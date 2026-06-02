/**
 * ArcEditor Settings Module
 * Handles local user configurations, provider presets, and disk settings serialization.
 */

async function loadSettings() {
    let loaded = false;
    if (fs) {
        try {
            const dataStr = await fs.promises.readFile(configPath, 'utf8');
            const data = JSON.parse(dataStr);
            currentProvider = data.provider || "lemonade";
            apiUrl = data.url || getDefaultUrl(currentProvider);
            modelName = data.model || getDefaultModel(currentProvider);
            apiKey = data.key || "";
            includeBase64InDebugLog = data.includeBase64InDebugLog !== undefined ? !!data.includeBase64InDebugLog : false;
            maxToolRetryLimit = data.maxToolRetryLimit !== undefined ? parseInt(data.maxToolRetryLimit, 10) : 15;
            loaded = true;
        } catch (e) {
            if (e.code !== 'ENOENT') {
                console.error("Failed to load saved config:", e);
            }
        }
    }

    if (!loaded) {
        // Apply defaults
        currentProvider = "lemonade";
        apiUrl = getDefaultUrl(currentProvider);
        modelName = getDefaultModel(currentProvider);
        apiKey = "";
        includeBase64InDebugLog = false;
        maxToolRetryLimit = 15;
    }

    // Sync into settings DOM
    document.getElementById("setting-provider").value = currentProvider;
    document.getElementById("setting-url").value = apiUrl;
    document.getElementById("setting-model").value = modelName;
    document.getElementById("setting-key").value = apiKey;
    const base64Checkbox = document.getElementById("setting-include-base64");
    if (base64Checkbox) base64Checkbox.checked = includeBase64InDebugLog;
    const maxRetryInput = document.getElementById("setting-max-tool-retry");
    if (maxRetryInput) maxRetryInput.value = maxToolRetryLimit;
}

async function saveSettings(e) {
    if (e) e.preventDefault();

    currentProvider = document.getElementById("setting-provider").value;
    apiUrl = document.getElementById("setting-url").value || getDefaultUrl(currentProvider);
    modelName = document.getElementById("setting-model").value || getDefaultModel(currentProvider);
    apiKey = document.getElementById("setting-key").value;
    
    const base64Checkbox = document.getElementById("setting-include-base64");
    if (base64Checkbox) includeBase64InDebugLog = base64Checkbox.checked;
    
    const maxRetryInput = document.getElementById("setting-max-tool-retry");
    if (maxRetryInput) maxToolRetryLimit = parseInt(maxRetryInput.value, 10) || 15;

    const config = {
        provider: currentProvider,
        url: apiUrl,
        model: modelName,
        key: apiKey,
        includeBase64InDebugLog: includeBase64InDebugLog,
        maxToolRetryLimit: maxToolRetryLimit
    };

    if (fs) {
        try {
            await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
            addSystemMessage("Settings saved successfully.");
        } catch (err) {
            console.error("Failed to save settings to disk:", err);
            addSystemMessage("Error saving settings to local config file: " + err.message);
        }
    } else {
        addSystemMessage("Settings applied locally (Running in browser mode).");
    }

    toggleSettingsDrawer(false);
    validateConnection();
}

function getDefaultUrl(provider) {
    if (provider === "lemonade") return "http://localhost:1337/v1";
    if (provider === "openai") return "https://api.openai.com/v1";
    if (provider === "anthropic") return "https://api.anthropic.com/v1";
    if (provider === "gemini") return "https://generativelanguage.googleapis.com";
    return "";
}

function getDefaultModel(provider) {
    if (provider === "lemonade") return "qwen2.5-coder-7b";
    if (provider === "gemini") return "gemini-1.5-flash";
    if (provider === "openai") return "gpt-4o";
    if (provider === "anthropic") return "claude-3-5-sonnet-20241022";
    return "";
}

// --- PROJECT SPECIFIC CHATS AND PERSISTENT HISTORIES ---
async function loadChats() {
    let loaded = false;
    if (fs) {
        try {
            const dataStr = await fs.promises.readFile(chatsConfigPath, 'utf8');
            allProjectChats = JSON.parse(dataStr);
            loaded = true;
        } catch (e) {
            if (e.code !== 'ENOENT') {
                console.error("Failed to load chats database:", e);
            }
        }
    }

    if (!loaded) {
        allProjectChats = {};
    }
}

