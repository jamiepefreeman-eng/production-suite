import { useEffect, useMemo, useState } from "react";
import { api, confirmDialog } from "../../shared/bridge";
import { pushLog, send, updateShow, useEngine } from "../../shared/store";
import type { MonitorInfo, Presentation, PresentationKind, Show, Slide, SlideTrigger } from "../../shared/types";
import { SlideRender } from "./OutputView";

// ProPresenter-style colour per section ("group"), by the label's first word.
const GROUP_COLORS: [RegExp, string][] = [
  [/^verse/i, "#3b82f6"],
  [/^pre-?chorus/i, "#14b8a6"],
  [/^chorus|^refrain/i, "#ef4444"],
  [/^bridge/i, "#a855f7"],
  [/^tag|^vamp|^turnaround/i, "#f97316"],
  [/^intro|^outro|^ending|^interlude|^instrumental/i, "#64748b"],
  [/^welcome|^announce/i, "#22c55e"],
];
export function groupColor(label: string) {
  return GROUP_COLORS.find(([re]) => re.test(label.trim()))?.[1] ?? "#6b7280";
}
const LABEL_SUGGESTIONS = ["Verse 1", "Verse 2", "Verse 3", "Pre-Chorus", "Chorus", "Bridge", "Tag", "Intro", "Outro", "Ending", "Blank"];

const readPref = (k: string, d: number) => {
  try {
    const v = Number(localStorage.getItem(k));
    return v > 0 ? v : d;
  } catch {
    return d;
  }
};
const writePref = (k: string, v: number) => {
  try {
    localStorage.setItem(k, String(v));
  } catch {
    /* storage unavailable: fine */
  }
};

