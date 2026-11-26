// Presenter's left column: Library (several libraries), Services (shows on this computer)
// and the open show's Service order. Laid out by layout.tsx PaneColumn.

import { useEffect, useRef, useState } from "react";
import { api, confirmDialog, showFiles } from "../../shared/bridge";
import { startDrag, useDropTarget, wasDragging } from "../../shared/drag";
import { pushLog, updateShow } from "../../shared/store";
import type {
  Presentation,
  PresentationKind,
  RecentShow,
  Show,
} from "../../shared/types";
import { newSlide } from "./render";

export const BUILT_IN_LIBRARIES = ["Default", "Songs", "Scripture"];

/** The library a presentation shows in (mirrors Presentation::library_name in Rust). */
export function libraryOf(p: Presentation): string {
  if (p.library) return p.library;
  return p.kind === "song"
    ? "Songs"
    : p.kind === "scripture"
      ? "Scripture"
      : "Default";
}

export function libraryNames(show: Show): string[] {
  const out = [...BUILT_IN_LIBRARIES];
  for (const l of [
    ...show.libraries,
    ...show.presentations.filter((p) => p.kind !== "header").map(libraryOf),
  ])
    if (!out.includes(l)) out.push(l);
  return out;
}

/** New blank presentation (announcement / scripture / header), filed in `library` when given. */
export function newPresentation(
  show: Show,
  kind: PresentationKind,
  library: string,
  addToService: boolean,
): Promise<number> {
  const id = Math.max(0, ...show.presentations.map((p) => p.id)) + 1;
  const title =
    kind === "scripture"
      ? "New scripture"
      : kind === "header"
        ? "New section"
        : "New announcement";
  const theme =
    kind === "scripture" && show.themes.some((t) => t.name === "Scripture")
      ? "Scripture"
      : (show.themes[0]?.name ?? "Default");
  return updateShow((d) => {
    d.presentations.push({
      id,
      title,
      kind,
      ccli: null,
      theme,
      groups: [],
      arrangements: [],
      arrangement: null,
      library: BUILT_IN_LIBRARIES.includes(library) ? "" : library,
      slides:
        kind === "header"
          ? []
          : [newSlide(1, kind === "scripture" ? "Reading" : "Welcome")],
    });
    if (addToService) d.playlist.push(id);
  }).then(() => id);
}

// ─────────────────────────────────────────────── Library

export function LibraryActions({
  show,
  onImport,
  activeLib,
  onNew,
}: {
  show: Show;
  onImport: () => void;
  activeLib: string;
  onNew: (id: number) => void;
}) {
  return (
    <div className="seg small pp-lib-add">
      <button onClick={onImport} title="Paste lyrics">
        + Song
      </button>
      <button
        onClick={() =>
          void newPresentation(show, "announcement", activeLib, true).then(
            onNew,
          )
        }
        title={`Blank presentation (in ${activeLib})`}
      >
        + Slides
      </button>
      <button
        onClick={() =>
          void newPresentation(show, "scripture", activeLib, true).then(onNew)
        }
        title="Scripture reading"
      >
        + Scripture
      </button>
    </div>
  );
}

