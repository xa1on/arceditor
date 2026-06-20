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

    // Clean up any duplicate or stray closing tags at the very start of content
    if (content) {
        const trimmed = content.trim();
        if (trimmed.indexOf(closeTag) === 0) {
            const index = content.indexOf(closeTag);
            content = content.substring(0, index).trimEnd() + "\n\n" + content.substring(index + closeTag.length).trimStart();
        }
    }

    return { reasoning, content };
}

// Export for Node/CommonJS environments if active, otherwise keep global
if (typeof module !== "undefined" && module.exports) {
    module.exports = { parseStreamingReasoning };
}

