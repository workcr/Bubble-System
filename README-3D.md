# 3D Underwater Bubble Simulation

A fully 3D translation of the original 2D p5.js bubble simulation, combining the strengths of p5.js and Three.js to create a realistic, interactive underwater bubble effect with organic deformation, physics simulation, and beautiful reflective materials.

## 🎨 Live Demo

Open `3d-demo.html` in a modern web browser to see the simulation in action.

## 🏗️ Architecture

This project uses a hybrid architecture that leverages the best features of both libraries:

### p5.js as the "Driver"
- **Canvas Management**: Creates the WebGL canvas using `createCanvas(1080, 1440, WEBGL)`
- **Animation Loop**: Manages the main `setup()` and `draw()` loop at 60fps
- **Noise Generation**: Uses p5's excellent `noise()` function for all procedural generation (shape deformation and physics drift)
- **Physics Calculations**: All physics (position, velocity, collisions) use `p5.Vector` for 3D math
- **UI Controls**: The entire control panel is built with p5.dom (createDiv, createSlider, etc.)

### Three.js as the "Renderer"
- **3D Scene**: Manages all 3D objects in a `THREE.Scene`
- **Camera**: Uses `THREE.PerspectiveCamera` for realistic perspective projection
- **Controls**: Implements `THREE.OrbitControls` for interactive camera manipulation
- **Geometry**: Creates bubbles using `THREE.IcosahedronGeometry` (evenly distributed vertices ideal for smooth deformation)
- **Materials**: Uses `THREE.MeshPhysicalMaterial` with environment maps for realistic soap bubble appearance
- **Lighting**: Handles all lighting with AmbientLight and DirectionalLight
- **Rendering**: The Three.js `WebGLRenderer` uses the canvas element created by p5.js

### Data Flow

```
┌─────────────┐
│   p5.js     │
│   setup()   │──> Creates WEBGL canvas
└─────────────┘
       │
       ▼
┌─────────────────────────┐
│    Three.js Init        │
│ - Scene                 │
│ - Camera                │──> Uses p5's canvas element
│ - Renderer (alpha:true) │
│ - OrbitControls         │
└─────────────────────────┘
       │
       ▼
┌─────────────┐
│   p5.js     │
│   draw()    │
└─────────────┘
       │
       ├──> 1. Draw p5 background (solid + image)
       │
       ├──> 2. Update physics (p5.Vector)
       │       - Buoyancy, drag, drift
       │       - Collision detection/response
       │       - Boundary constraints
       │
       ├──> 3. Update Three.js meshes
       │       - Sync positions from p5.Vector
       │       - Deform vertices (noise + dents)
       │       - Update materials (opacity fade)
       │
       ├──> 4. Update camera controls
       │
       └──> 5. Render Three.js scene
```

## ✨ Features

### 1. Organic Bubble Shape
- **2D Version**: Wobbles created by modulating radius at different angles using Perlin noise
- **3D Version**: Uses vertex displacement on IcosahedronGeometry
  - Each vertex is displaced along its normal based on 3D Perlin noise
  - `noise(x, y, z)` samples create natural, flowing deformations
  - Noise evolves over time for animated wobbling

### 2. Collision Detection & Deformation
- **Physics**: Sphere-sphere collision detection using bounding spheres (performance-optimized)
- **Visual Dents**: When bubbles collide, vertices near the contact point are displaced inward
  - Dent strength is based on collision overlap
  - Uses Gaussian falloff for smooth transitions
  - Dents fade out over time using exponential decay
  - Multiple dents can exist simultaneously and blend naturally

### 3. Physics System
All physics translated from 2D to 3D using p5.Vector:
- **Buoyancy**: Constant upward force along +Y axis (Three.js up direction)
- **Drag**: Exponential velocity damping
- **Drift**: Lateral forces driven by 3D Perlin noise for organic movement
- **Boundaries**: 3D bounding box with bounce physics
- **Collision Response**: Impulse-based collision resolution with mass consideration

### 4. Interactive UI Panel
Complete preservation of the original UI functionality:
- **Bubble Count** (`-` / `=`): Add or remove bubbles (4-32)
- **Min/Max Bubble Size** (`1`/`2`/`3`/`4`): Adjust size range (40-260 units)
- **Collision Iterations** (`,` / `.`): Quality vs performance trade-off (4-20)
- **Grid Cell Size** (`g` / `G`): Spatial partitioning for collision broad-phase (100-400)

### 5. Background Image System
- **Upload**: Load any image file via file input
- **Fit Mode**: Choose between "cover" (fill canvas) or "contain" (fit within canvas)
- **Opacity**: Adjust transparency (0-255)
- **Rendering**: p5.js draws the image, Three.js renders with transparent background on top

