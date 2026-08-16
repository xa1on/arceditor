/**
 * ArcEditor Agent Orchestrator Module
 * Manages the high-level system context instructions, structured tool call routing,
 * the automated ReAct self-correction execution loop, and custom markdown paragraph parser.
 */

window.ArcEditor = window.ArcEditor || {};

let capturedFrameDataDuringLoop = null;

const ANNOTATION_COLORS = {
    "#ff4d4d": "Red",
    "#00f0ff": "Cyan",
    "#ffd700": "Yellow",
    "#39ff14": "Green"
};

// Tool name mapping dictionary for O(1) canonicalization
const TOOL_NAME_MAP = {
    "captureactiveframe": "captureActiveFrame",
    "capturecompositionsequence": "captureCompositionSequence",
    "gettimelinecontext": "getTimelineContext",
    "getinstalledeffects": "getInstalledEffects",
    "searchinstalledeffects": "searchInstalledEffects",
    "getlayerproperties": "getLayerProperties",
    "selectlayers": "selectLayers",
    "switchcomposition": "switchComposition",
    "setplayheadtime": "setPlayheadTime",
    "readaudiopeaks": "readAudioPeaks",
    "readmarkers": "readMarkers",
    "undolastaction": "undoLastAction",
    "askquestion": "askQuestion",
    "submitplan": "submitPlan",
    "updateplan": "updatePlan",
    "websearch": "webSearch",
    "webscrape": "webScrape",
    "getprojectassets": "getProjectAssets",
    "geteffectproperties": "getEffectProperties",
    "createsvgshape": "createSvgShape",
    "updatesvgshape": "createSvgShape",
    "createscript": "createScript",
    "viewscript": "viewScript",
    "editscript": "editScript",
    "executescript": "executeScript"
};

function getCanonicalToolName(name) {
    if (!name) return "";
    return TOOL_NAME_MAP[name.toLowerCase()] || name;
}

// Consolidated read-only tool set for O(1) lookups
const READONLY_TOOLS = new Set([
    "captureActiveFrame",
    "captureCompositionSequence",
    "getTimelineContext",
    "searchInstalledEffects",
    "getLayerProperties",
    "getEffectProperties",
    "selectLayers",
    "switchComposition",
    "setPlayheadTime",
    "readAudioPeaks",
    "readMarkers",
    "undoLastAction",
    "askQuestion",
    "submitPlan",
    "updatePlan",
    "webSearch",
    "webScrape",
    "getProjectAssets",
    "createScript",
    "viewScript",
    "editScript"
]);

const CANVAS_READONLY_TOOLS = Array.from(READONLY_TOOLS);
const PERMISSION_READONLY_TOOLS = Array.from(READONLY_TOOLS);

function pushToHistory(msg) {
    const serialized = typeof structuredClone === "function" ? structuredClone(msg) : JSON.parse(JSON.stringify(msg));
    chatHistory.push(serialized);
    agentHistory.push(serialized);
    if (typeof saveChats === "function") {
        saveChats();
    }
}

ArcEditor.agent = ArcEditor.agent || {
    getCanonicalToolName,
    READONLY_TOOLS,
    pushToHistory
};


async function burnAnnotationsIntoImage(item) {
    if (!item.annotations || item.annotations.length === 0) {
        return item.data;
    }

    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                const canvas = document.createElement("canvas");
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0);

                // Configure drawing styles matching the annotation canvas editor
                ctx.lineCap = "round";
                ctx.lineJoin = "round";
                ctx.lineWidth = Math.max(2.5, img.width / 300); // Scale line width relative to base image width

                item.annotations.forEach(ann => {
                    if (ann.type === "rect") {
                        const sx = ann.x1 * canvas.width;
                        const sy = ann.y1 * canvas.height;
                        const sw = (ann.x2 - ann.x1) * canvas.width;
                        const sh = (ann.y2 - ann.y1) * canvas.height;
                        ctx.strokeStyle = ann.color || "#ff4d4d";
                        ctx.strokeRect(sx, sy, sw, sh);

                        if (ann.label) {
                            ctx.font = `bold ${Math.max(10, canvas.width / 80)}px monospace`;
                            const textW = ctx.measureText(ann.label).width;
                            const fontSize = Math.max(10, canvas.width / 80);
                            ctx.fillStyle = "rgba(0,0,0,0.75)";
                            ctx.fillRect(sx, sy - fontSize - 6, textW + 10, fontSize + 6);
                            ctx.fillStyle = ann.color || "#ff4d4d";
                            ctx.fillText(ann.label, sx + 5, sy - 5);
                        }
                    } else if (ann.type === "circle") {
                        const cx = (ann.x1 + ann.x2) / 2 * canvas.width;
                        const cy = (ann.y1 + ann.y2) / 2 * canvas.height;
                        const rx = Math.abs(ann.x2 - ann.x1) / 2 * canvas.width;
                        const ry = Math.abs(ann.y2 - ann.y1) / 2 * canvas.height;
                        ctx.strokeStyle = ann.color || "#ff4d4d";
                        ctx.beginPath();
                        ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
                        ctx.stroke();

                        if (ann.label) {
                            const sx = Math.min(ann.x1, ann.x2) * canvas.width;
                            const sy = Math.min(ann.y1, ann.y2) * canvas.height;
                            ctx.font = `bold ${Math.max(10, canvas.width / 80)}px monospace`;
                            const textW = ctx.measureText(ann.label).width;
                            const fontSize = Math.max(10, canvas.width / 80);
                            ctx.fillStyle = "rgba(0,0,0,0.75)";
                            ctx.fillRect(sx, sy - fontSize - 6, textW + 10, fontSize + 6);
                            ctx.fillStyle = ann.color || "#ff4d4d";
                            ctx.fillText(ann.label, sx + 5, sy - 5);
                        }
                    } else if (ann.type === "arrow") {
                        const x1 = ann.x1 * canvas.width;
                        const y1 = ann.y1 * canvas.height;
                        const x2 = ann.x2 * canvas.width;
                        const y2 = ann.y2 * canvas.height;

                        ctx.strokeStyle = ann.color || "#ff4d4d";
                        ctx.fillStyle = ann.color || "#ff4d4d";

                        ctx.beginPath();
                        ctx.moveTo(x1, y1);
                        ctx.lineTo(x2, y2);
                        ctx.stroke();

                        const angle = Math.atan2(y2 - y1, x2 - x1);
                        const headLength = Math.max(12, canvas.width / 60);
                        ctx.beginPath();
                        ctx.moveTo(x2, y2);
                        ctx.lineTo(x2 - headLength * Math.cos(angle - Math.PI / 6), y2 - headLength * Math.sin(angle - Math.PI / 6));
                        ctx.lineTo(x2 - headLength * Math.cos(angle + Math.PI / 6), y2 - headLength * Math.sin(angle + Math.PI / 6));
                        ctx.closePath();
                        ctx.fill();

                        if (ann.label) {
                            ctx.font = `bold ${Math.max(10, canvas.width / 80)}px monospace`;
                            const textW = ctx.measureText(ann.label).width;
                            const fontSize = Math.max(10, canvas.width / 80);
                            ctx.fillStyle = "rgba(0,0,0,0.75)";
                            ctx.fillRect(x1, y1 - fontSize - 6, textW + 10, fontSize + 6);
                            ctx.fillStyle = ann.color || "#ff4d4d";
                            ctx.fillText(ann.label, x1 + 5, y1 - 5);
                        }
                    } else if (ann.type === "text") {
                        const x = ann.x1 * canvas.width;
                        const y = ann.y1 * canvas.height;
                        ctx.font = `bold ${Math.max(11, canvas.width / 75)}px monospace`;
                        const textW = ctx.measureText(ann.text || "").width;
                        const fontSize = Math.max(11, canvas.width / 75);

                        ctx.fillStyle = "rgba(0,0,0,0.85)";
                        ctx.fillRect(x - 4, y - fontSize - 2, textW + 8, fontSize + 6);

                        ctx.fillStyle = ann.color || "#ff4d4d";
                        ctx.fillText(ann.text || "", x, y);
                    } else if (ann.type === "path") {
                        if (ann.points && ann.points.length > 1) {
                            ctx.strokeStyle = ann.color || "#ff4d4d";
                            ctx.beginPath();
                            ctx.moveTo(ann.points[0].x * canvas.width, ann.points[0].y * canvas.height);
                            for (let i = 1; i < ann.points.length; i++) {
                                ctx.lineTo(ann.points[i].x * canvas.width, ann.points[i].y * canvas.height);
                            }
                            ctx.stroke();
                        }
                    }
                });

                const dataUrl = canvas.toDataURL("image/png");
                const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
                resolve(base64);
            } catch (err) {
                console.error("Error in canvas drawing operations:", err);
                resolve(item.data);
            }
        };
        img.onerror = () => {
            console.error("Failed to load image in burnAnnotationsIntoImage helper");
            resolve(item.data);
        };
        img.src = `data:${item.mimeType || 'image/png'};base64,${item.data}`;
    });
}

function wrapExtendScript(scriptContent) {
    return `(function() {
        var ArcEditor = $._com_arceditor_ ? $._com_arceditor_.ArcEditor : null;
        var ArcJSON = $._com_arceditor_ ? $._com_arceditor_.ArcJSON : null;
        var ArcInspector = $._com_arceditor_ ? $._com_arceditor_.ArcInspector : null;
        var ArcCanvas = $._com_arceditor_ ? $._com_arceditor_.ArcCanvas : null;
        var JSON = ArcJSON;
        var _scriptAlerts = [];
        var alert = function(msg) {
            _scriptAlerts.push(String(msg));
        };
        
        var _dummy = null;
        app.beginUndoGroup("ArcEditor Agent Script");
        try {
            if (app.project && app.project.items) {
                try {
                    _dummy = app.project.items.addFolder("__arc_undo_sentinel__");
                } catch (_dErr) {}
            }
            var _userScriptResult = (function() {
                ${scriptContent}
            })();
            if (_dummy) {
                try { _dummy.remove(); } catch (_cleanErr) {}
            }
            app.endUndoGroup();
            if (_scriptAlerts.length > 0) {
                return "Success (Alerts during execution: " + _scriptAlerts.join(", ") + ")" + (_userScriptResult !== undefined ? "\\n" + String(_userScriptResult) : "");
            }
            return _userScriptResult !== undefined ? String(_userScriptResult) : "Success";
        } catch (err) {
            app.endUndoGroup();
            try {
                app.activate();
                app.executeCommand(16);
            } catch (undoErr) {}
            var errMsg = "Error (automatically undone, no need to rollback the errored script with the undo tool): " + err.toString() + (err.line ? " (line " + err.line + ")" : "");
            if (_scriptAlerts.length > 0) {
                errMsg += " (Alerts during execution: " + _scriptAlerts.join(", ") + ")";
            }
            return errMsg;
        }
    })()`;
}

