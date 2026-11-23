import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import OutputView from "./modules/presenter/OutputView";
import { MODULES } from "./modules/registry";
import type { ModuleId } from "./shared/bridge";
import "./styles.css";

// Routing by hash so every window loads the same bundle:
//   #output=audience   -> full-screen presentation output
//   #module=lighting   -> one module on its own (pop-out window)
//   (none)             -> the full suite
const hash = new URLSearchParams(window.location.hash.slice(1));
const output = hash.get("output");
const module = hash.get("module") as ModuleId | null;

function Root() {
  if (output) return <OutputView kind={output as "audience" | "stage" | "stream"} />;
  if (module && MODULES[module]) {
    const M = MODULES[module].component;
    return (
      <div className="standalone">
        <M />
      </div>
    );
  }
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
