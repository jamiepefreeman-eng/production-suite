import { useEffect, useMemo, useRef, useState } from "react";
import { api, confirmDialog, pickMediaFiles } from "../../shared/bridge";
import { pushLog, send, updateShow, useEngine } from "../../shared/store";
import type { MediaItem, MediaKind, MonitorInfo, Presentation, PresentationKind, Show, Slide, SlideTrigger, Theme } from "../../shared/types";
import { CountdownText, DEFAULT_THEME, FONTS, MediaFill, SlideRender, mediaById, slideBackground, themeFor } from "./render";

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

type Mode = "show" | "edit" | "reflow";

export default function PresenterApp() {
  const { show, live, layers } = useEngine();
  const [focus, setFocus] = useState<number | null>(null); // presentation being looked at / edited
  const [libraryOnly, setLibraryOnly] = useState<number | null>(null); // library item outside the service
  const [actionsFor, setActionsFor] = useState<{ p: number; s: number } | null>(null);
  const [mode, setMode] = useState<Mode>("show");
  const [importing, setImporting] = useState(false);
  const [themesOpen, setThemesOpen] = useState(false);
  const [thumb, setThumb] = useState(() => readPref("presenter.thumb", 220));
  const [binHeight, setBinHeight] = useState(() => readPref("presenter.bin", 190));
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const sectionRefs = useRef(new Map<number, HTMLElement>());

  useEffect(() => {
    api.monitors().then(setMonitors).catch(() => {});
  }, []);

  const playlist = useMemo(
    () => (show ? (show.playlist.map((id) => show.presentations.find((p) => p.id === id)).filter(Boolean) as Presentation[]) : []),
    [show],
  );
  // What the middle shows: the whole service, or one library item that isn't in it.
  const viewItems = libraryOnly != null ? show?.presentations.filter((p) => p.id === libraryOnly) ?? [] : playlist;
  const current = show?.presentations.find((p) => p.id === (focus ?? live?.presentation ?? viewItems[0]?.id));

  // Arrow keys / space / clicker step through the whole service, like ProPresenter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode !== "show" || (e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (!["ArrowRight", "ArrowLeft", " ", "PageDown", "PageUp", "ArrowDown", "ArrowUp"].includes(e.key)) return;
      e.preventDefault();
      const flat = viewItems.flatMap((p) => p.slides.map((s) => [p.id, s.id] as const));
      const i = live ? flat.findIndex(([p, s]) => p === live.presentation && s === live.slide) : -1;
      const step = ["ArrowLeft", "PageUp", "ArrowUp"].includes(e.key) ? -1 : 1;
      const next = flat[Math.max(0, Math.min(flat.length - 1, i + step))];
      if (next) {
        setFocus(next[0]);
        void send({ type: "go_slide", presentation: next[0], slide: next[1] });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewItems, live, mode]);

  // Keep the live slide in view as the service advances.
  useEffect(() => {
    if (mode !== "show" || !live) return;
    document.querySelector(".pp-slide.live")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [live?.presentation, live?.slide, mode]);

  if (!show) return <div className="empty">Loading show…</div>;

  const selectItem = (id: number) => {
    setFocus(id);
    setActionsFor(null);
    if (show.playlist.includes(id)) {
      setLibraryOnly(null);
      requestAnimationFrame(() => sectionRefs.current.get(id)?.scrollIntoView({ block: "start", behavior: "smooth" }));
    } else setLibraryOnly(id);
  };

  const actionSlide =
    actionsFor && show.presentations.find((p) => p.id === actionsFor.p)?.slides.find((s) => s.id === actionsFor.s);
  const actionPres = actionsFor ? show.presentations.find((p) => p.id === actionsFor.p) : undefined;
  const liveP = show.presentations.find((p) => p.id === live?.presentation);
  const liveIdx = liveP?.slides.findIndex((s) => s.id === live?.slide) ?? -1;
  const nextSlide = liveP && liveIdx >= 0 ? liveP.slides[liveIdx + 1] : undefined;
  const liveTheme = themeFor(show, live?.presentation);

  return (
    <div className="presenter" style={{ ["--thumb" as string]: `${thumb}px`, ["--bin" as string]: `${binHeight}px` }}>
      <Sidebar
        show={show}
        playlist={playlist}
        current={current?.id}
        liveId={live?.presentation}
        libraryOnly={libraryOnly}
        onSelect={selectItem}
        onShowService={() => setLibraryOnly(null)}
        onImport={() => setImporting(true)}
      />

      <section className="pp-center">
        <div className="pp-toolbar">
          <div className="seg pp-modes">
            {(["show", "edit", "reflow"] as Mode[]).map((m) => (
              <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)} disabled={m !== "show" && !current}>
                {m === "show" ? "▶ Show" : m === "edit" ? "✎ Edit" : "¶ Reflow"}
              </button>
            ))}
          </div>
          <button onClick={() => setThemesOpen(true)} title="Fonts, colours and backgrounds">
            ◐ Themes
          </button>
          <div className="pp-toolbar-title ellipsis">
            {mode === "show"
              ? libraryOnly != null
                ? `Library · ${current?.title ?? ""}`
                : `Service · ${playlist.length} items`
              : current
                ? `${mode === "edit" ? "Editing" : "Reflow"} · ${current.title}`
                : ""}
          </div>
          <label className="inline muted" title="Slide size">
            ▫
            <input
              type="range"
              min={140}
              max={420}
              value={thumb}
              onChange={(e) => {
                setThumb(Number(e.target.value));
                writePref("presenter.thumb", Number(e.target.value));
              }}
            />
            ▣
          </label>
        </div>

        <div className="pp-scroll">
          {mode === "show" &&
            viewItems.map((p) => (
              <PresentationSection
                key={p.id}
                p={p}
                show={show}
                focused={p.id === current?.id}
                liveSlide={live?.presentation === p.id ? live.slide : null}
                actionsFor={actionsFor}
                refCb={(el) => (el ? sectionRefs.current.set(p.id, el) : sectionRefs.current.delete(p.id))}
                onFocus={() => setFocus(p.id)}
                onEdit={() => {
                  setFocus(p.id);
                  setMode("edit");
                }}
                onActions={(s) => setActionsFor(actionsFor?.p === p.id && actionsFor.s === s ? null : { p: p.id, s })}
                layerMedia={layers.media}
              />
            ))}
          {mode === "show" && viewItems.length === 0 && (
            <div className="empty">The service is empty. Add songs with “+ Song”, or press + next to an item in the Library.</div>
          )}
          {mode === "edit" && current && <EditPresentation p={current} show={show} />}
          {mode === "reflow" && current && <Reflow key={current.id} p={current} onDone={() => setMode("show")} />}
        </div>
      </section>

      <aside className="pp-right">
        <div className="pp-preview-label">
          <span className="live-dot" /> Live <span className="grow" />
          <small className="muted ellipsis">{live ? `${live.title} · ${live.label}` : ""}</small>
        </div>
        <div className="pp-preview">
          <SlideRender
            text={live?.text ?? ""}
            theme={live ? liveTheme : { ...DEFAULT_THEME, background_color: "#000" }}
            background={live ? slideBackground(show, liveTheme, layers.media) : mediaById(show, layers.media)}
            play
            countdown={layers.countdown?.show_on_audience ? layers.countdown : null}
          />
        </div>
        <Layers />
        <div className="pp-next">
          <div className="pp-preview-label muted">Next {nextSlide ? `· ${nextSlide.label}` : ""}</div>
          <div className="pp-preview small">
            <SlideRender text={nextSlide?.text ?? ""} theme={liveTheme} background={slideBackground(show, liveTheme, layers.media)} />
          </div>
        </div>

        {actionSlide && actionPres ? (
          <TriggerEditor
            presentation={actionPres}
            slide={actionSlide}
            cues={show.cues.map((c) => ({ id: c.id, name: c.name }))}
            onClose={() => setActionsFor(null)}
          />
        ) : (
          <OutputButtons monitors={monitors} />
        )}
      </aside>

      <Bin show={show} current={current} height={binHeight} onResize={(h) => (setBinHeight(h), writePref("presenter.bin", h))} />

      {importing && (
        <ImportSong
          show={show}
          onClose={() => setImporting(false)}
          onAdded={(id) => {
            setMode("show");
            setLibraryOnly(null);
            selectItem(id);
          }}
        />
      )}
      {themesOpen && <ThemeEditor show={show} startWith={themeFor(show, current?.id).name} onClose={() => setThemesOpen(false)} />}
    </div>
  );
}

