// ProPresenter-style Presenter:
//
//   ┌ toolbar: Theme · Show · Edit · Reflow ·············· Media · Audience · Stage · Stream ┐
//   │ Library / Service │ groups + arrangement bar          │ Live preview + layers     │
//   │                   │ slides (whole service)            │                           │
//   │ Media folders     │ media bin                         │ Audio · Props · Timers ·  │
//   │                   │                                   │ Macros · Slide actions    │
//
// Drag media, props and macros onto slides; drag groups into an arrangement.

import { useEffect, useMemo, useRef, useState } from "react";
import { api, confirmDialog } from "../../shared/bridge";
import { startDrag, useDropTarget, wasDragging } from "../../shared/drag";
import { pushLog, send, updateShow, useEngine } from "../../shared/store";
import type { Presentation, PresentationKind, Show, Slide, SlideTrigger } from "../../shared/types";
import { groupColor, groupNames, sequence } from "./groups";
import { Bin, MediaFolders, RightTabs, triggerLabel, type Folder } from "./panels";
import { DEFAULT_THEME, SlideRender, liveProps, mediaById, slideBackground, slideMedia, themeFor } from "./render";
import ThemeEditor from "./themes";

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
export type SlideRef = { p: number; s: number };
/** Where we are in the played order (a slide can appear twice in an arrangement). */
export type Cursor = { p: number; pos: number } | null;

