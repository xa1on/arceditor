/**
 * ArcEditor Settings Module
 * Handles local user configurations, provider presets, and disk settings serialization.
 */

window.activePlan = null;

function updateProviderSectionsUI() {
    const activeProv = document.getElementById("setting-provider").value;
    const sections = document.querySelectorAll(".provider-section");
    sections.forEach(sec => {
        if (sec.getAttribute("data-provider") === activeProv) {
            sec.classList.add("active");
        } else {
            sec.classList.remove("active");
        }
    });
}

async function loadSettings() {
    let loaded = false;
    if (fs) {
        try {
            const dataStr = await fs.promises.readFile(configPath, 'utf8');
            const data = JSON.parse(dataStr);
            currentProvider = data.provider || "lemonade";

            if (data.providerSettings) {
                providerSettings = {
                    lemonade: { ...providerSettings.lemonade, ...data.providerSettings.lemonade },
                    gemini: { ...providerSettings.gemini, ...data.providerSettings.gemini },
                    openai: { ...providerSettings.openai, ...data.providerSettings.openai },
                    anthropic: { ...providerSettings.anthropic, ...data.providerSettings.anthropic }
                };
            } else {
                // Migrate legacy settings
                if (data.provider) {
                    providerSettings[data.provider].url = data.url || getDefaultUrl(data.provider);
                    providerSettings[data.provider].key = data.key || "";
                }
                if (data.model) {
                    providerSettings[currentProvider].model = data.model;
                }
            }

            apiUrl = providerSettings[currentProvider].url;
            apiKey = providerSettings[currentProvider].key;
            modelName = providerSettings[currentProvider].model || getDefaultModel(currentProvider);

            openaiReasoningEffort = providerSettings.openai.reasoningEffort || "medium";
            claudeThinkingBudget = providerSettings.anthropic.thinkingBudget !== undefined ? parseInt(providerSettings.anthropic.thinkingBudget, 10) : 2048;

            includeBase64InDebugLog = data.includeBase64InDebugLog !== undefined ? !!data.includeBase64InDebugLog : false;
            webSearchEnabled = data.webSearchEnabled !== undefined ? !!data.webSearchEnabled : true;
            maxToolRetryLimit = data.maxToolRetryLimit !== undefined ? parseInt(data.maxToolRetryLimit, 10) : 15;
            agentPermissionMode = data.agentPermissionMode || "review";
            uiTransitionsEnabled = data.uiTransitionsEnabled !== undefined ? !!data.uiTransitionsEnabled : true;
            apiTemperature = data.apiTemperature !== undefined ? parseFloat(data.apiTemperature) : 0.2;
            apiTopP = data.apiTopP !== undefined ? parseFloat(data.apiTopP) : 0.95;
            enabledSkills = data.enabledSkills || {};
            loaded = true;
        } catch (e) {
            if (e.code !== 'ENOENT') {
                console.error("Failed to load saved config:", e);
            }
        }
    }

    if (!loaded) {
        currentProvider = "lemonade";
        apiUrl = providerSettings.lemonade.url;
        apiKey = providerSettings.lemonade.key;
        modelName = providerSettings.lemonade.model;
        includeBase64InDebugLog = false;
        webSearchEnabled = true;
        maxToolRetryLimit = 15;
        agentPermissionMode = "review";
        uiTransitionsEnabled = true;
        apiTemperature = 0.2;
        apiTopP = 0.95;
        enabledSkills = {};
    }

    // Sync into settings DOM
    document.getElementById("setting-provider").value = currentProvider;

    // Sync each provider section inputs
    for (const prov in providerSettings) {
        const urlEl = document.getElementById(`setting-url-${prov}`);
        const keyEl = document.getElementById(`setting-key-${prov}`);
        if (urlEl) urlEl.value = providerSettings[prov].url;
        if (keyEl) keyEl.value = providerSettings[prov].key;
    }

    const opEffortEl = document.getElementById("setting-openai-reasoning-effort");
    if (opEffortEl) opEffortEl.value = providerSettings.openai.reasoningEffort || "medium";
    
    const anthThinkingEl = document.getElementById("setting-anthropic-thinking-budget");
    if (anthThinkingEl) anthThinkingEl.value = providerSettings.anthropic.thinkingBudget !== undefined ? providerSettings.anthropic.thinkingBudget : 2048;

    openaiReasoningEffort = providerSettings.openai.reasoningEffort || "medium";
    claudeThinkingBudget = providerSettings.anthropic.thinkingBudget !== undefined ? parseInt(providerSettings.anthropic.thinkingBudget, 10) : 2048;

    const base64Checkbox = document.getElementById("setting-include-base64");
    if (base64Checkbox) base64Checkbox.checked = includeBase64InDebugLog;
    const webSearchCheckbox = document.getElementById("setting-web-search");
    if (webSearchCheckbox) webSearchCheckbox.checked = webSearchEnabled;
    const maxRetryInput = document.getElementById("setting-max-tool-retry");
    if (maxRetryInput) maxRetryInput.value = maxToolRetryLimit;

    const tempInput = document.getElementById("setting-temperature");
    if (tempInput) tempInput.value = apiTemperature;
    const topPInput = document.getElementById("setting-top-p");
    if (topPInput) topPInput.value = apiTopP;

    const transitionsCheckbox = document.getElementById("setting-ui-transitions");
    if (transitionsCheckbox) transitionsCheckbox.checked = uiTransitionsEnabled;
    if (!uiTransitionsEnabled) {
        document.body.classList.add("no-transitions");
    } else {
        document.body.classList.remove("no-transitions");
    }

    const permissionModeSelect = document.getElementById("setting-permission-mode");
    if (permissionModeSelect) {
        permissionModeSelect.value = agentPermissionMode;
        if (typeof updatePermissionModeDescription === "function") {
            updatePermissionModeDescription(agentPermissionMode);
        }
    }

    updateProviderSectionsUI();
    populateAndQueryModels();
}

