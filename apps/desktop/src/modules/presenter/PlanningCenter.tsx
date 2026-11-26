// Services › Planning Center: pick a plan and make it a service here.
//
// Songs come in with their lyrics (from the arrangement), CCLI number, writers, © and the
// arrangement's section order. Songs already in the Library (same CCLI # or title) are reused —
// your slides and backgrounds are kept — and just get Planning Center's order as an arrangement.
// The new service is saved to its own file, so it appears in Services.

import { useEffect, useState } from "react";
import { api, showFiles } from "../../shared/bridge";
import { pushLog, updateShow } from "../../shared/store";
import type { PcoItem, PcoPlan, PcoPlanImport, PcoServiceType, Presentation, Show } from "../../shared/types";
import { BUILT_IN_LIBRARIES, addSongs } from "./Sidebar";
import { newSlide } from "./render";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Planning Center's sequence names ("V1", "Verse 1", "C") → this song's group labels, if they all match. */
export function mapSequence(seq: string[], labels: string[]): string[] | null {
  if (!seq.length) return null;
  const expand = (s: string) => {
    const m = norm(s).match(/^(v|c|b|pc|t|i|o|e)\s*(\d*)$/);
    if (!m) return norm(s);
    const word = { v: "verse", c: "chorus", b: "bridge", pc: "pre-chorus", t: "tag", i: "intro", o: "outro", e: "ending" }[m[1]]!;
    return m[2] ? `${word} ${m[2]}` : word;
  };
  const out: string[] = [];
  for (const s of seq) {
    const want = expand(s);
    const hit = labels.find((l) => norm(l) === want) ?? labels.find((l) => norm(l) === `${want} 1`) ?? labels.find((l) => norm(l).replace(/ 1$/, "") === want);
    if (!hit) return null;
    out.push(hit);
  }
  return out;
}

async function songFrom(item: PcoItem): Promise<Presentation> {
  const base = item.lyrics.trim()
    ? await api.importSongText(item.lyrics, item.title, 4)
    : ({
        id: 0,
        title: item.title,
        kind: "song",
        ccli: null,
        slides: [newSlide(1, "Lyrics", "")],
        theme: "Default",
        groups: [],
        arrangements: [],
        arrangement: null,
        library: "",
        authors: "",
        copyright: "",
      } as Presentation);
  const p: Presentation = { ...base, title: item.title, kind: "song", ccli: item.ccli ?? base.ccli, authors: item.authors || base.authors, copyright: item.copyright || base.copyright };
  const order = mapSequence(item.sequence, [...new Set(p.slides.map((s) => s.label))]);
  if (order) {
    const name = item.arrangement || "Planning Center";
    p.arrangements = [...p.arrangements.filter((a) => a.name !== name), { name, sequence: order }];
    p.arrangement = name;
  }
  return p;
}

