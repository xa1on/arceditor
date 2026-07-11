/**
 * ArcEditor Agent Orchestrator Module
 * Manages the high-level system context instructions, structured tool call routing,
 * the automated ReAct self-correction execution loop, and custom markdown paragraph parser.
 */
let capturedFrameDataDuringLoop = null;

// Helper to canonicalize tool names case-insensitively to standard camelCase
function getCanonicalToolName(name) {
    if (!name) return "";
    const lower = name.toLowerCase();
    const mapping = {
        "captureactiveframe": "captureActiveFrame",
        "capturecompositionsequence": "captureCompositionSequence",
        "gettimelinecontext": "getTimelineContext",
        "getinstalledeffects": "getInstalledEffects",
        "searchinstalledeffects": "searchInstalledEffects",
        "getlayerproperties": "getLayerProperties",
        "selectlayers": "selectLayers",
        "switchcomposition": "switchComposition",
        "setplayheadtime": "setPlayheadTime",
        "undolastaction": "undoLastAction",
        "askquestion": "askQuestion",
        "submitplan": "submitPlan",
        "updateplan": "updatePlan",
        "websearch": "webSearch"
    };
    return mapping[lower] || name;
}

// Central definition of tool categories for read-only checks
const CANVAS_READONLY_TOOLS = [
    "captureActiveFrame",
    "captureCompositionSequence",
    "getTimelineContext",
    "searchInstalledEffects",
    "getLayerProperties",
    "selectLayers",
    "switchComposition",
    "setPlayheadTime",
    "undoLastAction",
    "askQuestion",
    "submitPlan",
    "updatePlan",
    "webSearch"
];

const PERMISSION_READONLY_TOOLS = [
    "captureActiveFrame",
    "captureCompositionSequence",
    "getTimelineContext",
    "searchInstalledEffects",
    "getLayerProperties",
    "selectLayers",
    "switchComposition",
    "setPlayheadTime",
    "askQuestion",
    "updatePlan",
    "webSearch"
];

function pushToHistory(msg) {
    const serialized = JSON.parse(JSON.stringify(msg));
    chatHistory.push(serialized);
    agentHistory.push(JSON.parse(JSON.stringify(msg)));
    if (typeof saveChats === "function") {
        saveChats();
    }
}