async function runAgenticExecutionLoop(userText) {
    isStopped = false;
    currentExecutionId++;
    historyVersion++; // Increment version on new prompt run
    const executionId = currentExecutionId;

    try {
        let attachments = [...attachedFrames];

        // Await rendering sketch path overlays on images
        if (attachments && attachments.length > 0) {
            for (let i = 0; i < attachments.length; i++) {
                const item = attachments[i];
                if (item && typeof item === "object" && (item.type === "image" || (item.mimeType && item.mimeType.startsWith("image/")))) {
                    try {
                        item.annotatedData = await burnAnnotationsIntoImage(item);
                    } catch (e) {
                        console.error("Error pre-processing image annotations:", e);
                    }
                }
            }
        }

        // Reset attachments
        clearAttachmentDock();

        let userMsg;
        if (attachments && attachments.length > 0) {
            let embeddedText = userText;
            const contentParts = [];

            attachments.forEach(item => {
                const isObject = typeof item === "object" && item !== null;
                if (isObject) {
                    if (item.type === "video") {
                        embeddedText += `\n\n[Uploaded Video: ${item.name} - 5 extracted frames attached below]`;
                        if (item.frames && item.frames.length > 0) {
                            item.frames.forEach(frame => {
                                contentParts.push({
                                    type: "image_url",
                                    image_url: { url: `data:image/png;base64,${frame.data}` }
                                });
                            });
                        }
                    } else if (item.type === "text" || item.textContent !== undefined) {
                        embeddedText += `\n\n[Uploaded File: ${item.name}]\n\`\`\`\n${item.textContent}\n\`\`\``;
                    } else if (item.type === "pdf") {
                        if (item.textContent) {
                            embeddedText += `\n\n[Uploaded PDF File: ${item.name}]\n\`\`\`\n${item.textContent}\n\`\`\``;
                        }
                        if (currentProvider === "gemini") {
                            contentParts.push({
                                type: "inline_data",
                                inline_data: {
                                    mimeType: item.mimeType,
                                    data: item.data
                                }
                            });
                        } else {
                            embeddedText += `\n\n[Attached Binary File: ${item.name} (${item.mimeType}, ${item.size} bytes) - Note: Model provider does not support native PDF uploads]`;
                        }
                    } else if (item.type === "image" || item.mimeType.startsWith("image/")) {
                        let label = `Uploaded File: ${item.name}`;
                        if (item.frameNumber !== undefined && item.frameNumber !== null) {
                            label = `Captured Frame: ${item.name} at Frame #${item.frameNumber} (${item.timeInSeconds.toFixed(3)}s)`;
                        }
                        embeddedText += `\n\n[${label}]`;

                        if (item.annotations && item.annotations.length > 0) {
                            const dbgTextarea = document.getElementById("debug-output");
                            if (dbgTextarea) {
                                dbgTextarea.value += `\n\n============================================================\n[${new Date().toISOString()}] [ANNOTATION DEBUG]\n` +
                                    JSON.stringify({
                                        name: item.name,
                                        hasCompData: !!item.compData,
                                        compDataKeys: item.compData ? Object.keys(item.compData) : [],
                                        layersCount: item.compData && item.compData.layers ? item.compData.layers.length : 0,
                                        firstLayer: item.compData && item.compData.layers && item.compData.layers[0] ? {
                                            name: item.compData.layers[0].name,
                                            bounds: item.compData.layers[0].bounds,
                                            boundsError: item.compData.layers[0].boundsError
                                        } : null,
                                        annotations: item.annotations
                                    }, null, 2) + "\n";
                                dbgTextarea.scrollTop = dbgTextarea.scrollHeight;
                            }
                            embeddedText += `\n\n[Visual Annotations on Attachment: ${item.name}]`;

                            // 1. Calculate sketch path combined bounding box first (if any paths are drawn)
                            const pathAnns = item.annotations.filter(ann => ann.type === "path");
                            let sketchBox = null;
                            let hasSketchPoints = false;
                            let minX = 1.0, minY = 1.0, maxX = 0.0, maxY = 0.0;
                            const pathColors = new Set();

                            if (pathAnns.length > 0) {
                                pathAnns.forEach(ann => {
                                    const colorName = ANNOTATION_COLORS[ann.color] || ann.color;
                                    pathColors.add(colorName);
                                    if (ann.points && ann.points.length > 0) {
                                        ann.points.forEach(p => {
                                            hasSketchPoints = true;
                                            if (p.x < minX) minX = p.x;
                                            if (p.y < minY) minY = p.y;
                                            if (p.x > maxX) maxX = p.x;
                                            if (p.y > maxY) maxY = p.y;
                                        });
                                    }
                                });
                                if (hasSketchPoints) {
                                    sketchBox = {
                                        left: minX,
                                        top: minY,
                                        right: maxX,
                                        bottom: maxY
                                    };
                                }
                            }

                            // 2. Prepare intersection target bounds
                            const targets = [];
                            if (sketchBox) {
                                targets.push({
                                    name: "Sketch Annotation",
                                    bounds: sketchBox
                                });
                            }

                            if (item.compData && Array.isArray(item.compData.layers)) {
                                const compWidth = item.compData.width || 1920;
                                const compHeight = item.compData.height || 1080;
                                // Loop backwards to check targets in order from top to bottom
                                for (let k = item.compData.layers.length - 1; k >= 0; k--) {
                                    const layer = item.compData.layers[k];
                                    if (layer.enabled !== false &&
                                        layer.type !== "Null" &&
                                        layer.type !== "Adjustment" &&
                                        layer.bounds && typeof layer.bounds.left === "number") {
                                        targets.push({
                                            name: `"${layer.name}" (layerRef: ${layer.id})`,
                                            bounds: {
                                                left: layer.bounds.left / compWidth,
                                                right: layer.bounds.right / compWidth,
                                                top: layer.bounds.top / compHeight,
                                                bottom: layer.bounds.bottom / compHeight
                                            }
                                        });
                                    }
                                }
                            }

                            // Intersection math helpers
                            const checkRectIntersection = (boxA, boxB) => {
                                return (boxA.left <= boxB.right && boxA.right >= boxB.left &&
                                    boxA.top <= boxB.bottom && boxA.bottom >= boxB.top);
                            };

                            const checkEllipseIntersection = (cx, cy, rx, ry, box) => {
                                if (rx === 0 || ry === 0) return false;

                                const cxPrime = cx / rx;
                                const cyPrime = cy / ry;
                                const leftPrime = box.left / rx;
                                const rightPrime = box.right / rx;
                                const topPrime = box.top / ry;
                                const bottomPrime = box.bottom / ry;

                                const closestX = Math.max(leftPrime, Math.min(cxPrime, rightPrime));
                                const closestY = Math.max(topPrime, Math.min(cyPrime, bottomPrime));

                                const dx = cxPrime - closestX;
                                const dy = cyPrime - closestY;
                                return (dx * dx + dy * dy) <= 1.0;
                            };

                            // 3. Process standard layout shapes (rect, circle/ellipse, arrow, text)
                            item.annotations.forEach((ann, aIdx) => {
                                const colorName = ANNOTATION_COLORS[ann.color] || ann.color;
                                let shapeText = "";
                                const matchedLayers = [];

                                if (ann.type === "rect") {
                                    shapeText = `\n- Bounding Box #${aIdx + 1} (${colorName}): Label: "${ann.label || "unlabeled"}" bound coordinates: [Left: ${(ann.x1 * 100).toFixed(1)}%, Top: ${(ann.y1 * 100).toFixed(1)}%, Right: ${(ann.x2 * 100).toFixed(1)}%, Bottom: ${(ann.y2 * 100).toFixed(1)}%]`;

                                    const annBox = {
                                        left: Math.min(ann.x1, ann.x2),
                                        right: Math.max(ann.x1, ann.x2),
                                        top: Math.min(ann.y1, ann.y2),
                                        bottom: Math.max(ann.y1, ann.y2)
                                    };

                                    targets.forEach(target => {
                                        if (checkRectIntersection(annBox, target.bounds)) {
                                            matchedLayers.push(target.name);
                                        }
                                    });
                                } else if (ann.type === "circle") {
                                    const cx = (ann.x1 + ann.x2) / 2;
                                    const cy = (ann.y1 + ann.y2) / 2;
                                    const rx = Math.abs(ann.x2 - ann.x1) / 2;
                                    const ry = Math.abs(ann.y2 - ann.y1) / 2;
                                    shapeText = `\n- Ellipse #${aIdx + 1} (${colorName}): Label: "${ann.label || "unlabeled"}" Center at [X: ${(cx * 100).toFixed(1)}%, Y: ${(cy * 100).toFixed(1)}%] with radii [Horizontal: ${(rx * 100).toFixed(1)}%, Vertical: ${(ry * 100).toFixed(1)}%]`;

                                    targets.forEach(target => {
                                        if (checkEllipseIntersection(cx, cy, rx, ry, target.bounds)) {
                                            matchedLayers.push(target.name);
                                        }
                                    });
                                } else if (ann.type === "arrow") {
                                    shapeText = `\n- Arrow Vector #${aIdx + 1} (${colorName}): Label: "${ann.label || "unlabeled"}" Directing from [X1: ${(ann.x1 * 100).toFixed(1)}%, Y1: ${(ann.y1 * 100).toFixed(1)}%] to [X2: ${(ann.x2 * 100).toFixed(1)}%, Y2: ${(ann.y2 * 100).toFixed(1)}%]`;

                                    const arrowBox = {
                                        left: ann.x2 - 0.05,
                                        right: ann.x2 + 0.05,
                                        top: ann.y2 - 0.05,
                                        bottom: ann.y2 + 0.05
                                    };

                                    targets.forEach(target => {
                                        if (checkRectIntersection(arrowBox, target.bounds)) {
                                            matchedLayers.push(target.name);
                                        }
                                    });
                                } else if (ann.type === "text") {
                                    shapeText = `\n- Text Label #${aIdx + 1} (${colorName}): "${ann.text || ""}" at position [X: ${(ann.x1 * 100).toFixed(1)}%, Y: ${(ann.y1 * 100).toFixed(1)}%]`;
                                }

                                embeddedText += shapeText;
                                if (matchedLayers.length > 0) {
                                    const topMatches = matchedLayers.slice(0, 5);
                                    embeddedText += `\n    * Possible highlighted layers: ${JSON.stringify(topMatches)}`;
                                }
                            });

                            // 4. Print combined sketch path strokes description
                            if (pathAnns.length > 0) {
                                if (!hasSketchPoints) {
                                    minX = 0; minY = 0; maxX = 0; maxY = 0;
                                }
                                const colorStr = Array.from(pathColors).join(", ");
                                embeddedText += `\n- Sketch Path (${colorStr}): A sketch path is drawn on this frame within the combined bounding box [Left: ${(minX * 100).toFixed(1)}%, Top: ${(minY * 100).toFixed(1)}%, Right: ${(maxX * 100).toFixed(1)}%, Bottom: ${(maxY * 100).toFixed(1)}%]. Please analyze the shape of this sketch visually on the image.`;
                            }

                            embeddedText += `\n*Note: Use these percentage values relative to the composition width/height (obtainable from getTimelineContext) to calculate precise coordinates.*`;
                        }

                        contentParts.push({
                            type: "image_url",
                            image_url: { url: `data:${item.mimeType};base64,${item.annotatedData || item.data}` }
                        });
                    } else {
                        if (currentProvider === "gemini") {
                            contentParts.push({
                                type: "inline_data",
                                inline_data: {
                                    mimeType: item.mimeType,
                                    data: item.annotatedData || item.data
                                }
                            });
                        } else {
                            embeddedText += `\n\n[Attached Binary File: ${item.name} (${item.mimeType}, ${item.size} bytes)]`;
                        }
                    }
                } else {
                    contentParts.push({
                        type: "image_url",
                        image_url: { url: `data:image/png;base64,${item}` }
                    });
                }
            });

            contentParts.unshift({ type: "text", text: embeddedText });
            userMsg = {
                role: "user",
                content: contentParts,
                userText: userText
            };
        } else {
            userMsg = {
                role: "user",
                content: userText,
                userText: userText
            };
        }

        pushToHistory(userMsg);

        // DECOUPLED CONTEXT FOR LLM (keeps visual history completely raw and unpruned)
        let activeContext = JSON.parse(JSON.stringify(agentHistory));
        activeContext = fallbackSlidingWindowPrune(activeContext); // Instant local pruning to protect context size
        pruneBase64Images(activeContext, 2); // Initial sliding window pruning

        updateCurrentSessionHistory();
        updateContextSizeInfo();

        writeToDebugLog("Prompt / History Context", JSON.stringify(activeContext, null, 2));

        const aiBubbleId = addBubble("ai", '<div class="dots-loader"><span></span><span></span><span></span></div>');
        activeAiBubbleId = aiBubbleId;
        const aiBubble = document.getElementById(aiBubbleId);

        let isCompleted = false;
        let loopRetries = 0;
        const maxRetries = typeof maxToolRetryLimit !== "undefined" ? maxToolRetryLimit : 3;
        let finalLlmResponse = "";
        const executedActions = [];
        const completedTurns = [];
        let stateModifiedSinceLastCapture = false;

        const packageAbortedTurnIfAny = () => {
            const lastLlmText = aiBubble.getAttribute("data-raw-full-text");
            if (lastLlmText && lastLlmText.trim()) {
                const parsed = parseStreamingReasoning(lastLlmText);
                completedTurns.push({
                    type: "failed",
                    turnNum: completedTurns.length + 1,
                    turnTitle: "Turn aborted by user",
                    content: parsed.content || "(Aborted mid-generation)",
                    reasoning: parsed.reasoning || "",
                    llmResponse: lastLlmText,
                    observations: "Execution stopped by user."
                });

                // Package and save the partial response to chat/agent history
                const assistantMsg = {
                    role: "assistant",
                    content: parsed.content || "(Aborted mid-generation)",
                    reasoning: parsed.reasoning || "",
                    intermediateTurns: JSON.parse(JSON.stringify(completedTurns))
                };
                pushToHistory(assistantMsg);

                // Add a system observation indicating the user stopped the agent
                const systemMsg = {
                    role: "user",
                    content: "[System Observation]: Execution was stopped by the user during this turn.",
                    isIntermediate: true
                };
                pushToHistory(systemMsg);

                // Update debug log pane
                writeToDebugLog("Turn Aborted (Saved to History)", JSON.stringify({
                    assistantMessage: assistantMsg,
                    systemObservation: systemMsg
                }, null, 2));

                aiBubble.removeAttribute("data-raw-full-text");
            }
        };

        while (!isCompleted && loopRetries < maxRetries) {
            if (executionId !== currentExecutionId || isStopped) {
                isCompleted = true;
                break;
            }
            try {
                pruneBase64Images(activeContext, 2); // Prune old base64 images to keep a sliding window of the last 2 captures

                // Reset reasoning toggled flag for each new LLM generation turn
                window._userToggledReasoning = false;
                window._userReasoningState = false;

                // Clear active tool statuses from the previous turn to prevent leaking them during streaming preview
                window._activeToolStatuses = null;

                const llmResponse = await callLLMApi(activeContext, (chunkText) => {
                    if (executionId !== currentExecutionId) return;
                    const activeTurnNum = completedTurns.length + 1;

                    const parsed = parseStreamingReasoning(chunkText);
                    const reasoningHtml = parsed.reasoning ? `<details class="reasoning-details" id="reasoning-turn-${aiBubble.id}-${activeTurnNum}" open><summary>Reasoning / Assembly Plan (Thinking...)</summary><div class="reasoning-content">${formatMarkdown(parsed.reasoning, activeTurnNum)}</div></details>` : "";
                    const contentHtml = formatMarkdown(parsed.content, activeTurnNum);

                    if (!isStopped) {
                        updateAiBubbleTurns(aiBubble, completedTurns, reasoningHtml, contentHtml);
                    }


                    aiBubble.setAttribute("data-raw-text", parsed.content);
                    aiBubble.setAttribute("data-raw-full-text", chunkText);
                    if (typeof scrollToBottom === "function") scrollToBottom();
                });
                if (executionId !== currentExecutionId || isStopped) {
                    if (isStopped || executionId !== currentExecutionId) {
                        packageAbortedTurnIfAny();
                    }
                    isCompleted = true;
                    break;
                }

                // Extract tool calls and parsed response early to validate content presence
                const parsedResponse = llmResponse ? parseStreamingReasoning(llmResponse) : { reasoning: "", content: "" };
                const jsonBlock = llmResponse ? extractJSONToolCalls(llmResponse) : null;
                const isOnlyReasoning = llmResponse && llmResponse.trim() && parsedResponse.reasoning && !parsedResponse.content.trim() && !jsonBlock;

                if (!llmResponse || !llmResponse.trim() || isOnlyReasoning) {
                    loopRetries++;
                    const errorMsg = isOnlyReasoning ?
                        "LLM returned only reasoning content without any action or conversational text." :
                        "LLM returned an empty or whitespace-only response.";
                    writeToDebugLog("LLM Response Empty Error", `${errorMsg} The local model context might be overloaded, or it encountered a generation failure.`);

                    completedTurns.push({
                        type: "failed",
                        turnNum: completedTurns.length + 1,
                        turnTitle: "Empty response from agent (Retrying...)",
                        llmResponse: llmResponse || "",
                        observations: `Error: ${errorMsg} This usually indicates a generation failure, model formatting issue, or context window overflow.`
                    });

                    updateAiBubbleTurns(aiBubble, completedTurns, "",
                        `<div style="margin-top:8px; font-size:11px; color:var(--text-error); display:flex; align-items:center; gap:6px;"><div class="dots-loader"><span></span><span></span><span></span></div> Empty/incomplete response detected. Retrying generation... (Attempt ${loopRetries}/${maxRetries})</div>`);
                    if (typeof scrollToBottom === "function") scrollToBottom();

                    const retryMsg = {
                        role: "user",
                        content: isOnlyReasoning ?
                            "[System Observation - Error]: You only outputted a <thinking> block but did not call any tools or provide any conversational content. Please output a valid JSON tool call wrapped in a ```json code block to proceed with your next steps." :
                            "[System Observation - Error]: You returned an empty or whitespace-only response. If your context window is overloaded, please resolve the task immediately or output a concise, corrected JSON tool call without conversational preamble.",
                        isIntermediate: true
                    };
                    activeContext.push(retryMsg);
                    pushToHistory(retryMsg);
                    continue;
                }

                aiBubble.setAttribute("data-raw-text", parsedResponse.content);
                const assistantMsg = {
                    role: "assistant",
                    content: parsedResponse.content,
                    reasoning: parsedResponse.reasoning
                };
                activeContext.push(assistantMsg);
                finalLlmResponse = llmResponse;

                writeToDebugLog("LLM Raw Response", llmResponse);

                if (jsonBlock) {
                    try {
                        const repaired = repairJSONRawNewlines(jsonBlock);
                        const parsed = JSON.parse(repaired);
                        const toolCalls = Array.isArray(parsed) ? parsed : [parsed];
                        let containsModifying = false;
                        let containsCapture = false;
                        for (let tIdx = 0; tIdx < toolCalls.length; tIdx++) {
                            const tc = toolCalls[tIdx];
                            if (tc && tc.tool) {
                                const toolName = getCanonicalToolName(tc.tool);
                                let isReadOnly = CANVAS_READONLY_TOOLS.indexOf(toolName) !== -1;
                                if ((toolName === "createScript" || toolName === "editScript") && tc.parameters && tc.parameters.execute) {
                                    isReadOnly = false;
                                }
                                if (!isReadOnly) {
                                    containsModifying = true;
                                }
                                if (toolName === "captureActiveFrame" || toolName === "captureCompositionSequence") {
                                    containsCapture = true;
                                }
                            }
                        }
                        if (containsModifying) {
                            stateModifiedSinceLastCapture = true;
                        }
                        if (containsCapture) {
                            stateModifiedSinceLastCapture = false;
                        }
                    } catch (e) {
                        stateModifiedSinceLastCapture = true; // Fallback to safe side
                    }
                }

                if (jsonBlock) {
                    assistantMsg.isIntermediate = true;
                }
                pushToHistory(assistantMsg);

                var observations = "";

                if (jsonBlock) {
                    try {
                        const parsed = JSON.parse(repairJSONRawNewlines(jsonBlock));
                        const toolCalls = Array.isArray(parsed) ? parsed : [parsed];
                        window._activeToolStatuses = toolCalls.map(tc => ({
                            tool: tc.tool,
                            status: "pending",
                            reason: ""
                        }));

                        const scriptCall = toolCalls.find(tc => getCanonicalToolName(tc.tool) === "executeExtendScript");
                        if (scriptCall && scriptCall.parameters && scriptCall.parameters.script) {
                            updateConsolePane(scriptCall.parameters.script);
                        }
                    } catch (e) {
                        window._activeToolStatuses = null;
                    }
                    const activeTurnNum = completedTurns.length + 1;
                    const reasoningHtml = parsedResponse.reasoning ? `<details class="reasoning-details" id="reasoning-turn-${aiBubble.id}-${activeTurnNum}" open><summary>Reasoning / Assembly Plan (Thinking...)</summary><div class="reasoning-content">${formatMarkdown(parsedResponse.reasoning, activeTurnNum)}</div></details>` : "";
                    const contentHtml = formatMarkdown(parsedResponse.content, activeTurnNum) +
                        `<div style="margin-top:8px; font-size:11px; color:var(--text-accent); display:flex; align-items:center; gap:6px;"><div class="dots-loader"><span></span><span></span><span></span></div> Executing Agent Tool Calls...</div>`;
                    updateAiBubbleTurns(aiBubble, completedTurns, reasoningHtml, contentHtml);
                    if (typeof scrollToBottom === "function") scrollToBottom();

                    writeToDebugLog("Tool Calls Extracted", jsonBlock);

                    if (executionId !== currentExecutionId || isStopped) {
                        isCompleted = true;
                        break;
                    }

                    const toolObservations = await executeToolCalls(jsonBlock);
                    console.log("[ArcEditor Tool Calls Observations]:", toolObservations);

                    writeToDebugLog("Tool Execution Observations", toolObservations);

                    if (executionId !== currentExecutionId || isStopped) {
                        isCompleted = true;
                        break;
                    }

                    if (toolObservations.toLowerCase().indexOf("error:") !== -1 ||
                        toolObservations.toLowerCase().indexOf("evalscript error") !== -1 ||
                        toolObservations.toLowerCase().indexOf("exception:") !== -1 ||
                        toolObservations.indexOf("Unsupported tool name:") !== -1) {
                        loopRetries++;

                        writeToDebugLog("Tool Execution Error", toolObservations);

                        // Package failed turn
                        completedTurns.push({
                            type: "failed",
                            turnNum: completedTurns.length + 1,
                            turnTitle: "Tool execution failed (Retrying...)",
                            content: parsedResponse.content,
                            reasoning: parsedResponse.reasoning,
                            llmResponse: llmResponse,
                            observations: toolObservations
                        });

                        updateAiBubbleTurns(aiBubble, completedTurns, "",
                            `<div style="margin-top:8px; font-size:11px; color:var(--text-error); display:flex; align-items:center; gap:6px;"><div class="dots-loader"><span></span><span></span><span></span></div> Tool error detected. Initiating self-correction... (Attempt ${loopRetries}/${maxRetries})</div>`);
                        if (typeof scrollToBottom === "function") scrollToBottom();

                        // Push error feedback to local context history and master history
                        const errFeedbackMsg = {
                            role: "user",
                            content: `[System Observation - Error]: System execution failed with error: "${toolObservations}". Please analyze the After Effects error, correct the syntax or API mismatch, and output a complete revised JSON tool call.`,
                            isIntermediate: true
                        };
                        activeContext.push(errFeedbackMsg);
                        pushToHistory(errFeedbackMsg);

                        // Don't send the base64 image again to save bandwidth
                        visualFrameInputs = null;

                        continue; // Self-correction retry
                    } else {
                        observations += (observations ? "\n" : "") + `Tool execution observation:\n${toolObservations}`;
                    }

                    // Reset retry count on successful execution turn
                    loopRetries = 0;

                    // Append observations to local context history and master history (handling multi-modal visual observations!)
                    let turnImages = null;
                    let obsMsg;
                    if (capturedFrameDataDuringLoop) {
                        turnImages = capturedFrameDataDuringLoop;
                        const contentParts = [
                            { type: "text", text: `[System Observation - Visual Tool Output]:\n${observations}\n\nPlease analyze the visual state of the composition and proceed with your next planned steps.` }
                        ];
                        if (Array.isArray(capturedFrameDataDuringLoop)) {
                            capturedFrameDataDuringLoop.forEach(img => {
                                contentParts.push({ type: "image_url", image_url: { url: `data:image/png;base64,${img}` } });
                            });
                        } else {
                            contentParts.push({ type: "image_url", image_url: { url: `data:image/png;base64,${capturedFrameDataDuringLoop}` } });
                        }
                        obsMsg = {
                            role: "user",
                            content: contentParts,
                            isIntermediate: true
                        };
                        capturedFrameDataDuringLoop = null; // Reset for next potential capture
                    } else {
                        obsMsg = {
                            role: "user",
                            content: `[System Observation - Tool Output]:\n${observations}\n\nPlease analyze this result and proceed with your next planned steps.`,
                            isIntermediate: true
                        };
                    }
                    activeContext.push(obsMsg);
                    pushToHistory(obsMsg);

                    // Package successful turn
                    let turnTitle = "Analyzing composition context";
                    if (jsonBlock.indexOf("executeScript") !== -1) {
                        turnTitle = "Executing timeline automation script";
                    } else if (jsonBlock.indexOf("createScript") !== -1 || jsonBlock.indexOf("editScript") !== -1) {
                        turnTitle = "Drafting/editing automation script";
                    } else {
                        try {
                            const parsed = JSON.parse(jsonBlock);
                            const tools = (Array.isArray(parsed) ? parsed : [parsed]).map(t => t.tool).join(", ");
                            turnTitle = `Running tool: ${tools}`;
                        } catch (e) {
                            turnTitle = "Running agent tool calls";
                        }
                    }

                    completedTurns.push({
                        type: "success",
                        turnNum: completedTurns.length + 1,
                        turnTitle: turnTitle,
                        content: parsedResponse.content,
                        reasoning: parsedResponse.reasoning,
                        llmResponse: llmResponse,
                        observations: observations,
                        images: turnImages
                    });

                    // Show feedback in UI and prepare next turn
                    const isNextTurnAllowed = (loopRetries < maxRetries);
                    updateAiBubbleTurns(aiBubble, completedTurns, "",
                        (isNextTurnAllowed ? `<div style="margin-top:8px; font-size:11px; color:var(--text-accent); display:flex; align-items:center; gap:6px;"><div class="dots-loader"><span></span><span></span><span></span></div> Agent planning next step...</div>` : ""));
                    if (typeof scrollToBottom === "function") scrollToBottom();

                    continue; // Run next loop turn immediately
                } else {
                    // LLM replied without code blocks (informational answer)
                    if (stateModifiedSinceLastCapture) {
                        writeToDebugLog("Auto-Verification Intercept", "State was modified but no frame was captured. Automatically capturing active frame for validation...");

                        // 1. Show feedback in UI that verification is in progress
                        const activeTurnNum = completedTurns.length + 1;
                        const parsed = parseStreamingReasoning(llmResponse);
                        const reasoningHtml = parsed.reasoning ? `<details class="reasoning-details" id="reasoning-turn-${aiBubble.id}-${activeTurnNum}" open><summary>Reasoning / Assembly Plan (Thinking...)</summary><div class="reasoning-content">${formatMarkdown(parsed.reasoning, activeTurnNum)}</div></details>` : "";
                        const contentHtml = formatMarkdown(parsed.content, activeTurnNum) +
                            `<div style="margin-top:8px; font-size:11px; color:var(--text-accent); display:flex; align-items:center; gap:6px;"><div class="dots-loader"><span></span><span></span><span></span></div> Verifying timeline canvas changes...</div>`;
                        updateAiBubbleTurns(aiBubble, completedTurns, reasoningHtml, contentHtml);
                        if (typeof scrollToBottom === "function") scrollToBottom();

                        // 2. Perform the frame capture
                        const base64Data = await captureCompositionFrame(true);
                        if (base64Data) {
                            capturedFrameDataDuringLoop = base64Data;
                            stateModifiedSinceLastCapture = false; // Reset the flag since we've now provided a capture

                            // Mark the intercepted assistant message as intermediate in history since we are continuing the loop
                            assistantMsg.isIntermediate = true;
                            if (chatHistory.length > 0) {
                                chatHistory[chatHistory.length - 1].isIntermediate = true;
                            }
                            if (agentHistory.length > 0) {
                                agentHistory[agentHistory.length - 1].isIntermediate = true;
                            }

                            // 3. Inject the observation message with the image to prompt the LLM
                            const contentParts = [
                                { type: "text", text: `[System Observation - Visual Verification]: You have modified the composition but did not request a visual capture to inspect your changes. The system has automatically captured the active frame. Please analyze this attached canvas frame to visually verify that all layout coordinates, typography styles, shape sizes, colors, and blend modes are perfectly aligned and correct.\n\n- If everything looks correct: finalize your response as per the Detailed Final Conclusion guidelines in the System Instructions.\n- If you spot any layout bugs, rendering defects, or alignment issues: execute a corrected ExtendScript to fix them before finalizing.` }
                            ];
                            contentParts.push({ type: "image_url", image_url: { url: `data:image/png;base64,${base64Data}` } });

                            const obsMsg = {
                                role: "user",
                                content: contentParts,
                                isIntermediate: true
                            };
                            activeContext.push(obsMsg);
                            pushToHistory(obsMsg);

                            // Add a successful verification turn to completedTurns
                            completedTurns.push({
                                type: "success",
                                turnNum: completedTurns.length + 1,
                                turnTitle: "Visual verification frame captured",
                                content: parsedResponse.content,
                                reasoning: parsedResponse.reasoning,
                                llmResponse: llmResponse,
                                observations: "Success: Canvas frame automatically captured and attached for visual inspection.",
                                images: base64Data
                            });

                            capturedFrameDataDuringLoop = null; // Reset for next potential loop turn

                            // Force loop to continue so the LLM receives the image and verifies it!
                            continue;
                        } else {
                            // If capture failed, degrade gracefully as agreed
                            writeToDebugLog("Auto-Verification Warning", "Failed to capture active frame during intercept. Proceeding to finalize completion.");
                        }
                    }

                    // Check if the agent explicitly concluded
                    if (!parsedResponse.concluded) {
                        loopRetries++;
                        const errorMsg = "LLM replied with text but did not output the '__CONCLUDE__' token to finish the task.";
                        writeToDebugLog("LLM Incomplete Exit Warning", errorMsg);

                        completedTurns.push({
                            type: "failed",
                            turnNum: completedTurns.length + 1,
                            turnTitle: "Awaiting final conclusion (Retrying...)",
                            llmResponse: llmResponse,
                            observations: "Error: You did not output '__CONCLUDE__' to finish the task. If you are done, write your final response and append '__CONCLUDE__' to the very end. Otherwise, run your next tool call."
                        });

                        updateAiBubbleTurns(aiBubble, completedTurns, "",
                            `<div style="margin-top:8px; font-size:11px; color:var(--text-accent); display:flex; align-items:center; gap:6px;"><div class="dots-loader"><span></span><span></span><span></span></div> Awaiting completion token... Resuming...</div>`);
                        if (typeof scrollToBottom === "function") scrollToBottom();

                        const retryMsg = {
                            role: "user",
                            content: "[System Observation - Error]: You outputted text but did not append the '__CONCLUDE__' token at the very end of your final response content. If you are finished, you MUST append the token '__CONCLUDE__' to signal that the task is complete. If you are not finished and intended to call a tool, please output the tool call wrapped in a ```json code block.",
                            isIntermediate: true
                        };
                        activeContext.push(retryMsg);
                        pushToHistory(retryMsg);
                        continue;
                    }

                    isCompleted = true;
                    const reasoningHtml = parsedResponse.reasoning ? `<details class="reasoning-details" id="reasoning-turn-${aiBubble.id}-${completedTurns.length + 1}" open><summary>Reasoning / Assembly Plan</summary><div class="reasoning-content">${formatMarkdown(parsedResponse.reasoning, completedTurns.length + 1)}</div></details>` : "";
                    const contentHtml = formatMarkdown(parsedResponse.content, completedTurns.length + 1);
                    updateAiBubbleTurns(aiBubble, completedTurns, reasoningHtml, contentHtml, true);
                    if (typeof scrollToBottom === "function") scrollToBottom();
                    writeToDebugLog("Informational Response Completed", llmResponse);
                }

            } catch (err) {
                console.error("Loop iteration failed:", err);

                packageAbortedTurnIfAny();
                if (isStopped || executionId !== currentExecutionId) {
                    isCompleted = true;
                } else {
                    updateAiBubbleTurns(aiBubble, completedTurns, "", `<p style="color:var(--text-error);">Error executing loop: ${err.message}</p>`, true);
                    if (typeof scrollToBottom === "function") scrollToBottom();
                    isCompleted = true;
                }
            }
        }

        if (executionId !== currentExecutionId) {
            // Obsolete thread - if it was stopped, we still need to perform the final UI render once
            if (isStopped) {
                updateAiBubbleTurns(aiBubble, completedTurns, "",
                    `<div style="margin-top:8px; font-size:11px; color:var(--text-warning); display:flex; align-items:center; gap:6px;">` +
                    `<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>` +
                    `Execution stopped by user.</div>`, true);
                if (typeof scrollToBottom === "function") scrollToBottom();
            }
            return;
        }

        if (isStopped) {
            updateAiBubbleTurns(aiBubble, completedTurns, "",
                `<div style="margin-top:8px; font-size:11px; color:var(--text-warning); display:flex; align-items:center; gap:6px;">` +
                `<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>` +
                `Execution stopped by user.</div>`, true);
            if (typeof scrollToBottom === "function") scrollToBottom();
        } else {
            if (loopRetries >= maxRetries) {
                let hasEmptyResponse = false;
                for (let turnIdx = 0; turnIdx < completedTurns.length; turnIdx++) {
                    if (completedTurns[turnIdx].turnTitle === "Empty response from agent (Retrying...)") {
                        hasEmptyResponse = true;
                        break;
                    }
                }
                const extraMsg = hasEmptyResponse ? " (An empty response was detected, which could indicate a context window overflow on your local LLM server)." : " Check the JSX Console tab for syntax logs.";
                updateAiBubbleTurns(aiBubble, completedTurns, "",
                    `<div style="margin-top:8px; font-size:11px; color:var(--text-error);">⚠ Max correction attempts reached.${extraMsg}</div>`, true);
                if (typeof scrollToBottom === "function") scrollToBottom();
            }
        }

        // Set the intermediateTurns property on the last assistant message in history, and remove isIntermediate if failed, stopped, or completed
        const lastAssistantMsg = chatHistory.filter(m => m.role === "assistant").pop();
        if (lastAssistantMsg) {
            lastAssistantMsg.intermediateTurns = completedTurns;
            delete lastAssistantMsg.intermediateTurnsHtml;
            if (isStopped || loopRetries >= maxRetries || isCompleted) {
                delete lastAssistantMsg.isIntermediate;
            }
        }

        const lastAgentAssistantMsg = agentHistory.filter(m => m.role === "assistant").pop();
        if (lastAgentAssistantMsg) {
            lastAgentAssistantMsg.intermediateTurns = completedTurns;
            delete lastAgentAssistantMsg.intermediateTurnsHtml;
            if (isStopped || loopRetries >= maxRetries || isCompleted) {
                delete lastAgentAssistantMsg.isIntermediate;
            }
        }

        if (isStopped || loopRetries >= maxRetries || isCompleted) {
            pruneLargeWebObservations(chatHistory);
            pruneLargeWebObservations(agentHistory);
        }

        // Update persistent history size information
        updateCurrentSessionHistory();
        updateContextSizeInfo();

        // Trigger memory condensation asynchronously in the background so the user does not wait
        setTimeout(async () => {
            try {
                const expectedVersion = historyVersion; // Capture current history version
                const historySnapshot = [...agentHistory];
                const condensedContext = await pruneHistoryContexts(historySnapshot);
                if (condensedContext && condensedContext.length < historySnapshot.length) {
                    if (expectedVersion !== historyVersion) {
                        console.log("[ArcEditor] History version mismatch during condensation. Discarding condensation task to prevent race condition.");
                        return;
                    }
                    const snapshotLen = historySnapshot.length;
                    let wasModified = false;
                    for (let idx = 0; idx < snapshotLen; idx++) {
                        if (agentHistory[idx] !== historySnapshot[idx]) {
                            wasModified = true;
                            break;
                        }
                    }
                    if (wasModified) {
                        console.log("[ArcEditor] History base shifted during condensation. Discarding condensation task to prevent race condition.");
                        return;
                    }
                    const newMessages = agentHistory.slice(snapshotLen);
                    agentHistory = condensedContext.concat(newMessages);
                    updateCurrentSessionHistory();
                    updateContextSizeInfo();
                }
            } catch (e) {
                console.error("Background memory condensation failed:", e);
            }
        }, 50);

        // Expose activeContext strictly for testing, assertion, and developer inspection
        if (typeof window !== "undefined") {
            window.lastActiveContext = activeContext;
        } else if (typeof global !== "undefined") {
            global.lastActiveContext = activeContext;
        }
        try {
            lastActiveContext = activeContext;
        } catch (e) { }
    } finally {
        isExecuting = false;
        attachedFrames = [];
        if (typeof window !== "undefined") {
            window._activeToolStatuses = null;
        }
        if (typeof updateContextSizeInfo === "function") {
            updateContextSizeInfo();
        }
        if (typeof setUIReadyState === "function") {
            setUIReadyState(true);
        }
    }

}

