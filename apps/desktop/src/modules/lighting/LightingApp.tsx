import { useEffect, useState } from "react";
import { api, on } from "../../shared/bridge";
import { pushLog, send, updateShow, useEngine } from "../../shared/store";
import type { AiStatus, DmxOutputConfig, FixtureProfile, FixtureState, FixtureVisual, Rgb, SerialPortInfo, Show } from "../../shared/types";

type Tab = "live" | "patch" | "positions" | "outputs";

export default function LightingApp() {
  const [tab, setTab] = useState<Tab>("live");
  const { show } = useEngine();
  if (!show) return <div className="empty">Loading show…</div>;
  return (
    <div className={`lighting tab-${tab}`}>
      <div className="lk-tabs seg">
        {(["live", "patch", "positions", "outputs"] as Tab[]).map((t) => (
          <button key={t} className={t === tab ? "on" : ""} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === "live" && <Live show={show} />}
      {tab === "patch" && <Patch show={show} />}
      {tab === "positions" && <Positions show={show} />}
      {tab === "outputs" && <Outputs show={show} />}
    </div>
  );
}

// ─────────────────────────────────────────────── Live (Lightkey-style)
const SWATCHES: [string, string][] = [
  ["red", "#ff2222"], ["orange", "#ff7700"], ["amber", "#ffaa00"], ["yellow", "#ffee00"], ["green", "#22ee44"],
  ["teal", "#00ccbb"], ["cyan", "#00ffff"], ["blue", "#2222ff"], ["congo blue", "#3300ff"], ["purple", "#8800ff"],
  ["magenta", "#ff00ff"], ["pink", "#ff66bb"], ["warm white", "#ffc880"], ["white", "#ffffff"],
];

const toHex = (c: Rgb) =>
  "#" + [c.r, c.g, c.b].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("");
const fromHex = (h: string): Rgb => ({
  r: parseInt(h.slice(1, 3), 16) / 255,
  g: parseInt(h.slice(3, 5), 16) / 255,
  b: parseInt(h.slice(5, 7), 16) / 255,
});

function Live({ show }: { show: Show }) {
  const { activeCue, programmer } = useEngine();
  const [sel, setSel] = useState<number[]>([]);
  const [visuals, setVisuals] = useState<Record<number, FixtureVisual>>({});

  // What the rig is actually doing right now (20 Hz from the engine), for the stage plan.
  useEffect(
    () =>
      on("visualizer-frame", (f) => {
        if (f.source !== "internal") return;
        const m: Record<number, FixtureVisual> = {};
        for (const v of f.fixtures) m[v.id] = v;
        setVisuals(m);
      }),
    [],
  );

  const profileOf = (id: number) => show.profiles.find((p) => p.id === show.fixtures.find((f) => f.id === id)?.profile_id);
  const click = (id: number, e: React.MouseEvent) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    else setSel([id]);
  };

  return (
    <div className="lk-live">
      <SceneBuilder show={show} />

      <aside className="lk-fixtures">
        <h3>Groups</h3>
        <ul className="lk-list">
          {show.groups.map((g) => {
            const all = g.fixtures.length > 0 && g.fixtures.every((f) => sel.includes(f));
            return (
              <li key={g.name} className={all ? "sel" : ""} onClick={(e) => (e.shiftKey ? setSel([...new Set([...sel, ...g.fixtures])]) : setSel(g.fixtures))}>
                <span className="grow">{g.name}</span>
                <small>{g.fixtures.length}</small>
              </li>
            );
          })}
        </ul>
        <h3>
          Fixtures
          <span className="grow" />
          <button className="link" onClick={() => setSel(show.fixtures.map((f) => f.id))}>all</button>
          <button className="link" onClick={() => setSel([])}>none</button>
        </h3>
        <ul className="lk-list fixtures">
          {show.fixtures.map((f) => {
            const v = visuals[f.id];
            return (
              <li key={f.id} className={sel.includes(f.id) ? "sel" : ""} onClick={(e) => click(f.id, e)}>
                <span className="lk-dot" style={{ background: v ? toHex(v.color) : "#000", opacity: v ? 0.25 + 0.75 * v.intensity : 0.25 }} />
                <span className="grow ellipsis">{f.name}</span>
                <small>{v ? Math.round(v.intensity * 100) : 0}%</small>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="lk-stage">
        <StagePlan show={show} visuals={visuals} sel={sel} onClick={click} onClear={() => setSel([])} />
      </section>

      <Inspector show={show} sel={sel} programmer={programmer} profileOf={profileOf} />

      <CueStrip show={show} activeCue={activeCue} programmed={Object.keys(programmer.fixtures).length} />
    </div>
  );
}

function SceneBuilder({ show }: { show: Show }) {
  const { lastScene } = useEngine();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [engineUsed, setEngineUsed] = useState<string | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [showResult, setShowResult] = useState(false);
  useEffect(() => {
    api.aiStatus().then(setAi).catch(() => {});
  }, []);
  void show;

  const build = async (force: boolean) => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await api.aiBuildScene(text, force);
      setEngineUsed(r.engine);
      setShowResult(true);
    } catch (e) {
      pushLog("warn", String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="lk-builder">
      <span className="lk-builder-icon" title="Describe a look in plain words">✦</span>
      <input
        className="grow"
        value={text}
        placeholder="Describe a look… e.g. back wall blue, front wash at 75, movers gobo 3 position centre stage"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && build(e.shiftKey)}
      />
      <button className="primary" disabled={busy} onClick={() => build(false)} title="Enter">
        Build
      </button>
      <button disabled={busy || !ai?.has_api_key} onClick={() => build(true)} title={ai?.has_api_key ? "Shift+Enter" : "Add an API key in AI settings"}>
        Ask AI
      </button>
      <ApiKey hasKey={!!ai?.has_api_key} onSaved={() => api.aiStatus().then(setAi)} />
      {showResult && lastScene && (
        <div className="lk-scene-result" onClick={() => setShowResult(false)} title="Click to hide">
          {engineUsed && <span className="tag">{engineUsed}</span>}
          {lastScene.applied.map((a, i) => (
            <span key={i} className="ok">✓ {a}</span>
          ))}
          {lastScene.issues.map((a, i) => (
            <span key={i} className="warn">⚠ {a}</span>
          ))}
          {lastScene.unknown.map((a, i) => (
            <span key={i} className="muted">? “{a}”</span>
          ))}
        </div>
      )}
    </section>
  );
}

/** Top-down plan of the stage: each fixture drawn where it hangs, in its live colour. */
function StagePlan({
  show,
  visuals,
  sel,
  onClick,
  onClear,
}: {
  show: Show;
  visuals: Record<number, FixtureVisual>;
  sel: number[];
  onClick: (id: number, e: React.MouseEvent) => void;
  onClear: () => void;
}) {
  const { width, depth } = show.stage;
  // Front-of-house fixtures can sit beyond the stage edge: fit everything.
  const xs = show.fixtures.map((f) => f.position[0]);
  const zs = show.fixtures.map((f) => f.position[2]);
  const minX = Math.min(-width / 2, ...xs) - 0.8;
  const maxX = Math.max(width / 2, ...xs) + 0.8;
  const minZ = Math.min(-depth / 2, ...zs) - 0.8;
  const maxZ = Math.max(depth / 2, ...zs) + 0.8;
  const px = (x: number) => ((x - minX) / (maxX - minX)) * 100;
  const pz = (z: number) => ((z - minZ) / (maxZ - minZ)) * 100;

  return (
    <div className="lk-plan" onClick={(e) => e.target === e.currentTarget && onClear()}>
      <div
        className="lk-plan-stage"
        style={{ left: `${px(-width / 2)}%`, width: `${px(width / 2) - px(-width / 2)}%`, top: `${pz(-depth / 2)}%`, height: `${pz(depth / 2) - pz(-depth / 2)}%` }}
      >
        <span>Stage</span>
      </div>
      <div className="lk-plan-audience" style={{ top: `${pz(depth / 2)}%` }}>
        Audience
      </div>
      {show.fixtures.map((f) => {
        const v = visuals[f.id];
        const on = v && v.intensity > 0.01;
        const hex = v ? toHex(v.color) : "#000000";
        return (
          <button
            key={f.id}
            className={`lk-fixture ${sel.includes(f.id) ? "sel" : ""} ${on ? "on" : ""}`}
            style={{
              left: `${px(f.position[0])}%`,
              top: `${pz(f.position[2])}%`,
              ["--c" as string]: hex,
              ["--i" as string]: v ? v.intensity : 0,
            }}
            title={`${f.name} — ${v ? Math.round(v.intensity * 100) : 0}%`}
            onClick={(e) => {
              e.stopPropagation();
              onClick(f.id, e);
            }}
          >
            <span className="lk-fixture-glow" />
            <span className="lk-fixture-name">{f.name}</span>
          </button>
        );
      })}
      <small className="lk-plan-hint">Click a light to select it · Shift-click to add · click empty space to clear</small>
    </div>
  );
}

function Inspector({
  show,
  sel,
  programmer,
  profileOf,
}: {
  show: Show;
  sel: number[];
  programmer: { fixtures: Record<string, FixtureState> };
  profileOf: (id: number) => FixtureProfile | undefined;
}) {
  const first = sel.map((id) => programmer.fixtures[String(id)]).find(Boolean);
  const [dim, setDim] = useState(100);
  const [color, setColor] = useState("#ffffff");
  useEffect(() => {
    if (first?.intensity != null) setDim(Math.round(first.intensity * 100));
    if (first?.color) setColor(toHex(first.color));
  }, [sel.join(","), first?.intensity, first?.color?.r, first?.color?.g, first?.color?.b]);

  const set = (state: Partial<FixtureState>) => sel.length && send({ type: "set_fixture_state", fixtures: sel, state });
  const movers = sel.filter((id) => profileOf(id)?.channels.some((c) => c.attr === "pan"));
  const gobos = Math.max(0, ...sel.map((id) => (profileOf(id)?.gobo_slots.length ?? 1) - 1));
  const colorCapable = sel.some((id) => {
    const p = profileOf(id);
    return p && (p.channels.some((c) => c.attr === "red") || p.color_wheel.length > 0);
  });

  if (sel.length === 0)
    return (
      <aside className="lk-inspector empty-state">
        <h3>Inspector</h3>
        <p className="muted">Select lights on the stage plan or in the list to change their intensity, colour, position and gobo.</p>
      </aside>
    );

  const names = sel.map((id) => show.fixtures.find((f) => f.id === id)?.name).filter(Boolean);

  return (
    <aside className="lk-inspector">
      <h3>{sel.length === 1 ? names[0] : `${sel.length} lights`}</h3>
      {sel.length > 1 && <small className="muted ellipsis block">{names.join(", ")}</small>}

      <div className="lk-insp-section">
        <div className="lk-insp-head">
          Intensity <b>{dim}%</b>
        </div>
        <input
          type="range"
          className="lk-dimmer"
          min={0}
          max={100}
          value={dim}
          onChange={(e) => {
            const v = Number(e.target.value);
            setDim(v);
            void set({ intensity: v / 100 });
          }}
        />
        <div className="seg small fill">
          {[0, 25, 50, 75, 100].map((v) => (
            <button
              key={v}
              onClick={() => {
                setDim(v);
                void set({ intensity: v / 100 });
              }}
            >
              {v === 0 ? "Off" : v === 100 ? "Full" : v}
            </button>
          ))}
        </div>
      </div>

      {colorCapable && (
        <div className="lk-insp-section">
          <div className="lk-insp-head">
            Colour
            <input
              type="color"
              value={color}
              onChange={(e) => {
                setColor(e.target.value);
                void set({ color: fromHex(e.target.value) });
              }}
            />
          </div>
          <div className="lk-swatches">
            {SWATCHES.map(([name, hex]) => (
              <button
                key={name}
                className={`swatch ${color.toLowerCase() === hex ? "on" : ""}`}
                title={name}
                style={{ background: hex }}
                onClick={() => {
                  setColor(hex);
                  void set({ color: fromHex(hex) });
                }}
              />
            ))}
          </div>
        </div>
      )}

      {movers.length > 0 && (
        <div className="lk-insp-section">
          <div className="lk-insp-head">
            Position <small className="muted">{movers.length} mover(s)</small>
          </div>
          <XYPad
            pan={programmer.fixtures[String(movers[0])]?.pan ?? 0.5}
            tilt={programmer.fixtures[String(movers[0])]?.tilt ?? 0.5}
            onChange={(pan, tilt) => send({ type: "set_fixture_state", fixtures: movers, state: { pan, tilt } })}
          />
          <div className="lk-presets">
            {show.positions.map((p) => {
              const vals = p.values.filter((v) => movers.includes(v.fixture));
              return (
                <button
                  key={p.name}
                  disabled={vals.length === 0}
                  onClick={() => {
                    for (const v of vals) void send({ type: "set_fixture_state", fixtures: [v.fixture], state: { pan: v.pan, tilt: v.tilt } });
                  }}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {gobos > 0 && (
        <div className="lk-insp-section">
          <div className="lk-insp-head">Gobo</div>
          <div className="lk-gobos">
            {Array.from({ length: gobos + 1 }, (_, g) => (
              <button key={g} className={first?.gobo === g ? "on" : ""} onClick={() => set({ gobo: g })}>
                {g === 0 ? "Open" : g}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

function XYPad({ pan, tilt, onChange }: { pan: number; tilt: number; onChange: (pan: number, tilt: number) => void }) {
  const [pos, setPos] = useState({ pan, tilt });
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) setPos({ pan, tilt });
  }, [pan, tilt, dragging]);
  const fromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const t = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    setPos({ pan: p, tilt: t });
    onChange(p, t);
  };
  return (
    <div
      className="lk-xy"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        fromEvent(e);
      }}
      onPointerMove={(e) => dragging && fromEvent(e)}
      onPointerUp={() => setDragging(false)}
    >
      <div className="lk-xy-cross" style={{ left: `${pos.pan * 100}%`, top: `${(1 - pos.tilt) * 100}%` }} />
      <span className="lk-xy-label">
        Pan {Math.round(pos.pan * 100)} · Tilt {Math.round(pos.tilt * 100)}
      </span>
    </div>
  );
}

function CueStrip({ show, activeCue, programmed }: { show: Show; activeCue: number | null; programmed: number }) {
  const [gm, setGm] = useState(100);
  const [cueName, setCueName] = useState("");
  const [fade, setFade] = useState(2);
  return (
    <section className="lk-cues">
      <div className="lk-cues-head">
        <h3>Cues</h3>
        <div className="grow" />
        <span className="muted">{programmed} light(s) in programmer</span>
        <input placeholder="New cue name" value={cueName} onChange={(e) => setCueName(e.target.value)} />
        <label className="inline muted">
          Fade
          <input type="number" min={0} step={0.5} value={fade} onChange={(e) => setFade(Number(e.target.value))} />s
        </label>
        <button
          className="primary"
          disabled={!programmed}
          onClick={() => {
            void send({ type: "record_cue", name: cueName || `Cue ${show.cues.length + 1}`, fade_ms: fade * 1000 });
            setCueName("");
          }}
        >
          ● Record
        </button>
        <button onClick={() => send({ type: "clear_programmer" })}>Clear programmer</button>
        <button onClick={() => send({ type: "release_cue" })}>Release</button>
        <label className="inline lk-gm">
          Master {gm}%
          <input
            type="range"
            min={0}
            max={100}
            value={gm}
            onChange={(e) => {
              const v = Number(e.target.value);
              setGm(v);
              void send({ type: "grand_master", level: v / 100 });
            }}
          />
        </label>
      </div>
      <div className="lk-cue-tiles">
        {show.cues.map((c) => (
          <div key={c.id} className={`lk-cue ${c.id === activeCue ? "active" : ""}`} onClick={() => send({ type: "go_cue", cue: c.id })}>
            <div className="lk-cue-num">{c.id}</div>
            <div className="lk-cue-name">{c.name}</div>
            <div className="lk-cue-meta">
              <span>{(c.fade_ms / 1000).toFixed(1)}s</span>
              <span>{Object.keys(c.look.fixtures).length} lights</span>
            </div>
            <button
              className="icon lk-cue-del"
              title="Delete cue"
              onClick={(e) => {
                e.stopPropagation();
                void send({ type: "delete_cue", cue: c.id });
              }}
            >
              ✕
            </button>
          </div>
        ))}
        {show.cues.length === 0 && <div className="muted">No cues yet: build a look, then press Record.</div>}
      </div>
    </section>
  );
}

function ApiKey({ hasKey, onSaved }: { hasKey: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  return (
    <span className="lk-ai-settings">
      <button className="icon" title={hasKey ? "AI: key saved" : "AI settings (optional API key)"} onClick={() => setOpen(!open)}>
        ⚙
      </button>
      {open && (
        <div className="popover">
          <label>Anthropic API key (optional; the offline parser works without it)</label>
          <div className="row">
            <input type="password" className="grow" placeholder={hasKey ? "Saved — paste to replace" : "sk-ant-…"} value={key} onChange={(e) => setKey(e.target.value)} />
            <button
              className="primary"
              disabled={!key.trim()}
              onClick={async () => {
                await api.setApiKey(key).catch((e) => pushLog("warn", String(e)));
                setOpen(false);
                setKey("");
                onSaved();
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </span>
  );
}

// ─────────────────────────────────────────────── Patch
function Patch({ show }: { show: Show }) {
  const [warnings, setWarnings] = useState<string[]>([]);
  useEffect(() => {
    api.patchWarnings().then(setWarnings).catch(() => {});
  }, [show]);
  const profile = (id: string) => show.profiles.find((p) => p.id === id);

  return (
    <div className="patch">
      {warnings.length > 0 && (
        <div className="card">
          {warnings.map((w, i) => (
            <div key={i} className="warn">⚠ {w}</div>
          ))}
        </div>
      )}
      <table>
        <thead>
          <tr>
            <th>#</th><th>Name</th><th>Fixture</th><th>Mode</th><th>Univ</th><th>Address</th><th>Ch</th>
          </tr>
        </thead>
        <tbody>
          {show.fixtures.map((f) => {
            const p = profile(f.profile_id);
            return (
              <tr key={f.id}>
                <td>{f.id}</td>
                <td>
                  <input value={f.name} onChange={(e) => updateShow((d) => { d.fixtures.find((x) => x.id === f.id)!.name = e.target.value; })} />
                </td>
                <td>{p ? `${p.manufacturer} ${p.model}` : f.profile_id}</td>
                <td>{p?.mode}</td>
                <td>
                  <input type="number" min={1} value={f.universe} onChange={(e) => updateShow((d) => { d.fixtures.find((x) => x.id === f.id)!.universe = Number(e.target.value); })} />
                </td>
                <td>
                  <input type="number" min={1} max={512} value={f.address} onChange={(e) => updateShow((d) => { d.fixtures.find((x) => x.id === f.id)!.address = Number(e.target.value); })} />
                </td>
                <td>{p?.channels.length}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3>Groups & what people call them</h3>
      <p className="muted">The scene builder understands every alias listed here.</p>
      {show.groups.map((g, gi) => (
        <div key={g.name} className="row">
          <strong className="group-name">{g.name}</strong>
          <input
            className="grow"
            value={g.aliases.join(", ")}
            onChange={(e) =>
              updateShow((d) => {
                d.groups[gi].aliases = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
              })
            }
          />
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────── Positions
function Positions({ show }: { show: Show }) {
  const movers = show.fixtures.filter((f) => {
    const p = show.profiles.find((x) => x.id === f.profile_id);
    return p?.channels.some((c) => c.attr === "pan");
  });
  const [sel, setSel] = useState<number[]>(movers.map((m) => m.id));
  const [pan, setPan] = useState(50);
  const [tilt, setTilt] = useState(50);
  const [name, setName] = useState("");

  const push = (p: number, t: number) =>
    send({ type: "set_fixture_state", fixtures: sel, state: { pan: p / 100, tilt: t / 100, intensity: 1 } });

  return (
    <div className="positions">
      <div className="card">
        <h3>Focus movers</h3>
        <div className="row wrap">
          {movers.map((m) => (
            <label key={m.id} className="inline">
              <input
                type="checkbox"
                checked={sel.includes(m.id)}
                onChange={(e) => setSel(e.target.checked ? [...sel, m.id] : sel.filter((x) => x !== m.id))}
              />
              {m.name}
            </label>
          ))}
        </div>
        <label>Pan {pan}%</label>
        <input type="range" min={0} max={100} step={0.5} value={pan} onChange={(e) => { setPan(Number(e.target.value)); void push(Number(e.target.value), tilt); }} />
        <label>Tilt {tilt}%</label>
        <input type="range" min={0} max={100} step={0.5} value={tilt} onChange={(e) => { setTilt(Number(e.target.value)); void push(pan, Number(e.target.value)); }} />
        <p className="muted">Tip: open the Visualizer (or watch the stage) while focusing. Do one mover at a time for accurate presets.</p>
        <div className="row">
          <input placeholder="Preset name e.g. Centre Stage" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="primary" disabled={!name.trim()} onClick={() => send({ type: "record_position", name })}>
            Store position
          </button>
        </div>
      </div>
      <div className="card">
        <h3>Stored positions</h3>
        {show.positions.map((p, pi) => (
          <div key={p.name} className="row">
            <strong className="group-name">{p.name}</strong>
            <small>{p.values.length} fixtures</small>
            <input
              className="grow"
              placeholder="aliases"
              value={p.aliases.join(", ")}
              onChange={(e) =>
                updateShow((d) => {
                  d.positions[pi].aliases = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                })
              }
            />
            <button onClick={() => send({ type: "apply_text", text: `movers ${p.name}` })}>Recall</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── Outputs
function Outputs({ show }: { show: Show }) {
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [status, setStatus] = useState<[{ name: string; show_universe: number; error: string | null }[], string[]]>([[], []]);

  const refresh = () => {
    api.serialPorts().then(setPorts).catch(() => {});
    api.dmxOutputStatus().then(setStatus).catch(() => {});
  };
  useEffect(refresh, [show.dmx_outputs]);

  const add = (o: DmxOutputConfig) => updateShow((d) => void d.dmx_outputs.push(o));
  const remove = (i: number) => updateShow((d) => void d.dmx_outputs.splice(i, 1));
  const firstPort = ports.find((p) => p.likely_dmx)?.name ?? ports[0]?.name ?? "";

  return (
    <div className="outputs">
      <div className="card">
        <h3>DMX outputs</h3>
        <ul className="list">
          {show.dmx_outputs.map((o, i) => (
            <li key={i}>
              <span className="tag">{o.type}</span>
              <span className="grow">{describe(o)}</span>
              <button className="icon" onClick={() => remove(i)}>✕</button>
            </li>
          ))}
        </ul>
        <div className="row wrap">
          <button onClick={() => add({ type: "sacn", universe: 1, sacn_universe: 1, priority: 100, unicast_ip: null })}>+ sACN</button>
          <button onClick={() => add({ type: "art_net", ip: "2.255.255.255", universe: 1, artnet_universe: 0 })}>+ Art-Net</button>
          <button disabled={!firstPort} onClick={() => add({ type: "enttec_pro", port: firstPort, universe: 1 })}>+ Enttec DMX USB Pro</button>
          <button disabled={!firstPort} onClick={() => add({ type: "open_dmx", port: firstPort, universe: 1 })}>+ Enttec Open DMX</button>
          <button onClick={refresh}>Refresh</button>
        </div>
        {status[0].map((s, i) => (
          <div key={i} className={s.error ? "warn" : "ok"}>
            {s.error ? "⚠" : "●"} {s.name} {s.error ?? ""}
          </div>
        ))}
        {status[1].map((e, i) => (
          <div key={i} className="warn">⚠ {e}</div>
        ))}
      </div>
      <div className="card">
        <h3>USB serial devices</h3>
        {ports.length === 0 && <p className="muted">None found. Plug in the Enttec and press Refresh.</p>}
        <ul className="list compact">
          {ports.map((p) => (
            <li key={p.name}>
              {p.likely_dmx ? "🎛" : "·"} {p.name} <small>{p.product ?? ""} {p.serial ?? ""}</small>
            </li>
          ))}
        </ul>
        <p className="muted">
          The DMX USB Pro has its own timing chip and is the reliable choice. Open DMX relies on the computer for timing and may flicker.
        </p>
      </div>
    </div>
  );
}

function describe(o: DmxOutputConfig) {
  switch (o.type) {
    case "sacn":
      return `Show universe ${o.universe} → sACN ${o.sacn_universe} ${o.unicast_ip ? `to ${o.unicast_ip}` : "(multicast)"} prio ${o.priority}`;
    case "art_net":
      return `Show universe ${o.universe} → Art-Net ${o.artnet_universe} @ ${o.ip}`;
    case "enttec_pro":
      return `Show universe ${o.universe} → ${o.port}`;
    case "open_dmx":
      return `Show universe ${o.universe} → ${o.port} (best effort)`;
  }
}
