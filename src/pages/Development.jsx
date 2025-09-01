// src/pages/Development.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGame } from "@/state/GameStore";

/* ------------- utils ------------- */
const tryFetchJSON = async (paths) => {
  for (const p of paths) {
    try { const r = await fetch(p); if (r.ok) return await r.json(); } catch {}
  }
  return null;
};
const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
const fmtMoney = (n) => {
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(n||0)); }
  catch { return `${n}`; }
};
const toDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2])-1, Number(m[3])) : new Date(v);
};
const titleCase = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : "");
const daysBetween = (a, b) => Math.ceil((b.getTime() - a.getTime()) / (24*60*60*1000));

/* ----------- normalizers ----------- */
function normalizeProjects(raw) {
  // aceita raw.projects, raw, ou raw.items
  const arr = Array.isArray(raw?.projects) ? raw.projects
    : Array.isArray(raw) ? raw
    : Array.isArray(raw?.items) ? raw.items
    : [];
  return arr.map((p, i) => {
    const phase = (p.phase ?? p.stage ?? "design").toString().toLowerCase(); // concept|design|testing|homologation
    const type = (p.type ?? p.area ?? "aero").toString(); // aero|chassis|suspension|brakes|power
    const started_at = toDate(p.started_at ?? p.start ?? null);
    const finishes_at = toDate(p.finishes_at ?? p.finish ?? p.eta ?? null);
    const progress = p.progress != null ? clamp01(p.progress) : (started_at && finishes_at ? estimateProgress(started_at, finishes_at) : 0);
    const status = (p.status ?? (progress >= 1 ? "completed" : "active")).toString().toLowerCase(); // active|paused|completed
    return {
      id: p.id ?? `PR_${i+1}`,
      name: p.name ?? p.title ?? "New Part",
      type,
      phase,
      status,
      progress,
      cfd_hours: Number(p.cfd_hours ?? p.cfd ?? 0),
      wt_hours: Number(p.wind_tunnel_hours ?? p.wt_hours ?? p.windtunnel ?? 0),
      engineers: Number(p.engineers ?? p.eng_count ?? 0),
      cost: Number(p.cost ?? p.spend ?? 0),
      started_at,
      finishes_at,
      perf_delta: Number(p.perf_delta ?? p.performance ?? 0),
      risk: Number(p.risk ?? 0),
      meta: p
    };
  }).sort((a,b)=> (a.status===b.status ? (b.perf_delta - a.perf_delta) : (a.status==="active" ? -1 : 1)));
}
function estimateProgress(start, end) {
  if (!start || !end) return 0;
  const now = new Date();
  const total = end - start;
  const done = now - start;
  if (total <= 0) return 1;
  return clamp01(done / total);
}

function normalizeParts(raw) {
  const arr = Array.isArray(raw?.parts) ? raw.parts
    : Array.isArray(raw) ? raw
    : Array.isArray(raw?.items) ? raw.items
    : [];
  return arr.map((x, i) => ({
    id: x.id ?? `PT_${i+1}`,
    name: x.name ?? x.title ?? "Part",
    slot: x.slot ?? x.type ?? "Front Wing",
    version: x.version ?? x.ver ?? "A",
    carA: x.carA ?? x.fitted_A ?? false,
    carB: x.carB ?? x.fitted_B ?? false,
    condition: Number(x.condition ?? x.wear ?? 100),
    perf: Number(x.perf ?? x.performance ?? 0),
    inv: Number(x.inventory ?? x.units ?? 1),
    in_manufacturing: Number(x.in_manufacturing ?? 0),
    meta: x
  }));
}

function normalizeManufacturing(raw) {
  const arr = Array.isArray(raw?.queue) ? raw.queue
    : Array.isArray(raw) ? raw
    : Array.isArray(raw?.items) ? raw.items
    : [];
  return arr.map((q, i) => ({
    id: q.id ?? `MF_${i+1}`,
    part_id: q.part_id ?? q.part ?? q.name ?? `PT_${i+1}`,
    title: q.title ?? q.name ?? "Batch",
    qty: Number(q.qty ?? q.quantity ?? 1),
    unit_cost: Number(q.unit_cost ?? q.cost ?? 0),
    started_at: toDate(q.started_at ?? q.start ?? null),
    finishes_at: toDate(q.finishes_at ?? q.finish ?? q.eta ?? null),
    status: (q.status ?? (q.finishes_at && q.finishes_at < new Date() ? "completed" : "active")).toLowerCase()
  })).sort((a,b)=> (a.status===b.status ? (a.finishes_at?.getTime?.()||0) - (b.finishes_at?.getTime?.()||0) : (a.status==="active" ? -1 : 1)));
}

