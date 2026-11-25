import { useState } from "react";
import { confirmDialog } from "../../shared/bridge";
import { updateShow } from "../../shared/store";
import type { Show, Theme } from "../../shared/types";
import { DEFAULT_THEME, FONTS, SlideRender, mediaById, themeFor } from "./render";

export default function ThemeEditor({ show, startWith, onClose }: { show: Show; startWith: string; onClose: () => void }) {
  const themes = show.themes.length ? show.themes : [DEFAULT_THEME];
  const [sel, setSel] = useState(themes.find((t) => t.name === startWith)?.name ?? themes[0].name);
  const t = themes.find((x) => x.name === sel) ?? themes[0];
  const used = show.presentations.filter((p) => themeFor(show, p.id).name === t.name).length;

  const edit = (patch: Partial<Theme>) =>
    updateShow((d) => {
      if (!d.themes.length) d.themes.push({ ...DEFAULT_THEME });
      const x = d.themes.find((y) => y.name === t.name);
      if (!x) return;
      if (patch.name !== undefined && patch.name !== t.name) {
        if (!patch.name.trim() || d.themes.some((y) => y.name === patch.name)) return;
        for (const p of d.presentations) if (p.theme === t.name) p.theme = patch.name;
        setSel(patch.name);
      }
      Object.assign(x, patch);
    });
  const addTheme = (base: Theme) => {
    let n = 1;
    while (themes.some((x) => x.name === `${base.name} ${n}`)) n++;
    const name = `${base.name} ${n}`;
    void updateShow((d) => void d.themes.push({ ...base, name }));
    setSel(name);
  };
  const visuals = show.media.filter((m) => m.kind !== "audio");

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal theme-modal" onClick={(e) => e.stopPropagation()}>
        <header className="row">
          <h3 className="grow">Themes</h3>
          <button onClick={onClose}>Done</button>
        </header>
        <div className="theme-body">
          <ul className="pp-list theme-list">
            {themes.map((x) => (
              <li key={x.name} className={x.name === t.name ? "sel" : ""} onClick={() => setSel(x.name)}>
                <span className="theme-swatch" style={{ background: x.background_color, color: x.color, fontFamily: x.font }}>
                  Aa
                </span>
                <span className="grow ellipsis">{x.name}</span>
              </li>
            ))}
            <li className="muted" onClick={() => addTheme(t)}>
              + Duplicate “{t.name}”
            </li>
            <li className="muted" onClick={() => addTheme({ ...DEFAULT_THEME, name: "Theme" })}>
              + New theme
            </li>
          </ul>
          <div className="theme-fields">
            <div className="theme-preview">
              <SlideRender text={"Amazing grace! How sweet the sound\nThat saved a wretch like me"} theme={t} background={mediaById(show, t.background_media)} play />
            </div>
            <div className="theme-grid">
              <label>Name</label>
              <input key={t.name} defaultValue={t.name} onBlur={(e) => void edit({ name: e.target.value.trim() })} />
              <label>Font</label>
              <select value={t.font} onChange={(e) => void edit({ font: e.target.value })}>
                {[...new Set([t.font, ...FONTS])].map((f) => (
                  <option key={f} value={f} style={{ fontFamily: f }}>
                    {f}
                  </option>
                ))}
              </select>
              <label>Size {Math.round(t.size * 100)}%</label>
              <input type="range" min={0.4} max={2} step={0.05} value={t.size} onChange={(e) => void edit({ size: Number(e.target.value) })} />
              <label>Text colour</label>
              <input type="color" value={t.color.slice(0, 7)} onChange={(e) => void edit({ color: e.target.value })} />
              <label>Position</label>
              <div className="seg small">
                {(["top", "center", "bottom", "lower_third"] as const).map((pos) => (
                  <button key={pos} className={t.position === pos ? "on" : ""} onClick={() => void edit({ position: pos })}>
                    {pos === "lower_third" ? "Lower third" : pos[0].toUpperCase() + pos.slice(1)}
                  </button>
                ))}
              </div>
              <label>Style</label>
              <div className="row">
                <label className="inline"><input type="checkbox" checked={t.bold} onChange={(e) => void edit({ bold: e.target.checked })} /> Bold</label>
                <label className="inline"><input type="checkbox" checked={t.uppercase} onChange={(e) => void edit({ uppercase: e.target.checked })} /> CAPITALS</label>
                <label className="inline"><input type="checkbox" checked={t.shadow} onChange={(e) => void edit({ shadow: e.target.checked })} /> Shadow</label>
              </div>
              <label>Background colour</label>
              <input type="color" value={t.background_color.slice(0, 7)} onChange={(e) => void edit({ background_color: e.target.value })} />
              <label>Background media</label>
              <select value={t.background_media ?? ""} onChange={(e) => void edit({ background_media: e.target.value ? Number(e.target.value) : null })}>
                <option value="">None</option>
                {visuals.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.kind === "video" ? "▶ " : "▣ "}
                    {m.name}
                  </option>
                ))}
              </select>
              <label>Darken background {Math.round(t.dim * 100)}%</label>
              <input type="range" min={0} max={0.9} step={0.05} value={t.dim} onChange={(e) => void edit({ dim: Number(e.target.value) })} />
            </div>
            <div className="row">
              <small className="muted grow">
                Used by {used} presentation{used === 1 ? "" : "s"}. {visuals.length === 0 && "Add images / videos in the Media bin to use them as backgrounds."}
              </small>
              <button
                disabled={themes.length <= 1}
                onClick={() =>
                  void confirmDialog(`Delete theme “${t.name}”? Presentations using it switch to “${themes.find((x) => x.name !== t.name)?.name}”.`).then(
                    (yes) => {
                      if (!yes) return;
                      const fallback = themes.find((x) => x.name !== t.name)!.name;
                      void updateShow((d) => {
                        d.themes = d.themes.filter((x) => x.name !== t.name);
                        for (const p of d.presentations) if (p.theme === t.name) p.theme = fallback;
                      });
                      setSel(fallback);
                    },
                  )
                }
              >
                Delete theme
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
