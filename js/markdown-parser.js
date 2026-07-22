/**
 * ArcEditor Markdown and UI HTML Formatter Module
 * Handles HTML escaping, markdown conversions, tool call table formatting, and detailed turn wrappers.
 */

window.ArcEditor = window.ArcEditor || {};
ArcEditor.markdown = ArcEditor.markdown || {};

function getOpenTurnNums(aiBubble) {

    const openTurnNums = [];
    if (aiBubble) {
        const detailsElems = aiBubble.querySelectorAll(".agent-turn-details");
        for (let j = 0; j < detailsElems.length; j++) {
            const elem = detailsElems[j];
            if (elem.hasAttribute("open")) {
                const idMatch = elem.id.match(/details-turn-(?:.*-)?(\d+)$/);
                if (idMatch) {
                    openTurnNums.push(parseInt(idMatch[1], 10));
                }
            }
        }
    }
    return openTurnNums;
}

function renderTurnImagesHtml(images) {
    if (!images) return "";
    const imagesArray = Array.isArray(images) ? images : [images];
    if (imagesArray.length === 0) return "";

    let imgHtml = `<div class="bubble-images-container" style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; margin-bottom: 6px;">`;
    for (let i = 0; i < imagesArray.length; i++) {
        imgHtml += `<div class="bubble-image-wrap" style="margin-top: 0;"><img src="data:image/png;base64,${imagesArray[i]}" alt="Turn capture ${i + 1}" /></div>`;
    }
    imgHtml += `</div>`;
    return imgHtml;
}

