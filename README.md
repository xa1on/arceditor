<h1 align="center">ArcEditor</h1>

</br>

<img class="trimmed-cover" src="assets/arceditor-header.png" alt="ArcEditor Header" width="100%">

ArcEditor is a context-aware AI co-pilot and timeline automation harness built as a self-contained Adobe After Effects CEP Extension. ArcEditor enables real-time natural language interaction to build, edit, and animate complex motion graphics rigs directly inside After Effects.

---

## Architecture Overview

```mermaid
graph TD
    User([User Prompt]) --> Panel[CEP Frontend Panel / index.html & index.js]
    Panel --> Orchestrator[Agent Loop Orchestrator / js/agent.js]
    Orchestrator --> APIClient[LLM API Client / js/api-client.js]
    APIClient --> LLM{AI Models: Lemonade / Gemini / OpenAI / Anthropic}
    LLM -->|JSON Tool Calls / ExtendScript| Orchestrator
    Orchestrator --> TimelineBridge[Timeline RPC Bridge / js/timeline.js]
    TimelineBridge -->|CSInterface / JSX Execution| Host[After Effects Host Engine]
    Host -->|ExtendScript API: $. _com_arceditor_.ArcEditor| AECOMP[Composition / Timeline]
    AECOMP -->|Active Frame Capture / Base64| TimelineBridge
    TimelineBridge -->|Visual Observations| Orchestrator
```

The extension operates on a closed-loop **ReAct (Reasoning and Action) self-correction cycle**:
1. The **Agent Orchestrator** fetches structural composition context (`getTimelineContext`).
2. The **LLM Client** generates a sequence of actions or high-level ExtendScript code.
3. The **Timeline Bridge** runs the ExtendScript inside After Effects under an isolated transaction namespace (`$._com_arceditor_.ArcEditor`).
4. Visual rendering tools (`captureActiveFrame` or `captureCompositionSequence`) fetch base64 frames back to the agent for visual validation.
5. If syntax or layout runtime errors occur, the orchestrator catches them and automatically triggers self-correction loops.

---

## Key Features

* **Zero-Dependency Setup**: Runs entirely within the Adobe CEP panel context. No external terminal servers or external background processes are needed.
* **Expression-Centric Automation**: Instead of baking hardcoded keyframes, the agent creates Control Null layers (e.g. `[RigName] Controls`) containing Sliders, Angle, and Color controls, linking attributes via dynamic expressions so motion designers maintain full creative control.
* **Visual & Structural Context**: Programmatically grabs the active composition context, layer hierarchies, properties, and on-demand frames to let multi-modal models review layout coordinates, typography styling, and alignment.
* **ReAct Self-Correction**: Active scripting exceptions are captured, reverted automatically via atomic Undo points, and sent back to the model for iterative debugging.
* **Project Privacy**: Chat session files entirely locally. By running ArcEditor locally, all data related to your project stays local to your system.

---

## Directory Structure

```text
arceditor/
├── .debug                  # Configures DevTools remote debugging port (8000)
├── CSXS/
│   └── manifest.xml        # CEP panel configuration and target AE versions
├── js/
│   ├── agent.js            # Core ReAct loop, system instructions, and prompt definitions
│   ├── api-client.js       # Outbound network adapters for AI providers
│   ├── settings.js         # Settings manager, session storage, and disk serialization
│   ├── state.js            # Panel state, file pathing, and visual attachments
│   └── timeline.js         # Bridge to CEP host APIs (ExtendScript execution, frame capture)
├── jsx/
│   └── host.jsx            # Native ExtendScript library ($._com_arceditor_.ArcEditor)
├── lib/
│   └── CSInterface.js      # Adobe CEP Integration library
├── index.html              # Modern layout (Chat, Console, and Debug Log tabs)
├── index.css               # Vanilla CSS styling & premium dark glassmorphism design
├── index.js                # Panel DOM bindings and controller handlers
├── package.json            # Node.js project manifest and dependency map
└── setup_dev_mode.ps1      # Developer helper script to toggle PlayerDebugMode and symlinks
```

---

## Setup Instructions

