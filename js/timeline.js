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
            const baseUrl = apiUrl.replace(/\/$/, "");
            const checkUrl = baseUrl.endsWith("/v1") ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
            await makeRequest(checkUrl, 'GET', {}, "");
            statusDot.className = "status-dot online";
            statusDot.title = `Connected successfully via ${currentProvider}`;
        } else {
            // For cloud APIs, skip proactive key validation checks (preventing false positives).
            // Cloud model state is assumed ready, Send is enabled, and real failures are captured on demand.
            statusDot.className = "status-dot online";
            statusDot.title = `Cloud model '${modelName}' active. Connection is verified upon sending message.`;
        }
        sendBtn.disabled = false;
        isConnected = true;
    } catch (err) {
        statusDot.className = "status-dot error";
        statusDot.title = `Failed to connect to local Lemonade server: ${err.message}`;
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

    const result = await evalScriptAsync("$._com_arceditor_.ArcInspector.getInstalledEffects()");
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
            if (script.indexOf("getActiveCompositionData()") !== -1) {
                resolve(JSON.stringify({
                    id: 1234,
                    name: "Mock Composition",
                    width: 1920,
                    height: 1080,
                    duration: 10.0,
                    frameRate: 29.97,
                    currentTime: 0.0,
                    numLayers: 0,
                    layers: [],
                    projectAssets: [],
                    compMarkers: []
                }));
            } else if (script.indexOf("getInstalledEffects()") !== -1) {
                resolve(JSON.stringify({
                    "Blur & Sharpen": [
                        { displayName: "Gaussian Blur", matchName: "ADBE Gaussian Blur 2" },
                        { displayName: "Fast Box Blur", matchName: "ADBE Fast Blur" }
                    ],
                    "Stylize": [
                        { displayName: "Glow", matchName: "ADBE Glow" }
                    ]
                }));
            } else {
                resolve("Success: (Mocked JSX output)");
            }
        }
    });
}

async function captureCompositionFrame(isAgentCall) {
    if (!csInterface) {
        if (isAgentCall !== true) {
            addSystemMessage("Visual capture not supported outside After Effects.");
        }
        return null;
    }

    const previewContainer = document.getElementById("frame-attachment-preview");
    const previewImg = document.getElementById("attached-preview-img");

    if (isAgentCall !== true) {
        addSystemMessage("Capturing current timeline frame...");
    }

    // 1. Prioritize File-based Capture (Using new Asynchronous file-write polling to guarantee saveFrameToPng success)
    const saveDir = (os && typeof os.tmpdir === "function") ? os.tmpdir() : ((typeof process !== "undefined" && process.env) ? (process.env.TEMP || process.env.TMP) : '/tmp');
    const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const tempPngPath = path.join(saveDir, `arc_preview_${uniqueSuffix}.png`);
    const safePath = tempPngPath.replace(/\\/g, '/');

    const jsxCommand = `$._com_arceditor_.ArcCanvas.saveCurrentFrame("${safePath}")`;
    const result = await evalScriptAsync(jsxCommand);

    if (result.indexOf("Success:") === 0) {
        try {
            const returnedPath = result.substring(8).trim();
            let actualPath = returnedPath;

            // Poll for up to 10000ms (200 attempts at 50ms) to allow After Effects' write to fully complete and stabilize
            let fileFound = false;
            let lastSize = -1;
            for (let attempt = 0; attempt < 200; attempt++) {
                try {
                    const stats = await fs.promises.stat(actualPath);
                    // Check if file size is non-trivial (> 100 bytes) AND matches its size from the previous check (write complete)
                    if (stats.size > 100 && stats.size === lastSize) {
                        fileFound = true;
                        break;
                    }
                    lastSize = stats.size;
                } catch (e) {
                    // File not ready or does not exist yet
                }
                await new Promise(resolve => setTimeout(resolve, 50));
            }

            if (fileFound) {
                const base64Data = await fs.promises.readFile(actualPath, { encoding: 'base64' });

                if (isAgentCall !== true) {
                    attachedFrames.push(base64Data);

                    if (typeof renderAttachmentDock === "function") {
                        renderAttachmentDock();
                    } else {
                        const extName = path.extname(actualPath).toLowerCase();
                        let mimeType = 'image/png';
                        if (extName === '.jpg' || extName === '.jpeg') {
                            mimeType = 'image/jpeg';
                        }
                        if (previewImg) previewImg.src = `data:${mimeType};base64,${base64Data}`;
                        if (previewContainer) previewContainer.classList.remove("hidden");
                    }
                    addSystemMessage("Canvas frame captured successfully.");
                }

                try {
                    await fs.promises.unlink(actualPath);
                } catch (e) { }

                return base64Data;
            } else {
                console.warn("[ArcEditor] Direct save file did not appear in time.");
                if (isAgentCall !== true) {
                    addSystemMessage("Error: Frame capture file write timed out.");
                }
            }
        } catch (err) {
            console.error("[ArcEditor] Frame capture failed:", err);
            if (isAgentCall !== true) {
                addSystemMessage("Error capturing frame: " + err.message);
            }
        }
    } else {
        if (isAgentCall !== true) {
            addSystemMessage("Error capturing frame: Save current frame command failed. Result: " + result);
        }
    }
    return null;
}

async function getTimelineContext() {
    const jsxCommand = `$._com_arceditor_.ArcInspector.getActiveCompositionData()`;
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
