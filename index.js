/**
 * ArcEditor UI Controller Entry Point
 * Handles frontend user interface renderings, DOM inputs, scroll position updates,
 * event delegator listeners, settings drawers, and tab navigation.
 */

document.addEventListener("DOMContentLoaded", async () => {
    // 1. Initialize UI elements and event listeners first to ensure input/buttons are interactive immediately
    try {
        initUI();
    } catch (e) {
        console.error("UI Initialization failed:", e);
    }

    // 2. Load configurations and states resiliently
    try {
        await loadSettings();
    } catch (e) {
        console.error("Failed to load settings:", e);
    }
    
    try {
        await loadChats();
    } catch (e) {
        console.error("Failed to load chats:", e);
    }

    // 3. Kick off async integrations and background syncs resiliently
    try {
        validateConnection();
    } catch (e) {
        console.error("Failed to validate connection:", e);
    }

    // Defer any ExtendScript bridge calls by 2 seconds to let After Effects fully initialize and prevent CEP deadlocks
    setTimeout(() => {
        try {
            syncProjectPath();
        } catch (e) {
            console.error("Failed to sync project path:", e);
        }

        try {
            loadInstalledEffects();
        } catch (e) {
            console.error("Failed to load installed effects:", e);
        }
    }, 2000);

    try {
        updateContextSizeInfo();
    } catch (e) {
        console.error("Failed to update context size:", e);
    }

    // Auto-sync active AE project file path periodically
    setInterval(syncProjectPath, 5000);
});

