// 3D Underwater Bubbles — p5.js + Three.js + Glass Shader
// Background canvas (p5.js 2D) + 3D canvas (Three.js WebGL) with chromatic aberration glass shader
// Inspired by Olivier Larose's 3D distorted glass effect
// Canvas: 1080 x 1440

/* ---------- Palette (literal RGB) ---------- */
const PALETTE_HEX = ["#c0c0c0", "#838383", "#41a47f", "#746fae", "#ffa5ce"];
let PALETTE_RGB = [];

/* ---------- Three.js state ---------- */
let THREE, OrbitControls;
let threeReady = false;
let scene, camera, renderer, controls;
let ambientLight, directLight, directLight2;
let renderTarget; // For glass shader background

/* ---------- Canvas references ---------- */
let bgCanvas; // p5.js 2D canvas for background
let threeCanvas; // Three.js WebGL canvas

/* ---------- Background image state ---------- */
const bgState = {
  img: null,
  alpha: 255,
  mode: "cover"
};

/* ---------- Glass Shader Parameters ---------- */
const glassParams = {
  chromaticAberration: 0.02,
  refraction: 0.9,
  thickness: 0.2,
  ior: 1.2
};

/* ---------- Recording state ---------- */
const REC = {
  active: false,
  mode: "pngzip",
  fps: 30,
  secs: 8,
  targetFrames: 0,
  frameCount: 0,
  zip: null,
  zipReady: false,
  webmWriter: null,
  statusSpan: null,
  startBtn: null,
  modeSel: null,
  fpsSlider: null,
  secsSlider: null,
  setStatus(s) { if (this.statusSpan) this.statusSpan.html(s); }
};

/* ---------- Helpers ---------- */
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const TAU = Math.PI * 2;

/* ---------- External libs ---------- */
function ensureJSZip() {
  return new Promise((resolve, reject) => {
    if (window.JSZip) return resolve();
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load JSZip"));
    document.head.appendChild(s);
  });
}

function ensureWebMWriter() {
  return new Promise((resolve, reject) => {
    if (window.WebMWriter) return resolve();
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/webm-writer@0.3.0/WebMWriter.min.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load WebMWriter"));
    document.head.appendChild(s);
  });
}

/* ---------- Load Three.js ---------- */
async function loadThreeJS() {
  return new Promise((resolve, reject) => {
    if (window.THREE) {
      THREE = window.THREE;
      return loadOrbitControls().then(resolve).catch(reject);
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js";
    script.onload = () => {
      THREE = window.THREE;
      loadOrbitControls().then(resolve).catch(reject);
    };
    script.onerror = () => reject(new Error("Failed to load Three.js"));
    document.head.appendChild(script);
  });
}

function loadOrbitControls() {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/controls/OrbitControls.js";
    script.onload = () => {
      OrbitControls = window.THREE.OrbitControls;
      resolve();
    };
    script.onerror = () => reject(new Error("Failed to load OrbitControls"));
    document.head.appendChild(script);
  });
}

/* ---------- Glass Shaders (Chromatic Aberration) ---------- */
const glassVertexShader = `
varying vec3 vWorldPosition;
varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;

  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = -mvPosition.xyz;

  vNormal = normalize(normalMatrix * normal);

  gl_Position = projectionMatrix * mvPosition;
}
`;

const glassFragmentShader = `
uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uChromaticAberration;
uniform float uRefraction;
uniform float uThickness;
uniform float uIor;
uniform vec3 uColor;

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying vec3 vViewPosition;

vec2 getUV(vec3 normal) {
  vec3 viewDir = normalize(vViewPosition);
  vec3 refracted = refract(viewDir, normal, 1.0 / uIor);
  vec2 uv = gl_FragCoord.xy / uResolution;
  uv += refracted.xy * uRefraction;
  return uv;
}

void main() {
  vec3 normal = normalize(vNormal);
  if (!gl_FrontFacing) {
    normal *= -1.0;
  }

  // Chromatic aberration - separate RGB channels
  vec2 uv = getUV(normal);
  vec2 uvR = uv + normal.xy * uChromaticAberration;
  vec2 uvG = uv;
  vec2 uvB = uv - normal.xy * uChromaticAberration;

  // Sample each color channel with different offsets
  float r = texture2D(uTexture, uvR).r;
  float g = texture2D(uTexture, uvG).g;
  float b = texture2D(uTexture, uvB).b;

  vec3 refractedColor = vec3(r, g, b);

  // Fresnel effect for edge highlights
  vec3 viewDir = normalize(vViewPosition);
  float fresnel = pow(1.0 - abs(dot(viewDir, normal)), 3.0);

  // Mix refracted color with base color
  vec3 finalColor = mix(refractedColor, uColor, fresnel * 0.1);

  // Add some transparency based on thickness and fresnel
  float alpha = 0.9 - fresnel * 0.2;

  gl_FragColor = vec4(finalColor, alpha);
}
`;

/* ---------- UI (outside canvas) ---------- */
let system, ui = {};

