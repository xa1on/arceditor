/**
 * ArcEditor Timeline RPC Module
 * Interfaces directly with Adobe CEP ExtendScript execution engine, crawls installed effects,
 * and serializes timeline metadata or exports preview canvas PNG layers.
 */

async function validateConnection() {
    const statusDot = document.getElementById("status-dot");
    const sendBtn = document.getElementById("btn-send");

    if (statusDot) {
        statusDot.className = "status-dot offline";
        statusDot.title = "Validating connection...";
    }
    sendBtn.disabled = true;

    if (!httpsClient && !httpClient) {
        // Standalone browser fallback mock state
        if (statusDot) {
            statusDot.className = "status-dot online";
            statusDot.title = "Mock Connection (Browser Mode)";
        }
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
            if (statusDot) {
                statusDot.className = "status-dot online";
                statusDot.title = `Connected successfully via ${currentProvider}`;
            }
        } else {
            // For cloud APIs, skip proactive key validation checks (preventing false positives).
            // Cloud model state is assumed ready, Send is enabled, and real failures are captured on demand.
            if (statusDot) {
                statusDot.className = "status-dot online";
                statusDot.title = `Cloud model '${modelName}' active. Connection is verified upon sending message.`;
            }
        }
        sendBtn.disabled = false;
        isConnected = true;
    } catch (err) {
        if (statusDot) {
            statusDot.className = "status-dot error";
            statusDot.title = `Failed to connect to local Lemonade server: ${err.message}`;
        }
        sendBtn.disabled = false; // Let the user send anyway to troubleshoot
        isConnected = false;
    }
}

