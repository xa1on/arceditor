/**
 * ArcEditor UI Controller Entry Point
 * Handles frontend user interface renderings, DOM inputs, scroll position updates,
 * event delegator listeners, settings drawers, and tab navigation.
 */

document.addEventListener("DOMContentLoaded", async () => {
    await loadSettings();
    await loadChats();
    initUI();
    validateConnection();
    syncProjectPath();
    loadInstalledEffects();
    updateContextSizeInfo();

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

    // Copy Bubble Text Event Delegation
    const chatMessages = document.getElementById("chat-messages");
    if (chatMessages) {
        chatMessages.addEventListener("click", async (e) => {
            const btn = e.target.closest(".copy-bubble-btn");
            if (!btn) return;

            const messageDiv = btn.closest(".message");
            if (!messageDiv) return;

            const textToCopy = messageDiv.getAttribute("data-raw-text");
            if (!textToCopy) return;

            try {
                await copyToClipboard(textToCopy);
                
                // Visual feedback: toggle icons and add copied class
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

    addBubble("user", userText);
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

function addBubble(sender, text) {
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
        content.innerHTML = formatMarkdown(text);
        wrapper.setAttribute("data-raw-text", text);
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
    // Specialized high-fidelity estimation for mixed code/natural language text
    const words = text.match(/[\w]+|[^\s\w]+/g) || [];
    let count = 0;
    for (const token of words) {
        if (/^[^\s\w]+$/.test(token)) {
            // Punctuation is tokenized distinctively
            count += Math.ceil(token.length / 1.5);
        } else {
            // Standard words and BPE subword splitting
            if (token.length > 8) {
                count += Math.ceil(token.length / 4);
            } else {
                count += 1;
            }
        }
    }
    const newlines = (text.match(/\n/g) || []).length;
    count += newlines;
    return Math.round(count);
}

function updateContextSizeInfo() {
    const metaElement = document.getElementById("input-meta-info");
    if (!metaElement) return;

    const inputText = document.getElementById("chat-input").value;

    // Reconstruct prospective messages payload (including text input and attachments)
    const prospectiveHistory = [...chatHistory];
    if (inputText.trim()) {
        if (attachedFrameBase64) {
            prospectiveHistory.push({
                role: "user",
                content: [
                    { type: "text", text: inputText },
                    { type: "image_url", image_url: { url: `data:image/png;base64,${attachedFrameBase64}` } }
                ]
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

    // Asynchronous dynamic true token counting for Gemini
    if (typeof currentProvider !== "undefined" && currentProvider === "gemini" && apiKey && typeof fetchTrueTokenCount === "function") {
        clearTimeout(tokenCountTimeout);
        tokenCountTimeout = setTimeout(async () => {
            const trueTokens = await fetchTrueTokenCount(prospectiveHistory);
            if (trueTokens !== null) {
                currentTrueTokens = trueTokens;
                if (document.getElementById("chat-input").value === inputText) {
                    metaElement.innerText = `Context: ${totalChars.toLocaleString()} chars (${trueTokens.toLocaleString()} true tokens)${usageTag}`;
                }
            }
        }, 400);
    }
}

function clearAttachmentDock() {
    attachedFrameBase64 = null;
    document.getElementById("attached-preview-img").src = "";
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
    if (btnSend) btnSend.disabled = !ready || !chatInput.value.trim();
    if (selectSession) selectSession.disabled = !ready;
    if (btnDeleteSession) btnDeleteSession.disabled = !ready;
    if (chipCapture) chipCapture.disabled = !ready;
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
