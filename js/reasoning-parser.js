/**
 * ArcEditor Reasoning Parser Module
 * Handles separating <thinking> blocks from raw text/streams.
 */

function parseStreamingReasoning(text) {
    let reasoning = "";
    let content = "";
    const openTag = "<thinking>";
    const closeTag = "</thinking>";
    
    if (!text) return { reasoning, content };

    const openIndex = text.indexOf(openTag);
    if (openIndex !== -1) {
        const closeIndex = text.indexOf(closeTag);
        if (closeIndex !== -1) {
            // Closed thinking block
            reasoning = text.substring(openIndex + openTag.length, closeIndex).trim();
            content = text.substring(0, openIndex) + text.substring(closeIndex + closeTag.length);
        } else {
            // Open/active thinking block
            reasoning = text.substring(openIndex + openTag.length);
            content = text.substring(0, openIndex);
        }
    } else {
        content = text;
    }
    return { reasoning, content };
}

// Export for Node/CommonJS environments if active, otherwise keep global
if (typeof module !== "undefined" && module.exports) {
    module.exports = { parseStreamingReasoning };
}
