/**
 * ArcEditor Host ExtendScript Suite
 * Provides native After Effects scripting APIs for structural inspection,
 * visual frame rendering, and the Animator-Control-Centric timeline expressions automation suite.
 * Compatible with After Effects 2020+ (ES3 Engine).
 */

$._com_arceditor_ = $._com_arceditor_ || {};
(function(ns) {
// Custom lightweight JSON stringifier (since ExtendScript lacks native JSON)
var ArcJSON = {
    stringify: function (obj, seen) {
        seen = seen || [];
        var t = typeof (obj);
        if (obj === null || obj === undefined) return "null";
        if (t === "number" || t === "boolean") return String(obj);
        if (t === "string") {
            return '"' + obj
                .replace(/\\/g, '\\\\')
                .replace(/"/g, '\\"')
                .replace(/\n/g, '\\n')
                .replace(/\r/g, '\\r')
                .replace(/\t/g, '\\t')
                .replace(/\f/g, '\\f')
                .replace(/[\b]/g, '\\b') + '"';
        }
        if (t === "object") {
            for (var i = 0; i < seen.length; i++) {
                if (seen[i] === obj) {
                    return '"[Circular]"';
                }
            }
            seen.push(obj);

            var json = [];
            var isArr = (obj instanceof Array || (obj && obj.constructor === Array));

            if (isArr) {
                for (var j = 0; j < obj.length; j++) {
                    json.push(this.stringify(obj[j], seen));
                }
                seen.pop();
                return "[" + json.join(",") + "]";
            } else {
                for (var n in obj) {
                    if (obj.hasOwnProperty(n)) {
                        var v = obj[n];
                        var t2 = typeof (v);
                        if (t2 === "function" || t2 === "undefined") continue;

                        var val = this.stringify(v, seen);
                        json.push('"' + n.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '":' + val);
                    }
                }
                seen.pop();
                return "{" + json.join(",") + "}";
            }
        }
        return "null";
    }
};

// Map global JSON alias to ArcJSON (ExtendScript lacks native JSON)
var JSON = ArcJSON;

// Extend Layer prototype to support .effect("Effect Name") in ExtendScript scripting
if (typeof Layer !== "undefined" && !Layer.prototype.effect) {
    Layer.prototype.effect = function (name) {
        var effects = this.property("Effects") || this.property("ADBE Effect Parade");
        if (effects) return effects.property(name);
        return null;
    };
}

// --- SECTION 1: TIMELINE & COMPOSITION INSPECTOR ---
var ArcInspector = {
    /**
     * Returns the absolute path of the current active project file.
     */
    getProjectPath: function () {
        return app.project.file ? app.project.file.fsName : "Unsaved Project";
    },

    /**
     * Serializes structural details of the active composition and its layers.
     */
    getActiveCompositionData: function () {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return ArcJSON.stringify({ error: "No active composition found. Please open a composition in the timeline." });
        }

        var data = {
            id: comp.id,
            name: comp.name,
            width: comp.width,
            height: comp.height,
            duration: comp.duration,
            frameRate: comp.frameRate,
            currentTime: comp.time,
            numLayers: comp.numLayers,
            layers: []
        };

        // Retrieve all available project bin assets
        data.projectAssets = [];
        try {
            for (var p = 1; p <= app.project.numItems; p++) {
                var pItem = app.project.item(p);
                if ((pItem instanceof FootageItem || pItem instanceof CompItem) && pItem.id !== comp.id) {
                    data.projectAssets.push({
                        id: pItem.id,
                        name: pItem.name,
                        type: pItem instanceof CompItem ? "Composition" : "Footage"
                    });
                }
            }
        } catch (err) { }

        // Retrieve composition markers
        data.compMarkers = [];
        try {
            var markerProp = comp.markerProperty;
            if (markerProp && markerProp.numKeys > 0) {
                for (var m = 1; m <= markerProp.numKeys; m++) {
                    var mVal = markerProp.keyValue(m);
                    data.compMarkers.push({
                        time: Math.round(markerProp.keyTime(m) * 100) / 100,
                        comment: mVal.comment || "",
                        duration: Math.round(mVal.duration * 100) / 100,
                        label: mVal.label || 0
                    });
                }
            }
        } catch (e) { }

        // Inspect all layers
        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            var layerType = "Unknown";

            // Determine precise layer type
            if (layer instanceof TextLayer) {
                layerType = "Text";
            } else if (layer instanceof ShapeLayer) {
                layerType = "Shape";
            } else if (layer instanceof CameraLayer) {
                layerType = "Camera";
            } else if (layer instanceof LightLayer) {
                layerType = "Light";
            } else if (layer.source instanceof CompItem) {
                layerType = "Precomp";
            } else if (layer.source && layer.source instanceof FootageItem) {
                if (layer.source.mainSource instanceof FileSource) {
                    layerType = "Footage";
                } else if (layer.source.mainSource instanceof SolidSource) {
                    if (layer.nullLayer) {
                        layerType = "Null";
                    } else if (layer.adjustmentLayer) {
                        layerType = "Adjustment";
                    } else {
                        layerType = "Solid";
                    }
                }
            } else if (layer.nullLayer) {
                layerType = "Null";
            }

            // Dynamically query the layer's active blending mode string representation
            var bmName = "NORMAL";
            try {
                if (typeof layer.blendingMode !== "undefined") {
                    for (var key in BlendingMode) {
                        if (BlendingMode.hasOwnProperty(key)) {
                            if (BlendingMode[key] === layer.blendingMode) {
                                bmName = key;
                                break;
                            }
                        }
                    }
                }
            } catch (e) { }

            var layerData = {
                index: layer.index,
                id: layer.id,
                name: layer.name,
                sourceName: (layer.source && typeof layer.source.name !== "undefined") ? layer.source.name : "",
                type: layerType,
                selected: layer.selected,
                enabled: layer.enabled,
                startTime: layer.startTime,
                inPoint: layer.inPoint,
                outPoint: layer.outPoint,
                hasParent: layer.parent !== null,
                blendMode: bmName
            };

            // Retrieve layer markers
            layerData.markers = [];
            try {
                var layerMarkerProp = layer.property("Marker") || layer.property("ADBE Marker");
                if (layerMarkerProp && layerMarkerProp.numKeys > 0) {
                    for (var lm = 1; lm <= layerMarkerProp.numKeys; lm++) {
                        var lmVal = layerMarkerProp.keyValue(lm);
                        layerData.markers.push({
                            time: Math.round(layerMarkerProp.keyTime(lm) * 100) / 100,
                            comment: lmVal.comment || "",
                            duration: Math.round(lmVal.duration * 100) / 100,
                            label: lmVal.label || 0
                        });
                    }
                }
            } catch (e) { }

            // Add specific details for selected layer properties (reduces JSON payload size)
            if (layer.selected) {
                layerData.position = this.safePropertyValue(layer.property("Position"));
                layerData.scale = this.safePropertyValue(layer.property("Scale"));
                layerData.opacity = this.safePropertyValue(layer.property("Opacity"));

                if (layerType === "Text") {
                    try {
                        var textDocument = layer.property("Source Text").value;
                        layerData.textString = textDocument.text;
                        layerData.font = textDocument.font;
                        layerData.fontSize = textDocument.fontSize;

                        if (textDocument.applyFill && textDocument.fillColor) {
                            var fc = textDocument.fillColor;
                            var r = Math.round(fc[0] * 255).toString(16);
                            var g = Math.round(fc[1] * 255).toString(16);
                            var b = Math.round(fc[2] * 255).toString(16);
                            if (r.length === 1) r = "0" + r;
                            if (g.length === 1) g = "0" + g;
                            if (b.length === 1) b = "0" + b;
                            layerData.fillColor = "#" + r + g + b;
                        }

                        if (textDocument.justification === ParagraphJustification.CENTER_JUSTIFY) {
                            layerData.alignment = "center";
                        } else if (textDocument.justification === ParagraphJustification.RIGHT_JUSTIFY) {
                            layerData.alignment = "right";
                        } else {
                            layerData.alignment = "left";
                        }
                    } catch (e) { }
                }
            }

            data.layers.push(layerData);
        }

        return ArcJSON.stringify(data);
    },

    /**
     * Safely reads a property's value or expression.
     */
    safePropertyValue: function (prop) {
        if (!prop) return null;
        var info = {
            hasExpression: prop.expressionEnabled,
            expression: prop.expression
        };
        try {
            if (prop.value instanceof Array) {
                info.value = [];
                for (var i = 0; i < prop.value.length; i++) {
                    info.value.push(Math.round(prop.value[i] * 100) / 100);
                }
            } else {
                info.value = Math.round(prop.value * 100) / 100;
            }
        } catch (e) {
            info.value = "Unreadable";
        }
        return info;
    },

    /**
     * Serializes all installed effects, including built-ins and third-party plugins.
     */
    getInstalledEffects: function () {
        var list = {};
        if (typeof app.effects !== "undefined" && app.effects) {
            for (var i = 0; i < app.effects.length; i++) {
                var fx = app.effects[i];
                if (!fx) continue;
                var cat = fx.category || "Other";
                if (!list[cat]) list[cat] = [];
                list[cat].push({
                    displayName: fx.displayName,
                    matchName: fx.matchName
                });
            }
        }
        return ArcJSON.stringify(list);
    }
};

// --- SECTION 2: VISUAL CANVAS RENDERER & PNG EXPORTER ---
var ArcCanvas = {
    /**
     * Copies the current active viewer frame directly to the OS clipboard.
     */
    copyFrameToClipboard: function () {
        try {
            var cmdId = app.findMenuCommandId("Copy Frame to Clipboard");
            if (cmdId && cmdId !== 0) {
                app.executeCommand(cmdId);
                return "Success: Clipboard";
            }
            
            // Standard fallback IDs for Copy Frame in various AE builds
            var fallbackIds = [10340, 10341, 10342, 10339];
            for (var i = 0; i < fallbackIds.length; i++) {
                try {
                    app.executeCommand(fallbackIds[i]);
                    return "Success: Clipboard";
                } catch(e) {}
            }
            return "Error: Copy Frame command not found.";
        } catch (err) {
            return "Error: " + err.toString();
        }
    },

    /**
     * Saves the current frame of the active composition to a temporary PNG file.
     * 
     * @param {string} tempPath Absolute file path to save the preview PNG to.
     */
    saveCurrentFrame: function (tempPath) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return "Error: No active composition found to render.";
        }

        try {
            var file = new File(tempPath);

            // Ensure parent directory exists inside AE
            if (!file.parent.exists) {
                file.parent.create();
            }

            if (typeof comp.saveFrameToPng === "function") {
                if (file.exists) {
                    file.remove();
                }
                comp.saveFrameToPng(comp.time, file);
                return "Success: " + file.fsName;
            }
            if (typeof comp.saveFrameToPNG === "function") {
                if (file.exists) {
                    file.remove();
                }
                comp.saveFrameToPNG(comp.time, file);
                return "Success: " + file.fsName;
            }
            
            return "Error: Native saveFrameToPng is not supported in this After Effects version (AE 2020+ required).";
        } catch (err) {
            return "Error rendering frame: " + err.toString();
        }
    }
};