async function runAgenticExecutionLoop(userText) {
    isStopped = false;
    currentExecutionId++;
    historyVersion++; // Increment version on new prompt run
    const executionId = currentExecutionId;

    try {
        let attachments = [...attachedFrames];

        // Reset attachments
        clearAttachmentDock();

        let userMsg;
        if (attachments && attachments.length > 0) {
            let embeddedText = userText;
            const contentParts = [];

            attachments.forEach(item => {
                const isObject = typeof item === "object" && item !== null;
                if (isObject) {
                    if (item.type === "text" || item.textContent !== undefined) {
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
                        contentParts.push({
                            type: "image_url",
                            image_url: { url: `data:${item.mimeType};base64,${item.data}` }
                        });
                    } else {
                        if (currentProvider === "gemini") {
                            contentParts.push({
                                type: "inline_data",
                                inline_data: {
                                    mimeType: item.mimeType,
                                    data: item.data
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
                content: contentParts
            };
        } else {
            userMsg = { role: "user", content: userText };
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
                    if (executionId !== currentExecutionId || isStopped) return;
                    const activeTurnNum = completedTurns.length + 1;

                    const parsed = parseStreamingReasoning(chunkText);
                    const reasoningHtml = parsed.reasoning ? `<details class="reasoning-details" id="reasoning-turn-${aiBubble.id}-${activeTurnNum}" open><summary>Reasoning / Assembly Plan (Thinking...)</summary><div class="reasoning-content">${formatMarkdown(parsed.reasoning, activeTurnNum)}</div></details>` : "";
                    const contentHtml = formatMarkdown(parsed.content, activeTurnNum);

                    updateAiBubbleTurns(aiBubble, completedTurns, reasoningHtml, contentHtml);

                    aiBubble.setAttribute("data-raw-text", parsed.content);
                    if (typeof scrollToBottom === "function") scrollToBottom();
                });
                if (executionId !== currentExecutionId || isStopped) {
                    isCompleted = true;
                    break;
                }
                if (!llmResponse || !llmResponse.trim()) {
                    loopRetries++;
                    writeToDebugLog("LLM Response Empty Error", "LLM returned an empty or whitespace-only response. The local model context might be overloaded, or it encountered a generation failure.");

                    completedTurns.push({
                        type: "failed",
                        turnNum: completedTurns.length + 1,
                        turnTitle: "Empty response from agent (Retrying...)",
                        llmResponse: "",
                        observations: "Error: The model returned an empty response. This usually indicates a generation failure or context window overflow."
                    });

                    updateAiBubbleTurns(aiBubble, completedTurns, "",
                        `<div style="margin-top:8px; font-size:11px; color:var(--text-error); display:flex; align-items:center; gap:6px;"><div class="dots-loader"><span></span><span></span><span></span></div> Empty response detected. Retrying generation... (Attempt ${loopRetries}/${maxRetries})</div>`);
                    if (typeof scrollToBottom === "function") scrollToBottom();

                    const retryMsg = {
                        role: "user",
                        content: "[System Observation - Error]: You returned an empty or whitespace-only response. If your context window is overloaded, please resolve the task immediately or output a concise, corrected JSON tool call without conversational preamble.",
                        isIntermediate: true
                    };
                    activeContext.push(retryMsg);
                    pushToHistory(retryMsg);
                    continue;
                }
                const parsedResponse = parseStreamingReasoning(llmResponse);
                aiBubble.setAttribute("data-raw-text", parsedResponse.content);
                const assistantMsg = {
                    role: "assistant",
                    content: parsedResponse.content,
                    reasoning: parsedResponse.reasoning
                };
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
                                const toolName = getCanonicalToolName(tc.tool);
                                const isReadOnly = CANVAS_READONLY_TOOLS.indexOf(toolName) !== -1;
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
                var executedAnything = false;
                var scriptFailed = false;

                if (jsonBlock) {
                    try {
                        const parsed = JSON.parse(jsonBlock);
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
                    executedAnything = true;
                    const activeTurnNum = completedTurns.length + 1;
                    const parsed = parseStreamingReasoning(llmResponse);
                    const reasoningHtml = parsed.reasoning ? `<details class="reasoning-details" id="reasoning-turn-${aiBubble.id}-${activeTurnNum}" open><summary>Reasoning / Assembly Plan (Thinking...)</summary><div class="reasoning-content">${formatMarkdown(parsed.reasoning, activeTurnNum)}</div></details>` : "";
                    const contentHtml = formatMarkdown(parsed.content, activeTurnNum) +
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
                        scriptFailed = true;
                        loopRetries++;

                        writeToDebugLog("Tool Execution Error", toolObservations);

                        // Package failed turn
                        const parsedTurn = parseStreamingReasoning(llmResponse);
                        completedTurns.push({
                            type: "failed",
                            turnNum: completedTurns.length + 1,
                            turnTitle: "Tool execution failed (Retrying...)",
                            content: parsedTurn.content,
                            reasoning: parsedTurn.reasoning,
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

                    const parsedTurn = parseStreamingReasoning(llmResponse);
                    completedTurns.push({
                        type: "success",
                        turnNum: completedTurns.length + 1,
                        turnTitle: turnTitle,
                        content: parsedTurn.content,
                        reasoning: parsedTurn.reasoning,
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
                            const parsedTurn = parseStreamingReasoning(llmResponse);
                            completedTurns.push({
                                type: "success",
                                turnNum: completedTurns.length + 1,
                                turnTitle: "Visual verification frame captured",
                                content: parsedTurn.content,
                                reasoning: parsedTurn.reasoning,
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
                    const parsedFinal = parseStreamingReasoning(llmResponse);
                    const reasoningHtml = parsedFinal.reasoning ? `<details class="reasoning-details" id="reasoning-turn-${aiBubble.id}-${completedTurns.length + 1}" open><summary>Reasoning / Assembly Plan</summary><div class="reasoning-content">${formatMarkdown(parsedFinal.reasoning, completedTurns.length + 1)}</div></details>` : "";
                    const contentHtml = formatMarkdown(parsedFinal.content, completedTurns.length + 1);
                    updateAiBubbleTurns(aiBubble, completedTurns, reasoningHtml, contentHtml, true);
                    if (typeof scrollToBottom === "function") scrollToBottom();
                    writeToDebugLog("Informational Response Completed", llmResponse);
                }

            } catch (err) {
                console.error("Loop iteration failed:", err);
                updateAiBubbleTurns(aiBubble, completedTurns, "", `<p style="color:var(--text-error);">Error executing loop: ${err.message}</p>`, true);
                if (typeof scrollToBottom === "function") scrollToBottom();
                isCompleted = true;
            }
        }

        if (executionId !== currentExecutionId) {
            // Obsolete thread, exit silently
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
        if (executionId === currentExecutionId) {
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

function getSignificantJsonActionKey(jsonStr) {
    if (!jsonStr) return "";
    try {
        const parsed = JSON.parse(jsonStr);
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
        const parsed = JSON.parse(jsonStr);
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
            const isReadOnly = PERMISSION_READONLY_TOOLS.indexOf(toolName) !== -1;

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
            } else if (toolName === "webSearch") {
                const query = params.query;
                const results = await window.searchWeb(query);
                observations.push(`- Tool "webSearch": ${JSON.stringify(results)}`);
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
            } else if (toolName === "executeExtendScript") {
                const script = params.script;
                // Static Analysis Verification
                const analysis = typeof analyzeExtendScript === "function" ? analyzeExtendScript(script) : { safe: true };
                if (!analysis.safe) {
                    observations.push(`- Tool "executeExtendScript": Blocked by static security analyzer. Reason: ${analysis.reason}`);
                    if (window._activeToolStatuses && window._activeToolStatuses[i]) {
                        window._activeToolStatuses[i].status = "blocked";
                        window._activeToolStatuses[i].reason = analysis.reason;
                    }
                    if (typeof window !== "undefined" && typeof window.updateToolCardStatusUI === "function") {
                        window.updateToolCardStatusUI(i, "blocked", analysis.reason);
                    }
                    continue;
                }
                jsxCommand = `(function() {
                    var ArcEditor = $._com_arceditor_ ? $._com_arceditor_.ArcEditor : null;
                    var ArcJSON = $._com_arceditor_ ? $._com_arceditor_.ArcJSON : null;
                    var ArcInspector = $._com_arceditor_ ? $._com_arceditor_.ArcInspector : null;
                    var ArcCanvas = $._com_arceditor_ ? $._com_arceditor_.ArcCanvas : null;
                    var JSON = ArcJSON;
                    var _arcEditorTempFolder;
                    try {
                        _arcEditorTempFolder = app.project.items.addFolder("ArcEditorTemp");
                        if (_arcEditorTempFolder) _arcEditorTempFolder.remove();
                    } catch (dummyErr) {}
                    
                    app.beginUndoGroup("ArcEditor Agent Script");
                    try {
                        ${script}
                        app.endUndoGroup();
                        return "Success";
                    } catch (err) {
                        app.endUndoGroup();
                        try {
                            app.activate();
                            app.executeCommand(16);
                        } catch (undoErr) {}
                        return "Error (automatically undone, no need to rollback the errored script with the undo tool): " + err.toString() + (err.line ? " (line " + err.line + ")" : "");
                    }
                })()`;
            } else {
                throw new Error(`Unsupported tool name: ${toolName}`);
            }

            let result = await evalScriptAsync(jsxCommand);
            if (toolName === "executeExtendScript" && (!result || result.trim() === "")) {
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
        // Fallback high-fidelity BPE approximation if estimateTrueTokens is not available
        const spaces = textForEstimation.match(/ {2,4}/g) || [];
        let count = spaces.length;
        const cleanedText = textForEstimation.replace(/ {2,4}/g, '');
        const words = cleanedText.match(/[\w]+|[^\s\w]/g) || [];
        for (var k = 0; k < words.length; k++) {
            var token = words[k];
            if (/^[^\s\w]$/.test(token)) {
                count += 1;
            } else {
                if (token.length > 4) {
                    count += Math.ceil(token.length / 3.5);
                } else {
                    count += 1;
                }
            }
        }
        const newlines = (textForEstimation.match(/\n/g) || []).length;
        count += newlines * 0.5;
        estTokens = Math.round(count);
    }

    estTokens += imageBlocksCount * 258;
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
        "API Network Error": true
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
