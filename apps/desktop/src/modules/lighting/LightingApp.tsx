import { useEffect, useState } from "react";
import { api } from "../../shared/bridge";
import { pushLog, send, updateShow, useEngine } from "../../shared/store";
import type { AiStatus, DmxOutputConfig, SerialPortInfo, Show } from "../../shared/types";

type Tab = "live" | "patch" | "positions" | "outputs";

export default function LightingApp() {
  const [tab, setTab] = useState<Tab>("live");
  const { show } = useEngine();
  if (!show) return <div className="empty">Loading show…</div>;
  return (
    <div className="lighting">
      <div className="tabs">
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

// ─────────────────────────────────────────────── Live: AI bar, groups, cues
const SWATCHES = ["red", "orange", "amber", "yellow", "green", "teal", "cyan", "blue", "congo blue", "purple", "magenta", "pink", "warm white", "white"];
const CSS: Record<string, string> = {
  red: "#f22", orange: "#f70", amber: "#fa0", yellow: "#fe0", green: "#2e4", teal: "#0cb", cyan: "#0ff", blue: "#22f",
  "congo blue": "#30f", purple: "#80f", magenta: "#f0f", pink: "#f6b", "warm white": "#ffc880", white: "#fff",
};

function Live({ show }: { show: Show }) {
  const { activeCue, lastScene, programmer } = useEngine();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [engineUsed, setEngineUsed] = useState<string | null>(null);
  const [cueName, setCueName] = useState("");
  const [fade, setFade] = useState(2);
  const [gm, setGm] = useState(100);
  const [ai, setAi] = useState<AiStatus | null>(null);

  useEffect(() => {
    api.aiStatus().then(setAi).catch(() => {});
  }, []);

  const build = async (force: boolean) => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await api.aiBuildScene(text, force);
      setEngineUsed(r.engine);
    } catch (e) {
      pushLog("warn", String(e));
    } finally {
      setBusy(false);
    }
  };

  const programmed = Object.keys(programmer.fixtures).length;

  return (
    <div className="lighting-live">
      <section className="card ai-bar">
        <header>
          <h3>Scene builder</h3>
          <small>{ai?.has_api_key ? `AI: ${ai.model}` : "Offline parser (add an API key for full AI)"}</small>
        </header>
        <div className="row">
          <input
            className="grow big"
            value={text}
            placeholder="back wall blue, front spots on at 75, movers gobo 3 location centre stage"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && build(e.shiftKey)}
          />
          <button className="primary" disabled={busy} onClick={() => build(false)} title="Enter">
            Build
          </button>
          <button disabled={busy || !ai?.has_api_key} onClick={() => build(true)} title="Shift+Enter">
            Ask AI
          </button>
        </div>
        {lastScene && (
          <div className="scene-result">
            {engineUsed && <span className="tag">{engineUsed}</span>}
            {lastScene.applied.map((a, i) => (
              <div key={i} className="ok">✓ {a}</div>
            ))}
            {lastScene.issues.map((a, i) => (
              <div key={i} className="warn">⚠ {a}</div>
            ))}
            {lastScene.unknown.map((a, i) => (
              <div key={i} className="muted">? didn’t understand “{a}”</div>
            ))}
          </div>
        )}
        <div className="row">
          <span className="muted">{programmed} fixture(s) in programmer</span>
          <input placeholder="Cue name" value={cueName} onChange={(e) => setCueName(e.target.value)} />
          <label className="inline">
            Fade
            <input type="number" min={0} step={0.5} value={fade} onChange={(e) => setFade(Number(e.target.value))} />s
          </label>
          <button
            className="primary"
            disabled={!programmed}
            onClick={() => {
              void send({ type: "record_cue", name: cueName || text || `Cue ${show.cues.length + 1}`, fade_ms: fade * 1000 });
              setCueName("");
            }}
          >
            Record cue
          </button>
          <button onClick={() => send({ type: "clear_programmer" })}>Clear</button>
        </div>
        <ApiKey onSaved={() => api.aiStatus().then(setAi)} />
      </section>

      <section className="card groups">
        <h3>Groups</h3>
        {show.groups.map((g) => (
          <div key={g.name} className="group-row">
            <div className="group-name">
              {g.name} <small>({g.fixtures.length})</small>
            </div>
            {[0, 25, 50, 75, 100].map((v) => (
              <button key={v} onClick={() => send({ type: "apply_text", text: `${g.name} at ${v}` })}>
                {v}
              </button>
            ))}
            <div className="swatches">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  className="swatch"
                  title={c}
                  style={{ background: CSS[c] }}
                  onClick={() => send({ type: "apply_text", text: `${g.name} ${c}` })}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="card cues">
        <header>
          <h3>Cues</h3>
          <button onClick={() => send({ type: "release_cue" })}>Release</button>
        </header>
        <ul className="list">
          {show.cues.map((c) => (
            <li key={c.id} className={c.id === activeCue ? "live" : ""}>
              <button className="go" onClick={() => send({ type: "go_cue", cue: c.id })}>
                GO
              </button>
              <span className="grow">
                {c.id}. {c.name}
              </span>
              <small>{(c.fade_ms / 1000).toFixed(1)}s</small>
              <button className="icon" onClick={() => send({ type: "delete_cue", cue: c.id })}>
                ✕
              </button>
            </li>
          ))}
        </ul>
        <label>Grand master {gm}%</label>
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
      </section>
    </div>
  );
}

function ApiKey({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  if (!open)
    return (
      <button className="link" onClick={() => setOpen(true)}>
        AI settings…
      </button>
    );
  return (
    <div className="row">
      <input type="password" className="grow" placeholder="Anthropic API key" value={key} onChange={(e) => setKey(e.target.value)} />
      <button
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
