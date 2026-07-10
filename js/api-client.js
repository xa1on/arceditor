const EXCLUDED_KEYS = {
    system: true,
    systemInstruction: true,
    safetySettings: true,
    generationConfig: true,
    temperature: true,
    model: true,
    max_tokens: true,
    stream: true,
    stream_options: true
};

function sanitizePayload(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === "string") {
        if (typeof includeBase64InDebugLog !== "undefined" && !includeBase64InDebugLog) {
            if (obj.indexOf("data:image/") === 0 && obj.indexOf(";base64,") !== -1) {
                return "data:image/png;base64,[Base64 Image Data (Omitted)]";
            }
            if (obj.length > 1000 && /^[a-zA-Z0-9+\/=\r\n_\-]+$/.test(obj.substring(0, 100))) {
                return "[Base64 Image Data (Omitted)]";
            }
        }
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(sanitizePayload);
    }
    if (typeof obj === "object") {
        const copy = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                if (EXCLUDED_KEYS[key]) continue;

                if (key === "messages" && Array.isArray(obj[key])) {
                    copy[key] = obj[key].filter(msg => msg.role !== "system").map(sanitizePayload);
                } else if (typeof includeBase64InDebugLog !== "undefined" && !includeBase64InDebugLog &&
                    (key === "data" || key === "url" || key === "image" || key === "images" || key === "base64") &&
                    typeof obj[key] === "string" && obj[key].length > 50) {
                    copy[key] = obj[key].indexOf("data:image/") === 0 ? "data:image/png;base64,[Base64 Image Data (Omitted)]" : "[Base64 Image Data (Omitted)]";
                } else {
                    copy[key] = sanitizePayload(obj[key]);
                }
            }
        }
        return copy;
    }
    return obj;
}

function sanitizeLogHeaders(headers) {
    if (!headers) return headers;
    const sanitized = { ...headers };
    const sensitive = ["authorization", "x-api-key", "api-key", "apikey"];
    for (const key in sanitized) {
        if (Object.prototype.hasOwnProperty.call(sanitized, key)) {
            if (sensitive.indexOf(key.toLowerCase()) !== -1) {
                sanitized[key] = "[Redacted]";
            }
        }
    }
    return sanitized;
}

function sanitizeLogUrl(urlStr) {
    if (!urlStr) return urlStr;
    try {
        const urlObj = new URL(urlStr);
        if (urlObj.searchParams.has("key")) {
            urlObj.searchParams.set("key", "[Redacted]");
        }
        return urlObj.toString();
    } catch (e) {
        return urlStr.replace(/([?&]key=)[^&]+/ig, "$1[Redacted]");
    }
}

let activeRequests = [];

function addActiveRequest(req) {
    activeRequests.push(req);
}

function removeActiveRequest(req) {
    const idx = activeRequests.indexOf(req);
    if (idx !== -1) {
        activeRequests.splice(idx, 1);
    }
}

function abortActiveRequests() {
    for (let i = 0; i < activeRequests.length; i++) {
        try {
            if (activeRequests[i]) {
                if (typeof activeRequests[i].abort === "function") {
                    activeRequests[i].abort();
                } else if (typeof activeRequests[i].destroy === "function") {
                    activeRequests[i].destroy();
                }
            }
        } catch (e) {
            console.error("Failed to abort/destroy request:", e);
        }
    }
    activeRequests = [];
}

function makeRequest(url, method, headers, payload) {
    return new Promise((resolve, reject) => {
        if (!httpsClient || !httpClient) {
            if (typeof fetch !== "undefined") {
                const controller = new AbortController();
                const reqHandle = { abort: () => controller.abort() };
                addActiveRequest(reqHandle);

                const fetchOptions = {
                    method: method,
                    headers: headers || {},
                    signal: controller.signal
                };
                if (method !== 'GET' && method !== 'HEAD' && payload !== undefined && payload !== null) {
                    fetchOptions.body = typeof payload === "string" ? payload : JSON.stringify(payload);
                }

                fetch(url, fetchOptions)
                    .then(response => {
                        removeActiveRequest(reqHandle);
                        if (!response.ok) {
                            response.text().then(text => {
                                reject(new Error(`HTTP Error ${response.status}: ${text}`));
                            }).catch(() => {
                                reject(new Error(`HTTP Error ${response.status}`));
                            });
                        } else {
                            response.text().then(resolve).catch(reject);
                        }
                    })
                    .catch(err => {
                        removeActiveRequest(reqHandle);
                        reject(err);
                    });
                return;
            }
            reject(new Error("Node.js network modules (https/http) not loaded and browser fetch is unavailable."));
            return;
        }

        try {
            const urlObj = new URL(url);
            const client = urlObj.protocol === 'https:' ? httpsClient : httpClient;
            const postData = typeof payload === "string" ? payload : JSON.stringify(payload);

            const reqHeaders = { ...headers };
            if (method !== 'GET' && method !== 'HEAD' && postData !== undefined && postData !== null) {
                reqHeaders['Content-Length'] = Buffer.byteLength(postData);
            }

            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: method,
                headers: reqHeaders
            };

            const req = client.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    removeActiveRequest(req);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(data);
                    } else {
                        reject(new Error(`HTTP Error ${res.statusCode}: ${data}`));
                    }
                });
            });

            req.on('error', (err) => {
                removeActiveRequest(req);
                reject(err);
            });

            addActiveRequest(req);

            if (method !== 'GET' && postData) {
                req.write(postData);
            }
            req.end();

        } catch (e) {
            reject(e);
        }
    });
}

