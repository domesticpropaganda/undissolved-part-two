import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class Scene {
  constructor() {
    this.initScene();
    this.initPreloader();
    this.loadAssets().then(() => {
      this.showInitialCloud();
      this.setupNavigation();
      this.animate();
    });
  }

  initScene() {
    // Renderer setup
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(this.renderer.domElement);

    // Scene and camera setup
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.z = 5;

    // Add a rotating cube
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    this.cube = new THREE.Mesh(geometry, material);
    this.scene.add(this.cube);

    // Handle window resize
    window.addEventListener('resize', () => this.onResize());
  }

  initPreloader() {
    this.preloader = document.createElement('div');
    this.preloader.id = 'preloader';
    this.preloader.textContent = 'Loading...';
    document.body.appendChild(this.preloader);
  }

  async loadAssets() {
    const loader = new GLTFLoader();
    const timelineResponse = await fetch('assets/data/plastikwelt_timeline.json');
    this.timeline = await timelineResponse.json();

    this.mesh = await new Promise((resolve, reject) => {
      loader.load('assets/models/human.glb', resolve, undefined, reject);
    });

    document.body.removeChild(this.preloader);
  }

  showInitialCloud() {
    const geometry = new THREE.BufferGeometry();
    const positions = [];

    for (let i = 0; i < 3000; i++) {
      positions.push((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({ size: 0.05, color: 0xffffff });
    this.points = new THREE.Points(geometry, material);
    this.scene.add(this.points);
  }

  setupNavigation() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        this.morphToMesh();
      } else if (e.key === 'ArrowUp') {
        this.morphToCloud();
      }
    });
  }

  morphToMesh() {
    const positions = this.points.geometry.attributes.position;
    const targetPositions = this.mesh.scene.children[0].geometry.attributes.position.array;

    const start = [];
    const end = [];

    for (let i = 0; i < positions.count; i++) {
      start.push(positions.getX(i), positions.getY(i), positions.getZ(i));
      const idx = (i * 3) % targetPositions.length;
      end.push(targetPositions[idx], targetPositions[idx + 1], targetPositions[idx + 2]);
    }

    this.animateMorph(start, end, positions);
  }

  morphToCloud() {
    const positions = this.points.geometry.attributes.position;
    const start = [];
    const end = [];

    for (let i = 0; i < positions.count; i++) {
      start.push(positions.getX(i), positions.getY(i), positions.getZ(i));
      end.push((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
    }

    this.animateMorph(start, end, positions);
  }

  animateMorph(start, end, positions) {
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
    // Rotate the cube
    this.cube.rotation.x += 0.01;
    this.cube.rotation.y += 0.01;

    // Render the scene
    this.renderer.render(this.scene, this.camera);

    // Request the next frame
    requestAnimationFrame(() => this.animate());
  }
}