### 6. Export Functionality
Both export modes preserved from original:
- **PNG-ZIP**: Captures each frame as PNG, bundles into downloadable ZIP file
- **WebM Video**: Encodes frames directly to WebM format (requires WebP support)
- **Settings**: Configurable FPS (8-60) and duration (1-60 seconds)
- **Keyboard**: Press `R` to start/stop recording

### 7. Realistic Bubble Material
Three.js MeshPhysicalMaterial provides:
- **Transmission**: Light passes through the bubble (0.9)
- **Clearcoat**: Glossy outer layer for wet appearance (1.0)
- **IOR**: Index of refraction matching soap bubbles (1.33)
- **Environment Map**: Reflections of surrounding environment
- **Opacity**: Semi-transparent with fade-out during pop animation (0.6)

### 8. Interactive 3D Camera
OrbitControls enable full 3D exploration:
- **Rotate**: Left-click and drag
- **Pan**: Right-click and drag
- **Zoom**: Scroll wheel
- **Damping**: Smooth, inertial camera movement
- **Constraints**: Min/max zoom distance limits

## 🔧 Technical Implementation

### Bubble Geometry Deformation

The core of the 3D effect is the per-frame vertex displacement:

```javascript
// For each vertex in the IcosahedronGeometry:
for (let i = 0; i < vertexCount; i++) {
  // 1. Get original position (stored at initialization)
  const originalPos = this.originalPositions[i];

  // 2. Calculate noise-based wobble
  const noise3D = noise(
    normalX * scale + time,
    normalY * scale + time,
    normalZ * scale + time
  );
  const wobble = (noise3D - 0.5) * 2.0 * amplitude;

  // 3. Calculate dent deformation
  let dentSum = 0;
  for (const dent of this.dents) {
    const distanceToContact = distance(vertex, dent.worldPos);
    const angularDistance = distanceToContact / radius;
    const gaussian = exp(-0.5 * angularDistance² / sigma²);
    dentSum += dent.strength * gaussian;
  }

  // 4. Compute final radius
  const finalRadius = baseRadius * (1 + wobble) * (1 - dentSum);

  // 5. Set new vertex position
  vertex.position = normal * finalRadius;
}

// 6. Recompute normals for correct lighting
geometry.computeVertexNormals();
```

### Physics Collision Pipeline

```javascript
// 1. Spatial partitioning (3D grid)
grid.clear();
for (const bubble of bubbles) {
  grid.insert(bubble);
}

// 2. Get potential collision pairs
grid.pairs(pairBuffer);

// 3. Sort by penetration depth (deepest first)
sortByDepth(pairBuffer);

// 4. Resolve collisions iteratively
for (let iter = 0; iter < COLLISION_ITERS; iter++) {
  for (const [a, b] of pairBuffer) {
    const overlap = separatePair(a, b);
    if (overlap > 0) {
      // Position correction (mass-weighted)
      // Velocity impulse
      // Visual dent creation
    }
  }
}

// 5. Final exact sweep (eliminate any remaining overlap)
```

### Asynchronous Library Loading

The simulation gracefully handles Three.js loading:

```javascript
// 1. Show loading screen
background(255);
text("Loading Three.js...", 0, 0);

// 2. Async load Three.js from CDN
await loadThreeJS();
await loadOrbitControls();

// 3. Initialize Three.js scene
initThreeJS(canvas.elt);

// 4. Start simulation
threeReady = true;
```

If loading fails, a clear error message is displayed.

## 📦 Dependencies

All dependencies are loaded from CDNs (no installation required):

- **p5.js** `1.9.0`: Canvas, animation loop, noise, vectors, UI
- **Three.js** `0.160.0`: 3D rendering engine
- **OrbitControls**: Camera interaction (Three.js addon)
- **JSZip** `3.10.1`: PNG-ZIP export (lazy-loaded)
- **WebMWriter** `0.3.0`: WebM export (lazy-loaded)

## 🚀 Usage

### Option 1: Direct HTML File
1. Open `3d-demo.html` in a web browser
2. The simulation will load automatically

### Option 2: Embed in Your Project
```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.jsdelivr.net/npm/p5@1.9.0/lib/p5.min.js"></script>
</head>
<body>
  <script src="3d-bubble-simulation.js"></script>
</body>
</html>
```

### Option 3: Local Development Server
```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx serve

# Then open http://localhost:8000/3d-demo.html
```

## ⚙️ Configuration

### Adjust Physics Parameters

