"use client";

import { useEffect, useRef } from "react";
import type { MotionValue } from "framer-motion";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/**
 * "Spools, studio white" — scroll-driven hero scene.
 * As you scroll, tape winds from the small supply spool onto the take-up
 * spool (a conversation being recorded) while the camera eases through a
 * small cinematic arc into a close-up of the take-up spool catching warm
 * light. Scrubbed by scroll progress (fed via ref, no React re-renders).
 */

/** Matches the `--paper` token, for fog and for the transparent clear color. */
const PAPER = 0xfffdfc;

export default function HeroScene({
  progress,
}: {
  progress: MotionValue<number>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(PAPER, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(PAPER, 14, 26);

    // studio reflections for glossy surfaces (tape clearcoat, spool edges)
    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnvironment = new RoomEnvironment();
    const envMap = pmrem.fromScene(roomEnvironment, 0.04).texture;
    roomEnvironment.dispose();
    scene.environment = envMap;

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);

    // ---------- studio lighting ----------
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd8dbe0, 0.9));
    const key = new THREE.DirectionalLight(0xfff3e2, 1.5);
    key.position.set(-3.5, 6, 4.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 8;
    key.shadow.camera.bottom = -8;
    key.shadow.radius = 7;
    key.shadow.bias = -0.0005;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.55);
    rim.position.set(4.5, 2, -3.5);
    scene.add(rim);
    const warm = new THREE.PointLight(0xe05540, 4.5, 7, 2);
    warm.position.set(2.3, 0.9, 0.8);
    scene.add(warm);

    // ---------- ground shadow catcher ----------
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.ShadowMaterial({ opacity: 0.13 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2.35;
    ground.receiveShadow = true;
    scene.add(ground);

    // ---------- helpers ----------
    function stripeTexture() {
      const c = document.createElement("canvas");
      c.width = 128;
      c.height = 1;
      const g = c.getContext("2d")!;
      g.clearRect(0, 0, 128, 1);
      g.fillStyle = "rgba(255,255,255,1)";
      g.fillRect(0, 0, 10, 1);
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = THREE.RepeatWrapping;
      tex.repeat.set(26, 1);
      return tex;
    }
    function radialShadowTexture() {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const g = c.getContext("2d")!;
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, "rgba(20,20,26,0.55)");
      grad.addColorStop(0.55, "rgba(20,20,26,0.22)");
      grad.addColorStop(1, "rgba(20,20,26,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    }
    function buildRibbon(
      curve: THREE.CatmullRomCurve3,
      width: number,
      segments: number,
      widthDir: THREE.Vector3,
    ) {
      const positions: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];
      const p = new THREE.Vector3();
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        curve.getPoint(t, p);
        positions.push(
          p.x - (widthDir.x * width) / 2,
          p.y - (widthDir.y * width) / 2,
          p.z - (widthDir.z * width) / 2,
          p.x + (widthDir.x * width) / 2,
          p.y + (widthDir.y * width) / 2,
          p.z + (widthDir.z * width) / 2,
        );
        uvs.push(t, 0, t, 1);
      }
      for (let i = 0; i < segments; i++) {
        const a = i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        indices.push(a, b, c, b, d, c);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(indices);
      g.computeVertexNormals();
      return g;
    }
    function smooth(t: number) {
      return t * t * (3 - 2 * t);
    }
    function clamp01(t: number) {
      return Math.min(1, Math.max(0, t));
    }

    // ---------- spools ----------
    const ceramic = new THREE.MeshStandardMaterial({
      color: 0x35373d,
      roughness: 0.48,
      metalness: 0.22,
    });
    const woundTape = new THREE.MeshPhysicalMaterial({
      color: 0xc03227,
      roughness: 0.38,
      metalness: 0.0,
      clearcoat: 0.9,
      clearcoatRoughness: 0.22,
      envMapIntensity: 0.8,
    });
    const brandGlow = new THREE.MeshBasicMaterial({ color: 0xec4f44 });
    const shadowTex = radialShadowTexture();

    function makeSpool(scale: number) {
      const g = new THREE.Group();
      const spin = new THREE.Group();
      const core = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, 0.44, 48),
        ceramic,
      );
      const tape = new THREE.Mesh(
        new THREE.CylinderGeometry(0.84, 0.84, 0.36, 64),
        woundTape,
      );
      const f1 = new THREE.Mesh(
        new THREE.CylinderGeometry(1.04, 1.04, 0.05, 64),
        ceramic,
      );
      f1.position.y = 0.245;
      const f2 = f1.clone();
      f2.position.y = -0.245;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.5, 0.03, 16, 64),
        brandGlow,
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.225;
      const ringB = ring.clone();
      ringB.position.y = -0.225;
      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 0.5, 24),
        brandGlow,
      );
      // reel-window triangles on the top flange — the classic tape-reel read
      const triShape = new THREE.Shape();
      triShape.moveTo(0, -0.1);
      triShape.lineTo(0.14, 0.1);
      triShape.lineTo(-0.14, 0.1);
      triShape.closePath();
      const triGeo = new THREE.ShapeGeometry(triShape);
      const tris: THREE.Mesh[] = [];
      for (let k = 0; k < 3; k++) {
        const tri = new THREE.Mesh(triGeo, brandGlow);
        const a = (k / 3) * Math.PI * 2;
        tri.rotation.set(-Math.PI / 2, 0, -a + Math.PI / 2);
        tri.position.set(Math.cos(a) * 0.33, 0.272, Math.sin(a) * 0.33);
        tris.push(tri);
      }
      spin.add(core, tape, f1, f2, ring, ringB, hub, ...tris);
      spin.traverse((o) => {
        o.castShadow = true;
      });
      g.add(spin);
      g.scale.setScalar(scale);
      g.userData.spin = spin;
      g.userData.tape = tape;
      return g;
    }

    // take-up spool (the recording accumulates here) — large, upper
    const takeup = makeSpool(1.0);
    takeup.position.set(2.5, 1.0, -0.7);
    takeup.rotation.set(0.35, 0.2, -0.5);
    scene.add(takeup);

    // supply spool — smaller, lower right
    const supply = makeSpool(0.62);
    supply.position.set(4.15, -1.15, -2.3);
    supply.rotation.set(-0.3, 0.4, 0.45);
    scene.add(supply);

    // scene-level soft contact shadows (never inherit the spools' tilt)
    function makeContactShadow(size: number) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({
          map: shadowTex,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
        }),
      );
      m.rotation.x = -Math.PI / 2;
      scene.add(m);
      return m;
    }
    const shadowA = makeContactShadow(3.0);
    const shadowB = makeContactShadow(2.2);
    function placeShadows() {
      const pairs: Array<[THREE.Group, THREE.Mesh]> = [
        [takeup, shadowA],
        [supply, shadowB],
      ];
      for (const [spool, s] of pairs) {
        const height = spool.position.y + 2.35;
        s.position.set(
          spool.position.x + 0.35,
          -2.33,
          spool.position.z + 0.35,
        );
        const fade = THREE.MathUtils.clamp(1.1 - height * 0.14, 0.3, 1);
        (s.material as THREE.MeshBasicMaterial).opacity = 0.5 * fade;
        const stretch = 1 + height * 0.15;
        s.scale.set(stretch, stretch, 1);
      }
    }
    placeShadows();

    // ---------- tape path: wound onto supply → bottom sweep → wound onto take-up ----------
    // Join points are built in spool-local space: the tape enters through the
    // gap between the flanges (local y = 0 plane), touches the winding surface
    // tangentially, then wraps a short arc ON the surface like the outermost
    // layer — so it never clips through a flange or the winding itself.
    function spoolTapeJoin(
      spool: THREE.Group,
      neighbor: THREE.Vector3,
      surfaceR: number,
      sweep: number,
    ) {
      spool.updateMatrixWorld(true);
      const localN = spool.worldToLocal(neighbor.clone());
      const a0 = Math.atan2(localN.z, localN.x);
      const polar = (r: number, a: number) =>
        spool.localToWorld(
          new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r),
        );
      const pts = [
        polar(1.3, a0), // outside the flanges, gap plane
        polar(0.98, a0), // between the flanges
        polar(surfaceR, a0), // first contact with the winding
      ];
      for (let k = 1; k <= 4; k++) {
        pts.push(polar(surfaceR, a0 + (k / 4) * sweep));
      }
      return pts;
    }
    // take-up: winding starts at radius 0.84 * 0.78 ≈ 0.66 and grows past the
    // wrap arc, swallowing the join as the recording accumulates
    const takeupJoin = spoolTapeJoin(
      takeup,
      new THREE.Vector3(0.6, -0.2, 0.6),
      0.68,
      -1.6,
    );
    // supply (scale 0.62): winding starts at local radius 0.84 and drains
    const supplyJoin = spoolTapeJoin(
      supply,
      new THREE.Vector3(2.4, -2.15, -1.2),
      0.86,
      1.6,
    ).reverse();
    const curve = new THREE.CatmullRomCurve3([
      ...supplyJoin, // wrap on the supply winding → out through the flange gap
      new THREE.Vector3(2.4, -2.15, -1.2),
      new THREE.Vector3(0.2, -2.45, 0.4), // bottom sweep
      new THREE.Vector3(-1.6, -2.1, 1.9), // bottom-left bow
      new THREE.Vector3(-0.5, -1.2, 1.3),
      new THREE.Vector3(0.6, -0.2, 0.6),
      ...takeupJoin, // in through the flange gap → wrap onto the take-up winding
    ]);
    const widthDir = new THREE.Vector3(0, 1, 0.35).normalize();
    // magnetic tape: deep brand red with a glossy clearcoat, so the surface
    // picks up studio reflections and reads as tape, not a flat ribbon
    const ribbon = new THREE.Mesh(
      buildRibbon(curve, 0.24, 220, widthDir),
      new THREE.MeshPhysicalMaterial({
        color: 0xd63a2e,
        roughness: 0.3,
        metalness: 0.0,
        clearcoat: 1.0,
        clearcoatRoughness: 0.16,
        envMapIntensity: 0.9,
        side: THREE.DoubleSide,
      }),
    );
    ribbon.castShadow = true;
    scene.add(ribbon);
    // darker tape edge
    const ribbonEdge = new THREE.Mesh(
      buildRibbon(curve, 0.045, 220, widthDir),
      new THREE.MeshPhysicalMaterial({
        color: 0x9c2a20,
        roughness: 0.34,
        metalness: 0.0,
        clearcoat: 0.8,
        clearcoatRoughness: 0.2,
        envMapIntensity: 0.8,
        side: THREE.DoubleSide,
      }),
    );
    ribbonEdge.position.y = 0.135;
    scene.add(ribbonEdge);
    // flow stripes — shimmer along the tape while it winds
    const stripeTex = stripeTexture();
    const stripeMat = new THREE.MeshBasicMaterial({
      color: 0xb33229,
      map: stripeTex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const stripes = new THREE.Mesh(
      buildRibbon(curve, 0.06, 220, widthDir),
      stripeMat,
    );
    stripes.position.y = 0.006; // just above the tape face — it is opaque now
    scene.add(stripes);

    // ---------- scroll timeline ----------
    // tape color transitions with scroll: vivid brand red at the top,
    // dimmed/desaturated as the story progresses — keeps the page balanced
    const TAPE_COLORS = {
      ribbon: [new THREE.Color(0xd63a2e), new THREE.Color(0xbc5f53)],
      edge: [new THREE.Color(0x9c2a20), new THREE.Color(0x934439)],
      winding: [new THREE.Color(0xc03227), new THREE.Color(0xb04e44)],
    } as const;
    const ribbonMat = ribbon.material as THREE.MeshPhysicalMaterial;
    const edgeMat = ribbonEdge.material as THREE.MeshPhysicalMaterial;
    const CAM = [
      {
        p: 0,
        pos: new THREE.Vector3(0.1, 0.35, 8.6),
        look: new THREE.Vector3(0.7, -0.1, 0),
      },
      {
        p: 0.6,
        pos: new THREE.Vector3(1.5, 0.55, 6.6),
        look: new THREE.Vector3(1.7, 0.1, -0.6),
      },
      {
        p: 1,
        pos: new THREE.Vector3(2.05, 0.95, 3.6),
        look: new THREE.Vector3(2.45, 0.9, -0.75),
      },
    ];
    const camPos = new THREE.Vector3();
    const camLook = new THREE.Vector3();
    function camAt(p: number) {
      if (p <= 0.6) {
        const t = smooth(p / 0.6);
        camPos.lerpVectors(CAM[0].pos, CAM[1].pos, t);
        camLook.lerpVectors(CAM[0].look, CAM[1].look, t);
      } else {
        const t = smooth((p - 0.6) / 0.4);
        camPos.lerpVectors(CAM[1].pos, CAM[2].pos, t);
        camLook.lerpVectors(CAM[1].look, CAM[2].look, t);
      }
      if (narrowFrame) {
        // keep the spools in frame on tall/narrow screens
        camLook.x += 0.8;
        camPos.x += 0.8;
        camLook.y += 1.1;
        camPos.z += 1.5;
      }
      camera.position.copy(camPos);
      camera.lookAt(camLook);
    }

    // ---------- sizing ----------
    let narrowFrame = false;
    function resize() {
      const el = canvas?.parentElement;
      if (!el) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      narrowFrame = camera.aspect < 0.85;
      camera.fov = narrowFrame ? 50 : 38;
      camera.updateProjectionMatrix();
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);

    // ---------- animation (scrubbed) ----------
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let target = progress.get();
    let damped = target;
    let stripeGlow = 0;
    let prevFlow = 0;
    const unsubscribe = progress.on("change", (v) => {
      target = v;
    });
    const timer = new THREE.Timer();
    let rafId = 0;
    let running = false;

    function frame(time: number, p: number, dt: number) {
      const flow = smooth(clamp01((p - 0.12) / 0.73)); // winding timeline
      const settle = smooth(clamp01((p - 0.6) / 0.4)); // detail-shot warmth
      const dim = smooth(clamp01((p - 0.1) / 0.75)); // color transition

      ribbonMat.color.lerpColors(TAPE_COLORS.ribbon[0], TAPE_COLORS.ribbon[1], dim);
      edgeMat.color.lerpColors(TAPE_COLORS.edge[0], TAPE_COLORS.edge[1], dim);
      woundTape.color.lerpColors(TAPE_COLORS.winding[0], TAPE_COLORS.winding[1], dim);

      // winding transfer: take-up grows, supply drains
      const takeupS = 0.78 + flow * 0.38;
      const supplyS = 1.0 - flow * 0.32;
      takeup.userData.tape.scale.set(takeupS, 1, takeupS);
      supply.userData.tape.scale.set(supplyS, 1, supplyS);
      takeup.userData.spin.rotation.y = flow * 12;
      supply.userData.spin.rotation.y = -flow * 16;

      // gentle ambient float (kept from the approved scene)
      takeup.position.y = 1.0 + Math.sin(time * 0.5) * 0.06;
      supply.position.y = -1.15 + Math.sin(time * 0.42 + 1.7) * 0.08;
      takeup.rotation.z = -0.5 + Math.sin(time * 0.3) * 0.025;
      warm.intensity = 3.8 + settle * 1.6 + Math.sin(time * 1.4) * 0.6;
      placeShadows();

      // tape shimmer only while the wind is actually moving
      stripeTex.offset.x = -flow * 10;
      const flowVel = Math.abs(flow - prevFlow);
      prevFlow = flow;
      const glowEase = 1 - Math.exp(-dt * 8);
      stripeGlow += (Math.min(1, flowVel * 160) - stripeGlow) * glowEase;
      stripeMat.opacity = stripeGlow * 0.85;

      camAt(p);
      renderer.render(scene, camera);
    }
    function loop(timestamp: number) {
      timer.update(timestamp);
      const dt = Math.min(timer.getDelta(), 0.05);
      // exponential, frame-rate independent damping — long, even glide
      damped += (target - damped) * (1 - Math.exp(-dt * 3.6));
      frame(timer.getElapsed(), damped, dt);
      rafId = requestAnimationFrame(loop);
    }
    function start() {
      if (running || reducedMotion) return;
      running = true;
      rafId = requestAnimationFrame(loop);
    }
    function stop() {
      running = false;
      cancelAnimationFrame(rafId);
    }
    function onVisibility() {
      if (document.hidden) stop();
      else start();
    }

    if (reducedMotion) {
      // Static composed frame at the top of the story.
      frame(1.4, 0, 1 / 60);
    } else {
      start();
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      unsubscribe();
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      resizeObserver.disconnect();
      timer.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material)
            ? obj.material
            : [obj.material];
          for (const m of mats) {
            const mat = m as THREE.MeshBasicMaterial;
            if (mat.map) mat.map.dispose();
            mat.dispose();
          }
        }
      });
      renderer.dispose();
      envMap.dispose();
      pmrem.dispose();
    };
  }, [progress]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="absolute inset-0 h-full w-full"
    />
  );
}