function buildUI() {
  const panel = createDiv().id("controls-panel");
  const container = document.getElementById("canvas-container");
  if (container && container.parentNode) {
    container.parentNode.insertBefore(panel.elt, container.nextSibling);
  } else {
    document.body.appendChild(panel.elt);
  }

  panel
    .style("max-width", "1080px")
    .style("margin", "12px auto")
    .style("padding", "12px 14px")
    .style("border", "1px solid #e5e7eb")
    .style("border-radius", "12px")
    .style("background", "#fafafa")
    .style("font", "13px/1.35 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial");

  createDiv("<b>3D Glass Bubble Simulation</b> (keys: - =  , .  g/G  1/2  3/4)").parent(panel)
    .style("margin-bottom", "8px");

  function row(label, min, max, value, step, oninput) {
    const r = createDiv().parent(panel).style("display", "grid")
      .style("grid-template-columns", "160px 1fr 60px").style("gap", "8px")
      .style("align-items", "center").style("margin", "6px 0");
    createSpan(label).parent(r);
    const s = createSlider(min, max, value, step).parent(r).style("width", "100%");
    const v = createSpan("" + value).parent(r).style("text-align", "right");
    s.input(() => { v.html(s.value()); oninput(Number(s.value())); });
    return { slider: s, value: v };
  }

  // Bubble controls
  ui.grid = row("Grid Cell Size g/G", 100, 400, 250, 10, val => system.setGridCellSize(val));
  ui.count = row("Bubble Count - / =", 4, 32, 12, 1, val => system.setTargetCount(val));
  ui.iters = row("Collision Iters , / .", 4, 20, system.COLLISION_ITERS, 1, val => system.COLLISION_ITERS = val);
  ui.minR = row("Min Bubble Size 1/2", 40, 200, system.minR, 2, val => system.setBubbleSize(val, system.maxR));
  ui.maxR = row("Max Bubble Size 3/4", 60, 260, system.maxR, 2, val => system.setBubbleSize(system.minR, val));

  // Glass shader controls
  createDiv('<hr style="border:none;border-top:1px solid #e5e7eb;margin:10px 0;">').parent(panel);
  createDiv("<b>Glass shader</b>").parent(panel).style("margin", "6px 0 4px");

  ui.chromatic = row("Chromatic Aberration", 0, 0.1, glassParams.chromaticAberration, 0.001, val => {
    glassParams.chromaticAberration = val;
    system.updateGlassParams();
  });
  ui.refraction = row("Refraction", 0, 2, glassParams.refraction, 0.01, val => {
    glassParams.refraction = val;
    system.updateGlassParams();
  });
  ui.thickness = row("Thickness", 0, 1, glassParams.thickness, 0.01, val => {
    glassParams.thickness = val;
    system.updateGlassParams();
  });
  ui.ior = row("IOR (Index of Refraction)", 1, 2, glassParams.ior, 0.01, val => {
    glassParams.ior = val;
    system.updateGlassParams();
  });

  // Background controls
  createDiv('<hr style="border:none;border-top:1px solid #e5e7eb;margin:10px 0;">').parent(panel);
  createDiv("<b>Background image</b>").parent(panel).style("margin", "6px 0 4px");

  const fileRow = createDiv().parent(panel).style("display", "flex").style("gap", "8px").style("align-items", "center");
  createSpan("Upload:").parent(fileRow).style("width", "160px");
  const fileInput = createFileInput(handleBGUpload, false).parent(fileRow);
  fileInput.elt.accept = "image/*";

  const modeRow = createDiv().parent(panel).style("display", "grid")
    .style("grid-template-columns", "160px 1fr").style("gap", "8px").style("align-items", "center");
  createSpan("Fit:").parent(modeRow);
  const modeSel = createSelect().parent(modeRow);
  modeSel.option("cover"); modeSel.option("contain"); modeSel.selected(bgState.mode);
  modeSel.changed(() => bgState.mode = modeSel.value());

  const opRow = createDiv().parent(panel).style("display", "grid")
    .style("grid-template-columns", "160px 1fr 60px").style("gap", "8px").style("align-items", "center");
  createSpan("Opacity:").parent(opRow);
  const opSlider = createSlider(0, 255, bgState.alpha, 1).parent(opRow);
  const opVal = createSpan("" + bgState.alpha).parent(opRow).style("text-align", "right");
  opSlider.input(() => { bgState.alpha = opSlider.value(); opVal.html(bgState.alpha); });

  const clearRow = createDiv().parent(panel).style("display", "grid")
    .style("grid-template-columns", "160px 1fr").style("gap", "8px").style("align-items", "center");
  createSpan("Clear:").parent(clearRow);
  const clearBtn = createButton("Remove background").parent(clearRow);
  clearBtn.mousePressed(() => { bgState.img = null; });

  // Export controls
  createDiv('<hr style="border:none;border-top:1px solid #e5e7eb;margin:10px 0;">').parent(panel);
  createDiv("<b>Export video</b>").parent(panel).style("margin", "6px 0 4px");

  const fpsRow = createDiv().parent(panel).style("display", "grid")
    .style("grid-template-columns", "160px 1fr 60px").style("gap", "8px").style("align-items", "center");
  createSpan("FPS:").parent(fpsRow);
  REC.fpsSlider = createSlider(8, 60, REC.fps, 1).parent(fpsRow);
  const fpsVal = createSpan("" + REC.fps).parent(fpsRow).style("text-align", "right");
  REC.fpsSlider.input(() => { REC.fps = REC.fpsSlider.value(); fpsVal.html(REC.fps); });

  const durRow = createDiv().parent(panel).style("display", "grid")
    .style("grid-template-columns", "160px 1fr 60px").style("gap", "8px").style("align-items", "center");
  createSpan("Duration (s):").parent(durRow);
  REC.secsSlider = createSlider(1, 60, REC.secs, 1).parent(durRow);
  const durVal = createSpan("" + REC.secs).parent(durRow).style("text-align", "right");
  REC.secsSlider.input(() => { REC.secs = REC.secsSlider.value(); durVal.html(REC.secs); });

  const fmtRow = createDiv().parent(panel).style("display", "grid")
    .style("grid-template-columns", "160px 1fr 160px").style("gap", "8px").style("align-items", "center");
  createSpan("Format:").parent(fmtRow);
  REC.modeSel = createSelect().parent(fmtRow);
  REC.modeSel.option("pngzip");
  REC.modeSel.option("webm (beta)");
  REC.modeSel.changed(() => { REC.mode = REC.modeSel.value().startsWith("webm") ? "webm" : "pngzip"; });
  REC.startBtn = createButton("Start recording (R)").parent(fmtRow);
  REC.startBtn.mousePressed(() => {
    if (REC.active) stopRecording();
    else startRecording({ mode: (REC.modeSel.value().startsWith("webm") ? "webm" : "pngzip"), fps: REC.fps, secs: REC.secs });
  });

  const statRow = createDiv().parent(panel).style("margin-top", "6px");
  REC.statusSpan = createSpan("Ready").parent(statRow);

  createDiv('<hr style="border:none;border-top:1px solid #e5e7eb;margin:10px 0;">').parent(panel);
  createDiv("<b>Camera:</b> Left-drag to rotate, right-drag to pan, scroll to zoom").parent(panel)
    .style("margin", "6px 0 4px").style("color", "#666");

  system._syncUI = function () {
    ui.grid.slider.value(this.grid.cellSize); ui.grid.value.html(this.grid.cellSize);
    ui.count.slider.value(this.TARGET_COUNT); ui.count.value.html(this.TARGET_COUNT);
    ui.iters.slider.value(this.COLLISION_ITERS); ui.iters.value.html(this.COLLISION_ITERS);
    ui.minR.slider.value(this.minR); ui.minR.value.html(this.minR);
    ui.maxR.slider.value(this.maxR); ui.maxR.value.html(this.maxR);
    ui.chromatic.slider.value(glassParams.chromaticAberration);
    ui.chromatic.value.html(glassParams.chromaticAberration.toFixed(3));
    ui.refraction.slider.value(glassParams.refraction);
    ui.refraction.value.html(glassParams.refraction.toFixed(2));
    ui.thickness.slider.value(glassParams.thickness);
    ui.thickness.value.html(glassParams.thickness.toFixed(2));
    ui.ior.slider.value(glassParams.ior);
    ui.ior.value.html(glassParams.ior.toFixed(2));
    opSlider.value(bgState.alpha); opVal.html(bgState.alpha);
    modeSel.value(bgState.mode);
  };
}

