// Lightkey-style patch: fixture library on the left, a 512-channel grid per
// universe on the right. Drag a fixture mode from the library onto the grid to
// add it; drag a fixture block to re-address it. Overlaps show red-hatched.

import { useEffect, useMemo, useRef, useState } from "react";
import { confirmDialog } from "../../shared/bridge";
import { startDrag, useDropTarget, wasDragging, type Point } from "../../shared/drag";
import { pushLog, updateShow } from "../../shared/store";
import type { Attr, Fixture, FixtureKind, FixtureProfile, Show } from "../../shared/types";

// ─────────────────────────────────────────────── Library data

interface LibMode { name: string; ch: [Attr, number, string][] }
interface LibFixture {
  model: string;
  kind: FixtureKind;
  type: string;
  src: "ofl" | "qlc";
  pan: number;
  tilt: number;
  beam: number;
  colors: [string, number, string][];
  gobos: number[];
  modes: LibMode[];
}
interface Library { version: number; count: number; manufacturers: Record<string, LibFixture[]> }

let libraryPromise: Promise<Library> | null = null;
function loadLibrary(): Promise<Library> {
  libraryPromise ??= fetch("fixture-library.json").then((r) => {
    if (!r.ok) throw new Error(`fixture library: HTTP ${r.status}`);
    return r.json() as Promise<Library>;
  });
  return libraryPromise;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const hexToRgb = (h: string) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 });

/** Library mode -> a profile the engine understands. */
export function profileFromLibrary(manufacturer: string, f: LibFixture, m: LibMode): FixtureProfile {
  const attrs = new Set(m.ch.map((c) => c[0]));
  return {
    id: slug(`${manufacturer} ${f.model} ${m.name}`),
    manufacturer,
    model: f.model,
    mode: m.name,
    kind: f.kind,
    channels: m.ch.map(([attr, def, name]) => ({ attr, default: def, name })),
    gobo_slots: attrs.has("gobo") ? f.gobos : [],
    color_wheel: attrs.has("color_wheel") ? f.colors.map(([name, dmx, hex]) => ({ name, dmx, rgb: hexToRgb(hex) })) : [],
    pan_range: attrs.has("pan") ? f.pan : 0,
    tilt_range: attrs.has("tilt") ? f.tilt : 0,
    beam_angle: f.beam,
    needs_verification: false,
  };
}

type ProfileDrag = { profile: FixtureProfile; count: number };
type FixtureDrag = { id: number; grab: number };

/** Where a new fixture appears in the Visualizer, by type (adjust there). */
function defaultPlacement(kind: FixtureKind, n: number): { position: [number, number, number]; rotation: [number, number, number] } {
  const x = -4 + (n % 9) * 1;
  if (kind === "moving_spot" || kind === "moving_wash") return { position: [x, 6, 0], rotation: [180, 0, 0] };
  if (kind === "puck" || kind === "strip") return { position: [x, 0.05, -3.5], rotation: [-12, 0, 0] };
  return { position: [x, 5, 5], rotation: [-135, 0, 0] };
}

/** Add `count` fixtures of a profile starting at `address` (packed one after another). */
async function addFixtures(profile: FixtureProfile, universe: number, address: number, count: number) {
  const fp = profile.channels.length;
  if (address + fp * count - 1 > 512) {
    pushLog("warn", `Not enough room: ${count} × ${fp} channels from ${address} runs past 512`);
    return;
  }
  await updateShow((d) => {
    if (!d.profiles.some((p) => p.id === profile.id)) d.profiles.push(profile);
    let id = Math.max(0, ...d.fixtures.map((f) => f.id));
    const same = d.fixtures.filter((f) => f.profile_id === profile.id).length;
    for (let i = 0; i < count; i++) {
      const place = defaultPlacement(profile.kind, same + i);
      d.fixtures.push({ id: ++id, name: `${profile.model} ${same + i + 1}`, profile_id: profile.id, universe, address: address + i * fp, ...place });
    }
  });
  pushLog("info", `Added ${count} × ${profile.manufacturer} ${profile.model} (${profile.mode}) at ${universe}.${address}`);
}

// ─────────────────────────────────────────────── Patch view

const COLS = 24;
const KIND_HUE: Record<string, number> = { moving_spot: 28, moving_wash: 40, wash: 200, par: 300, puck: 290, strip: 160, generic: 220 };

