/**
 * ArcEditor Agent Orchestrator Module
 * Manages the high-level system context instructions, structured tool call routing,
 * the automated ReAct self-correction execution loop, and custom markdown paragraph parser.
 */

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
- **ON-DEMAND CONTEXT PRINCIPLE**: You do NOT automatically receive active timeline metadata or installed effects list in the initial prompt. Whenever the user requests timeline automation, layer styling, or asset placements, you MUST first invoke the \`getTimelineContext\` or \`getInstalledEffects\` tool in a JSON block to fetch the live context before generating your reasoning and ExtendScript.
- **NEVER GUESS EFFECT MATCH NAMES**: You must NEVER guess, assume, or hardcode match names for effects or plugins (e.g., do NOT assume Glow is "ADBE Glow"). If a request involves applying an effect, you MUST first invoke the \`getInstalledEffects\` tool, search the returned JSON catalog for the user's requested display name, and retrieve its exact, active \`matchName\` (e.g., searching 'Glow' will yield 'ADBE Glo2'). Always write the exact retrieved matchName in your generated scripts.
- Only after closing the \`</thinking>\` tag should you output your conversational text and After Effects ExtendScript JSX code blocks.

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
- **NEVER use After Effects' native \`comp.layer(id)\` directly with a numeric layer ID** (e.g. \`comp.layer(26)\`). Native AE scripting only accepts indices or names in \`comp.layer()\`, so passing an ID will retrieve the wrong index or crash.
- **ALWAYS use \`ArcEditor.resolveLayer(layerRef)\`** to retrieve a layer safely from its ID, name, or index in loops (e.g., \`var layer = ArcEditor.resolveLayer(layerIds[i]);\`).
- Property Match Names must be handled carefully. Colors are represented as an array of 4 floats: [R, G, B, A] normalized between 0.0 and 1.0 (e.g. red is [1, 0, 0, 1]).
- If a layer is parented, its Position is in local coordinates relative to the parent.
- Always wrap scripts in a clean try-catch block and return meaningful error messages.
- Wrap all property additions in an app.beginUndoGroup("Editing Action") and app.endUndoGroup() to allow easy rollbacks.

*** AVAILABLE HIGH-LEVEL TOOL CALLS & EDITING API (ArcEditor) ***
To make editing, composition, and timeline automation simple and bulletproof, you have access to a pre-compiled high-level global API object named \`ArcEditor\` inside the host ExtendScript environment. Use these functions in your generated scripts to perform complex editing tasks reliably:

Layer Referencing (Avoid Fragile Indexes!):
- Instead of raw layer indexes (which shift dynamically), always refer to layers using a \`layerRef\`.
- \`layerRef\` can be:
  1. The unique persistent layer \`id\` (integer, e.g. 24). This is the absolute best way to target a layer, especially when multiple layers share the same name!
  2. The exact layer \`name\` string (e.g. "Logo Controls").
  3. A 1-based layer index (e.g. 1) as a fallback if no specific ID or Name exists.
- In your active timeline context JSON, every layer has a unique \`id\` and a \`name\`. Inspect the JSON, find the target layer, and use its unique \`id\` (or name) for the \`layerRef\` parameter.

1. \`ArcEditor.createLayer(type, name, size)\`
   - Description: Creates a new layer in the active composition.
   - Parameters:
     * \`type\`: "Solid", "Text", "Shape", "Null", "Adjustment", "Camera", "Light". (CRITICAL: ALWAYS use "Adjustment" to create adjustment layers. NEVER manually set layer.adjustmentLayer = true on a solid layer, as After Effects invalidates the ExtendScript object reference upon type mutation, causing subsequent operations to crash.)
     * \`name\`: String layer name.
     * \`size\`: (Optional) [width, height] array (e.g. \`[1920, 1080]\`).
   - Returns: The created Layer object.

2. \`ArcEditor.applyEffect(layerRef, effectMatchName, effectDisplayName)\`
   - Description: Applies an effect to a layer.
   - CRITICAL EFFECT MATCH NAME PREFIX RULE: Built-in Adobe effect match names ALWAYS begin with "ADBE" (e.g. "ADBE Slider Control"). NEVER use "ABDE" which is a spelling typo and will crash After Effects.
   - FOR ALL BUILT-IN AND THIRD-PARTY EFFECTS: Do NOT guess. You MUST first retrieve the live [Installed Effects Catalog] by calling the \`getInstalledEffects\` tool. Search the returned JSON catalog for the user's requested display name (e.g. "Glow", "Gaussian Blur", or third-party plugins like Sapphire/Red Giant) and look up its exact, active \`matchName\` (e.g. searching 'Glow' will yield 'ADBE Glo2', not 'ADBE Glow'). Apply the matchName exactly as retrieved!
   - Parameters:
     * \`layerRef\`: Layer unique ID, name, or index.
     * \`effectMatchName\`: String match name (e.g. "ADBE Slider Control", "ADBE Glo2").
     * \`effectDisplayName\`: (Optional) String display name.
   - Returns: The created Effect object.

3. \`ArcEditor.setPropertyValue(layerRef, propPath, value, time)\`
   - Description: Sets a static value or a keyframe value at a specific time.
   - Parameters:
     * \`layerRef\`: Layer unique ID, name, or index.
     * \`propPath\`: String name (e.g. "Position") or Array path (e.g. \`["Transform", "Position"]\`).
     * \`value\`: Number or Array value (e.g. \`[960, 540]\`).
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
   - Description: Changes layer blend mode.
   - Parameters:
     * \`blendModeName\`: "ADD", "SCREEN", "MULTIPLY", "OVERLAY", "DARKEN", "LIGHTEN", "DIFFERENCE", "NORMAL".

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

16. \`getTimelineContext\`
    - Description: Retrieves the active composition details on demand, including layer names, IDs, indices, structures, and all available project bin assets (\`projectAssets\`).
    - Parameters: None.
    - JSON Call Format: Output a JSON code block like this:
      \`\`\`json
      {
        "tool": "getTimelineContext",
        "parameters": {}
      }
      \`\`\`

17. \`getInstalledEffects\`
    - Description: Retrieves the live catalog/dictionary of installed effects in the host After Effects application. Use this to lookup exact matchNames.
    - Parameters: None.
    - JSON Call Format: Output a JSON code block like this:
      \`\`\`json
      {
        "tool": "getInstalledEffects",
        "parameters": {}
      }
      \`\`\`

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
Do not write any comments inside the markdown formatting outside the code blocks that contradict this structure. The host panel parses the block marked with javascript and runs it.
`;