function extractJSONToolCalls(text) {
    if (!text) return null;

    // 1. Check standard markdown code blocks (```json ... ``` or ``` ... ```)
    const blockRegex = /```(?:json)?\s*([\s\S]*?)(?:```|$)/gi;
    let match;
    while ((match = blockRegex.exec(text)) !== null) {
        const candidate = match[1].trim();
        if (!candidate) continue;
        if (candidate.startsWith("{") || candidate.startsWith("[")) {
            try {
                const repaired = repairJSONRawNewlines(candidate);
                const parsed = JSON.parse(repaired);
                const isTool = parsed && (parsed.tool || (Array.isArray(parsed) && parsed.some(p => p && p.tool)));
                if (isTool) {
                    return candidate;
                }
            } catch (e) {
                // Try suffix recovery for unclosed streaming chunks
                try {
                    const recovered = candidate + (candidate.startsWith("[") ? "]" : "}");
                    const repaired = repairJSONRawNewlines(recovered);
                    const parsed = JSON.parse(repaired);
                    if (parsed && (parsed.tool || (Array.isArray(parsed) && parsed.some(p => p && p.tool)))) {
                        return recovered;
                    }
                } catch (e2) { }
            }
        }
    }

    // 2. Fallback: Search for raw JSON objects containing a "tool" key outside code blocks
    const rawToolMatch = text.match(/(\{[\s\S]*?"tool"\s*:\s*"[^"]+"[\s\S]*?\}|\[\s*\{[\s\S]*?"tool"\s*:\s*"[^"]+"[\s\S]*?\}\s*\])/);
    if (rawToolMatch) {
        try {
            const candidate = rawToolMatch[1].trim();
            const repaired = repairJSONRawNewlines(candidate);
            JSON.parse(repaired);
            return candidate;
        } catch (e) { }
    }

    return null;
}

