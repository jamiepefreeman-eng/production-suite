// "Match background": lights follow the picture on the screens.
//
// About 10 times a second the background that's showing (media layer, or the live
// presentation's theme background) is drawn small onto a canvas. Each light takes
// the colour of the part of the picture that matches where it is on stage (left of
// stage = left of the picture, high = top), with brightness following the picture.
// Moving heads follow the brightest area, so motion in the video becomes movement.
// Results go to the programmer as one `merge_programmer` command per tick; the AI
// itself never writes DMX (CLAUDE.md rule 5) — this is plain arithmetic.

import { mediaUrl, on } from "./bridge";
import { getInputStream } from "./inputs";
import { getEngine, pushLog, send } from "./store";
import type { FixtureState, Look, MediaItem, Rgb, Show } from "./types";

const W = 48;
const H = 27;
const TICK_MS = 100;

export interface MatchStatus {
  running: boolean;
  media: string | null;
  fixtures: number;
  /** "loading": opening the background (spinner); "matching": lights are following it. */
  phase: "idle" | "loading" | "matching";
  /** Colours being sent to the lights right now, left to right (for the progress wheel). */
  colors: string[];
  /** Frames matched so far. */
  frames: number;
}
const IDLE: MatchStatus = { running: false, media: null, fixtures: 0, phase: "idle", colors: [], frames: 0 };
let status: MatchStatus = IDLE;
const listeners = new Set<() => void>();
const setStatus = (s: MatchStatus) => {
  status = s;
  listeners.forEach((l) => l());
};
export const matchStatus = {
  get: () => status,
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};

/** The background the audience is looking at right now, if any. */
export function currentBackground(show: Show, layers: { media: number | null }, livePresentation: number | null): MediaItem | null {
  const byId = (id: number | null | undefined) => (id == null ? null : (show.media.find((m) => m.id === id && m.kind !== "audio") ?? null));
  const p = show.presentations.find((x) => x.id === livePresentation);
  const theme = show.themes.find((t) => t.name === p?.theme) ?? show.themes[0];
  return byId(layers.media) ?? (p ? byId(theme?.background_media) : null);
}

// ─────────────────────────────────────────── the maths (pure; unit-testable)

export interface Placed {
  id: number;
  /** 0 = stage left edge of the rig … 1 = right */
  u: number;
  /** 0 = top of the rig … 1 = floor */
  v: number;
  moves: boolean;
}

/** Where each light sits within the rig, as picture coordinates. */
export function placeFixtures(show: Show, ids: number[]): Placed[] {
  const fx = show.fixtures.filter((f) => ids.includes(f.id));
  if (!fx.length) return [];
  const xs = fx.map((f) => f.position[0]);
  const ys = fx.map((f) => f.position[1]);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  return fx.map((f) => {
    const prof = show.profiles.find((p) => p.id === f.profile_id);
    return {
      id: f.id,
      u: x1 - x0 < 0.01 ? 0.5 : (f.position[0] - x0) / (x1 - x0),
      // Floor lights (pucks) read the lower part of the picture, rig lights the upper part.
      v: y1 - y0 < 0.01 ? 0.5 : 1 - (f.position[1] - y0) / (y1 - y0),
      moves: !!prof?.channels.some((c) => c.attr === "pan"),
    };
  });
}

/** Lights look best saturated: push the colour away from grey and scale so the brightest channel is full. */
export function lightColour(r: number, g: number, b: number): Rgb {
  const mx = Math.max(r, g, b, 1e-6);
  const mean = (r + g + b) / 3;
  const boost = (c: number) => Math.max(0, mean + (c - mean) * 1.3);
  const [R, G, B] = [boost(r), boost(g), boost(b)];
  const m2 = Math.max(R, G, B, 1e-6);
  if (mx < 0.03) return { r: 0, g: 0, b: 0 };
  return { r: R / m2, g: G / m2, b: B / m2 };
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * One frame of matching: picture (RGBA bytes, w×h) → a look for the lights.
 * `prev` is the last look (for smoothing); `motion` 0..1 makes it react faster.
 */
export function matchFrame(px: Uint8ClampedArray, w: number, h: number, lights: Placed[], prev: Look, motion: number): Look {
  const at = (x: number, y: number) => {
    const i = (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4;
    return [px[i] / 255, px[i + 1] / 255, px[i + 2] / 255];
  };
  // Brightest area of the picture (for moving heads).
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = at(x, y);
      const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) ** 4;
      sx += x * l;
      sy += y * l;
      sw += l;
    }
  const cx = sw > 1e-6 ? sx / sw / (w - 1) : 0.5;
  const cy = sw > 1e-6 ? sy / sw / (h - 1) : 0.5;

  const k = 0.3 + 0.5 * Math.min(1, motion * 8); // smoothing: faster when the video moves
  const mix = (a: number | null | undefined, b: number) => (a == null ? b : a + (b - a) * k);
  const rx = Math.max(1, Math.round(w / 10));
  const ry = Math.max(1, Math.round(h / 6));
  const out: Look = { fixtures: {} };
  for (const L of lights) {
    const px0 = Math.round(L.u * (w - 1));
    const py0 = Math.round(L.v * (h - 1));
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let y = py0 - ry; y <= py0 + ry; y++)
      for (let x = px0 - rx; x <= px0 + rx; x++) {
        const c = at(x, y);
        r += c[0];
        g += c[1];
        b += c[2];
        n++;
      }
    r /= n;
    g /= n;
    b /= n;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const col = lightColour(r, g, b);
    const p = prev.fixtures[String(L.id)] as FixtureState | undefined;
    const st: FixtureState = {
      intensity: round(mix(p?.intensity, luma < 0.03 ? 0 : Math.min(1, 0.2 + luma * 1.3))),
      color: { r: round(mix(p?.color?.r, col.r)), g: round(mix(p?.color?.g, col.g)), b: round(mix(p?.color?.b, col.b)) },
      gobo: null,
      pan: null,
      tilt: null,
    };
    if (L.moves) {
      // Sweep gently around centre (±20 % of the pan range, tilt ±12 %) following the bright area.
      st.pan = round(mix(p?.pan, 0.5 + (cx - 0.5) * 0.4));
      st.tilt = round(mix(p?.tilt, 0.5 + (cy - 0.5) * 0.24));
    }
    out.fixtures[String(L.id)] = st;
  }
  return out;
}

