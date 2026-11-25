// Effects in Program mode: tiles next to the cues (click = start / stop) and a small editor.
// The engine plays them (suite_core::lighting::effects), so they run the same from the show page
// and MIDI.

import { useState } from "react";
import { confirmDialog } from "../../shared/bridge";
import { send, updateShow, useEngine } from "../../shared/store";
import type { Effect, EffectKind, Rgb, Show } from "../../shared/types";

const KINDS: [EffectKind, string, string][] = [
  [
    "rainbow",
    "Rainbow",
    "Colours roll round the wheel, spread across the lights",
  ],
  ["chase", "Chase", "One light after another, left to right"],
  [
    "pulse",
    "Pulse / breathe",
    "Brightness breathes up and down (a wave when spread)",
  ],
  ["two_colour", "Two colours", "Swaps between two colours"],
  ["strobe", "Strobe", "Short flashes"],
];

const toHex = (c: Rgb) =>
  "#" +
  [c.r, c.g, c.b]
    .map((v) =>
      Math.round(Math.max(0, Math.min(1, v)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
const fromHex = (h: string): Rgb => ({
  r: parseInt(h.slice(1, 3), 16) / 255,
  g: parseInt(h.slice(3, 5), 16) / 255,
  b: parseInt(h.slice(5, 7), 16) / 255,
});

/** Preview swatch for a tile. */
export function effectSwatch(e: Effect) {
  return e.kind === "rainbow"
    ? "linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)"
    : e.kind === "two_colour"
      ? `linear-gradient(90deg, ${toHex(e.color)} 50%, ${toHex(e.color2)} 50%)`
      : toHex(e.color);
}

export default function EffectTiles({
  show,
  sel,
}: {
  show: Show;
  sel: number[];
}) {
  const { activeEffects } = useEngine();
  const [editing, setEditing] = useState<number | null>(null);

  const add = () => {
    // Start from the group that matches the selection exactly, if any.
    const g = show.groups.find(
      (x) =>
        sel.length > 0 &&
        x.fixtures.length === sel.length &&
        x.fixtures.every((f) => sel.includes(f)),
    );
    const id = Math.max(0, ...show.effects.map((e) => e.id)) + 1;
    const effect: Effect = {
      id,
      name: `Effect ${id}`,
      kind: "rainbow",
      group: g?.name ?? show.groups[0]?.name ?? "",
      color: { r: 1, g: 0, b: 0 },
      color2: { r: 0, g: 0, b: 1 },
      speed: 0.25,
      spread: 1,
      level: 1,
    };
    void updateShow((d) => {
      d.effects.push(effect);
      // Put it on the show page too (before the faders).
      if (d.show_page.items.length) {
        const at = d.show_page.items.findIndex(
          (i) =>
            i.kind.type === "grand_master" || i.kind.type === "group_master",
        );
        const item = {
          id: Math.max(0, ...d.show_page.items.map((i) => i.id)) + 1,
          kind: { type: "effect" as const, effect: id },
          label: "",
          color: "",
          midi: null,
        };
        d.show_page.items.splice(
          at < 0 ? d.show_page.items.length : at,
          0,
          item,
        );
      }
    }).then(() => setEditing(id));
  };

  const edited = show.effects.find((e) => e.id === editing);
  return (
    <>
      <div className="lk-fx-divider">
        Effects
        <button
          className="link"
          onClick={add}
          title="New effect (on the selected group)"
        >
          + new
        </button>
      </div>
      {show.effects.map((e) => {
        const on = activeEffects.includes(e.id);
        return (
          <div
            key={e.id}
            className={`lk-cue lk-fx ${on ? "active" : ""}`}
            onClick={() => send({ type: "set_effect", effect: e.id, on: !on })}
            title={on ? "Running — click to stop" : "Click to start"}
          >
            <div
              className="lk-fx-swatch"
              style={{ background: effectSwatch(e) }}
            />
            <div className="lk-cue-name">{e.name}</div>
            <div className="lk-cue-meta">
              <span>{KINDS.find((k) => k[0] === e.kind)?.[1]}</span>
              <span>{e.group || "all lights"}</span>
            </div>
            <button
              className="icon lk-cue-del"
              title="Edit effect"
              onClick={(ev) => {
                ev.stopPropagation();
                setEditing(e.id);
              }}
            >
              ✎
            </button>
          </div>
        );
      })}
      {edited && (
        <EffectEditor e={edited} show={show} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function EffectEditor({
  e,
  show,
  onClose,
}: {
  e: Effect;
  show: Show;
  onClose: () => void;
}) {
  const set = (patch: Partial<Effect>) =>
    updateShow((d) => {
      const x = d.effects.find((y) => y.id === e.id);
      if (x) Object.assign(x, patch);
    });
  const usesColour = e.kind !== "rainbow";
  return (
    <div className="modal-back" onClick={onClose}>
      <div
        className="modal lk-fx-editor"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h3>Effect</h3>
        <div
          className="lk-fx-preview"
          style={{ background: effectSwatch(e) }}
        />
        <label>Name</label>
        <input
          value={e.name}
          onChange={(ev) => void set({ name: ev.target.value })}
        />
        <label>Type</label>
        <select
          value={e.kind}
          onChange={(ev) => void set({ kind: ev.target.value as EffectKind })}
        >
          {KINDS.map(([k, l, d]) => (
            <option key={k} value={k} title={d}>
              {l}
            </option>
          ))}
        </select>
        <small className="muted">
          {KINDS.find((k) => k[0] === e.kind)?.[2]}
        </small>
        <label>Lights</label>
        <select
          value={e.group}
          onChange={(ev) => void set({ group: ev.target.value })}
        >
          <option value="">All lights</option>
          {show.groups.map((g) => (
            <option key={g.name} value={g.name}>
              {g.name} ({g.fixtures.length})
            </option>
          ))}
        </select>
        {usesColour && (
          <div className="row">
            <label className="inline">
              Colour{" "}
              <input
                type="color"
                value={toHex(e.color)}
                onChange={(ev) => void set({ color: fromHex(ev.target.value) })}
              />
            </label>
            {e.kind === "two_colour" && (
              <label className="inline">
                and{" "}
                <input
                  type="color"
                  value={toHex(e.color2)}
                  onChange={(ev) =>
                    void set({ color2: fromHex(ev.target.value) })
                  }
                />
              </label>
            )}
          </div>
        )}
        <label>
          Speed{" "}
          <b>
            {e.speed >= 1
              ? `${e.speed.toFixed(1)} per second`
              : `${Math.round(e.speed * 60)} per minute`}
          </b>
        </label>
        {/* Log scale: 1 per minute … 20 per second. */}
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={Math.log(e.speed / (1 / 60)) / Math.log(20 * 60)}
          onChange={(ev) =>
            void set({
              speed:
                Math.round(
                  (1 / 60) * Math.pow(20 * 60, Number(ev.target.value)) * 1000,
                ) / 1000,
            })
          }
        />
        <label>
          Spread <b>{Math.round(e.spread * 100)}%</b>{" "}
          <small className="muted">
            0 = all together, 100% = a full wave across the lights
          </small>
        </label>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={e.spread}
          onChange={(ev) => void set({ spread: Number(ev.target.value) })}
        />
        <label>
          Brightness <b>{Math.round(e.level * 100)}%</b>
        </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={e.level}
          onChange={(ev) => void set({ level: Number(ev.target.value) })}
        />
        <div className="row end">
          <button
            className="danger-btn"
            onClick={() =>
              void confirmDialog(`Delete effect “${e.name}”?`).then((yes) => {
                if (!yes) return;
                onClose();
                void send({ type: "set_effect", effect: e.id, on: false });
                void updateShow((d) => {
                  d.effects = d.effects.filter((x) => x.id !== e.id);
                  d.show_page.items = d.show_page.items.filter(
                    (i) =>
                      !(i.kind.type === "effect" && i.kind.effect === e.id),
                  );
                });
              })
            }
          >
            Delete
          </button>
          <span className="grow" />
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
