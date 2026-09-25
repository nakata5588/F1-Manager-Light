import React, { useEffect, useMemo, useState } from "react";
import { useGame } from "@/state/GameStore";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InfoPopover } from "@/components/ui/InfoPopover.jsx";
import { testDriverDevelopmentProfile } from "@/domain/developmentTesting";
import { teamEngineeringSupport } from "@/engine/PracticeSetupEngine.js";
import { pitCrewEffectiveProfile } from "@/engine/RaceStrategyEngine.js";
import {
  PIT_CREW_TRAINING_PRESETS,
  pitCrewTrainingLoadEffects,
  projectPitCrewTraining,
} from "@/domain/pitCrewTraining.js";
import { TeamLogo } from "@/components/entity/EntityVisuals.jsx";
import { availableCarComponentSlots, componentLabel } from "@/domain/carComponents.js";
import { normalizePhysicalPartState, partUnitsForDesign, warehousePartUnitsForDesign } from "@/domain/partUnits.js";
import { activeWorkshopJobs, partManufactureQuote } from "@/domain/componentService.js";
import { derivePartTechnicalProfile } from "@/domain/carPartPerformance.js";
import {
  bestDevelopedPartForSlot,
  buildDevelopmentProjection,
  developmentObjectivesForSlot,
  developmentStrengthTarget,
  objectiveProjectModifiers,
  technicalDevelopmentCapacity,
} from "@/domain/developmentProject.js";
import { teamOperationalMorale, teamWorkRateLabel, teamWorkRateMultiplier } from "@/domain/teamMorale.js";
import { managerGameplayEffects } from "@/domain/managerProfile.js";
import {
  aeroAllocationPerformanceEquivalents,
  aeroTestingRemaining,
  componentDevelopmentRule,
  defaultAeroAllocation,
  developmentRegulationProfile,
  normalizedAeroAllocation,
  recordAeroTestingUsage,
} from "@/domain/developmentRegulations.js";
import {
  consumeTechnicalResearch,
  normalizeTechnicalResearch,
  setTechnicalResearchFocus,
  technicalResearchArea,
  technicalResearchAreaForProject,
  technicalResearchDailyOutput,
  technicalResearchSupport,
} from "@/domain/technicalResearch.js";
import {
  discoverableCarTechnologies,
  startTechnologyAdoption,
  technologyAdoptionQuote,
  technologyProjectsForTeam,
} from "@/domain/technologyAdoption.js";
import {
  NEXT_SEASON_PHASES,
  normalizeNextSeasonCarProgramme,
  nextSeasonProgrammeQuote,
  pauseNextSeasonCarProgramme,
  resumeNextSeasonCarProgramme,
  setNextSeasonCarEngineers,
  startNextSeasonCarProgramme,
} from "@/domain/nextSeasonCar.js";
import {
  nextSeasonRegulationImpact,
  regulationImpactAreaSummary,
} from "@/domain/nextSeasonRegulations.js";
import {
  nextSeasonKnowledgeCarryover,
  technicalKnowledgeSnapshot,
} from "@/domain/technicalKnowledge.js";
import {
  NEXT_SEASON_TECHNICAL_PHILOSOPHIES,
  buildNextSeasonTechnicalPackage,
} from "@/domain/nextSeasonTechnicalPackage.js";

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
function projectProgress(project, now) {
  if (project?.status==="completed") return 1;
  if (project?.status==="paused") return Number(project?.progress||0);
  if (project?.resumed_at && Number.isFinite(Number(project?.resume_progress))) {
    const base=Math.max(0,Math.min(1,Number(project.resume_progress)));
    return base+(1-base)*progressBetween(project.resumed_at,project.finishes_at,now);
  }
  return progressBetween(project?.started_at,project?.finishes_at,now);
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
    avg_time_s:6.8,consistency:70,error_rate:0.05,training_load:50,fatigue:0,source:"fallback"
  };
  const effectivePitCrew=pitCrewEffectiveProfile(rawPitCrew);
  const pitCrewFacilityLevel=levelOf("pitcrew_training_level");
  const pitCrewLoadEffects=pitCrewTrainingLoadEffects(rawPitCrew.training_load??50);
  const pitCrewSevenDay=projectPitCrewTraining(rawPitCrew,pitCrewFacilityLevel,7);
  const teamMorale=teamOperationalMorale(gameState,teamId);
  const moraleWorkRate=teamWorkRateLabel(gameState,teamId);
  const moraleTimeFactor=teamWorkRateMultiplier(gameState,teamId);
  const managerEffects=managerGameplayEffects(gameState,{teamId});
  const regulationProfile=useMemo(
    ()=>developmentRegulationProfile(gameState,teamId,{dateISO:currentDateISO}),
    [gameState,teamId,currentDateISO,activeYear]
  );
  const atrRemaining=useMemo(
    ()=>aeroTestingRemaining(dev,regulationProfile),
    [dev,regulationProfile]
  );
  const research = normalizeTechnicalResearch(dev.research);
  const researchOutput=technicalResearchDailyOutput(gameState);
  const nextSeasonCar=normalizeNextSeasonCarProgramme(dev.nextSeasonCar,{activeYear});
  const validTabs = ["projects","next_season","parts","manufacturing","research","pit_crew"];
  const [tab, setTab] = useState(validTabs.includes(initialTab) ? initialTab : "projects");
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({
    type:"chassis", objective:"balanced", engineers:3, duration:21, cfd:0, windTunnel:0, researchSupport:0,
  });
  const [nextSeasonDraftEngineers,setNextSeasonDraftEngineers]=useState(4);
  const [nextSeasonPhilosophyId,setNextSeasonPhilosophyId]=useState("balanced");

  const calculatedNextSeasonImpact=useMemo(
    ()=>nextSeasonRegulationImpact(gameState,{targetSeason:nextSeasonCar.targetSeason,teamId}),
    [gameState,nextSeasonCar.targetSeason,teamId,activeYear]
  );
  const nextSeasonImpact=nextSeasonCar.regulation_impact||calculatedNextSeasonImpact;
  const nextSeasonImpactAreas=regulationImpactAreaSummary(nextSeasonImpact);
  const technicalKnowledge=useMemo(
    ()=>technicalKnowledgeSnapshot(gameState,{teamId}),
    [gameState,teamId,activeYear]
  );
  const nextSeasonKnowledge=useMemo(
    ()=>nextSeasonKnowledgeCarryover(gameState,{
      teamId,
      targetSeason:nextSeasonCar.targetSeason,
      regulationImpact:nextSeasonImpact,
    }),
    [gameState,teamId,nextSeasonCar.targetSeason,nextSeasonImpact]
  );
  const nextSeasonReservedEngineers=nextSeasonCar.status==="active"?Number(nextSeasonCar.engineers||0):0;
  const nextSeasonSelectedPhilosophy=nextSeasonCar.status==="not_started"
    ?nextSeasonPhilosophyId
    :(nextSeasonCar.technical_philosophy?.id||"balanced");
  const nextSeasonTechnicalPackage=useMemo(
    ()=>Number(nextSeasonCar.technical_package?.version||0)>=2?nextSeasonCar.technical_package:buildNextSeasonTechnicalPackage(gameState,{
      teamId,
      knowledgeCarryover:nextSeasonKnowledge,
      programme:{
        ...nextSeasonCar,
        engineers:nextSeasonCar.status==="not_started"
          ?Math.max(1,Number(nextSeasonDraftEngineers||1))
          :nextSeasonCar.engineers,
        technical_philosophy:{id:nextSeasonSelectedPhilosophy},
        knowledge_carryover:nextSeasonKnowledge,
      },
    }),
    [gameState,teamId,nextSeasonCar,nextSeasonKnowledge,nextSeasonDraftEngineers,nextSeasonSelectedPhilosophy]
  );

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
      setDraft((d) => ({...d, type:eraTypes[0], objective:"balanced", researchSupport:0}));
      return;
    }
    const allowed=developmentObjectivesForSlot(gameState,draft.type,teamId);
    if(!allowed.some((objective)=>objective.id===draft.objective)){
      setDraft((d)=>({...d,objective:allowed[0]?.id||"balanced",researchSupport:0}));
    }
  }, [eraTypes, draft.type, draft.objective, gameState]);

  const budget = Number(gameState?.team?.budget ?? gameState?.finances?.balance ?? 0);
  const componentRule=componentDevelopmentRule(gameState,teamId,draft.type);
  const objectiveOptions=developmentObjectivesForSlot(gameState,draft.type,teamId);
  const objective=objectiveOptions.find((row)=>row.id===draft.objective)||objectiveOptions[0]||null;
  const objectiveModifiers=objectiveProjectModifiers(gameState,draft.type,draft.objective,teamId);
  const researchAreaId=technicalResearchAreaForProject(gameState,draft.type,draft.objective);
  const researchArea=technicalResearchArea(research,researchAreaId);
  const researchSupport=technicalResearchSupport(research,researchAreaId,draft.researchSupport);
  const aeroAllocation=normalizedAeroAllocation(gameState,teamId,draft.type,{
    windTunnel:draft.windTunnel,
    cfd:draft.cfd,
  },dev);
  const aeroEffect=aeroAllocationPerformanceEquivalents(regulationProfile,{
    windTunnel:aeroAllocation.wind_tunnel,
    cfd:aeroAllocation.cfd,
  });
  const effectiveDraft={
    ...draft,
    cfd:aeroEffect.cfd_effective,
    windTunnel:aeroEffect.wind_tunnel_effective,
  };
  const rawEffectiveDays = effectiveProjectDays(effectiveDraft, levelOf, moraleTimeFactor);
  const effectiveDays = Math.max(7,Math.round(
    rawEffectiveDays*objectiveModifiers.duration_multiplier*researchSupport.duration_multiplier*managerEffects.technicalTimeMultiplier
  ));
  const baseCost = projectCost({...effectiveDraft, duration:effectiveDays}, levelOf("manufacturing_leve"));
  const cost = Math.round(baseCost*objectiveModifiers.cost_multiplier);
  const baseExpectedPerf = perfDelta(effectiveDraft, levelOf, parts);
  const expectedIncrement = Number((
    baseExpectedPerf *
    Number(testDriverProfile?.performanceMultiplier || 1) *
    researchSupport.performance_multiplier
  ).toFixed(2));
  const strengthTarget=developmentStrengthTarget(parts,draft.type,expectedIncrement);
  const currentDesign=strengthTarget.current_part||bestDevelopedPartForSlot(parts,draft.type);
  const technicalProjection=buildDevelopmentProjection(gameState,{
    slot:draft.type,
    objectiveId:draft.objective,
    targetStrength:strengthTarget.target_strength,
    currentPart:currentDesign,
    teamId,
  });
  const capacity=technicalDevelopmentCapacity(gameState,teamId,{
    engineeringSupport,
    projects,
    reservedEngineers:nextSeasonReservedEngineers,
  });
  const nextSeasonBaseCapacity=technicalDevelopmentCapacity(gameState,teamId,{
    engineeringSupport,
    projects,
    reservedEngineers:0,
  });
  const nextSeasonDraftMax=Math.max(1,Number(nextSeasonBaseCapacity.available_engineers||1));
  const nextSeasonQuote=nextSeasonProgrammeQuote(gameState,{
    teamId,
    engineers:Math.min(nextSeasonDraftEngineers,nextSeasonDraftMax),
  });
  const canStartNextSeason=Boolean(
    currentDateISO &&
    nextSeasonCar.status==="not_started" &&
    nextSeasonDraftEngineers<=nextSeasonBaseCapacity.available_engineers &&
    budget>=nextSeasonQuote.launch_cost
  );
  const relevantFacility = PART_PROFILES[draft.type]?.label || "Technical facilities";
  const nextDesignVersion=parts.filter((part)=>String(part?.slot)===String(draft.type)).length+1;
  const automaticProjectName=`${componentLabel(gameState,draft.type)} · ${objective?.label||"Balanced Package"} · P${nextDesignVersion}`;
  const projectRiskBeforeManager=Math.max(
    0.025,
    (0.22 - Number(draft.engineers) * 0.02 - Number(testDriverProfile?.riskReduction || 0))*
      objectiveModifiers.risk_multiplier -
      researchSupport.risk_reduction
  );
  const projectRisk=Math.max(0.025,projectRiskBeforeManager*managerEffects.technicalRiskMultiplier);
  const hasEngineerCapacity=Number(draft.engineers)<=Number(capacity.available_engineers);
  const canStartProject=Boolean(
    currentDateISO &&
    componentRule.can_start_project &&
    objective &&
    aeroAllocation.allowed &&
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
      name:automaticProjectName,
      type:draft.type,
      objective_id:objective?.id||"balanced",
      objective_label:objective?.label||"Balanced Package",
      phase:"design",
      status:"active",
      started_at:currentDateISO,
      finishes_at:addDaysISO(currentDateISO, effectiveDays),
      duration_days:effectiveDays,
      engineers:Number(draft.engineers),
      cfd_hours:regulationProfile.scheme==="fia_atr"?0:Number(aeroAllocation.cfd),
      cfd_mauh:regulationProfile.scheme==="fia_atr"?Number(aeroAllocation.cfd):null,
      cfd_allocation:Number(aeroAllocation.cfd),
      cfd_unit:regulationProfile.cfd_unit,
      wt_hours:Number(aeroAllocation.wind_tunnel),
      aero_testing_scheme:regulationProfile.scheme,
      aero_testing_period:regulationProfile.period?.id||null,
      atr_coefficient:regulationProfile.coefficient,
      component_development_rule:componentRule.rule,
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
      research_area:researchSupport.area_id,
      research_points_used:researchSupport.points_used,
      research_support:{
        duration_multiplier:researchSupport.duration_multiplier,
        risk_reduction:researchSupport.risk_reduction,
        performance_multiplier:researchSupport.performance_multiplier,
      },
    };

    applyExpense(cost, `Development — ${project.name}`);
    const nextResearch=consumeTechnicalResearch(
      research,
      researchSupport.area_id,
      researchSupport.points_used
    );
    const nextDevelopment=recordAeroTestingUsage({
      ...dev,
      projects:[...projects, project],
      parts,partUnits,manufacturing,research:nextResearch,
    },regulationProfile,{
      windTunnel:aeroAllocation.wind_tunnel,
      cfd:aeroAllocation.cfd,
    });
    setGameState({development:nextDevelopment});
    const defaults=defaultAeroAllocation(gameState,teamId,draft.type,nextDevelopment);
    setDraft((current)=>({...current,cfd:defaults.cfd,windTunnel:defaults.windTunnel,researchSupport:0}));
    setShowCreate(false);
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

  const toggleProjectPause=(project)=>{
    const progress=projectProgress(project,currentDateISO);
    if(project.status==="paused"){
      const remaining=Math.max(
        1,
        Number(project.remaining_days)||
        Math.ceil(Number(project.duration_days||21)*(1-progress))
      );
      patchProject(project.id,{
        status:"active",
        resumed_at:currentDateISO,
        resume_progress:progress,
        finishes_at:addDaysISO(currentDateISO,remaining),
        remaining_days:null,
      });
      return;
    }
    const remaining=Math.max(
      1,
      Math.ceil((+parseISO(project.finishes_at)-+parseISO(currentDateISO))/DAY)
    );
    patchProject(project.id,{
      status:"paused",
      paused_at:currentDateISO,
      progress,
      remaining_days:remaining,
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

  const startTechnologyProject=(slot)=>{
    const next=startTechnologyAdoption(gameState,teamId,slot,{origin:"player"});
    if(next!==gameState)setGameState(next);
  };

  const updateResearch = (id, focus) => {
    const next=setTechnicalResearchFocus(research,id,focus);
    setGameState({development:{...dev,projects,parts,partUnits,manufacturing,research:next}});
  };

  const startNextSeasonProgramme=()=>{
    if(!canStartNextSeason)return;
    const next=startNextSeasonCarProgramme(gameState,{
      teamId,
      engineers:nextSeasonDraftEngineers,
      engineeringSupport,
      philosophyId:nextSeasonPhilosophyId,
    });
    if(next!==gameState)setGameState(next);
  };

  const updateNextSeasonEngineers=(value)=>{
    const requested=Math.max(1,Math.min(nextSeasonDraftMax,Number(value)||1));
    const next=setNextSeasonCarEngineers(gameState,{
      teamId,
      engineers:requested,
      engineeringSupport,
    });
    if(next!==gameState)setGameState(next);
  };

  const toggleNextSeasonPause=()=>{
    const next=nextSeasonCar.status==="paused"
      ?resumeNextSeasonCarProgramme(gameState,{teamId,engineeringSupport})
      :pauseNextSeasonCarProgramme(gameState);
    if(next!==gameState)setGameState(next);
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
          <p className="text-sm text-slate-400">Current-car development, next-season engineering, technology R&D, manufacturing and race operations.</p>
        </div>
        <div className="flex-1" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Mini label="Budget" value={fmtMoney(budget)}/>
          <Mini label="Engineering" value={Math.round(Number(engineeringSupport||0))+"/100"}/>
          <Mini label="Operational Morale" value={Math.round(teamMorale)+"/100"}/>
          <Mini label="Work Rate" value={moraleWorkRate.label}/>
          <Mini label="Engineers Free" value={capacity.available_engineers+"/"+capacity.engineer_pool}/>
        </div>
        {(showCreate||tab==="projects")&&<Button onClick={()=>setShowCreate((v)=>!v)}>{showCreate ? "Close" : "New Project"}</Button>}
      </div>}

      {showCreate && (
        <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-4">
          <div className="flex flex-col xl:flex-row xl:items-start gap-4">
            <div className="xl:w-[46%] space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Current Car Development</div>
                  <div className="text-lg font-semibold">Create design brief</div>
                  <div className="text-sm text-slate-400">Choose the component, technical objective and resources. The preview on the right shows the expected engineering trade-off before you commit.</div>
                </div>
                <Button size="sm" variant="outline" onClick={()=>setShowCreate(false)}>Back to Development</Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="text-sm">
                  <div>Project name</div>
                  <div className="mt-1 border border-white/10 bg-[#0d0f15] rounded px-3 py-2 w-full font-medium text-slate-200">{automaticProjectName}</div>
                  <div className="mt-1 text-[10px] text-slate-500">Generated automatically from component, design objective and version.</div>
                </div>
                <label className="text-sm">Component<select className="mt-1 border border-white/10 bg-[#0d0f15] rounded px-3 py-2 w-full" value={draft.type} onChange={(e)=>{const type=e.target.value;const defaults=defaultAeroAllocation(gameState,teamId,type,dev);setDraft({...draft,type,objective:"balanced",cfd:defaults.cfd,windTunnel:defaults.windTunnel,researchSupport:0});}}>{eraTypes.map((t)=><option key={t} value={t}>{componentLabel(gameState,t)}</option>)}</select></label>
              </div>

              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Design objective</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {objectiveOptions.length?objectiveOptions.map((row)=><button key={row.id} onClick={()=>setDraft({...draft,objective:row.id,researchSupport:0})} className={"rounded-lg border p-3 text-left transition "+(draft.objective===row.id?"border-cyan-300/40 bg-cyan-300/[0.08]":"border-white/10 bg-white/[0.025] hover:bg-white/[0.05]")}>
                    <div className="flex items-center justify-between gap-2"><div className="font-semibold text-sm">{row.label}</div><span className="text-[9px] uppercase text-slate-500">{row.id==="balanced"?"General":"Specialist"}</span></div>
                    <div className="text-[11px] text-slate-500 mt-1">{row.description}</div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      <EffectChip label="Cost" value={(Number(row.cost||1)-1)*100}/>
                      <EffectChip label="Time" value={(Number(row.duration||1)-1)*100}/>
                      <EffectChip label="Risk" value={(Number(row.risk||1)-1)*100}/>
                    </div>
                  </button>):<div className="sm:col-span-2 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] p-3 text-sm text-rose-200">Normal current-car development is not permitted for this component under the {activeYear} rules.</div>}
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-[#0d0f15] p-3">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Development Regulations · {activeYear}</div>
                    <div className="font-semibold text-sm">{regulationProfile.label}</div>
                    <div className="text-[11px] text-slate-500 mt-1">{regulationProfile.note}</div>
                  </div>
                  <span className={"rounded px-2 py-1 text-[10px] font-semibold h-fit "+(componentRule.rule==="free"?"bg-emerald-500/10 text-emerald-300":componentRule.can_start_project?"bg-amber-500/10 text-amber-300":"bg-rose-500/10 text-rose-300")}>{componentRule.label}</span>
                </div>
                <div className="mt-2 text-[11px] text-slate-400">{componentRule.reason}</div>
                {regulationProfile.hard_quota&&regulationProfile.period?<div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                  <Mini label={"ATP "+regulationProfile.period.number+"/6"} value={regulationProfile.period.start+" → "+regulationProfile.period.end}/>
                  <Mini label="ATR coefficient" value={regulationProfile.coefficient+"%"}/>
                  <Mini label="Wind-on remaining" value={Number(atrRemaining.wind_tunnel_hours_remaining||0).toFixed(1)+"h"}/>
                  <Mini label="CFD remaining" value={Number(atrRemaining.cfd_mauh_remaining||0).toFixed(2)+" MAUh"}/>
                </div>:null}
              </div>

              <div className="rounded-lg border border-white/10 bg-[#0d0f15] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Research Support</div>
                    <div className="font-semibold text-sm">{researchArea?.label||"Technical Research"}</div>
                    <div className="text-[11px] text-slate-500 mt-1">Spend banked Research Points on this design. They reduce development time and risk and give a small expected-performance boost. Points are consumed when the project starts.</div>
                  </div>
                  <span className="rounded bg-cyan-500/10 px-2 py-1 text-xs text-cyan-200">{Number(researchArea?.points||0).toFixed(1)} RP available</span>
                </div>
                <div className="mt-3 grid grid-cols-[1fr_auto] gap-3 items-center">
                  <input className="w-full" type="range" min="0" max={Math.min(15,Number(researchArea?.points||0))} step="0.5" value={Math.min(Number(draft.researchSupport||0),Math.min(15,Number(researchArea?.points||0)))} onChange={(e)=>setDraft({...draft,researchSupport:Number(e.target.value)})}/>
                  <strong className="tabular-nums">{researchSupport.points_used.toFixed(1)} RP</strong>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <span className="rounded bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300">Time {((researchSupport.duration_multiplier-1)*100).toFixed(0)}%</span>
                  <span className="rounded bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300">Risk −{(researchSupport.risk_reduction*100).toFixed(1)} pp</span>
                  <span className="rounded bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300">Expected gain +{((researchSupport.performance_multiplier-1)*100).toFixed(1)}%</span>
                </div>
              </div>

              <div className={"grid grid-cols-2 "+(aeroAllocation.aero_relevant?"md:grid-cols-4":"md:grid-cols-2")+" gap-3"}>
                <label className="text-sm">Engineers<input type="number" min="1" max={Math.max(1,capacity.available_engineers)} className="mt-1 border border-white/10 bg-[#0d0f15] rounded px-3 py-2 w-full" value={draft.engineers} onChange={(e)=>setDraft({...draft,engineers:Number(e.target.value)})}/></label>
                <label className="text-sm">Base days<input type="number" min="7" max="90" className="mt-1 border border-white/10 bg-[#0d0f15] rounded px-3 py-2 w-full" value={draft.duration} onChange={(e)=>setDraft({...draft,duration:Number(e.target.value)})}/></label>
                {aeroAllocation.aero_relevant&&regulationProfile.cfd_available?<label className="text-sm">CFD · {regulationProfile.cfd_unit}<input type="number" min="0" step={regulationProfile.scheme==="fia_atr"?"0.05":"1"} max={regulationProfile.hard_quota?Math.max(0,Number(atrRemaining.cfd_mauh_remaining||0)):200} className="mt-1 border border-white/10 bg-[#0d0f15] rounded px-3 py-2 w-full" value={draft.cfd} onChange={(e)=>setDraft({...draft,cfd:Number(e.target.value)})}/>{regulationProfile.hard_quota?<div className="mt-1 text-[10px] text-slate-500">After project: {Math.max(0,Number(atrRemaining.cfd_mauh_remaining||0)-Number(draft.cfd||0)).toFixed(2)} MAUh</div>:null}</label>:null}
                {aeroAllocation.aero_relevant&&regulationProfile.wind_tunnel_available?<label className="text-sm">Wind tunnel · {regulationProfile.wind_tunnel_unit}<input type="number" min="0" step="0.5" max={regulationProfile.hard_quota?Math.max(0,Number(atrRemaining.wind_tunnel_hours_remaining||0)):100} className="mt-1 border border-white/10 bg-[#0d0f15] rounded px-3 py-2 w-full" value={draft.windTunnel} onChange={(e)=>setDraft({...draft,windTunnel:Number(e.target.value)})}/>{regulationProfile.hard_quota?<div className="mt-1 text-[10px] text-slate-500">After project: {Math.max(0,Number(atrRemaining.wind_tunnel_hours_remaining||0)-Number(draft.windTunnel||0)).toFixed(1)}h</div>:<div className="mt-1 text-[10px] text-slate-500">No FIA quota · team facility capacity only</div>}</label>:null}
              </div>
              {!aeroAllocation.aero_relevant?<div className="text-xs text-slate-500">This component does not consume CFD or wind-tunnel allocation in the current model.</div>:null}
              {aeroAllocation.aero_relevant&&!regulationProfile.cfd_available?<div className="text-xs text-slate-500">CFD is not available in {activeYear}. Aerodynamic development relies on physical wind-tunnel work and engineering.</div>:null}

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
                <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                  {capacity.available_engineers}/{capacity.engineer_pool} engineers available · {capacity.active_projects}/{capacity.max_projects} concurrent project slots used
                  <InfoPopover title="Concurrent project capacity" align="right">
                    Project slots limit how many design projects can occupy the Technical Department at the same time. They are not a season allowance: completed projects free their slot immediately, while paused projects still occupy one. Facilities currently cap this at {capacity.max_projects} simultaneous projects for this TEAM.
                  </InfoPopover>
                </span>
              </div>
              {!componentRule.can_start_project&&<div className="text-sm text-rose-300">{componentRule.reason}</div>}
              {!aeroAllocation.allowed&&<div className="text-sm text-rose-300">{aeroAllocation.reason==="wind_tunnel_quota"?"Wind-tunnel allocation exceeds the remaining ATR allowance.":"CFD allocation exceeds the remaining ATR allowance."}</div>}
              {!hasEngineerCapacity&&<div className="text-sm text-rose-300">Not enough free engineers for this brief.</div>}
              {!capacity.project_slot_available&&<div className="text-sm text-rose-300">Technical project capacity is full. Complete or free a project slot first.</div>}
              {strengthTarget.increment<=0&&<div className="text-sm text-amber-300">This component has reached the current-car development ceiling.</div>}
              {!testDriverProfile&&<div className="text-sm text-amber-300">No dedicated Test Driver is contracted. Result uncertainty will be higher.</div>}
              {budget<cost&&<div className="text-sm text-rose-300">Insufficient budget for this project.</div>}
            </div>

            <div className="xl:flex-1 rounded-xl border border-white/10 bg-[#0d0f15] overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10">
                <div className="text-xs uppercase tracking-wide text-slate-500">Design Projection</div>
                <div className="font-semibold">{componentLabel(gameState,draft.type)} · {objective?.label||componentRule.label}</div>
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

      {!showCreate && <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Project Slots" value={capacity.active_projects+"/"+capacity.max_projects}/>
        <Stat label="Completed Projects" value={projects.filter((p)=>p.status==="completed").length}/>
        <Stat label="Blueprints" value={parts.length}/>
        <Stat label="Manufacturing" value={manufacturing.filter((m)=>m.status==="active").length + workshop.length}/>
      </div>}

      {!showCreate && <div className="rounded-xl border border-white/10 bg-[#12141c] p-3 flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {[
            ["projects","Current Car"],
            ["next_season","Next Season Car"],
            ["manufacturing","Manufacturing"],
            ["parts","Blueprints"],
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
        {embedded && (showCreate||tab==="projects") && <Button size="sm" onClick={()=>setShowCreate((v)=>!v)}>{showCreate ? "Close" : "New Project"}</Button>}
      </div>}

      {!showCreate && tab==="projects" && (
        <div className="grid grid-cols-1 gap-2">
          <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Current Car</div>
                <div className="font-semibold">Design projects</div>
              </div>
              <InfoPopover title="Current Car projects">
                Active and paused design briefs for the car you are racing now. Completing a project creates an engineering Blueprint; it does not create a physical part until that Blueprint is manufactured.
              </InfoPopover>
            </div>
          </CardContent></Card>
          {projects.map((p)=>{
            const progress = projectProgress(p,currentDateISO);
            const projection=p.technical_projection||null;
            const result=p.technical_result||null;
            const currentStrength=Number(p.current_design_perf||0);
            const targetStrength=Number(p.target_design_perf??p.perf_delta??0);
            const actualStrength=Number(p.actual_design_perf??targetStrength);
            return <Card className="!bg-[#12141c] !border-white/10 !text-slate-100" key={p.id}><CardContent className="p-4 space-y-3">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2">
                <div>
                  <div className="text-xs text-slate-400">{componentLabel(gameState,p.type)} · {p.objective_label||"Legacy development"} · {nice(p.phase)}</div>
                  <div className="font-semibold">{p.name}</div>
                </div>
                <div className="flex items-center gap-2">
                  {p.status==="completed"&&p.result_rating&&p.result_rating!=="legacy"?<ResultPill result={p.result_rating}/>:null}
                  <span className="text-xs rounded bg-white/10 px-2 py-1 h-fit">{nice(p.status)}</span>
                </div>
              </div>
              <div><div className="flex justify-between text-sm"><span>Progress</span><strong>{Math.round(progress*100)}%</strong></div><div className="h-2 mt-1 bg-white/10 rounded overflow-hidden"><div className="h-full bg-slate-200" style={{width:`${progress*100}%`}}/></div></div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
                <Mini label="Engineers" value={p.engineers}/>
                <Mini label="CFD" value={p.cfd_allocation?(`${p.cfd_allocation} ${p.cfd_unit||"h"}`):"—"}/>
                <Mini label="WT" value={Number(p.wt_hours||0)>0?`${p.wt_hours}h`:"—"}/>
                <Mini label="Risk" value={p.risk!=null?(Number(p.risk)*100).toFixed(0)+"%":"—"}/>
                <Mini label={p.status==="completed"?"Actual strength":"Target strength"} value={(p.status==="completed"?actualStrength:targetStrength).toFixed(2)}/>
              </div>
              {projection?<div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <ProjectDelta label="Weight" current={projection.current?.design?.weight_kg} proposed={(result||projection)?.design?.weight_kg} suffix=" kg" lowerBetter/>
                <ProjectDelta label="Drag" current={projection.current?.design?.drag} proposed={(result||projection)?.design?.drag} digits={4} lowerBetter/>
                <ProjectDelta label="Downforce" current={projection.current?.design?.downforce} proposed={(result||projection)?.design?.downforce} digits={4}/>
                <ProjectDelta label="Reliability" current={Number(projection.current?.design?.reliability||0)*100} proposed={Number((result||projection)?.design?.reliability||0)*100} suffix="%" digits={1}/>
              </div>:null}
              <div className="text-xs text-slate-400">{p.started_at} → {p.finishes_at} · <span className="text-rose-300">{fmtMoney(p.cost)}</span> · Design {currentStrength.toFixed(2)} → {targetStrength.toFixed(2)}{p.status==="completed"&&Math.abs(actualStrength-targetStrength)>=0.005?` · actual ${actualStrength.toFixed(2)}`:""}</div>
              {p.test_driver_name && <div className="text-xs text-slate-400">Validation: {p.test_driver_name} · feedback {Math.round(Number(p.test_driver_feedback||0))}/100</div>}
              {p.status!=="completed" && <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={()=>toggleProjectPause(p)}>{p.status==="paused"?"Resume":"Pause"}</Button>
                <span className="text-xs text-slate-500 self-center">Design brief is locked once the project starts.</span>
              </div>}
            </CardContent></Card>;
          })}
          {!projects.length && <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-5 text-sm text-slate-400">No development projects yet. Start one with “New Project”.</CardContent></Card>}
        </div>
      )}

      {!showCreate && tab==="parts" && (
        <div className="space-y-3">
          <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Engineering</div>
                <div className="font-semibold">Blueprints</div>
              </div>
              <InfoPopover title="What is a Blueprint?">
                A Blueprint is the approved specification created by a completed development project. It is not a physical part. Use Manufacture to create physical units; those units can then sit in the warehouse or be fitted to Car 1 / Car 2.
              </InfoPopover>
            </div>
          </CardContent></Card>
          <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-0 overflow-x-auto"><table className="min-w-full text-sm">
            <thead className="bg-[#171a23] text-slate-300"><tr><th className="px-3 py-2 text-left">Blueprint</th><th className="px-3 py-2 text-left">Component</th><th className="px-3 py-2 text-left">Version</th><th className="px-3 py-2 text-right">Design strength</th><th className="px-3 py-2 text-right">Physical units</th><th className="px-3 py-2 text-right">Manufacture</th></tr></thead>
            <tbody>{parts.map((p)=>{
              const warehouse=warehousePartUnitsForDesign(physicalState,p.id);
              const allUnits=partUnitsForDesign(physicalState,p.id);
              const fitted=Math.max(0,allUnits.length-warehouse.length);
              const manufactureQuote=partManufactureQuote(physicalState,p);
              const technical=derivePartTechnicalProfile(physicalState,p);
              return <tr key={p.id} className="border-t border-white/10">
                <td className="px-3 py-2 font-medium"><div>{p.name}</div><div className="text-[10px] text-slate-500">{technical.impact_area} · {technical.design.weight_kg.toFixed(1)} kg · DF {technical.design.downforce.toFixed(3)} · Drag {technical.design.drag.toFixed(3)} · Rel {(technical.design.reliability*100).toFixed(1)}%</div></td>
                <td className="px-3 py-2">{componentLabel(gameState,p.slot)}</td>
                <td className="px-3 py-2">{p.version||"—"}</td>
                <td className="px-3 py-2 text-right"><div>+{Number(p.perf||0).toFixed(2)}</div><div className="text-[10px] text-slate-500">{p.development_focus?nice(p.development_focus):"Balanced"}</div></td>
                <td className="px-3 py-2 text-right"><div>{allUnits.length} total{p.in_manufacturing? ` (+${p.in_manufacturing} building)`:""}</div><div className="text-[10px] text-slate-500">{fitted} fitted · {warehouse.length} warehouse</div></td>
                <td className="px-3 py-2 text-right"><Button size="sm" className="border border-emerald-400/30 !bg-emerald-500/10 !text-emerald-200 hover:!bg-emerald-500/20" onClick={()=>manufacture(p)} disabled={budget<Number(manufactureQuote.cost||0)}>Manufacture · {manufactureQuote.days}d · <span className="ml-1 rounded bg-rose-500/15 px-1 text-rose-300">{fmtMoney(manufactureQuote.cost)}</span></Button></td>
              </tr>;
            })}
            {!parts.length&&<tr><td colSpan={6} className="px-3 py-5 text-center text-slate-400">Complete a Current Car design project to create your first blueprint.</td></tr>}</tbody>
          </table></CardContent></Card>
        </div>
      )}

      {!showCreate && tab==="manufacturing" && (
        <div className="space-y-3">
          <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Physical Production</div>
                <div className="font-semibold">Manufacturing & Workshop</div>
              </div>
              <InfoPopover title="What appears here?">
                Blueprint Production contains newly developed physical parts ordered from Blueprints. Car Workshop is directly linked to Car 1 / Car 2 actions: restore, build, build & fit, standard spares, developed-part restoration and reserve-car work all enter the same workshop queue.
              </InfoPopover>
            </div>
          </CardContent></Card>
          <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-0 overflow-x-auto">
            <div className="px-3 py-3 border-b border-white/10 flex items-center gap-2"><div className="font-semibold">Blueprint Production</div><InfoPopover title="Blueprint Production">Physical units ordered from Blueprints are manufactured here. When the batch finishes, the new units enter inventory and can be fitted to Car 1 / Car 2 or kept as spares.</InfoPopover></div>
            <table className="min-w-full text-sm">
            <thead className="bg-[#171a23] text-slate-300"><tr><th className="px-3 py-2 text-left">Batch</th><th className="px-3 py-2 text-left">Started</th><th className="px-3 py-2 text-left">ETA</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Cost</th><th className="px-3 py-2 text-left">Status</th></tr></thead>
            <tbody>{manufacturing.map((m)=><tr key={m.id} className="border-t border-white/10"><td className="px-3 py-2 font-medium">{m.title}</td><td className="px-3 py-2">{m.started_at}</td><td className="px-3 py-2">{m.finishes_at}</td><td className="px-3 py-2 text-right">{m.qty}</td><td className="px-3 py-2 text-right"><span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-300">{fmtMoney(Number(m.unit_cost||0)*Number(m.qty||1))}</span></td><td className="px-3 py-2">{nice(m.status)}</td></tr>)}
            {!manufacturing.length&&<tr><td colSpan={6} className="px-3 py-5 text-center text-slate-400">No manufacturing batches.</td></tr>}</tbody>
          </table></CardContent></Card>
          <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-0 overflow-x-auto">
            <div className="px-3 py-3 border-b border-white/10 flex items-center gap-2"><div className="font-semibold">Car Workshop</div><InfoPopover title="Car Workshop queue">Jobs started from Car 1 / Car 2 are shown here and use real in-game time. This includes restoration, replacement/build work, standard spares, developed-part restoration and reserve-car construction.</InfoPopover></div>
            <table className="min-w-full text-sm"><thead className="bg-[#171a23] text-slate-300"><tr><th className="px-3 py-2 text-left">Job</th><th className="px-3 py-2 text-left">Started</th><th className="px-3 py-2 text-left">ETA</th><th className="px-3 py-2 text-right">Cost</th><th className="px-3 py-2 text-left">Status</th></tr></thead>
              <tbody>{(physicalState?.garage?.serviceJobs||[]).map((job)=><tr key={job.id} className="border-t border-white/10"><td className="px-3 py-2 font-medium">{job.title||nice(job.kind)}</td><td className="px-3 py-2">{job.started_at}</td><td className="px-3 py-2">{job.finishes_at}</td><td className="px-3 py-2 text-right"><span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-300">{fmtMoney(job.cost)}</span></td><td className="px-3 py-2">{nice(job.status)}</td></tr>)}
              {!(physicalState?.garage?.serviceJobs||[]).length&&<tr><td colSpan={5} className="px-3 py-5 text-center text-slate-400">No workshop jobs.</td></tr>}</tbody>
            </table>
          </CardContent></Card>
        </div>
      )}

      {!showCreate && tab==="next_season" && (
        <div className="space-y-3">
          <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-4">
            <div className="flex flex-col lg:flex-row lg:items-center gap-4">
              <div className="flex items-center gap-2">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Strategic Technical Programme</div>
                  <div className="font-semibold">Next Season Car · {nextSeasonCar.targetSeason}</div>
                </div>
                <InfoPopover title="Next Season Car">
                  This is the technical programme for the following season. It does not use a Current Car Project Slot, but allocated engineers are shared with the current-car development department. Progress is driven by the game clock.
                </InfoPopover>
              </div>
              <div className="lg:flex-1"/>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <Mini label="Target" value={String(nextSeasonCar.targetSeason)}/>
                <Mini label="Status" value={nice(nextSeasonCar.status)}/>
                <Mini label="Phase" value={nice(nextSeasonCar.phase)}/>
                <Mini label="Progress" value={Number(nextSeasonCar.overall_progress||0).toFixed(1)+"%"}/>
                <Mini label="Engineers" value={String(nextSeasonCar.engineers||0)}/>
              </div>
            </div>
          </CardContent></Card>

          <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-4 space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-start gap-4">
              <div className="flex items-start gap-2 lg:w-[42%]">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Target Regulations</div>
                  <div className="font-semibold">{nextSeasonImpact.label} · {nextSeasonImpact.targetSeason}</div>
                  <div className="text-xs text-slate-500 mt-1">{nextSeasonImpact.governance.note}</div>
                </div>
                <InfoPopover title="Regulation impact">
                  The next-season car uses the already-known technical rules for its target season. New regulation votes cannot take effect next season; they require at least two seasons of lead time. Minor, Medium and Major describe how much the target technical rules differ from the current season.
                </InfoPopover>
              </div>
              <div className="lg:flex-1 grid grid-cols-2 md:grid-cols-4 gap-2">
                <Mini label="Impact" value={nextSeasonImpact.label}/>
                <Mini label="Changes" value={String(nextSeasonImpact.changes.length)}/>
                <Mini label="Rules locked" value={nextSeasonImpact.governance.next_season_locked?"Yes":"No"}/>
                <Mini label="Earliest new vote" value={String(nextSeasonImpact.governance.minimum_vote_effective_season)}/>
              </div>
            </div>

            {nextSeasonImpact.changes.length ? (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
                {nextSeasonImpact.changes.map((change,index)=><div key={change.id||change.type+"_"+index} className="rounded-lg border border-white/10 bg-[#0d0f15] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-sm">{change.title}</div>
                    <span className="rounded bg-amber-500/10 px-2 py-1 text-[10px] uppercase tracking-wide text-amber-200">{nice(change.area||"multiple")}</span>
                  </div>
                  {change.detail?<div className="text-[11px] text-slate-500 mt-1">{change.detail}</div>:null}
                </div>)}
              </div>
            ) : (
              <div className="rounded-lg border border-emerald-400/15 bg-emerald-500/[0.05] p-3 text-sm text-emerald-200">
                No structural technical-rule changes are detected between {nextSeasonImpact.currentSeason} and {nextSeasonImpact.targetSeason}. The programme can carry current technical knowledge forward without a regulation-reset penalty.
              </div>
            )}

            {nextSeasonImpactAreas.length ? <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-2">Knowledge carry-over preview</div>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
                {nextSeasonImpactAreas.map((row)=><Mini key={row.area} label={nice(row.area)} value={row.retention.percent+"%"}/>)}
              </div>
              <div className="text-[11px] text-slate-500 mt-2">This regulation-retention ceiling is now applied to the team's live Technical Knowledge before Concept and Design convert it into the projected next-season package.</div>
            </div>:null}
          </CardContent></Card>

          <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-4 space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center gap-4">
              <div className="flex items-center gap-2">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Technical Knowledge</div>
                  <div className="font-semibold">Current expertise → transferable expertise</div>
                </div>
                <InfoPopover title="Technical Knowledge & Carry-over">
                  Technical Knowledge is persistent team know-how built from the current career state, Research and completed development projects. Regulation changes can reduce how much of that knowledge transfers to the target car; physical parts themselves are not carried over.
                </InfoPopover>
              </div>
              <div className="lg:flex-1"/>
              <div className="grid grid-cols-3 gap-2">
                <Mini label="Current avg." value={nextSeasonKnowledge.current_average.toFixed(1)}/>
                <Mini label="Retained avg." value={nextSeasonKnowledge.retained_average.toFixed(1)}/>
                <Mini label="Carry-over" value={nextSeasonKnowledge.retention_percent.toFixed(1)+"%"}/>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
              {nextSeasonKnowledge.rows.map((row)=><div key={row.id} className="rounded-lg border border-white/10 bg-[#0d0f15] p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">{row.label}</div>
                <div className="mt-1 flex items-end gap-1.5 tabular-nums">
                  <strong className="text-base">{row.current_level.toFixed(1)}</strong>
                  <span className="text-slate-600">→</span>
                  <strong className={row.regulation_retention_percent<100?"text-amber-200":"text-emerald-200"}>{row.retained_level.toFixed(1)}</strong>
                </div>
                <div className="mt-1 text-[10px] text-slate-500">{row.regulation_retention_percent}% regulation retention</div>
              </div>)}
            </div>
            <div className="text-[11px] text-slate-500">
              Opening calibration: staff {Number(technicalKnowledge.opening_context?.staff_quality||0).toFixed(0)}/100 · facilities {Number(technicalKnowledge.opening_context?.facility_quality||0).toFixed(0)}/100. From this point onward, the ledger evolves from the simulated career.
            </div>
          </CardContent></Card>

          <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-4 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center gap-4">
              <div className="flex items-center gap-2">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Concept & Design</div>
                  <div className="font-semibold">{nextSeasonTechnicalPackage.philosophy.label} technical package</div>
                  <div className="text-xs text-slate-500 mt-1">{nextSeasonTechnicalPackage.philosophy.tradeoff}</div>
                </div>
                <InfoPopover title="Projected Technical Package">
                  Concept converts retained knowledge into a technical direction. Design then turns that direction into a projected package. The displayed uncertainty is not daily randomness: it narrows as engineering maturity increases. Current-season carStats are not changed by these projections.
                </InfoPopover>
              </div>
              <div className="lg:flex-1"/>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Mini label="Concept quality" value={nextSeasonTechnicalPackage.concept.quality.toFixed(1)}/>
                <Mini label="Concept maturity" value={nextSeasonTechnicalPackage.concept.maturity.toFixed(0)+"%"}/>
                <Mini label="Design maturity" value={nextSeasonTechnicalPackage.design.maturity.toFixed(0)+"%"}/>
                <Mini label="Confidence" value={nextSeasonTechnicalPackage.overall.confidence.toFixed(0)+"%"}/>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {nextSeasonTechnicalPackage.rows.map((row)=><div key={row.id} className="rounded-lg border border-white/10 bg-[#0d0f15] p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs uppercase tracking-wide text-slate-500">{row.label}</div>
                  {row.applicable===false?<span className="text-[10px] text-slate-600">Not applicable · {nextSeasonTechnicalPackage.targetSeason}</span>:Math.abs(Number(row.philosophy_bias||0))>=0.05?<span className={Number(row.philosophy_bias)>0?"text-[10px] text-emerald-300":"text-[10px] text-amber-300"}>{Number(row.philosophy_bias)>0?"+":""}{Number(row.philosophy_bias).toFixed(1)} philosophy</span>:null}
                </div>
                {row.applicable===false?<div className="mt-3 text-xs text-slate-600">Excluded from package averages and Integration because this technical family is outside the target-season architecture.</div>:<>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                    <div><div className="text-[9px] uppercase text-slate-600">Knowledge</div><div className="font-semibold tabular-nums">{row.retained_knowledge.toFixed(1)}</div></div>
                    <div><div className="text-[9px] uppercase text-slate-600">Concept target</div><div className="font-semibold tabular-nums">{row.concept_target.toFixed(1)}</div></div>
                    <div><div className="text-[9px] uppercase text-slate-600">Projected</div><div className="font-semibold tabular-nums text-cyan-200">{row.projected.toFixed(1)}</div></div>
                  </div>
                  <div className="mt-2 text-[10px] text-slate-500 text-center">Range {row.range_low.toFixed(1)}–{row.range_high.toFixed(1)} · ±{row.uncertainty.toFixed(1)}</div>
                </>}
              </div>)}
            </div>
            <div className="rounded-lg border border-white/10 bg-[#0d0f15] p-3 flex flex-col md:flex-row md:items-center gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Projected package average</div>
                <div className="text-xl font-semibold tabular-nums">{nextSeasonTechnicalPackage.overall.projected.toFixed(1)} <span className="text-sm text-slate-500">± {nextSeasonTechnicalPackage.overall.uncertainty.toFixed(1)}</span></div>
              </div>
              <div className="md:flex-1"/>
              <div className="text-[11px] text-slate-500 max-w-xl">{nextSeasonTechnicalPackage.design.locked?"Design baseline locked at 60%. Later Research cannot rewrite completed Design.":"Design remains live until 60%, when its baseline is locked for Integration."}</div>
            </div>
          </CardContent></Card>

          <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-4 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center gap-4">
              <div className="flex items-center gap-2">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Integration</div>
                  <div className="font-semibold">Systems coherence & packaging</div>
                  <div className="text-xs text-slate-500 mt-1">Strong individual systems still need to work together as one car.</div>
                </div>
                <InfoPopover title="Integration">
                  Integration evaluates package balance, aero/chassis correlation, powertrain/cooling margin, hybrid integration where applicable, packaging and systems compatibility. Poor coherence can reduce how much Design potential survives. Design locks at 60%; Integration locks at 85%.
                </InfoPopover>
              </div>
              <div className="lg:flex-1"/>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <Mini label="Maturity" value={nextSeasonTechnicalPackage.integration.maturity.toFixed(0)+"%"}/>
                <Mini label="Quality" value={nextSeasonTechnicalPackage.integration.quality==null?"Pending":nextSeasonTechnicalPackage.integration.quality.toFixed(1)}/>
                <Mini label="Projected" value={nextSeasonTechnicalPackage.integration.projected_quality.toFixed(1)}/>
                <Mini label="Packaging" value={nextSeasonTechnicalPackage.integration.packaging_quality.toFixed(1)}/>
                <Mini label="Systems" value={nextSeasonTechnicalPackage.integration.systems_compatibility.toFixed(1)}/>
              </div>
            </div>

            {nextSeasonTechnicalPackage.integration.bottlenecks.length?<div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {nextSeasonTechnicalPackage.integration.bottlenecks.map((issue)=><div key={issue.id} className={"rounded-lg border p-3 "+(issue.severity==="major"?"border-rose-400/20 bg-rose-500/[0.05]":issue.severity==="medium"?"border-amber-400/20 bg-amber-500/[0.05]":"border-white/10 bg-[#0d0f15]")}>
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-sm">{issue.title}</strong>
                  <span className="text-[10px] uppercase tracking-wide text-slate-400">{nice(issue.severity)}</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-1">{issue.detail}</div>
              </div>)}
            </div>:<div className="rounded-lg border border-white/10 bg-[#0d0f15] p-3 text-sm text-slate-500">
              {nextSeasonTechnicalPackage.integration.maturity>0?"No material integration bottlenecks detected at the current package state.":String(nextSeasonTechnicalPackage.integration.all_projected_bottlenecks.length)+" projected bottleneck(s) will be evaluated once Integration begins."}
            </div>}

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
              {nextSeasonTechnicalPackage.rows.filter((row)=>row.applicable!==false).map((row)=><div key={row.id} className="rounded-lg border border-white/10 bg-[#0d0f15] p-2">
                <div className="text-[9px] uppercase tracking-wide text-slate-500">{row.label}</div>
                <div className="mt-1 text-sm tabular-nums"><span className="text-slate-500">{row.projected.toFixed(1)}</span> <span className="text-slate-700">→</span> <strong className={Number(row.integration_penalty||0)>0.2?"text-amber-200":"text-emerald-200"}>{row.integrated_projected.toFixed(1)}</strong></div>
                <div className="text-[9px] text-slate-600 mt-0.5">{Number(row.integration_penalty||0)>0.05?"-"+Number(row.integration_penalty).toFixed(2)+" integration":"No material loss"}</div>
              </div>)}
            </div>
            {nextSeasonTechnicalPackage.integration.locked?<div className="text-[11px] text-emerald-300/80">Integration baseline locked at 85%. Validation now tests this fixed integrated package.</div>:null}
          </CardContent></Card>

          <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-4 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center gap-4">
              <div className="flex items-center gap-2">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Validation</div>
                  <div className="font-semibold">Correlation & technical sign-off</div>
                  <div className="text-xs text-slate-500 mt-1">Validation confirms or revises the integrated projection and closes uncertainty.</div>
                </div>
                <InfoPopover title="Validation">
                  Validation is deterministic. It uses Integration quality, bottlenecks, staff, facilities, engineering support and philosophy complexity; there is no hidden random roll. As maturity rises, the package converges on validated values and uncertainty narrows.
                </InfoPopover>
              </div>
              <div className="lg:flex-1"/>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Mini label="Maturity" value={nextSeasonTechnicalPackage.validation.maturity.toFixed(0)+"%"}/>
                <Mini label="Support" value={nextSeasonTechnicalPackage.validation.support_quality.toFixed(1)}/>
                <Mini label="Confidence" value={nextSeasonTechnicalPackage.validation.confidence.toFixed(1)+"%"}/>
                <Mini label="Uncertainty" value={"± "+nextSeasonTechnicalPackage.validation.uncertainty.toFixed(2)}/>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
              {nextSeasonTechnicalPackage.rows.filter((row)=>row.applicable!==false).map((row)=><div key={row.id} className="rounded-lg border border-white/10 bg-[#0d0f15] p-2">
                <div className="text-[9px] uppercase tracking-wide text-slate-500">{row.label}</div>
                <div className="mt-1 text-sm tabular-nums"><span className="text-slate-500">{row.integrated_projected.toFixed(1)}</span> <span className="text-slate-700">→</span> <strong className="text-cyan-200">{row.validated.toFixed(1)}</strong></div>
                <div className="text-[9px] text-slate-600 mt-0.5">Range {row.validated_range_low.toFixed(1)}–{row.validated_range_high.toFixed(1)}</div>
              </div>)}
            </div>

            {nextSeasonTechnicalPackage.validation.discoveries.length?<div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {nextSeasonTechnicalPackage.validation.discoveries.map((finding)=><div key={finding.id} className={"rounded-lg border p-3 "+(finding.severity==="positive"?"border-emerald-400/20 bg-emerald-500/[0.05]":finding.severity==="medium"?"border-amber-400/20 bg-amber-500/[0.05]":"border-white/10 bg-[#0d0f15]")}>
                <div className="font-medium text-sm">{finding.title}</div>
                <div className="text-[11px] text-slate-500 mt-1">{finding.detail}</div>
              </div>)}
            </div>:nextSeasonTechnicalPackage.validation.maturity>0?<div className="rounded-lg border border-emerald-400/15 bg-emerald-500/[0.04] p-3 text-sm text-emerald-200">Validation is tracking the integrated projection without a material technical revision so far.</div>:null}

            <div className="rounded-lg border border-white/10 bg-[#0d0f15] p-3 flex flex-col md:flex-row md:items-center gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Package status</div>
                <div className="font-semibold">{nice(nextSeasonTechnicalPackage.readiness)}</div>
              </div>
              <div className="md:flex-1"/>
              <div className="grid grid-cols-2 gap-2 min-w-[250px]">
                <Mini label="Integrated avg." value={nextSeasonTechnicalPackage.overall.integrated_projected.toFixed(1)}/>
                <Mini label="Validated avg." value={nextSeasonTechnicalPackage.overall.validated.toFixed(1)}/>
              </div>
            </div>
          </CardContent></Card>

          {nextSeasonCar.status==="not_started" ? (
            <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-4 space-y-4">
              <div>
                <div className="font-semibold">Launch {nextSeasonCar.targetSeason} programme</div>
                <div className="text-sm text-slate-400 mt-1">Choose the technical philosophy and engineering commitment. Philosophy is locked when the programme starts; engineers can still be reallocated later.</div>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Technical Philosophy</div>
                  <InfoPopover title="Technical Philosophy">
                    Philosophy changes the technical targets and trade-offs of the new car. It is not a free performance bonus: stronger emphasis in one area can reduce margins elsewhere and increases integration complexity for more aggressive concepts.
                  </InfoPopover>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                  {NEXT_SEASON_TECHNICAL_PHILOSOPHIES.map((row)=>{
                    const active=nextSeasonPhilosophyId===row.id;
                    return <button key={row.id} onClick={()=>setNextSeasonPhilosophyId(row.id)} className={"rounded-lg border p-3 text-left transition "+(active?"border-cyan-300/40 bg-cyan-300/[0.08]":"border-white/10 bg-[#0d0f15] hover:bg-white/[0.04]")}>
                      <div className="flex items-center justify-between gap-2">
                        <strong className="text-sm">{row.label}</strong>
                        <span className="text-[10px] text-slate-500">Complexity {Number(row.complexity).toFixed(1)}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">{row.description}</div>
                      <div className="text-[10px] text-amber-200/80 mt-2">{row.tradeoff}</div>
                    </button>;
                  })}
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-end">
                <div className="lg:col-span-2 rounded-lg border border-white/10 bg-[#0d0f15] p-3">
                  <div className="flex items-center justify-between text-sm"><span>Engineering allocation</span><strong>{nextSeasonDraftEngineers} engineers</strong></div>
                  <input
                    className="w-full mt-3"
                    type="range"
                    min="1"
                    max={nextSeasonDraftMax}
                    step="1"
                    value={Math.min(nextSeasonDraftEngineers,nextSeasonDraftMax)}
                    onChange={(e)=>setNextSeasonDraftEngineers(Number(e.target.value))}
                  />
                  <div className="mt-2 text-xs text-slate-500">{nextSeasonBaseCapacity.available_engineers} engineers currently available · Current Car slots remain {capacity.active_projects}/{capacity.max_projects}.</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-[#0d0f15] p-3 space-y-2">
                  <Mini label="Programme launch" value={fmtMoney(nextSeasonQuote.launch_cost)}/>
                  <Button className="w-full" disabled={!canStartNextSeason} onClick={startNextSeasonProgramme}>Start Programme</Button>
                  {!canStartNextSeason&&budget<nextSeasonQuote.launch_cost?<div className="text-[11px] text-rose-300">Insufficient budget.</div>:null}
                </div>
              </div>
            </CardContent></Card>
          ) : (
            <>
              <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold">Technical programme progress</div>
                    <div className="text-xs text-slate-500 mt-1">Current phase: {nice(nextSeasonCar.phase)} · {Number(nextSeasonCar.phase_progress||0).toFixed(1)}% phase progress</div>
                  </div>
                  {nextSeasonCar.status!=="completed"&&<Button size="sm" variant="outline" onClick={toggleNextSeasonPause}>{nextSeasonCar.status==="paused"?"Resume":"Pause"}</Button>}
                </div>
                <div className="h-2 rounded bg-white/10 overflow-hidden"><div className="h-full bg-cyan-300/70" style={{width:Number(nextSeasonCar.overall_progress||0)+"%"}}/></div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                  {NEXT_SEASON_PHASES.map((phase)=>{
                    const current=phase.id===nextSeasonCar.phase;
                    const phaseOrder=NEXT_SEASON_PHASES.findIndex((row)=>row.id===phase.id);
                    const currentOrder=NEXT_SEASON_PHASES.findIndex((row)=>row.id===nextSeasonCar.phase);
                    const complete=nextSeasonCar.status==="completed"||phaseOrder<currentOrder;
                    return <div key={phase.id} className={"rounded-lg border p-3 "+(current?"border-cyan-300/40 bg-cyan-300/[0.08]":complete?"border-emerald-400/20 bg-emerald-500/[0.05]":"border-white/10 bg-[#0d0f15]")}>
                      <div className="text-xs uppercase tracking-wide text-slate-500">{complete?"Complete":current?"Current":"Upcoming"}</div>
                      <div className="font-semibold mt-1">{phase.label}</div>
                      <div className="text-[11px] text-slate-500 mt-1">{phase.description}</div>
                    </div>;
                  })}
                </div>
              </CardContent></Card>

              <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-4">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-center">
                  <div className="lg:col-span-2">
                    <div className="flex items-center justify-between text-sm"><span>Allocated engineers</span><strong>{nextSeasonCar.engineers||0}/{nextSeasonBaseCapacity.available_engineers}</strong></div>
                    <input
                      className="w-full mt-3"
                      type="range"
                      min="1"
                      max={nextSeasonDraftMax}
                      step="1"
                      disabled={nextSeasonCar.status==="completed"}
                      value={Math.min(Math.max(1,Number(nextSeasonCar.engineers||1)),nextSeasonDraftMax)}
                      onChange={(e)=>updateNextSeasonEngineers(e.target.value)}
                    />
                    <div className="text-xs text-slate-500 mt-2">Next Season Car does not consume a Project Slot. It consumes engineers from the same technical pool as Current Car projects.</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Mini label="Launch cost" value={fmtMoney(nextSeasonCar.launch_cost)}/>
                    <Mini label="Started" value={nextSeasonCar.started_at||"—"}/>
                  </div>
                </div>
                {nextSeasonCar.status==="completed"?<div className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-500/[0.06] p-3 text-sm text-emerald-200">Technical package validated. It remains separate from the current car; Stage 7.7 will materialise it into the following-season baseline.</div>:null}
              </CardContent></Card>
            </>
          )}
        </div>
      )}

      {!showCreate && tab==="research" && (
        <div className="space-y-3">
          <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-4">
            <div className="flex flex-col lg:flex-row lg:items-center gap-4">
              <div className="flex items-center gap-2">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Technical Research</div>
                  <div className="font-semibold">Research Focus & RP</div>
                </div>
                <InfoPopover title="Research Focus & Research Points">
                  Focus always totals 100% across the four technical areas. It determines where daily Research Points are generated. Banked RP can then support matching Current Car projects.
                </InfoPopover>
              </div>
              <div className="lg:flex-1"/>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Mini label="Output" value={researchOutput.total_points_per_day.toFixed(2)+" RP/day"}/>
                <Mini label="Focus" value={research.reduce((sum,row)=>sum+Number(row.focus||0),0).toFixed(0)+"%"}/>
                <Mini label="Banked" value={research.reduce((sum,row)=>sum+Number(row.points||0),0).toFixed(1)+" RP"}/>
              </div>
            </div>
          </CardContent></Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {research.map((r)=>{
              const daily=researchOutput.total_points_per_day*(Number(r.focus||0)/100);
              return <Card className="!bg-[#12141c] !border-white/10 !text-slate-100" key={r.id}><CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2"><div className="font-semibold">{r.label||r.area}</div><InfoPopover title={r.label||r.area}>{r.description} Focus controls this area's share of daily RP generation; banked RP can support matching development projects.</InfoPopover></div>
                  <div className="text-right"><div className="font-semibold tabular-nums">{Number(r.focus||0).toFixed(0)}%</div><div className="text-[10px] text-emerald-300">+{daily.toFixed(2)} RP/day</div></div>
                </div>
                <input className="w-full mt-4" type="range" min="0" max="100" step="5" value={r.focus||0} onChange={(e)=>updateResearch(r.id,e.target.value)}/>
                <div className="mt-3 flex items-center justify-end text-xs">
                  <strong className="text-cyan-200 tabular-nums">{Number(r.points||0).toFixed(1)} RP</strong>
                </div>
              </CardContent></Card>;
            })}
          </div>

          <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Technology Adoption</div>
                <div className="font-semibold">Paddock opportunities</div>
              </div>
              <InfoPopover title="Technology Adoption">
                Rival technologies can be researched independently when they are legal for the era. Adoption unlocks the technical area; it does not create a Blueprint or a physical part.
              </InfoPopover>
            </div>
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
        </div>
      )}

      {!showCreate && tab==="pit_crew" && (
        <div className="space-y-3">
          <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-4">
            <div className="flex flex-col lg:flex-row lg:items-start gap-4">
              <div className="lg:w-[48%] flex items-center gap-2">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Race Operations</div>
                  <div className="font-semibold">Pit Crew Training</div>
                </div>
                <InfoPopover title="Pit Crew Training">
                  Training Load controls long-term skill development and fatigue. Recovery is fatigue-only; Balanced gives modest development with almost neutral fatigue; Intensive and Maximum develop raw skill faster but build fatigue that can hurt race-day execution.
                </InfoPopover>
              </div>
              <div className="lg:flex-1 grid grid-cols-2 md:grid-cols-4 gap-2">
                <Mini label="Training facility" value={"Lv "+pitCrewFacilityLevel}/>
                <Mini label="Current fatigue" value={Number(rawPitCrew.fatigue||0).toFixed(0)+"/100"}/>
                <Mini label="Development speed" value={"×"+pitCrewLoadEffects.development_multiplier.toFixed(2)}/>
                <Mini label="Fatigue / day" value={(pitCrewLoadEffects.fatigue_delta_per_day>=0?"+":"")+pitCrewLoadEffects.fatigue_delta_per_day.toFixed(2)}/>
              </div>
            </div>
          </CardContent></Card>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
            <Card className="!bg-[#12141c] !border-white/10 !text-slate-100 xl:col-span-5"><CardContent className="p-4 space-y-4">
              <div>
                <div className="flex items-center justify-between"><div className="font-semibold">Training Load</div><strong>{Math.round(Number(rawPitCrew.training_load??50))}%</strong></div>
                <input className="w-full mt-3" type="range" min="0" max="100" step="5" value={Number(rawPitCrew.training_load??50)} onChange={(e)=>setPitCrewTrainingLoad(e.target.value)}/>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {PIT_CREW_TRAINING_PRESETS.map((preset)=>{
                  const effects=pitCrewTrainingLoadEffects(preset.load);
                  const active=Number(rawPitCrew.training_load??50)===preset.load;
                  return <button key={preset.id} onClick={()=>setPitCrewTrainingLoad(preset.load)} className={"rounded-lg border p-3 text-left transition "+(active?"border-cyan-300/40 bg-cyan-300/[0.08]":"border-white/10 bg-[#0d0f15] hover:bg-white/[0.04]")}>
                    <div className="flex items-center justify-between gap-2"><span className="font-semibold text-sm">{preset.label}</span><span className="text-xs">{preset.load}%</span></div>
                    <div className="text-[11px] text-slate-500 mt-1">{preset.description}</div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-200">Training ×{effects.development_multiplier.toFixed(2)}</span>
                      <span className={"rounded px-1.5 py-0.5 text-[10px] "+(effects.fatigue_delta_per_day>0?"bg-rose-500/10 text-rose-300":"bg-emerald-500/10 text-emerald-300")}>Fatigue {(effects.fatigue_delta_per_day>=0?"+":"")+effects.fatigue_delta_per_day.toFixed(2)}/day</span>
                    </div>
                  </button>;
                })}
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-500">
                Training modes
                <InfoPopover title="Training modes">
                  Recovery: no raw skill training, only fatigue reduction. Balanced: modest development with near-neutral fatigue. Intensive: faster development with meaningful fatigue. Maximum: strongest raw development with the largest fatigue cost.
                </InfoPopover>
              </div>
            </CardContent></Card>

            <Card className="!bg-[#12141c] !border-white/10 !text-slate-100 xl:col-span-7"><CardContent className="p-4 space-y-4">
              <div className="flex items-center gap-2">
                <div className="font-semibold">Pit Crew Performance</div>
                <InfoPopover title="Race Weekend connection" align="right">
                  Base stop skill is permanent crew ability. Race-day values include current fatigue. The Race Weekend uses the same profile: average stop skill sets stationary-time baseline, Consistency controls stop-to-stop variance, and Error Rate controls operational-mistake probability.
                </InfoPopover>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Mini label="Base stop skill" value={Number(rawPitCrew.avg_time_s??6.8).toFixed(2)+"s"}/>
                <Mini label="Race-day stop" value={Number(effectivePitCrew.avg_time_s??6.8).toFixed(2)+"s"}/>
                <Mini label="Race-day consistency" value={Number(effectivePitCrew.consistency??70).toFixed(1)+"%"}/>
                <Mini label="Race-day error rate" value={(Number(effectivePitCrew.error_rate??0.05)*100).toFixed(1)+"%"}/>
              </div>

              <div className="rounded-lg border border-white/10 bg-[#0d0f15] p-3">
                <div className="flex items-center justify-between gap-3"><div><div className="text-xs uppercase tracking-wide text-slate-500">7-day forecast at current load</div><div className="font-semibold text-sm">{Math.round(Number(rawPitCrew.training_load??50))}% Training Load</div></div><span className="text-xs text-slate-500">Facility Lv {pitCrewFacilityLevel}</span></div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                  <ForecastMini label="Race-day stop" current={Number(effectivePitCrew.avg_time_s??6.8)} future={Number(pitCrewSevenDay.effective.avg_time_s??6.8)} suffix="s" digits={3} lowerBetter/>
                  <ForecastMini label="Consistency" current={Number(effectivePitCrew.consistency??70)} future={Number(pitCrewSevenDay.effective.consistency??70)} suffix="%" digits={2}/>
                  <ForecastMini label="Error rate" current={Number(effectivePitCrew.error_rate??0.05)*100} future={Number(pitCrewSevenDay.effective.error_rate??0.05)*100} suffix="%" digits={2} lowerBetter/>
                  <ForecastMini label="Fatigue" current={Number(rawPitCrew.fatigue||0)} future={Number(pitCrewSevenDay.raw.fatigue||0)} suffix="/100" lowerBetter/>
                </div>
              </div>


            </CardContent></Card>
          </div>
        </div>
      )}
    </div>
  );
}

function EffectChip({label,value}){
  const amount=Number(value||0);
  const neutral=Math.abs(amount)<0.05;
  const good=label==="Risk"?amount<0:amount<=0;
  return <span className={"rounded px-1.5 py-0.5 text-[9px] "+(neutral?"bg-white/5 text-slate-500":good?"bg-emerald-500/10 text-emerald-300":"bg-amber-500/10 text-amber-300")}>{label} {amount>0?"+":""}{amount.toFixed(0)}%</span>;
}
function ForecastMini({label,current,future,suffix="",lowerBetter=false,digits=2}){
  const a=Number(current||0),b=Number(future||0),delta=b-a;
  const good=lowerBetter?delta<0:delta>0;
  const neutral=Math.abs(delta)<Math.pow(10,-digits);
  const cls=neutral?"text-slate-400":good?"text-emerald-300":"text-rose-300";
  const sign=delta>0?"+":"";
  return <div className="rounded-lg border border-white/10 p-2">
    <div className="text-[10px] text-slate-500">{label}</div>
    <div className="mt-1 flex items-center gap-1 text-sm tabular-nums">
      <span className="text-slate-500">{a.toFixed(digits)}{suffix}</span>
      <span className="text-slate-600">→</span>
      <strong className={cls}>{b.toFixed(digits)}{suffix}</strong>
    </div>
    <div className={"mt-0.5 text-[10px] tabular-nums "+cls}>
      {neutral?"No material change":`${sign}${delta.toFixed(digits)}${suffix}`}
    </div>
  </div>;
}
function TechCompare({label,current,proposed,suffix="",digits=2,lowerBetter=false}){
  const a=Number(current||0),b=Number(proposed||0),delta=b-a;
  const good=lowerBetter?delta<0:delta>0;
  const neutral=Math.abs(delta)<Math.pow(10,-digits);
  return <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center text-sm">
    <span className="text-slate-400">{label}</span>
    <span className="tabular-nums text-slate-500">{a.toFixed(digits)}{suffix}</span>
    <span className="text-slate-600">→</span>
    <span className={"font-semibold tabular-nums "+(neutral?"text-slate-200":good?"text-emerald-300":"text-rose-300")}>{b.toFixed(digits)}{suffix}</span>
  </div>;
}
function ProjectDelta(props){
  return <div className="rounded-lg border border-white/10 bg-[#0d0f15] p-2"><div className="text-[9px] uppercase tracking-wide text-slate-500 mb-1">{props.label}</div><TechCompare {...props} label=""/></div>;
}
function ResultPill({result}){
  const cls=result==="above_expectation"?"bg-emerald-500/10 text-emerald-300":result==="below_expectation"?"bg-rose-500/10 text-rose-300":"bg-cyan-500/10 text-cyan-300";
  const label=result==="above_expectation"?"Above target":result==="below_expectation"?"Below target":"On target";
  return <span className={"rounded px-2 py-1 text-[10px] uppercase font-semibold "+cls}>{label}</span>;
}
function Stat({label,value}){return <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-4"><div className="text-xs text-slate-400">{label}</div><div className="text-xl font-semibold">{value}</div></CardContent></Card>;}
function Mini({label,value}){return <div className="border border-white/10 rounded p-2"><div className="text-[10px] text-slate-400">{label}</div><div className="font-medium truncate">{value}</div></div>;}
