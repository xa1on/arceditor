/**
 * ArcEditor Markdown and UI HTML Formatter Module
 * Handles HTML escaping, markdown conversions, tool call table formatting, and detailed turn wrappers.
 */

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
    const lines = observations.split("\n");
    const results = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.indexOf('- Tool "') === 0) {
            const closingQuote = line.indexOf('"', 8);
            if (closingQuote !== -1) {
                const tool = line.substring(8, closingQuote);
                const rest = line.substring(closingQuote + 2).trim(); // Skip ": "
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
                results.push({ tool, status, reason });
            }
        }
    }
    return results;
}

function tryFormatToolCall(code, isStreaming, toolStatuses, activeTurn = "default") {
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

            let paramsHtml = "";
            if (parsed) {
                const params = call.parameters || {};
                const paramKeys = Object.keys(params);
                if (paramKeys.length > 0) {
                    paramsHtml = `<table class="tool-params-table">`;
                    paramKeys.forEach(key => {
                        let valStr = "";
                        if (typeof params[key] === "object" && params[key] !== null) {
                            valStr = JSON.stringify(params[key], null, 2);
                        } else {
                            valStr = String(params[key]);
                        }
                        const escapedValStr = valStr
                            .replace(/&/g, "&amp;")
                            .replace(/</g, "&lt;")
                            .replace(/>/g, "&gt;");

                        let displayHtml = "";
                        if (key === "script") {
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

            const cardId = "tool-card-" + activeTurn + "-" + index;
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

            html += `
                <div class="tool-call-card status-${status}" id="${cardId}" data-tool="${call.tool}" data-index="${index}" data-status="${status}">
                    <div class="tool-call-header">
                        <span class="tool-badge">Tool Call${isStreaming ? ' (Streaming...)' : ''}</span>
                        <span class="tool-name">${call.tool || '...'}</span>
                        <span class="tool-status-badge status-${status}">${status}</span>
                        <button class="toggle-tool-view-btn">Show JSON</button>
                    </div>
                    <div class="tool-call-body">
                        ${denialHtml}
                        <div class="tool-params-table-wrap">
                            ${paramsHtml}
                        </div>
                        <div class="tool-raw-json-wrap">
                            ${rawJsonHtml}
                        </div>
                    </div>
                </div>
            `;
        });
        html += `</div>`;
        return html;
    } catch (err) {
        console.error("tryFormatToolCall error:", err);
        return null;
    }
}

function renderTurnsHtml(turns, openTurnNums, bubbleId) {
    if (!turns || turns.length === 0) return "";
    let html = "";
    const prefix = bubbleId ? `${bubbleId}-` : "";
    for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];
        const isOpen = openTurnNums && openTurnNums.indexOf(turn.turnNum) !== -1;
        const openAttr = isOpen ? " open" : "";
        const imagesHtml = renderTurnImagesHtml(turn.images);

        const reasoningHtml = turn.reasoning ? `<details class="reasoning-details" id="reasoning-turn-${prefix}${turn.turnNum}" open><summary>Reasoning / Assembly Plan</summary><div class="reasoning-content">${formatMarkdown(turn.reasoning, turn.turnNum)}</div></details>` : "";
        const contentHtml = formatMarkdown(turn.content !== undefined ? turn.content : turn.llmResponse, turn.turnNum);

        let obsHtml = "";
        if (turn.observations) {
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
                    <div class="turn-observations">
                        <strong style="color: var(--text-error);">Error Observation:</strong>
                        <pre class="observation-pre" style="border-color: var(--text-error); color: var(--text-error) !important;">${turn.observations}</pre>
                    </div>
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
    return html;
}

function formatMarkdown(text, turnNum, observations) {
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
                const formatted = tryFormatToolCall(code, !isClosed, toolStatuses, activeTurn);
                if (formatted) {
                    renderedBlock = formatted;
                } else {
                    renderedBlock = `<pre class="code-viewport"><code>${highlightCode(code, "json")}</code></pre>`;
                }
            } else if (lang === "javascript" || lang === "js" || lang === "extendscript" || lang === "jsx") {
                jsxBlockCount++;
                renderedBlock = `
                <details class="jsx-code-details" id="jsx-code-turn-${activeTurn}-${jsxBlockCount}" ${!isClosed ? 'open' : ''}>
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

            // Calculate indentation styling based on leading spaces
            const leadingSpaces = line.match(/^(\s*)/)[0];
            const indentLevel = leadingSpaces.length;
            const indentStyle = indentLevel > 0 ? ` style="padding-left: ${indentLevel * 16}px;"` : '';

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

            const isBlock = lineHtml.startsWith("<div") || lineHtml.startsWith("<h") || lineHtml.startsWith("<block") || lineHtml.startsWith("<table") || lineHtml.startsWith("<ul") || lineHtml.startsWith("<ol");
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
