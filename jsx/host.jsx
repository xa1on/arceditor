/**
 * ArcEditor Host ExtendScript Suite
 * Provides native After Effects scripting APIs for structural inspection,
 * visual frame rendering, and the Animator-Control-Centric expressions rigging suite.
 * Compatible with After Effects 2020+ (ES3 Engine).
 */

// Custom lightweight JSON stringifier (since ExtendScript lacks native JSON)
var ArcJSON = {
    stringify: function(obj) {
        var t = typeof(obj);
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
                var t2 = typeof(v);
                if (t2 === "function" || t2 === "undefined") continue;
                
                var val = this.stringify(v);
                json.push((isArr ? "" : '"' + n + '":') + val);
            }
        }
        return (isArr ? "[" : "{") + json.join(",") + (isArr ? "]" : "}");
    }
};

// --- SECTION 1: TIMELINE & COMPOSITION INSPECTOR ---
var ArcInspector = {
    /**
     * Serializes structural details of the active composition and its layers.
     */
    getActiveCompositionData: function() {
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
                    } else {
                        layerType = "Solid";
                    }
                }
            } else if (layer.nullLayer) {
                layerType = "Null";
            }
            
            var layerData = {
                index: layer.index,
                name: layer.name,
                type: layerType,
                selected: layer.selected,
                enabled: layer.enabled,
                startTime: layer.startTime,
                inPoint: layer.inPoint,
                outPoint: layer.outPoint,
                hasParent: layer.parent !== null
            };
            
            // Add specific details for selected layer properties (reduces JSON payload size)
            if (layer.selected) {
                layerData.position = this.safePropertyValue(layer.property("Position"));
                layerData.scale = this.safePropertyValue(layer.property("Scale"));
                layerData.opacity = this.safePropertyValue(layer.property("Opacity"));
                
                if (layerType === "Text") {
                    try {
                        layerData.textString = layer.property("Source Text").value.text;
                    } catch(e) {}
                }
            }
            
            data.layers.push(layerData);
        }
        
        return ArcJSON.stringify(data);
    },
    
    /**
     * Safely reads a property's value or expression.
     */
    safePropertyValue: function(prop) {
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
        } catch(e) {
            info.value = "Unreadable";
        }
        return info;
    }
};

