import { mergeProps, onCleanup, onMount } from 'solid-js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import wecubeModel from '../../../../../shared/assets/wecube-beveled.glb';

// Ensure Three.js treats hex/CSS colors as sRGB (not raw linear), matching the browser.
THREE.ColorManagement.enabled = true;

// ─── Variant system ──────────────────────────────────────────────────────────

export type WeCubeVariant = 'glass' | 'lit-primary' | 'solid' | 'wireframe';

function readPrimaryColor(): THREE.Color {
  const css = getComputedStyle(document.documentElement).getPropertyValue('--we-color-primary').trim();
  const c = new THREE.Color();
  try {
    c.setStyle(css || '#5d4fff'); // setStyle respects ColorManagement: parses as sRGB, stores as linear
  } catch {
    c.setStyle('#5d4fff');
  }
  return c;
}

function hslShifted(base: THREE.Color, hueDelta: number): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  return new THREE.Color().setHSL((((hsl.h + hueDelta) % 1) + 1) % 1, hsl.s, Math.min(0.85, hsl.l + 0.1));
}

function setupVariant(
  variant: WeCubeVariant,
  scene: THREE.Scene,
): {
  material?: THREE.Material;
  // For variants that need to manipulate geometry (e.g. edges-only wireframe)
  patchMesh?: (mesh: THREE.Mesh, container: THREE.Object3D) => void;
  // Optional renderer configuration (e.g. tone mapping)
  configureRenderer?: (renderer: THREE.WebGLRenderer) => void;
  updateColors?: () => void;
} {
  switch (variant) {
    case 'glass': {
      scene.add(new THREE.AmbientLight(0xffffff, 1.0));
      const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
      keyLight.position.set(10, 20, 15);
      scene.add(keyLight);
      const fillLight = new THREE.DirectionalLight(0xffffff, 0.8);
      fillLight.position.set(-10, 5, -10);
      scene.add(fillLight);
      return {
        material: new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          metalness: 0.0,
          roughness: 0.0,
          transmission: 1.0,
          transparent: true,
          ior: 2,
          thickness: 5,
          envMapIntensity: 1.0,
          side: THREE.DoubleSide,
          clearcoat: 0.1,
          clearcoatRoughness: 0.0,
          attenuationDistance: 0.5,
          attenuationColor: new THREE.Color(0.9, 0.9, 1.0),
        }),
      };
    }

    case 'lit-primary': {
      scene.add(new THREE.AmbientLight(0xffffff, 0.5));
      scene.add(new THREE.DirectionalLight(0xff69b4, 2.0));
      const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
      const updateColors = () => {
        mat.color.copy(readPrimaryColor());
      };
      updateColors();
      return { material: mat, updateColors };
    }

    case 'solid': {
      // Flat primary colour on the material itself, neutral white lighting
      scene.add(new THREE.AmbientLight(0xffffff, 0.5));
      const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
      keyLight.position.set(10, 20, 15);
      scene.add(keyLight);
      const rimLight = new THREE.DirectionalLight(0xffffff, 0.6);
      rimLight.position.set(-8, -5, -10);
      scene.add(rimLight);
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.1 });
      const updateColors = () => {
        mat.color.copy(readPrimaryColor());
      };
      updateColors();
      return { material: mat, updateColors };
    }

    case 'wireframe': {
      // Use EdgesGeometry so only real silhouette edges are drawn, not internal triangle diagonals.
      const lineMat = new THREE.LineBasicMaterial();
      const updateColors = () => {
        lineMat.color.copy(readPrimaryColor());
      };
      updateColors();
      return {
        patchMesh: (mesh, container) => {
          mesh.visible = false; // hide solid mesh, show edges only
          const edgesGeo = new THREE.EdgesGeometry(mesh.geometry, 0.1); // 5° threshold — catches bevel edges, still drops coplanar face diagonals
          const lines = new THREE.LineSegments(edgesGeo, lineMat);
          lines.position.copy(mesh.position);
          lines.rotation.copy(mesh.rotation);
          lines.scale.copy(mesh.scale);
          container.add(lines);
        },
        updateColors,
      };
    }
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

interface WeCubeProps {
  width?: string;
  height?: string;
  rotationSpeed?: number; // radians per second; 0 to disable auto-rotation
  variant?: WeCubeVariant;
}

export function WeCube(rawProps: WeCubeProps) {
  const props = mergeProps(
    { width: '200px', height: '200px', rotationSpeed: 0.6, variant: 'lit-primary' as WeCubeVariant },
    rawProps,
  );
  let containerRef: HTMLDivElement | undefined;

  onMount(() => {
    if (!containerRef) return;

    const width = containerRef.clientWidth;
    const height = containerRef.clientHeight;

    // Scene
    const scene = new THREE.Scene();

    // Camera — frustumSize tuned so the cube has breathing room on all sides
    const aspect = width / height;
    const frustumSize = 6;
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

    // Material + lighting for this variant
    const { material, patchMesh, configureRenderer, updateColors } = setupVariant(props.variant, scene);
    configureRenderer?.(renderer);

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
        if (patchMesh) {
          patchMesh(mesh, model);
        } else if (material) {
          mesh.material = material;
        }
      }

      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());

      pivotGroup = new THREE.Group();
      scene.add(pivotGroup);
      pivotGroup.add(model);
      model.position.set(-center.x, -center.y, -center.z);

      // Initial isometric-friendly orientation
      pivotGroup.rotation.set(THREE.MathUtils.degToRad(55), THREE.MathUtils.degToRad(0), THREE.MathUtils.degToRad(-45));
    });

    // Drag-to-rotate state
    let isDragging = false;
    let prevMouse = { x: 0, y: 0 };
    let dragRotX = 0; // accumulated vertical drag offset
    let autoRotY = THREE.MathUtils.degToRad(-45); // single Y angle, advanced by auto-rotation and horizontal drag

    const canvas = renderer.domElement;

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      prevMouse = { x: e.clientX, y: e.clientY };
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
      isDragging = false;
      canvas.releasePointerCapture(e.pointerId);
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
        if (!isDragging) {
          autoRotY += delta * props.rotationSpeed;
        }
        pivotGroup.rotation.x = THREE.MathUtils.degToRad(55) + dragRotX;
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

  return <div ref={containerRef} style={{ width: props.width, height: props.height, cursor: 'grab' }} />;
}

export default WeCube;
