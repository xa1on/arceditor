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
        initializeProjectSessions();
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
    }, 2000);

    try {
        updateContextSizeInfo();
    } catch (e) {
        console.error("Failed to update context size:", e);
    }

    // Sync active AE project file path when the panel gets focus
    window.addEventListener("focus", syncProjectPath);

    // Global link click handler for Markdown links
    document.addEventListener("click", (e) => {
        const link = e.target.closest("a");
        if (link) {
            const href = link.getAttribute("href");
            if (href) {
                e.preventDefault();
                openExternalLink(href);
            }
        }
    });

    // Bind chat model select dropdown events
    const chatModelSelect = document.getElementById("chat-model-select");
    if (chatModelSelect) {
        chatModelSelect.addEventListener("change", handleChatModelChange);
        chatModelSelect.addEventListener("mousedown", handleChatModelMousedown);
    } else {
        alert("Debug Error: #chat-model-select not found in DOM!");
    }
    const welcomeChatModelSelect = document.getElementById("welcome-chat-model-select");
    if (welcomeChatModelSelect) {
        welcomeChatModelSelect.addEventListener("change", handleChatModelChange);
        welcomeChatModelSelect.addEventListener("mousedown", handleChatModelMousedown);
    } else {
        alert("Debug Error: #welcome-chat-model-select not found in DOM!");
    }
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

    btnSettings.addEventListener("click", () => {
        toggleSettingsDrawer(true);
        if (typeof populateAndQueryModels === "function") {
            populateAndQueryModels();
        }
        if (typeof renderAllowedToolsList === "function") {
            renderAllowedToolsList();
        }
        if (typeof renderDeniedToolsList === "function") {
            renderDeniedToolsList();
        }
    });
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

    chipCapture.addEventListener("click", () => captureCompositionFrame(false));

    const btnPlus = document.getElementById("btn-plus");
    if (btnPlus) {
        btnPlus.addEventListener("click", () => captureCompositionFrame(false));
    }
    const welcomeBtnPlus = document.getElementById("welcome-btn-plus");
    if (welcomeBtnPlus) {
        welcomeBtnPlus.addEventListener("click", () => captureCompositionFrame(false));
    }

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
        const scrollHeight = this.scrollHeight;
        if (scrollHeight > 52) {
            this.style.height = "52px";
            this.style.overflowY = "auto";
        } else {
            this.style.height = scrollHeight + "px";
            this.style.overflowY = "hidden";
        }
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

    // Welcome Chat Input Auto-resize, Enter key, and Send button bindings
    const welcomeChatInput = document.getElementById("welcome-chat-input");
    const welcomeBtnSend = document.getElementById("welcome-btn-send");
    if (welcomeChatInput && welcomeBtnSend) {
        welcomeChatInput.addEventListener("input", function () {
            this.style.height = "auto";
            const scrollHeight = this.scrollHeight;
            if (scrollHeight > 52) {
                this.style.height = "52px";
                this.style.overflowY = "auto";
            } else {
                this.style.height = scrollHeight + "px";
                this.style.overflowY = "hidden";
            }
            welcomeBtnSend.disabled = !this.value.trim();
        });
        
        welcomeChatInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                triggerWelcomeUserMessage();
            }
        });
        
        welcomeBtnSend.addEventListener("click", triggerWelcomeUserMessage);
    }

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

    const permissionModeSelect = document.getElementById("setting-permission-mode");
    if (permissionModeSelect) {
        permissionModeSelect.addEventListener("change", (e) => {
            updatePermissionModeDescription(e.target.value);
        });
    }
}

window.updatePermissionModeDescription = function(mode) {
    const descEl = document.getElementById("setting-permission-mode-desc");
    if (!descEl) return;
    
    let descText = "";
    if (mode === "permissive") {
        descText = "Allows the agent to run all tool calls automatically, including timeline modifications, without prompting. Tools in the Denied list will be blocked.";
    } else if (mode === "strict") {
        descText = "Prompts for authorization on every single tool call from the agent (including read-only actions), unless they have been explicitly added to the Allowed list.";
    } else {
        descText = "Allows the agent to run read-only composition checks automatically. Non-read-only changes (like creating layers, editing properties) will prompt for your authorization.";
    }
    descEl.innerText = descText;
};

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

