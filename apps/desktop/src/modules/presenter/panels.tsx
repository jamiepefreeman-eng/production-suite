// Media folders + media bin (bottom), and the right-hand tabs:
// Audio · Props · Timers · Macros · Slide actions.

import MediaSearch from "./MediaSearch";
import { useEffect, useRef, useState } from "react";
import { confirmDialog, pickMediaFiles } from "../../shared/bridge";
import { startDrag, useDropTarget, wasDragging } from "../../shared/drag";
import { listVideoInputs, type VideoInput } from "../../shared/inputs";
import { pushLog, send, updateShow, useEngine } from "../../shared/store";
import type { ClearLayer, Macro, MediaItem, MediaKind, Prop, Show, SlideTrigger } from "../../shared/types";
import { CountdownText, MediaFill, SlideRender, mediaById } from "./render";
import type { SlideRef } from "./PresenterApp";

export type Folder = { kind: "all" | "visual" | "audio" | "input" } | { kind: "playlist"; index: number };

export function triggerLabel(t: SlideTrigger, show?: Show | null): string {
  const m = (id: number | null) => (id == null ? "none" : (show?.media.find((x) => x.id === id)?.name ?? `#${id}`));
  switch (t.type) {
    case "lighting_cue":
      return `💡 Cue ${t.cue}`;
    case "lighting_text":
      return `💡 “${t.text}”`;
    case "blackout":
      return "💡 Blackout";
    case "mixer":
      return t.command.type === "recall_scene" ? `🎚 Scene ${t.command.scene}` : `🎚 ${t.command.type}`;
    case "media":
      return t.media == null ? "▣ Clear media" : `▣ ${m(t.media)}`;
    case "audio":
      return t.audio == null ? "♪ Stop audio" : `♪ ${m(t.audio)}`;
    case "prop":
      return `${t.on ? "◆" : "◇"} ${show?.props.find((p) => p.id === t.prop)?.name ?? `Prop ${t.prop}`}`;
    case "macro":
      return `⚡ ${show?.macros.find((x) => x.id === t.id)?.name ?? `Macro ${t.id}`}`;
    case "clear":
      return `✕ Clear ${t.layer}`;
  }
}

const kindOf = (path: string): MediaKind | null => {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext)) return "image";
  if (["mp4", "mov", "m4v", "webm"].includes(ext)) return "video";
  if (["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(ext)) return "audio";
  return null;
};

async function importMedia(show: Show, intoPlaylist?: number) {
  const paths = await pickMediaFiles();
  if (!paths.length) return;
  let id = Math.max(0, ...show.media.map((m) => m.id));
  const items: MediaItem[] = [];
  for (const path of paths) {
    const kind = kindOf(path);
    if (!kind || show.media.some((m) => m.path === path)) continue;
    items.push({ id: ++id, name: path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, ""), path, kind });
  }
  if (items.length)
    await updateShow((d) => {
      d.media.push(...items);
      if (intoPlaylist != null) d.media_playlists[intoPlaylist]?.items.push(...items.map((i) => i.id));
    });
  pushLog("info", `Added ${items.length} file(s) to the media bin`);
}

// ─────────────────────────────────────────────── Media folders (left bottom)

export function MediaFolders({ show, folder, setFolder }: { show: Show; folder: Folder; setFolder: (f: Folder) => void }) {
  const [naming, setNaming] = useState(false);
  const fixed: [Folder["kind"], string, string][] = [
    ["all", "▦", "All media"],
    ["visual", "▣", "Images & video"],
    ["input", "◉", "Video inputs"],
    ["audio", "♪", "Audio"],
  ];
  return (
    <div className="pp-section pp-folders">
      <header>
        <h3>Media</h3>
        <span className="grow" />
        <button className="icon" title="New media playlist" onClick={() => setNaming(true)}>
          +
        </button>
      </header>
      <ul className="pp-list">
        {fixed.map(([k, icon, label]) => (
          <li key={k} className={folder.kind === k ? "sel" : ""} onClick={() => setFolder({ kind: k } as Folder)}>
            <span className="pp-folder-icon">{icon}</span>
            {label}
          </li>
        ))}
        {show.media_playlists.map((pl, i) => (
          <FolderRow key={i} index={i} name={pl.name} count={pl.items.length} selected={folder.kind === "playlist" && folder.index === i} onSelect={() => setFolder({ kind: "playlist", index: i })} />
        ))}
        {naming && (
          <li>
            <input
              autoFocus
              placeholder="Playlist name"
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              onBlur={(e) => {
                setNaming(false);
                const name = e.target.value.trim();
                if (name) void updateShow((d) => void d.media_playlists.push({ name, items: [] }));
              }}
            />
          </li>
        )}
      </ul>
    </div>
  );
}

