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
                const idMatch = elem.id.match(/details-turn-(\d+)/);
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

function tryFormatToolCall(code, isStreaming) {
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
        if (!parsed) return null;

        const calls = Array.isArray(parsed) ? parsed : [parsed];

        // Validate if this actually looks like a tool call sequence
        const isValid = calls.every(c => c && typeof c === "object" && typeof c.tool === "string");
        if (!isValid) return null;

        let html = `<div class="tool-calls-container">`;
        calls.forEach((call, index) => {
            const params = call.parameters || {};
            let paramsHtml = "";
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
                    if (key === "script" || valStr.indexOf("\n") !== -1) {
                        displayHtml = `<pre class="param-value-code"><code>${escapedValStr}</code></pre>`;
                    } else {
                        displayHtml = escapedValStr;
                    }
                    paramsHtml += `<tr><td class="param-key">${key}</td><td class="param-value">${displayHtml}</td></tr>`;
                });
                paramsHtml += `</table>`;
            } else {
                paramsHtml = `<div class="tool-no-params">No parameters</div>`;
            }

            const cardId = "tool-card-" + Date.now() + "-" + index;
            const rawJsonHtml = `<pre class="code-viewport"><code>${JSON.stringify(call, null, 2)}</code></pre>`;

            html += `
                <div class="tool-call-card" id="${cardId}">
                    <div class="tool-call-header">
                        <span class="tool-badge">Tool Call${isStreaming ? ' (Streaming...)' : ''}</span>
                        <span class="tool-name">${call.tool}</span>
                        <button class="toggle-tool-view-btn">Show JSON</button>
                    </div>
                    <div class="tool-call-body">
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
    } catch (e) {
        return null;
    }
}

function renderTurnsHtml(turns, openTurnNums) {
    if (!turns || turns.length === 0) return "";
    let html = "";
    for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];
        const isOpen = openTurnNums && openTurnNums.indexOf(turn.turnNum) !== -1;
        const openAttr = isOpen ? " open" : "";
        const imagesHtml = renderTurnImagesHtml(turn.images);

        if (turn.type === "failed") {
            html += `
            <details class="agent-turn-details" id="details-turn-${turn.turnNum}" style="border-color: var(--text-error);"${openAttr}>
                <summary class="agent-turn-summary" style="background-color: rgba(255, 68, 68, 0.15);">
                    <span class="turn-index-badge" style="background-color: var(--text-error); color: white;">Turn ${turn.turnNum}</span>
                    <span class="turn-title" style="color: var(--text-error);">${turn.turnTitle}</span>
                </summary>
                <div class="agent-turn-body">
                    ${formatMarkdown(turn.llmResponse)}
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
            <details class="agent-turn-details" id="details-turn-${turn.turnNum}"${openAttr}>
                <summary class="agent-turn-summary">
                    <span class="turn-index-badge">Turn ${turn.turnNum}</span>
                    <span class="turn-title">${turn.turnTitle}</span>
                </summary>
                <div class="agent-turn-body">
                    ${formatMarkdown(turn.llmResponse)}
                    ${imagesHtml}
                    <div class="turn-observations">
                        <strong>Observations:</strong>
                        <pre class="observation-pre">${turn.observations}</pre>
                    </div>
                </div>
            </details>
            `;
        }
    }
    return html;
}

function formatMarkdown(text) {
    if (!text) return "";

    // Escape HTML special characters safely
    let html = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    const preBlocks = [];
    const parts = html.split("```");
    let rebuiltHtml = "";

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
                const formatted = tryFormatToolCall(code, !isClosed);
                if (formatted) {
                    renderedBlock = formatted;
                } else {
                    renderedBlock = `<pre class="code-viewport"><code>${code}</code></pre>`;
                }
            } else if (lang === "javascript" || lang === "js" || lang === "extendscript" || lang === "jsx") {
                renderedBlock = `
                <details class="jsx-code-details" ${!isClosed ? 'open' : ''}>
                    <summary class="jsx-code-summary">ExtendScript JSX Code Block${!isClosed ? ' (Streaming...)' : ''}</summary>
                    <pre class="code-viewport"><code>${code}</code></pre>
                </details>
                `;
            } else {
                let displayCode = code;
                if (firstNewline === -1) {
                    displayCode = block;
                }
                renderedBlock = `<pre class="code-viewport"><code>${displayCode}</code></pre>`;
            }

            preBlocks.push(renderedBlock);
            rebuiltHtml += `__PRE_BLOCK_${preBlocks.length - 1}__`;
        }
    }

    html = rebuiltHtml;

    // Process the text paragraph by paragraph
    const paragraphs = html.split(/\n\n+/);
    const processedParagraphs = paragraphs.map(p => {
        let trimmed = p.trim();
        if (!trimmed) return "";

        // Check if it's a pre-extracted block
        if (trimmed.indexOf("__PRE_BLOCK_") === 0) {
            return trimmed;
        }

        // Process headings
        if (trimmed.startsWith("#")) {
            return trimmed
                .replace(/^###### (.*?)$/gm, "<h6>$1</h6>")
                .replace(/^##### (.*?)$/gm, "<h5>$1</h5>")
                .replace(/^#### (.*?)$/gm, "<h4>$1</h4>")
                .replace(/^### (.*?)$/gm, "<h3>$1</h3>")
                .replace(/^## (.*?)$/gm, "<h2>$1</h2>")
                .replace(/^# (.*?)$/gm, "<h1>$1</h1>");
        }

        // Process list items
        if (/^\s*[-*+]\s+/.test(trimmed) || /^\s*\d+\.\s+/.test(trimmed)) {
            return trimmed
                .replace(/^\s*[-*+]\s+(.*?)$/gm, "<div class='bullet-item'>• $1</div>")
                .replace(/^\s*(\d+)\.\s+(.*?)$/gm, "<div class='bullet-item'>$1. $2</div>");
        }

        // Standard text paragraph
        // Replace single newlines with <br> for soft breaks
        let pText = trimmed.replace(/\n/g, "<br>");
        return `<p>${pText}</p>`;
    });

    let result = processedParagraphs.join("\n");

    // Restore pre blocks
    result = result.replace(/__PRE_BLOCK_(\d+)__/g, (match, index) => {
        return preBlocks[parseInt(index, 10)];
    });

    // Inline formatting: Bold, Italic, Code
    result = result
        .replace(/\*\*((?:(?!<br>)[^\*])+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*((?:(?!<br>)[^\*])+?)\*/g, "<em>$1</em>")
        .replace(/`([^`]+)`/g, "<code>$1</code>");

    // Clean up empty paragraphs
    result = result.replace(/<p><\/p>/g, "");

    // Process agent reasoning thinking blocks
    result = result.replace(/&lt;thinking&gt;([\s\S]*?)&lt;\/thinking&gt;/g, (match, thoughts) => {
        return `<details class="reasoning-details"><summary>Reasoning / Assembly Plan</summary><div class="reasoning-content">${thoughts}</div></details>`;
    });

    result = result.replace(/&lt;thinking&gt;([\s\S]*?)$/g, (match, thoughts) => {
        return `<details class="reasoning-details" open><summary>Reasoning / Assembly Plan (Thinking...)</summary><div class="reasoning-content">${thoughts}</div></details>`;
    });

    return result;
}
