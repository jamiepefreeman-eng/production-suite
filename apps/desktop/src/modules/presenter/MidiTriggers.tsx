// Presenter › MIDI: let a playback app (MultiTracks Playback, Loop Community Prime) or a controller drive
// the slides. Each trigger = a MIDI note / CC / program change → an action. The engine runs them
// (suite_core engine::midi_action), so they work whichever window or tab is open.

import { useEffect, useRef, useState } from "react";
import { midiControlOf, midiLabel } from "../../shared/midi";
import { pushLog, updateShow, useEngine } from "../../shared/store";
import type { MidiAction, MidiTrigger, Show, SlideTrigger } from "../../shared/types";
import { groupNames } from "./groups";

type Kind = MidiAction["type"] | "cue" | "macro" | "scene" | "clear" | "blackout";

const KINDS: [Kind, string][] = [
  ["next_slide", "Next slide"],
  ["previous_slide", "Previous slide"],
  ["go_group", "Go to section (Verse 1, Chorus…) of the live song"],
  ["go_slide_index", "Go to slide number … of the live song"],
  ["go_service_item", "Go to service item number …"],
  ["cue", "Lighting cue"],
  ["scene", "Mixer scene"],
  ["macro", "Run macro"],
  ["clear", "Clear all"],
  ["blackout", "Blackout"],
];

function kindOf(a: MidiAction): Kind {
  if (a.type !== "trigger") return a.type;
  const t = a.trigger;
  if (t.type === "lighting_cue") return "cue";
  if (t.type === "macro") return "macro";
  if (t.type === "mixer") return "scene";
  if (t.type === "blackout") return "blackout";
  return "clear";
}

function actionFor(kind: Kind, show: Show, prev?: MidiAction): MidiAction {
  const trig = (trigger: SlideTrigger): MidiAction => ({ type: "trigger", trigger });
  switch (kind) {
    case "next_slide":
    case "previous_slide":
      return { type: kind };
    case "go_group":
      return { type: "go_group", group: prev?.type === "go_group" ? prev.group : "Chorus" };
    case "go_slide_index":
      return { type: "go_slide_index", index: 1 };
    case "go_service_item":
      return { type: "go_service_item", index: 1 };
    case "go_slide":
      return prev?.type === "go_slide" ? prev : { type: "next_slide" };
    case "cue":
      return trig({ type: "lighting_cue", cue: show.cues[0]?.id ?? 1 });
    case "scene":
      return trig({ type: "mixer", command: { type: "recall_scene", scene: 1 } });
    case "macro":
      return trig({ type: "macro", id: show.macros[0]?.id ?? 1 });
    case "blackout":
      return trig({ type: "blackout" });
    case "clear":
    case "trigger":
      return trig({ type: "clear", layer: "all" });
  }
}

