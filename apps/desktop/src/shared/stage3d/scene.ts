// three.js stage. Fixtures are drawn from the patch; their light comes from
// DMX decoded by the engine (FixtureVisual), so what you see is what the rig
// receives — from this app, or from an external console.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { mediaUrl } from "../bridge";
import type { FixtureProfile, FixtureVisual, Scenery, Show, VisualizerSettings } from "../types";
import { ScreenPainter, type ScreenContent } from "./screen";

const DEG = Math.PI / 180;

interface FixtureObj {
  id: number;
  root: THREE.Group; // mounting position/rotation
  yoke: THREE.Group; // pan
  head: THREE.Group; // tilt
  beam: THREE.Mesh | null;
  pool: THREE.Mesh | null;
  glow: THREE.Mesh; // lens / LED face
  /** Real light, so walls, drapes and the floor are lit by the beam. */
  light: THREE.SpotLight | null;
  profile: FixtureProfile;
}

export type SelItem = { kind: "fixture"; id: number } | { kind: "scenery"; id: number };
/** @deprecated single selection; use SelItem[] */
export type Selection = SelItem | null;

export interface SceneCallbacks {
  /** `additive` = Shift / Cmd / Ctrl held: add to (or remove from) the selection. `null` = clear. */
  onSelect: (sel: SelItem | null, additive: boolean) => void;
  onMoved: (id: number, position: [number, number, number], rotation: [number, number, number]) => void;
  onSceneryMoved: (id: number, position: [number, number, number], rotation: [number, number, number]) => void;
}

