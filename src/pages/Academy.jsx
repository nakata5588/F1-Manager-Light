// src/pages/Academy.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGame } from "@/state/GameStore";

/* ───────────── utils ───────────── */
const tryFetchJSON = async (paths) => {
  for (const p of paths) {
    try { const r = await fetch(p); if (r.ok) return await r.json(); } catch {}
  }
  return null;
};
const normId = (s) =>
  (s ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\w\-]+/g, "");
const fmtMoney = (n) => {
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(n||0)); }
  catch { return `${n}`; }
};
const toDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(v);
};
const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
const titleCase = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : "");

/* ─────────── normalizers ────────── */
function normalizeAcademyDrivers(raw, driversAll) {
  // aceita: raw.drivers || raw.prospects || array direto
  const arr = Array.isArray(raw?.drivers) ? raw.drivers
    : Array.isArray(raw?.prospects) ? raw.prospects
    : Array.isArray(raw) ? raw
    : Array.isArray(raw?.items) ? raw.items
    : [];

  return arr.map((d, i) => {
    const id = d.driver_id ?? d.id ?? `AD_${i+1}`;
    const enriched = Array.isArray(driversAll)
      ? driversAll.find((x) => normId(x.driver_id ?? x.id) === normId(id))
      : null;

    const rating = Number(
      d.rating ?? d.overall ?? d.potential ??
      (enriched ? (enriched.rating ?? enriched.overall ?? enriched.potential) : 0)
    ) || 0;

    const progress = d.progress != null ? clamp01(d.progress) : null;

    return {
      driver_id: id,
      display_name: d.display_name ?? d.name ?? enriched?.display_name ?? enriched?.name ?? "Driver",
      age: Number(d.age ?? enriched?.age ?? 0) || null,
      nationality: d.country_name ?? d.nationality ?? enriched?.country_name ?? enriched?.nationality ?? "",
      team: d.team_name ?? d.team ?? "",
      series: d.series ?? d.league ?? d.category ?? "", // F2/F3/Ford etc
      rating,
      potential: Number(d.potential ?? enriched?.potential ?? rating) || rating,
      salary_weekly: Number(d.salary_weekly ?? d.weekly ?? d.salary ?? 0),
      contract_until: toDate(d.until ?? d.contract_end ?? d.end_date ?? null),
      contract_since: toDate(d.since ?? d.contract_start ?? d.start_date ?? null),
      on_loan: Boolean(d.on_loan ?? d.loan ?? false),
      loan_team: d.loan_team ?? d.loan_to ?? "",
      loan_until: toDate(d.loan_until ?? d.loan_end ?? null),
      progress, // 0..1 (nível no programa, se existir)
      notes: d.notes ?? "",
      portrait_path: d.portrait_path ?? `/portraits/drivers/${normId(id)}.png`,
      meta: d
    };
  });
}

function normalizePrograms(raw) {
  // aceita: raw.programs || array || items
  const arr = Array.isArray(raw?.programs) ? raw.programs
    : Array.isArray(raw) ? raw
    : Array.isArray(raw?.items) ? raw.items
    : [];
  return arr.map((p, i) => ({
    id: p.id ?? `PG_${i+1}`,
    name: p.name ?? p.title ?? "Program",
    focus: p.focus ?? p.area ?? "General", // Racecraft, Quali, Fitness, Mental, Media, Consistency…
    level: Number(p.level ?? p.tier ?? 1),
    max_level: Number(p.max_level ?? p.max ?? 5),
    cost_weekly: Number(p.cost_weekly ?? p.weekly_cost ?? 0),
    slots: Number(p.slots ?? p.capacity ?? 2),
    enrolled: Array.isArray(p.enrolled) ? p.enrolled : [],
    desc: p.desc ?? p.description ?? "",
  }));
}

