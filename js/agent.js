/**
 * ArcEditor Agent Orchestrator Module
 * Manages the high-level system context instructions, structured tool call routing,
 * the automated ReAct self-correction execution loop, and custom markdown paragraph parser.
 */
let capturedFrameDataDuringLoop = null;



async function runAgenticExecutionLoop(userText) {
    isStopped = false;
    currentExecutionId++;
    const executionId = currentExecutionId;

    try {
        let visualFrameInputs = [...attachedFrames];

        // Reset attachments
        clearAttachmentDock();

        if (visualFrameInputs && visualFrameInputs.length > 0) {
            const contentParts = [{ type: "text", text: userText }];
            visualFrameInputs.forEach(img => {
                contentParts.push({ type: "image_url", image_url: { url: `data:image/png;base64,${img}` } });
            });
            chatHistory.push({
                role: "user",
                content: contentParts
            });
        } else {
            chatHistory.push({ role: "user", content: userText });
        }

        // DECOUPLED CONTEXT FOR LLM (keeps visual history completely raw and unpruned)
        let activeContext = JSON.parse(JSON.stringify(chatHistory));
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
        const maxRetries = 3;
        let toolTurns = 0;
        const maxToolTurns = typeof maxToolRetryLimit !== "undefined" ? maxToolRetryLimit : 15;
        let finalLlmResponse = "";
        const executedActions = [];
        const completedTurns = [];
        let stateModifiedSinceLastCapture = false;

        while (!isCompleted && loopRetries < maxRetries && toolTurns < maxToolTurns) {
            if (executionId !== currentExecutionId || isStopped) {
                isCompleted = true;
                break;
            }
            try {
                pruneBase64Images(activeContext, 2); // Prune old base64 images to keep a sliding window of the last 2 captures

                // Reset reasoning toggled flag for each new LLM generation turn
                window._userToggledReasoning = false;
                window._userReasoningState = false;

                const llmResponse = await callLLMApi(activeContext, (chunkText) => {
                    if (executionId !== currentExecutionId || isStopped) return;
                    const openTurnNums = getOpenTurnNums(aiBubble);
                    aiBubble.querySelector(".message-content").innerHTML = renderTurnsHtml(completedTurns, openTurnNums) +
                        `<div class="active-turn-container">` +
                        formatMarkdown(chunkText) +
                        `</div>`;

                    // Restore user's manual expand/collapse state if they interacted with it
                    if (window._userToggledReasoning) {
                        const newDetails = aiBubble.querySelector(".active-turn-container .reasoning-details");
                        if (newDetails) {
                            if (window._userReasoningState) {
                                newDetails.setAttribute("open", "");
                            } else {
                                newDetails.removeAttribute("open");
                            }
                        }
                    }

                    aiBubble.setAttribute("data-raw-text", chunkText);
                    if (typeof scrollToBottom === "function") scrollToBottom();
                });
                if (executionId !== currentExecutionId || isStopped) {
                    isCompleted = true;
                    break;
                }
                aiBubble.setAttribute("data-raw-text", llmResponse);
                const assistantMsg = { role: "assistant", content: llmResponse };
                activeContext.push(assistantMsg);
                finalLlmResponse = llmResponse;

                writeToDebugLog("LLM Raw Response", llmResponse);

                // Check for JSON tool calls only (ExtendScript is executed via the executeExtendScript tool)
                const jsonBlock = extractJSONToolCalls(llmResponse);

                if (jsonBlock) {
                    try {
                        const parsed = JSON.parse(jsonBlock);
                        const toolCalls = Array.isArray(parsed) ? parsed : [parsed];
                        let containsModifying = false;
                        let containsCapture = false;
                        for (let tIdx = 0; tIdx < toolCalls.length; tIdx++) {
                            const tc = toolCalls[tIdx];
                            if (tc && tc.tool) {
                                const isReadOnly = [
                                    "captureActiveFrame",
                                    "captureCompositionSequence",
                                    "getTimelineContext",
                                    "getInstalledEffects",
                                    "searchInstalledEffects",
                                    "getLayerProperties",
                                    "selectLayers",
                                    "switchComposition",
                                    "setPlayheadTime",
                                    "undoLastAction"
                                ].indexOf(tc.tool) !== -1;
                                if (!isReadOnly) {
                                    containsModifying = true;
                                }
                                if (tc.tool === "captureActiveFrame" || tc.tool === "captureCompositionSequence") {
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
                    const significantJson = getSignificantJsonActionKey(jsonBlock);
                    const actionKey = significantJson ? `json:${significantJson}` : "";
                    if (actionKey) {
                        if (executedActions.indexOf(actionKey) !== -1) {
                            console.warn("[ArcEditor] Loop detected! Agent is repeating identical actions:", actionKey);
                            const openTurnNums = getOpenTurnNums(aiBubble);
                            aiBubble.querySelector(".message-content").innerHTML = renderTurnsHtml(completedTurns, openTurnNums) + formatMarkdown(llmResponse) +
                                `<div style="margin-top:8px; font-size:11px; color:var(--text-error);">⚠ Execution loop detected (agent repeated identical actions). Terminating to prevent quota burn.</div>`;
                            if (typeof scrollToBottom === "function") scrollToBottom();
                            isCompleted = true;
                            break;
                        }
                        executedActions.push(actionKey);
                    }
                }
                chatHistory.push(JSON.parse(JSON.stringify(assistantMsg)));

                var observations = "";
                var executedAnything = false;
                var scriptFailed = false;

                if (jsonBlock) {
                    executedAnything = true;
                    toolTurns++;
                    updateConsolePane(jsonBlock);
                    const openTurnNums = getOpenTurnNums(aiBubble);
                    aiBubble.querySelector(".message-content").innerHTML = renderTurnsHtml(completedTurns, openTurnNums) +
                        `<div class="active-turn-container">` +
                        formatMarkdown(llmResponse) +
                        `<div style="margin-top:8px; font-size:11px; color:var(--text-accent); display:flex; align-items:center; gap:6px;"><div class="dots-loader"><span></span><span></span><span></span></div> Executing Agent Tool Calls...</div>` +
                        `</div>`;
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

                    if (toolObservations.toLowerCase().indexOf("error:") !== -1 || toolObservations.toLowerCase().indexOf("evalscript error") !== -1 || toolObservations.indexOf("Unsupported tool name:") !== -1) {
                        scriptFailed = true;
                        loopRetries++;

                        // Package failed turn
                        completedTurns.push({
                            type: "failed",
                            turnNum: completedTurns.length + 1,
                            turnTitle: "Tool execution failed (Retrying...)",
                            llmResponse: llmResponse,
                            observations: toolObservations
                        });

                        const openTurnNums = getOpenTurnNums(aiBubble);
                        aiBubble.querySelector(".message-content").innerHTML = renderTurnsHtml(completedTurns, openTurnNums) +
                            `<div style="margin-top:8px; font-size:11px; color:var(--text-error); display:flex; align-items:center; gap:6px;"><div class="dots-loader"><span></span><span></span><span></span></div> Tool error detected. Initiating self-correction... (Attempt ${loopRetries}/${maxRetries})</div>`;
                        if (typeof scrollToBottom === "function") scrollToBottom();

                        // Push error feedback to local context history and master history
                        const errFeedbackMsg = {
                            role: "user",
                            content: `System execution failed with error: "${toolObservations}". Please analyze the After Effects error, correct the syntax or API mismatch, and output a complete revised JSON tool call.`,
                            isIntermediate: true
                        };
                        activeContext.push(errFeedbackMsg);
                        chatHistory.push(JSON.parse(JSON.stringify(errFeedbackMsg)));

                        // Don't send the base64 image again to save bandwidth
                        visualFrameInputs = null;
                    } else {
                        observations += (observations ? "\n" : "") + `Tool execution observation:\n${toolObservations}`;
                    }
                }

                if (executedAnything) {
                    if (scriptFailed) {
                        continue; // Skip rest of execution and let loop retry self-correction
                    }

                    // Append observations to local context history and master history (handling multi-modal visual observations!)
                    let turnImages = null;
                    if (capturedFrameDataDuringLoop) {
                        turnImages = capturedFrameDataDuringLoop;
                        const contentParts = [
                            { type: "text", text: `Observation:\n${observations}\n\nPlease analyze the visual state of the composition and proceed with your next planned steps.` }
                        ];
                        if (Array.isArray(capturedFrameDataDuringLoop)) {
                            capturedFrameDataDuringLoop.forEach(img => {
                                contentParts.push({ type: "image_url", image_url: { url: `data:image/png;base64,${img}` } });
                            });
                        } else {
                            contentParts.push({ type: "image_url", image_url: { url: `data:image/png;base64,${capturedFrameDataDuringLoop}` } });
                        }
                        const obsMsg = {
                            role: "user",
                            content: contentParts,
                            isIntermediate: true
                        };
                        activeContext.push(obsMsg);
                        chatHistory.push(JSON.parse(JSON.stringify(obsMsg)));
                        capturedFrameDataDuringLoop = null; // Reset for next potential capture
                    } else {
                        const obsMsg = {
                            role: "user",
                            content: `Observation:\n${observations}\n\nPlease analyze this result and proceed with your next planned steps.`,
                            isIntermediate: true
                        };
                        activeContext.push(obsMsg);
                        chatHistory.push(JSON.parse(JSON.stringify(obsMsg)));
                    }

                    // Package successful turn
                    let turnTitle = "Analyzing composition context";
                    if (jsonBlock) {
                        if (jsonBlock.indexOf("executeExtendScript") !== -1) {
                            turnTitle = "Executing timeline automation script";
                        } else {
                            try {
                                const parsed = JSON.parse(jsonBlock);
                                const tools = (Array.isArray(parsed) ? parsed : [parsed]).map(t => t.tool).join(", ");
                                turnTitle = `Running tool: ${tools}`;
                            } catch (e) {
                                turnTitle = "Running agent tool calls";
                            }
                        }
                    }

                    completedTurns.push({
                        type: "success",
                        turnNum: completedTurns.length + 1,
                        turnTitle: turnTitle,
                        llmResponse: llmResponse,
                        observations: observations,
                        images: turnImages
                    });

                    // Show feedback in UI and prepare next turn
                    const isNextTurnAllowed = (loopRetries < maxRetries && toolTurns < maxToolTurns);
                    const openTurnNums = getOpenTurnNums(aiBubble);
                    aiBubble.querySelector(".message-content").innerHTML = renderTurnsHtml(completedTurns, openTurnNums) +
                        (isNextTurnAllowed ? `<div style="margin-top:8px; font-size:11px; color:var(--text-accent); display:flex; align-items:center; gap:6px;"><div class="dots-loader"><span></span><span></span><span></span></div> Agent planning next step...</div>` : "");
                    if (typeof scrollToBottom === "function") scrollToBottom();

                    continue; // Run next loop turn immediately
                } else {
                    // LLM replied without code blocks (informational answer)
                    if (stateModifiedSinceLastCapture) {
                        writeToDebugLog("Auto-Verification Intercept", "State was modified but no frame was captured. Automatically capturing active frame for validation...");

                        // 1. Show feedback in UI that verification is in progress
                        const openTurnNums = getOpenTurnNums(aiBubble);
                        aiBubble.querySelector(".message-content").innerHTML = renderTurnsHtml(completedTurns, openTurnNums) +
                            `<div class="active-turn-container">` +
                            formatMarkdown(llmResponse) +
                            `<div style="margin-top:8px; font-size:11px; color:var(--text-accent); display:flex; align-items:center; gap:6px;"><div class="dots-loader"><span></span><span></span><span></span></div> Verifying timeline canvas changes...</div>` +
                            `</div>`;
                        if (typeof scrollToBottom === "function") scrollToBottom();

                        // 2. Perform the frame capture
                        const base64Data = await captureCompositionFrame(true);
                        if (base64Data) {
                            capturedFrameDataDuringLoop = base64Data;
                            stateModifiedSinceLastCapture = false; // Reset the flag since we've now provided a capture

                            // 3. Inject the observation message with the image to prompt the LLM
                            const contentParts = [
                                { type: "text", text: `[System Verification Observation]: You have modified the composition but did not request a visual capture to inspect your changes. The system has automatically captured the active frame. Please analyze this attached canvas frame to visually verify that all layout coordinates, typography styles, shape sizes, colors, and blend modes are perfectly aligned and correct.\n\n- If everything looks correct: please summarize your changes and finalize your response to the user.\n- If you spot any layout bugs, rendering defects, or alignment issues: execute a corrected ExtendScript to fix them before finalizing.` }
                            ];
                            contentParts.push({ type: "image_url", image_url: { url: `data:image/png;base64,${base64Data}` } });

                            const obsMsg = {
                                role: "user",
                                content: contentParts,
                                isIntermediate: true
                            };
                            activeContext.push(obsMsg);
                            chatHistory.push(JSON.parse(JSON.stringify(obsMsg)));

                            // Add a successful verification turn to completedTurns
                            completedTurns.push({
                                type: "success",
                                turnNum: completedTurns.length + 1,
                                turnTitle: "Visual verification frame captured",
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

                    isCompleted = true;
                    const openTurnNums = getOpenTurnNums(aiBubble);
                    aiBubble.querySelector(".message-content").innerHTML = renderTurnsHtml(completedTurns, openTurnNums) + formatMarkdown(llmResponse);
                    if (typeof scrollToBottom === "function") scrollToBottom();
                    writeToDebugLog("Informational Response Completed", llmResponse);
                }

            } catch (err) {
                console.error("Loop iteration failed:", err);
                aiBubble.querySelector(".message-content").innerHTML = `<p style="color:var(--text-error);">Error executing loop: ${err.message}</p>`;
                if (typeof scrollToBottom === "function") scrollToBottom();
                isCompleted = true;
            }
        }

        if (executionId !== currentExecutionId) {
            // Obsolete thread, exit silently
            return;
        }

        if (isStopped) {
            const openTurnNums = getOpenTurnNums(aiBubble);
            aiBubble.querySelector(".message-content").innerHTML = renderTurnsHtml(completedTurns, openTurnNums) +
                `<div style="margin-top:8px; font-size:11px; color:var(--text-warning); display:flex; align-items:center; gap:6px;">` +
                `<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>` +
                `Execution stopped by user.</div>`;
            if (typeof scrollToBottom === "function") scrollToBottom();
        } else {
            if (loopRetries >= maxRetries) {
                const openTurnNums = getOpenTurnNums(aiBubble);
                aiBubble.querySelector(".message-content").innerHTML = renderTurnsHtml(completedTurns, openTurnNums) +
                    `<div style="margin-top:8px; font-size:11px; color:var(--text-error);">⚠ Max correction attempts reached. Check the JSX Console tab for syntax logs.</div>`;
                if (typeof scrollToBottom === "function") scrollToBottom();
            }
            if (toolTurns >= maxToolTurns && !isCompleted) {
                const openTurnNums = getOpenTurnNums(aiBubble);
                aiBubble.querySelector(".message-content").innerHTML = renderTurnsHtml(completedTurns, openTurnNums) +
                    `<div style="margin-top:8px; font-size:11px; color:var(--text-error);">⚠ Max agent tool turns reached to prevent looping.</div>`;
                if (typeof scrollToBottom === "function") scrollToBottom();
            }
        }

        // Set the intermediateTurns property on the last assistant message in history, and remove isIntermediate if failed or stopped
        const lastAssistantMsg = chatHistory.filter(m => m.role === "assistant").pop();
        if (lastAssistantMsg) {
            lastAssistantMsg.intermediateTurns = completedTurns;
            delete lastAssistantMsg.intermediateTurnsHtml;
            if (isStopped || loopRetries >= maxRetries || (toolTurns >= maxToolTurns && !isCompleted)) {
                delete lastAssistantMsg.isIntermediate;
            }
        }

        // Update persistent history size information
        updateCurrentSessionHistory();
        updateContextSizeInfo();

        // Trigger memory condensation asynchronously in the background so the user does not wait
        setTimeout(async () => {
            try {
                const condensedContext = await pruneHistoryContexts(chatHistory);
                if (condensedContext && condensedContext.length < chatHistory.length) {
                    chatHistory = condensedContext;
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
        if (executionId === currentExecutionId) {
            isExecuting = false;
            attachedFrames = [];
            if (typeof updateContextSizeInfo === "function") {
                updateContextSizeInfo();
            }
            if (typeof setUIReadyState === "function") {
                setUIReadyState(true);
            }
        }
    }
}

function extractJSXCode(text) {
    if (!text) return null;
    const parts = text.split("```");
    // If the last block is unclosed (even number of parts), ignore it to prevent executing truncated code that deadlocks AE
    const limit = parts.length % 2 === 0 ? parts.length - 1 : parts.length;
    for (let i = 1; i < limit; i += 2) {
        let block = parts[i];
        let lines = block.split("\n");
        if (lines.length > 0) {
            const lang = lines[0].trim().toLowerCase();
            if (lang === "json") {
                continue;
            }
            if (lang === "javascript" || lang === "js" || lang === "extendscript" || lang === "jsx" || lang === "") {
                const code = lines.slice(1).join("\n").trim();
                if (code) {
                    return code;
                }
            } else {
                const nonJsLangs = ["python", "py", "html", "css", "bash", "sh", "txt", "markdown", "md"];
                if (nonJsLangs.indexOf(lang) === -1) {
                    const code = block.trim();
                    if (code) {
                        if (code.startsWith("{") && code.endsWith("}")) {
                            try {
                                JSON.parse(code);
                                continue;
                            } catch (e) { }
                        }
                        return code;
                    }
                }
            }
        }
    }
    return null;
}

function extractJSONToolCalls(text) {
    if (!text) return null;
    const parts = text.split("```");
    // If the last block is unclosed (even number of parts), ignore it to prevent parsing truncated JSON
    const limit = parts.length % 2 === 0 ? parts.length - 1 : parts.length;
    for (let i = 1; i < limit; i += 2) {
        let block = parts[i];
        let lines = block.split("\n");
        if (lines.length > 0) {
            const lang = lines[0].trim().toLowerCase();
            if (lang === "json") {
                const code = lines.slice(1).join("\n").trim();
                if (code) {
                    return code;
                }
            }
        }
    }
    return null;
}

function getSignificantJsonActionKey(jsonStr) {
    if (!jsonStr) return "";
    try {
        const parsed = JSON.parse(jsonStr);
        const toolCalls = Array.isArray(parsed) ? parsed : [parsed];
        const stateModifying = toolCalls.filter(tc => {
            const toolName = tc.tool;
            const isReadOnly = [
                "captureActiveFrame",
                "captureCompositionSequence",
                "getTimelineContext",
                "getInstalledEffects",
                "searchInstalledEffects",
                "getLayerProperties",
                "selectLayers",
                "switchComposition",
                "setPlayheadTime"
            ].indexOf(toolName) !== -1;
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
        const parsed = JSON.parse(jsonStr);
        toolCalls = Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
        return `Error parsing JSON tool calls: ${e.message}. Ensure your JSON blocks are strictly valid.`;
    }

    let observations = [];
    let undoGroupActive = false;

    try {
        for (let i = 0; i < toolCalls.length; i++) {
            if (typeof isStopped !== "undefined" && isStopped) {
                observations.push(`- Tool execution aborted: Stopped by user.`);
                break;
            }
            const tc = toolCalls[i];
            const toolName = tc.tool;
            const params = tc.parameters || {};
            const ref = params.layerRef !== undefined ? params.layerRef : params.layerIndex;
            const serializedRef = typeof ref === "string" ? `"${ref.replace(/"/g, '\\"')}"` : (ref !== undefined ? ref : 'null');

            // Centralized classification: determine if the tool modifies the AE comp state
            const isReadOnly = [
                "captureActiveFrame",
                "captureCompositionSequence",
                "getTimelineContext",
                "getInstalledEffects",
                "searchInstalledEffects",
                "getLayerProperties",
                "selectLayers",
                "switchComposition",
                "setPlayheadTime",
                "undoLastAction"
            ].indexOf(toolName) !== -1;

            // Lazily open the AE Undo Group only for state-modifying tools
            if (!isReadOnly && !undoGroupActive) {
                await evalScriptAsync(`app.beginUndoGroup("ArcEditor Agent Tools")`);
                undoGroupActive = true;
            }

            let jsxCommand = "";
            if (toolName === "getTimelineContext") {
                const timelineData = await getTimelineContext();
                observations.push(`- Tool "getTimelineContext": ${JSON.stringify(timelineData)}`);
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
            } else if (toolName === "captureActiveFrame") {
                const base64Data = await captureCompositionFrame(true);
                if (base64Data) {
                    observations.push(`- Tool "captureActiveFrame": Success: Active frame successfully captured and visually attached.`);
                    capturedFrameDataDuringLoop = base64Data;
                } else {
                    observations.push(`- Tool "captureActiveFrame": Error: Failed to capture active frame preview.`);
                }
                continue;
            } else if (toolName === "captureCompositionSequence") {
                const base64List = await captureCompositionSequence(params.startTime, params.endTime, params.numFrames, true);
                if (base64List && base64List.length > 0) {
                    observations.push(`- Tool "captureCompositionSequence": Success: Captured and visually attached a sequence of ${base64List.length} frames.`);
                    capturedFrameDataDuringLoop = base64List;
                } else {
                    observations.push(`- Tool "captureCompositionSequence": Error: Failed to capture composition sequence.`);
                }
                continue;
            } else if (toolName === "undoLastAction") {
                if (undoGroupActive) {
                    await evalScriptAsync(`app.endUndoGroup()`);
                    undoGroupActive = false;
                }
                await evalScriptAsync("app.executeCommand(16)");
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
            } else if (toolName === "executeExtendScript") {
                const script = params.script;
                jsxCommand = `(function() {
                    var ArcEditor = $._com_arceditor_ ? $._com_arceditor_.ArcEditor : null;
                    var ArcJSON = $._com_arceditor_ ? $._com_arceditor_.ArcJSON : null;
                    var ArcInspector = $._com_arceditor_ ? $._com_arceditor_.ArcInspector : null;
                    var ArcCanvas = $._com_arceditor_ ? $._com_arceditor_.ArcCanvas : null;
                    var JSON = ArcJSON;
                    app.beginUndoGroup("ArcEditor Action");
                    var _arcEditorTempFolder;
                    try {
                        _arcEditorTempFolder = app.project.items.addFolder("ArcEditorTemp");
                        if (_arcEditorTempFolder) _arcEditorTempFolder.remove();
                    } catch (dummyErr) {}
                    try {
                        ${script}
                        app.endUndoGroup();
                        return "Success";
                    } catch (err) {
                        app.endUndoGroup();
                        try {
                            app.executeCommand(16); // Auto-rollback on script failure!
                        } catch (e) {}
                        return "Error: " + err.toString() + (err.line ? " (line " + err.line + ")" : "");
                    }
                })()`;
            } else {
                throw new Error(`Unsupported tool name: ${toolName}`);
            }

            let result = await evalScriptAsync(jsxCommand);
            if (toolName === "executeExtendScript" && (!result || result.trim() === "")) {
                result = "Error: ExtendScript execution returned an empty response. This usually indicates a global syntax or compilation error in After Effects (e.g., unescaped newlines, unmatched brackets, or quote mismatches) that prevented the script from parsing/compiling.";
            }
            observations.push(`- Tool "${toolName}": ${result}`);

            if (result && (result.toLowerCase().indexOf("error:") === 0 || result.toLowerCase().indexOf("evalscript error") === 0)) {
                break;
            }
        }
        if (undoGroupActive) {
            await evalScriptAsync(`app.endUndoGroup()`);
        }
    } catch (err) {
        if (undoGroupActive) {
            try {
                await evalScriptAsync(`app.endUndoGroup()`);
            } catch (e) { }
        }
        observations.push(`- Tool execution exception: ${err.message}`);
    }

    return observations.join("\n");
}

function repairJSON(jsonStr) {
    let repaired = jsonStr.trim();
    if (!repaired) return null;

    // Remove any trailing commas or commas followed by space at the end
    repaired = repaired.replace(/,\s*$/g, '');
    repaired = repaired.replace(/,\s*([}\]])/g, '$1');

    let structure = [];
    let inString = false;
    let escaping = false;
    let lastValidIndex = repaired.length;

    for (let i = 0; i < repaired.length; i++) {
        const char = repaired[i];
        if (escaping) {
            escaping = false;
            continue;
        }
        if (char === '\\') {
            escaping = true;
            continue;
        }
        if (char === '"') {
            inString = !inString;
            continue;
        }
        if (!inString) {
            if (char === '{' || char === '[') {
                structure.push(char);
            } else if (char === '}') {
                if (structure.length > 0 && structure[structure.length - 1] === '{') {
                    structure.pop();
                    if (structure.length === 0) {
                        lastValidIndex = i + 1;
                    }
                }
            } else if (char === ']') {
                if (structure.length > 0 && structure[structure.length - 1] === '[') {
                    structure.pop();
                    if (structure.length === 0) {
                        lastValidIndex = i + 1;
                    }
                }
            }
        }
    }

    if (structure.length === 0) {
        repaired = repaired.substring(0, lastValidIndex);
    } else {
        if (inString) {
            if (escaping) {
                repaired = repaired.substring(0, repaired.length - 1);
            }
            repaired += '"';
        }

        repaired = repaired.trim().replace(/,\s*$/g, '');

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



function pruneBase64Images(context, maxKeep) {
    if (!context) return;
    var maxToKeep = typeof maxKeep === "number" ? maxKeep : 2;
    var imageMessageIndices = [];
    for (var i = 0; i < context.length; i++) {
        var msg = context[i];
        if (msg && Array.isArray(msg.content)) {
            var hasImage = false;
            for (var j = 0; j < msg.content.length; j++) {
                if (msg.content[j] && msg.content[j].type === "image_url") {
                    hasImage = true;
                    break;
                }
            }
            if (hasImage) {
                imageMessageIndices.push(i);
            }
        }
    }
    if (imageMessageIndices.length > maxToKeep) {
        var toStripCount = imageMessageIndices.length - maxToKeep;
        for (var k = 0; k < toStripCount; k++) {
            var msgIndex = imageMessageIndices[k];
            var msg = context[msgIndex];
            if (msg && Array.isArray(msg.content)) {
                var newContent = [];
                for (var j = 0; j < msg.content.length; j++) {
                    var part = msg.content[j];
                    if (part && part.type === "text") {
                        newContent.push(part);
                    } else if (part && part.type === "image_url") {
                        newContent.push({ type: "text", text: "[Obsolete Intermediate Frame Capture Stripped to Save Context]" });
                    }
                }
                msg.content = newContent;
            }
        }
    }
}

async function pruneHistoryContexts(contextArray) {
    if (!contextArray) return [];

    // 1. If history length is greater than 10 messages (5 turns), trigger memory condensation
    const maxThreshold = 10;
    if (contextArray.length > maxThreshold) {
        // Keep the last 6 messages (3 turns) completely raw as active transactional context
        const rawTurnsCount = 6;
        const cutIndex = contextArray.length - rawTurnsCount;

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
    return contextArray;
}

function fallbackSlidingWindowPrune(contextArray) {
    if (!contextArray) return [];
    const maxHistoryMessages = 12;
    if (contextArray.length > maxHistoryMessages) {
        let cutIndex = contextArray.length - maxHistoryMessages;
        while (cutIndex < contextArray.length && contextArray[cutIndex].role !== "user") {
            cutIndex++;
        }
        if (cutIndex < contextArray.length) {
            return contextArray.slice(cutIndex);
        }
    }
    return contextArray;
}

function stripCodeBlocks(text) {
    if (!text) return "";
    return text.replace(/```[\s\S]*?(?:```|$)/g, "").trim();
}

function writeToDebugLog(category, text) {
    // Only allow API Request and API Response categories in the debug log
    const isRequest = category.indexOf("API Request Sent") === 0;
    const isResponse = category.indexOf("API Response Received") === 0;
    if (!isRequest && !isResponse) {
        return;
    }

    let loggedText = text;

    if (isResponse) {
        // Only keep reasoning and text blocks of the response, strip code blocks
        loggedText = stripCodeBlocks(loggedText);
    }

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

    // 2. Append to persistent file in workspace if active
    if (typeof require !== "undefined" && currentProjectPath && currentProjectPath !== "Unsaved Project") {
        try {
            const fs = require('fs');
            const path = require('path');
            const lastSeparator = Math.max(currentProjectPath.lastIndexOf('/'), currentProjectPath.lastIndexOf('\\'));
            const projectDir = currentProjectPath.substring(0, lastSeparator);
            const debugLogPath = path.join(projectDir, "arceditor_debug.log");
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
                const activeTurn = contentDiv.querySelector(".active-turn-container");
                if (activeTurn) {
                    activeTurn.remove();
                }

                // If not already ended with a stopped message, append one
                if (contentDiv.innerHTML.indexOf("Execution stopped by user.") === -1) {
                    contentDiv.innerHTML += '<div style="margin-top:8px; font-size:11px; color:var(--text-warning); display:flex; align-items:center; gap:6px;">' +
                        '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></svg>' +
                        'Execution stopped by user.</div>';
                }
            }
        }
    }

    if (typeof setUIReadyState === "function") {
        setUIReadyState(true);
    }

    addSystemMessage("Execution stopped by user.");
}