async function saveChats() {
    if (fs) {
        try {
            await fs.promises.writeFile(chatsConfigPath, JSON.stringify(allProjectChats, null, 2), 'utf8');
        } catch (err) {
            console.error("Failed to save chats database to disk:", err);
        }
    }
}

async function syncProjectPath() {
    if (isExecuting) {
        // Defer syncing project path and session migration while the agent loop is actively running
        return;
    }
    let path = "Unsaved Project";
    if (csInterface) {
        const result = await evalScriptAsync("$._com_arceditor_.ArcInspector.getProjectPath()");
        if (result && result.indexOf("Error") !== 0) {
            path = result.trim();
        }
    }
    
    if (path !== currentProjectPath) {
        const oldProjectPath = currentProjectPath;
        currentProjectPath = path;
        
        // Update UI Label
        const label = document.getElementById("label-active-project");
        if (label) {
            const lastSeparator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
            const baseName = path.substring(lastSeparator + 1);
            label.innerText = baseName || "Unsaved Project";
            label.title = path;
        }
        
        // Auto-migration: If transitioning from "Unsaved Project" to a saved project path,
        // move all chat sessions from "Unsaved Project" to the new project path key.
        if (oldProjectPath === "Unsaved Project" && path !== "Unsaved Project") {
            const unsavedSessions = allProjectChats["Unsaved Project"];
            if (unsavedSessions && unsavedSessions.length > 0) {
                if (!allProjectChats[path] || allProjectChats[path].length === 0) {
                    allProjectChats[path] = unsavedSessions;
                    delete allProjectChats["Unsaved Project"];
                    saveChats();
                    console.log("[ArcEditor] Migrated active chat history from Unsaved Project to: " + path);
                }
            }
        }
        
        // Load session list for this project
        initializeProjectSessions();
    }
}

function initializeProjectSessions() {
    if (!allProjectChats[currentProjectPath]) {
        allProjectChats[currentProjectPath] = [];
    }
    
    const sessions = allProjectChats[currentProjectPath];
    if (sessions.length === 0) {
        // Create initial default session
        const newSession = {
            id: "session_" + Date.now(),
            title: "New Chat",
            history: [],
            created: Date.now()
        };
        sessions.push(newSession);
        saveChats();
    }
    
    // Populate Dropdown selector
    const select = document.getElementById("select-chat-session");
    if (select) {
        select.innerHTML = '<option value="new">+ New Chat...</option>';
        
        sessions.forEach(s => {
            const opt = document.createElement("option");
            opt.value = s.id;
            opt.innerText = s.title;
            select.appendChild(opt);
        });
        
        // Select the last active session or the first one
        activeSessionId = sessions[sessions.length - 1].id;
        select.value = activeSessionId;
    }
    
    // Load history of this active session
    loadSessionHistory(activeSessionId);
}

function loadSessionHistory(sessionId) {
    const sessions = allProjectChats[currentProjectPath] || [];
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;
    
    activeSessionId = sessionId;
    chatHistory = session.history || [];
    
    // Clear Chat Scroller and re-render messages!
    const scroller = document.getElementById("chat-messages");
    if (scroller) {
        scroller.innerHTML = `
            <div class="message system-msg">
                <div class="message-content">
                    <p><strong>ArcEditor v1.0.0</strong> initialized. Setup your API key or point to a local Lemonade server to begin automating, editing, and designing compositions!</p>
                </div>
            </div>
        `;
        
        // Re-render chat bubbles from history, filtering out intermediate technical turns!
        chatHistory.forEach(msg => {
            if (msg.isIntermediate) {
                return;
            }
            if (msg.role === "user") {
                let textContent = "";
                let base64Images = [];
                if (typeof msg.content === "string") {
                    textContent = msg.content;
                } else if (Array.isArray(msg.content)) {
                    const textPart = msg.content.find(p => p.type === "text");
                    if (textPart) textContent = textPart.text;
                    const imgParts = msg.content.filter(p => p.type === "image_url");
                    imgParts.forEach(imgPart => {
                        if (imgPart.image_url && imgPart.image_url.url) {
                            const urlStr = imgPart.image_url.url;
                            if (urlStr.indexOf("base64,") !== -1) {
                                base64Images.push(urlStr.substring(urlStr.indexOf("base64,") + 7));
                            }
                        }
                    });
                }
                addBubble("user", textContent, base64Images);
            } else if (msg.role === "assistant" && msg.content) {
                const turns = msg.intermediateTurns !== undefined ? msg.intermediateTurns : msg.intermediateTurnsHtml;
                addBubble("ai", msg.content, null, turns);
            }
        });
    }
    
    // Sync selection in dropdown UI
    const select = document.getElementById("select-chat-session");
    if (select) select.value = activeSessionId;
    
    updateContextSizeInfo();
}