async function saveSettings(e) {
    if (e) e.preventDefault();

    currentProvider = document.getElementById("setting-provider").value;

    // Read from each provider's inputs
    for (const prov in providerSettings) {
        const urlEl = document.getElementById(`setting-url-${prov}`);
        const keyEl = document.getElementById(`setting-key-${prov}`);
        if (urlEl) providerSettings[prov].url = urlEl.value || getDefaultUrl(prov);
        if (keyEl) providerSettings[prov].key = keyEl.value;
    }

    const opEffortEl = document.getElementById("setting-openai-reasoning-effort");
    if (opEffortEl) {
        providerSettings.openai.reasoningEffort = opEffortEl.value;
        openaiReasoningEffort = opEffortEl.value;
    }
    
    const anthThinkingEl = document.getElementById("setting-anthropic-thinking-budget");
    if (anthThinkingEl) {
        const val = parseInt(anthThinkingEl.value, 10);
        providerSettings.anthropic.thinkingBudget = isNaN(val) ? 2048 : val;
        claudeThinkingBudget = providerSettings.anthropic.thinkingBudget;
    }

    // Sync active provider variables
    apiUrl = providerSettings[currentProvider].url;
    apiKey = providerSettings[currentProvider].key;
    modelName = providerSettings[currentProvider].model || getDefaultModel(currentProvider);

    const permissionModeSelect = document.getElementById("setting-permission-mode");
    if (permissionModeSelect) agentPermissionMode = permissionModeSelect.value || "review";

    const base64Checkbox = document.getElementById("setting-include-base64");
    if (base64Checkbox) includeBase64InDebugLog = base64Checkbox.checked;

    const webSearchCheckbox = document.getElementById("setting-web-search");
    if (webSearchCheckbox) webSearchEnabled = webSearchCheckbox.checked;

    const maxRetryInput = document.getElementById("setting-max-tool-retry");
    if (maxRetryInput) maxToolRetryLimit = parseInt(maxRetryInput.value, 10) || 15;

    const tempInput = document.getElementById("setting-temperature");
    if (tempInput) {
        const val = parseFloat(tempInput.value);
        apiTemperature = isNaN(val) ? 0.2 : val;
    }
    const topPInput = document.getElementById("setting-top-p");
    if (topPInput) {
        const val = parseFloat(topPInput.value);
        apiTopP = isNaN(val) ? 0.95 : val;
    }

    const transitionsCheckbox = document.getElementById("setting-ui-transitions");
    if (transitionsCheckbox) {
        uiTransitionsEnabled = transitionsCheckbox.checked;
        if (!uiTransitionsEnabled) {
            document.body.classList.add("no-transitions");
        } else {
            document.body.classList.remove("no-transitions");
        }
    }

    const config = {
        provider: currentProvider,
        providerSettings: providerSettings,
        model: modelName,
        includeBase64InDebugLog: includeBase64InDebugLog,
        webSearchEnabled: webSearchEnabled,
        maxToolRetryLimit: maxToolRetryLimit,
        agentPermissionMode: agentPermissionMode,
        uiTransitionsEnabled: uiTransitionsEnabled,
        apiTemperature: apiTemperature,
        apiTopP: apiTopP,
        enabledSkills: enabledSkills
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

    updateProviderSectionsUI();
    // Clear models cache to trigger a fresh query on next use
    cachedModels = {};
    populateAndQueryModels();
    toggleSettingsDrawer(false);
    validateConnection();
}

function getDefaultUrl(provider) {
    if (provider === "lemonade") return "http://localhost:13305/v1";
    if (provider === "openai") return "https://api.openai.com/v1";
    if (provider === "anthropic") return "https://api.anthropic.com/v1";
    if (provider === "gemini") return "https://generativelanguage.googleapis.com";
    return "";
}

function getDefaultModel(provider) {
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

function stripImagesForDisk(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== "object") return obj;

    if (Array.isArray(obj)) {
        var newArr = [];
        for (var i = 0; i < obj.length; i++) {
            newArr.push(stripImagesForDisk(obj[i]));
        }
        return newArr;
    }

    var copy = {};
    for (var key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            if (key === "images" && (typeof obj[key] === "string" || Array.isArray(obj[key]))) {
                copy[key] = null;
            } else if (key === "image_url" && typeof obj[key] === "object" && obj[key] && typeof obj[key].url === "string") {
                if (obj[key].url.indexOf("data:image/") === 0) {
                    copy[key] = { url: "data:image/png;base64,[Base64 Image Omitted]" };
                } else {
                    copy[key] = stripImagesForDisk(obj[key]);
                }
            } else {
                copy[key] = stripImagesForDisk(obj[key]);
            }
        }
    }
    return copy;
}