// --- SECTION 8: USER INTERFACE RENDERERS & EVENT BINDINGS ---
function initUI() {
    const btnSettings = document.getElementById("btn-settings");
    const btnCloseSettings = document.getElementById("btn-close-settings");
    const formSettings = document.getElementById("form-settings");
    const tabChat = document.getElementById("tab-chat");
    const tabConsole = document.getElementById("tab-console");
    const tabDebug = document.getElementById("tab-debug");
    const chatInput = document.getElementById("chat-input");
    const btnSend = document.getElementById("btn-send");
    const btnClearConsole = document.getElementById("btn-clear-console");
    const btnRemoveAttachment = document.getElementById("btn-remove-attachment");

    // Quick Chips
    const chipCapture = document.getElementById("chip-capture");

    btnSettings.addEventListener("click", () => toggleSettingsDrawer(true));
    btnCloseSettings.addEventListener("click", () => toggleSettingsDrawer(false));
    formSettings.addEventListener("submit", saveSettings);

    tabChat.addEventListener("click", () => switchTab("chat"));
    tabConsole.addEventListener("click", () => switchTab("console"));
    if (tabDebug) {
        tabDebug.addEventListener("click", () => switchTab("debug"));
    }

    const btnClearDebug = document.getElementById("btn-clear-debug");
    if (btnClearDebug) {
        btnClearDebug.addEventListener("click", () => {
            const debugOutput = document.getElementById("debug-output");
            if (debugOutput) debugOutput.value = "";
            addSystemMessage("Debug logs cleared.");
        });
    }

    const btnCopyDebug = document.getElementById("btn-copy-debug");
    if (btnCopyDebug) {
        btnCopyDebug.addEventListener("click", async () => {
            const debugOutput = document.getElementById("debug-output");
            if (debugOutput && debugOutput.value) {
                try {
                    await copyToClipboard(debugOutput.value);
                    addSystemMessage("Debug logs copied to clipboard!");
                } catch (err) {
                    addSystemMessage("Failed to copy logs.");
                }
            }
        });
    }

    btnClearConsole.addEventListener("click", () => {
        const output = document.getElementById("console-output");
        if (output.tagName === "TEXTAREA") {
            output.value = "";
        } else if (output.querySelector("code")) {
            output.querySelector("code").innerText = "// Code cleared. Run a command in Chat.";
        }
    });

    const btnRunConsole = document.getElementById("btn-run-console");
    if (btnRunConsole) {
        btnRunConsole.addEventListener("click", async () => {
            const output = document.getElementById("console-output");
            const code = output.tagName === "TEXTAREA" ? output.value : output.querySelector("code").innerText;
            if (!code.trim()) {
                addSystemMessage("Console is empty. Type some ExtendScript to run.");
                return;
            }
            addSystemMessage("Executing custom ExtendScript...");
            const prependedCode = `var ArcEditor = $._com_arceditor_ ? $._com_arceditor_.ArcEditor : null;
var ArcJSON = $._com_arceditor_ ? $._com_arceditor_.ArcJSON : null;
var ArcInspector = $._com_arceditor_ ? $._com_arceditor_.ArcInspector : null;
var ArcCanvas = $._com_arceditor_ ? $._com_arceditor_.ArcCanvas : null;
var JSON = ArcJSON;
${code}`;
            const result = await evalScriptAsync(prependedCode);
            addSystemMessage(`Console Exec Result: ${result}`);
        });
    }

    btnRemoveAttachment.addEventListener("click", clearAttachmentDock);

    chipCapture.addEventListener("click", captureCompositionFrame);

    const chipCaptureSequence = document.getElementById("chip-capture-sequence");
    if (chipCaptureSequence) {
        chipCaptureSequence.addEventListener("click", async () => {
            if (isExecuting) return;
            isExecuting = true;
            setUIReadyState(false);
            try {
                await captureCompositionSequence(null, null, 5, false);
            } finally {
                isExecuting = false;
                setUIReadyState(true);
            }
        });
    }

    const chipInspect = document.getElementById("chip-inspect");
    if (chipInspect) {
        chipInspect.addEventListener("click", async () => {
            if (isExecuting) return;
            addBubble("user", "Test Timeline Connection");
            addSystemMessage("Loading active timeline context...");
            const context = await getTimelineContext();
            if (context.error) {
                addBubble("ai", `Timeline Inspector failed:\n\n${context.error}`);
            } else {
                addBubble("ai", `Successfully connected to After Effects! Active Comp: **${context.name}** (${context.width}x${context.height}, ${context.frameRate} fps). Layers: **${context.numLayers}**.`);
            }
        });
    }

    const btnInspectComp = document.getElementById("btn-inspect-comp");
    if (btnInspectComp) {
        btnInspectComp.addEventListener("click", async () => {
            toggleSettingsDrawer(false); // Close settings drawer to let user see chat messages
            addBubble("user", "Test Timeline Connection");
            addSystemMessage("Loading active timeline context...");
            const context = await getTimelineContext();
            if (context.error) {
                addBubble("ai", `Timeline Inspector failed:\n\n${context.error}`);
            } else {
                addBubble("ai", `Successfully connected to After Effects! Active Comp: **${context.name}** (${context.width}x${context.height}, ${context.frameRate} fps). Layers: **${context.numLayers}**.`);
            }
        });
    }

    // Auto-resize chat input textarea and update context count
    chatInput.addEventListener("input", function () {
        this.style.height = "auto";
        this.style.height = (this.scrollHeight - 6) + "px";
        btnSend.disabled = !this.value.trim();
        updateContextSizeInfo();
    });

    btnSend.addEventListener("click", triggerUserMessage);
    const btnStop = document.getElementById("btn-stop");
    if (btnStop) {
        btnStop.addEventListener("click", () => {
            if (typeof stopAgentExecution === "function") {
                stopAgentExecution();
            }
        });
    }
    chatInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            triggerUserMessage();
        }
    });

    // Chat Sessions Dropdown Selector
    const selectSession = document.getElementById("select-chat-session");
    if (selectSession) {
        selectSession.addEventListener("change", (e) => {
            if (e.target.value === "new") {
                createNewSession();
            } else {
                loadSessionHistory(e.target.value);
            }
        });
    }

    const btnDeleteSession = document.getElementById("btn-delete-session");
    if (btnDeleteSession) {
        btnDeleteSession.addEventListener("click", deleteSession);
    }

    // Copy Bubble Text & Toggle Tool View Event Delegation
    const chatMessages = document.getElementById("chat-messages");
    if (chatMessages) {
        chatMessages.addEventListener("click", async (e) => {
            // 1. Copy bubble content
            const btn = e.target.closest(".copy-bubble-btn");
            if (btn) {
                const messageDiv = btn.closest(".message");
                if (messageDiv) {
                    const textToCopy = messageDiv.getAttribute("data-raw-text");
                    if (textToCopy) {
                        try {
                            await copyToClipboard(textToCopy);
                            btn.classList.add("copied");
                            const copyIcon = btn.querySelector(".copy-icon");
                            const checkIcon = btn.querySelector(".check-icon");
                            if (copyIcon && checkIcon) {
                                copyIcon.style.display = "none";
                                checkIcon.style.display = "block";
                            }
                            setTimeout(() => {
                                btn.classList.remove("copied");
                                if (copyIcon && checkIcon) {
                                    copyIcon.style.display = "block";
                                    checkIcon.style.display = "none";
                                }
                            }, 1000);
                        } catch (err) {
                            console.error("Failed to copy text: ", err);
                        }
                    }
                }
                return;
            }

            // 2. Toggle tool view (Visual table vs Raw JSON)
            const toggleBtn = e.target.closest(".toggle-tool-view-btn");
            if (toggleBtn) {
                const card = toggleBtn.closest(".tool-call-card");
                if (card) {
                    const tableWrap = card.querySelector(".tool-params-table-wrap");
                    const jsonWrap = card.querySelector(".tool-raw-json-wrap");
                    if (tableWrap && jsonWrap) {
                        const isVisual = tableWrap.style.display !== "none";
                        tableWrap.style.display = isVisual ? "none" : "block";
                        jsonWrap.style.display = isVisual ? "block" : "none";
                        toggleBtn.innerText = isVisual ? "Show Visual" : "Show JSON";
                    }
                }
                return;
            }

            // 3. User manually toggled reasoning details block
            const reasoningSummary = e.target.closest(".reasoning-details summary");
            if (reasoningSummary) {
                const details = reasoningSummary.closest(".reasoning-details");
                if (details) {
                    const willBeOpen = !details.hasAttribute("open");
                    window._userReasoningState = willBeOpen;
                    window._userToggledReasoning = true;
                }
            }
        });
    }
}

