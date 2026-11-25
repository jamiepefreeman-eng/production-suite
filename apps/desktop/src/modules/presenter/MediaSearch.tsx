// "✦ Find" in the media bin: describe a background, see the best matches, use one for a song.

import { useState } from "react";
import { pushLog, send, updateShow } from "../../shared/store";
import type { MediaAnalysis, Show } from "../../shared/types";
import { analyseMedia, search, serviceSongs, type Pick } from "./mediaAnalysis";
import { MediaFill } from "./render";

export default function MediaSearch({ show, onClose }: { show: Show; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [res, setRes] = useState<Awaited<ReturnType<typeof search>> | null>(null);
  const [song, setSong] = useState<number | "">("");

  /** Measure anything not measured yet, save it on the media items, return the updated show. */
  const analyseMissing = async (): Promise<Show> => {
    const todo = show.media.filter((m) => (m.kind === "image" || m.kind === "video") && !m.analysis);
    if (!todo.length) return show;
    const found = new Map<number, MediaAnalysis>();
    for (const [i, m] of todo.entries()) {
      setBusy(`Looking at ${m.name} (${i + 1}/${todo.length})…`);
      try {
        found.set(m.id, await analyseMedia(m));
      } catch (e) {
        pushLog("warn", `Couldn't analyse “${m.name}”: ${(e as Error).message ?? e}`);
      }
    }
    await updateShow((d) => {
      for (const m of d.media) if (found.has(m.id)) m.analysis = found.get(m.id)!;
    });
    return { ...show, media: show.media.map((m) => (found.has(m.id) ? { ...m, analysis: found.get(m.id)! } : m)) };
  };

  const run = async () => {
    if (!q.trim()) return;
    try {
      const s = await analyseMissing();
      setBusy("Choosing…");
      const r = await search(q, s);
      setRes(r);
      setSong(r.target?.id ?? "");
    } catch (e) {
      pushLog("warn", String(e));
    } finally {
      setBusy(null);
    }
  };

  const useFor = (p: Pick) => {
    const pres = show.presentations.find((x) => x.id === song);
    if (!pres || !pres.slides.length) return;
    void updateShow((d) => {
      const s = d.presentations.find((x) => x.id === pres.id)?.slides[0];
      if (!s) return;
      s.triggers = [...s.triggers.filter((t) => t.type !== "media"), { type: "media", media: p.item.id }];
    });
    pushLog("info", `“${p.item.name}” is now the background cue on the first slide of “${pres.title}”`);
  };

  const songs = serviceSongs(show);
  return (
    <div className="pp-msearch">
      <div className="row">
        <span className="pp-msearch-icon">✦</span>
        <input
          className="grow"
          autoFocus
          value={q}
          placeholder="Describe the background… e.g. for song one I want a fast upbeat background with movement, orange"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void run()}
        />
        <button className="primary" disabled={!!busy || !q.trim()} onClick={() => void run()}>
          Find
        </button>
        <button className="icon" onClick={onClose} title="Close">
          ✕
        </button>
      </div>
      {busy && <div className="muted">{busy}</div>}
      {res && !busy && (
        <>
          <div className="row wrap muted">
            <span className="tag">{res.engine === "ai" ? "AI" : "offline"}</span>
            {res.engine === "offline" && res.note && <small>({res.note.replace(/^Error: /, "")})</small>}
            <span className="grow" />
            <label className="inline">
              Use for
              <select value={song} onChange={(e) => setSong(e.target.value ? Number(e.target.value) : "")}>
                <option value="">— choose a song —</option>
                {songs.map((p, i) => (
                  <option key={p.id} value={p.id}>
                    {i + 1}. {p.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {res.picks.length === 0 && <p className="muted">No images or videos in the bin yet — add some with “+ Add files…”.</p>}
          <div className="pp-msearch-results">
            {res.picks.map((p, i) => (
              <div key={p.item.id} className="pp-msearch-card">
                <div className="pp-msearch-thumb">
                  <MediaFill item={p.item} play />
                  <span className="pp-msearch-rank">{i + 1}</span>
                </div>
                <b className="ellipsis">{p.item.name}</b>
                <small>{p.reason}</small>
                {p.item.analysis && (
                  <span className="pp-msearch-swatches">
                    {p.item.analysis.colors.slice(0, 4).map((c) => (
                      <span key={c} style={{ background: c }} />
                    ))}
                  </span>
                )}
                <div className="row">
                  <button className="primary small" disabled={song === ""} onClick={() => useFor(p)} title="Background cue on the song's first slide">
                    Use for song
                  </button>
                  <button className="small" onClick={() => send({ type: "set_media", media: p.item.id })} title="Put it on screen now">
                    Show now
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