function parseObservations(observations) {
    if (!observations) return [];
    const normalized = observations.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const parts = normalized.split(/\n(?=- Tool ")/);
    const results = [];
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        if (part.indexOf('- Tool "') === 0) {
            const closingQuote = part.indexOf('"', 8);
            if (closingQuote !== -1) {
                const tool = part.substring(8, closingQuote);
                const rest = part.substring(closingQuote + 2).trim(); // Skip ": "
                let status = "allowed";
                let reason = "";
                if (rest.indexOf("Denied by user.") === 0) {
                    status = "denied";
                    const reasonIndex = rest.indexOf('Reason: "');
                    if (reasonIndex !== -1) {
                        reason = rest.substring(reasonIndex + 9, rest.length - 1);
                    }
                } else if (rest.indexOf("Blocked by project security configuration.") === 0) {
                    status = "blocked";
                }
                results.push({ tool, status, reason, output: rest });
            }
        }
    }
    return results;
}

function formatToolObservation(toolName, output, turnNum) {
    if (!output) return "";
    
    // Check if it's askQuestion
    if (toolName === "askQuestion") {
        const lines = output.split("\n");
        let qaList = [];
        let currentQA = null;
        for (let j = 0; j < lines.length; j++) {
            const line = lines[j].trim();
            if (line.indexOf('- Question: "') === 0) {
                if (currentQA) qaList.push(currentQA);
                currentQA = {
                    question: line.substring('- Question: "'.length, line.length - 1),
                    answer: ""
                };
            } else if (line.indexOf('Answer: ') === 0 && currentQA) {
                let ans = line.substring('Answer: '.length);
                if (ans.startsWith('"') && ans.endsWith('"')) {
                    ans = ans.substring(1, ans.length - 1);
                } else if (ans.startsWith('[') && ans.endsWith(']')) {
                    try {
                        ans = JSON.parse(ans).join(", ");
                    } catch (e) {}
                }
                currentQA.answer = ans;
            }
        }
        if (currentQA) qaList.push(currentQA);
        
        if (qaList.length > 0) {
            return `
            <div style="font-size: 10px; display: flex; flex-direction: column; gap: 4px; margin-top: 4px; background: var(--bg-input); padding: 6px; border: 1px solid var(--border-color); border-radius: var(--border-radius-sm);">
                ${qaList.map(qa => `
                    <div style="border-bottom: 1px solid rgba(255,255,255,0.03); padding-bottom: 2px; margin-bottom: 2px;">
                        <div style="color: var(--text-secondary); font-weight: 500;">Q: ${qa.question}</div>
                        <div style="color: var(--text-primary); padding-left: 6px; font-family: var(--font-mono); font-size: 9px; margin-top: 1px;">A: ${qa.answer}</div>
                    </div>
                `).join("")}
            </div>
            `;
        }
    }
    
    // Check if it's submitPlan
    if (toolName === "submitPlan") {
        const lines = output.split("\n");
        let status = "approved";
        let reason = "";
        let planContent = "";
        let isCapturingPlan = false;
        
        for (let j = 0; j < lines.length; j++) {
            const line = lines[j];
            if (line.indexOf("Plan rejected by user") !== -1 || line.indexOf("Denied by user") !== -1) {
                status = "rejected";
                const reasonIdx = line.indexOf("Reason: ");
                if (reasonIdx !== -1) {
                    reason = line.substring(reasonIdx + 8);
                    if (reason.startsWith('"') && reason.endsWith('"')) {
                        reason = reason.substring(1, reason.length - 1);
                    }
                }
            } else if (line.indexOf("Plan approved by user") !== -1) {
                status = "approved";
                isCapturingPlan = true;
            } else if (isCapturingPlan || line.indexOf("- Tool \"submitPlan\":") === -1) {
                planContent += (planContent ? "\n" : "") + line;
            }
        }
        
        if (planContent.indexOf("Plan approved by user") === 0) {
            planContent = planContent.substring("Plan approved by user. Plan details:\n".length);
        }
        
        if (status === "approved") {
            return `
            <div style="font-size: 10px; margin-top: 4px; background: rgba(20, 115, 230, 0.05); padding: 8px; border: 1px solid var(--text-accent); border-radius: var(--border-radius-sm);">
                ${formatMarkdown(planContent, turnNum)}
            </div>
            `;
        } else {
            const displayReason = reason ? `: "${reason}"` : "";
            return `
            <div style="color: var(--text-error); font-weight: 600; font-size: 10px; margin-top: 4px;">
                Plan Rejected${displayReason}
            </div>
            `;
        }
    }
    
    // Generic display
    return `<pre class="observation-pre" style="margin-top: 4px !important; background: #111 !important; color: var(--text-secondary) !important; font-family: var(--font-mono) !important; font-size: 9.5px !important; padding: 6px !important; border: 1px solid var(--border-color) !important; white-space: pre-wrap; word-break: break-all;">${output}</pre>`;
}

function tryFormatToolCall(code, isStreaming, toolStatuses, activeTurn = "default", images = null) {
    // Unescape HTML entities first (since formatMarkdown escapes them before processing code blocks)
    const cleanCode = code
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
    try {
        let parsed = null;
        if (isStreaming) {
            parsed = repairJSON(cleanCode);
        } else {
            try {
                parsed = JSON.parse(cleanCode);
            } catch (e) {
                parsed = repairJSON(cleanCode);
            }
        }

        let isLikelyToolCall = false;
        let toolName = "";

        if (parsed) {
            const calls = Array.isArray(parsed) ? parsed : [parsed];
            isLikelyToolCall = calls.every(c => c && typeof c === "object" && typeof c.tool === "string");
            if (isLikelyToolCall) {
                toolName = calls[0].tool;
            }
        } else {
            // If parsed is null, check if the code block starts like a JSON tool call
            const trimmed = cleanCode.trim();
            if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
                isLikelyToolCall = true;
                const toolMatch = cleanCode.match(/"tool"\s*:\s*"([^"]*)"/);
                if (toolMatch) {
                    toolName = toolMatch[1];
                }
            }
        }

        if (!isLikelyToolCall) return null;

        const calls = parsed ? (Array.isArray(parsed) ? parsed : [parsed]) : [{ tool: toolName, parameters: {} }];

        let html = `<div class="tool-calls-container">`;
        calls.forEach((call, index) => {
            const statusInfo = toolStatuses && toolStatuses[index];
            const status = statusInfo ? statusInfo.status : (isStreaming ? "pending" : "allowed");
            const reason = statusInfo ? statusInfo.reason : "";
            const cardId = "tool-card-" + activeTurn + "-" + index;

            // Cache successfully parsed parameters or fallback to last cached values to avoid layout flicker
            let activeParams = null;
            if (parsed) {
                activeParams = call.parameters || {};
                if (typeof window !== "undefined") {
                    window._lastParsedParameters = window._lastParsedParameters || {};
                    window._lastParsedParameters[cardId] = activeParams;
                }
            } else if (typeof window !== "undefined" && window._lastParsedParameters && window._lastParsedParameters[cardId]) {
                activeParams = window._lastParsedParameters[cardId];
            }

            let paramsHtml = "";
            if (activeParams) {
                const paramKeys = Object.keys(activeParams);
                if (paramKeys.length > 0) {
                    paramsHtml = `<table class="tool-params-table">`;
                    paramKeys.forEach(key => {
                        let valStr = "";
                        if (typeof activeParams[key] === "object" && activeParams[key] !== null) {
                            valStr = JSON.stringify(activeParams[key], null, 2);
                        } else {
                            valStr = String(activeParams[key]);
                        }
                        const escapedValStr = valStr
                            .replace(/&/g, "&amp;")
                            .replace(/</g, "&lt;")
                            .replace(/>/g, "&gt;");

                        let displayHtml = "";
                        if (key === "script" || key === "content" || key === "targetContent" || key === "replacementContent") {
                            displayHtml = `<pre class="param-value-code"><code>${highlightCode(escapedValStr, "javascript")}</code></pre>`;
                        } else if (valStr.indexOf("\n") !== -1) {
                            const trimmedVal = valStr.trim();
                            const possibleLang = (trimmedVal.startsWith("{") && trimmedVal.endsWith("}")) || (trimmedVal.startsWith("[") && trimmedVal.endsWith("]")) ? "json" : "";
                            displayHtml = `<pre class="param-value-code"><code>${highlightCode(escapedValStr, possibleLang)}</code></pre>`;
                        } else {
                            displayHtml = escapedValStr;
                        }
                        paramsHtml += `<tr><td class="param-key">${key}</td><td class="param-value">${displayHtml}</td></tr>`;
                    });
                    paramsHtml += `</table>`;
                } else {
                    paramsHtml = `<div class="tool-no-params">No parameters</div>`;
                }
            } else {
                paramsHtml = `<div class="tool-no-params">Streaming parameters...</div>`;
            }

            const rawJsonHtml = `<pre class="code-viewport"><code>${highlightCode(parsed ? JSON.stringify(call, null, 2) : cleanCode, "json")}</code></pre>`;

            const escapedReason = reason ? reason
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;") : "";

            const denialHtml = (status === "denied" && escapedReason) ? `
                <div class="tool-denial-reason" style="margin-bottom: 6px; padding: 4px 6px; background: rgba(255, 68, 68, 0.1); border: 1px solid rgba(255, 68, 68, 0.2); border-radius: var(--border-radius-sm); font-size: 9.5px; color: var(--text-error); font-style: italic;">
                    <strong>Denial Reason:</strong> ${escapedReason}
                </div>
            ` : "";

            let observationHtml = "";
            if (statusInfo && statusInfo.output) {
                let imgHtml = "";
                if ((call.tool === "captureActiveFrame" || call.tool === "captureCompositionSequence") && images) {
                    imgHtml = renderTurnImagesHtml(images);
                }

                const isSuccess = statusInfo.output.trim().indexOf("Success:") === 0 || statusInfo.status === "allowed";
                const isError = statusInfo.output.trim().toLowerCase().indexOf("error:") !== -1 || statusInfo.status === "blocked";

                let titleColor = "var(--text-accent)";
                let titleText = "Observation";
                if (isSuccess) {
                    titleColor = "var(--text-success)";
                    if (call.tool === "askQuestion") titleText = "Questions Answered";
                    else if (call.tool === "submitPlan") titleText = "Plan Approved";
                }
                if (isError) {
                    titleColor = "var(--text-error)";
                    if (call.tool === "submitPlan") titleText = "Plan Rejected";
                }

                observationHtml = `
                    <div class="tool-observation-wrap" style="margin-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.05); padding-top: 8px;">
                        <div style="font-size: 9.5px; font-weight: 600; color: ${titleColor}; text-transform: uppercase; margin-bottom: 4px;">${titleText}:</div>
                        ${formatToolObservation(call.tool, statusInfo.output, activeTurn)}
                        ${imgHtml}
                    </div>
                `;
            }

            html += `
                <details class="tool-call-card status-${status} ${isStreaming ? 'streaming' : ''}" id="${cardId}" data-tool="${call.tool}" data-index="${index}" data-status="${status}" open>
                    <summary class="tool-call-header">
                        <span class="tool-badge">Tool Call${isStreaming ? ' (Streaming...)' : ''}</span>
                        <span class="tool-name">${call.tool || '...'}</span>
                        <button class="toggle-tool-view-btn">Show JSON</button>
                    </summary>
                    <div class="tool-call-body">
                        ${denialHtml}
                        <div class="tool-params-table-wrap">
                            ${paramsHtml}
                        </div>
                        <div class="tool-raw-json-wrap">
                            ${rawJsonHtml}
                        </div>
                        ${observationHtml}
                    </div>
                </details>
            `;
        });
        html += `</div>`;
        return html;
    } catch (err) {
        console.error("tryFormatToolCall error:", err);
        return null;
    }
}

