import { useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { api, inTauri, type ModuleId } from "./shared/bridge";
import { pushLog, send, useEngine } from "./shared/store";
import { MODULES } from "./modules/registry";

export default function App() {
  const [active, setActive] = useState<ModuleId>("presenter");
  const eng = useEngine();

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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openFile = async () => {
    // Extensions must not contain a dot: macOS rejects "show.json" and then greys out every file.
    const path = await open({ filters: [{ name: "Show", extensions: ["json"] }] });
    if (typeof path === "string") await api.openShow(path).catch((e) => pushLog("warn", String(e)));
  };
  const saveFile = async () => {
    const path = await save({
      defaultPath: `${eng.show?.name ?? "show"}.show.json`,
      filters: [{ name: "Show", extensions: ["json"] }],
    });
    if (path) await api.saveShow(path).then((p) => pushLog("info", `Saved ${p}`)).catch((e) => pushLog("warn", String(e)));
  };

  const Active = MODULES[active].component;
  const cueName = eng.show?.cues.find((c) => c.id === eng.activeCue)?.name;

  return (
    <div className="shell">
      <nav className="rail">
        <div className="brand">PS</div>
        {(Object.keys(MODULES) as ModuleId[]).map((id) => (
          <div key={id} className="rail-item">
            <button className={id === active ? "on" : ""} onClick={() => setActive(id)} title={`⌘/Ctrl+${MODULES[id].key}`}>
              {MODULES[id].label}
            </button>
            <button className="popout" title="Open in its own window" onClick={() => api.openModule(id)}>
              ⧉
            </button>
          </div>
        ))}
        <div className="rail-spacer" />
        <button onClick={openFile}>Open…</button>
        <button onClick={saveFile}>Save…</button>
        <button onClick={() => api.newDemoShow()}>Demo show</button>
      </nav>

      <main className="module">
        {!inTauri && (
          <div className="banner warn">
            Running in a plain browser. Start the desktop app with <code>npm run tauri dev</code> to connect to the engine.
          </div>
        )}
        {eng.error && <div className="banner warn">{eng.error}</div>}
        <Active />
      </main>

      <footer className="status">
        <span className={`pill ${eng.live ? "live" : ""}`}>
          {eng.live ? `LIVE · ${eng.live.title} · ${eng.live.label}` : "No slide live"}
        </span>
        <span className="pill">{cueName ? `Cue ${eng.activeCue} · ${cueName}` : "No cue"}</span>
        <span className="grow">{eng.log[0]?.message}</span>
        <button className={eng.blackout ? "danger on" : "danger"} onClick={() => send({ type: "blackout", on: !eng.blackout })}>
          {eng.blackout ? "Blackout ON" : "Blackout"}
        </button>
        <button onClick={() => send({ type: "clear_slide" })}>Clear slide (Esc)</button>
      </footer>
    </div>
  );
}