export default function PatchView({ show }: { show: Show }) {
  const [universe, setUniverse] = useState(1);
  const [extraUniverses, setExtra] = useState<number[]>([]);
  const [selected, setSelected] = useState<number | null>(null);

  const universes = useMemo(
    () => [...new Set([1, ...show.fixtures.map((f) => f.universe), ...show.dmx_outputs.map((o) => o.universe), ...extraUniverses])].sort((a, b) => a - b),
    [show, extraUniverses],
  );
  const sel = show.fixtures.find((f) => f.id === selected) ?? null;

  return (
    <div className="patch-view">
      <LibraryBrowser show={show} universe={universe} />
      <section className="pv-main">
        <div className="pv-tabs">
          {universes.map((u) => {
            const out = show.dmx_outputs.filter((o) => o.universe === u);
            return (
              <button key={u} className={`pv-tab ${u === universe ? "on" : ""}`} onClick={() => setUniverse(u)}>
                <b>Universe {u}</b>
                <small className={out.length ? "" : "warn"}>{out.length ? out.map(outputLabel).join(" + ") : "no output"}</small>
              </button>
            );
          })}
          <button
            className="pv-tab add"
            title="Add a universe"
            onClick={() => {
              const n = Math.max(...universes) + 1;
              setExtra([...extraUniverses, n]);
              setUniverse(n);
            }}
          >
            +
          </button>
        </div>
        <UniverseGrid show={show} universe={universe} selected={selected} onSelect={setSelected} />
        {sel && <FixtureDetails key={sel.id} show={show} fixture={sel} universes={universes} onClose={() => setSelected(null)} />}
        <GroupsEditor show={show} />
      </section>
    </div>
  );
}

function outputLabel(o: Show["dmx_outputs"][number]) {
  switch (o.type) {
    case "sacn":
      return `sACN ${o.sacn_universe}`;
    case "art_net":
      return `Art-Net ${o.artnet_universe}`;
    case "enttec_pro":
      return "DMX USB Pro";
    case "open_dmx":
      return "Open DMX USB";
  }
}

