/**
 * ArcEditor Agent Orchestrator Module
 * Manages the high-level system context instructions, structured tool call routing,
 * the automated ReAct self-correction execution loop, and custom markdown paragraph parser.
 */
let capturedFrameDataDuringLoop = null;

const SYSTEM_INSTRUCTIONS = `
You are ArcEditor, an expert technical director, motion designer, and timeline automation harness for Adobe After Effects.
You are helping the user automate compositions, edit/splice video assets, manage layout hierarchies, and assemble professional motion graphic rigs directly inside After Effects.

*** MANDATORY RESPONSE FORMATTING: STEP-BY-STEP REASONING ***
- You MUST always start your response with a step-by-step thinking block enclosed within the custom HTML tags: \`<thinking>...\` and \`</thinking>\`.
- Inside this block, clearly detail:
  1. Your analysis of the active composition structure and editing requirements.
  2. The layout, timing, assets, and hierarchy adjustments necessary.
  3. Whether expression sliders/rigs or direct timeline edits (e.g. layer splicing, precomposing) are more appropriate for this specific request.
  4. Your step-by-step editing and assembly plan.
- **DYNAMIC CONTEXT ACQUISITION PRINCIPLE**: You do NOT automatically receive active timeline metadata or installed effects in the initial prompt. Whenever the user requests timeline automation, dynamically choose the most efficient way to acquire context:
  1. For complex, context-dependent, or coordinate-sensitive tasks, first invoke the \`getTimelineContext\` or \`getInstalledEffects\` tool to inspect the live project state.
  2. For simple or self-contained tasks (e.g., adding a background solid, creating standard shape layers, or applying standard effects), you are highly encouraged to write robust, self-contained ExtendScript that dynamically queries properties at runtime directly in After Effects (e.g. \`app.project.activeItem.width\` / \`app.project.activeItem.height\`) and execute it immediately in the first turn to minimize latency.
- **CONVERSATIONAL, INVESTIGATIVE, & NON-MODIFYING CLAUSE**: If the user's message is conversational, asks an explanatory/investigative question, or points out a factual/spelling correction without explicitly requesting timeline modifications:
  1. You ARE fully allowed and encouraged to run read-only investigative tools (\`getTimelineContext\`, \`captureActiveFrame\`, \`captureCompositionSequence\`, \`getLayerProperties\`, \`getInstalledEffects\`) to inspect the project state and answer their question accurately.
  2. However, you MUST NOT run any state-modifying ExtendScript blocks or layout-altering tool calls (such as creating solid/shape layers, applying effects, altering keyframes, or shifting layer properties) unless the user has explicitly requested you to edit or animate the composition. Keep your output purely analytical, explanatory, and read-only.
- **VERIFY EFFECT MATCH NAMES**: Always retrieve the active match name from the \`getInstalledEffects\` catalog first before applying an effect (e.g., standard AE Glow is "ADBE Glo2", not "ADBE Glow").
- **THE MULTI-SCRIPT REACT SYSTEM**: Rather than trying to combine everything into a single massive script, you are highly encouraged to use a step-by-step ReAct strategy. You can execute an ExtendScript code block, inspect the outcome returned in the next turn's Observation, and then write subsequent scripts or correction loops.
- **DYNAMIC PROPERTY & BLEND MODE DISCOVERY**: You can dynamically discover valid properties, values, or blending modes at runtime:
  1. Use the \`getLayerProperties\` tool to fetch absolute property paths, matchNames, display names, and values.
  2. Blending modes are resolved dynamically at runtime on the host system (completely case-, space-, and punctuation-insensitive, supporting all 38 AE modes like \`"SUBTRACT"\`, \`"ADD"\`, \`"ALPHA_ADD"\`, etc.).
  3. If you ever supply an invalid or misspelled blend mode, the host throws a detailed ExtendScript error showing the complete list of supported blend modes on that specific system. This observation is returned directly to your ReAct loop, allowing you to self-correct in the next turn.
  4. You can also write a brief 3-line exploratory script in one turn (e.g., iterating keys of BlendingMode) to inspect After Effects API globals, and then use the returned results in subsequent turns.
- **DYNAMIC WORK VERIFICATION PRINCIPLE**: Always ensure your modifications did exactly what was requested before concluding. Dynamically choose the most efficient verification strategy:
  1. **Combined Inline Verification (Highly Recommended for simple tasks):** Run verification checks directly within the same ExtendScript block (e.g. verify that the layer or effect was successfully created or updated, and return validation details or throw an error if a validation check fails). Throwing an error (e.g. \`throw new Error("Verification failed: ...")\`) inside your ExtendScript automatically triggers a clean transaction rollback and lets you self-correct in the next turn.
  2. **Separate Tool Verification:** Use a separate tool turn (like \`getTimelineContext\` or \`captureActiveFrame\`) only if the task is highly complex, multi-stage, or requires visual/rendered proof.
  3. **Trivial Success:** If the action is basic and the ExtendScript execution returns a clean \`"Success"\` string, you may assume success and conclude without an extra verification turn.
- Only after closing the \`</thinking>\` tag should you output your conversational text and After Effects ExtendScript JSX code blocks or JSON tool calls.
- **MANDATORY TOOL FORMATTING REQUIREMENT**: Any and all JSON tool calls you output MUST be strictly wrapped in a markdown \`\`\`json and \`\`\` code block. NEVER output raw JSON outside of a markdown code block. The CEP extension parser relies on the presence of triple backticks and the "json" language identifier to extract and execute your tools; raw JSON text will be completely ignored and treated as conversational text.

*** CRITICAL SYSTEM PHILOSOPHY: GENERAL VIDEO EDITING & DYNAMIC ORCHESTRATION ***
- COMPOSITION ASSEMBLY & VIDEO EDITING:
  * Prioritize clean timeline structures. Set layer inPoints, outPoints, and startTimes precisely using \`ArcEditor.trimLayer\`.
  * Precompose groups of assets cleanly using \`ArcEditor.precompose\` to maintain modular video editing tracks.
  * Adjust opacity, blending modes (using \`ArcEditor.setLayerBlendMode\`), and layout coordinates to composite assets seamlessly.
- THE ANIMATOR-CONTROL-CENTRIC PARADIGM (FOR DYNAMIC GRAPHICS/RIGS):
  * When the user requests dynamic motion graphics or templated animations, avoid baking static keyframes on individual elements.
  * Instead, create green parameter Nulls (e.g., "[RigName] Controls") with standard sliders ("Progress", "Duration", "Spread") to let animators easily tune visual timing.
  * Re-use existing control Nulls and effects in the composition. Avoid duplicating Null layers if they already exist in the timeline inspector payload.
  * Link parameters to target layers via clean expressions using the Progress slider method (\`ease(progress, 0, 100, start, end)\`), and keyframe the slider with \`ArcEditor.setKeyframes\` so it runs out-of-the-box.

*** EXTENDSCRIPT SYNTAX & AE DOM RULES ***
- ExtendScript is based on an old JavaScript ES3 engine. NEVER use modern ES6 features like 'const', 'let', '=>' arrow functions, 'Promise', or default parameters inside the JSX code blocks. Use standard 'var' and standard ES3/ES5 syntax.
- AE Collections are 1-indexed. The first item in an array or collection is index 1 (e.g., app.project.item(1)).
- **NEVER use After Effects' native 'comp.layer(id)' directly with a numeric layer ID** (e.g. 'comp.layer(26)'). Native AE scripting only accepts indices or names in 'comp.layer()', so passing an ID will retrieve the wrong index or crash.
- **ALWAYS use 'ArcEditor.resolveLayer(layerRef)'** to retrieve a layer safely from its ID, name, or index (e.g., 'var layer = ArcEditor.resolveLayer(layerRef);').
- **ALWAYS reference layers using primitive values (layer.id as an integer or layer.name as a string) when invoking ArcEditor APIs.** Never store or pass raw Layer JavaScript objects across multiple tool calls or mutations, as After Effects mutates and invalidates internal object pointers when solid properties or adjustment options are changed, causing subsequent scripting calls to fail.

- Property Match Names must be handled carefully. Colors are represented as an array of 4 floats: [R, G, B, A] normalized between 0.0 and 1.0 (e.g. red is [1, 0, 0, 1]).
- If a layer is parented, its Position is in local coordinates relative to the parent.
- Always wrap scripts in a clean try-catch block and return meaningful error messages.
- NEVER wrap your scripts or property additions in 'app.beginUndoGroup' and 'app.endUndoGroup' yourself. The host panel automatically wraps all executed scripts in a single atomic transaction. Writing your own undo groups will nest them, which breaks After Effects' undo history and prevents clean rollbacks during error self-corrections.

*** PROCEDURAL SHAPE & LAYOUT RULES ***
- Shape Layers are completely empty container layers when created via createLayer("Shape", name). You MUST procedurally add styled shape groups (using ADBE Vector Shape, Fills, and Strokes) to draw paths and make them visible on the canvas. Always use 'ArcEditor.addShapeToLayer' to create visible geometry.
- Always check the composition dimensions (width and height) from 'getTimelineContext'. Adjust your shape sizes, solid layers, and offset coordinates proportionally (e.g. for a 1920x1080 composition, standard shapes should be 100-300px; for a 4K 3840x2160 composition, scale shapes up by 2x).
- Avoid calling setPropertyValue() on properties that already have keyframes (e.g., animated Position, Scale, etc.). If you must modify an animated parameter statically, rely on our built-in keyframe protection inside setPropertyValue which updates the value at 'comp.time', or overwrite the entire keyframe sequence using 'setKeyframes'.

*** AVAILABLE HIGH-LEVEL TOOL CALLS & EDITING API (ArcEditor) ***
To make editing, composition, and timeline automation simple and bulletproof, you have access to a pre-compiled high-level global API object named \`ArcEditor\` inside the host ExtendScript environment. Use these functions in your generated scripts to perform complex editing tasks reliably:

Layer Referencing (Avoid Fragile Indexes!):
- Instead of raw layer indexes (which shift dynamically), always refer to layers using a \`layerRef\`.
- \`layerRef\` can be:
  1. The unique persistent layer \`id\` (integer, e.g. 24). This is the absolute best way to target a layer, especially when multiple layers share the same name!
  2. The exact layer \`name\` string (e.g. "Logo Controls").
  3. A 1-based layer index (e.g. 1) as a fallback if no specific ID or Name exists.
- In your active timeline context JSON, every layer has a unique \`id\` and a \`name\`. Inspect the JSON, find the target layer, and use its unique \`id\` (or name) for the \`layerRef\` parameter.

1. \`ArcEditor.createLayer(type, name, size, color)\`
   - Description: Creates a new layer in the active composition.
   - Parameters:
     * \`type\`: "Solid", "Text", "Shape", "Null", "Adjustment", "Camera", "Light".
     * \`name\`: String layer name.
     * \`size\`: (Optional) [width, height] array (e.g. \`[1920, 1080]\`).
     * \`color\`: (Optional) [R, G, B] normalized array (e.g. \`[1, 1, 1]\` for white) if type is "Solid" or "Adjustment".
   - Returns: The created Layer object.

2. \`ArcEditor.applyEffect(layerRef, effectMatchName, effectDisplayName)\`
   - Description: Applies an effect to a layer.
   - Use the exact matchName from the getInstalledEffects catalog (e.g. "ADBE Slider Control", "ADBE Glo2").
   - Parameters:
     * \`layerRef\`: Layer unique ID, name, or index.
     * \`effectMatchName\`: String match name (e.g. "ADBE Slider Control", "ADBE Glo2").
     * \`effectDisplayName\`: (Optional) String display name.
   - Returns: The created Effect object.

 3. \`ArcEditor.setPropertyValue(layerRef, propPath, value, time)\`
    - Description: A UNIFIED, OMNIPOTENT PROPERTY API. Sets static or keyframe values. Under the hood, it automatically intercepts and sets:
      1. Native Layer Fields (e.g. \`"Name"\`, \`"Enabled"\` [sets layer visibility!], \`"Locked"\`, \`"Selected"\`, \`"InPoint"\`, \`"OutPoint"\`, \`"StartTime"\`, \`"Stretch"\`, \`"Comment"\`, \`"ThreeDLayer"\`, \`"GuideLayer"\`, \`"MotionBlur"\`, \`"AdjustmentLayer"\`, \`"Parent"\` [pass parent layerRef or null to unparent], \`"BlendMode"\` [supports any case/space/punctuation-insensitive native mode, e.g. \`\"SUBTRACT\"\`, \`\"ADD\"\`, \`\"ALPHA_ADD\"\`, \`\"SCREEN\"\`, \`\"MULTIPLY\"\`, \`\"NORMAL\"\`]).
      2. Footage/Solid source properties (e.g. \`"Color"\` / \`"SolidColor"\` [pass \`[R, G, B]\` normalized color array like \`[1, 1, 1]\` for white]).
      3. Standard timeline Property objects (e.g. \`"Position"\`, \`"Opacity"\`, or path arrays like \`["Effects", "Fast Box Blur", "Blur Radius"]\`).
      4. Visibility of individual sub-elements like shape groups, vector shapes, masks, and effects by setting \`"Enabled"\` at the end of deep property paths (e.g., \`["Contents", "Rectangle Group", "Enabled"]\` or \`["Effects", "Fast Box Blur", "Enabled"]\` or \`["Masks", "Mask 1", "Enabled"]\`).
    - Parameters:
      * \`layerRef\`: Layer unique ID, name, or index.
      * \`propPath\`: String property name or Array path.
      * \`value\`: Raw value to assign (Number, Array, String, or Boolean).
      * \`time\`: (Optional) Number time in seconds to set keyframe value.

4. \`ArcEditor.setPropertyExpression(layerRef, propPath, expressionStr)\`
   - Description: Writes a JavaScript expression onto a property.
   - Parameters:
     * \`layerRef\`: Layer unique ID, name, or index.
     * \`propPath\`: String name or Array path.
     * \`expressionStr\`: String expression.

5. \`ArcEditor.setKeyframes(layerRef, propPath, times, values, easeIn, easeOut)\`
   - Description: Generates multiple eased keyframes on a property.
   - Parameters:
     * \`layerRef\`: Layer unique ID, name, or index.
     * \`propPath\`: String name or Array path.
     * \`times\`: Array of numbers (times in seconds, e.g. \`[0, 1.5, 3]\`).
     * \`values\`: Array of corresponding values (e.g. \`[[100, 100], [200, 200], [100, 100]]\`).
     * \`easeIn\`, \`easeOut\`: (Optional) Booleans to apply Easy Ease.

6. \`ArcEditor.parentLayer(layerRef, parentLayerRef)\`
   - Description: Parents one layer to another. Pass \`null\` as parentLayerRef to unparent.

7. \`ArcEditor.trimLayer(layerRef, inPoint, outPoint, startTime)\`
   - Description: Sets layer inPoint, outPoint, and timeline startTime in seconds.

8. \`ArcEditor.precompose(layerRefs, precompName, moveAllAttributes)\`
   - Description: Groups selected layers into a precomposition.
   - Parameters:
     * \`layerRefs\`: Array of layer references (IDs, names, or indexes, e.g. \`[24, 25, "Logo Background"]\`).
     * \`precompName\`: String name.
     * \`moveAllAttributes\`: (Optional) Boolean. Defaults to true.

9. \`ArcEditor.setLayerBlendMode(layerRef, blendModeName)\`
   - Description: Changes layer blend mode. Supported modes are resolved dynamically at runtime (case-insensitive and punctuation-insensitive, covering all AE blend modes such as \`"ADD\"\`, \`"ALPHA_ADD\"\`, \`"SCREEN\"\`, \`"MULTIPLY\"\`, \`"NORMAL\"\`). If a mode is invalid, the script throws an error listing all available native modes.
   - Parameters:
     * \`blendModeName\`: Any native After Effects blend mode string (e.g. \`"SUBTRACT\"\`, \`\"ADD\"\`, \`\"SCREEN\"\`, etc.).

10. \`ArcEditor.resolveLayer(layerRef)\`
    - Description: Safely resolves any layer ID, name, or index into a native After Effects Layer object.
    - Parameters:
      * \`layerRef\`: Layer unique ID (integer), name (string), or index (integer).
    - Returns: Native After Effects Layer object.

11. \`ArcEditor.addMarker(type, layerRef, time, comment, duration, labelIndex)\`
    - Description: Adds a marker to the active composition timeline or an individual layer.
    - Parameters:
      * \`type\`: String. "comp" (for composition marker) or "layer" (for layer marker).
      * \`layerRef\`: Layer unique ID, name, or index (ignored if type is "comp", pass \`null\`).
      * \`time\`: Number. Time in seconds from timeline start.
      * \`comment\`: (Optional) String text description inside the marker.
      * \`duration\`: (Optional) Number duration in seconds (defaults to \`0\`).
      * \`labelIndex\`: (Optional) Integer label color index (0 to 16, e.g. 1 for Red, 9 for Green).

12. \`ArcEditor.deleteMarker(type, layerRef, timeOrIndex)\`
    - Description: Deletes a marker from the active composition or a specific layer.
    - Parameters:
      * \`type\`: String. "comp" or "layer".
      * \`layerRef\`: Layer unique ID, name, or index (ignored if type is "comp").
      * \`timeOrIndex\`: Number or String. 1-based marker index (integer) or the exact time (number in seconds) of the marker to remove.

13. \`ArcEditor.setKeyframeEasing(layerRef, propPath, keyIndex, easeIn, easeOut)\`
    - Description: Sets high-level ease curve presets or custom Bezier weights on an existing keyframe.
    - Parameters:
      * \`layerRef\`: Layer unique ID, name, or index.
      * \`propPath\`: String name (e.g. "Position", "Opacity") or Array path (e.g. \`["Transform", "Scale"]\`).
      * \`keyIndex\`: Integer 1-based keyframe index.
      * \`easeIn\`: String preset name (\`"linear"\`, \`"easyEase"\`, \`"easeInQuad"\`, \`"easeOutQuad"\`, \`"easeInOutQuad"\`, \`"easeInExpo"\`, \`"easeOutExpo"\`, \`"easeInOutExpo"\`) OR custom Bezier object \`{ speed: Number, influence: Number }\`.
      * \`easeOut\`: String preset name OR custom Bezier object \`{ speed: Number, influence: Number }\`.

14. \`ArcEditor.setTextProperties(layerRef, properties)\`
    - Description: Sets multiple typography and style properties on an existing Text layer in a single atomic call.
    - Parameters:
      * \`layerRef\`: Layer unique ID, name, or index.
      * \`properties\`: Configuration JSON object. Supports any subset of these optional keys:
        - \`text\`: (Optional) String new text content.
        - \`font\`: (Optional) String PostScript font name (e.g. \`"Arial-BoldMT"\`).
        - \`fontSize\`: (Optional) Number font size in pixels.
        - \`fillColor\`: (Optional) String color hex code (e.g. \`"#FF3366"\`). Maps to RGB array and turns fill on under the hood.
        - \`strokeColor\`: (Optional) String color hex code. Maps to RGB array and turns stroke on under the hood.
        - \`strokeWidth\`: (Optional) Number stroke width in pixels.
        - \`tracking\`: (Optional) Number horizontal tracking.
        - \`leading\`: (Optional) Number line leading.
        - \`alignment\`: (Optional) String alignment (\`"left"\`, \`"center"\`, \`"right"\`). Maps to ParagraphJustification.

15. \`ArcEditor.addAssetToTimeline(assetRef, properties)\`
    - Description: Adds an existing asset from the project bin (e.g. footage, audio, or another precomposition) to the active composition timeline as a new layer.
    - Context Awareness: Available project panel assets are automatically listed in the \`[Active Timeline Context]\` payload under \`projectAssets\`. You MUST inspect \`projectAssets\` first to verify if the asset is present in the project before trying to add it.
    - Parameters:
      * \`assetRef\`: Project item ID (integer) or exact item name string (e.g. \`"logo.png"\`).
      * \`properties\`: (Optional) Configuration JSON object supporting any subset of these keys:
        - \`name\`: (Optional) String custom layer name.
        - \`startTime\`: (Optional) Number time in seconds to place layer inPoints on the timeline.
        - \`inPoint\`: (Optional) Number footage inPoint.
        - \`outPoint\`: (Optional) Number footage outPoint.
        - \`parentLayerRef\`: (Optional) Parent layer ID, name, or index.
        - \`blendMode\`: (Optional) String blend mode (e.g. \`"ADD"\`, \`"SCREEN"\`, \`"MULTIPLY"\`, \`"NORMAL"\`).

16. \`ArcEditor.setSolidColor(layerRef, color)\`
    - Description: Sets/changes the color of a Solid layer's source.
    - Parameters:
      * \`layerRef\`: Layer unique ID, name, or index.
      * \`color\`: [R, G, B] normalized array (e.g. \`[1, 1, 1]\` for white).

17. \`ArcEditor.deleteLayer(layerRef)\`
    - Description: Safely deletes a layer from the composition.
    - Parameters:
      * \`layerRef\`: Layer unique ID, name, or index.

18. \`ArcEditor.addShapeToLayer(layerRef, shapeType, groupName, properties)\`
    - Description: Procedurally draws a styled shape group (with optional vector sizes, position offsets, color fills, and strokes) inside an existing Shape Layer, enforcing sensible visible defaults if styling parameters are omitted.
    - Parameters:
      * \`layerRef\`: Layer unique ID, name, or index of the target Shape Layer.
      * \`shapeType\`: String. "Ellipse" (or "Circle") or "Rect" (or "Rectangle").
      * \`groupName\`: (Optional) String custom name for the shape vector group (e.g., "Wheel Front").
      * \`properties\`: (Optional) Configuration JSON object supporting:
        - \`size\`: (Optional) [width, height] array (e.g. \`[150, 150]\` for wheel, \`[400, 100]\` for frame).
        - \`position\`: (Optional) [X, Y] local position offset array relative to the layer's center.
        - \`fillColor\`: (Optional) String hex color code (e.g. \`"#FF3366"\`) or \`[R, G, B]\` normalized array. Enforces light gray if omitted (pass \`false\` to disable fill).
        - \`strokeColor\`: (Optional) String hex color code or \`[R, G, B]\` normalized array. Defaults to black.
        - \`strokeWidth\`: (Optional) Number stroke width in pixels. Defaults to 2 (pass \`0\` to disable stroke).

17. \`getTimelineContext\`
    - Description: Retrieves the active composition details on demand, including layer names, IDs, indices, structures, and all available project bin assets (\`projectAssets\`).
    - Parameters: None.
    - JSON Call Format: Output a JSON code block like this:
      \`\`\`json
      {
        "tool": "getTimelineContext",
        "parameters": {}
      }
      \`\`\`

18. \`getInstalledEffects\`
    - Description: Retrieves the live catalog/dictionary of installed effects in the host After Effects application. Use this to lookup exact matchNames.
    - Parameters: None.
    - JSON Call Format: Output a JSON code block like this:
      \`\`\`json
      {
        "tool": "getInstalledEffects",
        "parameters": {}
      }
      \`\`\`

19. \`captureActiveFrame\`
    - Description: Programmatically captures the current active frame preview of the After Effects canvas. Use this tool whenever you need to visually verify layer layout coordinates, styling, expression binding outcomes, or splicing alignment.
    - Parameters: None.
    - JSON Call Format: Output a JSON code block like this:
      \`\`\`json
      {
        "tool": "captureActiveFrame",
        "parameters": {}
      }
      \`\`\`

19a. \`captureCompositionSequence\`
    - Description: Programmatically captures a sequence of N frames of the composition timeline between startTime and endTime. Use this tool when the user asks to analyze visual transitions, check animations across time, verify splicing alignment across multiple scenes, or understand timing and movement.
    - Parameters:
      * \`startTime\`: (Optional) Number. The start time in seconds (defaults to 0).
      * \`endTime\`: (Optional) Number. The end time in seconds (defaults to composition duration).
      * \`numFrames\`: (Optional) Integer. The number of frames to capture (e.g. 5, max 10, defaults to 5).
    - JSON Call Format: Output a JSON code block like this:
      \`\`\`json
      {
        "tool": "captureCompositionSequence",
        "parameters": {
          "startTime": 0.0,
          "endTime": 5.0,
          "numFrames": 5
        }
      }
      \`\`\`

20. \`undoLastAction\`
    - Description: Undoes the very last committed ExtendScript action block in After Effects (acting as a programmatic 'Ctrl+Z'). Use this tool if your previous script executed successfully, but upon verification (via getTimelineContext or captureActiveFrame), you realize the resulting layout, alignment, or properties are incorrect, so you can safely roll back and retry on a clean slate.
    - Parameters: None.
    - JSON Call Format: Output a JSON code block like this:
      \`\`\`json
      {
        "tool": "undoLastAction",
        "parameters": {}
      }
      \`\`\`

21. \`setPlayheadTime\`
    - Description: Moves the active timeline playhead/needle to a specific time or shifts it relatively.
    - Parameters:
      * \`time\`: Number (absolute seconds, e.g. \`2.5\`) OR String relative offset (e.g. \`"+1.5"\` or \`"-0.5"\` to shift from current position).
    - JSON Call Format: Output a JSON code block like this:
      \`\`\`json
      {
        "tool": "setPlayheadTime",
        "parameters": {
          "time": "+2.0"
        }
      }
      \`\`\`

22. \`selectLayer\`
    - Description: Selects a specific layer in the active composition, optionally deselecting all other layers.
    - Parameters:
      * \`layerRef\`: Layer unique ID, name string, or index.
      * \`deselectOthers\`: (Optional) Boolean. Defaults to true. If false, adds to active selection.
    - JSON Call Format: Output a JSON code block like this:
      \`\`\`json
      {
        "tool": "selectLayer",
        "parameters": {
          "layerRef": 24,
          "deselectOthers": true
        }
      }
      \`\`\`

23. \`switchComposition\`
    - Description: Switches the active composition by opening a target composition from the project bin in the viewer, and returns its new structural context.
    - Parameters:
      * \`compRef\`: Composition unique ID, name string, or index in the project bin.
    - JSON Call Format: Output a JSON code block like this:
      \`\`\`json
      {
        "tool": "switchComposition",
        "parameters": {
          "compRef": "Main Precomp"
        }
      }
      \`\`\`

24. \`addMarker\`
    - Description: Adds a marker to the active composition timeline or a specific layer.
    - Parameters:
      * \`type\`: "comp" (for composition marker) or "layer" (for layer marker).
      * \`layerRef\`: Layer unique ID, name string, or index (ignored if type is "comp").
      * \`time\`: Number. Time in seconds from timeline start.
      * \`comment\`: (Optional) String text description inside the marker.
      * \`duration\`: (Optional) Number duration in seconds (defaults to 0).
      * \`labelIndex\`: (Optional) Integer label color index (0 to 16, e.g. 1 for Red, 9 for Green).
    - JSON Call Format: Output a JSON code block like this:
      \`\`\`json
      {
        "tool": "addMarker",
        "parameters": {
          "type": "comp",
          "time": 3.5,
          "comment": "Chorus Hook"
        }
      }
      \`\`\`

25. \`deleteMarker\`
    - Description: Deletes a marker from the active composition or a specific layer.
    - Parameters:
      * \`type\`: "comp" or "layer".
      * \`layerRef\`: Layer unique ID, name string, or index (ignored if type is "comp").
      * \`timeOrIndex\`: Number or String. 1-based marker index (integer) or the exact time (number in seconds) of the marker to remove.
    - JSON Call Format: Output a JSON code block like this:
      \`\`\`json
      {
        "tool": "deleteMarker",
        "parameters": {
          "type": "comp",
          "timeOrIndex": 1
        }
      }
      \`\`\`

26. \`getLayerProperties\`
    - Description: Recursively inspects a layer's properties, shapes, and applied effects, returning their exact display names, matchNames, values, and array property paths (e.g. \`["Effects", "Fast Box Blur", "Blur Radius"]\`). Use this tool immediately whenever you need to edit an effect parameter or shape property, or if you receive a "Property path segment not found" error, to discover the correct paths and matchNames with 100% precision.
    - Parameters:
      * \`layerRef\`: Layer unique ID, name string, or index.
      * \`groupFilter\`: (Optional) String. Target a specific group branch to inspect (e.g., \`"Effects"\` or \`"Transform"\` or \`"Contents"\`) to keep context payloads very focused and small. If omitted, defaults to crawling the Transform and Effects groups.
    - JSON Call Format: Output a JSON code block like this:
      \`\`\`json
      {
        "tool": "getLayerProperties",
        "parameters": {
          "layerRef": 14,
          "groupFilter": "Effects"
        }
      }
      \`\`\`

27. \`setSolidColor\`
    - Description: Sets or changes the color of a Solid layer's source.
    - Parameters:
      * \`layerRef\`: Layer unique ID, name string, or index.
      * \`color\`: [R, G, B] normalized array of floats (e.g. \`[1.0, 1.0, 1.0]\` for white, \`[0.0, 0.0, 0.0]\` for black).
    - JSON Call Format: Output a JSON code block like this:
      \`\`\`json
      {
        "tool": "setSolidColor",
        "parameters": {
          "layerRef": 15,
          "color": [1.0, 1.0, 1.0]
        }
      }
      \`\`\`

28. \`deleteLayer\`
    - Description: Safely deletes a layer from the composition timeline by its ID, name, or index.
    - Parameters:
      * \`layerRef\`: Layer unique ID, name string, or index.
    - JSON Call Format: Output a JSON code block like this:
      \`\`\`json
      {
        "tool": "deleteLayer",
        "parameters": {
          "layerRef": 16
        }
      }
      \`\`\`

29. \`undoLastAction\`
    - Description: Rolls back the very last ExtendScript transaction executed inside After Effects. Use this tool immediately whenever the user requests to undo, cancel, or revert a change, or when you realize your previous script output did something incorrect on the composition timeline.
    - JSON Call Format: Output a JSON code block like this:
      \`\`\`json
      {
        "tool": "undoLastAction"
      }
      \`\`\`



*** RESILIENT UNDO & CORRECTIVE BEHAVIOR ***
- HONOUR USER UNDO REQUESTS: If the user states that your modification was wrong, incorrect, or asks to "undo", "revert", or "roll back", you MUST immediately call the \`undoLastAction\` tool (or output \`app.undo()\` in ExtendScript) on your first turn. Never try to build fixes or corrections on top of an incorrect composition state. Always restore the timeline to a clean state first!
- SELF-CORRECTION UNDO: If you run an ExtendScript code block and realize it has a layout bug or configuration mistake, perform an undo step first before generating the corrected script block. Always ensure the canvas is clean before applying revised designs.



*** HOW TO COMUNICATE EXECUTION CODE ***
- You are a fully integrated, automated CEP coding agent. DO NOT tell the user to copy/paste code, create external .jsx files, or use tools like ExtendScript Toolkit or manual After Effects script runners. Any JavaScript/ExtendScript code block you output inside \`\`\`javascript ... \`\`\` WILL BE EXECUTED AUTOMATICALLY and natively inside After Effects by the extension panel.
- Write your code blocks as direct, self-executing actions that run immediately on the active composition.
- Double-check your code for basic JavaScript syntax errors. Ensure math operators are explicit (e.g., use \`spacing * 2\` rather than missing characters like \`spacing 2\`).
- Only output a code block with ExtendScript if the user's request requires writing, modifying, or executing After Effects setups.
- If the user's request is purely informational, conversational, or a general question, answer directly in plain markdown without any JavaScript code blocks. Do not invent scripts unnecessarily.
- When a script is required, output your technical plan first, and then output your After Effects ExtendScript JSX script inside a single, clean code block marked with:
\`\`\`javascript
// ExtendScript goes here
\`\`\`
- When a JSON tool call is required, output it inside a markdown block marked with:
\`\`\`json
{
  "tool": "toolName",
  "parameters": { ... }
}
\`\`\`
Do not write any text or raw JSON outside of the markdown code block. The host panel parses the block marked with json and runs it. Raw JSON will fail to be recognized as a tool call.
Do not write any comments inside the markdown formatting outside the code blocks that contradict this structure.
`;

