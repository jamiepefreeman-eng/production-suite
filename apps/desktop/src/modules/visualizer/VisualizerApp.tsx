import { useEffect, useRef, useState } from "react";
import { api, on } from "../../shared/bridge";
import { pushLog, send, useEngine } from "../../shared/store";
import type { Fixture, VizSource } from "../../shared/types";
import { StageScene } from "./scene";

export default function VisualizerApp() {
  const { show } = useEngine();
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<StageScene | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [source, setSource] = useState<VizSource["type"]>("internal");
  const [frameSource, setFrameSource] = useState("");

  // Create the 3D scene once.
  useEffect(() => {
    if (!host.current) return;
    const s = new StageScene(host.current, {
      onSelect: setSelected,
      onMoved: (id, position, rotation) => send({ type: "move_fixture", fixture: id, position, rotation }),
    });
    scene.current = s;
    const off = on("visualizer-frame", (f) => {
      s.applyVisuals(f.fixtures);
      setFrameSource(f.source);
    });
    return () => {
      off();
      s.dispose();
      scene.current = null;
    };
  }, []);

  // Rebuild fixtures when the patch changes.
  useEffect(() => {
    if (show && scene.current) scene.current.setShow(show);
  }, [show]);

  useEffect(() => {
    scene.current?.select(selected);
  }, [selected]);

  const changeSource = async (t: VizSource["type"]) => {
    const src: VizSource = t === "sacn" ? { type: "sacn", universes: 4 } : t === "art_net" ? { type: "art_net" } : { type: "internal" };
    try {
      await api.setVisualizerSource(src);
      setSource(t);
    } catch (e) {
      pushLog("warn", String(e));
    }
  };

  const fx = show?.fixtures.find((f) => f.id === selected) ?? null;

  return (
    <div className="visualizer">
      <div className="viz-toolbar">
        <label className="inline">
          Show DMX from
          <select value={source} onChange={(e) => changeSource(e.target.value as VizSource["type"])}>
            <option value="internal">This app's lighting</option>
            <option value="sacn">External console via sACN (e.g. Lightkey)</option>
            <option value="art_net">External console via Art-Net</option>
          </select>
        </label>
        <span className="muted">{frameSource && `receiving ${frameSource}`}</span>
        <span className="grow" />
        <button onClick={() => scene.current?.setMode("translate")}>Move (W)</button>
        <button onClick={() => scene.current?.setMode("rotate")}>Rotate (E)</button>
        <button onClick={() => scene.current?.resetCamera()}>Reset view</button>
      </div>
      <div className="viz-body">
        <div className="viz-canvas" ref={host} />
        <aside className="panel right">
          <h3>Fixtures</h3>
          <ul className="list compact">
            {show?.fixtures.map((f) => (
              <li key={f.id} className={f.id === selected ? "sel" : ""} onClick={() => setSelected(f.id)}>
                {f.name} <small>{f.universe}.{f.address}</small>
              </li>
            ))}
          </ul>
          {fx && <Inspector fixture={fx} />}
        </aside>
      </div>
    </div>
  );
}

function Inspector({ fixture }: { fixture: Fixture }) {
  const set = (position: [number, number, number], rotation: [number, number, number]) =>
    send({ type: "move_fixture", fixture: fixture.id, position, rotation });
  const axis = ["X", "Y", "Z"];
  return (
    <div className="card">
      <h3>{fixture.name}</h3>
      <label>Position (m) — X across, Y height, Z toward audience</label>
      <div className="row">
        {fixture.position.map((v, i) => (
          <label key={i} className="inline">
            {axis[i]}
            <input
              type="number"
              step={0.1}
              value={Number(v.toFixed(2))}
              onChange={(e) => {
                const p = [...fixture.position] as [number, number, number];
                p[i] = Number(e.target.value);
                void set(p, fixture.rotation);
              }}
            />
          </label>
        ))}
      </div>
      <label>Rotation (°)</label>
      <div className="row">
        {fixture.rotation.map((v, i) => (
          <label key={i} className="inline">
            {axis[i]}
            <input
              type="number"
              step={5}
              value={Number(v.toFixed(1))}
              onChange={(e) => {
                const r = [...fixture.rotation] as [number, number, number];
                r[i] = Number(e.target.value);
                void set(fixture.position, r);
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
