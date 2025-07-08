import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class Scene {
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
    this.animate();
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
    if (!this._meshPositions) return;
    // Create points geometry from mesh positions
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this._meshPositions, 3));
    // Add color attribute for RGBA (for depth of field alpha)
    const colors = new Float32Array(this._meshPositions.length / 3 * 4);
    for (let i = 0; i < this._meshPositions.length / 3; i++) {
      colors[i * 4 + 0] = 1.0; // r
      colors[i * 4 + 1] = 1.0; // g
      colors[i * 4 + 2] = 1.0; // b
      colors[i * 4 + 3] = 1.0; // a (will be updated per frame)
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));


    // Add per-particle shape index attribute (0-15, for 16 shapes in 4x4 grid)
    const count = this._meshPositions.length / 3;
    const shapeIndices = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      shapeIndices[i] = Math.floor(Math.random() * 16); // 0-15
    }
    geometry.setAttribute('shapeIndex', new THREE.BufferAttribute(shapeIndices, 1));

    // Load the garments texture (only load once)
    if (!this._garmentsTexture) {
      this._garmentsTexture = await new Promise((resolve, reject) => {
        new THREE.TextureLoader().load('assets/masks/garments.png', resolve, undefined, reject);
      });
      this._garmentsTexture.minFilter = THREE.LinearMipMapLinearFilter;
      this._garmentsTexture.magFilter = THREE.LinearFilter;
      this._garmentsTexture.generateMipmaps = true;
      this._garmentsTexture.needsUpdate = true;
    }

    // Custom shader for 4x4 grid-based particle masking
    const vertexShader = `
      attribute float shapeIndex;
      varying vec4 vColor;
      varying float vShapeIndex;
      void main() {
        vColor = color;
        vShapeIndex = shapeIndex;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        // Point size scaling for perspective
        gl_PointSize = 0.6 * 100.0 / -mvPosition.z;
      }
    `;

    const fragmentShader = `
      uniform sampler2D atlas;
      varying vec4 vColor;
      varying float vShapeIndex;
      void main() {
        // 4x4 grid: idx 0 = (0,0), 1 = (1,0), ..., 15 = (3,3)
        float idx = vShapeIndex;
        float u = mod(idx, 4.0);
        float v = floor(idx / 4.0);
        // Each shape is 0.25x0.25 in UV space
        // Flip Y to rotate 180 degrees
        vec2 atlasUV = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y);
        atlasUV = atlasUV * 0.25 + vec2(u * 0.25, v * 0.25);
        float mask = texture2D(atlas, atlasUV).a;
        if (mask < 0.1) discard;
        gl_FragColor = vec4(vColor.rgb, vColor.a * mask);
      }
    `;

    const material = new THREE.ShaderMaterial({
      uniforms: {
        atlas: { value: this._garmentsTexture },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      vertexColors: true,
      depthTest: true,
      depthWrite: false,
    });

    this.points = new THREE.Points(geometry, material);
    this.scene.add(this.points);
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
      if (this.meshObj) {
        const meshPositions = this.meshObj.geometry.attributes.position.array;
        this._meshPositions = [];
        for (let i = 0; i < 1500; i++) {
          const idx = (i * 3) % meshPositions.length;
          this._meshPositions.push(meshPositions[idx], meshPositions[idx + 1], meshPositions[idx + 2]);
        }
        
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
this.renderer.setClearColor(0x8B959A, 1); // for black, or use any color you want
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
    const material = new THREE.PointsMaterial({ size: 0.1, vertexColors: true, transparent: true });
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
    const duration = 2000;
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
      console.log('[animate] Camera animating. t:', t.toFixed(3), 'from:', this._cameraAnim.from, 'to:', this._cameraAnim.to, 'current:', {x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z});
      if (t >= 1) {
        this._cameraAnim.active = false;
        console.log('[animate] Camera animation complete. Final position:', {x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z});
      }
    }
    // If not animating, just set to target
    else {
      this.camera.position.x = this._cameraAnim.to.x;
      this.camera.position.y = this._cameraAnim.to.y;
      this.camera.position.z = this._cameraAnim.to.z;
      this.camera.lookAt(0, 0, 0);
    }

    // --- Per-particle spinning for detached particles (option 1) ---
    if (this._isMorphingToIntro) {
      // Skip per-particle logic during morph to intro
    } else if (this.points && this._detachmentIndices && this.timeline && this.currentLevel >= 0) {
      // Determine which particles are detached at this level
      const data = this.timeline[this.currentLevel];
      const percent = data && this.totalItems ? (data.items_consumed / this.totalItems) : 0;
      const count = this.points.geometry.attributes.position.count;
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
          // Always use the current spinning position as the start
          let from;
          if (this._particleSpinState[i]) {
            // Compute current spinning position
            const s = this._particleSpinState[i];
            const x = s.orbitRadius * Math.cos(s.theta);
            const z = s.orbitRadius * Math.sin(s.theta);
            const y = s.y;
            from = [x, y, z];
          } else {
            // Fallback: use current buffer position
            const positions = this.points.geometry.attributes.position;
            from = [positions.getX(i), positions.getY(i), positions.getZ(i)];
          }
          const to = [this._meshPositions[i*3], this._meshPositions[i*3+1], this._meshPositions[i*3+2]];
          this._reattachAnimations[i] = {
            from,
            to,
            start: performance.now(),
            duration: 1200
          };
          // Do NOT remove spin state here; let it be removed only after reattach animation completes
        }
      }

      // --- Initialize per-particle spin state only for newly detached particles ---
      for (let i = 0; i < count; i++) {
        if (detachedSet.has(i)) {
          // Only initialize if not already spinning
          if (!this._particleSpinState[i]) {
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
      const positions = this.points.geometry.attributes.position;
      let now = performance.now();
      let anyReattaching = false;
      // Easing function for ease-in (cubic)
      function easeInCubic(t) { return t * t * t; }
      const SPIN_EASE_DURATION = 900; // ms, how long the ease-in lasts
      for (let i = 0; i < count; i++) {
        if (detachedSet.has(i) && this._particleSpinState[i]) {
          let s = this._particleSpinState[i];
          // Track when spinning started
          if (!s.spinStartTime) s.spinStartTime = now;
          let spinElapsed = now - s.spinStartTime;
          let ease = 1.0;
          if (spinElapsed < SPIN_EASE_DURATION) {
            ease = easeInCubic(Math.min(spinElapsed / SPIN_EASE_DURATION, 1));
          }
          // Increment angle for spinning with ease-in
          s.theta += s.dTheta * ease;
          // Spin around Y axis, keep y fixed, radius is fixed from detachment
          const x = s.orbitRadius * Math.cos(s.theta);
          const z = s.orbitRadius * Math.sin(s.theta);
          const y = s.y;
          positions.setXYZ(i, x, y, z);

          // --- Fade color to custom red as particle starts spinning ---
          // Use ease as the fade-in factor (0=start, 1=fully spinning)
          const colors = this.points.geometry.attributes.color;
          // Fade from white (1,1,1) to red (213/255,0,11/255)
          const targetR = 255 / 255;
          const targetG = 0.0;
          const targetB = 56 / 255;
          const r = 1.0 + (targetR - 1.0) * ease;
          const g = 1.0 + (targetG - 1.0) * ease;
          const b = 1.0 + (targetB - 1.0) * ease;
          // Keep alpha as is (will be set in DoF section)
          colors.setX(i, r);
          colors.setY(i, g);
          colors.setZ(i, b);
        } else if (this._reattachAnimations[i]) {
          // Animate reattaching from current spinning position to mesh with cubic ease-out
          anyReattaching = true;
          const anim = this._reattachAnimations[i];
          const t = Math.min((now - anim.start) / anim.duration, 1);
          // Cubic ease-out for reattachment
          const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
          const easedT = easeOutCubic(t);
          const from = anim.from;
          const to = anim.to;
          const x = from[0] + (to[0] - from[0]) * easedT;
          const y = from[1] + (to[1] - from[1]) * easedT;
          const z = from[2] + (to[2] - from[2]) * easedT;
          positions.setXYZ(i, x, y, z);
          // --- Fade color back to white as particle reattaches ---
          const colors = this.points.geometry.attributes.color;
          // Fade from custom red (213/255,0,11/255) to white (1,1,1) as t goes 0->1
          const startR = 255 / 255;
          const startG = 0.0;
          const startB = 56 / 255;
          const r = startR + (1.0 - startR) * easedT;
          const g = startG + (1.0 - startG) * easedT;
          const b = startB + (1.0 - startB) * easedT;
          colors.setX(i, r);
          colors.setY(i, g);
          colors.setZ(i, b);
          if (t >= 1) {
            // Animation done, clean up
            delete this._reattachAnimations[i];
            if (this._particleSpinState[i]) delete this._particleSpinState[i];
            if (this._particleSpinTargetLevel[i]) delete this._particleSpinTargetLevel[i];
          }
        }
      }
      positions.needsUpdate = true;
      // Update color buffer for fade to red/white
      if (this.points && this.points.geometry && this.points.geometry.attributes.color) {
        this.points.geometry.attributes.color.needsUpdate = true;
      }
      // If any reattaching, keep animation loop going
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
    // Use same logic as gotoTimelineStep for camera animation
    const min = this._baseCameraPos || { x: 2, y: 2, z: 2 };
    const max = { x: min.x + 2, y: min.y + 2, z: min.z + 2 };
    const prevPercent = 0; // intro is always 0
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
    this._cameraAnim = {
      from: { ...startPos },
      to: { ...endPos },
      start: performance.now(),
      duration: 900,
      active: true
    };
    console.log('[handleFadeOutIntro] Set _cameraAnim:', JSON.stringify(this._cameraAnim));
    if (introOverlay && introOverlay.style.display !== 'none') {
      introOverlay.style.transition = 'opacity 0.7s';
      introOverlay.style.opacity = '0';
      setTimeout(() => {
        introOverlay.style.display = 'none';
      }, 700);
      // Wait for fade out
      await new Promise(res => setTimeout(res, 700));
    }
    // Animate level 0: particles detach from human and move out
    // Ensure detachment indices are initialized (normally done in gotoTimelineStep)
    if (!this._detachmentIndices && this.points) {
      const count = this.points.geometry.attributes.position.count;
      this._detachmentIndices = Array.from({length: count}, (_, i) => i);
      for (let i = this._detachmentIndices.length - 1; i > 0; i--) {
        const j = Math.floor(i * 1337 % (i + 1));
        [this._detachmentIndices[i], this._detachmentIndices[j]] = [this._detachmentIndices[j], this._detachmentIndices[i]];
      }
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
    console.log('[gotoTimelineStep] called with level:', level, 'currentLevel:', this.currentLevel);
    // Allow level -1 for intro overlay state
    if (level < -1) level = -1;
    // --- OUTRO OVERLAY HANDLING (NEW) ---
    if (level > this.timeline.length - 1) {
      // Fade out timeline overlay
      const timelineOverlay = document.getElementById('timeline-overlay');
      if (timelineOverlay) {
        timelineOverlay.style.transition = 'opacity 0.7s';
        timelineOverlay.style.opacity = '0';
        setTimeout(() => { timelineOverlay.style.display = 'none'; }, 700);
      }
      // Fade in outro overlay and block interaction
      const outro = document.getElementById('outro-overlay');
      if (outro) {
        outro.style.display = 'block';
        void outro.offsetWidth;
        outro.style.transition = 'opacity 0.7s';
        outro.style.opacity = '1';
        // Block pointer events on canvas
        const canvas = document.getElementById('three-canvas');
        if (canvas) canvas.style.pointerEvents = 'none';
      }
      // Animate camera zoom out (top-right vector)
      const min = this._baseCameraPos || { x: 2, y: 2, z: 2 };
      const max = { x: min.x + 2, y: min.y + 2, z: min.z + 2 };
      this._cameraAnim = {
        from: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
        to: max,
        start: performance.now(),
        duration: 1200,
        active: true
      };
      await new Promise(resolve => {
        const check = () => {
          const t = Math.min((performance.now() - this._cameraAnim.start) / this._cameraAnim.duration, 1);
          if (t < 1) {
            requestAnimationFrame(check);
          } else {
            resolve();
          }
        };
        check();
      });
      // Attach navigation listeners to allow going back (using existing navigation structure)
      if (!this._outroBackHandler) {
        this._outroBackHandler = async (e) => {
          if (this.isAnimating || this._swipeLocked) return;
          let backward = false;
          if (e.type === 'wheel' && e.deltaY < 0) backward = true;
          if (e.type === 'keydown' && (e.key === 'ArrowUp' || e.key === 'PageUp')) backward = true;
          if (e.type === 'touchmove' && this._outroTouchStartY !== null && e.touches.length === 1) {
            const deltaY = e.touches[0].clientY - this._outroTouchStartY;
            if (deltaY > 60) backward = true;
          }
          if (backward) {
            // Fade out outro overlay
            const outro = document.getElementById('outro-overlay');
            if (outro) {
              outro.style.transition = 'opacity 0.7s';
              outro.style.opacity = '0';
              setTimeout(() => { outro.style.display = 'none'; }, 700);
            }
            // Restore timeline overlay
            const timelineOverlay = document.getElementById('timeline-overlay');
            if (timelineOverlay) {
              timelineOverlay.style.display = '';
              void timelineOverlay.offsetWidth;
              timelineOverlay.style.transition = 'opacity 0.7s';
              timelineOverlay.style.opacity = '1';
            }
            // Restore camera zoom (top-right vector)
            const min = this._baseCameraPos || { x: 2, y: 2, z: 2 };
            const max = { x: min.x + 2, y: min.y + 2, z: min.z + 2 };
            this._cameraAnim = {
              from: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
              to: { x: min.x + (max.x - min.x) * 1, y: min.y + (max.y - min.y) * 1, z: min.z + (max.z - min.z) * 1 },
              start: performance.now(),
              duration: 1200,
              active: true
            };
            await new Promise(resolve => {
              const check = () => {
                const t = Math.min((performance.now() - this._cameraAnim.start) / this._cameraAnim.duration, 1);
                if (t < 1) {
                  requestAnimationFrame(check);
                } else {
                  resolve();
                }
              };
              check();
            });
            // Unblock pointer events on canvas
            const canvas = document.getElementById('three-canvas');
            if (canvas) canvas.style.pointerEvents = '';
            // Remove listeners
            window.removeEventListener('wheel', this._outroBackHandler, true);
            window.removeEventListener('keydown', this._outroBackHandler, true);
            window.removeEventListener('touchstart', this._outroTouchStartHandler, true);
            window.removeEventListener('touchmove', this._outroBackHandler, true);
            window.removeEventListener('touchend', this._outroTouchEndHandler, true);
            this._outroBackHandler = null;
            this._outroTouchStartHandler = null;
            this._outroTouchEndHandler = null;
            this._outroTouchStartY = null;
            // Go back to last timeline step
            this.gotoTimelineStep(this.timeline.length - 1);
          }
        };
        this._outroTouchStartHandler = (e) => {
          if (e.touches.length === 1) this._outroTouchStartY = e.touches[0].clientY;
        };
        this._outroTouchEndHandler = (e) => {
          this._outroTouchStartY = null;
        };
        window.addEventListener('wheel', this._outroBackHandler, true);
        window.addEventListener('keydown', this._outroBackHandler, true);
        window.addEventListener('touchstart', this._outroTouchStartHandler, true);
        window.addEventListener('touchmove', this._outroBackHandler, true);
        window.addEventListener('touchend', this._outroTouchEndHandler, true);
      }
      return;
    }
    this.isAnimating = true;
    this._swipeLocked = true;
    // --- Fade out timeline overlay and reset typewriter animation if visible ---
    const timelineOverlay = document.getElementById('timeline-overlay');
    if (timelineOverlay && timelineOverlay.style.opacity !== '0' && timelineOverlay.style.display !== 'none') {
      timelineOverlay.style.transition = 'opacity 0.7s';
      timelineOverlay.style.opacity = '0';
      // Reset typewriter animation if present
      if (typeof window.resetTypewriterAnimation === 'function') {
        window.resetTypewriterAnimation();
      }
      // Wait for fade out before continuing
      await new Promise(res => setTimeout(res, 700));
    }
    // --- Deterministic detachment indices for each step ---
    if (!this._detachmentIndices) {
      // Always use the same shuffled indices for all steps
      const count = this.points.geometry.attributes.position.count;
      this._detachmentIndices = Array.from({length: count}, (_, i) => i);
      for (let i = this._detachmentIndices.length - 1; i > 0; i--) {
        const j = Math.floor(i * 1337 % (i + 1)); // deterministic shuffle
        [this._detachmentIndices[i], this._detachmentIndices[j]] = [this._detachmentIndices[j], this._detachmentIndices[i]];
      }
    }
    // Handle return to intro overlay state
    if (level === -1) {
      // Animate all points back to mesh (particles form the human shape) and camera zoom in at the same time
      // 1. Capture current displayed positions as start (before clearing spin/reattach state)
      const positions = this.points.geometry.attributes.position;
      const colors = this.points.geometry.attributes.color;
      const start = [];
      const startColors = [];
      for (let i = 0; i < positions.count; i++) {
        start.push(positions.getX(i), positions.getY(i), positions.getZ(i));
        // Store current RGB color
        startColors.push(colors.getX(i), colors.getY(i), colors.getZ(i));
      }
      // 2. Set morphing flag to disable per-particle logic in animation loop
      this._isMorphingToIntro = true;
      // 3. Now stop spinning logic before morph
      this._particleSpinState = null;
      this._particleSpinTargetLevel = null;
      this._reattachAnimations = null;
      this._reattachAnimationActive = false;
      const end = this._meshPositions.slice();
      // Camera animation: zoom out from level 1 position to intro position
      // Use same logic as timeline step camera animation for consistency
      const min = this._baseCameraPos || { x: 2, y: 2, z: 2 };
      const max = { x: min.x + 2, y: min.y + 2, z: min.z + 2 };
      // If coming from level 1, use percent for level 1 as camera start
      let prevPercent = 0;
      if (this.currentLevel >= 0 && this.timeline[this.currentLevel]) {
        prevPercent = (this.timeline[this.currentLevel].items_consumed / this.totalItems);
      }
      const cameraStart = {
        x: min.x + (max.x - min.x) * prevPercent,
        y: min.y + (max.y - min.y) * prevPercent,
        z: min.z + (max.z - min.z) * prevPercent
      };
      const cameraEnd = min;
      // Set up camera animation for main loop
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
          for (let i = 0; i < positions.count; i++) {
            const idx = i * 3;
            positions.setXYZ(
              i,
              start[idx] + (end[idx] - start[idx]) * t,
              start[idx + 1] + (end[idx + 1] - start[idx + 1]) * t,
              start[idx + 2] + (end[idx + 2] - start[idx + 2]) * t
            );
            // Fade color to white (1,1,1)
            const cidx = i * 3;
            const r0 = startColors[cidx + 0] !== undefined ? startColors[cidx + 0] : 1.0;
            const g0 = startColors[cidx + 1] !== undefined ? startColors[cidx + 1] : 1.0;
            const b0 = startColors[cidx + 2] !== undefined ? startColors[cidx + 2] : 1.0;
            colors.setX(i, r0 + (1.0 - r0) * t);
            colors.setY(i, g0 + (1.0 - g0) * t);
            colors.setZ(i, b0 + (1.0 - b0) * t);
          }
          positions.needsUpdate = true;
          colors.needsUpdate = true;
          if (t < 1) {
            requestAnimationFrame(animate);
          } else {
            resolve();
          }
        };
        animate();
      });
      // 4. Clear morphing flag after morph is done
      this._isMorphingToIntro = false;
      // Fade out timeline overlay
      if (timelineOverlay) {
        timelineOverlay.style.transition = 'opacity 0.7s';
        timelineOverlay.style.opacity = '0';
      }
      // Fade in intro overlay
      const intro = document.getElementById('intro-overlay');
      if (intro) {
        intro.style.display = '';
        void intro.offsetWidth;
        intro.style.transition = 'opacity 0.7s';
        intro.style.opacity = '1';
        // Re-attach scroll/wheel listeners for intro overlay using the shared handler
        this._introDone = false;
        window.addEventListener('scroll', this._handleFadeOutIntro);
        window.addEventListener('wheel', this._handleFadeOutIntro);
      }
      this.currentLevel = -1;
      // Lock navigation until user scrolls forward again
      this._introFaded = false;
      this.isAnimating = false;
      this._swipeLocked = false;
      return;
    }
    // Animate detachment/reattachment and camera zoom for this step
    const data = this.timeline[level];
    const percent = data && this.totalItems ? (data.items_consumed / this.totalItems) : 0;
    let prevPercent = (this.currentLevel >= 0 && this.timeline[this.currentLevel]) ? (this.timeline[this.currentLevel].items_consumed / this.totalItems) : 0;
    console.log('[gotoTimelineStep] prevPercent:', prevPercent, 'percent:', percent);

    // --- Overlay fade out and type animation reset ---
    if (timelineOverlay && timelineOverlay.style.opacity !== '0') {
      timelineOverlay.style.transition = 'opacity 0.3s';
      timelineOverlay.style.opacity = '0';
      // Reset typewriter animation if present
      const statSublabel = timelineOverlay.querySelector('.overlay-stat-sublabel');
      if (statSublabel) {
        statSublabel.innerHTML = '';
        statSublabel.style.opacity = 0;
        statSublabel.style.display = 'none';
      }
      // Wait for fade out before animating
      await new Promise(res => setTimeout(res, 320));
    }

    // Camera zoom logic: always animate from prevPercent to percent (forward or backward)
    // Set camera animation target for main loop
    const min = this._baseCameraPos || { x: 2, y: 2, z: 2 };
    const max = { x: min.x + 2, y: min.y + 2, z: min.z + 2 };
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
    this._cameraAnim = {
      from: { ...startPos },
      to: { ...endPos },
      start: performance.now(),
      duration: 900,
      active: true
    };
    console.log('[gotoTimelineStep] Set _cameraAnim:', JSON.stringify(this._cameraAnim));
    await this.animateDetachAndZoomDeterministic(prevPercent, percent);
    this.currentLevel = level;
    this.updateTimelineOverlay(level);
    // Fade in overlay in correct order: date → percentage → sublabel, after overlay is fully visible
    if (timelineOverlay) {
      timelineOverlay.style.transition = 'opacity 0.7s';
      timelineOverlay.style.opacity = '1';
      const yearEl = timelineOverlay.querySelector('.overlay-year');
      const statMainEl = timelineOverlay.querySelector('.overlay-stat-main');
      const statSublabelEl = timelineOverlay.querySelector('.overlay-stat-sublabel');
      // Hide all children first
      if (yearEl) { yearEl.style.opacity = 0; yearEl.style.display = ''; }
      if (statMainEl) { statMainEl.style.opacity = 0; statMainEl.style.display = ''; }
      if (statSublabelEl) {
        // Always clear and hide before fade-in
        if (typeof window.resetTypewriterAnimation === 'function') window.resetTypewriterAnimation();
        statSublabelEl.innerHTML = '';
        statSublabelEl.style.opacity = 0;
        statSublabelEl.style.display = 'none';
      }
      // Start child fade-in after overlay fade-in completes (0.7s)
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
              // Always trigger typewriter after fade-in
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
    if (!this.points) return;
    const positions = this.points.geometry.attributes.position;
    const count = positions.count;
    const detachCountPrev = Math.floor(count * prevPercent);
    const detachCountNext = Math.floor(count * nextPercent);
    const detachIndicesPrev = new Set(this._detachmentIndices.slice(0, detachCountPrev));
    const detachIndicesNext = new Set(this._detachmentIndices.slice(0, detachCountNext));
    const startPositions = [];
    const endPositions = [];
    // Determine the current timeline step (level) for detachment scale
    let currentStep = 0;
    if (this.timeline && this.timeline.length > 0 && typeof nextPercent === 'number') {
      // Find the closest timeline step for nextPercent
      let minDiff = 1;
      for (let i = 0; i < this.timeline.length; i++) {
        const stepPercent = this.timeline[i].items_consumed / this.totalItems;
        if (Math.abs(stepPercent - nextPercent) < minDiff) {
          minDiff = Math.abs(stepPercent - nextPercent);
          currentStep = i;
        }
      }
    }
    // Detachment scale: level 0 = 1, level 1 = 2, level 2 = 3, level 3+ = 4
    let detachmentScale = Math.min(currentStep + 1, 3);
    // Precompute random spherical targets for all possible detachment levels for determinism
    if (!this._sphericalDetachTargets) this._sphericalDetachTargets = {};
    if (!this._sphericalDetachTargets[currentStep]) {
      this._sphericalDetachTargets[currentStep] = [];
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
        this._sphericalDetachTargets[currentStep][i] = [sx, sy, sz];
      }
    }
    for (let i = 0; i < count; i++) {
      let x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      let meshX = this._meshPositions[i*3], meshY = this._meshPositions[i*3+1], meshZ = this._meshPositions[i*3+2];
      // Only animate if detachment state changes
      const wasDetached = detachIndicesPrev.has(i);
      const willBeDetached = detachIndicesNext.has(i);
      if (wasDetached !== willBeDetached) {
        // Animate from current to target
        startPositions.push(x, y, z);
        if (willBeDetached) {
          // Animate to spherical detachment
          const [sx, sy, sz] = this._sphericalDetachTargets[currentStep][i];
          endPositions.push(sx, sy, sz);
        } else {
          // Animate to mesh
          endPositions.push(meshX, meshY, meshZ);
        }
      } else {
        // Keep static: set both start and end to current position
        startPositions.push(x, y, z);
        endPositions.push(x, y, z);
      }
    }
    // Animate detachment/reattachment only (camera handled by main loop)
    const duration = 1200;
    function easeInOutCubic(t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }
    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
    await new Promise(resolve => {
      const animate = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / duration, 1);
        const easedT = easeInOutCubic(t);
        for (let i = 0; i < count; i++) {
          const idx = i * 3;
          const wasDetached = detachIndicesPrev.has(i);
          const willBeDetached = detachIndicesNext.has(i);
          let localT;
          if (wasDetached && !willBeDetached) {
            localT = easeOutCubic(t);
          } else if (!wasDetached && willBeDetached) {
            localT = easedT;
          } else {
            localT = 1;
          }
          positions.setXYZ(
            i,
            startPositions[idx] + (endPositions[idx] - startPositions[idx]) * localT,
            startPositions[idx+1] + (endPositions[idx+1] - startPositions[idx+1]) * localT,
            startPositions[idx+2] + (endPositions[idx+2] - startPositions[idx+2]) * localT
          );
        }
        positions.needsUpdate = true;
        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          resolve();
        }
      };
      const startTime = performance.now();
      animate();
    });
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
}