function handleBGUpload(file) {
  if (!file || !file.data) return;
  loadImage(file.data, img => { bgState.img = img; });
}

/* ---------- p5 setup ---------- */
function setup() {
  bgCanvas = createCanvas(1080, 1440);
  bgCanvas.parent("canvas-container");
  pixelDensity(2);
  frameRate(60);

  colorMode(RGB, 255, 255, 255, 255);
  PALETTE_RGB = PALETTE_HEX.map(h => color(h));

  noiseDetail(4, 0.5);
  randomSeed(12345);
  noiseSeed(67890);

  background(255);
  fill(0);
  textAlign(CENTER, CENTER);
  textSize(24);
  text("Loading Three.js...", width/2, height/2);

  loadThreeJS()
    .then(() => {
      initThreeJS();
      system = new BubbleSystem();
      buildUI();
      threeReady = true;
      console.log("Three.js + Glass Shader loaded successfully");
    })
    .catch(err => {
      console.error(err);
      background(255);
      fill(255, 0, 0);
      textAlign(CENTER, CENTER);
      textSize(18);
      text("Failed to load Three.js\n" + err.message + "\n\nPlease refresh the page", width/2, height/2);
    });
}

/* ---------- Initialize Three.js with Glass Shader ---------- */
function initThreeJS() {
  threeCanvas = document.createElement("canvas");
  threeCanvas.width = 1080 * 2;
  threeCanvas.height = 1440 * 2;
  threeCanvas.style.width = "1080px";
  threeCanvas.style.height = "1440px";
  threeCanvas.style.position = "absolute";
  threeCanvas.style.top = "0";
  threeCanvas.style.left = "0";
  threeCanvas.style.pointerEvents = "auto";

  const container = document.getElementById("canvas-container");
  container.appendChild(threeCanvas);

  scene = new THREE.Scene();

  const aspect = 1080 / 1440;
  camera = new THREE.PerspectiveCamera(50, aspect, 10, 10000);
  camera.position.set(0, 0, 1800);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({
    canvas: threeCanvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true
  });
  renderer.setSize(1080, 1440);
  renderer.setPixelRatio(2);
  renderer.setClearColor(0x000000, 0);

  // Create render target for glass shader background
  renderTarget = new THREE.WebGLRenderTarget(1080 * 2, 1440 * 2, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType
  });

  controls = new OrbitControls(camera, threeCanvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 400;
  controls.maxDistance = 3000;
  controls.target.set(0, 0, 0);

  ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  directLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directLight.position.set(500, 800, 600);
  scene.add(directLight);

  directLight2 = new THREE.DirectionalLight(0xaaccff, 0.4);
  directLight2.position.set(-400, 200, -300);
  scene.add(directLight2);
}