async function copyToClipboard(text) {
    // Premium CEP/Node-integrated clipboard copier
    if (typeof require !== "undefined") {
        try {
            const child_process = require("child_process");
            const os = require("os");
            const platform = os.platform();

            if (platform === "win32" || platform === "darwin") {
                const cmd = platform === "win32" ? "clip" : "pbcopy";
                await new Promise((resolve, reject) => {
                    const proc = child_process.exec(cmd, (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                    proc.stdin.write(text);
                    proc.stdin.end();
                });
                return;
            }
        } catch (err) {
            console.error("Node-based clipboard copy failed, falling back to browser API: ", err);
        }
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
    }
    // Fallback for environments where navigator.clipboard might not be fully functional
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
        const success = document.execCommand("copy");
        if (!success) throw new Error("copy command returned false");
    } catch (err) {
        console.error("Clipboard copy fallback failed", err);
        throw err;
    } finally {
        document.body.removeChild(textarea);
    }
}

function toggleSettingsDrawer(open) {
    const drawer = document.getElementById("settings-drawer");
    if (open) {
        drawer.classList.remove("hidden");
    } else {
        drawer.classList.add("hidden");
    }
}

function switchTab(tab) {
    document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
    document.querySelectorAll(".view-pane").forEach(pane => pane.classList.remove("active"));

    document.getElementById(`tab-${tab}`).classList.add("active");
    document.getElementById(`pane-${tab}`).classList.add("active");
}

function triggerUserMessage() {
    const input = document.getElementById("chat-input");
    const userText = input.value.trim();
    if (!userText || isExecuting) return;

    window._userToggledReasoning = false;
    window._userReasoningState = false;

    addBubble("user", userText, attachedFrames);
    input.value = "";
    input.style.height = "auto";

    isExecuting = true;
    setUIReadyState(false);

    runAgenticExecutionLoop(userText);
}

function scrollToBottom(force = false) {
    const scroller = document.getElementById("chat-messages");
    if (!scroller) return;

    // Check if the scrollbar is currently at the bottom (within a 40px tolerance)
    const isAtBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 40;

    if (force || isAtBottom) {
        scroller.scrollTop = scroller.scrollHeight;
    }
}

function addBubble(sender, text, base64Images = null, intermediateTurns = null) {
    const scroller = document.getElementById("chat-messages");
    const id = "bubble-" + Date.now();

    const wrapper = document.createElement("div");
    wrapper.id = id;
    wrapper.className = `message ${sender}`;

    const content = document.createElement("div");
    content.className = "message-content";
    if (text.indexOf("dots-loader") !== -1) {
        content.innerHTML = text; // Bypass markdown formatting for raw loader elements
        wrapper.setAttribute("data-raw-text", "");
    } else {
        let htmlContent = "";
        if (intermediateTurns) {
            if (typeof intermediateTurns === "string") {
                htmlContent += intermediateTurns;
            } else if (Array.isArray(intermediateTurns)) {
                htmlContent += renderTurnsHtml(intermediateTurns);
            }
        }
        htmlContent += formatMarkdown(text);
        content.innerHTML = htmlContent;
        wrapper.setAttribute("data-raw-text", text);
    }

    if (base64Images) {
        const imagesArray = Array.isArray(base64Images) ? base64Images : [base64Images];
        if (imagesArray.length > 0) {
            const containerWrap = document.createElement("div");
            containerWrap.className = "bubble-images-container";
            containerWrap.style.display = "flex";
            containerWrap.style.flexWrap = "wrap";
            containerWrap.style.gap = "6px";
            containerWrap.style.marginTop = "6px";

            imagesArray.forEach((imgData, index) => {
                const imgWrap = document.createElement("div");
                imgWrap.className = "bubble-image-wrap";
                imgWrap.style.marginTop = "0"; // Reset margin since container has gap
                imgWrap.innerHTML = `<img src="data:image/png;base64,${imgData}" alt="User attachment ${index + 1}" />`;
                containerWrap.appendChild(imgWrap);
            });
            content.appendChild(containerWrap);
        }
    }

    wrapper.appendChild(content);

    // Add Copy Button for user prompts and agent responses
    if (sender === "user" || sender === "ai") {
        const copyBtn = document.createElement("button");
        copyBtn.className = "copy-bubble-btn";
        copyBtn.setAttribute("title", "Copy raw text");
        copyBtn.innerHTML = `
            <svg class="copy-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <svg class="check-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="var(--text-success)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display: none;">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
        `;
        wrapper.appendChild(copyBtn);
    }

    scroller.appendChild(wrapper);
    scrollToBottom(true);

    return id;
}

function addSystemMessage(text) {
    const scroller = document.getElementById("chat-messages");
    const wrapper = document.createElement("div");
    wrapper.className = "message system-msg";

    const content = document.createElement("div");
    content.className = "message-content";
    content.innerHTML = `<p>${text}</p>`;

    wrapper.appendChild(content);
    scroller.appendChild(wrapper);
    scrollToBottom(true);
}

let tokenCountTimeout = null;
let currentTrueTokens = null;

function estimateTrueTokens(text) {
    if (!text) return 0;
    // Count indentation blocks (each group of 2-4 spaces is roughly 1 token in BPE tokenizers)
    const spaces = text.match(/ {2,4}/g) || [];
    let count = spaces.length;

    // Remove the counted indentation spaces to avoid double counting
    const cleanedText = text.replace(/ {2,4}/g, '');

    // Tokenize remaining words, identifiers, and individual code delimiters
    const words = cleanedText.match(/[\w]+|[^\s\w]/g) || [];
    for (const token of words) {
        if (/^[^\s\w]$/.test(token)) {
            // Code punctuation symbols ({}, [], (), operators, semicolons) are usually 1 token each
            count += 1;
        } else {
            // Alphanumeric words and camelCase/snake_case programming identifiers
            if (token.length > 4) {
                count += Math.ceil(token.length / 3.5);
            } else {
                count += 1;
            }
        }
    }
    // Newlines often represent distinct splits in token configurations
    const newlines = (text.match(/\n/g) || []).length;
    count += newlines * 0.5;

    return Math.round(count);
}

function updateContextSizeInfo() {
    const metaElement = document.getElementById("input-meta-info");
    if (!metaElement) return;

    const inputText = document.getElementById("chat-input").value;

    // Reconstruct prospective messages payload (including text input and attachments)
    const prospectiveHistory = [...chatHistory];
    if (inputText.trim()) {
        if (attachedFrames && attachedFrames.length > 0) {
            const contentParts = [{ type: "text", text: inputText }];
            attachedFrames.forEach(img => {
                contentParts.push({ type: "image_url", image_url: { url: `data:image/png;base64,${img}` } });
            });
            prospectiveHistory.push({
                role: "user",
                content: contentParts
            });
        } else {
            prospectiveHistory.push({ role: "user", content: inputText });
        }
    }

    // Calculate characters and assemble text for local estimation
    let totalChars = 0;
    let textForEstimation = "";
    for (const msg of prospectiveHistory) {
        if (typeof msg.content === "string") {
            totalChars += msg.content.length;
            textForEstimation += msg.content + "\n";
        } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part.type === "text" && part.text) {
                    totalChars += part.text.length;
                    textForEstimation += part.text + "\n";
                } else if (part.type === "image_url" && part.image_url && part.image_url.url) {
                    totalChars += part.image_url.url.length;
                }
            }
        }
    }

    // High-fidelity BPE token estimation
    let estTokens = estimateTrueTokens(textForEstimation);

    // Scan entire prospective history to add standard 258 tokens for every single image block found
    let imageBlocksCount = 0;
    for (const msg of prospectiveHistory) {
        if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part.type === "image_url") {
                    imageBlocksCount++;
                }
            }
        }
    }
    estTokens += imageBlocksCount * 258;

    let usageTag = "";
    if (typeof lastApiUsage !== "undefined" && lastApiUsage) {
        usageTag = ` | Last API Usage: ${lastApiUsage.promptTokens.toLocaleString()} prompt + ${lastApiUsage.completionTokens.toLocaleString()} completion tokens`;
    }

    // Initial render with high-fidelity BPE estimation
    metaElement.innerText = `Context: ${totalChars.toLocaleString()} chars (~${estTokens.toLocaleString()} tokens)${usageTag}`;
}

