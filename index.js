/**
 * ArcEditor UI Controller Entry Point
 * Handles frontend user interface renderings, DOM inputs, scroll position updates,
 * event delegator listeners, settings drawers, and tab navigation.
 */

// Global console.error redirection to the built-in debug log pane
(function() {
    const originalConsoleError = console.error;
    console.error = function() {
        originalConsoleError.apply(console, arguments);
        try {
            const debugTextarea = document.getElementById("debug-output");
            if (debugTextarea) {
                const args = Array.prototype.slice.call(arguments).map(arg => {
                    if (arg instanceof Error) return arg.stack || arg.message;
                    if (typeof arg === "object") return JSON.stringify(arg);
                    return String(arg);
                });
                const timestamp = new Date().toISOString();
                debugTextarea.value += `\n[${timestamp}] [CONSOLE.ERROR] ${args.join(" ")}\n`;
                debugTextarea.scrollTop = debugTextarea.scrollHeight;
            }
        } catch (e) {}
    };
})();

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
        if (window.skillsManager && typeof window.skillsManager.initSkills === "function") {
            await window.skillsManager.initSkills();
        }
    } catch (e) {
        console.error("Failed to load settings or skills:", e);
    }
    
    try {
        await loadChats();
        await loadScripts();
        initializeProjectSessions();
        if (typeof renderScriptTabs === "function") {
            renderScriptTabs();
        }
    } catch (e) {
        console.error("Failed to load chats/scripts:", e);
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

    if (btnSettings) {
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
            if (typeof renderSkillsSettingsUI === "function") {
                renderSkillsSettingsUI();
            }
        });
    }
    if (btnCloseSettings) {
        btnCloseSettings.addEventListener("click", () => toggleSettingsDrawer(false));
    }
    const drawerOverlay = document.querySelector(".drawer-overlay");
    if (drawerOverlay) {
        drawerOverlay.addEventListener("click", () => toggleSettingsDrawer(false));
    }
    if (formSettings) {
        formSettings.addEventListener("submit", saveSettings);
    }

    const btnOpenSkillsFolder = document.getElementById("btn-open-skills-folder");
    if (btnOpenSkillsFolder) {
        btnOpenSkillsFolder.addEventListener("click", () => {
            if (window.skillsManager && typeof window.skillsManager.openSkillsFolder === "function") {
                window.skillsManager.openSkillsFolder();
            }
        });
    }

    if (tabChat) {
        tabChat.addEventListener("click", () => switchTab("chat"));
    }
    if (tabConsole) {
        tabConsole.addEventListener("click", () => switchTab("console"));
    }
    if (tabDebug) {
        tabDebug.addEventListener("click", () => switchTab("debug"));
    }

    // Close button for visual annotations modal
    const btnCloseAnnotationModal = document.getElementById("btn-close-annotation-modal");
    if (btnCloseAnnotationModal) {
        btnCloseAnnotationModal.addEventListener("click", () => {
            if (typeof closeAnnotationPopup === "function") {
                closeAnnotationPopup();
            }
        });
    }

    // Scroll lock event listener removed to prevent recursive event storm crashes on element focus.

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

    if (btnClearConsole) {
        btnClearConsole.addEventListener("click", () => {
            const output = document.getElementById("console-output");
            if (output) {
                if (output.tagName === "TEXTAREA") {
                    output.value = "";
                    if (activeScriptName) {
                        createOrUpdateScript(currentProjectPath, activeScriptName, "");
                    }
                } else if (output.querySelector("code")) {
                    output.querySelector("code").innerText = "// Code cleared. Run a command in Chat.";
                }
            }
        });
    }

    const consoleOutput = document.getElementById("console-output");
    if (consoleOutput) {
        consoleOutput.addEventListener("input", () => {
            if (activeScriptName) {
                createOrUpdateScript(currentProjectPath, activeScriptName, consoleOutput.value);
            }
        });
    }

    const btnNewScriptTab = document.getElementById("btn-new-script-tab");
    if (btnNewScriptTab) {
        btnNewScriptTab.addEventListener("click", () => {
            if (isExecuting) return;
            const name = prompt("Enter script name:", "untitled.jsx");
            if (name && name.trim()) {
                const sName = name.trim();
                const existing = findScriptByName(currentProjectPath, sName);
                if (existing) {
                    alert(`A script named "${sName}" already exists.`);
                    return;
                }
                createOrUpdateScript(currentProjectPath, sName, "// Custom ExtendScript code\n");
                selectScriptTab(sName);
            }
        });
    }

    const btnRunConsole = document.getElementById("btn-run-console");
    if (btnRunConsole) {
        btnRunConsole.addEventListener("click", async () => {
            const output = document.getElementById("console-output");
            const code = output.tagName === "TEXTAREA" ? output.value : output.querySelector("code").innerText;
            if (!code.trim()) {
                addSystemMessage("Console is empty. Type some ExtendScript to run.");
                return;
            }
            if (activeScriptName) {
                createOrUpdateScript(currentProjectPath, activeScriptName, code);
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

    if (btnRemoveAttachment) {
        btnRemoveAttachment.addEventListener("click", clearAttachmentDock);
    }

    if (chipCapture) {
        chipCapture.addEventListener("click", () => captureCompositionFrame(false));
    }
    const welcomeChipCapture = document.getElementById("welcome-chip-capture");
    if (welcomeChipCapture) {
        welcomeChipCapture.addEventListener("click", () => captureCompositionFrame(false));
    }

    const fileUploadInput = document.getElementById("file-upload-input");
    if (fileUploadInput) {
        fileUploadInput.addEventListener("change", handleFileSelection);
    }

    const dragOverlay = document.getElementById("drag-overlay");
    document.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (dragOverlay) dragOverlay.classList.remove("hidden");
    });
    document.addEventListener("dragleave", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.relatedTarget === null || e.toElement === null) {
            if (dragOverlay) dragOverlay.classList.add("hidden");
        }
    });
    document.addEventListener("drop", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (dragOverlay) dragOverlay.classList.add("hidden");

        const files = e.dataTransfer ? e.dataTransfer.files : null;
        if (files && files.length > 0) {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                try {
                    await processUploadedFile(file);
                } catch (err) {
                    addSystemMessage(`Failed to read file ${file.name}: ${err.message}`);
                }
            }
        }
    });

    const btnPlus = document.getElementById("btn-plus");
    if (btnPlus) {
        btnPlus.addEventListener("click", () => {
            if (fileUploadInput) fileUploadInput.click();
        });
    }
    const welcomeBtnPlus = document.getElementById("welcome-btn-plus");
    if (welcomeBtnPlus) {
        welcomeBtnPlus.addEventListener("click", () => {
            if (fileUploadInput) fileUploadInput.click();
        });
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
    const welcomeChipCaptureSequence = document.getElementById("welcome-chip-capture-sequence");
    if (welcomeChipCaptureSequence) {
        welcomeChipCaptureSequence.addEventListener("click", async () => {
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
    if (chatInput) {
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
            updateSendButtonState();
            updateContextSizeInfo();
        });

        chatInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                triggerUserMessage();
            }
        });
    }

    if (btnSend) {
        btnSend.addEventListener("click", triggerUserMessage);
    }
    const btnStop = document.getElementById("btn-stop");
    if (btnStop) {
        btnStop.addEventListener("click", () => {
            if (typeof stopAgentExecution === "function") {
                stopAgentExecution();
            }
        });
    }

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
            updateSendButtonState();
        });
        
        welcomeChatInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                triggerWelcomeUserMessage();
            }
        });
        
        welcomeBtnSend.addEventListener("click", triggerWelcomeUserMessage);
    }

    // Chat Sessions New Tab Button
    const btnNewChatTab = document.getElementById("btn-new-chat-tab");
    if (btnNewChatTab) {
        btnNewChatTab.addEventListener("click", () => {
            if (isExecuting) return;
            createNewSession();
        });
    }

    // Past Chats Dropdown Button
    const btnPastChats = document.getElementById("btn-past-chats");
    const pastChatsDropdown = document.getElementById("past-chats-dropdown");
    if (btnPastChats && pastChatsDropdown) {
        btnPastChats.addEventListener("click", (e) => {
            e.stopPropagation();
            if (isExecuting) return;
            pastChatsDropdown.classList.toggle("hidden");
        });
    }

    // Close past chats dropdown when clicking outside
    document.addEventListener("click", (e) => {
        if (pastChatsDropdown && !pastChatsDropdown.classList.contains("hidden")) {
            if (!e.target.closest(".past-chats-wrap")) {
                pastChatsDropdown.classList.add("hidden");
            }
        }
    });

    // Automatically blur/unblur toasts and chat history when the past chats dropdown class changes
    if (pastChatsDropdown) {
        const observer = new MutationObserver(() => {
            const isHidden = pastChatsDropdown.classList.contains("hidden");
            const toastContainer = document.getElementById("toast-container");
            if (toastContainer) {
                if (!isHidden) {
                    toastContainer.classList.add("blur-toasts");
                } else {
                    toastContainer.classList.remove("blur-toasts");
                }
            }
            const paneChat = document.getElementById("pane-chat");
            if (paneChat) {
                if (!isHidden) {
                    paneChat.classList.add("blur-chat");
                } else {
                    paneChat.classList.remove("blur-chat");
                }
            }
        });
        observer.observe(pastChatsDropdown, { attributes: true, attributeFilter: ["class"] });
    }

    // Copy Bubble Text & Toggle Tool View Event Delegation
    const chatMessages = document.getElementById("chat-messages");
    if (chatMessages) {
        chatMessages.addEventListener("scroll", () => {
            if (isProgrammaticScroll) return;
            // Use a slightly larger tolerance to be resilient to fast generation and rendering delays
            const isAtBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight <= 80;
            if (isAtBottom) {
                userHasScrolledUp = false;
            } else {
                userHasScrolledUp = true;
            }
        });

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
        });
    }

    const permissionModeSelect = document.getElementById("setting-permission-mode");
    if (permissionModeSelect) {
        permissionModeSelect.addEventListener("change", (e) => {
            updatePermissionModeDescription(e.target.value);
        });
    }

    // Global summary click animator delegator
    document.addEventListener("click", (e) => {
        const summary = e.target.closest("summary");
        if (summary) {
            const details = summary.closest("details");
            if (details) {
                // If the click is on a button, link, or input field inside the summary, bypass details toggling
                if (e.target.closest("button") || e.target.closest("a") || e.target.closest("input") || e.target.closest("select")) {
                    return;
                }
                e.preventDefault();
                const wasOpen = details.hasAttribute("open");
                if (wasOpen) {
                    window.collapseDetailsWithAnimation(details);
                } else {
                    window.expandDetailsWithAnimation(details);
                }

                // Preserve reasoning toggling states
                if (details.classList.contains("reasoning-details")) {
                    window._userReasoningState = !wasOpen;
                    window._userToggledReasoning = true;
                }
            }
        }
    });

    // Initialize autocomplete slash command system
    if (window.commandsManager && typeof window.commandsManager.init === "function") {
        window.commandsManager.init();
    }

    // ----------------------------------------------------
    // IMAGE LIGHTBOX ZOOM SYSTEM
    // ----------------------------------------------------
    const lightbox = document.getElementById("image-lightbox");
    if (lightbox) {
        const lightboxContent = lightbox.querySelector(".lightbox-content");
        const lightboxScroller = lightbox.querySelector(".lightbox-scroller");
        let lightboxZoom = 1.0;
        let lightboxBaseWidth = 0;
        let lightboxBaseHeight = 0;
        let lightboxIsPanning = false;
        let lightboxPanStartMouseX = 0;
        let lightboxPanStartMouseY = 0;
        let lightboxPanStartScrollLeft = 0;
        let lightboxPanStartScrollTop = 0;

        const updateLightboxZoom = () => {
            if (lightboxBaseWidth === 0) return;
            const w = lightboxBaseWidth * lightboxZoom;
            const h = lightboxBaseHeight * lightboxZoom;
            
            const clone = lightboxContent.querySelector(".bubble-image-wrap");
            const cloneImg = clone ? clone.querySelector("img") : null;
            if (clone && cloneImg) {
                clone.style.setProperty("width", w + "px", "important");
                clone.style.setProperty("height", h + "px", "important");
                cloneImg.style.setProperty("width", w + "px", "important");
                cloneImg.style.setProperty("height", h + "px", "important");
            }
            
            // Adjust overlay flex alignment dynamically based on overflow
            const workRect = lightboxScroller.getBoundingClientRect();
            // 40px is padding offset
            if (w > workRect.width - 40) {
                lightboxScroller.style.justifyContent = "flex-start";
            } else {
                lightboxScroller.style.justifyContent = "center";
            }
            if (h > workRect.height - 40) {
                lightboxScroller.style.alignItems = "flex-start";
            } else {
                lightboxScroller.style.alignItems = "center";
            }

            // Update zoom indicator
            const zoomEl = lightbox.querySelector("#lightbox-zoom-level");
            if (zoomEl) {
                zoomEl.innerText = Math.round(lightboxZoom * 100) + "%";
            }
        };

        const resetLightboxZoom = () => {
            if (lightboxBaseWidth === 0) return;
            lightboxZoom = 1.0;
            updateLightboxZoom();
            lightboxScroller.scrollLeft = 0;
            lightboxScroller.scrollTop = 0;
        };

        const zoomLightboxTo = (factor, mouseX_screen, mouseY_screen) => {
            if (lightboxBaseWidth === 0) return;
            const minZoom = 0.5;
            const maxZoom = 20.0;
            const zoom_old = lightboxZoom;
            const zoom_new = Math.max(minZoom, Math.min(maxZoom, zoom_old * factor));
            
            if (zoom_new === zoom_old) return;
            
            const scrollLeft = lightboxScroller.scrollLeft;
            const scrollTop = lightboxScroller.scrollTop;
            
            lightboxZoom = zoom_new;
            updateLightboxZoom();
            
            lightboxScroller.scrollLeft = (scrollLeft + mouseX_screen) * (zoom_new / zoom_old) - mouseX_screen;
            lightboxScroller.scrollTop = (scrollTop + mouseY_screen) * (zoom_new / zoom_old) - mouseY_screen;
        };

        const zoomLightboxToCenter = (factor) => {
            const workRect = lightboxScroller.getBoundingClientRect();
            zoomLightboxTo(factor, workRect.width / 2, workRect.height / 2);
        };

        const closeLightbox = () => {
            lightbox.classList.remove("active");
            setTimeout(() => {
                if (!lightbox.classList.contains("active")) {
                    lightboxContent.innerHTML = "";
                }
            }, 200);
        };

        // Delegate clicks on images in the chat history or messages
        document.addEventListener("click", (e) => {
            const wrap = e.target.closest(".bubble-image-wrap");
            if (wrap) {
                // If the click is already inside the lightbox content, ignore it
                if (e.target.closest(".lightbox-content")) {
                    return;
                }
                lightboxContent.innerHTML = "";
                const clone = wrap.cloneNode(true);
                
                // Remove any inline styles on the clone to let the stylesheet take control
                clone.style.removeProperty("margin-top");
                clone.style.removeProperty("max-width");
                clone.style.removeProperty("max-height");
                
                lightboxContent.appendChild(clone);
                lightbox.classList.add("active");
                
                // Reset states
                lightboxZoom = 1.0;
                lightboxBaseWidth = 0;
                lightboxBaseHeight = 0;
                
                // Restore default overlay alignment for measuring
                lightboxScroller.style.justifyContent = "center";
                lightboxScroller.style.alignItems = "center";
                lightboxContent.style.maxWidth = "90%";
                lightboxContent.style.maxHeight = "90%";
                
                const cloneImg = clone.querySelector("img");
                const onImageLoad = () => {
                    const naturalWidth = cloneImg.naturalWidth || 800;
                    const naturalHeight = cloneImg.naturalHeight || 600;
                    const ratio = naturalWidth / naturalHeight;
                    const containerWidth = window.innerWidth * 0.9;
                    const containerHeight = window.innerHeight * 0.9;
                    
                    let w = naturalWidth;
                    let h = naturalHeight;
                    
                    if (w > containerWidth) {
                        w = containerWidth;
                        h = w / ratio;
                    }
                    if (h > containerHeight) {
                        h = containerHeight;
                        w = h * ratio;
                    }
                    
                    lightboxBaseWidth = w;
                    lightboxBaseHeight = h;
                    
                    // Remove constraints so they can scale past viewport
                    lightboxContent.style.maxWidth = "none";
                    lightboxContent.style.maxHeight = "none";
                    clone.style.setProperty("max-width", "none", "important");
                    clone.style.setProperty("max-height", "none", "important");
                    cloneImg.style.setProperty("max-width", "none", "important");
                    cloneImg.style.setProperty("max-height", "none", "important");
                    clone.style.setProperty("flex-shrink", "0", "important");
                    
                    resetLightboxZoom();
                };
                
                if (cloneImg.complete) {
                    onImageLoad();
                } else {
                    cloneImg.onload = onImageLoad;
                }
            }
        });

        // Close lightbox on click on overlay or close button
        lightbox.addEventListener("click", (e) => {
            if (e.target === lightbox || e.target === lightboxScroller || e.target.closest(".lightbox-close")) {
                closeLightbox();
            }
        });

        // Wheel listener on scroller for Zooming (Ctrl+Scroll)
        lightboxScroller.addEventListener("wheel", (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
                const workRect = lightboxScroller.getBoundingClientRect();
                const mouseX_screen = e.clientX - workRect.left;
                const mouseY_screen = e.clientY - workRect.top;
                
                zoomLightboxTo(factor, mouseX_screen, mouseY_screen);
            }
            // Normal scroll (without Ctrl) rolls scrollbars naturally
        }, { passive: false });

        // Middle click drag to pan on lightbox scroller (native scroll based)
        lightboxScroller.addEventListener("pointerdown", (e) => {
            if (e.button === 1) { // Middle click / scroll wheel click
                e.preventDefault();
                lightboxIsPanning = true;
                lightboxPanStartMouseX = e.clientX;
                lightboxPanStartMouseY = e.clientY;
                lightboxPanStartScrollLeft = lightboxScroller.scrollLeft;
                lightboxPanStartScrollTop = lightboxScroller.scrollTop;
                lightboxScroller.style.cursor = "grabbing";
                lightboxContent.style.pointerEvents = "none";
                lightboxScroller.setPointerCapture(e.pointerId);
            }
        });

        lightboxScroller.addEventListener("pointermove", (e) => {
            if (lightboxIsPanning) {
                if (!(e.buttons & 4)) {
                    lightboxIsPanning = false;
                    lightboxScroller.style.cursor = "";
                    lightboxContent.style.pointerEvents = "auto";
                    return;
                }
                const dx = e.clientX - lightboxPanStartMouseX;
                const dy = e.clientY - lightboxPanStartMouseY;
                lightboxScroller.scrollLeft = lightboxPanStartScrollLeft - dx;
                lightboxScroller.scrollTop = lightboxPanStartScrollTop - dy;
            }
        });

        lightboxScroller.addEventListener("pointerup", (e) => {
            if (lightboxIsPanning && e.button === 1) {
                lightboxIsPanning = false;
                lightboxScroller.style.cursor = "";
                lightboxContent.style.pointerEvents = "auto";
                try { lightboxScroller.releasePointerCapture(e.pointerId); } catch(err) {}
            }
        });

        lightboxScroller.addEventListener("pointercancel", (e) => {
            if (lightboxIsPanning) {
                lightboxIsPanning = false;
                lightboxScroller.style.cursor = "";
                lightboxContent.style.pointerEvents = "auto";
            }
        });

        // Cancel panning when window loses focus
        window.addEventListener("blur", () => {
            if (lightboxIsPanning) {
                lightboxIsPanning = false;
                lightboxScroller.style.cursor = "";
                lightboxContent.style.pointerEvents = "auto";
            }
        });

        // Double click background to reset zoom/pan
        lightboxScroller.addEventListener("dblclick", (e) => {
            if (e.target === lightboxScroller || e.target === lightboxContent) {
                resetLightboxZoom();
            }
        });

        // Floating Zoom Bar Buttons
        const btnLightboxIn = lightbox.querySelector("#btn-lightbox-zoom-in");
        const btnLightboxOut = lightbox.querySelector("#btn-lightbox-zoom-out");
        const btnLightboxReset = lightbox.querySelector("#btn-lightbox-zoom-reset");

        if (btnLightboxIn) {
            btnLightboxIn.addEventListener("click", (e) => {
                e.stopPropagation();
                zoomLightboxToCenter(1.25);
            });
        }
        if (btnLightboxOut) {
            btnLightboxOut.addEventListener("click", (e) => {
                e.stopPropagation();
                zoomLightboxToCenter(1 / 1.25);
            });
        }
        if (btnLightboxReset) {
            btnLightboxReset.addEventListener("click", (e) => {
                e.stopPropagation();
                resetLightboxZoom();
            });
        }

        // Close lightbox on Escape key
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && lightbox.classList.contains("active")) {
                closeLightbox();
            }
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
    if (!drawer) return;
    
    if (open) {
        drawer.classList.remove("hidden");
        // Force reflow
        drawer.offsetHeight;
        drawer.classList.add("active");
    } else {
        drawer.classList.remove("active");
        
        // If transitions are disabled, hide it instantly
        if (typeof uiTransitionsEnabled !== "undefined" && !uiTransitionsEnabled) {
            drawer.classList.add("hidden");
            return;
        }

        // Otherwise, wait for transition to finish
        const onTransitionEnd = (e) => {
            if (e.target === drawer || e.propertyName === "visibility" || e.propertyName === "transform") {
                drawer.removeEventListener("transitionend", onTransitionEnd);
                if (!drawer.classList.contains("active")) {
                    drawer.classList.add("hidden");
                }
            }
        };
        drawer.addEventListener("transitionend", onTransitionEnd);
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

    toggleWelcomeScreen(false, false);

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
    const quickUtilities = document.getElementById("active-quick-utilities");
    
    // If executing or there are attached files/frames, the composer is active, so we are not empty
    const hasAttachments = (typeof attachedFrames !== "undefined" && attachedFrames && attachedFrames.length > 0);
    const executing = (typeof isExecuting !== "undefined" && isExecuting);
    if (executing || hasAttachments) {
        isEmpty = false;
    }
    
    if (isEmpty) {
        if (welcomeScreen) {
            welcomeScreen.classList.remove("hidden");
            welcomeScreen.classList.remove("fade-out");
        }
        if (chatMessages) chatMessages.classList.add("hidden");
        if (footer) footer.classList.add("hidden");
        if (quickUtilities) quickUtilities.classList.add("hidden");
    } else {
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
        if (quickUtilities) {
            quickUtilities.classList.remove("hidden");
        }
    }
}