/* ---------- p5 draw loop ---------- */
function draw() {
  background(255);

  if (bgState.img) {
    push();
    tint(255, bgState.alpha);
    const iw = bgState.img.width, ih = bgState.img.height;
    const sx = width / iw, sy = height / ih;
    const s = (bgState.mode === "cover") ? max(sx, sy) : min(sx, sy);
    const dw = iw * s, dh = ih * s;
    const dx = (width - dw) * 0.5;
    const dy = (height - dh) * 0.5;
    image(bgState.img, dx, dy, dw, dh);
    pop();
  }

  if (!threeReady) return;

  const dt = Math.min(0.033, deltaTime / 1000);
  system.update(dt);
  system.updateThreeMeshes();

  controls.update();

  // Render background to texture for glass shader
  renderBackgroundToTexture();

  // Render scene with glass bubbles
  renderer.render(scene, camera);

  if (REC.active) addFrameToRecording();
}

function renderBackgroundToTexture() {
  // Capture the p5 canvas as texture for glass shader refraction
  const canvas = bgCanvas.elt;
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  // Update all bubble materials with the new background texture
  for (const bubble of system.bubbles) {
    if (bubble.material && bubble.material.uniforms) {
      bubble.material.uniforms.uTexture.value = texture;
    }
  }
}

/* ---------- Keyboard ---------- */
function keyPressed() {
  if (!threeReady) return false;

  if (key === '-') system.setTargetCount(max(4, system.TARGET_COUNT - 1));
  if (key === '=') system.setTargetCount(min(32, system.TARGET_COUNT + 1));
  if (key === ',') system.COLLISION_ITERS = max(4, system.COLLISION_ITERS - 1);
  if (key === '.') system.COLLISION_ITERS = min(20, system.COLLISION_ITERS + 1);
  if (key === 'g') system.setGridCellSize(max(100, system.grid.cellSize - 10));
  if (key === 'G') system.setGridCellSize(min(400, system.grid.cellSize + 10));
  if (key === '1') system.setBubbleSize(max(40, system.minR - 4), system.maxR);
  if (key === '2') system.setBubbleSize(min(system.maxR - 8, system.minR + 4), system.maxR);
  if (key === '3') system.setBubbleSize(system.minR, max(system.minR + 10, system.maxR - 4));
  if (key === '4') system.setBubbleSize(system.minR, min(260, system.maxR + 4));
  if (key === 'R') {
    if (REC.active) stopRecording();
    else startRecording({ mode: (REC.modeSel.value().startsWith("webm") ? "webm" : "pngzip"), fps: REC.fps, secs: REC.secs });
  }

  if (system._syncUI) system._syncUI();
  return false;
}

/* ---------- Uniform Grid (3D) ---------- */
class UniformGrid {
  constructor(w, h, d, cell = 250) { this.resize(w, h, d, cell); }
  resize(w, h, d, cell) {
    this.w = w; this.h = h; this.d = d;
    this.cellSize = max(20, cell | 0);
    this.cols = max(1, Math.ceil(w / this.cellSize));
    this.rows = max(1, Math.ceil(h / this.cellSize));
    this.layers = max(1, Math.ceil(d / this.cellSize));
    const n = this.cols * this.rows * this.layers;
    this.cells = new Array(n);
    for (let i = 0; i < n; i++) this.cells[i] = [];
  }
  clear() { for (let i = 0; i < this.cells.length; i++) this.cells[i].length = 0; }
  _idx(cx, cy, cz) {
    if (cx < 0 || cy < 0 || cz < 0 || cx >= this.cols || cy >= this.rows || cz >= this.layers) return -1;
    return cz * this.rows * this.cols + cy * this.cols + cx;
  }
  insert(b) {
    const R = b.currentMaxRadius();
    const minX = Math.floor((b.pos.x + this.w/2 - R) / this.cellSize);
    const maxX = Math.floor((b.pos.x + this.w/2 + R) / this.cellSize);
    const minY = Math.floor((b.pos.y + this.h/2 - R) / this.cellSize);
    const maxY = Math.floor((b.pos.y + this.h/2 + R) / this.cellSize);
    const minZ = Math.floor((b.pos.z + this.d/2 - R) / this.cellSize);
    const maxZ = Math.floor((b.pos.z + this.d/2 + R) / this.cellSize);
    for (let cz = minZ; cz <= maxZ; cz++) {
      for (let cy = minY; cy <= maxY; cy++) {
        for (let cx = minX; cx <= maxX; cx++) {
          const id = this._idx(cx, cy, cz);
          if (id >= 0) this.cells[id].push(b);
        }
      }
    }
  }
  pairs(out) {
    out.length = 0;
    for (const cell of this.cells) {
      const n = cell.length;
      if (n < 2) continue;
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
          const A = cell[a], B = cell[b];
          out.push(A.id < B.id ? [A, B] : [B, A]);
        }
      }
    }
    let stamp = ++UniformGrid._stamp;
    if (!UniformGrid._seen) UniformGrid._seen = new Map();
    const seen = UniformGrid._seen, filtered = [];
    for (const [a, b] of out) {
      const key = a.id * 131071 + b.id;
      if (seen.get(key) === stamp) continue;
      seen.set(key, stamp);
      filtered.push([a, b]);
    }
    out.length = 0;
    Array.prototype.push.apply(out, filtered);
  }
}
UniformGrid._stamp = 0;