async function runAgenticExecutionLoop(userText) {
    try {
        let visualFrameInputs = [...attachedFrames];

    // Reset attachments
    clearAttachmentDock();

    if (visualFrameInputs && visualFrameInputs.length > 0) {
        const contentParts = [{ type: "text", text: userText }];
        visualFrameInputs.forEach(img => {
            contentParts.push({ type: "image_url", image_url: { url: `data:image/png;base64,${img}` } });
        });
        chatHistory.push({
            role: "user",
            content: contentParts
        });
    } else {
        chatHistory.push({ role: "user", content: userText });
    }

    // DECOUPLED CONTEXT FOR LLM (keeps visual history completely raw and unpruned)
    let activeContext = JSON.parse(JSON.stringify(chatHistory));
    activeContext = fallbackSlidingWindowPrune(activeContext); // Instant local pruning to protect context size
    pruneBase64Images(activeContext, 2); // Initial sliding window pruning

    updateCurrentSessionHistory();
    updateContextSizeInfo();

    writeToDebugLog("Prompt / History Context", JSON.stringify(activeContext, null, 2));

    const aiBubbleId = addBubble("ai", '<div class="dots-loader"><span></span><span></span><span></span></div>');
    const aiBubble = document.getElementById(aiBubbleId);

    let isCompleted = false;
    let loopRetries = 0;
    const maxRetries = 3;
    let toolTurns = 0;
    const maxToolTurns = 15;
    let finalLlmResponse = "";
    const executedActions = [];
    const completedTurnsHtml = [];

    while (!isCompleted && loopRetries < maxRetries && toolTurns < maxToolTurns) {
        try {
            pruneBase64Images(activeContext, 2); // Prune old base64 images to keep a sliding window of the last 2 captures
            const llmResponse = await callLLMApi(activeContext, (chunkText) => {
                aiBubble.querySelector(".message-content").innerHTML = completedTurnsHtml.join("") + 
                    `<div class="active-turn-container">` +
                    formatMarkdown(chunkText) +
                    `</div>`;
                aiBubble.setAttribute("data-raw-text", chunkText);
                if (typeof scrollToBottom === "function") scrollToBottom();
            });
            aiBubble.setAttribute("data-raw-text", llmResponse);
            const assistantMsg = { role: "assistant", content: llmResponse };
            activeContext.push(assistantMsg);
            finalLlmResponse = llmResponse;

            writeToDebugLog("LLM Raw Response", llmResponse);

            // Check for JSON tool calls first, then JSX code blocks
            const jsonBlock = extractJSONToolCalls(llmResponse);
            const jsxBlock = extractJSXCode(llmResponse);

            if (jsxBlock || jsonBlock) {
                assistantMsg.isIntermediate = true;
                const significantJson = getSignificantJsonActionKey(jsonBlock);
                const actionKey = (jsxBlock ? `jsx:${jsxBlock.trim()}` : "") + (significantJson ? `|json:${significantJson}` : "");
                if (actionKey) {
                    if (executedActions.indexOf(actionKey) !== -1) {
                        console.warn("[ArcEditor] Loop detected! Agent is repeating identical actions:", actionKey);
                        aiBubble.querySelector(".message-content").innerHTML = completedTurnsHtml.join("") + formatMarkdown(llmResponse) +
                            `<div style="margin-top:8px; font-size:11px; color:var(--text-error);">⚠ Execution loop detected (agent repeated identical actions). Terminating to prevent quota burn.</div>`;
                        if (typeof scrollToBottom === "function") scrollToBottom();
                        isCompleted = true;
                        break;
                    }
                    executedActions.push(actionKey);
                }
            }
            chatHistory.push(JSON.parse(JSON.stringify(assistantMsg)));

            var observations = "";
            var executedAnything = false;
            var scriptFailed = false;

            if (jsxBlock) {
                executedAnything = true;
                toolTurns++;
                updateConsolePane(jsxBlock);
                aiBubble.querySelector(".message-content").innerHTML = completedTurnsHtml.join("") +
                    `<div class="active-turn-container">` +
                    formatMarkdown(llmResponse) +
                    `<div style="margin-top:8px; font-size:11px; color:var(--text-accent); display:flex; align-items:center; gap:6px;"><div class="dots-loader"><span></span><span></span><span></span></div> Executing ExtendScript...</div>` +
                    `</div>`;
                if (typeof scrollToBottom === "function") scrollToBottom();

                writeToDebugLog("ExtendScript Extracted", jsxBlock);

                // Wrap in try-catch to ensure we capture all ExtendScript runtime and reference errors
                const wrappedJSX = `(function() {
                    var ArcEditor = $._com_arceditor_ ? $._com_arceditor_.ArcEditor : null;
                    var ArcJSON = $._com_arceditor_ ? $._com_arceditor_.ArcJSON : null;
                    var ArcInspector = $._com_arceditor_ ? $._com_arceditor_.ArcInspector : null;
                    var ArcCanvas = $._com_arceditor_ ? $._com_arceditor_.ArcCanvas : null;
                    var JSON = ArcJSON;
                    app.beginUndoGroup("ArcEditor Action");
                    try {
                        ${jsxBlock}
                        app.endUndoGroup();
                        return "Success";
                    } catch (err) {
                        app.endUndoGroup();
                        try {
                            app.executeCommand(16); // Auto-rollback the ENTIRE transaction on script failure!
                        } catch (e) {}
                        return "Error: " + err.toString() + (err.line ? " (line " + err.line + ")" : "");
                    }
                })()`;

                // Execute ExtendScript via CEP evalScript
                const execResult = await evalScriptAsync(wrappedJSX);
                console.log("[ArcEditor JSX Executed Result]:", execResult);

                writeToDebugLog("ExtendScript Execution Result", execResult);

                if (execResult.indexOf("Error:") === 0 || execResult.indexOf("EvalScript error") === 0) {
                    scriptFailed = true;
                    loopRetries++;
                    
                    // Package failed turn
                    const turnNum = completedTurnsHtml.length + 1;
                    const turnHtml = `
                    <details class="agent-turn-details" style="border-color: var(--text-error);">
                        <summary class="agent-turn-summary" style="background-color: rgba(255, 68, 68, 0.15);">
                            <span class="turn-index-badge" style="background-color: var(--text-error); color: white;">Turn ${turnNum}</span>
                            <span class="turn-title" style="color: var(--text-error);">Script execution failed (Retrying...)</span>
                        </summary>
                        <div class="agent-turn-body">
                            ${formatMarkdown(llmResponse)}
                            <div class="turn-observations">
                                <strong style="color: var(--text-error);">Error Observation:</strong>
                                <pre class="observation-pre" style="border-color: var(--text-error); color: var(--text-error) !important;">${execResult}</pre>
                            </div>
                        </div>
                    </details>
                    `;
                    completedTurnsHtml.push(turnHtml);

                    aiBubble.querySelector(".message-content").innerHTML = completedTurnsHtml.join("") +
                        `<div style="margin-top:8px; font-size:11px; color:var(--text-error); display:flex; align-items:center; gap:6px;"><div class="dots-loader"><span></span><span></span><span></span></div> Script error detected. Initiating self-correction... (Attempt ${loopRetries}/${maxRetries})</div>`;
                    if (typeof scrollToBottom === "function") scrollToBottom();

                    // Push error feedback to local context history and master history
                    const errFeedbackMsg = {
                        role: "user",
                        content: `System execution failed with error: "${execResult}". Please analyze the After Effects error, correct the syntax or API mismatch, and output a complete revised ExtendScript.`,
                        isIntermediate: true
                    };
                    activeContext.push(errFeedbackMsg);
                    chatHistory.push(JSON.parse(JSON.stringify(errFeedbackMsg)));

                    // Don't send the base64 image again to save bandwidth
                    visualFrameInputs = null;
                } else {
                    observations += `ExtendScript executed successfully with result: "${execResult}"\n`;
                }
            }

            // Only execute JSON tool calls if the ExtendScript succeeded (or if there was no script to begin with)
            if (jsonBlock && !scriptFailed) {
                executedAnything = true;
                toolTurns++;
                updateConsolePane(jsonBlock);
                aiBubble.querySelector(".message-content").innerHTML = completedTurnsHtml.join("") +
                    `<div class="active-turn-container">` +
                    formatMarkdown(llmResponse) +
                    `<div style="margin-top:8px; font-size:11px; color:var(--text-accent); display:flex; align-items:center; gap:6px;"><div class="dots-loader"><span></span><span></span><span></span></div> Executing Agent Tool Calls...</div>` +
                    `</div>`;
                if (typeof scrollToBottom === "function") scrollToBottom();

                writeToDebugLog("Tool Calls Extracted", jsonBlock);

                const toolObservations = await executeToolCalls(jsonBlock);
                console.log("[ArcEditor Tool Calls Observations]:", toolObservations);

                writeToDebugLog("Tool Execution Observations", toolObservations);
                observations += (observations ? "\n" : "") + `Tool execution observation:\n${toolObservations}`;
            }

            if (executedAnything) {
                if (scriptFailed) {
                    continue; // Skip rest of execution and let loop retry self-correction
                }

                // Append observations to local context history and master history (handling multi-modal visual observations!)
                if (capturedFrameDataDuringLoop) {
                    const contentParts = [
                        { type: "text", text: `Observation:\n${observations}\n\nPlease analyze the visual state of the composition and proceed with your next planned steps.` }
                    ];
                    if (Array.isArray(capturedFrameDataDuringLoop)) {
                        capturedFrameDataDuringLoop.forEach(img => {
                            contentParts.push({ type: "image_url", image_url: { url: `data:image/png;base64,${img}` } });
                        });
                    } else {
                        contentParts.push({ type: "image_url", image_url: { url: `data:image/png;base64,${capturedFrameDataDuringLoop}` } });
                    }
                    const obsMsg = {
                        role: "user",
                        content: contentParts,
                        isIntermediate: true
                    };
                    activeContext.push(obsMsg);
                    chatHistory.push(JSON.parse(JSON.stringify(obsMsg)));
                    capturedFrameDataDuringLoop = null; // Reset for next potential capture
                } else {
                    const obsMsg = {
                        role: "user",
                        content: `Observation:\n${observations}\n\nPlease analyze this result and proceed with your next planned steps.`,
                        isIntermediate: true
                    };
                    activeContext.push(obsMsg);
                    chatHistory.push(JSON.parse(JSON.stringify(obsMsg)));
                }

                // Package successful turn
                const turnNum = completedTurnsHtml.length + 1;
                let turnTitle = "Analyzing composition context";
                if (jsxBlock) {
                    turnTitle = "Executing timeline automation script";
                } else if (jsonBlock) {
                    try {
                        const parsed = JSON.parse(jsonBlock);
                        const tools = (Array.isArray(parsed) ? parsed : [parsed]).map(t => t.tool).join(", ");
                        turnTitle = `Running tool: ${tools}`;
                    } catch (e) {
                        turnTitle = "Running agent tool calls";
                    }
                }

                const turnHtml = `
                <details class="agent-turn-details">
                    <summary class="agent-turn-summary">
                        <span class="turn-index-badge">Turn ${turnNum}</span>
                        <span class="turn-title">${turnTitle}</span>
                    </summary>
                    <div class="agent-turn-body">
                        ${formatMarkdown(llmResponse)}
                        <div class="turn-observations">
                            <strong>Observations:</strong>
                            <pre class="observation-pre">${observations}</pre>
                        </div>
                    </div>
                </details>
                `;
                completedTurnsHtml.push(turnHtml);

                // Show feedback in UI and prepare next turn
                const isNextTurnAllowed = (loopRetries < maxRetries && toolTurns < maxToolTurns);
                aiBubble.querySelector(".message-content").innerHTML = completedTurnsHtml.join("") +
                    (isNextTurnAllowed ? `<div style="margin-top:8px; font-size:11px; color:var(--text-accent); display:flex; align-items:center; gap:6px;"><div class="dots-loader"><span></span><span></span><span></span></div> Agent planning next step...</div>` : "");
                if (typeof scrollToBottom === "function") scrollToBottom();

                continue; // Run next loop turn immediately
            } else {
                // LLM replied without code blocks (informational answer)
                isCompleted = true;
                aiBubble.querySelector(".message-content").innerHTML = completedTurnsHtml.join("") + formatMarkdown(llmResponse);
                if (typeof scrollToBottom === "function") scrollToBottom();
                writeToDebugLog("Informational Response Completed", llmResponse);
            }

        } catch (err) {
            console.error("Loop iteration failed:", err);
            aiBubble.querySelector(".message-content").innerHTML = `<p style="color:var(--text-error);">Error executing loop: ${err.message}</p>`;
            if (typeof scrollToBottom === "function") scrollToBottom();
            isCompleted = true;
        }
    }

    if (loopRetries >= maxRetries) {
        aiBubble.querySelector(".message-content").innerHTML +=
            `<div style="margin-top:8px; font-size:11px; color:var(--text-error);">⚠ Max correction attempts reached. Check the JSX Console tab for syntax logs.</div>`;
        if (typeof scrollToBottom === "function") scrollToBottom();
    }
    if (toolTurns >= maxToolTurns && !isCompleted) {
        aiBubble.querySelector(".message-content").innerHTML +=
            `<div style="margin-top:8px; font-size:11px; color:var(--text-error);">⚠ Max agent tool turns reached to prevent looping.</div>`;
        if (typeof scrollToBottom === "function") scrollToBottom();
    }

    // Set the intermediateTurnsHtml property on the last assistant message in history, and remove isIntermediate if failed
    const lastAssistantMsg = chatHistory.filter(m => m.role === "assistant").pop();
    if (lastAssistantMsg) {
        lastAssistantMsg.intermediateTurnsHtml = completedTurnsHtml.join("");
        if (loopRetries >= maxRetries || (toolTurns >= maxToolTurns && !isCompleted)) {
            delete lastAssistantMsg.isIntermediate;
        }
    }

    // Update persistent history size information
    updateCurrentSessionHistory();
    updateContextSizeInfo();

    // Trigger memory condensation asynchronously in the background so the user does not wait
    setTimeout(async () => {
        try {
            const condensedContext = await pruneHistoryContexts(chatHistory);
            if (condensedContext && condensedContext.length < chatHistory.length) {
                chatHistory = condensedContext;
                updateCurrentSessionHistory();
                updateContextSizeInfo();
            }
        } catch (e) {
            console.error("Background memory condensation failed:", e);
        }
    }, 50);

    // Expose activeContext strictly for testing, assertion, and developer inspection
    if (typeof window !== "undefined") {
        window.lastActiveContext = activeContext;
    } else if (typeof global !== "undefined") {
        global.lastActiveContext = activeContext;
    }
        try {
            lastActiveContext = activeContext;
        } catch (e) { }
    } finally {
        isExecuting = false;
        attachedFrames = [];
        if (typeof updateContextSizeInfo === "function") {
            updateContextSizeInfo();
        }
        if (typeof setUIReadyState === "function") {
            setUIReadyState(true);
        }
    }
}

