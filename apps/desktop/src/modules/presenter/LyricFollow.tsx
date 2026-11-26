// Lyric Follow: controls, status, and the live-slide word tracker.
import { useEffect, useState, useSyncExternalStore } from "react";
import { api, on } from "../../shared/bridge";
import { pushLog, updateShow, useEngine } from "../../shared/store";
import type { AudioDevice, FollowMode, FollowSettings, FollowStatus, ModelProgress, SpeechModel } from "../../shared/types";

// ── shared status (one subscription per window)
let status: FollowStatus | null = null;
const subs = new Set<() => void>();
let started = false;
function startStatus() {
  if (started) return;
  started = true;
  const set = (s: FollowStatus) => {
    status = s;
    subs.forEach((f) => f());
  };
  api.followStatus().then(set).catch(() => {});
  on("follow-status", set);
}
export function useFollowStatus(): FollowStatus | null {
  useEffect(startStatus, []);
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => status,
  );
}

/** Assist mode: Enter takes the suggested next slide. Used by the Presenter so it works whichever tab is open. */
export function useFollowEnter() {
  useEffect(startStatus, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.key === "Enter" && status?.running && status.mode === "assist" && status.next) {
        e.preventDefault();
        void api.followTake().catch((x) => pushLog("warn", String(x)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Same word rule as the engine: a token counts if it has a letter or digit. */
const isWord = (t: string) => /[\p{L}\p{N}]/u.test(t);
export function triggerIndex(count: number, early: number): number | null {
  return count === 0 ? null : Math.max(0, count - 1 - early);
}

/** Live slide text with sung words, the next word, and the advance point marked. */
export function FollowLyrics({
  text,
  sung,
  trigger,
  dimAll,
}: {
  text: string;
  sung: number | null;
  trigger: number | null;
  dimAll?: boolean;
}) {
  let n = -1;
  return (
    <div className="follow-lyrics">
      {text.split("\n").map((line, li) => (
        <div key={li}>
          {line.split(/\s+/).filter(Boolean).map((tok, ti) => {
            if (!isWord(tok)) return <span key={ti}>{tok} </span>;
            n += 1;
            const cls = [
              !dimAll && sung != null && n <= sung ? "sung" : "",
              !dimAll && sung != null && n === sung + 1 ? "next" : "",
              n === trigger ? "trigger" : "",
            ].join(" ");
            return (
              <span key={ti} className={cls} title={n === trigger ? "Advances when this word is heard" : undefined}>
                {tok}{" "}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const MODES: { id: FollowMode; label: string; hint: string }[] = [
  { id: "off", label: "Off", hint: "Not listening" },
  { id: "assist", label: "Assist", hint: "Lights up Next — you press it (Enter)" },
  { id: "auto", label: "Auto", hint: "Advances on its own. Any manual change pauses it briefly" },
];

export default function LyricFollowPanel() {
  const { show, live } = useEngine();
  const st = useFollowStatus();
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [models, setModels] = useState<SpeechModel[]>([]);
  const [progress, setProgress] = useState<ModelProgress | null>(null);
  const [device, setDevice] = useState("");
  const [channel, setChannel] = useState(0);
  const [model, setModel] = useState("");
  const [gate, setGate] = useState(-45);
  const [advanced, setAdvanced] = useState(false);

  const refresh = () => {
    api.audioDevices().then((d) => setDevices(d.filter((x) => x.input_channels > 0))).catch(() => {});
    api.followModels().then(setModels).catch(() => {});
  };
  useEffect(() => {
    refresh();
    return on("follow-model-progress", setProgress);
  }, []);
  // Restore this computer's last choice once.
  useEffect(() => {
    if (st?.input && !device) {
      setDevice(st.input.device);
      setChannel(st.input.channel);
      setModel(st.input.model);
      setGate(st.input.gate_db);
    }
  }, [st?.input]);
  useEffect(() => {
    if (!model) {
      const m = models.find((x) => x.downloaded && x.name === "base.en") ?? models.find((x) => x.downloaded);
      if (m) setModel(m.path);
    }
  }, [models]);

  if (!show) return null;
  const fs = show.lyric_follow;
  const setFs = (patch: Partial<FollowSettings>) =>
    updateShow((d) => {
      d.lyric_follow = { ...d.lyric_follow, ...patch };
    });

  const dev = devices.find((d) => d.name === device);
  const start = async () => {
    try {
      await api.followStart({ device, channel, model, gate_db: gate });
    } catch (e) {
      pushLog("warn", String(e));
    }
  };
  const setMode = async (m: FollowMode) => {
    await setFs({ mode: m });
    if (m === "off") await api.followStop().catch(() => {});
    else if (!st?.running) await start();
  };
  const canStart = Boolean(device && model);

  const liveText = live?.text ?? "";
  const wordCount = liveText.split(/\s+/).filter(isWord).length;
  const trig = triggerIndex(wordCount, fs.words_early);
  const sungHere = st?.live && live && st.live[0] === live.presentation && st.live[1] === live.slide ? st.sung_word : null;
  const meter = Math.max(0, Math.min(100, ((st?.level_db ?? -90) + 70) * (100 / 60)));
  const gatePos = ((gate + 70) * 100) / 60;

  return (
    <div className="card follow">
      <header>
        <h3>Lyric Follow</h3>
        <span className={`pill ${st?.running ? "live" : ""}`}>{st?.running ? "Listening" : "Stopped"}</span>
      </header>

      <div className="seg">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={fs.mode === m.id ? "on" : ""}
            title={m.hint}
            disabled={m.id !== "off" && !canStart && !st?.running}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <small className="muted">{MODES.find((m) => m.id === fs.mode)?.hint}</small>

      <label>Advance timing</label>
      <div className="row">
        <input
          type="range"
          className="grow"
          min={0}
          max={10}
          value={fs.words_early}
          onChange={(e) => setFs({ words_early: Number(e.target.value) })}
        />
        <strong className="early">{fs.words_early === 0 ? "On last word" : `${fs.words_early} word${fs.words_early > 1 ? "s" : ""} early`}</strong>
      </div>
      <small className="muted">
        The highlighted word is where it changes. Speech recognition runs about {st?.latency_ms ? (st.latency_ms / 1000).toFixed(1) : "1"} s
        behind the singer — if slides change late, add a word or two.
      </small>

      <div className="follow-live">
        {liveText ? (
          <FollowLyrics text={liveText} sung={sungHere ?? null} trigger={trig} dimAll={st?.in_previous} />
        ) : (
          <span className="muted">Put a slide live to see where it will advance.</span>
        )}
      </div>

      {st?.running && (
        <div className="follow-state">
          <div className="meter" title={`${st.level_db.toFixed(0)} dBFS`}>
            <div className={`fill ${st.voice ? "voice" : ""}`} style={{ width: `${meter}%` }} />
            <div className="gate" style={{ left: `${gatePos}%` }} />
          </div>
          <div className="row">
            <small className="grow">{st.voice ? "Hearing voice" : "Quiet (below gate) — waiting"}</small>
            <small>Match {(st.confidence * 100).toFixed(0)}%</small>
          </div>
          <div className="heard mono">{st.heard || "…"}</div>
          {st.in_previous && <small className="muted">Finishing the previous slide…</small>}
          {st.blocked && <small className="warn">Holding: {st.blocked}</small>}
          {fs.mode === "assist" && st.next && (
            <button className={`primary take ${st.ready ? "ready" : ""}`} onClick={() => api.followTake()}>
              Next ▶ {st.ready ? "(now)" : ""} — Enter
            </button>
          )}
          {st.error && <div className="warn">⚠ {st.error}</div>}
        </div>
      )}

      <label>Listen to</label>
      <div className="row">
        <select className="grow" value={device} onChange={(e) => { setDevice(e.target.value); setChannel(0); }}>
          <option value="">Choose input…</option>
          {devices.map((d) => (
            <option key={`${d.host}-${d.name}`} value={d.name}>
              {d.name} ({d.input_channels} in){d.matches_mixer ? ` · ${d.matches_mixer}` : ""}
            </option>
          ))}
        </select>
        <button className="icon" title="Refresh" onClick={refresh}>↻</button>
      </div>
      {dev && dev.input_channels > 1 && (
        <div className="row">
          <label className="inline">
            Channel
            <select value={channel} onChange={(e) => setChannel(Number(e.target.value))}>
              {Array.from({ length: dev.input_channels }, (_, i) => (
                <option key={i} value={i}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          <small className="muted">Pick the lead vocal channel from the desk's USB feed for best results.</small>
        </div>
      )}
      <label>Voice gate {gate} dB</label>
      <input
        type="range"
        min={-70}
        max={-10}
        value={gate}
        onChange={(e) => {
          const v = Number(e.target.value);
          setGate(v);
          void api.followSetGate(v).catch(() => {});
        }}
      />
      <small className="muted">Set it just above the level during instrumentals, so it only listens when someone sings.</small>

      <label>Speech model</label>
      {models.map((m) => (
        <div key={m.name} className="row">
          <label className="inline grow">
            <input type="radio" disabled={!m.downloaded} checked={model === m.path} onChange={() => setModel(m.path)} />
            {m.name} <small className="muted">{m.size_mb} MB · {m.note}</small>
          </label>
          {!m.downloaded && (
            <button
              disabled={progress != null && progress.downloaded < (progress.total ?? Infinity)}
              onClick={async () => {
                try {
                  const path = await api.followDownloadModel(m.name);
                  setModel(path);
                  refresh();
                } catch (e) {
                  pushLog("warn", String(e));
                }
              }}
            >
              {progress?.name === m.name && progress.total && progress.downloaded < progress.total
                ? `${Math.round((progress.downloaded / progress.total) * 100)}%`
                : "Download"}
            </button>
          )}
        </div>
      ))}

      <div className="row">
        {st?.running ? (
          <button onClick={() => api.followStop()}>Stop listening</button>
        ) : (
          <button className="primary" disabled={!canStart} onClick={start}>
            Start listening
          </button>
        )}
        {st?.running && <button onClick={start} title="Apply a new input or model">Restart</button>}
      </div>

      <button className="link" onClick={() => setAdvanced(!advanced)}>
        {advanced ? "Hide" : "More"} settings
      </button>
      {advanced && (
        <div className="stack">
          <label>Match needed {(fs.min_confidence * 100).toFixed(0)}% (higher = fewer wrong advances, may miss some)</label>
          <input type="range" min={0.3} max={0.95} step={0.05} value={fs.min_confidence} onChange={(e) => setFs({ min_confidence: Number(e.target.value) })} />
          <label>Minimum time on a slide {(fs.min_slide_ms / 1000).toFixed(1)} s</label>
          <input type="range" min={0} max={8000} step={250} value={fs.min_slide_ms} onChange={(e) => setFs({ min_slide_ms: Number(e.target.value) })} />
          <label>Pause after a manual change {(fs.manual_hold_ms / 1000).toFixed(1)} s</label>
          <input type="range" min={0} max={15000} step={500} value={fs.manual_hold_ms} onChange={(e) => setFs({ manual_hold_ms: Number(e.target.value) })} />
          <label className="inline">
            <input type="checkbox" checked={fs.bias_prompt} onChange={(e) => setFs({ bias_prompt: e.target.checked })} />
            Hint upcoming lyrics to the speech engine (more accurate)
          </label>
        </div>
      )}
    </div>
  );
}
