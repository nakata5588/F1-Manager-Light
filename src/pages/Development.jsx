import React, { useEffect, useMemo, useState } from "react";
import { useGame } from "@/state/GameStore";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const DAY = 86_400_000;
const fmtMoney = (n) => new Intl.NumberFormat("en-GB", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
}).format(Number(n || 0));

function parseISO(value) {
  const [y,m,d] = String(value || "").slice(0,10).split("-").map(Number);
  return new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
}
function addDaysISO(value, days) {
  const d = parseISO(value);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0,10);
}
function progressBetween(start, finish, now) {
  if (!start || !finish || !now) return 0;
  const a = +parseISO(start), b = +parseISO(finish), n = +parseISO(now);
  if (b <= a) return 1;
  return Math.max(0, Math.min(1, (n - a) / (b - a)));
}
function nice(value) {
  return String(value || "").replace(/_/g," ").replace(/\b\w/g,(m)=>m.toUpperCase());
}
const PART_PROFILES = {
  chassis:       { multiplier:1.00, facility:"_chassis_shop_level", label:"Chassis Workshop" },
  aero_front:    { multiplier:0.88, facility:"aero", label:"Aero + Wind Tunnel" },
  aero_rear:     { multiplier:0.96, facility:"aero", label:"Aero + Wind Tunnel" },
  suspension:    { multiplier:0.72, facility:"_chassis_shop_level", label:"Chassis Workshop" },
  gearbox:       { multiplier:0.82, facility:"manufacturing_leve", label:"Manufacturing" },
  brakes:        { multiplier:0.58, facility:"_chassis_shop_level", label:"Chassis Workshop" },
  cooling:       { multiplier:0.66, facility:"manufacturing_leve", label:"Manufacturing" },
  turbocharger:  { multiplier:1.08, facility:"manufacturing_leve", label:"Manufacturing" },
};

function projectCost({ engineers, cfd, windTunnel, duration }, manufacturingLevel = 5) {
  const raw =
    60_000 +
    Number(engineers || 0) * 18_000 +
    Number(cfd || 0) * 650 +
    Number(windTunnel || 0) * 1_100 +
    Number(duration || 0) * 2_500;
  const efficiency = Math.max(0.78, 1.08 - Number(manufacturingLevel || 0) * 0.015);
  return Math.round(raw * efficiency);
}
function facilityFactor(type, levelOf) {
  const profile = PART_PROFILES[type] || PART_PROFILES.chassis;
  if (profile.facility === "aero") {
    const aero = Number(levelOf("aero_dept_level") || 0);
    const wind = Number(levelOf("wind_tunnel_level") || 0);
    return 0.75 + (aero + wind) / 40;
  }
  return 0.80 + Number(levelOf(profile.facility) || 0) / 25;
}
function perfDelta(draft, levelOf, existingParts = []) {
  const profile = PART_PROFILES[draft.type] || PART_PROFILES.chassis;
  const engineers = Math.max(1, Number(draft.engineers || 0));
  const cfd = Math.max(0, Number(draft.cfd || 0));
  const wt = Math.max(0, Number(draft.windTunnel || 0));
  const duration = Math.max(7, Number(draft.duration || 0));

  const resourceScore =
    0.08 +
    engineers * 0.035 +
    Math.sqrt(cfd) * 0.008 +
    Math.sqrt(wt) * 0.014 +
    Math.min(60, duration) * 0.003;

  const bestExisting = Math.max(
    0,
    ...existingParts
      .filter((p) => String(p.slot) === String(draft.type))
      .map((p) => Number(p.perf || 0))
      .filter(Number.isFinite)
  );
  const diminishingReturns = 1 / (1 + bestExisting * 0.18);
  return Number((resourceScore * profile.multiplier * facilityFactor(draft.type, levelOf) * diminishingReturns).toFixed(2));
}
function effectiveProjectDays(draft, levelOf) {
  const profile = PART_PROFILES[draft.type] || PART_PROFILES.chassis;
  const relevant = profile.facility === "aero"
    ? (Number(levelOf("aero_dept_level") || 0) + Number(levelOf("wind_tunnel_level") || 0)) / 2
    : Number(levelOf(profile.facility) || 0);
  return Math.max(7, Math.round(Number(draft.duration || 21) * Math.max(0.82, 1.12 - relevant * 0.025)));
}