var ArcCanvas = {
    /**
     * Saves the current frame of the active composition to a temporary PNG file.
     * 
     * @param {string} tempPath Absolute file path to save the preview PNG to.
     */
    saveCurrentFrame: function(tempPath) {
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
    renderQueueFallback: function(comp, file) {
        var rq = app.project.renderQueue;
        var item = rq.items.add(comp);
        item.timeSpanStart = comp.time;
        item.timeSpanDuration = comp.frameDuration;
        
        var om = item.outputModule(1);
        try {
            om.applyTemplate("PNG Sequence");
        } catch(e) {
            try {
                om.applyTemplate("Lossless");
            } catch(e2) {}
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

// --- SECTION 3: ANIMATOR-CONTROL-CENTRIC RIGGING SUITE ---
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
    createSliderRig: function(layerIndex, propertyName, rigName, controlName, defaultValue, expressionTemplate) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return "Error: Active composition not found.";
        }
        
        app.beginUndoGroup("ArcEditor Rigging: " + rigName);
        try {
            var targetLayer = comp.layer(layerIndex);
            if (!targetLayer) {
                app.endUndoGroup();
                return "Error: Target layer index " + layerIndex + " not found.";
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
            return "Success: Rig '" + controlLayerName + "' linked to " + targetLayer.name + "." + propertyName;
        } catch(err) {
            app.endUndoGroup();
            return "Error during rigging execution: " + err.toString();
        }
    },
    
    /**
     * Adds an extra slider control to an existing Control layer.
     */
    addSliderToRig: function(rigName, controlName, defaultValue) {
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
        } catch(err) {
            app.endUndoGroup();
            return "Error adding slider: " + err.toString();
        }
    }
};

// --- SECTION 4: THE HIGH-LEVEL EDITING & COMPOSITING SUITE ---
var ArcEditor = {
    /**
     * Creates a new layer in the active composition.
     * 
     * @param {string} type Layer type: "Solid", "Text", "Shape", "Null", "Camera", "Light".
     * @param {string} name Custom name for the new layer.
     * @param {Array} size Optional [width, height] array. Defaults to comp size.
     */
    createLayer: function(type, name, size) {
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
        } else if (type === "Camera") {
            layer = comp.layers.addCamera(name, [w/2, h/2]);
        } else if (type === "Light") {
            layer = comp.layers.addLight(name, [w/2, h/2]);
        } else {
            throw new Error("Unsupported layer type: " + type);
        }
        return layer;
    },
    
    /**
     * Applies a native After Effects effect to a layer and sets its name.
     */
    applyEffect: function(layerIndex, effectMatchName, effectDisplayName) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition.");
        var layer = comp.layer(layerIndex);
        if (!layer) throw new Error("Layer at index " + layerIndex + " not found.");
        
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
    resolveProperty: function(layer, propPath) {
        if (!layer) throw new Error("Invalid layer parameter.");
        if (typeof propPath === "string") {
            var prop = layer.property(propPath);
            if (!prop) {
                // Try inside Transform group
                var transform = layer.property("Transform") || layer.property("ADBE Transform Group");
                if (transform) prop = transform.property(propPath);
            }
            if (!prop) throw new Error("Property not found: " + propPath);
            return prop;
        }
        if (propPath instanceof Array) {
            var curr = layer;
            for (var i = 0; i < propPath.length; i++) {
                curr = curr.property(propPath[i]);
                if (!curr) throw new Error("Property path segment not found: " + propPath[i]);
            }
            return curr;
        }
        return propPath; // Already a property object
    },
    
    /**
     * Sets value on a property at a specific time or overall.
     */
    setPropertyValue: function(layerIndex, propPath, value, time) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition.");
        var layer = comp.layer(layerIndex);
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
    setPropertyExpression: function(layerIndex, propPath, expressionStr) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition.");
        var layer = comp.layer(layerIndex);
        var prop = this.resolveProperty(layer, propPath);
        
        prop.expression = expressionStr;
        prop.expressionEnabled = true;
        return true;
    },
    
    /**
     * Sets multiple keyframes on a property with optional Easy Ease.
     */
    setKeyframes: function(layerIndex, propPath, times, values, easeIn, easeOut) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition.");
        var layer = comp.layer(layerIndex);
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
    parentLayer: function(layerIndex, parentLayerIndex) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition.");
        var child = comp.layer(layerIndex);
        var parent = parentLayerIndex ? comp.layer(parentLayerIndex) : null;
        if (!child) throw new Error("Child layer not found.");
        
        child.parent = parent;
        return true;
    },
    
    /**
     * Trims layer timing and start times on timeline.
     */
    trimLayer: function(layerIndex, inPoint, outPoint, startTime) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition.");
        var layer = comp.layer(layerIndex);
        if (!layer) throw new Error("Layer not found.");
        
        if (startTime !== undefined && startTime !== null) layer.startTime = startTime;
        if (inPoint !== undefined && inPoint !== null) layer.inPoint = inPoint;
        if (outPoint !== undefined && outPoint !== null) layer.outPoint = outPoint;
        return true;
    },
    
    /**
     * Precomposes a list of layer indices into a precomposition.
     */
    precompose: function(layerIndices, precompName, moveAllAttributes) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition.");
        
        var indices = [];
        for (var i = 0; i < layerIndices.length; i++) {
            indices.push(layerIndices[i]);
        }
        
        var newCompLayer = comp.layers.precompose(indices, precompName, moveAllAttributes !== false);
        return newCompLayer;
    },
    
    /**
     * Sets blend mode of a layer.
     */
    setLayerBlendMode: function(layerIndex, blendModeName) {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) throw new Error("No active composition.");
        var layer = comp.layer(layerIndex);
        if (!layer) throw new Error("Layer not found.");
        
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
    }
};