function sendUserMessage(userText, isFromWelcome = false) {
    if (!userText || isExecuting) return;

    // Sync project path on demand before starting agent loop
    syncProjectPath();

    window._userToggledReasoning = false;
    window._userReasoningState = false;

    if (isFromWelcome) {
        toggleWelcomeScreen(false, true);
    } else {
        toggleWelcomeScreen(false, false);
    }

    addBubble("user", userText, attachedFrames);
    
    // Clear inputs
    const mainInput = document.getElementById("chat-input");
    const welcomeInput = document.getElementById("welcome-chat-input");
    if (mainInput) {
        mainInput.value = "";
        mainInput.style.height = "20px";
        mainInput.style.overflowY = "hidden";
    }
    if (welcomeInput) {
        welcomeInput.value = "";
        welcomeInput.style.height = "20px";
        welcomeInput.style.overflowY = "hidden";
    }

    isExecuting = true;
    setUIReadyState(false);

    runAgenticExecutionLoop(userText);
}

function triggerUserMessage() {
    const input = document.getElementById("chat-input");
    sendUserMessage(input.value.trim(), false);
}

function triggerWelcomeUserMessage() {
    const input = document.getElementById("welcome-chat-input");
    sendUserMessage(input.value.trim(), true);
}

function toggleWelcomeScreen(isEmpty, animate = false) {
    const welcomeScreen = document.getElementById("welcome-screen");
    const chatMessages = document.getElementById("chat-messages");
    const footer = document.querySelector("footer.app-footer");
    
    if (isEmpty) {
        if (welcomeScreen) {
            welcomeScreen.classList.remove("hidden");
            welcomeScreen.classList.remove("fade-out");
        }
        if (chatMessages) chatMessages.classList.add("hidden");
        if (footer) footer.classList.add("hidden");
    } else {
        if (animate && welcomeScreen && !welcomeScreen.classList.contains("hidden")) {
            // Apply fade transition
            welcomeScreen.classList.add("fade-out");
            
            if (chatMessages) {
                chatMessages.classList.remove("hidden");
                chatMessages.classList.add("fade-in-start");
            }
            if (footer) {
                footer.classList.remove("hidden");
                footer.classList.add("fade-in-start");
            }
            
            // Force repaint
            welcomeScreen.offsetHeight;
            
            if (chatMessages) chatMessages.classList.remove("fade-in-start");
            if (footer) footer.classList.remove("fade-in-start");
            
            setTimeout(() => {
                welcomeScreen.classList.add("hidden");
                welcomeScreen.classList.remove("fade-out");
            }, 200);
        } else {
            // Instant transition
            if (welcomeScreen) {
                welcomeScreen.classList.add("hidden");
                welcomeScreen.classList.remove("fade-out");
            }
            if (chatMessages) {
                chatMessages.classList.remove("hidden");
                chatMessages.classList.remove("fade-in-start");
            }
            if (footer) {
                footer.classList.remove("hidden");
                footer.classList.remove("fade-in-start");
            }
        }
    }
}

// Assign to window for settings.js access
window.toggleWelcomeScreen = toggleWelcomeScreen;

function scrollToBottom(force = false) {
    const scroller = document.getElementById("chat-messages");
    if (!scroller) return;

    // Check if the scrollbar is currently at the bottom (within a 40px tolerance)
    const isAtBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 40;

    if (force || isAtBottom) {
        scroller.scrollTop = scroller.scrollHeight;
    }
}

