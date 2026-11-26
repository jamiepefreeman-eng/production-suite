// MIDI names shared by Lighting (show page, MIDI setup) and Presenter (MIDI triggers).
import type { MidiControl, MidiMessage } from "./types";

export function midiControlOf(m: MidiMessage): MidiControl {
  switch (m.type) {
    case "control_change":
      return { kind: "cc", channel: m.channel, number: m.controller };
    case "program_change":
      return { kind: "program", channel: m.channel, number: m.program };
    default:
      return { kind: "note", channel: m.channel, number: m.note };
  }
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function midiLabel(c: MidiControl) {
  const ch = c.channel === 1 ? "" : ` ch${c.channel}`;
  if (c.kind === "cc") return `CC ${c.number}${ch}`;
  if (c.kind === "program") return `Program ${c.number + 1}${ch}`;
  return `${NOTE_NAMES[c.number % 12]}${Math.floor(c.number / 12) - 1} (${c.number})${ch}`;
}

/** "pressed (100)" / "moved to 64" / "program 3" — for MIDI monitors. */
export function midiWhat(m: MidiMessage) {
  switch (m.type) {
    case "control_change":
      return `moved to ${m.value}`;
    case "note_on":
      return `pressed (${m.velocity})`;
    case "note_off":
      return "released";
    case "program_change":
      return "sent";
  }
}