// --- SECTION 4: THE HIGH-LEVEL EDITING & COMPOSITING SUITE ---
var ArcEditor = {
    /**
     * Resolves a layer reference (ID, Name, Index, or Layer Object) safely.
     */
    resolveLayer: function (layerRef) {
        if (!layerRef) return null;
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition.");

        // If layerRef is already a Layer object
        if ((typeof Layer !== "undefined" && layerRef instanceof Layer) || (layerRef && typeof layerRef.index === "number")) {
            try {
                // Verify if the reference is valid by reading a simple property
                var testIndex = layerRef.index;
                return layerRef;
            } catch (invalidErr) {
                // Pointer invalidation has occurred! Let's attempt self-healing.
                try {
                    for (var sIdx = 1; sIdx <= comp.numLayers; sIdx++) {
                        var tempL = comp.layer(sIdx);
                        if (tempL && tempL.selected) {
                            return tempL; // Heuristic fallback: return the active selected layer
                        }
                    }
                    if (comp.numLayers > 0) {
                        return comp.layer(1); // Fallback to first layer
                    }
                } catch (healingErr) {}
                throw new Error("Bricked layer reference caught: Pointer invalidated due to After Effects solid/adjustment mutation. Recommendation: ALWAYS use primitive persistent values like layer.id (e.g. 24) or exact name strings instead of raw Layer object pointers.");
            }
        }

        // Normalize stringified integer IDs up-front
        if (typeof layerRef === "string") {
            var numericId = parseInt(layerRef, 10);
            if (!isNaN(numericId) && String(numericId) === layerRef) {
                layerRef = numericId;
            }
        }

        // If layerRef is a number (ID or index)
        if (typeof layerRef === "number") {
            // Check for unique persistent layer ID first
            for (var i = 1; i <= comp.numLayers; i++) {
                if (comp.layer(i).id === layerRef) {
                    return comp.layer(i);
                }
            }
            // Fallback to 1-based index
            if (layerRef > 0 && layerRef <= comp.numLayers) {
                return comp.layer(layerRef);
            }
        }

        // If layerRef is a string (exact name matching)
        if (typeof layerRef === "string") {
            var matches = [];
            for (var i = 1; i <= comp.numLayers; i++) {
                if (comp.layer(i).name === layerRef) {
                    matches.push(comp.layer(i));
                }
            }
            if (matches.length === 1) {
                return matches[0];
            } else if (matches.length > 1) {
                for (var j = 0; j < matches.length; j++) {
                    if (matches[j].selected) return matches[j];
                }
                return matches[0];
            }
        }

        throw new Error("Could not resolve layer reference: " + layerRef);
    },

    /**
     * Creates a new layer in the active composition.
     * 
     * @param {string} type Layer type: "Solid", "Text", "Shape", "Null", "Camera", "Light".
     * @param {string} name Custom name for the new layer.
     * @param {Array} size Optional [width, height] array. Defaults to comp size.
     */
    createLayer: function (type, name, size, color) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition.");

        var w = (size && size[0]) ? size[0] : comp.width;
        var h = (size && size[1]) ? size[1] : comp.height;
        var layer;

        if (type === "Null") {
            layer = comp.layers.addNull(comp.duration);
            layer.name = name;
            if (layer.source && typeof layer.source.name !== "undefined") {
                layer.source.name = name;
            }
        } else if (type === "Text") {
            layer = comp.layers.addText(name);
        } else if (type === "Shape") {
            layer = comp.layers.addShape();
            layer.name = name;
        } else if (type === "Solid") {
            var solidColor = [0.1, 0.1, 0.1];
            if (color && color.length >= 3) {
                solidColor = [Number(color[0]), Number(color[1]), Number(color[2])];
            }
            layer = comp.layers.addSolid(solidColor, name, w, h, 1.0, comp.duration);
        } else if (type === "Adjustment") {
            layer = comp.layers.addSolid([1, 1, 1], name, w, h, 1.0, comp.duration);
            var targetId = layer.id;
            layer.adjustmentLayer = true;
            // Refresh ExtendScript DOM pointer by resolving via persistent immutable unique ID (not top index 1!)
            for (var idx = 1; idx <= comp.numLayers; idx++) {
                if (comp.layer(idx).id === targetId) {
                    layer = comp.layer(idx);
                    break;
                }
            }
        } else if (type === "Camera") {
            layer = comp.layers.addCamera(name, [w / 2, h / 2]);
        } else if (type === "Light") {
            layer = comp.layers.addLight(name, [w / 2, h / 2]);
        } else {
            throw new Error("Unsupported layer type: " + type);
        }
        return layer;
    },

    /**
     * Applies a native After Effects effect to a layer and sets its name.
     */
    applyEffect: function (layerRef, effectMatchName, effectDisplayName) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition.");
        var layer = this.resolveLayer(layerRef);
        if (!layer) throw new Error("Layer not found: " + layerRef);



        var effectGroup = layer.property("Effects") || layer.property("ADBE Effect Parade");
        if (!effectGroup) throw new Error("Effects parameter not supported on this layer.");

        var fx;
        try {
            fx = effectGroup.addProperty(effectMatchName);
        } catch (err) {
            throw new Error("Failed to add effect '" + effectMatchName + "' to layer '" + layer.name + "'. This usually means the effect match name is incorrect or not installed. Please query the installed effects using the getInstalledEffects tool to find the exact match name (e.g. standard AE Glow is 'ADBE Glo2', not 'ADBE Glow'). Original error: " + err.toString());
        }

        if (effectDisplayName) {
            fx.name = effectDisplayName;
        }
        return fx;
    },

    /**
     * Resolves a property path safely on a layer (e.g. "Position" or ["Transform", "Position"]).
     */
    resolveProperty: function (layer, propPath) {
        if (!layer) throw new Error("Invalid layer parameter.");
        var prop;

        if (typeof propPath === "string" && propPath.indexOf(".") !== -1) {
            propPath = propPath.split(".");
        }

        if (typeof propPath === "string") {
            prop = layer.property(propPath);
            if (!prop) {
                // Try inside Transform group
                var transform = layer.property("Transform") || layer.property("ADBE Transform Group");
                if (transform) prop = transform.property(propPath);
            }
            if (!prop) throw new Error("Property not found: " + propPath);
        } else if (propPath instanceof Array) {
            var curr = layer;
            for (var i = 0; i < propPath.length; i++) {
                var segment = propPath[i];
                if (typeof curr.property === "undefined") {
                    var prevSeg = i > 0 ? "segment '" + propPath[i-1] + "'" : "layer root";
                    throw new Error("Property path " + prevSeg + " resolved to a leaf Property and cannot contain child property '" + segment + "'.");
                }
                var next = curr.property(segment);
                if (!next) {
                    if (segment === "Effects" || segment === "Effect") {
                        next = curr.property("ADBE Effect Parade");
                    } else if (segment === "Transform") {
                        next = curr.property("ADBE Transform Group");
                    } else if (segment === "Masks" || segment === "Mask" || segment === "Mask Parade") {
                        next = curr.property("ADBE Mask Parade");
                    } else if (segment === "Contents" || segment === "Content") {
                        next = curr.property("ADBE Root Vectors Group");
                    }
                }
                if (!next) throw new Error("Property path segment not found: " + segment);
                curr = next;
            }
            prop = curr;
        } else {
            prop = propPath; // Already a property object
        }

        // Handle Separate Dimensions spatial constraint
        if (prop && prop.matchName === "ADBE Position") {
            try {
                if (prop.dimensionsSeparated) {
                    prop.dimensionsSeparated = false;
                }
            } catch (e) { }
        }

        return prop;
    },

    /**
     * Sets value on a property at a specific time or overall.
     */
    setPropertyValue: function (layerRef, propPath, value, time) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition.");
        var layer = this.resolveLayer(layerRef);
        if (!layer) throw new Error("Layer not found: " + layerRef);

        // Intercept deep path visibility toggles (e.g. ending in "enabled")
        var pathArray = null;
        if (propPath instanceof Array) {
            pathArray = propPath;
        } else if (typeof propPath === "string" && propPath.indexOf(".") !== -1) {
            pathArray = propPath.split(".");
        }

        if (pathArray && pathArray.length > 1) {
            var lastSegment = String(pathArray[pathArray.length - 1]).toLowerCase();
            if (lastSegment === "enabled") {
                var parentPropPath = pathArray.slice(0, -1);
                var parentProp = this.resolveProperty(layer, parentPropPath);
                if (parentProp) {
                    var boolVal = (value === true || value === 1 || String(value).toLowerCase() === "true");
                    parentProp.enabled = boolVal;
                    return true;
                }
            }
        }

        // Normalize propPath to a string if it's a single-element array or basic string
        var pathStr = "";
        if (typeof propPath === "string") {
            pathStr = propPath;
        } else if (propPath instanceof Array && propPath.length === 1) {
            pathStr = propPath[0];
        }

        if (pathStr) {
            var lowerPath = pathStr.toLowerCase();
            
            // 1. Intercept Solid Color updates
            if (lowerPath === "color" || lowerPath === "solidcolor" || lowerPath === "sourcecolor") {
                if (layer.source && layer.source.mainSource && typeof layer.source.mainSource.color !== "undefined") {
                    var rgb = [Number(value[0]), Number(value[1]), Number(value[2])];
                    layer.source.mainSource.color = rgb;
                    return true;
                }
            }

            // 2. Intercept Native Layer JavaScript fields
            if (lowerPath === "name") {
                layer.name = String(value);
                return true;
            }
            if (lowerPath === "sourcename" || lowerPath === "source_name") {
                if (layer.source && typeof layer.source.name !== "undefined") {
                    layer.source.name = String(value);
                    return true;
                }
                throw new Error("Layer does not have a source to rename.");
            }
            if (lowerPath === "enabled") {
                layer.enabled = (value === true || value === 1 || String(value).toLowerCase() === "true");
                return true;
            }
            if (lowerPath === "locked") {
                layer.locked = (value === true || value === 1 || String(value).toLowerCase() === "true");
                return true;
            }
            if (lowerPath === "selected") {
                layer.selected = (value === true || value === 1 || String(value).toLowerCase() === "true");
                return true;
            }
            if (lowerPath === "inpoint" || lowerPath === "in_point") {
                layer.inPoint = Number(value);
                return true;
            }
            if (lowerPath === "outpoint" || lowerPath === "out_point") {
                layer.outPoint = Number(value);
                return true;
            }
            if (lowerPath === "starttime" || lowerPath === "start_time") {
                layer.startTime = Number(value);
                return true;
            }
            if (lowerPath === "stretch") {
                layer.stretch = Number(value);
                return true;
            }
            if (lowerPath === "comment") {
                layer.comment = String(value);
                return true;
            }
            if (lowerPath === "threedlayer" || lowerPath === "3d" || lowerPath === "threed") {
                layer.threeDLayer = (value === true || value === 1 || String(value).toLowerCase() === "true");
                return true;
            }
            if (lowerPath === "guidelayer" || lowerPath === "guide") {
                layer.guideLayer = (value === true || value === 1 || String(value).toLowerCase() === "true");
                return true;
            }
            if (lowerPath === "motionblur" || lowerPath === "blur") {
                layer.motionBlur = (value === true || value === 1 || String(value).toLowerCase() === "true");
                return true;
            }
            if (lowerPath === "adjustmentlayer" || lowerPath === "adjustment") {
                layer.adjustmentLayer = (value === true || value === 1 || String(value).toLowerCase() === "true");
                return true;
            }
            if (lowerPath === "parent") {
                if (value === null || value === "") {
                    layer.parent = null;
                } else {
                    var pLayer = this.resolveLayer(value);
                    if (pLayer) layer.parent = pLayer;
                }
                return true;
            }
            if (lowerPath === "blendmode" || lowerPath === "blend_mode") {
                this.setLayerBlendMode(layer, String(value));
                return true;
            }
        }

        // Standard timeline property fallback
        var prop = this.resolveProperty(layer, propPath);
        if (time !== undefined && time !== null) {
            prop.setValueAtTime(time, value);
        } else {
            try {
                if (prop.numKeys > 0) {
                    prop.setValueAtTime(comp.time, value);
                } else {
                    prop.setValue(value);
                }
            } catch (setValueErr) {
                prop.setValue(value);
            }
        }
        return true;
    },

    /**
     * Sets expression on a property.
     */
    setPropertyExpression: function (layerRef, propPath, expressionStr) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition.");
        var layer = this.resolveLayer(layerRef);
        var prop = this.resolveProperty(layer, propPath);

        prop.expression = expressionStr;
        prop.expressionEnabled = true;
        return true;
    },

    /**
     * Retrieves the raw expression string of a property.
     */
    getPropertyExpression: function (layerRef, propPath) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition.");
        var layer = this.resolveLayer(layerRef);
        var prop = this.resolveProperty(layer, propPath);
        return prop.expression;
    },

    /**
     * Retrieves the current value of a property.
     */
    getPropertyValue: function (layerRef, propPath) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition.");
        var layer = this.resolveLayer(layerRef);
        var prop = this.resolveProperty(layer, propPath);
        return prop.value;
    },

    /**
     * Sets multiple keyframes on a property with optional Easy Ease.
     */
    setKeyframes: function (layerRef, propPath, times, values, easeIn, easeOut) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition.");
        var layer = this.resolveLayer(layerRef);
        var prop = this.resolveProperty(layer, propPath);

        prop.setValuesAtTimes(times, values);

        // Easing curves
        if (easeIn || easeOut) {
            var dimensionality = 1;
            try {
                if (prop.value instanceof Array) {
                    dimensionality = prop.value.length;
                }
            } catch (e) { }

            var easeArray = [];
            for (var d = 0; d < dimensionality; d++) {
                easeArray.push(new KeyframeEase(0, 33.3));
            }

            for (var i = 0; i < times.length; i++) {
                try {
                    var k = prop.nearestKeyIndex(times[i]);
                    if (k > 0 && k <= prop.numKeys) {
                        prop.setTemporalEaseAtKey(k, easeArray, easeArray);
                    }
                } catch (easeErr) { }
            }
        }
        return true;
    },

    /**
     * Parents one layer to another on the timeline.
     */
    parentLayer: function (layerRef, parentLayerRef) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition.");
        var child = this.resolveLayer(layerRef);
        var parent = parentLayerRef ? this.resolveLayer(parentLayerRef) : null;
        if (!child) throw new Error("Child layer not found: " + layerRef);

        child.parent = parent;
        return true;
    },

    /**
     * Trims layer timing and start times on timeline.
     */
    trimLayer: function (layerRef, inPoint, outPoint, startTime) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition.");
        var layer = this.resolveLayer(layerRef);
        if (!layer) throw new Error("Layer not found: " + layerRef);

        if (startTime !== undefined && startTime !== null) layer.startTime = startTime;
        if (inPoint !== undefined && inPoint !== null) layer.inPoint = inPoint;
        if (outPoint !== undefined && outPoint !== null) layer.outPoint = outPoint;
        return true;
    },

    /**
     * Reorganizes the layer ordering (index) in the composition.
     * 
     * @param {string|number} layerRef Layer unique ID, name, or index to move.
     * @param {string} position Target position: "top", "bottom", "before", or "after".
     * @param {string|number} relativeToLayerRef (Optional) Reference layer if position is "before" or "after".
     */
    moveLayer: function (layerRef, position, relativeToLayerRef) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition.");
        var layer = this.resolveLayer(layerRef);
        if (!layer) throw new Error("Layer to move not found: " + layerRef);

        var cleanPos = String(position).toLowerCase();
        if (cleanPos === "top" || cleanPos === "beginning") {
            layer.moveToBeginning();
        } else if (cleanPos === "bottom" || cleanPos === "end") {
            layer.moveToEnd();
        } else if (cleanPos === "before" || cleanPos === "above") {
            if (!relativeToLayerRef) throw new Error("Missing relativeToLayerRef parameter for 'before' position.");
            var relativeLayer = this.resolveLayer(relativeToLayerRef);
            if (!relativeLayer) throw new Error("Relative reference layer not found: " + relativeToLayerRef);
            layer.moveBefore(relativeLayer);
        } else if (cleanPos === "after" || cleanPos === "below") {
            if (!relativeToLayerRef) throw new Error("Missing relativeToLayerRef parameter for 'after' position.");
            var relativeLayer = this.resolveLayer(relativeToLayerRef);
            if (!relativeLayer) throw new Error("Relative reference layer not found: " + relativeToLayerRef);
            layer.moveAfter(relativeLayer);
        } else {
            throw new Error("Invalid move position: " + position + ". Supported options: 'top', 'bottom', 'before', 'after'.");
        }
        return true;
    },

    /**
     * Precomposes a list of layer references into a precomposition.
     */
    precompose: function (layerRefs, precompName, moveAllAttributes) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition.");

        var indices = [];
        for (var i = 0; i < layerRefs.length; i++) {
            var layer = this.resolveLayer(layerRefs[i]);
            if (layer) {
                indices.push(layer.index);
            }
        }

        var newCompLayer = comp.layers.precompose(indices, precompName, moveAllAttributes !== false);
        return newCompLayer;
    },

    /**
     * Sets blend mode of a layer.
     */
    setLayerBlendMode: function (layerRef, blendModeName) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition.");
        var layer = this.resolveLayer(layerRef);
        if (!layer) throw new Error("Layer not found: " + layerRef);

        var mode = null;
        var inputClean = String(blendModeName).toUpperCase().replace(/[^A-Z0-9]/g, "");

        // Dynamically discover and match against global BlendingMode keys
        for (var key in BlendingMode) {
            if (BlendingMode.hasOwnProperty(key)) {
                var keyClean = key.toUpperCase().replace(/[^A-Z0-9]/g, "");
                if (keyClean === inputClean) {
                    mode = BlendingMode[key];
                    break;
                }
            }
        }

        if (mode === null) {
            var availableModes = [];
            for (var k in BlendingMode) {
                if (BlendingMode.hasOwnProperty(k)) {
                    availableModes.push(k);
                }
            }
            throw new Error("Unsupported or invalid layer blend mode: '" + blendModeName + "'. Supported modes on this system: " + availableModes.join(", "));
        }

        layer.blendingMode = mode;
        return true;
    },

    /**
     * Adds a marker to either the active composition or a specific layer.
     */
    addMarker: function (type, layerRef, time, comment, duration, labelIndex) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition.");

        var markerVal = new MarkerValue(comment || "");
        if (duration !== undefined && duration !== null) {
            markerVal.duration = duration;
        }
        if (labelIndex !== undefined && labelIndex !== null) {
            markerVal.label = labelIndex;
        }

        if (type && type.toLowerCase() === "comp") {
            comp.markerProperty.setValueAtTime(time, markerVal);
            return "Success: Added composition marker at " + time + "s";
        } else {
            var layer = this.resolveLayer(layerRef);
            if (!layer) throw new Error("Layer not found for marker: " + layerRef);
            var markerProp = layer.property("Marker") || layer.property("ADBE Marker");
            if (!markerProp) throw new Error("Layer does not support markers.");
            markerProp.setValueAtTime(time, markerVal);
            return "Success: Added layer marker at " + time + "s on layer '" + layer.name + "'";
        }
    },

    /**
     * Deletes a marker from the active composition or a layer by index or time.
     */
    deleteMarker: function (type, layerRef, timeOrIndex) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition.");

        var markerProp;
        if (type && type.toLowerCase() === "comp") {
            markerProp = comp.markerProperty;
        } else {
            var layer = this.resolveLayer(layerRef);
            if (!layer) throw new Error("Layer not found: " + layerRef);
            markerProp = layer.property("Marker") || layer.property("ADBE Marker");
        }

        if (!markerProp) throw new Error("Marker property not found.");

        if (typeof timeOrIndex === "number") {
            var keyIndex = -1;
            if (timeOrIndex > 0 && timeOrIndex <= markerProp.numKeys && timeOrIndex % 1 === 0) {
                keyIndex = timeOrIndex;
            } else {
                for (var i = 1; i <= markerProp.numKeys; i++) {
                    if (Math.abs(markerProp.keyTime(i) - timeOrIndex) < 0.01) {
                        keyIndex = i;
                        break;
                    }
                }
            }

            if (keyIndex !== -1) {
                markerProp.removeKey(keyIndex);
                return "Success: Deleted marker key " + keyIndex;
            }
            throw new Error("No marker found matching: " + timeOrIndex);
        } else if (typeof timeOrIndex === "string") {
            var idx = parseInt(timeOrIndex, 10);
            if (!isNaN(idx) && idx > 0 && idx <= markerProp.numKeys) {
                markerProp.removeKey(idx);
                return "Success: Deleted marker key " + idx;
            }
            throw new Error("Invalid marker index: " + timeOrIndex);
        } else {
            throw new Error("Invalid timeOrIndex parameter type.");
        }
    },

    /**
     * Sets keyframe easing with high-level presets or custom Bezier parameters.
     */
    setKeyframeEasing: function (layerRef, propPath, keyIndex, easeInPresetOrCustom, easeOutPresetOrCustom) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition.");
        var layer = this.resolveLayer(layerRef);
        var prop = this.resolveProperty(layer, propPath);

        if (!prop || !prop.numKeys || keyIndex < 1 || keyIndex > prop.numKeys) {
            throw new Error("Invalid keyframe index " + keyIndex + " on property.");
        }

        var parseEase = function (val, isOut) {
            var res = { speed: 0, influence: 33.33, isLinear: false };
            if (!val) return res;

            if (typeof val === "string") {
                var s = val.toLowerCase();
                if (s === "linear") {
                    res.isLinear = true;
                } else if (s === "easyease" || s === "easy" || s === "easyease") {
                    res.speed = 0;
                    res.influence = 33.33;
                } else if (s === "easeinquad" || s === "easein") {
                    res.speed = 0;
                    res.influence = isOut ? 33.33 : 50.0;
                } else if (s === "easeoutquad" || s === "easeout") {
                    res.speed = 0;
                    res.influence = isOut ? 50.0 : 33.33;
                } else if (s === "easeinoutquad" || s === "easeinout") {
                    res.speed = 0;
                    res.influence = 50.0;
                } else if (s === "easeincubic") {
                    res.speed = 0;
                    res.influence = isOut ? 33.33 : 66.66;
                } else if (s === "easeoutcubic") {
                    res.speed = 0;
                    res.influence = isOut ? 66.66 : 33.33;
                } else if (s === "easeinoutcubic") {
                    res.speed = 0;
                    res.influence = 66.66;
                } else if (s === "easeinexpo" || s === "easeinstrong") {
                    res.speed = 0;
                    res.influence = isOut ? 33.33 : 90.0;
                } else if (s === "easeoutexpo" || s === "easeoutstrong") {
                    res.speed = 0;
                    res.influence = isOut ? 90.0 : 33.33;
                } else if (s === "easeinoutexpo" || s === "easeinoutstrong") {
                    res.speed = 0;
                    res.influence = 90.0;
                }
            } else if (typeof val === "object") {
                if (val.speed !== undefined) res.speed = Number(val.speed);
                if (val.influence !== undefined) res.influence = Number(val.influence);
                if (val.linear === true || val.isLinear === true) res.isLinear = true;
            }
            return res;
        };

        var parsedIn = parseEase(easeInPresetOrCustom, false);
        var parsedOut = parseEase(easeOutPresetOrCustom, true);

        if (parsedIn.isLinear || parsedOut.isLinear) {
            var inType = parsedIn.isLinear ? KeyframeInterpolationType.LINEAR : KeyframeInterpolationType.BEZIER;
            var outType = parsedOut.isLinear ? KeyframeInterpolationType.LINEAR : KeyframeInterpolationType.BEZIER;
            prop.setInterpolationTypeAtKey(keyIndex, inType, outType);
            if (parsedIn.isLinear && parsedOut.isLinear) {
                return "Success: Applied linear interpolation to keyframe " + keyIndex + " on property '" + prop.name + "'";
            }
        }

        var dimensionality = 1;
        try {
            if (prop.value instanceof Array) {
                var isSpatial = false;
                try {
                    if (prop.propertyValueType === PropertyValueType.TwoD_SPATIAL ||
                        prop.propertyValueType === PropertyValueType.ThreeD_SPATIAL) {
                        isSpatial = true;
                    }
                } catch (ev) { }

                if (!isSpatial) {
                    dimensionality = prop.value.length;
                }
            }
        } catch (e) { }

        var inEaseArray = [];
        var outEaseArray = [];

        for (var d = 0; d < dimensionality; d++) {
            inEaseArray.push(new KeyframeEase(parsedIn.speed, parsedIn.influence));
            outEaseArray.push(new KeyframeEase(parsedOut.speed, parsedOut.influence));
        }

        prop.setTemporalEaseAtKey(keyIndex, inEaseArray, outEaseArray);
        return "Success: Applied easing to keyframe " + keyIndex + " on property '" + prop.name + "'";
    },

    /**
     * Sets multiple text document styling properties in a single atomic call.
     */
    setTextProperties: function (layerRef, properties) {
        if (!properties) throw new Error("No properties object provided.");

        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition.");

        var layer = this.resolveLayer(layerRef);
        if (!layer) throw new Error("Layer not found: " + layerRef);
        if (!(layer instanceof TextLayer)) throw new Error("Layer is not a TextLayer.");

        var sourceTextProp = layer.property("Source Text") || layer.property("ADBE Source Text");
        if (!sourceTextProp) throw new Error("Source Text property not found.");

        var textDocument = sourceTextProp.value;

        var hexToRgb = function (hex) {
            if (!hex) return [0, 0, 0];
            var s = hex.replace("#", "");
            if (s.length === 3) {
                s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
            }
            if (s.length !== 6) return [0, 0, 0];
            var r = parseInt(s.substring(0, 2), 16) / 255;
            var g = parseInt(s.substring(2, 4), 16) / 255;
            var b = parseInt(s.substring(4, 6), 16) / 255;
            return [Math.round(r * 100) / 100, Math.round(g * 100) / 100, Math.round(b * 100) / 100];
        };

        if (properties.text !== undefined && properties.text !== null) {
            textDocument.text = String(properties.text);
        }
        if (properties.font !== undefined && properties.font !== null) {
            textDocument.font = String(properties.font);
        }
        if (properties.fontSize !== undefined && properties.fontSize !== null) {
            textDocument.fontSize = Number(properties.fontSize);
        }
        if (properties.fillColor !== undefined && properties.fillColor !== null) {
            textDocument.fillColor = hexToRgb(properties.fillColor);
            textDocument.applyFill = true;
        }
        if (properties.strokeColor !== undefined && properties.strokeColor !== null) {
            textDocument.strokeColor = hexToRgb(properties.strokeColor);
            textDocument.applyStroke = true;
        }
        if (properties.strokeWidth !== undefined && properties.strokeWidth !== null) {
            textDocument.strokeWidth = Number(properties.strokeWidth);
        }
        if (properties.tracking !== undefined && properties.tracking !== null) {
            textDocument.tracking = Number(properties.tracking);
        }
        if (properties.leading !== undefined && properties.leading !== null) {
            textDocument.leading = Number(properties.leading);
        }
        if (properties.alignment !== undefined && properties.alignment !== null) {
            var al = String(properties.alignment).toLowerCase();
            var just = ParagraphJustification.LEFT_JUSTIFY;
            if (al === "center" || al === "center_justify") {
                just = ParagraphJustification.CENTER_JUSTIFY;
            } else if (al === "right" || al === "right_justify") {
                just = ParagraphJustification.RIGHT_JUSTIFY;
            } else if (al === "justify" || al === "full_justify") {
                just = ParagraphJustification.FULL_JUSTIFY;
            }
            textDocument.justification = just;
        }

        sourceTextProp.setValue(textDocument);
        return "Success: Applied typography properties to Text layer '" + layer.name + "'";
    },

    /**
     * Adds an existing project item (footage or precomp) to the active timeline composition as a new layer.
     */
    addAssetToTimeline: function (assetRef, properties) {
        if (!assetRef) throw new Error("No asset reference provided.");

        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            throw new Error("No active composition open.");
        }

        var projectItem = null;
        var numericId = parseInt(assetRef, 10);

        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof FootageItem || item instanceof CompItem) {
                if (!isNaN(numericId) && item.id === numericId) {
                    projectItem = item;
                    break;
                }
                if (item.name === assetRef) {
                    projectItem = item;
                    break;
                }
            }
        }

        if (!projectItem) {
            throw new Error("Project asset not found for reference: " + assetRef);
        }

        try {
            var layer = comp.layers.add(projectItem);

            var props = properties || {};
            if (props.name) {
                layer.name = props.name;
            }
            if (props.sourceName || props.source_name) {
                var sName = props.sourceName || props.source_name;
                if (layer.source && typeof layer.source.name !== "undefined") {
                    layer.source.name = String(sName);
                }
            }

            if (props.startTime !== undefined && props.startTime !== null) layer.startTime = Number(props.startTime);
            if (props.inPoint !== undefined && props.inPoint !== null) layer.inPoint = Number(props.inPoint);
            if (props.outPoint !== undefined && props.outPoint !== null) layer.outPoint = Number(props.outPoint);

            if (props.parentLayerRef) {
                var pLayer = this.resolveLayer(props.parentLayerRef);
                if (pLayer) layer.parent = pLayer;
            }

            if (props.blendMode) {
                this.setLayerBlendMode(layer, props.blendMode);
            }

            return "Success: Added project asset '" + projectItem.name + "' as layer '" + layer.name + "' at index " + layer.index;
        } catch (err) {
            throw err;
        }
    },

    /**
     * Sets the playhead position of the active composition (absolute or relative).
     */
    setPlayheadTime: function (timeVal) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return "Error: No active composition found.";
        }
        
        var targetTime = comp.time;
        if (typeof timeVal === "string") {
            var val = parseFloat(timeVal);
            if (isNaN(val)) return "Error: Invalid relative offset time format.";
            if (timeVal.charAt(0) === "+" || timeVal.charAt(0) === "-") {
                targetTime += val;
            } else {
                targetTime = val;
            }
        } else if (typeof timeVal === "number") {
            targetTime = timeVal;
        } else {
            return "Error: Invalid time parameter type.";
        }

        // Clamp within composition bounds
        targetTime = Math.max(0, Math.min(comp.duration, targetTime));
        comp.time = targetTime;
        return "Success: Playhead moved to " + targetTime.toFixed(3) + " seconds.";
    },

    /**
     * Selects multiple layers by an array of layerRefs, optionally deselecting others.
     */
    selectLayers: function (layerRefs, deselectOthers) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return "Error: No active composition found.";
        }

        if (deselectOthers !== false) {
            for (var i = 1; i <= comp.numLayers; i++) {
                comp.layer(i).selected = false;
            }
        }

        var selectedCount = 0;
        var refs = layerRefs;
        if (typeof refs === "string" || typeof refs === "number" || !(refs instanceof Array)) {
            refs = [refs];
        }

        for (var j = 0; j < refs.length; j++) {
            var layer = this.resolveLayer(refs[j]);
            if (layer) {
                layer.selected = true;
                selectedCount++;
            }
        }
        return "Success: Selected " + selectedCount + " layers.";
    },

    /**
     * Locates a composition in the project bin and opens it in the active viewer.
     */
    switchComposition: function (compRef) {
        if (!compRef) return "Error: No composition reference provided.";

        var targetComp = null;
        var numericId = parseInt(compRef, 10);

        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item && item instanceof CompItem) {
                if (!isNaN(numericId) && item.id === numericId) {
                    targetComp = item;
                    break;
                }
                if (item.name === compRef) {
                    targetComp = item;
                    break;
                }
            }
        }

        if (!targetComp) {
            return "Error: Composition not found in project bin for reference: " + compRef;
        }

        targetComp.openInViewer();
        
        // Return context data to save a ReAct turn
        var activeData = {
            id: targetComp.id,
            name: targetComp.name,
            width: targetComp.width,
            height: targetComp.height,
            duration: targetComp.duration,
            frameRate: targetComp.frameRate,
            currentTime: targetComp.time,
            numLayers: targetComp.numLayers
        };
        return "Success: Switched active composition to '" + targetComp.name + "'. Context: " + ArcJSON.stringify(activeData);
    },

    /**
     * Recursively inspects layer properties and effects, returning exact paths and matchNames.
     */
    inspectLayerProperties: function (layerRef, groupFilter) {
        var layer = this.resolveLayer(layerRef);
        if (!layer) return ArcJSON.stringify({ error: "Layer not found for reference: " + layerRef });

        var result = {
            layerName: layer.name,
            layerId: layer.id,
            properties: []
        };

        function crawl(propGroup, currentPath, depth) {
            if (depth > 4) return;
            if (!propGroup) return;

            for (var i = 1; i <= propGroup.numProperties; i++) {
                var prop = propGroup.property(i);
                if (!prop) continue;

                var newPath = currentPath.concat([prop.name]);
                var propInfo = {
                    name: prop.name,
                    matchName: prop.matchName,
                    path: newPath
                };

                if (prop.propertyType === PropertyType.PROPERTY) {
                    propInfo.type = "PROPERTY";
                    try {
                        propInfo.value = prop.value;
                    } catch (e) {
                        propInfo.value = "(unreadable)";
                    }
                    try {
                        propInfo.hasExpression = prop.expressionEnabled;
                        if (prop.expressionEnabled) {
                            propInfo.expression = prop.expression;
                        }
                    } catch (exprErr) { }
                    result.properties.push(propInfo);
                } else if (prop.propertyType === PropertyType.NAMED_GROUP || prop.propertyType === PropertyType.INDEXED_GROUP) {
                    propInfo.type = "GROUP";
                    result.properties.push(propInfo);
                    crawl(prop, newPath, depth + 1);
                }
            }
        }

        try {
            if (groupFilter) {
                // Map standard user/agent display names directly to language-independent matchNames
                var matchNameMap = {
                    "transform": "ADBE Transform Group",
                    "effects": "ADBE Effect Parade",
                    "contents": "ADBE Root Vectors Group"
                };
                var targetName = matchNameMap[String(groupFilter).toLowerCase()] || groupFilter;
                var startGroup = layer.property(targetName);
                
                if (startGroup) {
                    crawl(startGroup, [startGroup.name], 1);
                } else {
                    return ArcJSON.stringify({ error: "Property group '" + groupFilter + "' not found on layer." });
                }
            } else {
                // Default to crawling primary editing groups: Effects and Transform
                var fxGroup = layer.property("Effects") || layer.property("ADBE Effect Parade");
                if (fxGroup) crawl(fxGroup, ["Effects"], 1);
                
                var tfGroup = layer.property("Transform") || layer.property("ADBE Transform Group");
                if (tfGroup) crawl(tfGroup, ["Transform"], 1);
            }
            return ArcJSON.stringify(result);
        } catch (err) {
            return ArcJSON.stringify({ error: "Failed to crawl properties: " + err.toString() });
        }
    },

    /**
     * Sets the color of a Solid layer's source.
     * @param {string|number} layerRef Layer reference.
     * @param {Array} color [R, G, B] or [R, G, B, A] normalized color.
     */
    setSolidColor: function (layerRef, color) {
        var layer = this.resolveLayer(layerRef);
        if (!layer) throw new Error("Layer not found: " + layerRef);
        if (!layer.source || !layer.source.mainSource || typeof layer.source.mainSource.color === "undefined") {
            throw new Error("Layer '" + layer.name + "' is not a Solid layer (solids hold their color under layer.source.mainSource.color).");
        }
        var rgb = [Number(color[0]), Number(color[1]), Number(color[2])];
        layer.source.mainSource.color = rgb;
        return "Success: Set color of Solid layer '" + layer.name + "' to [" + rgb.join(", ") + "].";
    },

    /**
     * Safely deletes a layer from the composition.
     * @param {string|number} layerRef Layer reference.
     */
    deleteLayer: function (layerRef) {
        var layer = this.resolveLayer(layerRef);
        if (!layer) throw new Error("Layer not found: " + layerRef);
        var name = layer.name;
        layer.remove();
        return "Success: Deleted layer '" + name + "'";
    },

    /**
     * Converts a Hex color string (e.g. "#FF3366") to a normalized RGB array.
     */
    hexToRgb: function (hex) {
        if (!hex) return [0.8, 0.8, 0.8]; // Fallback to gray
        var s = String(hex).replace("#", "").replace(/\s/g, "");
        
        // Handle common plain-english standard color names as a premium ease-of-use fallback
        var lowerS = s.toLowerCase();
        if (lowerS === "red") return [1.0, 0.0, 0.0];
        if (lowerS === "green") return [0.0, 1.0, 0.0];
        if (lowerS === "blue") return [0.0, 0.0, 1.0];
        if (lowerS === "white") return [1.0, 1.0, 1.0];
        if (lowerS === "black") return [0.0, 0.0, 0.0];
        if (lowerS === "gray" || lowerS === "grey") return [0.5, 0.5, 0.5];
        if (lowerS === "yellow") return [1.0, 1.0, 0.0];
        if (lowerS === "cyan") return [0.0, 1.0, 1.0];
        if (lowerS === "magenta") return [1.0, 0.0, 1.0];

        if (s.length === 3) {
            s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
        }
        
        if (s.length !== 6) return [0.8, 0.8, 0.8]; // Fallback to gray

        var r = parseInt(s.substring(0, 2), 16) / 255;
        var g = parseInt(s.substring(2, 4), 16) / 255;
        var b = parseInt(s.substring(4, 6), 16) / 255;

        // Ensure parsed color channels are valid numbers (NaN safety check)
        if (isNaN(r) || isNaN(g) || isNaN(b)) {
            return [0.8, 0.8, 0.8]; // Fallback to gray if parsing results in NaN
        }

        return [Math.round(r * 100) / 100, Math.round(g * 100) / 100, Math.round(b * 100) / 100];
    },

    /**
     * Procedurally adds a styled shape group to an existing Shape Layer.
     * Enforces visual defaults (solid gray fill and thin black stroke) if styling is omitted.
     */
    addShapeToLayer: function (layerRef, shapeType, groupName, properties) {
        var layer = this.resolveLayer(layerRef);
        if (!layer) throw new Error("Layer not found for reference: " + layerRef);
        
        if (typeof ShapeLayer !== "undefined" && !(layer instanceof ShapeLayer)) {
            throw new Error("Layer '" + layer.name + "' is not a ShapeLayer. Shapes can only be added to Shape Layers.");
        }

        var props = properties || {};
        var contents = layer.property("Contents") || layer.property("ADBE Root Vectors Group");
        if (!contents) throw new Error("Could not access shape layer contents.");

        // 1. Create a Named Vector Group
        var group = contents.addProperty("ADBE Vector Group");
        group.name = groupName || "Shape Group";
        var groupContents = group.property("Contents") || group.property("ADBE Vectors Group");
        if (!groupContents) throw new Error("Could not access shape group contents.");

        // 2. Add Shape Primitive
        var shape = null;
        var typeLower = String(shapeType).toLowerCase();
        if (typeLower === "ellipse" || typeLower === "circle") {
            shape = groupContents.addProperty("ADBE Vector Shape - Ellipse");
            if (props.size) shape.property("Size").setValue(props.size);
        } else if (typeLower === "rect" || typeLower === "rectangle") {
            shape = groupContents.addProperty("ADBE Vector Shape - Rect");
            if (props.size) shape.property("Size").setValue(props.size);
        } else if (typeLower === "star" || typeLower === "polystar") {
            shape = groupContents.addProperty("ADBE Vector Shape - Star");
        } else {
            throw new Error("Unsupported shape type primitive: " + shapeType + ". Supported: Ellipse, Rectangle.");
        }

        // 3. Add Fill with high-fidelity defaults (White/light gray if unspecified)
        if (props.fillColor !== false) {
            var fill = groupContents.addProperty("ADBE Vector Graphic - Fill");
            var fillRGB = [0.8, 0.8, 0.8]; // Sensible default gray
            if (props.fillColor) {
                fillRGB = typeof props.fillColor === "string" ? this.hexToRgb(props.fillColor) : props.fillColor;
            }
            if (fill) fill.property("Color").setValue(fillRGB);
        }

        // 4. Add Stroke with default thin black outline if specified or by default
        var hasStroke = props.strokeWidth !== undefined && props.strokeWidth !== null ? (props.strokeWidth > 0) : true;
        if (hasStroke) {
            var stroke = groupContents.addProperty("ADBE Vector Graphic - Stroke");
            var strokeRGB = [0, 0, 0]; // Default black stroke
            if (props.strokeColor) {
                strokeRGB = typeof props.strokeColor === "string" ? this.hexToRgb(props.strokeColor) : props.strokeColor;
            }
            var sWidth = props.strokeWidth !== undefined && props.strokeWidth !== null ? Number(props.strokeWidth) : 2;
            if (stroke) {
                stroke.property("Color").setValue(strokeRGB);
                stroke.property("Stroke Width").setValue(sWidth);
            }
        }

        // 5. Set local position offsets if defined
        if (props.position) {
            var tf = group.property("Transform");
            if (tf) tf.property("Position").setValue(props.position);
        }

        return "Success: Added styled shape '" + (groupName || shapeType) + "' to layer '" + layer.name + "'";
    }
};

// Export to namespace
ns.ArcJSON = ArcJSON;
ns.ArcInspector = ArcInspector;
ns.ArcCanvas = ArcCanvas;
ns.ArcEditor = ArcEditor;

})($._com_arceditor_);