async function saveChats() {
    if (fs) {
        try {
            const chatsToSave = {};
            for (const key in allProjectChats) {
                if (key === "Unsaved Project" || key === "settings_Unsaved Project") {
                    continue;
                }
                
                if (key.startsWith("settings_")) {
                    const settings = allProjectChats[key];
                    const hasAllowed = settings && settings.allowedTools && settings.allowedTools.length > 0;
                    const hasDenied = settings && settings.deniedTools && settings.deniedTools.length > 0;
                    if (hasAllowed || hasDenied) {
                        chatsToSave[key] = settings;
                    }
                } else {
                    const sessions = allProjectChats[key];
                    if (Array.isArray(sessions)) {
                        const sessionsWithHistory = sessions.filter(s => s.history && s.history.length > 0);
                        if (sessionsWithHistory.length > 0) {
                            chatsToSave[key] = sessionsWithHistory;
                        }
                    }
                }
            }
            const cleanedChats = stripImagesForDisk(chatsToSave);
            await fs.promises.writeFile(chatsConfigPath, JSON.stringify(cleanedChats, null, 2), 'utf8');
        } catch (err) {
            console.error("Failed to save chats database to disk:", err);
        }
    }
}

// --- PROJECT SPECIFIC SCRIPTS AND PERSISTENT HISTORIES ---
async function loadScripts() {
    let loaded = false;
    if (fs) {
        try {
            const dataStr = await fs.promises.readFile(scriptsConfigPath, 'utf8');
            allProjectScripts = JSON.parse(dataStr);
            loaded = true;
        } catch (e) {
            if (e.code !== 'ENOENT') {
                console.error("Failed to load scripts database:", e);
            }
        }
    }

    if (!loaded) {
        allProjectScripts = {};
    }
}

async function saveScripts() {
    if (fs) {
        try {
            const scriptsToSave = {};
            for (const key in allProjectScripts) {
                if (key === "Unsaved Project" || key === "settings_Unsaved Project") {
                    continue;
                }
                const scripts = allProjectScripts[key];
                if (Array.isArray(scripts) && scripts.length > 0) {
                    scriptsToSave[key] = scripts;
                }
            }
            await fs.promises.writeFile(scriptsConfigPath, JSON.stringify(scriptsToSave, null, 2), 'utf8');
        } catch (err) {
            console.error("Failed to save scripts database to disk:", err);
        }
    }
}

function getProjectScripts(projectPath) {
    const proj = projectPath || currentProjectPath;
    if (!allProjectScripts[proj]) {
        allProjectScripts[proj] = [];
    }
    return allProjectScripts[proj];
}

function findScriptByName(projectPath, name) {
    const scripts = getProjectScripts(projectPath);
    return scripts.find(s => s.name === name);
}

function createOrUpdateScript(projectPath, name, content) {
    const scripts = getProjectScripts(projectPath);
    let script = scripts.find(s => s.name === name);
    if (script) {
        script.content = content;
        script.modified = Date.now();
    } else {
        script = {
            name: name,
            content: content,
            created: Date.now(),
            modified: Date.now()
        };
        scripts.push(script);
    }
    saveScripts();
    return script;
}

