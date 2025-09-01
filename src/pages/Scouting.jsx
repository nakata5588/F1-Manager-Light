// src/pages/Scouting.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGame } from "@/state/GameStore";

/* ---------------- utils ---------------- */
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
const titleCase = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : "");
const fmtDate = (d) => d ? d.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"2-digit" }) : "—";
const toDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(v);
};
const daysToMs = (d) => (Number(d) || 0) * 24 * 60 * 60 * 1000;
const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));

/* ------------- normalization -------------- */
function normalizeAssignments(raw) {
  // aceita: raw.assignments || raw.tasks || array direto
  const arr = Array.isArray(raw?.assignments) ? raw.assignments
    : Array.isArray(raw?.tasks) ? raw.tasks
    : Array.isArray(raw) ? raw
    : Array.isArray(raw?.items) ? raw.items
    : [];
  return arr.map((a, i) => {
    const id = a.id ?? `A_${i + 1}`;
    const scout_id = a.scout_id ?? a.staff_id ?? a.scout ?? null;
    const prospect_id = a.prospect_id ?? a.driver_id ?? a.target_id ?? null;
    const started_at = toDate(a.started_at ?? a.start ?? a.date_start ?? null);
    const duration_days = Number(a.duration_days ?? a.days ?? 14);
    const finishes_at = toDate(a.finishes_at ?? a.finish ?? a.date_end ?? (started_at ? new Date(started_at.getTime() + daysToMs(duration_days)) : null));
    const status = (a.status ?? (finishes_at && finishes_at < new Date() ? "completed" : "active")).toLowerCase(); // active|paused|completed|failed
    const progress = a.progress != null ? clamp01(a.progress) : estimateProgress(started_at, finishes_at);
    return {
      id,
      title: a.title ?? a.name ?? "Assignment",
      region: a.region ?? a.area ?? a.country ?? "Global",
      role: (a.role ?? a.type ?? "Scouting").toString(),
      status,
      priority: Number(a.priority ?? 2),
      started_at,
      finishes_at,
      duration_days,
      progress,
      scout_id,
      prospect_id,
      meta: a
    };
  }).sort((a,b)=> (a.status===b.status ? (a.priority-b.priority) : (a.status==="active"?-1:1)));
}
function estimateProgress(start, end) {
  if (!start || !end) return 0;
  const now = new Date();
  const total = end - start;
  const done = now - start;
  if (total <= 0) return 1;
  return clamp01(done / total);
}

function normalizeScouts(raw) {
  const arr = Array.isArray(raw?.scouts) ? raw.scouts
    : Array.isArray(raw) ? raw
    : Array.isArray(raw?.items) ? raw.items
    : [];
  return arr.map((s, i) => {
    const id = s.staff_id ?? s.id ?? `SC_${i + 1}`;
    const skills = s.skills || s.attributes || {};
    const rating =
      Number(s.rating ?? s.overall) ||
      (typeof skills === "object" ? Math.round(Object.values(skills).reduce((a,b)=>a+Number(b||0),0)/Math.max(1,Object.keys(skills).length)) : 0);
    return {
      staff_id: id,
      display_name: s.display_name ?? s.name ?? "Scout",
      role: s.role ?? "Scout",
      region: s.region ?? s.country ?? "Global",
      rating,
      portrait_path: s.portrait_path ?? `/portraits/staff/${normId(id)}.png`,
      meta: s
    };
  });
}

function normalizeProspects(raw) {
  const arr = Array.isArray(raw?.prospects) ? raw.prospects
    : Array.isArray(raw) ? raw
    : Array.isArray(raw?.items) ? raw.items
    : [];
  return arr.map((p, i) => {
    const id = p.driver_id ?? p.id ?? `P_${i + 1}`;
    const rating = Number(p.rating ?? p.potential ?? 0);
    return {
      driver_id: id,
      display_name: p.display_name ?? p.name ?? "Driver",
      age: Number(p.age ?? 0) || null,
      nationality: p.country_name ?? p.nationality ?? "",
      team: p.team_name ?? p.team ?? "",
      rating,
      portrait_path: p.portrait_path ?? `/portraits/drivers/${normId(id)}.png`,
      notes: p.notes ?? "",
      meta: p
    };
  });
}