function updatePlanString(planText, updates) {
    if (!planText) return planText;
    const lines = planText.split("\n");
    let checklistCount = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/^(\s*[-*+]\s+\[)([\s*xX]?)(\]\s+)(.*?)$/);
        if (match) {
            const currentIdx = checklistCount;
            checklistCount++;

            const update = updates.find(u => u.index === currentIdx);
            if (update) {
                let leading = match[1];
                let checkChar = match[2];
                let closing = match[3];
                let text = match[4];

                if (update.checked !== undefined) {
                    checkChar = update.checked ? 'x' : ' ';
                }
                if (update.text !== undefined) {
                    text = update.text;
                }

                lines[i] = `${leading}${checkChar}${closing}${text}`;
            }
        }
    }
    return lines.join("\n");
}

function repairJSONRawNewlines(jsonStr) {
    if (!jsonStr) return "";
    let result = "";
    let inString = false;
    let escaped = false;
    for (let i = 0; i < jsonStr.length; i++) {
        const char = jsonStr[i];
        if (escaped) {
            result += char;
            escaped = false;
            continue;
        }
        if (char === '\\') {
            result += char;
            escaped = true;
            continue;
        }
        if (char === '"') {
            inString = !inString;
            result += char;
            continue;
        }
        if (inString && (char === '\n' || char === '\r')) {
            if (char === '\n') {
                result += "\\n";
            }
            continue;
        }
        result += char;
    }
    return result;
}

