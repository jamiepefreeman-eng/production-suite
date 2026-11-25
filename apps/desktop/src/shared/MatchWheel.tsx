// The "thinking wheel" for match background: spins while the background loads, then
// becomes a ring of the colours being sent to the lights (left → right round the ring).

import { useSyncExternalStore } from "react";
import { matchStatus } from "./bgmatch";

export default function MatchWheel({ size = 22 }: { size?: number }) {
  const s = useSyncExternalStore(matchStatus.subscribe, matchStatus.get);
  if (!s.running) return null;
  const ring =
    s.phase === "matching" && s.colors.length
      ? `conic-gradient(${[...s.colors, s.colors[0]].map((c, i, a) => `${c} ${(i / (a.length - 1)) * 100}%`).join(", ")})`
      : "conic-gradient(#f97316, #ec4899, #8b5cf6, #3b82f6, transparent 85%)";
  return (
    <span
      className={`match-wheel ${s.phase}`}
      style={{ width: size, height: size, background: ring }}
      title={s.phase === "loading" ? `Opening “${s.media}”…` : `Matching “${s.media}” · ${s.fixtures} lights · ${s.frames} frames`}
    />
  );
}

/** Wheel + words, for status lines. */
export function MatchProgress() {
  const s = useSyncExternalStore(matchStatus.subscribe, matchStatus.get);
  if (!s.running) return null;
  return (
    <span className="match-progress">
      <MatchWheel />
      <span>{s.phase === "loading" ? `Opening “${s.media}”…` : `Matching “${s.media}” · ${s.fixtures} lights`}</span>
    </span>
  );
}
