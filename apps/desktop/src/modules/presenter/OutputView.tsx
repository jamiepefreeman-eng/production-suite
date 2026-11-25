import { useEffect } from "react";
import { useEngine } from "../../shared/store";
import { CountdownText, DEFAULT_THEME, SlideRender, liveProps, mediaById, slideBackground, slideMedia, themeFor, useNow } from "./render";

type Kind = "audience" | "stage" | "stream";

// Re-exported so existing imports keep working.
export { SlideRender } from "./render";

function Clock() {
  const now = useNow(1000);
  return <div className="clock">{new Date(now).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>;
}

/** Full-window output (opened by the Presenter on another display). */
export default function OutputView({ kind }: { kind: Kind }) {
  const { live, show, layers } = useEngine();

  useEffect(() => {
    document.body.classList.add("output-body", `output-${kind}`);
    return () => document.body.classList.remove("output-body", `output-${kind}`);
  }, [kind]);

  if (kind === "stage") {
    const p = show?.presentations.find((x) => x.id === live?.presentation);
    const idx = p?.slides.findIndex((s) => s.id === live?.slide) ?? -1;
    const next = p && idx >= 0 ? p.slides[idx + 1] : undefined;
    return (
      <div className="stage-display">
        <div className="stage-top">
          <span>{live ? `${live.title} — ${live.label}` : "—"}</span>
          {layers.countdown && (
            <span className="stage-countdown">
              {layers.countdown.label} <b><CountdownText c={layers.countdown} /></b>
            </span>
          )}
          <Clock />
        </div>
        <div className="stage-current">{live?.text}</div>
        <div className="stage-next">
          <small>NEXT {next ? `· ${next.label}` : ""}</small>
          <div>{next?.text ?? ""}</div>
        </div>
      </div>
    );
  }

  // With no slide live (Clear Slide) only the media layer stays up, like ProPresenter.
  const theme = live ? themeFor(show, live.presentation) : { ...DEFAULT_THEME, background_color: "#000000" };
  const slide = show?.presentations.find((p) => p.id === live?.presentation)?.slides.find((s) => s.id === live?.slide);
  // Media layer wins; then media dragged onto the live slide; then the theme's background.
  const background = mediaById(show, layers.media) ?? (live ? (slideMedia(show, slide) ?? slideBackground(show, theme, null)) : null);
  return (
    <div className={`output output-${kind}`}>
      <SlideRender
        text={live?.text ?? ""}
        theme={theme}
        background={background}
        kind={kind}
        play
        countdown={kind === "audience" && layers.countdown?.show_on_audience ? layers.countdown : null}
        props={liveProps(show, layers.props)}
      />
    </div>
  );
}