window.toggleWelcomeScreen = toggleWelcomeScreen;

let userHasScrolledUp = false;
let isProgrammaticScroll = false;

function scrollToBottom(force = false, smooth = false) {
    const scroller = document.getElementById("chat-messages");
    if (!scroller) return;

    if (force || !userHasScrolledUp) {
        isProgrammaticScroll = true;
        if (smooth && typeof uiTransitionsEnabled !== "undefined" && uiTransitionsEnabled) {
            scroller.scrollTo({
                top: scroller.scrollHeight,
                behavior: "smooth"
            });
        } else {
            scroller.scrollTop = scroller.scrollHeight;
        }
        setTimeout(() => {
            isProgrammaticScroll = false;
        }, 50);
    }
}

function escapeXml(unsafe) {
    if (!unsafe) return "";
    return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
}

function createAnnotationsSvg(annotations, uniquePrefix) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "bubble-image-annotations-svg");
    
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    svg.appendChild(defs);

    const arrowColors = new Set();
    annotations.forEach(ann => {
        if (ann.type === "arrow") {
            arrowColors.add(ann.color || "#ff4d4d");
        }
    });

    arrowColors.forEach(c => {
        const cleanColor = typeof c === "string" ? c.trim() : "#ff4d4d";
        const isValidHex = /^#[0-9A-Fa-f]{3,8}$/.test(cleanColor);
        const hexId = isValidHex ? cleanColor.replace("#", "") : "default";
        
        const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
        marker.setAttribute("id", `arrow-${hexId}-${uniquePrefix}`);
        marker.setAttribute("viewBox", "0 0 10 10");
        marker.setAttribute("refX", "6");
        marker.setAttribute("refY", "5");
        marker.setAttribute("markerWidth", "6");
        marker.setAttribute("markerHeight", "6");
        marker.setAttribute("orient", "auto-start-reverse");
        
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", "M 0 1.5 L 10 5 L 0 8.5 z");
        path.setAttribute("fill", isValidHex ? cleanColor : "#ff4d4d");
        
        marker.appendChild(path);
        defs.appendChild(marker);
    });

    annotations.forEach(ann => {
        const color = typeof ann.color === "string" && /^#[0-9A-Fa-f]{3,8}$/.test(ann.color.trim()) ? ann.color.trim() : "#ff4d4d";
        const hexId = color.replace("#", "");
        const x1 = (ann.x1 * 100).toFixed(2) + "%";
        const y1 = (ann.y1 * 100).toFixed(2) + "%";
        const x2 = (ann.x2 * 100).toFixed(2) + "%";
        const y2 = (ann.y2 * 100).toFixed(2) + "%";
        const wVal = ((ann.x2 - ann.x1) * 100).toFixed(2) + "%";
        const hVal = ((ann.y2 - ann.y1) * 100).toFixed(2) + "%";

        if (ann.type === "rect") {
            const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            rect.setAttribute("x", x1);
            rect.setAttribute("y", y1);
            rect.setAttribute("width", wVal);
            rect.setAttribute("height", hVal);
            rect.setAttribute("stroke", color);
            rect.setAttribute("stroke-width", "2");
            rect.setAttribute("fill", "none");
            svg.appendChild(rect);
            
            if (ann.label) {
                const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
                text.setAttribute("x", x1);
                text.setAttribute("y", y1);
                text.setAttribute("dy", "-3");
                text.setAttribute("fill", color);
                text.setAttribute("font-size", "8px");
                text.setAttribute("font-family", "monospace");
                text.setAttribute("font-weight", "bold");
                text.textContent = ann.label;
                svg.appendChild(text);
            }
        } else if (ann.type === "circle") {
            const cx = ((ann.x1 + ann.x2) / 2 * 100).toFixed(2) + "%";
            const cy = ((ann.y1 + ann.y2) / 2 * 100).toFixed(2) + "%";
            const rx = (Math.abs(ann.x2 - ann.x1) / 2 * 100).toFixed(2) + "%";
            const ry = (Math.abs(ann.y2 - ann.y1) / 2 * 100).toFixed(2) + "%";
            
            const ellipse = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
            ellipse.setAttribute("cx", cx);
            ellipse.setAttribute("cy", cy);
            ellipse.setAttribute("rx", rx);
            ellipse.setAttribute("ry", ry);
            ellipse.setAttribute("stroke", color);
            ellipse.setAttribute("stroke-width", "2");
            ellipse.setAttribute("fill", "none");
            svg.appendChild(ellipse);

            if (ann.label) {
                const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
                const sx = (Math.min(ann.x1, ann.x2) * 100).toFixed(2) + "%";
                const sy = (Math.min(ann.y1, ann.y2) * 100).toFixed(2) + "%";
                text.setAttribute("x", sx);
                text.setAttribute("y", sy);
                text.setAttribute("dy", "-3");
                text.setAttribute("fill", color);
                text.setAttribute("font-size", "8px");
                text.setAttribute("font-family", "monospace");
                text.setAttribute("font-weight", "bold");
                text.textContent = ann.label;
                svg.appendChild(text);
            }
        } else if (ann.type === "arrow") {
            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", x1);
            line.setAttribute("y1", y1);
            line.setAttribute("x2", x2);
            line.setAttribute("y2", y2);
            line.setAttribute("stroke", color);
            line.setAttribute("stroke-width", "2");
            line.setAttribute("marker-end", `url(#arrow-${hexId}-${uniquePrefix})`);
            svg.appendChild(line);

            if (ann.label) {
                const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
                text.setAttribute("x", x1);
                text.setAttribute("y", y1);
                text.setAttribute("dy", "-4");
                text.setAttribute("fill", color);
                text.setAttribute("font-size", "8px");
                text.setAttribute("font-family", "monospace");
                text.setAttribute("font-weight", "bold");
                text.textContent = ann.label;
                svg.appendChild(text);
            }
        } else if (ann.type === "path") {
            if (ann.points && ann.points.length > 1) {
                const pathD = "M " + ann.points.map(p => `${(p.x * 100).toFixed(2)} ${(p.y * 100).toFixed(2)}`).join(" L ");
                
                const nestedSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                nestedSvg.setAttribute("viewBox", "0 0 100 100");
                nestedSvg.setAttribute("preserveAspectRatio", "none");
                nestedSvg.setAttribute("width", "100%");
                nestedSvg.setAttribute("height", "100%");
                nestedSvg.setAttribute("x", "0");
                nestedSvg.setAttribute("y", "0");
                
                const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                path.setAttribute("d", pathD);
                path.setAttribute("stroke", color);
                path.setAttribute("stroke-width", "2.5");
                path.setAttribute("fill", "none");
                path.setAttribute("vector-effect", "non-scaling-stroke");
                path.setAttribute("stroke-linejoin", "round");
                path.setAttribute("stroke-linecap", "round");
                
                nestedSvg.appendChild(path);
                svg.appendChild(nestedSvg);
            }
        } else if (ann.type === "text") {
            const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
            
            // Add a background rect for readability, matching annotation.html
            const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            bgRect.setAttribute("x", x1);
            bgRect.setAttribute("y", y1);
            const textStr = ann.text || "";
            const charWidth = 5.2; // approx width of monospace char at font-size 9px
            const estWidth = textStr.length * charWidth + 8;
            bgRect.setAttribute("width", estWidth.toString());
            bgRect.setAttribute("height", "13");
            bgRect.setAttribute("rx", "1.5");
            bgRect.setAttribute("ry", "1.5");
            bgRect.setAttribute("fill", "rgba(0, 0, 0, 0.85)");
            bgRect.setAttribute("transform", "translate(0, -9)");
            g.appendChild(bgRect);
            
            const markerRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            markerRect.setAttribute("x", x1);
            markerRect.setAttribute("y", y1);
            markerRect.setAttribute("rx", "2");
            markerRect.setAttribute("ry", "2");
            markerRect.setAttribute("width", "4");
            markerRect.setAttribute("height", "4");
            markerRect.setAttribute("fill", color);
            markerRect.setAttribute("transform", "translate(-2,-2)");
            g.appendChild(markerRect);
            
            const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
            text.setAttribute("x", x1);
            text.setAttribute("y", y1);
            text.setAttribute("dx", "4");
            text.setAttribute("dy", "3");
            text.setAttribute("fill", color);
            text.setAttribute("font-size", "9px");
            text.setAttribute("font-family", "monospace");
            text.setAttribute("font-weight", "bold");
            text.textContent = textStr;
            g.appendChild(text);
            
            svg.appendChild(g);
        }
    });

    return svg;
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
        const rawImagesArray = Array.isArray(base64Images) ? base64Images : [base64Images];
        const imagesArray = rawImagesArray.map((item, index) => {
            const isObj = typeof item === "object" && item !== null;
            if (isObj) {
                return {
                    type: item.type || "image",
                    name: item.name || `Attachment ${index + 1}`,
                    mimeType: item.mimeType || "image/png",
                    size: item.size || null,
                    data: item.data || "",
                    annotations: item.annotations || []
                };
            } else {
                return {
                    type: "image",
                    name: `User attachment ${index + 1}`,
                    mimeType: "image/png",
                    size: null,
                    data: item,
                    annotations: []
                };
            }
        });

        if (imagesArray.length > 0) {
            const containerWrap = document.createElement("div");
            containerWrap.className = "bubble-images-container";
            containerWrap.style.display = "flex";
            containerWrap.style.flexWrap = "wrap";
            containerWrap.style.gap = "6px";
            containerWrap.style.marginTop = "6px";

            imagesArray.forEach((item, imgIdx) => {
                const isImage = item.type === "image" || item.mimeType.startsWith("image/");

                if (isImage) {
                    const imgWrap = document.createElement("div");
                    imgWrap.className = "bubble-image-wrap";
                    imgWrap.style.marginTop = "0"; // Reset margin since container has gap
                    
                    const imgElement = document.createElement("img");
                    imgElement.src = `data:${item.mimeType};base64,${item.data}`;
                    imgElement.alt = item.name;
                    imgElement.title = item.name;
                    imgWrap.appendChild(imgElement);

                    if (item.annotations && item.annotations.length > 0) {
                        const uniqueMarkerId = `${id}-${imgIdx}`;
                        const annotationsSvg = createAnnotationsSvg(item.annotations, uniqueMarkerId);
                        imgWrap.appendChild(annotationsSvg);
                    }
                    containerWrap.appendChild(imgWrap);

                    // Add collapsible details listing annotations if present
                    if (item.annotations && item.annotations.length > 0) {
                        const details = document.createElement("details");
                        details.className = "annotation-details-summary";
                        
                        const colorLabels = {
                            "#ff4d4d": "Red",
                            "#00f0ff": "Cyan",
                            "#ffd700": "Yellow",
                            "#39ff14": "Green"
                        };

                        const pathAnns = item.annotations.filter(ann => ann.type === "path");
                        const otherAnns = item.annotations.filter(ann => ann.type !== "path");
                        const totalCount = otherAnns.length + (pathAnns.length > 0 ? 1 : 0);

                        let listHtml = "<ul>";
                        item.annotations.forEach((ann, aIdx) => {
                            const colorName = colorLabels[ann.color] || ann.color;
                            if (ann.type === "rect") {
                                listHtml += `<li><strong>Box #${aIdx+1} (${colorName})</strong>: "${escapeXml(ann.label || 'unlabeled')}" (Bounds: [${(ann.x1*100).toFixed(0)}%, ${(ann.y1*100).toFixed(0)}%] to [${(ann.x2*100).toFixed(0)}%, ${(ann.y2*100).toFixed(0)}%])</li>`;
                            } else if (ann.type === "circle") {
                                const desc = ann.label ? `"${escapeXml(ann.label)}"` : '(unlabeled)';
                                listHtml += `<li><strong>Circle #${aIdx+1} (${colorName})</strong>: ${desc} (Center: [${((ann.x1+ann.x2)/2*100).toFixed(0)}%, ${((ann.y1+ann.y2)/2*100).toFixed(0)}%], Radius: [H: ${(Math.abs(ann.x2-ann.x1)/2*100).toFixed(0)}%, V: ${(Math.abs(ann.y2-ann.y1)/2*100).toFixed(0)}%])</li>`;
                            } else if (ann.type === "arrow") {
                                const desc = ann.label ? `"${escapeXml(ann.label)}"` : '(unlabeled)';
                                listHtml += `<li><strong>Arrow #${aIdx+1} (${colorName})</strong>: ${desc} direction [${(ann.x1*100).toFixed(0)}%, ${(ann.y1*100).toFixed(0)}%] &rarr; [${(ann.x2*100).toFixed(0)}%, ${(ann.y2*100).toFixed(0)}%]</li>`;
                            } else if (ann.type === "text") {
                                listHtml += `<li><strong>Note #${aIdx+1} (${colorName})</strong>: "${escapeXml(ann.text || '')}" at [${(ann.x1*100).toFixed(0)}%, ${(ann.y1*100).toFixed(0)}%]</li>`;
                            }
                        });

                        // Append consolidated sketch path details if present
                        if (pathAnns.length > 0) {
                            let minX = 1.0, minY = 1.0, maxX = 0.0, maxY = 0.0;
                            let hasPoints = false;
                            const colors = new Set();
                            
                            pathAnns.forEach(ann => {
                                const colorName = colorLabels[ann.color] || ann.color;
                                colors.add(colorName);
                                if (ann.points && ann.points.length > 0) {
                                    ann.points.forEach(p => {
                                        hasPoints = true;
                                        if (p.x < minX) minX = p.x;
                                        if (p.y < minY) minY = p.y;
                                        if (p.x > maxX) maxX = p.x;
                                        if (p.y > maxY) maxY = p.y;
                                    });
                                }
                            });
                            
                            if (!hasPoints) {
                                minX = 0; minY = 0; maxX = 0; maxY = 0;
                            }
                            
                            const colorStr = Array.from(colors).join(", ");
                            const strokeSuffix = pathAnns.length === 1 ? "stroke" : "strokes";
                            listHtml += `<li><strong>Sketch Path (${colorStr})</strong>: A sketch of ${pathAnns.length} ${strokeSuffix} inside bounds [Left: ${(minX*100).toFixed(0)}%, Top: ${(minY*100).toFixed(0)}%, Right: ${(maxX*100).toFixed(0)}%, Bottom: ${(maxY*100).toFixed(0)}%]</li>`;
                        }

                        listHtml += "</ul>";
                        
                        details.innerHTML = `
                            <summary>Annotations (${totalCount})</summary>
                            ${listHtml}
                        `;
                        containerWrap.appendChild(details);
                    }
                } else {
                    const fileWrap = document.createElement("div");
                    fileWrap.className = "bubble-file-attachment";
                    
                    let sizeStr = "";
                    if (typeof item.size === "number") {
                        if (item.size < 1024) {
                            sizeStr = `${item.size} B`;
                        } else if (item.size < 1024 * 1024) {
                            sizeStr = `${(item.size / 1024).toFixed(1)} KB`;
                        } else {
                            sizeStr = `${(item.size / (1024 * 1024)).toFixed(1)} MB`;
                        }
                    }

                    const isVideo = item.type === "video";
                    const iconSvg = isVideo ? `
                        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none">
                            <polygon points="23 7 16 12 23 17 23 7"></polygon>
                            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                        </svg>
                    ` : `
                        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                        </svg>
                    `;
                    fileWrap.innerHTML = `
                        ${iconSvg}
                        <span class="bubble-file-name" title="${item.name}">${item.name}</span>
                        ${sizeStr ? `<span class="bubble-file-size">${sizeStr}</span>` : ""}
                    `;
                    containerWrap.appendChild(fileWrap);
                }
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
    scrollToBottom(true, true);

    return id;
}

function showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    // Create toast element
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;

    // Wrapper for icon + content
    const wrapper = document.createElement("div");
    wrapper.className = "toast-content-wrapper";

    // Icon based on type
    const iconContainer = document.createElement("div");
    iconContainer.className = `toast-icon ${type}`;
    if (type === "success") {
        iconContainer.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
        `;
    } else if (type === "error") {
        iconContainer.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
        `;
    } else {
        iconContainer.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
        `;
    }
    wrapper.appendChild(iconContainer);

    // Text content
    const content = document.createElement("div");
    content.className = "toast-content";
    content.innerText = message;
    wrapper.appendChild(content);

    toast.appendChild(wrapper);

    // Close button
    const closeBtn = document.createElement("button");
    closeBtn.className = "toast-close";
    closeBtn.title = "Dismiss";
    closeBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
    `;
    
    let isDismissed = false;

    const dismiss = () => {
        if (isDismissed) return;
        isDismissed = true;
        
        toast.style.opacity = "0";
        toast.style.transform = "translateY(10px) scale(0.95)";
        
        // Remove hover blur if no other toast is hovered (excluding the current one)
        setTimeout(() => {
            const otherHovered = Array.from(container.querySelectorAll(".toast:hover"))
                .filter(t => t !== toast);
            if (otherHovered.length === 0) {
                const pane = document.getElementById("pane-chat");
                if (pane) {
                    pane.classList.remove("blur-chat");
                }
            }
        }, 50);

        setTimeout(() => {
            if (toast.parentNode) {
                container.removeChild(toast);
            }
        }, 200);
    };

    closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        dismiss();
    });
    toast.appendChild(closeBtn);

    // Hover blur effects
    toast.addEventListener("mouseenter", () => {
        const pane = document.getElementById("pane-chat");
        if (pane) {
            pane.classList.add("blur-chat");
        }
    });

    toast.addEventListener("mouseleave", () => {
        setTimeout(() => {
            const hovered = container.querySelector(".toast:hover");
            if (!hovered) {
                const pane = document.getElementById("pane-chat");
                if (pane) {
                    pane.classList.remove("blur-chat");
                }
            }
        }, 50);
    });

    // Append to container
    container.appendChild(toast);

    // Auto dismiss after 5 seconds
    setTimeout(dismiss, 5000);
}