function addBubble(sender, text, base64Images = null, intermediateTurns = null, reasoning = null) {
    const scroller = document.getElementById("chat-messages");
    const id = "bubble-" + Date.now();

    const wrapper = document.createElement("div");
    wrapper.id = id;
    wrapper.className = `message ${sender}`;

    const content = document.createElement("div");
    content.className = "message-content";
    if (text.indexOf("dots-loader") !== -1) {
        content.innerHTML = `<div class="completed-turns-area"></div><div class="active-turn-area"><div class="active-turn-container"><div class="active-reasoning-area"></div><div class="active-content-area">${text}</div></div></div>`; // Wrap initial loader elements
        wrapper.setAttribute("data-raw-text", "");
    } else {
        let htmlContent = "";
        let turnsHtml = "";
        if (intermediateTurns) {
            if (typeof intermediateTurns === "string") {
                turnsHtml = intermediateTurns;
            } else if (Array.isArray(intermediateTurns)) {
                turnsHtml = renderTurnsHtml(intermediateTurns, null, id);
            }
        }
        htmlContent += `<div class="completed-turns-area">${turnsHtml}</div>`;

        let activeReasoningHtml = "";
        if (reasoning) {
            activeReasoningHtml = `<details class="reasoning-details" id="reasoning-turn-${id}-final" open><summary>Reasoning / Assembly Plan</summary><div class="reasoning-content">${formatMarkdown(reasoning)}</div></details>`;
        }
        let activeContentHtml = formatMarkdown(text);
        
        htmlContent += `<div class="active-turn-area"><div class="active-turn-container"><div class="active-reasoning-area">${activeReasoningHtml}</div><div class="active-content-area">${activeContentHtml}</div></div></div>`;
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
    const prospectiveHistory = [...agentHistory];
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
    const btnSettings = document.getElementById("btn-settings");
    const btnInspectComp = document.getElementById("btn-inspect-comp");
    const welcomeInput = document.getElementById("welcome-chat-input");
    const welcomeBtnSend = document.getElementById("welcome-btn-send");
    const chatModelSelect = document.getElementById("chat-model-select");
    const welcomeModelSelect = document.getElementById("welcome-chat-model-select");
    const btnPlus = document.getElementById("btn-plus");
    const welcomeBtnPlus = document.getElementById("welcome-btn-plus");

    if (chatInput) {
        chatInput.disabled = !ready;
        if (!ready) {
            chatInput.placeholder = "Agent is active... please wait";
        } else {
            chatInput.placeholder = "Ask Arc to edit, splice, or animate...";
        }
    }
    
    if (welcomeInput) {
        welcomeInput.disabled = !ready;
        if (!ready) {
            welcomeInput.placeholder = "Agent is active... please wait";
        } else {
            welcomeInput.placeholder = "Ask Arc to edit, splice, or animate...";
        }
    }

    if (chatModelSelect) chatModelSelect.disabled = !ready;
    if (welcomeModelSelect) welcomeModelSelect.disabled = !ready;
    if (btnPlus) btnPlus.disabled = !ready;
    if (welcomeBtnPlus) welcomeBtnPlus.disabled = !ready;

    const btnStop = document.getElementById("btn-stop");
    if (ready) {
        if (btnSend) {
            btnSend.classList.remove("hidden");
            btnSend.disabled = !chatInput.value.trim();
        }
        if (welcomeBtnSend) {
            welcomeBtnSend.disabled = !welcomeInput || !welcomeInput.value.trim();
        }
        if (btnStop) btnStop.classList.add("hidden");
    } else {
        if (btnSend) btnSend.classList.add("hidden");
        if (btnStop) btnStop.classList.remove("hidden");
        if (welcomeBtnSend) {
            welcomeBtnSend.disabled = true;
        }
    }
    if (selectSession) selectSession.disabled = !ready;
    if (btnDeleteSession) btnDeleteSession.disabled = !ready;
    if (chipCapture) chipCapture.disabled = !ready;
    if (chipCaptureSequence) chipCaptureSequence.disabled = !ready;
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

async function handleChatModelMousedown() {
    try {
        const provider = currentProvider;
        if (!cachedModels[provider]) {
            const url = apiUrl;
            const key = apiKey;
            const currentModelVal = modelName;

            const select = this;
            const loadingOption = document.createElement("option");
            loadingOption.text = "Fetching models...";
            loadingOption.disabled = true;

            // Safe append
            if (select.options.length > 0) {
                select.insertBefore(loadingOption, select.options[0]);
            } else {
                select.appendChild(loadingOption);
            }

            try {
                await updateModelDropdownOptions(provider, url, key, currentModelVal, true);
            } finally {
                try {
                    if (loadingOption.parentNode) {
                        loadingOption.parentNode.removeChild(loadingOption);
                    }
                } catch (e) { }
            }
        }
    } catch (err) {
        console.error("Error in handleChatModelMousedown:", err);
    }
}

async function handleChatModelChange() {
    const select = this;
    let val = select.value;
    if (val === "custom") {
        const custom = prompt("Enter custom model name:");
        if (custom && custom.trim()) {
            val = custom.trim();
        } else {
            select.value = modelName;
            return;
        }
    }

    modelName = val;
    if (providerSettings[currentProvider]) {
        providerSettings[currentProvider].model = val;
    }

    // Update both select values
    const footerSelect = document.getElementById("chat-model-select");
    const welcomeSelect = document.getElementById("welcome-chat-model-select");
    if (footerSelect) {
        let opt = footerSelect.querySelector(`option[value="${val}"]`);
        if (!opt) {
            opt = document.createElement("option");
            opt.value = val;
            opt.text = val;
            const refOpt = footerSelect.options.length > 0 ? footerSelect.options[footerSelect.options.length - 1] : null;
            footerSelect.insertBefore(opt, refOpt);
        }
        footerSelect.value = val;
    }
    if (welcomeSelect) {
        let opt = welcomeSelect.querySelector(`option[value="${val}"]`);
        if (!opt) {
            opt = document.createElement("option");
            opt.value = val;
            opt.text = val;
            const refOpt = welcomeSelect.options.length > 0 ? welcomeSelect.options[welcomeSelect.options.length - 1] : null;
            welcomeSelect.insertBefore(opt, refOpt);
        }
        welcomeSelect.value = val;
    }

    // Save settings immediately
    const config = {
        provider: currentProvider,
        providerSettings: providerSettings,
        model: modelName,
        includeBase64InDebugLog: includeBase64InDebugLog,
        maxToolRetryLimit: maxToolRetryLimit,
        agentPermissionMode: agentPermissionMode
    };

    if (fs) {
        try {
            await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
        } catch (err) {
            console.error("Failed to save settings auto-change:", err);
        }
    }
}

function openExternalLink(url) {
    if (window.cep && window.cep.util && window.cep.util.openURLInDefaultBrowser) {
        window.cep.util.openURLInDefaultBrowser(url);
    } else {
        window.open(url, "_blank");
    }
}

function renderAllowedToolsList() {
    const listContainer = document.getElementById("settings-allowed-tools-list");
    if (!listContainer) return;

    listContainer.innerHTML = "";
    const allowed = getProjectAllowedTools(currentProjectPath);

    if (allowed.length === 0) {
        listContainer.innerHTML = `<div style="font-size: 10px; color: var(--text-secondary); font-style: italic; text-align: center; padding: 4px 0;">No tools allowed permanently yet.</div>`;
        return;
    }

    allowed.forEach(tool => {
        const item = document.createElement("div");
        item.style.display = "flex";
        item.style.alignItems = "center";
        item.style.justifyContent = "space-between";
        item.style.fontSize = "10px";
        item.style.padding = "4px";
        item.style.borderBottom = "1px solid rgba(255, 255, 255, 0.03)";
        item.innerHTML = `
            <span style="font-family: var(--font-mono); color: var(--text-primary);">${tool}</span>
            <button type="button" class="btn-remove-allowed-tool" data-tool="${tool}" style="background: none; border: none; color: var(--text-error); cursor: pointer; font-size: 12px; font-weight: bold; line-height: 1; padding: 0 4px;">&times;</button>
        `;
        listContainer.appendChild(item);
    });

    listContainer.querySelectorAll(".btn-remove-allowed-tool").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const tool = btn.getAttribute("data-tool");
            let list = getProjectAllowedTools(currentProjectPath);
            list = list.filter(t => t !== tool);
            setProjectAllowedTools(currentProjectPath, list);
            renderAllowedToolsList();
        });
    });
}