function normalizeResearch(raw) {
  // simples: lista de áreas com pontos/níveis
  const arr = Array.isArray(raw?.areas) ? raw.areas
    : Array.isArray(raw) ? raw
    : Array.isArray(raw?.items) ? raw.items
    : [];
  return arr.map((r, i) => ({
    id: r.id ?? r.area ?? `RS_${i+1}`,
    area: r.area ?? r.name ?? r.id ?? `Area ${i+1}`,
    points: Number(r.points ?? r.rp ?? 0),
    level: Number(r.level ?? 0),
    focus: Number(r.focus ?? r.alloc ?? 0), // 0..100
    notes: r.notes ?? ""
  }));
}

/* ------------- component ------------- */
export default function Development() {
  const { gameState } = useGame();

  const [fbDev, setFbDev] = useState(null);
  const [fbParts, setFbParts] = useState(null);
  const [fbMf, setFbMf] = useState(null);
  const [fbRes, setFbRes] = useState(null);

  useEffect(() => {
    (async () => {
      const [dev, parts, mfg, res] = await Promise.all([
        tryFetchJSON(["/data/development.json"]),
        tryFetchJSON(["/data/parts.json"]),
        tryFetchJSON(["/data/manufacturing.json"]),
        tryFetchJSON(["/data/research.json"]),
      ]);
      setFbDev(dev);
      setFbParts(parts);
      setFbMf(mfg);
      setFbRes(res);
    })();
  }, []);

  // fontes principais
  const devState = gameState?.development || {};
  const projects = useMemo(
    () => normalizeProjects(devState.projects || fbDev?.projects || fbDev || []),
    [devState.projects, fbDev]
  );
  const parts = useMemo(
    () => normalizeParts(devState.parts || fbParts?.parts || fbParts || []),
    [devState.parts, fbParts]
  );
  const queue = useMemo(
    () => normalizeManufacturing(devState.manufacturing || fbMf?.queue || fbMf || []),
    [devState.manufacturing, fbMf]
  );
  const research = useMemo(
    () => normalizeResearch(devState.research || fbRes?.areas || fbRes || []),
    [devState.research, fbRes]
  );

  // tabs
  const [tab, setTab] = useState("projects");

  // snapshots
  const activeProjects = projects.filter(p => p.status === "active").length;
  const mfActive = queue.filter(q => q.status === "active").length;
  const totalCFD = projects.reduce((s,p)=> s + (p.cfd_hours||0), 0);
  const totalWT = projects.reduce((s,p)=> s + (p.wt_hours||0), 0);
  const spend = projects.reduce((s,p)=> s + (p.cost||0), 0);

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <h1 className="text-2xl md:text-3xl font-semibold">Development</h1>
        <div className="text-sm text-muted-foreground">
          {projects.length} projects • {parts.length} parts • {queue.length} batches • {research.length} research areas
        </div>
      </div>

      {/* Snapshot */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Stat title="Active Projects" value={activeProjects} />
        <Stat title="CFD used (h)" value={totalCFD} />
        <Stat title="Wind Tunnel (h)" value={totalWT} />
        <Stat title="Spend (est.)" value={fmtMoney(spend)} />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2">
        {[
          ["projects","Projects"],
          ["parts","Parts"],
          ["manufacturing","Manufacturing"],
          ["research","Research"],
        ].map(([k,l]) => (
          <Button key={k} variant={tab===k ? "default":"outline"} onClick={()=>setTab(k)}>{l}</Button>
        ))}
        <div className="flex-1" />
        <Button variant="outline" disabled>New project</Button>
      </div>

      {/* Content */}
      {tab === "projects" && <ProjectsTab projects={projects} />}
      {tab === "parts" && <PartsTab parts={parts} />}
      {tab === "manufacturing" && <ManufacturingTab queue={queue} parts={parts} />}
      {tab === "research" && <ResearchTab areas={research} />}
    </div>
  );
}

