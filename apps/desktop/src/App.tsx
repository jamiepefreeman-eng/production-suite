import { useEffect, useState } from "react";
import { api, inTauri, showFiles, type ModuleId } from "./shared/bridge";
import { pushLog, send, useEngine } from "./shared/store";
import { MODULES } from "./modules/registry";
import AudioLayer from "./shared/AudioLayer";
import { listenForRemoteToggle } from "./shared/bgmatch";

export default function App() {
  const [active, setActive] = useState<ModuleId>("presenter");
  const eng = useEngine();

  // MIDI / show-page "match background" (the sampler runs in this window).
  useEffect(listenForRemoteToggle, []);

  // Cmd/Ctrl+1–4 switch modules; Esc = clear slide.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      const hit = (Object.keys(MODULES) as ModuleId[]).find((k) => MODULES[k].key === e.key);
      if (hit && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setActive(hit);
      }
      if (e.key === "Escape") void send({ type: "clear_slide" });
      // ProPresenter's clear keys.
      if (e.key === "F1") void send({ type: "clear_all" });
      if (e.key === "F2") void send({ type: "clear_slide" });
      if (e.key === "F3") void send({ type: "set_media", media: null });
      if (e.key === "F5") void send({ type: "play_audio", audio: null, looped: false });
      if (e.key.startsWith("F") && ["F1", "F2", "F3", "F5"].includes(e.key)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openFile = async () => {
    const path = await showFiles.open();
    if (path)
      await api
        .openShow(path)
        .then(() => pushLog("info", `Opened ${path}`))
        .catch((e) => pushLog("warn", String(e)));
  };
  const saveFile = async () => {
    const path = await showFiles.save(`${eng.show?.name ?? "show"}.show.json`);
    if (path) await api.saveShow(path).then((p) => pushLog("info", `Saved ${p}`)).catch((e) => pushLog("warn", String(e)));
  };

  const Active = MODULES[active].component;
  const cueName = eng.show?.cues.find((c) => c.id === eng.activeCue)?.name;
  // Status line messages fade after 15 s so an old error doesn't look current.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const lastLog = eng.log[0] && now - eng.log[0].t < 15000 ? eng.log[0] : undefined;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <img className="logo" src="/brand/mark.png" alt="Freeman Creative" title="Production Suite · Freeman Creative" draggable={false} />
          <span className="show-name" title="Show">{eng.show?.name ?? "—"}</span>
        </div>

        <nav className="module-tabs">
          {(Object.keys(MODULES) as ModuleId[]).map((id) => (
            <div key={id} className={`module-tab ${id === active ? "on" : ""}`} data-module={id}>
              <button className="tab-main" onClick={() => setActive(id)} title={`${MODULES[id].label} (⌘/Ctrl+${MODULES[id].key})`}>
                <span className="tab-icon">{MODULES[id].icon}</span>
                {MODULES[id].label}
              </button>
              <button className="tab-pop" title="Open in its own window" onClick={() => api.openModule(id)}>
                ⧉
              </button>
            </div>
          ))}
        </nav>

        <div className="topbar-status">
          <AudioLayer />
          <span className={`pill ${eng.live ? "live" : ""}`}>{eng.live ? `● ${eng.live.title} · ${eng.live.label}` : "No slide"}</span>
          <span className={`pill ${cueName ? "cue" : ""}`}>{cueName ? `Cue ${eng.activeCue} · ${cueName}` : "No cue"}</span>
        </div>

        <div className="topbar-actions">
          <div className="seg">
            <button onClick={openFile} title="Open show">Open</button>
            <button onClick={saveFile} title="Save show">Save</button>
            <button onClick={() => api.newDemoShow()} title="Load the demo show">Demo</button>
          </div>
          <button className={eng.blackout ? "danger on" : "danger"} onClick={() => send({ type: "blackout", on: !eng.blackout })}>
            {eng.blackout ? "BLACKOUT" : "Blackout"}
          </button>
          <button className="clear" onClick={() => send({ type: "clear_all" })} title="Clear slide, media, audio and timer (F1). Esc / F2 clears just the slide.">
            Clear All
          </button>
        </div>
      </header>

      <main className={`module module-${active}`}>
        {!inTauri && (
          <div className="banner warn">
            Running in a plain browser. Start the desktop app with <code>npm run tauri dev</code> to connect to the engine.
          </div>
        )}
        {eng.error && <div className="banner warn">{eng.error}</div>}
        {eng.show ? (
          <Active />
        ) : (
          <div className="splash">
            <img src="/brand/freeman-creative.png" alt="Freeman Creative — Finding wonder · Revealing Jesus" draggable={false} />
            <span className="muted">Production Suite · loading the show…</span>
          </div>
        )}
      </main>

      <footer className="statusline">
        <span className={lastLog?.level === "warn" ? "warn" : "muted"}>{lastLog?.message ?? "Ready"}</span>
      </footer>
    </div>
  );
}
