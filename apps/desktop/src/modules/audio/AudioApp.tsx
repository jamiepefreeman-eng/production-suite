import { useEffect, useRef, useState } from "react";
import { api, on } from "../../shared/bridge";
import { pushLog, send, useEngine } from "../../shared/store";
import type { AudioDevice, ChannelParam, EqType, MixerCommand, MixerConfig, MixerFeedback, MixerKind, MixerStatus } from "../../shared/types";
import { compCurve, eqCurve, faderToDb, type ChState, defaultChannel } from "./dsp";

const KIND_HINT: Record<MixerKind, string> = {
  x32: "OSC over UDP 10023. Desk IP: Setup › Network.",
  x_air: "OSC over UDP 10024. Use the mixer's IP (192.168.1.1 only in its own Wi-Fi mode).",
  sq: "MIDI over TCP 51325. MIDI channel: Utility › Control › MIDI.",
  avantis: "MIDI over TCP 51325 (firmware 2.0+). Uses a base MIDI channel.",
};

const mix = (command: MixerCommand) => send({ type: "mixer", command });

/** Apply one desk setting to our local copy of that channel. */
function applyParam(s: ChState, p: ChannelParam): ChState {
  const n = { ...s, bands: s.bands.map((b) => ({ ...b })) };
  const band = "band" in p ? n.bands[p.band - 1] : undefined;
  switch (p.param) {
    case "fader": n.fader = p.level; break;
    case "mute": n.muted = p.muted; break;
    case "pan": n.pan = p.pan; break;
    case "name": n.name = p.name; break;
    case "hpf_on": n.hpfOn = p.on; break;
    case "hpf_freq": n.hpfHz = p.hz; break;
    case "eq_on": n.eqOn = p.on; break;
    case "eq_type": if (band) band.kind = p.kind; break;
    case "eq_freq": if (band) band.hz = p.hz; break;
    case "eq_gain": if (band) band.db = p.db; break;
    case "eq_q": if (band) band.q = p.q; break;
    case "gate_on": n.gate.on = p.on; break;
    case "gate_threshold": n.gate.threshold = p.db; break;
    case "gate_range": n.gate.range = p.db; break;
    case "gate_attack": n.gate.attack = p.ms; break;
    case "gate_hold": n.gate.hold = p.ms; break;
    case "gate_release": n.gate.release = p.ms; break;
    case "comp_on": n.comp.on = p.on; break;
    case "comp_threshold": n.comp.threshold = p.db; break;
    case "comp_ratio": n.comp.ratio = p.ratio; break;
    case "comp_knee": n.comp.knee = p.db; break;
    case "comp_makeup": n.comp.makeup = p.db; break;
    case "comp_attack": n.comp.attack = p.ms; break;
    case "comp_hold": n.comp.hold = p.ms; break;
    case "comp_release": n.comp.release = p.ms; break;
  }
  n.gate = { ...n.gate };
  n.comp = { ...n.comp };
  return n;
}