function addSystemMessage(text) {
    if (!text) return;
    
    // Check for intermediate status messages to ignore completely
    const lower = text.toLowerCase();
    if (lower.includes("capturing current timeline frame") ||
        lower.includes("capturing composition sequence") ||
        lower.includes("loading active timeline context") ||
        lower.includes("executing custom extendscript") ||
        lower.includes("extracting frames from video")) {
        return;
    }

    // Determine type (error, success, info)
    let type = "info";
    if (lower.startsWith("error") || lower.includes("failed")) {
        type = "error";
    } else if (lower.includes("successfully") || lower.includes("success")) {
        type = "success";
    }

    showToast(text, type);
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

function updateSendButtonState() {
    const chatInput = document.getElementById("chat-input");
    const btnSend = document.getElementById("btn-send");
    const welcomeInput = document.getElementById("welcome-chat-input");
    const welcomeBtnSend = document.getElementById("welcome-btn-send");
    
    const hasAttachments = attachedFrames && attachedFrames.length > 0;
    
    if (btnSend && chatInput) {
        btnSend.disabled = !chatInput.value.trim() && !hasAttachments;
    }
    if (welcomeBtnSend && welcomeInput) {
        welcomeBtnSend.disabled = !welcomeInput.value.trim() && !hasAttachments;
    }
}

function updateContextSizeInfo() {
    const metaElement = document.getElementById("input-meta-info");
    if (!metaElement) return;

    const inputText = document.getElementById("chat-input").value;

    // Reconstruct prospective messages payload (including text input and attachments)
    const prospectiveHistory = [...agentHistory];
    if (inputText.trim() || (attachedFrames && attachedFrames.length > 0)) {
        if (attachedFrames && attachedFrames.length > 0) {
            let embeddedText = inputText;
            const contentParts = [];
            
            attachedFrames.forEach(item => {
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
                    contentParts.push({ type: "image_url", image_url: { url: `data:image/png;base64,${item}` } });
                }
            });
            
            contentParts.unshift({ type: "text", text: embeddedText });
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
                if (part.type === "image_url" || part.type === "inline_data") {
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

    attachedFrames.forEach((item, idx) => {
        const wrap = document.createElement("div");
        wrap.className = "dock-img-wrap";

        const isObject = typeof item === "object" && item !== null;
        const mimeType = isObject ? (item.mimeType || "image/png") : "image/png";
        const data = isObject ? item.data : item;
        const name = isObject ? item.name : `Frame ${idx + 1}`;
        const isImage = isObject ? (item.type === "image" || mimeType.startsWith("image/")) : true;

        if (isImage) {
            const img = document.createElement("img");
            img.src = `data:${mimeType};base64,${data}`;
            img.alt = name;
            wrap.appendChild(img);

            const hasAnnotations = isObject && item.annotations && item.annotations.length > 0;
            if (hasAnnotations) {
                wrap.classList.add("annotated");
            }

            // Add pencil edit overlay
            const editOverlay = document.createElement("div");
            editOverlay.className = "dock-img-edit-overlay";
            editOverlay.title = hasAnnotations ? "Edit visual annotations" : "Annotate image";
            editOverlay.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 20h9"></path>
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                </svg>
            `;
            editOverlay.addEventListener("click", (e) => {
                e.stopPropagation();
                openAnnotationPopup(idx);
            });
            wrap.appendChild(editOverlay);
        } else {
            const fileIcon = document.createElement("div");
            fileIcon.className = "dock-file-icon";
            const isVideo = isObject && item.type === "video";
            const iconSvg = isVideo ? `
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none">
                    <polygon points="23 7 16 12 23 17 23 7"></polygon>
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                </svg>
            ` : `
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                </svg>
            `;
            fileIcon.innerHTML = `
                ${iconSvg}
                <span class="dock-file-name" title="${name}">${name}</span>
            `;
            wrap.appendChild(fileIcon);
        }

        const btn = document.createElement("button");
        btn.className = "close-badge";
        btn.innerHTML = "&times;";
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            attachedFrames.splice(idx, 1);
            renderAttachmentDock();
            updateContextSizeInfo();
        });

        wrap.appendChild(btn);
        dockThumbnails.appendChild(wrap);
    });

    const dockLabel = previewContainer.querySelector(".dock-label");
    if (dockLabel) {
        const hasNonImages = attachedFrames.some(f => typeof f === "object" && f.type !== "image");
        dockLabel.innerText = hasNonImages ? "Attached files" : "Captured frames";
    }

    previewContainer.classList.remove("hidden");
    
    // Auto-transition welcome screen if attachments change
    if (typeof toggleWelcomeScreen === "function") {
        toggleWelcomeScreen(chatHistory.length === 0, false);
    }
    
    updateContextSizeInfo();
    updateSendButtonState();
}

function clearAttachmentDock() {
    attachedFrames = [];
    const dockThumbnails = document.getElementById("dock-thumbnails");
    if (dockThumbnails) dockThumbnails.innerHTML = "";
    document.getElementById("frame-attachment-preview").classList.add("hidden");
    
    // Update welcome screen state since attachments changed
    if (typeof toggleWelcomeScreen === "function") {
        toggleWelcomeScreen(chatHistory.length === 0, false);
    }
    
    updateContextSizeInfo();
    updateSendButtonState();
}
window.clearAttachmentDock = clearAttachmentDock;

window.currentAnnotationData = null;

function openAnnotationPopup(idx) {
    const item = attachedFrames[idx];
    if (!item) return;

    const isObject = typeof item === "object" && item !== null;
    const mimeType = isObject ? (item.mimeType || "image/png") : "image/png";
    const data = isObject ? item.data : item;
    const name = isObject ? item.name : `Frame ${idx + 1}`;

    window.currentAnnotationData = {
        index: idx,
        base64Data: data,
        mimeType: mimeType,
        name: name,
        frameNumber: isObject ? item.frameNumber : null,
        timeInSeconds: isObject ? item.timeInSeconds : null,
        annotations: isObject ? (item.annotations || []) : []
    };

    // If running inside Adobe CEP/CEF panel, use iframe modal overlay since CEF blocks window.open popups
    if (window.cep || !window.open) {
        const iframe = document.getElementById("annotation-iframe");
        const container = document.getElementById("annotation-modal-container");
        if (iframe && container) {
            iframe.src = 'annotation.html';
            container.style.display = "block";
            // Prevent Chromium window scroll shifts when modals/iframes open
            document.documentElement.scrollTop = 0;
            document.documentElement.scrollLeft = 0;
            document.body.scrollTop = 0;
            document.body.scrollLeft = 0;
            const arcRoot = document.getElementById("arc-root");
            if (arcRoot) {
                arcRoot.scrollTop = 0;
                arcRoot.scrollLeft = 0;
            }
            return;
        }
    }

    // Fallback: Open native Chromium popup window (mockup mode / browser testing)
    const w = 820;
    const h = 640;
    const left = (window.screen.width - w) / 2;
    const top = (window.screen.height - h) / 2;
    window.open('annotation.html', 'ArcEditorAnnotation', `width=${w},height=${h},left=${left},top=${top},scrollbars=no,resizable=yes`);
}

window.closeAnnotationPopup = function() {
    const container = document.getElementById("annotation-modal-container");
    if (container) {
        container.style.display = "none";
    }
    const iframe = document.getElementById("annotation-iframe");
    if (iframe) {
        iframe.src = "";
    }
    // Prevent and fix CEF/Chrome scroll-shifting bug on iframe/modal blur/focus
    document.documentElement.scrollTop = 0;
    document.documentElement.scrollLeft = 0;
    document.body.scrollTop = 0;
    document.body.scrollLeft = 0;
    const arcRoot = document.getElementById("arc-root");
    if (arcRoot) {
        arcRoot.scrollTop = 0;
        arcRoot.scrollLeft = 0;
    }
};

window.saveAnnotationsFromPopup = function(idx, shapes) {
    if (idx === null || idx === undefined || !attachedFrames[idx]) return;
    const item = attachedFrames[idx];
    item.annotations = shapes;
    renderAttachmentDock();
    addSystemMessage(`Visual annotations applied to attachment "${item.name || 'image'}".`);
};

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
    const btnNewChatTab = document.getElementById("btn-new-chat-tab");
    const btnPastChats = document.getElementById("btn-past-chats");
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
        }
        updateSendButtonState();
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
    if (btnNewChatTab) btnNewChatTab.disabled = !ready;
    if (btnPastChats) btnPastChats.disabled = !ready;
    if (chipCapture) chipCapture.disabled = !ready;
    if (chipCaptureSequence) chipCaptureSequence.disabled = !ready;
    const welcomeChipCapture = document.getElementById("welcome-chip-capture");
    const welcomeChipCaptureSequence = document.getElementById("welcome-chip-capture-sequence");
    if (welcomeChipCapture) welcomeChipCapture.disabled = !ready;
    if (welcomeChipCaptureSequence) welcomeChipCaptureSequence.disabled = !ready;
    if (btnSettings) btnSettings.disabled = !ready;
    if (btnInspectComp) btnInspectComp.disabled = !ready;

    if (typeof renderChatTabs === "function") {
        renderChatTabs();
    }

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
            const loaderEl = activeContainer.querySelector(".dots-loader");
            if (loaderEl) {
                executingLoader = loaderEl.parentElement;
                executingLoader.style.display = "none";
            }
        }

        const toolName = tc.tool;
        let paramString = "";
        if (toolName === "executeScript" && tc.parameters && tc.parameters.scriptName) {
            const scriptObj = typeof findScriptByName === "function" ? findScriptByName(currentProjectPath, tc.parameters.scriptName) : null;
            paramString = `Script: ${tc.parameters.scriptName}\n\nContent:\n${scriptObj ? scriptObj.content : "(Not Found)"}`;
        } else if (toolName === "createScript" && tc.parameters) {
            paramString = `Script: ${tc.parameters.scriptName}\nExecute: ${tc.parameters.execute ? "Yes" : "No"}\n\nContent:\n${tc.parameters.content}`;
        } else if (toolName === "editScript" && tc.parameters) {
            paramString = `Script: ${tc.parameters.scriptName}\nExecute: ${tc.parameters.execute ? "Yes" : "No"}\n\nTarget:\n${tc.parameters.targetContent}\n\nReplacement:\n${tc.parameters.replacementContent}`;
        } else if (toolName === "submitPlan" && tc.parameters && tc.parameters.plan) {
            paramString = tc.parameters.plan;
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

        let targetDiv = contentDiv;
        if (activeContainer) {
            const activeContentArea = activeContainer.querySelector(".active-content-area");
            if (activeContentArea) {
                targetDiv = activeContentArea;
            }
        }
        targetDiv.appendChild(cardDiv);
        scrollToBottom(true);

        const btnAllow = cardDiv.querySelector(".btn-confirm-allow");
        const btnAllowAll = cardDiv.querySelector(".btn-confirm-allow-all");
        const btnDeny = cardDiv.querySelector(".btn-confirm-deny");
        const btnDenyAll = cardDiv.querySelector(".btn-confirm-deny-all");

        btnAllow.addEventListener("click", () => {
            cardDiv.remove();
            if (executingLoader) {
                executingLoader.style.display = "";
            }
            resolve("allow");
        });

        btnAllowAll.addEventListener("click", () => {
            cardDiv.remove();
            if (executingLoader) {
                executingLoader.style.display = "";
            }
            resolve("allowAll");
        });

        btnDeny.addEventListener("click", () => {
            cardDiv.innerHTML = `
                <div style="font-weight: 600; font-size: 11px; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                    <svg viewBox="0 0 24 24" width="12" height="12" stroke="var(--text-error)" stroke-width="2.5" fill="none">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                    <span>Denial Reason (Optional)</span>
                </div>
                <div style="margin-bottom: 4px;">
                    <input type="text" class="deny-reason-input form-input" placeholder="Why did you deny this? (optional)" style="width: 100%; box-sizing: border-box; padding: 4px 8px; font-size: 10px; height: 22px;" />
                </div>
                <div style="display: flex; gap: 4px; justify-content: flex-end; margin-top: 8px;">
                    <button class="btn-deny-skip" style="width: auto; padding: 2px 8px; font-size: 9px; font-weight: 600; height: 20px; border-radius: var(--border-radius-sm); background: #3e3e3e; border: 1px solid #555; color: var(--text-primary); cursor: pointer;">Skip</button>
                    <button class="btn-deny-submit" style="width: auto; padding: 2px 10px; font-size: 9px; font-weight: 600; height: 20px; border-radius: var(--border-radius-sm); background: rgba(255, 68, 68, 0.3); border: 1px solid var(--text-error); color: var(--text-error); cursor: pointer;">Submit</button>
                </div>
            `;
            scrollToBottom(true);

            const inputField = cardDiv.querySelector(".deny-reason-input");
            const btnSkip = cardDiv.querySelector(".btn-deny-skip");
            const btnSubmit = cardDiv.querySelector(".btn-deny-submit");

            inputField.focus();

            const handleDenial = (reason) => {
                reason = (reason || "").trim();
                cardDiv.remove();
                if (executingLoader) {
                    executingLoader.style.display = "";
                }
                if (reason) {
                    resolve(`deny::${reason}`);
                } else {
                    resolve("deny");
                }
                scrollToBottom(true);
            };

            btnSkip.addEventListener("click", () => {
                handleDenial("");
            });

            btnSubmit.addEventListener("click", () => {
                handleDenial(inputField.value);
            });

            inputField.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    handleDenial(inputField.value);
                }
            });
        });

        btnDenyAll.addEventListener("click", () => {
            cardDiv.remove();
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
            const loaderEl = activeContainer.querySelector(".dots-loader");
            if (loaderEl) {
                executingLoader = loaderEl.parentElement;
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

        let targetDiv = contentDiv;
        if (activeContainer) {
            const activeContentArea = activeContainer.querySelector(".active-content-area");
            if (activeContentArea) {
                targetDiv = activeContentArea;
            }
        }
        targetDiv.appendChild(cardDiv);
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

function openPlanModal() {
    const modal = document.getElementById("plan-modal");
    if (modal) {
        modal.classList.add("active");
        renderPlanModalBody();
    }
}

function closePlanModal() {
    const modal = document.getElementById("plan-modal");
    if (modal) {
        modal.classList.remove("active");
    }
}

function renderPlanModalBody() {
    const modalBody = document.getElementById("plan-modal-body");
    if (modalBody) {
        if (window.activePlan) {
            modalBody.innerHTML = typeof formatMarkdown === "function" ? formatMarkdown(window.activePlan) : `<pre>${window.activePlan}</pre>`;
        } else {
            modalBody.innerHTML = `<div style="font-size: 11px; color: var(--text-secondary); text-align: center; font-style: italic;">No active plan available.</div>`;
        }
    }
}

function initPinnedPlanToggle() {
    const header = document.querySelector(".pinned-plan-header");
    if (header) {
        if (!header.dataset.listenerBound) {
            header.addEventListener("click", () => {
                openPlanModal();
            });
            header.dataset.listenerBound = "true";
        }
    }

    const closeBtn = document.getElementById("btn-close-plan");
    if (closeBtn) {
        if (!closeBtn.dataset.listenerBound) {
            closeBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                closePlanModal();
            });
            closeBtn.dataset.listenerBound = "true";
        }
    }

    const modal = document.getElementById("plan-modal");
    if (modal) {
        const overlay = modal.querySelector(".modal-overlay");
        if (overlay && !overlay.dataset.listenerBound) {
            overlay.addEventListener("click", (e) => {
                e.stopPropagation();
                closePlanModal();
            });
            overlay.dataset.listenerBound = "true";
        }
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPinnedPlanToggle);
} else {
    initPinnedPlanToggle();
}

window.updatePinnedPlanUI = function() {
    const container = document.getElementById("pinned-plan-container");
    if (!container) return;

    if (window.activePlan) {
        container.classList.remove("hidden");
        const modal = document.getElementById("plan-modal");
        if (modal && modal.classList.contains("active")) {
            renderPlanModalBody();
        }
    } else {
        container.classList.add("hidden");
        closePlanModal();
    }
};

window.collapseDetailsWithAnimation = function(detailsEl) {
    if (!detailsEl || !detailsEl.hasAttribute("open") || detailsEl.dataset.animating === "true") return;

    if (typeof uiTransitionsEnabled !== "undefined" && !uiTransitionsEnabled) {
        detailsEl.removeAttribute("open");
        // Also collapse child tool cards instantly when parent turn is collapsed
        if (detailsEl.classList.contains("agent-turn-details")) {
            const childCards = detailsEl.querySelectorAll(".tool-call-card");
            childCards.forEach(card => card.removeAttribute("open"));
        }
        return;
    }

    detailsEl.dataset.animating = "true";
    const summary = detailsEl.querySelector("summary");
    
    // Calculate exact collapsed height (summary height + details borders + details padding)
    const computedStyle = window.getComputedStyle(detailsEl);
    const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
    const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;
    const borderTop = parseFloat(computedStyle.borderTopWidth) || 0;
    const borderBottom = parseFloat(computedStyle.borderBottomWidth) || 0;
    const collapsedHeight = (summary ? summary.offsetHeight : 24) + paddingTop + paddingBottom + borderTop + borderBottom;
    
    const startHeight = detailsEl.offsetHeight;

    detailsEl.style.height = `${startHeight}px`;
    detailsEl.style.overflow = "hidden";

    // Force reflow
    detailsEl.offsetHeight;

    detailsEl.style.transition = "height 0.25s cubic-bezier(0.4, 0, 0.2, 1)";
    detailsEl.style.height = `${collapsedHeight}px`;

    const onEnd = (e) => {
        if (e.target !== detailsEl) return;
        if (e.propertyName === "height") {
            detailsEl.removeEventListener("transitionend", onEnd);
            detailsEl.removeAttribute("open");
            detailsEl.style.height = "";
            detailsEl.style.overflow = "";
            detailsEl.style.transition = "";
            detailsEl.dataset.animating = "false";
            
            // Also collapse child tool cards instantly when parent turn completes collapse animation
            if (detailsEl.classList.contains("agent-turn-details")) {
                const childCards = detailsEl.querySelectorAll(".tool-call-card");
                childCards.forEach(card => {
                    card.removeAttribute("open");
                    card.style.height = "";
                    card.style.overflow = "";
                    card.style.transition = "";
                });
            }
        }
    };
    detailsEl.addEventListener("transitionend", onEnd);
};

window.expandDetailsWithAnimation = function(detailsEl) {
    if (!detailsEl || detailsEl.hasAttribute("open") || detailsEl.dataset.animating === "true") return;

    if (typeof uiTransitionsEnabled !== "undefined" && !uiTransitionsEnabled) {
        detailsEl.setAttribute("open", "");
        return;
    }

    detailsEl.dataset.animating = "true";
    const summary = detailsEl.querySelector("summary");
    
    // Calculate exact collapsed height (summary height + details borders + details padding)
    const computedStyle = window.getComputedStyle(detailsEl);
    const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
    const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;
    const borderTop = parseFloat(computedStyle.borderTopWidth) || 0;
    const borderBottom = parseFloat(computedStyle.borderBottomWidth) || 0;
    const collapsedHeight = (summary ? summary.offsetHeight : 24) + paddingTop + paddingBottom + borderTop + borderBottom;

    // First set open attribute so contents are rendered and we can measure
    detailsEl.setAttribute("open", "");

    // Measure full height
    const fullHeight = detailsEl.offsetHeight;

    // Set start height to collapsed height
    detailsEl.style.height = `${collapsedHeight}px`;
    detailsEl.style.overflow = "hidden";

    // Force reflow
    detailsEl.offsetHeight;

    // Transition to full height
    detailsEl.style.transition = "height 0.25s cubic-bezier(0.4, 0, 0.2, 1)";
    detailsEl.style.height = `${fullHeight}px`;

    const onEnd = (e) => {
        if (e.target !== detailsEl) return;
        if (e.propertyName === "height") {
            detailsEl.removeEventListener("transitionend", onEnd);
            detailsEl.style.height = "";
            detailsEl.style.overflow = "";
            detailsEl.style.transition = "";
            detailsEl.dataset.animating = "false";
        }
    };
    detailsEl.addEventListener("transitionend", onEnd);
};

function isTextFile(file) {
    if (file.type && file.type.startsWith("text/")) return true;
    if (file.type && (file.type === "application/json" || file.type === "application/javascript" || file.type === "application/xml" || file.type.includes("json") || file.type.includes("xml"))) return true;
    const textExtensions = [
        ".txt", ".js", ".jsx", ".ts", ".tsx", ".json", ".html", ".css", ".md", 
        ".xml", ".yaml", ".yml", ".py", ".sh", ".bat", ".ps1", ".svg", 
        ".c", ".cpp", ".h", ".java", ".cs", ".go", ".rs", ".php", ".rb", ".ini", ".conf", ".cfg", ".csv"
    ];
    const dotIdx = file.name.lastIndexOf(".");
    if (dotIdx === -1) return false;
    const ext = file.name.substring(dotIdx).toLowerCase();
    return textExtensions.includes(ext);
}

function extractTextFromPDF(arrayBuffer) {
    let zlibModule = null;
    try {
        if (typeof require !== "undefined") {
            zlibModule = require('zlib');
        }
    } catch (e) {
        console.warn("Node zlib module not available for PDF text extraction.", e);
    }

    if (!zlibModule) {
        return parseUncompressedPDFText(arrayBuffer);
    }

    const pdfBuffer = Buffer.from(arrayBuffer);
    let text = "";
    let pos = 0;
    
    while (true) {
        const streamStartIdx = pdfBuffer.indexOf(Buffer.from("stream"), pos);
        if (streamStartIdx === -1) break;
        
        let contentStart = streamStartIdx + 6;
        if (pdfBuffer[contentStart] === 13) contentStart++; 
        if (pdfBuffer[contentStart] === 10) contentStart++; 
        
        const streamEndIdx = pdfBuffer.indexOf(Buffer.from("endstream"), contentStart);
        if (streamEndIdx === -1) break;
        
        const streamData = pdfBuffer.slice(contentStart, streamEndIdx);
        
        const dictStartIdx = pdfBuffer.lastIndexOf(Buffer.from("<<"), streamStartIdx);
        let isFlate = false;
        if (dictStartIdx !== -1 && dictStartIdx < streamStartIdx) {
            const dictData = pdfBuffer.slice(dictStartIdx, streamStartIdx).toString('ascii');
            if (dictData.includes("/FlateDecode") || dictData.includes("/Flate")) {
                isFlate = true;
            }
        }
        
        let decompressed = null;
        if (isFlate) {
            try {
                decompressed = zlibModule.inflateSync(streamData);
            } catch (err) {
                // If FlateDecode fails, fallback raw
            }
        } else {
            decompressed = streamData;
        }
        
        if (decompressed) {
            const decompressedStr = decompressed.toString('binary');
            let btIdx = 0;
            while (true) {
                btIdx = decompressedStr.indexOf("BT", btIdx);
                if (btIdx === -1) break;
                
                const etIdx = decompressedStr.indexOf("ET", btIdx);
                if (etIdx === -1) {
                    btIdx += 2;
                    continue;
                }
                
                const textBlock = decompressedStr.substring(btIdx + 2, etIdx);
                const regex = /\(((?:[^)\\]|\\.)*)\)/g;
                let match;
                while ((match = regex.exec(textBlock)) !== null) {
                    let matchedText = match[1];
                    matchedText = matchedText
                        .replace(/\\([\(\)])/g, '$1')
                        .replace(/\\n/g, '\n')
                        .replace(/\\r/g, '\r')
                        .replace(/\\t/g, '\t');
                    text += matchedText + " ";
                }
                
                btIdx = etIdx + 2;
            }
        }
        
        pos = streamEndIdx + 9;
    }
    
    return text.replace(/\s+/g, ' ').trim();
}

function parseUncompressedPDFText(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    let str = "";
    for (let i = 0; i < view.byteLength; i++) {
        str += String.fromCharCode(view.getUint8(i));
    }
    let text = "";
    let btIdx = 0;
    while (true) {
        btIdx = str.indexOf("BT", btIdx);
        if (btIdx === -1) break;
        const etIdx = str.indexOf("ET", btIdx);
        if (etIdx === -1) {
            btIdx += 2;
            continue;
        }
        const textBlock = str.substring(btIdx + 2, etIdx);
        const regex = /\(((?:[^)\\]|\\.)*)\)/g;
        let match;
        while ((match = regex.exec(textBlock)) !== null) {
            text += match[1] + " ";
        }
        btIdx = etIdx + 2;
    }
    return text.replace(/\s+/g, ' ').trim();
}

async function handleFileSelection(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
            await processUploadedFile(file);
        } catch (err) {
            addSystemMessage(`Failed to read file ${file.name}: ${err.message}`);
        }
    }
    event.target.value = "";
}

function processUploadedFile(file) {
    return new Promise((resolve, reject) => {
        const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
        
        if (file.type.startsWith("video/") || [".mp4", ".webm", ".mov", ".ogg", ".avi", ".mkv"].includes(ext)) {
            addSystemMessage(`Extracting frames from video ${file.name}...`);
            extractVideoFrames(file).then(frames => {
                if (frames && frames.length > 0) {
                    attachedFrames.push({
                        type: "video",
                        name: file.name,
                        mimeType: file.type || "video/mp4",
                        size: file.size,
                        frames: frames
                    });
                    renderAttachmentDock();
                    updateContextSizeInfo();
                    addSystemMessage(`Successfully extracted ${frames.length} frames from ${file.name}.`);
                    resolve();
                } else {
                    reject(new Error("No frames could be extracted from the video file. Make sure it is a valid, playable video."));
                }
            }).catch(reject);
        } else if (file.type.startsWith("image/")) {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error("Error reading image file"));
            reader.onload = (e) => {
                const base64Data = e.target.result.split(',')[1];
                attachedFrames.push({
                    type: "image",
                    name: file.name,
                    mimeType: file.type || "image/png",
                    size: file.size,
                    data: base64Data
                });
                renderAttachmentDock();
                updateContextSizeInfo();
                resolve();
            };
            reader.readAsDataURL(file);
        } else if (ext === ".pdf") {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error("Error reading PDF file"));
            reader.onload = (e) => {
                const arrayBuffer = e.target.result;
                let extractedText = "";
                try {
                    extractedText = extractTextFromPDF(arrayBuffer);
                } catch (err) {
                    console.error("PDF text extraction failed:", err);
                }

                // Fast chunked / native base64 conversion
                let base64Data = "";
                if (typeof Buffer !== "undefined") {
                    base64Data = Buffer.from(arrayBuffer).toString('base64');
                } else {
                    let binary = "";
                    const bytes = new Uint8Array(arrayBuffer);
                    const len = bytes.byteLength;
                    const chunk_size = 0x8000; // 32KB chunks
                    for (let i = 0; i < len; i += chunk_size) {
                        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk_size));
                    }
                    base64Data = btoa(binary);
                }

                attachedFrames.push({
                    type: "pdf",
                    name: file.name,
                    mimeType: "application/pdf",
                    size: file.size,
                    data: base64Data,
                    textContent: extractedText
                });
                renderAttachmentDock();
                updateContextSizeInfo();
                resolve();
            };
            reader.readAsArrayBuffer(file);
        } else if (isTextFile(file)) {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error("Error reading text file"));
            reader.onload = (e) => {
                const textContent = e.target.result;
                let base64Data = "";
                try {
                    base64Data = btoa(unescape(encodeURIComponent(textContent)));
                } catch (err) {
                    base64Data = btoa(textContent);
                }
                attachedFrames.push({
                    type: "text",
                    name: file.name,
                    mimeType: file.type || "text/plain",
                    size: file.size,
                    data: base64Data,
                    textContent: textContent
                });
                renderAttachmentDock();
                updateContextSizeInfo();
                resolve();
            };
            reader.readAsText(file);
        } else {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error("Error reading binary file"));
            reader.onload = (e) => {
                const base64Data = e.target.result.split(',')[1];
                attachedFrames.push({
                    type: "binary",
                    name: file.name,
                    mimeType: file.type || "application/octet-stream",
                    size: file.size,
                    data: base64Data
                });
                renderAttachmentDock();
                updateContextSizeInfo();
                resolve();
            };
            reader.readAsDataURL(file);
        }
    });
}

function extractVideoFrames(file) {
    return new Promise((resolve) => {
        const video = document.createElement("video");
        video.preload = "auto";
        video.muted = true;
        video.playsInline = true;

        const fileURL = URL.createObjectURL(file);
        video.src = fileURL;

        video.addEventListener("loadedmetadata", async () => {
            const duration = video.duration;
            if (!duration || isNaN(duration)) {
                URL.revokeObjectURL(fileURL);
                resolve([]);
                return;
            }

            const frameCount = 5;
            const frames = [];
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            
            const targetWidth = 640;
            const aspectRatio = video.videoWidth / video.videoHeight;
            canvas.width = targetWidth;
            canvas.height = targetWidth / (aspectRatio || 1);

            const intervals = [0.1, 0.3, 0.5, 0.7, 0.9];

            for (let i = 0; i < intervals.length; i++) {
                const targetTime = duration * intervals[i];
                video.currentTime = targetTime;
                
                await new Promise((seekResolve) => {
                    const onSeeked = () => {
                        video.removeEventListener("seeked", onSeeked);
                        try {
                            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                            const base64Data = canvas.toDataURL("image/png").split(",")[1];
                            frames.push({
                                type: "image",
                                name: `${file.name} (Frame ${i + 1})`,
                                mimeType: "image/png",
                                data: base64Data
                            });
                        } catch (err) {
                            console.error("Failed to capture video frame at " + targetTime, err);
                        }
                        seekResolve();
                    };
                    video.addEventListener("seeked", onSeeked);
                });
            }

            URL.revokeObjectURL(fileURL);
            video.src = "";
            video.load();
            resolve(frames);
        });

        video.addEventListener("error", (e) => {
            console.error("Video load error:", e);
            URL.revokeObjectURL(fileURL);
            resolve([]);
        });
    });
}


