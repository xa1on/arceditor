/**
 * ArcEditor Timeline RPC Module
 * Interfaces directly with Adobe CEP ExtendScript execution engine, crawls installed effects,
 * and serializes timeline metadata or exports preview canvas PNG layers.
 */

async function validateConnection() {
    const statusDot = document.getElementById("status-dot");
    const sendBtn = document.getElementById("btn-send");

    statusDot.className = "status-dot offline";
    statusDot.title = "Validating connection...";
    sendBtn.disabled = true;

    if (!httpsClient && !httpClient) {
        // Standalone browser fallback mock state
        statusDot.className = "status-dot online";
        statusDot.title = "Mock Connection (Browser Mode)";
        sendBtn.disabled = false;
        isConnected = true;
        return;
    }

    try {
        if (currentProvider === "lemonade") {
            // Check local Lemonade status
            const checkUrl = apiUrl.endsWith("/v1") ? `${apiUrl}/models` : `${apiUrl}/v1/models`;
            await makeRequest(checkUrl, 'GET', {}, "");
        } else {
            // For cloud APIs, check if we have a key input
            if (!apiKey) {
                statusDot.className = "status-dot error";
                statusDot.title = "API Key required for cloud provider.";
                return;
            }
        }

        statusDot.className = "status-dot online";
        statusDot.title = `Connected successfully via ${currentProvider}`;
        sendBtn.disabled = false;
        isConnected = true;
    } catch (err) {
        statusDot.className = "status-dot error";
        statusDot.title = `Failed to connect to ${currentProvider}: ${err.message}`;
        sendBtn.disabled = false; // Let the user send anyway to troubleshoot
        isConnected = false;
    }
}

async function loadInstalledEffects() {
    if (!csInterface) {
        // Fallback mockup installed effects inside standalone browser
        installedEffects = {
            "Blur & Sharpen": [
                { displayName: "Gaussian Blur", matchName: "ADBE Gaussian Blur 2" },
                { displayName: "Fast Box Blur", matchName: "ADBE Fast Blur" }
            ],
            "Stylize": [
                { displayName: "Glow", matchName: "ADBE Glow" }
            ]
        };
        return;
    }

    const result = await evalScriptAsync("ArcInspector.getInstalledEffects()");
    try {
        installedEffects = JSON.parse(result);
        console.log("[ArcEditor] Loaded installed effects catalog:", Object.keys(installedEffects).length, "categories");
    } catch (e) {
        console.error("[ArcEditor] Failed to parse installed effects:", e, result);
    }
}

function evalScriptAsync(script) {
    return new Promise((resolve) => {
        if (csInterface) {
            csInterface.evalScript(script, (result) => {
                resolve(result);
            });
        } else {
            // Mock runner inside general browsers
            console.log("[ArcEditor Mock Executing JSX]:", script);
            resolve("Success: (Mocked JSX output)");
        }
    });
}

async function captureCompositionFrame() {
    if (!csInterface && !fs) {
        addSystemMessage("Visual capture not supported outside After Effects.");
        return;
    }

    const previewContainer = document.getElementById("frame-attachment-preview");
    const previewImg = document.getElementById("attached-preview-img");

    const saveDir = (os && typeof os.homedir === "function") ? os.homedir() : (process.env.TEMP || process.env.TMP || '/tmp');
    const tempPngPath = path.join(saveDir, 'arc_preview.png');

    // Replace backslashes for safe ExtendScript evaluation on Windows paths
    const safePath = tempPngPath.replace(/\\/g, '/');

    const jsxCommand = `ArcCanvas.saveCurrentFrame("${safePath}")`;
    addSystemMessage("Rendering current timeline frame...");

    const result = await evalScriptAsync(jsxCommand);

    if (result.indexOf("Success:") === 0) {
        try {
            const returnedPath = result.substring(8).trim();
            let actualPath = returnedPath;

            if (!fs.existsSync(actualPath)) {
                throw new Error("Could not find rendered preview file on disk at: " + returnedPath);
            }

            const base64Data = fs.readFileSync(actualPath, { encoding: 'base64' });
            attachedFrameBase64 = base64Data;

            // Show visual attachment badge in UI
            previewImg.src = `data:image/png;base64,${base64Data}`;
            previewContainer.classList.remove("hidden");
            addSystemMessage("Canvas frame attached successfully.");

            // Clean up the temporary preview file from disk
            try {
                fs.unlinkSync(actualPath);
            } catch (e) { }

        } catch (err) {
            console.error("Failed to read captured PNG frame from disk:", err);
            addSystemMessage("Error reading captured frame: " + err.message);
        }
    } else {
        addSystemMessage(result);
    }
}

async function getTimelineContext() {
    const jsxCommand = `ArcInspector.getActiveCompositionData()`;
    const jsonResult = await evalScriptAsync(jsxCommand);

    try {
        const parsed = JSON.parse(jsonResult);
        if (parsed.error) {
            return { error: parsed.error };
        }
        return parsed;
    } catch (e) {
        console.error("Failed to parse timeline inspector payload:", e);
        return { error: "Failed to parse timeline inspector data: " + jsonResult };
    }
}