export function LibraryBody({
  show,
  selected,
  onSelect,
  activeLib,
  setActiveLib,
}: {
  show: Show;
  selected: number | null;
  onSelect: (id: number) => void;
  activeLib: string;
  setActiveLib: (l: string) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [naming, setNaming] = useState<{
    old: string | null;
    text: string;
  } | null>(null);
  const names = libraryNames(show);
  const items = show.presentations
    .filter(
      (p) =>
        p.kind !== "header" && p.title.toLowerCase().includes(q.toLowerCase()),
    )
    .sort((a, b) => a.title.localeCompare(b.title));

  const saveName = () => {
    if (!naming) return;
    const name = naming.text.trim();
    setNaming(null);
    if (!name || (names.includes(name) && name !== naming.old)) return;
    void updateShow((d) => {
      if (naming.old == null) d.libraries.push(name);
      else {
        d.libraries = d.libraries.map((l) => (l === naming.old ? name : l));
        for (const p of d.presentations)
          if (p.library === naming.old) p.library = name;
      }
    });
    setActiveLib(name);
  };
  const removeLibrary = (name: string) =>
    void confirmDialog(
      `Remove the library “${name}”? Its presentations move back to Default / Songs / Scripture (nothing is deleted).`,
    ).then((yes) => {
      if (!yes) return;
      void updateShow((d) => {
        d.libraries = d.libraries.filter((l) => l !== name);
        for (const p of d.presentations) if (p.library === name) p.library = "";
      });
      if (activeLib === name) setActiveLib("Default");
    });

  return (
    <div className="pp-lib">
      <div className="row pp-lib-tools">
        <input
          className="search grow"
          placeholder="Search all libraries…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          className="icon"
          title="New library (e.g. Christmas, Kids, Announcements)"
          onClick={() => setNaming({ old: null, text: "" })}
        >
          + Library
        </button>
      </div>
      {naming && (
        <input
          className="pp-lib-name"
          autoFocus
          placeholder="Library name"
          value={naming.text}
          onChange={(e) => setNaming({ ...naming, text: e.target.value })}
          onKeyDown={(e) =>
            e.key === "Enter"
              ? saveName()
              : e.key === "Escape" && setNaming(null)
          }
          onBlur={saveName}
        />
      )}
      <div className="pp-lib-groups">
        {names.map((name) => {
          const inLib = items.filter((p) => libraryOf(p) === name);
          if (q && inLib.length === 0) return null;
          const isOpen = q
            ? true
            : (open[name] ?? (name === activeLib || inLib.length <= 6));
          return (
            <LibraryGroup
              key={name}
              name={name}
              items={inLib}
              open={isOpen}
              active={name === activeLib}
              custom={!BUILT_IN_LIBRARIES.includes(name)}
              selected={selected}
              onToggle={() => {
                setOpen((o) => ({ ...o, [name]: !isOpen }));
                setActiveLib(name);
              }}
              onSelect={onSelect}
              onRename={() => setNaming({ old: name, text: name })}
              onRemove={() => removeLibrary(name)}
            />
          );
        })}
      </div>
    </div>
  );
}

function LibraryGroup({
  name,
  items,
  open,
  active,
  custom,
  selected,
  onToggle,
  onSelect,
  onRename,
  onRemove,
}: {
  name: string;
  items: Presentation[];
  open: boolean;
  active: boolean;
  custom: boolean;
  selected: number | null;
  onToggle: () => void;
  onSelect: (id: number) => void;
  onRename: () => void;
  onRemove: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  // Drag a presentation onto a library to file it there.
  useDropTarget(ref, ["library-item"], {
    onOver: () => setOver(true),
    onLeave: () => setOver(false),
    onDrop: (_pt, p) => {
      setOver(false);
      void updateShow((d) => {
        const x = d.presentations.find((y) => y.id === p.data);
        if (x)
          x.library =
            BUILT_IN_LIBRARIES.includes(name) &&
            libraryOf({ ...x, library: "" }) === name
              ? ""
              : name;
      });
    },
  });
  return (
    <div ref={ref} className={`pp-lib-group ${over ? "drop-over" : ""}`}>
      <div
        className={`pp-lib-head ${active ? "active" : ""}`}
        onClick={onToggle}
        title="Click to open / close · drop a presentation here to file it"
      >
        <span className="pp-lib-chev">{open ? "▾" : "▸"}</span>
        <span className="pp-lib-icon">
          {name === "Songs" ? "♫" : name === "Scripture" ? "✝" : "▤"}
        </span>
        <span className="grow ellipsis">{name}</span>
        <small className="muted">{items.length}</small>
        {custom && (
          <>
            <button
              className="icon"
              title="Rename library"
              onClick={(e) => {
                e.stopPropagation();
                onRename();
              }}
            >
              ✎
            </button>
            <button
              className="icon"
              title="Remove library (keeps its presentations)"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
            >
              ✕
            </button>
          </>
        )}
      </div>
      {open && (
        <ul className="pp-list">
          {items.map((p) => (
            <LibraryRow
              key={p.id}
              p={p}
              selected={p.id === selected}
              onSelect={onSelect}
            />
          ))}
          {items.length === 0 && (
            <li className="muted hint">Empty — drag presentations here</li>
          )}
        </ul>
      )}
    </div>
  );
}

function LibraryRow({
  p,
  selected,
  onSelect,
}: {
  p: Presentation;
  selected: boolean;
  onSelect: (id: number) => void;
}) {
  return (
    <li
      className={selected ? "sel" : ""}
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
          void confirmDialog(`Delete “${p.title}” from the library?`).then(
            (yes) => {
              if (yes)
                void updateShow((d) => {
                  d.presentations = d.presentations.filter(
                    (x) => x.id !== p.id,
                  );
                  d.playlist = d.playlist.filter((x) => x !== p.id);
                });
            },
          );
        }}
      >
        🗑
      </button>
    </li>
  );
}

// ─────────────────────────────────────────────── Services (shows on this computer)

const stem = (path: string) =>
  path
    .split(/[\\/]/)
    .pop()
    ?.replace(/(\.show)?\.json$/i, "") ?? path;

