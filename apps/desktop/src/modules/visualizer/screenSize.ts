// Screen sizes the way people say them: 90" (diagonal), 120 inch, 7'x13', 7' 6" x 13', 2.1m x 3.7m, 400 x 225 cm.

export type Aspect = [number, number];
export const ASPECTS: [string, Aspect][] = [
  ["16:9", [16, 9]],
  ["16:10", [16, 10]],
  ["4:3", [4, 3]],
  ["21:9", [21, 9]],
  ["1:1", [1, 1]],
];

const M: Record<string, number> = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048 };

/** One length: 90", 7', 7'6", 7 ft 6 in, 2.1m, 210cm, 90. Unit null = none given. */
function length(s: string): { metres: number; unit: string | null } | null {
  const t = s.trim().toLowerCase().replace(/[’′]/g, "'").replace(/[”″]/g, '"').replace(/''/g, '"');
  // feet and inches together
  const fi = t.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)\s*(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?$/);
  if (fi) return { metres: Number(fi[1]) * M.ft + Number(fi[2]) * M.in, unit: "ft" };
  const one = t.match(/^(\d+(?:\.\d+)?)\s*("|in|inch|inches|'|ft|feet|foot|m|metres?|meters?|cm|mm)?$/);
  if (!one) return null;
  const u = one[2] ?? null;
  const unit = u == null ? null : u === '"' || u.startsWith("in") ? "in" : u === "'" || u.startsWith("f") ? "ft" : u.startsWith("m") && u !== "mm" ? "m" : u;
  return { metres: unit ? Number(one[1]) * M[unit] : Number(one[1]), unit };
}

/** Width × height in metres, or an error to show. A single size is the diagonal. */
export function parseScreenSize(text: string, aspect: Aspect = [16, 9]): { w: number; h: number } | { error: string } {
  const t = text.trim();
  if (!t) return { error: "Type a size, e.g. 90\" or 7'x13'" };
  const parts = t.split(/\s*(?:x|×|by|\*)\s*/i).filter(Boolean);
  if (parts.length === 1) {
    const d = length(parts[0].replace(/\s*(diag(onal)?|screen|tv)\s*$/i, ""));
    if (!d) return { error: `Couldn't read “${t}”` };
    // No unit on one number: a TV / projector size in inches.
    const diag = d.unit ? d.metres : d.metres * M.in;
    const k = diag / Math.hypot(aspect[0], aspect[1]);
    return { w: aspect[0] * k, h: aspect[1] * k };
  }
  if (parts.length === 2) {
    const a = length(parts[0]);
    const b = length(parts[1]);
    if (!a || !b) return { error: `Couldn't read “${t}”` };
    // A unit on one side applies to the other ("7x13'"); none at all: feet for small numbers, else inches.
    const unit = a.unit ?? b.unit ?? (Math.max(a.metres, b.metres) <= 40 ? "ft" : "in");
    const va = a.unit ? a.metres : a.metres * M[unit];
    const vb = b.unit ? b.metres : b.metres * M[unit];
    // Screens are usually wider than tall: the bigger number is the width ("7'x13'" = 7 high, 13 wide).
    return { w: Math.max(va, vb), h: Math.min(va, vb) };
  }
  return { error: `Couldn't read “${t}” — use one size (diagonal) or width x height` };
}

/** 3.96 → 13' 0" */
export function feetInches(m: number) {
  const totalIn = Math.round(m / M.in);
  return `${Math.floor(totalIn / 12)}' ${totalIn % 12}"`;
}

export function describeSize(w: number, h: number) {
  const diag = Math.round(Math.hypot(w, h) / M.in);
  return `${w.toFixed(2)} × ${h.toFixed(2)} m · ${feetInches(w)} × ${feetInches(h)} · ${diag}" diagonal`;
}
