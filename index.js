/**
 * ArcEditor Frontend & Agent Orchestrator Controller
 * Manages UI interactivity, persistent settings storage, network operations via Node.js context,
 * and coordinates the agentic ReAct loop for After Effects ExtendScript operations.
 */

// Global state variables
let currentProvider = "lemonade";
let apiUrl = "http://localhost:1337/v1";
let modelName = "qwen2.5-coder-7b";
let apiKey = "";
let isConnected = false;

let chatHistory = [];
let attachedFrameBase64 = null;

// Safe Node.js loading (allows mockup testing inside standalone browsers)
let fs = null, path = null, os = null, httpsClient = null, httpClient = null;
let csInterface = null;
let extensionPath = "./";
let configPath = "./config.json";

try {
    if (typeof require !== "undefined") {
        fs = require('fs');
        path = require('path');
        os = require('os');
        httpsClient = require('https');
        httpClient = require('http');
    }
} catch (e) {
    console.warn("[ArcEditor] Node.js context not detected. Running in mockup browser mode.");
}

// Initialize Adobe CEP CSInterface
try {
    if (typeof CSInterface !== "undefined") {
        csInterface = new CSInterface();
        extensionPath = csInterface.getSystemPath('extension');
    }
} catch (e) {
    console.error("CSInterface initialization failed:", e);
}

// Set writable config path in user home directory (avoids Program Files read-only permission issues!)
if (os && path) {
    configPath = path.join(os.homedir(), '.arceditor_config.json');
} else {
    configPath = "./config.json";
}

// Document Ready
document.addEventListener("DOMContentLoaded", () => {
    loadSettings();
    initUI();
    validateConnection();
    updateContextSizeInfo();
});

// --- SECTION 1: SETTINGS & LOCAL PERSISTENCE ---
function loadSettings() {
    if (fs && fs.existsSync(configPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            currentProvider = data.provider || "lemonade";
            apiUrl = data.url || getDefaultUrl(currentProvider);
            modelName = data.model || getDefaultModel(currentProvider);
            apiKey = data.key || "";
        } catch(e) {
            console.error("Failed to load saved config:", e);
        }
    } else {
        // Apply defaults
        currentProvider = "lemonade";
        apiUrl = getDefaultUrl(currentProvider);
        modelName = getDefaultModel(currentProvider);
    }
    
    // Sync into settings DOM
    document.getElementById("setting-provider").value = currentProvider;
    document.getElementById("setting-url").value = apiUrl;
    document.getElementById("setting-model").value = modelName;
    document.getElementById("setting-key").value = apiKey;
}

function saveSettings(e) {
    if (e) e.preventDefault();
    
    currentProvider = document.getElementById("setting-provider").value;
    apiUrl = document.getElementById("setting-url").value || getDefaultUrl(currentProvider);
    modelName = document.getElementById("setting-model").value || getDefaultModel(currentProvider);
    apiKey = document.getElementById("setting-key").value;
    
    const config = {
        provider: currentProvider,
        url: apiUrl,
        model: modelName,
        key: apiKey
    };
    
    if (fs) {
        try {
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
            addSystemMessage("Settings saved successfully.");
        } catch(err) {
            console.error("Failed to save settings to disk:", err);
            addSystemMessage("Error saving settings to local config file: " + err.message);
        }
    } else {
        addSystemMessage("Settings applied locally (Running in browser mode).");
    }
    
    toggleSettingsDrawer(false);
    validateConnection();
}

function getDefaultUrl(provider) {
    if (provider === "lemonade") return "http://localhost:1337/v1";
    if (provider === "openai") return "https://api.openai.com/v1";
    if (provider === "anthropic") return "https://api.anthropic.com/v1";
    if (provider === "gemini") return "https://generativelanguage.googleapis.com";
    return "";
}

function getDefaultModel(provider) {
    if (provider === "lemonade") return "qwen2.5-coder-7b";
    if (provider === "gemini") return "gemini-1.5-flash";
    if (provider === "openai") return "gpt-4o";
    if (provider === "anthropic") return "claude-3-5-sonnet-20241022";
    return "";
}