function renderDeniedToolsList() {
    const listContainer = document.getElementById("settings-denied-tools-list");
    if (!listContainer) return;

    listContainer.innerHTML = "";
    const denied = getProjectDeniedTools(currentProjectPath);

    if (denied.length === 0) {
        listContainer.innerHTML = `<div style="font-size: 10px; color: var(--text-secondary); font-style: italic; text-align: center; padding: 4px 0;">No tools denied permanently yet.</div>`;
        return;
    }

    denied.forEach(tool => {
        const item = document.createElement("div");
        item.style.display = "flex";
        item.style.alignItems = "center";
        item.style.justifyContent = "space-between";
        item.style.fontSize = "10px";
        item.style.padding = "4px";
        item.style.borderBottom = "1px solid rgba(255, 255, 255, 0.03)";
        item.innerHTML = `
            <span style="font-family: var(--font-mono); color: var(--text-primary);">${tool}</span>
            <button type="button" class="btn-remove-denied-tool" data-tool="${tool}" style="background: none; border: none; color: var(--text-error); cursor: pointer; font-size: 12px; font-weight: bold; line-height: 1; padding: 0 4px;">&times;</button>
        `;
        listContainer.appendChild(item);
    });

    listContainer.querySelectorAll(".btn-remove-denied-tool").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const tool = btn.getAttribute("data-tool");
            let list = getProjectDeniedTools(currentProjectPath);
            list = list.filter(t => t !== tool);
            setProjectDeniedTools(currentProjectPath, list);
            renderDeniedToolsList();
        });
    });
}