async function runAgenticExecutionLoop(userText) {
    let visualFrameInput = attachedFrameBase64;

    // Reset attachments
    clearAttachmentDock();

    if (visualFrameInput) {
        chatHistory.push({
            role: "user",
            content: [
                { type: "text", text: userText },
                { type: "image_url", image_url: { url: `data:image/png;base64,${visualFrameInput}` } }
            ]
        });
    } else {
        chatHistory.push({ role: "user", content: userText });
    }

    // DECOUPLED CONTEXT FOR LLM (keeps visual history completely raw and unpruned)
    let activeContext = JSON.parse(JSON.stringify(chatHistory));
    activeContext = await pruneHistoryContexts(activeContext);
    
    updateCurrentSessionHistory();
    updateContextSizeInfo();

    writeToDebugLog("Prompt / History Context", JSON.stringify(activeContext, null, 2));

    const aiBubbleId = addBubble("ai", '<div class="dots-loader"><span></span><span></span><span></span></div>');
    const aiBubble = document.getElementById(aiBubbleId);

    let isCompleted = false;
    let loopRetries = 0;
    const maxRetries = 3;
    let toolTurns = 0;
    const maxToolTurns = 5;
    let finalLlmResponse = "";

    while (!isCompleted && loopRetries < maxRetries && toolTurns < maxToolTurns) {
        try {
            const llmResponse = await callLLMApi(activeContext, (chunkText) => {
                aiBubble.querySelector(".message-content").innerHTML = formatMarkdown(chunkText);
                aiBubble.setAttribute("data-raw-text", chunkText);
            });
            aiBubble.setAttribute("data-raw-text", llmResponse);
            activeContext.push({ role: "assistant", content: llmResponse });
            finalLlmResponse = llmResponse;

            writeToDebugLog("LLM Raw Response", llmResponse);

            // Check for JSON tool calls first, then JSX code blocks
            const jsonBlock = extractJSONToolCalls(llmResponse);
            const jsxBlock = extractJSXCode(llmResponse);

            if (jsonBlock) {
                toolTurns++;
                updateConsolePane(jsonBlock);
                aiBubble.querySelector(".message-content").innerHTML = formatMarkdown(llmResponse) +
                    `<div style="margin-top:8px; font-size:11px; color:var(--text-accent);"><div class="dots-loader"><span></span><span></span><span></span></div> Executing Agent Tool Calls...</div>`;

                writeToDebugLog("Tool Calls Extracted", jsonBlock);

                const observations = await executeToolCalls(jsonBlock);
                console.log("[ArcEditor Tool Calls Observations]:", observations);

                writeToDebugLog("Tool Execution Observations", observations);

                // Append observations to local context history
                activeContext.push({
                    role: "user",
                    content: `Observation:\n${observations}\n\nPlease analyze this result and proceed with your next planned steps.`
                });

                // Show feedback in UI and prepare next turn
                aiBubble.querySelector(".message-content").innerHTML = formatMarkdown(llmResponse) +
                    `<div style="margin-top:8px; font-size:11px; border-left: 2px solid var(--text-accent); padding-left: 6px; color:var(--text-secondary);"><strong>Tools Executed:</strong><br>${observations.replace(/\n/g, '<br>')}</div>` +
                    `<div style="margin-top:8px; font-size:11px; color:var(--text-accent);"><div class="dots-loader"><span></span><span></span><span></span></div> Agent planning next step...</div>`;

                continue; // Run next loop turn immediately

            } else if (jsxBlock) {
                updateConsolePane(jsxBlock);
                aiBubble.querySelector(".message-content").innerHTML = formatMarkdown(llmResponse) +
                    `<div style="margin-top:8px; font-size:11px; color:var(--text-accent);"><div class="dots-loader"><span></span><span></span><span></span></div> Executing ExtendScript...</div>`;

                writeToDebugLog("ExtendScript Extracted", jsxBlock);

                // Execute ExtendScript via CEP evalScript
                const execResult = await evalScriptAsync(jsxBlock);
                console.log("[ArcEditor JSX Executed Result]:", execResult);

                writeToDebugLog("ExtendScript Execution Result", execResult);

                if (execResult.indexOf("Error:") === 0 || execResult.indexOf("EvalScript error") === 0) {
                    loopRetries++;
                    aiBubble.querySelector(".message-content").innerHTML = formatMarkdown(llmResponse) +
                        `<div style="margin-top:8px; font-size:11px; color:var(--text-error);"><div class="dots-loader"><span></span><span></span><span></span></div> Script error detected. Initiating self-correction... (Attempt ${loopRetries}/${maxRetries})</div>`;

                    // Push error feedback to local context history
                    activeContext.push({
                        role: "user",
                        content: `System execution failed with error: "${execResult}". Please analyze the After Effects error, correct the syntax or API mismatch, and output a complete revised ExtendScript.`
                    });

                    // Don't send the base64 image again to save bandwidth
                    visualFrameInput = null;
                } else {
                    // Success! Display results to the user
                    isCompleted = true;
                    // Format response markdown nicely
                    aiBubble.querySelector(".message-content").innerHTML = formatMarkdown(llmResponse) +
                        `<div style="margin-top:8px; font-size:11px; color:var(--text-accent);">✓ Timeline edits successfully applied! Check After Effects.</div>`;
                }
            } else {
                // LLM replied without code blocks (informational answer)
                isCompleted = true;
                aiBubble.querySelector(".message-content").innerHTML = formatMarkdown(llmResponse);
                writeToDebugLog("Informational Response Completed", llmResponse);
            }

        } catch (err) {
            console.error("Loop iteration failed:", err);
            aiBubble.querySelector(".message-content").innerHTML = `<p style="color:var(--text-error);">Error executing loop: ${err.message}</p>`;
            isCompleted = true;
        }
    }

    if (loopRetries >= maxRetries) {
        aiBubble.querySelector(".message-content").innerHTML +=
            `<div style="margin-top:8px; font-size:11px; color:var(--text-error);">⚠ Max correction attempts reached. Check the JSX Console tab for syntax logs.</div>`;
    }
    if (toolTurns >= maxToolTurns && !isCompleted) {
        aiBubble.querySelector(".message-content").innerHTML +=
            `<div style="margin-top:8px; font-size:11px; color:var(--text-error);">⚠ Max agent tool turns reached to prevent looping.</div>`;
    }

    // Persist strictly the final, resolved assistant message in visual chatHistory (keeps UI 100% clean of JSON tool observations)
    if (finalLlmResponse) {
        chatHistory.push({ role: "assistant", content: finalLlmResponse });
    }
    updateCurrentSessionHistory();
    updateContextSizeInfo();

    // Expose activeContext strictly for testing, assertion, and developer inspection
    if (typeof window !== "undefined") {
        window.lastActiveContext = activeContext;
    } else if (typeof global !== "undefined") {
        global.lastActiveContext = activeContext;
    }
    try {
        lastActiveContext = activeContext;
    } catch (e) {}
}

