# First run on your Mac and your Windows PC

The easy way: install the app from the download page. There are steps in INSTALL.md,
and the newest installers are always at
https://github.com/jamiepefreeman-eng/production-suite/releases

Only use the "build it yourself" steps further down if Claude asks you to.

## Quick check (5 minutes)

Tell Claude which of these worked and which didn't, on each computer:

1. **Presenter:** click the "Welcome" slide. It should show in the LIVE box, and the bottom bar should show "Cue 1 · Walk-in".
2. **Presenter → Outputs:** pick your second screen in the dropdown, then click **Audience**. Does it fill the right screen? Click again to close it.
3. **⧉ button** next to Lighting: does Lighting open in its own window?
4. **Lighting:** type `back wall blue, front wash at 75` and press **Build**. Then open **Visualizer**: is the back wall blue?
5. **Audio → Audio devices:** does it list your interfaces (for example the X32's X-USB)?
6. **Lighting → Outputs:** with the Enttec plugged in, does its port show up? Mac: `/dev/cu.usbserial-…`. Windows: `COM3` or similar.
7. **Audio → Mixer:** if the desk is on the network, enter its IP and click **Connect**.
8. **Save…** then **Open…**: does the show come back the same?

Don't run a real service on it yet. Check the "Before using it in a service" list in README.md first.

---
<details><summary>Build it yourself (only if Claude asks)</summary>

Install Rust (https://rustup.rs) and Node.js LTS (https://nodejs.org). On a Mac, also run
`xcode-select --install`. On Windows, install Visual Studio Build Tools with "Desktop development with C++".
Then, in the `apps/desktop` folder, run `npm install` and then `npm run tauri dev`.
</details>
