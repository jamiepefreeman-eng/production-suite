// Live video inputs: capture cards (Blackmagic, Magewell, Elgato…), webcams, and
// NDI sources via NDI Tools' free "NDI Webcam" (which shows up as a camera).
// Each window opens the device itself; streams are shared within a window.

import { useEffect, useState } from "react";

export interface VideoInput { deviceId: string; label: string }

let unlocked = false;

/** Ask once for camera permission so device names are visible, then list video inputs. */
export async function listVideoInputs(): Promise<VideoInput[]> {
  if (!navigator.mediaDevices?.enumerateDevices) throw new Error("This computer's web view doesn't offer video inputs");
  if (!unlocked) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      s.getTracks().forEach((t) => t.stop());
    } catch (e) {
      throw new Error(`Camera / capture access was refused (${e}). Allow it in System Settings › Privacy › Camera (Mac) or Settings › Privacy › Camera (Windows).`);
    }
    unlocked = true;
  }
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === "videoinput").map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Video input ${i + 1}` }));
}

const streams = new Map<string, Promise<MediaStream>>();

/** Open (or reuse) the input whose name matches `label` (names survive restarts; ids may not). */
export function getInputStream(label: string): Promise<MediaStream> {
  let p = streams.get(label);
  if (!p) {
    p = (async () => {
      const inputs = await listVideoInputs();
      const dev = inputs.find((d) => d.label === label) ?? inputs.find((d) => d.label.includes(label));
      if (!dev) throw new Error(`Video input “${label}” isn't connected`);
      return navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: dev.deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
    })();
    p.catch(() => streams.delete(label));
    streams.set(label, p);
  }
  return p;
}

/** React hook: the live stream for an input, or an error message. */
export function useInputStream(label: string | null): { stream: MediaStream | null; error: string | null } {
  const [state, setState] = useState<{ stream: MediaStream | null; error: string | null }>({ stream: null, error: null });
  useEffect(() => {
    if (!label) return setState({ stream: null, error: null });
    let live = true;
    getInputStream(label)
      .then((stream) => live && setState({ stream, error: null }))
      .catch((e) => live && setState({ stream: null, error: String(e?.message ?? e) }));
    return () => {
      live = false;
    };
  }, [label]);
  return state;
}