export default function PresenterApp() {
  const { show, live } = useEngine();
  const [focus, setFocus] = useState<number | null>(null);
  const [libraryOnly, setLibraryOnly] = useState<number | null>(null);
  const [selSlide, setSelSlide] = useState<SlideRef | null>(null);
  const [mode, setMode] = useState<Mode>("show");
  const [importing, setImporting] = useState(false);
  const [themesOpen, setThemesOpen] = useState(false);
  const [showBin, setShowBin] = useState(true);
  const [folder, setFolder] = useState<Folder>({ kind: "all" });
  const [thumb, setThumb] = useState(() => readPref("presenter.thumb", 200));
  const [binH, setBinH] = useState(() => readPref("presenter.bin2", 230));
  const [rightTab, setRightTab] = useState<string>("audio");
  const [cursor, setCursor] = useState<Cursor>(null);
  const sectionRefs = useRef(new Map<number, HTMLElement>());

  const playlist = useMemo(
    () => (show ? (show.playlist.map((id) => show.presentations.find((p) => p.id === id)).filter(Boolean) as Presentation[]) : []),
    [show],
  );
  const viewItems = libraryOnly != null ? (show?.presentations.filter((p) => p.id === libraryOnly) ?? []) : playlist;
  const current = show?.presentations.find(
    (p) => p.id === (focus ?? live?.presentation ?? viewItems.find((x) => x.kind !== "header")?.id) && p.kind !== "header",
  );

  // Arrow keys / space / clicker: through the whole service, in arrangement order.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode !== "show" || (e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (!["ArrowRight", "ArrowLeft", " ", "PageDown", "PageUp", "ArrowDown", "ArrowUp"].includes(e.key)) return;
      e.preventDefault();
      const flat = viewItems.flatMap((p) => sequence(p).map((x) => [p.id, x.slide.id, x.pos] as const));
      const here = (c: (typeof flat)[number]) => !!live && c[0] === live.presentation && c[1] === live.slide;
      let i = cursor ? flat.findIndex((c) => c[0] === cursor.p && c[2] === cursor.pos && here(c)) : -1;
      if (i < 0 && live) i = flat.findIndex(here);
      const step = ["ArrowLeft", "PageUp", "ArrowUp"].includes(e.key) ? -1 : 1;
      const next = flat[Math.max(0, Math.min(flat.length - 1, i + step))];
      if (next) {
        setFocus(next[0]);
        setCursor({ p: next[0], pos: next[2] });
        void send({ type: "go_slide", presentation: next[0], slide: next[1] });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewItems, live, mode, cursor]);

  useEffect(() => {
    if (mode === "show" && live) document.querySelector(".pp-slide.live")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [live?.presentation, live?.slide, mode]);

  if (!show) return <div className="empty">Loading show…</div>;

  const selectItem = (id: number) => {
    setFocus(id);
    if (show.playlist.includes(id)) {
      setLibraryOnly(null);
      requestAnimationFrame(() => sectionRefs.current.get(id)?.scrollIntoView({ block: "start", behavior: "smooth" }));
    } else setLibraryOnly(id);
  };
  const pickSlide = (r: SlideRef) => {
    setSelSlide(r);
    setRightTab("slide");
  };

  return (
    <div className={`pp ${showBin ? "" : "no-bin"}`} style={{ ["--thumb" as string]: `${thumb}px`, ["--bin" as string]: `${binH}px` }}>
      <Toolbar
        mode={mode}
        setMode={setMode}
        canEdit={!!current}
        onThemes={() => setThemesOpen(true)}
        showBin={showBin}
        setShowBin={setShowBin}
      />

      <div className="pp-left">
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
        {showBin && <MediaFolders show={show} folder={folder} setFolder={setFolder} />}
      </div>

      <section className="pp-center">
        {current && mode !== "reflow" && <GroupBar p={current} />}
        <div className="pp-scroll">
          {mode === "show" &&
            viewItems.map((p, i) =>
              p.kind === "header" ? (
                <HeaderRow key={`${p.id}-${i}`} p={p} />
              ) : (
                <PresentationSection
                  key={`${p.id}-${i}`}
                  p={p}
                  show={show}
                  focused={p.id === current?.id}
                  liveSlide={live?.presentation === p.id ? live.slide : null}
                  selected={selSlide}
                  refCb={(el) => (el ? sectionRefs.current.set(p.id, el) : sectionRefs.current.delete(p.id))}
                  onFocus={() => setFocus(p.id)}
                  onEdit={() => {
                    setFocus(p.id);
                    setMode("edit");
                  }}
                  onPick={pickSlide}
                  cursor={cursor}
                  onGo={setCursor}
                />
              ),
            )}
          {mode === "show" && viewItems.length === 0 && (
            <div className="empty">The service is empty. Add songs with “+ Song”, or press + next to an item in the Library.</div>
          )}
          {mode === "edit" && current && <EditPresentation p={current} show={show} />}
          {mode === "reflow" && current && <Reflow key={current.id} p={current} onDone={() => setMode("show")} />}
        </div>
        <div className="pp-center-foot">
          <label className="inline muted" title="Slide size">
            ▫
            <input
              type="range"
              min={120}
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
      </section>

      {showBin && (
        <Bin
          show={show}
          folder={folder}
          height={binH}
          onResize={(h) => {
            setBinH(h);
            writePref("presenter.bin2", h);
          }}
        />
      )}

      <aside className="pp-right">
        <LivePanel cursor={cursor} />
        <RightTabs
          show={show}
          tab={rightTab}
          setTab={setRightTab}
          selected={selSlide}
          onCloseSlide={() => setSelSlide(null)}
        />
      </aside>

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

// ─────────────────────────────────────────────── Toolbar

function Toolbar({
  mode,
  setMode,
  canEdit,
  onThemes,
  showBin,
  setShowBin,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  canEdit: boolean;
  onThemes: () => void;
  showBin: boolean;
  setShowBin: (v: boolean) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [monitors, setMonitors] = useState<{ index: number; name: string | null; width: number; height: number }[]>([]);
  const [screen, setScreen] = useState("window");
  useEffect(() => {
    api.monitors().then(setMonitors).catch(() => {});
  }, []);
  const toggleOutput = (kind: "audience" | "stage" | "stream") => {
    void api.openOutput(kind, screen === "window" ? undefined : Number(screen));
    setOpen((o) => ({ ...o, [kind]: !o[kind] }));
  };
  const Tool = ({ icon, label, on, onClick, disabled, title }: { icon: string; label: string; on?: boolean; onClick: () => void; disabled?: boolean; title?: string }) => (
    <button className={`pp-tool ${on ? "on" : ""}`} onClick={onClick} disabled={disabled} title={title ?? label}>
      <span className="pp-tool-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
  return (
    <div className="pp-toolbar2">
      <Tool icon="◐" label="Theme" onClick={onThemes} title="Fonts, colours and backgrounds" />
      <span className="pp-tool-gap" />
      <Tool icon="▶" label="Show" on={mode === "show"} onClick={() => setMode("show")} />
      <Tool icon="✎" label="Edit" on={mode === "edit"} disabled={!canEdit} onClick={() => setMode("edit")} />
      <Tool icon="¶" label="Reflow" on={mode === "reflow"} disabled={!canEdit} onClick={() => setMode("reflow")} />
      <Tool icon="✝" label="Bible" disabled onClick={() => {}} title="Scripture lookup is coming — for now use + Scripture in the Library" />
      <span className="grow" />
      <Tool icon="▣" label="Media" on={showBin} onClick={() => setShowBin(!showBin)} title="Show / hide the media bin" />
      <span className="pp-tool-gap" />
      <select className="pp-screen-pick" value={screen} onChange={(e) => setScreen(e.target.value)} title="Where outputs open">
        <option value="window">In a window</option>
        {monitors.map((m) => (
          <option key={m.index} value={m.index}>
            Screen {m.index + 1} {m.width}×{m.height}
          </option>
        ))}
      </select>
      {(["audience", "stage", "stream"] as const).map((k) => (
        <button key={k} className={`pp-tool pp-out ${open[k] ? "on" : ""}`} onClick={() => toggleOutput(k)} title={`Open / close the ${k} output`}>
          <span className={`pp-dot ${open[k] ? "on" : ""}`} />
          <span>{k[0].toUpperCase() + k.slice(1)}</span>
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────── Live panel (right top)

function LivePanel({ cursor }: { cursor: Cursor }) {
  const { show, live, layers } = useEngine();
  const liveP = show?.presentations.find((p) => p.id === live?.presentation);
  const theme = themeFor(show, live?.presentation);
  const seq = liveP ? sequence(liveP) : [];
  let idx = cursor?.p === live?.presentation ? seq.findIndex((x) => x.pos === cursor?.pos && x.slide.id === live?.slide) : -1;
  if (idx < 0) idx = seq.findIndex((x) => x.slide.id === live?.slide);
  const next = idx >= 0 ? seq[idx + 1]?.slide : undefined;
  const liveSlide = liveP?.slides.find((s) => s.id === live?.slide);
  const bg = mediaById(show, layers.media) ?? (live ? (slideMedia(show, liveSlide) ?? slideBackground(show, theme, null)) : null);
  const any = !!(live || layers.media != null || layers.audio != null || layers.countdown || layers.props.length);
  const media = mediaById(show, layers.media);
  const audio = mediaById(show, layers.audio);
  const clear = (layer: "slide" | "media" | "audio" | "props" | "timer") =>
    layer === "slide"
      ? send({ type: "clear_slide" })
      : layer === "media"
        ? send({ type: "set_media", media: null })
        : layer === "audio"
          ? send({ type: "play_audio", audio: null, looped: false })
          : layer === "props"
            ? send({ type: "clear_props" })
            : send({ type: "clear_countdown" });
  const rows: [string, "slide" | "media" | "audio" | "props" | "timer", boolean, string | undefined][] = [
    ["Slide", "slide", !!live, live?.label],
    ["Media", "media", !!media, media?.name],
    ["Audio", "audio", !!audio, audio?.name],
    ["Props", "props", layers.props.length > 0, `${layers.props.length} on`],
    ["Timer", "timer", !!layers.countdown, layers.countdown?.label],
  ];
  return (
    <div className="pp-live">
      <div className="pp-preview-label">
        <span className="live-dot" /> Live <span className="grow" />
        <small className="muted ellipsis">{live ? `${live.title} · ${live.label}` : ""}</small>
      </div>
      <div className="pp-preview">
        <SlideRender
          text={live?.text ?? ""}
          theme={live ? theme : { ...DEFAULT_THEME, background_color: "#000" }}
          background={bg}
          play
          countdown={layers.countdown?.show_on_audience ? layers.countdown : null}
          props={liveProps(show, layers.props)}
        />
      </div>
      <div className="pp-layers">
        <button className={`pp-clear-all ${any ? "armed" : ""}`} onClick={() => send({ type: "clear_all" })} title="F1 · slide, media, audio, props and timer">
          ✕ Clear All
        </button>
        <div className="pp-layer-row five">
          {rows.map(([label, layer, on, detail]) => (
            <button key={layer} className={`pp-layer ${on ? "on" : ""}`} disabled={!on} onClick={() => clear(layer)} title={on ? `Clear ${label}` : `${label}: nothing showing`}>
              <span className="pp-layer-name">{label}</span>
              <span className="pp-layer-detail ellipsis">{on ? (detail ?? "on") : "—"}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="pp-next-row">
        <div className="pp-preview tiny">
          <SlideRender text={next?.text ?? ""} theme={theme} background={slideMedia(show, next)} transparent />
        </div>
        <div className="muted">
          <small>NEXT</small>
          <div className="ellipsis">{next ? next.label : "—"}</div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── Library + service

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
  const [dragOver, setDragOver] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const lib = show.presentations
    .filter((p) => p.kind !== "header" && p.title.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.title.localeCompare(b.title));

  // Drag service items to reorder; drag library items in to add.
  useDropTarget(listRef, ["service-item", "library-item"], {
    onOver: (pt) => {
      const rows = [...(listRef.current?.querySelectorAll("li[data-i]") ?? [])] as HTMLElement[];
      const i = rows.findIndex((r) => pt.y < r.getBoundingClientRect().top + r.offsetHeight / 2);
      setDragOver(i < 0 ? rows.length : i);
    },
    onLeave: () => setDragOver(null),
    onDrop: (_pt, p) => {
      const to = dragOver ?? playlist.length;
      setDragOver(null);
      void updateShow((d) => {
        if (p.kind === "service-item") {
          const from = p.data as number;
          const [x] = d.playlist.splice(from, 1);
          d.playlist.splice(to > from ? to - 1 : to, 0, x);
        } else d.playlist.splice(to, 0, p.data as number);
      });
    },
  });

  const newItem = (kind: PresentationKind) => {
    const id = Math.max(0, ...show.presentations.map((p) => p.id)) + 1;
    const title = kind === "scripture" ? "New scripture" : kind === "header" ? "New section" : "New announcement";
    const theme = kind === "scripture" && show.themes.some((t) => t.name === "Scripture") ? "Scripture" : (show.themes[0]?.name ?? "Default");
    void updateShow((d) => {
      d.presentations.push({
        id,
        title,
        kind,
        ccli: null,
        theme,
        groups: [],
        arrangements: [],
        arrangement: null,
        slides: kind === "header" ? [] : [{ id: 1, label: kind === "scripture" ? "Reading" : "Welcome", text: "", triggers: [] }],
      });
      d.playlist.push(id);
    }).then(() => kind !== "header" && onSelect(id));
  };

  return (
    <div className="pp-sidebar">
      <div className="pp-section">
        <header>
          <h3 className={libraryOnly == null ? "pp-service-title on" : "pp-service-title"} onClick={onShowService} title="Show the whole service">
            ☰ Service
          </h3>
          <span className="grow" />
          <button className="icon" title="Add a section header (e.g. Main Show)" onClick={() => newItem("header")}>
            + Header
          </button>
        </header>
        <ol className="pp-list" ref={listRef}>
          {playlist.map((p, i) => (
            <li
              key={`${p.id}-${i}`}
              data-i={i}
              className={`${p.kind === "header" ? "pp-header-item" : ""} ${p.id === current && libraryOnly == null ? "sel" : ""} ${p.id === liveId ? "live" : ""} ${dragOver === i ? "drop-before" : ""}`}
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest("button, input")) return;
                startDrag(e, { kind: "service-item", data: i, label: p.title });
              }}
              onClick={() => !wasDragging() && p.kind !== "header" && onSelect(p.id)}
            >
              {p.kind === "header" ? (
                <input
                  className="pp-header-input"
                  value={p.title}
                  onChange={(e) =>
                    updateShow((d) => {
                      const x = d.presentations.find((y) => y.id === p.id);
                      if (x) x.title = e.target.value;
                    })
                  }
                />
              ) : (
                <>
                  <span className={`kind-dot ${p.kind}`} />
                  <span className="grow ellipsis">{p.title}</span>
                  <small className="muted ellipsis pp-theme-hint">{p.theme}</small>
                </>
              )}
              <button
                className="icon"
                title="Remove from service (stays in the Library)"
                onClick={(e) => {
                  e.stopPropagation();
                  void updateShow((d) => {
                    d.playlist.splice(i, 1);
                    if (p.kind === "header") d.presentations = d.presentations.filter((x) => x.id !== p.id);
                  });
                }}
              >
                −
              </button>
            </li>
          ))}
          {dragOver === playlist.length && <li className="drop-before end" />}
          {playlist.length === 0 && <li className="muted hint">Drag songs here from the Library, or press +</li>}
        </ol>
      </div>

      <div className="pp-section grow">
        <header>
          <h3>Library</h3>
          <div className="seg small">
            <button onClick={onImport} title="Paste lyrics">+ Song</button>
            <button onClick={() => newItem("announcement")} title="Blank presentation">+ Slides</button>
            <button onClick={() => newItem("scripture")} title="Scripture reading">+ Scripture</button>
          </div>
        </header>
        <input className="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="pp-list">
          {lib.map((p) => (
            <li
              key={p.id}
              className={p.id === libraryOnly ? "sel" : ""}
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest("button")) return;
                startDrag(e, { kind: "library-item", data: p.id, label: p.title });
              }}
              onClick={() => !wasDragging() && onSelect(p.id)}
            >
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
    </div>
  );
}

function HeaderRow({ p }: { p: Presentation }) {
  return (
    <div className="pp-header-row">
      <span>{p.title}</span>
    </div>
  );
}

// ─────────────────────────────────────────────── Groups + arrangement bar

const editPres = (id: number, fn: (p: Presentation) => void) =>
  updateShow((d) => {
    const p = d.presentations.find((x) => x.id === id);
    if (p) fn(p);
  });

function GroupBar({ p }: { p: Presentation }) {
  const names = groupNames(p);
  const arr = p.arrangement ? p.arrangements.find((a) => a.name === p.arrangement) : undefined;
  const arrRef = useRef<HTMLDivElement>(null);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [newGroup, setNewGroup] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  useDropTarget(arrRef, ["group", "arr-item"], {
    onOver: (pt) => {
      const chips = [...(arrRef.current?.querySelectorAll(".pp-chip[data-i]") ?? [])] as HTMLElement[];
      const i = chips.findIndex((c) => {
        const r = c.getBoundingClientRect();
        return pt.y < r.bottom && pt.x < r.left + r.width / 2;
      });
      setInsertAt(i < 0 ? chips.length : i);
    },
    onLeave: () => setInsertAt(null),
    onDrop: (_pt, payload) => {
      const at = insertAt ?? arr?.sequence.length ?? 0;
      setInsertAt(null);
      void editPres(p.id, (x) => {
        let a = x.arrangements.find((y) => y.name === x.arrangement);
        if (!a) {
          // Dropping into "as written" starts a new arrangement from the written order.
          let n = 1;
          while (x.arrangements.some((y) => y.name === `Arrangement ${n}`)) n++;
          a = { name: `Arrangement ${n}`, sequence: groupNames(x).filter((g) => x.slides.some((s) => s.label === g)) };
          x.arrangements.push(a);
          x.arrangement = a.name;
        }
        if (payload.kind === "group") a.sequence.splice(at, 0, payload.data as string);
        else {
          const from = payload.data as number;
          const [g] = a.sequence.splice(from, 1);
          a.sequence.splice(at > from ? at - 1 : at, 0, g);
        }
      });
    },
  });

  const seq = arr?.sequence ?? groupNames(p).filter((g) => p.slides.some((s) => s.label === g));
  return (
    <div className="pp-groupbar">
      <div className="pp-groupbar-title">
        <span className={`kind-dot ${p.kind}`} />
        <b className="ellipsis">{p.title}</b>
        {p.ccli && <small className="muted">CCLI #{p.ccli}</small>}
      </div>
      <div className="pp-groups-row">
        <span className="pp-row-label">Groups</span>
        {names.map((g) => (
          <span key={g} className="pp-chip-wrap">
            <span
              className="pp-chip"
              style={{ background: groupColor(g, p) }}
              title="Drag into the arrangement below · click to recolour / rename"
              onPointerDown={(e) => startDrag(e, { kind: "group", data: g, label: g })}
              onClick={() => !wasDragging() && setEditing(editing === g ? null : g)}
            >
              {g}
            </span>
            {editing === g && <GroupEditor p={p} name={g} onClose={() => setEditing(null)} />}
          </span>
        ))}
        <input
          className="pp-new-group"
          placeholder="+ group"
          value={newGroup}
          onChange={(e) => setNewGroup(e.target.value)}
          onKeyDown={(e) => {
            const g = newGroup.trim();
            if (e.key === "Enter" && g && !names.includes(g)) {
              void editPres(p.id, (x) => void x.groups.push({ name: g, color: groupColor(g) }));
              setNewGroup("");
            }
          }}
        />
      </div>
      <div className="pp-groups-row">
        <select
          className="pp-arr-pick"
          value={p.arrangement ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "__new") {
              let n = 1;
              while (p.arrangements.some((y) => y.name === `Arrangement ${n}`)) n++;
              const name = `Arrangement ${n}`;
              void editPres(p.id, (x) => {
                x.arrangements.push({ name, sequence: [...seq] });
                x.arrangement = name;
              });
              setRenaming(name);
            } else void editPres(p.id, (x) => void (x.arrangement = v || null));
          }}
          title="Arrangement (saved versions of the song order)"
        >
          <option value="">As written</option>
          {p.arrangements.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name}
            </option>
          ))}
          <option value="__new">+ Save as new arrangement…</option>
        </select>
        <div className="pp-arr" ref={arrRef}>
          {seq.map((g, i) => (
            <span key={`${g}-${i}`} className={`pp-chip ${insertAt === i ? "insert-before" : ""}`} data-i={i} style={{ background: groupColor(g, p) }}>
              <span
                onPointerDown={(e) => arr && startDrag(e, { kind: "arr-item", data: i, label: g })}
                title={arr ? "Drag to reorder" : "Drag a group here to start a custom arrangement"}
              >
                {g}
              </span>
              {arr && (
                <button className="pp-chip-x" title="Remove" onClick={() => editPres(p.id, (x) => void x.arrangements.find((y) => y.name === x.arrangement)?.sequence.splice(i, 1))}>
                  ×
                </button>
              )}
            </span>
          ))}
          {insertAt === seq.length && <span className="pp-chip-insert-end" />}
          {!arr && <small className="muted">Drag groups here to build an arrangement</small>}
        </div>
        {arr && renaming === arr.name && (
          <input
            className="pp-arr-rename"
            autoFocus
            defaultValue={arr.name}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            onBlur={(e) => {
              const name = e.target.value.trim();
              setRenaming(null);
              if (name && name !== arr.name && !p.arrangements.some((y) => y.name === name))
                void editPres(p.id, (x) => {
                  const a = x.arrangements.find((y) => y.name === arr.name);
                  if (a) a.name = name;
                  x.arrangement = name;
                });
            }}
          />
        )}
        {arr && (
          <>
            <button className="icon" title="Rename this arrangement" onClick={() => setRenaming(arr.name)}>
              ✎
            </button>
            <button
              className="icon"
              title="Delete this arrangement"
              onClick={() =>
                void confirmDialog(`Delete arrangement “${arr.name}”? The slides stay.`).then(
                  (yes) =>
                    yes &&
                    void editPres(p.id, (x) => {
                      x.arrangements = x.arrangements.filter((y) => y.name !== arr.name);
                      x.arrangement = null;
                    }),
                )
              }
            >
              🗑
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function GroupEditor({ p, name, onClose }: { p: Presentation; name: string; onClose: () => void }) {
  const [n, setN] = useState(name);
  const color = groupColor(name, p);
  const save = (newName: string, newColor: string) =>
    editPres(p.id, (x) => {
      const g = x.groups.find((y) => y.name === name);
      if (g) Object.assign(g, { name: newName, color: newColor });
      else x.groups.push({ name: newName, color: newColor });
      if (newName !== name) {
        for (const s of x.slides) if (s.label === name) s.label = newName;
        for (const a of x.arrangements) a.sequence = a.sequence.map((y) => (y === name ? newName : y));
      }
    });
  return (
    <div className="popover pp-group-pop" onPointerDown={(e) => e.stopPropagation()}>
      <div className="row">
        <input value={n} onChange={(e) => setN(e.target.value)} />
        <input type="color" value={color.slice(0, 7)} onChange={(e) => void save(name, e.target.value)} />
      </div>
      <div className="row end">
        <button onClick={onClose}>Close</button>
        <button className="primary" disabled={!n.trim()} onClick={() => void save(n.trim(), color).then(onClose)}>
          Rename
        </button>
      </div>
      <small className="muted">Renaming changes every slide in this group.</small>
    </div>
  );
}

// ─────────────────────────────────────────────── Slides (Show mode)

function PresentationSection({
  p,
  show,
  focused,
  liveSlide,
  selected,
  refCb,
  onFocus,
  onEdit,
  onPick,
  cursor,
  onGo,
}: {
  p: Presentation;
  show: Show;
  focused: boolean;
  liveSlide: number | null;
  selected: SlideRef | null;
  refCb: (el: HTMLElement | null) => void;
  onFocus: () => void;
  onEdit: () => void;
  onPick: (r: SlideRef) => void;
  cursor: Cursor;
  onGo: (c: Cursor) => void;
}) {
  const theme = themeFor(show, p.id);
  const seq = sequence(p);
  // If we know which repeat is live, light only that one.
  const cursorHere = cursor?.p === p.id && seq.some((x) => x.pos === cursor.pos && x.slide.id === liveSlide);
  return (
    <section className={`pp-pres ${focused ? "focused" : ""} ${liveSlide != null ? "has-live" : ""}`} ref={refCb} onMouseDown={onFocus}>
      <header className="pp-pres-head">
        <span className={`kind-dot ${p.kind}`} />
        <h2 className="ellipsis">{p.title}</h2>
        {p.arrangement && <span className="tag">{p.arrangement}</span>}
        <span className="grow" />
        <select
          className="pp-theme-pick"
          value={theme.name}
          title="Theme for this presentation"
          onChange={(e) => editPres(p.id, (x) => void (x.theme = e.target.value))}
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
        {seq.map(({ slide, pos }) => (
          <SlideTile
            key={`${slide.id}-${pos}`}
            p={p}
            slide={slide}
            num={pos + 1}
            show={show}
            theme={theme}
            bg={slideMedia(show, slide)}
            live={liveSlide === slide.id && (!cursorHere || cursor?.pos === pos)}
            selected={selected?.p === p.id && selected.s === slide.id}
            onPick={() => onPick({ p: p.id, s: slide.id })}
            onGo={() => onGo({ p: p.id, pos })}
          />
        ))}
        {p.slides.length === 0 && <div className="muted pp-empty-pres">No slides — press ✎ to add some.</div>}
      </div>
    </section>
  );
}

/** One slide. Click = go live. Drop media / props / macros on it to attach them. */
function SlideTile({
  p,
  slide,
  num,
  show,
  theme,
  bg,
  live,
  selected,
  onPick,
  onGo,
}: {
  p: Presentation;
  slide: Slide;
  num: number;
  show: Show;
  theme: ReturnType<typeof themeFor>;
  bg: ReturnType<typeof mediaById>;
  live: boolean;
  selected: boolean;
  onPick: () => void;
  onGo: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  useDropTarget(ref, ["media", "prop", "macro"], {
    onOver: () => setOver(true),
    onLeave: () => setOver(false),
    onDrop: (_pt, payload) => {
      setOver(false);
      const t: SlideTrigger =
        payload.kind === "media"
          ? (show.media.find((m) => m.id === payload.data)?.kind === "audio"
            ? { type: "audio", audio: payload.data as number, looped: false }
            : { type: "media", media: payload.data as number })
          : payload.kind === "prop"
            ? { type: "prop", prop: payload.data as number, on: true }
            : { type: "macro", id: payload.data as number };
      void editPres(p.id, (x) => {
        const s = x.slides.find((y) => y.id === slide.id);
        if (!s) return;
        // One background per slide: a new media replaces the old one.
        if (t.type === "media") s.triggers = s.triggers.filter((y) => y.type !== "media");
        s.triggers.push(t);
      });
      pushLog("info", `Added ${triggerLabel(t, show)} to “${slide.label}”`);
    },
  });
  return (
    <div
      ref={ref}
      className={`pp-slide ${live ? "live" : ""} ${selected ? "focused" : ""} ${over ? "drop-over" : ""}`}
      onClick={() => {
        onGo();
        void send({ type: "go_slide", presentation: p.id, slide: slide.id });
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onPick();
      }}
    >
      <div className="pp-thumb">
        <SlideRender text={slide.text} theme={theme} background={bg} transparent />
        {slide.triggers.length > 0 && (
          <div className="pp-badges">
            {slide.triggers.slice(0, 3).map((t, k) => (
              <span key={k} className="badge">
                {triggerLabel(t, show)}
              </span>
            ))}
            {slide.triggers.length > 3 && <span className="badge">+{slide.triggers.length - 3} more</span>}
          </div>
        )}
      </div>
      <div className="pp-label" style={{ ["--group" as string]: groupColor(slide.label, p) }}>
        <span className="num">{num}</span>
        <span className="grow ellipsis">{slide.label}</span>
        <button
          className="icon light"
          title="Slide actions — or right-click"
          onClick={(e) => {
            e.stopPropagation();
            onPick();
          }}
        >
          ⚙
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── Edit mode

const editSlides = (pid: number, fn: (slides: Slide[]) => Slide[]) => editPres(pid, (p) => void (p.slides = fn(p.slides)));
const nextSlideId = (slides: Slide[]) => Math.max(0, ...slides.map((s) => s.id)) + 1;

function EditPresentation({ p, show }: { p: Presentation; show: Show }) {
  const set = (patch: Partial<Presentation>) => editPres(p.id, (x) => void Object.assign(x, patch));
  const theme = themeFor(show, p.id);
  const names = groupNames(p);
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
      <datalist id="slide-labels">
        {[...new Set([...names, "Intro", "Verse 1", "Verse 2", "Verse 3", "Pre-Chorus", "Chorus", "Bridge", "Tag", "Outro", "Blank"])].map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
      <div className="pp-grid">
        {p.slides.map((s, i) => (
          <SlideEditCard key={s.id} p={p} slide={s} index={i} theme={theme} show={show} />
        ))}
        <button
          className="pp-add-slide"
          onClick={() => editSlides(p.id, (ss) => [...ss, { id: nextSlideId(ss), label: ss[ss.length - 1]?.label ?? "Verse 1", text: "", triggers: [] }])}
        >
          + Add slide
        </button>
      </div>
    </section>
  );
}

function SlideEditCard({ p, slide, index, theme, show }: { p: Presentation; slide: Slide; index: number; theme: ReturnType<typeof themeFor>; show: Show }) {
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
        <SlideRender text={slide.text} theme={theme} background={slideMedia(show, slide)} transparent />
      </div>
      <div className="pp-label" style={{ ["--group" as string]: groupColor(slide.label, p) }}>
        <span className="num">{index + 1}</span>
        <input className="label-input" list="slide-labels" value={slide.label} onChange={(e) => void set({ label: e.target.value })} />
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

// ─────────────────────────────────────────────── Reflow (all words, with groups)

function Reflow({ p, onDone }: { p: Presentation; onDone: () => void }) {
  const [text, setText] = useState(() => p.slides.map((s) => `[${s.label}]\n${s.text}`).join("\n\n"));
  const [lines, setLines] = useState(0);
  const [saveVersion, setSaveVersion] = useState("");
  const ta = useRef<HTMLTextAreaElement>(null);
  const names = groupNames(p);
  const { show } = useEngine();
  const theme = themeFor(show, p.id);

  // Live preview: re-parse a moment after typing stops, with the same parser Apply uses.
  const [preview, setPreview] = useState<Slide[]>(p.slides);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      api
        .parseLyrics(p.title, text, lines || 99)
        .then((r) => {
          setPreview(r.slides);
          setPreviewErr(null);
        })
        .catch((e) => setPreviewErr(String(e)));
    }, 250);
    return () => clearTimeout(t);
  }, [text, lines, p.title]);
  /** The n-th slide of a group keeps the media it had (matched by group and position in it). */
  const mediaFor = (s: Slide, i: number) => {
    const nth = preview.slice(0, i).filter((x) => x.label === s.label).length;
    const groupFirst = preview.findIndex((x) => x.label === s.label);
    const blockLen = preview.slice(groupFirst).findIndex((x) => x.label !== s.label);
    const idxInGroup = blockLen > 0 ? nth % blockLen : nth;
    const old = p.slides.filter((x) => x.label === s.label)[idxInGroup];
    return slideMedia(show, old);
  };
  /** Click a preview: put the cursor on that slide's text. */
  const jumpTo = (s: Slide) => {
    const el = ta.current;
    const first = s.text.split("\n")[0];
    if (!el || !first) return;
    const head = text.indexOf(`[${s.label}]`);
    const at = text.indexOf(first, Math.max(0, head));
    if (at < 0) return;
    el.focus();
    el.setSelectionRange(at, at + first.length);
    // Scroll the textarea so the selection is visible.
    const linesBefore = text.slice(0, at).split("\n").length;
    el.scrollTop = Math.max(0, (linesBefore - 4) * (el.scrollHeight / Math.max(1, text.split("\n").length)));
  };

  /** Insert a group header at the cursor (on its own line). */
  const insertGroup = (g: string) => {
    const el = ta.current;
    if (!el) return;
    const at = el.selectionStart;
    const before = text.slice(0, at);
    const pre = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
    const ins = `${pre}[${g}]\n`;
    setText(before + ins + text.slice(at));
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = at + ins.length;
    });
  };

  const apply = async () => {
    try {
      const parsed = await api.parseLyrics(p.title, text, lines || 99);
      // The order groups appear in the text = this version's arrangement.
      const order: string[] = [];
      let prev = "";
      for (const s of parsed.slides) if (s.label !== prev) (order.push(s.label), (prev = s.label));
      // Repeated sections keep one copy of their slides; the repeat lives in the arrangement.
      const seen = new Set<string>();
      const firstOrder: string[] = [];
      for (const g of order) if (!seen.has(g)) (seen.add(g), firstOrder.push(g));
      const repeats = order.length !== firstOrder.length;
      const kept = parsed.slides.filter((s, i, all) => {
        const firstIdx = all.findIndex((x) => x.label === s.label);
        const blockEnd = all.findIndex((x, j) => j > firstIdx && x.label !== s.label);
        return i >= firstIdx && (blockEnd < 0 || i < blockEnd);
      });
      await editPres(p.id, (x) => {
        x.slides = kept.map((s, i) => ({ ...s, id: i + 1, triggers: x.slides[i]?.triggers ?? [] }));
        const vname = saveVersion.trim();
        if (vname || repeats) {
          const name = vname || "From Reflow";
          x.arrangements = [...x.arrangements.filter((a) => a.name !== name), { name, sequence: order }];
          x.arrangement = name;
        }
      });
      onDone();
    } catch (e) {
      pushLog("warn", String(e));
    }
  };

  return (
    <section className="pp-reflow">
      <div className="pp-reflow-groups">
        <span className="pp-row-label">Insert group</span>
        {[...new Set([...names, "Intro", "Verse 1", "Verse 2", "Pre-Chorus", "Chorus", "Bridge", "Tag", "Outro", "Blank"])].map((g) => (
          <button key={g} className="pp-chip" style={{ background: groupColor(g, p) }} onClick={() => insertGroup(g)}>
            {g}
          </button>
        ))}
      </div>
      <div className="pp-reflow-split">
        <textarea ref={ta} value={text} onChange={(e) => setText(e.target.value)} spellCheck />
        <div className="pp-reflow-preview">
          {previewErr && <div className="warn">{previewErr}</div>}
          {preview.map((s, i) => (
            <div key={i} className="pp-slide" onClick={() => jumpTo(s)} title="Click to find this slide's text">
              <div className="pp-thumb">
                <SlideRender text={s.text} theme={theme} background={mediaFor(s, i)} transparent />
              </div>
              <div className="pp-label" style={{ ["--group" as string]: groupColor(s.label, p) }}>
                <span className="num">{i + 1}</span>
                <span className="grow ellipsis">{s.label}</span>
              </div>
            </div>
          ))}
          {preview.length === 0 && !previewErr && <p className="muted">No slides yet — type lyrics on the left.</p>}
        </div>
      </div>
      <p className="muted">
        Each <code>[Group]</code> starts a section; a blank line inside it starts a new slide. Write a section a second time (e.g. <code>[Chorus]</code>{" "}
        again) and it becomes a repeat in the arrangement, not a duplicate slide.
      </p>
      <div className="row end wrap">
        <label className="inline muted">
          Save this order as version
          <input placeholder="e.g. Sunday, Acoustic" value={saveVersion} onChange={(e) => setSaveVersion(e.target.value)} />
        </label>
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
        <textarea rows={16} value={lyrics} onChange={(e) => setLyrics(e.target.value)} placeholder={"[Verse 1]\nFirst line\nSecond line\n\n[Chorus]\n…"} />
        <small>
          Section headers like <code>[Verse 1]</code>, <code>Chorus:</code> or <code>Verse 2</code> become groups; a blank line starts a new slide. Change
          anything afterwards with <b>Edit</b> or <b>Reflow</b>.
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
