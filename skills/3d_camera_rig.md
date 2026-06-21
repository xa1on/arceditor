# 3D Camera Rig
Description: Set up 3D space, camera structures, and the golden camera-null orbit rig pattern in After Effects.

## Guidelines & Implementation Details
- **3D SPACE VISIBILITY REQUIREMENT**: Standard 2D layers (text, solid, shape, footage) ignore After Effects cameras and render flat on top of the 3D space. To make a layer interact with a 3D camera, you MUST explicitly set its `"ThreeDLayer"` property to `true`:
  `ArcEditor.setPropertyValue(layerId, "ThreeDLayer", true);`
- **CAMERA CREATION & POI CONSTRAINT**: Creating a camera layer via `ArcEditor.createLayer("Camera", "Main Camera")` adds a Two-Node Camera in After Effects. A Two-Node Camera is constrained by its Point of Interest (POI) property. If you animate or change the camera's Position, it will rotate to keep looking at `[width/2, height/2, 0]`.
- **THE GOLDEN CAMERA-NULL ORBIT RIG PATTERN**: To avoid gimbal lock, auto-orientation bugs, and complex 3D trigonometric position math, ALWAYS parent the Camera to a 3D Null layer to control orbits, pans, and crane movements:
  1. Create a 3D Null to act as the camera controller/pivot:
     `var ctrlNull = ArcEditor.createLayer("Null", "Camera Controls", null, null, {threeDLayer: true});`
  2. Create the Camera:
     `var camera = ArcEditor.createLayer("Camera", "Main Camera");`
  3. Parent the Camera to the Null:
     `ArcEditor.parentLayer(camera.id, ctrlNull.id);`
  4. Offset the Camera along the local Z-axis (zoom/dolly distance):
     `ArcEditor.setPropertyValue(camera.id, "Position", [0, 0, -1500]);`
  5. To rotate or orbit the camera, keyframe the `Rotation` (X, Y, or Z Rotation) of the parent Null layer, NOT the camera.
  6. To pan the camera, move the `Position` of the parent Null layer.
- **CAMERA TRANSFORM PROPERTY NAMES**: Standard camera transform property names are case-sensitive:
  * `"Position"` (local dolly distance when parented, or absolute coordinates)
  * `"Point of Interest"` (MatchName: `ADBE Point of Interest`)
  * `"Orientation"` (MatchName: `ADBE Orientation`)
  * `"X Rotation"`, `"Y Rotation"`, `"Z Rotation"` (MatchNames: `ADBE Rotate X`, `ADBE Rotate Y`, `ADBE Rotate Z`)
