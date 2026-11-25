// AI media search: "for song one I want a fast upbeat background that has movement and is orange".
//
// 1. Each image / video in the bin is measured once (colours, brightness, saturation, motion
//    between frames, length) and the result is saved on the media item (`MediaItem.analysis`).
// 2. Claude ranks the bin from those measurements (ai_rank_media). Without an API key / internet
//    the keyword ranking below does the same job offline.
// 3. "Use for <song>" puts the pick on the first slide of that song as its background cue.

import { api, mediaUrl } from "../../shared/bridge";
import type { MediaAnalysis, MediaItem, Presentation, Show } from "../../shared/types";

const W = 48;
const H = 27;

// ─────────────────────────────────────────── measuring

interface Px {
  data: Uint8ClampedArray;
}

function grab(ctx: CanvasRenderingContext2D, src: CanvasImageSource): Px {
  ctx.drawImage(src, 0, 0, W, H);
  return { data: ctx.getImageData(0, 0, W, H).data };
}

const once = (el: HTMLElement, ev: string, ms = 8000) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timed out waiting for ${ev}`)), ms);
    el.addEventListener(ev, () => (clearTimeout(t), res()), { once: true });
    el.addEventListener("error", () => (clearTimeout(t), rej(new Error("can't load the file"))), { once: true });
  });

/** Hue 0..360, saturation 0..1, lightness 0..1. */
export function hsl(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : mx === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return [h, s, l];
}

/** Plain-language name for a colour. */
export function colorName(r: number, g: number, b: number): string {
  const [h, s, l] = hsl(r, g, b);
  if (l < 0.1) return "black";
  if (s < 0.15) return l > 0.8 ? "white" : l < 0.3 ? "black" : "grey";
  const base =
    h < 15 || h >= 345 ? "red" : h < 40 ? "orange" : h < 65 ? "yellow" : h < 160 ? "green" : h < 200 ? "teal" : h < 250 ? "blue" : h < 290 ? "purple" : "pink";
  return l < 0.3 ? `deep ${base}` : l > 0.75 ? `light ${base}` : base;
}

const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");

/** Colours / brightness / motion from frames of one picture (RGBA, W×H). Pure: unit-testable. */
export function analyseFrames(frames: Uint8ClampedArray[], motionPairs: [Uint8ClampedArray, Uint8ClampedArray][], duration: number, name: string): MediaAnalysis {
  // Colour buckets (4 levels per channel), weighted toward saturated pixels so a small orange
  // flare on black still counts as "orange".
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  let lum = 0;
  let sat = 0;
  let count = 0;
  for (const f of frames)
    for (let i = 0; i < f.length; i += 4) {
      const r = f[i] / 255;
      const g = f[i + 1] / 255;
      const b = f[i + 2] / 255;
      const [, s, l] = hsl(r, g, b);
      lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sat += s;
      count++;
      const key = (Math.min(3, Math.floor(r * 4)) << 4) | (Math.min(3, Math.floor(g * 4)) << 2) | Math.min(3, Math.floor(b * 4));
      const w = 0.3 + s * (l > 0.08 ? 1 : 0.2);
      const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      e.n += w;
      e.r += r * w;
      e.g += g * w;
      e.b += b * w;
      buckets.set(key, e);
    }
  const top = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, 5);
  const total = [...buckets.values()].reduce((a, b) => a + b.n, 0) || 1;
  const colors = top.map((e) => hex(e.r / e.n, e.g / e.n, e.b / e.n));
  const names: string[] = [];
  for (const e of top) {
    if (e.n / total < 0.06) continue;
    const n = colorName(e.r / e.n, e.g / e.n, e.b / e.n);
    if (!names.includes(n)) names.push(n);
  }
  let motion = 0;
  for (const [a, b] of motionPairs) {
    let d = 0;
    for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    motion += d / ((a.length / 4) * 3 * 255);
  }
  motion = motionPairs.length ? motion / motionPairs.length : 0;
  const brightness = count ? lum / count : 0;
  const saturation = count ? sat / count : 0;

  const tags = new Set<string>();
  const hues = names.map((n) => n.replace(/^(deep|light) /, ""));
  if (hues.some((h) => ["red", "orange", "yellow", "pink"].includes(h))) tags.add("warm");
  if (hues.some((h) => ["blue", "teal", "green", "purple"].includes(h))) tags.add("cool");
  tags.add(brightness > 0.55 ? "bright" : brightness < 0.25 ? "dark" : "medium brightness");
  tags.add(saturation > 0.5 ? "vibrant" : saturation < 0.2 ? "muted" : "colourful");
  if (duration > 0) {
    tags.add("video");
    tags.add(motion < 0.006 ? "nearly still" : motion < 0.025 ? "slow movement" : motion < 0.06 ? "moving" : "fast movement");
  } else tags.add("still image");
  for (const w of name.toLowerCase().replace(/\.[a-z0-9]+$/, "").split(/[^a-z]+/)) if (w.length > 2 && !/^(mp4|mov|jpg|png|loop|final|hd|uhd)$/.test(w)) tags.add(w);
  return { colors, color_names: names, brightness: r2(brightness), saturation: r2(saturation), motion: Math.round(motion * 10000) / 10000, duration: r2(duration), tags: [...tags] };
}
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Measure one image or video (a few frames; videos also frame-to-frame change). */
export async function analyseMedia(m: MediaItem): Promise<MediaAnalysis> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  if (m.kind === "image") {
    const img = new Image();
    img.crossOrigin = "anonymous"; // the asset protocol allows the app's origin; needed to read pixels
    img.src = mediaUrl(m.path);
    if (!img.complete) await once(img, "load");
    return analyseFrames([grab(ctx, img).data], [], 0, m.name);
  }
  const v = document.createElement("video");
  v.crossOrigin = "anonymous";
  v.muted = true;
  v.preload = "auto";
  v.playsInline = true;
  // WebKit only decodes videos that are in the document.
  v.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none";
  document.body.appendChild(v);
  try {
    v.src = mediaUrl(m.path);
    await once(v, "loadeddata");
    const dur = Number.isFinite(v.duration) ? v.duration : 0;
    const seek = async (t: number) => {
      v.currentTime = Math.max(0, Math.min(dur - 0.05, t));
      await once(v, "seeked");
      return grab(ctx, v).data.slice();
    };
    const frames: Uint8ClampedArray[] = [];
    const pairs: [Uint8ClampedArray, Uint8ClampedArray][] = [];
    for (const p of [0.15, 0.5, 0.85]) {
      const a = await seek(dur * p);
      const b = await seek(dur * p + 0.25);
      frames.push(a);
      pairs.push([a, b]);
    }
    return analyseFrames(frames, pairs, dur, m.name);
  } finally {
    v.remove();
  }
}

// ─────────────────────────────────────────── describing / ranking

export function describe(m: MediaItem): string {
  const a = m.analysis;
  if (!a) return m.kind === "input" ? "live camera / capture input" : "not analysed";
  const motion = a.duration > 0 ? `motion ${a.motion.toFixed(3)} (${a.tags.find((t) => /still|slow|moving|fast/.test(t)) ?? "?"}), ${Math.round(a.duration)} s` : "still image";
  return `colours: ${a.color_names.join(", ") || "?"} (${a.colors.slice(0, 3).join(" ")}); brightness ${Math.round(a.brightness * 100)}%; saturation ${Math.round(a.saturation * 100)}%; ${motion}; tags: ${a.tags.join(", ")}`;
}

const COLOR_WORDS = ["red", "orange", "yellow", "gold", "green", "teal", "cyan", "blue", "navy", "purple", "violet", "pink", "magenta", "white", "black", "grey", "gray"];
const COLOR_ALIASES: Record<string, string> = { gold: "yellow", cyan: "teal", navy: "blue", violet: "purple", magenta: "pink", gray: "grey", amber: "orange" };
const FAST = /\b(fast|upbeat|energ\w*|movement|moving|motion|dynamic|lively|celebrat\w*|busy|exciting|party|driving|anthem\w*)\b/;
const SLOW = /\b(slow|calm|still|peaceful|gentle|reflective|quiet|soft|ambient|subtle|intimate|prayer\w*)\b/;

export interface Pick {
  item: MediaItem;
  reason: string;
  score: number;
}

/** Offline ranking from the measurements and file names. */
export function rankOffline(prompt: string, media: MediaItem[]): Pick[] {
  const q = prompt.toLowerCase();
  const wantColors = COLOR_WORDS.filter((c) => new RegExp(`\\b${c}\\b`).test(q)).map((c) => COLOR_ALIASES[c] ?? c);
  if (/\bamber\b/.test(q)) wantColors.push("orange");
  const fast = FAST.test(q);
  const slow = SLOW.test(q);
  const words = q.split(/[^a-z]+/).filter((w) => w.length > 3);
  const out: Pick[] = [];
  for (const m of media) {
    if (m.kind !== "image" && m.kind !== "video") continue;
    const a = m.analysis;
    let score = 0;
    const why: string[] = [];
    if (a) {
      const hues = a.color_names.map((n) => n.replace(/^(deep|light) /, ""));
      for (const c of wantColors) {
        const i = hues.indexOf(c);
        if (i >= 0) {
          score += i === 0 ? 4 : 2.5;
          why.push(i === 0 ? `mostly ${a.color_names[i]}` : `has ${a.color_names[i]}`);
        } else score -= 1;
      }
      if (/\bwarm\b/.test(q) && a.tags.includes("warm")) (score += 1.5), why.push("warm");
      if (/\bcool\b/.test(q) && a.tags.includes("cool")) (score += 1.5), why.push("cool");
      if (/\b(bright|light)\b/.test(q)) score += 2 * a.brightness;
      if (/\bdark\b/.test(q)) score += 2 * (1 - a.brightness);
      if (fast) {
        const k = Math.min(1, a.motion / 0.06);
        score += 3.5 * k + (a.duration > 0 ? 1 : -1);
        if (k > 0.4) why.push(a.motion >= 0.06 ? "fast movement" : "lots of movement");
      }
      if (slow) {
        score += 2.5 * (1 - Math.min(1, a.motion / 0.03));
        if (a.motion < 0.015) why.push(a.duration > 0 ? "gentle movement" : "still");
      }
    }
    for (const w of words) if (m.name.toLowerCase().includes(w)) (score += 1.5), why.push(`name has “${w}”`);
    if (/\b(video|loop|motion)\b/.test(q) && m.kind === "video") score += 1;
    out.push({ item: m, score, reason: why.length ? why.join(", ") : a ? "closest match" : "not analysed yet" });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

/** Songs in service order (what "song one" means). */
export function serviceSongs(show: Show): Presentation[] {
  const inService = show.playlist.map((id) => show.presentations.find((p) => p.id === id)).filter((p): p is Presentation => !!p);
  return inService.filter((p) => p.kind === "song");
}

const NUMBER_WORDS: Record<string, number> = { one: 1, first: 1, two: 2, second: 2, three: 3, third: 3, four: 4, fourth: 4, five: 5, fifth: 5, six: 6, sixth: 6 };

/** Which song the prompt is about: "song one", "song 2", "the second song", or a title. */
export function targetSong(prompt: string, show: Show): Presentation | null {
  const q = prompt.toLowerCase();
  const songs = serviceSongs(show);
  const m = q.match(/\bsong\s+(\d+|one|two|three|four|five|six)\b/) ?? q.match(/\b(first|second|third|fourth|fifth|sixth)\s+song\b/);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
    return songs[n - 1] ?? null;
  }
  return songs.find((p) => p.title.length > 2 && q.includes(p.title.toLowerCase())) ?? null;
}

/** Claude ranking, falling back to the offline one. */
export async function search(prompt: string, show: Show): Promise<{ picks: Pick[]; target: Presentation | null; engine: "ai" | "offline"; note?: string }> {
  const visual = show.media.filter((m) => m.kind === "image" || m.kind === "video");
  const offlineTarget = targetSong(prompt, show);
  try {
    const r = await api.aiRankMedia(
      prompt,
      serviceSongs(show).map((p) => p.title),
      visual.map((m) => ({ id: m.id, name: m.name, kind: m.kind, description: describe(m) })),
    );
    const picks = r.picks.map((p) => ({ item: visual.find((m) => m.id === p.id)!, reason: p.reason, score: 0 })).filter((p) => p.item);
    const target = show.presentations.find((p) => p.title === r.target) ?? offlineTarget;
    if (picks.length) return { picks, target, engine: "ai" };
  } catch (e) {
    return { picks: rankOffline(prompt, visual), target: offlineTarget, engine: "offline", note: String(e) };
  }
  return { picks: rankOffline(prompt, visual), target: offlineTarget, engine: "offline" };
}
