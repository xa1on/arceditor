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
            resolve("Success: (Mocked JSX output)");
        }
    });
}

async function captureCompositionFrame() {
    if (!csInterface) {
        addSystemMessage("Visual capture not supported outside After Effects.");
        return null;
    }

    const previewContainer = document.getElementById("frame-attachment-preview");
    const previewImg = document.getElementById("attached-preview-img");

    addSystemMessage("Capturing current timeline frame...");

    // 1. Prioritize File-based Capture (Using new Asynchronous file-write polling to guarantee saveFrameToPng success)
    const saveDir = (os && typeof os.tmpdir === "function") ? os.tmpdir() : (process.env.TEMP || process.env.TMP || '/tmp');
    const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const tempPngPath = path.join(saveDir, `arc_preview_${uniqueSuffix}.png`);
    const safePath = tempPngPath.replace(/\\/g, '/');

    const jsxCommand = `$._com_arceditor_.ArcCanvas.saveCurrentFrame("${safePath}")`;
    const result = await evalScriptAsync(jsxCommand);

    if (result.indexOf("Success:") === 0) {
        try {
            const returnedPath = result.substring(8).trim();
            let actualPath = returnedPath;

            // Poll for up to 1500ms (30 attempts at 50ms) to allow After Effects' asynchronous write to complete
            let fileFound = false;
            for (let attempt = 0; attempt < 30; attempt++) {
                try {
                    const stats = await fs.promises.stat(actualPath);
                    if (stats.size > 100) {
                        fileFound = true;
                        break;
                    }
                } catch (e) {
                    // File not ready or does not exist yet
                }
                await new Promise(resolve => setTimeout(resolve, 50));
            }

            if (fileFound) {
                const base64Data = await fs.promises.readFile(actualPath, { encoding: 'base64' });
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

                try {
                    await fs.promises.unlink(actualPath);
                } catch (e) { }

                return base64Data;
            } else {
                console.warn("[ArcEditor] Direct save file did not appear in time. Trying clipboard fallback.");
            }
        } catch (err) {
            console.warn("[ArcEditor] Asynchronous file read failed. Trying clipboard fallback:", err);
        }
    }

    // 2. Clipboard-based Fallback (Used strictly as an absolute last resort to protect active user clipboard)
    try {
        const clipResult = await evalScriptAsync("$._com_arceditor_.ArcCanvas.copyFrameToClipboard()");
        if (clipResult.indexOf("Success:") === 0) {
            const child_process = require('child_process');
            const platform = (os && typeof os.platform === 'function') ? os.platform() : process.platform;
            
            let base64Data = "";
            if (platform === 'win32') {
                const psCmd = `Add-Type -AssemblyName System.Windows.Forms, System.Drawing; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img) { $ms = New-Object System.IO.MemoryStream; $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); [System.Convert]::ToBase64String($ms.ToArray()) }`;
                try {
                    const stdout = await new Promise((resolve, reject) => {
                        child_process.exec(`powershell -NoProfile -Command "${psCmd}"`, { windowsHide: true }, (err, stdout) => {
                            if (err) reject(err);
                            else resolve(stdout);
                        });
                    });
                    base64Data = stdout.toString().trim();
                } catch (err) {
                    console.error("[ArcEditor] Windows fallback clipboard copy process failed: ", err);
                }
            } else if (platform === 'darwin') {
                try {
                    const stdout = await new Promise((resolve, reject) => {
                        child_process.exec(`osascript -e "write (the clipboard as «class PNGf») to (open for access \\"/tmp/arc_clip.png\\" with write permission)" && base64 -i /tmp/arc_clip.png && rm /tmp/arc_clip.png`, (err, stdout) => {
                            if (err) reject(err);
                            else resolve(stdout);
                        });
                    });
                    base64Data = stdout.toString().trim();
                } catch (err) {
                    console.error("[ArcEditor] macOS fallback clipboard copy process failed: ", err);
                }
            }

            if (base64Data && base64Data.length > 100) {
                attachedFrames.push(base64Data);
                if (typeof renderAttachmentDock === "function") {
                    renderAttachmentDock();
                } else {
                    if (previewImg) previewImg.src = `data:image/png;base64,${base64Data}`;
                    if (previewContainer) previewContainer.classList.remove("hidden");
                }
                addSystemMessage("Canvas frame captured from fallback clipboard successfully.");
                return base64Data;
            }
        }
    } catch (clipErr) {
        console.error("[ArcEditor] Frame capture completely failed:", clipErr);
        addSystemMessage("Error capturing frame: " + clipErr.message);
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