function renderAttachmentDock() {
    const previewContainer = document.getElementById("frame-attachment-preview");
    const dockThumbnails = document.getElementById("dock-thumbnails");
    if (!dockThumbnails || !previewContainer) return;

    dockThumbnails.innerHTML = "";
    if (!attachedFrames || attachedFrames.length === 0) {
        previewContainer.classList.add("hidden");
        return;
    }

    attachedFrames.forEach((base64Data, idx) => {
        const wrap = document.createElement("div");
        wrap.className = "dock-img-wrap";

        const img = document.createElement("img");
        img.src = `data:image/png;base64,${base64Data}`;
        img.alt = `Frame ${idx + 1}`;

        const btn = document.createElement("button");
        btn.className = "close-badge";
        btn.innerHTML = "&times;";
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            attachedFrames.splice(idx, 1);
            renderAttachmentDock();
            updateContextSizeInfo();
        });

        wrap.appendChild(img);
        wrap.appendChild(btn);
        dockThumbnails.appendChild(wrap);
    });

    previewContainer.classList.remove("hidden");
    updateContextSizeInfo();
}

function clearAttachmentDock() {
    attachedFrames = [];
    const dockThumbnails = document.getElementById("dock-thumbnails");
    if (dockThumbnails) dockThumbnails.innerHTML = "";
    document.getElementById("frame-attachment-preview").classList.add("hidden");
    updateContextSizeInfo();
}

