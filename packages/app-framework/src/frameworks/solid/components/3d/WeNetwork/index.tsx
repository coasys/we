import { mergeProps, onCleanup, onMount } from 'solid-js';
import * as THREE from 'three';

THREE.ColorManagement.enabled = true;

const GLOW_SIZE = 1.8;
// Frustum zoom — same scale as WeCube so both feel consistent when swapped.
const ZOOM = 0.9;

// ─── Component ───────────────────────────────────────────────────────────────

interface WeNetworkProps {
  width?: string;
  height?: string;
  /** Number of nodes scattered in 3-D space. */
  nodeCount?: number;
  /** Radius of the sphere nodes are distributed within. */
  sphereRadius?: number;
  /** Maximum distance between two nodes for an edge to be drawn. */
  maxEdgeDistance?: number;
  /** Cap on edges per node — prevents hairball clusters. */
  maxEdgesPerNode?: number;
  rotationSpeed?: number;
}

export function WeNetwork(rawProps: WeNetworkProps) {
  const props = mergeProps(
    {
      width: '200px',
      height: '200px',
      nodeCount: 40,
      sphereRadius: 2.5,
      maxEdgeDistance: 1.5,
      maxEdgesPerNode: 5,
      rotationSpeed: 0.4,
    },
    rawProps,
  );

  let containerRef: HTMLDivElement | undefined;

  onMount(() => {
    if (!containerRef) return;

    const w = containerRef.clientWidth;
    const h = containerRef.clientHeight;

    // ── Camera ──────────────────────────────────────────────────────────────
    const aspect = w / h;
    const frustumSize = 6 / ZOOM;
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

    // ── Renderer ─────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    containerRef.appendChild(renderer.domElement);

    // ── Scene / pivot ────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    const pivot = new THREE.Group();
    pivot.rotation.order = 'YXZ';
    scene.add(pivot);

    // ── Generate node positions (uniform sphere distribution) ────────────────
    const { nodeCount, sphereRadius, maxEdgeDistance, maxEdgesPerNode } = props;
    const nodePositions: THREE.Vector3[] = [];
    while (nodePositions.length < nodeCount) {
      const v = new THREE.Vector3(
        (Math.random() * 2 - 1) * sphereRadius,
        (Math.random() * 2 - 1) * sphereRadius,
        (Math.random() * 2 - 1) * sphereRadius,
      );
      if (v.length() <= sphereRadius) nodePositions.push(v);
    }

    // ── Build edges — connect nearest pairs first, cap per-node degree ───────
    const pairs: { a: number; b: number; dist: number }[] = [];
    for (let i = 0; i < nodeCount; i++) {
      for (let j = i + 1; j < nodeCount; j++) {
        const d = nodePositions[i].distanceTo(nodePositions[j]);
        if (d <= maxEdgeDistance) pairs.push({ a: i, b: j, dist: d });
      }
    }
    pairs.sort((a, b) => a.dist - b.dist);

    const degree = new Array<number>(nodeCount).fill(0);
    const edges: [number, number][] = [];
    for (const { a, b } of pairs) {
      if (degree[a] < maxEdgesPerNode && degree[b] < maxEdgesPerNode) {
        edges.push([a, b]);
        degree[a]++;
        degree[b]++;
      }
    }

    // ── Node mesh (Points) ───────────────────────────────────────────────────
    const nodeBuf = new Float32Array(nodeCount * 3);
    for (let i = 0; i < nodeCount; i++) {
      nodeBuf[i * 3] = nodePositions[i].x;
      nodeBuf[i * 3 + 1] = nodePositions[i].y;
      nodeBuf[i * 3 + 2] = nodePositions[i].z;
    }
    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(nodeBuf, 3));
    const nodeMat = new THREE.PointsMaterial({
      color: '#6d3aed',
      size: 5,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.9,
    });
    pivot.add(new THREE.Points(nodeGeo, nodeMat));

    // ── Edge mesh (LineSegments) ─────────────────────────────────────────────
    if (edges.length > 0) {
      const edgeBuf = new Float32Array(edges.length * 6);
      for (let i = 0; i < edges.length; i++) {
        const [a, b] = edges[i];
        edgeBuf[i * 6 + 0] = nodePositions[a].x;
        edgeBuf[i * 6 + 1] = nodePositions[a].y;
        edgeBuf[i * 6 + 2] = nodePositions[a].z;
        edgeBuf[i * 6 + 3] = nodePositions[b].x;
        edgeBuf[i * 6 + 4] = nodePositions[b].y;
        edgeBuf[i * 6 + 5] = nodePositions[b].z;
      }
      const edgeGeo = new THREE.BufferGeometry();
      edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgeBuf, 3));
      const edgeMat = new THREE.LineBasicMaterial({
        color: '#6d3aed',
        transparent: true,
        opacity: 0.2,
      });
      pivot.add(new THREE.LineSegments(edgeGeo, edgeMat));
    }

    // ── Drag-to-rotate ───────────────────────────────────────────────────────
    let isDragging = false;
    let prevMouse = { x: 0, y: 0 };
    let autoRotY = 0;
    let dragRotX = 0;

    const canvas = renderer.domElement;

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      prevMouse = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - prevMouse.x;
      const dy = e.clientY - prevMouse.y;
      prevMouse = { x: e.clientX, y: e.clientY };
      autoRotY += dx * 0.004;
      dragRotX += dy * 0.004;
      dragRotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, dragRotX));
    };

    const onPointerUp = (e: PointerEvent) => {
      isDragging = false;
      canvas.releasePointerCapture(e.pointerId);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.style.cursor = 'grab';

    // ── Animation loop ───────────────────────────────────────────────────────
    let animFrameId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      if (!isDragging) autoRotY += delta * props.rotationSpeed;
      pivot.rotation.x = dragRotX;
      pivot.rotation.y = autoRotY;
      renderer.render(scene, camera);
    };
    animate();

    // ── Resize handler ───────────────────────────────────────────────────────
    const handleResize = () => {
      if (!containerRef) return;
      const nw = containerRef.clientWidth;
      const nh = containerRef.clientHeight;
      const a = nw / nh;
      camera.left = (-frustumSize * a) / 2;
      camera.right = (frustumSize * a) / 2;
      camera.top = frustumSize / 2;
      camera.bottom = -frustumSize / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    window.addEventListener('resize', handleResize);

    onCleanup(() => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      renderer.dispose();
      if (containerRef?.contains(canvas)) containerRef.removeChild(canvas);
    });
  });

  return (
    <div style={{ position: 'relative', width: props.width, height: props.height }}>
      {/* Ambient glow behind the canvas */}
      <div
        style={{
          position: 'absolute',
          width: `${GLOW_SIZE * 100}%`,
          height: `${GLOW_SIZE * 100}%`,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background:
            'linear-gradient(135deg, rgba(58, 73, 237, 0.4) 0%, rgba(121, 50, 220, 0.2) 60%, transparent 100%)',
          '-webkit-mask-image': 'radial-gradient(circle closest-side at 50% 50%, black 0%, transparent 75%)',
          'mask-image': 'radial-gradient(circle closest-side at 50% 50%, black 0%, transparent 75%)',
          'pointer-events': 'none',
        }}
      />
      <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', cursor: 'grab' }} />
    </div>
  );
}

export default WeNetwork;
