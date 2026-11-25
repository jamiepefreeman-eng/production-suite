// ▶ Show mode: only the buttons and faders the operator needs during a service — cues, effects,
// blackout, release, match background, grand master and group faders. "Arrange" lets you drag them
// into your own order, rename and colour them, and teach each one a MIDI pad / fader ("Learn").

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { matchStatus, startMatching, stopMatching } from "../../shared/bgmatch";
import { startDrag, useDropTarget, wasDragging } from "../../shared/drag";
import MatchWheel from "../../shared/MatchWheel";
import { pushLog, send, updateShow, useEngine } from "../../shared/store";
import type {
  MidiControl,
  MidiMessage,
  Show,
  ShowItem,
  ShowItemKind,
} from "../../shared/types";
import { effectSwatch } from "./Effects";

const isFader = (k: ShowItemKind) =>
  k.type === "grand_master" || k.type === "group_master";

/** Same layout as the engine's ShowPage::generate: cues, effects, specials, then faders. */
export function generatePage(show: Show): ShowItem[] {
  const kinds: ShowItemKind[] = [
    ...show.cues.map((c) => ({ type: "cue" as const, cue: c.id })),
    ...show.effects.map((e) => ({ type: "effect" as const, effect: e.id })),
    { type: "match_background" },
    { type: "blackout" },
    { type: "release" },
    { type: "grand_master" },
    ...show.groups.map((g) => ({
      type: "group_master" as const,
      group: g.name,
    })),
  ];
  return kinds.map((kind, i) => ({
    id: i + 1,
    kind,
    label: "",
    color: "",
    midi: null,
  }));
}

const sameKind = (a: ShowItemKind, b: ShowItemKind) =>
  JSON.stringify(a) === JSON.stringify(b);

function autoLabel(show: Show, k: ShowItemKind): string {
  switch (k.type) {
    case "cue":
      return (
        show.cues.find((c) => c.id === k.cue)?.name ?? `Cue ${k.cue} (deleted)`
      );
    case "effect":
      return (
        show.effects.find((e) => e.id === k.effect)?.name ?? "Effect (deleted)"
      );
    case "grand_master":
      return "Master";
    case "group_master":
      return k.group;
    case "blackout":
      return "Blackout";
    case "release":
      return "Release all";
    case "match_background":
      return "Match background";
  }
}

export function midiControlOf(m: MidiMessage): MidiControl {
  return m.type === "control_change"
    ? { kind: "cc", channel: m.channel, number: m.controller }
    : { kind: "note", channel: m.channel, number: m.note };
}
const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];
export function midiLabel(c: MidiControl) {
  const ch = c.channel === 1 ? "" : ` ch${c.channel}`;
  return c.kind === "cc"
    ? `CC ${c.number}${ch}`
    : `${NOTE_NAMES[c.number % 12]}${Math.floor(c.number / 12) - 1} (${c.number})${ch}`;
}