/* ---------------- component ---------------- */
export default function Scouting() {
  const { gameState } = useGame();

  const [fallbackScouting, setFallbackScouting] = useState(null);
  const [fallbackScouts, setFallbackScouts] = useState(null);
  const [fallbackProspects, setFallbackProspects] = useState(null);

  useEffect(() => {
    (async () => {
      const [sc, scs, pr] = await Promise.all([
        tryFetchJSON(["/data/scouting.json"]),
        tryFetchJSON(["/data/scouts.json", "/data/staff_scouts.json"]),
        tryFetchJSON(["/data/prospects.json", "/data/driver_prospects.json"]),
      ]);
      setFallbackScouting(sc);
      setFallbackScouts(scs);
      setFallbackProspects(pr);
    })();
  }, []);

  // sources
  const rawScouting = gameState?.scouting || fallbackScouting || {};
  const assignments = useMemo(
    () => normalizeAssignments(rawScouting.assignments || rawScouting.tasks || rawScouting),
    [rawScouting]
  );
  const scouts = useMemo(
    () => normalizeScouts(gameState?.scouting?.scouts || fallbackScouts || []),
    [gameState?.scouting, fallbackScouts]
  );
  const prospects = useMemo(
    () => normalizeProspects(gameState?.scouting?.prospects || fallbackProspects || []),
    [gameState?.scouting, fallbackProspects]
  );

  // tabs
  const [tab, setTab] = useState("assignments");

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <h1 className="text-2xl md:text-3xl font-semibold">Scouting</h1>
        <div className="text-sm text-muted-foreground">
          {assignments.length} assignments • {scouts.length} scouts • {prospects.length} prospects
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2">
        {[
          ["assignments","Assignments"],
          ["prospects","Prospects"],
          ["scouts","Scouts"],
        ].map(([k,label]) => (
          <Button key={k} variant={tab===k ? "default":"outline"} onClick={()=>setTab(k)}>{label}</Button>
        ))}
        <div className="flex-1" />
        <Button disabled variant="outline">Start assignment</Button>
      </div>

      {tab === "assignments" && <AssignmentsTab assignments={assignments} scouts={scouts} prospects={prospects} />}
      {tab === "prospects" && <ProspectsTab prospects={prospects} />}
      {tab === "scouts" && <ScoutsTab scouts={scouts} />}
    </div>
  );
}