function FolderRow({ index, name, count, selected, onSelect }: { index: number; name: string; count: number; selected: boolean; onSelect: () => void }) {
  const ref = useRef<HTMLLIElement>(null);
  const [over, setOver] = useState(false);
  useDropTarget(ref, ["media"], {
    onOver: () => setOver(true),
    onLeave: () => setOver(false),
    onDrop: (_pt, p) => {
      setOver(false);
      void updateShow((d) => {
        const pl = d.media_playlists[index];
        if (pl && !pl.items.includes(p.data as number)) pl.items.push(p.data as number);
      });
    },
  });
  return (
    <li ref={ref} className={`${selected ? "sel" : ""} ${over ? "drop-over" : ""}`} onClick={onSelect}>
      <span className="pp-folder-icon">▤</span>
      <span className="grow ellipsis">{name}</span>
      <small>{count}</small>
      <button
        className="icon"
        title="Delete playlist (media stays in the bin)"
        onClick={(e) => {
          e.stopPropagation();
          void updateShow((d) => void d.media_playlists.splice(index, 1));
        }}
      >
        ✕
      </button>
    </li>
  );
}

// ─────────────────────────────────────────────── Media bin (centre bottom)

export function Bin({ show, folder, height, onResize }: { show: Show; folder: Folder; height: number; onResize: (h: number) => void }) {
  const { layers } = useEngine();
  const [q, setQ] = useState("");
  const [inputs, setInputs] = useState<VideoInput[] | null>(null);
  const [size, setSize] = useState(150);
  const [finding, setFinding] = useState(false);

  const items = show.media.filter((m) => {
    if (q && !m.name.toLowerCase().includes(q.toLowerCase())) return false;
    switch (folder.kind) {
      case "all":
        return true;
      case "visual":
        return m.kind === "image" || m.kind === "video";
      case "audio":
        return m.kind === "audio";
      case "input":
        return m.kind === "input";
      case "playlist":
        return show.media_playlists[folder.index]?.items.includes(m.id) ?? false;
    }
  });
  const title =
    folder.kind === "playlist" ? (show.media_playlists[folder.index]?.name ?? "Playlist") : { all: "All media", visual: "Images & video", audio: "Audio", input: "Video inputs" }[folder.kind];

  const startResize = (e: React.PointerEvent) => {
    const y0 = e.clientY;
    const h0 = height;
    const move = (ev: PointerEvent) => onResize(Math.max(80, Math.min(520, h0 - (ev.clientY - y0))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const addInput = async () => {
    try {
      setInputs(await listVideoInputs());
    } catch (e) {
      pushLog("warn", String((e as Error).message ?? e));
    }
  };

  const activate = (m: MediaItem) =>
    m.kind === "audio"
      ? send({ type: "play_audio", audio: layers.audio === m.id ? null : m.id, looped: false })
      : send({ type: "set_media", media: layers.media === m.id ? null : m.id });

  return (
    <section className="pp-bin2" style={{ ["--tile" as string]: `${size}px` }}>
      <div className="pp-bin-resize" onPointerDown={startResize} title="Drag to resize" />
      <div className="pp-bin-head">
        <b>{title}</b>
        <small className="muted">{items.length}</small>
        <span className="grow" />
        <input className="pp-bin-filter" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className={`small ${finding ? "on" : ""}`} onClick={() => setFinding(!finding)} title="Describe a background and let AI find it in the bin">
          ✦ Find
        </button>
        {folder.kind === "input" ? (
          <button className="small" onClick={addInput}>
            + Add video input…
          </button>
        ) : (
          <button className="small" onClick={() => importMedia(show, folder.kind === "playlist" ? folder.index : undefined)}>
            + Add files…
          </button>
        )}
        <input type="range" min={90} max={260} value={size} onChange={(e) => setSize(Number(e.target.value))} title="Thumbnail size" />
      </div>
      {finding && <MediaSearch show={show} onClose={() => setFinding(false)} />}
      {inputs && (
        <div className="pp-inputs">
          <b>Connected video inputs</b>
          {inputs.length === 0 && <span className="muted">None found — plug in the capture card / camera and try again.</span>}
          {inputs.map((d) => (
            <button
              key={d.deviceId}
              disabled={show.media.some((m) => m.kind === "input" && m.path === d.label)}
              onClick={() => {
                void updateShow((x) => void x.media.push({ id: Math.max(0, ...x.media.map((m) => m.id)) + 1, name: d.label, path: d.label, kind: "input" }));
                setInputs(null);
              }}
            >
              ◉ {d.label}
            </button>
          ))}
          <small className="muted">NDI: install the free NDI Tools and run “NDI Webcam” — it appears here as a camera.</small>
          <button className="icon" onClick={() => setInputs(null)}>
            ✕
          </button>
        </div>
      )}
      <div className="pp-bin-grid">
        {items.map((m) => (
          <div
            key={m.id}
            className={`pp-media ${layers.media === m.id || layers.audio === m.id ? "live" : ""} kind-${m.kind}`}
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest("button")) return;
              startDrag(e, { kind: "media", data: m.id, label: `${m.kind === "audio" ? "♪" : "▣"} ${m.name}` });
            }}
            onClick={() => !wasDragging() && activate(m)}
            title={`${m.name} — click to put on screen (or play), drag onto a slide or a playlist`}
          >
            <BinThumb m={m} />
            <div className="pp-media-name">
              <span className="ellipsis grow">{m.name}</span>
              <button
                className="icon"
                title={folder.kind === "playlist" ? "Remove from this playlist" : "Remove from bin (file isn't deleted)"}
                onClick={(e) => {
                  e.stopPropagation();
                  if (folder.kind === "playlist")
                    void updateShow((d) => {
                      const pl = d.media_playlists[folder.index];
                      if (pl) pl.items = pl.items.filter((x) => x !== m.id);
                    });
                  else
                    void confirmDialog(`Remove “${m.name}” from the bin?`).then((yes) => {
                      if (!yes) return;
                      void updateShow((d) => {
                        d.media = d.media.filter((x) => x.id !== m.id);
                        for (const pl of d.media_playlists) pl.items = pl.items.filter((x) => x !== m.id);
                        for (const t of d.themes) if (t.background_media === m.id) t.background_media = null;
                        for (const pr of d.props) if (pr.media === m.id) pr.media = null;
                      });
                    });
                }}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="muted pp-bin-empty">
            {folder.kind === "input"
              ? "Add a capture card or camera with “+ Add video input…”. Use it like any background: click it, or drag it onto a slide."
              : "Add images, video loops and audio with “+ Add files…”. Click to put on screen; drag onto a slide so it comes up with that slide."}
          </div>
        )}
      </div>
    </section>
  );
}

/** Bin thumbnail: still frame with its length; motion backgrounds play while you hover. */
function BinThumb({ m }: { m: MediaItem }) {
  const [hover, setHover] = useState(false);
  const [dur, setDur] = useState<number | null>(null);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  return (
    <div className="pp-media-thumb" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {m.kind === "audio" ? (
        <div className="media-fill pp-audio-thumb">♪</div>
      ) : (
        <MediaFill item={m} play={m.kind === "input" || (m.kind === "video" && hover)} onDuration={setDur} />
      )}
      {m.kind === "video" && (
        <span className="pp-media-dur">
          {dur && isFinite(dur) ? fmt(dur) : ""} <span title="Loops">⟲</span>
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────── Right tabs

export function RightTabs({
  show,
  tab,
  setTab,
  selected,
  onCloseSlide,
}: {
  show: Show;
  tab: string;
  setTab: (t: string) => void;
  selected: SlideRef | null;
  onCloseSlide: () => void;
}) {
  const tabs: [string, string, string][] = [
    ["audio", "♪", "Audio"],
    ["props", "◆", "Props"],
    ["timers", "◷", "Timers"],
    ["macros", "⚡", "Macros"],
    ["slide", "⚙", "Slide"],
  ];
  return (
    <div className="pp-rtabs">
      <div className="pp-rtab-bar">
        {tabs.map(([k, icon, label]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)} title={label}>
            <span>{icon}</span>
            <small>{label}</small>
          </button>
        ))}
      </div>
      <div className="pp-rtab-body">
        {tab === "audio" && <AudioTab show={show} />}
        {tab === "props" && <PropsTab show={show} />}
        {tab === "timers" && <TimersTab />}
        {tab === "macros" && <MacrosTab show={show} />}
        {tab === "slide" && <SlideActions show={show} selected={selected} onClose={onCloseSlide} />}
      </div>
    </div>
  );
}

function AudioTab({ show }: { show: Show }) {
  const { layers } = useEngine();
  const [loop, setLoop] = useState(true);
  const items = show.media.filter((m) => m.kind === "audio");
  return (
    <div className="pp-audio-list">
      <label className="inline muted">
        <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop
      </label>
      {items.length === 0 && <div className="muted">Add walk-in music in the media bin (+ Add files…). It plays from this computer's sound output.</div>}
      {items.map((m) => {
        const on = layers.audio === m.id;
        return (
          <div key={m.id} className={`pp-audio ${on ? "live" : ""}`} onPointerDown={(e) => !(e.target as HTMLElement).closest("button") && startDrag(e, { kind: "media", data: m.id, label: `♪ ${m.name}` })}>
            <button className={on ? "danger on" : ""} onClick={() => send({ type: "play_audio", audio: on ? null : m.id, looped: loop })}>
              {on ? "■" : "▶"}
            </button>
            <span className="grow ellipsis">{m.name}</span>
            {on && layers.audio_loop && <small className="muted">loop</small>}
          </div>
        );
      })}
    </div>
  );
}

function TimersTab() {
  const { layers } = useEngine();
  const [label, setLabel] = useState("Service starts in");
  const [mins, setMins] = useState(5);
  const [audience, setAudience] = useState(true);
  const start = (m: number) => send({ type: "start_countdown", label, seconds: Math.round(m * 60), show_on_audience: audience });
  return (
    <div className="pp-timers">
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" />
      <div className="row wrap">
        {[1, 2, 5, 10].map((m) => (
          <button key={m} onClick={() => start(m)}>
            {m} min
          </button>
        ))}
      </div>
      <div className="row">
        <input type="number" min={0.5} step={0.5} value={mins} onChange={(e) => setMins(Number(e.target.value))} />
        <span className="muted">min</span>
        <button className="primary" onClick={() => start(mins)}>
          Start
        </button>
      </div>
      <label className="inline muted">
        <input type="checkbox" checked={audience} onChange={(e) => setAudience(e.target.checked)} /> Show on audience screen
      </label>
      <div className="pp-timer-now">
        {layers.countdown ? (
          <>
            <span className="muted">{layers.countdown.label}</span>
            <b>
              <CountdownText c={layers.countdown} />
            </b>
            <button onClick={() => send({ type: "clear_countdown" })}>Clear</button>
          </>
        ) : (
          <span className="muted">No timer running. It always shows on the stage display.</span>
        )}
      </div>
    </div>
  );
}

// ── Props

function PropsTab({ show }: { show: Show }) {
  const { layers } = useEngine();
  const [editing, setEditing] = useState<number | null>(null);
  const prop = show.props.find((p) => p.id === editing);
  const add = () => {
    const id = Math.max(0, ...show.props.map((p) => p.id)) + 1;
    void updateShow(
      (d) =>
        void d.props.push({ id, name: `Prop ${id}`, media: null, text: "Text", x: 0.05, y: 0.8, w: 0.4, h: 0.1, color: "#ffffff", background: "#000000b3" }),
    );
    setEditing(id);
  };
  if (prop) return <PropEditor show={show} prop={prop} onClose={() => setEditing(null)} />;
  return (
    <div className="pp-props">
      <p className="muted">Click to show / hide over everything. Drag onto a slide to bring it up with that slide.</p>
      {show.props.map((p) => {
        const on = layers.props.includes(p.id);
        return (
          <div
            key={p.id}
            className={`pp-prop ${on ? "live" : ""}`}
            onPointerDown={(e) => !(e.target as HTMLElement).closest("button") && startDrag(e, { kind: "prop", data: p.id, label: `◆ ${p.name}` })}
            onClick={() => !wasDragging() && send({ type: "set_prop", prop: p.id, on: !on })}
          >
            <div className="pp-prop-thumb">
              <SlideRender text="" theme={{ name: "", font: "Inter", size: 1, color: "#fff", bold: true, uppercase: false, shadow: false, position: "center", background_color: "#16171b", background_media: null, dim: 0 }} props={[{ prop: p, media: mediaById(show, p.media) }]} />
            </div>
            <span className="grow ellipsis">{p.name}</span>
            <button
              className="icon"
              title="Edit"
              onClick={(e) => {
                e.stopPropagation();
                setEditing(p.id);
              }}
            >
              ✎
            </button>
          </div>
        );
      })}
      <button onClick={add}>+ New prop</button>
    </div>
  );
}

function PropEditor({ show, prop, onClose }: { show: Show; prop: Prop; onClose: () => void }) {
  const set = (patch: Partial<Prop>) =>
    updateShow((d) => {
      const x = d.props.find((y) => y.id === prop.id);
      if (x) Object.assign(x, patch);
    });
  const pct = (k: "x" | "y" | "w" | "h", label: string) => (
    <label className="inline muted">
      {label}
      <input type="number" min={0} max={100} value={Math.round(prop[k] * 100)} onChange={(e) => void set({ [k]: Math.max(0, Math.min(100, Number(e.target.value))) / 100 })} />%
    </label>
  );
  return (
    <div className="pp-prop-edit">
      <div className="row">
        <input className="grow" value={prop.name} onChange={(e) => void set({ name: e.target.value })} />
        <button onClick={onClose}>Done</button>
      </div>
      <div className="pp-preview">
        <SlideRender text="" theme={{ name: "", font: "Inter", size: 1, color: "#fff", bold: true, uppercase: false, shadow: false, position: "center", background_color: "#16171b", background_media: null, dim: 0 }} props={[{ prop, media: mediaById(show, prop.media) }]} />
      </div>
      <label>Text</label>
      <input value={prop.text} onChange={(e) => void set({ text: e.target.value })} />
      <label>Image / video</label>
      <select value={prop.media ?? ""} onChange={(e) => void set({ media: e.target.value ? Number(e.target.value) : null })}>
        <option value="">None</option>
        {show.media
          .filter((m) => m.kind !== "audio")
          .map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
      </select>
      <div className="row wrap">
        {pct("x", "Left")}
        {pct("y", "Top")}
        {pct("w", "Width")}
        {pct("h", "Height")}
      </div>
      <div className="row">
        <label className="inline muted">
          Text <input type="color" value={prop.color.slice(0, 7)} onChange={(e) => void set({ color: e.target.value })} />
        </label>
        <label className="inline muted">
          Box <input type="color" value={prop.background.slice(0, 7)} onChange={(e) => void set({ background: `${e.target.value}${prop.background.slice(7, 9) || "b3"}` })} />
        </label>
        <label className="inline muted">
          <input type="checkbox" checked={prop.background.slice(7, 9) !== "00"} onChange={(e) => void set({ background: `${prop.background.slice(0, 7)}${e.target.checked ? "b3" : "00"}` })} /> Box
        </label>
      </div>
      <button
        onClick={() =>
          void confirmDialog(`Delete prop “${prop.name}”?`).then((yes) => {
            if (!yes) return;
            onClose();
            void send({ type: "set_prop", prop: prop.id, on: false });
            void updateShow((d) => void (d.props = d.props.filter((x) => x.id !== prop.id)));
          })
        }
      >
        Delete prop
      </button>
    </div>
  );
}

// ── Macros

function MacrosTab({ show }: { show: Show }) {
  const [editing, setEditing] = useState<number | null>(null);
  const m = show.macros.find((x) => x.id === editing);
  if (m) return <MacroEditor show={show} m={m} onClose={() => setEditing(null)} />;
  return (
    <div className="pp-macros">
      <div className="pp-macro-grid">
        {show.macros.map((x) => (
          <div
            key={x.id}
            className="pp-macro"
            style={{ ["--mc" as string]: x.color }}
            onPointerDown={(e) => !(e.target as HTMLElement).closest("button") && startDrag(e, { kind: "macro", data: x.id, label: `⚡ ${x.name}` })}
            onClick={() => !wasDragging() && send({ type: "run_macro", id: x.id })}
            title={x.actions.map((a) => triggerLabel(a, show)).join(" · ")}
          >
            <b className="ellipsis">{x.name}</b>
            <small>{x.actions.length} actions</small>
            <button
              className="icon"
              title="Edit"
              onClick={(e) => {
                e.stopPropagation();
                setEditing(x.id);
              }}
            >
              ✎
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={() => {
          const id = Math.max(0, ...show.macros.map((x) => x.id)) + 1;
          void updateShow((d) => void d.macros.push({ id, name: `Macro ${id}`, color: "#8b5cf6", actions: [] }));
          setEditing(id);
        }}
      >
        + New macro
      </button>
      <small className="muted">Click to run. Drag onto a slide to run it when the slide goes live.</small>
    </div>
  );
}

function MacroEditor({ show, m, onClose }: { show: Show; m: Macro; onClose: () => void }) {
  const set = (fn: (x: Macro) => void) =>
    updateShow((d) => {
      const x = d.macros.find((y) => y.id === m.id);
      if (x) fn(x);
    });
  return (
    <div className="pp-macro-edit">
      <div className="row">
        <input type="color" value={m.color.slice(0, 7)} onChange={(e) => void set((x) => void (x.color = e.target.value))} />
        <input className="grow" value={m.name} onChange={(e) => void set((x) => void (x.name = e.target.value))} />
        <button onClick={onClose}>Done</button>
      </div>
      <ActionList show={show} actions={m.actions} onChange={(actions) => set((x) => void (x.actions = actions))} excludeMacro={m.id} />
      <div className="row">
        <button onClick={() => send({ type: "run_macro", id: m.id })}>▶ Test</button>
        <span className="grow" />
        <button
          onClick={() =>
            void confirmDialog(`Delete macro “${m.name}”?`).then((yes) => {
              if (!yes) return;
              onClose();
              void updateShow((d) => void (d.macros = d.macros.filter((x) => x.id !== m.id)));
            })
          }
        >
          Delete
        </button>
      </div>
    </div>
  );
}

// ── Slide actions (and the action list shared with macros)

function SlideActions({ show, selected, onClose }: { show: Show; selected: SlideRef | null; onClose: () => void }) {
  const p = show.presentations.find((x) => x.id === selected?.p);
  const s = p?.slides.find((x) => x.id === selected?.s);
  if (!p || !s) return <p className="muted">Right-click a slide (or its ⚙) to choose what happens when it goes live: lights, mixer, media, props, macros.</p>;
  const setTriggers = (triggers: SlideTrigger[]) =>
    updateShow((d) => {
      const x = d.presentations.find((y) => y.id === p.id)?.slides.find((y) => y.id === s.id);
      if (x) x.triggers = triggers;
    });
  return (
    <div className="pp-slide-actions">
      <header className="row">
        <b className="grow ellipsis">
          {p.title} · {s.label}
        </b>
        <button className="icon" onClick={onClose}>
          ✕
        </button>
      </header>
      <ActionList show={show} actions={s.triggers} onChange={(t) => void setTriggers(t)} />
    </div>
  );
}

const CLEARS: ClearLayer[] = ["all", "slide", "media", "audio", "props", "timer", "lights"];

function ActionList({ show, actions, onChange, excludeMacro }: { show: Show; actions: SlideTrigger[]; onChange: (a: SlideTrigger[]) => void; excludeMacro?: number }) {
  const [text, setText] = useState("");
  const [scene, setScene] = useState(1);
  const add = (t: SlideTrigger) => onChange([...actions, t]);
  const pick = (placeholder: string, options: [string, string][], make: (v: string) => SlideTrigger) => (
    <select value="" onChange={(e) => e.target.value && add(make(e.target.value))}>
      <option value="">{placeholder}</option>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
  useEffect(() => setText(""), [actions.length]);
  return (
    <div className="pp-action-list">
      <ul className="list compact">
        {actions.map((t, i) => (
          <li key={i}>
            <span className="grow">{triggerLabel(t, show)}</span>
            <button className="icon" disabled={i === 0} onClick={() => onChange(actions.map((x, j) => (j === i - 1 ? actions[i] : j === i ? actions[i - 1] : x)))}>
              ↑
            </button>
            <button className="icon" onClick={() => onChange(actions.filter((_, j) => j !== i))}>
              ✕
            </button>
          </li>
        ))}
        {actions.length === 0 && <li className="muted">Nothing yet</li>}
      </ul>
      <div className="pp-action-adders">
        {pick("+ Lighting cue…", show.cues.map((c): [string, string] => [String(c.id), `${c.id}. ${c.name}`]), (v) => ({ type: "lighting_cue", cue: Number(v) }))}
        {pick(
          "+ Media…",
          [...show.media.filter((m) => m.kind !== "audio").map((m): [string, string] => [String(m.id), m.name]), ["clear", "Clear media"]],
          (v) => ({ type: "media", media: v === "clear" ? null : Number(v) }),
        )}
        {pick("+ Audio…", [...show.media.filter((m) => m.kind === "audio").map((m) => [String(m.id), m.name] as [string, string]), ["stop", "Stop audio"]], (v) =>
          v === "stop" ? { type: "audio", audio: null, looped: false } : { type: "audio", audio: Number(v), looped: false },
        )}
        {pick("+ Prop…", show.props.flatMap((p) => [[`${p.id}:1`, `Show ${p.name}`], [`${p.id}:0`, `Hide ${p.name}`]] as [string, string][]), (v) => ({
          type: "prop",
          prop: Number(v.split(":")[0]),
          on: v.endsWith(":1"),
        }))}
        {pick("+ Macro…", show.macros.filter((x) => x.id !== excludeMacro).map((x): [string, string] => [String(x.id), x.name]), (v) => ({ type: "macro", id: Number(v) }))}
        {pick("+ Clear…", CLEARS.map((c): [string, string] => [c, `Clear ${c}`]), (v) => ({ type: "clear", layer: v as ClearLayer }))}
      </div>
      <div className="row">
        <input className="grow" value={text} placeholder="Lights by sentence: back wall blue at 40" onChange={(e) => setText(e.target.value)} />
        <button disabled={!text.trim()} onClick={() => add({ type: "lighting_text", text })}>
          Add
        </button>
      </div>
      <div className="row">
        <span className="muted">Mixer scene</span>
        <input type="number" min={1} value={scene} onChange={(e) => setScene(Number(e.target.value))} />
        <button onClick={() => add({ type: "mixer", command: { type: "recall_scene", scene } })}>Add</button>
        <button onClick={() => add({ type: "blackout" })}>+ Blackout</button>
      </div>
    </div>
  );
}