export default function Development() {
  const gameState = useGame((s) => s.gameState);
  const setGameState = useGame((s) => s.setGameState);
  const currentDateISO = String(gameState?.currentDateISO || "").slice(0,10);
  const activeYear = Number(gameState?.activeYear) || Number(currentDateISO.slice(0,4)) || 1980;
  const dev = gameState?.development || {};
  const projects = Array.isArray(dev.projects) ? dev.projects : [];
  const parts = Array.isArray(dev.parts) ? dev.parts : [];
  const manufacturing = Array.isArray(dev.manufacturing) ? dev.manufacturing : [];

  const teamId = String(gameState?.team?.team_id ?? gameState?.team?.id ?? "");
  const baseFacility = (gameState?.facilities || []).find(
    (row) => String(row?.team_id ?? row?.team ?? "") === teamId && Number(row?.year ?? activeYear) === activeYear
  ) || null;
  const hqLevels = gameState?.hq?.facilityLevels || {};
  const levelOf = (key) => Number(hqLevels[key] ?? baseFacility?.[key] ?? 5);
  const research = Array.isArray(dev.research) && dev.research.length
    ? dev.research
    : [
        { id:"aero", area:"Aerodynamics", focus:25, points:0 },
        { id:"chassis", area:"Chassis", focus:25, points:0 },
        { id:"reliability", area:"Reliability", focus:25, points:0 },
        { id:"powertrain", area:"Powertrain Integration", focus:25, points:0 },
      ];

  const [catalog, setCatalog] = useState([]);
  const [tab, setTab] = useState("projects");
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({
    name:"", type:"chassis", engineers:3, duration:21, cfd:20, windTunnel:10,
  });

  useEffect(() => {
    fetch("/data/car_parts.json")
      .then((r) => r.ok ? r.json() : [])
      .then((rows) => setCatalog(Array.isArray(rows) ? rows : []))
      .catch(() => setCatalog([]));
  }, []);

  const eraTypes = useMemo(() => {
    const rows = catalog.filter((p) => {
      const from = Number(p?.era_start_year ?? -Infinity);
      const toRaw = p?.era_end_year;
      const to = toRaw == null || toRaw === "" ? Infinity : Number(toRaw);
      return activeYear >= from && activeYear <= to;
    });
    const vals = rows.map((p) => String(p?.part_type || "")).filter(Boolean);
    return vals.length ? Array.from(new Set(vals)) : ["chassis","aero_front","aero_rear","suspension","gearbox","brakes"];
  }, [catalog, activeYear]);

  useEffect(() => {
    if (!eraTypes.includes(draft.type) && eraTypes.length) {
      setDraft((d) => ({...d, type:eraTypes[0]}));
    }
  }, [eraTypes, draft.type]);

  // Complete projects/manufacturing when the in-game date reaches their ETA.
  useEffect(() => {
    if (!currentDateISO) return;
    let changed = false;
    let nextParts = [...parts];

    const nextProjects = projects.map((p) => {
      if (p.status !== "active" || !p.finishes_at || p.finishes_at > currentDateISO) return p;
      changed = true;
      const partId = `part_${p.id}`;
      if (!nextParts.some((x) => x.id === partId)) {
        nextParts.push({
          id:partId,
          name:p.name,
          slot:p.type,
          version:`P${nextParts.filter((x)=>x.slot===p.type).length + 1}`,
          perf:Number(p.perf_delta || 0),
          condition:100,
          inv:1,
          in_manufacturing:0,
          created_from:p.id,
        });
      }
      return {...p, status:"completed", progress:1, completed_at:currentDateISO};
    });

    const nextManufacturing = manufacturing.map((job) => {
      if (job.status !== "active" || !job.finishes_at || job.finishes_at > currentDateISO) return job;
      changed = true;
      nextParts = nextParts.map((part) =>
        part.id === job.part_id
          ? {...part, inv:Number(part.inv || 0) + Number(job.qty || 1), in_manufacturing:Math.max(0, Number(part.in_manufacturing || 0) - Number(job.qty || 1))}
          : part
      );
      return {...job, status:"completed", completed_at:currentDateISO};
    });

    if (changed) {
      setGameState({
        development:{...dev, projects:nextProjects, parts:nextParts, manufacturing:nextManufacturing, research},
      });
    }
  }, [currentDateISO, projects, parts, manufacturing, research, dev, setGameState]);

  const budget = Number(gameState?.team?.budget ?? gameState?.finances?.balance ?? 0);
  const effectiveDays = effectiveProjectDays(draft, levelOf);
  const cost = projectCost({...draft, duration:effectiveDays}, levelOf("manufacturing_leve"));
  const expectedPerf = perfDelta(draft, levelOf, parts);
  const relevantFacility = PART_PROFILES[draft.type]?.label || "Technical facilities";

  const createProject = () => {
    if (!draft.name.trim() || !currentDateISO || budget < cost) return;
    const id = `dev_${Date.now()}`;
    const project = {
      id,
      name:draft.name.trim(),
      type:draft.type,
      phase:"design",
      status:"active",
      started_at:currentDateISO,
      finishes_at:addDaysISO(currentDateISO, effectiveDays),
      duration_days:effectiveDays,
      engineers:Number(draft.engineers),
      cfd_hours:Number(draft.cfd),
      wt_hours:Number(draft.windTunnel),
      cost,
      perf_delta:expectedPerf,
      risk:Math.max(0.05, 0.22 - Number(draft.engineers) * 0.02),
    };

    applyExpense(cost, `Development — ${project.name}`);
    setGameState({
      development:{...dev, projects:[...projects, project], parts, manufacturing, research},
    });
    setShowCreate(false);
    setDraft((d)=>({...d,name:""}));
  };

  const patchProject = (id, patch) => {
    setGameState({
      development:{
        ...dev,
        projects:projects.map((p)=>p.id===id?{...p,...patch}:p),
        parts, manufacturing, research,
      },
    });
  };

  const addHours = (project, field) => {
    const unitCost = field === "cfd_hours" ? 3_250 : 5_500;
    if (budget < unitCost) return;
    applyExpense(unitCost, `Development allocation — ${project.name}`);
    patchProject(project.id, {[field]:Number(project[field] || 0) + 5});
  };

  const manufacture = (part) => {
    const qty = 1;
    const manufacturingLevel = levelOf("manufacturing_leve");
    const rawUnitCost = Math.max(25_000, Math.round(80_000 + Math.abs(Number(part.perf || 0)) * 40_000));
    const unitCost = Math.round(rawUnitCost * Math.max(0.72, 1.12 - manufacturingLevel * 0.025));
    const buildDays = Math.max(3, Math.round(10 - manufacturingLevel * 0.6));
    if (budget < unitCost || !currentDateISO) return;
    applyExpense(unitCost, `Manufacturing — ${part.name}`);
    const job = {
      id:`mfg_${Date.now()}`,
      part_id:part.id,
      title:`${part.name} batch`,
      qty,
      unit_cost:unitCost,
      started_at:currentDateISO,
      finishes_at:addDaysISO(currentDateISO, buildDays),
      status:"active",
    };
    setGameState({
      development:{
        ...dev,
        projects,
        parts:parts.map((p)=>p.id===part.id?{...p,in_manufacturing:Number(p.in_manufacturing||0)+qty}:p),
        manufacturing:[...manufacturing,job],
        research,
      },
    });
  };

  const updateResearch = (id, focus) => {
    const next = research.map((r)=>r.id===id?{...r,focus:Number(focus)}:r);
    setGameState({development:{...dev,projects,parts,manufacturing,research:next}});
  };

  function applyExpense(amount, desc) {
    const value = Math.abs(Number(amount || 0));
    const oldBudget = Number(gameState?.team?.budget ?? gameState?.finances?.balance ?? 0);
    const nextBudget = oldBudget - value;
    const tx = {
      id:`tx_dev_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      dateISO:currentDateISO,
      type:"expense",
      category:"Development",
      desc,
      amount:-value,
    };
    setGameState({
      team:{...(gameState?.team||{}),budget:nextBudget},
      finances:{
        ...(gameState?.finances||{}),
        budget:nextBudget,
        balance:Number(gameState?.finances?.balance ?? oldBudget)-value,
        season_spend:Number(gameState?.finances?.season_spend||0)+value,
      },
      financeLog:[...(gameState?.financeLog||[]),tx],
    });
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold">Development</h1>
          <p className="text-sm text-muted-foreground">Design, test and manufacture era-appropriate car parts.</p>
        </div>
        <div className="flex-1" />
        <div className="text-sm">Available budget: <strong>{fmtMoney(budget)}</strong></div>
        <Button onClick={()=>setShowCreate((v)=>!v)}>{showCreate ? "Close" : "New Project"}</Button>
      </div>

      {showCreate && (
        <Card><CardContent className="p-4 grid gap-3">
          <div className="font-semibold">Create development project</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-sm">Project name<input className="mt-1 border rounded px-3 py-2 w-full" value={draft.name} onChange={(e)=>setDraft({...draft,name:e.target.value})} placeholder="e.g. Revised rear wing"/></label>
            <label className="text-sm">Part type<select className="mt-1 border rounded px-3 py-2 w-full" value={draft.type} onChange={(e)=>setDraft({...draft,type:e.target.value})}>{eraTypes.map((t)=><option key={t} value={t}>{nice(t)}</option>)}</select></label>
            <label className="text-sm">Engineers<input type="number" min="1" max="12" className="mt-1 border rounded px-3 py-2 w-full" value={draft.engineers} onChange={(e)=>setDraft({...draft,engineers:Number(e.target.value)})}/></label>
            <label className="text-sm">Duration (days)<input type="number" min="7" max="90" className="mt-1 border rounded px-3 py-2 w-full" value={draft.duration} onChange={(e)=>setDraft({...draft,duration:Number(e.target.value)})}/></label>
            <label className="text-sm">CFD hours<input type="number" min="0" max="200" className="mt-1 border rounded px-3 py-2 w-full" value={draft.cfd} onChange={(e)=>setDraft({...draft,cfd:Number(e.target.value)})}/></label>
            <label className="text-sm">Wind tunnel hours<input type="number" min="0" max="100" className="mt-1 border rounded px-3 py-2 w-full" value={draft.windTunnel} onChange={(e)=>setDraft({...draft,windTunnel:Number(e.target.value)})}/></label>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span>Cost: <strong>{fmtMoney(cost)}</strong></span>
            <span>Expected performance Δ: <strong>+{expectedPerf}</strong></span>
            <span>Primary facility: <strong>{relevantFacility}</strong></span>
            <span>Effective duration: <strong>{effectiveDays} days</strong></span>
            <span>ETA: <strong>{currentDateISO ? addDaysISO(currentDateISO,effectiveDays) : "—"}</strong></span>
            <Button onClick={createProject} disabled={!draft.name.trim() || budget < cost}>Start Project</Button>
          </div>
          {budget < cost && <div className="text-sm text-red-600">Insufficient budget for this project.</div>}
        </CardContent></Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Active Projects" value={projects.filter((p)=>p.status==="active").length}/>
        <Stat label="Completed Projects" value={projects.filter((p)=>p.status==="completed").length}/>
        <Stat label="Designed Parts" value={parts.length}/>
        <Stat label="Manufacturing" value={manufacturing.filter((m)=>m.status==="active").length}/>
      </div>

      <div className="flex flex-wrap gap-2">
        {["projects","parts","manufacturing","research"].map((key)=><Button key={key} variant={tab===key?"default":"outline"} onClick={()=>setTab(key)}>{nice(key)}</Button>)}
      </div>

      {tab==="projects" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {projects.map((p)=>{
            const progress = p.status==="completed" ? 1 : p.status==="paused" ? Number(p.progress||0) : progressBetween(p.started_at,p.finishes_at,currentDateISO);
            return <Card key={p.id}><CardContent className="p-4 space-y-3">
              <div className="flex justify-between gap-2"><div><div className="text-xs text-muted-foreground">{nice(p.type)} · {nice(p.phase)}</div><div className="font-semibold">{p.name}</div></div><span className="text-xs rounded bg-gray-100 px-2 py-1 h-fit">{nice(p.status)}</span></div>
              <div><div className="flex justify-between text-sm"><span>Progress</span><strong>{Math.round(progress*100)}%</strong></div><div className="h-2 mt-1 bg-gray-100 rounded overflow-hidden"><div className="h-full bg-slate-800" style={{width:`${progress*100}%`}}/></div></div>
              <div className="grid grid-cols-3 gap-2 text-sm"><Mini label="Engineers" value={p.engineers}/><Mini label="CFD" value={`${p.cfd_hours||0}h`}/><Mini label="WT" value={`${p.wt_hours||0}h`}/></div>
              <div className="text-xs text-muted-foreground">{p.started_at} → {p.finishes_at} · {fmtMoney(p.cost)} · Δ +{p.perf_delta}</div>
              {p.status!=="completed" && <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={()=>patchProject(p.id,{status:p.status==="paused"?"active":"paused",progress})}>{p.status==="paused"?"Resume":"Pause"}</Button>
                <Button size="sm" variant="outline" onClick={()=>addHours(p,"cfd_hours")}>+5 CFD</Button>
                <Button size="sm" variant="outline" onClick={()=>addHours(p,"wt_hours")}>+5 WT</Button>
              </div>}
            </CardContent></Card>;
          })}
          {!projects.length && <Card><CardContent className="p-5 text-sm text-muted-foreground">No development projects yet. Start one with “New Project”.</CardContent></Card>}
        </div>
      )}

      {tab==="parts" && (
        <Card><CardContent className="p-0 overflow-x-auto"><table className="min-w-full text-sm">
          <thead className="bg-gray-50"><tr><th className="px-3 py-2 text-left">Part</th><th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-left">Version</th><th className="px-3 py-2 text-right">Performance</th><th className="px-3 py-2 text-right">Inventory</th><th className="px-3 py-2 text-right">Action</th></tr></thead>
          <tbody>{parts.map((p)=><tr key={p.id} className="border-t"><td className="px-3 py-2 font-medium">{p.name}</td><td className="px-3 py-2">{nice(p.slot)}</td><td className="px-3 py-2">{p.version||"—"}</td><td className="px-3 py-2 text-right">+{Number(p.perf||0).toFixed(2)}</td><td className="px-3 py-2 text-right">{Number(p.inv||0)}{p.in_manufacturing? ` (+${p.in_manufacturing} building)`:""}</td><td className="px-3 py-2 text-right"><Button size="sm" onClick={()=>manufacture(p)}>Manufacture +1</Button></td></tr>)}
          {!parts.length&&<tr><td colSpan={6} className="px-3 py-5 text-center text-muted-foreground">Complete a development project to create your first part.</td></tr>}</tbody>
        </table></CardContent></Card>
      )}

      {tab==="manufacturing" && (
        <Card><CardContent className="p-0 overflow-x-auto"><table className="min-w-full text-sm">
          <thead className="bg-gray-50"><tr><th className="px-3 py-2 text-left">Batch</th><th className="px-3 py-2 text-left">Started</th><th className="px-3 py-2 text-left">ETA</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Cost</th><th className="px-3 py-2 text-left">Status</th></tr></thead>
          <tbody>{manufacturing.map((m)=><tr key={m.id} className="border-t"><td className="px-3 py-2 font-medium">{m.title}</td><td className="px-3 py-2">{m.started_at}</td><td className="px-3 py-2">{m.finishes_at}</td><td className="px-3 py-2 text-right">{m.qty}</td><td className="px-3 py-2 text-right">{fmtMoney(Number(m.unit_cost||0)*Number(m.qty||1))}</td><td className="px-3 py-2">{nice(m.status)}</td></tr>)}
          {!manufacturing.length&&<tr><td colSpan={6} className="px-3 py-5 text-center text-muted-foreground">No manufacturing batches.</td></tr>}</tbody>
        </table></CardContent></Card>
      )}

      {tab==="research" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {research.map((r)=><Card key={r.id}><CardContent className="p-4">
            <div className="flex justify-between"><div className="font-semibold">{r.area}</div><div className="text-sm">{r.focus||0}% focus</div></div>
            <input className="w-full mt-3" type="range" min="0" max="100" value={r.focus||0} onChange={(e)=>updateResearch(r.id,e.target.value)}/>
            <div className="text-xs text-muted-foreground mt-2">Research points: {r.points||0}</div>
          </CardContent></Card>)}
        </div>
      )}
    </div>
  );
}

function Stat({label,value}){return <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">{label}</div><div className="text-xl font-semibold">{value}</div></CardContent></Card>;}
function Mini({label,value}){return <div className="border rounded p-2"><div className="text-[10px] text-muted-foreground">{label}</div><div className="font-medium">{value}</div></div>;}
