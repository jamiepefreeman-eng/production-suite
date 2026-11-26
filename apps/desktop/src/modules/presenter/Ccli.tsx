// CCLI: the church's licence number, where the song copyright notice appears, and the usage report
// (every song shown, logged per service by the app — see src-tauri/src/songs.rs).

import { useEffect, useMemo, useState } from "react";
import { api, confirmDialog, showFiles } from "../../shared/bridge";
import { pushLog, updateShow } from "../../shared/store";
import type { CcliFooter, Show, UsageEntry } from "../../shared/types";

const day = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fromDay = (s: string) => new Date(`${s}T00:00:00`).getTime();

interface Row {
  title: string;
  ccli: string;
  authors: string;
  copyright: string;
  dates: string[];
}

/** One row per song (CCLI number, else title) with the days it was used. */
export function summarise(entries: UsageEntry[]): Row[] {
  const rows = new Map<string, Row>();
  for (const e of entries) {
    const key = e.ccli || e.title.toLowerCase();
    const r = rows.get(key) ?? { title: e.title, ccli: e.ccli ?? "", authors: e.authors, copyright: e.copyright, dates: [] };
    const d = day(e.at);
    if (!r.dates.includes(d)) r.dates.push(d);
    rows.set(key, r);
  }
  return [...rows.values()].sort((a, b) => b.dates.length - a.dates.length || a.title.localeCompare(b.title));
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function toCsv(rows: Row[]): string {
  const lines = [["Song", "CCLI Song #", "Writers", "Copyright", "Times used", "Dates"].join(",")];
  for (const r of rows) lines.push([r.title, r.ccli, r.authors, r.copyright, String(r.dates.length), r.dates.join(" ")].map(csvCell).join(","));
  return lines.join("\n") + "\n";
}

export default function CcliPanel({ show, onClose }: { show: Show; onClose: () => void }) {
  const [entries, setEntries] = useState<UsageEntry[]>([]);
  const today = day(Date.now());
  const [from, setFrom] = useState(day(Date.now() - 90 * 86_400_000));
  const [to, setTo] = useState(today);
  const load = () => void api.ccliUsage().then((e) => setEntries(e ?? [])).catch((e) => pushLog("warn", String(e)));
  useEffect(load, []);

  const inRange = useMemo(() => entries.filter((e) => e.at >= fromDay(from) && e.at < fromDay(to) + 86_400_000), [entries, from, to]);
  const rows = useMemo(() => summarise(inRange), [inRange]);
  const missing = rows.filter((r) => !r.ccli).length;
  const set = (patch: Partial<Show["ccli"]>) => updateShow((d) => void (d.ccli = { ...d.ccli, ...patch }));

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal ccli-modal" onClick={(e) => e.stopPropagation()}>
        <header className="row">
          <h3 className="grow">CCLI</h3>
          <button className="icon" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="row wrap">
          <label className="inline">
            CCLI Licence #
            <input value={show.ccli.license} placeholder="e.g. 1234567" onChange={(e) => void set({ license: e.target.value })} />
          </label>
          <label className="inline">
            Show the song notice
            <select value={show.ccli.footer} onChange={(e) => void set({ footer: e.target.value as CcliFooter })}>
              <option value="first">on the first slide</option>
              <option value="last">on the last slide</option>
              <option value="all">on every slide</option>
              <option value="off">nowhere</option>
            </select>
          </label>
        </div>
        <small className="muted">
          The notice — song title, writers, © and the CCLI song and licence numbers — appears small along the bottom of the audience output on song slides. Songs
          imported from SongSelect or Planning Center fill it in for you.
        </small>

        <h4>Song usage report</h4>
        <div className="row wrap">
          <label className="inline">
            From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="inline">
            to <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </label>
          <span className="grow" />
          <button
            disabled={!rows.length}
            onClick={() => {
              const text = rows.map((r) => `${r.title}\t${r.ccli}\t${r.dates.length}`).join("\n");
              void navigator.clipboard.writeText(text).then(
                () => pushLog("info", "Copied — song, CCLI #, times used"),
                () => pushLog("warn", "Couldn't copy to the clipboard"),
              );
            }}
          >
            Copy
          </button>
          <button
            className="primary"
            disabled={!rows.length}
            onClick={async () => {
              const path = await showFiles.saveAs(`CCLI report ${from} to ${to}.csv`, "Spreadsheet (CSV)", ["csv"]);
              if (!path) return;
              await api.writeTextFile(path, toCsv(rows)).then(
                () => pushLog("info", `Saved ${path}`),
                (e) => pushLog("warn", String(e)),
              );
            }}
          >
            Export CSV…
          </button>
        </div>
        <div className="ccli-table-wrap">
          <table className="ccli-table">
            <thead>
              <tr>
                <th>Song</th>
                <th>CCLI #</th>
                <th>Times</th>
                <th>Dates</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ccli || r.title} className={r.ccli ? "" : "no-ccli"}>
                  <td>
                    <b>{r.title}</b>
                    {r.authors && <small className="muted"> — {r.authors.split("|").join(", ")}</small>}
                  </td>
                  <td>{r.ccli || <span className="warn">missing</span>}</td>
                  <td>{r.dates.length}</td>
                  <td className="muted">{r.dates.join(", ")}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No songs shown between these dates. Every song you put on screen is logged here automatically (once per service).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <small className="muted">
          {missing > 0 && <span className="warn">{missing} song(s) have no CCLI number — add it in Edit before reporting. </span>}
          Report these in your CCLI account online (CCLI asks for each song and how many times it was shown). Logged on this computer only.
        </small>
        <div className="row end">
          <button
            onClick={() =>
              void confirmDialog(`Clear the usage log before ${from}? Do this after you've reported those dates to CCLI.`).then(async (yes) => {
                if (!yes) return;
                const n = await api.ccliUsageClear(fromDay(from));
                pushLog("info", `Cleared ${n} logged use(s)`);
                load();
              })
            }
          >
            Clear before {from}…
          </button>
          <span className="grow" />
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
