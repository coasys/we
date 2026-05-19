import { mergeProps, onCleanup, onMount } from 'solid-js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import wecubeModel from '../../../../../shared/assets/wecube-2.glb';

// Ensure Three.js treats hex/CSS colors as sRGB (not raw linear), matching the browser.
THREE.ColorManagement.enabled = true;

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

// Scene constants
const CUBE_ZOOM = 0.85; // Zoom level for the cube — tweak to make it fill more or less of the frame. 1 = tight fit, smaller = more breathing room.
const GLOW_SIZE = 2.0; // Size of the glow layer relative to the cube size. Higher = bigger glow, but too high causes more noticeable pixelation at the edges. Keep below ~3 for best results.
const PRE_INTRO_PAUSE = 0.5; // Seconds to pause on the initial view before starting the intro animation cycling through the snap views. Set to 0 to disable the pause.
const INTRO_SNAP_INTERVAL = 0; // Seconds between each snap in the intro animation. Set to 0 to disable the intro and start directly at the first snap view (same as props.rotationSpeed = 0, but with the correct initial orientation).
const SNAP_DURATION = 0.8; // Seconds for each snap animation to complete. Set to 0 for instant snaps with no animation (not recommended — the animation helps visually connect the views and makes it clear it's the same cube).
const POST_INTRO_PAUSE = 0; // Seconds to pause after the intro animation finishes before starting auto-rotation. Set to 0 to start auto-rotation immediately after the intro.
const SPIN_UP_DURATION = 2.0; // Seconds for auto-rotation to accelerate from 0 to full speed. Set to 0 to have auto-rotation start immediately at full speed (not recommended — the spin-up gives a nice sense of the cube coming to life, and prevents a jarring jump if the intro is disabled or the user interacts during the intro).
const easeInOutCubic = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
// const easeOutCubic = (p: number) => 1 - (1 - p) ** 3;
// const smoothstep = (p: number) => p * p * (3 - 2 * p);
// const linear = (p: number) => p;
const snapEase = easeInOutCubic;

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

    // Snap view presets — YXZ Euler: y = horizontal spin, x = vertical tilt.
    // TOP_FACE/FRONT_FACE are the x-tilts needed to point directly at the +Y and +Z cube faces.
    const TOP_FACE = Math.acos(1 / Math.sqrt(3)); // ≈ 54.74° — +Y face
    const FRONT_FACE = -Math.asin(1 / Math.sqrt(3)); // ≈-35.26° — +Z face
    // roll = camera roll baked into pivotQuat (see viewAxisWorld).
    const snapViews = [
      { x: TOP_FACE, y: deg(45), roll: deg(90) }, // W
      { x: FRONT_FACE, y: deg(45), roll: deg(90) }, // E
      // { x: (TOP_FACE + FRONT_FACE) / 2, y: deg(45), roll: deg(90) }, // WE Middle
      { x: 0, y: deg(0), roll: deg(120) }, // WE Down
      { x: 0, y: deg(90), roll: deg(60) }, // WE Up
      // { x: (TOP_FACE + FRONT_FACE) / 2, y: deg(45), roll: deg(90) }, // WE Middle
    ];
    let snapIndex = 0;

    // Drag-to-rotate state
    let isDragging = false;
    let isSnapping = false;
    // Quaternion-based orientation — replaces the old separate dragRotX / autoRotY Euler state.
    // Using a quaternion lets drag feel like spinning a physical ball (arcball) rather than
    // independently accumulating two Euler angles, which causes the axis-coupling/drift the
    // Euler approach suffered from.
    // Start at snapViews[0] so the first frame shows the correct orientation, and the intro
    // begins from view 1 (no redundant zero-distance snap back to the start).
    const pivotQuat = new THREE.Quaternion()
      .setFromAxisAngle(viewAxisWorld, -snapViews[0].roll)
      .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(snapViews[0].x, snapViews[0].y, 0, 'YXZ')));
    const snapTargetQuat = new THREE.Quaternion();
    const snapStartQuat = new THREE.Quaternion();
    let snapElapsed = 0;
    let prevMouse = { x: 0, y: 0 };
    let pointerDownPos = { x: 0, y: 0 };
    // Intro: cycle through all snap views once on load before auto-rotation starts.
    let introPhase = true;
    let introIdx = 1; // start at 1 — already at snapViews[0]
    let introTimer = -PRE_INTRO_PAUSE; // negative so it must count up past 0 before first snap fires
    let postIntroTimer = 0;
    let spinUpElapsed = 0;

    const canvas = renderer.domElement;

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      isSnapping = false;
      introPhase = false;
      postIntroTimer = 0;
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
        snapStartQuat.copy(pivotQuat);
        snapElapsed = 0;
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
          // Duration-based slerp with easing — SNAP_DURATION controls the time, snapEase the curve.
          snapElapsed += delta;
          const p = Math.min(snapElapsed / SNAP_DURATION, 1);
          pivotQuat.copy(snapStartQuat).slerp(snapTargetQuat, snapEase(p));
          if (p >= 1) {
            pivotQuat.copy(snapTargetQuat);
            isSnapping = false;
          }
        } else if (introPhase) {
          introTimer += delta;
          if (introTimer >= INTRO_SNAP_INTERVAL) {
            introTimer = 0;
            if (introIdx < snapViews.length) {
              const view = snapViews[introIdx++];
              snapStartQuat.copy(pivotQuat);
              snapElapsed = 0;
              snapTargetQuat
                .setFromAxisAngle(viewAxisWorld, -view.roll)
                .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(view.x, view.y, 0, 'YXZ')));
              isSnapping = true;
            } else {
              introPhase = false;
              postIntroTimer = POST_INTRO_PAUSE;
            }
          }
        } else if (!isDragging) {
          if (postIntroTimer > 0) {
            postIntroTimer -= delta;
          } else {
            // Auto-rotation: ease in from 0 to full speed over SPIN_UP_DURATION, then hold.
            spinUpElapsed += delta;
            const speedMul = snapEase(Math.min(spinUpElapsed / SPIN_UP_DURATION, 1));
            pivotQuat.premultiply(
              new THREE.Quaternion().setFromAxisAngle(
                new THREE.Vector3(0, 1, 0),
                delta * props.rotationSpeed * speedMul,
              ),
            );
          }
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