/* ------------- tabs ------------- */
function ProjectsTab({ projects }) {
  const [phase, setPhase] = useState("ALL"); // ALL|concept|design|testing|homologation
  const [status, setStatus] = useState("active"); // active|completed|paused|all
  const [q, setQ] = useState("");

  const filtered = useMemo(() => projects.filter(p => {
    if (status !== "all" && p.status !== status) return false;
    if (phase !== "ALL" && p.phase !== phase) return false;
    if (q) {
      const hay = `${p.name} ${p.type} ${p.phase}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  }), [projects, status, phase, q]);

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <select value={status} onChange={(e)=>setStatus(e.target.value)} className="border rounded px-2 py-1">
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
              <option value="all">All</option>
            </select>
            <select value={phase} onChange={(e)=>setPhase(e.target.value)} className="border rounded px-2 py-1">
              {["ALL","concept","design","testing","homologation"].map(p => <option key={p} value={p}>{p==="ALL"?"All phases":titleCase(p)}</option>)}
            </select>
            <input
              type="text"
              placeholder="Search project…"
              value={q}
              onChange={(e)=>setQ(e.target.value)}
              className="border rounded px-3 py-1.5 w-full md:flex-1"
            />
            <div className="flex-1" />
            <Button variant="outline" onClick={()=>{ setStatus("active"); setPhase("ALL"); setQ(""); }}>Clear</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.length === 0 ? (
          <Card><CardContent className="p-4 text-sm text-muted-foreground">No projects.</CardContent></Card>
        ) : filtered.map((p) => (
          <Card key={p.id}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm text-muted-foreground">{p.type} • {titleCase(p.phase)}</div>
                  <div className="text-lg font-medium">{p.name}</div>
                </div>
                <StatusPill status={p.status} />
              </div>

              <div>
                <div className="flex items-center justify-between text-sm">
                  <div>Progress</div>
                  <div className="font-medium">{Math.round(p.progress*100)}%</div>
                </div>
                <div className="mt-1"><Progress value={p.progress} /></div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <MiniStat label="CFD (h)" value={p.cfd_hours} />
                <MiniStat label="WT (h)" value={p.wt_hours} />
                <MiniStat label="Engineers" value={p.engineers} />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border p-2">
                  <div className="text-[11px] text-muted-foreground">Performance Δ</div>
                  <div className={`text-sm font-medium ${p.perf_delta>=0 ? "text-emerald-700":"text-rose-700"}`}>{p.perf_delta >= 0 ? `+${p.perf_delta}` : p.perf_delta}</div>
                </div>
                <div className="rounded-lg border p-2">
                  <div className="text-[11px] text-muted-foreground">Cost</div>
                  <div className="text-sm font-medium">{fmtMoney(p.cost)}</div>
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                {p.started_at ? `Started: ${p.started_at.toLocaleDateString("en-GB", { day:"2-digit", month:"short" })}` : "Started: —"}
                {" • "}
                {p.finishes_at ? `ETA: ${p.finishes_at.toLocaleDateString("en-GB", { day:"2-digit", month:"short" })} (${daysBetween(new Date(), p.finishes_at)}d)` : "ETA: —"}
              </div>

              <div className="flex items-center gap-2">
                <Button size="sm" disabled>Pause</Button>
                <Button size="sm" variant="outline" disabled>Allocate Hours</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

function PartsTab({ parts }) {
  const [slot, setSlot] = useState("ALL"); // ALL|Front Wing|Rear Wing|Sidepods|Underbody|Suspension|Brakes|Engine Cover...
  const [q, setQ] = useState("");
  const filtered = useMemo(() => parts.filter(p => {
    if (slot !== "ALL" && p.slot !== slot) return false;
    if (q) {
      const hay = `${p.name} ${p.slot} ${p.version}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  }), [parts, slot, q]);

  const slots = useMemo(() => {
    const set = new Set(["ALL"]);
    parts.forEach(p => p.slot && set.add(p.slot));
    return Array.from(set);
  }, [parts]);

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <select value={slot} onChange={(e)=>setSlot(e.target.value)} className="border rounded px-2 py-1">
              {slots.map(s => <option key={s} value={s}>{s==="ALL"?"All slots":s}</option>)}
            </select>
            <input
              type="text"
              placeholder="Search part…"
              value={q}
              onChange={(e)=>setQ(e.target.value)}
              className="border rounded px-3 py-1.5 w-full md:flex-1"
            />
            <div className="flex-1" />
            <Button variant="outline" onClick={()=>{ setSlot("ALL"); setQ(""); }}>Clear</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No parts.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/60">
                <tr className="text-left">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Slot</th>
                  <th className="px-3 py-2">Ver</th>
                  <th className="px-3 py-2 text-center">Car A</th>
                  <th className="px-3 py-2 text-center">Car B</th>
                  <th className="px-3 py-2 text-right">Condition</th>
                  <th className="px-3 py-2 text-right">Perf</th>
                  <th className="px-3 py-2 text-right">Inv</th>
                  <th className="px-3 py-2 text-right">In Mfg</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{p.name}</td>
                    <td className="px-3 py-2">{p.slot}</td>
                    <td className="px-3 py-2">{p.version}</td>
                    <td className="px-3 py-2 text-center">{p.carA ? "✓" : "—"}</td>
                    <td className="px-3 py-2 text-center">{p.carB ? "✓" : "—"}</td>
                    <td className="px-3 py-2 text-right">{Math.round(p.condition)}%</td>
                    <td className={`px-3 py-2 text-right ${p.perf>=0?"text-emerald-700":"text-rose-700"}`}>{p.perf>=0?`+${p.perf}`:p.perf}</td>
                    <td className="px-3 py-2 text-right">{p.inv}</td>
                    <td className="px-3 py-2 text-right">{p.in_manufacturing}</td>
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

function ManufacturingTab({ queue, parts }) {
  const partName = (id) => {
    const p = parts.find(x => (x.id === id || x.name === id || x.slot === id));
    return p ? `${p.slot} ${p.version} — ${p.name}` : id;
  };

  return (
    <Card>
      <CardContent className="p-0">
        {queue.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No batches in manufacturing.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/60">
              <tr className="text-left">
                <th className="px-3 py-2">Batch</th>
                <th className="px-3 py-2">Part</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Unit Cost</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2">ETA</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((q) => (
                <tr key={q.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{q.title}</td>
                  <td className="px-3 py-2">{partName(q.part_id)}</td>
                  <td className="px-3 py-2 text-right">{q.qty}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(q.unit_cost)}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(q.unit_cost * q.qty)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {q.started_at ? q.started_at.toLocaleDateString("en-GB", { day:"2-digit", month:"short" }) : "—"}
                    {" → "}
                    {q.finishes_at ? q.finishes_at.toLocaleDateString("en-GB", { day:"2-digit", month:"short" }) : "—"}
                  </td>
                  <td className="px-3 py-2"><StatusPill status={q.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function ResearchTab({ areas }) {
  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="text-sm text-muted-foreground">
            Research allocation is read-only for now. Sliders disabled — values pulled from data.
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {areas.length === 0 ? (
          <Card><CardContent className="p-4 text-sm text-muted-foreground">No research areas.</CardContent></Card>
        ) : areas.map((a) => (
          <Card key={a.id}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm text-muted-foreground">Area</div>
                  <div className="text-lg font-medium">{a.area}</div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-semibold">{a.points}</div>
                  <div className="text-[11px] text-muted-foreground">Points</div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-sm">
                  <div>Level</div>
                  <div className="font-medium">{a.level}</div>
                </div>
                <div className="mt-1"><Progress value={Math.min(1, a.level/10)} /></div>
              </div>

              <div className="rounded-lg border p-2">
                <div className="text-[11px] text-muted-foreground">Focus</div>
                <div className="flex items-center gap-2">
                  <input type="range" min={0} max={100} value={a.focus || 0} readOnly className="w-full" />
                  <div className="text-sm font-medium w-12 text-right">{a.focus || 0}%</div>
                </div>
              </div>

              {a.notes ? <div className="text-xs text-muted-foreground">{a.notes}</div> : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

/* ------------- small UI bits ------------- */
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
function StatusPill({ status }) {
  const map = {
    active: "bg-sky-600 text-white",
    paused: "bg-slate-600 text-white",
    completed: "bg-emerald-600 text-white",
  };
  return <span className={`inline-flex px-2 py-0.5 rounded text-[11px] ${map[status] || "bg-zinc-600 text-white"}`}>{titleCase(status)}</span>;
}
