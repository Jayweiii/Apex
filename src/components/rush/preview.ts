/** Garage preview: the player's kart turning on a podium, in chunky pixels. */
import * as THREE from "three";
import type { KartLook } from "@/lib/rush/garage";
import { buildKart, type KartModel } from "./models";

export type KartPreview = { setLook: (look: KartLook) => void; dispose: () => void };

export function createKartPreview(canvas: HTMLCanvasElement, look: KartLook): KartPreview {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
  renderer.setPixelRatio(1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 50);
  camera.position.set(3.0, 1.75, 3.0);
  camera.lookAt(0, 0.5, 0);
  scene.add(new THREE.HemisphereLight("#cfe3ff", "#4a4036", 1.3));
  const sun = new THREE.DirectionalLight("#fff4d6", 2);
  sun.position.set(3, 5, 2);
  scene.add(sun);

  const podGeo = new THREE.CylinderGeometry(1.75, 1.95, 0.3, 10);
  const podMat = new THREE.MeshLambertMaterial({ color: "#3a3f52", flatShading: true });
  const podium = new THREE.Mesh(podGeo, podMat);
  podium.position.y = -0.15;
  scene.add(podium);

  const spin = new THREE.Group();
  scene.add(spin);
  let model: KartModel = buildKart(look);
  spin.add(model.group);

  const size = () => {
    const w = canvas.clientWidth || 240;
    const h = canvas.clientHeight || 160;
    const px = 2;
    renderer.setSize(Math.max(60, Math.round(w / px)), Math.max(40, Math.round(h / px)), false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  size();
  const ro = new ResizeObserver(size);
  ro.observe(canvas);

  let raf = 0;
  let last = performance.now();
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    spin.rotation.y += dt * 0.7;
    podium.rotation.y = spin.rotation.y;
    for (const w of model.wheels) w.rotation.z -= dt * 2;
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  return {
    setLook: (next) => {
      spin.remove(model.group);
      model.dispose();
      model = buildKart(next);
      spin.add(model.group);
    },
    dispose: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      model.dispose();
      podGeo.dispose();
      podMat.dispose();
      renderer.dispose();
      // Free the context once the canvas is gone (iOS caps live contexts); a StrictMode re-run keeps it.
      setTimeout(() => {
        if (!canvas.isConnected) renderer.forceContextLoss();
      }, 0);
    },
  };
}
