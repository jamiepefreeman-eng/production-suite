// Lighting's 3D view: the same 3D stage as the Visualizer (shared/stage3d), for picking and
// moving lights. Selection is the Lighting selection; moves go to the engine, so the
// Visualizer and the 2D plan follow.

import { useEffect, useRef } from "react";
import { on } from "../../shared/bridge";
import { send } from "../../shared/store";
import { StageScene } from "../../shared/stage3d/scene";
import type { Show } from "../../shared/types";

export default function Stage3D({
  show,
  sel,
  setSel,
  locked = false,
}: {
  show: Show;
  sel: number[];
  setSel: (f: (s: number[]) => number[]) => void;
  /** Program mode: select only, no moving. */
  locked?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<StageScene | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const s = new StageScene(host.current, {
      onSelect: (item, additive) => {
        if (!item) return setSel(() => []);
        if (item.kind !== "fixture") return; // stage items are edited in the Visualizer
        const id = item.id;
        setSel((cur) =>
          additive
            ? cur.includes(id)
              ? cur.filter((x) => x !== id)
              : [...cur, id]
            : [id],
        );
      },
      onMoved: (id, position, rotation) =>
        void send({ type: "move_fixture", fixture: id, position, rotation }),
      onSceneryMoved: () => {},
    });
    scene.current = s;
    const off = on("visualizer-frame", (f) => {
      if (f.source === "internal") s.applyVisuals(f.fixtures);
    });
    return () => {
      off();
      s.dispose();
      scene.current = null;
    };
  }, []);

  useEffect(() => {
    if (!scene.current) return;
    scene.current.setLocked(locked);
    scene.current.setShow(show);
    scene.current.setAtmosphere(
      show.visualizer ?? { haze: 0.35, ambient: 0.15 },
    );
    scene.current.select(sel.map((id) => ({ kind: "fixture" as const, id })));
  }, [show, sel, locked]);

  return (
    <div className="lk-3d">
      <div className="lk-3d-canvas" ref={host} />
      <div className="lk-3d-tools seg small">
        {!locked && (
          <>
            <button
              onClick={() => scene.current?.setMode("translate")}
              title="W"
            >
              Move
            </button>
            <button onClick={() => scene.current?.setMode("rotate")} title="E">
              Rotate
            </button>
          </>
        )}
        <button onClick={() => scene.current?.resetCamera()}>Reset view</button>
      </div>
      <small className="lk-3d-hint">
        {locked
          ? "Click a light · Shift-click for several · drag empty space to orbit · lights are locked (move them in Setup)"
          : "Click a light · Shift-click for several · drag the arrows to move · drag empty space to orbit"}
      </small>
    </div>
  );
}