function normalizeLoans(raw) {
  const arr = Array.isArray(raw?.loans) ? raw.loans
    : Array.isArray(raw) ? raw
    : Array.isArray(raw?.items) ? raw.items
    : [];
  return arr.map((l, i) => ({
    id: l.id ?? `LN_${i+1}`,
    driver_id: l.driver_id ?? l.id ?? l.driver ?? `AD_${i+1}`,
    to_team: l.to_team ?? l.team ?? "",
    since: toDate(l.since ?? l.start ?? l.start_date ?? null),
    until: toDate(l.until ?? l.end ?? l.end_date ?? null),
    fee: Number(l.fee ?? 0),
    salary_share: Number(l.salary_share ?? l.wages ?? 0), // %
    notes: l.notes ?? ""
  }));
}

/* ──────────── component ─────────── */
export default function Academy() {
  const { gameState } = useGame();

  const [fbAcademy, setFbAcademy] = useState(null);
  const [fbPrograms, setFbPrograms] = useState(null);
  const [fbLoans, setFbLoans] = useState(null);
  const [driversAll, setDriversAll] = useState(null); // enrichment

  useEffect(() => {
    (async () => {
      const [ac, pg, ln, dr] = await Promise.all([
        tryFetchJSON(["/data/academy.json"]),
        tryFetchJSON(["/data/academy_programs.json"]),
        tryFetchJSON(["/data/academy_loans.json"]),
        tryFetchJSON(["/data/drivers.json", "/data/all_drivers.json"]),
      ]);
      setFbAcademy(ac);
      setFbPrograms(pg);
      setFbLoans(ln);
      setDriversAll(dr);
    })();
  }, []);

  const academyState = gameState?.academy || {};
  const drivers = useMemo(
    () => normalizeAcademyDrivers(academyState.drivers || fbAcademy?.drivers || fbAcademy || [], driversAll),
    [academyState.drivers, fbAcademy, driversAll]
  );
  const programs = useMemo(
    () => normalizePrograms(academyState.programs || fbPrograms?.programs || fbPrograms || []),
    [academyState.programs, fbPrograms]
  );
  const loans = useMemo(
    () => normalizeLoans(academyState.loans || fbLoans?.loans || fbLoans || []),
    [academyState.loans, fbLoans]
  );

  const [tab, setTab] = useState("drivers");

  // summary
  const stipend = drivers.reduce((s, d) => s + (d.salary_weekly || 0), 0);
  const programsWeekly = programs.reduce((s, p) => s + (p.cost_weekly || 0), 0);

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <h1 className="text-2xl md:text-3xl font-semibold">Academy</h1>
        <div className="text-sm text-muted-foreground">
          {drivers.length} drivers • {programs.length} programs • {loans.length} loans
        </div>
      </div>

      {/* Snapshot */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Stat title="Drivers" value={drivers.length} />
        <Stat title="Programs weekly" value={fmtMoney(programsWeekly)} />
        <Stat title="Stipends weekly" value={fmtMoney(stipend)} />
        <Stat title="On loan" value={drivers.filter(d=>d.on_loan).length} />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2">
        {[
          ["drivers","Drivers"],
          ["programs","Programs"],
          ["loans","Loans"],
        ].map(([k,l]) => (
          <Button key={k} variant={tab===k ? "default":"outline"} onClick={()=>setTab(k)}>{l}</Button>
        ))}
        <div className="flex-1" />
        <Button disabled variant="outline">Add driver</Button>
      </div>

      {tab === "drivers" && <DriversTab drivers={drivers} />}
      {tab === "programs" && <ProgramsTab programs={programs} drivers={drivers} />}
      {tab === "loans" && <LoansTab loans={loans} drivers={drivers} />}
    </div>
  );
}

