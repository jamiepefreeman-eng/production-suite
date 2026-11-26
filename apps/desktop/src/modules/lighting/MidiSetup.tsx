// ⚙ Setup › MIDI: which controllers to listen to, and a live monitor of what they send.
// Mapping a pad / fader to a button happens on the ▶ Show page (Arrange › 🎹 Learn).

import { useEffect, useState } from "react";
import { api } from "../../shared/bridge";
import { pushLog, useEngine } from "../../shared/store";
import type { MidiStatus } from "../../shared/types";
import { midiControlOf, midiLabel, midiWhat } from "../../shared/midi";

export default function MidiSetup() {
  const [st, setSt] = useState<MidiStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const { lastMidi, show } = useEngine();
  const [heard, setHeard] = useState<string[]>([]);

  const refresh = async () => {
    try {
      setSt(await api.midiStatus());
    } catch (e) {
      pushLog("warn", String(e));
    }
  };
  useEffect(() => void refresh(), []);
  useEffect(() => {
    if (!lastMidi) return;
    const m = lastMidi.message;
    const what = midiWhat(m);
    setHeard((h) =>
      [`${midiLabel(midiControlOf(m))} ${what}`, ...h].slice(0, 12),
    );
  }, [lastMidi?.n]);

  const connect = async (inputs: string[] | null) => {
    setBusy(true);
    try {
      const s = await api.midiConnect(inputs);
      setSt(s);
      s.errors.forEach((e) => pushLog("warn", `MIDI: ${e}`));
    } catch (e) {
      pushLog("warn", String(e));
    } finally {
      setBusy(false);
    }
  };

  const mapped = show?.show_page.items.filter((i) => i.midi).length ?? 0;
  return (
    <div className="lk-midi">
      <h2>MIDI controllers</h2>
      <p className="muted">
        Plug in a controller (Akai APC / MIDImix, Novation Launchpad / Launch
        Control, Korg nanoKONTROL, a keyboard…). Then go to ▶ Show › ✎ Arrange
        and press 🎹 Learn on a button or fader, and press the pad / move the
        fader you want for it.
      </p>
      <div className="card">
        <header>
          <h3>Inputs on this computer</h3>
          <button onClick={() => void refresh()} disabled={busy}>
            Rescan
          </button>
        </header>
        {!st && <p className="muted">Looking…</p>}
        {st && st.available.length === 0 && (
          <p className="muted">
            No MIDI inputs found. Plug the controller in (and turn it on), then
            Rescan.
          </p>
        )}
        <div className="lk-midi-ports">
          {st?.available.map((name) => {
            const on = st.connected.includes(name);
            return (
              <label key={name} className="inline lk-midi-port">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={busy}
                  onChange={() =>
                    void connect(
                      on
                        ? st.connected.filter((n) => n !== name)
                        : [...st.connected, name],
                    )
                  }
                />
                <span className={on ? "" : "muted"}>{name}</span>
                {on && <span className="tag">listening</span>}
              </label>
            );
          })}
        </div>
        {st && st.available.length > 1 && (
          <button
            disabled={busy}
            onClick={() => void connect(null)}
            title="Also picks up controllers plugged in later (after a Rescan)"
          >
            Listen to all
          </button>
        )}
      </div>
      <div className="card">
        <header>
          <h3>What the controller is sending</h3>
          <small className="muted">{mapped} show-page control(s) mapped</small>
        </header>
        {heard.length === 0 ? (
          <p className="muted">Press a pad or move a fader…</p>
        ) : (
          <ul className="list compact">
            {heard.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