function renderScriptTabs() {
    const listContainer = document.getElementById("script-tabs-list");
    if (!listContainer) return;

    listContainer.innerHTML = "";

    const scripts = getProjectScripts(currentProjectPath);
    
    // Ensure there is at least one default script if empty
    if (scripts.length === 0) {
        createOrUpdateScript(currentProjectPath, "scratch.jsx", "// Custom ExtendScript scratchpad\n");
    }

    if (!activeScriptName || !findScriptByName(currentProjectPath, activeScriptName)) {
        activeScriptName = scripts[0] ? scripts[0].name : "scratch.jsx";
    }

    scripts.forEach(s => {
        const tab = document.createElement("div");
        tab.className = "chat-tab" + (s.name === activeScriptName ? " active" : "") + (isExecuting ? " disabled" : "");
        tab.title = s.name;
        tab.style.cursor = "pointer";

        // Click to load script
        tab.addEventListener("click", (e) => {
            if (isExecuting) return;
            if (e.target.closest(".chat-tab-close")) return;
            selectScriptTab(s.name);
        });

        // Double click to rename
        tab.addEventListener("dblclick", () => {
            if (isExecuting) return;
            const newName = prompt("Enter a new name for the script:", s.name);
            if (newName && newName.trim() && newName.trim() !== s.name) {
                renameScript(s.name, newName.trim());
            }
        });

        // Tab Title
        const titleSpan = document.createElement("span");
        titleSpan.className = "chat-tab-title";
        titleSpan.innerText = s.name;
        tab.appendChild(titleSpan);

        // Close/Delete Button
        const closeBtn = document.createElement("button");
        closeBtn.className = "chat-tab-close";
        closeBtn.title = "Delete script";
        closeBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="8" height="8" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        `;
        closeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (isExecuting) return;
            if (confirm(`Are you sure you want to delete script "${s.name}"?`)) {
                deleteScript(s.name);
            }
        });
        tab.appendChild(closeBtn);

        listContainer.appendChild(tab);
    });
}

function selectScriptTab(name) {
    activeScriptName = name;
    renderScriptTabs();
    
    const scriptObj = findScriptByName(currentProjectPath, name);
    const output = document.getElementById("console-output");
    if (output && scriptObj) {
        output.value = scriptObj.content;
    }
}

function deleteScript(name) {
    let scripts = getProjectScripts(currentProjectPath);
    scripts = scripts.filter(s => s.name !== name);
    allProjectScripts[currentProjectPath] = scripts;
    saveScripts();

    if (activeScriptName === name) {
        activeScriptName = scripts[0] ? scripts[0].name : null;
    }
    renderScriptTabs();
    if (activeScriptName) {
        selectScriptTab(activeScriptName);
    } else {
        const output = document.getElementById("console-output");
        if (output) output.value = "";
    }
}

function renameScript(oldName, newName) {
    const existing = findScriptByName(currentProjectPath, newName);
    if (existing) {
        alert(`A script named "${newName}" already exists.`);
        return;
    }

    const script = findScriptByName(currentProjectPath, oldName);
    if (script) {
        script.name = newName;
        script.modified = Date.now();
        saveScripts();
        if (activeScriptName === oldName) {
            activeScriptName = newName;
        }
        renderScriptTabs();
        if (activeScriptName === newName) {
            selectScriptTab(newName);
        }
    }
}


async function syncProjectPath() {
    if (isExecuting) {
        // Defer syncing project path and session migration while the agent loop is actively running
        return;
    }
    let activePath = "Unsaved Project";
    if (csInterface) {
        const result = await evalScriptAsync("$._com_arceditor_.ArcInspector.getProjectPath()");
        if (result && result.indexOf("Error") !== 0) {
            activePath = result.trim();
        }
    }

    if (activePath !== currentProjectPath) {
        const oldProjectPath = currentProjectPath;
        currentProjectPath = activePath;

        // Update UI Label
        const label = document.getElementById("label-active-project");
        if (label) {
            const lastSeparator = Math.max(activePath.lastIndexOf('/'), activePath.lastIndexOf('\\'));
            const baseName = activePath.substring(lastSeparator + 1);
            label.innerText = baseName || "Unsaved Project";
            label.title = activePath;
        }

        // Auto-migration: If transitioning from "Unsaved Project" to a saved project path,
        // move all chat sessions from "Unsaved Project" to the new project path key.
        if (oldProjectPath === "Unsaved Project" && activePath !== "Unsaved Project") {
            const unsavedSessions = allProjectChats["Unsaved Project"];
            if (unsavedSessions && unsavedSessions.length > 0) {
                if (!allProjectChats[activePath] || allProjectChats[activePath].length === 0) {
                    allProjectChats[activePath] = unsavedSessions;
                    delete allProjectChats["Unsaved Project"];
                    
                    // Also migrate project-specific settings (allowed tools)
                    const unsavedSettings = allProjectChats["settings_Unsaved Project"];
                    if (unsavedSettings) {
                        allProjectChats["settings_" + activePath] = unsavedSettings;
                        delete allProjectChats["settings_Unsaved Project"];
                    }
                    
                    saveChats();
                    console.log("[ArcEditor] Migrated active chat history from Unsaved Project to: " + activePath);
                }
            }

            // Migrate scripts as well
            const unsavedScripts = allProjectScripts["Unsaved Project"];
            if (unsavedScripts && unsavedScripts.length > 0) {
                if (!allProjectScripts[activePath] || allProjectScripts[activePath].length === 0) {
                    allProjectScripts[activePath] = unsavedScripts;
                    delete allProjectScripts["Unsaved Project"];
                    saveScripts();
                    console.log("[ArcEditor] Migrated active script history from Unsaved Project to: " + activePath);
                }
            }
        }

        // Load session list for this project
        initializeProjectSessions();
        
        // Render script tabs for new project path
        if (typeof renderScriptTabs === "function") {
            renderScriptTabs();
        }
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
            agentHistory: [],
            created: Date.now(),
            isOpen: true
        };
        sessions.push(newSession);
        saveChats();
    }

    // Find all open sessions
    const openSessions = sessions.filter(s => s.isOpen !== false);
    if (openSessions.length === 0) {
        if (sessions.length > 0) {
            sessions[sessions.length - 1].isOpen = true;
            activeSessionId = sessions[sessions.length - 1].id;
        } else {
            const newSession = {
                id: "session_" + Date.now(),
                title: "New Chat",
                history: [],
                agentHistory: [],
                created: Date.now(),
                isOpen: true
            };
            sessions.push(newSession);
            activeSessionId = newSession.id;
        }
        saveChats();
    } else {
        const activeExists = openSessions.some(s => s.id === activeSessionId);
        if (!activeExists) {
            activeSessionId = openSessions[openSessions.length - 1].id;
        }
    }

    // Render tabs
    renderChatTabs();

    // Load history of this active session
    loadSessionHistory(activeSessionId);
}

function loadSessionHistory(sessionId) {
    const sessions = allProjectChats[currentProjectPath] || [];
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;

    activeSessionId = sessionId;
    chatHistory = session.history || [];
    agentHistory = session.agentHistory || [];
    window.activePlan = session.activePlan || null;
    if (typeof window !== "undefined" && typeof window.updatePinnedPlanUI === "function") {
        window.updatePinnedPlanUI();
    }
    
    // Clear temporary attachments for the previous session
    if (typeof window !== "undefined" && typeof window.clearAttachmentDock === "function") {
        window.clearAttachmentDock();
    }

    // Clear Chat Scroller and re-render messages!
    const scroller = document.getElementById("chat-messages");
    if (scroller) {
        scroller.innerHTML = "";

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
                addBubble("ai", msg.content, null, turns, msg.reasoning);
            }
        });
    }

    if (typeof renderChatTabs === "function") {
        renderChatTabs();
    }

    if (typeof toggleWelcomeScreen === "function") {
        toggleWelcomeScreen(chatHistory.length === 0, false);
    }

    updateContextSizeInfo();
}

function updateCurrentSessionHistory() {
    const sessions = allProjectChats[currentProjectPath] || [];
    const session = sessions.find(s => s.id === activeSessionId);
    if (session) {
        session.history = chatHistory;
        session.agentHistory = agentHistory;
        session.activePlan = window.activePlan;

        // Auto-generate title from the first user prompt if the title is still "New Chat"
        if (session.title === "New Chat" && chatHistory.length > 0) {
            const firstUserMsg = chatHistory.find(m => m.role === "user");
            if (firstUserMsg) {
                let rawPrompt = firstUserMsg.userText || "";
                if (!rawPrompt.trim()) {
                    if (typeof firstUserMsg.content === "string") {
                        rawPrompt = firstUserMsg.content;
                    } else if (Array.isArray(firstUserMsg.content)) {
                        const textPart = firstUserMsg.content.find(p => p.type === "text");
                        if (textPart) rawPrompt = textPart.text;
                    }
                }

                // Clean up rawPrompt if it starts with attachment syntax
                let cleanPrompt = (rawPrompt || "").trim();
                if (cleanPrompt.startsWith("[Uploaded File:") || 
                    cleanPrompt.startsWith("[Uploaded Video:") || 
                    cleanPrompt.startsWith("[Uploaded PDF File:") || 
                    cleanPrompt.startsWith("[Captured Frame:")) {
                    const match = cleanPrompt.match(/\[(?:Uploaded File|Uploaded Video|Uploaded PDF File|Captured Frame):\s*([^\]\n]+)\]/);
                    if (match && match[1]) {
                        cleanPrompt = match[1];
                    }
                }

                // If cleanPrompt has newlines, extract only the first line
                if (cleanPrompt.includes("\n")) {
                    cleanPrompt = cleanPrompt.split("\n")[0];
                }

                let summary = cleanPrompt.trim().substring(0, 20);
                if (cleanPrompt.length > 20) summary += "...";
                session.title = summary || "New Chat";

                if (typeof renderChatTabs === "function") {
                    renderChatTabs();
                }
            }
        }

        saveChats();
    }
}

function createNewSession() {
    if (isExecuting) {
        addSystemMessage("Cannot create a new chat while the agent is active.");
        return;
    }

    if (!allProjectChats[currentProjectPath]) {
        allProjectChats[currentProjectPath] = [];
    }

    window.activePlan = null;
    if (typeof window !== "undefined" && typeof window.updatePinnedPlanUI === "function") {
        window.updatePinnedPlanUI();
    }

    const newSession = {
        id: "session_" + Date.now(),
        title: "New Chat",
        history: [],
        agentHistory: [],
        activePlan: null,
        created: Date.now(),
        isOpen: true
    };

    allProjectChats[currentProjectPath].push(newSession);
    saveChats();

    activeSessionId = newSession.id;
    loadSessionHistory(activeSessionId);
}

function closeSession(sessionId) {
    if (isExecuting) {
        addSystemMessage("Cannot close chat while the agent is active.");
        return;
    }

    const sessions = allProjectChats[currentProjectPath] || [];
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
        session.isOpen = false;
        saveChats();

        // If we closed the active session, switch to another open one
        if (sessionId === activeSessionId) {
            const openSessions = sessions.filter(s => s.isOpen !== false);
            if (openSessions.length > 0) {
                activeSessionId = openSessions[openSessions.length - 1].id;
                loadSessionHistory(activeSessionId);
            } else {
                createNewSession();
            }
        } else {
            renderChatTabs();
        }
    }
}

function restoreSession(sessionId) {
    if (isExecuting) {
        addSystemMessage("Cannot restore chat while the agent is active.");
        return;
    }

    const sessions = allProjectChats[currentProjectPath] || [];
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
        session.isOpen = true;
        saveChats();
        activeSessionId = sessionId;
        loadSessionHistory(activeSessionId);
    }
}

function deleteSession(sessionId) {
    if (isExecuting) {
        addSystemMessage("Cannot delete chat while the agent is active.");
        return;
    }

    const sessionToDeleteId = sessionId || activeSessionId;
    
    // Find the session info for confirmation prompt
    let sessionTitle = "this chat";
    for (const projPath in allProjectChats) {
        const sessions = allProjectChats[projPath] || [];
        const s = sessions.find(x => x.id === sessionToDeleteId);
        if (s) {
            sessionTitle = `"${s.title}"`;
            break;
        }
    }

    if (!confirm(`Are you sure you want to permanently delete ${sessionTitle}? This cannot be undone.`)) {
        return;
    }

    let deleted = false;

    // 1. Try to find and delete the session across ALL project keys to handle any project path desyncs
    for (const projPath in allProjectChats) {
        if (Object.prototype.hasOwnProperty.call(allProjectChats, projPath)) {
            const sessions = allProjectChats[projPath] || [];
            const idx = sessions.findIndex(s => s.id === sessionToDeleteId);
            if (idx !== -1) {
                sessions.splice(idx, 1);
                deleted = true;
                console.log("[ArcEditor] Deleted session " + sessionToDeleteId + " from project path: " + projPath);
                break;
            }
        }
    }

    // 2. Save changes to disk
    saveChats();

    // 3. Re-initialize sessions if the deleted session was the active one
    if (sessionToDeleteId === activeSessionId) {
        initializeProjectSessions();
    } else {
        renderChatTabs();
    }

    if (deleted) {
        addSystemMessage("Chat deleted permanently.");
    }
}

function renderChatTabs() {
    const listContainer = document.getElementById("chat-tabs-list");
    if (!listContainer) return;

    listContainer.innerHTML = "";

    const sessions = allProjectChats[currentProjectPath] || [];
    const openSessions = sessions.filter(s => s.isOpen !== false);

    openSessions.forEach(s => {
        const tab = document.createElement("div");
        tab.className = "chat-tab" + (s.id === activeSessionId ? " active" : "") + (isExecuting ? " disabled" : "");
        tab.title = s.title;

        // Click to load history
        tab.addEventListener("click", (e) => {
            if (isExecuting) return;
            // Prevent trigger if they clicked the close button
            if (e.target.closest(".chat-tab-close")) return;
            
            loadSessionHistory(s.id);
            
            // Switch view back to Chat pane automatically!
            if (typeof switchTab === "function") {
                switchTab("chat");
            }
        });

        // Tab Title
        const titleSpan = document.createElement("span");
        titleSpan.className = "chat-tab-title";
        titleSpan.innerText = s.title;
        tab.appendChild(titleSpan);

        // Close Button
        const closeBtn = document.createElement("button");
        closeBtn.className = "chat-tab-close";
        closeBtn.title = "Close chat";
        closeBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="8" height="8" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        `;
        closeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (isExecuting) return;
            closeSession(s.id);
        });
        tab.appendChild(closeBtn);

        listContainer.appendChild(tab);
    });

    // Populate past chats dropdown
    renderPastChatsDropdown();
}

