# Color Palette Control
Description: Create a central color palette Null layer to control multiple layer colors globally via expressions.

## Guidelines & Implementation Details
- **WHEN TO USE**: When the user requests a custom color theme, color palette, or wants to easily swap colors across multiple layers (shapes, texts, solids) dynamically.
- **THE CENTRAL CONTROLLER**: Create a Null layer named `[Theme] Color Palette` at the top of the timeline. Add multiple "ADBE Color Control" effects to it.
- **LANGUAGE-INDEPENDENT EXPRESSION REFERENCING**: Bind target properties to color sliders using index-based referencing (e.g. `.effect(index)(1)`) to support non-English language versions of After Effects.

### Implementation Workflow
1. Create the Color Palette Null layer:
   `var paletteNull = ArcEditor.createLayer("Null", "Color Palette");`
2. Add Color Control effects to the Null:
   ```javascript
   ArcEditor.applyEffect(paletteNull.id, "ADBE Color Control", "Color 1");
   ArcEditor.applyEffect(paletteNull.id, "ADBE Color Control", "Color 2");
   ArcEditor.applyEffect(paletteNull.id, "ADBE Color Control", "Color 3");
   
   // Set default colors (Color 1: Red [1,0,0,1], Color 2: Blue [0,0,1,1])
   ArcEditor.setPropertyValue(paletteNull.id, ["Effects", "Color 1", "Color"], [1.0, 0.2, 0.2, 1.0]);
   ArcEditor.setPropertyValue(paletteNull.id, ["Effects", "Color 2", "Color"], [0.2, 0.5, 1.0, 1.0]);
   ArcEditor.setPropertyValue(paletteNull.id, ["Effects", "Color 3", "Color"], [0.1, 0.1, 0.1, 1.0]);
   ```
3. Link target layer parameters (e.g. a Shape fill or Solid source color) to the color controllers:
   ```javascript
   // Link to Color 1
   var color1Expr = "thisComp.layer('Color Palette').effect(1)(1);";
   ArcEditor.setPropertyExpression(targetShapeLayerId, ["Contents", "Rectangle 1", "Fill 1", "Color"], color1Expr);
   ```