### Option A: Automatic Setup (PowerShell)
1. Close Adobe After Effects.
2. Open **PowerShell** as an Administrator.
3. Navigate to the project directory and execute:
   ```powershell
   Set-ExecutionPolicy Bypass -Scope Process
   .\setup_dev_mode.ps1
   ```
This automatically enables Adobe `PlayerDebugMode` across CSXS versions 9 to 11 and establishes a symbolic link from the repo to Adobe's CEP extensions directory.

### Option B: Manual Setup
1. Open PowerShell and run the following commands to enable debug mode for Adobe CEP extensions:
   ```powershell
   reg add "HKCU\Software\Adobe\CSXS.9" /v PlayerDebugMode /t REG_SZ /d 1 /f
   reg add "HKCU\Software\Adobe\CSXS.10" /v PlayerDebugMode /t REG_SZ /d 1 /f
   reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f
   ```
2. Copy or symlink this repository folder into:
   `%APPDATA%\Adobe\CEP\extensions\com.arceditor\`

---

## Usage Guide

1. Launch **After Effects** and open or create a composition.
2. Open the panel via **Window > Extensions > ArcEditor**.
3. Open the drawer by clicking the **Gear Icon** in the header. Set your AI provider (Gemini, OpenAI, Anthropic, or Lemonade), specify your API endpoint/key, and click **Save & Apply**.
4. The status indicator dot in the header will turn green once a successful connection is established.
5. **Chat Interface**: Describe your required animations, rigs, or layer modifications.
6. **JSX Console**: Test custom scripts directly, running them inside atomic undo blocks.
7. **Debug Log**: Review raw prompts, LLM reasoning steps, and executed JSON tool commands.

---

## ExtendScript API Reference (`ArcEditor`)

To simplify timeline manipulations, the host environment exposes a global API named `$._com_arceditor_.ArcEditor` (aliased as `ArcEditor` inside the agent's execution context). The core methods include:

| Method | Description |
| :--- | :--- |
| `createLayer(type, name, size, color)` | Creates a new layer in the active composition (`type` can be `"Solid"`, `"Text"`, `"Shape"`, `"Null"`, `"Adjustment"`, `"Camera"`, `"Light"`). |
| `applyEffect(layerRef, effectMatchName, effectDisplayName)` | Applies an effect using its native matchName. |
| `setPropertyValue(layerRef, propPath, value, time)` | Unified API to set native layer fields, solid colors, blending modes, and timeline property values. |
| `setPropertyExpression(layerRef, propPath, expressionStr)` | Binds a javascript expression string to a target property. |
| `setKeyframes(layerRef, propPath, times, values, easeIn, easeOut)` | Generates multiple eased keyframes across the timeline. |
| `addShapeToLayer(layerRef, shapeType, groupName, properties)` | Procedurally draws a styled shape vector group (`"Ellipse"`, `"Rect"`) with sizing, fill, and stroke parameters inside a target Shape Layer. |
| `parentLayer(layerRef, parentLayerRef)` | Parents one layer to another. |
| `trimLayer(layerRef, inPoint, outPoint, startTime)` | Clips and slides the layer bounds and position in time. |
| `precompose(layerRefs, precompName, moveAllAttributes)` | Groups an array of layers into a separate precomposition. |
| `resolveLayer(layerRef)` | Safely resolves a layer ID, name, or index into a native AE Layer object. |
| `addMarker(type, layerRef, time, comment, duration, labelIndex)` | Appends a marker to the timeline ruler or an individual layer. |

---

## Debugging and Development

### Chrome DevTools Remote Debugging
You can inspect the CEP panel UI, console outputs, and memory states using Chrome DevTools:
1. Open a Google Chrome or Microsoft Edge window.
2. Navigate to: `http://localhost:8000`.
3. Select the **ArcEditor** target link to launch the inspector.

> [!WARNING]
> The embedded CEP engine uses a custom Chromium context. Refreshing the inspector page at a very high frequency or using an incompatible remote debugger client can occasionally cause the After Effects process to crash. Ensure you avoid rapid repeated page reloads of the DevTools window.