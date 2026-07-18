/**
 * ArcEditor State Module
 * Holds global states, Node.js runtime bindings, and settings persistence path keys.
 */

// Global state variables
let currentProvider = "lemonade";
let apiUrl = "http://localhost:13305/v1";
let modelName = "";
let apiKey = "";
let isConnected = false;
let includeBase64InDebugLog = false;
let maxToolRetryLimit = 15;
let openaiReasoningEffort = "medium";
let claudeThinkingBudget = 2048;
let agentPermissionMode = "review";
let webSearchEnabled = true;
let uiTransitionsEnabled = true;
let apiTemperature = 0.2;
let apiTopP = 0.95;

let providerSettings = {
    lemonade: { url: "http://localhost:13305/v1", key: "", model: "" },
    gemini: { url: "https://generativelanguage.googleapis.com", key: "", model: "" },
    openai: { url: "https://api.openai.com/v1", key: "", model: "", reasoningEffort: "medium" },
    anthropic: { url: "https://api.anthropic.com/v1", key: "", model: "", thinkingBudget: 2048 }
};

let chatHistory = [];
let agentHistory = [];
let attachedFrames = [];
let installedEffects = {};
let lastApiUsage = null; // { promptTokens, completionTokens, totalTokens }
let skillsList = [];
let enabledSkills = {};

// Safe Node.js loading (allows mockup testing inside standalone browsers)
let fs = null, path = null, os = null, httpsClient = null, httpClient = null, url = null;
let csInterface = null;
let extensionPath = "./";
let configPath = "./config.json";
let chatsConfigPath = "./chats.json";
let scriptsConfigPath = "./scripts.json";
let effectsCachePath = "./effects_cache.json";
let effectPropertiesCachePath = "./effect_properties_cache.json";
let appConfigDir = "";

try {
    if (typeof require !== "undefined") {
        fs = require('fs');
        path = require('path');
        os = require('os');
        httpsClient = require('https');
        httpClient = require('http');
        url = require('url');
    }
} catch (e) {
    console.warn("[ArcEditor] Node.js context not detected. Running in mockup browser mode.");
}

// Initialize Adobe CEP CSInterface
try {
    if (typeof CSInterface !== "undefined") {
        csInterface = new CSInterface();
        extensionPath = csInterface.getSystemPath('extension');
        if (extensionPath && extensionPath.indexOf("file://") === 0) {
            if (url && typeof url.fileURLToPath === "function") {
                extensionPath = url.fileURLToPath(extensionPath);
            } else {
                if (/^file:\/\/\/[a-zA-Z]:/.test(extensionPath)) {
                    extensionPath = extensionPath.replace(/^file:\/\/\//, "");
                } else {
                    extensionPath = extensionPath.replace(/^file:\/\//, "");
                }
                extensionPath = decodeURIComponent(extensionPath);
                if (path && os && os.platform() === "win32") {
                    extensionPath = extensionPath.replace(/\//g, "\\");
                }
            }
        }
    }
} catch (e) {
    console.error("CSInterface initialization failed:", e);
}

// Set writable config path in dynamic Documents/ArcEditor folder (avoids Program Files read-only permission issues!)
if (os && path && fs) {
    appConfigDir = "";
    try {
        let docsPath = "";
        if (csInterface && typeof csInterface.getSystemPath === "function") {
            docsPath = csInterface.getSystemPath("myDocuments");
        }
        if (docsPath) {
            // Normalize path if it starts with file:// scheme
            if (docsPath.indexOf("file://") === 0) {
                if (url && typeof url.fileURLToPath === "function") {
                    docsPath = url.fileURLToPath(docsPath);
                } else {
                    // Manual parsing fallback if url module is unavailable
                    if (/^file:\/\/\/[a-zA-Z]:/.test(docsPath)) {
                        docsPath = docsPath.replace(/^file:\/\/\//, ""); // Remove file:///
                    } else {
                        docsPath = docsPath.replace(/^file:\/\//, ""); // Remove file://, keeping root /
                    }
                    docsPath = decodeURIComponent(docsPath);
                    if (path && os && os.platform() === "win32") {
                        docsPath = docsPath.replace(/\//g, "\\");
                    }
                }
            }
        }
        if (!docsPath) {
            docsPath = path.join(os.homedir(), 'Documents');
        }

        appConfigDir = path.join(docsPath, 'ArcEditor');
        if (!fs.existsSync(appConfigDir)) {
            fs.mkdirSync(appConfigDir, { recursive: true });
        }
    } catch (e) {
        console.error("Failed to dynamically locate or create ArcEditor Documents folder:", e);
        appConfigDir = os.homedir(); // Safe fallback to user home directory
    }
    configPath = path.join(appConfigDir, 'config.json');
    chatsConfigPath = path.join(appConfigDir, 'chats.json');
    scriptsConfigPath = path.join(appConfigDir, 'scripts.json');
    effectsCachePath = path.join(appConfigDir, 'effects_cache.json');
    effectPropertiesCachePath = path.join(appConfigDir, 'effect_properties_cache.json');
} else {
    configPath = "./config.json";
    chatsConfigPath = "./chats.json";
    scriptsConfigPath = "./scripts.json";
    effectsCachePath = "./effects_cache.json";
    effectPropertiesCachePath = "./effect_properties_cache.json";
}

// Project specific chat sessions state
let allProjectChats = {};
let activeSessionId = null;
let allProjectScripts = {};
let activeScriptName = null;
let currentProjectPath = "Unsaved Project";
let isExecuting = false;
let isStopped = false;
let currentExecutionId = 0;
let historyVersion = 0;
let activeAiBubbleId = null;

// Project-level tool execution permissions helpers
function getProjectAllowedTools(projectPath) {
    const key = "settings_" + (projectPath || currentProjectPath);
    if (!allProjectChats[key]) {
        allProjectChats[key] = { allowedTools: [], deniedTools: [] };
    }
    if (!allProjectChats[key].allowedTools) {
        allProjectChats[key].allowedTools = [];
    }
    if (!allProjectChats[key].deniedTools) {
        allProjectChats[key].deniedTools = [];
    }
    return allProjectChats[key].allowedTools;
}

function setProjectAllowedTools(projectPath, allowedList) {
    const key = "settings_" + (projectPath || currentProjectPath);
    if (!allProjectChats[key]) {
        allProjectChats[key] = {};
    }
    allProjectChats[key].allowedTools = allowedList;
    if (typeof saveChats === "function") {
        saveChats();
    }
}

function getProjectDeniedTools(projectPath) {
    const key = "settings_" + (projectPath || currentProjectPath);
    if (!allProjectChats[key]) {
        allProjectChats[key] = { allowedTools: [], deniedTools: [] };
    }
    if (!allProjectChats[key].deniedTools) {
        allProjectChats[key].deniedTools = [];
    }
    return allProjectChats[key].deniedTools;
}

function setProjectDeniedTools(projectPath, deniedList) {
    const key = "settings_" + (projectPath || currentProjectPath);
    if (!allProjectChats[key]) {
        allProjectChats[key] = {};
    }
    allProjectChats[key].deniedTools = deniedList;
    if (typeof saveChats === "function") {
        saveChats();
    }
}

