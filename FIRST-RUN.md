# First run on your Mac and your Windows PC

This gets the app running on your own computers. You'll do it once per computer.
Expect about 30–45 minutes the first time, mostly waiting for downloads.
If any step shows red error text, copy all of it and paste it to Claude.

## 1. Install the tools (one time)

### Mac
1. Open **Terminal** (press ⌘-Space, type "Terminal", press Enter).
2. Paste this and press Enter. If a window pops up, click **Install**:
   ```bash
   xcode-select --install
   ```
3. Install Rust. Paste this and press Enter, then press Enter again to accept the defaults:
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
4. Install Node.js: download the **LTS** installer from https://nodejs.org and run it.
5. **Quit Terminal completely (⌘-Q) and open it again** so it finds the new tools.

### Windows
1. Install **Visual Studio Build Tools** from https://visualstudio.microsoft.com/visual-cpp-build-tools/ .
   In the installer, tick **"Desktop development with C++"**, then click Install.
2. Install Rust from https://rustup.rs: download `rustup-init.exe`, run it, and press Enter to accept the defaults.
3. Install Node.js: download the **LTS** installer from https://nodejs.org and run it.
4. WebView2 is already part of Windows 10 and 11, so there's nothing to install for it.
5. **Restart the computer** so the new tools are found.

## 2. Run the app

Unzip the project somewhere easy, for example your Documents folder. Then:

* **Mac:** in Terminal, type `cd ` (with a space after it), drag the `production-suite/apps/desktop` folder onto the Terminal window, and press Enter.
* **Windows:** open the `production-suite\apps\desktop` folder in File Explorer, click the address bar, type `cmd`, and press Enter.

Then run these one at a time:
```bash
npm install
```
```bash
npm run tauri dev
```
The first build takes 5–15 minutes. Later runs take seconds. The app window opens by itself.

## 3. Quick check (5 minutes)

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
