/**
 * ArcEditor Host ExtendScript Suite
 * Provides native After Effects scripting APIs for structural inspection,
 * visual frame rendering, and the Animator-Control-Centric timeline expressions automation suite.
 * Compatible with After Effects 2020+ (ES3 Engine).
 */

// Custom lightweight JSON stringifier (since ExtendScript lacks native JSON)
var ArcJSON = {
    stringify: function (obj) {
        var t = typeof (obj);
        if (obj === null || obj === undefined) return "null";
        if (t === "string") {
            return '"' + obj.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
        }
        if (t === "number" || t === "boolean") return String(obj);

        var json = [];
        var isArr = (obj instanceof Array || (obj && obj.constructor === Array));

        for (var n in obj) {
            if (obj.hasOwnProperty(n)) {
                var v = obj[n];
                var t2 = typeof (v);
                if (t2 === "function" || t2 === "undefined") continue;

                var val = this.stringify(v);
                json.push((isArr ? "" : '"' + n + '":') + val);
            }
        }
        return (isArr ? "[" : "{") + json.join(",") + (isArr ? "]" : "}");
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

            var layerData = {
                index: layer.index,
                id: layer.id,
                name: layer.name,
                type: layerType,
                selected: layer.selected,
                enabled: layer.enabled,
                startTime: layer.startTime,
                inPoint: layer.inPoint,
                outPoint: layer.outPoint,
                hasParent: layer.parent !== null
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
                        layerData.textString = layer.property("Source Text").value.text;
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

            var saveFn = comp.saveFrameToPng || comp.saveFrameToPNG;
            if (typeof saveFn === "function") {
                saveFn.call(comp, comp.time, file);

                if (file.exists) {
                    return "Success: " + file.fsName;
                } else {
                    // Direct save failed or silent skip, try Render Queue
                    return this.renderQueueFallback(comp, file);
                }
            } else {
                return this.renderQueueFallback(comp, file);
            }
        } catch (err) {
            return "Error rendering frame: " + err.toString();
        }
    },

    /**
     * Fallback frame exporter utilizing Render Queue (100% universal across all AE versions)
     */
    renderQueueFallback: function (comp, file) {
        var rq = app.project.renderQueue;
        var item = rq.items.add(comp);
        item.timeSpanStart = comp.time;
        item.timeSpanDuration = comp.frameDuration;

        var om = item.outputModule(1);
        try {
            om.applyTemplate("PNG Sequence");
        } catch (e) {
            try {
                om.applyTemplate("Lossless");
            } catch (e2) { }
        }
        om.file = file;

        rq.render();
        item.remove(); // Clean up Render Queue item

        if (file.exists) {
            return "Success: " + file.fsName;
        }

        // Suffix check: Render Queue often appends frame number suffixes (e.g. arc_preview_00000.png)
        var dir = file.parent;
        var baseName = file.name.substring(0, file.name.lastIndexOf("."));
        var ext = file.name.substring(file.name.lastIndexOf("."));

        var matchFiles = dir.getFiles(baseName + "*" + ext);
        if (matchFiles && matchFiles.length > 0) {
            return "Success: " + matchFiles[0].fsName;
        }

        return "Error: Render Queue completed but file could not be found on disk.";
    }
};