function extractJSXCode(text) {
    if (!text) return null;
    const parts = text.split("```");
    // If the last block is unclosed (even number of parts), ignore it to prevent executing truncated code that deadlocks AE
    const limit = parts.length % 2 === 0 ? parts.length - 1 : parts.length;
    for (let i = 1; i < limit; i += 2) {
        let block = parts[i];
        let lines = block.split("\n");
        if (lines.length > 0) {
            const lang = lines[0].trim().toLowerCase();
            if (lang === "json") {
                continue;
            }
            if (lang === "javascript" || lang === "js" || lang === "extendscript" || lang === "jsx" || lang === "") {
                const code = lines.slice(1).join("\n").trim();
                if (code) {
                    return code;
                }
            } else {
                const nonJsLangs = ["python", "py", "html", "css", "bash", "sh", "txt", "markdown", "md"];
                if (nonJsLangs.indexOf(lang) === -1) {
                    const code = block.trim();
                    if (code) {
                        if (code.startsWith("{") && code.endsWith("}")) {
                            try {
                                JSON.parse(code);
                                continue;
                            } catch (e) {}
                        }
                        return code;
                    }
                }
            }
        }
    }
    return null;
}

function extractJSONToolCalls(text) {
    if (!text) return null;
    const parts = text.split("```");
    // If the last block is unclosed (even number of parts), ignore it to prevent parsing truncated JSON
    const limit = parts.length % 2 === 0 ? parts.length - 1 : parts.length;
    for (let i = 1; i < limit; i += 2) {
        let block = parts[i];
        let lines = block.split("\n");
        if (lines.length > 0) {
            const lang = lines[0].trim().toLowerCase();
            if (lang === "json") {
                const code = lines.slice(1).join("\n").trim();
                if (code) {
                    return code;
                }
            }
        }
    }
    return null;
}