function updateCurrentSessionHistory() {
    const sessions = allProjectChats[currentProjectPath] || [];
    const session = sessions.find(s => s.id === activeSessionId);
    if (session) {
        session.history = chatHistory;
        
        // Auto-generate title from the first user prompt if the title is still "New Chat"
        if (session.title === "New Chat" && chatHistory.length > 0) {
            const firstUserMsg = chatHistory.find(m => m.role === "user");
            if (firstUserMsg) {
                let rawPrompt = "";
                if (typeof firstUserMsg.content === "string") {
                    rawPrompt = firstUserMsg.content;
                } else if (Array.isArray(firstUserMsg.content)) {
                    const textPart = firstUserMsg.content.find(p => p.type === "text");
                    if (textPart) rawPrompt = textPart.text;
                }
                
                let summary = rawPrompt.trim().substring(0, 20);
                if (rawPrompt.length > 20) summary += "...";
                session.title = summary || "New Chat";
                
                // Re-populate select list to show the new title
                const select = document.getElementById("select-chat-session");
                if (select) {
                    const opt = select.querySelector(`option[value="${activeSessionId}"]`);
                    if (opt) opt.innerText = session.title;
                }
            }
        }
        
        saveChats();
    }
}

function createNewSession() {
    if (!allProjectChats[currentProjectPath]) {
        allProjectChats[currentProjectPath] = [];
    }
    
    const newSession = {
        id: "session_" + Date.now(),
        title: "New Chat",
        history: [],
        created: Date.now()
    };
    
    allProjectChats[currentProjectPath].push(newSession);
    saveChats();
    
    // Add to select dropdown
    const select = document.getElementById("select-chat-session");
    if (select) {
        const opt = document.createElement("option");
        opt.value = newSession.id;
        opt.innerText = newSession.title;
        select.appendChild(opt);
        
        activeSessionId = newSession.id;
        select.value = activeSessionId;
    }
    
    loadSessionHistory(activeSessionId);
}

function deleteSession() {
    let deleted = false;
    
    // 1. Try to find and delete the session across ALL project keys to handle any project path desyncs
    for (const projPath in allProjectChats) {
        if (Object.prototype.hasOwnProperty.call(allProjectChats, projPath)) {
            const sessions = allProjectChats[projPath] || [];
            const idx = sessions.findIndex(s => s.id === activeSessionId);
            if (idx !== -1) {
                sessions.splice(idx, 1);
                deleted = true;
                console.log("[ArcEditor] Deleted session " + activeSessionId + " from project path: " + projPath);
                break;
            }
        }
    }

    // 2. Save changes to disk
    saveChats();

    // 3. Re-initialize sessions for the current project path
    initializeProjectSessions();

    // 4. Update UI scroll & message bubbles
    if (deleted) {
        addSystemMessage("Chat deleted successfully. Spun up a new clean chat session.");
    } else {
        // Fallback: If we couldn't find the activeSessionId anywhere, force a clean reset of the current project's sessions
        console.warn("[ArcEditor] activeSessionId (" + activeSessionId + ") not found. Forcing clean reset of current project chats.");
        if (allProjectChats[currentProjectPath]) {
            allProjectChats[currentProjectPath] = [];
        }
        initializeProjectSessions();
        addSystemMessage("Session state was out of sync. Active chat successfully reset.");
    }
}