function extractJSXCode(text) {
    const match = text.match(/```(?:javascript|js|extendscript|jsx)?\n([\s\S]*?)\n```/);
    return match ? match[1].trim() : null;
}

function extractJSONToolCalls(text) {
    const match = text.match(/```json\n([\s\S]*?)\n```/);
    return match ? match[1].trim() : null;
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

    // Begin AE Undo Group for atomic operations
    await evalScriptAsync(`app.beginUndoGroup("ArcEditor Agent Tools")`);

    try {
        for (let i = 0; i < toolCalls.length; i++) {
            const tc = toolCalls[i];
            const toolName = tc.tool;
            const params = tc.parameters || {};
            const ref = params.layerRef !== undefined ? params.layerRef : params.layerIndex;
            const serializedRef = typeof ref === "string" ? `"${ref.replace(/"/g, '\\"')}"` : (ref !== undefined ? ref : 'null');

            let jsxCommand = "";
            if (toolName === "createLayer") {
                jsxCommand = `(function() { var l = ArcEditor.createLayer("${params.type}", "${params.name || 'Layer'}", ${params.size ? JSON.stringify(params.size) : 'null'}); return "Success: Created layer '" + l.name + "' at index " + l.index; })()`;
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
            } else {
                throw new Error(`Unsupported tool name: ${toolName}`);
            }

            const result = await evalScriptAsync(jsxCommand);
            observations.push(`- Tool "${toolName}": ${result}`);

            if (result.indexOf("Error:") === 0) {
                break;
            }
        }
        await evalScriptAsync(`app.endUndoGroup()`);
    } catch (err) {
        await evalScriptAsync(`app.endUndoGroup()`);
        observations.push(`- Tool execution exception: ${err.message}`);
    }

    return observations.join("\n");
}

