# Dynamic Line Connector
Description: Create dynamic vector lines that connect two Null layers (points) and automatically update as they move.

## Guidelines & Implementation Details
- **WHEN TO USE**: When the user wants to draw a line, trace, or connector between two layers (e.g. connecting a label to a target point, drawing links in infographics).
- **THE CONNECTOR LAYER**: Create a shape layer containing a path.
- **PATH EXPRESSION**: Use a path expression mapping the two layers' world positions (`toComp`) to dynamic line path vertices.

### Implementation Workflow
1. Create a Shape Layer for the connector:
   `var lineLayer = ArcEditor.createLayer("Shape", "Connector Line");`
2. Add a path group, stroke style, and remove fill inside the Shape Layer:
   ```javascript
   // Add Ellipse path/stroke group
   ArcEditor.addShapeToLayer(lineLayer.id, "Path", "Line Path", {
       strokeColor: [1.0, 1.0, 1.0],
       strokeWidth: 4,
       fillColor: false // Disable fill
   });
   ```
3. Set the path expression on the Path property of the connector group. The expression queries the positions of `Point A` and `Point B` relative to the composition and creates a linear segment between them:
   ```javascript
   var connExpr = "var pA = thisComp.layer('Point A').toComp([0,0,0]);\n" +
       "var pB = thisComp.layer('Point B').toComp([0,0,0]);\n" +
       "createPath([fromComp(pA), fromComp(pB)], [], [], false);";
   
   ArcEditor.setPropertyExpression(lineLayer.id, ["Contents", "Line Path", "Path"], connExpr);
   ```