const defaultStandardEffects = {
    "Blur & Sharpen": [
        { displayName: "Gaussian Blur", matchName: "ADBE Gaussian Blur 2" },
        { displayName: "Fast Box Blur", matchName: "ADBE Fast Blur" },
        { displayName: "Directional Blur", matchName: "ADBE Direct Blur" },
        { displayName: "Radial Blur", matchName: "ADBE Radial Blur" },
        { displayName: "Camera Lens Blur", matchName: "ADBE Camera Lens Blur" },
        { displayName: "Sharpen", matchName: "ADBE Sharpen" }
    ],
    "Channel": [
        { displayName: "Invert", matchName: "ADBE Invert" },
        { displayName: "Minimax", matchName: "ADBE Minimax" },
        { displayName: "Shift Channels", matchName: "ADBE Shift Channels" }
    ],
    "Color Correction": [
        { displayName: "Tint", matchName: "ADBE Tint" },
        { displayName: "Curves", matchName: "ADBE CurvesCustom" },
        { displayName: "Hue/Saturation", matchName: "ADBE Color Balance 2" },
        { displayName: "Brightness & Contrast", matchName: "ADBE Brightness & Contrast 2" },
        { displayName: "Levels", matchName: "ADBE Levels" },
        { displayName: "Exposure", matchName: "ADBE Exposure" },
        { displayName: "Color Balance", matchName: "ADBE Color Balance" },
        { displayName: "Lumetri Color", matchName: "Adobe Lumetri Color" }
    ],
    "Distort": [
        { displayName: "Turbulent Displace", matchName: "ADBE Turbulent Displace" },
        { displayName: "Corner Pin", matchName: "ADBE Corner Pin" },
        { displayName: "Magnify", matchName: "ADBE Magnify" },
        { displayName: "Mesh Warp", matchName: "ADBE Mesh Warp" },
        { displayName: "Mirror", matchName: "ADBE Mirror" },
        { displayName: "Polar Coordinates", matchName: "ADBE Polar Coordinates" },
        { displayName: "Ripple", matchName: "ADBE Ripple" },
        { displayName: "Spherize", matchName: "ADBE Spherize" },
        { displayName: "Wave Warp", matchName: "ADBE Wave Warp" },
        { displayName: "Optics Compensation", matchName: "ADBE Optics Compensation" },
        { displayName: "Transform", matchName: "ADBE Transform" }
    ],
    "Generate": [
        { displayName: "Fill", matchName: "ADBE Fill" },
        { displayName: "Gradient Ramp", matchName: "ADBE Gradient Ramp" },
        { displayName: "Grid", matchName: "ADBE Grid" },
        { displayName: "Lens Flare", matchName: "ADBE Lens Flare" },
        { displayName: "Radio Waves", matchName: "ADBE Radio Waves" },
        { displayName: "Stroke", matchName: "ADBE Stroke" },
        { displayName: "Write-on", matchName: "ADBE Write-on" },
        { displayName: "Circle", matchName: "ADBE Circle" },
        { displayName: "Beam", matchName: "ADBE Beam" },
        { displayName: "Audio Spectrum", matchName: "ADBE Audio Spectrum" },
        { displayName: "Audio Waveform", matchName: "ADBE Audio Waveform" }
    ],
    "Keying": [
        { displayName: "Keylight (1.2)", matchName: "Keylight (1.2)" },
        { displayName: "Luma Key", matchName: "ADBE Luma Key" }
    ],
    "Perspective": [
        { displayName: "Drop Shadow", matchName: "ADBE Drop Shadow" },
        { displayName: "Radial Shadow", matchName: "ADBE Radial Shadow" }
    ],
    "Simulation": [
        { displayName: "CC Particle World", matchName: "CC Particle World" },
        { displayName: "CC Particle Systems II", matchName: "CC Particle Systems II" },
        { displayName: "CC Snowfall", matchName: "CC Snowfall" },
        { displayName: "CC Rainfall", matchName: "CC Rainfall" }
    ],
    "Stylize": [
        { displayName: "Glow", matchName: "ADBE Glo2" },
        { displayName: "Glow (Legacy)", matchName: "ADBE Glow" },
        { displayName: "Find Edges", matchName: "ADBE Find Edges" },
        { displayName: "Mosaic", matchName: "ADBE Mosaic" },
        { displayName: "Posterize", matchName: "ADBE Posterize" },
        { displayName: "Emboss", matchName: "ADBE Emboss" },
        { displayName: "Roughen Edges", matchName: "ADBE Roughen Edges" }
    ],
    "Transition": [
        { displayName: "Linear Wipe", matchName: "ADBE Linear Wipe" },
        { displayName: "Radial Wipe", matchName: "ADBE Radial Wipe" },
        { displayName: "Venetian Blinds", matchName: "ADBE Venetian Blinds" }
    ],
    "Expression Controls": [
        { displayName: "Slider Control", matchName: "ADBE Slider Control" },
        { displayName: "Color Control", matchName: "ADBE Color Control" },
        { displayName: "Angle Control", matchName: "ADBE Angle Control" },
        { displayName: "Point Control", matchName: "ADBE Point Control" },
        { displayName: "3D Point Control", matchName: "ADBE 3D Point Control" },
        { displayName: "Checkbox Control", matchName: "ADBE Checkbox Control" },
        { displayName: "Layer Control", matchName: "ADBE Layer Control" }
    ]
};