function getSignificantJsonActionKey(jsonStr) {
    if (!jsonStr) return "";
    try {
        const repaired = repairJSONRawNewlines(jsonStr);
        const parsed = JSON.parse(repaired);
        const toolCalls = Array.isArray(parsed) ? parsed : [parsed];
        const stateModifying = toolCalls.filter(tc => {
            const toolName = getCanonicalToolName(tc.tool);
            const isReadOnly = CANVAS_READONLY_TOOLS.indexOf(toolName) !== -1;
            return !isReadOnly;
        });
        if (stateModifying.length === 0) {
            return ""; // No state-modifying actions
        }
        return JSON.stringify(stateModifying);
    } catch (e) {
        // Fallback to the raw string if parsing fails, so we still track repeats of syntax errors or raw text
        return jsonStr.trim();
    }
}

async function executeToolCalls(jsonStr) {
    let toolCalls = [];
    try {
        const repaired = repairJSONRawNewlines(jsonStr);
        const parsed = JSON.parse(repaired);
        toolCalls = Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
        return `Error parsing JSON tool calls: ${e.message}. Ensure your JSON blocks are strictly valid.`;
    }

    let observations = [];

    try {
        for (let i = 0; i < toolCalls.length; i++) {
            if (typeof isStopped !== "undefined" && isStopped) {
                observations.push(`- Tool execution aborted: Stopped by user.`);
                break;
            }
            const tc = toolCalls[i];
            const toolName = getCanonicalToolName(tc.tool);

            // Authorization Intercept for non-readonly tool calls
            let isReadOnly = PERMISSION_READONLY_TOOLS.indexOf(toolName) !== -1;
            if ((toolName === "createScript" || toolName === "editScript") && tc.parameters && tc.parameters.execute) {
                isReadOnly = false;
            }

            const allowed = getProjectAllowedTools(currentProjectPath);
            const denied = getProjectDeniedTools(currentProjectPath);

            if (denied.includes(toolName)) {
                if (window._activeToolStatuses && window._activeToolStatuses[i]) {
                    window._activeToolStatuses[i].status = "blocked";
                }
                if (typeof window !== "undefined" && typeof window.updateToolCardStatusUI === "function") {
                    window.updateToolCardStatusUI(i, "blocked");
                }
                observations.push(`- Tool "${toolName}": Blocked by project security configuration.`);
                continue;
            }

            let needsPrompt = false;
            if (agentPermissionMode === "permissive") {
                needsPrompt = false;
            } else if (agentPermissionMode === "strict") {
                needsPrompt = !allowed.includes(toolName);
            } else {
                needsPrompt = !isReadOnly && !allowed.includes(toolName);
            }

            if (needsPrompt) {
                if (typeof setUIReadyState === "function") {
                    setUIReadyState(false);
                }

                let choice = "allow";
                if (typeof window !== "undefined" && typeof window.promptUserForToolConfirmation === "function") {
                    tc.toolIndex = i;
                    choice = await window.promptUserForToolConfirmation(tc);
                }

                if (choice === "deny") {
                    if (window._activeToolStatuses && window._activeToolStatuses[i]) {
                        window._activeToolStatuses[i].status = "denied";
                    }
                    if (typeof window !== "undefined" && typeof window.updateToolCardStatusUI === "function") {
                        window.updateToolCardStatusUI(i, "denied");
                    }
                    observations.push(`- Tool "${toolName}": Denied by user.`);
                    continue;
                } else if (choice && choice.startsWith("deny::")) {
                    const reason = choice.substring(6).trim();
                    if (window._activeToolStatuses && window._activeToolStatuses[i]) {
                        window._activeToolStatuses[i].status = "denied";
                        window._activeToolStatuses[i].reason = reason;
                    }
                    if (typeof window !== "undefined" && typeof window.updateToolCardStatusUI === "function") {
                        window.updateToolCardStatusUI(i, "denied", reason);
                    }
                    observations.push(`- Tool "${toolName}": Denied by user. Reason: "${reason}"`);
                    continue;
                } else if (choice === "denyAll") {
                    if (window._activeToolStatuses && window._activeToolStatuses[i]) {
                        window._activeToolStatuses[i].status = "blocked";
                    }
                    if (typeof window !== "undefined" && typeof window.updateToolCardStatusUI === "function") {
                        window.updateToolCardStatusUI(i, "blocked");
                    }
                    const updatedDenied = [...denied];
                    if (!updatedDenied.includes(toolName)) {
                        updatedDenied.push(toolName);
                        setProjectDeniedTools(currentProjectPath, updatedDenied);
                    }
                    const updatedAllowed = allowed.filter(t => t !== toolName);
                    if (updatedAllowed.length !== allowed.length) {
                        setProjectAllowedTools(currentProjectPath, updatedAllowed);
                    }
                    observations.push(`- Tool "${toolName}": Blocked by project security configuration.`);
                    continue;
                } else if (choice === "allowAll") {
                    const updatedAllowed = [...allowed];
                    if (!updatedAllowed.includes(toolName)) {
                        updatedAllowed.push(toolName);
                        setProjectAllowedTools(currentProjectPath, updatedAllowed);
                    }
                    const updatedDenied = denied.filter(t => t !== toolName);
                    if (updatedDenied.length !== denied.length) {
                        setProjectDeniedTools(currentProjectPath, updatedDenied);
                    }
                }
            }

            // Mark as allowed since it bypassed prompt or user allowed it
            if (window._activeToolStatuses && window._activeToolStatuses[i]) {
                window._activeToolStatuses[i].status = "allowed";
            }
            if (typeof window !== "undefined" && typeof window.updateToolCardStatusUI === "function") {
                window.updateToolCardStatusUI(i, "allowed");
            }

            const params = tc.parameters || {};
            const ref = params.layerRef !== undefined ? params.layerRef : params.layerIndex;
            const serializedRef = typeof ref === "string" ? `"${ref.replace(/"/g, '\\"')}"` : (ref !== undefined ? ref : 'null');

            let jsxCommand = "";
            if (toolName === "getTimelineContext") {
                const timelineData = await getTimelineContext();
                observations.push(`- Tool "getTimelineContext": ${JSON.stringify(timelineData)}`);
                continue;
            } else if (toolName === "getProjectAssets") {
                const assetsResult = await evalScriptAsync("$._com_arceditor_.ArcInspector.getProjectAssets()");
                observations.push(`- Tool "getProjectAssets": ${assetsResult}`);
                continue;
            } else if (toolName === "webSearch") {
                const query = params.query;
                const results = await window.searchWeb(query);
                observations.push(`- Tool "webSearch": ${JSON.stringify(results)}\n Follow this up with the webScrape tool for retrieve information from the following links.`);
                continue;
            } else if (toolName === "webScrape") {
                const url = params.url;
                const chunk = params.chunk !== undefined ? params.chunk : 0;
                const format = params.format || "text";
                const result = await window.scrapeWeb(url, chunk, format);
                observations.push(`- Tool "webScrape": ${result}`);
                continue;
            } else if (toolName === "askQuestion") {
                if (typeof setUIReadyState === "function") {
                    setUIReadyState(false);
                }
                let answers = "";
                if (typeof window !== "undefined" && typeof window.promptUserForQuestions === "function") {
                    answers = await window.promptUserForQuestions(tc);
                } else {
                    answers = "Error: Question prompting UI is not supported on this platform.";
                }
                observations.push(`- Tool "askQuestion":\n${answers}`);
                continue;
            } else if (toolName === "submitPlan") {
                window.activePlan = params.plan;
                if (typeof window !== "undefined" && typeof window.updatePinnedPlanUI === "function") {
                    window.updatePinnedPlanUI();
                }
                if (typeof updateCurrentSessionHistory === "function") {
                    updateCurrentSessionHistory();
                }
                observations.push(`- Tool "submitPlan": Plan approved by user. Plan details:\n${params.plan}`);
                continue;
            } else if (toolName === "updatePlan") {
                let originalPlan = window.activePlan || "";
                let newPlan = originalPlan;

                if (params.plan !== undefined) {
                    newPlan = params.plan;
                } else if (params.updates && Array.isArray(params.updates)) {
                    newPlan = updatePlanString(originalPlan, params.updates);
                }

                if (params.conclude) {
                    window.activePlan = newPlan;
                    if (typeof updateCurrentSessionHistory === "function") {
                        updateCurrentSessionHistory();
                    }
                    window.activePlan = null;
                    if (typeof window !== "undefined" && typeof window.updatePinnedPlanUI === "function") {
                        window.updatePinnedPlanUI();
                    }
                    observations.push(`- Tool "${toolName}": Plan updated and concluded/finished. Current plan details:\n${newPlan}`);
                    continue;
                }

                if (!window.activePlan && params.plan === undefined) {
                    observations.push(`- Tool "${toolName}": Error: No active running plan to update. Propose a new plan first using submitPlan.`);
                    continue;
                }

                window.activePlan = newPlan;
                if (typeof window !== "undefined" && typeof window.updatePinnedPlanUI === "function") {
                    window.updatePinnedPlanUI();
                }
                if (typeof updateCurrentSessionHistory === "function") {
                    updateCurrentSessionHistory();
                }
                observations.push(`- Tool "${toolName}": Plan updated successfully. Current plan details:\n${window.activePlan}`);
                continue;
            } else if (toolName === "getInstalledEffects") {
                if (!installedEffects || Object.keys(installedEffects).length === 0) {
                    await loadInstalledEffects();
                }
                observations.push(`- Tool "getInstalledEffects": ${JSON.stringify(installedEffects)}`);
                continue;
            } else if (toolName === "searchInstalledEffects") {
                if (!installedEffects || Object.keys(installedEffects).length === 0) {
                    await loadInstalledEffects();
                }
                const keyword = (params.keyword || "").toLowerCase();
                const matched = {};
                for (const category in installedEffects) {
                    if (Object.prototype.hasOwnProperty.call(installedEffects, category)) {
                        const list = installedEffects[category];
                        if (Array.isArray(list)) {
                            const filtered = list.filter(fx =>
                                (fx.displayName && fx.displayName.toLowerCase().indexOf(keyword) !== -1) ||
                                (fx.matchName && fx.matchName.toLowerCase().indexOf(keyword) !== -1)
                            );
                            if (filtered.length > 0) {
                                matched[category] = filtered;
                            }
                        }
                    }
                }
                observations.push(`- Tool "searchInstalledEffects": ${JSON.stringify(matched)}`);
                continue;
            } else if (toolName === "getEffectProperties") {
                const effectMatchName = params.effectMatchName;
                const resultObj = await getEffectProperties(effectMatchName);
                observations.push(`- Tool "getEffectProperties": ${JSON.stringify(resultObj)}`);
                continue;
            } else if (toolName === "captureActiveFrame") {
                try {
                    const base64Data = await captureCompositionFrame(true);
                    if (base64Data) {
                        observations.push(`- Tool "captureActiveFrame": Success: Active frame successfully captured and visually attached.`);
                        capturedFrameDataDuringLoop = base64Data;
                    } else {
                        observations.push(`- Tool "captureActiveFrame": Error: Failed to capture active frame preview. No frame data was returned.`);
                    }
                } catch (err) {
                    observations.push(`- Tool "captureActiveFrame": Error: Failed to capture active frame preview. Reason: ${err.message}`);
                }
                continue;
            } else if (toolName === "captureCompositionSequence") {
                try {
                    const base64List = await captureCompositionSequence(params.startTime, params.endTime, params.numFrames, true);
                    if (base64List && base64List.length > 0) {
                        observations.push(`- Tool "captureCompositionSequence": Success: Captured and visually attached a sequence of ${base64List.length} frames.`);
                        capturedFrameDataDuringLoop = base64List;
                    } else {
                        observations.push(`- Tool "captureCompositionSequence": Error: Failed to capture composition sequence. No frames were returned.`);
                    }
                } catch (err) {
                    observations.push(`- Tool "captureCompositionSequence": Error: Failed to capture composition sequence. Reason: ${err.message}`);
                }
                continue;
            } else if (toolName === "undoLastAction") {
                await evalScriptAsync("app.activate(); app.executeCommand(16);");
                observations.push(`- Tool "undoLastAction": Success: Rolled back the last ExtendScript action in After Effects.`);
                continue;
            } else if (toolName === "setPlayheadTime") {
                const serializedTime = typeof params.time === "string" ? `"${params.time.replace(/"/g, '\\"')}"` : params.time;
                jsxCommand = `(function() { return $._com_arceditor_.ArcEditor.setPlayheadTime(${serializedTime}); })()`;
            } else if (toolName === "selectLayers") {
                const refs = params.layerRefs !== undefined ? params.layerRefs : params.layerIndices;
                const serializedRefs = typeof refs === "string" || typeof refs === "number" ? (typeof refs === "string" ? `"${refs.replace(/"/g, '\\"')}"` : refs) : JSON.stringify(refs);
                jsxCommand = `(function() { return $._com_arceditor_.ArcEditor.selectLayers(${serializedRefs}, ${params.deselectOthers !== false}); })()`;
            } else if (toolName === "switchComposition") {
                const serializedCompRef = typeof params.compRef === "string" ? `"${params.compRef.replace(/"/g, '\\"')}"` : params.compRef;
                jsxCommand = `(function() { return $._com_arceditor_.ArcEditor.switchComposition(${serializedCompRef}); })()`;
            } else if (toolName === "getLayerProperties") {
                const groupFilterVal = params.groupFilter ? `"${params.groupFilter.replace(/"/g, '\\"')}"` : "null";
                jsxCommand = `$._com_arceditor_.ArcEditor.inspectLayerProperties(${serializedRef}, ${groupFilterVal})`;
            } else if (toolName === "readAudioPeaks") {
                try {
                    const audioRef = params.audioLayer || params.audioLayerRef || params.layerRef;
                    if (!audioRef) {
                        observations.push(`- Tool "readAudioPeaks": Error - Missing audioLayer parameter.`);
                        continue;
                    }
                    const resStr = await ArcEditor.timeline.readAudioPeaks(audioRef, params);
                    observations.push(`- Tool "readAudioPeaks": ${resStr}`);
                } catch (err) {
                    observations.push(`- Tool "readAudioPeaks": Error: ${err.message}`);
                }
                continue;
            } else if (toolName === "readMarkers") {
                try {
                    const resStr = await ArcEditor.timeline.readMarkers(params.type || "comp", params.layerRef);
                    observations.push(`- Tool "readMarkers": ${resStr}`);
                } catch (err) {
                    observations.push(`- Tool "readMarkers": Error: ${err.message}`);
                }
            } else if (toolName === "createSvgShape") {
                const svgContent = params.svg;
                if (!svgContent || typeof svgContent !== "string") {
                    observations.push(`- Tool "createSvgShape": Error - Missing or invalid 'svg' parameter.`);
                    continue;
                }

                try {
                    // 1. Query active timeline dimensions for coordinate calculation if available
                    let compW = 1920, compH = 1080;
                    try {
                        const compData = typeof getTimelineContext === "function" ? await getTimelineContext() : null;
                        if (compData && compData.width && compData.height) {
                            compW = compData.width;
                            compH = compData.height;
                        }
                    } catch (e) { }

                    // 2. Transpile SVG into Intermediate Representation (IR)
                    let transpiler = (typeof window !== "undefined" && window.ArcSvgTranspiler) ||
                        (typeof ArcSvgTranspiler !== "undefined" ? ArcSvgTranspiler : null) ||
                        (typeof window !== "undefined" && window.ArcEditor && window.ArcEditor.svgTranspiler);
                    if (!transpiler && typeof require === "function") {
                        try {
                            transpiler = require("./js/svg-transpiler.js");
                        } catch (reqErr1) {
                            try {
                                transpiler = require("./svg-transpiler.js");
                            } catch (reqErr2) { }
                        }
                    }
                    if (!transpiler) {
                        throw new Error("ArcSvgTranspiler module is not loaded. Please ensure js/svg-transpiler.js is included in index.html.");
                    }

                    const ir = transpiler.transpile(svgContent, {
                        compWidth: compW,
                        compHeight: compH,
                        position: params.position,
                        scale: params.scale,
                        mode: params.mode || "single_layer",
                        layerName: params.layerName
                    });

                    // 3. Execute on timeline
                    let hostRes = "";
                    if (params.targetLayer) {
                        // In-place update / replacement
                        const updateOpts = {
                            targetGroup: params.targetGroup || null
                        };
                        const serializedRef = JSON.stringify(params.targetLayer);
                        const serializedIR = JSON.stringify(ir);
                        const serializedOpts = JSON.stringify(updateOpts);
                        const script = `$._com_arceditor_.ArcEditor.updateSvgShapeLayer(${serializedRef}, ${serializedIR}, ${serializedOpts})`;
                        hostRes = await evalScriptAsync(wrapExtendScript(script));
                    } else {
                        // Create new shape layer(s)
                        const createOpts = {
                            ordering: params.ordering || null,
                            relativeTo: params.relativeTo || params.relativeToLayerRef || null
                        };
                        const serializedName = JSON.stringify(params.layerName || "SVG Vector Layer");
                        const serializedIR = JSON.stringify(ir);
                        const serializedOpts = JSON.stringify(createOpts);
                        const script = `$._com_arceditor_.ArcEditor.addSvgShapeLayer(${serializedName}, ${serializedIR}, ${serializedOpts})`;
                        hostRes = await evalScriptAsync(wrapExtendScript(script));
                    }

                    observations.push(`- Tool "createSvgShape": ${hostRes}`);
                } catch (err) {
                    observations.push(`- Tool "createSvgShape": Error transpiling SVG: ${err.message}`);
                }
                continue;
            } else if (toolName === "createScript") {
                const sName = params.scriptName;
                const content = params.content;
                if (!sName) {
                    observations.push(`- Tool "createScript": Error - Missing scriptName.`);
                    continue;
                }
                const analysis = typeof analyzeExtendScript === "function" ? analyzeExtendScript(content) : { safe: true };
                if (!analysis.safe) {
                    observations.push(`- Tool "createScript": Blocked by static security analyzer. Reason: ${analysis.reason}`);
                    if (window._activeToolStatuses && window._activeToolStatuses[i]) {
                        window._activeToolStatuses[i].status = "blocked";
                        window._activeToolStatuses[i].reason = analysis.reason;
                    }
                    if (typeof window !== "undefined" && typeof window.updateToolCardStatusUI === "function") {
                        window.updateToolCardStatusUI(i, "blocked", analysis.reason);
                    }
                    continue;
                }
                createOrUpdateScript(currentProjectPath, sName, content);
                activeScriptName = sName;
                if (typeof renderScriptTabs === "function") {
                    renderScriptTabs();
                }
                const consoleOutput = document.getElementById("console-output");
                if (consoleOutput) {
                    consoleOutput.value = content;
                }

                if (params.execute) {
                    jsxCommand = wrapExtendScript(content);
                } else {
                    observations.push(`- Tool "createScript": Script "${sName}" created/overwritten successfully.`);
                    continue;
                }
            } else if (toolName === "viewScript") {
                const sName = params.scriptName;
                if (!sName) {
                    observations.push(`- Tool "viewScript": Error - Missing scriptName.`);
                    continue;
                }
                const scriptObj = typeof findScriptByName === "function" ? findScriptByName(currentProjectPath, sName) : null;
                if (!scriptObj) {
                    observations.push(`- Tool "viewScript": Error - Script "${sName}" not found.`);
                } else {
                    let contentToShow = scriptObj.content;
                    const startLine = params.startLine;
                    const endLine = params.endLine;
                    if (startLine !== undefined || endLine !== undefined) {
                        const lines = contentToShow.split("\n");
                        const start = startLine !== undefined ? Math.max(1, startLine) : 1;
                        const end = endLine !== undefined ? Math.min(lines.length, endLine) : lines.length;
                        const slicedLines = lines.slice(start - 1, end);
                        contentToShow = slicedLines.join("\n");
                        observations.push(`- Tool "viewScript":\nName: ${scriptObj.name}\nLines: ${start} to ${end}\nContent:\n${contentToShow}`);
                    } else {
                        observations.push(`- Tool "viewScript":\nName: ${scriptObj.name}\nModified: ${new Date(scriptObj.modified).toISOString()}\nContent:\n${contentToShow}`);
                    }
                }
                continue;
            } else if (toolName === "editScript") {
                const sName = params.scriptName;
                const target = params.targetContent;
                const replacement = params.replacementContent;
                if (!sName || target === undefined || replacement === undefined) {
                    observations.push(`- Tool "editScript": Error - Missing scriptName, targetContent, or replacementContent.`);
                    continue;
                }
                const scriptObj = typeof findScriptByName === "function" ? findScriptByName(currentProjectPath, sName) : null;
                if (!scriptObj) {
                    observations.push(`- Tool "editScript": Error - Script "${sName}" not found.`);
                    continue;
                }
                const idx = scriptObj.content.indexOf(target);
                if (idx === -1) {
                    observations.push(`- Tool "editScript": Error - targetContent was not found in script "${sName}". Ensure targetContent matches exactly, including indentation and spacing.`);
                    continue;
                }
                if (scriptObj.content.indexOf(target, idx + 1) !== -1) {
                    observations.push(`- Tool "editScript": Error - targetContent is not unique in script "${sName}". Provide a larger block of code to ensure uniqueness.`);
                    continue;
                }
                const newContent = scriptObj.content.substring(0, idx) + replacement + scriptObj.content.substring(idx + target.length);
                const analysis = typeof analyzeExtendScript === "function" ? analyzeExtendScript(newContent) : { safe: true };
                if (!analysis.safe) {
                    observations.push(`- Tool "editScript": Blocked by static security analyzer. Reason: ${analysis.reason}`);
                    if (window._activeToolStatuses && window._activeToolStatuses[i]) {
                        window._activeToolStatuses[i].status = "blocked";
                        window._activeToolStatuses[i].reason = analysis.reason;
                    }
                    if (typeof window !== "undefined" && typeof window.updateToolCardStatusUI === "function") {
                        window.updateToolCardStatusUI(i, "blocked", analysis.reason);
                    }
                    continue;
                }
                createOrUpdateScript(currentProjectPath, sName, newContent);
                activeScriptName = sName;
                if (typeof renderScriptTabs === "function") {
                    renderScriptTabs();
                }
                const consoleOutput = document.getElementById("console-output");
                if (consoleOutput) {
                    consoleOutput.value = newContent;
                }

                if (params.execute) {
                    jsxCommand = wrapExtendScript(newContent);
                } else {
                    observations.push(`- Tool "editScript": Script "${sName}" edited successfully. New content:\n${newContent}`);
                    continue;
                }
            } else if (toolName === "executeScript") {
                const sName = params.scriptName;
                if (!sName) {
                    observations.push(`- Tool "executeScript": Error - Missing scriptName.`);
                    continue;
                }
                const scriptObj = typeof findScriptByName === "function" ? findScriptByName(currentProjectPath, sName) : null;
                if (!scriptObj) {
                    observations.push(`- Tool "executeScript": Error - Script "${sName}" not found.`);
                    continue;
                }
                const script = scriptObj.content;
                const analysis = typeof analyzeExtendScript === "function" ? analyzeExtendScript(script) : { safe: true };
                if (!analysis.safe) {
                    observations.push(`- Tool "executeScript": Blocked by static security analyzer. Reason: ${analysis.reason}`);
                    if (window._activeToolStatuses && window._activeToolStatuses[i]) {
                        window._activeToolStatuses[i].status = "blocked";
                        window._activeToolStatuses[i].reason = analysis.reason;
                    }
                    if (typeof window !== "undefined" && typeof window.updateToolCardStatusUI === "function") {
                        window.updateToolCardStatusUI(i, "blocked", analysis.reason);
                    }
                    continue;
                }
                activeScriptName = sName;
                if (typeof renderScriptTabs === "function") {
                    renderScriptTabs();
                }
                const consoleOutput = document.getElementById("console-output");
                if (consoleOutput) {
                    consoleOutput.value = script;
                }
                jsxCommand = wrapExtendScript(script);
            } else {
                throw new Error(`Unsupported tool name: ${toolName}`);
            }

            let result = await evalScriptAsync(jsxCommand);
            if ((toolName === "executeScript" || toolName === "createScript" || toolName === "editScript") && (!result || result.trim() === "")) {
                result = "Error: ExtendScript execution returned an empty response. This usually indicates a global syntax or compilation error in After Effects (e.g., unescaped newlines, unmatched brackets, or quote mismatches) that prevented the script from parsing/compiling.";
            } else if (toolName === "getLayerProperties" && result && result.length > 8000) {
                result = result.substring(0, 8000) + "\n... [TRUNCATED to prevent context window overflow. If you need a specific property group, please use getLayerProperties with a specific groupFilter parameter, e.g. \"Transform\" or \"Effects\"] ...";
            }
            observations.push(`- Tool "${toolName}": ${result}`);

            const trimmedResult = result ? result.trim().toLowerCase() : "";
            if (trimmedResult && (trimmedResult.indexOf("error:") === 0 || trimmedResult.indexOf("evalscript error") === 0)) {
                break;
            }
        }
    } catch (err) {
        observations.push(`- Tool execution exception: ${err.message}`);
    }

    return observations.join("\n");
}