export class StageScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private orbit: OrbitControls;
  private gizmo: TransformControls;
  private fixtures = new Map<number, FixtureObj>();
  private scenery = new Map<number, { obj: THREE.Object3D; key: string }>();
  private ambient = new THREE.AmbientLight(0xffffff, 0.15);
  private haze = 0.35;
  /** One painter draws the live slide; every screen object shows its texture. */
  private painter = new ScreenPainter();
  private stageGroup = new THREE.Group();
  private raf = 0;
  private ro: ResizeObserver;
  private dragging = false;
  /** What's selected (objects in the scene). Several = moved together through `pivot`. */
  private selected: THREE.Object3D[] = [];
  private pivot = new THREE.Object3D();
  private pivotStart = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  private members: { obj: THREE.Object3D; pos: THREE.Vector3; quat: THREE.Quaternion }[] = [];

  constructor(private host: HTMLElement, private cb: SceneCallbacks) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x05060a);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.resetCamera();

    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.addEventListener("dragging-changed", (e) => {
      this.dragging = Boolean(e.value);
      this.orbit.enabled = !this.dragging;
      if (this.dragging && this.gizmo.object === this.pivot) {
        this.pivotStart = { pos: this.pivot.position.clone(), quat: this.pivot.quaternion.clone() };
        this.members = this.selected.map((obj) => ({ obj, pos: obj.position.clone(), quat: obj.quaternion.clone() }));
      }
      if (!this.dragging) for (const o of this.selected) this.emitMove(o);
    });
    // Moving the pivot carries every selected object with it (translate and rotate around the centre).
    this.gizmo.addEventListener("objectChange", () => {
      if (this.gizmo.object !== this.pivot || !this.dragging) return;
      const dq = this.pivot.quaternion.clone().multiply(this.pivotStart.quat.clone().invert());
      for (const m of this.members) {
        const off = m.pos.clone().sub(this.pivotStart.pos).applyQuaternion(dq);
        m.obj.position.copy(this.pivot.position).add(off);
        m.obj.quaternion.copy(dq.clone().multiply(m.quat));
      }
    });
    this.scene.add(this.pivot);
    this.scene.add(this.gizmo.getHelper());

    this.scene.add(this.ambient);
    this.scene.fog = new THREE.FogExp2(0x05060a, 0);
    this.scene.add(this.stageGroup);

    this.renderer.domElement.addEventListener("pointerdown", this.onPointer);
    window.addEventListener("keydown", this.onKey);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.loop();
  }

  resetCamera() {
    this.camera.position.set(0, 7, 16);
    this.orbit.target.set(0, 2, 0);
    this.orbit.update();
  }

  setMode(m: "translate" | "rotate") {
    this.gizmo.setMode(m);
  }

  private onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
    if (e.key === "w") this.setMode("translate");
    if (e.key === "e") this.setMode("rotate");
    if (e.key === "Escape") this.cb.onSelect(null, false);
  };

  private onPointer = (e: PointerEvent) => {
    if (this.dragging || e.button !== 0) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const targets = [...[...this.fixtures.values()].map((f) => f.root), ...[...this.scenery.values()].map((s) => s.obj)];
    const hit = ray
      .intersectObjects(targets, true)
      .find((h) => h.object.userData.fixtureId !== undefined || h.object.userData.sceneryId !== undefined);
    if (!hit) return;
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (hit.object.userData.fixtureId !== undefined) this.cb.onSelect({ kind: "fixture", id: hit.object.userData.fixtureId as number }, additive);
    else this.cb.onSelect({ kind: "scenery", id: hit.object.userData.sceneryId as number }, additive);
  };

  /** Show the move / rotate gizmo on these items (several: around their centre). */
  /** Locked: clicking still selects, but there are no move / rotate arrows (Lighting's Program mode). */
  private locked = false;
  setLocked(locked: boolean) {
    this.locked = locked;
    if (locked) this.gizmo.detach();
  }

  select(items: SelItem[]) {
    if (this.locked) {
      this.selected = [];
      this.gizmo.detach();
      return;
    }
    const objs = items
      .map((s) => (s.kind === "fixture" ? this.fixtures.get(s.id)?.root : this.scenery.get(s.id)?.obj))
      .filter((o): o is THREE.Object3D => !!o);
    this.selected = objs;
    if (objs.length === 0) this.gizmo.detach();
    else if (objs.length === 1) this.gizmo.attach(objs[0]);
    else {
      const c = new THREE.Vector3();
      for (const o of objs) c.add(o.position);
      this.pivot.position.copy(c.divideScalar(objs.length));
      this.pivot.quaternion.identity();
      this.gizmo.attach(this.pivot);
    }
  }

  /** Is this object being dragged right now (so show updates mustn't snap it back)? */
  private held(obj: THREE.Object3D) {
    return this.dragging && (this.gizmo.object === obj || (this.gizmo.object === this.pivot && this.selected.includes(obj)));
  }

  private emitMove(obj: THREE.Object3D) {
    const p = obj.position;
    const r = obj.rotation;
    const rot: [number, number, number] = [round(r.x / DEG), round(r.y / DEG), round(r.z / DEG)];
    if (obj.userData.sceneryId !== undefined) {
      // Scenery is positioned by the centre of its bottom face.
      this.cb.onSceneryMoved(obj.userData.sceneryId as number, [round(p.x), round(p.y), round(p.z)], rot);
    } else this.cb.onMoved(obj.userData.fixtureId as number, [round(p.x), round(p.y), round(p.z)], rot);
  }

  setShow(show: Show) {
    // Stage
    this.stageGroup.clear();
    const { width, depth } = show.stage;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshStandardMaterial({ color: 0x1a1b20, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    this.stageGroup.add(floor);
    const house = new THREE.Mesh(new THREE.PlaneGeometry(width * 2, 14), new THREE.MeshStandardMaterial({ color: 0x0c0c10 }));
    house.rotation.x = -Math.PI / 2;
    house.position.set(0, -0.6, depth / 2 + 7);
    this.stageGroup.add(house);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(width, show.stage.trim_height + 1), new THREE.MeshStandardMaterial({ color: 0x15161b }));
    wall.position.set(0, (show.stage.trim_height + 1) / 2, -depth / 2 - 0.2);
    this.stageGroup.add(wall);
    const grid = new THREE.GridHelper(Math.max(width, depth), Math.max(width, depth), 0x2a2d36, 0x1c1e25);
    grid.position.y = 0.01;
    this.stageGroup.add(grid);

    this.syncScenery(show.scenery ?? []);

    // Fixtures (rebuilt when their profile or its look changes)
    const keep = new Set(show.fixtures.map((f) => f.id));
    for (const [id, f] of this.fixtures) {
      const now = show.fixtures.find((x) => x.id === id);
      const prof = show.profiles.find((p) => p.id === now?.profile_id);
      if (!keep.has(id) || f.profile.id !== now?.profile_id || f.profile.kind !== prof?.kind || f.profile.beam_angle !== prof?.beam_angle) {
        if (this.gizmo.object === f.root) this.gizmo.detach();
        this.scene.remove(f.root);
        this.fixtures.delete(id);
      }
    }
    for (const fx of show.fixtures) {
      const profile = show.profiles.find((p) => p.id === fx.profile_id);
      if (!profile) continue;
      let obj = this.fixtures.get(fx.id);
      if (!obj) {
        obj = buildFixture(fx.id, profile);
        this.fixtures.set(fx.id, obj);
        this.scene.add(obj.root);
      }
      if (!this.held(obj.root)) {
        obj.root.position.set(...fx.position);
        obj.root.rotation.set(fx.rotation[0] * DEG, fx.rotation[1] * DEG, fx.rotation[2] * DEG);
      }
    }
  }

  private syncScenery(list: Scenery[]) {
    const keep = new Set(list.map((s) => s.id));
    for (const [id, s] of this.scenery) {
      if (!keep.has(id)) {
        if (this.gizmo.object === s.obj) this.gizmo.detach();
        this.scene.remove(s.obj);
        this.scenery.delete(id);
      }
    }
    for (const s of list) {
      // Rebuild geometry only when the shape changes; moves just update the transform.
      const key = `${s.kind}|${s.size.join(",")}|${s.color}|${s.model_path}|${s.model_unit}|${s.model_z_up}`;
      let entry = this.scenery.get(s.id);
      if (!entry || entry.key !== key) {
        const wasSelected = entry && this.gizmo.object === entry.obj;
        if (entry) this.scene.remove(entry.obj);
        entry = { obj: buildScenery(s, this.painter.texture), key };
        this.scenery.set(s.id, entry);
        this.scene.add(entry.obj);
        if (wasSelected) this.gizmo.attach(entry.obj);
      }
      if (!this.held(entry.obj)) {
        entry.obj.position.set(...s.position);
        entry.obj.rotation.set(s.rotation[0] * DEG, s.rotation[1] * DEG, s.rotation[2] * DEG);
      }
    }
  }

  applyVisuals(vis: FixtureVisual[]) {
    for (const v of vis) {
      const f = this.fixtures.get(v.id);
      if (!f) continue;
      const color = new THREE.Color(v.color.r, v.color.g, v.color.b);
      const i = v.intensity;
      (f.glow.material as THREE.MeshBasicMaterial).color.copy(color).multiplyScalar(0.15 + i * 0.85);
      if (f.beam) {
        const m = f.beam.material as THREE.MeshBasicMaterial;
        m.color.copy(color);
        // Beams are only visible in haze, like a real room.
        m.opacity = i * (v.gobo > 0 ? 0.6 : 1) * 0.32 * this.haze;
        f.beam.visible = i > 0.01;
      }
      if (f.light) {
        f.light.color.copy(color);
        // Candela-ish: enough to light a wall a few metres away at full.
        f.light.intensity = i * (f.profile.kind === "puck" ? 60 : 160);
        f.light.visible = i > 0.01;
      }
      if (f.pool) {
        const m = f.pool.material as THREE.MeshBasicMaterial;
        m.color.copy(color);
        m.opacity = i * 0.35;
        f.pool.visible = i > 0.01;
      }
      if (f.profile.pan_range > 0) {
        f.yoke.rotation.y = (v.pan - 0.5) * f.profile.pan_range * DEG;
        f.head.rotation.x = (v.tilt - 0.5) * f.profile.tilt_range * DEG;
      }
    }
  }

  private resize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Haze (beam visibility + fog) and ambient light, 0..1 each. */
  setAtmosphere(v: VisualizerSettings) {
    this.haze = Math.max(0, Math.min(1, v.haze));
    this.ambient.intensity = 0.03 + Math.max(0, Math.min(1, v.ambient)) * 1.2;
    (this.scene.fog as THREE.FogExp2).density = this.haze * 0.025;
  }

  /** What the screens show (the Presenter's audience output). */
  setScreenContent(c: ScreenContent) {
    this.painter.set(c);
  }

  private loop = () => {
    this.painter.tick();
    this.raf = requestAnimationFrame(this.loop);
    this.orbit.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    window.removeEventListener("keydown", this.onKey);
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointer);
    this.gizmo.dispose();
    this.orbit.dispose();
    this.renderer.dispose();
    this.painter.dispose();
    this.renderer.domElement.remove();
  }
}

