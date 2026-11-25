# Production Suite

One desktop app (macOS + Windows) made of four modules that share one show engine:

| Module | What it does today |
|---|---|
| **Presenter** | ProPresenter-style: the whole service in one scrolling view, themes (fonts, colours, text position, image / video backgrounds), media bin with a background layer, walk-in audio, countdown timers on the audience and stage screens, layered Clear buttons (F1 all · F2 slide · F3 media · F5 audio), Reflow editor, Library + drag-to-reorder Service playlist, song import from pasted lyrics, big slide grid with coloured section labels, Edit mode (change words, add / move / duplicate / delete slides), Live + Next previews, audience + stage display + stream lower-third outputs on any screen, per-slide lighting/mixer actions |
| **Lighting** | Lightkey-style: built-in library of 2,279 fixtures (Open Fixture Library + QLC+), drag-and-drop patch grid per universe with overlap warnings, plain-language scene builder (offline parser + optional Claude), top-down stage plan showing every light in its live colour, inspector (intensity, colour, pan/tilt pad, position presets, gobos), cue tiles with fades, grand master, patch editor, focus positions, DMX outputs (sACN, Art-Net, Enttec DMX USB Pro, Enttec Open DMX) |
| **Audio** | Console view for Midas M32 / Behringer X32, Behringer X Air (XR18), Allen & Heath SQ and Avantis: channel names, faders (dB), pan, mutes, scene recall. On X32 / X Air also high-pass filter, 4-band EQ with response curve, gate and compressor, read back from the desk. Lists every audio device the OS sees |
| **Visualizer** | 3D stage with your patched fixtures lit by live DMX — from this app, or from an external console (Lightkey) over sACN/Art-Net. Every light casts real light, so walls, drapes, risers and the floor light up. Haze and ambient controls; LED screens that show the live Presenter output; truss, stage decks, people, drums, keys, guitarist, mics, speakers and wedges. Add and size walls / drapes / risers, drag fixtures and scenery around, change how a fixture type is drawn (puck, par, wash, strip, mover) |

Each module can run inside the main window or **pop out into its own window** (⧉), so on show day Presenter can be on one screen and Lighting on another — still one engine.

## How the modules talk

```
 Presenter ─┐                               ┌─> Presenter  (live slide, outputs)
 Lighting  ─┼─ Command ─> Engine ─ Event ───┼─> Lighting   (programmer, cue)
 Audio     ─┤   (one entry point)           ├─> Audio      (MixerOut -> desk)
 Visualizer┘                                └─> Visualizer
                  Engine.frame() @ 40 Hz ──> DMX outputs ──> decode ──> Visualizer @ 20 Hz
```

A slide going live can fire a lighting cue, run a lighting sentence ("front spots warm white at 90") and recall a mixer scene — the modules never call each other.

## Layout

```
crates/suite-core/          Rust engine, zero dependencies (protocols, AI parser, show model) + 23 unit tests
apps/desktop/src-tauri/     Tauri 2 shell: threads, USB DMX, audio devices, mixer link, Claude API, windows
apps/desktop/src/           React + TypeScript UI
  shared/                   bridge.ts (only file that touches Tauri), store.ts, types.ts (mirrors Rust)
  modules/presenter|lighting|audio|visualizer/   one folder per module, no cross-imports
```

## Run it

Prerequisites: Rust (stable), Node 20+, and the Tauri 2 platform prerequisites
(macOS: Xcode Command Line Tools; Windows: Visual Studio Build Tools + WebView2).

```bash
cd apps/desktop
npm install
npm run tauri dev          # dev build with hot reload
npm run tauri build        # installers (.dmg / .msi)

cargo test -p suite-core   # engine tests (from repo root)
```

The app starts with a demo show built around the current rig (COB Cannons, MDAC Curtains/Sidewalls, Intimidator Spot 250s). Try typing in Lighting:

> back wall blue, front spots on at 75, movers gobo 3 location centre stage

## Before using it in a service

* **Patch addresses** in the demo are sequential placeholders — enter the real ones (Lighting › Patch).
* **Unverified profiles** (flagged in Lighting › Patch): ADJ COB Cannon Wash 4ch and Chauvet Intimidator Spot LED 250 13ch channel maps, gobo/colour wheel values and shutter-open value.
* **Mixer parameter tables** marked `VERIFY` in `crates/suite-core/src/mixer/allen_heath.rs` — check against the A&H protocol PDFs on a real desk.
* **Focus positions** are rough — re-record Centre Stage / Pulpit etc. in Lighting › Positions.
* **Open DMX** timing is best-effort; prefer a DMX USB Pro or an sACN/Art-Net node.

See `CLAUDE.md` for the roadmap and conventions.