function repairJSON(jsonStr) {
    let raw = jsonStr.trim();
    if (!raw) return null;

    let result = "";
    let structure = [];
    let inString = false;
    let escaping = false;
    let lastValidIndex = 0;

    for (let i = 0; i < raw.length; i++) {
        const char = raw[i];

        if (escaping) {
            result += char;
            escaping = false;
            continue;
        }

        if (char === '\\') {
            result += char;
            if (inString) {
                escaping = true;
            }
            continue;
        }

        if (char === '"') {
            result += char;
            inString = !inString;
            continue;
        }

        if (inString) {
            if (char === '\n') {
                result += '\\n';
            } else if (char === '\r') {
                // Ignore carriage return
            } else {
                result += char;
            }
        } else {
            // Outside of string literal: intercept trailing commas
            if (char === ',') {
                let nextNonWhitespaceIdx = -1;
                for (let k = i + 1; k < raw.length; k++) {
                    if (!/\s/.test(raw[k])) {
                        nextNonWhitespaceIdx = k;
                        break;
                    }
                }
                if (nextNonWhitespaceIdx !== -1 && (raw[nextNonWhitespaceIdx] === '}' || raw[nextNonWhitespaceIdx] === ']')) {
                    // Skip trailing comma
                    continue;
                }
            }

            result += char;
            if (char === '{' || char === '[') {
                structure.push(char);
            } else if (char === '}') {
                if (structure.length > 0 && structure[structure.length - 1] === '{') {
                    structure.pop();
                    if (structure.length === 0) {
                        lastValidIndex = result.length;
                    }
                }
            } else if (char === ']') {
                if (structure.length > 0 && structure[structure.length - 1] === '[') {
                    structure.pop();
                    if (structure.length === 0) {
                        lastValidIndex = result.length;
                    }
                }
            }
        }
    }

    let repaired = result;
    if (structure.length === 0) {
        if (lastValidIndex > 0) {
            repaired = result.substring(0, lastValidIndex);
        }
    } else {
        if (inString) {
            if (repaired.endsWith('\\')) {
                repaired = repaired.substring(0, repaired.length - 1);
            }
            repaired += '"';
        }

        repaired = repaired.trim();
        let lastCommaMatch = repaired.match(/,\s*$/);
        if (lastCommaMatch) {
            repaired = repaired.substring(0, lastCommaMatch.index);
        }

        while (structure.length > 0) {
            const openChar = structure.pop();
            if (openChar === '{') {
                repaired += '}';
            } else if (openChar === '[') {
                repaired += ']';
            }
        }
    }

    try {
        return JSON.parse(repaired);
    } catch (e) {
        return null;
    }
}



