import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class Scene {
  constructor() {
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
      // --- Outro overlay setup ---
      const outro = document.getElementById('outro-overlay');
      if (outro) {
        outro.style.display = 'none';
        outro.style.opacity = 0;
        outro.classList.remove('fade-out');
        const outroBtn = document.getElementById('outro-close-btn');
        if (outroBtn) {
          outroBtn.onclick = () => {
            outro.style.opacity = 0;
            outro.classList.add('fade-out');
            setTimeout(() => { outro.style.display = 'none'; }, 800);
          };
        }
      }
      console.log('Assets loaded and mesh displayed');
    });
    this.animate();
  }

  // Show mesh as points (for intro: human made of particles)
  showMeshAsPoints() {
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
    const material = new THREE.PointsMaterial({ size: 0.05, color: 0xffffff });
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
        for (let i = 0; i < 3000; i++) {
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

    // Scene and camera setup
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.z = 5;
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
    const material = new THREE.PointsMaterial({ size: 0.05, color: 0xffffff });
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
    // Orbit the camera around the center
    const radius = 5;
    const speed = 0.003; // radians per frame
    if (!this._orbitAngle) this._orbitAngle = 0;
    this._orbitAngle += speed;
    this.camera.position.x = Math.sin(this._orbitAngle) * radius;
    this.camera.position.z = Math.cos(this._orbitAngle) * radius;
    this.camera.lookAt(0, 0, 0);

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

  setupIntroOverlay() {
    const introOverlay = document.getElementById('intro-overlay');
    // Only allow one scroll to trigger the intro-to-level0 transition
    let introDone = false;
    const fadeOutIntro = async () => {
      if (this.isAnimating || this._swipeLocked || introDone) return;
      this.isAnimating = true;
      this._swipeLocked = true;
      introDone = true;
      if (introOverlay && !introOverlay.style.opacity) {
        introOverlay.style.transition = 'opacity 0.7s';
        introOverlay.style.opacity = '0';
        setTimeout(() => {
          introOverlay.style.display = 'none';
        }, 700);
      }
      // Remove listeners after first use
      window.removeEventListener('scroll', fadeOutIntro);
      window.removeEventListener('wheel', fadeOutIntro);
      // Wait for fade out
      await new Promise(res => setTimeout(res, 700));
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
    };
    if (introOverlay) {
      window.addEventListener('scroll', fadeOutIntro, { once: true });
      window.addEventListener('wheel', fadeOutIntro, { once: true });
    } else {
      window.addEventListener('scroll', fadeOutIntro, { once: true });
      window.addEventListener('wheel', fadeOutIntro, { once: true });
    }
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
    // Allow level -1 for intro overlay state
    if (level < -1) level = -1;
    // --- OUTRO OVERLAY HANDLING ---
    const outro = document.getElementById('outro-overlay');
    if (level > this.timeline.length - 1) {
      // Show outro overlay
      if (outro) {
        outro.style.display = 'block';
        setTimeout(() => { outro.style.opacity = '1'; }, 10);
        // Attach scroll/wheel/keyboard/touch listeners for backward navigation from outro
        if (!this._outroBackHandler) {
          this._outroBackHandler = async (e) => {
            if (this.isAnimating || this._swipeLocked) return;
            // Only allow backward navigation (scroll up, arrow up, swipe down)
            let backward = false;
            if (e.type === 'wheel' && e.deltaY < 0) backward = true;
            if (e.type === 'keydown' && (e.key === 'ArrowUp' || e.key === 'PageUp')) backward = true;
            if (e.type === 'touchmove' && this._outroTouchStartY !== null && e.touches.length === 1) {
              const deltaY = e.touches[0].clientY - this._outroTouchStartY;
              if (deltaY > 60) backward = true;
            }
            if (backward) {
              // Fade out outro overlay
              outro.style.transition = 'opacity 0.7s';
              outro.style.opacity = '0';
              setTimeout(() => { outro.style.display = 'none'; }, 700);
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
              await this.gotoTimelineStep(this.timeline.length - 1);
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
      }
      return;
    } else if (outro && outro.style.display === 'block') {
      // If outro is visible and user navigates back, fade it out
      outro.style.transition = 'opacity 0.7s';
      outro.style.opacity = '0';
      setTimeout(() => { outro.style.display = 'none'; }, 700);
      // Remove listeners if any
      if (this._outroBackHandler) {
        window.removeEventListener('wheel', this._outroBackHandler, true);
        window.removeEventListener('keydown', this._outroBackHandler, true);
        window.removeEventListener('touchstart', this._outroTouchStartHandler, true);
        window.removeEventListener('touchmove', this._outroBackHandler, true);
        window.removeEventListener('touchend', this._outroTouchEndHandler, true);
        this._outroBackHandler = null;
        this._outroTouchStartHandler = null;
        this._outroTouchEndHandler = null;
        this._outroTouchStartY = null;
      }
    }
    this.isAnimating = true;
    this._swipeLocked = true;
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
      // Animate all points back to initial cloud
      const positions = this.points.geometry.attributes.position;
      const start = [];
      for (let i = 0; i < positions.count; i++) {
        start.push(positions.getX(i), positions.getY(i), positions.getZ(i));
      }
      const end = this._cloudPositions.slice();
      await new Promise(resolve => {
        this.animateMorph(start, end, positions, resolve);
      });
      // Fade out timeline overlay
      const overlay = document.getElementById('timeline-overlay');
      if (overlay) {
        overlay.style.transition = 'opacity 0.7s';
        overlay.style.opacity = '0';
      }
      // Fade in intro overlay
      const intro = document.getElementById('intro-overlay');
      if (intro) {
        intro.style.display = '';
        void intro.offsetWidth;
        intro.style.transition = 'opacity 0.7s';
        intro.style.opacity = '1';
        // Re-attach scroll/wheel listeners for intro overlay
        // Use the correct morph function (should be morphMeshToCloudIntro, not morphCloudToMeshIntro)
        const fadeOutIntro = async () => {
          if (this.isAnimating || this._swipeLocked) return;
          this.isAnimating = true;
          this._swipeLocked = true;
          intro.style.transition = 'opacity 0.7s';
          intro.style.opacity = '0';
          setTimeout(() => {
            intro.style.display = 'none';
          }, 700);
          window.removeEventListener('scroll', fadeOutIntro);
          window.removeEventListener('wheel', fadeOutIntro);
          await new Promise(res => setTimeout(res, 700));
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
          this.isAnimating = false;
          this._swipeLocked = false;
          this._introFaded = true;
        };
        window.addEventListener('scroll', fadeOutIntro, { once: true });
        window.addEventListener('wheel', fadeOutIntro, { once: true });
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
    const prevPercent = (this.currentLevel >= 0 && this.timeline[this.currentLevel]) ? (this.timeline[this.currentLevel].items_consumed / this.totalItems) : 0;
    await this.animateDetachAndZoomDeterministic(prevPercent, percent);
    this.currentLevel = level;
    this.updateTimelineOverlay(level);
    // Fade in overlay
    const overlay = document.getElementById('timeline-overlay');
    if (overlay) {
      overlay.style.transition = 'opacity 0.7s';
      overlay.style.opacity = '1';
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
    // For each point, animate from prev to next detached state
    const startPositions = [];
    const endPositions = [];
    for (let i = 0; i < count; i++) {
      // Start: detached if in prev, else mesh
      let x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      startPositions.push(x, y, z);
      // End: detached if in next, else mesh
      let meshX = this._meshPositions[i*3], meshY = this._meshPositions[i*3+1], meshZ = this._meshPositions[i*3+2];
      if (detachIndicesNext.has(i)) {
        // Move outward from mesh
        const len = Math.sqrt(meshX*meshX + meshY*meshY + meshZ*meshZ) || 1;
        const scale = 2.5;
        endPositions.push(meshX + (meshX/len)*scale, meshY + (meshY/len)*scale, meshZ + (meshZ/len)*scale);
      } else {
        endPositions.push(meshX, meshY, meshZ);
      }
    }
    // Animate detachment/reattachment and camera zoom
    const startZ = this.camera.position.z;
    const endZ = 5 + nextPercent * 3;
    const duration = 1200;
    const startTime = performance.now();
    await new Promise(resolve => {
      const animate = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / duration, 1);
        for (let i = 0; i < count; i++) {
          const idx = i * 3;
          positions.setXYZ(
            i,
            startPositions[idx] + (endPositions[idx] - startPositions[idx]) * t,
            startPositions[idx+1] + (endPositions[idx+1] - startPositions[idx+1]) * t,
            startPositions[idx+2] + (endPositions[idx+2] - startPositions[idx+2]) * t
          );
        }
        positions.needsUpdate = true;
        this.camera.position.z = startZ + (endZ - startZ) * t;
        this.camera.updateProjectionMatrix();
        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          resolve();
        }
      };
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
      contaminationRate: (typeof data.items_consumed === 'number' && this.totalItems ? data.items_consumed / this.totalItems : 0),
      description: (data.label !== undefined && data.label !== '' ? data.label : (data.description !== undefined ? data.description : '')),
      show: true,
      step: level + 1,
      totalSteps: this.timeline.length,
      references: data.references || ''
    });
  }
}