Edit the `BubbleSystem` constructor in `3d-bubble-simulation.js`:

```javascript
this.BUOY_UP = 35.0;           // Buoyancy force (higher = faster rise)
this.DRAG = 0.25;              // Air resistance (higher = slower)
this.DRIFT_ACC = 6.0;          // Lateral drift strength
this.MAX_SPEED = 220;          // Terminal velocity

this.NOISE_AMP = 0.85;         // Wobble intensity (0-1)
this.NOISE_SCALE = 0.08;       // Wobble frequency (smaller = larger features)
this.NOISE_TIME_SPEED = 0.25;  // Animation speed

this.DENT_SIGMA = 0.8;         // Dent spread (higher = wider)
this.DENT_DECAY = 18.0;        // Dent fade speed (higher = faster)
this.MAX_DENT_FRAC = 0.006;    // Maximum dent depth (fraction of radius)
```

### Adjust Bounding Box

```javascript
this.BOX_W = 900;   // Width (X axis)
this.BOX_H = 1200;  // Height (Y axis)
this.BOX_D = 600;   // Depth (Z axis)
```

### Adjust Material Properties

Edit the bubble material in `Bubble3D.createMesh()`:

```javascript
this.material = new THREE.MeshPhysicalMaterial({
  metalness: 0.0,          // 0 = dielectric (soap is not metal)
  roughness: 0.1,          // 0 = perfectly smooth, 1 = very rough
  opacity: 0.6,            // Base transparency
  transmission: 0.9,       // How much light passes through
  clearcoat: 1.0,          // Glossy coating strength
  clearcoatRoughness: 0.1, // Coating smoothness
  ior: 1.33,               // Index of refraction (water/soap)
  reflectivity: 0.5        // Reflection intensity
});
```

### Adjust Geometry Detail

Higher subdivision = smoother but slower:

```javascript
// In Bubble3D.createMesh():
this.geometry = new THREE.IcosahedronGeometry(
  this.baseR,  // radius
  3            // subdivision level (0-5 typical range)
);
```

| Subdivision | Vertices | Triangles | Quality | Performance |
|-------------|----------|-----------|---------|-------------|
| 0 | 12 | 20 | Faceted | Very Fast |
| 1 | 42 | 80 | Low | Fast |
| 2 | 162 | 320 | Medium | Good |
| 3 | 642 | 1280 | High | Moderate |
| 4 | 2562 | 5120 | Very High | Slow |

**Recommended**: 3 (default) provides excellent quality with good performance.

## 🎓 Learning Resources

### Concepts Demonstrated

1. **Hybrid Framework Architecture**: Combining multiple libraries strategically
2. **Vertex Displacement**: Real-time mesh deformation techniques
3. **3D Perlin Noise**: Procedural generation in three dimensions
4. **Physics Simulation**: Realistic movement and collision response
5. **Spatial Partitioning**: Performance optimization with uniform grids
6. **PBR Materials**: Physically-based rendering for realism
7. **Camera Controls**: User interaction in 3D space
8. **Async Loading**: Graceful resource loading with error handling

### Key Algorithms

- **Catmull-Rom to Bézier** (2D version): Smooth curve interpolation
- **Vertex Displacement**: `position = normal * f(noise, dents, time)`
- **Gaussian Dent Falloff**: `strength * exp(-0.5 * distance² / sigma²)`
- **Impulse-Based Collision**: Conservation of momentum with mass weighting
- **Spatial Hashing**: O(n) broad-phase collision detection
- **Exponential Decay**: `value *= exp(-rate * dt)` for smooth animations

## 🐛 Troubleshooting

### Black Screen
- Check browser console for errors
- Ensure Three.js loaded successfully (CDN accessible)
- Try refreshing the page

### Poor Performance
- Reduce bubble count (use `-` key)
- Lower collision iterations (use `,` key)
- Increase grid cell size (use `G` key)
- Reduce geometry subdivision level in code

### WebM Export Fails
- Your browser may not support WebP encoding
- Use PNG-ZIP mode instead (automatic fallback)
- Try a different browser (Chrome/Edge recommended)

### Background Image Not Showing
- Check image file format (PNG, JPG, GIF supported)
- Increase opacity slider
- Ensure "cover" or "contain" mode is selected

## 📝 License

This project is provided as-is for educational and creative purposes.

## 🙏 Acknowledgments

- Original 2D bubble simulation architecture
- p5.js community for excellent documentation
- Three.js contributors for the powerful 3D engine
- OrbitControls for intuitive camera interaction

---

**Created with p5.js + Three.js** | 3D Generative Art | Physics Simulation