/* ───────────── tabs: Drivers ───────────── */
function DriversTab({ drivers }) {
  const [q, setQ] = useState("");
  const [minRating, setMinRating] = useState(0);
  const [series, setSeries] = useState("ALL");

  const SERIES = useMemo(() => {
    const set = new Set(["ALL"]);
    drivers.forEach(d => d.series && set.add(d.series));
    return Array.from(set);
  }, [drivers]);

  const filtered = useMemo(() => {
    return drivers.filter(d => {
      if (minRating && (d.rating || 0) < minRating) return false;
      if (series !== "ALL" && d.series !== series) return false;
      if (q) {
        const hay = `${d.display_name} ${d.nationality} ${d.team} ${d.series}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [drivers, q, minRating, series]);

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-sm">Min rating</label>
              <input type="number" min={0} max={100} value={minRating} onChange={(e)=>setMinRating(Number(e.target.value))} className="border rounded px-2 py-1 w-20" />
            </div>
            <select value={series} onChange={(e)=>setSeries(e.target.value)} className="border rounded px-2 py-1">
              {SERIES.map(s => <option key={s} value={s}>{s==="ALL"?"All series":s}</option>)}
            </select>
            <input
              type="text"
              placeholder="Search name/team/nationality…"
              value={q}
              onChange={(e)=>setQ(e.target.value)}
              className="border rounded px-3 py-1.5 w-full md:flex-1"
            />
            <div className="flex-1" />
            <Button variant="outline" onClick={()=>{ setQ(""); setMinRating(0); setSeries("ALL"); }}>Clear</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.length === 0 ? (
          <Card><CardContent className="p-4 text-sm text-muted-foreground">No academy drivers.</CardContent></Card>
        ) : filtered.map((d) => (
          <Card key={d.driver_id}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Avatar src={d.portrait_path} name={d.display_name} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium leading-tight truncate">{d.display_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {d.nationality || "—"} {d.age ? `• ${d.age}y` : ""} {d.team ? `• ${d.team}` : ""} {d.series ? `• ${d.series}` : ""}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xl font-semibold">{d.rating}</div>
                  <div className="text-[11px] text-muted-foreground">Rating</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <MiniStat label="Potential" value={d.potential} />
                <MiniStat label="Weekly" value={fmtMoney(d.salary_weekly)} />
                <MiniStat label="On loan" value={d.on_loan ? "Yes" : "No"} />
              </div>

              {d.progress != null ? (
                <div>
                  <div className="flex items-center justify-between text-sm">
                    <div>Program Progress</div>
                    <div className="font-medium">{Math.round(d.progress*100)}%</div>
                  </div>
                  <div className="mt-1"><Progress value={d.progress} /></div>
                </div>
              ) : null}

              <div className="text-xs text-muted-foreground">
                {d.contract_since ? `Since: ${d.contract_since.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"2-digit" })}` : "Since: —"}
                {" • "}
                {d.contract_until ? `Until: ${d.contract_until.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"2-digit" })}` : "Until: —"}
              </div>

              {d.on_loan ? (
                <div className="rounded-lg border p-2 text-xs">
                  <div><span className="text-muted-foreground">Loan to:</span> {d.loan_team || "—"}</div>
                  <div><span className="text-muted-foreground">Until:</span> {d.loan_until ? d.loan_until.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"2-digit" }) : "—"}</div>
                </div>
              ) : null}

              <div className="flex items-center gap-2">
                <Button size="sm" disabled>Assign Program</Button>
                <Button size="sm" variant="outline" disabled>Loan Out</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

/* ─────────── tabs: Programs ─────────── */
function ProgramsTab({ programs, drivers }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    return programs.filter(p => {
      if (!q) return true;
      const hay = `${p.name} ${p.focus}`.toLowerCase();
      return hay.includes(q.toLowerCase());
    });
  }, [programs, q]);

  const enrolledName = (id) => {
    const d = drivers.find(x => normId(x.driver_id) === normId(id));
    return d ? d.display_name : id;
  };

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Search program…"
              value={q}
              onChange={(e)=>setQ(e.target.value)}
              className="border rounded px-3 py-1.5 w-full md:flex-1"
            />
            <Button variant="outline" onClick={()=>setQ("")}>Clear</Button>
            <div className="flex-1" />
            <Button disabled>New Program</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.length === 0 ? (
          <Card><CardContent className="p-4 text-sm text-muted-foreground">No programs.</CardContent></Card>
        ) : filtered.map((p) => (
          <Card key={p.id}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm text-muted-foreground">{p.focus}</div>
                  <div className="text-lg font-medium">{p.name}</div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-semibold">{p.level}/{p.max_level}</div>
                  <div className="text-[11px] text-muted-foreground">Level</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <MiniStat label="Weekly Cost" value={fmtMoney(p.cost_weekly)} />
                <MiniStat label="Slots" value={`${p.enrolled.length}/${p.slots}`} />
              </div>

              {p.desc ? <div className="text-xs text-muted-foreground">{p.desc}</div> : null}

              <div className="rounded-lg border p-2">
                <div className="text-[11px] text-muted-foreground mb-1">Enrolled</div>
                {p.enrolled.length === 0 ? (
                  <div className="text-xs text-muted-foreground">None</div>
                ) : (
                  <ul className="text-sm list-disc pl-5">
                    {p.enrolled.map((id) => <li key={id}>{enrolledName(id)}</li>)}
                  </ul>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button size="sm" disabled>Upgrade</Button>
                <Button size="sm" variant="outline" disabled>Enroll Driver</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

/* ───────────── tabs: Loans ───────────── */
function LoansTab({ loans, drivers }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    return loans.filter(l => {
      if (!q) return true;
      const d = drivers.find(x => normId(x.driver_id) === normId(l.driver_id));
      const name = d?.display_name || l.driver_id;
      const hay = `${name} ${l.to_team}`.toLowerCase();
      return hay.includes(q.toLowerCase());
    });
  }, [loans, drivers, q]);

  const nameOf = (id) => {
    const d = drivers.find(x => normId(x.driver_id) === normId(id));
    return d ? d.display_name : id;
  };

  const totalFees = filtered.reduce((s, l) => s + (l.fee || 0), 0);

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Search driver/team…"
              value={q}
              onChange={(e)=>setQ(e.target.value)}
              className="border rounded px-3 py-1.5 w-full md:flex-1"
            />
            <div className="flex-1" />
            <div className="text-sm text-muted-foreground">Total fees: <span className="font-medium">{fmtMoney(totalFees)}</span></div>
            <Button variant="outline" onClick={()=>setQ("")}>Clear</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No loans.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/60">
                <tr className="text-left">
                  <th className="px-3 py-2">Driver</th>
                  <th className="px-3 py-2">To Team</th>
                  <th className="px-3 py-2 w-40">Term</th>
                  <th className="px-3 py-2 text-right">Fee</th>
                  <th className="px-3 py-2 text-right">Salary Share</th>
                  <th className="px-3 py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{nameOf(l.driver_id)}</td>
                    <td className="px-3 py-2">{l.to_team || "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {l.since ? l.since.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"2-digit" }) : "—"}
                      {" → "}
                      {l.until ? l.until.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"2-digit" }) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">{fmtMoney(l.fee)}</td>
                    <td className="px-3 py-2 text-right">{l.salary_share ? `${l.salary_share}%` : "—"}</td>
                    <td className="px-3 py-2 text-xs">{l.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/* ───────────── UI bits ───────────── */
function Stat({ title, value }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-sm text-muted-foreground mb-1">{title}</div>
        <div className="text-xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
function MiniStat({ label, value }) {
  return (
    <div className="rounded-lg border p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}
function Progress({ value }) {
  const v = clamp01(value);
  return (
    <div className="h-2 w-full rounded bg-muted/50 overflow-hidden ring-1 ring-black/5">
      <div className="h-full rounded" style={{ width: `${Math.round(v*100)}%`, background: "var(--primary, #111827)" }} />
    </div>
  );
}
function Avatar({ src, name }) {
  return (
    <div className="h-10 w-10 rounded-lg overflow-hidden bg-muted/40 flex items-center justify-center ring-1 ring-black/5">
      {src ? (
        <img
          src={src}
          alt={name}
          className="h-full w-full object-cover"
          onError={(e)=>{ e.currentTarget.style.display = "none"; }}
        />
      ) : (
        <span className="text-xs px-1 text-muted-foreground">{(name||"").split(" ").map(x=>x[0]).join("").slice(0,2)}</span>
      )}
    </div>
  );
}
