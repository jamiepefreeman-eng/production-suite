// One renderer for every place a slide appears — thumbnails, Live/Next
// previews and the real outputs — so what the operator sees is what the room sees.

import { useEffect, useRef, useState } from "react";
import { mediaUrl } from "../../shared/bridge";
import { useInputStream } from "../../shared/inputs";
import { pushLog } from "../../shared/store";
import type { Countdown, MediaItem, Prop, Show, Slide, Theme } from "../../shared/types";

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

/** Live capture card / camera / NDI-webcam picture. */
function InputFill({ item }: { item: MediaItem }) {
  const { stream, error } = useInputStream(item.path);
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
      void ref.current.play().catch(() => {});
    }
  }, [stream]);
  if (error) return <div className="media-fill media-error">{error}</div>;
  return <video ref={ref} className="media-fill" autoPlay muted playsInline />;
}

/** Looping, silent background video that really autoplays everywhere. React never writes the
 *  `muted` attribute, and Safari/WKWebView refuses to autoplay a video it doesn't see as muted —
 *  which leaves it frozen on the first frame. Set it ourselves and call play(). */
function LoopVideo({ src, onError }: { src: string; onError: React.ReactEventHandler<HTMLVideoElement> }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    v.defaultMuted = true;
    v.setAttribute("muted", "");
    v.setAttribute("playsinline", "");
    const go = () => void v.play().catch(() => {});
    go();
    v.addEventListener("canplay", go);
    return () => v.removeEventListener("canplay", go);
  }, [src]);
  return <video ref={ref} className="media-fill" src={src} autoPlay loop muted playsInline preload="auto" onError={onError} />;
}

export function MediaFill({ item, play, onDuration }: { item: MediaItem; play: boolean; onDuration?: (seconds: number) => void }) {
  if (item.kind === "input") return play ? <InputFill item={item} /> : <div className="media-fill media-input-thumb">● {item.name}</div>;
  const src = mediaUrl(item.path);
  if (item.kind === "image") return <img className="media-fill" src={src} alt="" draggable={false} onError={(e) => reportBroken(item, e)} />;
  if (item.kind === "video")
    return play ? (
      <LoopVideo src={src} onError={(e) => reportBroken(item, e)} />
    ) : (
      // #t=0.5: a frame from just after the start, as a still.
      <video
        className="media-fill"
        src={`${src}#t=0.5`}
        preload="metadata"
        muted
        playsInline
        onLoadedMetadata={(e) => onDuration?.(e.currentTarget.duration)}
        onError={(e) => reportBroken(item, e)}
      />
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
  props,
  transparent = false,
}: {
  text: string;
  theme?: Theme;
  /** Media layer; overrides the theme's background media while set. */
  background?: MediaItem | null;
  kind?: "audience" | "stream";
  /** Play video backgrounds (outputs and Live preview); thumbnails stay still. */
  play?: boolean;
  countdown?: Countdown | null;
  /** Props showing on top (logo bug, lower third…). */
  props?: { prop: Prop; media: MediaItem | null }[];
  /** Thumbnails: no theme background — a slide shows only the media it brings itself
   *  (like ProPresenter); everything else is see-through (checkerboard). */
  transparent?: boolean;
}) {
  const stream = kind === "stream";
  const bg = background ?? null;
  const position = stream ? "lower_third" : theme.position;
  return (
    <div
      className={`render pos-${position} ${stream ? "render-stream" : ""} ${transparent && !bg ? "render-transparent" : ""}`}
      style={{ background: stream || (transparent && !bg) ? undefined : theme.background_color }}
    >
      {!stream && bg && <MediaFill item={bg} play={play} />}
      {!stream && theme.dim > 0 && bg && <div className="render-dim" style={{ opacity: theme.dim }} />}
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
      {props?.map(({ prop, media }) => (
        <div
          key={prop.id}
          className="render-prop"
          style={{ left: `${prop.x * 100}%`, top: `${prop.y * 100}%`, width: `${prop.w * 100}%`, height: `${prop.h * 100}%`, background: prop.background, color: prop.color, ["--ph" as string]: prop.h }}
        >
          {media && <MediaFill item={media} play={play} />}
          {prop.text && <span>{prop.text}</span>}
        </div>
      ))}
      {countdown && <CountdownBadge c={countdown} />}
    </div>
  );
}

/** Background for a slide: the media layer if one is set, else the theme's own media. */
export function slideBackground(show: Show | null, theme: Theme, mediaLayer: number | null): MediaItem | null {
  return mediaById(show, mediaLayer) ?? mediaById(show, theme.background_media);
}

/** The media a slide brings with it (dragged on from the bin), if any. */
export function slideMedia(show: Show | null, slide: Slide | undefined): MediaItem | null {
  const t = slide?.triggers.find((x) => x.type === "media");
  return t && t.type === "media" ? mediaById(show, t.media) : null;
}

/** Props currently on screen, resolved for rendering. */
export function liveProps(show: Show | null, ids: number[]) {
  if (!show) return [];
  return ids
    .map((id) => show.props.find((p) => p.id === id))
    .filter((p): p is Prop => !!p)
    .map((prop) => ({ prop, media: mediaById(show, prop.media) }));
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