function makeStreamingRequest(url, method, headers, payload, onChunk) {
    return new Promise((resolve, reject) => {
        if (!httpsClient && !httpClient) {
            if (typeof fetch !== "undefined") {
                const controller = new AbortController();
                const reqHandle = { abort: () => controller.abort() };
                addActiveRequest(reqHandle);

                const fetchOptions = {
                    method: method,
                    headers: headers || {},
                    signal: controller.signal
                };
                if (method !== 'GET' && method !== 'HEAD' && payload !== undefined && payload !== null) {
                    fetchOptions.body = typeof payload === "string" ? payload : JSON.stringify(payload);
                }

                fetch(url, fetchOptions)
                    .then(async (response) => {
                        removeActiveRequest(reqHandle);
                        if (!response.ok) {
                            const text = await response.text().catch(() => "");
                            reject(new Error(`HTTP Error ${response.status}: ${text}`));
                            return;
                        }

                        const reader = response.body.getReader();
                        const decoder = new TextDecoder("utf-8");
                        let buffer = "";

                        try {
                            while (true) {
                                const { done, value } = await reader.read();
                                if (done) break;

                                const textChunk = decoder.decode(value, { stream: true });
                                buffer += textChunk;

                                let eventBlocks = buffer.split(/\r?\n\r?\n/);
                                buffer = eventBlocks.pop();

                                for (let i = 0; i < eventBlocks.length; i++) {
                                    const block = eventBlocks[i].trim();
                                    if (!block) continue;

                                    const lines = block.split(/\r?\n/);
                                    for (let j = 0; j < lines.length; j++) {
                                        const line = lines[j].trim();
                                        if (!line) continue;
                                        onChunk(line);
                                    }
                                }
                            }

                            // Process remaining buffer
                            let remaining = buffer + decoder.decode();
                            if (remaining.trim()) {
                                const lines = remaining.split(/\r?\n/);
                                for (let j = 0; j < lines.length; j++) {
                                    const line = lines[j].trim();
                                    if (line) onChunk(line);
                                }
                            }
                            resolve();
                        } catch (err) {
                            reject(err);
                        }
                    })
                    .catch(err => {
                        removeActiveRequest(reqHandle);
                        reject(err);
                    });
                return;
            }
            reject(new Error("Node.js network modules (https/http) not loaded and browser fetch is unavailable."));
            return;
        }

        try {
            const urlObj = new URL(url);
            const client = urlObj.protocol === 'https:' ? httpsClient : httpClient;
            const postData = typeof payload === "string" ? payload : JSON.stringify(payload);

            const reqHeaders = { ...headers };
            if (method !== 'GET' && method !== 'HEAD' && postData !== undefined && postData !== null) {
                reqHeaders['Content-Length'] = Buffer.byteLength(postData);
            }

            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: method,
                headers: reqHeaders
            };

            const req = client.request(options, (res) => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    let errData = '';
                    res.on('data', (chunk) => { errData += chunk; });
                    res.on('end', () => {
                        removeActiveRequest(req);
                        reject(new Error(`HTTP Error ${res.statusCode}: ${errData}`));
                    });
                    return;
                }

                let buffer = '';
                let decoder = null;
                try {
                    if (typeof require !== "undefined") {
                        const { StringDecoder } = require('string_decoder');
                        decoder = new StringDecoder('utf8');
                    }
                } catch (e) { }

                res.on('data', (chunk) => {
                    const textChunk = decoder ? decoder.write(chunk) : chunk.toString();
                    buffer += textChunk;

                    let eventBlocks = buffer.split(/\r?\n\r?\n/);
                    buffer = eventBlocks.pop();

                    for (let i = 0; i < eventBlocks.length; i++) {
                        const block = eventBlocks[i].trim();
                        if (!block) continue;

                        const lines = block.split(/\r?\n/);
                        for (let j = 0; j < lines.length; j++) {
                            const line = lines[j].trim();
                            if (!line) continue;
                            onChunk(line);
                        }
                    }
                });

                res.on('end', () => {
                    removeActiveRequest(req);
                    let remaining = buffer;
                    if (decoder) {
                        remaining += decoder.end();
                    }
                    if (remaining.trim()) {
                        const lines = remaining.split(/\r?\n/);
                        for (let j = 0; j < lines.length; j++) {
                            const line = lines[j].trim();
                            if (line) onChunk(line);
                        }
                    }
                    resolve();
                });
            });

            req.on('error', (err) => {
                removeActiveRequest(req);
                reject(err);
            });

            addActiveRequest(req);

            if (method !== 'GET' && postData) {
                req.write(postData);
            }
            req.end();

        } catch (e) {
            reject(e);
        }
    });
}