// --- SECTION 1B: DEPENDENCY-FREE HTTP REQUEST HELPER ---
function makeRequest(url, method, headers, payload) {
    return new Promise((resolve, reject) => {
        if (!httpsClient || !httpClient) {
            reject(new Error("Node.js network modules (https/http) not loaded."));
            return;
        }
        
        try {
            const urlObj = new URL(url);
            const client = urlObj.protocol === 'https:' ? httpsClient : httpClient;
            const postData = typeof payload === "string" ? payload : JSON.stringify(payload);
            
            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: method,
                headers: {
                    ...headers,
                    'Content-Length': Buffer.byteLength(postData)
                }
            };
            
            const req = client.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(data);
                    } else {
                        reject(new Error(`HTTP Error ${res.statusCode}: ${data}`));
                    }
                });
            });
            
            req.on('error', (err) => {
                reject(err);
            });
            
            if (method !== 'GET' && postData) {
                req.write(postData);
            }
            req.end();
            
        } catch(e) {
            reject(e);
        }
    });
}

function makeStreamingRequest(url, method, headers, payload, onChunk) {
    return new Promise((resolve, reject) => {
        if (!httpsClient && !httpClient) {
            reject(new Error("Node.js network modules (https/http) not loaded."));
            return;
        }
        
        try {
            const urlObj = new URL(url);
            const client = urlObj.protocol === 'https:' ? httpsClient : httpClient;
            const postData = typeof payload === "string" ? payload : JSON.stringify(payload);
            
            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: method,
                headers: {
                    ...headers,
                    'Content-Length': Buffer.byteLength(postData)
                }
            };
            
            const req = client.request(options, (res) => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    let errData = '';
                    res.on('data', (chunk) => { errData += chunk; });
                    res.on('end', () => { reject(new Error(`HTTP Error ${res.statusCode}: ${errData}`)); });
                    return;
                }
                
                let buffer = '';
                res.on('data', (chunk) => {
                    buffer += chunk.toString();
                    
                    let lines = buffer.split('\n');
                    buffer = lines.pop(); // Keep incomplete line
                    
                    for (let line of lines) {
                        line = line.trim();
                        if (!line) continue;
                        onChunk(line);
                    }
                });
                
                res.on('end', () => {
                    if (buffer.trim()) {
                        onChunk(buffer.trim());
                    }
                    resolve();
                });
            });
            
            req.on('error', (err) => {
                reject(err);
            });
            
            if (method !== 'GET' && postData) {
                req.write(postData);
            }
            req.end();
            
        } catch(e) {
            reject(e);
        }
    });
}

// --- SECTION 2: CONNECTION VALIDATION ---
async function validateConnection() {
    const statusDot = document.getElementById("status-dot");
    const sendBtn = document.getElementById("btn-send");
    
    statusDot.className = "status-dot offline";
    statusDot.title = "Validating connection...";
    sendBtn.disabled = true;
    
    if (!httpsClient && !httpClient) {
        // Standalone browser fallback mock state
        statusDot.className = "status-dot online";
        statusDot.title = "Mock Connection (Browser Mode)";
        sendBtn.disabled = false;
        isConnected = true;
        return;
    }
    
    try {
        if (currentProvider === "lemonade") {
            // Check local Lemonade status
            const checkUrl = apiUrl.endsWith("/v1") ? `${apiUrl}/models` : `${apiUrl}/v1/models`;
            await makeRequest(checkUrl, 'GET', {}, "");
        } else {
            // For cloud APIs, check if we have a key input
            if (!apiKey) {
                statusDot.className = "status-dot error";
                statusDot.title = "API Key required for cloud provider.";
                return;
            }
        }
        
        statusDot.className = "status-dot online";
        statusDot.title = `Connected successfully via ${currentProvider}`;
        sendBtn.disabled = false;
        isConnected = true;
    } catch(err) {
        statusDot.className = "status-dot error";
        statusDot.title = `Failed to connect to ${currentProvider}: ${err.message}`;
        sendBtn.disabled = false; // Let the user send anyway to troubleshoot
        isConnected = false;
    }
}

// --- SECTION 3: EXTENDSCRIPT RPC BRIDGE ---
function evalScriptAsync(script) {
    return new Promise((resolve) => {
        if (csInterface) {
            csInterface.evalScript(script, (result) => {
                resolve(result);
            });
        } else {
            // Mock runner inside general browsers
            console.log("[ArcEditor Mock Executing JSX]:", script);
            resolve("Success: (Mocked JSX output)");
        }
    });
}

