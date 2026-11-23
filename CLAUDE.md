# CLAUDE.md — Production Suite

Church/event production app: Presenter (ProPresenter-style), Lighting (Lightkey-style, with an AI scene
builder), Audio (device discovery + mixer control) and a 3D Visualizer — four modules, one engine.
Targets **macOS and Windows** via Tauri 2. The owner does not write code; Claude does all of it,
so keep changes complete, tested and explained in plain language.

## Commands

```bash
cargo test -p suite-core                 # engine tests — run after any Rust change in crates/
cd apps/desktop && npm install
npm run tauri dev                        # run the app
npm run typecheck                        # TS check
cargo clippy --workspace                 # lint
```

## Architecture rules

1. **One engine, one entry point.** Every state change is a `suite_core::engine::Command` sent through
   `AppState::dispatch` (Rust) / `api.send` (TS). Engine returns `Event`s published on the bus;
   the `events` thread forwards them to all windows as `engine-event`.
2. **Modules are islands.** `apps/desktop/src/modules/<name>/` never imports from another module.
   Shared code lives in `src/shared/`. Only `shared/bridge.ts` imports `@tauri-apps/*`.
3. **suite-core stays dependency-free** (std only, serde behind the `serde` feature with
   `#[cfg_attr(feature = "serde", ...)]`). Protocol code goes here with unit tests; anything needing
   OS/hardware crates (serialport, cpal, reqwest, windows) goes in `src-tauri`.
4. **Types are mirrored by hand** in `src/shared/types.ts`. Serde uses `tag = "type"` +
   `rename_all = "snake_case"` (e.g. `XAir` → `"x_air"`, `ArtNet` → `"art_net"`). Update both sides together.
   Tauri converts Rust snake_case command args to camelCase in JS (`force_llm` → `forceLlm`).
5. **The AI never writes DMX.** LLM output is `ParseOutput { intents, unknown }`, validated by
   `ai::resolve` against the patch. Keep the offline parser (`ai/parser.rs`) working for every phrase
   type the LLM prompt advertises — services must work with no internet.
6. **Real-time threads** (`dmx` 40 Hz, `mixer` 20 Hz, `viz-in`) must never block on the UI. Hold the
   engine mutex briefly; never across I/O or `.await`.
7. Window-creating Tauri commands must be `async` (sync ones can deadlock on Windows).

## Hardware / protocol facts used

* Art-Net ArtDmx UDP 6454; sACN E1.31 UDP 5568, multicast 239.255.hi.lo.
* Enttec DMX USB Pro: `7E 06 lenLSB lenMSB 00 <512> E7`. Open DMX: FTDI, 250 kbaud 8N2, host does BREAK/MAB.
* X32/M32 OSC UDP 10023, X Air UDP 10024, `/xremote` renew < 10 s; `/ch/NN/mix/on` 1 = unmuted.
* A&H SQ and Avantis: MIDI over TCP 51325 (Avantis protocol requires firmware 2.0+). NRPN tables in
  `mixer/allen_heath.rs` are marked VERIFY.

## Must verify on real gear (tell the owner before relying on it)

- [ ] ADJ COB Cannon Wash 4ch and Chauvet Intimidator Spot LED 250 13ch profiles (`demo.rs`, `needs_verification: true`)
- [ ] SQ NRPN numbers + level law; Avantis mute/fader/scene messages; Avantis main fader (not implemented)
- [ ] Real patch addresses from the owner's Lightkey export (all universe 1)
- [ ] Open DMX timing on macOS (FTDI VCP driver) and Windows

## Roadmap (suggested order)

1. **First real build on Mac + Windows**: `npm install`, `tauri dev`, fix any compile errors in
   `src-tauri` (it was written without network access, so it hasn't been compiled yet; `suite-core` has).
   Generate a `Cargo.lock` and `package-lock.json`.
2. **Fixture library**: import Lightkey/QLC+/Open Fixture Library (OFL JSON) profiles; profile editor UI;
   patch "add fixture" dialog; import the Lightkey patch TSV.
3. **Lighting engine**: HTP/LTP, 16-bit-aware pan/tilt fades, effects (chase, rainbow, pan/tilt circles),
   cue list with follow/wait times, multiple playbacks, tap tempo, MIDI controller input.
4. **Presenter**: themes/backgrounds (images + video loops), media playback, scripture library
   (public-domain KJV/WEB bundled; others need licences), arrangements (V1 C V2 C B C), stage display
   layouts, NDI output, CCLI usage report export. SongSelect import needs a CCLI agreement.
5. **Audio**: playback engine (cpal) for walk-in music / tracks / click to chosen outputs; desk feedback
   → UI fader state; meters (X32 `/meters`); A&H MIDI feedback parsing; scene name lists.
6. **Visualizer**: floor pools/gobo projection, haze, truss models, import a stage model (glTF),
   fixture drag that snaps to truss.
7. **Remote**: phone/tablet remote over WebSocket speaking the same `Command`/`Event` JSON.
8. **Safety**: autosave + crash recovery of the show file, API key in OS keychain, undo.
