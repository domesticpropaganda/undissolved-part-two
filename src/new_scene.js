import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class Scene {
  // ---- Centralized Constants ----
  static PARTICLE_SHAPE_COUNT = 5; // Number of mesh shapes (now matches mesh files)
  static PARTICLE_TARGET_SIZE = 0.09;
  static PARTICLE_MIN_WIDTH = 0.06;
  static PARTICLE_MIN_DEPTH = 0.045;
  static PARTICLE_DETACH_DURATION = 1200;
  static PARTICLE_REATTACH_DURATION = 1200;
  static CAMERA_ANIM_DURATION = 900;
  static SPIN_EASE_DURATION = 900;
  static SHARED_ORBIT_DTHETA = 0.004;
  static DETACHMENT_SCALE_MAX = 3;
  static CUBE_COLOR = 0x3C414A;
  static OVERLAY_FADE_DURATION = 700;
  static OUTRO_FADE_DURATION = 800;
  static SWIPE_THRESHOLD = 60;
  static INTRO_FADE_DURATION = 700;
  static MORPH_DURATION = 2000;
  static POINT_SIZE = 0.1;
  /**
   * Generate spherical detachment targets for a timeline step.
   * @param {number} step - Timeline step index
   * @param {number} count - Number of particles
   * @param {number} detachmentScale - Scale factor for shell radius
   * @returns {Array<[number, number, number]>} Array of [x, y, z] positions
   */
  _generateSphericalDetachTargets(step, count, detachmentScale) {
    const targets = [];
    for (let i = 0; i < count; i++) {
      const randomFactor = 1 + (Math.random() - 0.5) * 0.2;
      const r = detachmentScale * randomFactor;
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const sx = r * Math.sin(phi) * Math.cos(theta);
      const sy = r * Math.sin(phi) * Math.sin(theta);
      const sz = r * Math.cos(phi);
      targets[i] = [sx, sy, sz];
    }
    return targets;
  }
  // Helper to reset typewriter animation
  _resetTypewriterAnimation() {
    if (typeof window.resetTypewriterAnimation === 'function') {
      window.resetTypewriterAnimation();
    }
  }
  // Helper to show overlay with fade-in
  _showOverlay(overlay, { display = '', opacity = '1', duration = 700 } = {}) {
    if (!overlay) return;
    overlay.style.display = display;
    void overlay.offsetWidth;
    overlay.style.transition = `opacity ${duration / 1000}s`;
    overlay.style.opacity = opacity;
    overlay.style.pointerEvents = 'auto';
  }

  // Helper to hide overlay with fade-out
  _hideOverlay(overlay, { display = 'none', opacity = '0', duration = 700 } = {}) {
    if (!overlay) return;
    overlay.style.transition = `opacity ${duration / 1000}s`;
    overlay.style.opacity = opacity;
    overlay.style.pointerEvents = 'none';
    setTimeout(() => {
      overlay.style.display = display;
    }, duration);
  }
  // Helper to initialize and shuffle detachment indices
  _initDetachmentIndices() {
    const count = this._instancedParticleCount;
    this._detachmentIndices = Array.from({ length: count }, (_, i) => i);
    for (let i = this._detachmentIndices.length - 1; i > 0; i--) {
      const j = Math.floor(i * 1337 % (i + 1));
      [this._detachmentIndices[i], this._detachmentIndices[j]] = [this._detachmentIndices[j], this._detachmentIndices[i]];
    }
  }
  constructor() {
    // Always hide outro overlay on startup to prevent flash
    const outro = document.getElementById('outro-overlay');
    if (outro) {
      outro.style.display = 'none';
      outro.style.opacity = '0';
      outro.style.pointerEvents = 'none';
    }
    // --- Preloader setup ---
    this.preloader = document.createElement('div');
    this.preloader.id = 'preloader';
    this.preloader.style.position = 'fixed';
    this.preloader.style.top = '0';
    this.preloader.style.left = '0';
    this.preloader.style.width = '100vw';
    this.preloader.style.height = '100vh';
    this.preloader.style.display = 'flex';
    this.preloader.style.alignItems = 'center';
    this.preloader.style.justifyContent = 'center';
    this.preloader.style.background = 'rgba(0,0,0,0.85)';
    this.preloader.style.zIndex = '9999';
    this.preloaderText = document.createElement('span');
    this.preloaderText.style.color = 'white';
    this.preloaderText.style.fontSize = 'min(2rem, 6vw)';
    this.preloaderText.textContent = 'Loading...';
    this.preloader.appendChild(this.preloaderText);
    document.body.appendChild(this.preloader);

    this.initScene();
    this.setupIntroOverlay();
    this._initialCloudPositions = null;
    this.currentLevel = -1; // -1 = mesh, 0+ = timeline levels
    this.isAnimating = false;
    this.timeline = [];
    this.totalItems = 0;
    this.meshObj = null;
    // Preload particle meshes before app initialization
    this._particleMeshFiles = [
      'tee.glb',
      'shirt.glb',
      'pants.glb',
      'sneaks.glb',
      'sweat.glb'
    ];
    this._particleMeshGeometries = [];
    this.preloadParticleMeshes().then(() => {
      this.loadAssets().then(() => {
        // Show mesh as points for intro (human made of particles)
        this.showMeshAsPoints();
        this.showInitialCloud(); // Generate cloud positions for morphing
        this.totalItems = this.timeline.length > 0 ? this.timeline[this.timeline.length - 1].items_consumed : 1;
        this.setupNavigation();
        this.updateTimelineOverlay(-1); // Hide overlay initially
        if (this.preloader) this.preloader.remove();
        console.log('Assets loaded and mesh displayed');
      });
    });
    this.animate();
  }

  // Helper to fade overlays
  async _fadeOverlay(overlay, { opacity, display, duration = 700 }) {
    if (!overlay) return;
    overlay.style.transition = `opacity ${duration / 1000}s`;
    overlay.style.opacity = opacity;
    if (display !== undefined) {
      setTimeout(() => { overlay.style.display = display; }, duration);
    }
    // Wait for fade out if opacity is 0
    if (opacity === '0') {
      await new Promise(res => setTimeout(res, duration));
    }
  }

  // Helper to set camera animation
  _setCameraAnim(from, to, duration = 900) {
    this._cameraAnim = {
      from: { ...from },
      to: { ...to },
      start: performance.now(),
      duration,
      active: true
    };
  }

  // Preload GLB meshes for 3D particles
  async preloadParticleMeshes() {
    const loader = new GLTFLoader();
    const meshDir = 'assets/models/';
    const files = this._particleMeshFiles;
    this._particleMeshGeometries = [];
    console.log('[Mesh Preloader] Preloading particle meshes:', files);
    for (let i = 0; i < files.length; i++) {
      try {
        const gltf = await new Promise((resolve, reject) => {
          loader.load(meshDir + files[i], resolve, undefined, reject);
        });
        let meshGeom = null;
        gltf.scene.traverse((child) => {
          if (child.isMesh && child.geometry && !meshGeom) meshGeom = child.geometry.clone();
        });
        if (meshGeom) {
          // Center geometry
          meshGeom.computeBoundingBox();
          const bbox = meshGeom.boundingBox;
          const center = new THREE.Vector3();
          bbox.getCenter(center);
          meshGeom.translate(-center.x, -center.y, -center.z);
          // Uniform scale to fit within a slightly larger box (0.09)
          const size = new THREE.Vector3();
          bbox.getSize(size);
          const maxDim = Math.max(size.x, size.y, size.z);
          const targetSize = Scene.PARTICLE_TARGET_SIZE;
          let scale = maxDim > 0 ? targetSize / maxDim : 1;
          meshGeom.scale(scale, scale, scale);
          // --- Hybrid scaling: ensure minimum width/depth ---
          meshGeom.computeBoundingBox();
          const bbox2 = meshGeom.boundingBox;
          const minWidth = Scene.PARTICLE_MIN_WIDTH;
          const minDepth = Scene.PARTICLE_MIN_DEPTH;
          const size2 = new THREE.Vector3();
          bbox2.getSize(size2);
          let rescale = 1;
          if (size2.x < minWidth || size2.z < minDepth) {
            // Find the factor needed to bring the smallest axis up to threshold
            const scaleX = size2.x < minWidth ? minWidth / size2.x : 1;
            const scaleZ = size2.z < minDepth ? minDepth / size2.z : 1;
            rescale = Math.max(scaleX, scaleZ);
            meshGeom.scale(rescale, rescale, rescale);
            meshGeom.computeBoundingBox();
          }
          // Rotate 90 degrees on X axis, then 90 degrees on Y axis
          const rotMatrixX = new THREE.Matrix4().makeRotationX(Math.PI / 2);
          const rotMatrixY = new THREE.Matrix4().makeRotationY(Math.PI / 2);
          // Additional: rotate -45deg on Y axis (clockwise)
          const rotMatrixYNeg45 = new THREE.Matrix4().makeRotationY(-Math.PI / 4);
          meshGeom.applyMatrix4(rotMatrixX);
          meshGeom.applyMatrix4(rotMatrixY);
          meshGeom.applyMatrix4(rotMatrixYNeg45);
          meshGeom.computeBoundingBox();
          this._particleMeshGeometries.push(meshGeom);
          console.log(`[Mesh Preloader] Loaded, normalized, rotated: ${files[i]}`);
        } else {
          this._particleMeshGeometries.push(new THREE.BoxGeometry(Scene.PARTICLE_MIN_WIDTH, Scene.PARTICLE_MIN_WIDTH, Scene.PARTICLE_MIN_WIDTH));
          console.warn(`[Mesh Preloader] Mesh not found in GLB: ${files[i]}`);
        }
      } catch (err) {
        console.error('[Mesh Preloader] Failed to load particle mesh:', files[i], err);
        this._particleMeshGeometries.push(new THREE.BoxGeometry(0.07, 0.07, 0.07));
      }
    }
    console.log('[Mesh Preloader] All particle meshes preloaded:', this._particleMeshGeometries.length);
  }

  // Show mesh as points (for intro: human made of particles)
  async showMeshAsPoints() {
    // Remove mesh if present
    if (this.meshObj && this.meshObj.parent === this.scene) {
      this.scene.remove(this.meshObj);
    }
    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      this.points.material.dispose();
      this.points = null;
    }
    // Remove previous instanced meshes if any
    if (this._particleMeshes) {
      for (const mesh of this._particleMeshes) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    }
    if (!this._meshPositions) return;
    // --- InstancedMesh version: use preloaded GLB meshes for particles ---
    let geometries;
    if (this._particleMeshGeometries && this._particleMeshGeometries.length === Scene.PARTICLE_SHAPE_COUNT) {
      geometries = this._particleMeshGeometries;
    } else {
      // Fallback: fill with primitives for missing meshes
      geometries = [];
      for (let i = 0; i < Scene.PARTICLE_SHAPE_COUNT; i++) {
        if (this._particleMeshGeometries && this._particleMeshGeometries[i]) {
          geometries.push(this._particleMeshGeometries[i]);
        } else {
          // Use different primitive for each missing mesh
          if (i % 3 === 0) {
            geometries.push(new THREE.BoxGeometry(Scene.PARTICLE_MIN_WIDTH, Scene.PARTICLE_MIN_WIDTH, Scene.PARTICLE_MIN_WIDTH));
          } else if (i % 3 === 1) {
            geometries.push(new THREE.SphereGeometry(Scene.PARTICLE_MIN_DEPTH, 8, 8));
          } else {
            geometries.push(new THREE.ConeGeometry(Scene.PARTICLE_MIN_WIDTH, Scene.PARTICLE_TARGET_SIZE, 4));
          }
        }
      }
    }
    const baseMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.5,
      metalness: 0.1
    });
    const count = this._meshPositions.length / 3;
    // Assign a random shape to each particle
    this._particleShapeIndices = [];
    for (let i = 0; i < count; i++) {
      this._particleShapeIndices[i] = Math.floor(Math.random() * Scene.PARTICLE_SHAPE_COUNT);
    }
    // Count per shape
    const shapeCounts = Array(Scene.PARTICLE_SHAPE_COUNT).fill(0);
    for (let i = 0; i < count; i++) shapeCounts[this._particleShapeIndices[i]]++;
    // Create InstancedMeshes
    this._particleMeshes = [];
    for (let shape = 0; shape < Scene.PARTICLE_SHAPE_COUNT; shape++) {
      const mesh = new THREE.InstancedMesh(geometries[shape], baseMaterial.clone(), shapeCounts[shape]);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(mesh);
      this._particleMeshes.push(mesh);
    }
    // Store mapping: for each shape, which instance index is which particle
    this._particleInstanceMap = Array(Scene.PARTICLE_SHAPE_COUNT).fill().map(() => []);
    const instanceIndices = Array(Scene.PARTICLE_SHAPE_COUNT).fill(0);
    for (let i = 0; i < count; i++) {
      const shape = this._particleShapeIndices[i];
      this._particleInstanceMap[shape][instanceIndices[shape]] = i;
      instanceIndices[shape]++;
    }
    // Set initial transforms and colors
    for (let shape = 0; shape < Scene.PARTICLE_SHAPE_COUNT; shape++) {
      let mesh = this._particleMeshes[shape];
      let idx = 0;
      for (let i = 0; i < count; i++) {
        if (this._particleShapeIndices[i] !== shape) continue;
        const x = this._meshPositions[i * 3];
        const y = this._meshPositions[i * 3 + 1];
        const z = this._meshPositions[i * 3 + 2];
        const matrix = new THREE.Matrix4().makeTranslation(x, y, z);
        mesh.setMatrixAt(idx, matrix);
        mesh.setColorAt(idx, new THREE.Color(1, 1, 1));
        idx++;
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    // Store for animation loop
    this.points = null; // No longer using Points
    this._instancedParticleCount = count;
    this._instancedMeshesReady = true;
    // Lighting (add a soft ambient and directional if not present)
    if (!this._particleLight) {
      this._particleLight = new THREE.AmbientLight(0xffffff, 0.7);
      this.scene.add(this._particleLight);
      this._particleDirLight = new THREE.DirectionalLight(0xffffff, 0.5);
      this._particleDirLight.position.set(2, 4, 2);
      this.scene.add(this._particleDirLight);
    }
  }

  // End of constructor's .then()

  async loadAssets() {
    const loader = new GLTFLoader();

    // Load timeline JSON
    try {
      const response = await fetch('assets/data/plastikwelt_timeline.json');
      this.timeline = await response.json();
      console.log('Timeline JSON loaded:', this.timeline);
    } catch (error) {
      console.error('Failed to load timeline JSON:', error);
    }

    // Load human.glb mesh
    try {
      this.mesh = await new Promise((resolve, reject) => {
        loader.load('assets/models/human.glb', resolve, undefined, reject);
      });
      console.log('human.glb mesh loaded');
      // Find mesh object and sample 3000 positions
      this.meshObj = null;
      this.mesh.scene.traverse((child) => {
        if (child.isMesh && child.geometry && !this.meshObj) this.meshObj = child;
      });
      if (
        this.meshObj &&
        this.meshObj.geometry &&
        this.meshObj.geometry.attributes &&
        this.meshObj.geometry.attributes.position &&
        this.meshObj.geometry.attributes.position.array
      ) {
        const meshPositions = this.meshObj.geometry.attributes.position.array;
        this._meshPositions = [];
        // Determine number of particles from timeline data
        // Always set particleCount to the total of items_consumed in the timeline (if available)
        let particleCount = 1500;
        if (this.timeline && this.timeline.length > 0) {
          particleCount = this.timeline.reduce((sum, t) => sum + (t.items_consumed || 0), 0);
        }
        for (let i = 0; i < particleCount; i++) {
          const idx = (i * 3) % meshPositions.length;
          this._meshPositions.push(meshPositions[idx], meshPositions[idx + 1], meshPositions[idx + 2]);
        }
      } else {
        console.error('GLB mesh does not have geometry/position data');
      }
    } catch (error) {
      console.error('Failed to load human.glb mesh:', error);
    }
  }


  initScene() {
    // Renderer setup
    if (!document.getElementById('three-canvas')) {
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.domElement.id = 'three-canvas';
      document.body.appendChild(this.renderer.domElement);
    } else {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, canvas: document.getElementById('three-canvas') });
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
this.renderer.setClearColor(0x181A1E, 1); // for black, or use any color you want
    // Scene and camera setup
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    // Set camera to top-right view
    this.camera.position.set(1.25, 1.25, 1.25);
    this._baseCameraPos = { x: 1.25, y: 1.25, z: 1.25 }; // Save for later reference
    this.camera.lookAt(0, 0, 0);

    // Debug helpers (uncomment for debugging)
    // const gridHelper = new THREE.GridHelper(10, 10);
    // this.scene.add(gridHelper);
    // const axesHelper = new THREE.AxesHelper(5);
    // this.scene.add(axesHelper);

    // Handle window resize
    window.addEventListener('resize', () => this.onResize());
  }

  showMesh() {
    // Remove cloud if present
    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      this.points.material.dispose();
      this.points = null;
    }
    // Add mesh if loaded
    if (this.mesh && !this.meshObj) {
      this.meshObj = null;
      this.mesh.scene.traverse((child) => {
        if (child.isMesh && child.geometry && !this.meshObj) this.meshObj = child;
      });
      if (this.meshObj) {
        this.scene.add(this.meshObj);
      }
    } else if (this.meshObj) {
      this.scene.add(this.meshObj);
    }
  }

  showInitialCloud() {
    // Generate 3000 random cloud positions
    this._cloudPositions = [];
    const radius = 5;
    for (let i = 0; i < 3000; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = radius * Math.cbrt(Math.random());
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);
      this._cloudPositions.push(x, y, z);
    }
  }

  morphToCloud() {
    if (!this._meshPositions || !this._cloudPositions) return;
    // Remove mesh if present
    if (this.meshObj && this.meshObj.parent === this.scene) {
      this.scene.remove(this.meshObj);
    }
    // Remove old points
    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      this.points.material.dispose();
      this.points = null;
    }
    // Create new points geometry from mesh positions
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this._meshPositions, 3));
    
    // Add color attribute for RGBA (for depth of field alpha)
    const colors = new Float32Array(this._meshPositions.length / 3 * 4);
    for (let i = 0; i < this._meshPositions.length / 3; i++) {
      colors[i * 4 + 0] = 1.0;
      colors[i * 4 + 1] = 1.0;
      colors[i * 4 + 2] = 1.0;
      colors[i * 4 + 3] = 1.0;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    const material = new THREE.PointsMaterial({ size: Scene.POINT_SIZE, vertexColors: true, transparent: true });
    this.points = new THREE.Points(geometry, material);
    this.scene.add(this.points);
    // Animate mesh points to cloud positions
    const positions = this.points.geometry.attributes.position;
    const start = this._meshPositions.slice();
    const end = this._cloudPositions.slice();
    this.animateMorph(start, end, positions);
  }

  morphToMesh() {
    if (!this._meshPositions || !this._cloudPositions || !this.points) return;
    // Animate cloud points to mesh positions
    const positions = this.points.geometry.attributes.position;
    const start = this._cloudPositions.slice();
    const end = this._meshPositions.slice();
    for (let i = 0; i < positions.count; i++) {
      start[i * 3] = positions.getX(i);
      start[i * 3 + 1] = positions.getY(i);
      start[i * 3 + 2] = positions.getZ(i);
    }
    this.animateMorph(start, end, positions, () => {
      // Remove cloud and show mesh
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      this.points.material.dispose();
      this.points = null;
      if (this.meshObj && this.meshObj.parent !== this.scene) {
        this.scene.add(this.meshObj);
      }
    });
  }

  animateMorph(start, end, positions, onComplete) {
    const duration = Scene.MORPH_DURATION;
    const startTime = performance.now();
    const animate = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      for (let i = 0; i < positions.count; i++) {
        const idx = i * 3;
        positions.setXYZ(
          i,
          start[idx] + (end[idx] - start[idx]) * t,
          start[idx + 1] + (end[idx + 1] - start[idx + 1]) * t,
          start[idx + 2] + (end[idx + 2] - start[idx + 2]) * t
        );
      }
      positions.needsUpdate = true;
      if (t < 1) {
        requestAnimationFrame(animate);
      } else if (onComplete) {
        onComplete();
      }
    };
    animate();
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  animate() {
    // Centralized camera animation logic
    if (!this._cameraAnim) {
      this._cameraAnim = {
        from: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
        to: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
        start: performance.now(),
        duration: 0,
        active: false
      };
    }
    // Only animate if active
    if (this._cameraAnim.active) {
      let t = Math.min((performance.now() - this._cameraAnim.start) / this._cameraAnim.duration, 1);
      // Use cubic ease-in-out
      t = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.camera.position.x = this._cameraAnim.from.x + (this._cameraAnim.to.x - this._cameraAnim.from.x) * t;
      this.camera.position.y = this._cameraAnim.from.y + (this._cameraAnim.to.y - this._cameraAnim.from.y) * t;
      this.camera.position.z = this._cameraAnim.from.z + (this._cameraAnim.to.z - this._cameraAnim.from.z) * t;
      this.camera.lookAt(0, 0, 0);
      // console.log('[animate] Camera animating. t:', t.toFixed(3), 'from:', this._cameraAnim.from, 'to:', this._cameraAnim.to, 'current:', {x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z});
      if (t >= 1) {
        this._cameraAnim.active = false;
        // console.log('[animate] Camera animation complete. Final position:', {x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z});
      }
    }
    // If not animating, just set to target
    else {
      this.camera.position.x = this._cameraAnim.to.x;
      this.camera.position.y = this._cameraAnim.to.y;
      this.camera.position.z = this._cameraAnim.to.z;
      this.camera.lookAt(0, 0, 0);
    }

    // --- Per-particle spinning for detached particles (InstancedMesh version) ---
    if (this._isMorphingToIntro || this._isMorphingDetach) {
      // Skip per-particle logic during morph to intro or detachment animation
    } else if (this._particleMeshes && this._detachmentIndices && this.timeline && this.currentLevel >= 0) {
      // Determine which particles are detached at this level
      const data = this.timeline[this.currentLevel];
      const percent = data && this.totalItems ? (data.items_consumed / this.totalItems) : 0;
      const count = this._instancedParticleCount;
      const detachCount = Math.floor(count * percent);
      const detachedSet = new Set(this._detachmentIndices.slice(0, detachCount));

      // --- Animate reattaching particles ---
      if (!this._reattachAnimations) this._reattachAnimations = {};
      if (!this._reattachAnimationActive) this._reattachAnimationActive = false;
      if (!this._particleSpinState) this._particleSpinState = {};
      if (!this._particleSpinTargetLevel) this._particleSpinTargetLevel = {};
      if (!this._sphericalDetachTargets) this._sphericalDetachTargets = {};
      if (!this._sphericalDetachTargets[this.currentLevel]) {
        // fallback: use previous targets if not present
        this._sphericalDetachTargets[this.currentLevel] = [];
      }

      // --- Find particles that are reattaching (were spinning, now not detached) ---
      for (let i = 0; i < count; i++) {
        const wasSpinning = this._particleSpinState[i] !== undefined;
        const shouldSpin = detachedSet.has(i);
        if (wasSpinning && !shouldSpin && !this._reattachAnimations[i]) {
          // Start reattach animation for this particle
          let from;
          if (this._particleSpinState[i]) {
            const s = this._particleSpinState[i];
            const x = s.orbitRadius * Math.cos(s.theta);
            const z = s.orbitRadius * Math.sin(s.theta);
            const y = s.y;
            from = [x, y, z];
          } else {
            from = [this._meshPositions[i*3], this._meshPositions[i*3+1], this._meshPositions[i*3+2]];
          }
          const to = [this._meshPositions[i*3], this._meshPositions[i*3+1], this._meshPositions[i*3+2]];
          this._reattachAnimations[i] = {
            from,
            to,
            start: performance.now(),
            duration: 1200
          };
        }
      }

      // --- Initialize per-particle spin state only for newly detached particles ---
      for (let i = 0; i < count; i++) {
        if (detachedSet.has(i)) {
          // Only initialize spin state if not already spinning, and only after detachment animation is complete
          if (!this._particleSpinState[i] && !this._detachAnimations[i] && this._detachAnimationCompleted && this._detachAnimationCompleted[i]) {
            // Use the detached target as the base position
            const [x, y, z] = this._sphericalDetachTargets[this.currentLevel][i] || [0, 0, 0];
            // Calculate radius in XZ plane from origin
            const radius = Math.sqrt(x * x + z * z);
            // Calculate initial angle in XZ plane
            let theta = Math.atan2(z, x);
            // Shared angular speed for all particles
            if (this._sharedOrbitDTheta === undefined) {
              this._sharedOrbitDTheta = 0.004;
            }
            const dTheta = this._sharedOrbitDTheta;
            this._particleSpinState[i] = {
              theta,
              dTheta,
              y: y, // keep y fixed
              orbitRadius: radius, // fixed radius after detachment
              spinning: true
            };
            this._particleSpinTargetLevel[i] = this.currentLevel;
          }
        } else {
          // If particle is no longer detached and not animating, remove its spin state
          if (this._particleSpinState[i] && !this._reattachAnimations[i]) {
            delete this._particleSpinState[i];
            delete this._particleSpinTargetLevel[i];
          }
        }
      }

      // --- Animate spinning and reattaching for detached particles (Z axis only) ---
      let now = performance.now();
      let anyReattaching = false;
      // Easing function for ease-in (cubic)
      function easeInCubic(t) { return t * t * t; }
      const SPIN_EASE_DURATION = Scene.SPIN_EASE_DURATION;

      // Prepare per-shape instance index
      const shapeCounts = Array(Scene.PARTICLE_SHAPE_COUNT).fill(0);
      for (let i = 0; i < count; i++) shapeCounts[this._particleShapeIndices[i]]++;
      const instanceIndices = Array(Scene.PARTICLE_SHAPE_COUNT).fill(0);

      // For color fading
    //   const targetRed = new THREE.Color(1.0, 0.0, 56/255);
      const targetRed = new THREE.Color(Scene.CUBE_COLOR);
      const white = new THREE.Color(1, 1, 1);

      // For each particle, update its instance matrix and color
      // Reset detach animation state for all particles that are not detached this frame
      if (!this._detachAnimations) this._detachAnimations = {};
      if (!this._detachAnimationCompleted) this._detachAnimationCompleted = {};
      for (let i = 0; i < count; i++) {
        if (!detachedSet.has(i)) {
          if (this._detachAnimations[i]) delete this._detachAnimations[i];
          if (this._detachAnimationCompleted[i]) delete this._detachAnimationCompleted[i];
        }
      }

      for (let i = 0; i < count; i++) {
        const shape = this._particleShapeIndices[i];
        const mesh = this._particleMeshes[shape];
        const idx = instanceIndices[shape];
        let matrix = new THREE.Matrix4();
        let color = new THREE.Color();
        if (detachedSet.has(i)) {
          // Animate detached particles to their target position (spherical shell)
          let s = this._particleSpinState[i];
          let detachTarget = this._sphericalDetachTargets[this.currentLevel][i] || [0, 0, 0];
          // If spinning, animate in orbit; else, animate to target
          if (s) {
            if (!s.spinStartTime) s.spinStartTime = now;
            let spinElapsed = now - s.spinStartTime;
            let ease = 1.0;
            if (spinElapsed < SPIN_EASE_DURATION) {
              ease = easeInCubic(Math.min(spinElapsed / SPIN_EASE_DURATION, 1));
            }
            s.theta += s.dTheta * ease;
            const x = s.orbitRadius * Math.cos(s.theta);
            const z = s.orbitRadius * Math.sin(s.theta);
            const y = s.y;
            matrix.makeTranslation(x, y, z);
            // Fade color to red
            color.copy(white).lerp(targetRed, ease);
          } else {
            // Animate from mesh position to detach target
            if (!this._detachAnimations[i]) {
              this._detachAnimations[i] = {
                from: [this._meshPositions[i*3], this._meshPositions[i*3+1], this._meshPositions[i*3+2]],
                to: detachTarget,
                start: now,
                duration: 1200
              };
            }
            let anim = this._detachAnimations[i];
            const t = Math.min((now - anim.start) / anim.duration, 1);
            const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
            const easedT = easeOutCubic(t);
            const from = anim.from;
            const to = anim.to;
            const x = from[0] + (to[0] - from[0]) * easedT;
            const y = from[1] + (to[1] - from[1]) * easedT;
            const z = from[2] + (to[2] - from[2]) * easedT;
            matrix.makeTranslation(x, y, z);
            // No color transition during detachment animation; always white
            color.copy(white);
            if (t >= 1) {
              this._detachAnimationCompleted[i] = true;
              delete this._detachAnimations[i];
            }
          }
        } else if (this._reattachAnimations[i]) {
          // If reattaching, clear detach animation state
          if (this._detachAnimations[i]) delete this._detachAnimations[i];
          if (this._detachAnimationCompleted[i]) delete this._detachAnimationCompleted[i];
          // If reattaching, clear detach animation state
          if (this._detachAnimations && this._detachAnimations[i]) delete this._detachAnimations[i];
          if (this._detachAnimationCompleted && this._detachAnimationCompleted[i]) delete this._detachAnimationCompleted[i];
          anyReattaching = true;
          const anim = this._reattachAnimations[i];
          const t = Math.min((now - anim.start) / anim.duration, 1);
          const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
          const easedT = easeOutCubic(t);
          const from = anim.from;
          const to = anim.to;
          const x = from[0] + (to[0] - from[0]) * easedT;
          const y = from[1] + (to[1] - from[1]) * easedT;
          const z = from[2] + (to[2] - from[2]) * easedT;
          matrix.makeTranslation(x, y, z);
          // Fade color back to white
          color.copy(targetRed).lerp(white, easedT);
          if (t >= 1) {
            delete this._reattachAnimations[i];
            if (this._particleSpinState[i]) delete this._particleSpinState[i];
            if (this._particleSpinTargetLevel[i]) delete this._particleSpinTargetLevel[i];
          }
        } else {
          // Not spinning or reattaching: use mesh position and white color
          const x = this._meshPositions[i*3];
          const y = this._meshPositions[i*3+1];
          const z = this._meshPositions[i*3+2];
          matrix.makeTranslation(x, y, z);
          color.copy(white);
        }
        mesh.setMatrixAt(idx, matrix);
        mesh.setColorAt(idx, color);
        instanceIndices[shape]++;
      }
      // Mark all instance matrices/colors as needing update
      for (let shape = 0; shape < Scene.PARTICLE_SHAPE_COUNT; shape++) {
        this._particleMeshes[shape].instanceMatrix.needsUpdate = true;
        if (this._particleMeshes[shape].instanceColor) this._particleMeshes[shape].instanceColor.needsUpdate = true;
      }
      this._reattachAnimationActive = anyReattaching;
    } else {
      // If not spinning, clear spin state
      this._particleSpinState = null;
      this._particleSpinTargetLevel = null;
      this._reattachAnimations = null;
      this._reattachAnimationActive = false;
    }

    // Depth of field: fade distant particles (if points exist)
    if (this.points) {
      const positions = this.points.geometry.attributes.position;
      const colors = this.points.geometry.attributes.color;
      for (let i = 0; i < positions.count; i++) {
        const px = positions.getX(i);
        const py = positions.getY(i);
        const pz = positions.getZ(i);
        const dx = px - this.camera.position.x;
        const dy = py - this.camera.position.y;
        const dz = pz - this.camera.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        // You can tweak the numbers below for different focus/falloff
        const alpha = THREE.MathUtils.clamp(1.5 - dist * 0.25, 0.2, 1.0);
        colors.setW(i, alpha);
      }
      colors.needsUpdate = true;
    }

    // Rotate the cube if it exists
    if (this.cube) {
      this.cube.rotation.x += 0.01;
      this.cube.rotation.y += 0.01;
    }

    // Render the scene
    this.renderer.render(this.scene, this.camera);

    // Request the next frame
    requestAnimationFrame(() => this.animate());
  }

  // Call this to enable/disable shared orbit for detached particles
  setParticleOrbitActive(detachIndices, orbitLevel = 0) {
    // detachIndices: Set of indices of detached particles
    // orbitLevel: timeline step (0-based)
    if (!detachIndices || detachIndices.size === 0) {
      this._orbitSharedBase = null;
      this._orbitDetachedIndices = null;
      this._orbitLevel = 0;
      return;
    }
    // Store base positions for detached particles
    const positions = this.points.geometry.attributes.position;
    this._orbitSharedBase = {};
    this._orbitDetachedIndices = new Set(detachIndices);
    this._orbitLevel = orbitLevel;
    for (let i of detachIndices) {
      this._orbitSharedBase[i] = [positions.getX(i), positions.getY(i), positions.getZ(i)];
    }
  }

  setupIntroOverlay() {
    this._introDone = false;
    // Bind the shared handler once
    this._handleFadeOutIntro = this._handleFadeOutIntro?.bind(this) || this.handleFadeOutIntro.bind(this);
    const introOverlay = document.getElementById('intro-overlay');
    if (introOverlay) {
      window.addEventListener('scroll', this._handleFadeOutIntro);
      window.addEventListener('wheel', this._handleFadeOutIntro);
    } else {
      window.addEventListener('scroll', this._handleFadeOutIntro);
      window.addEventListener('wheel', this._handleFadeOutIntro);
    }
  }

  async handleFadeOutIntro(e) {
    const introOverlay = document.getElementById('intro-overlay');
    // Only allow scroll down (wheel/touch/scroll) to trigger, ignore scroll up
    if (this.isAnimating || this._swipeLocked || this._introDone) return;
    // If event is wheel, only allow deltaY > 0 (scroll down)
    if (e && e.type === 'wheel' && e.deltaY <= 0) return;
    // If event is scroll, only allow if user has scrolled down from the top
    if (e && e.type === 'scroll' && window.scrollY === 0) return;
    // If event is undefined (programmatic), allow

    // Now that we know it's a valid scroll down, remove listeners
    window.removeEventListener('scroll', this._handleFadeOutIntro);
    window.removeEventListener('wheel', this._handleFadeOutIntro);
    this.isAnimating = true;
    this._swipeLocked = true;
    this._introDone = true;
    // --- Camera animation for intro to level 1 ---
    const min = this._baseCameraPos || { x: 2, y: 2, z: 2 };
    const max = { x: min.x + 1.75, y: min.y + 1.75, z: min.z + 1.75 };
    const prevPercent = 0;
    const percent = (this.timeline.length > 0 ? (this.timeline[0].items_consumed / this.totalItems) : 0);
    const startPos = {
      x: min.x + (max.x - min.x) * prevPercent,
      y: min.y + (max.y - min.y) * prevPercent,
      z: min.z + (max.z - min.z) * prevPercent
    };
    const endPos = {
      x: min.x + (max.x - min.x) * percent,
      y: min.y + (max.y - min.y) * percent,
      z: min.z + (max.z - min.z) * percent
    };
    this._setCameraAnim(startPos, endPos, 900);
    // console.log('[handleFadeOutIntro] Set _cameraAnim:', JSON.stringify(this._cameraAnim));
    if (introOverlay && introOverlay.style.display !== 'none') {
      await this._fadeOverlay(introOverlay, { opacity: '0', display: 'none', duration: 700 });
    }
    // Animate level 0: particles detach from human and move out
    // Ensure detachment indices are initialized (normally done in gotoTimelineStep)
    if (!this._detachmentIndices) {
      this._initDetachmentIndices();
    }
    await this.animateDetachAndZoomDeterministic(0, this.timeline.length > 0 ? (this.timeline[0].items_consumed / this.totalItems) : 0);
    this.currentLevel = 0;
    this.updateTimelineOverlay(0);
    // Fade in overlay for level 0
    const overlay = document.getElementById('timeline-overlay');
    if (overlay) {
      overlay.style.transition = 'opacity 0.7s';
      overlay.style.opacity = '1';
    }
    // Now unlock navigation for further timeline steps
    this.isAnimating = false;
    this._swipeLocked = false;
    this._introFaded = true;
  }
  // Morph mesh points to cloud for intro (blocking, returns promise)
  async morphMeshToCloudIntro() {
    // Animate mesh points to cloud positions
    if (!this.points || !this._cloudPositions) return;
    const positions = this.points.geometry.attributes.position;
    const start = [];
    for (let i = 0; i < positions.count; i++) {
      start.push(positions.getX(i), positions.getY(i), positions.getZ(i));
    }
    const end = this._cloudPositions.slice();
    await new Promise(resolve => {
      this.animateMorph(start, end, positions, resolve);
    });
  }

  setupNavigation() {
    // Robust navigation: lock during animation, threshold for wheel/swipe, prevent before intro faded
    this._swipeLocked = false;
    this._swipeThreshold = 60;
    this._swipeAccum = 0;
    this._introFaded = false;
    let touchStartY = null;
    // Helper: go to timeline step by offset
    this._gotoTimelineStepOffset = (dir) => {
      if (this._swipeLocked || this.isAnimating) return;
      if (!this._introFaded && dir < 0) return;
      if (!this._introFaded && dir > 0) return; // Only allow intro sequence
      this.gotoTimelineStep(this.currentLevel + dir);
    };
    // Wheel event (trackpad/touchpad/mouse)
    window.addEventListener('wheel', (e) => {
      if (this._swipeLocked || this.isAnimating) return;
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      this._swipeAccum += e.deltaY;
      if (this._swipeAccum > this._swipeThreshold) {
        this._swipeAccum = 0;
        this._gotoTimelineStepOffset(1);
      } else if (this._swipeAccum < -this._swipeThreshold) {
        this._swipeAccum = 0;
        this._gotoTimelineStepOffset(-1);
      }
      e.preventDefault();
    }, { passive: false });
    // Keyboard navigation
    window.addEventListener('keydown', (e) => {
      if (this._swipeLocked || this.isAnimating) return;
      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        this._gotoTimelineStepOffset(1);
        e.preventDefault();
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        this._gotoTimelineStepOffset(-1);
        e.preventDefault();
      }
    });
    // Touch navigation (swipe up/down)
    window.addEventListener('touchstart', (e) => {
      if (this._swipeLocked || this.isAnimating) return;
      if (e.touches.length === 1) touchStartY = e.touches[0].clientY;
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      if (this._swipeLocked || this.isAnimating) return;
      if (touchStartY !== null && e.touches.length === 1) {
        const deltaY = e.touches[0].clientY - touchStartY;
        if (Math.abs(deltaY) > this._swipeThreshold) {
          if (deltaY < 0) {
            this._gotoTimelineStepOffset(1); // Swipe up
          } else {
            this._gotoTimelineStepOffset(-1); // Swipe down
          }
          touchStartY = null;
        }
      }
      if (e.target && e.target.tagName === 'CANVAS') {
        e.preventDefault();
      }
    }, { passive: false });
    window.addEventListener('touchend', (e) => {
      touchStartY = null;
    }, { passive: true });
  }

  async gotoTimelineStep(level) {
    if (this.isAnimating || this._swipeLocked) return;
    // console.log('[gotoTimelineStep] called with level:', level, 'currentLevel:', this.currentLevel);
    // Allow level -1 for intro overlay state
    if (level < -1) level = -1;
    // --- OUTRO OVERLAY HANDLING (SHOW OUTRO WHEN PAST LAST LEVEL) ---
    if (level > this.timeline.length - 1) {
      // Hide timeline overlay
      const timelineOverlay = document.getElementById('timeline-overlay');
      this._hideOverlay(timelineOverlay, { display: 'none', duration: 700 });
      // Show outro overlay
      const outroOverlay = document.getElementById('outro-overlay');
      this._showOverlay(outroOverlay, { display: 'flex', duration: 800 });
      // --- Add listeners for backwards navigation from outro ---
      if (this._outroNavHandlers) {
        window.removeEventListener('wheel', this._outroNavHandlers.wheel);
        window.removeEventListener('keydown', this._outroNavHandlers.keydown);
        window.removeEventListener('touchstart', this._outroNavHandlers.touchstart);
        window.removeEventListener('touchmove', this._outroNavHandlers.touchmove);
      }
      const self = this;
      this._outroNavHandlers = {
        wheel: function(e) {
          if (e.deltaY < 0) {
            self._hideOutroAndReturnToLastLevel();
            e.preventDefault();
          }
        },
        keydown: function(e) {
          if (e.key === 'ArrowUp' || e.key === 'PageUp') {
            self._hideOutroAndReturnToLastLevel();
            e.preventDefault();
          }
        },
        touchstart: function(e) {
          if (e.touches && e.touches.length === 1) {
            self._outroTouchStartY = e.touches[0].clientY;
          }
        },
        touchmove: function(e) {
          if (self._outroTouchStartY !== null && e.touches && e.touches.length === 1) {
            const deltaY = e.touches[0].clientY - self._outroTouchStartY;
            if (deltaY > 60) {
              self._hideOutroAndReturnToLastLevel();
              self._outroTouchStartY = null;
              e.preventDefault();
            }
          }
        }
      };
      window.addEventListener('wheel', this._outroNavHandlers.wheel, { passive: false });
      window.addEventListener('keydown', this._outroNavHandlers.keydown);
      window.addEventListener('touchstart', this._outroNavHandlers.touchstart, { passive: true });
      window.addEventListener('touchmove', this._outroNavHandlers.touchmove, { passive: false });
      this._outroTouchStartY = null;
      // Optionally, fade out intro overlay if visible
      const introOverlay = document.getElementById('intro-overlay');
      this._hideOverlay(introOverlay, { display: 'none', duration: 700 });
      this.isAnimating = false;
      this._swipeLocked = true;
      return;
    }

    this.isAnimating = true;
    this._swipeLocked = true;
    // --- Fade out timeline overlay and reset typewriter animation if visible ---
    const timelineOverlay = document.getElementById('timeline-overlay');
    if (timelineOverlay && timelineOverlay.style.opacity !== '0' && timelineOverlay.style.display !== 'none') {
      this._resetTypewriterAnimation();
      await this._fadeOverlay(timelineOverlay, { opacity: '0', display: undefined, duration: 700 });
    }
    // --- Deterministic detachment indices for each step ---
    if (!this._detachmentIndices) {
      this._initDetachmentIndices();
    }
    // Handle return to intro overlay state
    if (level === -1) {
      // Animate all particles back to mesh (particles form the human shape) and camera zoom in at the same time
      // 1. Capture current displayed positions as start (before clearing spin/reattach state)
      const count = this._instancedParticleCount;
      const start = [];
      const startColors = [];
      for (let i = 0; i < count; i++) {
        // Find which mesh and instance index this particle is
        const shape = this._particleShapeIndices[i];
        const mesh = this._particleMeshes[shape];
        const meshIdx = this._particleInstanceMap[shape].indexOf(i);
        const matrix = new THREE.Matrix4();
        mesh.getMatrixAt(meshIdx, matrix);
        const pos = new THREE.Vector3();
        pos.setFromMatrixPosition(matrix);
        start.push(pos.x, pos.y, pos.z);
        // Color
        let color = new THREE.Color(1, 1, 1);
        if (mesh.instanceColor) {
          mesh.getColorAt(meshIdx, color);
        }
        startColors.push(color.r, color.g, color.b);
      }
      this._isMorphingToIntro = true;
      this._particleSpinState = null;
      this._particleSpinTargetLevel = null;
      this._reattachAnimations = null;
      this._reattachAnimationActive = false;
      const end = this._meshPositions.slice();
      // Camera animation: use actual current camera position as start, base position as end
      const min = this._baseCameraPos || { x: 2, y: 2, z: 2 };
      const cameraStart = {
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z
      };
      const cameraEnd = min;
      this._cameraAnim = {
        from: { ...cameraStart },
        to: { ...cameraEnd },
        start: performance.now(),
        duration: 900,
        active: true
      };
      // Animate particles and fade colors to white in lockstep (camera handled by main loop)
      const duration = 1200;
      const startTime = performance.now();
      await new Promise(resolve => {
        const animate = () => {
          const elapsed = performance.now() - startTime;
          const t = Math.min(elapsed / duration, 1);
          for (let i = 0; i < count; i++) {
            const idx = i * 3;
            const shape = this._particleShapeIndices[i];
            const mesh = this._particleMeshes[shape];
            const meshIdx = this._particleInstanceMap[shape].indexOf(i);
            // Interpolate position
            const x = start[idx] + (end[idx] - start[idx]) * t;
            const y = start[idx+1] + (end[idx+1] - start[idx+1]) * t;
            const z = start[idx+2] + (end[idx+2] - start[idx+2]) * t;
            const matrix = new THREE.Matrix4().makeTranslation(x, y, z);
            mesh.setMatrixAt(meshIdx, matrix);
            // Fade color to white
            const cidx = i * 3;
            const r0 = startColors[cidx + 0] !== undefined ? startColors[cidx + 0] : 1.0;
            const g0 = startColors[cidx + 1] !== undefined ? startColors[cidx + 1] : 1.0;
            const b0 = startColors[cidx + 2] !== undefined ? startColors[cidx + 2] : 1.0;
            const r = r0 + (1.0 - r0) * t;
            const g = g0 + (1.0 - g0) * t;
            const b = b0 + (1.0 - b0) * t;
            if (mesh.instanceColor) mesh.setColorAt(meshIdx, new THREE.Color(r, g, b));
          }
          for (let shape = 0; shape < Scene.PARTICLE_SHAPE_COUNT; shape++) {
            this._particleMeshes[shape].instanceMatrix.needsUpdate = true;
            if (this._particleMeshes[shape].instanceColor) this._particleMeshes[shape].instanceColor.needsUpdate = true;
          }
          if (t < 1) {
            requestAnimationFrame(animate);
          } else {
            resolve();
          }
        };
        animate();
      });
      this._isMorphingToIntro = false;
      if (timelineOverlay) {
        timelineOverlay.style.transition = 'opacity 0.7s';
        timelineOverlay.style.opacity = '0';
      }
      const intro = document.getElementById('intro-overlay');
      if (intro) {
        intro.style.display = '';
        void intro.offsetWidth;
        intro.style.transition = 'opacity 0.7s';
        intro.style.opacity = '1';
        this._introDone = false;
        window.addEventListener('scroll', this._handleFadeOutIntro);
        window.addEventListener('wheel', this._handleFadeOutIntro);
      }
      this.currentLevel = -1;
      this._introFaded = false;
      this.isAnimating = false;
      this._swipeLocked = false;
      return;
    }
    // Animate detachment/reattachment and camera zoom for this step
    const data = this.timeline[level];
    const percent = data && this.totalItems ? (data.items_consumed / this.totalItems) : 0;
    let prevPercent = (this.currentLevel >= 0 && this.timeline[this.currentLevel]) ? (this.timeline[this.currentLevel].items_consumed / this.totalItems) : 0;
    // console.log('[gotoTimelineStep] prevPercent:', prevPercent, 'percent:', percent);
    // --- Overlay fade out and type animation reset ---
    if (timelineOverlay && timelineOverlay.style.opacity !== '0') {
      timelineOverlay.style.transition = 'opacity 0.3s';
      timelineOverlay.style.opacity = '0';
      const statSublabel = timelineOverlay.querySelector('.overlay-stat-sublabel');
      if (statSublabel) {
        statSublabel.innerHTML = '';
        statSublabel.style.opacity = 0;
        statSublabel.style.display = 'none';
      }
      await new Promise(res => setTimeout(res, 320));
    }
    // Camera zoom logic: always animate from prevPercent to percent (forward or backward)
    const min = this._baseCameraPos || { x: 2, y: 2, z: 2 };
    const max = { x: min.x + 1.75, y: min.y + 1.75, z: min.z + 1.75 };
    const startPos = {
      x: min.x + (max.x - min.x) * prevPercent,
      y: min.y + (max.y - min.y) * prevPercent,
      z: min.z + (max.z - min.z) * prevPercent
    };
    const endPos = {
      x: min.x + (max.x - min.x) * percent,
      y: min.y + (max.y - min.y) * percent,
      z: min.z + (max.z - min.z) * percent
    };
    this._setCameraAnim(startPos, endPos, 900);
    // console.log('[gotoTimelineStep] Set _cameraAnim:', JSON.stringify(this._cameraAnim));
    await this.animateDetachAndZoomDeterministic(prevPercent, percent);
    this.currentLevel = level;
    this.updateTimelineOverlay(level);
    if (timelineOverlay) {
      this._showOverlay(timelineOverlay, { display: '', duration: 700 });
      const yearEl = timelineOverlay.querySelector('.overlay-year');
      const statMainEl = timelineOverlay.querySelector('.overlay-stat-main');
      const statSublabelEl = timelineOverlay.querySelector('.overlay-stat-sublabel');
      if (yearEl) { yearEl.style.opacity = 0; yearEl.style.display = ''; }
      if (statMainEl) { statMainEl.style.opacity = 0; statMainEl.style.display = ''; }
      if (statSublabelEl) {
        this._resetTypewriterAnimation();
        statSublabelEl.innerHTML = '';
        statSublabelEl.style.opacity = 0;
        statSublabelEl.style.display = 'none';
      }
      setTimeout(() => {
        if (yearEl) {
          yearEl.style.transition = 'opacity 0.3s';
          yearEl.style.opacity = 1;
        }
        setTimeout(() => {
          if (statMainEl) {
            statMainEl.style.transition = 'opacity 0.3s';
            statMainEl.style.opacity = 1;
          }
          setTimeout(() => {
            if (statSublabelEl) {
              statSublabelEl.style.transition = 'opacity 0.3s';
              statSublabelEl.style.display = '';
              statSublabelEl.style.opacity = 1;
              if (typeof window.startTypewriterAnimation === 'function') {
                window.startTypewriterAnimation();
              }
            }
          }, 300);
        }, 300);
      }, 700);
    }
    this.isAnimating = false;
    this._swipeLocked = false;
  }

  // Animate detachment/reattachment and camera zoom for timeline step (deterministic indices)
  async animateDetachAndZoomDeterministic(prevPercent, nextPercent) {
    // InstancedMesh version
    if (!this._particleMeshes) return;
    const count = this._instancedParticleCount;
    const detachCountPrev = Math.floor(count * prevPercent);
    const detachCountNext = Math.floor(count * nextPercent);
    const detachIndicesPrev = new Set(this._detachmentIndices.slice(0, detachCountPrev));
    const detachIndicesNext = new Set(this._detachmentIndices.slice(0, detachCountNext));
    // Determine the current timeline step (level) for detachment scale
    let currentStep = 0;
    if (this.timeline && this.timeline.length > 0 && typeof nextPercent === 'number') {
      let minDiff = 1;
      for (let i = 0; i < this.timeline.length; i++) {
        const stepPercent = this.timeline[i].items_consumed / this.totalItems;
        if (Math.abs(stepPercent - nextPercent) < minDiff) {
          minDiff = Math.abs(stepPercent - nextPercent);
          currentStep = i;
        }
      }
    }
    let detachmentScale = Math.min(currentStep + 1, Scene.DETACHMENT_SCALE_MAX);
    if (!this._sphericalDetachTargets) this._sphericalDetachTargets = {};
    if (!this._sphericalDetachTargets[currentStep]) {
      this._sphericalDetachTargets[currentStep] = this._generateSphericalDetachTargets(currentStep, count, detachmentScale);
    }
    // Only snap attached->attached particles; never animate detachment/reattachment here
    for (let i = 0; i < count; i++) {
      const wasDetached = detachIndicesPrev.has(i);
      const willBeDetached = detachIndicesNext.has(i);
      // Only snap attached->attached (not spinning)
      if (!wasDetached && !willBeDetached) {
        const shape = this._particleShapeIndices[i];
        const mesh = this._particleMeshes[shape];
        const meshIdx = this._particleInstanceMap[shape].indexOf(i);
        const meshX = this._meshPositions[i*3], meshY = this._meshPositions[i*3+1], meshZ = this._meshPositions[i*3+2];
        const instantMatrix = new THREE.Matrix4().makeTranslation(meshX, meshY, meshZ);
        mesh.setMatrixAt(meshIdx, instantMatrix);
      }
      // For newly detached particles, always reset detach animation state so they animate from mesh to shell
      if (!wasDetached && willBeDetached) {
        if (!this._detachAnimations) this._detachAnimations = {};
        if (!this._detachAnimationCompleted) this._detachAnimationCompleted = {};
        // Always reset animation state for new detachment
        this._detachAnimations[i] = {
          from: [this._meshPositions[i*3], this._meshPositions[i*3+1], this._meshPositions[i*3+2]],
          to: this._sphericalDetachTargets[currentStep][i],
          start: performance.now(),
          duration: 1200
        };
        // Also clear any completed flag so main loop animates it
        if (this._detachAnimationCompleted[i]) delete this._detachAnimationCompleted[i];
        // Also clear spin state so it doesn't start spinning until animation completes
        if (this._particleSpinState && this._particleSpinState[i]) delete this._particleSpinState[i];
        if (this._particleSpinTargetLevel && this._particleSpinTargetLevel[i]) delete this._particleSpinTargetLevel[i];
      }
      // All animation for detachment/reattachment is handled in the main loop
    }
    // Mark all instance matrices as needing update
    for (let shape = 0; shape < Scene.PARTICLE_SHAPE_COUNT; shape++) {
      this._particleMeshes[shape].instanceMatrix.needsUpdate = true;
    }
    // Camera transition is handled as before; no per-particle animation here
    // (No blocking animation for detachment/reattachment)
  }

  updateTimelineOverlay(level) {
    // Use the global overlay update function from main.js for animation and step bars
    if (typeof window.updateTimelineOverlay !== 'function') return;
    if (level < 0 || !this.timeline[level]) {
      window.updateTimelineOverlay({ show: false });
      return;
    }
    const data = this.timeline[level];
    // Map data to expected fields for overlay
    window.updateTimelineOverlay({
      year: (data.year !== undefined ? data.year : (data.age !== undefined ? data.age : '')),
      contaminationRate: (typeof data.items_consumed === 'number' ? data.items_consumed : 0),
      description: (data.label !== undefined && data.label !== '' ? data.label : (data.description !== undefined ? data.description : '')),
      show: true,
      step: level + 1,
      totalSteps: this.timeline.length,
      references: data.references || ''
    });
  }

  // Fade out outro overlay and return to last timeline level
  _hideOutroAndReturnToLastLevel() {
    const outroOverlay = document.getElementById('outro-overlay');
    const timelineOverlay = document.getElementById('timeline-overlay');
    if (outroOverlay && outroOverlay.style.display !== 'none') {
      this._hideOverlay(outroOverlay, { display: 'none', duration: 700 });
      setTimeout(() => {
        this._showOverlay(timelineOverlay, { display: '', duration: 700 });
        // Return to last timeline level
        this.currentLevel = this.timeline.length - 1;
        this.updateTimelineOverlay(this.currentLevel);
        this.isAnimating = false;
        this._swipeLocked = false;
        // Remove outro nav listeners
        if (this._outroNavHandlers) {
          window.removeEventListener('wheel', this._outroNavHandlers.wheel);
          window.removeEventListener('keydown', this._outroNavHandlers.keydown);
          window.removeEventListener('touchstart', this._outroNavHandlers.touchstart);
          window.removeEventListener('touchmove', this._outroNavHandlers.touchmove);
        }
      }, 700);
    }
  }
}