function UniverseGrid({ show, universe, selected, onSelect }: { show: Show; universe: number; selected: number | null; onSelect: (id: number | null) => void }) {
  const grid = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const fixtures = show.fixtures.filter((f) => f.universe === universe);
  const fp = (f: Fixture) => show.profiles.find((p) => p.id === f.profile_id)?.channels.length ?? 1;

  // Which channels are used by more than one fixture.
  const owners = new Map<number, number[]>();
  for (const f of fixtures) for (let c = 0; c < fp(f); c++) owners.set(f.address + c, [...(owners.get(f.address + c) ?? []), f.id]);
  const clash = new Set<number>();
  for (const ids of owners.values()) if (ids.length > 1) ids.forEach((i) => clash.add(i));
  const used = [...owners.keys()].filter((a) => a >= 1 && a <= 512).length;
  const past = fixtures.filter((f) => f.address + fp(f) - 1 > 512);

  /** DMX address under the pointer. */
  const addrAt = (pt: Point) => {
    const el = grid.current!;
    const r = el.getBoundingClientRect();
    const col = Math.min(COLS - 1, Math.max(0, Math.floor(((pt.x - r.left) / r.width) * COLS)));
    const row = Math.floor((pt.y - r.top) / (ROW_H + 2));
    return Math.min(512, Math.max(1, row * COLS + col + 1));
  };

  useDropTarget(grid, ["profile", "fixture"], {
    onOver: (pt) => setHover(addrAt(pt)),
    onLeave: () => setHover(null),
    onDrop: (pt, p) => {
      setHover(null);
      void onDrop(addrAt(pt), p.kind, p.data);
    },
  });

  const onDrop = async (at: number, kind: string, data: unknown) => {
    if (kind === "profile") {
      const { profile, count } = data as ProfileDrag;
      await addFixtures(profile, universe, at, count);
      return;
    }
    if (kind === "fixture") {
      const { id, grab } = data as FixtureDrag;
      const f = show.fixtures.find((x) => x.id === id);
      if (!f) return;
      const address = Math.max(1, Math.min(512 - fp(f) + 1, at - grab));
      await updateShow((d) => {
        const x = d.fixtures.find((y) => y.id === id);
        if (x) Object.assign(x, { address, universe });
      });
      onSelect(id);
    }
  };

  // A fixture block can wrap over several rows: draw one segment per row.
  const segments = fixtures.flatMap((f) => {
    const n = fp(f);
    const out: { f: Fixture; start: number; len: number; first: boolean; offset: number }[] = [];
    let a = f.address;
    let off = 0;
    while (off < n && a <= 512) {
      const col = (a - 1) % COLS;
      const len = Math.min(n - off, COLS - col, 513 - a);
      out.push({ f, start: a, len, first: off === 0, offset: off });
      a += len;
      off += len;
    }
    return out;
  });

  return (
    <>
      {(clash.size > 0 || past.length > 0) && (
        <div className="pv-alert">
          {clash.size > 0 && "Fixtures must not overlap! "}
          {past.length > 0 && `${past.map((f) => f.name).join(", ")} run${past.length === 1 ? "s" : ""} past channel 512.`}
        </div>
      )}
      <div
        className="pv-grid"
        ref={grid}
        onClick={(e) => e.target === e.currentTarget && onSelect(null)}
      >
        {Array.from({ length: 512 }, (_, i) => (
          <div key={i} className={`pv-cell ${hover === i + 1 ? "hover" : ""}`} style={{ gridRow: Math.floor(i / COLS) + 1, gridColumn: (i % COLS) + 1 }}>
            {String(i + 1).padStart(3, "0")}
          </div>
        ))}
        {segments.map((s) => {
          const p = show.profiles.find((x) => x.id === s.f.profile_id);
          const hue = KIND_HUE[p?.kind ?? "generic"] ?? 220;
          return (
            <div
              key={`${s.f.id}-${s.start}`}
              className={`pv-fix ${clash.has(s.f.id) ? "clash" : ""} ${selected === s.f.id ? "sel" : ""} ${s.first ? "first" : ""}`}
              style={{ gridRow: Math.floor((s.start - 1) / COLS) + 1, gridColumn: `${((s.start - 1) % COLS) + 1} / span ${s.len}`, ["--hue" as string]: hue }}
              title={`${s.f.name} — ${p ? `${p.manufacturer} ${p.model} (${p.mode})` : s.f.profile_id} — ${s.f.universe}.${s.f.address}, ${p?.channels.length ?? "?"} ch`}
              onClick={() => !wasDragging() && onSelect(s.f.id)}
              onPointerDown={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const grab = s.offset + Math.floor(((e.clientX - r.left) / r.width) * s.len);
                startDrag(e, { kind: "fixture", data: { id: s.f.id, grab } satisfies FixtureDrag, label: `${s.f.name} → ?` });
              }}
            >
              {s.first ? (
                <>
                  <small>{String(s.f.address).padStart(3, "0")}</small>
                  <span className="ellipsis">
                    <b>{s.f.name}</b> {p?.model}
                  </span>
                </>
              ) : (
                <span className="ellipsis muted">{s.f.name}</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="pv-foot muted">
        {used} occupied, {512 - used} free channels in universe {universe} · drag a mode from the library onto a channel to add · drag a fixture to move it
      </div>
    </>
  );
}

const ROW_H = 34;

function FixtureDetails({ show, fixture, universes, onClose }: { show: Show; fixture: Fixture; universes: number[]; onClose: () => void }) {
  const p = show.profiles.find((x) => x.id === fixture.profile_id);
  const set = (patch: Partial<Fixture>) =>
    updateShow((d) => {
      const x = d.fixtures.find((y) => y.id === fixture.id);
      if (x) Object.assign(x, patch);
    });
  const [addr, setAddr] = useState(String(fixture.address));
  useEffect(() => setAddr(String(fixture.address)), [fixture.address]);
  return (
    <div className="pv-details card">
      <header>
        <input className="pv-name" value={fixture.name} onChange={(e) => void set({ name: e.target.value })} />
        <button className="icon" onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="row wrap">
        <span className="muted">{p ? `${p.manufacturer} ${p.model} · ${p.mode} · ${p.channels.length} ch` : fixture.profile_id}</span>
        <span className="grow" />
        <label className="inline">
          Universe
          <select value={fixture.universe} onChange={(e) => void set({ universe: Number(e.target.value) })}>
            {universes.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </label>
        <label className="inline">
          Address
          <input
            type="number"
            min={1}
            max={512}
            value={addr}
            onChange={(e) => {
              setAddr(e.target.value);
              const n = Number(e.target.value);
              if (n >= 1 && n <= 512) void set({ address: n });
            }}
          />
        </label>
        <button
          onClick={() =>
            updateShow((d) => {
              const id = Math.max(0, ...d.fixtures.map((f) => f.id)) + 1;
              const n = p?.channels.length ?? 1;
              d.fixtures.push({ ...structuredClone(fixture), id, name: `${fixture.name} copy`, address: Math.min(512 - n + 1, fixture.address + n) });
            })
          }
        >
          Duplicate
        </button>
        <button
          onClick={() =>
            void confirmDialog(`Remove “${fixture.name}” from the patch?`).then((yes) => {
              if (!yes) return;
              onClose();
              void updateShow((d) => {
                d.fixtures = d.fixtures.filter((f) => f.id !== fixture.id);
                for (const g of d.groups) g.fixtures = g.fixtures.filter((x) => x !== fixture.id);
                for (const c of d.cues) delete c.look.fixtures[String(fixture.id)];
                for (const pos of d.positions) pos.values = pos.values.filter((v) => v.fixture !== fixture.id);
              });
            })
          }
        >
          Remove
        </button>
      </div>
      <div className="pv-channels">
        {p?.channels.map((c, i) => (
          <span key={i} className={`pv-ch attr-${c.attr}`} title={c.attr}>
            <small>{fixture.address + i}</small>
            {c.name || c.attr.replace(/_/g, " ")}
          </span>
        ))}
      </div>
      <div className="row wrap">
        <span className="muted">Groups:</span>
        {show.groups.map((g, gi) => (
          <label key={g.name} className="inline">
            <input
              type="checkbox"
              checked={g.fixtures.includes(fixture.id)}
              onChange={(e) =>
                updateShow((d) => {
                  const list = d.groups[gi].fixtures;
                  d.groups[gi].fixtures = e.target.checked ? [...list, fixture.id] : list.filter((x) => x !== fixture.id);
                })
              }
            />
            {g.name}
          </label>
        ))}
      </div>
      {p?.needs_verification && <div className="warn">⚠ This profile was entered by hand — check the channel map against the fixture's manual.</div>}
    </div>
  );
}

function GroupsEditor({ show }: { show: Show }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  return (
    <details className="pv-groups" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Groups & what people call them ({show.groups.length})</summary>
      <p className="muted">The scene builder understands every alias listed here. Add fixtures to groups from a fixture's details.</p>
      {show.groups.map((g, gi) => (
        <div key={gi} className="row">
          <strong className="group-name">{g.name}</strong>
          <small className="muted">{g.fixtures.length}</small>
          <input
            className="grow"
            value={g.aliases.join(", ")}
            placeholder="aliases, comma separated"
            onChange={(e) =>
              updateShow((d) => {
                d.groups[gi].aliases = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
              })
            }
          />
          <button className="icon" title="Delete group" onClick={() => updateShow((d) => void d.groups.splice(gi, 1))}>
            ✕
          </button>
        </div>
      ))}
      <div className="row">
        <input placeholder="New group name" value={name} onChange={(e) => setName(e.target.value)} />
        <button
          disabled={!name.trim() || show.groups.some((g) => g.name === name.trim())}
          onClick={() => {
            void updateShow((d) => void d.groups.push({ name: name.trim(), aliases: [], fixtures: [] }));
            setName("");
          }}
        >
          Add group
        </button>
      </div>
    </details>
  );
}

// ─────────────────────────────────────────────── Library browser

function LibraryBrowser({ show, universe }: { show: Show; universe: number }) {
  const [lib, setLib] = useState<Library | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [man, setMan] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null); // "man|model"
  const [count, setCount] = useState(1);

  useEffect(() => {
    loadLibrary().then(setLib).catch((e) => setErr(String(e)));
  }, []);

  const inShow = useMemo(() => {
    // Profiles already in the show (incl. hand-made ones like MDAC) as a pseudo-manufacturer.
    const out: Record<string, FixtureProfile[]> = {};
    for (const p of show.profiles) (out[p.manufacturer] ??= []).push(p);
    return out;
  }, [show.profiles]);

  const results = useMemo(() => {
    if (!lib) return [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const all: { man: string; f: LibFixture }[] = [];
    for (const [m, list] of Object.entries(lib.manufacturers)) {
      if (!words.length && m !== man) continue;
      for (const f of list) {
        const hay = `${m} ${f.model} ${f.type}`.toLowerCase();
        if (words.every((w) => hay.includes(w))) all.push({ man: m, f });
      }
    }
    return all.slice(0, 300);
  }, [lib, q, man]);

  // Next free address in the current universe (for click-to-add).
  const nextFree = (n: number) => {
    const used = new Set<number>();
    for (const f of show.fixtures.filter((x) => x.universe === universe)) {
      const fp = show.profiles.find((p) => p.id === f.profile_id)?.channels.length ?? 1;
      for (let c = 0; c < fp; c++) used.add(f.address + c);
    }
    for (let a = 1; a + n - 1 <= 512; a++) {
      let ok = true;
      for (let c = 0; c < n; c++) if (used.has(a + c)) ok = false;
      if (ok) return a;
    }
    return null;
  };

  const modeRow = (profile: FixtureProfile, key: string) => (
    <div
      key={key}
      className="pv-mode"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        startDrag(e, { kind: "profile", data: { profile, count } satisfies ProfileDrag, label: `${count > 1 ? `${count} × ` : ""}${profile.model} · ${profile.mode}` });
      }}
      title="Drag onto a channel in the grid, or press + to add at the next free address"
    >
      <span className="grip">⋮⋮</span>
      <span className="grow ellipsis">{profile.mode}</span>
      <small className="muted">{profile.channels.length} ch</small>
      <button
        className="icon"
        onClick={() => {
          const at = nextFree(profile.channels.length * count);
          if (at == null) pushLog("warn", `No room for ${count} × ${profile.channels.length} channels in universe ${universe}`);
          else void addFixtures(profile, universe, at, count);
        }}
      >
        +
      </button>
    </div>
  );

  return (
    <aside className="pv-lib">
      <input className="pv-search" placeholder={lib ? `Search ${lib.count.toLocaleString()} fixtures…` : "Loading fixture library…"} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="row pv-count">
        <label className="inline muted">
          Add
          <input type="number" min={1} max={64} value={count} onChange={(e) => setCount(Math.max(1, Math.min(64, Number(e.target.value) || 1)))} />
          at a time
        </label>
      </div>
      {err && <div className="warn">{err}</div>}
      <div className="pv-lib-cols">
        {!q && (
          <ul className="pv-mans">
            <li className={man === "__show" ? "sel" : ""} onClick={() => setMan("__show")}>
              ★ In this show
            </li>
            {lib &&
              Object.keys(lib.manufacturers).map((m) => (
                <li key={m} className={man === m ? "sel" : ""} onClick={() => setMan(m)}>
                  {m}
                </li>
              ))}
          </ul>
        )}
        <div className="pv-models">
          {!q && man === "__show"
            ? Object.entries(inShow).map(([m, profiles]) => (
                <div key={m}>
                  <div className="pv-model-head">{m}</div>
                  {profiles.map((p) => modeRow(p, p.id))}
                </div>
              ))
            : results.map(({ man: m, f }) => {
                const key = `${m}|${f.model}`;
                return (
                  <div key={key} className="pv-model">
                    <div className="pv-model-head" onClick={() => setOpen(open === key ? null : key)}>
                      <span className="grow ellipsis">
                        {q && <small className="muted">{m} · </small>}
                        {f.model}
                      </span>
                      <small className="muted">{f.modes.length} mode{f.modes.length === 1 ? "" : "s"}</small>
                    </div>
                    {(open === key || f.modes.length === 1) && f.modes.map((md, i) => modeRow(profileFromLibrary(m, f, md), `${key}|${i}`))}
                  </div>
                );
              })}
          {!q && !man && <p className="muted pv-hint">Pick a manufacturer, or search by name (e.g. “intimidator 250”).</p>}
          {q && results.length === 0 && lib && <p className="muted pv-hint">No fixtures match “{q}”.</p>}
        </div>
      </div>
      <small className="muted pv-credit">Library: Open Fixture Library (MIT) + QLC+ fixtures (Apache 2.0).</small>
    </aside>
  );
}
