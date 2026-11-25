import { useEffect, useRef, useState } from "react";
import {
  api,
  confirmDialog,
  mediaUrl,
  on,
  pickModelFile,
} from "../../shared/bridge";
import { getInputStream } from "../../shared/inputs";
import { pushLog, send, updateShow, useEngine } from "../../shared/store";
import type {
  Fixture,
  FixtureKind,
  Scenery,
  SceneryKind,
  Show,
  Theme,
  VizSource,
} from "../../shared/types";
import { StageScene, type SelItem } from "../../shared/stage3d/scene";

type Defaults = Omit<Scenery, "id" | "name" | "kind">;
const D = (
  position: [number, number, number],
  size: [number, number, number],
  color: string,
): Defaults => ({
  position,
  size,
  rotation: [0, 0, 0],
  color,
  model_path: "",
  model_unit: "m",
  model_z_up: true,
});
/** Menu of things you can put on stage, grouped, with a sensible starting size (m) and colour. */
const CATALOG: { group: string; items: [SceneryKind, string, Defaults][] }[] = [
  {
    group: "Structure",
    items: [
      ["wall", "Wall", D([0, 0, -3], [4, 3, 0.12], "#b9b4aa")],
      ["drape", "Drape", D([0, 0, -3.5], [6, 4, 0.05], "#2b2d3a")],
      ["stage_deck", "Stage deck", D([0, 0, -1], [2.4, 0.6, 1.2], "#2a2a2e")],
      ["riser", "Riser", D([0, 0, -1.5], [2.4, 0.4, 1.2], "#3a3a3f")],
      ["truss", "Truss", D([0, 6, 0], [10, 0.3, 0.3], "#c9ccd1")],
    ],
  },
  {
    group: "Screens",
    items: [
      [
        "screen",
        "LED / projection screen",
        D([0, 2, -3.8], [4, 2.25, 0.08], "#111111"),
      ],
    ],
  },
  {
    group: "People & band",
    items: [
      ["person", "Person", D([0, 0, 0], [0.5, 1.75, 0.3], "#3b82f6")],
      ["guitarist", "Guitarist", D([-2, 0, -1], [0.7, 1.75, 0.4], "#64748b")],
      ["drum_kit", "Drum kit", D([0, 0.4, -2.4], [2, 1.4, 1.6], "#7f1d1d")],
      ["keyboard", "Keyboard", D([2, 0, -1.5], [1.3, 1, 0.45], "#18181b")],
      ["mic_stand", "Mic stand", D([0, 0, 1], [0.6, 1.6, 0.6], "#18181b")],
    ],
  },
  {
    group: "Audio",
    items: [
      ["speaker", "Speaker", D([-5, 0, 3.5], [0.6, 1, 0.5], "#18181b")],
      ["wedge", "Monitor wedge", D([0, 0, 2], [0.7, 0.4, 0.5], "#18181b")],
    ],
  },
];
const ALL_KINDS: [SceneryKind, string, Defaults][] = [
  ...CATALOG.flatMap((c) => c.items),
  ["model", "Imported model", D([0, 0, 0], [1, 1, 1], "#9ca3af")],
];
const kindLabel = (k: SceneryKind) =>
  ALL_KINDS.find((x) => x[0] === k)?.[1] ?? k;

const SHOWN_AS: [FixtureKind, string][] = [
  ["puck", "Puck / floor uplighter"],
  ["par", "Par / can"],
  ["wash", "Wash"],
  ["strip", "LED strip / batten"],
  ["moving_spot", "Moving head spot"],
  ["moving_wash", "Moving head wash"],
  ["generic", "Generic"],
];

/** The audience output as the Visualizer's screens should draw it (mirrors the Presenter). */
function themeFor(show: Show, presentation?: number): Theme | null {
  const p = show.presentations.find((x) => x.id === presentation);
  return show.themes.find((t) => t.name === p?.theme) ?? show.themes[0] ?? null;
}

