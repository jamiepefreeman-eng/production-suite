// TypeScript mirrors of the Rust types in crates/suite-core (serde JSON shape).
// Keep in sync when changing the Rust side.

export type Rgb = { r: number; g: number; b: number };

export type Attr =
  | "dimmer" | "red" | "green" | "blue" | "white" | "amber" | "uv"
  | "pan" | "pan_fine" | "tilt" | "tilt_fine" | "color_wheel" | "gobo" | "gobo_rotation"
  | "prism" | "focus" | "shutter" | "strobe" | "speed" | "control" | "unused"
  | "dimmer_fine" | "cyan" | "magenta" | "yellow" | "lime" | "zoom" | "iris" | "frost" | "color_temp" | "effect" | "other";

export type FixtureKind = "wash" | "par" | "puck" | "strip" | "moving_spot" | "moving_wash" | "generic";

export interface FixtureProfile {
  id: string;
  manufacturer: string;
  model: string;
  mode: string;
  kind: FixtureKind;
  channels: { attr: Attr; default: number; name?: string }[];
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
  | { type: "recall_scene"; scene: number }
  | { type: "channel"; channel: number; param: ChannelParam }
  | { type: "query_channel"; channel: number };

export type EqType = "low_cut" | "low_shelf" | "peq" | "veq" | "high_shelf" | "high_cut";
/** One channel setting in real units (see crates/suite-core/src/mixer/processing.rs for ranges). */
export type ChannelParam =
  | { param: "fader"; level: number }
  | { param: "mute"; muted: boolean }
  | { param: "pan"; pan: number }
  | { param: "name"; name: string }
  | { param: "hpf_on"; on: boolean }
  | { param: "hpf_freq"; hz: number }
  | { param: "eq_on"; on: boolean }
  | { param: "eq_type"; band: number; kind: EqType }
  | { param: "eq_freq"; band: number; hz: number }
  | { param: "eq_gain"; band: number; db: number }
  | { param: "eq_q"; band: number; q: number }
  | { param: "gate_on"; on: boolean }
  | { param: "gate_threshold"; db: number }
  | { param: "gate_range"; db: number }
  | { param: "gate_attack"; ms: number }
  | { param: "gate_hold"; ms: number }
  | { param: "gate_release"; ms: number }
  | { param: "comp_on"; on: boolean }
  | { param: "comp_threshold"; db: number }
  | { param: "comp_ratio"; ratio: number }
  | { param: "comp_knee"; db: number }
  | { param: "comp_makeup"; db: number }
  | { param: "comp_attack"; ms: number }
  | { param: "comp_hold"; ms: number }
  | { param: "comp_release"; ms: number };
export interface ChannelUpdate { channel: number; param: ChannelParam }

export type SlideTrigger =
  | { type: "lighting_cue"; cue: number }
  | { type: "lighting_text"; text: string }
  | { type: "blackout" }
  | { type: "mixer"; command: MixerCommand }
  | { type: "media"; media: number | null }
  | { type: "audio"; audio: number | null; looped: boolean }
  | { type: "prop"; prop: number; on: boolean }
  | { type: "macro"; id: number }
  | { type: "clear"; layer: ClearLayer };

export type ClearLayer = "all" | "slide" | "media" | "audio" | "props" | "timer" | "lights";
export interface SlideGroup { name: string; color: string }
export interface Arrangement { name: string; sequence: string[] }
export interface Prop {
  id: number;
  name: string;
  media: number | null;
  text: string;
  /** Position / size as fractions of the screen. */
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  background: string;
}
export interface Macro { id: number; name: string; color: string; actions: SlideTrigger[] }
export interface MediaPlaylist { name: string; items: number[] }

export type TextAlign = "left" | "center" | "right";
/** This slide's own text formatting; null = follow the theme. */
export interface TextStyle {
  font: string | null;
  size: number | null;
  color: string | null;
  bold: boolean | null;
  italic: boolean | null;
  uppercase: boolean | null;
  shadow: boolean | null;
  position: TextPosition | null;
  align: TextAlign | null;
}
export type ElementKind = "text" | "media" | "shape";
/** Text box / picture / video / live feed / shape on one slide; x,y,w,h are 0..1 of the frame. */
export interface SlideElement {
  id: number;
  kind: ElementKind;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  media: number | null;
  font: string;
  /** % of frame height */
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: TextAlign;
  background: string;
  radius: number;
  opacity: number;
}
export interface Slide { id: number; label: string; text: string; triggers: SlideTrigger[]; style: TextStyle; elements: SlideElement[] }
export type PresentationKind = "song" | "scripture" | "announcement" | "media" | "header";
export interface Presentation {
  id: number;
  title: string;
  kind: PresentationKind;
  ccli: string | null;
  slides: Slide[];
  theme: string;
  groups: SlideGroup[];
  arrangements: Arrangement[];
  arrangement: string | null;
  /** Library it is filed in; "" = by kind (Songs / Scripture / Default). */
  library: string;
  /** Writers ("Chris Tomlin | John Newton"). */
  authors: string;
  /** "© 2006 sixsteps Music …" */
  copyright: string;
}

export type MediaKind = "image" | "video" | "audio" | "input";
export interface MediaAnalysis {
  colors: string[];
  color_names: string[];
  brightness: number;
  saturation: number;
  motion: number;
  duration: number;
  tags: string[];
}
export interface MediaItem { id: number; name: string; path: string; kind: MediaKind; analysis?: MediaAnalysis | null }
export type TextPosition = "top" | "center" | "bottom" | "lower_third";
export interface Theme {
  name: string;
  font: string;
  size: number;
  color: string;
  bold: boolean;
  uppercase: boolean;
  shadow: boolean;
  position: TextPosition;
  background_color: string;
  background_media: number | null;
  dim: number;
}
export type SceneryKind =
  | "wall" | "drape" | "riser" | "stage_deck" | "truss" | "screen"
  | "person" | "drum_kit" | "keyboard" | "guitarist" | "mic_stand" | "speaker" | "wedge" | "model";
export interface VisualizerSettings { haze: number; ambient: number }
export interface Scenery {
  id: number;
  name: string;
  kind: SceneryKind;
  /** Centre of the bottom face, metres. */
  position: [number, number, number];
  /** Width, height, thickness (m). */
  size: [number, number, number];
  rotation: [number, number, number];
  color: string;
  model_path: string;
  model_unit: string;
  model_z_up: boolean;
}
export interface Countdown { label: string; ends_at_unix_ms: number; show_on_audience: boolean }
export interface Layers { media: number | null; audio: number | null; audio_loop: boolean; countdown: Countdown | null; props: number[] }

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
  themes: Theme[];
  media: MediaItem[];
  media_playlists: MediaPlaylist[];
  props: Prop[];
  macros: Macro[];
  scenery: Scenery[];
  visualizer: VisualizerSettings;
  mixer: MixerConfig | null;
  effects: Effect[];
  show_page: ShowPage;
  lyric_follow: FollowSettings;
  /** Libraries the operator made; "Default", "Songs", "Scripture" always exist. */
  libraries: string[];
  ccli: CcliSettings;
  midi_triggers: MidiTrigger[];
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
  | { type: "set_media"; media: number | null }
  | { type: "play_audio"; audio: number | null; looped: boolean }
  | { type: "start_countdown"; label: string; seconds: number; show_on_audience: boolean }
  | { type: "clear_countdown" }
  | { type: "clear_all" }
  | { type: "set_prop"; prop: number; on: boolean }
  | { type: "clear_props" }
  | { type: "run_macro"; id: number }
  | { type: "go_cue"; cue: number }
  | { type: "release_cue" }
  | { type: "blackout"; on: boolean }
  | { type: "grand_master"; level: number }
  | { type: "clear_programmer" }
  | { type: "apply_text"; text: string }
  | { type: "apply_intents"; intents: Intent[]; unknown: string[]; source: string | null }
  | { type: "set_fixture_state"; fixtures: number[]; state: Partial<FixtureState> }
  | { type: "merge_programmer"; look: Look }
  | { type: "set_effect"; effect: number; on: boolean }
  | { type: "group_master"; group: string; level: number }
  | { type: "trigger_show_item"; item: number; value: number }
  | { type: "midi_input"; message: MidiMessage }
  | { type: "record_cue"; name: string; fade_ms: number }
  | { type: "delete_cue"; cue: number }
  | { type: "record_position"; name: string }
  | { type: "move_fixture"; fixture: number; position: [number, number, number]; rotation: [number, number, number] }
  | { type: "mixer"; command: MixerCommand }
  | { type: "load_show"; show: Show }
  | { type: "replace_show"; show: Show };

export type EngineEvent =
  | { type: "show_changed" }
  | { type: "layers_changed"; layers: Layers }
  | { type: "slide_live"; presentation: number; slide: number; title: string; label: string; text: string }
  | { type: "slide_cleared" }
  | { type: "cue_fired"; cue: number; name: string }
  | { type: "cue_released" }
  | { type: "programmer_changed"; look: Look }
  | { type: "scene_built"; applied: string[]; issues: string[]; unknown: string[] }
  | { type: "blackout_changed"; on: boolean }
  | { type: "effects_changed"; active: number[] }
  | { type: "masters_changed"; grand_master: number; groups: GroupLevel[] }
  | { type: "midi_received"; message: MidiMessage }
  | { type: "toggle_match_background" }
  | { type: "mixer_out"; command: MixerCommand }
  | { type: "log"; level: "info" | "warn"; message: string };

export interface EngineStatus {
  active_cue: number | null;
  live_slide: [number, number] | null;
  programmer: Look;
  layers: Layers;
  show_path: string | null;
  active_effects: number[];
  grand_master: number;
  group_levels: GroupLevel[];
  blackout: boolean;
}
export interface GroupLevel { group: string; level: number }

export type EffectKind = "rainbow" | "chase" | "pulse" | "strobe" | "two_colour";
export interface Effect {
  id: number;
  name: string;
  kind: EffectKind;
  /** group name; "" = every light */
  group: string;
  color: Rgb;
  color2: Rgb;
  /** cycles per second */
  speed: number;
  spread: number;
  level: number;
}
export type ShowItemKind =
  | { type: "cue"; cue: number }
  | { type: "effect"; effect: number }
  | { type: "grand_master" }
  | { type: "group_master"; group: string }
  | { type: "blackout" }
  | { type: "release" }
  | { type: "match_background" };
export type MidiControlKind = "note" | "cc" | "program";
export interface MidiControl { kind: MidiControlKind; channel: number; number: number }
export interface ShowItem { id: number; kind: ShowItemKind; label: string; color: string; midi: MidiControl | null }
export interface ShowPage { items: ShowItem[] }
export type MidiMessage =
  | { type: "note_on"; channel: number; note: number; velocity: number }
  | { type: "note_off"; channel: number; note: number }
  | { type: "control_change"; channel: number; controller: number; value: number }
  | { type: "program_change"; channel: number; program: number };
export interface MidiStatus { available: string[]; connected: string[]; errors: string[] }

export interface FixtureVisual { id: number; intensity: number; color: Rgb; pan: number; tilt: number; gobo: number }
export interface VizFrame { source: "internal" | "external"; fixtures: FixtureVisual[] }
export type VizSource = { type: "internal" } | { type: "art_net" } | { type: "sacn"; universes: number };

export interface MixerStatus {
  connected: boolean;
  config: MixerConfig | null;
  input_channels: number;
  supports_processing: boolean;
  kinds: [MixerKind, string][];
}
export interface MixerFeedback { address: string; value: number | null; update: ChannelUpdate | null }

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
export interface MediaSummary { id: number; name: string; kind: string; description: string }
export interface MediaRanking { picks: { id: number; reason: string }[]; target: string | null }
export interface SceneResult { engine: "offline" | "llm"; parsed: ParseOutput }
export interface AiStatus { has_api_key: boolean; model: string }

// ── Lyric Follow (Presenter: listen to the singer, advance slides)
export type FollowMode = "off" | "assist" | "auto";
export interface FollowSettings {
  mode: FollowMode;
  words_early: number;
  min_confidence: number;
  min_slide_ms: number;
  manual_hold_ms: number;
  bias_prompt: boolean;
}
export interface FollowInput { device: string; channel: number; model: string; gate_db: number }
export interface FollowStatus {
  running: boolean;
  mode: FollowMode | null;
  input: FollowInput | null;
  error: string | null;
  level_db: number;
  voice: boolean;
  heard: string;
  confidence: number;
  live: [number, number] | null;
  next: [number, number] | null;
  sung_word: number | null;
  trigger_word: number | null;
  in_previous: boolean;
  ready: boolean;
  blocked: string | null;
  reason: string | null;
  latency_ms: number;
}
export interface SpeechModel { name: string; size_mb: number; note: string; path: string; downloaded: boolean }
export interface ModelProgress { name: string; downloaded: number; total: number | null }

/** A show opened or saved on this computer (Presenter › Services). */
export interface RecentShow { path: string; name: string; used_at: number; exists: boolean; current: boolean }

// ── CCLI / SongSelect / Planning Center / MIDI triggers
export type CcliFooter = "first" | "last" | "all" | "off";
export interface CcliSettings { license: string; footer: CcliFooter }
export type MidiAction =
  | { type: "next_slide" }
  | { type: "previous_slide" }
  | { type: "go_group"; group: string }
  | { type: "go_slide_index"; index: number }
  | { type: "go_service_item"; index: number }
  | { type: "go_slide"; presentation: number; slide: number }
  | { type: "trigger"; trigger: SlideTrigger };
export interface MidiTrigger { id: number; name: string; control: MidiControl | null; number_is_index: boolean; action: MidiAction }
export interface ImportedSong { path: string; presentation: Presentation | null; error: string | null }
export interface UsageEntry { at: number; title: string; ccli: string | null; authors: string; copyright: string; show: string }
export interface PcoStatus { signed_in: boolean; app_id: string }
export interface PcoServiceType { id: string; name: string }
export interface PcoPlan { id: string; title: string; dates: string; series: string }
export type PcoItemKind = "song" | "header" | "item" | "media";
export interface PcoItem {
  kind: PcoItemKind;
  title: string;
  key: string;
  ccli: string | null;
  authors: string;
  copyright: string;
  arrangement: string;
  lyrics: string;
  sequence: string[];
}
export interface PcoPlanImport { title: string; dates: string; items: PcoItem[] }
