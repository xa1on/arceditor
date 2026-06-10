/**
 * ArcEditor Settings Module
 * Handles local user configurations, provider presets, and disk settings serialization.
 */

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
        currentProvider = "lemonade";
        apiUrl = providerSettings.lemonade.url;
        apiKey = providerSettings.lemonade.key;
        modelName = providerSettings.lemonade.model;
        includeBase64InDebugLog = false;
        maxToolRetryLimit = 15;
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

    const base64Checkbox = document.getElementById("setting-include-base64");
    if (base64Checkbox) base64Checkbox.checked = includeBase64InDebugLog;
    const maxRetryInput = document.getElementById("setting-max-tool-retry");
    if (maxRetryInput) maxRetryInput.value = maxToolRetryLimit;

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

    // Sync active provider variables
    apiUrl = providerSettings[currentProvider].url;
    apiKey = providerSettings[currentProvider].key;
    modelName = providerSettings[currentProvider].model || getDefaultModel(currentProvider);

    const base64Checkbox = document.getElementById("setting-include-base64");
    if (base64Checkbox) includeBase64InDebugLog = base64Checkbox.checked;

    const maxRetryInput = document.getElementById("setting-max-tool-retry");
    if (maxRetryInput) maxToolRetryLimit = parseInt(maxRetryInput.value, 10) || 15;

    const config = {
        provider: currentProvider,
        providerSettings: providerSettings,
        model: modelName,
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

    updateProviderSectionsUI();
    // Clear models cache to trigger a fresh query on next use
    cachedModels = {};
    populateAndQueryModels();
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
            const chatsToSave = { ...allProjectChats };
            delete chatsToSave["Unsaved Project"];
            const cleanedChats = stripImagesForDisk(chatsToSave);
            await fs.promises.writeFile(chatsConfigPath, JSON.stringify(cleanedChats, null, 2), 'utf8');
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
                addBubble("ai", msg.content, null, turns);
            }
        });
    }

    // Sync selection in dropdown UI
    const select = document.getElementById("select-chat-session");
    if (select) select.value = activeSessionId;

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