// --- SECTION 4: CONTEXT & VISUAL FRAME CAPTURING ---
async function captureCompositionFrame() {
    if (!csInterface && !fs) {
        addSystemMessage("Visual capture not supported outside After Effects.");
        return;
    }
    
    const previewContainer = document.getElementById("frame-attachment-preview");
    const previewImg = document.getElementById("attached-preview-img");
    
    const saveDir = (os && typeof os.homedir === "function") ? os.homedir() : (process.env.TEMP || process.env.TMP || '/tmp');
    const tempPngPath = path.join(saveDir, 'arc_preview.png');
    
    // Replace backslashes for safe ExtendScript evaluation on Windows paths
    const safePath = tempPngPath.replace(/\\/g, '/');
    
    const jsxCommand = `ArcCanvas.saveCurrentFrame("${safePath}")`;
    addSystemMessage("Rendering current timeline frame...");
    
    const result = await evalScriptAsync(jsxCommand);
    
    if (result.indexOf("Success:") === 0) {
        try {
            const returnedPath = result.substring(8).trim();
            let actualPath = returnedPath;
            
            if (!fs.existsSync(actualPath)) {
                // Fall back to checking the local tempPngPath computed in Node.js
                if (fs.existsSync(tempPngPath)) {
                    actualPath = tempPngPath;
                } else {
                    // Suffix scan in both the returned path's directory and our local saveDir
                    const checkDirs = [];
                    try { checkDirs.push(path.dirname(returnedPath)); } catch(e) {}
                    try { checkDirs.push(path.dirname(tempPngPath)); } catch(e) {}
                    
                    let foundMatch = null;
                    for (const dir of checkDirs) {
                        if (!dir || !fs.existsSync(dir)) continue;
                        const baseName = 'arc_preview';
                        const files = fs.readdirSync(dir);
                        const match = files.find(f => f.indexOf(baseName) === 0 && f.endsWith('.png'));
                        if (match) {
                            foundMatch = path.join(dir, match);
                            break;
                        }
                    }
                    
                    if (foundMatch) {
                        actualPath = foundMatch;
                    } else {
                        throw new Error("Could not find rendered preview file on disk at: " + returnedPath + " (also scanned local fallback directories)");
                    }
                }
            }
            
            const base64Data = fs.readFileSync(actualPath, { encoding: 'base64' });
            attachedFrameBase64 = base64Data;
            
            // Show visual attachment badge in UI
            previewImg.src = `data:image/png;base64,${base64Data}`;
            previewContainer.classList.remove("hidden");
            addSystemMessage("Canvas frame attached successfully.");
            
            // Clean up the temporary preview file from disk
            try {
                fs.unlinkSync(actualPath);
            } catch(e) {}
            
        } catch(err) {
            console.error("Failed to read captured PNG frame from disk:", err);
            addSystemMessage("Error reading captured frame: " + err.message);
        }
    } else {
        addSystemMessage(result);
    }
}

async function getTimelineContext() {
    const jsxCommand = `ArcInspector.getActiveCompositionData()`;
    const jsonResult = await evalScriptAsync(jsxCommand);
    
    try {
        const parsed = JSON.parse(jsonResult);
        if (parsed.error) {
            return { error: parsed.error };
        }
        return parsed;
    } catch(e) {
        console.error("Failed to parse timeline inspector payload:", e);
        return { error: "Failed to parse timeline inspector data: " + jsonResult };
    }
}

// --- SECTION 5: THE SYSTEM PROMPTS & AE MANIFESTS ---
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

Layer Referencing (Avoid Fragile Indices!):
- Instead of raw layer indexes (which shift dynamically), always refer to layers using a \`layerRef\`.
- \`layerRef\` can be:
  1. The unique persistent layer \`id\` (integer, e.g. 24). This is the absolute best way to target a layer, especially when multiple layers share the same name!
  2. The exact layer \`name\` string (e.g. "Logo Controls").
  3. A 1-based layer index (e.g. 1) as a fallback if no specific ID or Name exists.
- In your active timeline context JSON, every layer has a unique \`id\` and a \`name\`. Inspect the JSON, find the target layer, and use its unique \`id\` (or name) for the \`layerRef\` parameter.

1. \`ArcEditor.createLayer(type, name, size)\`
   - Description: Creates a new layer in the active composition.
   - Parameters:
     * \`type\`: "Solid", "Text", "Shape", "Null", "Camera", "Light".
     * \`name\`: String layer name.
     * \`size\`: (Optional) [width, height] array (e.g. \`[1920, 1080]\`).
   - Returns: The created Layer object.

2. \`ArcEditor.applyEffect(layerRef, effectMatchName, effectDisplayName)\`
   - Description: Applies a native After Effects effect to a layer.
   - Parameters:
     * \`layerRef\`: Layer unique ID, name, or index.
     * \`effectMatchName\`: String match name (e.g. "ADBE Slider Control", "ADBE Color Control", "ADBE Gaussian Blur 2").
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

// --- SECTION 6: LLM CLIENT COMPILERS ---
async function callLLMApi(messages, onChunkReceived) {
    if (!httpsClient && !httpClient) {
        // Fallback mock mode ONLY inside standalone browsers
        return new Promise((resolve) => {
            setTimeout(() => {
                const text = `Based on your request, I will create a Scale bounce control slider rig to automate the bounce scaling.