/** Average absolute change between two frames, 0..1. */
export function frameMotion(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let d = 0;
  for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return d / ((a.length / 4) * 3 * 255);
}

// ─────────────────────────────────────────── the runner

let stopFn: (() => void) | null = null;

export function stopMatching() {
  stopFn?.();
  stopFn = null;
  if (status.running) setStatus(IDLE);
}

/** Main window only: a MIDI / show-page "match background" press arrives as an engine event. */
export function listenForRemoteToggle(): () => void {
  return on("engine-event", (ev) => {
    if (ev.type !== "toggle_match_background") return;
    if (status.running) stopMatching();
    else {
      const msg = startMatching([]);
      if (!status.running) pushLog("warn", msg);
    }
  });
}

const toHex = (c: { r: number; g: number; b: number } | null) =>
  c ? "#" + [c.r, c.g, c.b].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("") : "#000000";

/** Start following the background with these lights (all lights when empty). */
export function startMatching(fixtureIds: number[]): string {
  stopMatching();
  const eng = getEngine();
  const show = eng.show;
  if (!show) return "No show loaded";
  const ids = fixtureIds.length ? fixtureIds : show.fixtures.map((f) => f.id);
  const lights = placeFixtures(show, ids);
  let media = currentBackground(show, eng.layers, eng.live?.presentation ?? null);
  if (!media) return "No background is on screen — put a background (media cue or theme background) up in Presenter first";

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  // Video must stay in the document or WebKit pauses it (CLAUDE.md rule 13).
  const holder = document.createElement("div");
  holder.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;overflow:hidden;z-index:-1";
  document.body.appendChild(holder);
  let source: HTMLVideoElement | HTMLImageElement | null = null;
  let stream: MediaStream | null = null;
  let alive = true;
  let warned = false;

  const load = (m: MediaItem) => {
    holder.innerHTML = "";
    source = null;
    if (m.kind === "image") {
      const img = new Image();
      img.crossOrigin = "anonymous"; // the asset protocol allows the app's origin; needed to read pixels
      img.src = mediaUrl(m.path);
      holder.appendChild(img);
      source = img;
    } else {
      const v = document.createElement("video");
      v.crossOrigin = "anonymous";
      v.muted = true;
      v.setAttribute("muted", "");
      v.playsInline = true;
      v.loop = true;
      v.autoplay = true;
      if (m.kind === "input")
        getInputStream(m.path)
          .then((s) => {
            if (!alive) return;
            stream = s;
            v.srcObject = s;
            void v.play().catch(() => {});
          })
          .catch((e) => pushLog("warn", String(e?.message ?? e)));
      else {
        v.src = mediaUrl(m.path);
        void v.play().catch(() => {});
      }
      holder.appendChild(v);
      source = v;
    }
  };
  load(media);

  let prevPx: Uint8ClampedArray | null = null;
  let prevLook: Look = { fixtures: {} };
  const timer = setInterval(() => {
    // Follow the background if it changes (next song's media cue).
    const e = getEngine();
    if (e.show) {
      const now = currentBackground(e.show, e.layers, e.live?.presentation ?? null);
      if (now && now.id !== media!.id) {
        media = now;
        load(now);
        setStatus({ ...status, running: true, media: now.name, phase: "loading" });
      }
    }
    const s: HTMLVideoElement | HTMLImageElement | null = source;
    if (!s) return;
    const ready = s instanceof HTMLVideoElement ? s.readyState >= 2 : (s as HTMLImageElement).complete && (s as HTMLImageElement).naturalWidth > 0;
    if (!ready) return;
    try {
      ctx.drawImage(s, 0, 0, W, H);
      const px = ctx.getImageData(0, 0, W, H).data;
      const motion = prevPx ? frameMotion(prevPx, px) : 0;
      prevPx = new Uint8ClampedArray(px);
      prevLook = matchFrame(px, W, H, lights, prevLook, motion);
      void send({ type: "merge_programmer", look: prevLook });
      const sorted = [...lights].sort((a, b) => a.u - b.u);
      const step = Math.max(1, Math.floor(sorted.length / 12));
      setStatus({
        ...status,
        phase: "matching",
        frames: status.frames + 1,
        colors: sorted.filter((_, i) => i % step === 0).map((L) => {
          const st = prevLook.fixtures[String(L.id)];
          const c = st?.color ?? null;
          const k = st?.intensity ?? 0;
          return toHex(c && { r: c.r * k, g: c.g * k, b: c.b * k });
        }),
      });
    } catch (err) {
      if (!warned) pushLog("warn", `Can't read the background's pixels: ${err}`);
      warned = true;
    }
  }, TICK_MS);

  stopFn = () => {
    alive = false;
    clearInterval(timer);
    // Camera streams are shared with the Presenter (shared/inputs.ts): don't stop them.
    void stream;
    holder.remove();
  };
  setStatus({ running: true, media: media.name, fixtures: lights.length, phase: "loading", colors: [], frames: 0 });
  return `Matching “${media.name}” with ${lights.length} light${lights.length === 1 ? "" : "s"}`;
}
