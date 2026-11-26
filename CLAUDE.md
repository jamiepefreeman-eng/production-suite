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
   Number inputs that format their value must keep the typed text while focused (see `NumField` in
   VisualizerApp) — re-formatting on each keystroke swallows decimal points.
9. **Presenter rendering**: every slide (thumbnail, Live/Next preview, audience/stream output) goes through
   `modules/presenter/render.tsx` `SlideRender` with the presentation's `Theme` and the media layer, so the
   operator sees exactly what the room sees. Sizes use container units (`cqh`) of `.render` — never pad
   `.render` itself (cqh measures its content box). Layers (media, audio, countdown) live in the engine
   (`engine::Layers`, `LayersChanged`); audio plays only in the main window (`shared/AudioLayer.tsx`).
   Media files are referenced by absolute path and loaded via the Tauri asset protocol (`mediaUrl`).
10. **Drag and drop** uses `shared/drag.ts` (pointer events: `startDrag` + `useDropTarget`), never HTML5
   `draggable` — that is unreliable in Tauri webviews (Windows' file-drop handler swallows it) and can't be
   driven headlessly. xdotool mousedown/mousemove/mouseup exercises it in Xvfb.
11. **Fixture library**: `apps/desktop/public/fixture-library.json` is generated by
   `tools/build_fixture_library.py` from the Open Fixture Library (MIT) and QLC+ fixtures (Apache 2.0);
   keep `fixture-library-LICENSES.txt` next to it. Library modes become show profiles via
   `profileFromLibrary` (Lighting › PatchView) when patched; the engine never reads the library.
12. **Layout debugging without Tauri**: Playwright against the Vite dev server (`localhost:1420`) with a
   stub `window.__TAURI_INTERNALS__` (invoke → show JSON from contract.generated.ts, convertFileSrc) shows
   the real DOM/CSS — far quicker than guessing from Xvfb screenshots. Beware class-name clashes in the
   single global stylesheet (e.g. `.output` is the output-window class).
13. **Background video**: use `LoopVideo` (presenter/render.tsx) — React never writes the `muted` attribute and
   WKWebView won't autoplay a video it doesn't see as muted (it freezes on the first frame). Videos drawn to a
   canvas (visualizer/screen.ts) must stay attached to the document or WebKit pauses them.
14. CSS must work in WKWebView on older macOS (Safari < 17.4): no vertical `writing-mode` range inputs
   (use the rotated `.vfader-wrap` pattern), check caniuse for newer features.

## Lyric Follow (Presenter › Follow tab)

* Built in a separate Claude session on top of the original upload, merged in v0.10.0.
* Core logic: `crates/suite-core/src/presenter/follow.rs` (tested). It only decides **when** to go to the
  next slide — never which. Context is [last 8 words of previous slide][live slide][next slide]; fuzzy
  Smith-Waterman alignment of the last 10 heard words; cursor only moves forward.
* "Next" = `Show::play_order()` (running order, each song in its chosen arrangement, repeats included —
  same as `presenter/groups.ts` `sequence`). A repeated chorus is located with `Show::locate(order, slide,
  after)`; `FollowRuntime.pos` remembers where we are so the second chorus goes to the bridge, not verse 2.
* Desktop: `src-tauri/src/lyric_follow.rs` (cpal capture of one channel → 16 kHz ring → every 0.9 s the last
  6 s through a voice gate → `transcribe.rs` (whisper-rs 0.14, Metal on mac) → follower). Auto advances
  dispatch `Command::GoSlide`, so slide triggers still fire. `pending_auto` tells an auto advance apart from
  a manual one in `on_slide_live`. `follow_start` is async + spawn_blocking (opening audio waits).
* UI: `modules/presenter/LyricFollow.tsx` (panel; `useFollowEnter` = Enter takes the suggestion in Assist);
  next tile gets `follow-next` / `follow-ready`. Word numbering must match `normalize_word`.
* Settings in `Show.lyric_follow`; input device/channel/model/gate per computer in `Settings.follow_input`.
  Models (ggml tiny/base/small .en) download from huggingface.co into the app data folder.
* Building needs CMake + a C/C++ compiler + libclang (whisper.cpp). Build without it:
  `--no-default-features --features usb-dmx,audio`.

## Branding

Freeman Creative (owner's ministry/brand). App icons in `src-tauri/icons/` are generated from the CF mark on a
dark rounded square (`npx tauri icon <1024px png>`); `public/brand/mark.png` is the top-left badge and
`public/brand/freeman-creative.png` the horizontal logo on the loading screen (white text: dark backgrounds only).

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

- [x] COB Cannon Wash 4ch (= R G B A, Open Fixture Library) and Intimidator Spot LED 250 Advanced 13ch (QLC+ library)
- [ ] MDAC Curtain / Sidewall / Backlight channel maps (hand-made; Backlight assumed = Curtain layout)
- [ ] Owner's Lightkey shows P15/P16 COB Cannons overlapping at 1 and 5 — their Lightkey mode is longer than 4ch;
      confirm which mode the fixtures are set to (the demo uses 4ch)
- [ ] SQ NRPN numbers + level law; Avantis mute/fader/scene messages; Avantis main fader (not implemented)
- [x] Real patch addresses (from the owner's Lightkey patch screenshot; `demo.rs`, test `real_patch_has_no_overlaps`)
- [ ] Open DMX timing on macOS (FTDI VCP driver) and Windows
- [ ] X32 / X Air processing scalings on a real desk (tested against `tools/fake_x32.py` and the
      community OSC protocol document only); X Air HPF/EQ address map assumed identical to X32
- [ ] Gate acts as a gate only when the desk's gate mode is GATE (mode isn't set by the app)
- [ ] Video backgrounds (mp4/mov) via the asset protocol on macOS WKWebView and Windows WebView2 —
      Linux WebKitGTK can't stream video from the asset protocol (media error 4), so untested here.
      Images and audio-file playback paths are the same mechanism.
- [ ] Media paths are absolute: a show file moved to another computer needs the media at the same paths
- [ ] Video inputs (getUserMedia): macOS needs BOTH NSCameraUsageDescription (src-tauri/Info.plist) AND the
      `com.apple.security.device.camera` entitlement (src-tauri/Entitlements.plist) because the app is built with
      the hardened runtime — without the entitlement macOS denies silently and the app never appears in
      Privacy › Camera (owner hit this in v0.6.0). Windows: `on_permission_request` in lib.rs allows camera.
      Some capture drivers allow only one app/window at a time.
- [ ] Props / video inputs aren't drawn on Visualizer screens yet (text + background + countdown are)
- [ ] SketchUp model import: STL unit default is inches (SketchUp's default STL export) — check sizes on a real
      export; large models (>50 MB) may be slow in the webview
- [ ] AI media search with a real API key (only the offline ranking ran in tests); video analysis seeks frames
      through the asset protocol — check speed on a big bin on macOS/Windows
- [ ] Slide elements (text boxes, pictures, live feeds) aren't drawn on Visualizer screens (slide text formatting is)
- [ ] MIDI controllers on macOS (CoreMIDI) / Windows (WinMM) — only compiled + unit-tested on Linux (ALSA);
      Windows allows one app per MIDI input, so close other software (Lightkey, DAW) using the controller
- [ ] Lyric Follow end to end (mic → Whisper → advance): this cloud can't download models (huggingface.co
      blocked) and has no microphone — only compiled and unit-tested. Tune gate / confidence / words early
      with a real vocal channel at rehearsal; check latency on the Windows PCs
- [ ] "Match background" reads pixels through the asset protocol (needs its CORS header = app origin; works in
      Chromium tests) — confirm on macOS/Windows that a video background drives the lights

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
   *v0.3.0:* Presenter: whole service in one view, themes (font/size/colour/position/background
   colour/image/video/dim), media bin + media layer, audio layer (main window, fades), countdown timers
   (audience + stage), layered clears (F1 all, F2 slide, F3 media, F5 audio), Reflow editor. Visualizer:
   scenery (walls/drapes/risers) with real spotlights per fixture, puck fixture kind, "Shown as" per
   profile; Lighting plan draws scenery.
2. **Fixture library** — *v0.4.0:* 2,279 fixtures / 6,921 modes bundled (OFL + QLC+), Lightkey-style
   patch grid (universes, drag to add/move, overlap warnings, fixture details, groups), real COR patch.
   Still to do: profile editor UI, pixel/matrix modes, import Lightkey patch export.
3. **Lighting engine** — *v0.7.0:* group editor (create/rename/aliases/add-remove selection), delete fixtures in
   Patch (button + Delete key), drag lights on the 2D plan (moves them in the Visualizer too), Plan/3D toggle
   (`lighting/Stage3D.tsx` reuses `shared/stage3d/scene.ts`), "match background" (`shared/bgmatch.ts`:
   samples the on-screen background ~10 Hz into a 48×27 canvas → `merge_programmer`; intercepted in the
   scene builder before the engine, so it works offline; movers follow the brightest area).
   *v0.9.0:* three modes (`LightingApp` Mode, remembered in localStorage): ⚙ Setup (Stage layout = plan/3D
   with moving + `SetupInspector`, Patch, Positions, Outputs, MIDI), ✎ Program (lights locked: `StagePlan
   locked`, `StageScene.setLocked`), ▶ Show (`lighting/ShowPage.tsx`: `Show.show_page` items in order,
   drag to arrange, rename/colour, MIDI learn). Effects engine (`lighting/effects.rs`: rainbow/chase/pulse/
   two-colour/strobe over a group, pure function of time, applied in `Engine::frame`), group masters,
   `TriggerShowItem` (buttons + faders share one path with MIDI), MIDI (`midi.rs` parser; `src-tauri/
   midi_link.rs` midir thread → `Command::MidiInput`; `ShowItem.midi` mapping in the engine; CC buttons fire
   on the upward crossing). Match-background "thinking wheel" (`shared/MatchWheel.tsx`).
   Still to do: HTP/LTP, 16-bit-aware pan/tilt fades, effects (chase, rainbow, pan/tilt circles),
   cue list with follow/wait times, multiple playbacks, tap tempo, MIDI controller input.
4. **Presenter** — *v0.6.0:* ProPresenter layout (toolbar, Service with headers, media folders + bin,
   Live/layers, right tabs Audio/Props/Timers/Macros/Slide), groups + arrangements (saved versions; Reflow
   repeats become arrangement entries), props layer, macros (`SlideTrigger` lists, depth-limited), drag
   media/props/macros onto slides, video inputs (`shared/inputs.ts`, getUserMedia by device name) in
   Presenter and on Visualizer screens. *v0.8.0:* thumbnails/Next show only the slide's own media cue
   (checkerboard otherwise, `SlideRender transparent`); Reflow is split with live slide previews (debounced
   `parse_lyrics`); per-slide `Slide.style` (`TextStyle`, None = theme) and `Slide.elements` (`SlideElement`:
   text / shape / media incl. live inputs, x,y,w,h 0..1) edited in `presenter/SlideDesigner.tsx` (Edit › 🎨);
   AI media search (`presenter/mediaAnalysis.ts` measures colours/brightness/motion into `MediaItem.analysis`,
   `ai_rank_media` asks Claude with structured output, offline keyword ranking fallback; "Use for song" sets
   the first slide's media cue). *v0.12.0:* left column = Library (top; several libraries: `Presentation.library`,
   "" = by kind → Songs/Scripture/Default, `Show.libraries` for custom ones, drag onto a library to file),
   Services (`Settings.recent_shows`, `recent_shows`/`forget_recent_show`; clicking one saves the open show first
   if it has a file, else confirms, then `open_show`), Service (running order), Media folders. Both side columns
   are `presenter/layout.tsx` PaneColumns: width handles, drag bars between sections, ▾ fold, toolbar ◧/◨ hide;
   remembered in localStorage `presenter.layout.v2`. Still to do: scripture library, media transport (play/pause/scrub),
   stage display layouts, native NDI (now via NDI Tools "NDI Webcam"), CCLI report.
   Older notes: themes/backgrounds (images + video loops), media playback, scripture library
   (public-domain KJV/WEB bundled; others need licences), arrangements (V1 C V2 C B C), stage display
   layouts, NDI output, CCLI usage report export. SongSelect import needs a CCLI agreement.
5. **Audio**: playback engine (cpal) for walk-in music / tracks / click to chosen outputs; desk feedback
   → UI fader state; meters (X32 `/meters`); A&H MIDI feedback parsing; scene name lists.
6. **Visualizer** — *v0.5.0:* screens showing the live audience output (`visualizer/screen.ts` paints a
   canvas texture; mirrors presenter/render.tsx), haze + ambient (saved in `Show.visualizer`), stage items
   (deck, truss, people, drums, keys, guitarist, mic, speaker, wedge; built at a nominal size and scaled
   to `Scenery.size`). *v0.7.0:* the 3D stage lives in `shared/stage3d/` (used by Visualizer and Lighting);
   multi-select (Shift/⌘/Ctrl-click) moves/rotates through a pivot and a multi-edit inspector (mixed fields,
   spread evenly); model import (`SceneryKind::Model`: .stl/.obj/.dae/.glb/.gltf via three loaders, units +
   Z-up, sits on the floor; `size` = scale). *v0.9.0:* screen size box (`visualizer/screenSize.ts`: 90" diagonal
   + aspect, 7'x13', 7'6" x 13', 2.1m x 3.7m; bigger number = width). Still to do: gobo projection, snap fixtures to truss.
7. **Remote**: phone/tablet remote over WebSocket speaking the same `Command`/`Event` JSON.
8. **Safety**: autosave + crash recovery of the show file, API key in OS keychain, undo.