// --- SECTION 3: ANIMATOR-CONTROL-CENTRIC TIMELINE EXPRESSION SUITE ---
var ArcRigger = {
    /**
     * Creates a slider controller layer and applies an expression linking to it.
     * 
     * @param {number} layerIndex Target layer index inside the active composition.
     * @param {string} propertyName Name of the property (e.g. "Position", "Scale").
     * @param {string} rigName Name prefix for the control rig Null Layer.
     * @param {string} controlName Name of the specific slider control (e.g. "Frequency").
     * @param {number} defaultValue Initial value for the slider control.
     * @param {string} expressionTemplate Expression string to write on the target property.
     */
    createSliderRig: function (layerRef, propertyName, rigName, controlName, defaultValue, expressionTemplate) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return "Error: Active composition not found.";
        }

        app.beginUndoGroup("ArcEditor Edit: " + rigName);
        try {
            var targetLayer = ArcEditor.resolveLayer(layerRef);
            if (!targetLayer) {
                app.endUndoGroup();
                return "Error: Target layer " + layerRef + " not found.";
            }

            // 1. Locate or create the Null Control Layer
            var controlLayerName = rigName + " Controls";
            var controlLayer = null;
            for (var i = 1; i <= comp.numLayers; i++) {
                if (comp.layer(i).name === controlLayerName) {
                    controlLayer = comp.layer(i);
                    break;
                }
            }

            if (!controlLayer) {
                controlLayer = comp.layers.addNull();
                controlLayer.name = controlLayerName;
                controlLayer.label = 9; // Green color tag for high visibility
            }

            // Move control layer to the top of the timeline
            controlLayer.moveToBeginning();

            // 2. Add the Slider Control effect to the Null Layer if not present
            var effectGroup = controlLayer.property("Effects");
            var sliderEffect = effectGroup.property(controlName);
            if (!sliderEffect) {
                sliderEffect = effectGroup.addProperty("ADBE Slider Control");
                sliderEffect.name = controlName;
                sliderEffect.property(1).setValue(defaultValue);
            }

            // 3. Apply expression to target layer property
            var targetProperty = targetLayer.property(propertyName);
            if (!targetProperty) {
                app.endUndoGroup();
                return "Error: Property '" + propertyName + "' not found on layer " + targetLayer.name;
            }

            targetProperty.expression = expressionTemplate;
            targetProperty.expressionEnabled = true;

            app.endUndoGroup();
            return "Success: Control '" + controlLayerName + "' linked to " + targetLayer.name + "." + propertyName;
        } catch (err) {
            app.endUndoGroup();
            return "Error during script execution: " + err.toString();
        }
    },

    /**
     * Adds an extra slider control to an existing Control layer.
     */
    addSliderToRig: function (rigName, controlName, defaultValue) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) return "Error: Comp not found.";

        app.beginUndoGroup("Add Controller Slider");
        try {
            var controlLayerName = rigName + " Controls";
            var controlLayer = null;
            for (var i = 1; i <= comp.numLayers; i++) {
                if (comp.layer(i).name === controlLayerName) {
                    controlLayer = comp.layer(i);
                    break;
                }
            }

            if (!controlLayer) {
                app.endUndoGroup();
                return "Error: Control rig '" + controlLayerName + "' not found.";
            }

            var effectGroup = controlLayer.property("Effects");
            var sliderEffect = effectGroup.property(controlName);
            if (!sliderEffect) {
                sliderEffect = effectGroup.addProperty("ADBE Slider Control");
                sliderEffect.name = controlName;
                sliderEffect.property(1).setValue(defaultValue);
            }

            app.endUndoGroup();
            return "Success: Slider '" + controlName + "' added to '" + controlLayerName + "'.";
        } catch (err) {
            app.endUndoGroup();
            return "Error adding slider: " + err.toString();
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
        if (layerRef instanceof Layer || (layerRef && typeof layerRef.index === "number")) {
            return layerRef;
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

        // If layerRef is a string
        if (typeof layerRef === "string") {
            var numericId = parseInt(layerRef, 10);
            if (!isNaN(numericId)) {
                for (var i = 1; i <= comp.numLayers; i++) {
                    if (comp.layer(i).id === numericId) {
                        return comp.layer(i);
                    }
                }
            }

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
    createLayer: function (type, name, size) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition.");

        var w = (size && size[0]) ? size[0] : comp.width;
        var h = (size && size[1]) ? size[1] : comp.height;
        var layer;

        if (type === "Null") {
            layer = comp.layers.addNull(comp.duration);
            layer.name = name;
        } else if (type === "Text") {
            layer = comp.layers.addText(name);
        } else if (type === "Shape") {
            layer = comp.layers.addShape();
            layer.name = name;
        } else if (type === "Solid") {
            layer = comp.layers.addSolid([0.1, 0.1, 0.1], name, w, h, 1.0, comp.duration);
        } else if (type === "Adjustment") {
            layer = comp.layers.addSolid([0.1, 0.1, 0.1], name, w, h, 1.0, comp.duration);
            var layerId = layer.id;
            layer.adjustmentLayer = true;
            // Re-retrieve valid layer object reference using unique persistent ID
            for (var i = 1; i <= comp.numLayers; i++) {
                if (comp.layer(i).id === layerId) {
                    layer = comp.layer(i);
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

        // Auto-correct common LLM prefix typo "ABDE" -> "ADBE" (short for Adobe)
        if (effectMatchName && typeof effectMatchName === "string" && effectMatchName.indexOf("ABDE") === 0) {
            effectMatchName = "ADBE" + effectMatchName.substring(4);
        }

        var effectGroup = layer.property("Effects") || layer.property("ADBE Effect Parade");
        if (!effectGroup) throw new Error("Effects parameter not supported on this layer.");

        var fx = effectGroup.addProperty(effectMatchName);
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
                curr = curr.property(propPath[i]);
                if (!curr) throw new Error("Property path segment not found: " + propPath[i]);
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
        var prop = this.resolveProperty(layer, propPath);

        if (time !== undefined && time !== null) {
            prop.setValueAtTime(time, value);
        } else {
            prop.setValue(value);
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
            for (var k = 1; k <= times.length; k++) {
                var ease = new KeyframeEase(0, 33.3);
                prop.setTemporalEaseAtKey(k, [ease], [ease]);
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

        var mode = BlendMode.NORMAL;
        var m = blendModeName.toUpperCase();
        if (m === "ADD") mode = BlendMode.ADD;
        else if (m === "SCREEN") mode = BlendMode.SCREEN;
        else if (m === "MULTIPLY") mode = BlendMode.MULTIPLY;
        else if (m === "OVERLAY") mode = BlendMode.OVERLAY;
        else if (m === "DARKEN") mode = BlendMode.DARKEN;
        else if (m === "LIGHTEN") mode = BlendMode.LIGHTEN;
        else if (m === "DIFFERENCE") mode = BlendMode.DIFFERENCE;
        else if (m === "HUE") mode = BlendMode.HUE;
        else if (m === "SATURATION") mode = BlendMode.SATURATION;
        else if (m === "COLOR") mode = BlendMode.COLOR;
        else if (m === "LUMINOSITY") mode = BlendMode.LUMINOSITY;

        layer.blendMode = mode;
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
    }
};