function getSystemInstructionsWithPlan(includePlan = true) {
    let instructions = typeof SYSTEM_INSTRUCTIONS !== "undefined" ? SYSTEM_INSTRUCTIONS : "";
    
    // Inject active custom skills
    if (typeof skillsList !== "undefined" && typeof enabledSkills !== "undefined" && fs) {
        let skillsText = "";
        for (let i = 0; i < skillsList.length; i++) {
            const skill = skillsList[i];
            if (enabledSkills[skill.id]) {
                try {
                    const content = fs.readFileSync(skill.filePath, 'utf8');
                    skillsText += `\n---\n### SKILL: ${skill.title}\n${content}\n`;
                } catch (err) {
                    console.error(`Failed to read skill content for ${skill.id}:`, err);
                }
            }
        }
        if (skillsText) {
            instructions += `\n\n=== ACTIVE CUSTOM SKILLS & WORKFLOWS ===\nYou have access to the following custom skills and workflows. Always follow these design patterns and code structures when appropriate:\n${skillsText}\n========================================\n`;
        }
    }
    
    let catalog = "";
    if (typeof SYSTEM_TOOLS_ORDER !== "undefined" && typeof SYSTEM_TOOL_DESCRIPTIONS !== "undefined") {
        let counter = 1;
        const deniedTools = typeof getProjectDeniedTools === "function" ? getProjectDeniedTools(currentProjectPath) : [];
        
        for (let i = 0; i < SYSTEM_TOOLS_ORDER.length; i++) {
            const toolKey = SYSTEM_TOOLS_ORDER[i];
            const tool = SYSTEM_TOOL_DESCRIPTIONS[toolKey];
            if (!tool) continue;
            
            if (toolKey === "webSearch" && typeof webSearchEnabled !== "undefined" && !webSearchEnabled) {
                continue;
            }
            
            let numberPrefix = `${counter}. `;
            
            if (deniedTools.includes(toolKey)) {
                catalog += `${numberPrefix}\\\`${tool.name}\\\` (Currently disabled/blocked by project permission settings)\n\n`;
            } else {
                catalog += `${numberPrefix}\\\`${tool.name}\\\`\n${tool.text}\n`;
            }
            counter++;
        }
    }
    
    instructions = instructions.replace("[SYSTEM_TOOLS_CATALOG_PLACEHOLDER]", catalog);
    instructions = instructions.replace("[WEB_SEARCH_TOOL_PLACEHOLDER]", "");
    
    if (includePlan && typeof window !== "undefined" && window.activePlan) {
        instructions += `\n\n=== ACTIVE EXECUTION PLAN ===\nYou are currently executing the following plan. Refer to this plan to see what tasks are remaining or completed:\n${window.activePlan}\n=============================\n`;
    }
    return instructions;
}

function prepareGeminiPayload(messages, skipSystemInstructions) {
    const chatParts = [];

    messages.forEach(m => {
        if (m.role === "system") {
            // Transform system messages to user role with "[System Log]: " prefix
            let textContent = "";
            if (typeof m.content === "string") {
                textContent = m.content;
            } else if (Array.isArray(m.content)) {
                textContent = m.content.map(c => c.type === "text" ? c.text : "").join(" ");
            }
            chatParts.push({
                role: "user",
                parts: [{ text: `[System Log]: ${textContent}` }]
            });
        } else {
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
            chatParts.push({
                role: m.role === "user" ? "user" : "model",
                parts: parts
            });
        }
    });

    // 1. Merge consecutive messages with the same role sequentially in chronological order
    const contents = [];
    chatParts.forEach(msg => {
        if (contents.length > 0 && contents[contents.length - 1].role === msg.role) {
            contents[contents.length - 1].parts.push(...msg.parts);
        } else {
            contents.push(msg);
        }
    });

    // 2. Ensure the first message has the "user" role
    if (contents.length > 0 && contents[0].role === "model") {
        contents.unshift({
            role: "user",
            parts: [{ text: "[System State: Continuing session]" }]
        });
    }

    // 3. Ensure contents is not empty
    if (contents.length === 0) {
        contents.push({
            role: "user",
            parts: [{ text: "Hello" }]
        });
    }

    // 4. Build the base payload structure
    const payload = {
        contents: contents
    };

    if (!skipSystemInstructions) {
        payload.systemInstruction = {
            parts: [{ text: getSystemInstructionsWithPlan(false) }]
        };
    }

    return payload;
}

