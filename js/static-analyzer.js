/**
 * ArcEditor Static Security Analyzer
 * Parses ExtendScript strings and blocks dangerous identifiers, string values,
 * and built-in global objects to prevent sandbox escapes (filesystem access, shell execution, sockets).
 */

const DISALLOWED_IDENTIFIERS = new Set([
    "system", "socket", "file", "folder", "require", "process", 
    "child_process", "eval", "function", "global", "window", "$"
]);

const DISALLOWED_STRINGS = new Set([
    "system", "socket", "file", "folder", "require", "process", 
    "child_process", "eval", "function", "global", "window",
    "callsystem", "execute", "write", "open", "save"
]);

function analyzeExtendScript(code) {
    if (!code) return { safe: true };

    let index = 0;
    const length = code.length;

    while (index < length) {
        let char = code[index];

        // 1. Skip whitespace
        if (/\s/.test(char)) {
            index++;
            continue;
        }

        // 2. Skip single-line comments
        if (char === '/' && code[index + 1] === '/') {
            index += 2;
            while (index < length && code[index] !== '\n') {
                index++;
            }
            continue;
        }

        // 3. Skip multi-line comments
        if (char === '/' && code[index + 1] === '*') {
            index += 2;
            while (index < length && !(code[index] === '*' && code[index + 1] === '/')) {
                index++;
            }
            index += 2;
            continue;
        }

        // 4. String literal extraction
        if (char === '"' || char === "'" || char === '`') {
            const quote = char;
            index++;
            let stringVal = "";
            let escaped = false;
            while (index < length) {
                let sChar = code[index];
                if (escaped) {
                    stringVal += sChar;
                    escaped = false;
                } else if (sChar === '\\') {
                    escaped = true;
                } else if (sChar === quote) {
                    index++;
                    break;
                } else {
                    stringVal += sChar;
                }
                index++;
            }
            // Check string value against blocked signatures using trimmed, case-insensitive exact matching
            for (let blocked of DISALLOWED_STRINGS) {
                if (stringVal.toLowerCase().trim() === blocked) {
                    return {
                        safe: false,
                        reason: `Forbidden term "${stringVal}" detected in string literal (prevents dynamic property resolution obfuscation).`
                    };
                }
            }
            continue;
        }

        // 5. Identifier extraction
        if (/[a-zA-Z_$]/.test(char)) {
            let identifier = "";
            while (index < length && /[a-zA-Z0-9_$]/.test(code[index])) {
                identifier += code[index];
                index++;
            }
            const normalizedId = identifier.toLowerCase();
            if (DISALLOWED_IDENTIFIERS.has(normalizedId)) {
                return {
                    safe: false,
                    reason: `Forbidden identifier "${identifier}" detected in code execution path.`
                };
            }
            continue;
        }

        // 6. Non-significant characters (operators, braces, numbers)
        index++;
    }

    return { safe: true };
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { analyzeExtendScript };
} else if (typeof window !== "undefined") {
    window.analyzeExtendScript = analyzeExtendScript;
}