export default function AudioApp() {
  const { show } = useEngine();
  const [tab, setTab] = useState<"console" | "devices">("console");
  const [status, setStatus] = useState<MixerStatus | null>(null);
  const [cfg, setCfg] = useState<MixerConfig>({ kind: "x32", ip: "192.168.1.50", midi_channel: 1 });
  const [busy, setBusy] = useState(false);
  const [channels, setChannels] = useState<Record<number, ChState>>({});
  const [main, setMain] = useState(0.75);
  const [selected, setSelected] = useState(1);
  const [feedback, setFeedback] = useState<MixerFeedback[]>([]);
  const [scene, setScene] = useState(1);

  const connected = !!status?.connected;
  const count = Math.min(status?.input_channels || (cfg.kind === "x_air" ? 16 : 32), 32);
  const ch = (n: number) => channels[n] ?? defaultChannel(n);

  useEffect(() => {
    api.mixerStatus().then(setStatus).catch(() => {});
    return on("mixer-feedback", (fb) => {
      setFeedback((prev) => [...fb, ...prev].slice(0, 80));
      setChannels((prev) => {
        let next = prev;
        for (const f of fb) {
          if (!f.update) continue;
          if (next === prev) next = { ...prev };
          const c = f.update.channel;
          next[c] = applyParam(next[c] ?? defaultChannel(c), f.update.param);
        }
        return next;
      });
    });
  }, []);
  // Pre-fill from the desk saved in the show — only when that saved value really changes,
  // not on every show refresh (that used to wipe the IP box while typing).
  const savedMixer = show?.mixer ? JSON.stringify(show.mixer) : "";
  useEffect(() => {
    if (savedMixer && !connected) setCfg(JSON.parse(savedMixer) as MixerConfig);
  }, [savedMixer]);

  // After connecting, read every channel from the desk, gently (one channel per 40 ms).
  const queryTimer = useRef<number | null>(null);
  const readDesk = (n: number) => {
    if (queryTimer.current) window.clearInterval(queryTimer.current);
    let c = 1;
    queryTimer.current = window.setInterval(() => {
      void mix({ type: "query_channel", channel: c });
      if (++c > n && queryTimer.current) window.clearInterval(queryTimer.current);
    }, 40);
  };
  useEffect(() => () => void (queryTimer.current && window.clearInterval(queryTimer.current)), []);

  const connect = async () => {
    setBusy(true);
    try {
      const s = await api.mixerConnect(cfg);
      setStatus(s);
      if (s.supports_processing) readDesk(Math.min(s.input_channels, 32));
    } catch (e) {
      pushLog("warn", String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Change a setting: update our copy at once (smooth UI), then tell the desk. */
  const setParam = (channel: number, param: ChannelParam) => {
    setChannels((prev) => ({ ...prev, [channel]: applyParam(prev[channel] ?? defaultChannel(channel), param) }));
    if (connected) void mix({ type: "channel", channel, param });
  };

  return (
    <div className="audio">
      <div className="au-bar">
        <div className="seg">
          <button className={tab === "console" ? "on" : ""} onClick={() => setTab("console")}>
            Console
          </button>
          <button className={tab === "devices" ? "on" : ""} onClick={() => setTab("devices")}>
            Devices & feedback
          </button>
        </div>
        <div className="grow" />
        <select value={cfg.kind} disabled={connected} onChange={(e) => setCfg({ ...cfg, kind: e.target.value as MixerKind })}>
          {(status?.kinds ?? ([["x32", "Midas M32 / Behringer X32"], ["x_air", "Behringer X Air"], ["sq", "Allen & Heath SQ"], ["avantis", "Allen & Heath Avantis"]] as [MixerKind, string][])).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <input className="ip" value={cfg.ip} disabled={connected} onChange={(e) => setCfg({ ...cfg, ip: e.target.value })} placeholder="Desk IP" title={KIND_HINT[cfg.kind]} />
        {(cfg.kind === "sq" || cfg.kind === "avantis") && (
          <label className="inline muted">
            MIDI
            <input type="number" min={1} max={16} value={cfg.midi_channel} disabled={connected} onChange={(e) => setCfg({ ...cfg, midi_channel: Number(e.target.value) })} />
          </label>
        )}
        {connected ? (
          <>
            {status?.supports_processing && (
              <button onClick={() => readDesk(count)} title="Read every channel from the desk again">
                ⟳ Read desk
              </button>
            )}
            <button onClick={async () => setStatus(await api.mixerDisconnect())}>Disconnect</button>
          </>
        ) : (
          <button className="primary" disabled={busy} onClick={connect}>
            {busy ? "Connecting…" : "Connect"}
          </button>
        )}
        <span className={`pill ${connected ? "ok-pill" : ""}`}>{connected ? `● ${status?.config?.ip}` : "Offline"}</span>
        <label className="inline muted">
          Scene
          <input type="number" min={1} value={scene} onChange={(e) => setScene(Number(e.target.value))} />
        </label>
        <button disabled={!connected} onClick={() => mix({ type: "recall_scene", scene })}>
          Recall
        </button>
      </div>

      {tab === "console" ? (
        <div className="au-console">
          <div className="au-strips">
            {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
              <Strip
                key={n}
                n={n}
                s={ch(n)}
                selected={n === selected}
                disabled={!connected}
                onSelect={() => {
                  setSelected(n);
                  if (connected && status?.supports_processing) void mix({ type: "query_channel", channel: n });
                }}
                onParam={(p) => setParam(n, p)}
              />
            ))}
            <div className="au-strip main">
              <div className="au-strip-name">Main</div>
              <div className="au-fader-area">
                <div className="vfader-wrap">
                  <input
                    type="range"
                    className="vfader"
                    min={0}
                    max={1}
                    step={0.005}
                    value={main}
                    disabled={!connected}
                    onChange={(e) => {
                      setMain(Number(e.target.value));
                      void mix({ type: "main_fader", level: Number(e.target.value) });
                    }}
                  />
                </div>
              </div>
              <div className="au-db">{fmtDb(faderToDb(main))}</div>
            </div>
          </div>

          <ChannelPanel
            n={selected}
            s={ch(selected)}
            connected={connected}
            processing={connected ? !!status?.supports_processing : cfg.kind === "x32" || cfg.kind === "x_air"}
            kind={status?.config?.kind ?? cfg.kind}
            onParam={(p) => setParam(selected, p)}
          />
        </div>
      ) : (
        <Devices feedback={feedback} />
      )}
    </div>
  );
}

const fmtDb = (db: number | null) => (db === null ? "-∞" : `${db > 0 ? "+" : ""}${db.toFixed(1)}`);

function Strip({
  n,
  s,
  selected,
  disabled,
  onSelect,
  onParam,
}: {
  n: number;
  s: ChState;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onParam: (p: ChannelParam) => void;
}) {
  return (
    <div className={`au-strip ${selected ? "selected" : ""} ${s.muted ? "muted-ch" : ""}`}>
      <button className="au-strip-name" onClick={onSelect} title="Select to edit EQ / dynamics">
        <span className="num">{n}</span>
        <span className="ellipsis">{s.name || `Ch ${n}`}</span>
      </button>
      <div className="au-proc-leds" onClick={onSelect}>
        <span className={s.hpfOn ? "on" : ""}>HP</span>
        <span className={s.eqOn ? "on" : ""}>EQ</span>
        <span className={s.gate.on ? "on" : ""}>G</span>
        <span className={s.comp.on ? "on" : ""}>C</span>
      </div>
      <input
        type="range"
        className="au-pan"
        min={-1}
        max={1}
        step={0.02}
        value={s.pan}
        disabled={disabled}
        title={`Pan ${s.pan === 0 ? "C" : s.pan < 0 ? `L${Math.round(-s.pan * 100)}` : `R${Math.round(s.pan * 100)}`} (double-click to centre)`}
        onDoubleClick={() => onParam({ param: "pan", pan: 0 })}
        onChange={(e) => onParam({ param: "pan", pan: Number(e.target.value) })}
      />
      <button className={`au-mute ${s.muted ? "on" : ""}`} disabled={disabled} onClick={() => onParam({ param: "mute", muted: !s.muted })}>
        MUTE
      </button>
      <div className="au-fader-area">
        <div className="vfader-wrap">
          <input
            type="range"
            className="vfader"
            min={0}
            max={1}
            step={0.005}
            value={s.fader}
            disabled={disabled}
            onChange={(e) => onParam({ param: "fader", level: Number(e.target.value) })}
          />
        </div>
      </div>
      <div className="au-db">{fmtDb(faderToDb(s.fader))}</div>
    </div>
  );
}

// ─────────────────────────────────────────────── Channel processing

const EQ_TYPES: [EqType, string][] = [
  ["low_cut", "Low cut"],
  ["low_shelf", "Low shelf"],
  ["peq", "Bell (PEQ)"],
  ["veq", "Vintage bell"],
  ["high_shelf", "High shelf"],
  ["high_cut", "High cut"],
];
const RATIOS = [1.1, 1.3, 1.5, 2, 2.5, 3, 4, 5, 7, 10, 20, 100];

function ChannelPanel({
  n,
  s,
  connected,
  processing,
  kind,
  onParam,
}: {
  n: number;
  s: ChState;
  connected: boolean;
  processing: boolean;
  kind: MixerKind;
  onParam: (p: ChannelParam) => void;
}) {
  const [name, setName] = useState(s.name);
  useEffect(() => setName(s.name), [s.name, n]);

  if (!processing)
    return (
      <section className="au-panel">
        <h3>
          Channel {n} {s.name && `· ${s.name}`}
        </h3>
        <p className="muted">
          {kind === "avantis" ? "Allen & Heath Avantis" : "Allen & Heath SQ"}: faders, mutes and scene recall work from here, but A&amp;H's public
          control protocol doesn't include EQ, gate or compressor settings, so those have to be adjusted on the desk (or in A&amp;H's own
          Director / SQ MixPad app). Tip: save the processing in desk scenes and recall the scenes from Presenter slides.
        </p>
      </section>
    );

  return (
    <section className={`au-panel ${connected ? "" : "offline"}`}>
      <div className="au-panel-head">
        <span className="au-ch-num">{n}</span>
        <input
          className="au-ch-name"
          value={name}
          maxLength={12}
          disabled={!connected}
          placeholder={`Ch ${n}`}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== s.name && onParam({ param: "name", name })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        {!connected && <span className="muted">Connect to a desk to make changes. Settings shown are defaults until the desk is read.</span>}
      </div>
      <fieldset disabled={!connected} className="au-blocks">
        <div className="au-block eq">
          <div className="au-block-head">
            <Toggle on={s.eqOn} label="EQ" onChange={(v) => onParam({ param: "eq_on", on: v })} />
            <Toggle on={s.hpfOn} label="High-pass" onChange={(v) => onParam({ param: "hpf_on", on: v })} />
            <Param
              label="HPF"
              value={s.hpfHz}
              min={20}
              max={400}
              log
              unit="Hz"
              compact
              onChange={(hz) => onParam({ param: "hpf_freq", hz })}
            />
          </div>
          <EqGraph s={s} />
          <div className="au-bands">
            {s.bands.map((b, i) => {
              const band = i + 1;
              const cut = b.kind === "low_cut" || b.kind === "high_cut";
              return (
                <div key={band} className="au-band" style={{ ["--band" as string]: BAND_COLORS[i] }}>
                  <select value={b.kind} onChange={(e) => onParam({ param: "eq_type", band, kind: e.target.value as EqType })}>
                    {EQ_TYPES.map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <Param label="Freq" value={b.hz} min={20} max={20000} log unit="Hz" onChange={(hz) => onParam({ param: "eq_freq", band, hz })} />
                  <Param label="Gain" value={b.db} min={-15} max={15} step={0.25} unit="dB" disabled={cut} center onChange={(db) => onParam({ param: "eq_gain", band, db })} />
                  <Param label="Q" value={b.q} min={0.3} max={10} log digits={1} disabled={cut} onChange={(q) => onParam({ param: "eq_q", band, q })} />
                </div>
              );
            })}
          </div>
        </div>

        <div className="au-block">
          <div className="au-block-head">
            <Toggle on={s.gate.on} label="Gate" onChange={(v) => onParam({ param: "gate_on", on: v })} />
          </div>
          <Param label="Threshold" value={s.gate.threshold} min={-80} max={0} step={0.5} unit="dB" onChange={(db) => onParam({ param: "gate_threshold", db })} />
          <Param label="Range" value={s.gate.range} min={3} max={60} step={1} unit="dB" onChange={(db) => onParam({ param: "gate_range", db })} />
          <Param label="Attack" value={s.gate.attack} min={0} max={120} step={1} unit="ms" onChange={(ms) => onParam({ param: "gate_attack", ms })} />
          <Param label="Hold" value={s.gate.hold} min={0.02} max={2000} log unit="ms" onChange={(ms) => onParam({ param: "gate_hold", ms })} />
          <Param label="Release" value={s.gate.release} min={5} max={4000} log unit="ms" onChange={(ms) => onParam({ param: "gate_release", ms })} />
          <small className="muted">Desk gate mode must be GATE (Gate screen on the desk) for these to act as a gate.</small>
        </div>

        <div className="au-block">
          <div className="au-block-head">
            <Toggle on={s.comp.on} label="Compressor" onChange={(v) => onParam({ param: "comp_on", on: v })} />
          </div>
          <CompGraph s={s} />
          <Param label="Threshold" value={s.comp.threshold} min={-60} max={0} step={0.5} unit="dB" onChange={(db) => onParam({ param: "comp_threshold", db })} />
          <label className="au-param">
            <span>Ratio</span>
            <select value={s.comp.ratio} onChange={(e) => onParam({ param: "comp_ratio", ratio: Number(e.target.value) })}>
              {RATIOS.map((r) => (
                <option key={r} value={r}>
                  {r}:1
                </option>
              ))}
            </select>
          </label>
          <Param label="Knee" value={s.comp.knee} min={0} max={5} step={1} onChange={(db) => onParam({ param: "comp_knee", db })} />
          <Param label="Make-up" value={s.comp.makeup} min={0} max={24} step={0.5} unit="dB" onChange={(db) => onParam({ param: "comp_makeup", db })} />
          <Param label="Attack" value={s.comp.attack} min={0} max={120} step={1} unit="ms" onChange={(ms) => onParam({ param: "comp_attack", ms })} />
          <Param label="Release" value={s.comp.release} min={5} max={4000} log unit="ms" onChange={(ms) => onParam({ param: "comp_release", ms })} />
        </div>
      </fieldset>
    </section>
  );
}

const BAND_COLORS = ["#f59e0b", "#22c55e", "#3b82f6", "#a855f7"];

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button className={`au-toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)}>
      <span className="led" />
      {label}
    </button>
  );
}

/** Labelled slider in real units; `log` makes frequency/time sliders feel natural. */
function Param({
  label,
  value,
  min,
  max,
  step,
  log,
  unit,
  digits,
  disabled,
  center,
  compact,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  log?: boolean;
  unit?: string;
  digits?: number;
  disabled?: boolean;
  center?: boolean;
  compact?: boolean;
  onChange: (v: number) => void;
}) {
  const toPos = (v: number) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromPos = (p: number) => {
    const v = log ? min * Math.pow(max / min, p) : min + p * (max - min);
    return step ? Math.round(v / step) * step : v;
  };
  const fmt = (v: number) => {
    if (unit === "Hz") return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)}k` : `${Math.round(v)}`;
    if (unit === "ms" && v < 10) return v.toFixed(2);
    return v.toFixed(digits ?? (step && step < 1 ? 1 : 0));
  };
  return (
    <label className={`au-param ${disabled ? "dim" : ""} ${compact ? "compact" : ""}`}>
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={toPos(value)}
        disabled={disabled}
        onDoubleClick={() => center && onChange(0)}
        onChange={(e) => onChange(fromPos(Number(e.target.value)))}
      />
      <b>
        {fmt(value)}
        {unit && <small>{unit === "Hz" ? "" : ` ${unit}`}</small>}
      </b>
    </label>
  );
}

function EqGraph({ s }: { s: ChState }) {
  const W = 480;
  const H = 150;
  const pts = eqCurve(s, 160);
  const x = (hz: number) => (Math.log(hz / 20) / Math.log(1000)) * W;
  const y = (db: number) => H / 2 - (db / 18) * (H / 2);
  const path = pts.map(([hz, db], i) => `${i ? "L" : "M"}${x(hz).toFixed(1)},${y(db).toFixed(1)}`).join("");
  return (
    <svg className={`au-graph ${s.eqOn ? "" : "bypassed"}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {[100, 1000, 10000].map((f) => (
        <g key={f}>
          <line x1={x(f)} x2={x(f)} y1={0} y2={H} className="grid" />
          <text x={x(f) + 3} y={H - 4} className="axis">
            {f >= 1000 ? `${f / 1000}k` : f}
          </text>
        </g>
      ))}
      {[-12, -6, 0, 6, 12].map((d) => (
        <line key={d} x1={0} x2={W} y1={y(d)} y2={y(d)} className={d === 0 ? "grid zero" : "grid"} />
      ))}
      <path d={`${path}L${W},${H / 2}L0,${H / 2}Z`} className="fill" />
      <path d={path} className="curve" />
      {s.bands.map((b, i) => (
        <circle key={i} cx={x(b.hz)} cy={y(b.kind === "low_cut" || b.kind === "high_cut" ? 0 : b.db)} r={5} fill={BAND_COLORS[i]} />
      ))}
    </svg>
  );
}

function CompGraph({ s }: { s: ChState }) {
  const S = 120;
  const pts = compCurve(s);
  const m = (db: number) => S - ((db + 60) / 60) * S;
  const path = pts.map(([i, o], k) => `${k ? "L" : "M"}${(((i + 60) / 60) * S).toFixed(1)},${m(Math.min(0, o)).toFixed(1)}`).join("");
  return (
    <svg className={`au-graph comp ${s.comp.on ? "" : "bypassed"}`} viewBox={`0 0 ${S} ${S}`}>
      <line x1={0} y1={S} x2={S} y2={0} className="grid" />
      <line x1={((s.comp.threshold + 60) / 60) * S} x2={((s.comp.threshold + 60) / 60) * S} y1={0} y2={S} className="grid zero" />
      <path d={path} className="curve" />
    </svg>
  );
}

// ─────────────────────────────────────────────── Devices

function Devices({ feedback }: { feedback: MixerFeedback[] }) {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const refresh = () => api.audioDevices().then(setDevices).catch((e) => pushLog("warn", String(e)));
  useEffect(() => void refresh(), []);
  return (
    <div className="au-devices">
      <section className="card">
        <header>
          <h3>Audio interfaces</h3>
          <button onClick={refresh}>Refresh</button>
        </header>
        <table>
          <thead>
            <tr>
              <th>Device</th><th>Host</th><th>In</th><th>Out</th><th>Rate</th><th>Mixer</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d, i) => (
              <tr key={i}>
                <td>
                  {d.name} {d.is_default_output && <span className="tag">default out</span>} {d.is_default_input && <span className="tag">default in</span>}
                </td>
                <td>{d.host}</td>
                <td>{d.input_channels}</td>
                <td>{d.output_channels}</td>
                <td>{d.sample_rate ? `${d.sample_rate / 1000}k` : ""}</td>
                <td>{d.matches_mixer ?? ""}</td>
              </tr>
            ))}
            {devices.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No audio interfaces found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h3>Desk feedback</h3>
        <ul className="list compact mono">
          {feedback.map((f, i) => (
            <li key={i}>
              {f.address} {f.value ?? ""}
            </li>
          ))}
          {feedback.length === 0 && <li className="muted">Nothing yet (X32 / X Air send changes here after connecting)</li>}
        </ul>
      </section>
    </div>
  );
}