/* ---------- BubbleSystem (3D) ---------- */
class BubbleSystem {
  constructor() {
    this.BOX_W = 900; this.BOX_H = 1200; this.BOX_D = 600;
    this.TARGET_COUNT = 12; this.COLLISION_ITERS = 12; this.FINAL_SWEEPS = 2;
    this.BUOY_UP = 35.0; this.DRAG = 0.25; this.DRIFT_ACC = 6.0;
    this.DRIFT_SCALE = 0.06; this.MAX_SPEED = 220;
    this.NOISE_AMP = 0.85; this.NOISE_SCALE = 0.08; this.NOISE_TIME_SPEED = 0.25;
    this.DENT_SIGMA = 0.8; this.DENT_DECAY = 18.0; this.MAX_DENT_FRAC = 0.006;
    this.POP_MIN_AGE = 4.0; this.POP_RATE = 0.04; this.POP_DURATION = 0.06;
    this.minR = 64; this.maxR = 164;
    this._id = 1; this.bubbles = [];
    for (let i = 0; i < this.TARGET_COUNT; i++) this.spawnBubble(true);
    this.grid = new UniformGrid(this.BOX_W, this.BOX_H, this.BOX_D, 250);
    this._pairBuf = []; this._depth = [];
  }
  setGridCellSize(s) { this.grid.resize(this.BOX_W, this.BOX_H, this.BOX_D, s); if (this._syncUI) this._syncUI(); }
  setTargetCount(n) {
    this.TARGET_COUNT = n;
    while (this.bubbles.length < this.TARGET_COUNT) this.spawnBubble(true);
    while (this.bubbles.length > this.TARGET_COUNT) {
      const b = this.bubbles.pop();
      if (b.mesh) scene.remove(b.mesh);
    }
    if (this._syncUI) this._syncUI();
  }
  setBubbleSize(minR, maxR) {
    minR = int(minR); maxR = int(maxR);
    if (maxR <= minR + 8) maxR = minR + 8;
    const pmin = this.minR, pmax = this.maxR;
    this.minR = constrain(minR, 40, 200); this.maxR = constrain(maxR, 60, 260);
    const oldSpan = max(1, pmax - pmin), newSpan = this.maxR - this.minR;
    for (const b of this.bubbles) {
      const t = (b.baseR - pmin) / oldSpan;
      b.baseR = this.minR + clamp01(t) * newSpan;
      b.mass = (4/3) * Math.PI * b.baseR * b.baseR * b.baseR;
      b.rebuildGeometry();
    }
    if (this._syncUI) this._syncUI();
  }
  updateGlassParams() {
    for (const b of this.bubbles) {
      if (b.material && b.material.uniforms) {
        b.material.uniforms.uChromaticAberration.value = glassParams.chromaticAberration;
        b.material.uniforms.uRefraction.value = glassParams.refraction;
        b.material.uniforms.uThickness.value = glassParams.thickness;
        b.material.uniforms.uIor.value = glassParams.ior;
      }
    }
  }
  nextId() { return this._id++; }
  sampleRadius() { return lerp(this.minR, this.maxR, Math.pow(random(), 0.2)); }
  sampleColor() { return random(PALETTE_RGB); }
  spawnBubble(initial = false) {
    const r = this.sampleRadius();
    const x = random(-this.BOX_W/2 + r + 20, this.BOX_W/2 - r - 20);
    const z = random(-this.BOX_D/2 + r + 20, this.BOX_D/2 - r - 20);
    const y = initial ? random(-this.BOX_H/4, this.BOX_H/2 - r - 20) : -this.BOX_H/2 - r - random(5, 40);
    const b = new Bubble3D(this, this.nextId(), createVector(x, y, z), r, this.sampleColor(),
      this.NOISE_AMP, this.NOISE_SCALE, this.NOISE_TIME_SPEED);
    b.vel.y = random(10, 25);
    this.bubbles.push(b);
  }
  update(dt) {
    if (this.bubbles.length < this.TARGET_COUNT) this.spawnBubble();
    for (const b of this.bubbles) {
      b.beginFrameContacts();
      b.applyForces(dt, this.BUOY_UP, this.DRAG, this.DRIFT_ACC, this.DRIFT_SCALE, this.MAX_SPEED);
      b.integrate(dt);
      this.applyBoundingBox(b);
    }
    for (let it = 0; it < this.COLLISION_ITERS; it++) {
      this.grid.clear();
      for (const b of this.bubbles) this.grid.insert(b);
      this.grid.pairs(this._pairBuf);
      this._depth.length = this._pairBuf.length;
      for (let k = 0; k < this._pairBuf.length; k++) {
        const [a, b] = this._pairBuf[k];
        const diff = p5.Vector.sub(b.pos, a.pos);
        const d = diff.mag() || 1e-9;
        this._depth[k] = (a.currentMaxRadius() + b.currentMaxRadius()) - d;
      }
      const order = [...this._pairBuf.keys()].sort((i, j) => this._depth[j] - this._depth[i]);
      let maxPen = 0;
      for (const idx of order) {
        const [a, b] = this._pairBuf[idx];
        maxPen = Math.max(maxPen, this.separatePair(a, b, dt));
      }
      if (maxPen <= 0.01) break;
    }
    for (let pass = 0; pass < this.FINAL_SWEEPS; pass++) {
      let any = false;
      for (let i = 0; i < this.bubbles.length; i++) {
        for (let j = i + 1; j < this.bubbles.length; j++) {
          const s = this.separatePair(this.bubbles[i], this.bubbles[j], dt);
          if (s > 0) any = true;
        }
      }
      if (!any) break;
    }
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.endFrameContacts(dt, this.DENT_DECAY);
      if (b.readyToRemove) {
        if (b.mesh) scene.remove(b.mesh);
        this.bubbles.splice(i, 1);
        this.spawnBubble();
      }
    }
  }
  separatePair(a, b, dt) {
    const diff = p5.Vector.sub(b.pos, a.pos);
    const d2 = diff.magSq();
    if (d2 <= 1e-9) return 0;
    const d = Math.sqrt(d2);
    const n = diff.copy().normalize();
    const Ra = a.currentMaxRadius(), Rb = b.currentMaxRadius();
    const minDist = Ra + Rb;
    if (d < minDist) {
      const overlap = minDist - d;
      const ma = a.mass, mb = b.mass, invM = 1.0 / (ma + mb);
      const pushA = overlap * (mb * invM), pushB = overlap * (ma * invM);
      a.pos.add(n.copy().mult(-pushA));
      b.pos.add(n.copy().mult(pushB));
      const rv = p5.Vector.sub(b.vel, a.vel);
      const vn = rv.dot(n);
      if (vn < 0) {
        const impulse = -vn * 0.6;
        const jA = impulse * (mb * invM), jB = impulse * (ma * invM);
        a.vel.add(n.copy().mult(-jA));
        b.vel.add(n.copy().mult(jB));
      }
      const contactA = a.pos.copy().add(n.copy().mult(Ra));
      const contactB = b.pos.copy().add(n.copy().mult(-Rb));
      a.addContactDent(b.id, contactA, overlap, this.DENT_SIGMA, this.MAX_DENT_FRAC);
      b.addContactDent(a.id, contactB, overlap, this.DENT_SIGMA, this.MAX_DENT_FRAC);
      return overlap;
    }
    return 0;
  }
  applyBoundingBox(b) {
    const R = b.currentMaxRadius();
    const minX = -this.BOX_W/2 + R + 6;
    if (b.pos.x < minX) { b.pos.x = minX; if (b.vel.x < 0) b.vel.x *= -0.2; }
    const maxX = this.BOX_W/2 - R - 6;
    if (b.pos.x > maxX) { b.pos.x = maxX; if (b.vel.x > 0) b.vel.x *= -0.2; }
    const minZ = -this.BOX_D/2 + R + 6;
    if (b.pos.z < minZ) { b.pos.z = minZ; if (b.vel.z < 0) b.vel.z *= -0.2; }
    const maxZ = this.BOX_D/2 - R - 6;
    if (b.pos.z > maxZ) { b.pos.z = maxZ; if (b.vel.z > 0) b.vel.z *= -0.2; }
    const maxY = this.BOX_H/2 - R - 6;
    if (b.pos.y > maxY) {
      const pen = b.pos.y - maxY;
      b.pos.y = maxY;
      if (b.vel.y > 0) b.vel.y = 0;
      const topPoint = b.pos.copy();
      topPoint.y += R;
      b.waterlineDent(-2, topPoint, pen, this.DENT_SIGMA, this.MAX_DENT_FRAC);
    }
  }
  updateThreeMeshes() { for (const b of this.bubbles) b.updateMesh(); }
}

