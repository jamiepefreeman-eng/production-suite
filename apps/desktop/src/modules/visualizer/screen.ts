// Draws the Presenter's audience output onto a canvas that every Visualizer
// screen uses as its picture. Mirrors modules/presenter/render.tsx (modules
// can't import each other): theme font/size/colour/position, background
// colour / image / video, darkening, countdown.

import * as THREE from "three";
import type { Theme } from "../../shared/types";

export interface ScreenContent {
  text: string;
  theme: Theme | null;
  /** Media to fill the frame (layer, or the theme's background). */
  background: { kind: "image" | "video"; url: string } | null;
  countdown: { label: string; endsAt: number } | null;
  /** Live camera / capture input (Stage 3). */
  stream?: MediaStream | null;
}

const W = 1280;
const H = 720;

export class ScreenPainter {
  readonly canvas = document.createElement("canvas");
  readonly texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private content: ScreenContent = { text: "", theme: null, background: null, countdown: null };
  private img: HTMLImageElement | null = null;
  private video: HTMLVideoElement | null = null;
  private dirty = true;
  private lastSecond = -1;

  constructor() {
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  set(c: ScreenContent) {
    const bgChanged = c.background?.url !== this.content.background?.url || c.stream !== this.content.stream;
    this.content = c;
    if (bgChanged) {
      this.video?.pause();
      this.img = null;
      this.video = null;
      if (c.stream) {
        this.video = this.makeVideo();
        this.video.srcObject = c.stream;
      } else if (c.background?.kind === "image") {
        const img = new Image();
        img.onload = () => (this.dirty = true);
        img.src = c.background.url;
        this.img = img;
      } else if (c.background?.kind === "video") {
        this.video = this.makeVideo();
        this.video.src = c.background.url;
      }
    }
    this.dirty = true;
  }

  private makeVideo() {
    const v = document.createElement("video");
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.autoplay = true;
    void v.play().catch(() => {});
    return v;
  }

  /** Call every animation frame; repaints only when something changed (or video / countdown is running). */
  tick() {
    const sec = Math.floor(Date.now() / 1000);
    const moving = !!this.video && this.video.readyState >= 2;
    if (!this.dirty && !moving && !(this.content.countdown && sec !== this.lastSecond)) return;
    this.lastSecond = sec;
    this.dirty = false;
    this.paint();
    this.texture.needsUpdate = true;
  }

  private paint() {
    const { ctx } = this;
    const c = this.content;
    const t = c.theme;
    ctx.fillStyle = t?.background_color?.slice(0, 7) || "#000";
    ctx.fillRect(0, 0, W, H);
    const src = this.video && this.video.readyState >= 2 ? this.video : this.img?.complete && this.img.naturalWidth ? this.img : null;
    if (src) {
      const sw = src instanceof HTMLVideoElement ? src.videoWidth : src.naturalWidth;
      const sh = src instanceof HTMLVideoElement ? src.videoHeight : src.naturalHeight;
      const k = Math.max(W / sw, H / sh); // cover
      ctx.drawImage(src, (W - sw * k) / 2, (H - sh * k) / 2, sw * k, sh * k);
    }
    if (t && t.dim > 0) {
      ctx.fillStyle = `rgba(0,0,0,${t.dim})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (c.text && t) this.paintText(c.text, t);
    if (c.countdown) {
      const ms = Math.max(0, c.countdown.endsAt - Date.now());
      const s = Math.ceil(ms / 1000);
      const txt = s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      ctx.textAlign = "right";
      ctx.fillStyle = "#fff";
      ctx.shadowColor = "#000";
      ctx.shadowBlur = 8;
      ctx.font = `600 ${H * 0.026}px Inter, Arial, sans-serif`;
      ctx.fillText(c.countdown.label, W * 0.97, H * 0.86);
      ctx.font = `700 ${H * 0.06}px Inter, Arial, sans-serif`;
      ctx.fillText(txt, W * 0.97, H * 0.94);
      ctx.shadowBlur = 0;
    }
  }

  private paintText(text: string, t: Theme) {
    const { ctx } = this;
    const lower = t.position === "lower_third";
    const size = H * (lower ? 0.05 : 0.07) * (t.size || 1);
    ctx.font = `${t.bold ? 700 : 400} ${size}px "${t.font}", "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const maxW = W * 0.88;
    const lines: string[] = [];
    for (const raw of text.split("\n")) {
      const words = (t.uppercase ? raw.toUpperCase() : raw).split(" ");
      let line = "";
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (ctx.measureText(test).width > maxW && line) {
          lines.push(line);
          line = w;
        } else line = test;
      }
      lines.push(line);
    }
    const lh = size * 1.25;
    const block = lines.length * lh;
    let y0: number;
    if (lower) {
      const band = block + H * 0.05;
      ctx.fillStyle = "rgba(0,0,0,0.72)";
      ctx.fillRect(0, H - band, W, band);
      y0 = H - band + H * 0.025;
    } else if (t.position === "top") y0 = H * 0.07;
    else if (t.position === "bottom") y0 = H - H * 0.08 - block;
    else y0 = (H - block) / 2;
    if (t.shadow) {
      ctx.shadowColor = "#000";
      ctx.shadowBlur = size * 0.25;
      ctx.shadowOffsetY = size * 0.05;
    }
    ctx.fillStyle = t.color?.slice(0, 7) || "#fff";
    lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + lh * (i + 0.5)));
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  dispose() {
    this.video?.pause();
    this.texture.dispose();
  }
}
