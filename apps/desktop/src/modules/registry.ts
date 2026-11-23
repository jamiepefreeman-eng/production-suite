// The four modules. Each is a self-contained app (its own folder, no imports
// from the others) that only talks to the engine through shared/bridge.
import type { ComponentType } from "react";
import type { ModuleId } from "../shared/bridge";
import PresenterApp from "./presenter/PresenterApp";
import LightingApp from "./lighting/LightingApp";
import AudioApp from "./audio/AudioApp";
import VisualizerApp from "./visualizer/VisualizerApp";

export const MODULES: Record<ModuleId, { label: string; key: string; component: ComponentType }> = {
  presenter: { label: "Presenter", key: "1", component: PresenterApp },
  lighting: { label: "Lighting", key: "2", component: LightingApp },
  audio: { label: "Audio", key: "3", component: AudioApp },
  visualizer: { label: "Visualizer", key: "4", component: VisualizerApp },
};