/* ---------------- tabs content --------------- */
function AssignmentsTab({ assignments, scouts, prospects }) {
  const [status, setStatus] = useState("active"); // active|completed|paused|failed|all
  const [region, setRegion] = useState("ALL");
  const [q, setQ] = useState("");

  const REGIONS = useMemo(() => {
    const set = new Set(["ALL"]);
    assignments.forEach(a => a.region && set.add(a.region));
    return Array.from(set);
  }, [assignments]);

  const filtered = useMemo(() => {
    return assignments.filter(a => {
      if (status !== "all" && a.status !== status) return false;
      if (region !== "ALL" && a.region !== region) return false;
      if (q) {
        const hay = `${a.title} ${a.region} ${a.role}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [assignments, status, region, q]);

  const findScout = (id) => id ? scouts.find(s => normId(s.staff_id) === normId(id)) : null;
  const findProspect = (id) => id ? prospects.find(p => normId(p.driver_id) === normId(id)) : null;

  return (
    <>
      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <select value={status} onChange={(e)=>setStatus(e.target.value)} className="border rounded px-2 py-1">
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="all">All</option>
            </select>
            <select value={region} onChange={(e)=>setRegion(e.target.value)} className="border rounded px-2 py-1">
              {REGIONS.map(r => <option key={r} value={r}>{r==="ALL" ? "All regions" : r}</option>)}
            </select>
            <input
              type="text"
              placeholder="Search title/role/region…"
              value={q}
              onChange={(e)=>setQ(e.target.value)}
              className="border rounded px-3 py-1.5 w-full md:flex-1"
            />
            <div className="flex-1" />
            <Button variant="outline" onClick={()=>{ setStatus("active"); setRegion("ALL"); setQ(""); }}>
              Clear filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* List */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.length === 0 ? (
          <Card><CardContent className="p-4 text-sm text-muted-foreground">No assignments.</CardContent></Card>
        ) : filtered.map((a) => {
          const scout = findScout(a.scout_id);
          const prospect = findProspect(a.prospect_id);
          return (
            <Card key={a.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm text-muted-foreground">{a.role} • {a.region}</div>
                    <div className="text-lg font-medium">{a.title}</div>
                  </div>
                  <StatusPill status={a.status} />
                </div>

                <div>
                  <div className="flex items-center justify-between text-sm">
                    <div>Progress</div>
                    <div className="font-medium">{Math.round(a.progress*100)}%</div>
                  </div>
                  <div className="mt-1"><Progress value={a.progress} /></div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <MiniPerson label="Scout" name={scout?.display_name} img={scout?.portrait_path} fallback={scout ? null : "—"} />
                  <MiniPerson label="Prospect" name={prospect?.display_name} img={prospect?.portrait_path} fallback={prospect ? null : "—"} />
                </div>

                <div className="text-xs text-muted-foreground">
                  {a.started_at ? `Started: ${fmtDate(a.started_at)}` : "Started: —"}
                  {" • "}
                  {a.finishes_at ? `ETA: ${fmtDate(a.finishes_at)}` : "ETA: —"}
                </div>

                <div className="flex items-center gap-2">
                  <Button size="sm" disabled>Pause</Button>
                  <Button size="sm" variant="outline" disabled>Cancel</Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}

function ProspectsTab({ prospects }) {
  const [q, setQ] = useState("");
  const [minRating, setMinRating] = useState(0);

  const filtered = useMemo(() => {
    return prospects.filter(p => {
      if (minRating && (p.rating || 0) < minRating) return false;
      if (q) {
        const hay = `${p.display_name} ${p.nationality} ${p.team}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [prospects, q, minRating]);

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-sm">Min rating</label>
              <input type="number" min={0} max={100} value={minRating} onChange={(e)=>setMinRating(Number(e.target.value))} className="border rounded px-2 py-1 w-20" />
            </div>
            <input
              type="text"
              placeholder="Search prospect…"
              value={q}
              onChange={(e)=>setQ(e.target.value)}
              className="border rounded px-3 py-1.5 w-full md:flex-1"
            />
            <div className="flex-1" />
            <Button variant="outline" onClick={()=>{ setQ(""); setMinRating(0); }}>Clear</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.length === 0 ? (
          <Card><CardContent className="p-4 text-sm text-muted-foreground">No prospects.</CardContent></Card>
        ) : filtered.map((p) => (
          <Card key={p.driver_id}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Avatar src={p.portrait_path} name={p.display_name} />
                <div className="flex-1">
                  <div className="font-medium leading-tight">{p.display_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.nationality || "—"} {p.age ? `• ${p.age}y` : ""} {p.team ? `• ${p.team}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-semibold">{p.rating || "—"}</div>
                  <div className="text-[11px] text-muted-foreground">Rating</div>
                </div>
              </div>
              {p.notes ? <div className="text-xs text-muted-foreground">{p.notes}</div> : null}
              <div className="flex items-center gap-2">
                <Button size="sm" disabled>Request Report</Button>
                <Button size="sm" variant="outline" disabled>Add to Shortlist</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

function ScoutsTab({ scouts }) {
  const [region, setRegion] = useState("ALL");
  const [q, setQ] = useState("");
  const REGIONS = useMemo(() => {
    const set = new Set(["ALL"]);
    scouts.forEach(s => s.region && set.add(s.region));
    return Array.from(set);
  }, [scouts]);

  const filtered = useMemo(() => {
    return scouts.filter(s => {
      if (region !== "ALL" && s.region !== region) return false;
      if (q) {
        const hay = `${s.display_name} ${s.region}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [scouts, region, q]);

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <select value={region} onChange={(e)=>setRegion(e.target.value)} className="border rounded px-2 py-1">
              {REGIONS.map(r => <option key={r} value={r}>{r==="ALL" ? "All regions" : r}</option>)}
            </select>
            <input
              type="text"
              placeholder="Search scout…"
              value={q}
              onChange={(e)=>setQ(e.target.value)}
              className="border rounded px-3 py-1.5 w-full md:flex-1"
            />
            <div className="flex-1" />
            <Button variant="outline" onClick={()=>{ setRegion("ALL"); setQ(""); }}>Clear</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.length === 0 ? (
          <Card><CardContent className="p-4 text-sm text-muted-foreground">No scouts.</CardContent></Card>
        ) : filtered.map((s) => (
          <Card key={s.staff_id}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Avatar src={s.portrait_path} name={s.display_name} />
                <div className="flex-1">
                  <div className="font-medium leading-tight">{s.display_name}</div>
                  <div className="text-xs text-muted-foreground">{s.region || "Global"}</div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-semibold">{s.rating || "—"}</div>
                  <div className="text-[11px] text-muted-foreground">Rating</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" disabled>Assign</Button>
                <Button size="sm" variant="outline" disabled>Details</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

/* ---------------- small UI bits ---------------- */
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
    failed: "bg-rose-600 text-white",
  };
  return <span className={`inline-flex px-2 py-0.5 rounded text-[11px] ${map[status] || "bg-zinc-600 text-white"}`}>{titleCase(status)}</span>;
}

function MiniPerson({ label, name, img, fallback = "—" }) {
  return (
    <div className="rounded-lg border p-2 flex items-center gap-2">
      <Avatar src={img} name={name} />
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className="text-sm font-medium truncate">{name || fallback}</div>
      </div>
    </div>
  );
}