window.promptUserForToolConfirmation = function(tc) {
    return new Promise((resolve) => {
        const aiBubble = document.getElementById(activeAiBubbleId);
        if (!aiBubble) {
            resolve("allow");
            return;
        }

        const contentDiv = aiBubble.querySelector(".message-content");
        if (!contentDiv) {
            resolve("allow");
            return;
        }

        // Hide executing status loader temporarily
        const activeContainer = contentDiv.querySelector(".active-turn-container");
        let executingLoader = null;
        if (activeContainer) {
            executingLoader = Array.from(activeContainer.children).find(child => 
                child.innerHTML.indexOf("dots-loader") !== -1 || child.innerText.indexOf("Executing Agent Tool Calls") !== -1
            );
            if (executingLoader) {
                executingLoader.style.display = "none";
            }
        }

        const toolName = tc.tool;
        let paramString = "";
        if (toolName === "executeExtendScript" && tc.parameters && tc.parameters.script) {
            paramString = tc.parameters.script;
        } else {
            paramString = JSON.stringify(tc.parameters || {}, null, 2);
        }

        const cardId = "confirm-card-" + Date.now();
        const cardDiv = document.createElement("div");
        cardDiv.id = cardId;
        cardDiv.className = "tool-confirm-card";
        cardDiv.style.marginTop = "8px";
        cardDiv.style.border = "1px solid var(--border-color)";
        cardDiv.style.borderRadius = "var(--border-radius-sm)";
        cardDiv.style.padding = "8px";
        cardDiv.style.background = "var(--bg-surface)";

        cardDiv.innerHTML = `
            <div style="font-weight: 600; font-size: 11px; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                <svg viewBox="0 0 24 24" width="12" height="12" stroke="var(--text-warning)" stroke-width="2.5" fill="none">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
                <span>Confirm Tool Call</span>
            </div>
            <div style="font-size: 10px; color: var(--text-primary); margin-bottom: 6px;">
                Arc wants to run <strong style="font-family: var(--font-mono); font-size: 10px; color: var(--text-accent);">${toolName}</strong>
            </div>
            <details style="margin-bottom: 8px;">
                <summary style="font-size: 9px; color: var(--text-secondary); cursor: pointer; user-select: none;">View parameters</summary>
                <pre style="font-family: var(--font-mono); font-size: 9px; margin-top: 4px; max-height: 120px; overflow: auto; background: var(--bg-input); padding: 4px; border: 1px solid var(--border-color); white-space: pre-wrap; word-break: break-all; color: var(--text-primary);">${paramString}</pre>
            </details>
            <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                <button class="btn-confirm-deny-all" style="flex: 1 1 auto; min-width: 60px; padding: 4px; font-size: 10px; font-weight: 600; cursor: pointer; border: 1px solid var(--border-color); border-radius: var(--border-radius-sm); background: rgba(255, 68, 68, 0.3); color: var(--text-error); border-color: var(--text-error);">Deny All</button>
                <button class="btn-confirm-deny" style="flex: 1 1 auto; min-width: 60px; padding: 4px; font-size: 10px; font-weight: 600; cursor: pointer; border: 1px solid var(--border-color); border-radius: var(--border-radius-sm); background: rgba(255, 68, 68, 0.15); color: var(--text-error); border-color: var(--text-error);">Deny</button>
                <button class="btn-confirm-allow" style="flex: 1 1 auto; min-width: 60px; padding: 4px; font-size: 10px; font-weight: 600; cursor: pointer; border: 1px solid var(--border-color); border-radius: var(--border-radius-sm); background: rgba(20, 115, 230, 0.15); color: var(--text-accent); border-color: var(--text-accent);">Allow</button>
                <button class="btn-confirm-allow-all" style="flex: 1 1 auto; min-width: 60px; padding: 4px; font-size: 10px; font-weight: 600; cursor: pointer; border: 1px solid var(--border-color); border-radius: var(--border-radius-sm); background: rgba(20, 115, 230, 0.3); color: var(--text-accent); border-color: var(--text-accent);">Allow All</button>
            </div>
        `;

        contentDiv.appendChild(cardDiv);
        scrollToBottom(true);

        const btnAllow = cardDiv.querySelector(".btn-confirm-allow");
        const btnAllowAll = cardDiv.querySelector(".btn-confirm-allow-all");
        const btnDeny = cardDiv.querySelector(".btn-confirm-deny");
        const btnDenyAll = cardDiv.querySelector(".btn-confirm-deny-all");

        btnAllow.addEventListener("click", () => {
            cardDiv.innerHTML = `
                <div style="font-size: 10px; color: var(--text-secondary); display: flex; align-items: center; gap: 4px;">
                    <svg viewBox="0 0 24 24" width="12" height="12" stroke="var(--text-success)" stroke-width="2.5" fill="none">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    <span>Allowed tool call: <strong style="font-family: var(--font-mono);">${toolName}</strong></span>
                </div>
            `;
            if (executingLoader) {
                executingLoader.style.display = "";
            }
            resolve("allow");
        });

        btnAllowAll.addEventListener("click", () => {
            cardDiv.innerHTML = `
                <div style="font-size: 10px; color: var(--text-secondary); display: flex; align-items: center; gap: 4px;">
                    <svg viewBox="0 0 24 24" width="12" height="12" stroke="var(--text-accent)" stroke-width="2.5" fill="none">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    <span>Allowed permanently for project: <strong style="font-family: var(--font-mono);">${toolName}</strong></span>
                </div>
            `;
            if (executingLoader) {
                executingLoader.style.display = "";
            }
            resolve("allowAll");
        });

        btnDeny.addEventListener("click", () => {
            cardDiv.innerHTML = `
                <div style="font-size: 10px; color: var(--text-secondary); display: flex; align-items: center; gap: 4px;">
                    <svg viewBox="0 0 24 24" width="12" height="12" stroke="var(--text-error)" stroke-width="2.5" fill="none">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                    <span>Denied tool call: <strong style="font-family: var(--font-mono);">${toolName}</strong></span>
                </div>
            `;
            if (executingLoader) {
                executingLoader.style.display = "";
            }
            resolve("deny");
        });

        btnDenyAll.addEventListener("click", () => {
            cardDiv.innerHTML = `
                <div style="font-size: 10px; color: var(--text-secondary); display: flex; align-items: center; gap: 4px;">
                    <svg viewBox="0 0 24 24" width="12" height="12" stroke="var(--text-error)" stroke-width="2.5" fill="none">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                    <span>Denied permanently for project: <strong style="font-family: var(--font-mono);">${toolName}</strong></span>
                </div>
            `;
            if (executingLoader) {
                executingLoader.style.display = "";
            }
            resolve("denyAll");
        });
    });
};

