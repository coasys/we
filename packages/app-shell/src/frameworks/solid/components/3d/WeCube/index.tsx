import { createSignal, mergeProps, onCleanup, onMount } from 'solid-js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import wecubeRecord from '../../../../../shared/assets/wecube-2.glb';

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
const FADE_IN_DURATION = 0.8; // Seconds for the component to fade in on first load.
const SHOW_INTRO = true; // Set to false to skip the intro animation entirely and go straight to auto-rotation.
const SHOW_PARTICLE_CLOUD = false; // Toggle the co-rotating particle cloud layer around the cube.
const SHOW_NETWORK = false; // Toggle the network layer of nodes and edges surrounding the cube.
const NETWORK_NODE_PULSE = true; // When true, each node's opacity oscillates between NETWORK_OPACITY_MIN and NETWORK_OPACITY_MAX.
const SHOW_SPHERE = false; // Toggle the semi-transparent sphere layer surrounding the cube.

const CUBE_ZOOM = 0.85; // Zoom level for the cube — tweak to make it fill more or less of the frame. 1 = tight fit, smaller = more breathing room.
const GLOW_SIZE = 2.0; // Size of the glow layer relative to the cube size. Higher = bigger glow, but too high causes more noticeable pixelation at the edges. Keep below ~3 for best results.

const PRE_INTRO_PAUSE = 0.5; // Seconds to pause on the initial view before starting the intro animation cycling through the snap views. Set to 0 to disable the pause.
const INTRO_SNAP_INTERVAL = 0; // Seconds between each snap in the intro animation. Set to 0 to disable the intro and start directly at the first snap view (same as props.rotationSpeed = 0, but with the correct initial orientation).
const SNAP_DURATION = 0.8; // Seconds for each snap animation to complete. Set to 0 for instant snaps with no animation (not recommended — the animation helps visually connect the views and makes it clear it's the same cube).
const POST_INTRO_PAUSE = 0; // Seconds to pause after the intro animation finishes before starting auto-rotation. Set to 0 to start auto-rotation immediately after the intro.
const SPIN_UP_DURATION = 3.0; // Seconds for auto-rotation to accelerate from 0 to full speed. Set to 0 to have auto-rotation start immediately at full speed (not recommended — the spin-up gives a nice sense of the cube coming to life, and prevents a jarring jump if the intro is disabled or the user interacts during the intro).
const FREE_ROTATION_SPEED = 0.3; // Radians per second for auto-rotation after the intro. Set to 0 to disable auto-rotation.
const FREE_ROTATION_DIRECTION = 0.2; // 1 = counter-clockwise (left), -1 = clockwise (right) when viewed from above.
const FREE_ROTATION_TILT: number = 0; // Radians per second of vertical (up/down) rotation. Positive = tilts upward, negative = tilts downward. 0 = no vertical rotation.

const PARTICLE_COLOR = '#6d3aed';
const PARTICLE_COUNT = 100; // Number of particles in the co-rotating cloud.
const PARTICLE_INNER_RADIUS = 1.6; // Inner radius of the particle shell — particles are excluded from this zone to avoid overlapping the cube.
const PARTICLE_OUTER_RADIUS = 4; // Outer radius of the particle shell. Keep below ~2.9 (frustum half-size) to avoid clipping at canvas edges.
const PARTICLE_OPACITY = 0.7; // Opacity of the particle dots (0 = invisible, 1 = fully opaque).

const SPHERE_RADIUS = 2.7; // Radius of the surrounding sphere. 1.0 roughly encloses the cube — go larger for a looser halo.
const SPHERE_COLOR = '#7c3aed'; // Fill color of the sphere.
const SPHERE_OPACITY = 0.7; // Opacity of the sphere (0 = invisible, 1 = fully opaque). Keep low for a subtle halo effect.