function when(ms: number) {
  const d = new Date(ms);
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days < 1)
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function useRecentShows(show: Show) {
  const [list, setList] = useState<RecentShow[]>([]);
  const refresh = () =>
    void api
      .recentShows()
      .then((l) => setList(l ?? []))
      .catch(() => {});
  useEffect(() => {
    refresh();
    // Saves from the top bar (Save / Open) land here within a few seconds.
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [show.name]);
  return { list, refresh };
}

export function ServicesActions({ refresh }: { refresh: () => void }) {
  return (
    <>
      <button
        className="icon"
        title="Save the open show as a new service file"
        onClick={async () => {
          const path = await showFiles.save("Sunday service.json");
          if (!path) return;
          await api
            .saveShow(path)
            .then(() => pushLog("info", `Saved ${stem(path)}`))
            .catch((e) => pushLog("warn", String(e)));
          refresh();
        }}
      >
        + Save as
      </button>
      <button
        className="icon"
        title="Open a show file from disk"
        onClick={async () => {
          const path = await showFiles.open();
          if (!path) return;
          await api.openShow(path).catch((e) => pushLog("warn", String(e)));
          refresh();
        }}
      >
        Open…
      </button>
    </>
  );
}

export function ServicesBody({
  list,
  refresh,
}: {
  list: RecentShow[];
  refresh: () => void;
}) {
  const current = list.find((r) => r.current);
  const switchTo = async (r: RecentShow) => {
    if (r.current || wasDragging()) return;
    if (!r.exists)
      return pushLog(
        "warn",
        `“${stem(r.path)}” isn't at ${r.path} any more — was it moved or deleted?`,
      );
    if (current) {
      // Keep the open service's changes before switching (like ProPresenter, which saves as you go).
      try {
        await api.saveShow();
      } catch (e) {
        pushLog("warn", `Couldn't save “${stem(current.path)}” first: ${e}`);
        return;
      }
    } else if (
      !(await confirmDialog(
        `Open “${stem(r.path)}”?\n\nThe show that's open now has never been saved to a file, so any changes to it will be lost. Cancel, then use Save first to keep them.`,
      ))
    ) {
      return;
    }
    try {
      await api.openShow(r.path);
      pushLog("info", `Opened ${stem(r.path)}`);
    } catch (e) {
      pushLog("warn", String(e));
    }
    refresh();
  };
  return (
    <ul className="pp-list pp-services">
      {list.map((r) => (
        <li
          key={r.path}
          className={`${r.current ? "sel" : ""} ${r.exists ? "" : "missing"}`}
          onClick={() => void switchTo(r)}
          title={r.path}
        >
          <span className="pp-svc-icon">{r.current ? "●" : "▢"}</span>
          <span className="grow ellipsis">{stem(r.path)}</span>
          <small className="muted">
            {r.exists ? when(r.used_at) : "moved?"}
          </small>
          <button
            className="icon"
            title="Take off this list (the file stays on disk)"
            onClick={(e) => {
              e.stopPropagation();
              void api.forgetRecentShow(r.path).then(refresh);
            }}
          >
            ✕
          </button>
        </li>
      ))}
      {list.length === 0 && (
        <li className="muted hint">
          Shows you save or open appear here — click one to switch to it.
        </li>
      )}
    </ul>
  );
}

// ─────────────────────────────────────────────── Service (the open show's running order)

export function ServiceBody({
  show,
  playlist,
  current,
  liveId,
  libraryOnly,
  onSelect,
}: {
  show: Show;
  playlist: Presentation[];
  current?: number;
  liveId?: number;
  libraryOnly: number | null;
  onSelect: (id: number) => void;
}) {
  const [dragOver, setDragOver] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  void show;

  // Drag service items to reorder; drag library items in to add.
  useDropTarget(listRef, ["service-item", "library-item"], {
    onOver: (pt) => {
      const rows = [
        ...(listRef.current?.querySelectorAll("li[data-i]") ?? []),
      ] as HTMLElement[];
      const i = rows.findIndex(
        (r) => pt.y < r.getBoundingClientRect().top + r.offsetHeight / 2,
      );
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

  return (
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
          onClick={() =>
            !wasDragging() && p.kind !== "header" && onSelect(p.id)
          }
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
                if (p.kind === "header")
                  d.presentations = d.presentations.filter(
                    (x) => x.id !== p.id,
                  );
              });
            }}
          >
            −
          </button>
        </li>
      ))}
      {dragOver === playlist.length && <li className="drop-before end" />}
      {playlist.length === 0 && (
        <li className="muted hint">
          Drag songs here from the Library, or press + on one
        </li>
      )}
    </ol>
  );
}

export { stem as serviceName };