function getSignificantJsonActionKey(jsonStr) {
    if (!jsonStr) return "";
    try {
        const parsed = JSON.parse(jsonStr);
        const toolCalls = Array.isArray(parsed) ? parsed : [parsed];
        const stateModifying = toolCalls.filter(tc => {
            const toolName = tc.tool;
            const isReadOnly = [
                "captureActiveFrame",
                "captureCompositionSequence",
                "getTimelineContext",
                "getInstalledEffects",
                "getLayerProperties",
                "selectLayer",
                "switchComposition",
                "setPlayheadTime"
            ].indexOf(toolName) !== -1;
            return !isReadOnly;
        });
        if (stateModifying.length === 0) {
            return ""; // No state-modifying actions
        }
        return JSON.stringify(stateModifying);
    } catch (e) {
        // Fallback to the raw string if parsing fails, so we still track repeats of syntax errors or raw text
        return jsonStr.trim();
    }
}

async function executeToolCalls(jsonStr) {
    let toolCalls = [];
    try {
        const parsed = JSON.parse(jsonStr);
        toolCalls = Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
        return `Error parsing JSON tool calls: ${e.message}. Ensure your JSON blocks are strictly valid.`;
    }

    let observations = [];
    let undoGroupActive = false;

    try {
        for (let i = 0; i < toolCalls.length; i++) {
            const tc = toolCalls[i];
            const toolName = tc.tool;
            const params = tc.parameters || {};
            const ref = params.layerRef !== undefined ? params.layerRef : params.layerIndex;
            const serializedRef = typeof ref === "string" ? `"${ref.replace(/"/g, '\\"')}"` : (ref !== undefined ? ref : 'null');

            // Centralized classification: determine if the tool modifies the AE comp state
            const isReadOnly = [
                "captureActiveFrame",
                "captureCompositionSequence",
                "getTimelineContext",
                "getInstalledEffects",
                "getLayerProperties",
                "selectLayer",
                "switchComposition",
                "setPlayheadTime",
                "undoLastAction"
            ].indexOf(toolName) !== -1;

            // Lazily open the AE Undo Group only for state-modifying tools
            if (!isReadOnly && !undoGroupActive) {
                await evalScriptAsync(`app.beginUndoGroup("ArcEditor Agent Tools")`);
                undoGroupActive = true;
            }

            let jsxCommand = "";
            if (toolName === "createLayer") {
                const colorVal = params.color ? JSON.stringify(params.color) : 'null';
                jsxCommand = `(function() { var l = ArcEditor.createLayer("${params.type}", "${params.name || 'Layer'}", ${params.size ? JSON.stringify(params.size) : 'null'}, ${colorVal}); return "Success: Created layer '" + l.name + "' at index " + l.index; })()`;
            } else if (toolName === "applyEffect") {
                jsxCommand = `(function() { var fx = ArcEditor.applyEffect(${serializedRef}, "${params.effectMatchName}", "${params.effectDisplayName || ''}"); return "Success: Applied effect '" + fx.name + "' to layer " + ${serializedRef}; })()`;
            } else if (toolName === "setPropertyValue") {
                jsxCommand = `(function() { ArcEditor.setPropertyValue(${serializedRef}, ${JSON.stringify(params.propPath)}, ${JSON.stringify(params.value)}, ${params.time !== undefined && params.time !== null ? params.time : 'null'}); return "Success: Set property value on layer " + ${serializedRef}; })()`;
            } else if (toolName === "setPropertyExpression") {
                jsxCommand = `(function() { ArcEditor.setPropertyExpression(${serializedRef}, ${JSON.stringify(params.propPath)}, ${JSON.stringify(params.expressionStr)}); return "Success: Set expression on layer " + ${serializedRef}; })()`;
            } else if (toolName === "setKeyframes") {
                jsxCommand = `(function() { ArcEditor.setKeyframes(${serializedRef}, ${JSON.stringify(params.propPath)}, ${JSON.stringify(params.times)}, ${JSON.stringify(params.values)}, ${!!params.easeIn}, ${!!params.easeOut}); return "Success: Set keyframes on layer " + ${serializedRef}; })()`;
            } else if (toolName === "parentLayer") {
                const pRef = params.parentLayerRef !== undefined ? params.parentLayerRef : params.parentLayerIndex;
                const serializedParentRef = pRef === null || pRef === undefined ? 'null' : (typeof pRef === "string" ? `"${pRef.replace(/"/g, '\\"')}"` : pRef);
                jsxCommand = `(function() { ArcEditor.parentLayer(${serializedRef}, ${serializedParentRef}); return "Success: Set parenting for layer " + ${serializedRef}; })()`;
            } else if (toolName === "trimLayer") {
                jsxCommand = `(function() { ArcEditor.trimLayer(${serializedRef}, ${params.inPoint !== undefined && params.inPoint !== null ? params.inPoint : 'null'}, ${params.outPoint !== undefined && params.outPoint !== null ? params.outPoint : 'null'}, ${params.startTime !== undefined && params.startTime !== null ? params.startTime : 'null'}); return "Success: Trimmed layer " + ${serializedRef}; })()`;
            } else if (toolName === "precompose") {
                const refs = params.layerRefs !== undefined ? params.layerRefs : params.layerIndices;
                jsxCommand = `(function() { var l = ArcEditor.precompose(${JSON.stringify(refs)}, "${params.precompName}", ${params.moveAllAttributes !== false}); return "Success: Created precomposition layer '" + l.name + "' at index " + l.index; })()`;
            } else if (toolName === "setLayerBlendMode") {
                jsxCommand = `(function() { ArcEditor.setLayerBlendMode(${serializedRef}, "${params.blendModeName}"); return "Success: Set blend mode to " + "${params.blendModeName}" + " on layer " + ${serializedRef}; })()`;
            } else if (toolName === "addMarker") {
                jsxCommand = `(function() { return ArcEditor.addMarker("${params.type}", ${serializedRef}, ${params.time}, ${params.comment ? `"${params.comment.replace(/"/g, '\\"')}"` : 'null'}, ${params.duration !== undefined && params.duration !== null ? params.duration : 'null'}, ${params.labelIndex !== undefined && params.labelIndex !== null ? params.labelIndex : 'null'}); })()`;
            } else if (toolName === "deleteMarker") {
                const serializedTimeOrIndex = typeof params.timeOrIndex === "string" ? `"${params.timeOrIndex.replace(/"/g, '\\"')}"` : params.timeOrIndex;
                jsxCommand = `(function() { return ArcEditor.deleteMarker("${params.type}", ${serializedRef}, ${serializedTimeOrIndex}); })()`;
            } else if (toolName === "setKeyframeEasing") {
                const easeInVal = typeof params.easeIn === "string" ? `"${params.easeIn}"` : JSON.stringify(params.easeIn);
                const easeOutVal = typeof params.easeOut === "string" ? `"${params.easeOut}"` : JSON.stringify(params.easeOut);
                jsxCommand = `(function() { return ArcEditor.setKeyframeEasing(${serializedRef}, ${JSON.stringify(params.propPath)}, ${params.keyIndex}, ${easeInVal}, ${easeOutVal}); })()`;
            } else if (toolName === "setTextProperties") {
                jsxCommand = `(function() { return ArcEditor.setTextProperties(${serializedRef}, ${JSON.stringify(params.properties)}); })()`;
            } else if (toolName === "addAssetToTimeline") {
                const serializedAssetRef = typeof params.assetRef === "string" ? `"${params.assetRef.replace(/"/g, '\\"')}"` : params.assetRef;
                jsxCommand = `(function() { return ArcEditor.addAssetToTimeline(${serializedAssetRef}, ${JSON.stringify(params.properties)}); })()`;
            } else if (toolName === "getTimelineContext") {
                const timelineData = await getTimelineContext();
                observations.push(`- Tool "getTimelineContext": ${JSON.stringify(timelineData)}`);
                continue;
            } else if (toolName === "getInstalledEffects") {
                observations.push(`- Tool "getInstalledEffects": ${JSON.stringify(installedEffects)}`);
                continue;
            } else if (toolName === "captureActiveFrame") {
                const base64Data = await captureCompositionFrame(true);
                if (base64Data) {
                    observations.push(`- Tool "captureActiveFrame": Success: Active frame successfully captured and visually attached.`);
                    capturedFrameDataDuringLoop = base64Data;
                } else {
                    observations.push(`- Tool "captureActiveFrame": Error: Failed to capture active frame preview.`);
                }
                continue;
            } else if (toolName === "captureCompositionSequence") {
                const base64List = await captureCompositionSequence(params.startTime, params.endTime, params.numFrames, true);
                if (base64List && base64List.length > 0) {
                    observations.push(`- Tool "captureCompositionSequence": Success: Captured and visually attached a sequence of ${base64List.length} frames.`);
                    capturedFrameDataDuringLoop = base64List;
                } else {
                    observations.push(`- Tool "captureCompositionSequence": Error: Failed to capture composition sequence.`);
                }
                continue;
            } else if (toolName === "undoLastAction") {
                if (undoGroupActive) {
                    await evalScriptAsync(`app.endUndoGroup()`);
                    undoGroupActive = false;
                }
                await evalScriptAsync("app.executeCommand(16)");
                observations.push(`- Tool "undoLastAction": Success: Rolled back the last ExtendScript action in After Effects.`);
                continue;
            } else if (toolName === "setPlayheadTime") {
                const serializedTime = typeof params.time === "string" ? `"${params.time.replace(/"/g, '\\"')}"` : params.time;
                jsxCommand = `(function() { return ArcEditor.setPlayheadTime(${serializedTime}); })()`;
            } else if (toolName === "selectLayer") {
                jsxCommand = `(function() { return ArcEditor.selectLayer(${serializedRef}, ${params.deselectOthers !== false}); })()`;
            } else if (toolName === "switchComposition") {
                const serializedCompRef = typeof params.compRef === "string" ? `"${params.compRef.replace(/"/g, '\\"')}"` : params.compRef;
                jsxCommand = `(function() { return ArcEditor.switchComposition(${serializedCompRef}); })()`;
            } else if (toolName === "getLayerProperties") {
                const groupFilterVal = params.groupFilter ? `"${params.groupFilter.replace(/"/g, '\\"')}"` : "null";
                jsxCommand = `ArcEditor.inspectLayerProperties(${serializedRef}, ${groupFilterVal})`;
            } else if (toolName === "setSolidColor") {
                jsxCommand = `(function() { return ArcEditor.setSolidColor(${serializedRef}, ${JSON.stringify(params.color)}); })()`;
            } else if (toolName === "deleteLayer") {
                jsxCommand = `(function() { return ArcEditor.deleteLayer(${serializedRef}); })()`;
            } else {
                throw new Error(`Unsupported tool name: ${toolName}`);
            }

            const result = await evalScriptAsync(jsxCommand);
            observations.push(`- Tool "${toolName}": ${result}`);

            if (result.indexOf("Error:") === 0 || result.indexOf("EvalScript error") === 0) {
                break;
            }
        }
        if (undoGroupActive) {
            await evalScriptAsync(`app.endUndoGroup()`);
        }
    } catch (err) {
        if (undoGroupActive) {
            try {
                await evalScriptAsync(`app.endUndoGroup()`);
            } catch (e) {}
        }
        observations.push(`- Tool execution exception: ${err.message}`);
    }

    return observations.join("\n");
}