Here is the ExtendScript to build it:

\`\`\`javascript
(function() {
    var result = ArcRigger.createSliderRig(
        1, 
        "Scale", 
        "Bounce Rig", 
        "Bounce Elasticity", 
        15, 
        "var f = thisComp.layer('Bounce Rig Controls').effect('Bounce Elasticity')('Slider'); [100 + Math.sin(time * f) * 10, 100 + Math.sin(time * f) * 10]"
    );
    return result;
})();
\`\`\`
`;
                if (onChunkReceived) {
                    let chars = text.split("");
                    let i = 0;
                    let interval = setInterval(() => {
                        if (i < chars.length) {
                            onChunkReceived(chars.slice(0, i+1).join(""));
                            i += 5; // Stream fast in mock
                        } else {
                            clearInterval(interval);
                            resolve(text);
                        }
                    }, 30);
                } else {
                    resolve(text);
                }
            }, 1000);
        });
    }

    const headers = { "Content-Type": "application/json" };
    let payload = {};
    let targetUrl = apiUrl;
    
    if (currentProvider === "lemonade" || currentProvider === "openai") {
        targetUrl = targetUrl.endsWith("/chat/completions") ? targetUrl : `${targetUrl}/chat/completions`;
        if (currentProvider === "openai") {
            headers["Authorization"] = `Bearer ${apiKey}`;
        }
        
        payload = {
            model: modelName,
            messages: [
                { role: "system", content: SYSTEM_INSTRUCTIONS },
                ...messages
            ],
            temperature: 0.2,
            stream: !!onChunkReceived
        };
        
        if (onChunkReceived) {
            let accumulatedText = "";
            await makeStreamingRequest(targetUrl, 'POST', headers, payload, (line) => {
                if (line.startsWith("data: ")) {
                    const dataStr = line.substring(6).trim();
                    if (dataStr === "[DONE]") return;
                    try {
                        const parsed = JSON.parse(dataStr);
                        const content = parsed.choices[0].delta.content;
                        if (content) {
                            accumulatedText += content;
                            onChunkReceived(accumulatedText);
                        }
                    } catch(e) {}
                }
            });
            return accumulatedText;
        } else {
            const responseText = await makeRequest(targetUrl, 'POST', headers, payload);
            const responseData = JSON.parse(responseText);
            return responseData.choices[0].message.content;
        }
        
    } else if (currentProvider === "gemini") {
        // Target Gemini generateContent API
        let endpointName = onChunkReceived ? "streamGenerateContent" : "generateContent";
        targetUrl = `${apiUrl}/v1beta/models/${modelName}:${endpointName}?key=${apiKey}`;
        if (onChunkReceived) {
            targetUrl += "&alt=sse"; // Request SSE format for easy parsing!
        }
        
        // Convert messages to Gemini format
        const contents = messages.map(m => {
            const parts = [];
            if (typeof m.content === "string") {
                parts.push({ text: m.content });
            } else if (Array.isArray(m.content)) {
                m.content.forEach(c => {
                    if (c.type === "text") parts.push({ text: c.text });
                    if (c.type === "image_url") {
                        const partsOfUrl = c.image_url.url.split(',');
                        const base64Data = partsOfUrl[1] || partsOfUrl[0];
                        parts.push({
                            inlineData: {
                                mimeType: "image/png",
                                data: base64Data
                            }
                        });
                    }
                });
            }
            return {
                role: m.role === "user" ? "user" : "model",
                parts: parts
            };
        });
        
        payload = {
            systemInstruction: {
                parts: [{ text: SYSTEM_INSTRUCTIONS }]
            },
            contents: contents,
            generationConfig: {
                temperature: 0.2
            }
        };
        
        if (onChunkReceived) {
            let accumulatedText = "";
            await makeStreamingRequest(targetUrl, 'POST', headers, payload, (line) => {
                if (line.startsWith("data: ")) {
                    const dataStr = line.substring(6).trim();
                    try {
                        const parsed = JSON.parse(dataStr);
                        const text = parsed.candidates[0].content.parts[0].text;
                        if (text) {
                            accumulatedText += text;
                            onChunkReceived(accumulatedText);
                        }
                    } catch(e) {}
                }
            });
            return accumulatedText;
        } else {
            const responseText = await makeRequest(targetUrl, 'POST', headers, payload);
            const responseData = JSON.parse(responseText);
            return responseData.candidates[0].content.parts[0].text;
        }
        
    } else if (currentProvider === "anthropic") {
        // Target Claude API
        targetUrl = targetUrl.endsWith("/messages") ? targetUrl : `${targetUrl}/v1/messages`;
        headers["x-api-key"] = apiKey;
        headers["anthropic-version"] = "2023-06-01";
        
        // Convert vision base64 input to Anthropic's block format
        const anthropicMessages = messages.map(m => {
            let contentArr = [];
            if (typeof m.content === "string") {
                contentArr.push({ type: "text", text: m.content });
            } else if (Array.isArray(m.content)) {
                m.content.forEach(c => {
                    if (c.type === "text") contentArr.push({ type: "text", text: c.text });
                    if (c.type === "image_url") {
                        const partsOfUrl = c.image_url.url.split(',');
                        const base64Data = partsOfUrl[1] || partsOfUrl[0];
                        contentArr.push({
                            type: "image",
                            source: {
                                type: "base64",
                                media_type: "image/png",
                                data: base64Data
                            }
                        });
                    }
                });
            }
            return {
                role: m.role === "user" ? "user" : "assistant",
                content: contentArr
            };
        });
        
        payload = {
            model: modelName,
            system: SYSTEM_INSTRUCTIONS,
            messages: anthropicMessages,
            max_tokens: 4096,
            temperature: 0.2,
            stream: !!onChunkReceived
        };
        
        if (onChunkReceived) {
            let accumulatedText = "";
            await makeStreamingRequest(targetUrl, 'POST', headers, payload, (line) => {
                if (line.startsWith("data: ")) {
                    const dataStr = line.substring(6).trim();
                    try {
                        const parsed = JSON.parse(dataStr);
                        if (parsed.type === "content_block_delta" && parsed.delta && parsed.delta.text) {
                            accumulatedText += parsed.delta.text;
                            onChunkReceived(accumulatedText);
                        }
                    } catch(e) {}
                }
            });
            return accumulatedText;
        } else {
            const responseText = await makeRequest(targetUrl, 'POST', headers, payload);
            const responseData = JSON.parse(responseText);
            return responseData.content[0].text;
        }
    }
}