/* ---------- Bubble3D with Glass Shader ---------- */
class Bubble3D {
  constructor(sys, id, pos, baseR, col, noiseAmp, noiseScale, noiseTimeSpeed) {
    this.sys = sys; this.id = id; this.pos = pos; this.vel = createVector(0, 0, 0);
    this.baseR = baseR; this.color = col;
    this.noiseAmp = noiseAmp; this.noiseScale = noiseScale;
    this.noiseT = random(1000); this.noiseTimeSpeed = noiseTimeSpeed;
    this.mass = (4/3) * Math.PI * this.baseR * this.baseR * this.baseR;
    this.dents = new Map(); this.activeKeys = new Set();
    this.age = 0; this.popping = false; this.popT = 0;
    this.popDuration = this.sys.POP_DURATION; this.readyToRemove = false;
    this.mesh = null; this.geometry = null; this.material = null; this.originalPositions = null;
    this.createMesh();
  }
  createMesh() {
    this.geometry = new THREE.IcosahedronGeometry(this.baseR, 4); // Higher subdivision for glass shader
    this.originalPositions = new Float32Array(this.geometry.attributes.position.array);

    // Glass shader material with chromatic aberration
    this.material = new THREE.ShaderMaterial({
      vertexShader: glassVertexShader,
      fragmentShader: glassFragmentShader,
      uniforms: {
        uTexture: { value: null },
        uResolution: { value: new THREE.Vector2(1080 * 2, 1440 * 2) },
        uChromaticAberration: { value: glassParams.chromaticAberration },
        uRefraction: { value: glassParams.refraction },
        uThickness: { value: glassParams.thickness },
        uIor: { value: glassParams.ior },
        uColor: { value: new THREE.Color(
          red(this.color) / 255,
          green(this.color) / 255,
          blue(this.color) / 255
        )}
      },
      transparent: true,
      side: THREE.DoubleSide
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
    scene.add(this.mesh);
  }
  rebuildGeometry() {
    if (!this.mesh) return;
    scene.remove(this.mesh);
    if (this.geometry) this.geometry.dispose();
    if (this.material) this.material.dispose();
    this.createMesh();
  }
  beginFrameContacts() { this.activeKeys.clear(); }
  applyForces(dt, BUOY, DRAG, DRIFT_ACC, DRIFT_SCALE, VMAX) {
    if (this.popping) return;
    let acc = createVector(0, BUOY, 0);
    const nx = noise(this.pos.x * DRIFT_SCALE, (this.pos.y + frameCount * 0.5) * DRIFT_SCALE, this.pos.z * DRIFT_SCALE);
    const nz = noise(this.pos.z * DRIFT_SCALE + 100, (this.pos.y + frameCount * 0.5) * DRIFT_SCALE);
    acc.x += DRIFT_ACC * ((nx - 0.5) * 2.0);
    acc.z += DRIFT_ACC * ((nz - 0.5) * 2.0);
    this.vel.add(p5.Vector.mult(acc, dt));
    this.vel.mult(Math.exp(-DRAG * dt));
    const sp = this.vel.mag();
    if (sp > VMAX) this.vel.normalize().mult(VMAX);
  }
  integrate(dt) {
    if (!this.popping) this.pos.add(p5.Vector.mult(this.vel, dt));
    this.age += dt;
    if (!this.popping && this.age > this.sys.POP_MIN_AGE && random() < this.sys.POP_RATE * dt) this.startPop();
    if (this.popping) {
      this.popT += dt;
      if (this.popT >= this.popDuration) this.readyToRemove = true;
    }
    this.noiseT += this.noiseTimeSpeed * dt;
  }
  startPop() { this.popping = true; this.vel.set(0, 0, 0); }
  popScale() {
    if (!this.popping) return 1;
    const t = constrain(this.popT / this.popDuration, 0, 1);
    return (1 - t) * (1 - t);
  }
  currentMaxRadius() { return Math.max(2, this.baseR * this.popScale()); }
  addContactDent(key, worldPos, overlap, sigma, maxFrac) {
    this.activeKeys.add(key);
    const R = this.baseR;
    const targetDepth = constrain(overlap / R, 0, maxFrac);
    const k = this.dents.get(key);
    if (k) {
      k.worldPos = worldPos.copy();
      k.target = Math.max(k.target, targetDepth);
      k.alive = 1.0;
    } else {
      this.dents.set(key, {
        worldPos: worldPos.copy(), strength: targetDepth * 0.8,
        target: targetDepth, sigma, alive: 1.0
      });
    }
  }
  waterlineDent(key, worldPos, pen, sigma, maxFrac) {
    this.addContactDent(key, worldPos, pen, sigma, maxFrac);
  }
  endFrameContacts(dt, decayRate) {
    for (const [key, d] of this.dents) {
      const isActive = this.activeKeys.has(key);
      if (isActive) {
        const rise = 1 - Math.exp(-6.0 * dt);
        d.strength = d.strength + (d.target - d.strength) * rise;
        d.target *= 0.98;
      } else {
        d.strength *= Math.exp(-decayRate * dt);
        d.target *= Math.exp(-decayRate * dt);
        d.alive *= Math.exp(-decayRate * 0.6 * dt);
        if (d.strength < 0.01 && d.target < 0.01) this.dents.delete(key);
      }
    }
  }
  updateMesh() {
    if (!this.mesh) return;
    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
    const scale = this.popScale();
    this.mesh.scale.set(scale, scale, scale);
    if (this.popping && this.material.uniforms) {
      this.material.uniforms.uColor.value.multiplyScalar(scale);
    }
    this.deformGeometry();
  }
  deformGeometry() {
    if (!this.geometry || !this.originalPositions) return;
    const positions = this.geometry.attributes.position.array;
    const vertexCount = positions.length / 3;
    for (let i = 0; i < vertexCount; i++) {
      const idx = i * 3;
      const ox = this.originalPositions[idx];
      const oy = this.originalPositions[idx + 1];
      const oz = this.originalPositions[idx + 2];
      const len = Math.sqrt(ox*ox + oy*oy + oz*oz);
      const nx = ox / len, ny = oy / len, nz = oz / len;
      const n = noise(nx * this.noiseScale + this.noiseT, ny * this.noiseScale + this.noiseT,
        nz * this.noiseScale + this.noiseT);
      const wobble = (n - 0.5) * 2.0 * this.noiseAmp;
      let dentSum = 0;
      for (const [, d] of this.dents) {
        if (d.alive <= 0) continue;
        const worldX = this.pos.x + ox, worldY = this.pos.y + oy, worldZ = this.pos.z + oz;
        const dx = worldX - d.worldPos.x, dy = worldY - d.worldPos.y, dz = worldZ - d.worldPos.z;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        const angDist = dist / this.baseR;
        const g = Math.exp(-0.5 * (angDist * angDist) / (d.sigma * d.sigma));
        dentSum += d.strength * g;
      }
      const R = this.baseR;
      let r = R * (1.0 + wobble) * (1.0 - dentSum);
      const minR = R * 0.35;
      if (r < minR) r = minR;
      positions[idx] = nx * r;
      positions[idx + 1] = ny * r;
      positions[idx + 2] = nz * r;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}

/* ---------- Recording ---------- */
function createCompositeCanvas() {
  const composite = document.createElement("canvas");
  composite.width = 1080 * 2;
  composite.height = 1440 * 2;
  const ctx = composite.getContext("2d");
  ctx.drawImage(bgCanvas.elt, 0, 0);
  ctx.drawImage(threeCanvas, 0, 0);
  return composite;
}

async function startRecording({ mode = "pngzip", fps = 30, secs = 5 } = {}) {
  REC.mode = mode;
  REC.fps = fps | 0;
  REC.secs = Math.max(0.1, +secs);
  REC.targetFrames = Math.max(1, Math.round(REC.fps * REC.secs));
  REC.frameCount = 0;

  if (mode === "pngzip") {
    await ensureJSZip();
    REC.zip = new JSZip();
    REC.zipReady = true;
  } else if (mode === "webm") {
    try {
      await ensureWebMWriter();
      REC.webmWriter = new WebMWriter({ quality: 0.95, frameRate: REC.fps, transparent: false });
    } catch (e) {
      console.error(e);
      alert("WebM export isn't available here. Falling back to PNG-ZIP.");
      return startRecording({ mode: "pngzip", fps, secs });
    }
  }

  REC.active = true;
  if (REC.startBtn) REC.startBtn.html("Stop recording (R)");
  REC.setStatus(`Recording… 0 / ${REC.targetFrames} frames`);
}

function addFrameToRecording() {
  if (!REC.active) return;
  const composite = createCompositeCanvas();

  if (REC.mode === "pngzip" && REC.zipReady && REC.zip) {
    const name = `frames/frame_${String(REC.frameCount).padStart(5, '0')}.png`;
    const dataURL = composite.toDataURL('image/png');
    const base64 = dataURL.split(',')[1] || "";
    REC.zip.file(name, base64, { base64: true });
    REC.frameCount++;
    REC.setStatus(`Recording… ${REC.frameCount} / ${REC.targetFrames} frames`);
    if (REC.frameCount >= REC.targetFrames) stopRecording();
  } else if (REC.mode === "webm" && REC.webmWriter) {
    try {
      REC.webmWriter.addFrame(composite);
      REC.frameCount++;
      REC.setStatus(`Recording… ${REC.frameCount} / ${REC.targetFrames} frames`);
      if (REC.frameCount >= REC.targetFrames) stopRecording();
    } catch (err) {
      console.error("WebM addFrame failed:", err);
      alert("WebM addFrame failed. Falling back to PNG-ZIP.");
      REC.active = false;
      startRecording({ mode: "pngzip", fps: REC.fps, secs: REC.secs });
    }
  }
}

async function stopRecording() {
  if (!REC.active) return;
  REC.active = false;
  if (REC.startBtn) REC.startBtn.html("Start recording (R)");

  if (REC.mode === "pngzip" && REC.zipReady && REC.zip) {
    REC.setStatus("Finalizing ZIP…");
    const zipBlob = await REC.zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 }});
    const url = URL.createObjectURL(zipBlob);
    triggerDownload(url, "bubbles_glass_3d.zip");
    REC.zip = null; REC.zipReady = false;
    REC.setStatus("Saved PNG-ZIP");
  } else if (REC.mode === "webm" && REC.webmWriter) {
    REC.setStatus("Finalizing WebM…");
    try {
      const blob = await REC.webmWriter.complete();
      const url = URL.createObjectURL(blob);
      triggerDownload(url, "bubbles_glass_3d.webm");
      REC.setStatus("Saved WebM");
    } catch (e) {
      console.error(e);
      alert("WebM finalize failed. Try PNG-ZIP.");
      REC.setStatus("WebM failed");
    } finally {
      REC.webmWriter = null;
    }
  } else {
    REC.setStatus("Not recording.");
  }
}

function triggerDownload(url, filename) {
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
