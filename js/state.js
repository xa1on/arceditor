/**
 * ArcEditor State Module
 * Encapsulates application state under window.ArcEditor.state namespace
 * and provides safe Node.js runtime path bindings.
 */

window.ArcEditor = window.ArcEditor || {};

// Node.js & CEP runtime handles
let fs = null, path = null, os = null, httpsClient = null, httpClient = null, url = null;
let csInterface = null;

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
    console.warn("[ArcEditor] Node.js context not detected. Running in browser mockup mode.");
}

/**
 * Normalizes file:// URIs and platform paths.
 */
function normalizeFilePath(pathStr) {
    if (!pathStr || typeof pathStr !== "string") return pathStr || "";
    if (pathStr.indexOf("file://") === 0) {
        if (url && typeof url.fileURLToPath === "function") {
            return url.fileURLToPath(pathStr);
        }
        let clean = /^file:\/\/\/[a-zA-Z]:/.test(pathStr)
            ? pathStr.replace(/^file:\/\/\//, "")
            : pathStr.replace(/^file:\/\//, "");
        clean = decodeURIComponent(clean);
        if (path && os && os.platform() === "win32") {
            clean = clean.replace(/\//g, "\\");
        }
        return clean;
    }
    return pathStr;
}

// Initialize CSInterface
let extensionPath = "./";
try {
    if (typeof CSInterface !== "undefined") {
        csInterface = new CSInterface();
        const rawExtPath = csInterface.getSystemPath('extension');
        if (rawExtPath) {
            extensionPath = normalizeFilePath(rawExtPath);
        }
    }
} catch (e) {
    console.error("[ArcEditor] CSInterface initialization failed:", e);
}

// Compute dynamic config directory
let appConfigDir = "";
let configPath = "./config.json";
let chatsConfigPath = "./chats.json";
let scriptsConfigPath = "./scripts.json";
let effectsCachePath = "./effects_cache.json";
let effectPropertiesCachePath = "./effect_properties_cache.json";

if (os && path && fs) {
    try {
        let docsPath = "";
        if (csInterface && typeof csInterface.getSystemPath === "function") {
            docsPath = csInterface.getSystemPath("myDocuments");
        }
        docsPath = normalizeFilePath(docsPath) || path.join(os.homedir(), 'Documents');

        appConfigDir = path.join(docsPath, 'ArcEditor');
        if (!fs.existsSync(appConfigDir)) {
            fs.mkdirSync(appConfigDir, { recursive: true });
        }
    } catch (e) {
        console.error("[ArcEditor] Failed to locate or create ArcEditor Documents folder:", e);
        appConfigDir = os.homedir();
    }
    configPath = path.join(appConfigDir, 'config.json');
    chatsConfigPath = path.join(appConfigDir, 'chats.json');
    scriptsConfigPath = path.join(appConfigDir, 'scripts.json');
    effectsCachePath = path.join(appConfigDir, 'effects_cache.json');
    effectPropertiesCachePath = path.join(appConfigDir, 'effect_properties_cache.json');
}

// Core State Container
ArcEditor.state = {
    // Connection & Provider
    currentProvider: "lemonade",
    apiUrl: "http://localhost:13305/v1",
    modelName: "",
    apiKey: "",
    isConnected: false,

    // Settings & Features
    includeBase64InDebugLog: false,
    maxToolRetryLimit: 15,
    openaiReasoningEffort: "medium",
    claudeThinkingBudget: 2048,
    agentPermissionMode: "review",
    webSearchEnabled: true,
    webScrapeEnabled: true,
    uiTransitionsEnabled: true,
    apiTemperature: 0.2,
    apiTopP: 0.95,

    // Provider Config Presets
    providerSettings: {
        lemonade: { url: "http://localhost:13305/v1", key: "", model: "" },
        gemini: { url: "https://generativelanguage.googleapis.com", key: "", model: "" },
        openai: { url: "https://api.openai.com/v1", key: "", model: "", reasoningEffort: "medium" },
        anthropic: { url: "https://api.anthropic.com/v1", key: "", model: "", thinkingBudget: 2048 }
    },

    // Session Data
    chatHistory: [],
    agentHistory: [],
    attachedFrames: [],
    installedEffects: {},
    lastApiUsage: null,
    skillsList: [],
    enabledSkills: {},

    // Paths & Runtime Modules
    fs, path, os, httpsClient, httpClient, url, csInterface,
    extensionPath, configPath, chatsConfigPath, scriptsConfigPath,
    effectsCachePath, effectPropertiesCachePath, appConfigDir,

    // Execution & Workspace State
    allProjectChats: {},
    activeSessionId: null,
    allProjectScripts: {},
    activeScriptName: null,
    currentProjectPath: "Unsaved Project",
    isExecuting: false,
    isStopped: false,
    currentExecutionId: 0,
    historyVersion: 0,
    activeAiBubbleId: null,

    // Utility methods
    normalizeFilePath
};

// Project permission helpers
ArcEditor.state.getProjectAllowedTools = function(projectPath) {
    const key = "settings_" + (projectPath || ArcEditor.state.currentProjectPath);
    if (!ArcEditor.state.allProjectChats[key]) {
        ArcEditor.state.allProjectChats[key] = { allowedTools: [], deniedTools: [] };
    }
    return ArcEditor.state.allProjectChats[key].allowedTools || (ArcEditor.state.allProjectChats[key].allowedTools = []);
};

ArcEditor.state.setProjectAllowedTools = function(projectPath, allowedList) {
    const key = "settings_" + (projectPath || ArcEditor.state.currentProjectPath);
    if (!ArcEditor.state.allProjectChats[key]) ArcEditor.state.allProjectChats[key] = {};
    ArcEditor.state.allProjectChats[key].allowedTools = allowedList;
    if (typeof saveChats === "function") saveChats();
};

ArcEditor.state.getProjectDeniedTools = function(projectPath) {
    const key = "settings_" + (projectPath || ArcEditor.state.currentProjectPath);
    if (!ArcEditor.state.allProjectChats[key]) {
        ArcEditor.state.allProjectChats[key] = { allowedTools: [], deniedTools: [] };
    }
    return ArcEditor.state.allProjectChats[key].deniedTools || (ArcEditor.state.allProjectChats[key].deniedTools = []);
};

ArcEditor.state.setProjectDeniedTools = function(projectPath, deniedList) {
    const key = "settings_" + (projectPath || ArcEditor.state.currentProjectPath);
    if (!ArcEditor.state.allProjectChats[key]) ArcEditor.state.allProjectChats[key] = {};
    ArcEditor.state.allProjectChats[key].deniedTools = deniedList;
    if (typeof saveChats === "function") saveChats();
};

// Proxy property getters/setters on window for backward compatibility with scripts before Phase 5
(function() {
    const keys = [
        "currentProvider", "apiUrl", "modelName", "apiKey", "isConnected", "includeBase64InDebugLog",
        "maxToolRetryLimit", "openaiReasoningEffort", "claudeThinkingBudget", "agentPermissionMode",
        "webSearchEnabled", "webScrapeEnabled", "uiTransitionsEnabled", "apiTemperature", "apiTopP",
        "providerSettings", "chatHistory", "agentHistory", "attachedFrames", "installedEffects",
        "lastApiUsage", "skillsList", "enabledSkills", "allProjectChats", "activeSessionId",
        "allProjectScripts", "activeScriptName", "currentProjectPath", "isExecuting", "isStopped",
        "currentExecutionId", "historyVersion", "activeAiBubbleId",
        "fs", "path", "os", "httpsClient", "httpClient", "url", "csInterface",
        "extensionPath", "configPath", "chatsConfigPath", "scriptsConfigPath",
        "effectsCachePath", "effectPropertiesCachePath", "appConfigDir"
    ];
    keys.forEach(key => {
        if (!(key in window)) {
            Object.defineProperty(window, key, {
                get: () => ArcEditor.state[key],
                set: (val) => { ArcEditor.state[key] = val; },
                configurable: true,
                enumerable: true
            });
        }
    });
})();

function getProjectAllowedTools(p) { return ArcEditor.state.getProjectAllowedTools(p); }
function setProjectAllowedTools(p, l) { ArcEditor.state.setProjectAllowedTools(p, l); }
function getProjectDeniedTools(p) { return ArcEditor.state.getProjectDeniedTools(p); }
function setProjectDeniedTools(p, l) { ArcEditor.state.setProjectDeniedTools(p, l); }