export default function VisualizerApp() {
  const { show, live, layers } = useEngine();
  const [addOpen, setAddOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<StageScene | null>(null);
  const [selected, setSelected] = useState<SelItem[]>([]);
  const pick = (item: SelItem | null, additive: boolean) =>
    setSelected((cur) => {
      if (!item) return [];
      if (!additive) return [item];
      const has = cur.some((x) => x.kind === item.kind && x.id === item.id);
      return has
        ? cur.filter((x) => !(x.kind === item.kind && x.id === item.id))
        : [...cur, item];
    });
  // Several scenery items moved at once → one show update.
  const pendingMoves = useRef(
    new Map<
      number,
      { position: [number, number, number]; rotation: [number, number, number] }
    >(),
  );
  const [source, setSource] = useState<VizSource["type"]>("internal");
  const [frameSource, setFrameSource] = useState("");

  // Create the 3D scene once.
  useEffect(() => {
    if (!host.current) return;
    const s = new StageScene(host.current, {
      onSelect: pick,
      onMoved: (id, position, rotation) =>
        send({ type: "move_fixture", fixture: id, position, rotation }),
      onSceneryMoved: (id, position, rotation) => {
        const first = pendingMoves.current.size === 0;
        pendingMoves.current.set(id, { position, rotation });
        if (first)
          queueMicrotask(() => {
            const moves = new Map(pendingMoves.current);
            pendingMoves.current.clear();
            void updateShow((d) => {
              for (const x of d.scenery) {
                const m = moves.get(x.id);
                if (m) Object.assign(x, m);
              }
            });
          });
      },
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
    if (show && scene.current) {
      scene.current.setShow(show);
      scene.current.setAtmosphere(
        show.visualizer ?? { haze: 0.35, ambient: 0.15 },
      );
    }
  }, [show]);

  // Screens show what the audience sees.
  useEffect(() => {
    if (!show || !scene.current) return;
    const baseTheme = live ? themeFor(show, live.presentation) : null;
    // The live slide's own formatting (font, colour…) over its theme, like the Presenter draws it.
    const st = show.presentations.find((p) => p.id === live?.presentation)?.slides.find((s) => s.id === live?.slide)?.style;
    const theme = baseTheme && {
      ...baseTheme,
      font: st?.font ?? baseTheme.font,
      size: st?.size ?? baseTheme.size,
      color: st?.color ?? baseTheme.color,
      bold: st?.bold ?? baseTheme.bold,
      uppercase: st?.uppercase ?? baseTheme.uppercase,
      shadow: st?.shadow ?? baseTheme.shadow,
      position: st?.position ?? baseTheme.position,
    };
    const mediaId = layers.media ?? (live ? theme?.background_media : null);
    const media = show.media.find(
      (m) => m.id === mediaId && m.kind !== "audio",
    );
    const content = {
      text: live?.text ?? "",
      theme:
        theme ??
        (live
          ? null
          : { ...(show.themes[0] as Theme), background_color: "#000000" }),
      background:
        media && media.kind !== "input"
          ? {
              kind:
                media.kind === "video"
                  ? ("video" as const)
                  : ("image" as const),
              url: mediaUrl(media.path),
            }
          : null,
      countdown: layers.countdown?.show_on_audience
        ? {
            label: layers.countdown.label,
            endsAt: layers.countdown.ends_at_unix_ms,
          }
        : null,
      stream: null as MediaStream | null,
    };
    scene.current.setScreenContent(content);
    // Live camera / capture input on the screens too.
    if (media?.kind === "input") {
      let current = true;
      getInputStream(media.path)
        .then(
          (stream) =>
            current && scene.current?.setScreenContent({ ...content, stream }),
        )
        .catch((e) => pushLog("warn", String(e?.message ?? e)));
      return () => {
        current = false;
      };
    }
  }, [show, live, layers]);

  useEffect(() => {
    scene.current?.select(selected);
  }, [selected, show]);

  const changeSource = async (t: VizSource["type"]) => {
    const src: VizSource =
      t === "sacn"
        ? { type: "sacn", universes: 4 }
        : t === "art_net"
          ? { type: "art_net" }
          : { type: "internal" };
    try {
      await api.setVisualizerSource(src);
      setSource(t);
    } catch (e) {
      pushLog("warn", String(e));
    }
  };

  const addScenery = (kind: SceneryKind) => {
    if (!show) return;
    setAddOpen(false);
    const [, label, defaults] = ALL_KINDS.find((x) => x[0] === kind)!;
    const id = Math.max(0, ...show.scenery.map((s) => s.id)) + 1;
    const n = show.scenery.filter((s) => s.kind === kind).length + 1;
    void updateShow(
      (d) =>
        void d.scenery.push({
          id,
          name: `${label} ${n}`,
          kind,
          ...structuredClone(defaults),
        }),
    ).then(() => setSelected([{ kind: "scenery", id }]));
  };
  const importModel = async () => {
    setAddOpen(false);
    const path = await pickModelFile();
    if (!path || !show) return;
    const id = Math.max(0, ...show.scenery.map((s) => s.id)) + 1;
    const name =
      path
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.[^.]+$/, "") || "Model";
    // SketchUp exports STL in inches unless told otherwise; the inspector can change it.
    const unit = path.toLowerCase().endsWith(".stl") ? "in" : "m";
    void updateShow(
      (d) =>
        void d.scenery.push({
          id,
          name,
          kind: "model",
          ...D([0, 0, 0], [1, 1, 1], "#9ca3af"),
          model_path: path,
          model_unit: unit,
          model_z_up: !/\.(dae|glb|gltf)$/i.test(path),
        }),
    ).then(() => setSelected([{ kind: "scenery", id }]));
  };
  const atmo = show?.visualizer ?? { haze: 0.35, ambient: 0.15 };
  const setAtmo = (patch: Partial<typeof atmo>) =>
    updateShow((d) => void (d.visualizer = { ...atmo, ...patch }));

  const one = selected.length === 1 ? selected[0] : null;
  const fx =
    one?.kind === "fixture"
      ? show?.fixtures.find((f) => f.id === one.id)
      : undefined;
  const sc =
    one?.kind === "scenery"
      ? show?.scenery.find((s) => s.id === one.id)
      : undefined;
  const isSel = (kind: SelItem["kind"], id: number) =>
    selected.some((x) => x.kind === kind && x.id === id);
  const listClick = (item: SelItem) => (e: React.MouseEvent) =>
    pick(item, e.shiftKey || e.metaKey || e.ctrlKey);

  return (
    <div className="visualizer">
      <div className="viz-toolbar">
        <label className="inline">
          Show DMX from
          <select
            value={source}
            onChange={(e) => changeSource(e.target.value as VizSource["type"])}
          >
            <option value="internal">This app's lighting</option>
            <option value="sacn">
              External console via sACN (e.g. Lightkey)
            </option>
            <option value="art_net">External console via Art-Net</option>
          </select>
        </label>
        <span className="muted">
          {frameSource && `receiving ${frameSource}`}
        </span>
        <span className="grow" />
        <label
          className="inline muted viz-slider"
          title="How visible the beams are in the air"
        >
          Haze
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={atmo.haze}
            onChange={(e) => void setAtmo({ haze: Number(e.target.value) })}
          />
          <b>{Math.round(atmo.haze * 100)}%</b>
        </label>
        <label className="inline muted viz-slider" title="House / room light">
          Ambient
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={atmo.ambient}
            onChange={(e) => void setAtmo({ ambient: Number(e.target.value) })}
          />
          <b>{Math.round(atmo.ambient * 100)}%</b>
        </label>
        <span className="viz-add">
          <button className="primary" onClick={() => setAddOpen(!addOpen)}>
            + Add to stage ▾
          </button>
          {addOpen && (
            <div
              className="popover viz-add-menu"
              onMouseLeave={() => setAddOpen(false)}
            >
              {CATALOG.map((c) => (
                <div key={c.group}>
                  <h3>{c.group}</h3>
                  {c.items.map(([k, label]) => (
                    <button
                      key={k}
                      className="viz-add-item"
                      onClick={() => addScenery(k)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ))}
              <div>
                <h3>Import</h3>
                <button
                  className="viz-add-item"
                  onClick={() => void importModel()}
                  title="SketchUp: File › Export › 3D Model… as .stl, .obj or .dae (Collada keeps colours)"
                >
                  3D model file (SketchUp .stl / .obj / .dae, .glb)…
                </button>
              </div>
            </div>
          )}
        </span>
        <div className="seg">
          <button onClick={() => scene.current?.setMode("translate")} title="W">
            Move
          </button>
          <button onClick={() => scene.current?.setMode("rotate")} title="E">
            Rotate
          </button>
          <button onClick={() => scene.current?.resetCamera()}>
            Reset view
          </button>
        </div>
      </div>
      <div className="viz-body">
        <div className="viz-canvas" ref={host} />
        <aside className="panel right viz-side">
          {selected.length > 1 && show ? (
            <MultiInspector
              items={selected}
              show={show}
              onClose={() => setSelected([])}
            />
          ) : sc && show ? (
            <SceneryInspector s={sc} onClose={() => setSelected([])} />
          ) : fx && show ? (
            <FixtureInspector
              fixture={fx}
              show={show}
              onClose={() => setSelected([])}
            />
          ) : (
            <p className="muted viz-hint">
              Click a light or anything on stage in the 3D view (or in the lists
              below) to move, rotate and edit it. <b>Shift-click</b> (or
              ⌘/Ctrl-click) to select several and edit them together. Drag empty
              space to orbit, scroll to zoom.
            </p>
          )}
          <h3>Scenery</h3>
          <ul className="list compact">
            {show?.scenery.map((s) => (
              <li
                key={s.id}
                className={isSel("scenery", s.id) ? "sel" : ""}
                onClick={listClick({ kind: "scenery", id: s.id })}
              >
                <span className="viz-swatch" style={{ background: s.color }} />
                <span className="grow">{s.name}</span>
                <small>{kindLabel(s.kind)}</small>
              </li>
            ))}
            {show?.scenery.length === 0 && (
              <li className="muted">Nothing yet — use + Add to stage</li>
            )}
          </ul>
          <h3>
            Fixtures{" "}
            <button
              className="link"
              onClick={() =>
                setSelected(
                  (show?.fixtures ?? []).map((f) => ({
                    kind: "fixture" as const,
                    id: f.id,
                  })),
                )
              }
            >
              select all
            </button>
          </h3>
          <ul className="list compact">
            {show?.fixtures.map((f) => (
              <li
                key={f.id}
                className={isSel("fixture", f.id) ? "sel" : ""}
                onClick={listClick({ kind: "fixture", id: f.id })}
              >
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
function NumField({
  value,
  step,
  min,
  onChange,
}: {
  value: number;
  step: number;
  min?: number;
  onChange: (v: number) => void;
}) {
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
        <input
          className="viz-name"
          value={s.name}
          onChange={(e) => void set({ name: e.target.value })}
        />
        <button className="icon" onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="row">
        {s.kind === "model" ? (
          <span className="grow muted">Imported 3D model</span>
        ) : (
          <select
            value={s.kind}
            onChange={(e) => void set({ kind: e.target.value as SceneryKind })}
          >
            {CATALOG.map((c) => (
              <optgroup key={c.group} label={c.group}>
                {c.items.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
        <input
          type="color"
          value={s.color.slice(0, 7)}
          onChange={(e) => void set({ color: e.target.value })}
          title="Surface colour"
        />
      </div>
      {s.kind === "model" ? (
        <>
          <label>Model file</label>
          <div className="row">
            <small className="grow muted viz-path" title={s.model_path}>
              {s.model_path.split(/[\\/]/).pop()}
            </small>
            <button
              onClick={async () => {
                const p = await pickModelFile();
                if (p) void set({ model_path: p });
              }}
            >
              Change…
            </button>
          </div>
          <div className="row wrap">
            <label
              className="inline"
              title="The unit the file was exported in. Wrong size? Try another."
            >
              Units
              <select
                value={s.model_unit}
                onChange={(e) => void set({ model_unit: e.target.value })}
              >
                <option value="m">metres</option>
                <option value="cm">centimetres</option>
                <option value="mm">millimetres</option>
                <option value="in">inches (SketchUp STL)</option>
                <option value="ft">feet</option>
              </select>
            </label>
            <label
              className="inline"
              title="SketchUp and most CAD files have Z pointing up; turn off if the model lies on its side"
            >
              <input
                type="checkbox"
                checked={s.model_z_up}
                onChange={(e) => void set({ model_z_up: e.target.checked })}
              />
              Z is up
            </label>
          </div>
          <Vec3
            label="Scale — 1 = as drawn"
            value={s.size}
            step={0.1}
            min={0.01}
            onChange={(size) =>
              void set({
                size: size.map((v) => Math.max(0.01, v)) as [
                  number,
                  number,
                  number,
                ],
              })
            }
          />
        </>
      ) : (
        <Vec3
          label="Size (m) — width, height, thickness"
          value={s.size}
          step={0.1}
          min={0.02}
          onChange={(size) =>
            void set({
              size: size.map((v) => Math.max(0.02, v)) as [
                number,
                number,
                number,
              ],
            })
          }
        />
      )}
      <Vec3
        label="Position (m) — centre of the bottom edge"
        value={s.position}
        step={0.1}
        onChange={(position) => void set({ position })}
      />
      <Vec3
        label="Rotation (°)"
        value={s.rotation}
        step={5}
        onChange={(rotation) => void set({ rotation })}
      />
      <div className="row">
        <button
          onClick={() =>
            updateShow((d) => {
              const id = Math.max(0, ...d.scenery.map((x) => x.id)) + 1;
              d.scenery.push({
                ...structuredClone(s),
                id,
                name: `${s.name} copy`,
                position: [
                  s.position[0] + s.size[0] + 0.2,
                  s.position[1],
                  s.position[2],
                ],
              });
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
              void updateShow(
                (d) =>
                  void (d.scenery = d.scenery.filter((x) => x.id !== s.id)),
              );
            })
          }
        >
          Delete
        </button>
      </div>
      <small className="muted">
        {s.kind === "model"
          ? "Imported models use one surface colour (Collada .dae and .glb keep their own). Light shows best on light colours."
          : s.kind === "screen"
            ? "Shows the Presenter's audience output live. Size it to match the real screen; Duplicate for more screens."
            : "Tip: drag it in the view (Move / Rotate). Colour matters: light shows best on light surfaces."}
      </small>
    </div>
  );
}

function FixtureInspector({
  fixture,
  show,
  onClose,
}: {
  fixture: Fixture;
  show: Show;
  onClose: () => void;
}) {
  const set = (
    position: [number, number, number],
    rotation: [number, number, number],
  ) => send({ type: "move_fixture", fixture: fixture.id, position, rotation });
  const profile = show.profiles.find((p) => p.id === fixture.profile_id);
  const sameProfile = show.fixtures.filter(
    (f) => f.profile_id === fixture.profile_id,
  ).length;
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
            Shown as{" "}
            {sameProfile > 1 && (
              <small>
                (all {sameProfile} {profile.model} fixtures)
              </small>
            )}
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
                    if (p)
                      p.beam_angle = Math.max(
                        2,
                        Math.min(160, Number(e.target.value)),
                      );
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
                  .forEach(
                    (f) =>
                      void send({
                        type: "move_fixture",
                        fixture: f.id,
                        position: [f.position[0], 0.05, f.position[2]],
                        rotation: [-12, 0, 0],
                      }),
                  )
              }
            >
              Put all {sameProfile} on the floor, aimed up the wall
            </button>
          )}
        </>
      )}
      <Vec3
        label="Position (m) — X across, Y height, Z toward audience"
        value={fixture.position}
        step={0.1}
        onChange={(p) => void set(p, fixture.rotation)}
      />
      <Vec3
        label="Rotation (°) — floor puck tilted back to a wall ≈ X −12"
        value={fixture.rotation}
        step={5}
        onChange={(r) => void set(fixture.position, r)}
      />
    </div>
  );
}

/** Value shared by all, or null when they differ. */
function common(values: number[]): number | null {
  return values.length && values.every((v) => Math.abs(v - values[0]) < 1e-6)
    ? values[0]
    : null;
}

/** Number box for several items: blank when they differ; typing sets all of them. */
function MixedField({
  values,
  step,
  onChange,
}: {
  values: number[];
  step: number;
  onChange: (v: number) => void;
}) {
  const c = common(values);
  const [text, setText] = useState(
    c == null ? "" : String(Number(c.toFixed(2))),
  );
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(c == null ? "" : String(Number(c.toFixed(2))));
  }, [c, focused]);
  return (
    <input
      type="number"
      step={step}
      placeholder="mixed"
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

/** Edit several lights / stage items at once. */
function MultiInspector({
  items,
  show,
  onClose,
}: {
  items: SelItem[];
  show: Show;
  onClose: () => void;
}) {
  const fixtures = items.flatMap((i) =>
    i.kind === "fixture" ? show.fixtures.filter((f) => f.id === i.id) : [],
  );
  const scenery = items.flatMap((i) =>
    i.kind === "scenery" ? show.scenery.filter((s) => s.id === i.id) : [],
  );
  type V3 = [number, number, number];
  const all = [
    ...fixtures.map((f) => ({ position: f.position, rotation: f.rotation })),
    ...scenery,
  ];

  /** Change position / rotation of everything selected. */
  const place = (f: (p: V3, r: V3, i: number) => [V3, V3]) => {
    fixtures.forEach((x, i) => {
      const [position, rotation] = f(
        [...x.position] as V3,
        [...x.rotation] as V3,
        i,
      );
      void send({ type: "move_fixture", fixture: x.id, position, rotation });
    });
    if (scenery.length)
      void updateShow((d) => {
        scenery.forEach((s, j) => {
          const x = d.scenery.find((y) => y.id === s.id);
          if (!x) return;
          const [position, rotation] = f(
            [...x.position] as V3,
            [...x.rotation] as V3,
            fixtures.length + j,
          );
          Object.assign(x, { position, rotation });
        });
      });
  };
  const setAxis = (which: "position" | "rotation", axis: number, v: number) =>
    place((p, r) => {
      (which === "position" ? p : r)[axis] = v;
      return [p, r];
    });
  /** Even spacing along an axis between the outermost two, ordered by where they are now. */
  const spread = (axis: number) => {
    const order = all
      .map((x, i) => ({ i, v: x.position[axis] }))
      .sort((a, b) => a.v - b.v);
    const lo = order[0].v;
    const hi = order[order.length - 1].v;
    const rank = new Map(order.map((o, k) => [o.i, k]));
    place((p, r, i) => {
      p[axis] =
        Math.round(
          (lo +
            ((hi - lo) * (rank.get(i) ?? 0)) / Math.max(1, order.length - 1)) *
            100,
        ) / 100;
      return [p, r];
    });
  };
  const nudge = (axis: number, by: number) =>
    place((p, r) => {
      p[axis] = Math.round((p[axis] + by) * 100) / 100;
      return [p, r];
    });
  const profiles = [...new Set(fixtures.map((f) => f.profile_id))]
    .map((id) => show.profiles.find((p) => p.id === id))
    .filter((p) => !!p);
  const kinds = new Set(profiles.map((p) => p!.kind));

  return (
    <div className="card">
      <header>
        <h3>
          {items.length} selected
          <small className="muted">
            {" "}
            {fixtures.length > 0 &&
              `${fixtures.length} light${fixtures.length > 1 ? "s" : ""}`}
            {fixtures.length > 0 && scenery.length > 0 && " · "}
            {scenery.length > 0 &&
              `${scenery.length} stage item${scenery.length > 1 ? "s" : ""}`}
          </small>
        </h3>
        <button
          className="icon"
          onClick={onClose}
          title="Clear selection (Esc)"
        >
          ✕
        </button>
      </header>
      <small className="muted">
        Drag the arrows in the view to move them together (Rotate turns them
        around their centre). Blank boxes = values differ; typing sets all.
      </small>
      {(["position", "rotation"] as const).map((which) => (
        <div key={which}>
          <label>
            {which === "position" ? "Position (m)" : "Rotation (°)"}
          </label>
          <div className="viz-vec">
            {AXIS.map((a, axis) => (
              <label key={a} className="inline">
                {a}
                <MixedField
                  values={all.map((x) => x[which][axis])}
                  step={which === "position" ? 0.1 : 5}
                  onChange={(v) => setAxis(which, axis, v)}
                />
              </label>
            ))}
          </div>
        </div>
      ))}
      <label>Arrange</label>
      <div className="row wrap">
        <button
          onClick={() => spread(0)}
          title="Even gaps left to right, keeping the outermost two where they are"
        >
          ↔ Spread evenly
        </button>
        <button onClick={() => spread(2)} title="Even gaps front to back">
          ↕ Spread depth
        </button>
        <button onClick={() => nudge(1, 0.1)}>Up 10 cm</button>
        <button onClick={() => nudge(1, -0.1)}>Down 10 cm</button>
      </div>
      {fixtures.length > 0 && profiles.length > 0 && (
        <>
          <label>
            Lights shown as{" "}
            {profiles.length > 1 && (
              <small>({profiles.length} fixture types)</small>
            )}
          </label>
          <select
            value={kinds.size === 1 ? [...kinds][0] : ""}
            onChange={(e) =>
              updateShow((d) => {
                for (const p of d.profiles)
                  if (profiles.some((q) => q!.id === p.id))
                    p.kind = e.target.value as FixtureKind;
              })
            }
          >
            {kinds.size !== 1 && <option value="">mixed</option>}
            {SHOWN_AS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </>
      )}
      {scenery.length > 0 && (
        <div className="row">
          <label className="inline">
            Colour
            <input
              type="color"
              value={scenery[0].color.slice(0, 7)}
              onChange={(e) =>
                updateShow((d) => {
                  for (const x of d.scenery)
                    if (scenery.some((s) => s.id === x.id))
                      x.color = e.target.value;
                })
              }
            />
          </label>
          <span className="grow" />
          <button
            onClick={() =>
              void confirmDialog(
                `Delete ${scenery.length} stage item${scenery.length > 1 ? "s" : ""}? (Lights stay — delete those in Lighting › Patch.)`,
              ).then((yes) => {
                if (!yes) return;
                onClose();
                void updateShow(
                  (d) =>
                    void (d.scenery = d.scenery.filter(
                      (x) => !scenery.some((s) => s.id === x.id),
                    )),
                );
              })
            }
          >
            Delete stage items
          </button>
        </div>
      )}
    </div>
  );
}