window.promptUserForQuestions = function(tc) {
    return new Promise((resolve) => {
        const aiBubble = document.getElementById(activeAiBubbleId);
        if (!aiBubble) {
            resolve("Skipped by user (bubble not found)");
            return;
        }

        const contentDiv = aiBubble.querySelector(".message-content");
        if (!contentDiv) {
            resolve("Skipped by user (content container not found)");
            return;
        }

        // Hide executing status loader temporarily
        const activeContainer = contentDiv.querySelector(".active-turn-container");
        let executingLoader = null;
        if (activeContainer) {
            executingLoader = Array.from(activeContainer.children).find(child => 
                child.innerHTML.indexOf("dots-loader") !== -1 || child.innerText.indexOf("Executing Agent Tool Calls") !== -1
            );
            if (executingLoader) {
                executingLoader.style.display = "none";
            }
        }

        const questions = tc.parameters && tc.parameters.questions;
        if (!questions || !Array.isArray(questions) || questions.length === 0) {
            if (executingLoader) executingLoader.style.display = "";
            resolve("No questions provided.");
            return;
        }

        // Append card to contentDiv (same pattern as tool confirmation cards).
        // The card is removed on completion/skip, so it won't persist.
        const cardId = "questions-card-" + Date.now();
        const cardDiv = document.createElement("div");
        cardDiv.id = cardId;
        cardDiv.className = "tool-confirm-card";
        cardDiv.style.marginTop = "8px";
        cardDiv.style.border = "1px solid var(--border-color)";
        cardDiv.style.borderRadius = "var(--border-radius-sm)";
        cardDiv.style.padding = "8px";
        cardDiv.style.background = "var(--bg-surface)";

        contentDiv.appendChild(cardDiv);
        scrollToBottom(true);

        let currentQuestionIdx = 0;
        const answers = [];

        function showQuestion(idx) {
            if (idx >= questions.length) {
                // Formatting response to the model
                const formattedAnswers = answers.map((qAndA) => {
                    let formattedAns = "";
                    if (Array.isArray(qAndA.answer)) {
                        formattedAns = JSON.stringify(qAndA.answer);
                    } else {
                        formattedAns = `"${qAndA.answer}"`;
                    }
                    return `- Question: "${qAndA.question}"\n  Answer: ${formattedAns}`;
                }).join("\n\n");

                // Remove the card - the turn observation renderer in renderTurnsHtml
                // will display the Q&A summary inside the completed turn details.
                cardDiv.remove();

                if (executingLoader) {
                    executingLoader.style.display = "";
                }
                scrollToBottom(true);
                resolve(formattedAnswers);
                return;
            }

            const q = questions[idx];
            const hasOptions = q.options && Array.isArray(q.options) && q.options.length > 0;

            let optionsHtml = "";
            if (hasOptions) {
                optionsHtml += `<div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px;">`;
                q.options.forEach((opt, oIdx) => {
                    const inputId = `q-${idx}-opt-${oIdx}`;
                    const inputType = q.is_multi_select ? 'checkbox' : 'radio';
                    const inputName = `q-${idx}-options`;
                    optionsHtml += `
                        <label for="${inputId}" style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 10px; color: var(--text-primary); user-select: none; margin-bottom: 2px;">
                            <input type="${inputType}" id="${inputId}" name="${inputName}" value="${opt.replace(/"/g, '&quot;')}" style="cursor: pointer; width: 13px; height: 13px; accent-color: var(--text-accent); margin: 0;" />
                            <span>${opt}</span>
                        </label>
                    `;
                });
                optionsHtml += `</div>`;
            }

            const customPlaceholder = hasOptions ? "Or write in a custom option / comments..." : "Type your answer here...";
            const customInputHtml = `
                <div style="margin-bottom: 4px;">
                    <input type="text" class="question-custom-input form-input" placeholder="${customPlaceholder}" style="width: 100%; box-sizing: border-box; padding: 4px 8px; font-size: 10px; height: 22px;" />
                </div>
            `;

            cardDiv.innerHTML = `
                <div style="font-weight: 600; font-size: 11px; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                    <svg viewBox="0 0 24 24" width="12" height="12" stroke="var(--text-accent)" stroke-width="2.5" fill="none">
                        <circle cx="12" cy="12" r="10"></circle>
                        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>
                    <span>Clarification Needed (Question ${idx + 1} of ${questions.length})</span>
                </div>
                <div style="font-size: 10.5px; font-weight: 500; color: var(--text-primary); margin-bottom: 8px; line-height: 1.3;">
                    ${q.question}
                </div>
                <div class="question-inputs-area">
                    ${optionsHtml}
                    ${customInputHtml}
                </div>
                <div style="display: flex; gap: 4px; justify-content: flex-end; margin-top: 8px;">
                    <button class="btn-confirm-skip btn-secondary" style="width: auto; padding: 2px 8px; font-size: 9px; font-weight: 600; height: 20px; border-radius: var(--border-radius-sm);">Skip All</button>
                    <button class="btn-confirm-submit btn-primary" style="width: auto; padding: 2px 10px; font-size: 9px; font-weight: 600; height: 20px; border-radius: var(--border-radius-sm);">Submit</button>
                </div>
            `;

            scrollToBottom(true);

            const btnSubmit = cardDiv.querySelector(".btn-confirm-submit");
            const btnSkip = cardDiv.querySelector(".btn-confirm-skip");

            btnSkip.addEventListener("click", () => {
                // Remove the card - the observation "Skipped by user." will be
                // shown inside the completed turn details by renderTurnsHtml.
                cardDiv.remove();
                if (executingLoader) {
                    executingLoader.style.display = "";
                }
                scrollToBottom(true);
                resolve("Skipped by user.");
            });

            btnSubmit.addEventListener("click", () => {
                let selectedValues = [];
                if (hasOptions) {
                    const checkboxes = cardDiv.querySelectorAll(`input[name="q-${idx}-options"]:checked`);
                    checkboxes.forEach(cb => selectedValues.push(cb.value));
                }

                const customVal = cardDiv.querySelector(".question-custom-input").value.trim();

                let finalAnswer = "";
                if (q.is_multi_select) {
                    let combined = [...selectedValues];
                    if (customVal) {
                        combined.push(customVal);
                    }
                    finalAnswer = combined.length > 0 ? combined : "(No response provided)";
                } else {
                    if (customVal) {
                        finalAnswer = customVal;
                    } else if (selectedValues.length > 0) {
                        finalAnswer = selectedValues[0];
                    } else {
                        finalAnswer = "(No response provided)";
                    }
                }

                answers.push({
                    question: q.question,
                    answer: finalAnswer
                });

                showQuestion(idx + 1);
            });
        }

        showQuestion(currentQuestionIdx);
    });
};


