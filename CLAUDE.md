# CLAUDE.md — Production Suite

Church/event production app: Presenter (ProPresenter-style), Lighting (Lightkey-style, with an AI scene
builder), Audio (device discovery + mixer control) and a 3D Visualizer — four modules, one engine.
Targets **macOS and Windows** via Tauri 2. The owner does not write code; Claude does all of it,
so keep changes complete, tested and explained in plain language.

## Commands

```bash
cargo test -p suite-core                 # engine tests — run after any Rust change in crates/
cargo test -p production-suite           # regenerates src/shared/contract.generated.ts (Rust JSON samples)
cd apps/desktop && npm install
npm run tauri dev                        # run the app
npx tauri build --bundles deb            # release build check on Linux (Mac/Win installers come from CI)
npm run typecheck                        # TS check — also proves types.ts matches the Rust JSON
cargo clippy --workspace --all-targets   # lint (currently zero warnings — keep it that way)
```

Test the Audio module without a desk: `python3 tools/fake_x32.py` (pretend X32 on 127.0.0.1:10023 that
answers queries, stores sets and prints every SET), then connect the app to 127.0.0.1 as an X32.

Linux (CI / cloud sessions) needs: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev
librsvg2-dev libudev-dev libasound2-dev libssl-dev libxdo-dev`. Headless smoke test: `Xvfb :99 &` then
`DISPLAY=:99 npm run tauri dev`, drive with `xdotool`, screenshot with `import -window root`.

## Releases

`.github/workflows/build-installers.yml` builds a universal macOS `.dmg` and Windows `.exe`/`.msi` on
GitHub's runners and publishes them as a Release named after the version in `tauri.conf.json`.
Runs on every push to `main` (not docs-only), or Actions → "Build installers" → Run workflow.
Pushing tags is blocked from cloud sessions, so don't rely on `v*` tags; same version = installers replaced. Bump the version in
`tauri.conf.json` (and `Cargo.toml` workspace version) for each new release. Installers are unsigned
(macOS ad-hoc `signingIdentity: "-"`); INSTALL.md tells users how to get past Gatekeeper/SmartScreen.
Signing needs the owner's Apple Developer account / Windows certificate as repo secrets.

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
   When you add or change a type that crosses the bridge, add a sample to
   `src-tauri/src/contract_tests.rs`, run `cargo test -p production-suite`, then `npm run typecheck`.
   Never hand-edit `contract.generated.ts`.
5. **The AI never writes DMX.** LLM output is `ParseOutput { intents, unknown }`, validated by
   `ai::resolve` against the patch. Keep the offline parser (`ai/parser.rs`) working for every phrase
   type the LLM prompt advertises — services must work with no internet.
6. **Real-time threads** (`dmx` 40 Hz, `mixer` 20 Hz, `viz-in`) must never block on the UI. Hold the
   engine mutex briefly; never across I/O or `.await`.
7. Window-creating Tauri commands must be `async` (sync ones can deadlock on Windows). Sync commands run
   on the UI thread, so anything that can wait on the network or hardware (mixer connect, audio device
   scan) is `async` + `tauri::async_runtime::spawn_blocking`.
8. **Editing the show from the UI** goes through `updateShow` in `shared/store.ts`, which sends the whole
   show (`replace_show`). While the user types, the local copy wins: `show_changed` echoes inside
   `QUIET_MS` are ignored and the store re-syncs after a pause (re-reading mid-typing used to drop
   letters). Don't bypass this with direct `replace_show` sends. Fixture-id map keys arrive from JS as
   strings; `Look.fixtures` uses `u32_keys` to accept them (Tauri reads args from a borrowed Value).
   Never use `window.confirm/alert` (unreliable in desktop webviews): use `confirmDialog` from bridge.
9. CSS must work in WKWebView on older macOS (Safari < 17.4): no vertical `writing-mode` range inputs
   (use the rotated `.vfader-wrap` pattern), check caniuse for newer features.

## Hardware / protocol facts used

* Art-Net ArtDmx UDP 6454; sACN E1.31 UDP 5568, multicast 239.255.hi.lo.
* Enttec DMX USB Pro: `7E 06 lenLSB lenMSB 00 <512> E7`. Open DMX: FTDI, 250 kbaud 8N2, host does BREAK/MAB.
* X32/M32 OSC UDP 10023, X Air UDP 10024, `/xremote` renew < 10 s; `/ch/NN/mix/on` 1 = unmuted.
* A&H SQ and Avantis: MIDI over TCP 51325 (Avantis protocol requires firmware 2.0+). NRPN tables in
  `mixer/allen_heath.rs` are marked VERIFY. Their public MIDI protocols have **no EQ / gate / compressor**;
  `MixerCommand::basic()` reduces channel commands to fader/mute for them and the UI explains the limit.
* X32 / X Air channel processing (`mixer/processing.rs`): `/ch/NN/` + `preamp/hpon|hpf`, `eq/on`,
  `eq/B/type|f|g|q` (B=1..4), `gate/on|thr|range|attack|hold|release`, `dyn/on|thr|ratio|knee|mgain|attack|hold|release`,
  `mix/fader|on|pan`, `config/name`. Values are normalised 0..1 (lin or log over the documented range;
  EQ Q runs backwards 10→0.3) or int enums (EQ type 0..5, ratio index 0..11). Sending an address with no
  args queries it; replies come back through `MixerProfile::decode` as `MixerFeedback.update`.

## Must verify on real gear (tell the owner before relying on it)

- [ ] ADJ COB Cannon Wash 4ch and Chauvet Intimidator Spot LED 250 13ch profiles (`demo.rs`, `needs_verification: true`)
- [ ] SQ NRPN numbers + level law; Avantis mute/fader/scene messages; Avantis main fader (not implemented)
- [ ] Real patch addresses from the owner's Lightkey export (all universe 1)
- [ ] Open DMX timing on macOS (FTDI VCP driver) and Windows
- [ ] X32 / X Air processing scalings on a real desk (tested against `tools/fake_x32.py` and the
      community OSC protocol document only); X Air HPF/EQ address map assumed identical to X32
- [ ] Gate acts as a gate only when the desk's gate mode is GATE (mode isn't set by the app)

## Roadmap (suggested order)

1. **First real build on Mac + Windows** — *Compiles on Linux, macOS (universal) and Windows; CI installers
   published as Release v0.1.0. Waiting on the owner's hands-on check (FIRST-RUN.md §3) on real hardware.*
   Done: whole workspace compiles with zero warnings, `Cargo.lock` + `package-lock.json` committed,
   Rust↔TS contract test added, app launched and clicked through on Linux (all four modules, slide →
   cue → Visualizer, offline scene builder, mixer connect failure). Fixed: faders rendered flat,
   mixer connect / audio scan froze the window. Remaining: owner reports results from macOS and
   Windows (macOS-only / Windows-only code paths are not compiled on Linux: CoreAudio/WASAPI in cpal,
   serial port enumeration, window placement on second displays).
   *v0.2.0:* ProPresenter-style Presenter (library + service playlist, slide editor, group colours,
   live/next), Lightkey-style Lighting (stage plan with live colours, inspector, cue tiles), Audio
   console with X32/X Air HPF, 4-band EQ, gate and compressor incl. desk read-back.
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
