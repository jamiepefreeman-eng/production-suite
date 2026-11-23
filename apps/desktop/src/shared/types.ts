// TypeScript mirrors of the Rust types in crates/suite-core (serde JSON shape).
// Keep in sync when changing the Rust side.

export type Rgb = { r: number; g: number; b: number };

export type Attr =
  | "dimmer" | "red" | "green" | "blue" | "white" | "amber" | "uv"
  | "pan" | "pan_fine" | "tilt" | "tilt_fine" | "color_wheel" | "gobo" | "gobo_rotation"
  | "prism" | "focus" | "shutter" | "strobe" | "speed" | "control" | "unused";

export type FixtureKind = "wash" | "par" | "strip" | "moving_spot" | "moving_wash" | "generic";

export interface FixtureProfile {
  id: string;
  manufacturer: string;
  model: string;
  mode: string;
  kind: FixtureKind;
  channels: { attr: Attr; default: number }[];
  gobo_slots: number[];
  color_wheel: { name: string; dmx: number; rgb: Rgb }[];
  pan_range: number;
  tilt_range: number;
  beam_angle: number;
  needs_verification: boolean;
}

export interface Fixture {
  id: number;
  name: string;
  profile_id: string;
  universe: number;
  address: number;
  position: [number, number, number];
  rotation: [number, number, number];
}

export interface Group { name: string; aliases: string[]; fixtures: number[] }
export interface PositionPreset { name: string; aliases: string[]; values: { fixture: number; pan: number; tilt: number }[] }

export interface FixtureState {
  intensity: number | null;
  color: Rgb | null;
  gobo: number | null;
  pan: number | null;
  tilt: number | null;
}
export interface Look { fixtures: Record<string, FixtureState> }
export interface Cue { id: number; name: string; look: Look; fade_ms: number; source_text: string | null }

export type DmxOutputConfig =
  | { type: "art_net"; ip: string; universe: number; artnet_universe: number }
  | { type: "sacn"; universe: number; sacn_universe: number; priority: number; unicast_ip: string | null }
  | { type: "enttec_pro"; port: string; universe: number }
  | { type: "open_dmx"; port: string; universe: number };

export type MixerKind = "x32" | "x_air" | "sq" | "avantis";
export interface MixerConfig { kind: MixerKind; ip: string; midi_channel: number }
export type MixerCommand =
  | { type: "fader"; channel: number; level: number }
  | { type: "mute"; channel: number; muted: boolean }
  | { type: "main_fader"; level: number }
  | { type: "recall_scene"; scene: number };

export type SlideTrigger =
  | { type: "lighting_cue"; cue: number }
  | { type: "lighting_text"; text: string }
  | { type: "blackout" }
  | { type: "mixer"; command: MixerCommand };

export interface Slide { id: number; label: string; text: string; triggers: SlideTrigger[] }
export type PresentationKind = "song" | "scripture" | "announcement" | "media";
export interface Presentation {
  id: number;
  title: string;
  kind: PresentationKind;
  ccli: string | null;
  slides: Slide[];
  theme: string;
}

export interface Show {
  name: string;
  stage: { width: number; depth: number; trim_height: number };
  profiles: FixtureProfile[];
  fixtures: Fixture[];
  groups: Group[];
  positions: PositionPreset[];
  cues: Cue[];
  dmx_outputs: DmxOutputConfig[];
  presentations: Presentation[];
  playlist: number[];
  mixer: MixerConfig | null;
}

export type Action =
  | { type: "intensity"; value: number }
  | { type: "color"; value: string }
  | { type: "gobo"; value: number }
  | { type: "position"; value: string }
  | { type: "off" };
export interface Intent { target: string; actions: Action[] }
export interface ParseOutput { intents: Intent[]; unknown: string[] }

export type Command =
  | { type: "go_slide"; presentation: number; slide: number }
  | { type: "clear_slide" }
  | { type: "go_cue"; cue: number }
  | { type: "release_cue" }
  | { type: "blackout"; on: boolean }
  | { type: "grand_master"; level: number }
  | { type: "clear_programmer" }
  | { type: "apply_text"; text: string }
  | { type: "apply_intents"; intents: Intent[]; unknown: string[]; source: string | null }
  | { type: "set_fixture_state"; fixtures: number[]; state: Partial<FixtureState> }
  | { type: "record_cue"; name: string; fade_ms: number }
  | { type: "delete_cue"; cue: number }
  | { type: "record_position"; name: string }
  | { type: "move_fixture"; fixture: number; position: [number, number, number]; rotation: [number, number, number] }
  | { type: "mixer"; command: MixerCommand }
  | { type: "load_show"; show: Show }
  | { type: "replace_show"; show: Show };

export type EngineEvent =
  | { type: "show_changed" }
  | { type: "slide_live"; presentation: number; slide: number; title: string; label: string; text: string }
  | { type: "slide_cleared" }
  | { type: "cue_fired"; cue: number; name: string }
  | { type: "cue_released" }
  | { type: "programmer_changed"; look: Look }
  | { type: "scene_built"; applied: string[]; issues: string[]; unknown: string[] }
  | { type: "blackout_changed"; on: boolean }
  | { type: "mixer_out"; command: MixerCommand }
  | { type: "log"; level: "info" | "warn"; message: string };

export interface EngineStatus {
  active_cue: number | null;
  live_slide: [number, number] | null;
  programmer: Look;
  show_path: string | null;
}

export interface FixtureVisual { id: number; intensity: number; color: Rgb; pan: number; tilt: number; gobo: number }
export interface VizFrame { source: "internal" | "external"; fixtures: FixtureVisual[] }
export type VizSource = { type: "internal" } | { type: "art_net" } | { type: "sacn"; universes: number };

export interface MixerStatus {
  connected: boolean;
  config: MixerConfig | null;
  input_channels: number;
  kinds: [MixerKind, string][];
}
export interface MixerFeedback { address: string; value: number | null }

export interface AudioDevice {
  host: string;
  name: string;
  input_channels: number;
  output_channels: number;
  sample_rate: number | null;
  is_default_input: boolean;
  is_default_output: boolean;
  matches_mixer: string | null;
}

export interface SerialPortInfo {
  name: string;
  vid: number | null;
  pid: number | null;
  product: string | null;
  serial: string | null;
  likely_dmx: boolean;
}

export interface MonitorInfo { index: number; name: string | null; width: number; height: number; x: number; y: number; scale: number }
export interface SceneResult { engine: "offline" | "llm"; parsed: ParseOutput }
export interface AiStatus { has_api_key: boolean; model: string }
