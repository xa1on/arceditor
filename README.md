# ArcEditor 🌌

ArcEditor is a premium, context-aware AI co-pilot and automated rigging harness designed as a **100% self-contained Adobe After Effects Extension**. 

By leveraging Adobe CEP's mixed-context runtime, ArcEditor blends a sleek, glassmorphic HTML5/CSS panel in the frontend with a powerful embedded **Node.js** execution loop in the backend. It connects directly to local open-source models via **Lemonade** (supporting multimodal vision completions) or leading cloud APIs (Gemini, OpenAI, Anthropic), allowing you to automate repetitive tasks while retaining complete artistic control.

---

## Key Features

* **100% Self-Contained**: Runs entirely within a single After Effects panel. No background terminal servers or terminal installations are required for the editor.
* **The Animator-Control-Centric Paradigm**: Instead of baking millions of locked, un-editable keyframes, the agent creates **Null Control Layers** rigged with native **Expression Controls (Sliders, Angles, Colors)** and links them to properties via clean, live expressions. You keep 100% artistic control.
* **Visual Context (Canvas Eye)**: Captures your active timeline frame on-demand as a PNG, translates it to a base64 payload, and feeds it into local or cloud visual LLMs so they can "see" your composition.
* **Structural Context (Timeline Inspector)**: Automatically inspects and serializes active composition layer stacks, property parameters, and dimensions into JSON to provide strict structural prompts for the LLM.
* **ReAct Self-Correction**: If a generated ExtendScript triggers an exception in After Effects, ArcEditor catches the error, feeds it back to the LLM, and automatically corrects and re-runs it without user intervention.
* **AE 2020+ Backwards Compatibility**: Designed using Node 12-safe standards, fully compatible with After Effects 2020 through After Effects 2026.

---

## Visual File Structure

```text
/agentic-video-editing
├── /CSXS
│     └── manifest.xml        # Panel registration, targets AE 17.0+ (CSXS 9.0+)
├── /jsx
│     └── host.jsx            # Core AE scripting suite (inspections, preview rendering, slider rigs)
├── /lib
│     └── CSInterface.js      # Adobe CEP integration bridge
├── index.html                # UI panel layout (Chat pane, settings sheet, code console)
├── index.css                 # Advanced visual styling, custom scrollbars, and micro-animations
├── index.js                  # Frontend orchestrator, Node.js connection client, ReAct loop
├── package.json              # Extension metadata and script packages
├── setup_dev_mode.ps1        # Admin PowerShell script for automatic registry & symlink setup
└── README.md                 # Setup & usage instructions
```

---

## Installation & Configuration

### Option A: Automatic Setup (PowerShell - Recommended)
1. Close Adobe After Effects.
2. Open PowerShell as **Administrator**.
3. Navigate to this directory and run the helper script:
   ```powershell
   Set-ExecutionPolicy Bypass -Scope Process
   .\setup_dev_mode.ps1
   ```
4. This script automatically:
   - Configures the Windows Registry to run unsigned local extensions (enables Adobe `PlayerDebugMode` across CSXS 9, 10, and 11).
   - Creates a symbolic link directly from Adobe's extensions directory (`%APPDATA%\Adobe\CEP\extensions\`) pointing back to this workspace.

### Option B: Manual Setup
1. Enable Adobe PlayerDebugMode by opening PowerShell and executing:
   ```powershell
   reg add "HKCU\Software\Adobe\CSXS.9" /v PlayerDebugMode /t REG_SZ /d 1 /f
   reg add "HKCU\Software\Adobe\CSXS.10" /v PlayerDebugMode /t REG_SZ /d 1 /f
   reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f
   ```
2. Copy the entire `/agentic-video-editing` directory to Adobe's CEP extensions folder:
   - Path: `C:\Users\<Your_User>\AppData\Roaming\Adobe\CEP\extensions\com.arceditor\`
3. Open this folder in terminal and install packages:
   ```bash
   npm install
   ```

---

## Quick-Start Usage Guide

1. **Launch After Effects** and open a composition.
2. Open the extension panel from **Window > Extensions > ArcEditor**.
3. Click the **API Settings (Gear Icon)** in the header:
   - Choose your provider: **Lemonade (Local Server)**, **Gemini**, **OpenAI**, or **Anthropic**.
   - Input your corresponding model name and API keys (API keys are stored locally on your machine in `config.json`).
   - Click **Save & Apply**.
4. Check the **Status Indicator Dot** in the header. It will pulse **green** when successfully connected.
5. Try a prompt!
   - Select a layer in your timeline.
   - Click the **Wiggles** quick-chip or type:
     *"Link the scale of my selected layer to a wiggle expression control slider rig."*
   - Press **Send**.
   - The agent will serialize your comp, design the script, execute it inside After Effects, and notify you when complete.

---

## The Expression Rigging Philosophy

Instead of baked-keyframe files, ArcEditor writes dynamic expressions linked to expression controls. Here are examples of what the LLM generates automatically:

### 1. Wiggle Rig (Position / Scale / Rotation)
Creates a null controller with frequency/amplitude sliders and applies:
```javascript
var f = thisComp.layer("Wiggle Controls").effect("Frequency")("Slider");
var a = thisComp.layer("Wiggle Controls").effect("Amplitude")("Slider");
wiggle(f, a);
```

### 2. Smooth Inertial Bounce
Applies a math-based decaying spring bounce that fires automatically on keyframe changes, with sliders on a controller null:
```javascript
var amp = thisComp.layer("Bounce Controls").effect("Amplitude")("Slider") / 100;
var freq = thisComp.layer("Bounce Controls").effect("Frequency")("Slider");
var decay = thisComp.layer("Bounce Controls").effect("Decay")("Slider");

var n = 0;
if (numKeys > 0) {
  n = nearestKey(time).index;
  if (key(n).time > time) { n--; }
}
if (n == 0) {
  value;
} else {
  var t = time - key(n).time;
  if (t < 0.25) {
    var v = velocityAtTime(key(n).time - 0.001);
    value + v * amp * Math.sin(freq * t * 2 * Math.PI) / Math.exp(decay * t);
  } else {
    value;
  }
}
```

### 3. Dynamic Visual Canvas Debugging
Whenever you ask a visual question (e.g. *"Is my text aligned well?"*), click the **See Canvas** button:
- The panel exports your frame as a PNG.
- It attaches the frame to your chat prompt.
- The visual VLM (like Lemonade's visual model or Gemini 1.5) reviews the exact text wrapping, contrast, and layout issues and writes scripts to adjust values dynamically.