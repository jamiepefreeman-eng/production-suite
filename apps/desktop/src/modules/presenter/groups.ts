// Groups (song sections) and arrangements (the order to play them in).
// A slide belongs to the group named by its label.

import type { Presentation, Slide } from "../../shared/types";

const DEFAULT_COLORS: [RegExp, string][] = [
  [/^intro/i, "#a3a30f"],
  [/^verse/i, "#2563eb"],
  [/^pre-?chorus/i, "#0d9488"],
  [/^chorus|^refrain/i, "#e11d48"],
  [/^bridge/i, "#9333ea"],
  [/^tag|^vamp|^turnaround/i, "#ea580c"],
  [/^outro|^ending|^interlude|^instrumental/i, "#57534e"],
  [/^blank/i, "#111111"],
  [/^welcome|^announce/i, "#16a34a"],
];

export function groupColor(label: string, p?: Presentation) {
  const custom = p?.groups.find((g) => g.name === label);
  if (custom) return custom.color;
  return DEFAULT_COLORS.find(([re]) => re.test(label.trim()))?.[1] ?? "#4b5563";
}

/** Every group in this presentation: those used by slides (in order) plus extra ones. */
export function groupNames(p: Presentation): string[] {
  const out: string[] = [];
  for (const s of p.slides) if (!out.includes(s.label)) out.push(s.label);
  for (const g of p.groups) if (!out.includes(g.name)) out.push(g.name);
  return out;
}

export interface SeqSlide {
  slide: Slide;
  /** Position in the played order (unique even when a slide repeats). */
  pos: number;
  /** Arrangement entry this came from (for highlighting the right repeat). */
  entry: number;
}

/** Slides in the order they'll be played: the chosen arrangement, or as written. */
export function sequence(p: Presentation): SeqSlide[] {
  const arr = p.arrangement ? p.arrangements.find((a) => a.name === p.arrangement) : undefined;
  if (!arr) return p.slides.map((slide, i) => ({ slide, pos: i, entry: i }));
  const out: SeqSlide[] = [];
  arr.sequence.forEach((g, entry) => {
    for (const slide of p.slides.filter((s) => s.label === g)) out.push({ slide, pos: out.length, entry });
  });
  return out;
}
