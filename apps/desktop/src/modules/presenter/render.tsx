// One renderer for every place a slide appears — thumbnails, Live/Next
// previews and the real outputs — so what the operator sees is what the room sees.

import { useEffect, useRef, useState } from "react";
import { mediaUrl } from "../../shared/bridge";
import { useInputStream } from "../../shared/inputs";
import { sequence } from "./groups";
import { pushLog } from "../../shared/store";
import type { Countdown, MediaItem, Prop, Show, Slide, SlideElement, TextAlign, TextStyle, Theme } from "../../shared/types";

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

export const EMPTY_STYLE: TextStyle = { font: null, size: null, color: null, bold: null, italic: null, uppercase: null, shadow: null, position: null, align: null };

export function newSlide(id: number, label: string, text = ""): Slide {
  return { id, label, text, triggers: [], style: { ...EMPTY_STYLE }, elements: [] };
}

/** The theme with this slide's own formatting on top. */
export interface Look extends Theme {
  italic: boolean;
  align: TextAlign;
}
export function styledTheme(theme: Theme, style: TextStyle | null | undefined): Look {
  const s = style ?? EMPTY_STYLE;
  return {
    ...theme,
    font: s.font ?? theme.font,
    size: s.size ?? theme.size,
    color: s.color ?? theme.color,
    bold: s.bold ?? theme.bold,
    uppercase: s.uppercase ?? theme.uppercase,
    shadow: s.shadow ?? theme.shadow,
    position: s.position ?? theme.position,
    italic: s.italic ?? false,
    align: s.align ?? "center",
  };
}

/** A slide's elements with their media resolved, for SlideRender. */
export function slideElements(show: Show | null, slide: Slide | undefined | null) {
  return (slide?.elements ?? []).map((el) => ({ el, media: el.kind === "media" ? mediaById(show, el.media) : null }));
}
export type RenderElement = ReturnType<typeof slideElements>[number];

const fontStack = (f: string) => `"${f}", "Helvetica Neue", Arial, system-ui, sans-serif`;

/** One element on a slide (text box, picture, video, live feed, shape). */
export function ElementView({ el, media, play }: { el: SlideElement; media: MediaItem | null; play: boolean }) {
  return (
    <div
      className={`render-el kind-${el.kind} align-${el.align}`}
      style={{
        left: `${el.x * 100}%`,
        top: `${el.y * 100}%`,
        width: `${el.w * 100}%`,
        height: `${el.h * 100}%`,
        background: el.background || undefined,
        borderRadius: `${el.radius}%`,
        opacity: el.opacity,
        color: el.color,
        fontFamily: fontStack(el.font),
        fontWeight: el.bold ? 700 : 400,
        fontStyle: el.italic ? "italic" : "normal",
        ["--el-size" as string]: el.size,
      }}
    >
      {el.kind === "media" && media && <MediaFill item={media} play={play} />}
      {el.kind === "media" && !media && <div className="render-el-empty">Drop media here</div>}
      {el.kind !== "media" && (
        <div className="render-el-text">
          {el.text.split("\n").map((l, i) => (
            <div key={i}>{l || "\u00a0"}</div>
          ))}
        </div>
      )}
    </div>
  );
}

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
  style,
  elements,
  footer,
}: {
  text: string;
  theme?: Theme;
  /** This slide's own formatting (font, colour…) over the theme. */
  style?: TextStyle | null;
  /** Text boxes, pictures, videos and live feeds on this slide. */
  elements?: RenderElement[];
  /** Small notice along the bottom (the song's CCLI copyright line). */
  footer?: string;
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
  const look = styledTheme(theme, style);
  const position = stream ? "lower_third" : look.position;
  return (
    <div
      className={`render pos-${position} align-${look.align} ${stream ? "render-stream" : ""} ${transparent && !bg ? "render-transparent" : ""}`}
      style={{ background: stream || (transparent && !bg) ? undefined : theme.background_color }}
    >
      {!stream && bg && <MediaFill item={bg} play={play} />}
      {!stream && theme.dim > 0 && bg && <div className="render-dim" style={{ opacity: theme.dim }} />}
      {!stream && elements?.map(({ el, media }) => <ElementView key={el.id} el={el} media={media} play={play} />)}
      {text && (
        <div
          className={`render-text ${look.shadow ? "shadow" : ""}`}
          style={{
            fontFamily: fontStack(look.font),
            color: look.color,
            fontWeight: look.bold ? 700 : 400,
            fontStyle: look.italic ? "italic" : "normal",
            textTransform: look.uppercase ? "uppercase" : "none",
            ["--size" as string]: look.size,
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
      {footer && !stream && <div className="render-footer">{footer}</div>}
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

/** The CCLI copyright notice for this slide, if the song shows one here (Show.ccli.footer). */
export function ccliFooter(show: Show | null, presentationId: number | undefined, slideId: number | undefined): string {
  if (!show || presentationId == null || slideId == null) return "";
  const p = show.presentations.find((x) => x.id === presentationId);
  const where = show.ccli?.footer ?? "last";
  if (!p || p.kind !== "song" || where === "off") return "";
  if (!p.ccli && !p.copyright && !p.authors) return "";
  const seq = sequence(p);
  const first = seq[0]?.slide.id;
  const last = seq[seq.length - 1]?.slide.id;
  if (!(where === "all" || (where === "first" && slideId === first) || (where === "last" && slideId === last))) return "";
  const parts = [`“${p.title}”${p.authors ? ` — ${p.authors.split("|").map((a) => a.trim()).join(", ")}` : ""}`];
  if (p.copyright) parts.push(p.copyright);
  const nums = [p.ccli ? `CCLI Song # ${p.ccli}` : "", show.ccli?.license ? `CCLI License # ${show.ccli.license}` : ""].filter(Boolean).join(" · ");
  if (nums) parts.push(nums);
  return parts.join("  ·  ");
}
