// Pointer-based drag and drop, shared by every module.
//
// Why not HTML5 drag and drop: inside a Tauri window it's unreliable (on Windows
// the OS file-drop handler swallows it) and it can't be tested headlessly. This
// uses plain pointer events, which behave the same in WKWebView, WebView2 and
// WebKitGTK.
//
//   onPointerDown={(e) => startDrag(e, { kind: "profile", data, label: "Spot 260" })}
//   useDropTarget(ref, ["profile"], { onOver: (pt, p) => …, onDrop: (pt, p) => …, onLeave })

import { useEffect } from "react";

export interface DragPayload<T = unknown> {
  kind: string;
  data: T;
  label: string;
}
export interface Point { x: number; y: number }

interface Target {
  el: HTMLElement;
  kinds: string[];
  onOver?: (pt: Point, p: DragPayload) => void;
  onDrop: (pt: Point, p: DragPayload) => void;
  onLeave?: () => void;
}

const targets = new Set<Target>();
const THRESHOLD = 5; // px before a press becomes a drag (so clicks still click)

let active: { payload: DragPayload; ghost: HTMLElement; over: Target | null } | null = null;
let justDragged = false;

/** True right after a drag ended, so the click that follows can be ignored. */
export function wasDragging() {
  return justDragged;
}

function targetAt(x: number, y: number, kind: string): Target | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  let best: Target | null = null;
  for (const t of targets) {
    if (t.kinds.includes(kind) && t.el.contains(el)) {
      // Innermost wins.
      if (!best || best.el.contains(t.el)) best = t;
    }
  }
  return best;
}

export function startDrag(e: React.PointerEvent | PointerEvent, payload: DragPayload) {
  if (e.button !== 0) return;
  // Stop the press from starting a text selection (which would swallow the drag).
  e.preventDefault();
  window.getSelection()?.removeAllRanges();
  const x0 = e.clientX;
  const y0 = e.clientY;
  let started = false;

  const move = (ev: PointerEvent) => {
    if (!started) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < THRESHOLD) return;
      started = true;
      const ghost = document.createElement("div");
      ghost.className = "drag-ghost";
      ghost.textContent = payload.label;
      document.body.appendChild(ghost);
      document.body.classList.add("dragging");
      active = { payload, ghost, over: null };
    }
    if (!active) return;
    ev.preventDefault();
    active.ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 10}px)`;
    const t = targetAt(ev.clientX, ev.clientY, payload.kind);
    if (t !== active.over) {
      active.over?.onLeave?.();
      active.over = t;
    }
    t?.onOver?.({ x: ev.clientX, y: ev.clientY }, payload);
    active.ghost.classList.toggle("can-drop", !!t);
  };

  const up = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("keydown", esc);
    if (!active) return;
    const t = targetAt(ev.clientX, ev.clientY, payload.kind);
    finish();
    t?.onDrop({ x: ev.clientX, y: ev.clientY }, payload);
    justDragged = true;
    setTimeout(() => (justDragged = false), 0);
  };

  const esc = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("keydown", esc);
    finish();
  };

  const finish = () => {
    if (!active) return;
    active.over?.onLeave?.();
    active.ghost.remove();
    document.body.classList.remove("dragging");
    active = null;
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("keydown", esc);
}

/** Register an element as a drop target for the given payload kinds. */
export function useDropTarget(
  ref: React.RefObject<HTMLElement | null>,
  kinds: string[],
  handlers: Omit<Target, "el" | "kinds">,
) {
  useEffect(() => {
    if (!ref.current) return;
    const t: Target = { el: ref.current, kinds, ...handlers };
    targets.add(t);
    return () => void targets.delete(t);
  });
}