function pruneLargeWebObservations(historyArray) {
    if (!historyArray || !Array.isArray(historyArray)) return;
    for (let i = 0; i < historyArray.length; i++) {
        const msg = historyArray[i];
        if (msg && msg.role === "user" && msg.isIntermediate && typeof msg.content === "string") {
            if (msg.content.indexOf("- Tool \"webScrape\":") !== -1) {
                const marker = "- Tool \"webScrape\":";
                const idx = msg.content.indexOf(marker);
                const prefix = msg.content.substring(0, idx + marker.length);
                let url = "";
                const urlMatch = msg.content.match(/URL:\s*(https?:\/\/[^\s|\]]+)/i);
                if (urlMatch) {
                    url = urlMatch[1];
                }
                msg.content = `${prefix} [Web Scrape of ${url || "page"} (scraped text truncated to save context)]\n\nPlease analyze this result and proceed with your next planned steps.`;
            } else if (msg.content.indexOf("- Tool \"webSearch\":") !== -1) {
                const marker = "- Tool \"webSearch\":";
                const idx = msg.content.indexOf(marker);
                const prefix = msg.content.substring(0, idx + marker.length);
                msg.content = `${prefix} [Web Search Results (results list truncated to save context)]\n\nPlease analyze this result and proceed with your next planned steps.`;
            }
        }
    }
}

function pruneBase64Images(context, maxKeep) {
    if (!context) return;
    var maxToKeep = typeof maxKeep === "number" ? maxKeep : 2;
    var imageCount = 0;

    // Walk backwards from the newest message to the oldest
    for (var i = context.length - 1; i >= 0; i--) {
        var msg = context[i];
        if (msg && Array.isArray(msg.content)) {
            var newContent = [];
            // Walk backwards through content parts in this message to maintain chronology and reverse count
            for (var j = msg.content.length - 1; j >= 0; j--) {
                var part = msg.content[j];
                if (part) {
                    if (part.type === "image_url") {
                        imageCount++;
                        if (imageCount > maxToKeep) {
                            newContent.unshift({ type: "text", text: "[Obsolete Intermediate Frame Capture Stripped to Save Context]" });
                        } else {
                            newContent.unshift(part);
                        }
                    } else {
                        newContent.unshift(part);
                    }
                }
            }
            msg.content = newContent;
        }
    }
}

function estimateMessagesTokenCount(messagesArray) {
    if (!messagesArray || !Array.isArray(messagesArray)) return 0;
    let textForEstimation = "";
    let imageBlocksCount = 0;
    for (var i = 0; i < messagesArray.length; i++) {
        var msg = messagesArray[i];
        if (!msg) continue;
        if (typeof msg.content === "string") {
            textForEstimation += msg.content + "\n";
        } else if (Array.isArray(msg.content)) {
            for (var j = 0; j < msg.content.length; j++) {
                var part = msg.content[j];
                if (part) {
                    if (part.type === "text" && part.text) {
                        textForEstimation += part.text + "\n";
                    } else if (part.type === "image_url" || part.type === "inline_data") {
                        imageBlocksCount++;
                    }
                }
            }
        }
    }

    let estTokens = 0;
    if (typeof estimateTrueTokens === "function") {
        estTokens = estimateTrueTokens(textForEstimation);
    } else {
        estTokens = Math.ceil(textForEstimation.length / 3.8);
    }
    estTokens += imageBlocksCount * 1200;
    return estTokens;
}

async function pruneHistoryContexts(contextArray) {
    if (!contextArray) return [];

    // 1. Trigger memory condensation if the estimated token count exceeds 15000 tokens
    const maxThresholdTokens = 15000;
    if (estimateMessagesTokenCount(contextArray) > maxThresholdTokens) {
        // Keep at least the last 8 messages (4 turns) completely raw as active transactional context
        const rawTurnsCount = 8;
        if (contextArray.length > rawTurnsCount) {
            let cutIndex = contextArray.length - rawTurnsCount;
            // Adjust cutIndex so that the younger messages start with a 'user' message.
            // Walk backward to include slightly more raw messages if needed to start with a user message.
            while (cutIndex > 0 && contextArray[cutIndex].role !== "user") {
                cutIndex--;
            }

            // Retrieve the older turns to be compressed
            const olderMessages = contextArray.slice(0, cutIndex);
            const youngerMessages = contextArray.slice(cutIndex);

            // Collect and merge all older system compression summaries, filtering them out of raw messages to condense
            const existingSummaries = [];
            const messagesToCondense = olderMessages.filter(msg => {
                if (msg.role === "system" && msg.content.indexOf("[Condensed Session History:") === 0) {
                    existingSummaries.push(msg.content);
                    return false;
                }
                return true;
            });
            const existingSummaryText = existingSummaries.join("\n");

            if (messagesToCondense.length > 0) {
                try {
                    console.log("[ArcEditor] Initiating background memory condensation...");

                    // Deep clone and strip base64 payloads to save memory/tokens
                    const messagesClean = JSON.parse(JSON.stringify(messagesToCondense));
                    for (var i = 0; i < messagesClean.length; i++) {
                        var msg = messagesClean[i];
                        if (msg && Array.isArray(msg.content)) {
                            for (var j = 0; j < msg.content.length; j++) {
                                if (msg.content[j] && msg.content[j].type === "image_url") {
                                    msg.content[j] = { type: "text", text: "[Image Attachment (Base64 Payload Stripped for Condensation)]" };
                                }
                            }
                        }
                    }

                    // Formulate the condensation request prompt
                    const systemPrompt = "You are a memory compressor. Summarize the following video editing dialog history into a single-paragraph log of creative intents, assets added, and controller rigs configured. Keep it extremely concise (under 60 words). " +
                        (existingSummaryText ? "Incorporate this existing history summary: " + existingSummaryText : "") +
                        "\nDo NOT output any technical ExtendScript JSX code or observation JSON logs; summarize only the high-level accomplishments.";

                    const compressionMessages = [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: JSON.stringify(messagesClean) }
                    ];

                    // Call LLM API (non-streaming, direct response, skip system instructions)
                    const summaryText = await callLLMApi(compressionMessages, null, true);
                    const condensedBlock = {
                        role: "system",
                        content: `[Condensed Session History: ${summaryText.trim()}]`
                    };

                    // Reconstruct and return the chat history
                    const resultHistory = [condensedBlock, ...youngerMessages];
                    console.log("[ArcEditor] Background memory condensation completed successfully. New history size:", resultHistory.length);
                    return resultHistory;
                } catch (err) {
                    console.error("[ArcEditor] Background memory condensation failed:", err);
                    // Fallback to sliding window pruner if LLM call fails
                    return fallbackSlidingWindowPrune(contextArray);
                }
            }
        }
    }
    return contextArray;
}

function fallbackSlidingWindowPrune(contextArray) {
    if (!contextArray) return [];

    const maxTokens = 20000;
    if (estimateMessagesTokenCount(contextArray) <= maxTokens) {
        return contextArray;
    }

    const minKeep = Math.min(8, contextArray.length);
    const maxCut = contextArray.length - minKeep;

    let cutIndex = 0;
    while (cutIndex < maxCut) {
        if (estimateMessagesTokenCount(contextArray.slice(cutIndex)) <= maxTokens) {
            break;
        }
        cutIndex++;
    }

    // Adjust cutIndex so that the younger messages start with a 'user' message.
    // We can walk forward first (up to maxCut) to find a user message.
    while (cutIndex < maxCut && contextArray[cutIndex].role !== "user") {
        cutIndex++;
    }

    // If we pruned everything or kept too few, make sure we keep at least the last minKeep messages
    if (contextArray.length - cutIndex < minKeep) {
        // Fallback: just cut at maxCut, and adjust to the nearest user message by walking backward
        cutIndex = maxCut;
        while (cutIndex > 0 && contextArray[cutIndex].role !== "user") {
            cutIndex--;
        }
    }

    if (cutIndex < contextArray.length) {
        return contextArray.slice(cutIndex);
    }
    return contextArray;
}

function stripCodeBlocks(text) {
    if (!text) return "";
    return text.replace(/```[\s\S]*?(?:```|$)/g, "").trim();
}