const round = (n: number) => Math.round(n * 100) / 100;

function buildFixture(id: number, profile: FixtureProfile): FixtureObj {
  const root = new THREE.Group();
  root.userData.fixtureId = id;
  const yoke = new THREE.Group();
  const head = new THREE.Group();
  root.add(yoke);
  yoke.add(head);
  const tag = (m: THREE.Object3D) => {
    m.userData.fixtureId = id;
    return m;
  };
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2b2d33, metalness: 0.3, roughness: 0.6 });

  if (profile.kind === "strip") {
    // LED batten / strip: a glowing bar facing the audience.
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.9, 4, 0.08), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    tag(glow);
    head.add(glow);
    return { id, root, yoke, head, beam: null, pool: null, glow, light: null, profile };
  }

  if (profile.kind === "puck") {
    // Small floor uplighter: a squat disc, lens facing up (+Y). Rotate it to aim at a wall.
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.07, 20), bodyMat);
    body.position.y = 0.035;
    tag(body);
    head.add(body);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.075, 20), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.072;
    tag(glow);
    head.add(glow);
    const beam = makeBeam(profile.beam_angle, 3.2, 0.072);
    head.add(beam);
    const light = makeLight(profile.beam_angle, 0.08, 7);
    head.add(light, light.target);
    return { id, root, yoke, head, beam, pool: null, glow, light, profile };
  }

  const moving = profile.pan_range > 0;
  if (moving) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.3), bodyMat);
    tag(base);
    root.add(base);
    const arms = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.3, 0.06), bodyMat);
    arms.position.y = 0.2;
    tag(arms);
    yoke.add(arms);
    head.position.y = 0.3;
  }
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.32, 16), bodyMat);
  tag(body);
  head.add(body);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.11, 24), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.17;
  tag(glow);
  head.add(glow);

  const beam = makeBeam(profile.beam_angle, 9, 0.17);
  head.add(beam);
  const light = makeLight(profile.beam_angle, 0.17, 30);
  head.add(light, light.target);

  // TODO: gobo projection (texture on the spotlight's `map`).
  return { id, root, yoke, head, beam, pool: null, glow, light, profile };
}