export default function PlanningCenterImport({ show, onClose, onDone }: { show: Show; onClose: () => void; onDone: () => void }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [appId, setAppId] = useState("");
  const [secret, setSecret] = useState("");
  const [types, setTypes] = useState<PcoServiceType[]>([]);
  const [type, setType] = useState("");
  const [plans, setPlans] = useState<PcoPlan[]>([]);
  const [plan, setPlan] = useState<PcoPlanImport | null>(null);
  const [planId, setPlanId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async <T,>(what: string, f: () => Promise<T>): Promise<T | undefined> => {
    setBusy(what);
    setError(null);
    try {
      return await f();
    } catch (e) {
      setError(String(e));
      return undefined;
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    void api
      .pcoStatus()
      .then(async (s) => {
        setSignedIn(s.signed_in);
        setAppId(s.app_id);
        if (s.signed_in) {
          const t = await run("Loading service types…", () => api.pcoServiceTypes());
          if (t) setTypes(t);
        }
      })
      .catch(() => setSignedIn(false));
  }, []);
  useEffect(() => {
    if (types.length && !type) setType(types[0].id);
  }, [types]);
  useEffect(() => {
    if (!type) return;
    setPlan(null);
    void run("Loading plans…", () => api.pcoPlans(type)).then((p) => p && setPlans(p));
  }, [type]);

  const signIn = async () => {
    const t = await run("Checking with Planning Center…", () => api.pcoSignIn(appId, secret));
    if (t) {
      setSignedIn(true);
      setSecret("");
      setTypes(t);
    }
  };

  const importPlan = async () => {
    if (!plan) return;
    // Where the new service goes — ask first, so the open service is never overwritten by mistake.
    const path = await showFiles.save(`${plan.title || "Service"} ${plan.dates}`.trim().replace(/[\\/:*?"<>|]/g, "-") + ".json");
    if (!path) return;
    await run("Importing…", async () => {
      // Keep the open service's changes first (it's about to be replaced on screen).
      await api.saveShow().catch(() => {});
      const songs = plan.items.filter((i) => i.kind === "song");
      const built = await Promise.all(songs.map(songFrom));
      const { ids: songIds, skipped } = await addSongs(show, built, "Songs");
      // Songs already in the Library: add Planning Center's order as an arrangement (slides untouched).
      await updateShow((d) => {
        songs.forEach((item, i) => {
          const p = d.presentations.find((x) => x.id === songIds[i]);
          if (!p || !skipped.includes(built[i].title)) return;
          if (!p.ccli && item.ccli) p.ccli = item.ccli;
          if (!p.authors && item.authors) p.authors = item.authors;
          if (!p.copyright && item.copyright) p.copyright = item.copyright;
          const order = mapSequence(item.sequence, [...new Set(p.slides.map((s) => s.label))]);
          if (order) {
            const name = item.arrangement || "Planning Center";
            p.arrangements = [...p.arrangements.filter((a) => a.name !== name), { name, sequence: order }];
            p.arrangement = name;
          }
        });
        // Headers and other items, then the running order.
        let next = Math.max(0, ...d.presentations.map((p) => p.id));
        const lib = "Service items";
        if (!d.libraries.includes(lib) && plan.items.some((i) => i.kind === "item" || i.kind === "media")) d.libraries.push(lib);
        let s = 0;
        d.playlist = plan.items.map((item) => {
          if (item.kind === "song") return songIds[s++];
          const existing = item.kind !== "header" && d.presentations.find((p) => p.library === lib && norm(p.title) === norm(item.title));
          if (existing) return existing.id;
          const id = ++next;
          d.presentations.push({
            id,
            title: item.title,
            kind: item.kind === "header" ? "header" : "announcement",
            ccli: null,
            theme: d.themes[0]?.name ?? "Default",
            groups: [],
            arrangements: [],
            arrangement: null,
            library: item.kind === "header" || BUILT_IN_LIBRARIES.includes(lib) ? "" : lib,
            authors: "",
            copyright: "",
            slides: item.kind === "header" ? [] : [newSlide(1, item.title, "")],
          });
          return id;
        });
        d.name = [plan.title, plan.dates].filter(Boolean).join(" · ") || d.name;
      });
      await api.saveShow(path);
      pushLog("info", `Imported “${plan.title || plan.dates}” from Planning Center (${songs.length} songs${skipped.length ? `, ${skipped.length} already in the Library` : ""})`);
    });
    onDone();
    onClose();
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal pco-modal" onClick={(e) => e.stopPropagation()}>
        <header className="row">
          <h3 className="grow">Import from Planning Center</h3>
          <button className="icon" onClick={onClose}>
            ✕
          </button>
        </header>
        {signedIn === false && (
          <div className="pco-signin">
            <p>
              Connect with a <b>Personal Access Token</b> (only needs doing once on this computer):
            </p>
            <ol>
              <li>
                Sign in at <b>api.planningcenteronline.com/oauth/applications</b> with your Planning Center account.
              </li>
              <li>
                Under <b>Personal Access Tokens</b>, press <b>New Personal Access Token</b>, give it a name (e.g. “Production Suite”) and allow <b>Services</b>.
              </li>
              <li>Copy the Application ID and Secret here.</li>
            </ol>
            <label>Application ID</label>
            <input value={appId} onChange={(e) => setAppId(e.target.value)} autoComplete="off" />
            <label>Secret</label>
            <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" />
            <div className="row end">
              <button className="primary" disabled={!appId.trim() || !secret.trim() || !!busy} onClick={() => void signIn()}>
                Connect
              </button>
            </div>
          </div>
        )}
        {signedIn && (
          <>
            <div className="row wrap">
              <label className="inline">
                Service type
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <span className="grow" />
              <button
                className="link small"
                onClick={() =>
                  void api.pcoSignIn("", "").then(() => {
                    setSignedIn(false);
                    setTypes([]);
                    setPlans([]);
                  })
                }
              >
                Disconnect
              </button>
            </div>
            <div className="pco-cols">
              <ul className="pp-list pco-plans">
                {plans.map((p) => (
                  <li
                    key={p.id}
                    className={p.id === planId ? "sel" : ""}
                    onClick={() => {
                      setPlanId(p.id);
                      void run("Loading plan…", () => api.pcoPlan(type, p.id)).then((x) => x && setPlan(x));
                    }}
                  >
                    <span className="grow ellipsis">
                      <b>{p.dates}</b> {p.title && <span className="muted">· {p.title}</span>}
                    </span>
                    {p.series && <small className="muted ellipsis">{p.series}</small>}
                  </li>
                ))}
                {!plans.length && !busy && <li className="muted hint">No plans found for this service type.</li>}
              </ul>
              <div className="pco-items">
                {plan ? (
                  <>
                    <h4>
                      {plan.dates} {plan.title && `· ${plan.title}`}
                    </h4>
                    <ol>
                      {plan.items.map((i, k) => (
                        <li key={k} className={`pco-item ${i.kind}`}>
                          {i.kind === "song" ? "♫ " : i.kind === "header" ? "▬ " : "• "}
                          {i.title}
                          {i.kind === "song" && (
                            <small className="muted">
                              {i.key && ` · ${i.key}`}
                              {i.ccli && ` · CCLI ${i.ccli}`}
                              {i.lyrics.trim() ? "" : " · no lyrics in Planning Center"}
                              {i.sequence.length > 0 && ` · ${i.sequence.join(" ")}`}
                            </small>
                          )}
                        </li>
                      ))}
                    </ol>
                  </>
                ) : (
                  <p className="muted">Pick a plan to see what will come in.</p>
                )}
              </div>
            </div>
            <small className="muted">
              Songs already in your Library (same CCLI # or title) keep their slides and backgrounds — they just get Planning Center's order as an arrangement.
              The plan becomes a new service saved in its own file.
            </small>
            <div className="row end">
              <button onClick={onClose}>Cancel</button>
              <button className="primary" disabled={!plan || !!busy} onClick={() => void importPlan()}>
                Import as a new service…
              </button>
            </div>
          </>
        )}
        {busy && <div className="muted">{busy}</div>}
        {error && <div className="warn">⚠ {error}</div>}
      </div>
    </div>
  );
}
