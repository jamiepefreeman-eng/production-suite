// Resizable, hideable side panels for the Presenter.
//
//  * Side columns: drag their inner edge to resize; hide them from the toolbar.
//  * Inside a column, sections (Library, Services, Service, Media…) share the height. Drag the bar between
//    two sections to give one more room; click a section's ▾ to fold it down to its title.
// Everything is remembered per computer (localStorage).

import { useEffect, useRef, useState } from "react";

export interface Layout {
  leftW: number;
  rightW: number;
  leftHidden: boolean;
  rightHidden: boolean;
  /** Share of the column's height per section. */
  weights: Record<string, number>;
  collapsed: Record<string, boolean>;
}

const KEY = "presenter.layout.v2";
const DEFAULT: Layout = {
  leftW: 260,
  rightW: 340,
  leftHidden: false,
  rightHidden: false,
  weights: {
    library: 3,
    services: 1.2,
    service: 2.2,
    media: 1.6,
    live: 2,
    tabs: 3,
  },
  collapsed: {},
};

function load(): Layout {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && typeof v === "object")
      return {
        ...DEFAULT,
        ...v,
        weights: { ...DEFAULT.weights, ...v.weights },
        collapsed: { ...v.collapsed },
      };
  } catch {
    /* fall through */
  }
  return DEFAULT;
}

export function useLayout() {
  const [layout, setLayout] = useState<Layout>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(layout));
    } catch {
      /* storage unavailable: fine */
    }
  }, [layout]);
  const update = (patch: Partial<Layout> | ((l: Layout) => Partial<Layout>)) =>
    setLayout((l) => ({
      ...l,
      ...(typeof patch === "function" ? patch(l) : patch),
    }));
  return { layout, update, reset: () => setLayout(DEFAULT) };
}

/** Pointer-drag helper: calls onMove with the distance from where the drag started. */
function dragFrom(
  e: React.PointerEvent,
  axis: "x" | "y",
  onMove: (d: number) => void,
  onEnd?: () => void,
) {
  if (e.button !== 0) return;
  e.preventDefault();
  const start = axis === "x" ? e.clientX : e.clientY;
  document.body.classList.add(axis === "x" ? "resizing-x" : "resizing-y");
  const move = (ev: PointerEvent) =>
    onMove((axis === "x" ? ev.clientX : ev.clientY) - start);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    document.body.classList.remove("resizing-x", "resizing-y");
    onEnd?.();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/** Vertical bar on a column's edge: drag to change the column's width. */
export function WidthHandle({
  side,
  width,
  onWidth,
}: {
  side: "left" | "right";
  width: number;
  onWidth: (w: number) => void;
}) {
  return (
    <div
      className={`pp-width-handle ${side}`}
      title="Drag to resize · double-click for the normal width"
      onDoubleClick={() =>
        onWidth(side === "left" ? DEFAULT.leftW : DEFAULT.rightW)
      }
      onPointerDown={(e) => {
        const w0 = width;
        dragFrom(e, "x", (dx) =>
          onWidth(
            Math.round(
              Math.max(180, Math.min(620, side === "left" ? w0 + dx : w0 - dx)),
            ),
          ),
        );
      }}
    />
  );
}

export interface Pane {
  id: string;
  title: React.ReactNode;
  /** Buttons on the section's title bar. */
  actions?: React.ReactNode;
  body: React.ReactNode;
  /** Can't be folded (e.g. the Live preview). */
  fixed?: boolean;
}

/** A column of sections sharing its height. */
export function PaneColumn({
  panes,
  layout,
  update,
}: {
  panes: Pane[];
  layout: Layout;
  update: ReturnType<typeof useLayout>["update"];
}) {
  const col = useRef<HTMLDivElement>(null);
  const open = panes.filter((p) => !layout.collapsed[p.id]);
  const w = (id: string) => layout.weights[id] ?? 1;

  /** Drag the bar under pane `a` (between a and the next open pane b). */
  const resize = (e: React.PointerEvent, a: string, b: string) => {
    const el = col.current;
    if (!el) return;
    // Pixels per weight unit, from the open panes' current share of the column.
    const total = open.reduce((s, p) => s + w(p.id), 0);
    const pxPerW = el.getBoundingClientRect().height / Math.max(0.001, total);
    const wa = w(a);
    const wb = w(b);
    dragFrom(e, "y", (dy) => {
      const d = dy / pxPerW;
      const min = 0.25;
      const na = Math.max(min, Math.min(wa + wb - min, wa + d));
      update((l) => ({
        weights: { ...l.weights, [a]: na, [b]: wa + wb - na },
      }));
    });
  };

  return (
    <div className="pp-panes" ref={col}>
      {panes.map((p) => {
        const folded = !!layout.collapsed[p.id];
        const idx = open.findIndex((x) => x.id === p.id);
        const next = idx >= 0 ? open[idx + 1] : undefined;
        return (
          <div
            key={p.id}
            className={`pp-pane ${folded ? "folded" : ""}`}
            style={folded ? undefined : { flexGrow: w(p.id) }}
          >
            <header className="pp-pane-head">
              {!p.fixed && (
                <button
                  className="icon pp-fold"
                  title={folded ? "Show this section" : "Fold this section"}
                  onClick={() =>
                    update((l) => ({
                      collapsed: { ...l.collapsed, [p.id]: !folded },
                    }))
                  }
                >
                  {folded ? "▸" : "▾"}
                </button>
              )}
              <h3>{p.title}</h3>
              <span className="grow" />
              {!folded && p.actions}
            </header>
            {!folded && <div className="pp-pane-body">{p.body}</div>}
            {!folded && next && (
              <div
                className="pp-pane-handle"
                title="Drag to resize"
                onPointerDown={(e) => resize(e, p.id, next.id)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