/** Visible beam: cone along +Y from the lens, additive so overlapping beams add up. */
function makeBeam(beamAngle: number, length: number, y: number) {
  const radius = Math.tan((Math.min(beamAngle, 120) / 2) * DEG) * length;
  const geo = new THREE.ConeGeometry(radius, length, 32, 1, true);
  geo.translate(0, -length / 2, 0);
  geo.rotateX(Math.PI);
  const beam = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.position.y = y;
  return beam;
}

/** Spotlight along the beam, so surfaces it hits (walls, drapes, floor, risers) light up. */
function makeLight(beamAngle: number, y: number, range: number) {
  const light = new THREE.SpotLight(0xffffff, 0, range, Math.min(beamAngle, 160) * 0.5 * DEG, 0.55, 1.6);
  light.position.set(0, y, 0);
  light.target.position.set(0, y + 5, 0);
  light.visible = false;
  return light;
}

/** Nominal size each model is built at; `Scenery.size` scales it. */
export const NOMINAL: Partial<Record<Scenery["kind"], [number, number, number]>> = {
  person: [0.5, 1.75, 0.3],
  drum_kit: [2, 1.4, 1.6],
  keyboard: [1.3, 1.0, 0.45],
  guitarist: [0.7, 1.75, 0.4],
  mic_stand: [0.6, 1.6, 0.6],
};

const mat = (color: string | number, rough = 0.85, metal = 0) =>
  new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: rough, metalness: metal, side: THREE.DoubleSide });

/** Walls, drapes, stage, truss, screens, people and instruments — all lit by the fixtures.
 *  Origin = centre of the bottom face. */