function tryFormatToolCall(code) {
    // Unescape HTML entities first (since formatMarkdown escapes them before processing code blocks)
    const cleanCode = code
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
    try {
        const parsed = JSON.parse(cleanCode);
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
                        valStr = JSON.stringify(params[key]);
                    } else {
                        valStr = String(params[key]);
                    }
                    paramsHtml += `<tr><td class="param-key">${key}</td><td class="param-value">${valStr}</td></tr>`;
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
                        <span class="tool-badge">Tool Call</span>
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

function formatMarkdown(text) {
    if (!text) return "";

    // Escape HTML special characters safely
    let html = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // Extract pre/code blocks upfront to prevent formatting inside them
    const preBlocks = [];
    html = html.replace(/```(javascript|js|extendscript|jsx|json)?\n([\s\S]*?)\n```/g, (match, lang, code) => {
        if (lang === "json") {
            const formatted = tryFormatToolCall(code);
            if (formatted) {
                preBlocks.push(formatted);
                return `__PRE_BLOCK_${preBlocks.length - 1}__`;
            }
        }
        if (lang === "javascript" || lang === "js" || lang === "extendscript" || lang === "jsx") {
            const collapsibleHtml = `
            <details class="jsx-code-details">
                <summary class="jsx-code-summary">ExtendScript JSX Code Block</summary>
                <pre class="code-viewport"><code>${code}</code></pre>
            </details>
            `;
            preBlocks.push(collapsibleHtml);
            return `__PRE_BLOCK_${preBlocks.length - 1}__`;
        }
        preBlocks.push(`<pre class="code-viewport"><code>${code}</code></pre>`);
        return `__PRE_BLOCK_${preBlocks.length - 1}__`;
    });


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
        .replace(/\*\*([\s\S]*?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([\s\S]*?)\*/g, "<em>$1</em>")
        .replace(/`([^`]+)`/g, "<code>$1</code>");

    // Clean up empty paragraphs
    result = result.replace(/<p><\/p>/g, "");

    // Process agent reasoning thinking blocks
    result = result.replace(/&lt;thinking&gt;([\s\S]*?)&lt;\/thinking&gt;/g, (match, thoughts) => {
        return `<details class="reasoning-details"><summary>Reasoning / Assembly Plan</summary><div class="reasoning-content">${thoughts}</div></details>`;
    });

    result = result.replace(/&lt;thinking&gt;([\s\S]*?)$/g, (match, thoughts) => {
        return `<details class="reasoning-details"><summary>Reasoning / Assembly Plan (Thinking...)</summary><div class="reasoning-content">${thoughts}</div></details>`;
    });

    return result;
}

function pruneBase64Images(context, maxKeep) {
    if (!context) return;
    var maxToKeep = typeof maxKeep === "number" ? maxKeep : 2;
    var imageMessageIndices = [];
    for (var i = 0; i < context.length; i++) {
        var msg = context[i];
        if (msg && Array.isArray(msg.content)) {
            var hasImage = false;
            for (var j = 0; j < msg.content.length; j++) {
                if (msg.content[j] && msg.content[j].type === "image_url") {
                    hasImage = true;
                    break;
                }
            }
            if (hasImage) {
                imageMessageIndices.push(i);
            }
        }
    }
    if (imageMessageIndices.length > maxToKeep) {
        var toStripCount = imageMessageIndices.length - maxToKeep;
        for (var k = 0; k < toStripCount; k++) {
            var msgIndex = imageMessageIndices[k];
            var msg = context[msgIndex];
            if (msg && Array.isArray(msg.content)) {
                var newContent = [];
                for (var j = 0; j < msg.content.length; j++) {
                    var part = msg.content[j];
                    if (part && part.type === "text") {
                        newContent.push(part);
                    } else if (part && part.type === "image_url") {
                        newContent.push({ type: "text", text: "[Obsolete Intermediate Frame Capture Stripped to Save Context]" });
                    }
                }
                msg.content = newContent;
            }
        }
    }
}

async function pruneHistoryContexts(contextArray) {
    if (!contextArray) return [];

    // 1. If history length is greater than 10 messages (5 turns), trigger memory condensation
    const maxThreshold = 10;
    if (contextArray.length > maxThreshold) {
        // Keep the last 6 messages (3 turns) completely raw as active transactional context
        const rawTurnsCount = 6;
        const cutIndex = contextArray.length - rawTurnsCount;

        // Retrieve the older turns to be compressed
        const olderMessages = contextArray.slice(0, cutIndex);
        const youngerMessages = contextArray.slice(cutIndex);

        // Collect and merge all older system compression summaries, filtering them out of raw messages to condense
        const existingSummaries = [];
        const messagesToCondense = olderMessages.filter(msg => {
            if (msg.role === "system" && msg.content.indexOf("[Condensed Session History:") === 0) {
                existingSummaries.push(msg.content);
                return false;
            }
            return true;
        });
        const existingSummaryText = existingSummaries.join("\n");

        if (messagesToCondense.length > 0) {
            try {
                console.log("[ArcEditor] Initiating background memory condensation...");

                // Deep clone and strip base64 payloads to save memory/tokens
                const messagesClean = JSON.parse(JSON.stringify(messagesToCondense));
                for (var i = 0; i < messagesClean.length; i++) {
                    var msg = messagesClean[i];
                    if (msg && Array.isArray(msg.content)) {
                        for (var j = 0; j < msg.content.length; j++) {
                            if (msg.content[j] && msg.content[j].type === "image_url") {
                                msg.content[j] = { type: "text", text: "[Image Attachment (Base64 Payload Stripped for Condensation)]" };
                            }
                        }
                    }
                }

                // Formulate the condensation request prompt
                const systemPrompt = "You are a memory compressor. Summarize the following video editing dialog history into a single-paragraph log of creative intents, assets added, and controller rigs configured. Keep it extremely concise (under 60 words). " +
                    (existingSummaryText ? "Incorporate this existing history summary: " + existingSummaryText : "") +
                    "\nDo NOT output any technical ExtendScript JSX code or observation JSON logs; summarize only the high-level accomplishments.";

                const compressionMessages = [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: JSON.stringify(messagesClean) }
                ];

                // Call LLM API (non-streaming, direct response, skip system instructions)
                const summaryText = await callLLMApi(compressionMessages, null, true);
                const condensedBlock = {
                    role: "system",
                    content: `[Condensed Session History: ${summaryText.trim()}]`
                };

                // Reconstruct and return the chat history
                const resultHistory = [condensedBlock, ...youngerMessages];
                console.log("[ArcEditor] Background memory condensation completed successfully. New history size:", resultHistory.length);
                return resultHistory;
            } catch (err) {
                console.error("[ArcEditor] Background memory condensation failed:", err);
                // Fallback to sliding window pruner if LLM call fails
                return fallbackSlidingWindowPrune(contextArray);
            }
        }
    }
    return contextArray;
}

function fallbackSlidingWindowPrune(contextArray) {
    if (!contextArray) return [];
    const maxHistoryMessages = 12;
    if (contextArray.length > maxHistoryMessages) {
        let cutIndex = contextArray.length - maxHistoryMessages;
        while (cutIndex < contextArray.length && contextArray[cutIndex].role !== "user") {
            cutIndex++;
        }
        if (cutIndex < contextArray.length) {
            return contextArray.slice(cutIndex);
        }
    }
    return contextArray;
}

function writeToDebugLog(category, text) {
    const timestamp = new Date().toISOString();
    const divider = "\n\n" + "=".repeat(60) + "\n";
    const logEntry = `${divider}[${timestamp}] [${category.toUpperCase()}]\n${text}\n`;

    // 1. Update UI Textarea
    const debugTextarea = document.getElementById("debug-output");
    if (debugTextarea) {
        debugTextarea.value += logEntry;
        debugTextarea.scrollTop = debugTextarea.scrollHeight; // auto-scroll to bottom
    }

    // 2. Append to persistent file in workspace if active
    if (typeof require !== "undefined" && currentProjectPath && currentProjectPath !== "Unsaved Project") {
        try {
            const fs = require('fs');
            const path = require('path');
            const lastSeparator = Math.max(currentProjectPath.lastIndexOf('/'), currentProjectPath.lastIndexOf('\\'));
            const projectDir = currentProjectPath.substring(0, lastSeparator);
            const debugLogPath = path.join(projectDir, "arceditor_debug.log");
            fs.appendFile(debugLogPath, logEntry, 'utf8', (err) => {
                if (err) {
                    console.error("Failed to write to arceditor_debug.log asynchronously: ", err);
                }
            });
        } catch (e) {
            console.error("Failed to initiate write to arceditor_debug.log: ", e);
        }
    }
}