function renderPastChatsDropdown() {
    const dropdown = document.getElementById("past-chats-dropdown");
    if (!dropdown) return;

    dropdown.innerHTML = "";

    const sessions = allProjectChats[currentProjectPath] || [];
    const closedSessions = sessions.filter(s => s.isOpen === false);

    if (closedSessions.length === 0) {
        const emptyDiv = document.createElement("div");
        emptyDiv.style.padding = "8px";
        emptyDiv.style.color = "var(--text-secondary)";
        emptyDiv.style.textAlign = "center";
        emptyDiv.style.fontStyle = "italic";
        emptyDiv.style.fontSize = "10px";
        emptyDiv.innerText = "No past chats";
        dropdown.appendChild(emptyDiv);
        return;
    }

    closedSessions.forEach(s => {
        const item = document.createElement("div");
        item.className = "past-chat-item";

        // Click title to restore
        const titleBtn = document.createElement("button");
        titleBtn.className = "past-chat-title-btn";
        titleBtn.title = `Restore: ${s.title}`;
        titleBtn.innerText = s.title;
        titleBtn.addEventListener("click", () => {
            if (isExecuting) return;
            restoreSession(s.id);
            dropdown.classList.add("hidden");
        });
        item.appendChild(titleBtn);

        // Delete button
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "past-chat-delete";
        deleteBtn.title = "Delete permanently";
        deleteBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="10" height="10" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
        `;
        deleteBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (isExecuting) return;
            deleteSession(s.id);
        });
        item.appendChild(deleteBtn);

        dropdown.appendChild(item);
    });
}

// --- DYNAMIC MODEL SELECTOR & CACHING LOGIC ---
let cachedModels = {};

async function fetchModelsForProvider(provider, url, key) {
    const debugTextarea = document.getElementById("debug-output");
    if (debugTextarea) {
        const timestamp = new Date().toISOString();
        debugTextarea.value += `\n[${timestamp}] [DEBUG] Fetching models for ${provider} from URL: ${url} (Key length: ${key ? key.length : 0})\n`;
        debugTextarea.scrollTop = debugTextarea.scrollHeight;
    }

    if (cachedModels[provider] && cachedModels[provider].length > 0) {
        return cachedModels[provider];
    }

    if (!httpsClient && !httpClient && typeof fetch === "undefined") {
        const errorMsg = "Cannot dynamically fetch models: Node.js network modules and browser fetch are both unavailable.";
        if (debugTextarea) {
            const timestamp = new Date().toISOString();
            debugTextarea.value += `\n[${timestamp}] [ERROR] ${errorMsg}\n`;
            debugTextarea.scrollTop = debugTextarea.scrollHeight;
        }
        return [];
    }

    try {
        let models = [];
        const cleanUrl = url.replace(/\/$/, "");

        if (provider === "lemonade" || provider === "openai") {
            const checkUrl = cleanUrl.endsWith("/models") ? cleanUrl : `${cleanUrl}/models`;
            const headers = {};
            if (provider === "openai" && key) {
                headers["Authorization"] = `Bearer ${key}`;
            }
            const res = await makeRequest(checkUrl, 'GET', headers, "");
            const parsed = JSON.parse(res);
            if (parsed.data && Array.isArray(parsed.data)) {
                models = parsed.data.map(m => m.id);
            }
        } else if (provider === "gemini") {
            const checkUrl = `${cleanUrl}/v1beta/models?key=${key}`;
            const res = await makeRequest(checkUrl, 'GET', {}, "");
            const parsed = JSON.parse(res);
            if (parsed.models && Array.isArray(parsed.models)) {
                models = parsed.models
                    .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"))
                    .map(m => m.name.replace(/^models\//, ""));
            }
        } else if (provider === "anthropic") {
            const checkUrl = `${cleanUrl}/v1/models`;
            const headers = {
                "x-api-key": key,
                "anthropic-version": "2023-06-01"
            };
            const res = await makeRequest(checkUrl, 'GET', headers, "");
            const parsed = JSON.parse(res);
            if (parsed.data && Array.isArray(parsed.data)) {
                models = parsed.data.map(m => m.id);
            }
        }

        if (models && models.length > 0) {
            const successMsg = `Successfully fetched ${models.length} models for ${provider}: ${models.join(", ")}`;
            if (debugTextarea) {
                const timestamp = new Date().toISOString();
                debugTextarea.value += `\n[${timestamp}] [DEBUG] ${successMsg}\n`;
                debugTextarea.scrollTop = debugTextarea.scrollHeight;
            }
            cachedModels[provider] = models;
            return models;
        } else {
            const emptyMsg = `Fetch models returned no models (empty list) for provider: ${provider}`;
            if (debugTextarea) {
                const timestamp = new Date().toISOString();
                debugTextarea.value += `\n[${timestamp}] [DEBUG] ${emptyMsg}\n`;
                debugTextarea.scrollTop = debugTextarea.scrollHeight;
            }
            return [];
        }
    } catch (e) {
        console.warn(`[ArcEditor] Failed to fetch models for ${provider}:`, e);
        const errorMsg = `Failed to fetch models for ${provider}: ${e.message || e}`;
        if (debugTextarea) {
            const timestamp = new Date().toISOString();
            debugTextarea.value += `\n[${timestamp}] [ERROR] ${errorMsg}\n`;
            debugTextarea.scrollTop = debugTextarea.scrollHeight;
        }
        return [];
    }
}

function getFriendlyModelName(modelId) {
    return modelId || "";
}

async function updateModelDropdownOptions(provider, url, key, selectedModel, forceQuery = false) {
    const footerSelect = document.getElementById("chat-model-select");
    const welcomeSelect = document.getElementById("welcome-chat-model-select");
    if (!footerSelect && !welcomeSelect) return;

    let models = [];
    if (forceQuery) {
        models = await fetchModelsForProvider(provider, url, key);
    } else {
        models = cachedModels[provider] || [];
    }

    if (!models || models.length === 0) {
        models = cachedModels[provider] || [];
    }

    const populateSelect = (select) => {
        if (!select) return;
        select.innerHTML = "";

        models.forEach(m => {
            const opt = document.createElement("option");
            opt.value = m;
            opt.text = getFriendlyModelName(m);
            select.appendChild(opt);
        });

        const customOpt = document.createElement("option");
        customOpt.value = "custom";
        customOpt.text = "Custom model...";
        select.appendChild(customOpt);

        if (selectedModel && models.includes(selectedModel)) {
            select.value = selectedModel;
        } else if (selectedModel) {
            const customModelOpt = document.createElement("option");
            customModelOpt.value = selectedModel;
            customModelOpt.text = getFriendlyModelName(selectedModel);
            select.insertBefore(customModelOpt, customOpt);
            select.value = selectedModel;
        } else {
            select.value = models[0] || "custom";
        }
    };

    populateSelect(footerSelect);
    populateSelect(welcomeSelect);
}

async function populateAndQueryModels() {
    const provider = document.getElementById("setting-provider").value;
    const urlEl = document.getElementById(`setting-url-${provider}`);
    const keyEl = document.getElementById(`setting-key-${provider}`);
    const url = (urlEl && urlEl.value.trim()) ? urlEl.value.trim() : getDefaultUrl(provider);
    const key = (keyEl && keyEl.value.trim()) ? keyEl.value.trim() : "";
    const currentModelVal = providerSettings[provider] ? providerSettings[provider].model : getDefaultModel(provider);

    await updateModelDropdownOptions(provider, url, key, currentModelVal);

    if (!cachedModels[provider]) {
        fetchModelsForProvider(provider, url, key).then(() => {
            const currentVal = providerSettings[provider] ? providerSettings[provider].model : getDefaultModel(provider);
            updateModelDropdownOptions(provider, url, key, currentVal);
        });
    }
}

function handleProviderChange() {
    updateProviderSectionsUI();
}

document.addEventListener("DOMContentLoaded", () => {
    const providerSelect = document.getElementById("setting-provider");
    if (providerSelect) {
        providerSelect.addEventListener("change", handleProviderChange);
    }
});

function renderSkillsSettingsUI() {
    const container = document.getElementById("settings-skills-list");
    if (!container) return;
    
    container.innerHTML = "";
    if (!skillsList || skillsList.length === 0) {
        container.innerHTML = `<div style="font-size: 10px; color: var(--text-secondary); font-style: italic; text-align: center; padding: 6px 0;">No skills found.</div>`;
        return;
    }
    
    skillsList.forEach(skill => {
        const item = document.createElement("div");
        item.style.display = "flex";
        item.style.flexDirection = "column";
        item.style.gap = "4px";
        item.style.padding = "6px";
        item.style.borderBottom = "1px solid rgba(255, 255, 255, 0.03)";
        
        const header = document.createElement("div");
        header.style.display = "flex";
        header.style.alignItems = "center";
        header.style.justifyContent = "space-between";
        
        const titleWrap = document.createElement("div");
        titleWrap.style.display = "flex";
        titleWrap.style.alignItems = "center";
        titleWrap.style.gap = "6px";
        
        const title = document.createElement("span");
        title.style.fontWeight = "600";
        title.style.color = "var(--text-primary)";
        title.style.fontSize = "11px";
        title.innerText = skill.title;
        
        const badge = document.createElement("span");
        badge.style.fontSize = "8px";
        badge.style.padding = "1px 4px";
        badge.style.borderRadius = "2px";
        badge.style.textTransform = "uppercase";
        if (skill.isBuiltIn) {
            badge.style.background = "rgba(20, 115, 230, 0.15)";
            badge.style.color = "var(--text-accent)";
            badge.innerText = "Built-in";
        } else {
            badge.style.background = "rgba(0, 200, 81, 0.15)";
            badge.style.color = "var(--text-success)";
            badge.innerText = "Custom";
        }
        
        titleWrap.appendChild(title);
        titleWrap.appendChild(badge);
        
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = !!enabledSkills[skill.id];
        checkbox.style.cursor = "pointer";
        checkbox.style.width = "14px";
        checkbox.style.height = "14px";
        checkbox.style.accentColor = "var(--text-accent)";
        checkbox.addEventListener("change", (e) => {
            skillsManager.toggleSkill(skill.id, e.target.checked);
        });
        
        header.appendChild(titleWrap);
        header.appendChild(checkbox);
        
        const desc = document.createElement("span");
        desc.style.fontSize = "9px";
        desc.style.color = "var(--text-secondary)";
        desc.style.lineHeight = "1.3";
        desc.innerText = skill.description;
        
        item.appendChild(header);
        item.appendChild(desc);
        container.appendChild(item);
    });
}

window.renderSkillsSettingsUI = renderSkillsSettingsUI;
window.renderChatTabs = renderChatTabs;
window.closeSession = closeSession;
window.restoreSession = restoreSession;
window.deleteSession = deleteSession;
window.createNewSession = createNewSession;

window.loadScripts = loadScripts;
window.saveScripts = saveScripts;
window.getProjectScripts = getProjectScripts;
window.findScriptByName = findScriptByName;
window.createOrUpdateScript = createOrUpdateScript;
window.renderScriptTabs = renderScriptTabs;
window.selectScriptTab = selectScriptTab;
window.deleteScript = deleteScript;
window.renameScript = renameScript;