function formatMarkdown(text) {
    if (!text) return "";

    let html = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    html = html.replace(/```(?:javascript|js|extendscript|jsx)?\n([\s\S]*?)\n```/g, (match, code) => {
        return `<pre class="code-viewport"><code>${code}</code></pre>`;
    });

    const segments = html.split(/(<pre[\s\S]*?<\/pre>)/g);

    for (let i = 0; i < segments.length; i++) {
        if (!segments[i].startsWith("<pre")) {
            segments[i] = segments[i]
                .replace(/^###### (.*?)$/gm, "<h6>$1</h6>")
                .replace(/^##### (.*?)$/gm, "<h5>$1</h5>")
                .replace(/^#### (.*?)$/gm, "<h4>$1</h4>")
                .replace(/^### (.*?)$/gm, "<h3>$1</h3>")
                .replace(/^## (.*?)$/gm, "<h2>$1</h2>")
                .replace(/^# (.*?)$/gm, "<h1>$1</h1>")
                .replace(/^\s*[-*+]\s+(.*?)$/gm, "<div class='bullet-item'>• $1</div>")
                .replace(/^\s*(\d+)\.\s+(.*?)$/gm, "<div class='bullet-item'>$1. $2</div>")
                .replace(/`([^`]+)`/g, "<code>$1</code>")
                .replace(/\*\*([\s\S]*?)\*\*/g, "<strong>$1</strong>")
                .replace(/\*([\s\S]*?)\*/g, "<em>$1</em>")
                .replace(/\n/g, "<br>");
        }
    }

    let result = segments.join("");

    result = result.replace(/<(h[1-6]|div[^>]*|details[^>]*|summary[^>]*|pre[^>]*|table[^>]*|tr[^>]*|td[^>]*|th[^>]*|ul[^>]*|li[^>]*)><br>/gi, "<$1>");
    result = result.replace(/<\/(h[1-6]|div|details|summary|pre|table|tr|td|th|ul|li)><br>/gi, "</$1>");
    result = result.replace(/<br><(h[1-6]|div[^>]*|details[^>]*|summary[^>]*|pre[^>]*|table[^>]*|tr[^>]*|td[^>]*|th[^>]*|ul[^>]*|li[^>]*)>/gi, "<$1>");
    result = result.replace(/<br><\/(h[1-6]|div|details|summary|pre|table|tr|td|th|ul|li)>/gi, "</$1>");

    result = result.replace(/&lt;thinking&gt;([\s\S]*?)&lt;\/thinking&gt;/g, (match, thoughts) => {
        return `<details class="reasoning-details"><summary>Reasoning / Assembly Plan</summary><div class="reasoning-content">${thoughts}</div></details>`;
    });

    result = result.replace(/&lt;thinking&gt;([\s\S]*?)$/g, (match, thoughts) => {
        return `<details class="reasoning-details"><summary>Reasoning / Assembly Plan (Thinking...)</summary><div class="reasoning-content">${thoughts}</div></details>`;
    });

    return result;
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
        
        // Filter out any older system compression messages to avoid bloat and infinite loops
        const messagesToCondense = olderMessages.filter(msg => {
            return !(msg.role === "system" && msg.content.indexOf("[Condensed Session History:") === 0);
        });
        
        // Find if there is an existing summary block in the older history that we can carry forward or merge
        const existingSummaryBlock = olderMessages.find(msg => {
            return msg.role === "system" && msg.content.indexOf("[Condensed Session History:") === 0;
        });
        const existingSummaryText = existingSummaryBlock ? existingSummaryBlock.content : "";
        
        if (messagesToCondense.length > 0) {
            try {
                console.log("[ArcEditor] Initiating background memory condensation...");
                
                // Formulate the condensation request prompt
                const systemPrompt = "You are a memory compressor. Summarize the following video editing dialog history into a single-paragraph log of creative intents, assets added, and controller rigs configured. Keep it extremely concise (under 60 words). " +
                                     (existingSummaryText ? "Incorporate this existing history summary: " + existingSummaryText : "") +
                                     "\nDo NOT output any technical ExtendScript JSX code or observation JSON logs; summarize only the high-level accomplishments.";
                                     
                const compressionMessages = [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: JSON.stringify(messagesToCondense) }
                ];
                
                // Call LLM API (non-streaming, direct response)
                const summaryText = await callLLMApi(compressionMessages);
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
            fs.appendFileSync(debugLogPath, logEntry, 'utf8');
        } catch (e) {
            console.error("Failed to write to arceditor_debug.log: ", e);
        }
    }
}