async function loadInstalledEffects() {
    // 1. If already loaded in memory, return immediately
    if (installedEffects && Object.keys(installedEffects).length > 0) {
        return;
    }

    // 2. Fallback check: Browser mode checks
    if (!csInterface || !fs || !path) {
        installedEffects = defaultStandardEffects;
        console.log("[ArcEditor] Browser mode: loaded default standard effects catalog.");
        return;
    }

    // 3. Try reading from the persistent cache file first
    let cachedData = null;
    let cachedCount = 0;
    try {
        if (fs.existsSync(effectsCachePath)) {
            const fileContent = fs.readFileSync(effectsCachePath, 'utf8');
            if (fileContent && fileContent.trim()) {
                cachedData = JSON.parse(fileContent);
                if (cachedData && cachedData._meta) {
                    cachedCount = cachedData._meta.totalCount || 0;
                }
            }
        }
    } catch (cacheErr) {
        console.error("[ArcEditor] Failed to read effects cache file:", cacheErr);
    }

    // Helper to run background crawl and update memory/disk
    const triggerBackgroundCrawl = (delayMs) => {
        setTimeout(async () => {
            try {
                console.log("[ArcEditor] Starting background crawl of After Effects installed effects...");
                const result = await evalScriptAsync("$._com_arceditor_.ArcInspector.getInstalledEffects()");
                if (result && result.trim() && result.indexOf("Error") !== 0) {
                    const crawled = JSON.parse(result);
                    if (crawled && Object.keys(crawled).length > 0) {
                        const aeCountVal = await evalScriptAsync("app.effects ? app.effects.length : 0");
                        const currentAECount = parseInt(aeCountVal, 10) || 0;
                        crawled._meta = { totalCount: currentAECount };
                        
                        installedEffects = crawled;
                        fs.writeFileSync(effectsCachePath, JSON.stringify(crawled, null, 2), 'utf8');
                        console.log("[ArcEditor] Background crawl complete. Cached", Object.keys(installedEffects).length - 1, "categories to disk (total count: " + currentAECount + ").");
                    }
                }
            } catch (crawlErr) {
                console.error("[ArcEditor] Background effect crawling failed:", crawlErr);
            }
        }, delayMs);
    };

    // 4. Query current effect length from After Effects (extremely fast, ~5-10ms)
    let currentAECount = 0;
    try {
        const aeCountVal = await evalScriptAsync("app.effects ? app.effects.length : 0");
        currentAECount = parseInt(aeCountVal, 10) || 0;
    } catch (aeErr) {
        console.error("[ArcEditor] Failed to query app.effects.length:", aeErr);
    }

    // 5. Compare counts and decide
    if (cachedData && currentAECount === cachedCount) {
        installedEffects = cachedData;
        console.log("[ArcEditor] Loaded installed effects from disk cache file (up-to-date, count:", currentAECount, ")");
        return;
    }

    if (cachedData) {
        // Cache exists but is out-of-date (total count changed from cachedCount to currentAECount)
        installedEffects = cachedData; // Instantly load old cache for responsiveness first
        console.log("[ArcEditor] Effect count changed from " + cachedCount + " to " + currentAECount + ". Re-indexing in background.");
        triggerBackgroundCrawl(1000);
    } else {
        // No cache file exists
        installedEffects = defaultStandardEffects; // Instantly load built-in fallback
        console.log("[ArcEditor] No cache file found. Pre-populating and triggering background crawl.");
        triggerBackgroundCrawl(1000);
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
    if (!csInterface || !path || !fs) {
        if (isAgentCall !== true) {
            addSystemMessage("Visual capture not supported outside After Effects.");
        }
        throw new Error("Visual capture not supported outside After Effects or CEP environment.");
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

    if (!result) {
        throw new Error("Empty response from After Effects frame capture execution.");
    }
    if (result.indexOf("Error:") === 0) {
        throw new Error(result.substring(6).trim());
    }
    if (result.indexOf("Success:") !== 0) {
        throw new Error("Unexpected response from After Effects frame capture: " + result);
    }

    try {
        const returnedPath = result.substring(8).trim();
        let actualPath = returnedPath;

        let fileFound = false;
        let lastSize = -1;
        for (let attempt = 0; attempt < 100; attempt++) {
            try {
                const stats = await fs.promises.stat(actualPath);
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
            throw new Error("Frame capture file write timed out on disk.");
        }
    } catch (err) {
        console.error("[ArcEditor] Frame capture failed:", err);
        if (isAgentCall !== true) {
            addSystemMessage("Error capturing frame: " + err.message);
        }
        throw err;
    }
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

async function captureFrameAtTime(time, tempPath) {
    const safePath = tempPath.replace(/\\/g, '/');
    const jsxCommand = `(function() {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) return "Error: No active composition";
        var originalTime = comp.time;
        try {
            comp.time = Math.max(0, Math.min(comp.duration - comp.frameDuration, ${time}));
            var file = new File("${safePath}");
            if (!file.parent.exists) file.parent.create();
            if (file.exists) file.remove();
            if (typeof comp.saveFrameToPng === "function") {
                comp.saveFrameToPng(comp.time, file);
            } else if (typeof comp.saveFrameToPNG === "function") {
                comp.saveFrameToPNG(comp.time, file);
            } else {
                return "Error: saveFrameToPng not supported";
            }
            comp.time = originalTime; // restore playhead
            return "Success: " + file.fsName;
        } catch(e) {
            comp.time = originalTime; // restore playhead
            return "Error: " + e.toString();
        }
    })()`;
    return await evalScriptAsync(jsxCommand);
}

function resolveTimeValue(val, frameRate, relativeBaseTime) {
    if (val === undefined || val === null || val === "") return val;
    var frameDuration = 1 / frameRate;

    if (typeof val === "number") {
        return val * frameDuration;
    }

    if (typeof val === "string") {
        var trimmed = val.replace(/\s+/g, "");
        var lastChar = trimmed.charAt(trimmed.length - 1).toLowerCase();
        
        var isSeconds = (lastChar === "s");
        var isFrames = (lastChar === "f");
        
        var cleanVal = trimmed;
        if (isSeconds || isFrames) {
            cleanVal = trimmed.substring(0, trimmed.length - 1);
        }
        
        var num = parseFloat(cleanVal);
        if (isNaN(num)) {
            throw new Error("Invalid time/frame format: '" + val + "'");
        }

        var isRelative = (trimmed.charAt(0) === "+" || trimmed.charAt(0) === "-");
        
        if (isRelative) {
            if (relativeBaseTime === undefined || relativeBaseTime === null) {
                relativeBaseTime = 0;
            }
            if (isSeconds) {
                return relativeBaseTime + num;
            } else {
                var currentFrame = Math.round(relativeBaseTime / frameDuration);
                var targetFrame = currentFrame + num;
                return targetFrame * frameDuration;
            }
        } else {
            if (isSeconds) {
                return num;
            } else {
                return num * frameDuration;
            }
        }
    }
    throw new Error("Unsupported time/frame parameter type.");
}

async function captureCompositionSequence(startTime, endTime, numFrames, isAgentCall) {
    if (!csInterface || !path || !fs) {
        if (isAgentCall !== true) {
            addSystemMessage("Visual capture not supported outside After Effects.");
        }
        throw new Error("Visual capture not supported outside After Effects or CEP environment.");
    }

    if (isAgentCall !== true) {
        addSystemMessage("Capturing composition sequence...");
    }

    const n = Math.max(1, Math.min(10, numFrames || 5)); // Cap at 10 to keep it lightweight and fast

    let compData = null;
    try {
        compData = await getTimelineContext();
    } catch (e) {}

    const frameRate = (compData && compData.frameRate) || 30;
    const duration = (compData && compData.duration) || 5;
    const frameDuration = 1 / frameRate;

    let actualStart;
    try {
        actualStart = resolveTimeValue(startTime, frameRate);
        if (actualStart === undefined || actualStart === null) actualStart = 0;
    } catch (e) {
        actualStart = 0;
    }

    let actualEnd;
    try {
        actualEnd = resolveTimeValue(endTime, frameRate);
        if (actualEnd === undefined || actualEnd === null) actualEnd = duration;
    } catch (e) {
        actualEnd = duration;
    }

    // Clamp both to [0, duration - frameDuration] to avoid rendering blank frames beyond composition duration
    const maxSafeTime = Math.max(0, duration - frameDuration);
    actualStart = Math.max(0, Math.min(maxSafeTime, actualStart));
    actualEnd = Math.max(actualStart, Math.min(maxSafeTime, actualEnd));

    const saveDir = (os && typeof os.tmpdir === "function") ? os.tmpdir() : ((typeof process !== "undefined" && process.env) ? (process.env.TEMP || process.env.TMP) : '/tmp');
    const base64List = [];

    const pathsAndTimes = [];
    for (let i = 0; i < n; i++) {
        let t = actualStart;
        if (n > 1) {
            t = actualStart + i * (actualEnd - actualStart) / (n - 1);
        }
        const uniqueSuffix = `${Date.now()}_seq_${i}_${Math.random().toString(36).substring(2, 8)}`;
        const tempPngPath = path.join(saveDir, `arc_preview_${uniqueSuffix}.png`);
        const safePath = tempPngPath.replace(/\\/g, '/');
        pathsAndTimes.push({ time: t, path: safePath });
    }

    let stepsJsx = "";
    for (let i = 0; i < pathsAndTimes.length; i++) {
        const item = pathsAndTimes[i];
        stepsJsx += "\n" +
            "            comp.time = Math.max(0, Math.min(comp.duration - comp.frameDuration, " + item.time + "));\n" +
            "            var file_" + i + " = new File(\"" + item.path + "\");\n" +
            "            if (file_" + i + ".exists) file_" + i + ".remove();\n" +
            "            if (typeof comp.saveFrameToPng === \"function\") {\n" +
            "                comp.saveFrameToPng(comp.time, file_" + i + ");\n" +
            "            } else {\n" +
            "                comp.saveFrameToPNG(comp.time, file_" + i + ");\n" +
            "            }\n" +
            "            pathsResult.push(file_" + i + ".fsName);\n";
    }

    const jsxCommand = "(function() {\n" +
        "        var comp = app.project.activeItem;\n" +
        "        if (!comp || !(comp instanceof CompItem)) return \"Error: No active composition\";\n" +
        "        var originalTime = comp.time;\n" +
        "        var pathsResult = [];\n" +
        "        try {\n" +
        "            if (!new File(\"" + pathsAndTimes[0].path + "\").parent.exists) {\n" +
        "                new File(\"" + pathsAndTimes[0].path + "\").parent.create();\n" +
        "            }\n" +
        "            " + stepsJsx + "\n" +
        "            comp.time = originalTime;\n" +
        "            return \"Success: \" + pathsResult.join(\";\");\n" +
        "        } catch(e) {\n" +
        "            comp.time = originalTime;\n" +
        "            return \"Error: \" + e.toString();\n" +
        "        }\n" +
        "    })()";

    const result = await evalScriptAsync(jsxCommand);

    if (!result) {
        throw new Error("Empty response from After Effects composition sequence execution.");
    }
    if (result.indexOf("Error:") === 0) {
        throw new Error(result.substring(6).trim());
    }
    if (result.indexOf("Success:") !== 0) {
        throw new Error("Unexpected response from After Effects composition sequence: " + result);
    }

    const pathsList = result.substring(8).split(";");
    for (let i = 0; i < pathsList.length; i++) {
        const actualPath = pathsList[i].trim();
        if (!actualPath) continue;
        try {
            let fileFound = false;
            let lastSize = -1;
            for (let attempt = 0; attempt < 100; attempt++) {
                try {
                    const stats = await fs.promises.stat(actualPath);
                    if (stats.size > 100 && stats.size === lastSize) {
                        fileFound = true;
                        break;
                    }
                    lastSize = stats.size;
                } catch (e) {}
                await new Promise(resolve => setTimeout(resolve, 50));
            }

            if (fileFound) {
                const base64Data = await fs.promises.readFile(actualPath, { encoding: 'base64' });
                base64List.push(base64Data);
                try {
                    await fs.promises.unlink(actualPath);
                } catch (e) {}
            }
        } catch (err) {
            console.error("[ArcEditor] Error processing frame file: " + actualPath, err);
        }
    }

    if (base64List.length === 0) {
        throw new Error("Failed to read any captured sequence frames from disk. Please check disk permissions or temp folder access.");
    }

    if (isAgentCall !== true) {
        base64List.forEach(data => {
            attachedFrames.push(data);
        });
        if (typeof renderAttachmentDock === "function") {
            renderAttachmentDock();
        }
        addSystemMessage(`Captured sequence of ${base64List.length} frames successfully.`);
    }

    return base64List;
}

