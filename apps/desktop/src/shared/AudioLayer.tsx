// Plays the engine's audio layer (walk-in music, tracks) in the main window
// and shows "now playing" with volume and stop in the top bar. Output windows
// and pop-outs don't render this, so audio never plays twice.

import { useEffect, useRef, useState } from "react";
import { mediaUrl } from "./bridge";
import { pushLog, send, useEngine } from "./store";

const FADE_MS = 1500;

const readVol = () => {
  try {
    const v = Number(localStorage.getItem("audio.volume"));
    return v > 0 && v <= 1 ? v : 0.8;
  } catch {
    return 0.8;
  }
};

export default function AudioLayer() {
  const { layers, show } = useEngine();
  const el = useRef<HTMLAudioElement | null>(null);
  const fade = useRef<number | null>(null);
  const [vol, setVol] = useState(readVol);
  const [pos, setPos] = useState({ t: 0, d: 0 });
  const item = show?.media.find((m) => m.id === layers.audio && m.kind === "audio") ?? null;
  const volRef = useRef(vol);
  volRef.current = vol;

  useEffect(() => {
    const a = el.current;
    if (!a) return;
    if (fade.current) window.clearInterval(fade.current);
    if (!item) {
      // Fade out instead of cutting off mid-song.
      const start = a.volume;
      const t0 = performance.now();
      fade.current = window.setInterval(() => {
        const k = Math.min(1, (performance.now() - t0) / FADE_MS);
        a.volume = start * (1 - k);
        if (k >= 1) {
          a.pause();
          if (fade.current) window.clearInterval(fade.current);
        }
      }, 40);
      return;
    }
    const src = mediaUrl(item.path);
    if (a.src !== src) a.src = src;
    a.loop = layers.audio_loop;
    a.volume = volRef.current;
    a.play().catch((e) => pushLog("warn", `Couldn't play ${item.name}: ${e}`));
  }, [item?.id, item?.path, layers.audio_loop]);

  useEffect(() => {
    if (el.current && item) el.current.volume = vol;
    try {
      localStorage.setItem("audio.volume", String(vol));
    } catch {
      /* fine */
    }
  }, [vol]);

  const fmt = (s: number) => (isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "–:––");

  return (
    <>
      <audio
        ref={el}
        onTimeUpdate={(e) => setPos({ t: e.currentTarget.currentTime, d: e.currentTarget.duration })}
        onEnded={() => !layers.audio_loop && send({ type: "play_audio", audio: null, looped: false })}
        onError={() => item && pushLog("warn", `Couldn't open ${item.path}`)}
      />
      {item && (
        <div className="now-playing" title={item.path}>
          <span className="np-icon">♪</span>
          <span className="np-name ellipsis">{item.name}</span>
          <small className="muted">
            {fmt(pos.t)} / {fmt(pos.d)}
          </small>
          <input type="range" min={0} max={1} step={0.01} value={vol} onChange={(e) => setVol(Number(e.target.value))} title={`Volume ${Math.round(vol * 100)}%`} />
          <button className="icon" title="Fade out and stop" onClick={() => send({ type: "play_audio", audio: null, looped: false })}>
            ■
          </button>
        </div>
      )}
    </>
  );
}