function writeToDebugLog(category, text) {
    // Allow API Request, API Response, Tool Execution, and API Network Error categories in the debug log
    const ALLOWED_CATEGORIES = {
        "API Request Sent": true,
        "API Response Received": true,
        "Tool Calls Extracted": true,
        "Tool Execution": true,
        "Tool Execution Error": true,
        "API Network Error": true,
        "Turn Aborted": true
    };

    const catKey = Object.keys(ALLOWED_CATEGORIES).find(key => category.indexOf(key) === 0);
    if (!catKey) {
        return;
    }

    let loggedText = text;

    if (typeof includeBase64InDebugLog !== "undefined" && !includeBase64InDebugLog && typeof loggedText === "string") {
        // Replace base64 data URIs (escaped or unescaped)
        loggedText = loggedText.replace(/(\\*")data:image\/[^;]+;base64,[^"'\s\r\n\\]+(\\*")/g, '$1data:image/png;base64,[Base64 Image Data (Omitted)]$2');
        // Replace any raw base64 data URIs not inside quotes
        loggedText = loggedText.replace(/data:image\/[^;]+;base64,[^"'\s\r\n]+/g, 'data:image/png;base64,[Base64 Image Data (Omitted)]');
        // Replace any quoted base64 string (escaped or unescaped, > 1000 chars of base64-valid set) to prevent leaks in keys like data, images, etc.
        loggedText = loggedText.replace(/(\\*")[A-Za-z0-9+\/=\r\n_\-]{1000,}(\\*")/g, '$1[Base64 Image Data (Omitted)]$2');
    }

    const timestamp = new Date().toISOString();
    const divider = "\n\n" + "=".repeat(60) + "\n";
    const logEntry = `${divider}[${timestamp}] [${category.toUpperCase()}]\n${loggedText}\n`;

    // 1. Update UI Textarea
    const debugTextarea = document.getElementById("debug-output");
    if (debugTextarea) {
        debugTextarea.value += logEntry;
        debugTextarea.scrollTop = debugTextarea.scrollHeight; // auto-scroll to bottom
    }

    // 2. Append to persistent file in global appConfigDir
    if (typeof require !== "undefined" && appConfigDir) {
        try {
            const fs = require('fs');
            const path = require('path');
            const debugLogPath = path.join(appConfigDir, "arceditor_debug.log");
            fs.appendFile(debugLogPath, logEntry, 'utf8', (err) => {
                if (err) {
                    console.error("Failed to write to arceditor_debug.log asynchronously: ", err);
                }
            });
        } catch (e) {
            console.error("Failed to initiate write to arceditor_debug.log: ", e);
        }
    }
}

function stopAgentExecution() {
    isStopped = true;
    isExecuting = false;
    currentExecutionId++; // Increment to invalidate active loops

    if (typeof abortActiveRequests === "function") {
        abortActiveRequests();
    }

    // Clean up active AI bubble
    if (activeAiBubbleId) {
        const aiBubble = document.getElementById(activeAiBubbleId);
        if (aiBubble) {
            const contentDiv = aiBubble.querySelector(".message-content");
            if (contentDiv) {
                const loader = contentDiv.querySelector(".dots-loader");
                if (loader) {
                    loader.remove();
                }
                const activeTurn = contentDiv.querySelector(".active-turn-container") || contentDiv.querySelector(".active-turn-area");
                if (activeTurn && activeTurn.className === "active-turn-container") {
                    activeTurn.remove();
                }

                const completedTurnsGroup = contentDiv.querySelector(".completed-turns-group");
                if (completedTurnsGroup && completedTurnsGroup.hasAttribute("open")) {
                    if (typeof uiTransitionsEnabled !== "undefined" && !uiTransitionsEnabled) {
                        completedTurnsGroup.removeAttribute("open");
                    } else if (typeof window.collapseDetailsWithAnimation === "function") {
                        window.collapseDetailsWithAnimation(completedTurnsGroup);
                    } else {
                        completedTurnsGroup.removeAttribute("open");
                    }
                }

                const activeTurnArea = contentDiv.querySelector(".active-turn-area");
                if (activeTurnArea) {
                    if (activeTurnArea.innerHTML.indexOf("Execution stopped by user.") === -1) {
                        activeTurnArea.innerHTML += '<div style="margin-top:8px; font-size:11px; color:var(--text-warning); display:flex; align-items:center; gap:6px;">' +
                            '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></svg>' +
                            'Execution stopped by user.</div>';
                    }
                } else {
                    // Fallback to normal appending if not structured
                    if (contentDiv.innerHTML.indexOf("Execution stopped by user.") === -1) {
                        contentDiv.innerHTML += '<div style="margin-top:8px; font-size:11px; color:var(--text-warning); display:flex; align-items:center; gap:6px;">' +
                            '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></svg>' +
                            'Execution stopped by user.</div>';
                    }
                }
            }
        }
    }

    if (typeof setUIReadyState === "function") {
        setUIReadyState(true);
    }

    addSystemMessage("Execution stopped by user.");
}

function saveDetailsState(container) {
    const states = {};
    if (!container) return states;
    const details = container.querySelectorAll("details");
    for (let i = 0; i < details.length; i++) {
        const d = details[i];
        if (d.id) {
            states[d.id] = d.hasAttribute("open");
        }
    }
    return states;
}

function restoreDetailsState(container, states) {
    if (!container || !states) return;
    const details = container.querySelectorAll("details");
    for (let i = 0; i < details.length; i++) {
        const d = details[i];
        if (d.id && states[d.id] !== undefined) {
            if (states[d.id]) {
                d.setAttribute("open", "");
            } else {
                d.removeAttribute("open");
            }
        }
    }
}

window.updateToolCardStatusUI = function (toolIndex, status, reason = "") {
    const aiBubble = document.getElementById(activeAiBubbleId);
    if (!aiBubble) return;
    const toolCard = aiBubble.querySelector(`.tool-call-card[data-index="${toolIndex}"]`);
    if (!toolCard) return;

    toolCard.setAttribute("data-status", status);
    toolCard.classList.remove("status-pending", "status-allowed", "status-denied", "status-blocked");
    toolCard.classList.add(`status-${status}`);

    const badge = toolCard.querySelector(".tool-status-badge");
    if (badge) {
        badge.textContent = status;
        badge.className = `tool-status-badge status-${status}`;
    }

    if (status === "denied" && reason) {
        const body = toolCard.querySelector(".tool-call-body");
        if (body) {
            const existingReason = body.querySelector(".tool-denial-reason");
            if (existingReason) existingReason.remove();

            const reasonDiv = document.createElement("div");
            reasonDiv.className = "tool-denial-reason";
            reasonDiv.style.marginBottom = "6px";
            reasonDiv.style.padding = "4px 6px";
            reasonDiv.style.background = "rgba(255, 68, 68, 0.1)";
            reasonDiv.style.border = "1px solid rgba(255, 68, 68, 0.2)";
            reasonDiv.style.borderRadius = "var(--border-radius-sm)";
            reasonDiv.style.fontSize = "9.5px";
            reasonDiv.style.color = "var(--text-error)";
            reasonDiv.style.fontStyle = "italic";

            const strong = document.createElement("strong");
            strong.textContent = "Denial Reason: ";
            reasonDiv.appendChild(strong);
            reasonDiv.appendChild(document.createTextNode(reason));

            body.insertBefore(reasonDiv, body.firstChild);
        }
    }
};

function updateBubbleContent(aiBubble, html) {
    const content = aiBubble.querySelector(".message-content");
    if (!content) return;
    const detailsState = saveDetailsState(content);
    content.innerHTML = html;
    restoreDetailsState(content, detailsState);
}

function updateAiBubbleTurns(aiBubble, completedTurns, activeReasoningHtml, activeContentHtml, isExecutionCompleted = false) {
    const content = aiBubble.querySelector(".message-content");
    if (!content) return;

    let completedTurnsArea = content.querySelector(".completed-turns-area");
    let activeTurnArea = content.querySelector(".active-turn-area");

    // Fallback if not structured yet (e.g. initial rendering migration)
    if (!completedTurnsArea || !activeTurnArea) {
        content.innerHTML = '<div class="completed-turns-area"></div><div class="active-turn-area"></div>';
        completedTurnsArea = content.querySelector(".completed-turns-area");
        activeTurnArea = content.querySelector(".active-turn-area");
    }

    // Save the open details states of completed turns only, so user interaction is preserved!
    const completedTurnStates = saveDetailsState(completedTurnsArea);

    const openTurnNums = [];
    for (const key in completedTurnStates) {
        if (completedTurnStates[key]) {
            const m = key.match(/details-turn-(?:.*-)?(\d+)$/);
            if (m) {
                openTurnNums.push(parseInt(m[1], 10));
            }
        }
    }

    const bubbleId = aiBubble.id;
    const activeTurnHasContent = !!(
        (activeReasoningHtml && activeReasoningHtml.indexOf("reasoning-content") !== -1) ||
        (activeContentHtml && activeContentHtml.indexOf("dots-loader") === -1 && activeContentHtml.trim() !== "")
    );
    const currentCompletedHtml = renderTurnsHtml(completedTurns, openTurnNums, bubbleId, activeTurnHasContent);

    const renderedTurnsCount = completedTurnsArea.querySelectorAll(".agent-turn-details").length;
    if (renderedTurnsCount !== completedTurns.length) {
        completedTurnsArea.innerHTML = currentCompletedHtml;
        restoreDetailsState(completedTurnsArea, completedTurnStates);
    }

    // Collapse the previous completed turn in the DOM only once as soon as the active turn starts streaming content
    if (activeTurnHasContent && completedTurns.length > 0) {
        const lastTurnNum = completedTurns[completedTurns.length - 1].turnNum;
        if (aiBubble._lastCollapsedTurnNum !== lastTurnNum) {
            const lastTurnDetails = completedTurnsArea.querySelector(`#details-turn-${bubbleId}-${lastTurnNum}`);
            if (lastTurnDetails && lastTurnDetails.hasAttribute("open")) {
                if (typeof uiTransitionsEnabled !== "undefined" && !uiTransitionsEnabled) {
                    lastTurnDetails.removeAttribute("open");
                } else if (typeof window.collapseDetailsWithAnimation === "function") {
                    window.collapseDetailsWithAnimation(lastTurnDetails);
                } else {
                    lastTurnDetails.removeAttribute("open");
                }
            }
            aiBubble._lastCollapsedTurnNum = lastTurnNum;
        }
    }

    if (isExecutionCompleted) {
        const completedTurnsGroup = completedTurnsArea.querySelector(".completed-turns-group");
        if (completedTurnsGroup && completedTurnsGroup.hasAttribute("open")) {
            if (typeof uiTransitionsEnabled !== "undefined" && !uiTransitionsEnabled) {
                completedTurnsGroup.removeAttribute("open");
            } else if (typeof window.collapseDetailsWithAnimation === "function") {
                window.collapseDetailsWithAnimation(completedTurnsGroup);
            } else {
                completedTurnsGroup.removeAttribute("open");
            }
        }
    }

    // Initialize active-turn sub-containers if they don't exist yet
    let activeTurnContainer = activeTurnArea.querySelector(".active-turn-container");
    if (!activeTurnContainer) {
        activeTurnArea.innerHTML = '<div class="active-turn-container"><div class="active-reasoning-area"></div><div class="active-content-area"></div></div>';
        activeTurnContainer = activeTurnArea.querySelector(".active-turn-container");
    }

    let activeReasoningArea = activeTurnContainer.querySelector(".active-reasoning-area");
    let activeContentArea = activeTurnContainer.querySelector(".active-content-area");

    // Support fallback if only 3 arguments are passed (treat activeReasoningHtml as the single active html)
    if (activeContentHtml === undefined) {
        activeTurnArea.innerHTML = activeReasoningHtml;
        return;
    }

    // Update active reasoning only if it changed (by modifying only sub-elements to preserve details element reference)
    if (activeReasoningHtml) {
        let activeReasoningDetails = activeReasoningArea.querySelector(".reasoning-details");
        if (!activeReasoningDetails) {
            activeReasoningArea.innerHTML = activeReasoningHtml;
        } else {
            const tempDiv = document.createElement("div");
            tempDiv.innerHTML = activeReasoningHtml;

            const newContent = tempDiv.querySelector(".reasoning-content");
            const contentDiv = activeReasoningDetails.querySelector(".reasoning-content");
            if (contentDiv && newContent && contentDiv.innerHTML !== newContent.innerHTML) {
                contentDiv.innerHTML = newContent.innerHTML;
            }

            const summary = activeReasoningDetails.querySelector("summary");
            const newSummary = tempDiv.querySelector("summary");
            if (summary && newSummary && summary.innerHTML !== newSummary.innerHTML) {
                summary.innerHTML = newSummary.innerHTML;
            }
        }
    } else {
        activeReasoningArea.innerHTML = "";
    }

    // Update active content only if it changed
    if (activeContentHtml !== undefined && activeContentHtml !== null) {
        const contentStates = saveDetailsState(activeContentArea);
        if (activeContentArea.innerHTML !== activeContentHtml) {
            activeContentArea.innerHTML = activeContentHtml;
            restoreDetailsState(activeContentArea, contentStates);
        }
    } else {
        activeContentArea.innerHTML = "";
    }
}
