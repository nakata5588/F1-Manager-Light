import React, { useEffect, useMemo, useState } from "react";
import { useGame } from "@/state/GameStore";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { testDriverDevelopmentProfile } from "@/domain/developmentTesting";
import { teamEngineeringSupport } from "@/engine/PracticeSetupEngine.js";
import { pitCrewEffectiveProfile } from "@/engine/RaceStrategyEngine.js";
import { TeamLogo } from "@/components/entity/EntityVisuals.jsx";
import { availableCarComponentSlots, componentLabel } from "@/domain/carComponents.js";
import { createManufacturedPartUnits, normalizePhysicalPartState, partUnitsForDesign, warehousePartUnitsForDesign } from "@/domain/partUnits.js";
import { activeWorkshopJobs, partManufactureQuote, partUnitRestoreQuote, queueWorkshopJob } from "@/domain/componentService.js";
import { derivePartTechnicalProfile } from "@/domain/carPartPerformance.js";
import {
  bestDevelopedPartForSlot,
  buildDevelopmentProjection,
  developmentObjectivesForSlot,
  developmentStrengthTarget,
  objectiveProjectModifiers,
  realizeDevelopmentProjection,
  technicalDevelopmentCapacity,
} from "@/domain/developmentProject.js";
import { teamOperationalMorale, teamWorkRateLabel, teamWorkRateMultiplier } from "@/domain/teamMorale.js";
import {
  discoverableCarTechnologies,
  startTechnologyAdoption,
  technologyAdoptionQuote,
  technologyProjectsForTeam,
} from "@/domain/technologyAdoption.js";

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
  sidepods:      { multiplier:0.94, facility:"aero", label:"Aero + Wind Tunnel" },
  underfloor:    { multiplier:1.10, facility:"aero", label:"Aero + Wind Tunnel" },
  suspension:    { multiplier:0.72, facility:"_chassis_shop_level", label:"Chassis Workshop" },
  gearbox:       { multiplier:0.82, facility:"manufacturing_leve", label:"Manufacturing" },
  brakes:        { multiplier:0.58, facility:"_chassis_shop_level", label:"Chassis Workshop" },
  cooling:       { multiplier:0.66, facility:"manufacturing_leve", label:"Manufacturing" },
  turbocharger:  { multiplier:1.08, facility:"manufacturing_leve", label:"Manufacturing" },
  electronics:    { multiplier:0.78, facility:"manufacturing_leve", label:"Manufacturing" },
  kers:           { multiplier:1.02, facility:"manufacturing_leve", label:"Manufacturing" },
  ers_mgu_k:      { multiplier:1.06, facility:"manufacturing_leve", label:"Manufacturing" },
  ers_mgu_h:      { multiplier:1.08, facility:"manufacturing_leve", label:"Manufacturing" },
  battery_pack:   { multiplier:0.94, facility:"manufacturing_leve", label:"Manufacturing" },
  fuel_system:    { multiplier:0.70, facility:"manufacturing_leve", label:"Manufacturing" },
  exhaust_system: { multiplier:0.68, facility:"manufacturing_leve", label:"Manufacturing" },
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
function effectiveProjectDays(draft, levelOf, moraleFactor=1) {
  const profile = PART_PROFILES[draft.type] || PART_PROFILES.chassis;
  const relevant = profile.facility === "aero"
    ? (Number(levelOf("aero_dept_level") || 0) + Number(levelOf("wind_tunnel_level") || 0)) / 2
    : Number(levelOf(profile.facility) || 0);
  return Math.max(7, Math.round(Number(draft.duration || 21) * Math.max(0.82, 1.12 - relevant * 0.025) * Number(moraleFactor||1)));
}

