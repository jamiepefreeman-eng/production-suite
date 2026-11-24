// One renderer for every place a slide appears — thumbnails, Live/Next
// previews and the real outputs — so what the operator sees is what the room sees.

import { useEffect, useState } from "react";
import { mediaUrl } from "../../shared/bridge";
import { pushLog } from "../../shared/store";
import type { Countdown, MediaItem, Show, Theme } from "../../shared/types";

export const DEFAULT_THEME: Theme = {
  name: "Default",
  font: "Inter",
  size: 1,
  color: "#ffffff",
  bold: true,
  uppercase: false,
  shadow: true,
  position: "center",
  background_color: "#0b1020",
  background_media: null,
  dim: 0,
};

// Fonts present on both macOS and Windows (others fall back to Arial).
export const FONTS = ["Inter", "Helvetica Neue", "Arial", "Arial Black", "Avenir Next", "Georgia", "Times New Roman", "Verdana", "Trebuchet MS", "Impact", "Courier New", "Segoe UI"];

export function themeFor(show: Show | null, presentationId: number | undefined): Theme {
  if (!show) return DEFAULT_THEME;
  const p = show.presentations.find((x) => x.id === presentationId);
  return show.themes.find((t) => t.name === p?.theme) ?? show.themes[0] ?? DEFAULT_THEME;
}

export function mediaById(show: Show | null, id: number | null | undefined): MediaItem | null {
  if (!show || id == null) return null;
  return show.media.find((m) => m.id === id) ?? null;
}

/** Image or video filling the frame. Videos loop silently; thumbnails show a still frame. */
const reported = new Set<string>();
/** Say once per file when it can't be shown (moved/deleted file, unsupported video codec). */
function reportBroken(item: MediaItem, e: React.SyntheticEvent<HTMLImageElement | HTMLVideoElement>) {
  if (reported.has(item.path)) return;
  reported.add(item.path);
  const v = e.currentTarget as HTMLVideoElement;
  const why = v.error ? ` (media error ${v.error.code}${v.error.message ? `: ${v.error.message}` : ""})` : "";
  pushLog("warn", `Can't show “${item.name}” — is the file still at ${item.path}?${why}`);
}

export function MediaFill({ item, play }: { item: MediaItem; play: boolean }) {
  const src = mediaUrl(item.path);
  if (item.kind === "image") return <img className="media-fill" src={src} alt="" draggable={false} onError={(e) => reportBroken(item, e)} />;
  if (item.kind === "video")
    return play ? (
      <video className="media-fill" src={src} autoPlay loop muted playsInline onError={(e) => reportBroken(item, e)} />
    ) : (
      // #t=0.5: a frame from just after the start, as a still.
      <video className="media-fill" src={`${src}#t=0.5`} preload="metadata" muted playsInline onError={(e) => reportBroken(item, e)} />
    );
  return null;
}

export function SlideRender({
  text,
  theme = DEFAULT_THEME,
  background,
  kind = "audience",
  play = false,
  countdown,
}: {
  text: string;
  theme?: Theme;
  /** Media layer; overrides the theme's background media while set. */
  background?: MediaItem | null;
  kind?: "audience" | "stream";
  /** Play video backgrounds (outputs and Live preview); thumbnails stay still. */
  play?: boolean;
  countdown?: Countdown | null;
}) {
  const stream = kind === "stream";
  const bg = background ?? null;
  const position = stream ? "lower_third" : theme.position;
  return (
    <div className={`render pos-${position} ${stream ? "render-stream" : ""}`} style={{ background: stream ? "transparent" : theme.background_color }}>
      {!stream && bg && <MediaFill item={bg} play={play} />}
      {!stream && theme.dim > 0 && <div className="render-dim" style={{ opacity: theme.dim }} />}
      {text && (
        <div
          className={`render-text ${theme.shadow ? "shadow" : ""}`}
          style={{
            fontFamily: `"${theme.font}", "Helvetica Neue", Arial, system-ui, sans-serif`,
            color: theme.color,
            fontWeight: theme.bold ? 700 : 400,
            textTransform: theme.uppercase ? "uppercase" : "none",
            ["--size" as string]: theme.size,
          }}
        >
          {text.split("\n").map((l, i) => (
            <div key={i}>{l || " "}</div>
          ))}
        </div>
      )}
      {countdown && <CountdownBadge c={countdown} />}
    </div>
  );
}

/** Background for a slide: the media layer if one is set, else the theme's own media. */
export function slideBackground(show: Show | null, theme: Theme, mediaLayer: number | null): MediaItem | null {
  return mediaById(show, mediaLayer) ?? mediaById(show, theme.background_media);
}

export function useNow(intervalMs = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function formatRemaining(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function CountdownText({ c }: { c: Countdown }) {
  const now = useNow();
  return <>{formatRemaining(c.ends_at_unix_ms - now)}</>;
}

function CountdownBadge({ c }: { c: Countdown }) {
  return (
    <div className="render-countdown">
      <small>{c.label}</small>
      <CountdownText c={c} />
    </div>
  );
}
