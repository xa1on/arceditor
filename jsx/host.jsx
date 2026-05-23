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
