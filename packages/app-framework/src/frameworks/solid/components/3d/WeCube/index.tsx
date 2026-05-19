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

    const deg = THREE.MathUtils.degToRad;

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
    // viewAxisWorld: camera forward direction in world space (scene → camera = (-1,-1,-1)/√3).
    // Roll is baked into the pivot quaternion as a rotation around this axis, so a single
    // slerp on pivotQuat gives a visually clean arc — no separate roll animation diverging.
    const viewAxisWorld = new THREE.Vector3(-1, -1, -1).normalize();
    camera.up.set(0, 1, 0); // fixed — roll is encoded in pivotQuat instead
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
    const TOP_FACE = Math.acos(1 / Math.sqrt(3)); // ≈ 54.74° — +Y face
    const BOTTOM_FACE = TOP_FACE - Math.PI; // ≈-125.26° — -Y face (cube flips)
    const FRONT_FACE = -Math.asin(1 / Math.sqrt(3)); // ≈-35.26° — +Z face
    const BACK_FACE = Math.asin(1 / Math.sqrt(3)); // ≈ 35.26° — -Z face
    // roll = camera roll angle for this snap view.
    // deg(60) = spike-up isometric (one edge points up, two down).
    // 0       = spike-down isometric (one edge points down, two up).
    const snapViews = [
      { x: BACK_FACE + 0.34, y: deg(45), roll: deg(90) }, // W
      { x: BACK_FACE - 1.23, y: deg(45), roll: deg(90) }, // E
      { x: 0.17, y: deg(45), roll: deg(90) }, // WE Middle
      { x: 0, y: deg(0), roll: deg(120) }, // WE Down
      { x: 0, y: deg(90), roll: deg(60) }, // WE Up

      // // 4 upper corners — spike-up (roll 60°) ──
      // { x: 0, y: 0, roll: deg(60) }, // corner +X+Y+Z
      // { x: 0, y: deg(90), roll: deg(60) }, // Original WE
      // { x: 0, y: deg(180), roll: deg(60) }, // corner -X+Y-Z
      // { x: 0, y: deg(-90), roll: deg(60) }, // corner +X+Y-Z
      // // 4 upper corners — spike-down (roll 0°) ──
      // { x: 0, y: 0, roll: 0 }, // corner +X+Y+Z
      // { x: 0, y: deg(90), roll: 0 }, // corner -X+Y+Z
      // { x: 0, y: deg(180), roll: 0 }, // corner -X+Y-Z
      // { x: 0, y: deg(-90), roll: 0 }, // Down WE
      // // 4 reachable flat faces (no roll — edges appear level) ──
      // { x: TOP_FACE, y: deg(45), roll: 0 }, // E
      // { x: BOTTOM_FACE, y: deg(45), roll: 0 }, // W
      // { x: FRONT_FACE, y: deg(45), roll: 0 }, // M
      // { x: BACK_FACE, y: deg(-135), roll: 0 }, // E
    ];
    let snapIndex = 0;

    // Drag-to-rotate state
    let isDragging = false;
    let isSnapping = false;
    // Quaternion-based orientation — replaces the old separate dragRotX / autoRotY Euler state.
    // Using a quaternion lets drag feel like spinning a physical ball (arcball) rather than
    // independently accumulating two Euler angles, which causes the axis-coupling/drift the
    // Euler approach suffered from.
    // Initial pivot encodes the starting visual roll (deg(60)) baked into orientation.
    const pivotQuat = new THREE.Quaternion().setFromAxisAngle(viewAxisWorld, -deg(60));
    const snapTargetQuat = new THREE.Quaternion();
    let prevMouse = { x: 0, y: 0 };
    let pointerDownPos = { x: 0, y: 0 };

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

      // Arcball rotation: the rotation axis is perpendicular to the drag direction in
      // screen space, mapped to world space via the camera's world matrix columns.
      // This accounts for the current camera roll automatically — no manual compensation needed.
      // Dragging along any screen diagonal produces a clean spin around the matching 3D axis.
      camera.updateMatrixWorld();
      const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const camUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const axis = new THREE.Vector3().addScaledVector(camRight, dy).addScaledVector(camUp, dx).normalize();
      const angle = Math.sqrt(dx * dx + dy * dy) * 0.004;
      pivotQuat.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
    };

    const onPointerUp = (e: PointerEvent) => {
      const totalMoved = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      isDragging = false;
      canvas.releasePointerCapture(e.pointerId);

      // Treat as a click if the pointer barely moved — snap to next preset view
      if (totalMoved < 6) {
        const view = snapViews[snapIndex];
        // Bake roll into the target quaternion: rotation(roll, viewAxis) × Euler.
        // This makes the slerp a single smooth arc instead of two diverging animations.
        snapTargetQuat
          .setFromAxisAngle(viewAxisWorld, -view.roll)
          .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(view.x, view.y, 0, 'YXZ')));
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
          // Exponential slerp toward snap target — speed 6 gives ~0.5s settle time.
          const t = 1 - Math.exp(-6 * delta);
          pivotQuat.slerp(snapTargetQuat, t);
          if (pivotQuat.angleTo(snapTargetQuat) < 0.001) {
            pivotQuat.copy(snapTargetQuat);
            isSnapping = false;
          }
        } else if (!isDragging) {
          // Auto-rotation: spin around world Y axis.
          pivotQuat.premultiply(
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), delta * props.rotationSpeed),
          );
        }
        pivotGroup.quaternion.copy(pivotQuat);
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
