/**
 * CSInterface - Standard Adobe CEP Extension Integration Bridge
 * Implements the core APIs to evaluate ExtendScript and get environment information.
 */
function CSInterface() {}

/**
 * Evaluates an ExtendScript (JSX) statement in the host application.
 * 
 * @param {string} script The ExtendScript code string to execute.
 * @param {function} callback Optional callback that receives the return value of the script execution as a string parameter.
 */
CSInterface.prototype.evalScript = function(script, callback) {
    if (typeof window.__adobe_cep__ !== "undefined") {
        window.__adobe_cep__.evalScript(script, callback || function() {});
    } else {
        console.warn("[ArcEditor Mock] CSInterface.evalScript triggered outside Adobe CEP environment.");
        console.log("JSX Code:\n", script);
        // Simulate a mock success/error response for standard tests if running in regular browser
        if (callback) {
            setTimeout(function() {
                callback("Mock Success (Not in AE)");
            }, 100);
        }
    }
};

/**
 * Returns the host application ID (e.g. "AEFT" for After Effects).
 */
CSInterface.prototype.getApplicationID = function() {
    try {
        if (typeof window.__adobe_cep__ !== "undefined") {
            var env = JSON.parse(window.__adobe_cep__.getHostEnvironment());
            return env.appId || "AEFT";
        }
    } catch(e) {
        console.error("Failed to parse host environment:", e);
    }
    return "AEFT";
};

/**
 * Returns host application environment details.
 */
CSInterface.prototype.getHostEnvironment = function() {
    if (typeof window.__adobe_cep__ !== "undefined") {
        return window.__adobe_cep__.getHostEnvironment();
    }
    return JSON.stringify({
        appId: "AEFT",
        appVersion: "17.0",
        appName: "After Effects",
        appLocale: "en_US",
        appSkinInfo: {
            appBarBackgroundColor: { color: { red: 30, green: 30, blue: 30 } }
        }
    });
};

/**
 * Returns specific system paths (e.g. local extension path, document path).
 */
CSInterface.prototype.getSystemPath = function(pathType) {
    if (typeof window.__adobe_cep__ !== "undefined") {
        return window.__adobe_cep__.getSystemPath(pathType);
    }
    // Return standard dummy paths for browsers
    if (pathType === "extension") return "./";
    return "";
};

/**
 * Closes the extension panel.
 */
CSInterface.prototype.closeExtension = function() {
    if (typeof window.__adobe_cep__ !== "undefined") {
        window.__adobe_cep__.closeExtension();
    } else {
        window.close();
    }
};