function buildScenery(s: Scenery, screenTexture: THREE.Texture): THREE.Object3D {
  const [w, h, d] = s.size.map((v) => Math.max(0.02, v));
  const g = new THREE.Group();
  g.userData.sceneryId = s.id;
  const add = (m: THREE.Mesh, x = 0, y = 0, z = 0) => {
    m.position.set(x, y, z);
    m.userData.sceneryId = s.id;
    g.add(m);
    return m;
  };
  const box = (bw: number, bh: number, bd: number, m: THREE.Material, x = 0, y = 0, z = 0) => add(new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), m), x, y, z);
  const cyl = (r: number, len: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 16) =>
    add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), m), x, y, z);
  const main = mat(s.color, s.kind === "drape" ? 1 : 0.85);

  switch (s.kind) {
    case "drape": {
      const geo = new THREE.PlaneGeometry(w, h, Math.max(8, Math.round(w * 10)), 1);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 7) * Math.min(0.08, d + 0.04));
      geo.computeVertexNormals();
      add(new THREE.Mesh(geo, main), 0, h / 2);
      break;
    }
    case "stage_deck": {
      box(w, 0.04, d, mat("#2a2a2e", 0.7), 0, h - 0.02); // top
      box(w, h - 0.04, d, mat("#0d0d0f", 1), 0, (h - 0.04) / 2); // skirt
      break;
    }
    case "truss": {
      // Box truss along X: four chords and zig-zag lacing.
      const t = Math.max(0.2, Math.min(d, h)); // section size
      const chord = mat("#c9ccd1", 0.35, 0.8);
      for (const [y, z] of [[0, -t / 2], [0, t / 2], [t, -t / 2], [t, t / 2]] as const) {
        const c = cyl(0.025, w, chord, 0, y + 0.03, z, 8);
        c.rotation.z = Math.PI / 2;
      }
      const n = Math.max(1, Math.round(w / t));
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + (i + 0.5) * (w / n);
        for (const z of [-t / 2, t / 2]) {
          const lace = cyl(0.012, Math.hypot(t, w / n), chord, x, t / 2 + 0.03, z, 6);
          lace.rotation.z = (i % 2 ? 1 : -1) * Math.atan2(w / n, t);
        }
      }
      break;
    }
    case "screen": {
      box(w + 0.08, h + 0.08, d, mat("#050505", 0.5), 0, h / 2); // frame
      // The picture glows on its own (not lit by the rig).
      const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: screenTexture, toneMapped: false }));
      add(face, 0, h / 2, d / 2 + 0.002);
      break;
    }
    case "person":
    case "guitarist": {
      const skin = mat("#c99a7b", 0.7);
      const shirt = mat(s.color, 0.9);
      const pants = mat("#1f2430", 0.9);
      for (const x of [-0.1, 0.1]) cyl(0.07, 0.85, pants, x, 0.425, 0);
      add(new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.42, 4, 12), shirt), 0, 1.15, 0);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), skin), 0, 1.6, 0);
      for (const x of [-0.24, 0.24]) {
        const arm = cyl(0.05, 0.6, shirt, x, 1.12, 0.05);
        arm.rotation.x = -0.35;
      }
      if (s.kind === "guitarist") {
        const body = add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.07, 24), mat("#7c2d12", 0.4)), 0.05, 0.95, 0.2);
        body.rotation.x = Math.PI / 2;
        body.scale.set(1, 1, 1.3);
        const neck = box(0.6, 0.05, 0.03, mat("#3f2a1d", 0.6), 0.38, 1.12, 0.22);
        neck.rotation.z = 0.35;
      }
      break;
    }
    case "drum_kit": {
      const shell = mat(s.color, 0.4, 0.2);
      const chrome = mat("#d4d4d8", 0.25, 0.9);
      const brass = mat("#d4a017", 0.3, 0.9);
      const kick = cyl(0.28, 0.4, shell, 0, 0.28, 0.25, 24);
      kick.rotation.x = Math.PI / 2;
      cyl(0.17, 0.15, shell, -0.45, 0.65, 0.15); // snare
      cyl(0.14, 0.2, shell, -0.18, 0.8, 0.15); // toms
      cyl(0.14, 0.2, shell, 0.18, 0.8, 0.15);
      cyl(0.22, 0.4, shell, 0.55, 0.45, 0.1); // floor tom
      for (const [x, y, z] of [[-0.75, 1.15, 0.2], [0.7, 1.3, -0.05], [-0.35, 1.35, -0.2]]) {
        cyl(0.015, y, chrome, x, y / 2, z, 6);
        cyl(0.22, 0.01, brass, x, y, z, 24);
      }
      cyl(0.18, 0.05, mat("#111", 0.9), 0, 0.55, -0.45); // stool
      cyl(0.03, 0.5, chrome, 0, 0.27, -0.45, 6);
      break;
    }
    case "keyboard": {
      const metal = mat("#222", 0.5, 0.6);
      for (const sgn of [-1, 1]) {
        const leg = box(0.04, 1.1, 0.04, metal, 0.35 * sgn, 0.42, 0);
        leg.rotation.z = 0.55 * sgn;
      }
      box(1.25, 0.1, 0.38, mat(s.color, 0.5), 0, 0.92, 0);
      box(1.1, 0.02, 0.15, mat("#f4f4f5", 0.4), 0, 0.98, 0.08);
      break;
    }
    case "mic_stand": {
      const metal = mat("#18181b", 0.4, 0.7);
      for (let i = 0; i < 3; i++) {
        const leg = box(0.3, 0.02, 0.02, metal, Math.cos((i * 2 * Math.PI) / 3) * 0.13, 0.03, Math.sin((i * 2 * Math.PI) / 3) * 0.13);
        leg.rotation.y = (-i * 2 * Math.PI) / 3;
      }
      cyl(0.012, 1.45, metal, 0, 0.75, 0, 8);
      const boom = cyl(0.01, 0.5, metal, 0, 1.45, 0.2, 8);
      boom.rotation.x = Math.PI / 2.6;
      cyl(0.025, 0.14, mat("#3f3f46", 0.4, 0.8), 0, 1.55, 0.43, 12);
      break;
    }
    case "speaker":
      box(w, h, d, mat(s.color, 0.9), 0, h / 2);
      box(w * 0.85, h * 0.9, 0.01, mat("#111", 1), 0, h / 2, d / 2 + 0.006);
      break;
    case "wedge": {
      const shape = new THREE.Shape();
      shape.moveTo(-d / 2, 0);
      shape.lineTo(d / 2, 0);
      shape.lineTo(-d / 2, h);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
      geo.translate(0, 0, -w / 2);
      const m = add(new THREE.Mesh(geo, mat(s.color, 0.9)), 0, 0, 0);
      m.rotation.y = Math.PI / 2;
      break;
    }
    case "model":
      loadModel(s, g);
      break;
    default:
      // wall, riser
      box(w, h, d, main, 0, h / 2);
  }

  // Models built at a nominal size scale to the requested size.
  const nominal = NOMINAL[s.kind];
  if (nominal) {
    const inner = new THREE.Group();
    for (const c of [...g.children]) inner.add(c);
    inner.scale.set(w / nominal[0], h / nominal[1], d / nominal[2]);
    g.add(inner);
  }
  return g;
}