function renderTurnsHtml(turns, openTurnNums, bubbleId, activeTurnHasContent = false) {
    if (!turns || turns.length === 0) return "";
    let html = "";
    const prefix = bubbleId ? `${bubbleId}-` : "";
    const executing = typeof isExecuting !== "undefined" ? isExecuting : false;

    for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];
        const isMostRecent = i === turns.length - 1;
        const isOpen = (openTurnNums && openTurnNums.indexOf(turn.turnNum) !== -1) || (executing && isMostRecent && !activeTurnHasContent);
        const openAttr = isOpen ? " open" : "";

        const contentHtml = formatMarkdown(turn.content !== undefined ? turn.content : turn.llmResponse, turn.turnNum, turn.observations, turn.images);
        const hasToolCards = contentHtml.indexOf("tool-call-card") !== -1;
        const hasCaptureToolCard = contentHtml.indexOf('data-tool="captureActiveFrame"') !== -1 || contentHtml.indexOf('data-tool="captureCompositionSequence"') !== -1;
        
        const imagesHtml = (!hasCaptureToolCard) ? renderTurnImagesHtml(turn.images) : "";

        const reasoningHtml = turn.reasoning ? `<details class="reasoning-details" id="reasoning-turn-${prefix}${turn.turnNum}" open><summary>Reasoning / Assembly Plan</summary><div class="reasoning-content">${formatMarkdown(turn.reasoning, turn.turnNum)}</div></details>` : "";

        let obsHtml = "";
        if (turn.observations && !hasToolCards) {
            if (turn.observations.indexOf('- Tool "askQuestion":') !== -1) {
                const lines = turn.observations.split("\n");
                let qaList = [];
                let currentQA = null;
                for (let j = 0; j < lines.length; j++) {
                    const line = lines[j].trim();
                    if (line.indexOf('- Question: "') === 0) {
                        if (currentQA) qaList.push(currentQA);
                        currentQA = {
                            question: line.substring('- Question: "'.length, line.length - 1),
                            answer: ""
                        };
                    } else if (line.indexOf('Answer: ') === 0 && currentQA) {
                        let ans = line.substring('Answer: '.length);
                        if (ans.startsWith('"') && ans.endsWith('"')) {
                            ans = ans.substring(1, ans.length - 1);
                        } else if (ans.startsWith('[') && ans.endsWith(']')) {
                            try {
                                ans = JSON.parse(ans).join(", ");
                            } catch (e) {}
                        }
                        currentQA.answer = ans;
                    }
                }
                if (currentQA) qaList.push(currentQA);

                if (qaList.length > 0) {
                    obsHtml = `
                    <div class="turn-observations">
                        <strong style="color: var(--text-success);">Questions Answered:</strong>
                        <div style="font-size: 10px; display: flex; flex-direction: column; gap: 4px; margin-top: 4px; background: var(--bg-input); padding: 6px; border: 1px solid var(--border-color); border-radius: var(--border-radius-sm);">
                            ${qaList.map(qa => `
                                <div style="border-bottom: 1px solid rgba(255,255,255,0.03); padding-bottom: 2px; margin-bottom: 2px;">
                                    <div style="color: var(--text-secondary); font-weight: 500;">Q: ${qa.question}</div>
                                    <div style="color: var(--text-primary); padding-left: 6px; font-family: var(--font-mono); font-size: 9px; margin-top: 1px;">A: ${qa.answer}</div>
                                </div>
                            `).join("")}
                        </div>
                    </div>
                    `;
                } else {
                    obsHtml = `
                    <div class="turn-observations">
                        <strong>Observations:</strong>
                        <pre class="observation-pre">${turn.observations}</pre>
                    </div>
                    `;
                }
            } else if (turn.observations.indexOf('- Tool "submitPlan":') !== -1) {
                const lines = turn.observations.split("\n");
                let status = "approved";
                let reason = "";
                let planContent = "";
                let isCapturingPlan = false;
                for (let j = 0; j < lines.length; j++) {
                    const line = lines[j];
                    if (line.indexOf('- Tool "submitPlan":') === 0) {
                        const nextLine = lines[j + 1] || "";
                        if (nextLine.indexOf("Plan rejected by user") !== -1 || nextLine.indexOf("Denied by user") !== -1) {
                            status = "rejected";
                            const reasonIdx = nextLine.indexOf("Reason: ");
                            if (reasonIdx !== -1) {
                                reason = nextLine.substring(reasonIdx + 8);
                                if (reason.startsWith('"') && reason.endsWith('"')) {
                                    reason = reason.substring(1, reason.length - 1);
                                }
                            }
                        } else {
                            status = "approved";
                            isCapturingPlan = true;
                            j++;
                            if (lines[j] && lines[j].indexOf("Plan approved by user") !== -1) {
                                j++;
                            }
                        }
                    } else if (isCapturingPlan) {
                        planContent += (planContent ? "\n" : "") + line;
                    }
                }

                if (status === "approved") {
                    obsHtml = `
                    <div class="turn-observations">
                        <strong style="color: var(--text-success);">Plan Approved:</strong>
                        <div style="font-size: 10px; margin-top: 4px; background: rgba(20, 115, 230, 0.05); padding: 8px; border: 1px solid var(--text-accent); border-radius: var(--border-radius-sm);">
                            ${formatMarkdown(planContent, turn.turnNum)}
                        </div>
                    </div>
                    `;
                } else {
                    const displayReason = reason ? `: "${reason}"` : "";
                    obsHtml = `
                    <div class="turn-observations">
                        <strong style="color: var(--text-error);">Plan Rejected${displayReason}</strong>
                    </div>
                    `;
                }
            } else {
                obsHtml = `
                <div class="turn-observations">
                    <strong>Observations:</strong>
                    <pre class="observation-pre">${turn.observations}</pre>
                </div>
                `;
            }
        }

        if (turn.type === "failed") {
            let failedObsHtml = "";
            if (!hasToolCards) {
                failedObsHtml = `
                <div class="turn-observations">
                    <strong style="color: var(--text-error);">Error Observation:</strong>
                    <pre class="observation-pre" style="border-color: var(--text-error); color: var(--text-error) !important;">${turn.observations}</pre>
                </div>
                `;
            }
            html += `
            <details class="agent-turn-details" id="details-turn-${prefix}${turn.turnNum}" style="border-color: var(--text-error);"${openAttr}>
                <summary class="agent-turn-summary" style="background-color: rgba(255, 68, 68, 0.15);">
                    <span class="turn-index-badge" style="background-color: var(--text-error); color: white;">Turn ${turn.turnNum}</span>
                    <span class="turn-title" style="color: var(--text-error);">${turn.turnTitle}</span>
                </summary>
                <div class="agent-turn-body">
                    ${reasoningHtml}
                    ${contentHtml}
                    ${imagesHtml}
                    ${failedObsHtml}
                </div>
            </details>
            `;
        } else {
            html += `
            <details class="agent-turn-details" id="details-turn-${prefix}${turn.turnNum}"${openAttr}>
                <summary class="agent-turn-summary">
                    <span class="turn-index-badge">Turn ${turn.turnNum}</span>
                    <span class="turn-title">${turn.turnTitle}</span>
                </summary>
                <div class="agent-turn-body">
                    ${reasoningHtml}
                    ${contentHtml}
                    ${imagesHtml}
                    ${obsHtml}
                </div>
            </details>
            `;
        }
    }

    const groupId = `turns-group-${bubbleId || 'default'}`;
    const folderIconSvg = `<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px; vertical-align:middle; position:relative; top:-1px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline><path d="M20.47 5.58a10 10 0 0 0-16.94 4.42"></path></svg>`;

    return `
    <details class="completed-turns-group" id="${groupId}" open>
        <summary class="completed-turns-group-summary">
            <span class="history-icon">${folderIconSvg}</span>
            <span class="group-title">Agent Execution History (${turns.length} Turn${turns.length !== 1 ? 's' : ''})</span>
        </summary>
        <div class="completed-turns-group-content">
            ${html}
        </div>
    </details>
    `;
}