export default function PresenterApp() {
  const { show, live } = useEngine();
  const [selected, setSelected] = useState<number | null>(null);
  const [actionsFor, setActionsFor] = useState<number | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [importing, setImporting] = useState(false);
  const [thumb, setThumb] = useState(() => readPref("presenter.thumb", 240));
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);

  useEffect(() => {
    api.monitors().then(setMonitors).catch(() => {});
  }, []);

  const playlist = useMemo(
    () => (show ? (show.playlist.map((id) => show.presentations.find((p) => p.id === id)).filter(Boolean) as Presentation[]) : []),
    [show],
  );
  const current = show?.presentations.find((p) => p.id === (selected ?? live?.presentation ?? playlist[0]?.id ?? show.presentations[0]?.id));

  // Arrow keys / space / clicker step through slides, across the service order.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editMode || (e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (!["ArrowRight", "ArrowLeft", " ", "PageDown", "PageUp"].includes(e.key)) return;
      e.preventDefault();
      const order = playlist.length ? playlist : current ? [current] : [];
      const flat = order.flatMap((p) => p.slides.map((s) => [p.id, s.id] as const));
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
  }, [playlist, current, live, editMode]);

  if (!show) return <div className="empty">Loading show…</div>;

  const actionSlide = current?.slides.find((s) => s.id === actionsFor) ?? null;
  const liveP = show.presentations.find((p) => p.id === live?.presentation);
  const liveIdx = liveP?.slides.findIndex((s) => s.id === live?.slide) ?? -1;
  const nextSlide = liveP && liveIdx >= 0 ? liveP.slides[liveIdx + 1] : undefined;

  return (
    <div className="presenter" style={{ ["--thumb" as string]: `${thumb}px` }}>
      <Sidebar
        show={show}
        playlist={playlist}
        current={current?.id}
        liveId={live?.presentation}
        onSelect={(id) => {
          setSelected(id);
          setActionsFor(null);
        }}
        onImport={() => setImporting(true)}
      />

      <section className="pp-center">
        {current ? (
          <>
            <div className="pp-toolbar">
              {editMode ? (
                <PresentationHeaderEditor p={current} />
              ) : (
                <div className="pp-title">
                  <span className={`tag ${current.kind}`}>{current.kind}</span>
                  <h2>{current.title}</h2>
                  {current.ccli && <small>CCLI #{current.ccli}</small>}
                </div>
              )}
              <div className="grow" />
              <label className="inline muted" title="Thumbnail size">
                ▫
                <input
                  type="range"
                  min={150}
                  max={420}
                  value={thumb}
                  onChange={(e) => {
                    setThumb(Number(e.target.value));
                    writePref("presenter.thumb", Number(e.target.value));
                  }}
                />
                ▣
              </label>
              <div className="seg">
                <button className={!editMode ? "on" : ""} onClick={() => setEditMode(false)}>
                  Show
                </button>
                <button className={editMode ? "on" : ""} onClick={() => setEditMode(true)}>
                  Edit
                </button>
              </div>
            </div>

            <div className="pp-grid">
              {current.slides.map((s, i) =>
                editMode ? (
                  <SlideEditCard key={s.id} p={current} slide={s} index={i} />
                ) : (
                  <SlideCard
                    key={s.id}
                    slide={s}
                    index={i}
                    live={live?.presentation === current.id && live.slide === s.id}
                    focused={actionsFor === s.id}
                    onGo={() => send({ type: "go_slide", presentation: current.id, slide: s.id })}
                    onActions={() => setActionsFor(actionsFor === s.id ? null : s.id)}
                  />
                ),
              )}
              {editMode && (
                <button className="pp-add-slide" onClick={() => addSlide(current.id)}>
                  + Add slide
                </button>
              )}
              {!editMode && current.slides.length === 0 && (
                <div className="empty">
                  No slides yet. Switch to <b>Edit</b> to add some.
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="empty">Add a song with “+ Song”, or pick something from the Library.</div>
        )}
      </section>

      <aside className="pp-right">
        <div className="pp-preview-label">
          <span className="live-dot" /> Live
        </div>
        <div className="pp-preview">
          <SlideRender text={live?.text ?? ""} kind="audience" />
        </div>
        <div className="pp-next">
          <div className="pp-preview-label muted">Next {nextSlide ? `· ${nextSlide.label}` : ""}</div>
          <div className="pp-preview small">
            <SlideRender text={nextSlide?.text ?? ""} kind="audience" />
          </div>
        </div>
        <div className="pp-clear">
          <button onClick={() => send({ type: "clear_slide" })}>Clear slide</button>
          <button
            onClick={() => {
              void send({ type: "clear_slide" });
              void send({ type: "release_cue" });
            }}
          >
            Clear all
          </button>
        </div>

        {actionSlide && current ? (
          <TriggerEditor
            presentation={current}
            slide={actionSlide}
            cues={show.cues.map((c) => ({ id: c.id, name: c.name }))}
            onClose={() => setActionsFor(null)}
          />
        ) : (
          <OutputButtons monitors={monitors} />
        )}
      </aside>

      {importing && (
        <ImportSong
          onClose={() => setImporting(false)}
          onAdded={(id) => {
            setSelected(id);
            setEditMode(false);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────── Library + service playlist

function Sidebar({
  show,
  playlist,
  current,
  liveId,
  onSelect,
  onImport,
}: {
  show: Show;
  playlist: Presentation[];
  current?: number;
  liveId?: number;
  onSelect: (id: number) => void;
  onImport: () => void;
}) {
  const [q, setQ] = useState("");
  const [drag, setDrag] = useState<number | null>(null);
  const lib = show.presentations
    .filter((p) => p.title.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.title.localeCompare(b.title));

  const move = (from: number, to: number) =>
    updateShow((d) => {
      const [x] = d.playlist.splice(from, 1);
      d.playlist.splice(to, 0, x);
    });

  const newPresentation = (kind: PresentationKind) => {
    const id = Math.max(0, ...show.presentations.map((p) => p.id)) + 1;
    const title = kind === "scripture" ? "New scripture" : "New announcement";
    void updateShow((d) => {
      d.presentations.push({ id, title, kind, ccli: null, theme: "Default", slides: [{ id: 1, label: kind === "scripture" ? "Reading" : "Welcome", text: "", triggers: [] }] });
      d.playlist.push(id);
    }).then(() => onSelect(id));
  };

  return (
    <aside className="pp-sidebar">
      <div className="pp-section">
        <header>
          <h3>Service</h3>
          <small>{playlist.length} items</small>
        </header>
        <ol className="pp-list">
          {playlist.map((p, i) => (
            <li
              key={`${p.id}-${i}`}
              draggable
              onDragStart={() => setDrag(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (drag !== null && drag !== i) void move(drag, i);
                setDrag(null);
              }}
              className={`${p.id === current ? "sel" : ""} ${p.id === liveId ? "live" : ""}`}
              onClick={() => onSelect(p.id)}
            >
              <span className="grip" title="Drag to reorder">⋮⋮</span>
              <span className={`kind-dot ${p.kind}`} />
              <span className="grow ellipsis">{p.title}</span>
              <button
                className="icon"
                title="Remove from service (stays in the Library)"
                onClick={(e) => {
                  e.stopPropagation();
                  void updateShow((d) => void d.playlist.splice(i, 1));
                }}
              >
                −
              </button>
            </li>
          ))}
          {playlist.length === 0 && <li className="muted hint">Add items from the Library below with +</li>}
        </ol>
      </div>

      <div className="pp-section grow">
        <header>
          <h3>Library</h3>
          <div className="seg small">
            <button onClick={onImport} title="Paste lyrics">+ Song</button>
            <button onClick={() => newPresentation("announcement")} title="Blank presentation">+ Slides</button>
            <button onClick={() => newPresentation("scripture")} title="Scripture reading">+ Scripture</button>
          </div>
        </header>
        <input className="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="pp-list">
          {lib.map((p) => (
            <li key={p.id} className={p.id === current ? "sel" : ""} onClick={() => onSelect(p.id)}>
              <span className={`kind-dot ${p.kind}`} />
              <span className="grow ellipsis">{p.title}</span>
              <small>{p.slides.length}</small>
              <button
                className="icon"
                title="Add to service"
                onClick={(e) => {
                  e.stopPropagation();
                  void updateShow((d) => void d.playlist.push(p.id));
                }}
              >
                +
              </button>
              <button
                className="icon"
                title="Delete from library"
                onClick={(e) => {
                  e.stopPropagation();
                  void confirmDialog(`Delete “${p.title}” from the library?`).then(
(yes) => {
                    if (yes)
                      void updateShow((d) => {
                        d.presentations = d.presentations.filter((x) => x.id !== p.id);
                        d.playlist = d.playlist.filter((x) => x !== p.id);
                      });
                  });
                }}
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────── Slides

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

function SlideCard({
  slide,
  index,
  live,
  focused,
  onGo,
  onActions,
}: {
  slide: Slide;
  index: number;
  live: boolean;
  focused: boolean;
  onGo: () => void;
  onActions: () => void;
}) {
  return (
    <div
      className={`pp-slide ${live ? "live" : ""} ${focused ? "focused" : ""}`}
      onClick={onGo}
      onContextMenu={(e) => {
        e.preventDefault();
        onActions();
      }}
    >
      <div className="pp-thumb">
        <SlideRender text={slide.text} kind="audience" />
        {slide.triggers.length > 0 && (
          <div className="pp-badges">
            {slide.triggers.map((t, i) => (
              <span key={i} className="badge">
                {triggerLabel(t)}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="pp-label" style={{ background: groupColor(slide.label) }}>
        <span className="num">{index + 1}</span>
        <span className="grow ellipsis">{slide.label}</span>
        <button
          className="icon light"
          title="Slide actions (lights, mixer) — or right-click"
          onClick={(e) => {
            e.stopPropagation();
            onActions();
          }}
        >
          ⚙
        </button>
      </div>
    </div>
  );
}

const editSlides = (pid: number, fn: (slides: Slide[]) => Slide[]) =>
  updateShow((d) => {
    const p = d.presentations.find((x) => x.id === pid);
    if (p) p.slides = fn(p.slides);
  });

function nextSlideId(slides: Slide[]) {
  return Math.max(0, ...slides.map((s) => s.id)) + 1;
}

function addSlide(pid: number) {
  return editSlides(pid, (ss) => [...ss, { id: nextSlideId(ss), label: ss[ss.length - 1]?.label ?? "Verse 1", text: "", triggers: [] }]);
}

function SlideEditCard({ p, slide, index }: { p: Presentation; slide: Slide; index: number }) {
  const set = (patch: Partial<Slide>) => editSlides(p.id, (ss) => ss.map((s) => (s.id === slide.id ? { ...s, ...patch } : s)));
  const moveBy = (d: number) =>
    editSlides(p.id, (ss) => {
      const out = [...ss];
      const j = index + d;
      if (j < 0 || j >= out.length) return out;
      [out[index], out[j]] = [out[j], out[index]];
      return out;
    });
  return (
    <div className="pp-slide editing">
      <div className="pp-label" style={{ background: groupColor(slide.label) }}>
        <span className="num">{index + 1}</span>
        <input className="label-input" list="slide-labels" value={slide.label} onChange={(e) => void set({ label: e.target.value })} />
        <datalist id="slide-labels">
          {LABEL_SUGGESTIONS.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
      </div>
      <textarea
        className="pp-text-edit"
        value={slide.text}
        placeholder="Slide text"
        onChange={(e) => void set({ text: e.target.value })}
      />
      <div className="pp-edit-actions">
        <button className="icon" title="Move earlier" disabled={index === 0} onClick={() => moveBy(-1)}>
          ◀
        </button>
        <button className="icon" title="Move later" disabled={index === p.slides.length - 1} onClick={() => moveBy(1)}>
          ▶
        </button>
        <button
          className="icon"
          title="Duplicate"
          onClick={() =>
            editSlides(p.id, (ss) => {
              const out = [...ss];
              out.splice(index + 1, 0, { ...slide, id: nextSlideId(ss), triggers: [] });
              return out;
            })
          }
        >
          ⧉
        </button>
        <div className="grow" />
        <button className="icon" title="Delete slide" onClick={() => editSlides(p.id, (ss) => ss.filter((s) => s.id !== slide.id))}>
          🗑
        </button>
      </div>
    </div>
  );
}

function PresentationHeaderEditor({ p }: { p: Presentation }) {
  const set = (patch: Partial<Presentation>) =>
    updateShow((d) => {
      const x = d.presentations.find((y) => y.id === p.id);
      if (x) Object.assign(x, patch);
    });
  return (
    <div className="pp-title edit">
      <select value={p.kind} onChange={(e) => void set({ kind: e.target.value as PresentationKind })}>
        {(["song", "scripture", "announcement", "media"] as PresentationKind[]).map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      <input className="title-input" value={p.title} onChange={(e) => void set({ title: e.target.value })} />
      <input placeholder="CCLI #" value={p.ccli ?? ""} onChange={(e) => void set({ ccli: e.target.value || null })} />
    </div>
  );
}

// ─────────────────────────────────────────────── Outputs

function OutputButtons({ monitors }: { monitors: MonitorInfo[] }) {
  const [screen, setScreen] = useState<string>("window");
  const mon = screen === "window" ? undefined : Number(screen);
  return (
    <div className="pp-card">
      <h3>Outputs</h3>
      <select value={screen} onChange={(e) => setScreen(e.target.value)}>
        <option value="window">In a window</option>
        {monitors.map((m) => (
          <option key={m.index} value={m.index}>
            Screen {m.index + 1}: {m.name ?? ""} {m.width}×{m.height}
          </option>
        ))}
      </select>
      <div className="pp-outputs">
        <button onClick={() => api.openOutput("audience", mon)}>
          <b>Audience</b>
          <small>main screens</small>
        </button>
        <button onClick={() => api.openOutput("stage", mon)}>
          <b>Stage</b>
          <small>confidence monitor</small>
        </button>
        <button onClick={() => api.openOutput("stream", mon)}>
          <b>Stream</b>
          <small>lower third</small>
        </button>
      </div>
      <small className="muted">Click again to close an output. Right-click a slide (or ⚙) to add lighting and mixer actions.</small>
    </div>
  );
}

// ─────────────────────────────────────────────── Slide actions

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
    <div className="pp-card">
      <header>
        <h3>When “{slide.label}” goes live</h3>
        <button className="icon" onClick={onClose}>
          ✕
        </button>
      </header>
      <ul className="list compact">
        {slide.triggers.map((t, i) => (
          <li key={i}>
            <span className="grow">{triggerLabel(t)}</span>
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
        <input className="grow" value={text} placeholder="back wall blue at 40" onChange={(e) => setText(e.target.value)} />
        <button
          disabled={!text.trim()}
          onClick={() => {
            void mutate((ts) => [...ts, { type: "lighting_text", text }]);
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

// ─────────────────────────────────────────────── Import

function ImportSong({ onClose, onAdded }: { onClose: () => void; onAdded: (id: number) => void }) {
  const [title, setTitle] = useState("");
  const [ccli, setCcli] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [lines, setLines] = useState(2);

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
          <input className="grow" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
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
        <small>
          Section headers like <code>[Verse 1]</code>, <code>Chorus:</code> or <code>Verse 2</code> start a new section; a blank line starts a new
          slide. You can change anything afterwards in <b>Edit</b>.
        </small>
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