const UNIT_SCALE: Record<string, number> = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048 };

/** Load an imported model (SketchUp etc.) into `g`: scaled to metres, Z-up turned Y-up,
 *  sitting on the floor and centred on its position. Loaders are fetched only when needed. */
function loadModel(s: Scenery, g: THREE.Group) {
  if (!s.model_path) return;
  const url = mediaUrl(s.model_path);
  const ext = s.model_path.split(".").pop()?.toLowerCase();
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(s.color), roughness: 0.8, side: THREE.DoubleSide });
  const place = (obj: THREE.Object3D, keepMaterials: boolean) => {
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh;
        if (!keepMaterials) m.material = material;
        m.userData.sceneryId = s.id;
      }
    });
    // inner: file units → metres, Z-up → Y-up. holder: the user's scale (size) on stage axes.
    const inner = new THREE.Group();
    inner.add(obj);
    inner.scale.setScalar(UNIT_SCALE[s.model_unit] ?? 1);
    if (s.model_z_up) inner.rotation.x = -Math.PI / 2;
    const holder = new THREE.Group();
    holder.add(inner);
    holder.scale.set(...s.size);
    holder.updateMatrixWorld(true);
    // Sit on the floor, centred on the item's position.
    const box = new THREE.Box3().setFromObject(holder);
    const c = box.getCenter(new THREE.Vector3());
    holder.position.set(-c.x, -box.min.y, -c.z);
    g.add(holder);
  };
  const fail = (e: unknown) => console.warn(`Couldn't load model ${s.model_path}:`, e);
  (async () => {
    if (ext === "stl") {
      const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
      const geo = await new STLLoader().loadAsync(url);
      geo.computeVertexNormals();
      place(new THREE.Mesh(geo, material), false);
    } else if (ext === "obj") {
      const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
      place(await new OBJLoader().loadAsync(url), false);
    } else if (ext === "dae") {
      const { ColladaLoader } = await import("three/examples/jsm/loaders/ColladaLoader.js");
      const r = await new ColladaLoader().loadAsync(url);
      // Collada files say which way is up; the loader already turns them Y-up.
      if (r) place(r.scene, true);
    } else if (ext === "glb" || ext === "gltf") {
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      const r = await new GLTFLoader().loadAsync(url);
      place(r.scene, true);
    } else fail(`unsupported file type .${ext}`);
  })().catch(fail);
}
