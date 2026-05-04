import { mergeProps, onCleanup, onMount } from 'solid-js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import wecubeModel from '../../../../../shared/assets/wecube-2.glb';

// Ensure Three.js treats hex/CSS colors as sRGB (not raw linear), matching the browser.
THREE.ColorManagement.enabled = true;

// ─── Scene setup ─────────────────────────────────────────────────────────────

function setupScene(scene: THREE.Scene): {
  patchMesh: (mesh: THREE.Mesh, container: THREE.Object3D) => void;
  updateColors: () => void;
} {
  // Semi-transparent purple fill + edge lines.
  // polygonOffset pushes face geometry back in depth so edges render without z-fighting.
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const faceMat = new THREE.MeshLambertMaterial({
    color: '#6d3aed',
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const lineMat = new THREE.LineBasicMaterial();
  const updateColors = () => {
    lineMat.color = new THREE.Color('#6d3aed');
  };
  updateColors();
  return {
    patchMesh: (mesh, container) => {
      mesh.material = faceMat;
      const edgesGeo = new THREE.EdgesGeometry(mesh.geometry, 1); // drop coplanar triangulation diagonals, keep the 12 cube edges
      const lines = new THREE.LineSegments(edgesGeo, lineMat);
      lines.position.copy(mesh.position);
      lines.rotation.copy(mesh.rotation);
      lines.scale.copy(mesh.scale);
      container.add(lines);
    },
    updateColors,
  };
}

// ─── Scene constants ────────────────────────────────────────────────────────

// Higher = cube appears larger in frame (divides the orthographic frustum size).
const CUBE_ZOOM = 0.85;

// Size of the background glow relative to the container. 1.0 = same size as the
// container, 0.5 = half, 1.5 = 50% larger than the container (overflows, ambient).
const GLOW_SIZE = 2.0;

// ─── Component ───────────────────────────────────────────────────────────────

interface WeCubeProps {
  width?: string;
  height?: string;
  rotationSpeed?: number; // radians per second; 0 to disable auto-rotation
}

export function WeCube(rawProps: WeCubeProps) {
  const props = mergeProps({ width: '200px', height: '200px', rotationSpeed: 0.6 }, rawProps);
  let containerRef: HTMLDivElement | undefined;

  onMount(() => {
    if (!containerRef) return;

    const width = containerRef.clientWidth;
    const height = containerRef.clientHeight;

    // Scene
    const scene = new THREE.Scene();

    // Camera — frustumSize tuned so the cube has breathing room on all sides.
    // Divide by CUBE_ZOOM: higher zoom → smaller frustum → cube fills more of the frame.
    const aspect = width / height;
    const frustumSize = 6 / CUBE_ZOOM;
    const camera = new THREE.OrthographicCamera(
      (-frustumSize * aspect) / 2,
      (frustumSize * aspect) / 2,
      frustumSize / 2,
      -frustumSize / 2,
      0.1,
      100,
    );
    camera.position.set(10, 10, 10);
    camera.lookAt(0, 0, 0);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    containerRef.appendChild(renderer.domElement);

    // Scene lighting + materials
    const { patchMesh, updateColors } = setupScene(scene);

    // Watch for theme changes (e.g. data-theme attr on <html>) and re-derive colours
    let observer: MutationObserver | undefined;
    if (updateColors) {
      observer = new MutationObserver(updateColors);
      observer.observe(document.documentElement, { attributes: true });
    }

    // Load model
    let pivotGroup: THREE.Group | undefined;
    const loader = new GLTFLoader();
    loader.load(wecubeModel, (gltf) => {
      const model = gltf.scene;
      const mesh = model.children[0] as THREE.Mesh;
      if (mesh) {
        patchMesh(mesh, model);
      }

      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());

      pivotGroup = new THREE.Group();
      pivotGroup.rotation.order = 'YXZ'; // spin Y (world-up) first, then tilt X — standard turntable convention
      scene.add(pivotGroup);
      pivotGroup.add(model);
      model.position.set(-center.x, -center.y, -center.z);

      // Particle cloud — dots scattered in a shell around the cube, co-rotating
      // with pivotGroup so the rotation of space is visually readable.
      // PARTICLE_DISTANCE is the outer shell radius. Orthographic frustum half-size = 3,
      // so keep this below ~2.9 to avoid clipping at the canvas edges.
      const PARTICLE_DISTANCE = 4;
      const PARTICLE_COUNT = 100;
      const positions = new Float32Array(PARTICLE_COUNT * 3);
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const r = 1.6 + Math.random() * (PARTICLE_DISTANCE - 1.6); // shell from just past the cube to PARTICLE_DISTANCE
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = r * Math.cos(phi);
      }
      const particleGeo = new THREE.BufferGeometry();
      particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const particleMat = new THREE.PointsMaterial({
        color: '#6d3aed', // 0xffffff,
        size: 2,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.5,
      });
      pivotGroup.add(new THREE.Points(particleGeo, particleMat));
    });

    // Snap view presets — YXZ order: y = horizontal spin, x = vertical tilt.
    // Camera at (10,10,10) → view direction (1,1,1)/√3.
    // GLB is clean (no baked rotation), cube faces align with world axes.
    // Solve R_Y(y)*R_X(x)*n̂ = (1,1,1)/√3 for each face/corner normal n̂.
    //
    // Note: +X and -X faces are unreachable — R_Y*R_X*(±1,0,0) always has Y=0,
    // which can never match the camera's Y component (1/√3 ≠ 0).
    const deg = THREE.MathUtils.degToRad;
    const TOP_FACE = Math.acos(1 / Math.sqrt(3)); // ≈ 54.74° — +Y face
    const BOTTOM_FACE = TOP_FACE - Math.PI; // ≈-125.26° — -Y face (cube flips)
    const FRONT_FACE = -Math.asin(1 / Math.sqrt(3)); // ≈-35.26° — +Z face
    const BACK_FACE = Math.asin(1 / Math.sqrt(3)); // ≈ 35.26° — -Z face
    const snapViews = [
      // 4 upper corners (top diagonal faces camera) ──
      { x: 0, y: 0 }, // corner +X+Y+Z  (default)
      { x: 0, y: deg(90) }, // corner -X+Y+Z
      { x: 0, y: deg(180) }, // corner -X+Y-Z
      { x: 0, y: deg(-90) }, // corner +X+Y-Z
      // 4 lower corners (bottom diagonal faces camera) ──
      { x: deg(-90), y: 0 }, // corner +X-Y+Z
      { x: deg(-90), y: deg(90) }, // corner -X-Y+Z
      { x: deg(90), y: deg(180) }, // corner -X-Y-Z
      { x: deg(90), y: deg(-90) }, // corner +X-Y-Z
      // 4 reachable flat faces ──
      { x: TOP_FACE, y: deg(45) }, // top face    (+Y)
      { x: BOTTOM_FACE, y: deg(45) }, // bottom face (-Y, cube flips over)
      { x: FRONT_FACE, y: deg(45) }, // front face  (+Z)
      { x: BACK_FACE, y: deg(-135) }, // back face   (-Z)
    ];
    let snapIndex = 0;

    // Drag-to-rotate state
    let isDragging = false;
    let isSnapping = false;
    let snapTargetX = 0;
    let snapTargetY = 0;
    let prevMouse = { x: 0, y: 0 };
    let pointerDownPos = { x: 0, y: 0 };
    let dragRotX = 0; // starts at isometric corner A (x=0, y=0)
    let autoRotY = 0;

    const canvas = renderer.domElement;

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      isSnapping = false;
      prevMouse = { x: e.clientX, y: e.clientY };
      pointerDownPos = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging || !pivotGroup) return;
      const dx = e.clientX - prevMouse.x;
      const dy = e.clientY - prevMouse.y;
      prevMouse = { x: e.clientX, y: e.clientY };
      autoRotY += dx * 0.004;
      dragRotX += dy * 0.004;
      // Clamp vertical rotation so it doesn't flip
      dragRotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, dragRotX));
    };

    const onPointerUp = (e: PointerEvent) => {
      const totalMoved = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      isDragging = false;
      canvas.releasePointerCapture(e.pointerId);

      // Treat as a click if the pointer barely moved — snap to next preset view
      if (totalMoved < 6) {
        const view = snapViews[snapIndex];
        snapTargetX = view.x;
        snapTargetY = view.y;
        isSnapping = true;
        snapIndex = (snapIndex + 1) % snapViews.length;
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.style.cursor = 'grab';

    // Animation loop
    let animFrameId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();

      if (pivotGroup) {
        if (isSnapping) {
          // Exponential ease toward snap target — speed 6 gives ~0.5s settle time
          const t = 1 - Math.exp(-6 * delta);
          autoRotY += (snapTargetY - autoRotY) * t;
          dragRotX += (snapTargetX - dragRotX) * t;
          if (Math.abs(snapTargetY - autoRotY) < 0.001 && Math.abs(snapTargetX - dragRotX) < 0.001) {
            autoRotY = snapTargetY;
            dragRotX = snapTargetX;
            isSnapping = false;
          }
        } else if (!isDragging) {
          autoRotY += delta * props.rotationSpeed;
        }
        pivotGroup.rotation.x = dragRotX;
        pivotGroup.rotation.y = autoRotY;
      }

      renderer.render(scene, camera);
    };
    animate();

    // Resize handler
    const handleResize = () => {
      if (!containerRef) return;
      const w = containerRef.clientWidth;
      const h = containerRef.clientHeight;
      const a = w / h;
      camera.left = (-frustumSize * a) / 2;
      camera.right = (frustumSize * a) / 2;
      camera.top = frustumSize / 2;
      camera.bottom = -frustumSize / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    onCleanup(() => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener('resize', handleResize);
      observer?.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      renderer.dispose();
      if (containerRef?.contains(canvas)) {
        containerRef.removeChild(canvas);
      }
    });
  });

  return (
    <div style={{ position: 'relative', width: props.width, height: props.height }}>
      {/* Glow layer — sits behind the Three.js canvas. Size controlled by GLOW_SIZE. */}
      <div
        style={{
          position: 'absolute',
          width: `${GLOW_SIZE * 100}%`,
          height: `${GLOW_SIZE * 100}%`,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background:
            'linear-gradient(135deg, rgba(58, 73, 237, 0.6) 0%, rgba(121, 50, 220, 0.3) 60%, transparent 100%)',
          '-webkit-mask-image': 'radial-gradient(circle closest-side at 50% 50%, black 0%, transparent 75%)',
          'mask-image': 'radial-gradient(circle closest-side at 50% 50%, black 0%, transparent 75%)',
          'pointer-events': 'none',
        }}
      />
      <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', cursor: 'grab' }} />
    </div>
  );
}

export default WeCube;
