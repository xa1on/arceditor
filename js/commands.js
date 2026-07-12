/**
 * ArcEditor Autocomplete Commands Module
 * Manages registration of slash commands, autocomplete popup UI, keyboard/click handlers,
 * and integration with the chat input wrappers.
 */

(function() {
    const commands = [
        {
            name: "/grill-me",
            description: "Start an interactive alignment session to clarify design decisions",
            action: (inputEl) => {
                inputEl.value = "/grill-me ";
            }
        }
    ];

    window.commandsManager = {
        commands: commands,
        activeIndex: 0,
        activePopup: null,
        activeTextarea: null,
        filteredCommands: [],

        init: function() {
            const chatInput = document.getElementById("chat-input");
            const welcomeInput = document.getElementById("welcome-chat-input");
            const chatPopup = document.getElementById("chat-command-popup");
            const welcomePopup = document.getElementById("welcome-command-popup");

            if (chatInput && chatPopup) {
                this.attach(chatInput, chatPopup);
            }
            if (welcomeInput && welcomePopup) {
                this.attach(welcomeInput, welcomePopup);
            }
        },

        attach: function(textarea, popup) {
            const self = this;

            textarea.addEventListener("input", function() {
                const val = textarea.value;
                if (val.startsWith("/")) {
                    self.activeTextarea = textarea;
                    self.activePopup = popup;
                    const query = val.substring(1).toLowerCase();
                    self.filterAndShow(query);
                } else {
                    self.hide(popup);
                }
            });

            textarea.addEventListener("keydown", function(e) {
                if (!popup || popup.classList.contains("hidden")) {
                    return;
                }

                if (e.key === "ArrowDown") {
                    e.preventDefault();
                    if (self.filteredCommands.length > 0) {
                        self.activeIndex = (self.activeIndex + 1) % self.filteredCommands.length;
                        self.renderList();
                    }
                } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    if (self.filteredCommands.length > 0) {
                        self.activeIndex = (self.activeIndex - 1 + self.filteredCommands.length) % self.filteredCommands.length;
                        self.renderList();
                    }
                } else if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    self.selectActive();
                } else if (e.key === "Escape") {
                    e.preventDefault();
                    self.hide(popup);
                }
            });

            // Hide when clicking outside
            document.addEventListener("click", function(e) {
                if (!popup.contains(e.target) && e.target !== textarea) {
                    self.hide(popup);
                }
            });
        },

        filterAndShow: function(query) {
            this.filteredCommands = this.commands.filter(cmd => 
                cmd.name.substring(1).toLowerCase().startsWith(query)
            );

            if (this.filteredCommands.length === 0) {
                if (this.activePopup) {
                    this.hide(this.activePopup);
                }
                return;
            }

            if (this.activeIndex >= this.filteredCommands.length) {
                this.activeIndex = 0;
            }

            if (this.activePopup) {
                this.activePopup.classList.remove("hidden");
                this.renderList();
            }
        },

        renderList: function() {
            if (!this.activePopup) return;
            const self = this;
            this.activePopup.innerHTML = "";

            this.filteredCommands.forEach((cmd, idx) => {
                const item = document.createElement("div");
                item.className = "command-option-item" + (idx === this.activeIndex ? " active" : "");
                item.setAttribute("data-index", idx);

                item.innerHTML = `
                    <div class="command-option-left">
                        <span class="command-name">${cmd.name}</span>
                        <span class="command-description">${cmd.description}</span>
                    </div>
                    <div class="command-option-right">
                        <kbd class="command-kbd">Tab</kbd>
                    </div>
                `;

                item.addEventListener("click", function(e) {
                    e.stopPropagation();
                    self.activeIndex = idx;
                    self.selectActive();
                });

                this.activePopup.appendChild(item);
            });
        },

        selectActive: function() {
            if (this.filteredCommands.length === 0 || !this.activeTextarea) return;
            const cmd = this.filteredCommands[this.activeIndex];
            const textarea = this.activeTextarea;
            const popup = this.activePopup;

            this.hide(popup);

            // Execute the autofill action
            cmd.action(textarea);

            // Set focus back to input
            textarea.focus();

            // Trigger the textarea resize and state updates in index.js
            const event = new Event("input", { bubbles: true });
            textarea.dispatchEvent(event);
        },

        hide: function(popup) {
            const targetPopup = popup || this.activePopup;
            if (targetPopup) {
                targetPopup.classList.add("hidden");
                targetPopup.innerHTML = "";
            }
            if (targetPopup === this.activePopup) {
                this.activePopup = null;
                this.activeTextarea = null;
                this.filteredCommands = [];
                this.activeIndex = 0;
            }
        }
    };
})();