export default function MidiTriggersTab({ show }: { show: Show }) {
  const { lastMidi } = useEngine();
  const [learning, setLearning] = useState<number | null>(null);
  const triggers = show.midi_triggers;

  // MIDI learn: the next message received is assigned to the armed trigger.
  const seen = useRef(lastMidi?.n ?? 0);
  useEffect(() => {
    if (!lastMidi || lastMidi.n === seen.current) return;
    seen.current = lastMidi.n;
    if (learning == null || lastMidi.message.type === "note_off") return;
    const control = midiControlOf(lastMidi.message);
    void updateShow((d) => {
      const t = d.midi_triggers.find((x) => x.id === learning);
      if (t) t.control = control;
    });
    pushLog("info", `MIDI ${midiLabel(control)} learned`);
    setLearning(null);
  }, [lastMidi?.n]);

  const edit = (id: number, patch: Partial<MidiTrigger>) =>
    updateShow((d) => {
      const t = d.midi_triggers.find((x) => x.id === id);
      if (t) Object.assign(t, patch);
    });
  const add = (action: MidiAction, extra: Partial<MidiTrigger> = {}) => {
    const id = Math.max(0, ...triggers.map((t) => t.id)) + 1;
    void updateShow((d) => void d.midi_triggers.push({ id, name: "", control: null, number_is_index: false, action, ...extra })).then(() => setLearning(id));
  };
  const sections = [...new Set(["Intro", "Verse 1", "Verse 2", "Verse 3", "Pre-Chorus", "Chorus", "Bridge", "Tag", "Outro", ...show.presentations.filter((p) => p.kind === "song").flatMap(groupNames)])];

  return (
    <div className="pp-midi">
      <details className="pp-midi-help">
        <summary>Using MultiTracks Playback or Loop Community Prime?</summary>
        <ol>
          <li>In Playback / Prime, add MIDI events (MIDI out) on your songs: a note or program change at the start of each song and at each section.</li>
          <li>Send them to this computer: on the same Mac use the <b>IAC Driver</b> (Audio MIDI Setup › MIDI Studio); from another computer use Network MIDI or a USB MIDI interface. Check Lighting › Setup › MIDI shows it as listening.</li>
          <li>Here, add a trigger, press 🎹 <b>Learn</b>, then play that cue in Playback / Prime.</li>
        </ol>
        <small className="muted">
          Tip: one “Song by program change” trigger covers the whole service (Program 1 = first song, 2 = second…), and one “Slide by note number” trigger covers
          every slide.
        </small>
      </details>
      <div className="pp-midi-add">
        <button onClick={() => add({ type: "next_slide" })}>+ Next slide</button>
        <button onClick={() => add({ type: "go_group", group: "Chorus" })}>+ Section</button>
        <button onClick={() => add({ type: "go_service_item", index: 1 }, { number_is_index: true, name: "Song by program change" })} title="Program 1 = first song in the service, 2 = second…">
          + Song by program change
        </button>
        <button onClick={() => add({ type: "go_slide_index", index: 1 }, { number_is_index: true, name: "Slide by note number" })} title="Note 1 = slide 1 of the live song, 2 = slide 2…">
          + Slide by note number
        </button>
        <button onClick={() => add({ type: "trigger", trigger: { type: "lighting_cue", cue: show.cues[0]?.id ?? 1 } })}>+ Lighting cue</button>
      </div>
      <datalist id="midi-sections">
        {sections.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {triggers.length === 0 && <p className="muted">No MIDI triggers yet — add one above.</p>}
      {triggers.map((t) => {
        const kind = kindOf(t.action);
        const a = t.action;
        return (
          <div key={t.id} className={`pp-midi-row ${learning === t.id ? "learning" : ""}`}>
            <div className="row">
              <button className={`small ${learning === t.id ? "on" : ""}`} onClick={() => setLearning(learning === t.id ? null : t.id)} title="Then send the note / program from Playback, Prime or your controller">
                🎹 {learning === t.id ? "Waiting…" : t.control ? (t.number_is_index ? `${t.control.kind === "program" ? "Any program" : "Any note"}${t.control.channel === 1 ? "" : ` ch${t.control.channel}`}` : midiLabel(t.control)) : "Learn"}
              </button>
              <span className="muted">→</span>
              <select
                className="grow"
                value={kind}
                onChange={(e) => {
                  const k = e.target.value as Kind;
                  void edit(t.id, { action: actionFor(k, show, a), number_is_index: (k === "go_slide_index" || k === "go_service_item") && t.number_is_index });
                }}
              >
                {KINDS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
                {kind === "go_slide" && <option value="go_slide">A particular slide</option>}
              </select>
              <button className="icon" title="Delete trigger" onClick={() => void updateShow((d) => void (d.midi_triggers = d.midi_triggers.filter((x) => x.id !== t.id)))}>
                ✕
              </button>
            </div>
            <div className="row wrap pp-midi-params">
              {a.type === "go_group" && <input list="midi-sections" value={a.group} onChange={(e) => void edit(t.id, { action: { type: "go_group", group: e.target.value } })} />}
              {(a.type === "go_slide_index" || a.type === "go_service_item") && (
                <>
                  <label className="inline">
                    <input type="checkbox" checked={t.number_is_index} onChange={(e) => void edit(t.id, { number_is_index: e.target.checked })} />
                    use the {t.control?.kind === "program" ? "program" : "note"} number
                  </label>
                  {!t.number_is_index && (
                    <label className="inline">
                      number
                      <input type="number" min={1} value={a.index} onChange={(e) => void edit(t.id, { action: { ...a, index: Math.max(1, Number(e.target.value) || 1) } })} />
                    </label>
                  )}
                </>
              )}
              {a.type === "trigger" && a.trigger.type === "lighting_cue" && (
                <select value={a.trigger.cue} onChange={(e) => void edit(t.id, { action: { type: "trigger", trigger: { type: "lighting_cue", cue: Number(e.target.value) } } })}>
                  {show.cues.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.id}. {c.name}
                    </option>
                  ))}
                </select>
              )}
              {a.type === "trigger" && a.trigger.type === "macro" && (
                <select value={a.trigger.id} onChange={(e) => void edit(t.id, { action: { type: "trigger", trigger: { type: "macro", id: Number(e.target.value) } } })}>
                  {show.macros.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              )}
              {a.type === "trigger" && a.trigger.type === "mixer" && a.trigger.command.type === "recall_scene" && (
                <label className="inline">
                  scene
                  <input
                    type="number"
                    min={0}
                    value={a.trigger.command.scene}
                    onChange={(e) => void edit(t.id, { action: { type: "trigger", trigger: { type: "mixer", command: { type: "recall_scene", scene: Number(e.target.value) || 0 } } } })}
                  />
                </label>
              )}
              <input className="grow pp-midi-name" placeholder="Note (optional)" value={t.name} onChange={(e) => void edit(t.id, { name: e.target.value })} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