export default function Development({ embedded = false, initialTab = "projects", onTabChange = null }) {
  const gameState = useGame((s) => s.gameState);
  const setGameState = useGame((s) => s.setGameState);
  const currentDateISO = String(gameState?.currentDateISO || "").slice(0,10);
  const activeYear = Number(gameState?.activeYear) || Number(currentDateISO.slice(0,4)) || 1980;
  const physicalState = useMemo(() => normalizePhysicalPartState(gameState), [gameState]);
  const dev = physicalState?.development || {};
  const projects = Array.isArray(dev.projects) ? dev.projects : [];
  const parts = Array.isArray(dev.parts) ? dev.parts : [];
  const partUnits = Array.isArray(dev.partUnits) ? dev.partUnits : [];
  const manufacturing = Array.isArray(dev.manufacturing) ? dev.manufacturing : [];
  const workshop = activeWorkshopJobs(physicalState);

  const teamId = String(gameState?.team?.team_id ?? gameState?.team?.id ?? "");
  const technologyOpportunities = useMemo(
    () => discoverableCarTechnologies(gameState, teamId),
    [gameState, teamId, activeYear]
  );
  const technologyProjects = technologyProjectsForTeam(gameState, teamId);
  const baseFacility = (gameState?.facilities || []).find(
    (row) => String(row?.team_id ?? row?.team ?? "") === teamId && Number(row?.year ?? activeYear) === activeYear
  ) || null;
  const hqLevels = gameState?.hq?.facilityLevels || {};
  const levelOf = (key) => Number(hqLevels[key] ?? baseFacility?.[key] ?? 5);
  const testDriverProfile = useMemo(
    () => testDriverDevelopmentProfile(gameState, teamId),
    [gameState, teamId]
  );
  const engineeringSupport = useMemo(
    () => teamEngineeringSupport(gameState, teamId),
    [gameState, teamId]
  );
  const teamName=gameState?.team?.team_name||gameState?.team?.name||"My Team";
  const rawPitCrew=gameState?.raceStrategyWorld?.pitCrews?.[teamId]||{
    avg_time_s:6.8,consistency:70,error_rate:0.05,training_load:50,source:"fallback"
  };
  const effectivePitCrew=pitCrewEffectiveProfile(rawPitCrew);
  const teamMorale=teamOperationalMorale(gameState,teamId);
  const moraleWorkRate=teamWorkRateLabel(gameState,teamId);
  const moraleTimeFactor=teamWorkRateMultiplier(gameState,teamId);
  const research = Array.isArray(dev.research) && dev.research.length
    ? dev.research
    : [
        { id:"aero", area:"Aerodynamics", focus:25, points:0 },
        { id:"chassis", area:"Chassis", focus:25, points:0 },
        { id:"reliability", area:"Reliability", focus:25, points:0 },
        { id:"powertrain", area:"Powertrain Integration", focus:25, points:0 },
      ];

  const validTabs = ["projects","parts","manufacturing","research","pit_crew"];
  const [tab, setTab] = useState(validTabs.includes(initialTab) ? initialTab : "projects");
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({
    name:"", type:"chassis", objective:"balanced", engineers:3, duration:21, cfd:20, windTunnel:10,
  });

  useEffect(() => {
    if (validTabs.includes(initialTab) && initialTab !== tab) setTab(initialTab);
  }, [initialTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeTab = (nextTab) => {
    if (!validTabs.includes(nextTab)) return;
    setTab(nextTab);
    onTabChange?.(nextTab);
  };

  const eraTypes = useMemo(
    () => availableCarComponentSlots(gameState, teamId),
    [gameState, teamId, activeYear]
  );

  useEffect(() => {
    if (!eraTypes.includes(draft.type) && eraTypes.length) {
      setDraft((d) => ({...d, type:eraTypes[0], objective:"balanced"}));
      return;
    }
    const allowed=developmentObjectivesForSlot(gameState,draft.type);
    if(!allowed.some((objective)=>objective.id===draft.objective)){
      setDraft((d)=>({...d,objective:allowed[0]?.id||"balanced"}));
    }
  }, [eraTypes, draft.type, draft.objective, gameState]);

  // Complete projects/manufacturing when the in-game date reaches their ETA.
  useEffect(() => {
    if (!currentDateISO) return;
    let changed = false;
    let nextParts = [...parts];
    let nextUnits = [...partUnits];
    let nextGarage = physicalState?.garage || gameState?.garage;

    const nextProjects = projects.map((p) => {
      if (p.status !== "active" || !p.finishes_at || p.finishes_at > currentDateISO) return p;
      changed = true;
      const partId = `part_${p.id}`;
      const realizedProfile=p.technical_projection?realizeDevelopmentProjection(p):null;
      const actualStrength=Number(
        realizedProfile?.development_strength ??
        p.target_design_perf ??
        p.perf_delta ??
        0
      );
      if (!nextParts.some((x) => x.id === partId)) {
        const draftPart={
          id:partId,
          name:p.name,
          slot:p.type,
          version:`P${nextParts.filter((x)=>x.slot===p.type).length + 1}`,
          perf:actualStrength,
          inv:0,
          in_manufacturing:0,
          prototype:true,
          created_from:p.id,
          development_focus:p.objective_id||"balanced",
          created_at:currentDateISO,
        };
        nextParts.push({
          ...draftPart,
          technical_profile:realizedProfile||derivePartTechnicalProfile(physicalState,draftPart),
        });
      }
      return {
        ...p,
        status:"completed",
        progress:1,
        completed_at:currentDateISO,
        actual_design_perf:actualStrength,
        technical_result:realizedProfile||null,
        result_rating:realizedProfile?.realization?.result||"legacy",
      };
    });

    const nextManufacturing = manufacturing.map((job) => {
      if (job.status !== "active" || !job.finishes_at || job.finishes_at > currentDateISO) return job;
      changed = true;
      const produced = createManufacturedPartUnits({
        ...physicalState,
        garage:nextGarage,
        development:{...dev,parts:nextParts,partUnits:nextUnits,manufacturing},
      },{
        designId:job.part_id,
        qty:Number(job.qty||1),
        batchId:job.id,
        manufacturedAt:currentDateISO,
      });
      nextParts=(produced?.development?.parts||nextParts).map((part) =>
        part.id === job.part_id
          ? {...part, in_manufacturing:Math.max(0, Number(part.in_manufacturing || 0) - Number(job.qty || 1))}
          : part
      );
      nextUnits=produced?.development?.partUnits||nextUnits;
      nextGarage=produced?.garage||nextGarage;
      return {...job, status:"completed", completed_at:currentDateISO};
    });

    if (changed) {
      const finalState=normalizePhysicalPartState({
        ...physicalState,
        garage:nextGarage,
        development:{...dev, projects:nextProjects, parts:nextParts, partUnits:nextUnits, manufacturing:nextManufacturing, research},
      });
      setGameState({
        garage:finalState?.garage,
        development:finalState?.development,
      });
    }
  }, [currentDateISO, projects, parts, partUnits, manufacturing, research, dev, setGameState]); // eslint-disable-line react-hooks/exhaustive-deps

  const budget = Number(gameState?.team?.budget ?? gameState?.finances?.balance ?? 0);
  const objectiveOptions=developmentObjectivesForSlot(gameState,draft.type);
  const objective=objectiveOptions.find((row)=>row.id===draft.objective)||objectiveOptions[0];
  const objectiveModifiers=objectiveProjectModifiers(gameState,draft.type,draft.objective);
  const rawEffectiveDays = effectiveProjectDays(draft, levelOf, moraleTimeFactor);
  const effectiveDays = Math.max(7,Math.round(rawEffectiveDays*objectiveModifiers.duration_multiplier));
  const baseCost = projectCost({...draft, duration:effectiveDays}, levelOf("manufacturing_leve"));
  const cost = Math.round(baseCost*objectiveModifiers.cost_multiplier);
  const baseExpectedPerf = perfDelta(draft, levelOf, parts);
  const expectedIncrement = Number((
    baseExpectedPerf * Number(testDriverProfile?.performanceMultiplier || 1)
  ).toFixed(2));
  const strengthTarget=developmentStrengthTarget(parts,draft.type,expectedIncrement);
  const currentDesign=strengthTarget.current_part||bestDevelopedPartForSlot(parts,draft.type);
  const technicalProjection=buildDevelopmentProjection(gameState,{
    slot:draft.type,
    objectiveId:draft.objective,
    targetStrength:strengthTarget.target_strength,
    currentPart:currentDesign,
  });
  const capacity=technicalDevelopmentCapacity(gameState,teamId,{
    engineeringSupport,
    projects,
  });
  const relevantFacility = PART_PROFILES[draft.type]?.label || "Technical facilities";
  const projectRisk=Math.max(
    0.025,
    (0.22 - Number(draft.engineers) * 0.02 - Number(testDriverProfile?.riskReduction || 0))*
      objectiveModifiers.risk_multiplier
  );
  const hasEngineerCapacity=Number(draft.engineers)<=Number(capacity.available_engineers);
  const canStartProject=Boolean(
    draft.name.trim() &&
    currentDateISO &&
    budget>=cost &&
    hasEngineerCapacity &&
    capacity.project_slot_available &&
    strengthTarget.increment>0
  );

  const createProject = () => {
    if (!canStartProject) return;
    const sequence=String(projects.length+1).padStart(3,"0");
    const id = `dev_${teamId||"TEAM"}_${currentDateISO}_${sequence}`;
    const project = {
      id,
      name:draft.name.trim(),
      type:draft.type,
      objective_id:objective?.id||"balanced",
      objective_label:objective?.label||"Balanced Package",
      phase:"design",
      status:"active",
      started_at:currentDateISO,
      finishes_at:addDaysISO(currentDateISO, effectiveDays),
      duration_days:effectiveDays,
      engineers:Number(draft.engineers),
      cfd_hours:Number(draft.cfd),
      wt_hours:Number(draft.windTunnel),
      cost,
      perf_delta:strengthTarget.increment,
      base_perf_delta:baseExpectedPerf,
      current_design_perf:strengthTarget.current_strength,
      target_design_perf:strengthTarget.target_strength,
      technical_projection:technicalProjection,
      risk:projectRisk,
      test_driver_id:testDriverProfile?.driver_id||null,
      test_driver_name:testDriverProfile?.name||null,
      test_driver_feedback:testDriverProfile?.impact??null,
    };

    applyExpense(cost, `Development — ${project.name}`);
    setGameState({
      development:{...dev, projects:[...projects, project], parts, partUnits, manufacturing, research},
    });
    setShowCreate(false);
    setDraft((d)=>({...d,name:""}));
  };

  const patchProject = (id, patch) => {
    setGameState({
      development:{
        ...dev,
        projects:projects.map((p)=>p.id===id?{...p,...patch}:p),
        parts, partUnits, manufacturing, research,
      },
    });
  };

  const manufacture = (part) => {
    const qty = 1;
    const quote=partManufactureQuote(physicalState,part);
    const unitCost=Number(quote.cost||0);
    const buildDays=Number(quote.days||0);
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
      duration_days:buildDays,
      status:"active",
    };
    setGameState({
      development:{
        ...dev,
        projects,
        parts:parts.map((p)=>p.id===part.id?{...p,in_manufacturing:Number(p.in_manufacturing||0)+qty}:p),
        partUnits,
        manufacturing:[...manufacturing,job],
        research,
      },
    });
  };

  const restoreUnit = (part, unit) => {
    const quote=partUnitRestoreQuote(physicalState,unit?.id);
    if(!quote||!currentDateISO||budget<Number(quote.cost||0))return;
    const beforeJobs=(physicalState?.garage?.serviceJobs||[]).length;
    const next=queueWorkshopJob(physicalState,quote,{
      id:`workshop_${Date.now()}`,
      title:`Restore ${part?.name||part?.version||unit?.id} · ${unit?.id}`,
      startedAt:currentDateISO,
    });
    if((next?.garage?.serviceJobs||[]).length<=beforeJobs)return;
    applyExpense(quote.cost,`Restoration — ${part?.name||unit?.id}`);
    setGameState({
      garage:next?.garage,
      development:next?.development,
    });
  };

  const startTechnologyProject=(slot)=>{
    const next=startTechnologyAdoption(gameState,teamId,slot,{origin:"player"});
    if(next!==gameState)setGameState(next);
  };

  const updateResearch = (id, focus) => {
    const next = research.map((r)=>r.id===id?{...r,focus:Number(focus)}:r);
    setGameState({development:{...dev,projects,parts,partUnits,manufacturing,research:next}});
  };

  const setPitCrewTrainingLoad=(load)=>{
    const pitCrews={...(gameState?.raceStrategyWorld?.pitCrews||{})};
    pitCrews[teamId]={...rawPitCrew,training_load:Math.max(0,Math.min(100,Number(load)||0))};
    setGameState({raceStrategyWorld:{...(gameState?.raceStrategyWorld||{}),pitCrews}});
  };

  function applyExpense(amount, desc) {
    const value = Math.abs(Number(amount || 0));
    const oldBudget = Number(gameState?.team?.budget ?? gameState?.finances?.balance ?? 0);
    const nextBudget = oldBudget - value;
    const tx = {
      id:`tx_dev_${currentDateISO||"date"}_${String((gameState?.financeLog||[]).length+1).padStart(4,"0")}`,
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
    <div className={embedded ? "space-y-4" : "-mx-3 -my-4 md:-mx-5 md:-my-5 min-h-[calc(100vh-4rem)] bg-[#090b10] text-slate-100 p-4 md:p-6 space-y-4"}>
      {!embedded && <div className="rounded-xl border border-white/10 bg-[#12141c] p-5 flex flex-col lg:flex-row lg:items-center gap-4">
        <TeamLogo teamId={teamId} name={teamName} size="h-14 w-14"/>
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Technical Department</div>
          <h1 className="text-2xl md:text-3xl font-semibold">Technical Development</h1>
          <p className="text-sm text-slate-400">Current-car design briefs, technology R&D, manufacturing and race operations.</p>
        </div>
        <div className="flex-1" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Mini label="Budget" value={fmtMoney(budget)}/>
          <Mini label="Engineering" value={Math.round(Number(engineeringSupport||0))+"/100"}/>
          <Mini label="Operational Morale" value={Math.round(teamMorale)+"/100"}/>
          <Mini label="Work Rate" value={moraleWorkRate.label}/>
          <Mini label="Engineers Free" value={capacity.available_engineers+"/"+capacity.engineer_pool}/>
        </div>
        <Button onClick={()=>setShowCreate((v)=>!v)}>{showCreate ? "Close" : "New Project"}</Button>
      </div>}

      {showCreate && (
        <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-4">
          <div className="flex flex-col xl:flex-row xl:items-start gap-4">
            <div className="xl:w-[46%] space-y-4">
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Current Car Development</div>
                <div className="text-lg font-semibold">Create design brief</div>
                <div className="text-sm text-slate-400">Choose what the new specification should prioritise. Different briefs create different gains and trade-offs.</div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="text-sm">Project name<input className="mt-1 border border-white/10 bg-[#0d0f15] rounded px-3 py-2 w-full" value={draft.name} onChange={(e)=>setDraft({...draft,name:e.target.value})} placeholder="e.g. High-downforce front wing"/></label>
                <label className="text-sm">Component<select className="mt-1 border border-white/10 bg-[#0d0f15] rounded px-3 py-2 w-full" value={draft.type} onChange={(e)=>setDraft({...draft,type:e.target.value,objective:"balanced"})}>{eraTypes.map((t)=><option key={t} value={t}>{componentLabel(gameState,t)}</option>)}</select></label>
              </div>

              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Design objective</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {objectiveOptions.map((row)=><button key={row.id} onClick={()=>setDraft({...draft,objective:row.id})} className={"rounded-lg border p-3 text-left transition "+(draft.objective===row.id?"border-cyan-300/40 bg-cyan-300/[0.08]":"border-white/10 bg-white/[0.025] hover:bg-white/[0.05]")}>
                    <div className="font-semibold text-sm">{row.label}</div>
                    <div className="text-[11px] text-slate-500 mt-1">{row.description}</div>
                  </button>)}
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <label className="text-sm">Engineers<input type="number" min="1" max={Math.max(1,capacity.available_engineers)} className="mt-1 border border-white/10 bg-[#0d0f15] rounded px-3 py-2 w-full" value={draft.engineers} onChange={(e)=>setDraft({...draft,engineers:Number(e.target.value)})}/></label>
                <label className="text-sm">Base days<input type="number" min="7" max="90" className="mt-1 border border-white/10 bg-[#0d0f15] rounded px-3 py-2 w-full" value={draft.duration} onChange={(e)=>setDraft({...draft,duration:Number(e.target.value)})}/></label>
                <label className="text-sm">CFD hours<input type="number" min="0" max="200" className="mt-1 border border-white/10 bg-[#0d0f15] rounded px-3 py-2 w-full" value={draft.cfd} onChange={(e)=>setDraft({...draft,cfd:Number(e.target.value)})}/></label>
                <label className="text-sm">Wind tunnel<input type="number" min="0" max="100" className="mt-1 border border-white/10 bg-[#0d0f15] rounded px-3 py-2 w-full" value={draft.windTunnel} onChange={(e)=>setDraft({...draft,windTunnel:Number(e.target.value)})}/></label>
              </div>

              <div className="rounded-lg border border-white/10 bg-[#0d0f15] p-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <Mini label="Cost" value={fmtMoney(cost)}/>
                  <Mini label="Effective time" value={effectiveDays+"d"}/>
                  <Mini label="Risk" value={(projectRisk*100).toFixed(0)+"%"}/>
                  <Mini label="Design strength" value={strengthTarget.current_strength.toFixed(2)+" → "+strengthTarget.target_strength.toFixed(2)}/>
                </div>
                <div className="mt-2 text-xs text-slate-500">Primary facility: <span className="text-slate-300">{relevantFacility}</span> · ETA <span className="text-slate-300">{currentDateISO?addDaysISO(currentDateISO,effectiveDays):"—"}</span> · Test driver <span className="text-slate-300">{testDriverProfile?.name||"None"}</span></div>
              </div>

              <div className="flex flex-wrap gap-2 items-center">
                <Button onClick={createProject} disabled={!canStartProject}>Start Project</Button>
                <span className="text-xs text-slate-500">{capacity.available_engineers}/{capacity.engineer_pool} engineers available · {capacity.active_projects}/{capacity.max_projects} project slots used</span>
              </div>
              {!hasEngineerCapacity&&<div className="text-sm text-rose-300">Not enough free engineers for this brief.</div>}
              {!capacity.project_slot_available&&<div className="text-sm text-rose-300">Technical project capacity is full. Complete or free a project slot first.</div>}
              {strengthTarget.increment<=0&&<div className="text-sm text-amber-300">This component has reached the current-car development ceiling.</div>}
              {!testDriverProfile&&<div className="text-sm text-amber-300">No dedicated Test Driver is contracted. Result uncertainty will be higher.</div>}
              {budget<cost&&<div className="text-sm text-rose-300">Insufficient budget for this project.</div>}
            </div>

            <div className="xl:flex-1 rounded-xl border border-white/10 bg-[#0d0f15] overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10">
                <div className="text-xs uppercase tracking-wide text-slate-500">Design Projection</div>
                <div className="font-semibold">{componentLabel(gameState,draft.type)} · {objective?.label||"Balanced Package"}</div>
                <div className="text-xs text-slate-500 mt-1">Projection is an engineering estimate. The completed design can finish slightly above or below target depending on project risk and validation quality.</div>
              </div>
              <div className="p-4 space-y-3">
                <TechCompare label="Weight" current={technicalProjection.current.design.weight_kg} proposed={technicalProjection.design.weight_kg} suffix=" kg" lowerBetter/>
                <TechCompare label="Drag" current={technicalProjection.current.design.drag} proposed={technicalProjection.design.drag} digits={4} lowerBetter/>
                <TechCompare label="Downforce" current={technicalProjection.current.design.downforce} proposed={technicalProjection.design.downforce} digits={4}/>
                <TechCompare label="Design Reliability" current={Number(technicalProjection.current.design.reliability||0)*100} proposed={Number(technicalProjection.design.reliability||0)*100} suffix="%" digits={1}/>
                <TechCompare label="System Efficiency" current={Number(technicalProjection.current.delta.system_efficiency||technicalProjection.current.development_strength||0)} proposed={Number(technicalProjection.delta.system_efficiency||0)} digits={2}/>
              </div>
              <div className="border-t border-white/10 px-4 py-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-2">Characteristic trade-offs</div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(technicalProjection.characteristic_bias||{}).length?Object.entries(technicalProjection.characteristic_bias||{}).map(([key,value])=><span key={key} className={"rounded px-2 py-1 text-[10px] "+(Number(value)>=0?"bg-emerald-500/10 text-emerald-300":"bg-rose-500/10 text-rose-300")}>{nice(key)} {Number(value)>=0?"+":""}{Number(value).toFixed(1)}</span>):<span className="text-xs text-slate-500">Balanced brief — no extra characteristic bias beyond the component's normal technical effect.</span>}
                </div>
              </div>
            </div>
          </div>
        </CardContent></Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Active Projects" value={projects.filter((p)=>p.status==="active").length}/>
        <Stat label="Completed Projects" value={projects.filter((p)=>p.status==="completed").length}/>
        <Stat label="Designed Parts" value={parts.length}/>
        <Stat label="Manufacturing" value={manufacturing.filter((m)=>m.status==="active").length + workshop.length}/>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#12141c] p-3 flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {[
            ["projects","Current Car"],
            ["manufacturing","Manufacturing"],
            ["parts","Design Library"],
            ["research","Research / Technology"],
            ["pit_crew","Pit Crew"],
          ].map(([key,label])=><Button key={key} size="sm" variant={tab===key?"default":"outline"} onClick={()=>changeTab(key)}>{label}</Button>)}
        </div>
        <div className="flex-1"/>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Mini label="Budget" value={fmtMoney(budget)}/>
          <Mini label="Engineering" value={Math.round(Number(engineeringSupport||0))+"/100"}/>
          <Mini label="Morale" value={Math.round(teamMorale)+"/100"}/>
          <Mini label="Wind Tunnel" value={"Lv "+levelOf("wind_tunnel_level")}/>
          <Mini label="Manufacturing" value={"Lv "+levelOf("manufacturing_leve")}/>
        </div>
        <Button size="sm" variant="outline" disabled>Next Season Car · Stage 7</Button>
        {embedded && <Button size="sm" onClick={()=>setShowCreate((v)=>!v)}>{showCreate ? "Close" : "New Project"}</Button>}
      </div>

      {tab==="projects" && (
        <div className="grid grid-cols-1 gap-2">
          {projects.map((p)=>{
            const progress = p.status==="completed" ? 1 : p.status==="paused" ? Number(p.progress||0) : progressBetween(p.started_at,p.finishes_at,currentDateISO);
            return <Card className="!bg-[#12141c] !border-white/10 !text-slate-100" key={p.id}><CardContent className="p-4 space-y-3">
              <div className="flex justify-between gap-2"><div><div className="text-xs text-slate-400">{nice(p.type)} · {nice(p.phase)}</div><div className="font-semibold">{p.name}</div></div><span className="text-xs rounded bg-white/10 px-2 py-1 h-fit">{nice(p.status)}</span></div>
              <div><div className="flex justify-between text-sm"><span>Progress</span><strong>{Math.round(progress*100)}%</strong></div><div className="h-2 mt-1 bg-white/10 rounded overflow-hidden"><div className="h-full bg-slate-800" style={{width:`${progress*100}%`}}/></div></div>
              <div className="grid grid-cols-3 gap-2 text-sm"><Mini label="Engineers" value={p.engineers}/><Mini label="CFD" value={`${p.cfd_hours||0}h`}/><Mini label="WT" value={`${p.wt_hours||0}h`}/></div>
              <div className="text-xs text-slate-400">{p.started_at} → {p.finishes_at} · {fmtMoney(p.cost)} · Δ +{p.perf_delta}</div>
              {p.test_driver_name && <div className="text-xs text-slate-400">Test feedback: {p.test_driver_name} · {Math.round(Number(p.test_driver_feedback||0))}/100</div>}
              {p.status!=="completed" && <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={()=>patchProject(p.id,{status:p.status==="paused"?"active":"paused",progress})}>{p.status==="paused"?"Resume":"Pause"}</Button>
                <Button size="sm" variant="darkOutline" onClick={()=>addHours(p,"cfd_hours")}>+5 CFD</Button>
                <Button size="sm" variant="darkOutline" onClick={()=>addHours(p,"wt_hours")}>+5 WT</Button>
              </div>}
            </CardContent></Card>;
          })}
          {!projects.length && <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-5 text-sm text-slate-400">No development projects yet. Start one with “New Project”.</CardContent></Card>}
        </div>
      )}

      {tab==="parts" && (
        <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-0 overflow-x-auto"><table className="min-w-full text-sm">
          <thead className="bg-[#171a23] text-slate-300"><tr><th className="px-3 py-2 text-left">Part</th><th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-left">Version</th><th className="px-3 py-2 text-right">Performance</th><th className="px-3 py-2 text-right">Inventory</th><th className="px-3 py-2 text-right">Action</th></tr></thead>
          <tbody>{parts.map((p)=>{
            const warehouse=warehousePartUnitsForDesign(physicalState,p.id);
            const allUnits=partUnitsForDesign(physicalState,p.id);
            const fitted=Math.max(0,allUnits.length-warehouse.length);
            const worn=warehouse.filter((unit)=>Number(unit?.condition??100)<99.5).sort((a,b)=>Number(a.condition||100)-Number(b.condition||100))[0]||null;
            const restoreQuote=worn?partUnitRestoreQuote(physicalState,worn.id):null;
            const manufactureQuote=partManufactureQuote(physicalState,p);
            const technical=derivePartTechnicalProfile(physicalState,p);
            return <tr key={p.id} className="border-t border-white/10"><td className="px-3 py-2 font-medium"><div>{p.name}</div><div className="text-[10px] text-slate-500">{technical.impact_area} · {technical.design.weight_kg.toFixed(1)} kg · DF {technical.design.downforce.toFixed(3)} · Drag {technical.design.drag.toFixed(3)} · Rel {(technical.design.reliability*100).toFixed(1)}%</div></td><td className="px-3 py-2">{componentLabel(gameState,p.slot)}</td><td className="px-3 py-2">{p.version||"—"}</td><td className="px-3 py-2 text-right"><div>+{Number(p.perf||0).toFixed(2)}</div><div className="text-[10px] text-slate-500">{technical.delta.weight_kg.toFixed(2)} kg · DF +{technical.delta.downforce.toFixed(3)}</div></td><td className="px-3 py-2 text-right"><div>{warehouse.length} warehouse{p.in_manufacturing? ` (+${p.in_manufacturing} building)`:""}</div><div className="text-[10px] text-slate-500">{fitted} fitted · {allUnits.length} physical</div></td><td className="px-3 py-2 text-right"><div className="flex justify-end gap-1"><Button size="sm" className="border border-emerald-400/30 !bg-emerald-500/10 !text-emerald-200 hover:!bg-emerald-500/20" onClick={()=>manufacture(p)} disabled={budget<Number(manufactureQuote.cost||0)}>Manufacture · {manufactureQuote.days}d · <span className="ml-1 rounded bg-rose-500/15 px-1 text-rose-300">{fmtMoney(manufactureQuote.cost)}</span></Button>{worn&&restoreQuote?<Button size="sm" className="border border-amber-400/30 !bg-amber-500/10 !text-amber-200 hover:!bg-amber-500/20" onClick={()=>restoreUnit(p,worn)} disabled={budget<Number(restoreQuote.cost||0)}>Restore {Number(worn.condition||0).toFixed(0)}% · {restoreQuote.days}d · <span className="ml-1 rounded bg-rose-500/15 px-1 text-rose-300">{fmtMoney(restoreQuote.cost)}</span></Button>:null}</div></td></tr>;
          })}
          {!parts.length&&<tr><td colSpan={6} className="px-3 py-5 text-center text-slate-400">Complete a development project to create your first part.</td></tr>}</tbody>
        </table></CardContent></Card>
      )}

      {tab==="manufacturing" && (
        <div className="space-y-3">
          <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-0 overflow-x-auto"><table className="min-w-full text-sm">
            <thead className="bg-[#171a23] text-slate-300"><tr><th className="px-3 py-2 text-left">Batch</th><th className="px-3 py-2 text-left">Started</th><th className="px-3 py-2 text-left">ETA</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Cost</th><th className="px-3 py-2 text-left">Status</th></tr></thead>
            <tbody>{manufacturing.map((m)=><tr key={m.id} className="border-t border-white/10"><td className="px-3 py-2 font-medium">{m.title}</td><td className="px-3 py-2">{m.started_at}</td><td className="px-3 py-2">{m.finishes_at}</td><td className="px-3 py-2 text-right">{m.qty}</td><td className="px-3 py-2 text-right"><span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-300">{fmtMoney(Number(m.unit_cost||0)*Number(m.qty||1))}</span></td><td className="px-3 py-2">{nice(m.status)}</td></tr>)}
            {!manufacturing.length&&<tr><td colSpan={6} className="px-3 py-5 text-center text-slate-400">No manufacturing batches.</td></tr>}</tbody>
          </table></CardContent></Card>
          <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-0 overflow-x-auto">
            <div className="px-3 py-3 border-b border-white/10"><div className="font-semibold">Workshop</div><div className="text-xs text-slate-500">Standard component builds and part restoration take real in-game time.</div></div>
            <table className="min-w-full text-sm"><thead className="bg-[#171a23] text-slate-300"><tr><th className="px-3 py-2 text-left">Job</th><th className="px-3 py-2 text-left">Started</th><th className="px-3 py-2 text-left">ETA</th><th className="px-3 py-2 text-right">Cost</th><th className="px-3 py-2 text-left">Status</th></tr></thead>
              <tbody>{(physicalState?.garage?.serviceJobs||[]).map((job)=><tr key={job.id} className="border-t border-white/10"><td className="px-3 py-2 font-medium">{job.title||nice(job.kind)}</td><td className="px-3 py-2">{job.started_at}</td><td className="px-3 py-2">{job.finishes_at}</td><td className="px-3 py-2 text-right"><span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-300">{fmtMoney(job.cost)}</span></td><td className="px-3 py-2">{nice(job.status)}</td></tr>)}
              {!(physicalState?.garage?.serviceJobs||[]).length&&<tr><td colSpan={5} className="px-3 py-5 text-center text-slate-400">No workshop jobs.</td></tr>}</tbody>
            </table>
          </CardContent></Card>
        </div>
      )}

      {tab==="research" && (
        <div className="space-y-3">
          <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-4 space-y-3">
            <div><div className="text-xs uppercase tracking-wide text-slate-500">Technology Adoption</div><div className="text-lg font-semibold">Paddock technology opportunities</div><div className="text-sm text-slate-400 mt-1">A rival using a technology can make it researchable, but adoption only unlocks the technical area. You still need to design and manufacture a competitive physical part afterwards.</div></div>
            {technologyOpportunities.length?<div className="grid grid-cols-1 lg:grid-cols-2 gap-2">{technologyOpportunities.map((opportunity)=>{
              const quote=technologyAdoptionQuote(gameState,teamId,opportunity.slot);
              const active=technologyProjects.find((project)=>project.slot===opportunity.slot&&project.status==="active");
              return <div key={opportunity.slot} className="rounded-lg border border-white/10 bg-[#171a23] p-3">
                <div className="flex items-start justify-between gap-3"><div><div className="font-semibold">{opportunity.label}</div><div className="text-xs text-slate-500 mt-0.5">Observed at {opportunity.sources.map((source)=>source.name).join(", ")}</div></div>{active?<span className="text-[10px] uppercase rounded bg-amber-500/10 text-amber-200 px-2 py-1">R&D active</span>:null}</div>
                {active?<div className="mt-3 text-sm text-slate-300">Started {active.started_at} · ETA <strong>{active.finishes_at}</strong></div>:<Button size="sm" className="mt-3 border border-emerald-400/30 !bg-emerald-500/10 !text-emerald-200 hover:!bg-emerald-500/20" disabled={budget<Number(quote.cost||0)} onClick={()=>startTechnologyProject(opportunity.slot)}>Start technology R&D · {quote.days}d · <span className="ml-1 rounded bg-rose-500/15 px-1 text-rose-300">{fmtMoney(quote.cost)}</span></Button>}
              </div>;
            })}</div>:<div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-sm text-slate-500">No new rival technology is currently available for adoption in this era.</div>}
            {technologyProjects.filter((project)=>project.status==="completed").length?<div className="pt-2 border-t border-white/10"><div className="text-xs uppercase text-slate-500 mb-2">Adopted technology</div><div className="flex flex-wrap gap-2">{technologyProjects.filter((project)=>project.status==="completed").map((project)=><span key={project.id} className="rounded bg-emerald-500/10 text-emerald-200 px-2 py-1 text-xs">{project.label} · unlocked {project.completed_at}</span>)}</div></div>:null}
          </CardContent></Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {research.map((r)=><Card className="!bg-[#12141c] !border-white/10 !text-slate-100" key={r.id}><CardContent className="p-4">
              <div className="flex justify-between"><div className="font-semibold">{r.area}</div><div className="text-sm">{r.focus||0}% focus</div></div>
              <input className="w-full mt-3" type="range" min="0" max="100" value={r.focus||0} onChange={(e)=>updateResearch(r.id,e.target.value)}/>
              <div className="text-xs text-slate-400 mt-2">Research points: {r.points||0}</div>
            </CardContent></Card>)}
          </div>
        </div>
      )}

      {tab==="pit_crew" && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
          <Card className="!bg-[#12141c] !border-white/10 !text-slate-100 xl:col-span-5"><CardContent className="p-4 space-y-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">Race Operations</div>
              <div className="text-lg font-semibold">Pit Crew Training Load</div>
              <p className="text-sm text-slate-400 mt-1">Training improves pit-stop pace, consistency and error rate over time. Heavy training accelerates development but creates a temporary race-day fatigue penalty.</p>
            </div>
            <input className="w-full" type="range" min="0" max="100" step="5" value={Number(rawPitCrew.training_load??50)} onChange={(e)=>setPitCrewTrainingLoad(e.target.value)}/>
            <div className="flex items-center justify-between text-sm"><span className="text-slate-400">Current load</span><strong>{Math.round(Number(rawPitCrew.training_load??50))}%</strong></div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[["Recovery",20],["Balanced",50],["Intensive",80],["Maximum",100]].map(([label,value])=><Button key={label} size="sm" variant={Number(rawPitCrew.training_load??50)===value?"default":"outline"} onClick={()=>setPitCrewTrainingLoad(value)}>{label}</Button>)}
            </div>
            <div className="text-xs text-slate-500">Suggestion: taper the load before a race weekend if you want to avoid the race-day penalty from very high training intensity.</div>
          </CardContent></Card>

          <Card className="!bg-[#12141c] !border-white/10 !text-slate-100 xl:col-span-7"><CardContent className="p-4">
            <div className="font-semibold mb-3">Pit Crew Performance</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Mini label="Base stop" value={Number(rawPitCrew.avg_time_s??6.8).toFixed(2)+"s"}/>
              <Mini label="Race-day stop" value={Number(effectivePitCrew.avg_time_s??6.8).toFixed(2)+"s"}/>
              <Mini label="Consistency" value={Number(effectivePitCrew.consistency??70).toFixed(1)+"%"}/>
              <Mini label="Error rate" value={(Number(effectivePitCrew.error_rate??0.05)*100).toFixed(1)+"%"}/>
            </div>
            <div className="mt-4 rounded-lg border border-white/10 bg-[#171a23] p-3 text-sm">
              <div className="font-medium">How it works</div>
              <div className="text-slate-400 mt-1">Daily training progression is affected by the Pit Crew Training facility. Loads above 60% improve the crew faster but temporarily add stop-time and error risk on race day. This is now the same crew profile used by the race-strategy pit-stop simulation.</div>
            </div>
          </CardContent></Card>
        </div>
      )}
    </div>
  );
}

function Stat({label,value}){return <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-4"><div className="text-xs text-slate-400">{label}</div><div className="text-xl font-semibold">{value}</div></CardContent></Card>;}
function Mini({label,value}){return <div className="border border-white/10 rounded p-2"><div className="text-[10px] text-slate-400">{label}</div><div className="font-medium">{value}</div></div>;}
