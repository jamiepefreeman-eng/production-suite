// three.js stage. Fixtures are drawn from the patch; their light comes from
// DMX decoded by the engine (FixtureVisual), so what you see is what the rig
// receives — from this app, or from an external console.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { FixtureProfile, FixtureVisual, Scenery, Show } from "../../shared/types";

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

export type Selection = { kind: "fixture"; id: number } | { kind: "scenery"; id: number } | null;

export interface SceneCallbacks {
  onSelect: (sel: Selection) => void;
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
  private stageGroup = new THREE.Group();
  private raf = 0;
  private ro: ResizeObserver;
  private dragging = false;

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
      if (!this.dragging) this.emitMove();
    });
    this.scene.add(this.gizmo.getHelper());

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.15));
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
    if (e.key === "Escape") this.cb.onSelect(null);
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
    if (hit.object.userData.fixtureId !== undefined) this.cb.onSelect({ kind: "fixture", id: hit.object.userData.fixtureId as number });
    else this.cb.onSelect({ kind: "scenery", id: hit.object.userData.sceneryId as number });
  };

  select(sel: Selection) {
    const obj =
      sel?.kind === "fixture" ? this.fixtures.get(sel.id)?.root : sel?.kind === "scenery" ? this.scenery.get(sel.id)?.obj : undefined;
    if (obj) this.gizmo.attach(obj);
    else this.gizmo.detach();
  }

  private emitMove() {
    const obj = this.gizmo.object;
    if (!obj) return;
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
      if (!(this.dragging && this.gizmo.object === obj.root)) {
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
      const key = `${s.kind}|${s.size.join(",")}|${s.color}`;
      let entry = this.scenery.get(s.id);
      if (!entry || entry.key !== key) {
        const wasSelected = entry && this.gizmo.object === entry.obj;
        if (entry) this.scene.remove(entry.obj);
        entry = { obj: buildScenery(s), key };
        this.scenery.set(s.id, entry);
        this.scene.add(entry.obj);
        if (wasSelected) this.gizmo.attach(entry.obj);
      }
      if (!(this.dragging && this.gizmo.object === entry.obj)) {
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
        m.opacity = i * (v.gobo > 0 ? 0.12 : 0.2);
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

  private loop = () => {
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

/** Walls, drapes and risers: lit by the fixtures' spotlights. Origin = centre of the bottom face. */
function buildScenery(s: Scenery): THREE.Object3D {
  const [w, h, d] = s.size.map((v) => Math.max(0.02, v));
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(s.color), roughness: s.kind === "drape" ? 1 : 0.85, metalness: 0, side: THREE.DoubleSide });
  const g = new THREE.Group();
  g.userData.sceneryId = s.id;
  let mesh: THREE.Mesh;
  if (s.kind === "drape") {
    // Fabric: a sheet with soft vertical folds.
    const geo = new THREE.PlaneGeometry(w, h, Math.max(8, Math.round(w * 10)), 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 7) * Math.min(0.08, d + 0.04));
    geo.computeVertexNormals();
    mesh = new THREE.Mesh(geo, mat);
  } else {
    mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  }
  mesh.position.y = h / 2;
  mesh.userData.sceneryId = s.id;
  g.add(mesh);
  return g;
}
