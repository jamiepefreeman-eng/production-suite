import { useEffect, useState } from "react";
import { api, on } from "../../shared/bridge";
import { pushLog, send, useEngine } from "../../shared/store";
import type { AudioDevice, MixerConfig, MixerFeedback, MixerKind, MixerStatus } from "../../shared/types";

const KIND_HINT: Record<MixerKind, string> = {
  x32: "OSC over UDP 10023. Set the desk's IP in Setup > Network.",
  x_air: "OSC over UDP 10024. Use the XR18's IP (not 192.168.1.1 unless it's in AP mode).",
  sq: "MIDI over TCP 51325. MIDI channel is set in Utility > Control > MIDI.",
  avantis: "MIDI over TCP 51325 (firmware 2.0+). Uses a base MIDI channel.",
};

export default function AudioApp() {
  const { show } = useEngine();
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [status, setStatus] = useState<MixerStatus | null>(null);
  const [cfg, setCfg] = useState<MixerConfig>({ kind: "x32", ip: "192.168.1.50", midi_channel: 1 });
  const [feedback, setFeedback] = useState<MixerFeedback[]>([]);
  const [busy, setBusy] = useState(false);

  const refreshDevices = () => api.audioDevices().then(setDevices).catch((e) => pushLog("warn", String(e)));
  useEffect(() => {
    void refreshDevices();
    api.mixerStatus().then(setStatus).catch(() => {});
    return on("mixer-feedback", (fb) => setFeedback((prev) => [...fb, ...prev].slice(0, 60)));
  }, []);
  useEffect(() => {
    if (show?.mixer && !status?.connected) setCfg(show.mixer);
  }, [show?.mixer, status?.connected]);

  const connect = async () => {
    setBusy(true);
    try {
      setStatus(await api.mixerConnect(cfg));
    } catch (e) {
      pushLog("warn", String(e));
    } finally {
      setBusy(false);
    }
  };

  const channels = Math.min(status?.input_channels || 16, 32);

  return (
    <div className="audio">
      <section className="card">
        <header>
          <h3>Mixer</h3>
          <span className={`pill ${status?.connected ? "live" : ""}`}>
            {status?.connected ? `Connected · ${status.config?.ip}` : "Not connected"}
          </span>
        </header>
        <div className="row wrap">
          <select value={cfg.kind} onChange={(e) => setCfg({ ...cfg, kind: e.target.value as MixerKind })}>
            {(status?.kinds ?? [["x32", "Midas M32 / Behringer X32"], ["x_air", "Behringer X Air"], ["sq", "Allen & Heath SQ"], ["avantis", "Allen & Heath Avantis"]]).map(
              ([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ),
            )}
          </select>
          <input value={cfg.ip} onChange={(e) => setCfg({ ...cfg, ip: e.target.value })} placeholder="Desk IP" />
          {(cfg.kind === "sq" || cfg.kind === "avantis") && (
            <label className="inline">
              MIDI ch
              <input type="number" min={1} max={16} value={cfg.midi_channel} onChange={(e) => setCfg({ ...cfg, midi_channel: Number(e.target.value) })} />
            </label>
          )}
          {status?.connected ? (
            <button onClick={async () => setStatus(await api.mixerDisconnect())}>Disconnect</button>
          ) : (
            <button className="primary" disabled={busy} onClick={connect}>
              Connect
            </button>
          )}
        </div>
        <small className="muted">{KIND_HINT[cfg.kind]}</small>
      </section>

      <section className="card strips">
        <header>
          <h3>Channels</h3>
          <Scenes />
        </header>
        <div className="strip-row">
          {Array.from({ length: channels }, (_, i) => (
            <Strip key={i} ch={i + 1} />
          ))}
          <Strip main />
        </div>
        <small className="muted">
          Faders here send to the desk; the desk stays the source of truth. Slides can recall scenes (Presenter › ⚙ on a slide).
        </small>
      </section>

      <section className="card">
        <header>
          <h3>Audio devices</h3>
          <button onClick={refreshDevices}>Refresh</button>
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
          {feedback.length === 0 && <li className="muted">Nothing yet (X32/X Air stream changes after connecting)</li>}
        </ul>
      </section>
    </div>
  );
}

function Strip({ ch, main }: { ch?: number; main?: boolean }) {
  const [level, setLevel] = useState(0.75);
  const [muted, setMuted] = useState(false);
  return (
    <div className={`strip ${main ? "main" : ""}`}>
      <div className="strip-label">{main ? "Main" : ch}</div>
      <div className="vfader-wrap">
      <input
        type="range"
        className="vfader"
        min={0}
        max={1}
        step={0.005}
        value={level}
        onChange={(e) => {
          const v = Number(e.target.value);
          setLevel(v);
          void send({ type: "mixer", command: main ? { type: "main_fader", level: v } : { type: "fader", channel: ch!, level: v } });
        }}
      />
      </div>
      {!main && (
        <button
          className={muted ? "danger on" : ""}
          onClick={() => {
            setMuted(!muted);
            void send({ type: "mixer", command: { type: "mute", channel: ch!, muted: !muted } });
          }}
        >
          M
        </button>
      )}
    </div>
  );
}

function Scenes() {
  const [scene, setScene] = useState(1);
  return (
    <div className="row">
      <label className="inline">
        Scene
        <input type="number" min={1} value={scene} onChange={(e) => setScene(Number(e.target.value))} />
      </label>
      <button onClick={() => send({ type: "mixer", command: { type: "recall_scene", scene } })}>Recall</button>
    </div>
  );
}
