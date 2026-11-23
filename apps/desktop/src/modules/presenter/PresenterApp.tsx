import { useEffect, useMemo, useState } from "react";
import { api } from "../../shared/bridge";
import { pushLog, send, updateShow, useEngine } from "../../shared/store";
import type { MonitorInfo, Presentation, Slide, SlideTrigger } from "../../shared/types";
import { SlideRender } from "./OutputView";

export default function PresenterApp() {
  const { show, live } = useEngine();
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);

  useEffect(() => {
    api.monitors().then(setMonitors).catch(() => {});
  }, []);

  const ordered = useMemo(() => {
    if (!show) return [];
    const inList = show.playlist.map((id) => show.presentations.find((p) => p.id === id)).filter(Boolean) as Presentation[];
    const rest = show.presentations.filter((p) => !show.playlist.includes(p.id));
    return [...inList, ...rest];
  }, [show]);

  const current = ordered.find((p) => p.id === (selected ?? live?.presentation ?? ordered[0]?.id));

  // Arrow keys / space step through slides, across presentations.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (!["ArrowRight", "ArrowLeft", " ", "PageDown", "PageUp"].includes(e.key)) return;
      e.preventDefault();
      const flat = ordered.flatMap((p) => p.slides.map((s) => [p.id, s.id] as const));
      const i = live ? flat.findIndex(([p, s]) => p === live.presentation && s === live.slide) : -1;
      const step = e.key === "ArrowLeft" || e.key === "PageUp" ? -1 : 1;
      const next = flat[Math.max(0, Math.min(flat.length - 1, i + step))];
      if (next) {
        setSelected(next[0]);
        void send({ type: "go_slide", presentation: next[0], slide: next[1] });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ordered, live]);

  if (!show) return <div className="empty">Loading show…</div>;

  const editSlide = current?.slides.find((s) => s.id === editing) ?? null;

  return (
    <div className="presenter">
      <aside className="panel">
        <header>
          <h3>Service</h3>
          <button onClick={() => setImporting(true)}>+ Song</button>
        </header>
        <ul className="list">
          {ordered.map((p) => (
            <li
              key={p.id}
              className={`${p.id === current?.id ? "sel" : ""} ${p.id === live?.presentation ? "live" : ""}`}
              onClick={() => setSelected(p.id)}
            >
              <span className={`tag ${p.kind}`}>{p.kind}</span> {p.title}
              <small>{p.slides.length} slides</small>
            </li>
          ))}
        </ul>
      </aside>

      <section className="slides">
        {current ? (
          <>
            <header>
              <h2>{current.title}</h2>
              {current.ccli && <small>CCLI #{current.ccli}</small>}
            </header>
            <div className="slide-grid">
              {current.slides.map((s) => (
                <SlideCard
                  key={s.id}
                  slide={s}
                  live={live?.presentation === current.id && live.slide === s.id}
                  onGo={() => send({ type: "go_slide", presentation: current.id, slide: s.id })}
                  onEdit={() => setEditing(s.id)}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="empty">Add a song or pick a presentation</div>
        )}
      </section>

      <aside className="panel right">
        <h3>Live</h3>
        <div className="preview">
          <SlideRender text={live?.text ?? ""} kind="audience" />
        </div>
        <h3>Outputs</h3>
        <OutputButtons monitors={monitors} />
        {editSlide && current && (
          <TriggerEditor
            presentation={current}
            slide={editSlide}
            cues={show.cues.map((c) => ({ id: c.id, name: c.name }))}
            onClose={() => setEditing(null)}
          />
        )}
      </aside>

      {importing && <ImportSong onClose={() => setImporting(false)} onAdded={(id) => setSelected(id)} />}
    </div>
  );
}

function triggerLabel(t: SlideTrigger): string {
  switch (t.type) {
    case "lighting_cue":
      return `💡 Cue ${t.cue}`;
    case "lighting_text":
      return `💡 “${t.text}”`;
    case "blackout":
      return "💡 Blackout";
    case "mixer":
      return t.command.type === "recall_scene" ? `🎚 Scene ${t.command.scene}` : `🎚 ${t.command.type}`;
  }
}

function SlideCard({ slide, live, onGo, onEdit }: { slide: Slide; live: boolean; onGo: () => void; onEdit: () => void }) {
  return (
    <div className={`slide-card ${live ? "live" : ""}`} onClick={onGo}>
      <div className="slide-label">
        {slide.label}
        <button
          className="icon"
          title="Triggers"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          ⚙
        </button>
      </div>
      <div className="slide-thumb">
        <SlideRender text={slide.text} kind="audience" />
      </div>
      <div className="badges">
        {slide.triggers.map((t, i) => (
          <span key={i} className="badge">
            {triggerLabel(t)}
          </span>
        ))}
      </div>
    </div>
  );
}

function OutputButtons({ monitors }: { monitors: MonitorInfo[] }) {
  const [screen, setScreen] = useState<string>("window");
  const mon = screen === "window" ? undefined : Number(screen);
  return (
    <div className="stack">
      <select value={screen} onChange={(e) => setScreen(e.target.value)}>
        <option value="window">In a window</option>
        {monitors.map((m) => (
          <option key={m.index} value={m.index}>
            Screen {m.index + 1}: {m.name ?? ""} {m.width}×{m.height}
          </option>
        ))}
      </select>
      <div className="row">
        <button onClick={() => api.openOutput("audience", mon)}>Audience</button>
        <button onClick={() => api.openOutput("stage", mon)}>Stage display</button>
        <button onClick={() => api.openOutput("stream", mon)}>Stream lower-third</button>
      </div>
      <small>Click again to close an output.</small>
    </div>
  );
}

function TriggerEditor({
  presentation,
  slide,
  cues,
  onClose,
}: {
  presentation: Presentation;
  slide: Slide;
  cues: { id: number; name: string }[];
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [scene, setScene] = useState(1);
  const mutate = (fn: (triggers: SlideTrigger[]) => SlideTrigger[]) =>
    updateShow((d) => {
      const s = d.presentations.find((p) => p.id === presentation.id)?.slides.find((x) => x.id === slide.id);
      if (s) s.triggers = fn(s.triggers);
    });

  return (
    <div className="card">
      <header>
        <h3>When “{slide.label}” goes live</h3>
        <button className="icon" onClick={onClose}>
          ✕
        </button>
      </header>
      <ul className="list compact">
        {slide.triggers.map((t, i) => (
          <li key={i}>
            {triggerLabel(t)}
            <button className="icon" onClick={() => mutate((ts) => ts.filter((_, j) => j !== i))}>
              ✕
            </button>
          </li>
        ))}
        {slide.triggers.length === 0 && <li className="muted">Nothing yet</li>}
      </ul>
      <label>Lighting cue</label>
      <select
        value=""
        onChange={(e) => e.target.value && mutate((ts) => [...ts, { type: "lighting_cue", cue: Number(e.target.value) }])}
      >
        <option value="">Add cue…</option>
        {cues.map((c) => (
          <option key={c.id} value={c.id}>
            {c.id}. {c.name}
          </option>
        ))}
      </select>
      <label>Lighting by sentence</label>
      <div className="row">
        <input value={text} placeholder="back wall blue at 40" onChange={(e) => setText(e.target.value)} />
        <button
          disabled={!text.trim()}
          onClick={() => {
            mutate((ts) => [...ts, { type: "lighting_text", text }]);
            setText("");
          }}
        >
          Add
        </button>
      </div>
      <label>Mixer scene</label>
      <div className="row">
        <input type="number" min={1} value={scene} onChange={(e) => setScene(Number(e.target.value))} />
        <button onClick={() => mutate((ts) => [...ts, { type: "mixer", command: { type: "recall_scene", scene } }])}>Add</button>
      </div>
      <button onClick={() => mutate((ts) => [...ts, { type: "blackout" }])}>Add blackout</button>
    </div>
  );
}

function ImportSong({ onClose, onAdded }: { onClose: () => void; onAdded: (id: number) => void }) {
  const [title, setTitle] = useState("");
  const [ccli, setCcli] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [lines, setLines] = useState(4);

  const add = async () => {
    try {
      const p = await api.parseLyrics(title || "Untitled", lyrics, lines);
      p.ccli = ccli || null;
      await updateShow((d) => {
        d.presentations.push(p);
        d.playlist.push(p.id);
      });
      onAdded(p.id);
      onClose();
    } catch (e) {
      pushLog("warn", String(e));
    }
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Add song</h3>
        <div className="row">
          <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input placeholder="CCLI #" value={ccli} onChange={(e) => setCcli(e.target.value)} />
          <label className="inline">
            Lines/slide
            <input type="number" min={1} max={8} value={lines} onChange={(e) => setLines(Number(e.target.value))} />
          </label>
        </div>
        <textarea
          rows={16}
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          placeholder={"[Verse 1]\nFirst line\nSecond line\n\n[Chorus]\n…"}
        />
        <small>Section headers like [Verse 1] or “Chorus:” start a new section; a blank line starts a new slide.</small>
        <div className="row end">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={add} disabled={!lyrics.trim()}>
            Add to service
          </button>
        </div>
      </div>
    </div>
  );
}
