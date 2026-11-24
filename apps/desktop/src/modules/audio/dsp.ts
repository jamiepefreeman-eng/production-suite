// Display maths for the channel panel: EQ response curve, compressor curve and
// the X32 / X Air fader law. Drawing only — the desk does the real processing.

import type { EqType } from "../../shared/types";

export interface Band { kind: EqType; hz: number; db: number; q: number }
export interface ChState {
  name: string;
  fader: number;
  muted: boolean;
  pan: number;
  hpfOn: boolean;
  hpfHz: number;
  eqOn: boolean;
  bands: Band[];
  gate: { on: boolean; threshold: number; range: number; attack: number; hold: number; release: number };
  comp: { on: boolean; threshold: number; ratio: number; knee: number; makeup: number; attack: number; hold: number; release: number };
}

/** Shown until the desk has been read. */
export function defaultChannel(_n: number): ChState {
  return {
    name: "",
    fader: 0.75,
    muted: false,
    pan: 0,
    hpfOn: false,
    hpfHz: 80,
    eqOn: true,
    bands: [
      { kind: "low_shelf", hz: 120, db: 0, q: 2 },
      { kind: "peq", hz: 500, db: 0, q: 2 },
      { kind: "peq", hz: 2500, db: 0, q: 2 },
      { kind: "high_shelf", hz: 10000, db: 0, q: 2 },
    ],
    gate: { on: false, threshold: -50, range: 40, attack: 1, hold: 50, release: 200 },
    comp: { on: false, threshold: -20, ratio: 3, knee: 2, makeup: 0, attack: 10, hold: 1, release: 150 },
  };
}

/** X32 / X Air fader position (0..1) to dB; null = -∞. Mirrors processing.rs. */
export function faderToDb(f: number): number | null {
  if (f <= 0) return null;
  if (f >= 0.5) return f * 40 - 30;
  if (f >= 0.25) return f * 80 - 50;
  if (f >= 0.0625) return f * 160 - 70;
  return f * 480 - 90;
}

const FS = 48000;
type Coefs = [number, number, number, number, number, number];

// Audio EQ Cookbook (R. Bristow-Johnson) biquads.
function biquad(kind: EqType | "hpf", hz: number, db: number, q: number): Coefs {
  const A = Math.pow(10, db / 40);
  const w0 = (2 * Math.PI * Math.min(hz, FS / 2.1)) / FS;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const sA = 2 * Math.sqrt(A) * alpha;
  switch (kind) {
    case "peq":
    case "veq":
      return [1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A];
    case "low_shelf":
      return [
        A * (A + 1 - (A - 1) * cos + sA), 2 * A * (A - 1 - (A + 1) * cos), A * (A + 1 - (A - 1) * cos - sA),
        A + 1 + (A - 1) * cos + sA, -2 * (A - 1 + (A + 1) * cos), A + 1 + (A - 1) * cos - sA,
      ];
    case "high_shelf":
      return [
        A * (A + 1 + (A - 1) * cos + sA), -2 * A * (A - 1 + (A + 1) * cos), A * (A + 1 + (A - 1) * cos - sA),
        A + 1 - (A - 1) * cos + sA, 2 * (A - 1 - (A + 1) * cos), A + 1 - (A - 1) * cos - sA,
      ];
    case "high_cut":
      return [(1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha];
    case "low_cut":
    case "hpf":
      return [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha];
  }
}

function magDb([b0, b1, b2, a0, a1, a2]: Coefs, hz: number): number {
  const w = (2 * Math.PI * hz) / FS;
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2);
  const dr = a0 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

/** [frequency, dB] points from 20 Hz to 20 kHz. */
export function eqCurve(s: ChState, points: number): [number, number][] {
  const filters: Coefs[] = [];
  if (s.eqOn)
    for (const b of s.bands) {
      const cut = b.kind === "low_cut" || b.kind === "high_cut";
      filters.push(biquad(b.kind, b.hz, cut ? 0 : b.db, cut ? 0.707 : b.q));
    }
  if (s.hpfOn) filters.push(biquad("hpf", s.hpfHz, 0, 0.707));
  const out: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const hz = 20 * Math.pow(1000, i / points);
    const db = filters.reduce((sum, f) => sum + magDb(f, hz), 0);
    out.push([hz, Math.max(-18, Math.min(18, db))]);
  }
  return out;
}

/** [input dB, output dB] for the compressor transfer curve (-60..0). */
export function compCurve(s: ChState): [number, number][] {
  const { threshold: T, ratio: R, knee, makeup } = s.comp;
  const W = knee * 2; // the desk's knee setting is 0..5; draw it as a soft region a few dB wide
  const out: [number, number][] = [];
  for (let x = -60; x <= 0; x += 0.5) {
    let y: number;
    if (!s.comp.on) y = x;
    else if (W > 0 && Math.abs(x - T) <= W / 2) y = x + ((1 / R - 1) * Math.pow(x - T + W / 2, 2)) / (2 * W);
    else if (x > T) y = T + (x - T) / R;
    else y = x;
    out.push([x, y + (s.comp.on ? makeup : 0)]);
  }
  return out;
}
