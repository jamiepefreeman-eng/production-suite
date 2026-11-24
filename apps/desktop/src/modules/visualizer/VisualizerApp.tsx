import { useEffect, useRef, useState } from "react";
import { api, confirmDialog, on } from "../../shared/bridge";
import { pushLog, send, updateShow, useEngine } from "../../shared/store";
import type { Fixture, FixtureKind, Scenery, SceneryKind, Show, VizSource } from "../../shared/types";
import { StageScene, type Selection } from "./scene";

const SCENERY_DEFAULTS: Record<SceneryKind, Omit<Scenery, "id" | "name">> = {
  wall: { kind: "wall", position: [0, 0, -3], size: [4, 3, 0.12], rotation: [0, 0, 0], color: "#b9b4aa" },
  drape: { kind: "drape", position: [0, 0, -3.5], size: [6, 4, 0.05], rotation: [0, 0, 0], color: "#2b2d3a" },
  riser: { kind: "riser", position: [0, 0, -1.5], size: [2.4, 0.4, 1.2], rotation: [0, 0, 0], color: "#3a3a3f" },
};

const SHOWN_AS: [FixtureKind, string][] = [
  ["puck", "Puck / floor uplighter"],
  ["par", "Par / can"],
  ["wash", "Wash"],
  ["strip", "LED strip / batten"],
  ["moving_spot", "Moving head spot"],
  ["moving_wash", "Moving head wash"],
  ["generic", "Generic"],
];

