# Production Suite

One desktop app (macOS + Windows) made of four modules that share one show engine:

| Module | What it does today |
|---|---|
| **Presenter** | Service list, song import from pasted lyrics, slide grid, live/next, audience + stage display + stream lower-third outputs on any screen, per-slide triggers |
| **Lighting** | Plain-language scene builder (offline parser + optional Claude), cue list with fades, group quick-buttons, patch editor, focus positions, DMX outputs (sACN, Art-Net, Enttec DMX USB Pro, Enttec Open DMX) |
| **Audio** | Lists every audio device the OS sees, mixer profiles for Midas M32 / Behringer X32, Behringer X Air (XR18), Allen & Heath SQ and Avantis: faders, mutes, scene recall, desk feedback |
| **Visualizer** | 3D stage with your patched fixtures lit by live DMX — from this app, or from an external console (Lightkey) over sACN/Art-Net. Click a fixture to move/rotate it |

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