function checkModelSupportsNativeReasoning(provider, model) {
    if (!model) return false;
    const lowerModel = model.toLowerCase();
    if (provider === "anthropic") {
        return (claudeThinkingBudget > 0 && lowerModel.indexOf("3-7") !== -1);
    }
    if (provider === "openai") {
        return (lowerModel.indexOf("o1") !== -1 || lowerModel.indexOf("o3-mini") !== -1);
    }
    if (provider === "lemonade") {
        return (lowerModel.indexOf("r1") !== -1 || lowerModel.indexOf("reasoning") !== -1 || lowerModel.indexOf("thinking") !== -1);
    }
    return false;
}

async function callLLMApi(messages, onChunkReceived, skipSystemInstructions = false) {
    const modelSupportsNativeReasoning = checkModelSupportsNativeReasoning(currentProvider, modelName);

    if (!httpsClient && !httpClient) {
        // Fallback mock mode ONLY inside standalone browsers
        return new Promise((resolve) => {
            setTimeout(() => {
                const text = `Based on your request, I will create a Scale bounce control slider rig to automate the bounce scaling.

Here is the ExtendScript to build it:

\`\`\`javascript
(function() {
    var layer = ArcEditor.resolveLayer(1);
    var rig = ArcEditor.createLayer("Null", "Bounce Rig");
    ArcEditor.applyEffect(rig, "ADBE Slider Control", "Bounce Elasticity");
    ArcEditor.setPropertyValue(rig, ["Effects", "Bounce Elasticity", "Slider"], 15);
    ArcEditor.setPropertyExpression(layer, "Scale", "var f = thisComp.layer('Bounce Rig Controls').effect('Bounce Elasticity')('Slider'); [100 + Math.sin(time * f) * 10, 100 + Math.sin(time * f) * 10]");
    return "Success";
})();
\`\`\`
`;
                if (onChunkReceived) {
                    let chars = text.split("");
                    let i = 0;
                    let interval = setInterval(() => {
                        if (i < chars.length) {
                            onChunkReceived(chars.slice(0, i + 1).join(""));
                            i += 5; // Stream fast in mockup
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

    let headers = { "Content-Type": "application/json" };
    let payload = {};
    let targetUrl = apiUrl.replace(/\/$/, "");

    try {
        // Deep clone and clean past assistant reasoning blocks
        const cleanedMessages = messages.map(m => {
            const copy = { ...m };
            if (copy.role === "assistant" && copy.reasoning) {
                copy.content = `<thinking>\n${copy.reasoning}\n</thinking>\n\n${copy.content}`;
                delete copy.reasoning;
            }
            delete copy.isIntermediate;
            delete copy.intermediateTurns;
            return copy;
        });

        // Append the active plan to the very last user message to optimize prefix caching
        if (typeof window !== "undefined" && window.activePlan && cleanedMessages.length > 0) {
            let lastUserMsgIdx = -1;
            for (let i = cleanedMessages.length - 1; i >= 0; i--) {
                if (cleanedMessages[i].role === "user") {
                    lastUserMsgIdx = i;
                    break;
                }
            }
            if (lastUserMsgIdx !== -1) {
                const lastMsg = cleanedMessages[lastUserMsgIdx];
                const planSection = `\n\n=== ACTIVE EXECUTION PLAN ===\nYou are currently executing the following plan. Refer to this plan to see what tasks are remaining or completed:\n${window.activePlan}\n=============================\n`;
                
                if (typeof lastMsg.content === "string") {
                    lastMsg.content += planSection;
                } else if (Array.isArray(lastMsg.content)) {
                    const textPart = lastMsg.content.find(p => p.type === "text");
                    if (textPart) {
                        textPart.text += planSection;
                    } else {
                        lastMsg.content.push({ type: "text", text: planSection });
                    }
                }
            }
        }

        if (currentProvider === "lemonade" || currentProvider === "openai") {
            // Target OpenAI chat completions endpoint
            const cleanBaseUrl = targetUrl.replace(/\/$/, "");
            targetUrl = cleanBaseUrl.endsWith("/chat/completions") ? cleanBaseUrl : (cleanBaseUrl.endsWith("/v1") ? `${cleanBaseUrl}/chat/completions` : `${cleanBaseUrl}/v1/chat/completions`);
            if (apiKey) {
                headers["Authorization"] = `Bearer ${apiKey}`;
            }

            payload = {
                model: modelName,
                messages: skipSystemInstructions ? cleanedMessages : [
                    { role: "system", content: getSystemInstructionsWithPlan(false) },
                    ...cleanedMessages
                ],
                stream: !!onChunkReceived
            };

            if (modelSupportsNativeReasoning) {
                payload.max_completion_tokens = 8192;
                if (currentProvider === "openai" && typeof openaiReasoningEffort !== "undefined" && openaiReasoningEffort) {
                    payload.reasoning_effort = openaiReasoningEffort;
                }
            } else {
                payload.temperature = 0.2;
            }

            if (typeof writeToDebugLog === "function") {
                writeToDebugLog("API Request Sent (OpenAI/Lemonade)", JSON.stringify({
                    provider: currentProvider,
                    url: targetUrl,
                    headers: { ...headers, "Authorization": headers["Authorization"] ? "Bearer [Omitted]" : undefined },
                    payload: sanitizePayload(payload)
                }, null, 2));
            }

            if (onChunkReceived) {
                payload.stream_options = { include_usage: true };
                let accumulatedText = "";
                let isThinkingOpen = false;
                let isThinkingClosed = false;

                await makeStreamingRequest(targetUrl, 'POST', headers, payload, (line) => {
                    if (line.startsWith("data: ")) {
                        const dataStr = line.substring(6).trim();
                        if (dataStr === "[DONE]") return;
                        try {
                            const parsed = JSON.parse(dataStr);
                            if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) {
                                const delta = parsed.choices[0].delta;
                                const content = delta.content;
                                const reasoning = delta.reasoning_content;

                                if (reasoning) {
                                    if (!isThinkingOpen) {
                                        accumulatedText = "<thinking>\n" + reasoning;
                                        isThinkingOpen = true;
                                    } else {
                                        accumulatedText += reasoning;
                                    }
                                    onChunkReceived(normalizeResponse(accumulatedText));
                                } else if (content) {
                                    if (isThinkingOpen && !isThinkingClosed) {
                                        accumulatedText += "\n</thinking>\n\n" + content;
                                        isThinkingClosed = true;
                                    } else {
                                        accumulatedText += content;
                                    }
                                    onChunkReceived(normalizeResponse(accumulatedText));
                                }
                            }
                            if (parsed.usage) {
                                lastApiUsage = {
                                    promptTokens: parsed.usage.prompt_tokens,
                                    completionTokens: parsed.usage.completion_tokens,
                                    totalTokens: parsed.usage.total_tokens
                                };
                            }
                        } catch (e) { }
                    }
                });

                if (isThinkingOpen && !isThinkingClosed) {
                    accumulatedText += "\n</thinking>\n\n";
                    isThinkingClosed = true;
                    onChunkReceived(normalizeResponse(accumulatedText));
                }

                if (typeof writeToDebugLog === "function") {
                    writeToDebugLog("API Response Received (OpenAI/Lemonade Stream Finished)", normalizeResponse(accumulatedText));
                }
                return normalizeResponse(accumulatedText);
            } else {
                const responseText = await makeRequest(targetUrl, 'POST', headers, payload);
                const responseData = JSON.parse(responseText);
                if (responseData.usage) {
                    lastApiUsage = {
                        promptTokens: responseData.usage.prompt_tokens,
                        completionTokens: responseData.usage.completion_tokens,
                        totalTokens: responseData.usage.total_tokens
                    };
                }
                const msgObj = responseData.choices && responseData.choices[0] && responseData.choices[0].message ? responseData.choices[0].message : null;
                let content = msgObj ? msgObj.content : "";
                const reasoning = msgObj ? msgObj.reasoning_content : null;
                if (reasoning) {
                    content = `<thinking>\n${reasoning}\n</thinking>\n\n${content}`;
                }
                content = normalizeResponse(content);
                if (typeof writeToDebugLog === "function") {
                    writeToDebugLog("API Response Received (OpenAI/Lemonade)", content);
                }
                return content;
            }

        } else if (currentProvider === "gemini") {
            // Target Gemini generateContent API
            let endpointName = onChunkReceived ? "streamGenerateContent" : "generateContent";
            const cleanBaseUrl = apiUrl.replace(/\/$/, "");
            targetUrl = `${cleanBaseUrl}/v1beta/models/${modelName}:${endpointName}?key=${apiKey}`;
            if (onChunkReceived) {
                targetUrl += "&alt=sse"; // Request SSE format for easy parsing!
            }

            payload = prepareGeminiPayload(cleanedMessages, skipSystemInstructions);
            payload.generationConfig = {
                temperature: 0.2
            };
            payload.safetySettings = [
                {
                    category: "HARM_CATEGORY_HARASSMENT",
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                },
                {
                    category: "HARM_CATEGORY_HATE_SPEECH",
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                },
                {
                    category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                },
                {
                    category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                }
            ];

            if (typeof writeToDebugLog === "function") {
                writeToDebugLog("API Request Sent (Gemini)", JSON.stringify({
                    provider: currentProvider,
                    url: targetUrl.replace(/\?key=.*$/, "?key=[Omitted]"),
                    headers: headers,
                    payload: sanitizePayload(payload)
                }, null, 2));
            }


            if (onChunkReceived) {
                let accumulatedText = "";
                await makeStreamingRequest(targetUrl, 'POST', headers, payload, (line) => {
                    if (line.startsWith("data: ")) {
                        const dataStr = line.substring(6).trim();
                        try {
                            const parsed = JSON.parse(dataStr);
                            if (parsed.candidates && parsed.candidates[0] && parsed.candidates[0].content && parsed.candidates[0].content.parts && parsed.candidates[0].content.parts[0]) {
                                const text = parsed.candidates[0].content.parts[0].text;
                                if (text) {
                                    accumulatedText += text;
                                    onChunkReceived(normalizeResponse(accumulatedText));
                                }
                            }
                            if (parsed.usageMetadata) {
                                lastApiUsage = {
                                    promptTokens: parsed.usageMetadata.promptTokenCount,
                                    completionTokens: parsed.usageMetadata.candidatesTokenCount,
                                    totalTokens: parsed.usageMetadata.totalTokenCount
                                };
                            }
                        } catch (e) { }
                    }
                });
                if (typeof writeToDebugLog === "function") {
                    writeToDebugLog("API Response Received (Gemini Stream Finished)", normalizeResponse(accumulatedText));
                }
                return normalizeResponse(accumulatedText);
            } else {
                const responseText = await makeRequest(targetUrl, 'POST', headers, payload);
                const responseData = JSON.parse(responseText);
                if (responseData.usageMetadata) {
                    lastApiUsage = {
                        promptTokens: responseData.usageMetadata.promptTokenCount,
                        completionTokens: responseData.usageMetadata.candidatesTokenCount,
                        totalTokens: responseData.usageMetadata.totalTokenCount
                    };
                }
                let content = responseData.candidates && responseData.candidates[0] && responseData.candidates[0].content && responseData.candidates[0].content.parts && responseData.candidates[0].content.parts[0] ? responseData.candidates[0].content.parts[0].text : "";
                content = normalizeResponse(content);
                if (typeof writeToDebugLog === "function") {
                    writeToDebugLog("API Response Received (Gemini)", content);
                }
                return content;
            }

        } else if (currentProvider === "anthropic") {
            // Target Claude API
            const cleanBaseUrl = targetUrl.replace(/\/$/, "");
            targetUrl = cleanBaseUrl.endsWith("/messages") ? cleanBaseUrl : `${cleanBaseUrl}/v1/messages`;
            headers["x-api-key"] = apiKey;
            headers["anthropic-version"] = "2023-06-01";

            // Convert vision base64 input to Anthropic's block format
            const anthropicMessages = cleanedMessages.map(m => {
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
                messages: anthropicMessages,
                stream: !!onChunkReceived
            };

            if (modelSupportsNativeReasoning) {
                payload.thinking = {
                    type: "enabled",
                    budget_tokens: claudeThinkingBudget
                };
                payload.max_tokens = Math.max(claudeThinkingBudget + 2048, 4096);
            } else {
                payload.max_tokens = 4096;
                payload.temperature = 0.2;
            }

            if (!skipSystemInstructions) {
                payload.system = getSystemInstructionsWithPlan(false);
            }

            if (typeof writeToDebugLog === "function") {
                writeToDebugLog("API Request Sent (Anthropic)", JSON.stringify({
                    provider: currentProvider,
                    url: targetUrl,
                    headers: { ...headers, "x-api-key": "[Omitted]" },
                    payload: sanitizePayload(payload)
                }, null, 2));
            }

            if (onChunkReceived) {
                let accumulatedText = "";
                let isThinkingOpen = false;
                let isThinkingClosed = false;

                await makeStreamingRequest(targetUrl, 'POST', headers, payload, (line) => {
                    if (line.startsWith("data: ")) {
                        const dataStr = line.substring(6).trim();
                        try {
                            const parsed = JSON.parse(dataStr);
                            if (parsed.type === "content_block_delta" && parsed.delta) {
                                const delta = parsed.delta;
                                if (delta.type === "thinking_delta" && delta.thinking) {
                                    if (!isThinkingOpen) {
                                        accumulatedText = "<thinking>\n" + delta.thinking;
                                        isThinkingOpen = true;
                                    } else {
                                        accumulatedText += delta.thinking;
                                    }
                                    onChunkReceived(normalizeResponse(accumulatedText));
                                } else if (delta.type === "text_delta" && delta.text) {
                                    if (isThinkingOpen && !isThinkingClosed) {
                                        accumulatedText += "\n</thinking>\n\n" + delta.text;
                                        isThinkingClosed = true;
                                    } else {
                                        accumulatedText += delta.text;
                                    }
                                    onChunkReceived(normalizeResponse(accumulatedText));
                                } else if (delta.text) {
                                    accumulatedText += delta.text;
                                    onChunkReceived(normalizeResponse(accumulatedText));
                                }
                            } else if (parsed.type === "content_block_delta" && parsed.delta && parsed.delta.text) {
                                accumulatedText += parsed.delta.text;
                                onChunkReceived(normalizeResponse(accumulatedText));
                            }

                            if (parsed.type === "message_start" && parsed.message && parsed.message.usage) {
                                lastApiUsage = {
                                    promptTokens: parsed.message.usage.input_tokens || 0,
                                    completionTokens: parsed.message.usage.output_tokens || 0,
                                    totalTokens: (parsed.message.usage.input_tokens || 0) + (parsed.message.usage.output_tokens || 0)
                                };
                            } else if (parsed.type === "message_delta" && parsed.usage) {
                                if (lastApiUsage) {
                                    lastApiUsage.completionTokens = parsed.usage.output_tokens || 0;
                                    lastApiUsage.totalTokens = lastApiUsage.promptTokens + lastApiUsage.completionTokens;
                                }
                            }
                        } catch (e) { }
                    }
                });

                if (isThinkingOpen && !isThinkingClosed) {
                    accumulatedText += "\n</thinking>\n\n";
                    isThinkingClosed = true;
                    onChunkReceived(normalizeResponse(accumulatedText));
                }

                if (typeof writeToDebugLog === "function") {
                    writeToDebugLog("API Response Received (Anthropic Stream Finished)", normalizeResponse(accumulatedText));
                }
                return normalizeResponse(accumulatedText);
            } else {
                const responseText = await makeRequest(targetUrl, 'POST', headers, payload);
                const responseData = JSON.parse(responseText);
                if (responseData.usage) {
                    lastApiUsage = {
                        promptTokens: responseData.usage.input_tokens || 0,
                        completionTokens: responseData.usage.output_tokens || 0,
                        totalTokens: (responseData.usage.input_tokens || 0) + (responseData.usage.output_tokens || 0)
                    };
                }

                let content = "";
                if (responseData.content && Array.isArray(responseData.content)) {
                    let reasoningText = "";
                    let textContent = "";
                    responseData.content.forEach(c => {
                        if (c.type === "thinking" && c.thinking) {
                            reasoningText += c.thinking;
                        } else if (c.type === "text" && c.text) {
                            textContent += c.text;
                        }
                    });
                    if (reasoningText) {
                        content = `<thinking>\n${reasoningText}\n</thinking>\n\n${textContent}`;
                    } else {
                        content = textContent;
                    }
                } else if (responseData.content && responseData.content[0]) {
                    content = responseData.content[0].text || "";
                }

                content = normalizeResponse(content);
                if (typeof writeToDebugLog === "function") {
                    writeToDebugLog("API Response Received (Anthropic)", content);
                }
                return content;
            }
        }
    } catch (err) {
        if (typeof writeToDebugLog === "function") {
            const sanitizedUrl = sanitizeLogUrl(targetUrl);
            const sanitizedHeaders = sanitizeLogHeaders(headers);
            writeToDebugLog("API Network Error", JSON.stringify({
                provider: currentProvider,
                url: sanitizedUrl,
                method: "POST",
                headers: sanitizedHeaders,
                error: err.message || String(err)
            }, null, 2));
        }
        throw err;
    }
}

async function searchWeb(query) {
    const debugTextarea = document.getElementById("debug-output");
    const timestamp = new Date().toISOString();
    if (debugTextarea) {
        debugTextarea.value += `\n[${timestamp}] [DEBUG] Executing Web Search for: "${query}"\n`;
        debugTextarea.scrollTop = debugTextarea.scrollHeight;
    }

    try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        };
        const html = await makeRequest(url, 'GET', headers, null);
        
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        
        const results = [];
        const resultElements = doc.querySelectorAll(".result");
        
        for (let i = 0; i < resultElements.length && results.length < 5; i++) {
            const el = resultElements[i];
            const titleEl = el.querySelector(".result__title a");
            const snippetEl = el.querySelector(".result__snippet");
            
            if (titleEl) {
                const title = titleEl.textContent.trim();
                const rawUrl = titleEl.getAttribute("href");
                let cleanUrl = rawUrl;
                
                if (rawUrl) {
                    let absoluteUrl = rawUrl;
                    if (rawUrl.startsWith("//")) {
                        absoluteUrl = "https:" + rawUrl;
                    } else if (rawUrl.startsWith("/")) {
                        absoluteUrl = "https://html.duckduckgo.com" + rawUrl;
                    }
                    
                    if (absoluteUrl.includes("uddg=")) {
                        try {
                            const uddgParam = new URL(absoluteUrl).searchParams.get("uddg");
                            if (uddgParam) {
                                cleanUrl = uddgParam;
                            }
                        } catch (e) { }
                    } else {
                        cleanUrl = absoluteUrl;
                    }
                }
                
                const snippet = snippetEl ? snippetEl.textContent.trim() : "";
                results.push({
                    title: title,
                    url: cleanUrl,
                    snippet: snippet
                });
            }
        }
        
        if (results.length === 0) {
            if (html.includes("ddg-captcha") || html.includes("robot") || html.includes("captcha")) {
                return { error: "Search page returned a CAPTCHA challenge. Scraper blocked." };
            }
            return { error: "No search results found. DuckDuckGo may have changed structure or rate-limited the client." };
        }
        
        return results;
    } catch (err) {
        console.error("Web search failed:", err);
        return { error: `Web search request failed: ${err.message || err}` };
    }
}
if (typeof window !== "undefined") window.searchWeb = searchWeb;

function normalizeResponse(text) {
    if (!text) return "";
    
    // 1. Normalize antThinking to standard thinking
    let normalized = text
        .replace(/<antThinking>/g, "<thinking>")
        .replace(/<\/antThinking>/g, "</thinking>");
        
    // 2. Normalize XML function calls to JSON code blocks
    if (normalized.indexOf("<function_calls>") !== -1) {
        const startIdx = normalized.indexOf("<function_calls>");
        const endIdx = normalized.indexOf("</function_calls>", startIdx);
        
        const beforeCalls = normalized.substring(0, startIdx);
        let callsContent = "";
        let afterCalls = "";
        
        if (endIdx !== -1) {
            callsContent = normalized.substring(startIdx + "<function_calls>".length, endIdx);
            afterCalls = normalized.substring(endIdx + "</function_calls>".length);
        } else {
            callsContent = normalized.substring(startIdx + "<function_calls>".length);
        }
        
        const toolCalls = [];
        const invokeRegex = /<(invoke_name|invoke\s+name)\s*=\s*["']([^"']+)["']\s*>/g;
        let invokeMatch;
        let lastInvokeEnd = 0;
        
        while ((invokeMatch = invokeRegex.exec(callsContent)) !== null) {
            const toolName = invokeMatch[2];
            const invokeStart = invokeMatch.index + invokeMatch[0].length;
            
            let invokeEnd = callsContent.indexOf("</invoke>", invokeStart);
            if (invokeEnd === -1) {
                invokeEnd = callsContent.indexOf("</invoke_name>", invokeStart);
            }
            let isUnclosed = false;
            if (invokeEnd === -1) {
                invokeEnd = callsContent.length;
                isUnclosed = true;
            }
            
            const invokeContent = callsContent.substring(invokeStart, invokeEnd);
            const parameters = {};
            
            const paramRegex = /<(parameter_name|parameter\s+name)\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)(?:<\/(?:parameter_name|parameter)>|$)/g;
            let paramMatch;
            while ((paramMatch = paramRegex.exec(invokeContent)) !== null) {
                const paramName = paramMatch[2];
                const paramValue = paramMatch[3];
                parameters[paramName] = paramValue;
            }
            
            toolCalls.push({
                tool: toolName,
                parameters: parameters
            });
            
            let closeTagLen = 0;
            if (!isUnclosed) {
                closeTagLen = callsContent.indexOf("</invoke_name>", invokeStart) === invokeEnd ? "</invoke_name>".length : "</invoke>".length;
            }
            lastInvokeEnd = invokeEnd + closeTagLen;
        }
        
        if (toolCalls.length > 0) {
            const jsonStr = JSON.stringify(toolCalls.length === 1 ? toolCalls[0] : toolCalls, null, 2);
            const jsonBlock = `\n\`\`\`json\n${jsonStr}\n\`\`\`\n`;
            
            let remainingText = callsContent.substring(lastInvokeEnd).trim();
            remainingText = remainingText.replace(/<\/?[^>]*>?/g, "");
            if (remainingText) {
                normalized = beforeCalls + jsonBlock + "\n" + remainingText + afterCalls;
            } else {
                normalized = beforeCalls + jsonBlock + afterCalls;
            }
        }
    }
    
    return normalized;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports.normalizeResponse = normalizeResponse;
    module.exports.sanitizeLogHeaders = sanitizeLogHeaders;
    module.exports.sanitizeLogUrl = sanitizeLogUrl;
}