// ─────────────────────────────────────────────── Library + service playlist

function Sidebar({
  show,
  playlist,
  current,
  liveId,
  libraryOnly,
  onSelect,
  onShowService,
  onImport,
}: {
  show: Show;
  playlist: Presentation[];
  current?: number;
  liveId?: number;
  libraryOnly: number | null;
  onSelect: (id: number) => void;
  onShowService: () => void;
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
    const theme = kind === "scripture" && show.themes.some((t) => t.name === "Scripture") ? "Scripture" : (show.themes[0]?.name ?? "Default");
    void updateShow((d) => {
      d.presentations.push({
        id,
        title,
        kind,
        ccli: null,
        theme,
        slides: [{ id: 1, label: kind === "scripture" ? "Reading" : "Welcome", text: "", triggers: [] }],
      });
      d.playlist.push(id);
    }).then(() => onSelect(id));
  };

  return (
    <aside className="pp-sidebar">
      <div className="pp-section">
        <header>
          <h3 className={libraryOnly == null ? "pp-service-title on" : "pp-service-title"} onClick={onShowService} title="Show the whole service">
            ☰ Service
          </h3>
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
              className={`${p.id === current && libraryOnly == null ? "sel" : ""} ${p.id === liveId ? "live" : ""}`}
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
            <li key={p.id} className={p.id === libraryOnly ? "sel" : ""} onClick={() => onSelect(p.id)}>
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
                  void confirmDialog(`Delete “${p.title}” from the library?`).then((yes) => {
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

// ─────────────────────────────────────────────── Slides (Show mode)

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

function PresentationSection({
  p,
  show,
  focused,
  liveSlide,
  actionsFor,
  refCb,
  onFocus,
  onEdit,
  onActions,
  layerMedia,
}: {
  p: Presentation;
  show: Show;
  focused: boolean;
  liveSlide: number | null;
  actionsFor: { p: number; s: number } | null;
  refCb: (el: HTMLElement | null) => void;
  onFocus: () => void;
  onEdit: () => void;
  onActions: (slide: number) => void;
  layerMedia: number | null;
}) {
  const theme = themeFor(show, p.id);
  const bg = slideBackground(show, theme, layerMedia);
  return (
    <section className={`pp-pres ${focused ? "focused" : ""} ${liveSlide != null ? "has-live" : ""}`} ref={refCb} onMouseDown={onFocus}>
      <header className="pp-pres-head">
        <span className={`kind-dot ${p.kind}`} />
        <h2 className="ellipsis">{p.title}</h2>
        {p.ccli && <small className="muted">CCLI #{p.ccli}</small>}
        <span className="grow" />
        <select
          className="pp-theme-pick"
          value={theme.name}
          title="Theme for this presentation"
          onChange={(e) =>
            updateShow((d) => {
              const x = d.presentations.find((y) => y.id === p.id);
              if (x) x.theme = e.target.value;
            })
          }
        >
          {(show.themes.length ? show.themes : [DEFAULT_THEME]).map((t) => (
            <option key={t.name} value={t.name}>
              ◐ {t.name}
            </option>
          ))}
        </select>
        <button className="icon" title="Edit slides" onClick={onEdit}>
          ✎
        </button>
      </header>
      <div className="pp-grid">
        {p.slides.map((s, i) => (
          <div
            key={s.id}
            className={`pp-slide ${liveSlide === s.id ? "live" : ""} ${actionsFor?.p === p.id && actionsFor.s === s.id ? "focused" : ""}`}
            onClick={() => send({ type: "go_slide", presentation: p.id, slide: s.id })}
            onContextMenu={(e) => {
              e.preventDefault();
              onActions(s.id);
            }}
          >
            <div className="pp-thumb">
              <SlideRender text={s.text} theme={theme} background={bg} />
              {s.triggers.length > 0 && (
                <div className="pp-badges">
                  {s.triggers.map((t, k) => (
                    <span key={k} className="badge">
                      {triggerLabel(t)}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="pp-label" style={{ ["--group" as string]: groupColor(s.label) }}>
              <span className="num">{i + 1}</span>
              <span className="grow ellipsis">{s.label}</span>
              <button
                className="icon light"
                title="Slide actions (lights, mixer) — or right-click"
                onClick={(e) => {
                  e.stopPropagation();
                  onActions(s.id);
                }}
              >
                ⚙
              </button>
            </div>
          </div>
        ))}
        {p.slides.length === 0 && <div className="muted pp-empty-pres">No slides — press ✎ to add some.</div>}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────── Edit mode

const editSlides = (pid: number, fn: (slides: Slide[]) => Slide[]) =>
  updateShow((d) => {
    const p = d.presentations.find((x) => x.id === pid);
    if (p) p.slides = fn(p.slides);
  });

function nextSlideId(slides: Slide[]) {
  return Math.max(0, ...slides.map((s) => s.id)) + 1;
}

function EditPresentation({ p, show }: { p: Presentation; show: Show }) {
  const set = (patch: Partial<Presentation>) =>
    updateShow((d) => {
      const x = d.presentations.find((y) => y.id === p.id);
      if (x) Object.assign(x, patch);
    });
  const theme = themeFor(show, p.id);
  return (
    <section className="pp-pres focused">
      <header className="pp-pres-head edit">
        <select value={p.kind} onChange={(e) => void set({ kind: e.target.value as PresentationKind })}>
          {(["song", "scripture", "announcement", "media"] as PresentationKind[]).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <input className="title-input" value={p.title} onChange={(e) => void set({ title: e.target.value })} />
        <input className="ccli-input" placeholder="CCLI #" value={p.ccli ?? ""} onChange={(e) => void set({ ccli: e.target.value || null })} />
      </header>
      <div className="pp-grid">
        {p.slides.map((s, i) => (
          <SlideEditCard key={s.id} p={p} slide={s} index={i} theme={theme} show={show} />
        ))}
        <button
          className="pp-add-slide"
          onClick={() =>
            editSlides(p.id, (ss) => [...ss, { id: nextSlideId(ss), label: ss[ss.length - 1]?.label ?? "Verse 1", text: "", triggers: [] }])
          }
        >
          + Add slide
        </button>
      </div>
    </section>
  );
}

function SlideEditCard({ p, slide, index, theme, show }: { p: Presentation; slide: Slide; index: number; theme: Theme; show: Show }) {
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
      <div className="pp-thumb">
        <SlideRender text={slide.text} theme={theme} background={slideBackground(show, theme, null)} />
      </div>
      <div className="pp-label" style={{ ["--group" as string]: groupColor(slide.label) }}>
        <span className="num">{index + 1}</span>
        <input className="label-input" list="slide-labels" value={slide.label} onChange={(e) => void set({ label: e.target.value })} />
        <datalist id="slide-labels">
          {LABEL_SUGGESTIONS.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
      </div>
      <textarea className="pp-text-edit" value={slide.text} placeholder="Slide text" onChange={(e) => void set({ text: e.target.value })} />
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

// ─────────────────────────────────────────────── Reflow (all words in one editor)

function toReflowText(p: Presentation) {
  return p.slides.map((s) => `[${s.label}]\n${s.text}`).join("\n\n");
}

function Reflow({ p, onDone }: { p: Presentation; onDone: () => void }) {
  const [text, setText] = useState(() => toReflowText(p));
  const [lines, setLines] = useState(0);
  const apply = async () => {
    try {
      // 0 = keep each [section] as one slide; otherwise split long sections.
      const parsed = await api.parseLyrics(p.title, text, lines || 99);
      await updateShow((d) => {
        const x = d.presentations.find((y) => y.id === p.id);
        if (!x) return;
        // Keep slide actions (lights / mixer) by position.
        x.slides = parsed.slides.map((s, i) => ({ ...s, triggers: x.slides[i]?.triggers ?? [] }));
      });
      onDone();
    } catch (e) {
      pushLog("warn", String(e));
    }
  };
  return (
    <section className="pp-reflow">
      <p className="muted">
        All the words of <b>{p.title}</b> in one place. Each <code>[Label]</code> starts a slide; a blank line inside a section also starts a new
        slide. Slide actions stay with slides in the same position.
      </p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck />
      <div className="row end">
        <label className="inline muted">
          Max lines per slide
          <select value={lines} onChange={(e) => setLines(Number(e.target.value))}>
            <option value={0}>no limit</option>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button onClick={onDone}>Cancel</button>
        <button className="primary" onClick={apply}>
          Apply
        </button>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────── Layers (ProPresenter-style clears)

function Layers() {
  const { live, layers, show } = useEngine();
  const media = mediaById(show, layers.media);
  const audio = mediaById(show, layers.audio);
  const any = !!(live || layers.media != null || layers.audio != null || layers.countdown);
  return (
    <div className="pp-layers">
      <button className={`pp-clear-all ${any ? "armed" : ""}`} onClick={() => send({ type: "clear_all" })} title="Clear slide, media, audio and timer (Esc clears the slide)">
        Clear All
      </button>
      <div className="pp-layer-row">
        <LayerButton label="Slide" on={!!live} detail={live?.label} onClear={() => send({ type: "clear_slide" })} />
        <LayerButton label="Media" on={!!media} detail={media?.name} onClear={() => send({ type: "set_media", media: null })} />
        <LayerButton label="Audio" on={!!audio} detail={audio?.name} onClear={() => send({ type: "play_audio", audio: null, looped: false })} />
        <LayerButton
          label="Timer"
          on={!!layers.countdown}
          detail={layers.countdown ? <CountdownText c={layers.countdown} /> : undefined}
          onClear={() => send({ type: "clear_countdown" })}
        />
      </div>
    </div>
  );
}

function LayerButton({ label, on, detail, onClear }: { label: string; on: boolean; detail?: React.ReactNode; onClear: () => void }) {
  return (
    <button className={`pp-layer ${on ? "on" : ""}`} onClick={onClear} disabled={!on} title={on ? `Clear ${label}` : `${label}: nothing showing`}>
      <span className="pp-layer-name">{label}</span>
      <span className="pp-layer-detail ellipsis">{on ? detail ?? "on" : "—"}</span>
    </button>
  );
}

// ─────────────────────────────────────────────── Bottom bin: Media / Audio / Timers

const kindOf = (path: string): MediaKind | null => {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext)) return "image";
  if (["mp4", "mov", "m4v", "webm"].includes(ext)) return "video";
  if (["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(ext)) return "audio";
  return null;
};

async function importMedia(show: Show) {
  const paths = await pickMediaFiles();
  if (!paths.length) return;
  let id = Math.max(0, ...show.media.map((m) => m.id));
  const items: MediaItem[] = [];
  for (const path of paths) {
    const kind = kindOf(path);
    if (!kind || show.media.some((m) => m.path === path)) continue;
    const name = path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
    items.push({ id: ++id, name, path, kind });
  }
  if (items.length) await updateShow((d) => void d.media.push(...items));
  pushLog("info", `Added ${items.length} file(s) to the media bin`);
}

function Bin({ show, current, height, onResize }: { show: Show; current?: Presentation; height: number; onResize: (h: number) => void }) {
  const [tab, setTab] = useState<"media" | "audio" | "timers">("media");
  const startDrag = (e: React.PointerEvent) => {
    const y0 = e.clientY;
    const h0 = height;
    const move = (ev: PointerEvent) => onResize(Math.max(36, Math.min(480, h0 - (ev.clientY - y0))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <section className="pp-bin">
      <div className="pp-bin-resize" onPointerDown={startDrag} title="Drag to resize" />
      <div className="pp-bin-tabs">
        {(["media", "audio", "timers"] as const).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "media" ? "▣ Media" : t === "audio" ? "♪ Audio" : "◷ Timers"}
          </button>
        ))}
        <span className="grow" />
        {tab !== "timers" && (
          <button className="small" onClick={() => importMedia(show)}>
            + Add files…
          </button>
        )}
      </div>
      <div className="pp-bin-body">
        {tab === "media" && <MediaTab show={show} current={current} />}
        {tab === "audio" && <AudioTab show={show} />}
        {tab === "timers" && <TimersTab />}
      </div>
    </section>
  );
}

function removeMedia(m: MediaItem) {
  void confirmDialog(`Remove “${m.name}” from the bin? (The file itself is not deleted.)`).then((yes) => {
    if (!yes) return;
    void updateShow((d) => {
      d.media = d.media.filter((x) => x.id !== m.id);
      for (const t of d.themes) if (t.background_media === m.id) t.background_media = null;
    });
    // Take it off screen too.
    void send({ type: "set_media", media: null });
  });
}

function MediaTab({ show, current }: { show: Show; current?: Presentation }) {
  const { layers } = useEngine();
  const items = show.media.filter((m) => m.kind !== "audio");
  const theme = themeFor(show, current?.id);
  if (items.length === 0)
    return (
      <div className="muted pp-bin-empty">
        Add images and video loops with “+ Add files…”. Click one to put it on screen behind the words; use ◐ to make it a theme background.
      </div>
    );
  return (
    <div className="pp-media-grid">
      {items.map((m) => (
        <div
          key={m.id}
          className={`pp-media ${layers.media === m.id ? "live" : ""}`}
          onClick={() => send({ type: "set_media", media: layers.media === m.id ? null : m.id })}
          title={`${m.name} — click to show / hide`}
        >
          <div className="pp-media-thumb">
            <MediaFill item={m} play={false} />
            <span className="pp-media-kind">{m.kind === "video" ? "▶" : "▣"}</span>
          </div>
          <div className="pp-media-name">
            <span className="ellipsis grow">{m.name}</span>
            <button
              className={`icon ${theme.background_media === m.id ? "on" : ""}`}
              title={`Use as background of theme “${theme.name}”`}
              onClick={(e) => {
                e.stopPropagation();
                void updateShow((d) => {
                  const t = d.themes.find((x) => x.name === theme.name);
                  if (t) t.background_media = t.background_media === m.id ? null : m.id;
                  else d.themes.push({ ...theme, background_media: m.id });
                });
              }}
            >
              ◐
            </button>
            <button
              className="icon"
              title="Remove from bin"
              onClick={(e) => {
                e.stopPropagation();
                removeMedia(m);
              }}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function AudioTab({ show }: { show: Show }) {
  const { layers } = useEngine();
  const [loop, setLoop] = useState(true);
  const items = show.media.filter((m) => m.kind === "audio");
  return (
    <div className="pp-audio-list">
      <label className="inline muted">
        <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop
      </label>
      {items.length === 0 && <div className="muted">Add walk-in music or tracks with “+ Add files…”. It plays from this computer's sound output.</div>}
      {items.map((m) => {
        const on = layers.audio === m.id;
        return (
          <div key={m.id} className={`pp-audio ${on ? "live" : ""}`}>
            <button className={on ? "danger on" : ""} onClick={() => send({ type: "play_audio", audio: on ? null : m.id, looped: loop })}>
              {on ? "■" : "▶"}
            </button>
            <span className="grow ellipsis">{m.name}</span>
            {on && layers.audio_loop && <small className="muted">loop</small>}
            <button className="icon" title="Remove from bin" onClick={() => removeMedia(m)}>
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}

function TimersTab() {
  const { layers } = useEngine();
  const [label, setLabel] = useState("Service starts in");
  const [mins, setMins] = useState(5);
  const [audience, setAudience] = useState(true);
  const start = (m: number) => send({ type: "start_countdown", label, seconds: Math.round(m * 60), show_on_audience: audience });
  return (
    <div className="pp-timers">
      <div className="row wrap">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" />
        {[1, 2, 5, 10].map((m) => (
          <button key={m} onClick={() => start(m)}>
            {m} min
          </button>
        ))}
        <input type="number" min={0.5} step={0.5} value={mins} onChange={(e) => setMins(Number(e.target.value))} />
        <button className="primary" onClick={() => start(mins)}>
          Start
        </button>
        <label className="inline muted">
          <input type="checkbox" checked={audience} onChange={(e) => setAudience(e.target.checked)} /> Show on audience screen
        </label>
      </div>
      <div className="pp-timer-now">
        {layers.countdown ? (
          <>
            <span className="muted">{layers.countdown.label}</span>
            <b>
              <CountdownText c={layers.countdown} />
            </b>
            <button onClick={() => send({ type: "clear_countdown" })}>Clear</button>
          </>
        ) : (
          <span className="muted">No timer running. It always shows on the stage display.</span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── Themes

function ThemeEditor({ show, startWith, onClose }: { show: Show; startWith: string; onClose: () => void }) {
  const themes = show.themes.length ? show.themes : [DEFAULT_THEME];
  const [sel, setSel] = useState(themes.find((t) => t.name === startWith)?.name ?? themes[0].name);
  const t = themes.find((x) => x.name === sel) ?? themes[0];
  const used = show.presentations.filter((p) => themeFor(show, p.id).name === t.name).length;

  const edit = (patch: Partial<Theme>) =>
    updateShow((d) => {
      if (!d.themes.length) d.themes.push({ ...DEFAULT_THEME });
      const x = d.themes.find((y) => y.name === t.name);
      if (!x) return;
      if (patch.name !== undefined && patch.name !== t.name) {
        if (!patch.name.trim() || d.themes.some((y) => y.name === patch.name)) return;
        for (const p of d.presentations) if (p.theme === t.name) p.theme = patch.name;
        setSel(patch.name);
      }
      Object.assign(x, patch);
    });
  const addTheme = (base: Theme) => {
    let n = 1;
    while (themes.some((x) => x.name === `${base.name} ${n}`)) n++;
    const name = `${base.name} ${n}`;
    void updateShow((d) => void d.themes.push({ ...base, name }));
    setSel(name);
  };
  const visuals = show.media.filter((m) => m.kind !== "audio");

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal theme-modal" onClick={(e) => e.stopPropagation()}>
        <header className="row">
          <h3 className="grow">Themes</h3>
          <button onClick={onClose}>Done</button>
        </header>
        <div className="theme-body">
          <ul className="pp-list theme-list">
            {themes.map((x) => (
              <li key={x.name} className={x.name === t.name ? "sel" : ""} onClick={() => setSel(x.name)}>
                <span className="theme-swatch" style={{ background: x.background_color, color: x.color, fontFamily: x.font }}>
                  Aa
                </span>
                <span className="grow ellipsis">{x.name}</span>
              </li>
            ))}
            <li className="muted" onClick={() => addTheme(t)}>
              + Duplicate “{t.name}”
            </li>
            <li className="muted" onClick={() => addTheme({ ...DEFAULT_THEME, name: "Theme" })}>
              + New theme
            </li>
          </ul>
          <div className="theme-fields">
            <div className="theme-preview">
              <SlideRender text={"Amazing grace! How sweet the sound\nThat saved a wretch like me"} theme={t} background={mediaById(show, t.background_media)} play />
            </div>
            <div className="theme-grid">
              <label>Name</label>
              <input key={t.name} defaultValue={t.name} onBlur={(e) => void edit({ name: e.target.value.trim() })} />
              <label>Font</label>
              <select value={t.font} onChange={(e) => void edit({ font: e.target.value })}>
                {[...new Set([t.font, ...FONTS])].map((f) => (
                  <option key={f} value={f} style={{ fontFamily: f }}>
                    {f}
                  </option>
                ))}
              </select>
              <label>Size {Math.round(t.size * 100)}%</label>
              <input type="range" min={0.4} max={2} step={0.05} value={t.size} onChange={(e) => void edit({ size: Number(e.target.value) })} />
              <label>Text colour</label>
              <input type="color" value={t.color.slice(0, 7)} onChange={(e) => void edit({ color: e.target.value })} />
              <label>Position</label>
              <div className="seg small">
                {(["top", "center", "bottom", "lower_third"] as const).map((pos) => (
                  <button key={pos} className={t.position === pos ? "on" : ""} onClick={() => void edit({ position: pos })}>
                    {pos === "lower_third" ? "Lower third" : pos[0].toUpperCase() + pos.slice(1)}
                  </button>
                ))}
              </div>
              <label>Style</label>
              <div className="row">
                <label className="inline"><input type="checkbox" checked={t.bold} onChange={(e) => void edit({ bold: e.target.checked })} /> Bold</label>
                <label className="inline"><input type="checkbox" checked={t.uppercase} onChange={(e) => void edit({ uppercase: e.target.checked })} /> CAPITALS</label>
                <label className="inline"><input type="checkbox" checked={t.shadow} onChange={(e) => void edit({ shadow: e.target.checked })} /> Shadow</label>
              </div>
              <label>Background colour</label>
              <input type="color" value={t.background_color.slice(0, 7)} onChange={(e) => void edit({ background_color: e.target.value })} />
              <label>Background media</label>
              <select value={t.background_media ?? ""} onChange={(e) => void edit({ background_media: e.target.value ? Number(e.target.value) : null })}>
                <option value="">None</option>
                {visuals.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.kind === "video" ? "▶ " : "▣ "}
                    {m.name}
                  </option>
                ))}
              </select>
              <label>Darken background {Math.round(t.dim * 100)}%</label>
              <input type="range" min={0} max={0.9} step={0.05} value={t.dim} onChange={(e) => void edit({ dim: Number(e.target.value) })} />
            </div>
            <div className="row">
              <small className="muted grow">
                Used by {used} presentation{used === 1 ? "" : "s"}. {visuals.length === 0 && "Add images / videos in the Media bin to use them as backgrounds."}
              </small>
              <button
                disabled={themes.length <= 1}
                onClick={() =>
                  void confirmDialog(`Delete theme “${t.name}”? Presentations using it switch to “${themes.find((x) => x.name !== t.name)?.name}”.`).then(
                    (yes) => {
                      if (!yes) return;
                      const fallback = themes.find((x) => x.name !== t.name)!.name;
                      void updateShow((d) => {
                        d.themes = d.themes.filter((x) => x.name !== t.name);
                        for (const p of d.presentations) if (p.theme === t.name) p.theme = fallback;
                      });
                      setSel(fallback);
                    },
                  )
                }
              >
                Delete theme
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── Outputs

function OutputButtons({ monitors }: { monitors: MonitorInfo[] }) {
  const [screen, setScreen] = useState<string>("window");
  const mon = screen === "window" ? undefined : Number(screen);
  return (
    <div className="pp-card">
      <h3>Screens</h3>
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
          <small>confidence + timer</small>
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
      <select value="" onChange={(e) => e.target.value && mutate((ts) => [...ts, { type: "lighting_cue", cue: Number(e.target.value) }])}>
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

function ImportSong({ show, onClose, onAdded }: { show: Show; onClose: () => void; onAdded: (id: number) => void }) {
  const [title, setTitle] = useState("");
  const [ccli, setCcli] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [lines, setLines] = useState(2);
  const [theme, setTheme] = useState(show.themes.find((t) => t.name === "Worship")?.name ?? show.themes[0]?.name ?? "Default");

  const add = async () => {
    try {
      const p = await api.parseLyrics(title || "Untitled", lyrics, lines);
      p.ccli = ccli || null;
      p.theme = theme;
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
        </div>
        <div className="row">
          <label className="inline">
            Lines/slide
            <input type="number" min={1} max={8} value={lines} onChange={(e) => setLines(Number(e.target.value))} />
          </label>
          <label className="inline">
            Theme
            <select value={theme} onChange={(e) => setTheme(e.target.value)}>
              {show.themes.map((t) => (
                <option key={t.name}>{t.name}</option>
              ))}
            </select>
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
          slide. You can change anything afterwards with <b>Edit</b> or <b>Reflow</b>.
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