function updateConsolePane(code) {
    const output = document.getElementById("console-output");
    if (output.tagName === "TEXTAREA") {
        output.value = code;
    } else if (output.querySelector("code")) {
        output.querySelector("code").innerText = code;
    }
}

function setUIReadyState(ready) {
    const chatInput = document.getElementById("chat-input");
    const btnSend = document.getElementById("btn-send");
    const selectSession = document.getElementById("select-chat-session");
    const btnDeleteSession = document.getElementById("btn-delete-session");
    const chipCapture = document.getElementById("chip-capture");
    const chipCaptureSequence = document.getElementById("chip-capture-sequence");
    const chipInspect = document.getElementById("chip-inspect");
    const btnSettings = document.getElementById("btn-settings");
    const btnInspectComp = document.getElementById("btn-inspect-comp");

    if (chatInput) {
        chatInput.disabled = !ready;
        if (!ready) {
            chatInput.placeholder = "Agent is active... please wait";
        } else {
            chatInput.placeholder = "Ask Arc to edit, splice, or animate...";
        }
    }
    const btnStop = document.getElementById("btn-stop");
    if (ready) {
        if (btnSend) {
            btnSend.classList.remove("hidden");
            btnSend.disabled = !chatInput.value.trim();
        }
        if (btnStop) btnStop.classList.add("hidden");
    } else {
        if (btnSend) btnSend.classList.add("hidden");
        if (btnStop) btnStop.classList.remove("hidden");
    }
    if (selectSession) selectSession.disabled = !ready;
    if (btnDeleteSession) btnDeleteSession.disabled = !ready;
    if (chipCapture) chipCapture.disabled = !ready;
    if (chipCaptureSequence) chipCaptureSequence.disabled = !ready;
    if (chipInspect) chipInspect.disabled = !ready;
    if (btnSettings) btnSettings.disabled = !ready;
    if (btnInspectComp) btnInspectComp.disabled = !ready;

    // Apply transient style classes for visual execution lock feedback
    const quickUtilities = document.querySelector(".quick-utilities");
    if (quickUtilities) {
        if (!ready) {
            quickUtilities.style.opacity = "0.5";
            quickUtilities.style.pointerEvents = "none";
        } else {
            quickUtilities.style.opacity = "1";
            quickUtilities.style.pointerEvents = "auto";
        }
    }
}