// --- SECTION 7: AGENT REACT LOOP (SELF-CORRECTION) ---
async function runAgenticExecutionLoop(userText) {
    addSystemMessage("Gathering timeline structures...");
    const timelineData = await getTimelineContext();
    
    // Inject current project properties as a helper context
    let enrichedPrompt = userText;
    if (timelineData && !timelineData.error) {
        enrichedPrompt += `\n\n[Active Timeline Context: ${JSON.stringify(timelineData)}]`;
    } else {
        enrichedPrompt += `\n\n[Active Timeline Context: No composition currently open. Prompt the user to open one if the task requires a timeline].`;
    }
    
    let visualFrameInput = attachedFrameBase64;
    
    // Reset attachments
    clearAttachmentDock();
    
    if (visualFrameInput) {
        chatHistory.push({
            role: "user",
            content: [
                { type: "text", text: enrichedPrompt },
                { type: "image_url", image_url: { url: `data:image/png;base64,${visualFrameInput}` } }
            ]
        });
    } else {
        chatHistory.push({ role: "user", content: enrichedPrompt });
    }
    
    updateContextSizeInfo();
    
    const aiBubbleId = addBubble("ai", '<div class="dots-loader"><span></span><span></span><span></span></div>');
    const aiBubble = document.getElementById(aiBubbleId);
    
    let isCompleted = false;
    let loopRetries = 0;
    const maxRetries = 3;
    let toolTurns = 0;
    const maxToolTurns = 5;
    
    while (!isCompleted && loopRetries < maxRetries && toolTurns < maxToolTurns) {
        try {
            const llmResponse = await callLLMApi(chatHistory, (chunkText) => {
                aiBubble.querySelector(".message-content").innerHTML = formatMarkdown(chunkText);
            });
            chatHistory.push({ role: "assistant", content: llmResponse });
            
            // Check for JSON tool calls first, then JSX code blocks
            const jsonBlock = extractJSONToolCalls(llmResponse);
            const jsxBlock = extractJSXCode(llmResponse);
            
            if (jsonBlock) {
                toolTurns++;
                updateConsolePane(jsonBlock);
                aiBubble.querySelector(".message-content").innerHTML = formatMarkdown(llmResponse) + 
                    `<div style="margin-top:8px; font-size:11px; color:var(--text-accent);"><div class="dots-loader"><span></span><span></span><span></span></div> Executing Agent Tool Calls...</div>`;
                
                const observations = await executeToolCalls(jsonBlock);
                console.log("[ArcEditor Tool Calls Observations]:", observations);
                
                // Append observations to history
                chatHistory.push({ 
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
                
                // Execute ExtendScript via CEP evalScript
                const execResult = await evalScriptAsync(jsxBlock);
                console.log("[ArcEditor JSX Executed Result]:", execResult);
                
                if (execResult.indexOf("Error:") === 0 || execResult.indexOf("EvalScript error") === 0) {
                    loopRetries++;
                    aiBubble.querySelector(".message-content").innerHTML = formatMarkdown(llmResponse) + 
                        `<div style="margin-top:8px; font-size:11px; color:var(--text-error);"><div class="dots-loader"><span></span><span></span><span></span></div> Script error detected. Initiating self-correction... (Attempt ${loopRetries}/${maxRetries})</div>`;
                    
                    // Push error feedback to conversation memory
                    chatHistory.push({ 
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
                        `<div style="margin-top:8px; font-size:11px; color:var(--text-accent);">✓ Rigging successfully loaded! Check Effects panel in After Effects.</div>`;
                }
            } else {
                // LLM replied without code blocks (informational answer)
                isCompleted = true;
                aiBubble.querySelector(".message-content").innerHTML = formatMarkdown(llmResponse);
            }
            
        } catch(err) {
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
    
    updateContextSizeInfo();
}

function extractJSXCode(text) {
    // Regex matches text inside ```javascript or ```js or ```extendscript or ```jsx
    const match = text.match(/```(?:javascript|js|extendscript|jsx)?\n([\s\S]*?)\n```/);
    return match ? match[1].trim() : null;
}

function extractJSONToolCalls(text) {
    // Regex matches text inside ```json
    const match = text.match(/```json\n([\s\S]*?)\n```/);
    return match ? match[1].trim() : null;
}

async function executeToolCalls(jsonStr) {
    let toolCalls = [];
    try {
        const parsed = JSON.parse(jsonStr);
        toolCalls = Array.isArray(parsed) ? parsed : [parsed];
    } catch(e) {
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
    } catch(err) {
        await evalScriptAsync(`app.endUndoGroup()`);
        observations.push(`- Tool execution exception: ${err.message}`);
    }
    
    return observations.join("\n");
}

// --- SECTION 8: USER INTERFACE RENDERERS & EVENT BINDINGS ---
function initUI() {
    const btnSettings = document.getElementById("btn-settings");
    const btnCloseSettings = document.getElementById("btn-close-settings");
    const formSettings = document.getElementById("form-settings");
    const tabChat = document.getElementById("tab-chat");
    const tabConsole = document.getElementById("tab-console");
    const chatInput = document.getElementById("chat-input");
    const btnSend = document.getElementById("btn-send");
    const btnClearConsole = document.getElementById("btn-clear-console");
    const btnRemoveAttachment = document.getElementById("btn-remove-attachment");
    
    // Quick Chips
    const chipCapture = document.getElementById("chip-capture");
    const chipInspect = document.getElementById("chip-inspect");
    
    btnSettings.addEventListener("click", () => toggleSettingsDrawer(true));
    btnCloseSettings.addEventListener("click", () => toggleSettingsDrawer(false));
    formSettings.addEventListener("submit", saveSettings);
    
    tabChat.addEventListener("click", () => switchTab("chat"));
    tabConsole.addEventListener("click", () => switchTab("console"));
    
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
            const result = await evalScriptAsync(code);
            addSystemMessage(`Console Exec Result: ${result}`);
        });
    }
    
    btnRemoveAttachment.addEventListener("click", clearAttachmentDock);
    
    chipCapture.addEventListener("click", captureCompositionFrame);
    chipInspect.addEventListener("click", async () => {
        addBubble("user", "Inspect current composition structure.");
        addSystemMessage("Loading active timeline context...");
        const context = await getTimelineContext();
        if (context.error) {
            addBubble("ai", `Timeline Inspector failed:\n\n${context.error}`);
        } else {
            addBubble("ai", `Successfully serialised timeline! Active Comp: **${context.name}** (${context.width}x${context.height}, ${context.frameRate} fps). Layers: **${context.numLayers}**.`);
        }
    });
    
    // Auto-resize chat input textarea and update context count
    chatInput.addEventListener("input", function() {
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
    if (!userText) return;
    
    addBubble("user", userText);
    input.value = "";
    input.style.height = "auto";
    document.getElementById("btn-send").disabled = true;
    
    runAgenticExecutionLoop(userText);
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
    } else {
        content.innerHTML = formatMarkdown(text);
    }
    
    wrapper.appendChild(content);
    scroller.appendChild(wrapper);
    scroller.scrollTop = scroller.scrollHeight;
    
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
    scroller.scrollTop = scroller.scrollHeight;
}

function updateContextSizeInfo() {
    const metaElement = document.getElementById("input-meta-info");
    if (!metaElement) return;
    
    const inputText = document.getElementById("chat-input").value;
    
    // Calculate history size
    let historyCharCount = 0;
    for (const msg of chatHistory) {
        if (typeof msg.content === "string") {
            historyCharCount += msg.content.length;
        } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part.type === "text" && part.text) {
                    historyCharCount += part.text.length;
                } else if (part.type === "image_url" && part.image_url && part.image_url.url) {
                    historyCharCount += part.image_url.url.length;
                }
            }
        }
    }
    
    let totalChars = historyCharCount + inputText.length;
    if (attachedFrameBase64) {
        totalChars += attachedFrameBase64.length;
    }
    
    const estTokens = Math.round(totalChars / 4);
    metaElement.innerText = `Context: ${totalChars.toLocaleString()} chars (~${estTokens.toLocaleString()} tokens)`;
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

// Premium Markdown formatting helper that supports segment-scoped code viewports
function formatMarkdown(text) {
    if (!text) return "";
    
    // First, escape HTML characters to prevent XSS
    let html = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
        
    // Handle multi-line fenced code blocks: ```javascript ... ```
    html = html.replace(/```(?:javascript|js|extendscript|jsx)?\n([\s\S]*?)\n```/g, (match, code) => {
        return `<pre class="code-viewport"><code>${code}</code></pre>`;
    });
    
    // Split the text into segments to apply formatting ONLY outside <pre> code blocks
    const segments = html.split(/(<pre[\s\S]*?<\/pre>)/g);
    for (let i = 0; i < segments.length; i++) {
        if (!segments[i].startsWith("<pre")) {
            // Apply inline formatting only inside text segments, preserving code contents pristine
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
    
    // Clean up empty line breaks next to block elements
    result = result.replace(/<(h[1-6]|div[^>]*|details[^>]*|summary[^>]*|pre[^>]*|table[^>]*|tr[^>]*|td[^>]*|th[^>]*|ul[^>]*|li[^>]*)><br>/gi, "<$1>");
    result = result.replace(/<\/(h[1-6]|div|details|summary|pre|table|tr|td|th|ul|li)><br>/gi, "</$1>");
    result = result.replace(/<br><(h[1-6]|div[^>]*|details[^>]*|summary[^>]*|pre[^>]*|table[^>]*|tr[^>]*|td[^>]*|th[^>]*|ul[^>]*|li[^>]*)>/gi, "<$1>");
    result = result.replace(/<br><\/(h[1-6]|div|details|summary|pre|table|tr|td|th|ul|li)>/gi, "</$1>");
    
    // Parse thinking blocks into native AE collapsible details accordion
    result = result.replace(/&lt;thinking&gt;([\s\S]*?)&lt;\/thinking&gt;/g, (match, thoughts) => {
        return `<details class="reasoning-details"><summary>Reasoning / Rigging Plan</summary><div class="reasoning-content">${thoughts}</div></details>`;
    });
    
    return result;
}