export default function VisualizerApp() {
  const { show } = useEngine();
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<StageScene | null>(null);
  const [selected, setSelected] = useState<Selection>(null);
  const [source, setSource] = useState<VizSource["type"]>("internal");
  const [frameSource, setFrameSource] = useState("");

  // Create the 3D scene once.
  useEffect(() => {
    if (!host.current) return;
    const s = new StageScene(host.current, {
      onSelect: setSelected,
      onMoved: (id, position, rotation) => send({ type: "move_fixture", fixture: id, position, rotation }),
      onSceneryMoved: (id, position, rotation) =>
        updateShow((d) => {
          const x = d.scenery.find((y) => y.id === id);
          if (x) Object.assign(x, { position, rotation });
        }),
    });
    scene.current = s;
    const off = on("visualizer-frame", (f) => {
      s.applyVisuals(f.fixtures);
      setFrameSource(f.source);
    });
    return () => {
      off();
      s.dispose();
      scene.current = null;
    };
  }, []);

  // Rebuild when the patch or scenery changes.
  useEffect(() => {
    if (show && scene.current) scene.current.setShow(show);
  }, [show]);

  useEffect(() => {
    scene.current?.select(selected);
  }, [selected?.kind, selected?.id]);

  const changeSource = async (t: VizSource["type"]) => {
    const src: VizSource = t === "sacn" ? { type: "sacn", universes: 4 } : t === "art_net" ? { type: "art_net" } : { type: "internal" };
    try {
      await api.setVisualizerSource(src);
      setSource(t);
    } catch (e) {
      pushLog("warn", String(e));
    }
  };

  const addScenery = (kind: SceneryKind) => {
    if (!show) return;
    const id = Math.max(0, ...show.scenery.map((s) => s.id)) + 1;
    const n = show.scenery.filter((s) => s.kind === kind).length + 1;
    const name = `${kind[0].toUpperCase()}${kind.slice(1)} ${n}`;
    void updateShow((d) => void d.scenery.push({ id, name, ...structuredClone(SCENERY_DEFAULTS[kind]) })).then(() =>
      setSelected({ kind: "scenery", id }),
    );
  };

  const fx = selected?.kind === "fixture" ? show?.fixtures.find((f) => f.id === selected.id) : undefined;
  const sc = selected?.kind === "scenery" ? show?.scenery.find((s) => s.id === selected.id) : undefined;

  return (
    <div className="visualizer">
      <div className="viz-toolbar">
        <label className="inline">
          Show DMX from
          <select value={source} onChange={(e) => changeSource(e.target.value as VizSource["type"])}>
            <option value="internal">This app's lighting</option>
            <option value="sacn">External console via sACN (e.g. Lightkey)</option>
            <option value="art_net">External console via Art-Net</option>
          </select>
        </label>
        <span className="muted">{frameSource && `receiving ${frameSource}`}</span>
        <span className="grow" />
        <div className="seg">
          <button onClick={() => addScenery("wall")} title="Add a wall for lights to land on">
            + Wall
          </button>
          <button onClick={() => addScenery("drape")} title="Add a drape / curtain">
            + Drape
          </button>
          <button onClick={() => addScenery("riser")} title="Add a platform / riser">
            + Riser
          </button>
        </div>
        <div className="seg">
          <button onClick={() => scene.current?.setMode("translate")} title="W">
            Move
          </button>
          <button onClick={() => scene.current?.setMode("rotate")} title="E">
            Rotate
          </button>
          <button onClick={() => scene.current?.resetCamera()}>Reset view</button>
        </div>
      </div>
      <div className="viz-body">
        <div className="viz-canvas" ref={host} />
        <aside className="panel right viz-side">
          {sc && show ? (
            <SceneryInspector s={sc} onClose={() => setSelected(null)} />
          ) : fx && show ? (
            <FixtureInspector fixture={fx} show={show} onClose={() => setSelected(null)} />
          ) : (
            <p className="muted viz-hint">Click a light or a wall in the 3D view (or in the lists below) to move, rotate and edit it. Drag empty space to orbit, scroll to zoom.</p>
          )}
          <h3>Scenery</h3>
          <ul className="list compact">
            {show?.scenery.map((s) => (
              <li key={s.id} className={sc?.id === s.id ? "sel" : ""} onClick={() => setSelected({ kind: "scenery", id: s.id })}>
                <span className="viz-swatch" style={{ background: s.color }} />
                <span className="grow">{s.name}</span>
                <small>
                  {s.size[0]}×{s.size[1]} m
                </small>
              </li>
            ))}
            {show?.scenery.length === 0 && <li className="muted">No walls yet — use + Wall</li>}
          </ul>
          <h3>Fixtures</h3>
          <ul className="list compact">
            {show?.fixtures.map((f) => (
              <li key={f.id} className={fx?.id === f.id ? "sel" : ""} onClick={() => setSelected({ kind: "fixture", id: f.id })}>
                <span className="grow">{f.name}</span>
                <small>
                  {f.universe}.{f.address}
                </small>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

const AXIS = ["X", "Y", "Z"];

/** Number box that keeps what you type ("2.", "-0.") and only applies complete numbers,
 *  instead of re-formatting mid-typing (which used to swallow decimal points). */
function NumField({ value, step, min, onChange }: { value: number; step: number; min?: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(Number(value.toFixed(2))));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(Number(value.toFixed(2))));
  }, [value, focused]);
  return (
    <input
      type="number"
      step={step}
      min={min}
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== "" && Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

function Vec3({
  label,
  value,
  step,
  min,
  onChange,
}: {
  label: string;
  value: [number, number, number];
  step: number;
  min?: number;
  onChange: (v: [number, number, number]) => void;
}) {
  return (
    <>
      <label>{label}</label>
      <div className="viz-vec">
        {value.map((v, i) => (
          <label key={i} className="inline">
            {AXIS[i]}
            <NumField
              value={v}
              step={step}
              min={min}
              onChange={(n) => {
                const out = [...value] as [number, number, number];
                out[i] = n;
                onChange(out);
              }}
            />
          </label>
        ))}
      </div>
    </>
  );
}

function SceneryInspector({ s, onClose }: { s: Scenery; onClose: () => void }) {
  const set = (patch: Partial<Scenery>) =>
    updateShow((d) => {
      const x = d.scenery.find((y) => y.id === s.id);
      if (x) Object.assign(x, patch);
    });
  return (
    <div className="card">
      <header>
        <input className="viz-name" value={s.name} onChange={(e) => void set({ name: e.target.value })} />
        <button className="icon" onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="row">
        <select value={s.kind} onChange={(e) => void set({ kind: e.target.value as SceneryKind })}>
          <option value="wall">Wall</option>
          <option value="drape">Drape</option>
          <option value="riser">Riser / platform</option>
        </select>
        <input type="color" value={s.color.slice(0, 7)} onChange={(e) => void set({ color: e.target.value })} title="Surface colour" />
      </div>
      <Vec3 label="Size (m) — width, height, thickness" value={s.size} step={0.1} min={0.02} onChange={(size) => void set({ size: size.map((v) => Math.max(0.02, v)) as [number, number, number] })} />
      <Vec3 label="Position (m) — centre of the bottom edge" value={s.position} step={0.1} onChange={(position) => void set({ position })} />
      <Vec3 label="Rotation (°)" value={s.rotation} step={5} onChange={(rotation) => void set({ rotation })} />
      <div className="row">
        <button
          onClick={() =>
            updateShow((d) => {
              const id = Math.max(0, ...d.scenery.map((x) => x.id)) + 1;
              d.scenery.push({ ...structuredClone(s), id, name: `${s.name} copy`, position: [s.position[0] + s.size[0] + 0.2, s.position[1], s.position[2]] });
            })
          }
        >
          Duplicate
        </button>
        <span className="grow" />
        <button
          onClick={() =>
            void confirmDialog(`Delete “${s.name}”?`).then((yes) => {
              if (!yes) return;
              onClose();
              void updateShow((d) => void (d.scenery = d.scenery.filter((x) => x.id !== s.id)));
            })
          }
        >
          Delete
        </button>
      </div>
      <small className="muted">Tip: drag it in the view (Move / Rotate). Colour matters: light shows best on light surfaces.</small>
    </div>
  );
}

function FixtureInspector({ fixture, show, onClose }: { fixture: Fixture; show: Show; onClose: () => void }) {
  const set = (position: [number, number, number], rotation: [number, number, number]) =>
    send({ type: "move_fixture", fixture: fixture.id, position, rotation });
  const profile = show.profiles.find((p) => p.id === fixture.profile_id);
  const sameProfile = show.fixtures.filter((f) => f.profile_id === fixture.profile_id).length;
  return (
    <div className="card">
      <header>
        <h3>{fixture.name}</h3>
        <button className="icon" onClick={onClose}>
          ✕
        </button>
      </header>
      {profile && (
        <>
          <label>
            Shown as {sameProfile > 1 && <small>(all {sameProfile} {profile.model} fixtures)</small>}
          </label>
          <div className="row">
            <select
              value={profile.kind}
              onChange={(e) =>
                updateShow((d) => {
                  const p = d.profiles.find((x) => x.id === profile.id);
                  if (p) p.kind = e.target.value as FixtureKind;
                })
              }
            >
              {SHOWN_AS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <label className="inline muted" title="Beam angle">
              Beam
              <input
                type="number"
                min={2}
                max={160}
                value={profile.beam_angle}
                onChange={(e) =>
                  updateShow((d) => {
                    const p = d.profiles.find((x) => x.id === profile.id);
                    if (p) p.beam_angle = Math.max(2, Math.min(160, Number(e.target.value)));
                  })
                }
              />
              °
            </label>
          </div>
          {profile.kind === "puck" && (
            <button
              title="Keeps each light's left/right and depth; sets height to the floor and tilts it back toward the wall behind"
              onClick={() =>
                show.fixtures
                  .filter((f) => f.profile_id === profile.id)
                  .forEach((f) => void send({ type: "move_fixture", fixture: f.id, position: [f.position[0], 0.05, f.position[2]], rotation: [-12, 0, 0] }))
              }
            >
              Put all {sameProfile} on the floor, aimed up the wall
            </button>
          )}
        </>
      )}
      <Vec3 label="Position (m) — X across, Y height, Z toward audience" value={fixture.position} step={0.1} onChange={(p) => void set(p, fixture.rotation)} />
      <Vec3 label="Rotation (°) — floor puck tilted back to a wall ≈ X −12" value={fixture.rotation} step={5} onChange={(r) => void set(fixture.position, r)} />
    </div>
  );
}
