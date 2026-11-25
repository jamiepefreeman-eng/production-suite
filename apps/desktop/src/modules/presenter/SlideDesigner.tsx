// Edit › Design: a big preview of one slide where you format its text (font, size, colour…)
// and place text boxes, shapes, pictures, videos and live feeds — drag to move, pull the
// corner handles to resize. What you see is SlideRender, the same renderer as the outputs.

import { useEffect, useRef, useState } from "react";
import { useDropTarget } from "../../shared/drag";
import { pushLog } from "../../shared/store";
import type { ElementKind, Presentation, Show, Slide, SlideElement, TextAlign, TextPosition, TextStyle, Theme } from "../../shared/types";
import { EMPTY_STYLE, FONTS, SlideRender, mediaById, slideElements, slideMedia, styledTheme } from "./render";

type Sel = number | "text" | null;
type Box = Pick<SlideElement, "x" | "y" | "w" | "h">;

const ELEMENT_DEFAULTS: SlideElement = {
  id: 0,
  kind: "text",
  x: 0.3,
  y: 0.4,
  w: 0.4,
  h: 0.2,
  text: "",
  media: null,
  font: "Inter",
  size: 6,
  color: "#ffffff",
  bold: false,
  italic: false,
  align: "center",
  background: "",
  radius: 0,
  opacity: 1,
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** Snap to the frame's centre lines and edges when close. */
const snap = (v: number) => {
  for (const t of [0, 0.5, 1]) if (Math.abs(v - t) < 0.012) return t;
  return r3(v);
};

export default function SlideDesigner({
  p,
  slide,
  show,
  theme,
  edit,
  onPrev,
  onNext,
  onClose,
}: {
  p: Presentation;
  slide: Slide;
  show: Show;
  theme: Theme;
  /** Change this slide (sent through updateShow). */
  edit: (fn: (s: Slide) => void) => Promise<void>;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
}) {
  const [sel, setSel] = useState<Sel>("text");
  const [drag, setDrag] = useState<{ id: number; box: Box } | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const style = slide.style ?? EMPTY_STYLE;
  const look = styledTheme(theme, style);
  const elements = slide.elements ?? [];
  const selEl = typeof sel === "number" ? elements.find((e) => e.id === sel) : undefined;

  useEffect(() => setSel("text"), [slide.id]);

  const setStyle = (patch: Partial<TextStyle>) => edit((s) => void (s.style = { ...(s.style ?? EMPTY_STYLE), ...patch }));
  const setEl = (id: number, patch: Partial<SlideElement>) =>
    edit((s) => {
      const e = s.elements.find((x) => x.id === id);
      if (e) Object.assign(e, patch);
    });
  const addEl = (kind: ElementKind, extra: Partial<SlideElement> = {}) => {
    const id = Math.max(0, ...elements.map((e) => e.id)) + 1;
    const base: SlideElement =
      kind === "text"
        ? { ...ELEMENT_DEFAULTS, id, kind, text: "Text", font: look.font, color: look.color, bold: look.bold }
        : kind === "shape"
          ? { ...ELEMENT_DEFAULTS, id, kind, x: 0.1, y: 0.75, w: 0.8, h: 0.15, background: "#000000", opacity: 0.6, radius: 12 }
          : { ...ELEMENT_DEFAULTS, id, kind, x: 0.55, y: 0.1, w: 0.4, h: 0.4 };
    void edit((s) => void (s.elements = [...(s.elements ?? []), { ...base, ...extra }])).then(() => setSel(id));
  };
  const removeEl = (id: number) => {
    void edit((s) => void (s.elements = s.elements.filter((e) => e.id !== id)));
    setSel("text");
  };
  const reorder = (id: number, d: 1 | -1) =>
    edit((s) => {
      const i = s.elements.findIndex((e) => e.id === id);
      const j = i + d;
      if (i < 0 || j < 0 || j >= s.elements.length) return;
      [s.elements[i], s.elements[j]] = [s.elements[j], s.elements[i]];
    });

  // Delete / arrow keys for the selected element.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typeof sel !== "number" || (e.target as HTMLElement)?.closest("input, textarea, select")) return;
      const el = elements.find((x) => x.id === sel);
      if (!el) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeEl(sel);
      }
      const step = e.shiftKey ? 0.05 : 0.005;
      const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (d[e.key]) {
        e.preventDefault();
        void setEl(sel, { x: r3(el.x + d[e.key][0]), y: r3(el.y + d[e.key][1]) });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Media dragged from the bin onto the big preview becomes a picture / video / live feed there.
  const [over, setOver] = useState(false);
  useDropTarget(canvas, ["media"], {
    onOver: () => setOver(true),
    onLeave: () => setOver(false),
    onDrop: (pt, payload) => {
      setOver(false);
      const m = mediaById(show, payload.data as number);
      const r = canvas.current?.getBoundingClientRect();
      if (!m || !r) return;
      if (m.kind === "audio") {
        pushLog("warn", "Audio can't go on a slide as an element — drop it on a slide tile to play it as a cue");
        return;
      }
      const w = 0.4;
      const h = 0.4;
      addEl("media", { media: m.id, x: snap(clamp((pt.x - r.left) / r.width - w / 2, 0, 1 - w)), y: snap(clamp((pt.y - r.top) / r.height - h / 2, 0, 1 - h)), w, h });
    },
  });

  /** Move (mode "move") or resize from a corner / edge (mode = which edges). */
  const startBox = (e: React.PointerEvent, el: SlideElement, mode: string) => {
    if (e.button !== 0 || !canvas.current) return;
    e.preventDefault();
    e.stopPropagation();
    setSel(el.id);
    const r = canvas.current.getBoundingClientRect();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const start: Box = { x: el.x, y: el.y, w: el.w, h: el.h };
    let box = start;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / r.width;
      const dy = (ev.clientY - y0) / r.height;
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
      moved = true;
      if (mode === "move") {
        box = { ...start, x: snap(start.x + dx), y: snap(start.y + dy) };
        // Snap the far edges and centre too.
        const cx = snap(box.x + box.w / 2) - box.w / 2;
        if (cx !== box.x + box.w / 2 - box.w / 2) box.x = r3(cx);
        const right = snap(box.x + box.w);
        box.x = r3(right - box.w);
      } else {
        let { x, y, w, h } = start;
        if (mode.includes("w")) (x = snap(start.x + dx)), (w = start.w + (start.x - x));
        if (mode.includes("e")) w = snap(start.x + start.w + dx) - start.x;
        if (mode.includes("n")) (y = snap(start.y + dy)), (h = start.h + (start.y - y));
        if (mode.includes("s")) h = snap(start.y + start.h + dy) - start.y;
        box = { x: r3(x), y: r3(y), w: r3(Math.max(0.02, w)), h: r3(Math.max(0.02, h)) };
      }
      setDrag({ id: el.id, box });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (moved) void setEl(el.id, box);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const shown = elements.map((e) => (drag?.id === e.id ? { ...e, ...drag.box } : e));
  const inputs = show.media.filter((m) => m.kind === "input");
  const pictures = show.media.filter((m) => m.kind === "image" || m.kind === "video");

  return (
    <section className="pd">
      <header className="pd-head">
        <button className="icon" disabled={!onPrev} onClick={onPrev} title="Previous slide">
          ◀
        </button>
        <b className="ellipsis">
          {p.title} · {slide.label}
        </b>
        <button className="icon" disabled={!onNext} onClick={onNext} title="Next slide">
          ▶
        </button>
        <span className="grow" />
        <span className="pd-add">
          Add
          <button onClick={() => addEl("text")} title="A text box you can place anywhere">
            T Text box
          </button>
          <button onClick={() => addEl("shape")} title="A coloured box — e.g. a band behind text">
            ▭ Shape
          </button>
          <button onClick={() => addEl("media", { media: pictures[0]?.id ?? null })} title="Picture or video from the media bin (or drag one from the bin onto the slide)">
            ▣ Image / video
          </button>
          <button
            onClick={() => (inputs.length ? addEl("media", { media: inputs[0].id }) : pushLog("warn", "No video inputs yet — add one under Media › Video inputs"))}
            title="Camera / capture card / NDI webcam"
          >
            ● Live feed
          </button>
        </span>
        <button className="icon" onClick={onClose} title="Close the designer">
          ✕
        </button>
      </header>
      <div className="pd-body">
        <div className="pd-stage">
          <div ref={canvas} className={`pd-canvas ${over ? "drop-over" : ""}`} onPointerDown={() => setSel("text")}>
            <SlideRender text={slide.text} theme={theme} background={slideMedia(show, slide)} transparent style={style} elements={slideElements(show, { ...slide, elements: shown })} play />
            {shown.map((el) => (
              <div
                key={el.id}
                className={`pd-box ${sel === el.id ? "sel" : ""}`}
                style={{ left: `${el.x * 100}%`, top: `${el.y * 100}%`, width: `${el.w * 100}%`, height: `${el.h * 100}%` }}
                onPointerDown={(e) => startBox(e, el, "move")}
                title="Drag to move · corners to resize · Delete to remove"
              >
                {sel === el.id &&
                  ["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((h) => <span key={h} className={`pd-handle h-${h}`} onPointerDown={(e) => startBox(e, el, h)} />)}
              </div>
            ))}
          </div>
          <small className="muted">
            Click the slide for its main text · click an element to edit it · drag media from the bin onto the slide · arrow keys nudge (Shift = more)
          </small>
        </div>
        <aside className="pd-side">
          {selEl ? (
            <ElementPanel el={selEl} show={show} set={(patch) => void setEl(selEl.id, patch)} onDelete={() => removeEl(selEl.id)} onOrder={(d) => void reorder(selEl.id, d)} />
          ) : (
            <TextPanel
              style={style}
              look={look}
              setStyle={(patch) => void setStyle(patch)}
              onReset={() => void edit((s) => void (s.style = { ...EMPTY_STYLE }))}
              onApplyAll={() =>
                void edit(() => {}).then(() => {
                  // Copy this slide's formatting to every slide in the presentation.
                  void editAll(p.id, (ss) => ss.forEach((x) => (x.style = { ...style })));
                  pushLog("info", `Formatting applied to all ${p.slides.length} slides of “${p.title}”`);
                })
              }
            />
          )}
          {elements.length > 0 && (
            <>
              <h4>On this slide</h4>
              <ul className="list compact">
                <li className={sel === "text" ? "sel" : ""} onClick={() => setSel("text")}>
                  ¶ Slide text
                </li>
                {[...elements].reverse().map((e) => (
                  <li key={e.id} className={sel === e.id ? "sel" : ""} onClick={() => setSel(e.id)}>
                    {e.kind === "text" ? "T" : e.kind === "shape" ? "▭" : mediaById(show, e.media)?.kind === "input" ? "●" : "▣"}{" "}
                    <span className="ellipsis">{e.kind === "media" ? (mediaById(show, e.media)?.name ?? "empty") : e.text || "(no text)"}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

// Set by PresenterApp so "apply to all" can reach the presentation's other slides.
let editAll: (pid: number, fn: (slides: Slide[]) => void) => Promise<void> = async () => {};
export function setEditAll(f: typeof editAll) {
  editAll = f;
}

function Toggle({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title: string }) {
  return (
    <button className={on ? "on" : ""} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

function AlignButtons({ value, set }: { value: TextAlign; set: (a: TextAlign) => void }) {
  return (
    <div className="seg small">
      {(["left", "center", "right"] as TextAlign[]).map((a) => (
        <Toggle key={a} on={value === a} onClick={() => set(a)} title={`Align ${a}`}>
          {a === "left" ? "⇤" : a === "center" ? "↔" : "⇥"}
        </Toggle>
      ))}
    </div>
  );
}

function TextPanel({
  style,
  look,
  setStyle,
  onReset,
  onApplyAll,
}: {
  style: TextStyle;
  look: ReturnType<typeof styledTheme>;
  setStyle: (p: Partial<TextStyle>) => void;
  onReset: () => void;
  onApplyAll: () => void;
}) {
  const custom = Object.values(style).some((v) => v !== null);
  return (
    <div className="pd-panel">
      <h4>
        Slide text <small className="muted">{custom ? "· own formatting" : "· from the theme"}</small>
      </h4>
      <label>Font</label>
      <select value={style.font ?? ""} onChange={(e) => setStyle({ font: e.target.value || null })}>
        <option value="">Theme ({look.font})</option>
        {FONTS.map((f) => (
          <option key={f} value={f} style={{ fontFamily: f }}>
            {f}
          </option>
        ))}
      </select>
      <label>
        Size <b>{Math.round(look.size * 100)}%</b>
      </label>
      <input type="range" min={0.4} max={2.5} step={0.05} value={look.size} onChange={(e) => setStyle({ size: Number(e.target.value) })} />
      <div className="row wrap">
        <input type="color" value={look.color.slice(0, 7)} onChange={(e) => setStyle({ color: e.target.value })} title="Text colour" />
        <div className="seg small">
          <Toggle on={look.bold} onClick={() => setStyle({ bold: !look.bold })} title="Bold">
            <b>B</b>
          </Toggle>
          <Toggle on={look.italic} onClick={() => setStyle({ italic: !look.italic })} title="Italic">
            <i>I</i>
          </Toggle>
          <Toggle on={look.uppercase} onClick={() => setStyle({ uppercase: !look.uppercase })} title="ALL CAPS">
            AA
          </Toggle>
          <Toggle on={look.shadow} onClick={() => setStyle({ shadow: !look.shadow })} title="Shadow behind the text">
            S
          </Toggle>
        </div>
        <AlignButtons value={look.align} set={(align) => setStyle({ align })} />
      </div>
      <label>Position</label>
      <div className="seg small fill">
        {(
          [
            ["top", "Top"],
            ["center", "Middle"],
            ["bottom", "Bottom"],
            ["lower_third", "Lower third"],
          ] as [TextPosition, string][]
        ).map(([v, l]) => (
          <Toggle key={v} on={look.position === v} onClick={() => setStyle({ position: v })} title={l}>
            {l}
          </Toggle>
        ))}
      </div>
      <div className="row wrap pd-actions">
        <button disabled={!custom} onClick={onReset} title="Go back to the presentation's theme">
          Reset to theme
        </button>
        <button onClick={onApplyAll} title="Use this formatting on every slide of this presentation">
          Apply to all slides
        </button>
      </div>
    </div>
  );
}

function ElementPanel({
  el,
  show,
  set,
  onDelete,
  onOrder,
}: {
  el: SlideElement;
  show: Show;
  set: (p: Partial<SlideElement>) => void;
  onDelete: () => void;
  onOrder: (d: 1 | -1) => void;
}) {
  const pct = (v: number) => Math.round(v * 1000) / 10;
  return (
    <div className="pd-panel">
      <h4>{el.kind === "text" ? "Text box" : el.kind === "shape" ? "Shape" : "Picture / video / live feed"}</h4>
      {el.kind === "media" ? (
        <>
          <label>Shows</label>
          <select value={el.media ?? ""} onChange={(e) => set({ media: e.target.value ? Number(e.target.value) : null })}>
            <option value="">— nothing —</option>
            <optgroup label="Live feeds">
              {show.media
                .filter((m) => m.kind === "input")
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    ● {m.name}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Images & video">
              {show.media
                .filter((m) => m.kind === "image" || m.kind === "video")
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.kind === "video" ? "▶" : "▣"} {m.name}
                  </option>
                ))}
            </optgroup>
          </select>
        </>
      ) : (
        <>
          <label>Text</label>
          <textarea rows={3} value={el.text} onChange={(e) => set({ text: e.target.value })} placeholder={el.kind === "shape" ? "(optional)" : "Type here"} />
          <div className="row">
            <select className="grow" value={el.font} onChange={(e) => set({ font: e.target.value })}>
              {FONTS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <input type="color" value={el.color.slice(0, 7)} onChange={(e) => set({ color: e.target.value })} title="Text colour" />
          </div>
          <label>
            Size <b>{el.size.toFixed(1)}</b>
          </label>
          <input type="range" min={2} max={25} step={0.5} value={el.size} onChange={(e) => set({ size: Number(e.target.value) })} />
          <div className="row wrap">
            <div className="seg small">
              <Toggle on={el.bold} onClick={() => set({ bold: !el.bold })} title="Bold">
                <b>B</b>
              </Toggle>
              <Toggle on={el.italic} onClick={() => set({ italic: !el.italic })} title="Italic">
                <i>I</i>
              </Toggle>
            </div>
            <AlignButtons value={el.align} set={(align) => set({ align })} />
          </div>
        </>
      )}
      <label>Fill / corners / see-through</label>
      <div className="row wrap">
        <label className="inline" title="Colour behind the element">
          <input type="checkbox" checked={!!el.background} onChange={(e) => set({ background: e.target.checked ? "#000000" : "" })} />
          Fill
        </label>
        {el.background && <input type="color" value={el.background.slice(0, 7)} onChange={(e) => set({ background: e.target.value })} />}
        <label className="inline" title="Rounded corners">
          ◜
          <input type="range" min={0} max={50} step={1} value={el.radius} onChange={(e) => set({ radius: Number(e.target.value) })} />
        </label>
      </div>
      <label>
        Opacity <b>{Math.round(el.opacity * 100)}%</b>
      </label>
      <input type="range" min={0.05} max={1} step={0.05} value={el.opacity} onChange={(e) => set({ opacity: Number(e.target.value) })} />
      <label>Position & size (% of the screen)</label>
      <div className="pd-xywh">
        {(["x", "y", "w", "h"] as const).map((k) => (
          <label key={k} className="inline">
            {k.toUpperCase()}
            <input type="number" step={1} value={pct(el[k])} onChange={(e) => e.target.value !== "" && set({ [k]: clamp(Number(e.target.value) / 100, k === "w" || k === "h" ? 0.02 : -1, 2) })} />
          </label>
        ))}
      </div>
      <div className="row wrap pd-actions">
        <button onClick={() => set({ x: r3((1 - el.w) / 2) })} title="Centre left-to-right">
          Centre
        </button>
        <button onClick={() => set({ x: 0, y: 0, w: 1, h: 1 })} title="Fill the whole screen">
          Full screen
        </button>
        <button onClick={() => onOrder(1)} title="Bring forward">
          ↑ Front
        </button>
        <button onClick={() => onOrder(-1)} title="Send backward">
          ↓ Back
        </button>
        <span className="grow" />
        <button className="danger-btn" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
