/**
 * ArcEditor Settings Module
 * Handles local user configurations, provider presets, and disk settings serialization.
 */

function loadSettings() {
    if (fs && fs.existsSync(configPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            currentProvider = data.provider || "lemonade";
            apiUrl = data.url || getDefaultUrl(currentProvider);
            modelName = data.model || getDefaultModel(currentProvider);
            apiKey = data.key || "";
        } catch (e) {
            console.error("Failed to load saved config:", e);
        }
    } else {
        // Apply defaults
        currentProvider = "lemonade";
        apiUrl = getDefaultUrl(currentProvider);
        modelName = getDefaultModel(currentProvider);
    }

    // Sync into settings DOM
    document.getElementById("setting-provider").value = currentProvider;
    document.getElementById("setting-url").value = apiUrl;
    document.getElementById("setting-model").value = modelName;
    document.getElementById("setting-key").value = apiKey;
}

function saveSettings(e) {
    if (e) e.preventDefault();

    currentProvider = document.getElementById("setting-provider").value;
    apiUrl = document.getElementById("setting-url").value || getDefaultUrl(currentProvider);
    modelName = document.getElementById("setting-model").value || getDefaultModel(currentProvider);
    apiKey = document.getElementById("setting-key").value;

    const config = {
        provider: currentProvider,
        url: apiUrl,
        model: modelName,
        key: apiKey
    };

    if (fs) {
        try {
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
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