export default function ShowPage({ show }: { show: Show }) {
  const eng = useEngine();
  const match = useSyncExternalStore(matchStatus.subscribe, matchStatus.get);
  const [arrange, setArrange] = useState(false);
  const [learning, setLearning] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const items = show.show_page.items;

  // MIDI learn: the next control moved is assigned to the armed item.
  const lastN = useRef(eng.lastMidi?.n ?? 0);
  useEffect(() => {
    if (!eng.lastMidi || eng.lastMidi.n === lastN.current) return;
    lastN.current = eng.lastMidi.n;
    if (learning == null) return;
    const ctl = midiControlOf(eng.lastMidi.message);
    void updateShow((d) => {
      for (const i of d.show_page.items) {
        if (
          i.midi &&
          i.midi.kind === ctl.kind &&
          i.midi.channel === ctl.channel &&
          i.midi.number === ctl.number
        )
          i.midi = null; // one control, one job
      }
      const it = d.show_page.items.find((i) => i.id === learning);
      if (it) it.midi = ctl;
    });
    pushLog(
      "info",
      `MIDI ${midiLabel(ctl)} → ${autoLabel(show, items.find((i) => i.id === learning)?.kind ?? { type: "blackout" })}`,
    );
    setLearning(null);
  }, [eng.lastMidi?.n]);

  const press = (it: ShowItem) => {
    if (arrange || wasDragging()) return;
    if (it.kind.type === "match_background") {
      if (match.running) stopMatching();
      else {
        const msg = startMatching([]);
        if (!matchStatus.get().running) pushLog("warn", msg);
      }
      return;
    }
    void send({ type: "trigger_show_item", item: it.id, value: 1 });
  };

  const active = (k: ShowItemKind) =>
    (k.type === "cue" && eng.activeCue === k.cue) ||
    (k.type === "effect" && eng.activeEffects.includes(k.effect)) ||
    (k.type === "blackout" && eng.blackout) ||
    (k.type === "match_background" && match.running);
  const level = (k: ShowItemKind) =>
    k.type === "grand_master"
      ? eng.grandMaster
      : k.type === "group_master"
        ? (eng.groupLevels.find((g) => g.group === k.group)?.level ?? 1)
        : 0;

  const editItem = (id: number, patch: Partial<ShowItem>) =>
    updateShow((d) => {
      const it = d.show_page.items.find((i) => i.id === id);
      if (it) Object.assign(it, patch);
    });
  const moveBefore = (dragged: number, target: number | null) =>
    updateShow((d) => {
      const list = d.show_page.items;
      const from = list.findIndex((i) => i.id === dragged);
      if (from < 0) return;
      const [it] = list.splice(from, 1);
      const to =
        target == null ? list.length : list.findIndex((i) => i.id === target);
      list.splice(to < 0 ? list.length : to, 0, it);
    });

  // Things not on the page yet (new cues, effects, groups).
  const candidates: ShowItemKind[] = generatePage(show)
    .map((i) => i.kind)
    .filter((k) => !items.some((i) => sameKind(i.kind, k)));
  const add = (kinds: ShowItemKind[]) =>
    updateShow((d) => {
      let id = Math.max(0, ...d.show_page.items.map((i) => i.id));
      for (const kind of kinds)
        d.show_page.items.push({
          id: ++id,
          kind,
          label: "",
          color: "",
          midi: null,
        });
    });

  if (items.length === 0)
    return (
      <div className="lk-showpage empty-page">
        <p>
          The show page holds just the buttons and faders you need during a
          service.
        </p>
        <button
          className="primary"
          onClick={() =>
            void updateShow((d) => void (d.show_page.items = generatePage(d)))
          }
        >
          Build my show page
        </button>
        <small className="muted">
          Cues, effects, blackout, release, match background and a fader for
          every group — rearrange them afterwards.
        </small>
      </div>
    );

  const buttons = items.filter((i) => !isFader(i.kind));
  const faders = items.filter((i) => isFader(i.kind));
  return (
    <div className={`lk-showpage ${arrange ? "arranging" : ""}`}>
      <div className="lk-sp-bar">
        {arrange ? (
          <>
            <b>Arrange</b>
            <span className="muted">
              Drag to reorder · click a name to rename · 🎹 Learn, then press a
              pad or move a fader on your controller
            </span>
            <span className="grow" />
            {candidates.length > 0 && (
              <span className="lk-sp-add">
                <button onClick={() => setAdding(!adding)}>
                  + Add ({candidates.length}) ▾
                </button>
                {adding && (
                  <div
                    className="popover"
                    onMouseLeave={() => setAdding(false)}
                  >
                    <button
                      onClick={() => (void add(candidates), setAdding(false))}
                    >
                      All of them
                    </button>
                    {candidates.map((k) => (
                      <button
                        key={JSON.stringify(k)}
                        onClick={() => void add([k])}
                      >
                        {isFader(k) ? "⇕ " : "▢ "}
                        {autoLabel(show, k)}
                      </button>
                    ))}
                  </div>
                )}
              </span>
            )}
            <button
              className="primary"
              onClick={() => (setArrange(false), setLearning(null))}
            >
              Done
            </button>
          </>
        ) : (
          <>
            <span className="grow" />
            {candidates.length > 0 && (
              <small className="muted">
                {candidates.length} new cue(s) / effect(s) / group(s) aren't on
                this page — add them in Arrange
              </small>
            )}
            <button
              onClick={() => setArrange(true)}
              title="Reorder, rename, colour and MIDI-learn the buttons and faders"
            >
              ✎ Arrange
            </button>
          </>
        )}
      </div>
      <div className="lk-sp-body">
        <div className="lk-sp-buttons">
          {buttons.map((it) => (
            <Tile
              key={it.id}
              it={it}
              show={show}
              arrange={arrange}
              active={active(it.kind)}
              learning={learning === it.id}
              onPress={() => press(it)}
              onMove={moveBefore}
              onEdit={editItem}
              onLearn={setLearning}
            />
          ))}
          {arrange && <EndDrop onMove={moveBefore} />}
        </div>
        {faders.length > 0 && (
          <div className="lk-sp-faders">
            {faders.map((it) => (
              <FaderTile
                key={it.id}
                it={it}
                show={show}
                arrange={arrange}
                value={level(it.kind)}
                learning={learning === it.id}
                onMove={moveBefore}
                onEdit={editItem}
                onLearn={setLearning}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface TileProps {
  it: ShowItem;
  show: Show;
  arrange: boolean;
  learning: boolean;
  onMove: (dragged: number, before: number | null) => void;
  onEdit: (id: number, patch: Partial<ShowItem>) => void;
  onLearn: (id: number | null) => void;
}

/** Drag handle + drop target for arranging (pointer-based, see shared/drag.ts). */
function useArrange(
  ref: React.RefObject<HTMLDivElement | null>,
  it: ShowItem,
  arrange: boolean,
  onMove: TileProps["onMove"],
) {
  const [over, setOver] = useState(false);
  useDropTarget(ref, arrange ? ["show-item"] : [], {
    onOver: () => setOver(true),
    onLeave: () => setOver(false),
    onDrop: (_pt, p) => {
      setOver(false);
      if (p.data !== it.id) onMove(p.data as number, it.id);
    },
  });
  const onPointerDown = (e: React.PointerEvent) => {
    if (!arrange || (e.target as HTMLElement).closest("input, button, select"))
      return;
    startDrag(e, { kind: "show-item", data: it.id, label: it.label || "move" });
  };
  return { over, onPointerDown };
}

function ArrangeControls({
  it,
  show,
  learning,
  onEdit,
  onLearn,
}: Omit<TileProps, "arrange" | "onMove">) {
  return (
    <div className="lk-sp-edit">
      <input
        value={it.label}
        placeholder={autoLabel(show, it.kind)}
        onChange={(e) => onEdit(it.id, { label: e.target.value })}
        title="Name on the button (blank = automatic)"
      />
      <div className="row">
        <input
          type="color"
          value={it.color || "#2a2d36"}
          onChange={(e) => onEdit(it.id, { color: e.target.value })}
          title="Button colour"
        />
        <button
          className={`small ${learning ? "on" : ""}`}
          onClick={() => onLearn(learning ? null : it.id)}
          title="Then press a pad / move a fader on your MIDI controller"
        >
          🎹 {learning ? "Waiting…" : "Learn"}
        </button>
        {it.midi && (
          <button
            className="small icon"
            title="Forget the MIDI control"
            onClick={() => onEdit(it.id, { midi: null })}
          >
            ⌫
          </button>
        )}
        <span className="grow" />
        <button
          className="small icon"
          title="Remove from the show page"
          onClick={() =>
            void updateShow(
              (d) =>
                void (d.show_page.items = d.show_page.items.filter(
                  (i) => i.id !== it.id,
                )),
            )
          }
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function Tile({
  it,
  show,
  arrange,
  active,
  learning,
  onPress,
  onMove,
  onEdit,
  onLearn,
}: TileProps & { active: boolean; onPress: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { over, onPointerDown } = useArrange(ref, it, arrange, onMove);
  const fx =
    it.kind.type === "effect"
      ? show.effects.find(
          (e) => it.kind.type === "effect" && e.id === it.kind.effect,
        )
      : undefined;
  return (
    <div
      ref={ref}
      className={`lk-sp-tile kind-${it.kind.type} ${active ? "active" : ""} ${over ? "drop-over" : ""} ${learning ? "learning" : ""}`}
      style={{ ["--tile" as string]: it.color || undefined }}
      onPointerDown={onPointerDown}
      onClick={onPress}
    >
      {fx && (
        <div
          className="lk-fx-swatch"
          style={{ background: effectSwatch(fx) }}
        />
      )}
      {it.kind.type === "match_background" && active && (
        <MatchWheel size={18} />
      )}
      <div className="lk-sp-label">{it.label || autoLabel(show, it.kind)}</div>
      {it.kind.type === "cue" && (
        <small className="lk-sp-sub">Cue {it.kind.cue}</small>
      )}
      {it.midi && <small className="lk-sp-midi">🎹 {midiLabel(it.midi)}</small>}
      {arrange && (
        <ArrangeControls
          it={it}
          show={show}
          learning={learning}
          onEdit={onEdit}
          onLearn={onLearn}
        />
      )}
    </div>
  );
}

function FaderTile({
  it,
  show,
  arrange,
  value,
  learning,
  onMove,
  onEdit,
  onLearn,
}: TileProps & { value: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { over, onPointerDown } = useArrange(ref, it, arrange, onMove);
  return (
    <div
      ref={ref}
      className={`lk-sp-fader ${over ? "drop-over" : ""} ${learning ? "learning" : ""}`}
      style={{ ["--tile" as string]: it.color || undefined }}
      onPointerDown={onPointerDown}
    >
      <b>{Math.round(value * 100)}%</b>
      <div className="vfader-wrap">
        <input
          type="range"
          className="vfader"
          min={0}
          max={1}
          step={0.005}
          value={value}
          disabled={arrange}
          onChange={(e) =>
            void send({
              type: "trigger_show_item",
              item: it.id,
              value: Number(e.target.value),
            })
          }
        />
      </div>
      <div className="lk-sp-label">{it.label || autoLabel(show, it.kind)}</div>
      {it.midi && <small className="lk-sp-midi">🎹 {midiLabel(it.midi)}</small>}
      {arrange && (
        <ArrangeControls
          it={it}
          show={show}
          learning={learning}
          onEdit={onEdit}
          onLearn={onLearn}
        />
      )}
    </div>
  );
}

/** Drop here to move something to the end. */
function EndDrop({
  onMove,
}: {
  onMove: (dragged: number, before: number | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  useDropTarget(ref, ["show-item"], {
    onOver: () => setOver(true),
    onLeave: () => setOver(false),
    onDrop: (_pt, p) => {
      setOver(false);
      onMove(p.data as number, null);
    },
  });
  return (
    <div
      ref={ref}
      className={`lk-sp-tile lk-sp-end ${over ? "drop-over" : ""}`}
    >
      Drop here to move to the end
    </div>
  );
}
