/**
 * ArcEditor State Module
 * Holds global states, Node.js runtime bindings, and settings persistence path keys.
 */

// Global state variables
let currentProvider = "lemonade";
let apiUrl = "http://localhost:1337/v1";
let modelName = "qwen2.5-coder-7b";
let apiKey = "";
let isConnected = false;
let includeBase64InDebugLog = false;
let maxToolRetryLimit = 15;

let chatHistory = [];
let attachedFrames = [];
let installedEffects = {};
let lastApiUsage = null; // { promptTokens, completionTokens, totalTokens }

// Safe Node.js loading (allows mockup testing inside standalone browsers)
let fs = null, path = null, os = null, httpsClient = null, httpClient = null;
let csInterface = null;
let extensionPath = "./";
let configPath = "./config.json";
let chatsConfigPath = "./chats.json";

try {
    if (typeof require !== "undefined") {
        fs = require('fs');
        path = require('path');
        os = require('os');
        httpsClient = require('https');
        httpClient = require('http');
    }
} catch (e) {
    console.warn("[ArcEditor] Node.js context not detected. Running in mockup browser mode.");
}

// Initialize Adobe CEP CSInterface
try {
    if (typeof CSInterface !== "undefined") {
        csInterface = new CSInterface();
        extensionPath = csInterface.getSystemPath('extension');
    }
} catch (e) {
    console.error("CSInterface initialization failed:", e);
}

// Set writable config path in user home directory (avoids Program Files read-only permission issues!)
if (os && path) {
    configPath = path.join(os.homedir(), '.arceditor_config.json');
    chatsConfigPath = path.join(os.homedir(), '.arceditor_chats.json');
} else {
    configPath = "./config.json";
    chatsConfigPath = "./chats.json";
}

// Project specific chat sessions state
let allProjectChats = {};
let activeSessionId = null;
let currentProjectPath = "Unsaved Project";
let isExecuting = false;
let isStopped = false;
let currentExecutionId = 0;
let activeAiBubbleId = null;
