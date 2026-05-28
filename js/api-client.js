/**
 * ArcEditor API Client Module
 * Manages http/https connections and abstracts provider compilation formats for cloud and local VLMs.
 */

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

        } catch (e) {
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
                    res.on('end', () => { reject(new Error(`HTTP Error ${res.statusCode}: ${errData}`)); });
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
                reject(err);
            });

            if (method !== 'GET' && postData) {
                req.write(postData);
            }
            req.end();

        } catch (e) {
            reject(e);
        }
    });
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
            parts: [{ text: SYSTEM_INSTRUCTIONS }]
        };
    }

    return payload;
}

async function callLLMApi(messages, onChunkReceived, skipSystemInstructions = false) {
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

    const headers = { "Content-Type": "application/json" };
    let payload = {};
    let targetUrl = apiUrl.replace(/\/$/, "");

    if (currentProvider === "lemonade" || currentProvider === "openai") {
        targetUrl = targetUrl.endsWith("/chat/completions") ? targetUrl : `${targetUrl}/chat/completions`;
        if (currentProvider === "openai") {
            headers["Authorization"] = `Bearer ${apiKey}`;
        }

        payload = {
            model: modelName,
            messages: skipSystemInstructions ? messages : [
                { role: "system", content: SYSTEM_INSTRUCTIONS },
                ...messages
            ],
            temperature: 0.2,
            stream: !!onChunkReceived
        };

        if (onChunkReceived) {
            payload.stream_options = { include_usage: true };
            let accumulatedText = "";
            await makeStreamingRequest(targetUrl, 'POST', headers, payload, (line) => {
                if (line.startsWith("data: ")) {
                    const dataStr = line.substring(6).trim();
                    if (dataStr === "[DONE]") return;
                    try {
                        const parsed = JSON.parse(dataStr);
                        if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) {
                            const content = parsed.choices[0].delta.content;
                            if (content) {
                                accumulatedText += content;
                                onChunkReceived(accumulatedText);
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
            return accumulatedText;
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
            return responseData.choices[0].message.content;
        }

    } else if (currentProvider === "gemini") {
        // Target Gemini generateContent API
        let endpointName = onChunkReceived ? "streamGenerateContent" : "generateContent";
        const cleanBaseUrl = apiUrl.replace(/\/$/, "");
        targetUrl = `${cleanBaseUrl}/v1beta/models/${modelName}:${endpointName}?key=${apiKey}`;
        if (onChunkReceived) {
            targetUrl += "&alt=sse"; // Request SSE format for easy parsing!
        }

        payload = prepareGeminiPayload(messages, skipSystemInstructions);
        payload.generationConfig = {
            temperature: 0.2
        };
        payload.safetySettings = [
            {
                category: "HARM_CATEGORY_HARASSMENT",
                threshold: "BLOCK_NONE"
            },
            {
                category: "HARM_CATEGORY_HATE_SPEECH",
                threshold: "BLOCK_NONE"
            },
            {
                category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                threshold: "BLOCK_NONE"
            },
            {
                category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                threshold: "BLOCK_NONE"
            }
        ];


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
                                onChunkReceived(accumulatedText);
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
            return accumulatedText;
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
            return responseData.candidates[0].content.parts[0].text;
        }

    } else if (currentProvider === "anthropic") {
        // Target Claude API
        const cleanBaseUrl = targetUrl.replace(/\/$/, "");
        targetUrl = cleanBaseUrl.endsWith("/messages") ? cleanBaseUrl : `${cleanBaseUrl}/v1/messages`;
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
            messages: anthropicMessages,
            max_tokens: 4096,
            temperature: 0.2,
            stream: !!onChunkReceived
        };
        if (!skipSystemInstructions) {
            payload.system = SYSTEM_INSTRUCTIONS;
        }

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
            return accumulatedText;
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
            return responseData.content[0].text;
        }
    }
}