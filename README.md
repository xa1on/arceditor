# ArcEditor

ArcEditor is a context-aware AI co-pilot and editing harness built as a self-contained Adobe After Effects CEP Extension. It integrates a native dark theme HTML5 panel with an embedded Node.js execution loop to communicate with local models (via Lemonade) or cloud APIs (Gemini, OpenAI, Anthropic).

## Key Features

* **Self-Contained**: Runs entirely inside a single After Effects panel. No background terminal servers or external terminal processes are required.
* **Expression-Centric Controls**: Instead of writing dense, locked keyframes, the agent creates Null Control Layers populated with Sliders, Angles, and Color effects, linking properties via dynamic expressions to preserve user control.
* **Visual Context**: Captures the active timeline frame on-demand as a PNG, encoding it to base64 to allow VLMs to review composition alignment, text layout, and visual flow.
* **Structural Context**: Inspector automatically serializes composition details, layer properties, dimensions, and unique layer IDs into JSON, providing exact timeline context for the agent.
* **ReAct Self-Correction**: If a generated ExtendScript encounters an error, the panel catches the exception, pushes it back to the model, and automatically runs a corrected iteration.
* **AE 2020+ Compatibility**: Uses Node 12 standards compatible with After Effects 2020 through 2026.

## Directory Structure

```text
/agentic-video-editing
├── /CSXS
│     └── manifest.xml        # Panel registration for AE 17.0+
├── /jsx
│     └── host.jsx            # ExtendScript API suite and inspections
├── /lib
│     └── CSInterface.js      # Adobe CEP integration library
├── index.html                # UI panel layout (Chat, settings, code scratchpad)
├── index.css                 # AE native dark theme layout rules
├── index.js                  # Frontend client and agent loop orchestration
├── package.json              # Extension package manifest
├── setup_dev_mode.ps1        # Admin script for symbolic link and debug registry
└── README.md                 # Minimal setup guide
```

## Setup Instructions

### Option A: Automatic Setup (PowerShell)
1. Close After Effects.
2. Open PowerShell as Administrator.
3. Run the setup script from the project directory:
   ```powershell
   Set-ExecutionPolicy Bypass -Scope Process
   .\setup_dev_mode.ps1
   ```
This automatically enables Adobe PlayerDebugMode across CSXS 9 to 11 and creates a symbolic link to Adobe's CEP extensions folder.

### Option B: Manual Setup
1. Enable Adobe PlayerDebugMode:
   ```powershell
   reg add "HKCU\Software\Adobe\CSXS.9" /v PlayerDebugMode /t REG_SZ /d 1 /f
   reg add "HKCU\Software\Adobe\CSXS.10" /v PlayerDebugMode /t REG_SZ /d 1 /f
   reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f
   ```
2. Symlink or copy the repository directory to:
   `%APPDATA%\Adobe\CEP\extensions\com.arceditor\`

## Usage Guide

1. Open After Effects and load a composition.
2. Open **Window > Extensions > ArcEditor**.
3. Click the gear icon in the header to open settings, select your provider (Lemonade, Gemini, OpenAI, or Anthropic), input your keys, and save.
4. The status indicator dot in the header will turn green once a successful connection is established.
5. In the chat, describe your required animation or timeline structure, select target layers if needed, and send.