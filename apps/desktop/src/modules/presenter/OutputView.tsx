import { useEffect, useState } from "react";
import { useEngine } from "../../shared/store";

type Kind = "audience" | "stage" | "stream";

/** Renders slide text for a given output style. Used for thumbnails too. */
export function SlideRender({ text, kind }: { text: string; kind: Kind }) {
  return (
    <div className={`render render-${kind}`}>
      <div className="render-text">
        {text.split("\n").map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return <div className="clock">{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>;
}

/** Full-window output (opened by the Presenter on another display). */
export default function OutputView({ kind }: { kind: Kind }) {
  const { live, show } = useEngine();

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

  return (
    <div className={`output output-${kind}`}>
      {live && <SlideRender text={live.text} kind={kind} />}
    </div>
  );
}