function formatMarkdown(text, turnNum, observations, images) {
    if (!text) return "";
    const activeTurn = turnNum || "default";

    let toolStatuses = [];
    if (observations) {
        toolStatuses = parseObservations(observations);
    } else if (typeof window !== "undefined" && window._activeToolStatuses) {
        toolStatuses = window._activeToolStatuses;
    }

    // Normalize newlines to standard \n
    const normalizedText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    // Escape HTML special characters safely
    let html = normalizedText
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    const preBlocks = [];
    const parts = html.split("```");
    let rebuiltHtml = "";
    let jsxBlockCount = 0;

    for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 0) {
            rebuiltHtml += parts[i];
        } else {
            const block = parts[i];
            const isClosed = i < parts.length - 1;

            let lang = "";
            let code = block;

            const firstNewline = block.indexOf("\n");
            if (firstNewline !== -1) {
                lang = block.substring(0, firstNewline).trim().toLowerCase();
                code = block.substring(firstNewline + 1);
            } else {
                const possibleLang = block.trim().toLowerCase();
                const knownLangs = ["json", "javascript", "js", "extendscript", "jsx", "python", "py", "html", "css", "bash", "sh", "txt", "markdown", "md"];
                if (knownLangs.indexOf(possibleLang) !== -1 || possibleLang === "") {
                    lang = possibleLang;
                    code = "";
                }
            }

            let renderedBlock = "";
            if (lang === "json") {
                const formatted = tryFormatToolCall(code, !isClosed, toolStatuses, activeTurn, images);
                if (formatted) {
                    renderedBlock = formatted;
                } else {
                    renderedBlock = `<pre class="code-viewport"><code>${highlightCode(code, "json")}</code></pre>`;
                }
            } else if (lang === "javascript" || lang === "js" || lang === "extendscript" || lang === "jsx") {
                jsxBlockCount++;
                renderedBlock = `
                <details class="jsx-code-details ${!isClosed ? 'streaming' : ''}" id="jsx-code-turn-${activeTurn}-${jsxBlockCount}" ${!isClosed ? 'open' : ''}>
                    <summary class="jsx-code-summary">ExtendScript JSX Code Block${!isClosed ? ' (Streaming...)' : ''}</summary>
                    <pre class="code-viewport"><code>${highlightCode(code, lang)}</code></pre>
                </details>
                `;
            } else {
                let displayCode = code;
                if (firstNewline === -1) {
                    displayCode = block;
                }
                renderedBlock = `<pre class="code-viewport"><code>${highlightCode(displayCode, lang)}</code></pre>`;
            }

            preBlocks.push(renderedBlock);
            rebuiltHtml += `__PRE_BLOCK_${preBlocks.length - 1}__`;
        }
    }

    html = convertMarkdownTables(rebuiltHtml);

    // Process the text paragraph by paragraph
    const paragraphs = html.split(/\n\n+/);
    const processedParagraphs = paragraphs.map(p => {
        let trimmed = p.trim();
        if (!trimmed) return "";

        // Check if it's a pre-extracted block
        if (trimmed.indexOf("__PRE_BLOCK_") === 0) {
            return trimmed;
        }

        // Check if it's a pre-parsed HTML table
        if (trimmed.indexOf("<table") === 0) {
            return trimmed;
        }

        // Process tables (fallback)
        const tableHtml = parseMarkdownTable(trimmed);
        if (tableHtml) {
            return tableHtml;
        }

        // Split this paragraph block by single newlines to process headings, lists, and text separately
        const lines = trimmed.split("\n");
        const processedLines = lines.map(line => {
            const lTrim = line.trim();
            if (!lTrim) return "";

            // Horizontal rule
            if (/^(?:-\s*){3,}$|^(?:\*\s*){3,}$|^(?:_\s*){3,}$/.test(lTrim)) {
                return `<hr>`;
            }

            // Calculate indentation styling based on tab-stop steps (max 4 levels, 12px per level)
            const leadingSpaces = line.match(/^(\s*)/)[0].replace(/\t/g, "  ");
            const indentSteps = Math.min(4, Math.floor(leadingSpaces.length / 2));
            const indentStyle = indentSteps > 0 ? ` style="padding-left: ${indentSteps * 12}px;"` : '';

            // Headings
            if (lTrim.startsWith("#")) {
                return lTrim
                    .replace(/^###### (.*?)$/, "<h6>$1</h6>")
                    .replace(/^##### (.*?)$/, "<h5>$1</h5>")
                    .replace(/^#### (.*?)$/, "<h4>$1</h4>")
                    .replace(/^### (.*?)$/, "<h3>$1</h3>")
                    .replace(/^## (.*?)$/, "<h2>$1</h2>")
                    .replace(/^# (.*?)$/, "<h1>$1</h1>");
            }

            // Blockquotes
            if (lTrim.indexOf("&gt;") === 0) {
                return `<blockquote>${lTrim.replace(/^&gt;\s?/, "")}</blockquote>`;
            }

            // Checklist task items
            if (/^\s*[-*+]\s+\[\s*\]\s+/.test(line)) {
                return line.replace(/^\s*[-*+]\s+\[\s*\]\s+(.*?)$/, `<div class='bullet-item task-item'${indentStyle}><input type='checkbox' disabled /> <span class='bullet-text'>$1</span></div>`);
            }
            if (/^\s*[-*+]\s+\[[xX]\]\s+/.test(line)) {
                return line.replace(/^\s*[-*+]\s+\[[xX]\]\s+(.*?)$/, `<div class='bullet-item task-item'${indentStyle}><input type='checkbox' checked disabled /> <span class='bullet-text'>$1</span></div>`);
            }

            // Standard list items
            if (/^\s*[-*+]\s+/.test(line)) {
                return line.replace(/^\s*[-*+]\s+(.*?)$/, `<div class='bullet-item'${indentStyle}><span class='bullet-char'>•</span><span class='bullet-text'>$1</span></div>`);
            }
            if (/^\s*(\d+)\.\s+/.test(line)) {
                return line.replace(/^\s*(\d+)\.\s+(.*?)$/, `<div class='bullet-item'${indentStyle}><span class='bullet-char'>$1.</span><span class='bullet-text'>$2</span></div>`);
            }

            // Plain text line
            return lTrim;
        });

        // Group consecutive inline lines, but output block elements individually
        let finalHtml = "";
        let inParagraph = false;

        for (let j = 0; j < processedLines.length; j++) {
            const lineHtml = processedLines[j];
            if (!lineHtml) continue;

            const isBlock = lineHtml.startsWith("__PRE_BLOCK_") || lineHtml.startsWith("<div") || lineHtml.startsWith("<h") || lineHtml.startsWith("<block") || lineHtml.startsWith("<table") || lineHtml.startsWith("<ul") || lineHtml.startsWith("<ol") || lineHtml.startsWith("<hr");
            if (isBlock) {
                if (inParagraph) {
                    finalHtml += "</p>";
                    inParagraph = false;
                }
                finalHtml += lineHtml;
            } else {
                if (!inParagraph) {
                    finalHtml += "<p>";
                    inParagraph = true;
                } else {
                    finalHtml += "<br>";
                }
                finalHtml += lineHtml;
            }
        }
        if (inParagraph) {
            finalHtml += "</p>";
        }
        return finalHtml;
    });

    let result = processedParagraphs.join("\n");

    // Restore pre blocks
    result = result.replace(/__PRE_BLOCK_(\d+)__/g, (match, index) => {
        return preBlocks[parseInt(index, 10)];
    });

    // Inline formatting: Bold, Italic, Code, Links
    result = result
        .replace(/\*\*((?:(?!<br>)[^\*])+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*((?:(?!<br>)[^\*])+?)\*/g, "<em>$1</em>")
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="markdown-link">$1</a>');

    // Clean up empty paragraphs
    result = result.replace(/<p><\/p>/g, "");

    // Process agent reasoning thinking blocks
    result = result.replace(/&lt;thinking&gt;([\s\S]*?)&lt;\/thinking&gt;/g, (match, thoughts) => {
        return `<details class="reasoning-details" id="reasoning-turn-${activeTurn}"><summary>Reasoning / Assembly Plan</summary><div class="reasoning-content">${thoughts}</div></details>`;
    });

    result = result.replace(/&lt;thinking&gt;([\s\S]*?)$/g, (match, thoughts) => {
        return `<details class="reasoning-details" id="reasoning-turn-${activeTurn}" open><summary>Reasoning / Assembly Plan (Thinking...)</summary><div class="reasoning-content">${thoughts}</div></details>`;
    });

    return result;
}

function convertMarkdownTables(text) {
    if (!text) return "";
    const lines = text.split("\n");
    const processedLines = [];
    let i = 0;
    while (i < lines.length) {
        if (i + 1 < lines.length) {
            const currentLine = lines[i];
            const nextLine = lines[i + 1];
            const dividerRow = nextLine.trim();
            const dividerRegex = /^\|?\s*[:-]+\s*\|(\s*[:-]+\s*\|)*\s*[:-]*\s*$/;

            if (dividerRegex.test(dividerRow)) {
                // Table detected!
                const tableLines = [currentLine, nextLine];
                let j = i + 2;
                while (j < lines.length) {
                    const dataLine = lines[j];
                    const trimmedData = dataLine.trim();
                    // A line belongs to the table if it is not empty and has at least one pipe character
                    if (trimmedData === "" || trimmedData.indexOf("|") === -1) {
                        break;
                    }
                    tableLines.push(dataLine);
                    j++;
                }

                const tableHtml = parseTableLines(tableLines);
                if (tableHtml) {
                    processedLines.push("");
                    processedLines.push(tableHtml);
                    processedLines.push("");
                    i = j;
                    continue;
                }
            }
        }
        processedLines.push(lines[i]);
        i++;
    }
    return processedLines.join("\n");
}

function parseTableLines(lines) {
    if (lines.length < 2) return null;

    const dividerRow = lines[1].trim();

    let html = '<table class="markdown-table">';

    // Parse Headers
    let headerCols = lines[0].split("|").map(col => col.trim());
    if (lines[0].trim().startsWith("|")) headerCols.shift();
    if (lines[0].trim().endsWith("|")) headerCols.pop();

    html += '<thead><tr>';
    headerCols.forEach(col => {
        html += `<th>${col}</th>`;
    });
    html += '</tr></thead>';

    // Parse Alignments
    let alignCols = dividerRow.split("|").map(col => {
        const c = col.trim();
        const startColon = c.indexOf(":") === 0;
        const endColon = c.lastIndexOf(":") === c.length - 1 && c.length > 1;
        if (startColon && endColon) return "center";
        if (endColon) return "right";
        if (startColon) return "left";
        return "";
    });
    if (dividerRow.startsWith("|")) alignCols.shift();
    if (dividerRow.endsWith("|")) alignCols.pop();

    // Parse Data rows
    html += '<tbody>';
    for (let i = 2; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        let cols = line.split("|").map(col => col.trim());
        if (line.startsWith("|")) cols.shift();
        if (line.endsWith("|")) cols.pop();

        html += '<tr>';
        for (let j = 0; j < headerCols.length; j++) {
            const val = cols[j] !== undefined ? cols[j] : "";
            const align = alignCols[j] ? ` style="text-align: ${alignCols[j]};"` : "";
            html += `<td${align}>${val}</td>`;
        }
        html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
}

function parseMarkdownTable(blockText) {
    const lines = blockText.trim().split("\n");
    if (lines.length < 2) return null;

    const dividerRow = lines[1].trim();
    const dividerRegex = /^\|?\s*[:-]+\s*\|(\s*[:-]+\s*\|)*\s*[:-]*\s*$/;
    if (!dividerRegex.test(dividerRow)) {
        return null;
    }

    return parseTableLines(lines);
}

/**
 * Code Syntax Highlighting Module
 */
function unescapeHtml(html) {
    if (!html) return "";
    return html
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, "&");
}

function escapeHtml(text) {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function highlightJavascript(code) {
    const raw = unescapeHtml(code);
    const tokenRegex = new RegExp([
        `(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*)`, // 1. Comments
        `("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`)`, // 2. Strings
        `(\\/(?![*\\/])(?:\\\\.|[^\\/\\\\\\n])+\\/[gimy]*)`, // 3. RegEx
        `(\\b\\d+(?:\\.\\d+)?\\b)`, // 4. Numbers
        `(\\b(?:break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|function|if|import|in|instanceof|new|return|super|switch|this|throw|try|typeof|var|void|while|with|yield|let|static)\\b)`, // 5. Keywords
        `(\\b(?:app|project|activeItem|Layer|CompItem|FolderItem|File|Folder|Socket|XML|Global|window|document|console|Math|Array|Object|String|Number|Boolean|RegExp|JSON|undefined|null|NaN|Infinity)\\b)`, // 6. Builtins/Globals
        `(\\b[a-zA-Z_$][a-zA-Z0-9_$]*(?=\\s*\\())`, // 7. Functions
        `(=>|&&|\\|\\||[{}()\\[\\].;+\\-*/%&|^!=<>:~?]+)` // 8. Operators & brackets
    ].join('|'), 'g');

    let html = "";
    let lastIndex = 0;
    let match;

    while ((match = tokenRegex.exec(raw)) !== null) {
        if (match.index > lastIndex) {
            html += escapeHtml(raw.substring(lastIndex, match.index));
        }

        const tokenText = match[0];
        let tokenClass = "";

        if (match[1]) tokenClass = "hl-comment";
        else if (match[2]) tokenClass = "hl-string";
        else if (match[3]) tokenClass = "hl-regex";
        else if (match[4]) tokenClass = "hl-number";
        else if (match[5]) tokenClass = "hl-keyword";
        else if (match[6]) tokenClass = "hl-builtin";
        else if (match[7]) tokenClass = "hl-function";
        else if (match[8]) tokenClass = "hl-operator";

        if (tokenClass) {
            html += `<span class="${tokenClass}">${escapeHtml(tokenText)}</span>`;
        } else {
            html += escapeHtml(tokenText);
        }

        lastIndex = tokenRegex.lastIndex;
    }

    if (lastIndex < raw.length) {
        html += escapeHtml(raw.substring(lastIndex));
    }
    return html;
}

function highlightJson(code) {
    const raw = unescapeHtml(code);
    const tokenRegex = new RegExp([
        `(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*)`, // 1. Comments
        `("(?:\\\\.|[^"\\\\])*"(?=\\s*:))`, // 2. JSON Keys
        `("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`)`, // 3. Strings
        `(\\b\\d+(?:\\.\\d+)?\\b)`, // 4. Numbers
        `(\\b(?:true|false|null)\\b)`, // 5. JSON values/booleans
        `([{}()\\[\\].;+\\-*/%&|^!=<>:~?]+)` // 6. Operators & brackets
    ].join('|'), 'g');

    let html = "";
    let lastIndex = 0;
    let match;

    while ((match = tokenRegex.exec(raw)) !== null) {
        if (match.index > lastIndex) {
            html += escapeHtml(raw.substring(lastIndex, match.index));
        }

        const tokenText = match[0];
        let tokenClass = "";

        if (match[1]) tokenClass = "hl-comment";
        else if (match[2]) tokenClass = "hl-json-key";
        else if (match[3]) tokenClass = "hl-string";
        else if (match[4]) tokenClass = "hl-number";
        else if (match[5]) tokenClass = "hl-json-value";
        else if (match[6]) tokenClass = "hl-operator";

        if (tokenClass) {
            html += `<span class="${tokenClass}">${escapeHtml(tokenText)}</span>`;
        } else {
            html += escapeHtml(tokenText);
        }

        lastIndex = tokenRegex.lastIndex;
    }

    if (lastIndex < raw.length) {
        html += escapeHtml(raw.substring(lastIndex));
    }
    return html;
}

function highlightHtml(code) {
    const raw = unescapeHtml(code);
    const tokenRegex = new RegExp([
        `(<!--[\\s\\S]*?-->)`, // 1. Comments
        `(<\\/?[a-zA-Z0-9:-]+(?=>|\\s))`, // 2. Tags
        `(\\b[a-zA-Z-]+(?=\\s*=))`, // 3. Attributes
        `("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*')` // 4. Attribute values
    ].join('|'), 'g');

    let html = "";
    let lastIndex = 0;
    let match;

    while ((match = tokenRegex.exec(raw)) !== null) {
        if (match.index > lastIndex) {
            html += escapeHtml(raw.substring(lastIndex, match.index));
        }

        const tokenText = match[0];
        let tokenClass = "";

        if (match[1]) tokenClass = "hl-comment";
        else if (match[2]) tokenClass = "hl-keyword";
        else if (match[3]) tokenClass = "hl-builtin";
        else if (match[4]) tokenClass = "hl-string";

        if (tokenClass) {
            html += `<span class="${tokenClass}">${escapeHtml(tokenText)}</span>`;
        } else {
            html += escapeHtml(tokenText);
        }

        lastIndex = tokenRegex.lastIndex;
    }

    if (lastIndex < raw.length) {
        html += escapeHtml(raw.substring(lastIndex));
    }
    return html;
}

function highlightCss(code) {
    const raw = unescapeHtml(code);
    const tokenRegex = new RegExp([
        `(\\/\\*[\\s\\S]*?\\*\\/)`, // 1. Comments
        `(\\b[a-zA-Z-]+(?=\\s*:))`, // 2. Properties
        `("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*')` // 3. Strings
    ].join('|'), 'g');

    let html = "";
    let lastIndex = 0;
    let match;

    while ((match = tokenRegex.exec(raw)) !== null) {
        if (match.index > lastIndex) {
            html += escapeHtml(raw.substring(lastIndex, match.index));
        }

        const tokenText = match[0];
        let tokenClass = "";

        if (match[1]) tokenClass = "hl-comment";
        else if (match[2]) tokenClass = "hl-builtin";
        else if (match[3]) tokenClass = "hl-string";

        if (tokenClass) {
            html += `<span class="${tokenClass}">${escapeHtml(tokenText)}</span>`;
        } else {
            html += escapeHtml(tokenText);
        }

        lastIndex = tokenRegex.lastIndex;
    }

    if (lastIndex < raw.length) {
        html += escapeHtml(raw.substring(lastIndex));
    }
    return html;
}

function highlightCode(code, lang) {
    if (!code) return "";
    if (!lang) return escapeHtml(unescapeHtml(code));

    const cleanLang = lang.trim().toLowerCase();

    if (cleanLang === "json") {
        return highlightJson(code);
    } else if (cleanLang === "javascript" || cleanLang === "js" || cleanLang === "extendscript" || cleanLang === "jsx") {
        return highlightJavascript(code);
    } else if (cleanLang === "html" || cleanLang === "xml") {
        return highlightHtml(code);
    } else if (cleanLang === "css") {
        return highlightCss(code);
    }

    return escapeHtml(unescapeHtml(code));
}