const NETWORK_COLOR = '#b860ee';
const NETWORK_HUE_RANGE = 30; // Degrees of hue shift applied randomly to each node, centered on NETWORK_COLOR. e.g. 40 → ±20° around the base hue.
const NET_NODE_COUNT = 50; // Number of nodes in the network layer. Adjust as needed for visual density and performance balance — higher = more nodes and edges, but also more GPU load. Keep in mind that edges grow roughly with the square of node count, but we cap edges per node to mitigate this.
const NET_SPHERE_INNER_RADIUS = 3; // Inner radius — nodes are excluded from this zone to avoid overlapping the cube.
const NET_SPHERE_OUTER_RADIUS = 3.5; // Outer radius of the shell within which network nodes are randomly distributed.
const NET_MAX_EDGE_DIST = 2; // Maximum distance between two nodes for an edge to be drawn. Adjust to make the network more or less connected — lower = fewer edges and a sparser look, higher = more edges and a denser look. Keep in mind that the number of edges grows with the square of this distance, but we also cap edges per node to prevent hairball clusters.
const NET_MAX_EDGES_PER_NODE = 5; // Cap on the number of edges each node can have. This prevents highly connected nodes from creating large hairball clusters that dominate the visual and make it hard to see the cube. Adjust as needed to balance between a more web-like look (higher) and clearer separation between nodes (lower).
const NET_NODE_MIN_SIZE = 3; // px — smallest node circle
const NET_NODE_MAX_SIZE = 16; // px — largest node circle
const NETWORK_OPACITY = 0.6; // Base opacity of network nodes when pulse is off (0 = invisible, 1 = fully opaque). Also used as NETWORK_OPACITY_MAX when pulse is on.
const NETWORK_OPACITY_MIN = 0.05; // Minimum opacity during pulse cycle (only used when NETWORK_NODE_PULSE is true).
const NETWORK_PULSE_SPEED = 0.8; // Speed of the opacity pulse in cycles per second — higher = faster flicker.
const NETWORK_EDGE_OPACITY = 0.1; // Opacity of network edges (0 = invisible, 1 = fully opaque).

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
  const props = mergeProps({ width: '200px', height: '200px', rotationSpeed: FREE_ROTATION_SPEED }, rawProps);
  let containerRef: HTMLDivElement | undefined;
  const [visible, setVisible] = createSignal(false);

  onMount(() => {
    // Defer opacity change to the next frame so the browser first paints at opacity 0,
    // allowing the CSS transition to run from the very first render.
    requestAnimationFrame(() => setVisible(true));
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
    loader.load(wecubeRecord, (gltf) => {
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
      if (SHOW_PARTICLE_CLOUD) {
        const positions = new Float32Array(PARTICLE_COUNT * 3);
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          const r = PARTICLE_INNER_RADIUS + Math.random() * (PARTICLE_OUTER_RADIUS - PARTICLE_INNER_RADIUS); // shell from PARTICLE_INNER_RADIUS to PARTICLE_OUTER_RADIUS
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(2 * Math.random() - 1);
          positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
          positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
          positions[i * 3 + 2] = r * Math.cos(phi);
        }
        const particleGeo = new THREE.BufferGeometry();
        particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const particleMat = new THREE.PointsMaterial({
          color: PARTICLE_COLOR,
          size: 2,
          sizeAttenuation: false,
          transparent: true,
          opacity: PARTICLE_OPACITY,
        });
        pivotGroup.add(new THREE.Points(particleGeo, particleMat));
      } // end SHOW_PARTICLE_CLOUD

      // Surrounding sphere — semi-transparent halo co-rotating with the cube.
      if (SHOW_SPHERE) {
        const sphereGeo = new THREE.SphereGeometry(SPHERE_RADIUS, 48, 32);
        const sphereMat = new THREE.MeshLambertMaterial({
          color: SPHERE_COLOR,
          transparent: true,
          opacity: SPHERE_OPACITY,
          side: THREE.BackSide, // render inside faces only so the cube is always visible through it
          depthWrite: false,
        });
        pivotGroup.add(new THREE.Mesh(sphereGeo, sphereMat));
      } // end SHOW_SPHERE

      // Network layer — nodes scattered in a sphere, connected by short edges.
      if (SHOW_NETWORK) {
        const netPositions: THREE.Vector3[] = [];
        while (netPositions.length < NET_NODE_COUNT) {
          const v = new THREE.Vector3(
            (Math.random() * 2 - 1) * NET_SPHERE_OUTER_RADIUS,
            (Math.random() * 2 - 1) * NET_SPHERE_OUTER_RADIUS,
            (Math.random() * 2 - 1) * NET_SPHERE_OUTER_RADIUS,
          );
          if (v.length() >= NET_SPHERE_INNER_RADIUS && v.length() <= NET_SPHERE_OUTER_RADIUS) netPositions.push(v);
        }
        // Build edges — sort by distance, cap per-node degree.
        const pairs: { a: number; b: number; dist: number }[] = [];
        for (let i = 0; i < NET_NODE_COUNT; i++) {
          for (let j = i + 1; j < NET_NODE_COUNT; j++) {
            const d = netPositions[i].distanceTo(netPositions[j]);
            if (d <= NET_MAX_EDGE_DIST) pairs.push({ a: i, b: j, dist: d });
          }
        }
        pairs.sort((x, y) => x.dist - y.dist);
        const degree = new Array<number>(NET_NODE_COUNT).fill(0);
        const netEdges: [number, number][] = [];
        for (const { a, b } of pairs) {
          if (degree[a] < NET_MAX_EDGES_PER_NODE && degree[b] < NET_MAX_EDGES_PER_NODE) {
            netEdges.push([a, b]);
            degree[a]++;
            degree[b]++;
          }
        }
        // Node points — circular, varied size via ShaderMaterial + per-vertex pointSize, color and phase attributes.
        const nodeBuf = new Float32Array(NET_NODE_COUNT * 3);
        const sizeBuf = new Float32Array(NET_NODE_COUNT);
        const colorBuf = new Float32Array(NET_NODE_COUNT * 3);
        const phaseBuf = new Float32Array(NET_NODE_COUNT); // per-node phase offset so pulses are desynchronised
        const baseColor = new THREE.Color(NETWORK_COLOR);
        const hsl = { h: 0, s: 0, l: 0 };
        baseColor.getHSL(hsl);
        for (let i = 0; i < NET_NODE_COUNT; i++) {
          nodeBuf[i * 3] = netPositions[i].x;
          nodeBuf[i * 3 + 1] = netPositions[i].y;
          nodeBuf[i * 3 + 2] = netPositions[i].z;
          sizeBuf[i] = NET_NODE_MIN_SIZE + Math.random() * (NET_NODE_MAX_SIZE - NET_NODE_MIN_SIZE);
          const hueShift = (Math.random() - 0.5) * (NETWORK_HUE_RANGE / 360);
          const nodeColor = new THREE.Color().setHSL((hsl.h + hueShift + 1) % 1, hsl.s, hsl.l);
          colorBuf[i * 3] = nodeColor.r;
          colorBuf[i * 3 + 1] = nodeColor.g;
          colorBuf[i * 3 + 2] = nodeColor.b;
          phaseBuf[i] = Math.random() * Math.PI * 2;
        }
        const nodeGeo = new THREE.BufferGeometry();
        nodeGeo.setAttribute('position', new THREE.BufferAttribute(nodeBuf, 3));
        nodeGeo.setAttribute('pointSize', new THREE.BufferAttribute(sizeBuf, 1));
        nodeGeo.setAttribute('nodeColor', new THREE.BufferAttribute(colorBuf, 3));
        nodeGeo.setAttribute('nodePhase', new THREE.BufferAttribute(phaseBuf, 1));
        const nodeMat = new THREE.ShaderMaterial({
          transparent: true,
          uniforms: {
            opacityBase: { value: NETWORK_OPACITY },
            opacityMin: { value: NETWORK_OPACITY_MIN },
            pulse: { value: NETWORK_NODE_PULSE ? 1.0 : 0.0 },
            speed: { value: NETWORK_PULSE_SPEED },
            time: { value: 0.0 },
          },
          vertexShader: `
            attribute float pointSize;
            attribute vec3 nodeColor;
            attribute float nodePhase;
            varying vec3 vColor;
            varying float vPhase;
            void main() {
              vColor = nodeColor;
              vPhase = nodePhase;
              gl_PointSize = pointSize;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform float opacityBase;
            uniform float opacityMin;
            uniform float pulse;
            uniform float speed;
            uniform float time;
            varying vec3 vColor;
            varying float vPhase;
            void main() {
              if (length(gl_PointCoord - vec2(0.5)) > 0.5) discard;
              float t = sin(time * speed * 6.2831853 + vPhase) * 0.5 + 0.5; // 0..1
              float opacity = mix(opacityBase, opacityMin + (opacityBase - opacityMin) * t, pulse);
              gl_FragColor = vec4(vColor, opacity);
            }
          `,
        });
        pivotGroup.add(new THREE.Points(nodeGeo, nodeMat));
        // Edge lines.
        if (netEdges.length > 0) {
          const edgeBuf = new Float32Array(netEdges.length * 6);
          for (let i = 0; i < netEdges.length; i++) {
            const [a, b] = netEdges[i];
            edgeBuf[i * 6 + 0] = netPositions[a].x;
            edgeBuf[i * 6 + 1] = netPositions[a].y;
            edgeBuf[i * 6 + 2] = netPositions[a].z;
            edgeBuf[i * 6 + 3] = netPositions[b].x;
            edgeBuf[i * 6 + 4] = netPositions[b].y;
            edgeBuf[i * 6 + 5] = netPositions[b].z;
          }
          const edgeGeo = new THREE.BufferGeometry();
          edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgeBuf, 3));
          pivotGroup.add(
            new THREE.LineSegments(
              edgeGeo,
              new THREE.LineBasicMaterial({
                color: NETWORK_COLOR,
                transparent: true,
                opacity: NETWORK_EDGE_OPACITY,
              }),
            ),
          );
        }
      } // end SHOW_NETWORK
    });

    // Snap view presets — YXZ Euler: y = horizontal spin, x = vertical tilt.
    // TOP_FACE/FRONT_FACE are the x-tilts needed to point directly at the +Y and +Z cube faces.
    const TOP_FACE = Math.acos(1 / Math.sqrt(3)); // ≈ 54.74° — +Y face
    const FRONT_FACE = -Math.asin(1 / Math.sqrt(3)); // ≈-35.26° — +Z face
    // roll = camera roll baked into pivotQuat (see viewAxisWorld).
    const snapViews = [
      { x: 0, y: deg(90), roll: deg(60) }, // WE Up
      { x: TOP_FACE, y: deg(45), roll: deg(90) }, // W
      { x: FRONT_FACE, y: deg(45), roll: deg(90) }, // E
      // { x: (TOP_FACE + FRONT_FACE) / 2, y: deg(45), roll: deg(90) }, // WE Middle
      // { x: 0, y: deg(0), roll: deg(120) }, // WE Down
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
    let introPhase = SHOW_INTRO;
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

    let elapsedTime = 0;
    const animate = () => {
      animFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      elapsedTime += delta;
      if (NETWORK_NODE_PULSE && SHOW_NETWORK) {
        // Update the time uniform on the node shader material each frame.
        // We find it by traversing pivotGroup once the model is loaded.
        pivotGroup?.traverse((obj) => {
          if (obj instanceof THREE.Points) {
            const mat = obj.material as THREE.ShaderMaterial;
            if (mat?.uniforms?.time !== undefined) mat.uniforms.time.value = elapsedTime;
          }
        });
      }

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
                delta * props.rotationSpeed * speedMul * FREE_ROTATION_DIRECTION,
              ),
            );
            if (FREE_ROTATION_TILT !== 0) {
              pivotQuat.premultiply(
                new THREE.Quaternion().setFromAxisAngle(
                  new THREE.Vector3(1, 0, 0),
                  delta * FREE_ROTATION_TILT * speedMul,
                ),
              );
            }
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
    <div
      style={{
        position: 'relative',
        width: props.width,
        height: props.height,
        opacity: visible() ? 1 : 0,
        transition: `opacity ${FADE_IN_DURATION}s ease`,
      }}
    >
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
