// src/engine/AITechnicalEngine.js
// Stage 5A: deterministic AI technical lifecycle foundation.
// AI teams use the same component eligibility, physical-unit and manufacturing
// primitives as the player. Historical data seeds the world; aiTechnicalWorld
// becomes the save-world source of truth afterwards.

import { availableCarComponentSlots, componentLabel, COMPONENT_STAT_KEY } from "../domain/carComponents.js";
import { derivePartTechnicalProfile } from "../domain/carPartPerformance.js";
import {
  activeWorkshopJobFor,
  partManufactureQuote,
  partUnitRestoreQuote,
  processWorkshopJobs,
  queueWorkshopJob,
  reserveCarBuildQuote,
  standardRestoreQuote,
} from "../domain/componentService.js";
import {
  createManufacturedPartUnits,
  fitPhysicalPartUnit,
  normalizePhysicalPartState,
  partDesignById,
  partUnitById,
  removePhysicalPartUnit,
  updatePhysicalPartUnitCondition,
  warehousePartUnitsForDesign,
} from "../domain/partUnits.js";
import { teamWorkRateMultiplier } from "../domain/teamMorale.js";
import { activeDriverContracts, driverIdOf } from "../domain/driverContracts.js";
import { componentWearForRaceRow } from "../domain/componentWear.js";
import { PART_CONDITION_RELIABILITY_RISK } from "../domain/garage.js";
import {
  discoverableCarTechnologies,
  startTechnologyAdoption,
  technologyAdoptionQuote,
  technologyProjectsForTeam,
} from "../domain/technologyAdoption.js";
import { carReadinessForDate, raceCarsForTeam } from "../domain/carAvailability.js";

const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));
const str=(v)=>String(v??"");
const num=(v,fb=0)=>{const n=Number(v);return Number.isFinite(n)?n:fb;};
const neverNaN=(v,fb=0)=>Number.isFinite(Number(v))?Number(v):fb;

function parseISO(value){
  const [y,m,d]=String(value||"").slice(0,10).split("-").map(Number);
  return new Date(Date.UTC(y||1970,(m||1)-1,d||1));
}
function addDaysISO(value,days){
  const d=parseISO(value);
  d.setUTCDate(d.getUTCDate()+Math.max(0,Math.floor(Number(days)||0)));
  return d.toISOString().slice(0,10);
}
function daysBetweenISO(from,to){
  const a=parseISO(from).getTime();
  const b=parseISO(to).getTime();
  if(!Number.isFinite(a)||!Number.isFinite(b))return 0;
  return Math.round((b-a)/86_400_000);
}
function safeId(value){return str(value).replace(/[^a-zA-Z0-9_-]+/g,"_");}
function yearOf(gs){return Number(gs?.activeYear)||Number(str(gs?.currentDateISO).slice(0,4))||1980;}
function teamIdOf(row){return str(row?.team_id??row?.team??row?.constructor_id??row?.constructor);}
function rowForTeam(rows,teamId,year){
  const list=Array.isArray(rows)?rows:[];
  return list.find((row)=>teamIdOf(row)===str(teamId)&&Number(row?.year??row?.season_year)===Number(year))
    ||list.find((row)=>teamIdOf(row)===str(teamId))
    ||null;
}
function stableHash(text){
  let h=2166136261;
  for(const ch of str(text)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}
  return h>>>0;
}
function teamDisplayName(gs,teamId){
  const row=(gs?.teams||gs?.dbTeams||[]).find((team)=>teamIdOf(team)===str(teamId));
  return str(row?.team_name??row?.name??row?.short_name??teamId);
}
function appendAITechnicalNews(gs,{teamId,project,need,quote}={}){
  if(!gs||!project||!teamId)return gs;
  const id=`ai_technical_news_${safeId(project.id)}`;
  if((gs?.inbox||[]).some((row)=>str(row?.id)===id))return gs;
  const teamName=teamDisplayName(gs,teamId);
  const component=componentLabel(gs,need?.slot??project?.type);
  const body=[
    `${teamName} has started a new ${component} development programme.`,
    Number.isFinite(Number(need?.gap))?`The project follows an estimated ${Number(need.gap).toFixed(1)}-point technical gap to the current benchmark.`:null,
    Number.isFinite(Number(quote?.days))?`Design work is expected to take around ${Number(quote.days)} days before manufacturing can begin.`:null,
    "This is a real AI technical project: budget, design time, manufacturing, physical units and installation all use the same Save World lifecycle as the player.",
  ].filter(Boolean).join(" ");
  return {
    ...gs,
    inbox:[
      {
        id,
        date:str(gs?.currentDateISO).slice(0,10)||null,
        unread:true,
        type:"DEV",
        from:"Paddock Technical Watch",
        tag:"Technology",
        subject:`${teamName} begins ${component} development`,
        body,
        actions:[{label:"Compare cars",route:"/Car?view=analysis"}],
      },
      ...(gs?.inbox||[]),
    ].slice(0,300),
  };
}
function teamRows(gs){
  const rows=Array.isArray(gs?.teams)&&gs.teams.length?gs.teams:(gs?.dbTeams||[]);
  const year=yearOf(gs);
  const activeIds=new Set();

  for(const row of gs?.carStats||gs?.dbCarStats||[]){
    const rowYear=Number(row?.year??row?.season_year);
    if(Number.isFinite(rowYear)&&rowYear!==year)continue;
    const id=teamIdOf(row);
    if(id)activeIds.add(id);
  }
  for(const row of gs?.teamEngines||gs?.dbTeamEngines||[]){
    const rowYear=Number(row?.year??row?.season_year);
    if(Number.isFinite(rowYear)&&rowYear!==year)continue;
    const id=teamIdOf(row);
    if(id)activeIds.add(id);
  }
  for(const contract of activeDriverContracts(gs)){
    const id=teamIdOf(contract);
    if(id)activeIds.add(id);
  }

  if(activeIds.size){
    const byId=new Map(rows.map((row)=>[teamIdOf(row),row]).filter(([id])=>id));
    return [...activeIds].sort().map((id)=>byId.get(id)||{team_id:id});
  }

  const seen=new Map();
  for(const row of rows){
    const id=teamIdOf(row);
    if(!id)continue;
    const from=num(row?.year_from??row?.start_year??row?.founded_year,year);
    const toRaw=row?.year_to??row?.end_year??row?.last_year;
    const to=toRaw==null||toRaw===""?Infinity:num(toRaw,Infinity);
    if(year<from||year>to)continue;
    if(!seen.has(id))seen.set(id,row);
  }
  return [...seen.values()];
}
function facilityRow(gs,teamId){
  const year=yearOf(gs);
  return rowForTeam(gs?.facilities||gs?.dbFacilities||[],teamId,year)||{};
}
function facilityLevel(row,...keys){
  for(const key of keys){
    const value=Number(row?.[key]);
    if(Number.isFinite(value))return clamp(value,1,10);
  }
  return 5;
}
function engineeringStrength(gs,teamId){
  const f=facilityRow(gs,teamId);
  const aero=facilityLevel(f,"aero_dept_level","aero_level");
  const wind=facilityLevel(f,"wind_tunnel_level");
  const mfg=facilityLevel(f,"manufacturing_level","manufacturing_leve");
  const chassis=facilityLevel(f,"_chassis_shop_level","chassis_shop_level");
  return Number(((aero+wind+mfg+chassis)/4).toFixed(2));
}
function historicalBudgetSeed(gs,teamId){
  const year=yearOf(gs);
  const rows=gs?.financeLedger||gs?.dbFinanceLedger||[];
  const row=rowForTeam(rows,teamId,year)||{};
  for(const key of ["balance","budget","cash","opening_balance","season_budget"]){
    const value=Number(row?.[key]);
    if(Number.isFinite(value)&&value>0)return value;
  }
  // Fallback is a deterministic gameplay reserve derived from existing facilities,
  // not a recurring AI cash injection.
  return Math.round((1_250_000+engineeringStrength(gs,teamId)*350_000)/10_000)*10_000;
}
function initialCars(teamId){
  return [1,2].map((slot)=>({
    id:`ai_${safeId(teamId)}_car_${slot}`,
    label:`Car ${slot}`,
    kind:"race",
    ai_team_id:str(teamId),
    installedParts:{},
    componentCondition:{},
  }));
}
function scopedState(gs,teamId,state){
  return {
    ...gs,
    team:{team_id:str(teamId),budget:num(state?.budget,0)},
    finances:{balance:num(state?.budget,0),budget:num(state?.budget,0)},
    // Never inherit the player's HQ overrides. Shared component-service helpers
    // will then resolve facilities using this AI TEAM's own historical rows.
    hq:{facilityLevels:{},upgrades:[]},
    garage:state?.garage||{cars:initialCars(teamId),serviceJobs:[],baseComponentStock:{}},
    development:state?.development||{projects:[],parts:[],partUnits:[],manufacturing:[],research:[]},
    componentServiceLog:Array.isArray(state?.componentServiceLog)?state.componentServiceLog:[],
    componentWearLog:Array.isArray(state?.componentWearLog)?state.componentWearLog:[],
  };
}
function componentBaseline(gs,teamId,slot){
  const car=rowForTeam(gs?.carStats||gs?.dbCarStats||[],teamId,yearOf(gs))||{};
  const key=COMPONENT_STAT_KEY[slot];
  if(key){
    const value=Number(car?.[key]);
    if(Number.isFinite(value))return clamp(value);
  }
  const fallback={
    chassis:"chassis_spec",aero_front:"aero_spec",aero_rear:"aero_spec",
    sidepods:"aero_spec",underfloor:"aero_spec",suspension:"suspension_spec",
    gearbox:"gearbox_spec",brakes:"brakes_spec",cooling:"cooling_spec",
  }[slot];
  return fallback?clamp(num(car?.[fallback],70)):70;
}
const MAX_SLOT_DEVELOPMENT_STRENGTH=6.0;

function completedDesignCount(state,slot){
  return (state?.development?.parts||[]).filter((part)=>str(part?.slot)===str(slot)).length;
}
function bestDesignStrength(state,slot){
  return (state?.development?.parts||[])
    .filter((part)=>str(part?.slot)===str(slot))
    .reduce((best,part)=>Math.max(best,num(part?.perf,0)),0);
}
function developmentHeadroom(state,slot){
  return Math.max(0,MAX_SLOT_DEVELOPMENT_STRENGTH-bestDesignStrength(state,slot));
}

function technicalStateForTeam(gs,teamId){
  const player=str(gs?.team?.team_id??gs?.team?.id);
  if(str(teamId)===player){
    return {
      garage:gs?.garage||{cars:[]},
      development:gs?.development||{parts:[],partUnits:[]},
    };
  }
  const state=gs?.aiTechnicalWorld?.teams?.[str(teamId)]||null;
  return state?{garage:state.garage,development:state.development}:null;
}

function installedSlotDevelopmentBonus(gs,teamId,slot){
  const technical=technicalStateForTeam(gs,teamId);
  const cars=(technical?.garage?.cars||[]).filter((car)=>car?.kind==="race");
  if(!cars.length)return 0;
  const local={...gs,garage:technical.garage,development:technical.development};
  const values=cars.map((car)=>{
    const ref=car?.installedParts?.[slot];
    if(!ref)return 0;
    const unit=partUnitById(local,ref);
    const design=unit
      ?partDesignById(local,unit.design_id)
      :partDesignById(local,ref);
    if(!design)return 0;
    const condition=unit?clamp(unit?.condition??100)/100:1;
    return num(design?.perf,0)*Math.max(0.55,condition);
  });
  return values.reduce((sum,value)=>sum+value,0)/values.length;
}

function effectiveComponentScore(gs,teamId,slot){
  return Number((componentBaseline(gs,teamId,slot)+installedSlotDevelopmentBonus(gs,teamId,slot)).toFixed(3));
}

function fieldBenchmarkForSlot(gs,slot){
  const ids=[...new Set(teamRows(gs).map(teamIdOf).filter(Boolean))];
  const values=ids
    .filter((teamId)=>availableCarComponentSlots(gs,teamId).includes(slot))
    .map((teamId)=>effectiveComponentScore(gs,teamId,slot))
    .filter(Number.isFinite)
    .sort((a,b)=>b-a);
  if(!values.length)return null;
  const topCount=Math.max(1,Math.min(3,Math.ceil(values.length/3)));
  const target=values.slice(0,topCount).reduce((sum,value)=>sum+value,0)/topCount;
  return Number(target.toFixed(3));
}

function chooseNeed(gs,teamId,state){
  const slots=availableCarComponentSlots(gs,teamId);
  if(!slots.length)return null;
  const scored=slots.map((slot)=>{
    const baseline=componentBaseline(gs,teamId,slot);
    const current=effectiveComponentScore(gs,teamId,slot);
    const benchmark=fieldBenchmarkForSlot(gs,slot)??current;
    const gap=Math.max(0,benchmark-current);
    const prior=completedDesignCount(state,slot);
    const incumbent=bestDesignStrength(state,slot);
    const headroom=developmentHeadroom(state,slot);
    const repeatPenalty=prior*0.18;
    const cappedPenalty=headroom<0.12?100:0;
    const tie=(stableHash(`${teamId}|${yearOf(gs)}|${slot}`)%1000)/1_000_000;
    return {
      slot,baseline,current,benchmark,
      gap:Number(gap.toFixed(3)),
      prior,
      incumbent:Number(incumbent.toFixed(3)),
      headroom:Number(headroom.toFixed(3)),
      score:Number((gap-repeatPenalty-cappedPenalty+tie).toFixed(6)),
    };
  }).filter((row)=>row.headroom>=0.12)
    .sort((a,b)=>b.score-a.score||a.baseline-b.baseline||a.slot.localeCompare(b.slot));
  return scored[0]||null;
}
function projectQuote(gs,teamId,state,need){
  const strength=engineeringStrength(gs,teamId);
  const moraleTime=teamWorkRateMultiplier(gs,teamId);
  const prior=completedDesignCount(state,need.slot);
  const incumbent=bestDesignStrength(state,need.slot);
  const headroom=Math.max(0,MAX_SLOT_DEVELOPMENT_STRENGTH-incumbent);
  const baseDays=Math.max(18,34-prior*2);
  const days=Math.max(10,Math.round(baseDays*Math.max(0.72,1.16-strength*0.045)*moraleTime));
  const cost=Math.round((145_000+strength*42_000+prior*55_000)/10_000)*10_000;
  const rawIncrement=0.38+strength*0.072+Math.max(0,78-need.baseline)*0.014+Math.min(8,need.gap||0)*0.025;
  const diminishing=Math.max(0.34,1-(incumbent/MAX_SLOT_DEVELOPMENT_STRENGTH)*0.62);
  const increment=Math.min(headroom,Math.max(0.12,rawIncrement*diminishing));
  const targetPerf=Math.min(MAX_SLOT_DEVELOPMENT_STRENGTH,incumbent+increment);
  return {
    days,cost,
    perf:Number(targetPerf.toFixed(3)),
    increment:Number(increment.toFixed(3)),
    incumbent:Number(incumbent.toFixed(3)),
    headroom:Number(headroom.toFixed(3)),
    strength,
  };
}
function activeProjects(state){return (state?.development?.projects||[]).filter((p)=>p?.status==="active");}
function activeManufacturing(state){return (state?.development?.manufacturing||[]).filter((p)=>p?.status==="active");}

function planningReviewIntervalDays(gs,teamId){
  return Math.round(clamp(38-engineeringStrength(gs,teamId)*2,18,36));
}
function initialPlanningDelayDays(gs,teamId){
  return 10+(stableHash(`${teamId}|${yearOf(gs)}|first-review`)%9);
}
function seasonProjectLimit(gs,teamId){
  return Math.round(clamp(2+Math.floor(engineeringStrength(gs,teamId)/3),3,5));
}
function inferredInitialBudget(gs,state){
  const year=yearOf(gs);
  const spent=(state?.finance_log||[])
    .filter((row)=>Number(str(row?.dateISO??row?.date).slice(0,4))===year)
    .reduce((sum,row)=>{
      const amount=Number(row?.amount);
      return sum+(Number.isFinite(amount)&&amount<0?Math.abs(amount):0);
    },0);
  return Math.max(num(state?.budget,0),num(state?.budget,0)+spent);
}
function planningReserveFloor(gs,teamId,state){
  const initial=Math.max(1,num(state?.initial_budget,inferredInitialBudget(gs,state)));
  const strength=engineeringStrength(gs,teamId);
  const ratio=0.22+Math.max(0,6-strength)*0.015;
  return Math.round(Math.max(200_000,initial*ratio)/10_000)*10_000;
}

function archivedStandingContext(gs,teamId,seasonYear){
  const archive=(gs?.historySeasons||[]).find((row)=>Number(row?.year)===Number(seasonYear));
  const rows=archive?.standings?.teams||[];
  if(!Array.isArray(rows)||!rows.length)return {position:null,field_size:0,multiplier:1};
  const normalized=rows.map((row,index)=>({
    team_id:teamIdOf(row),
    position:num(row?.position??row?.pos,index+1),
    points:num(row?.points,0),
  })).sort((a,b)=>a.position-b.position||b.points-a.points);
  const found=normalized.find((row)=>row.team_id===str(teamId));
  if(!found)return {position:null,field_size:normalized.length,multiplier:1};
  const third=Math.max(1,Math.ceil(normalized.length/3));
  let multiplier=1;
  if(found.position===1)multiplier=1.08;
  else if(found.position<=third)multiplier=1.04;
  else if(found.position>normalized.length-third)multiplier=0.96;
  return {position:found.position,field_size:normalized.length,multiplier};
}

function seasonTechnicalAllocation(gs,teamId,state,previousYear){
  const initial=Math.max(1,num(state?.initial_budget,inferredInitialBudget(gs,state)));
  const strength=engineeringStrength(gs,teamId);
  const standing=archivedStandingContext(gs,teamId,previousYear);
  const resourceFactor=0.72+Math.max(1,Math.min(10,strength))*0.025;
  const allocation=initial*resourceFactor*standing.multiplier;
  return {
    amount:Math.round(allocation/10_000)*10_000,
    resource_factor:Number(resourceFactor.toFixed(3)),
    championship_multiplier:standing.multiplier,
    previous_position:standing.position,
    previous_field_size:standing.field_size,
  };
}

function seasonTechnicalSnapshot(state,seasonYear){
  const projects=(state?.development?.projects||[]).filter((project)=>
    Number(str(project?.started_at).slice(0,4))===Number(seasonYear)
  );
  const completed=projects.filter((project)=>project?.status==="completed").length;
  const maintenance=(state?.componentServiceLog||[]).filter((row)=>
    Number(str(row?.date).slice(0,4))===Number(seasonYear)
  ).length;
  return {
    year:Number(seasonYear),
    closing_budget:Math.round(num(state?.budget,0)),
    projects_started:projects.length,
    projects_completed:completed,
    designs_total:(state?.development?.parts||[]).length,
    physical_units_total:(state?.development?.partUnits||[]).length,
    maintenance_actions:maintenance,
  };
}

function rollAITechnicalSeasonEconomy(gs,teamId,state){
  const currentYear=yearOf(gs);
  const economy=state?.economy||{};
  const knownYear=Number.isFinite(Number(economy?.season_year))
    ?Number(economy.season_year)
    :Number.isFinite(Number(state?.planning?.season_year))
      ?Number(state.planning.season_year)
      :currentYear;

  if(knownYear>=currentYear){
    return {
      ...state,
      economy:{
        ...economy,
        season_year:currentYear,
        last_allocation:neverNaN(economy?.last_allocation,0),
      },
      season_history:Array.isArray(state?.season_history)?state.season_history:[],
    };
  }

  const initial=Math.max(1,num(state?.initial_budget,inferredInitialBudget(gs,state)));
  const snapshot=seasonTechnicalSnapshot(state,knownYear);
  const allocation=seasonTechnicalAllocation(gs,teamId,state,knownYear);
  const carryoverCap=Math.round(initial*0.30/10_000)*10_000;
  const carryover=Math.min(Math.max(0,num(state?.budget,0)),carryoverCap);
  const envelopeCap=Math.round(initial*1.20/10_000)*10_000;
  const openingBudget=Math.min(envelopeCap,carryover+allocation.amount);
  const credited=Math.max(0,openingBudget-carryover);
  const existingHistory=Array.isArray(state?.season_history)?state.season_history:[];
  const seasonHistory=[
    ...existingHistory.filter((row)=>Number(row?.year)!==knownYear),
    {
      ...snapshot,
      carryover_to_next:carryover,
      next_allocation:credited,
      next_opening_budget:openingBudget,
    },
  ].sort((a,b)=>Number(a.year)-Number(b.year)).slice(-20);

  const financeLog=[
    ...(state?.finance_log||[]),
    {
      id:`ai_tx_season_budget_${safeId(teamId)}_${currentYear}`,
      dateISO:`${currentYear}-01-01`,
      type:"income",
      category:"Technical Budget",
      amount:credited,
      desc:`Season ${currentYear} technical allocation`,
      source:"seasonal_technical_envelope",
    },
  ].slice(-500);

  return {
    ...state,
    budget:openingBudget,
    economy:{
      ...economy,
      season_year:currentYear,
      previous_season:knownYear,
      carryover,
      last_allocation:credited,
      opening_budget:openingBudget,
      resource_factor:allocation.resource_factor,
      championship_multiplier:allocation.championship_multiplier,
      previous_position:allocation.previous_position,
    },
    season_history:seasonHistory,
    finance_log:financeLog,
  };
}
function calendarDateISO(row){
  return str(row?.date??row?.race_date??row?.dateISO??row?.race_date_iso).slice(0,10);
}
function seasonEndISO(gs){
  const year=yearOf(gs);
  const dates=(gs?.calendar||[])
    .map(calendarDateISO)
    .filter((date)=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number(date.slice(0,4))===year)
    .sort();
  return dates.at(-1)||`${year}-12-31`;
}
function racesRemaining(gs,today){
  const dates=(gs?.calendar||[])
    .map(calendarDateISO)
    .filter((date)=>/^\d{4}-\d{2}-\d{2}$/.test(date));
  if(!dates.length)return null;
  return dates.filter((date)=>date>=today).length;
}
function seasonProjectsStarted(gs,state){
  const year=yearOf(gs);
  const partProjects=(state?.development?.projects||[]).filter((project)=>
    Number(str(project?.started_at).slice(0,4))===year
  ).length;
  const technologyProjects=(state?.technology_projects||[]).filter((project)=>
    Number(str(project?.started_at).slice(0,4))===year
  ).length;
  return partProjects+technologyProjects;
}
function activeTechnologyProjects(state){
  return (state?.technology_projects||[]).filter((project)=>project?.status==="active");
}
function teamStandingContext(gs,teamId){
  const rows=Array.isArray(gs?.standings?.teams)&&gs.standings.teams.length
    ?gs.standings.teams
    :Array.isArray(gs?.lastRace?.teamStandings)?gs.lastRace.teamStandings:[];
  if(!rows.length)return {position:null,field_size:0,threshold_adjustment:0};
  const normalized=rows.map((row,index)=>({
    team_id:teamIdOf(row),
    position:num(row?.position??row?.pos,index+1),
    points:num(row?.points,0),
  })).sort((a,b)=>a.position-b.position||b.points-a.points);
  const found=normalized.find((row)=>row.team_id===str(teamId));
  if(!found)return {position:null,field_size:normalized.length,threshold_adjustment:0};
  let adjustment=0;
  if(found.position===1)adjustment=0.35;
  else if(found.position>Math.ceil(normalized.length/2))adjustment=-0.20;
  return {position:found.position,field_size:normalized.length,threshold_adjustment:adjustment};
}
function planningGapThreshold(gs,teamId){
  const strength=engineeringStrength(gs,teamId);
  const standing=teamStandingContext(gs,teamId);
  const base=2.35+Math.max(0,6-strength)*0.12+standing.threshold_adjustment;
  return Number(clamp(base,1.9,3.1).toFixed(2));
}
function normalizedPlanningState(gs,teamId,state){
  const year=yearOf(gs);
  const today=str(gs?.currentDateISO).slice(0,10)||`${year}-01-01`;
  const previous=state?.planning||{};
  const sameSeason=Number(previous?.season_year)===year;
  const nextReview=sameSeason&&previous?.next_review_date
    ?str(previous.next_review_date).slice(0,10)
    :addDaysISO(today,initialPlanningDelayDays(gs,teamId));
  return {
    ...previous,
    season_year:year,
    cycle:sameSeason?num(previous?.cycle,0):0,
    last_need:sameSeason?(previous?.last_need??null):null,
    last_date:sameSeason?(previous?.last_date??null):null,
    last_review_date:sameSeason?(previous?.last_review_date??null):null,
    next_review_date:nextReview,
    last_decision:sameSeason?(previous?.last_decision??null):null,
    decision_history:sameSeason&&Array.isArray(previous?.decision_history)?previous.decision_history:[],
  };
}
function normalizeAITeamState(gs,teamId,state){
  const initial=num(state?.initial_budget,0)>0
    ?num(state.initial_budget,0)
    :inferredInitialBudget(gs,state);
  const seeded={
    ...state,
    initial_budget:initial,
    garage:state?.garage||{cars:initialCars(teamId),serviceJobs:[],baseComponentStock:{}},
    development:state?.development||{projects:[],parts:[],partUnits:[],manufacturing:[],research:[]},
    finance_log:Array.isArray(state?.finance_log)?state.finance_log:[],
    componentServiceLog:Array.isArray(state?.componentServiceLog)?state.componentServiceLog:[],
    componentWearLog:Array.isArray(state?.componentWearLog)?state.componentWearLog:[],
    season_history:Array.isArray(state?.season_history)?state.season_history:[],
    technology_projects:Array.isArray(state?.technology_projects)?state.technology_projects:[],
    technology_unlocks:state?.technology_unlocks&&typeof state.technology_unlocks==="object"
      ?state.technology_unlocks
      :{},
  };
  const rolled=rollAITechnicalSeasonEconomy(gs,teamId,seeded);
  return {
    ...rolled,
    planning:normalizedPlanningState(gs,teamId,rolled),
  };
}

export function normalizeAITechnicalWorld(gs){
  if(!gs)return gs;
  const player=str(gs?.team?.team_id??gs?.team?.id);
  const existing=gs?.aiTechnicalWorld?.teams||{};
  const teams={...existing};
  for(const row of teamRows(gs)){
    const teamId=teamIdOf(row);
    if(!teamId||teamId===player)continue;
    if(!teams[teamId]){
      const budget=historicalBudgetSeed(gs,teamId);
      teams[teamId]={
        team_id:teamId,
        budget,
        initial_budget:budget,
        garage:{cars:initialCars(teamId),serviceJobs:[],baseComponentStock:{}},
        development:{projects:[],parts:[],partUnits:[],manufacturing:[],research:[]},
        planning:{},
        economy:{season_year:yearOf(gs),last_allocation:0,opening_budget:budget},
        season_history:[],
        technology_projects:[],
        technology_unlocks:{},
        finance_log:[],
        componentServiceLog:[],
        componentWearLog:[],
      };
    }
    teams[teamId]=normalizeAITeamState(gs,teamId,teams[teamId]);
  }
  return {...gs,aiTechnicalWorld:{...(gs?.aiTechnicalWorld||{}),version:1,teams}};
}

export function aiTechnicalTeamState(gs,teamId){
  return gs?.aiTechnicalWorld?.teams?.[str(teamId)]||null;
}

export function aiTechnicalScopedState(gs,teamId){
  const normalized=normalizeAITechnicalWorld(gs);
  const state=aiTechnicalTeamState(normalized,teamId);
  return state?normalizePhysicalPartState(scopedState(normalized,teamId,state)):null;
}

export function aiTechnicalRaceCars(gs,teamId){
  const state=aiTechnicalTeamState(gs,teamId);
  return (state?.garage?.cars||[]).filter((car)=>car?.kind==="race");
}

export function aiTechnicalCarForDriver(gs,teamId,driverId=null){
  const cars=aiTechnicalRaceCars(gs,teamId);
  if(!cars.length)return null;
  if(driverId==null||driverId==="")return null;
  const did=str(driverId);
  const liveEntry=(gs?.raceEntryState?.entries||[]).find((entry)=>
    str(entry?.team_id)===str(teamId) &&
    str(entry?.driver_id)===did
  );
  if(liveEntry){
    const explicitId=str(liveEntry?.car_id);
    if(explicitId){
      const allCars=aiTechnicalRaceCars(gs,teamId)
        .concat((aiTechnicalTeamState(gs,teamId)?.garage?.cars||[]).filter((car)=>car?.kind==="reserve"));
      const explicit=allCars.find((car)=>str(car?.id)===explicitId);
      if(explicit)return explicit;
    }
    if(Number(liveEntry?.car_slot)>=1&&Number(liveEntry?.car_slot)<=2){
      return cars[Number(liveEntry.car_slot)-1]||null;
    }
  }

  const raceContracts=activeDriverContracts(gs,{teamId,raceOnly:true});
  const index=raceContracts.findIndex((contract)=>driverIdOf(contract)===did);
  return index>=0?(cars[index]||null):null;
}

function replaceTeamState(gs,teamId,nextState){
  return {
    ...gs,
    aiTechnicalWorld:{
      ...(gs?.aiTechnicalWorld||{}),
      version:1,
      teams:{...(gs?.aiTechnicalWorld?.teams||{}),[str(teamId)]:nextState},
    },
  };
}

function raceDriverId(row){
  return str(row?.driver_id??row?.driver?.driver_id??row?.driver?.id);
}

function raceTeamId(gs,row){
  const direct=teamIdOf(row);
  if(direct)return direct;
  const driverId=raceDriverId(row);
  if(!driverId)return "";
  const entry=(gs?.raceEntryState?.entries||[]).find((item)=>str(item?.driver_id)===driverId);
  if(entry?.team_id)return str(entry.team_id);
  const contract=activeDriverContracts(gs).find((item)=>driverIdOf(item)===driverId);
  if(contract)return teamIdOf(contract);
  return teamIdOf(row?.driver);
}

function resolveAIRaceCar(gs,row){
  const driverId=raceDriverId(row);
  if(!driverId)return null;
  const player=str(gs?.team?.team_id??gs?.team?.id);
  const preferred=raceTeamId(gs,row);
  const candidates=[
    preferred,
    ...Object.keys(gs?.aiTechnicalWorld?.teams||{}).sort(),
  ].filter(Boolean);
  const seen=new Set();
  for(const teamId of candidates){
    if(seen.has(teamId)||teamId===player)continue;
    seen.add(teamId);
    const state=aiTechnicalTeamState(gs,teamId);
    if(!state)continue;
    const car=aiTechnicalCarForDriver(gs,teamId,driverId);
    if(car)return {driverId,teamId,state,car};
  }
  return null;
}

function maintenanceThreshold(slot){
  const risk=Number(PART_CONDITION_RELIABILITY_RISK?.[slot]??3);
  return Math.round(clamp(40+risk*2.2,42,58));
}

function persistScopedState(state,scoped,{budget=null,financeLog=null}={}){
  return {
    ...state,
    ...(budget==null?{}:{budget:Number(budget)}),
    garage:scoped?.garage||state?.garage,
    development:scoped?.development||state?.development,
    componentServiceLog:Array.isArray(scoped?.componentServiceLog)?scoped.componentServiceLog:(state?.componentServiceLog||[]),
    componentWearLog:Array.isArray(scoped?.componentWearLog)?scoped.componentWearLog:(state?.componentWearLog||[]),
    ...(financeLog?{finance_log:financeLog}:{}),
  };
}

function appendAIFinance(state,row){
  return [...(state?.finance_log||[]),row].slice(-500);
}

function bestWarehouseUpgrade(scoped,slot,minCondition=65){
  const candidates=[];
  for(const part of scoped?.development?.parts||[]){
    if(str(part?.slot)!==str(slot))continue;
    for(const unit of warehousePartUnitsForDesign(scoped,part.id)){
      const condition=clamp(unit?.condition??100);
      if(condition<minCondition)continue;
      candidates.push({part,unit,condition,perf:num(part?.perf,0)});
    }
  }
  return candidates.sort((a,b)=>
    b.perf-a.perf ||
    b.condition-a.condition ||
    str(a.unit?.id).localeCompare(str(b.unit?.id))
  )[0]||null;
}

export function applyAIRaceComponentWear(gs,{race=[],gp=null}={}){
  let next=normalizeAITechnicalWorld(gs);
  const player=str(next?.team?.team_id??next?.team?.id);
  const gpId=str(gp?.gp_id??gp?.id??gp?.track_id);
  const date=str(next?.currentDateISO??gp?.race_date).slice(0,10)||null;

  for(const row of Array.isArray(race)?race:[]){
    const context=resolveAIRaceCar(next,row);
    if(!context)continue;
    const {driverId,teamId,state,car:mapped}=context;
    if(teamId===player)continue;

    let scoped=normalizePhysicalPartState(scopedState(next,teamId,state));
    const carId=str(mapped?.id);
    if(!carId)continue;

    const wearRows=[];
    const slots=availableCarComponentSlots(next,teamId);
    for(const slot of slots){
      const wear=Number(componentWearForRaceRow(row,slot)||0);
      if(wear<=0)continue;

      let car=(scoped?.garage?.cars||[]).find((item)=>str(item?.id)===carId);
      if(!car)continue;
      const installedRef=car?.installedParts?.[slot];
      const unit=installedRef?partUnitById(scoped,installedRef):null;

      if(unit){
        const before=clamp(unit?.condition??100);
        const after=Number(clamp(before-wear).toFixed(1));
        scoped=updatePhysicalPartUnitCondition(scoped,unit.id,after,{
          last_wear:Number(wear.toFixed(2)),
          last_wear_date:date,
        });
        wearRows.push({
          gp_id:gpId,date,session:"race",driver_id:driverId,car_id:carId,
          slot,component_source:"developed_part",part_unit_id:str(unit.id),
          design_id:str(unit.design_id),wear:Number(wear.toFixed(2)),
          condition_before:Number(before.toFixed(1)),condition_after:after,
          retirement_reason:row?.retirement_reason||null,
          incident_severity:row?.incident_severity||null,
        });
      }else{
        const before=clamp(car?.componentCondition?.[slot]??100);
        const after=Number(clamp(before-wear).toFixed(1));
        scoped={
          ...scoped,
          garage:{
            ...(scoped?.garage||{}),
            cars:(scoped?.garage?.cars||[]).map((item)=>str(item?.id)===carId
              ?{...item,componentCondition:{...(item?.componentCondition||{}),[slot]:after}}
              :item
            ),
          },
        };
        wearRows.push({
          gp_id:gpId,date,session:"race",driver_id:driverId,car_id:carId,
          slot,component_source:"base_component",part_unit_id:null,design_id:null,
          wear:Number(wear.toFixed(2)),
          condition_before:Number(before.toFixed(1)),condition_after:after,
          retirement_reason:row?.retirement_reason||null,
          incident_severity:row?.incident_severity||null,
        });
      }
    }

    if(wearRows.length){
      scoped={
        ...scoped,
        componentWearLog:[
          ...wearRows,
          ...(Array.isArray(scoped?.componentWearLog)?scoped.componentWearLog:[]),
        ].slice(0,500),
      };
      next=replaceTeamState(next,teamId,persistScopedState(state,scoped));
    }
  }
  return next;
}

export function processAITechnicalMaintenance(gs,teamId,stateInput=null){
  const state=stateInput||aiTechnicalTeamState(gs,teamId);
  if(!state)return state;
  const today=str(gs?.currentDateISO).slice(0,10);
  if(!today)return state;

  let budget=num(state?.budget,0);
  let financeLog=[...(state?.finance_log||[])];
  let scoped=normalizePhysicalPartState(scopedState(gs,teamId,state));
  scoped=processWorkshopJobs(scoped);

  const slots=availableCarComponentSlots(gs,teamId);
  const carIds=(scoped?.garage?.cars||[])
    .filter((car)=>car?.kind==="race")
    .map((car)=>str(car?.id))
    .sort();

  for(const carId of carIds){
    for(const slot of slots.slice().sort()){
      let car=(scoped?.garage?.cars||[]).find((item)=>str(item?.id)===carId);
      if(!car)continue;
      if(activeWorkshopJobFor(scoped,{carId,slot}))continue;

      let installedRef=car?.installedParts?.[slot];
      let unit=installedRef?partUnitById(scoped,installedRef):null;

      // Once a restored/developed unit returns from the workshop, refit the
      // best healthy design instead of silently leaving the AI on the baseline.
      if(!unit){
        const candidate=bestWarehouseUpgrade(scoped,slot,65);
        if(candidate){
          scoped=fitPhysicalPartUnit(scoped,{
            carId,slot,designId:candidate.part.id,unitId:candidate.unit.id,
          });
          car=(scoped?.garage?.cars||[]).find((item)=>str(item?.id)===carId);
          installedRef=car?.installedParts?.[slot];
          unit=installedRef?partUnitById(scoped,installedRef):null;
        }
      }

      const threshold=maintenanceThreshold(slot);
      if(unit){
        const condition=clamp(unit?.condition??100);
        if(condition>=threshold)continue;

        const sameDesignSpare=warehousePartUnitsForDesign(scoped,unit.design_id)
          .find((candidate)=>clamp(candidate?.condition??100)>=Math.max(65,threshold+8));
        if(sameDesignSpare){
          const wornId=str(unit.id);
          scoped=fitPhysicalPartUnit(scoped,{
            carId,slot,designId:unit.design_id,unitId:sameDesignSpare.id,
          });
          scoped={
            ...scoped,
            componentServiceLog:[
              {
                date:today,action:"swap_developed_spare",car_id:carId,slot,
                unit_id:str(sameDesignSpare.id),replaced_unit_id:wornId,
                condition_before:Number(condition.toFixed(1)),
                condition_after:Number(clamp(sameDesignSpare.condition??100).toFixed(1)),
                cost:0,
              },
              ...(Array.isArray(scoped?.componentServiceLog)?scoped.componentServiceLog:[]),
            ].slice(0,300),
          };
          continue;
        }

        if(activeWorkshopJobFor(scoped,{unitId:unit.id}))continue;
        const quote=partUnitRestoreQuote(scoped,unit.id);
        if(!quote||budget<Number(quote.cost||0))continue;

        const removed=removePhysicalPartUnit(scoped,{carId,slot});
        const beforeJobs=(removed?.garage?.serviceJobs||[]).length;
        const queued=queueWorkshopJob(removed,quote,{
          id:`ai_service_${safeId(teamId)}_${today}_${safeId(unit.id)}`,
          title:`Restore ${slot.replaceAll("_"," ")} · ${carId}`,
          startedAt:today,
        });
        if((queued?.garage?.serviceJobs||[]).length<=beforeJobs)continue;

        budget-=Number(quote.cost||0);
        financeLog=appendAIFinance(
          {...state,finance_log:financeLog},
          {
            id:`ai_tx_service_${safeId(teamId)}_${today}_${safeId(unit.id)}`,
            dateISO:today,type:"expense",category:"Maintenance",
            amount:-Number(quote.cost||0),desc:`Restore ${slot} · ${carId}`,
          }
        );
        scoped=queued;
        continue;
      }

      car=(scoped?.garage?.cars||[]).find((item)=>str(item?.id)===carId);
      const condition=clamp(car?.componentCondition?.[slot]??100);
      if(condition>=threshold)continue;

      const stock=Number(scoped?.garage?.baseComponentStock?.[slot]||0);
      if(stock>0){
        scoped={
          ...scoped,
          garage:{
            ...(scoped?.garage||{}),
            baseComponentStock:{
              ...(scoped?.garage?.baseComponentStock||{}),
              [slot]:Math.max(0,stock-1),
            },
            cars:(scoped?.garage?.cars||[]).map((item)=>str(item?.id)===carId
              ?{...item,componentCondition:{...(item?.componentCondition||{}),[slot]:100}}
              :item
            ),
          },
          componentServiceLog:[
            {
              date:today,action:"replace_standard_from_stock",car_id:carId,slot,
              condition_before:Number(condition.toFixed(1)),condition_after:100,cost:0,
            },
            ...(Array.isArray(scoped?.componentServiceLog)?scoped.componentServiceLog:[]),
          ].slice(0,300),
        };
        continue;
      }

      const quote=standardRestoreQuote(scoped,slot,condition,{carId});
      if(!quote||budget<Number(quote.cost||0))continue;
      const beforeJobs=(scoped?.garage?.serviceJobs||[]).length;
      const queued=queueWorkshopJob(scoped,quote,{
        id:`ai_service_${safeId(teamId)}_${today}_${safeId(carId)}_${safeId(slot)}`,
        title:`Restore ${slot.replaceAll("_"," ")} · ${carId}`,
        startedAt:today,
      });
      if((queued?.garage?.serviceJobs||[]).length<=beforeJobs)continue;

      budget-=Number(quote.cost||0);
      financeLog=appendAIFinance(
        {...state,finance_log:financeLog},
        {
          id:`ai_tx_service_${safeId(teamId)}_${today}_${safeId(carId)}_${safeId(slot)}`,
          dateISO:today,type:"expense",category:"Maintenance",
          amount:-Number(quote.cost||0),desc:`Restore ${slot} · ${carId}`,
        }
      );
      scoped=queued;
    }
  }

  return persistScopedState(state,scoped,{budget,financeLog});
}

function technologyPlanningCandidate(gs,teamId,state){
  if(activeTechnologyProjects(state).length)return null;
  const opportunities=discoverableCarTechnologies(gs,teamId);
  if(!opportunities.length)return null;
  return opportunities
    .map((opportunity)=>({
      ...opportunity,
      quote:technologyAdoptionQuote(gs,teamId,opportunity.slot),
    }))
    .sort((a,b)=>{
      // Deterministic: cheaper/faster adoption first, stable slot as tie-break.
      const aCommit=num(a?.quote?.cost,0)+num(a?.quote?.days,0)*5_000;
      const bCommit=num(b?.quote?.cost,0)+num(b?.quote?.days,0)*5_000;
      return aCommit-bCommit||str(a.slot).localeCompare(str(b.slot));
    })[0]||null;
}


export function processAIReserveCar(gs,teamId,stateInput=null){
  const state=stateInput||aiTechnicalTeamState(gs,teamId);
  if(!state)return state;
  if(state?.garage?.reserveCarBuilt===true)return state;

  const today=str(gs?.currentDateISO).slice(0,10);
  if(!today)return state;
  const scoped=normalizePhysicalPartState(scopedState(gs,teamId,state));
  if(activeWorkshopJobFor(scoped,{kind:"build_reserve_car"}))return state;

  const snapshot=replaceTeamState(gs,teamId,state);
  const raceCars=raceCarsForTeam(snapshot,teamId);
  const needsBackup=raceCars.some((car)=>!carReadinessForDate(snapshot,teamId,car,today).available);
  if(!needsBackup)return state;

  const quote=reserveCarBuildQuote(scoped);
  const reserveFloor=planningReserveFloor(gs,teamId,state);
  const budget=num(state?.budget,0);
  if(budget<num(quote?.cost,0)+reserveFloor)return state;

  const beforeJobs=(scoped?.garage?.serviceJobs||[]).length;
  const queued=queueWorkshopJob(scoped,quote,{
    id:`ai_reserve_car_${safeId(teamId)}_${yearOf(gs)}`,
    title:"Build Reserve Car",
    startedAt:today,
  });
  if((queued?.garage?.serviceJobs||[]).length<=beforeJobs)return state;

  const cost=num(quote?.cost,0);
  return persistScopedState(state,queued,{
    budget:budget-cost,
    financeLog:appendAIFinance(state,{
      id:`ai_tx_reserve_car_${safeId(teamId)}_${yearOf(gs)}`,
      dateISO:today,
      type:"expense",
      category:"Car Construction",
      amount:-cost,
      desc:"Build Reserve Car",
    }),
  });
}

function estimatedManufacturingCommitment(gs,teamId,state,need,quote){
  const scoped=normalizePhysicalPartState(scopedState(gs,teamId,state));
  const draft={
    id:`planning_${safeId(teamId)}_${safeId(need?.slot)}`,
    name:"Planning estimate",
    slot:need?.slot,
    perf:num(quote?.perf,0),
  };
  const unit=partManufactureQuote(scoped,draft)||{};
  return {
    qty:2,
    unit_cost:num(unit?.cost,0),
    cost:num(unit?.cost,0)*2,
    days:Math.max(1,num(unit?.days,2)),
  };
}

function planningDecisionRecord(today,action,reason,assessment){
  return {
    date:today,
    action,
    reason,
    slot:assessment?.need?.slot||null,
    gap:Number(assessment?.need?.gap||0),
    threshold:Number(assessment?.gap_threshold||0),
    budget:Number(assessment?.budget||0),
    reserve_floor:Number(assessment?.reserve_floor||0),
    total_commitment:Number(assessment?.total_commitment||0),
    season_projects:Number(assessment?.season_projects||0),
    season_limit:Number(assessment?.season_limit||0),
  };
}

export function aiTechnicalPlanningAssessment(gs,teamId,{force=false}={}){
  const normalized=normalizeAITechnicalWorld(gs);
  const state=aiTechnicalTeamState(normalized,teamId);
  const today=str(normalized?.currentDateISO).slice(0,10);
  if(!state||!today){
    return {action:"hold",reason:"missing_state",team_id:str(teamId)};
  }

  const planning=state?.planning||{};
  const technology=!force?technologyPlanningCandidate(normalized,teamId,state):null;
  const need=chooseNeed(normalized,teamId,state);
  const quote=need?projectQuote(normalized,teamId,state,need):null;
  const manufacturing=need&&quote
    ?estimatedManufacturingCommitment(normalized,teamId,state,need,quote)
    :{qty:2,unit_cost:0,cost:0,days:0};
  const budget=num(state?.budget,0);
  const reserveFloor=planningReserveFloor(normalized,teamId,state);
  const technologyCommitment=num(technology?.quote?.cost,0);
  const totalCommitment=technology
    ?technologyCommitment
    :num(quote?.cost,0)+num(manufacturing?.cost,0);
  const projects=seasonProjectsStarted(normalized,state);
  const limit=seasonProjectLimit(normalized,teamId);
  const reviewInterval=planningReviewIntervalDays(normalized,teamId);
  const nextReview=str(planning?.next_review_date).slice(0,10)||today;
  const gapThreshold=planningGapThreshold(normalized,teamId);
  const standing=teamStandingContext(normalized,teamId);
  const end=seasonEndISO(normalized);
  const daysToEnd=daysBetweenISO(today,end);
  const remaining=racesRemaining(normalized,today);
  const deliveryDays=technology
    ?num(technology?.quote?.days,0)+21
    :num(quote?.days,0)+num(manufacturing?.days,0)+3;

  const base={
    team_id:str(teamId),
    today,
    technology,
    need,
    quote,
    manufacturing,
    budget,
    reserve_floor:reserveFloor,
    total_commitment:totalCommitment,
    budget_after_commitment:budget-totalCommitment,
    season_projects:projects,
    season_limit:limit,
    review_interval_days:reviewInterval,
    next_review_date:nextReview,
    gap_threshold:gapThreshold,
    championship:standing,
    season_end:end,
    days_to_season_end:daysToEnd,
    races_remaining:remaining,
    delivery_days:deliveryDays,
  };

  if(activeProjects(state).length||activeManufacturing(state).length||activeTechnologyProjects(state).length){
    return {...base,action:"hold",reason:"technical_capacity_busy"};
  }
  if(!force&&today<nextReview){
    return {...base,action:"hold",reason:"review_not_due"};
  }
  if(!force&&projects>=limit){
    return {...base,action:"hold",reason:"season_capacity_reached"};
  }
  if(!force&&remaining===0){
    return {...base,action:"hold",reason:"season_complete"};
  }
  if(!force&&technology){
    if(budget<totalCommitment){
      return {...base,action:"hold",reason:"insufficient_budget"};
    }
    if(budget-totalCommitment<reserveFloor){
      return {...base,action:"hold",reason:"budget_reserve"};
    }
    if(daysToEnd<deliveryDays){
      return {...base,action:"hold",reason:"too_late_to_deliver"};
    }
    return {
      ...base,
      action:"adopt_technology",
      reason:"technology_opportunity",
      need:{slot:technology.slot,gap:0,benchmark:0,current:0},
      quote:technology.quote,
      manufacturing:{qty:0,unit_cost:0,cost:0,days:0},
    };
  }
  if(!need){
    return {...base,action:"hold",reason:"no_legal_component"};
  }
  if(!force&&num(need?.gap,0)<gapThreshold){
    return {...base,action:"hold",reason:"no_meaningful_competitive_gap"};
  }
  if(budget<totalCommitment){
    return {...base,action:"hold",reason:"insufficient_budget"};
  }
  if(!force&&budget-totalCommitment<reserveFloor){
    return {...base,action:"hold",reason:"budget_reserve"};
  }
  if(!force&&daysToEnd<deliveryDays){
    return {...base,action:"hold",reason:"too_late_to_deliver"};
  }

  return {...base,action:"develop",reason:force?"forced_lifecycle_test":"competitive_technical_gap"};
}

function recordPlanningHold(state,assessment){
  if(assessment?.reason==="review_not_due"||assessment?.reason==="technical_capacity_busy")return state;
  const today=assessment.today;
  const record=planningDecisionRecord(today,"hold",assessment.reason,assessment);
  const history=[...(state?.planning?.decision_history||[]),record].slice(-40);
  return {
    ...state,
    planning:{
      ...(state?.planning||{}),
      last_review_date:today,
      next_review_date:addDaysISO(today,assessment.review_interval_days),
      last_decision:record,
      decision_history:history,
    },
  };
}

export function planAITechnicalProject(gs,teamId,{force=false}={}){
  let next=normalizeAITechnicalWorld(gs);
  let state=aiTechnicalTeamState(next,teamId);
  if(!state)return next;

  const assessment=aiTechnicalPlanningAssessment(next,teamId,{force});
  if(assessment.action==="adopt_technology"){
    const today=assessment.today;
    next=startTechnologyAdoption(next,teamId,assessment.technology.slot,{origin:"ai"});
    state=aiTechnicalTeamState(next,teamId);
    if(!state)return next;
    const record=planningDecisionRecord(today,"adopt_technology","technology_opportunity",assessment);
    const history=[...(state?.planning?.decision_history||[]),record].slice(-40);
    const nextState={
      ...state,
      planning:{
        ...(state?.planning||{}),
        last_date:today,
        last_need:assessment.technology.slot,
        cycle:num(state?.planning?.cycle,0)+1,
        last_review_date:today,
        next_review_date:addDaysISO(
          today,
          num(assessment?.technology?.quote?.days,0)+assessment.review_interval_days
        ),
        last_decision:record,
        decision_history:history,
      },
    };
    return replaceTeamState(next,teamId,nextState);
  }
  if(assessment.action!=="develop"){
    const held=recordPlanningHold(state,assessment);
    return held===state?next:replaceTeamState(next,teamId,held);
  }

  const today=assessment.today;
  const need=assessment.need;
  const quote=assessment.quote;
  const manufacturing=assessment.manufacturing;
  const cycle=num(state?.planning?.cycle,0)+1;
  const id=`ai_dev_${safeId(teamId)}_${yearOf(next)}_${String(cycle).padStart(3,"0")}`;
  const project={
    id,
    team_id:str(teamId),
    name:`AI ${need.slot.replaceAll("_"," ")} package ${cycle}`,
    type:need.slot,
    phase:"design",
    status:"active",
    started_at:today,
    finishes_at:addDaysISO(today,quote.days),
    duration_days:quote.days,
    cost:quote.cost,
    perf_delta:quote.increment,
    base_design_perf:quote.incumbent,
    target_design_perf:quote.perf,
    development_headroom:quote.headroom,
    engineering_strength:quote.strength,
    need_baseline:need.baseline,
    planning_trigger:assessment.reason,
    competitive_gap:Number(need.gap||0),
    competitive_benchmark:Number(need.benchmark||0),
    projected_manufacturing_cost:Number(manufacturing.cost||0),
  };
  const record=planningDecisionRecord(today,"develop",assessment.reason,assessment);
  const history=[...(state?.planning?.decision_history||[]),record].slice(-40);
  const nextReview=addDaysISO(
    today,
    Number(quote.days||0)+Number(manufacturing.days||0)+assessment.review_interval_days
  );
  const nextState={
    ...state,
    budget:num(state.budget,0)-quote.cost,
    development:{...(state.development||{}),projects:[...(state.development?.projects||[]),project]},
    planning:{
      ...(state.planning||{}),
      last_date:today,
      last_need:need.slot,
      cycle,
      last_review_date:today,
      next_review_date:nextReview,
      last_decision:record,
      decision_history:history,
    },
    finance_log:[...(state.finance_log||[]),{
      id:`ai_tx_${id}`,dateISO:today,type:"expense",category:"Development",
      amount:-quote.cost,desc:project.name,
    }],
  };
  next=replaceTeamState(next,teamId,nextState);

  // Expose enough of the simulated AI world for the player to observe/test it
  // without flooding the Inbox: first project of each season, plus unusually
  // large technical responses, become paddock news.
  const newsworthy=!force&&(cycle===1||Number(need?.gap||0)>=4.5);
  if(newsworthy){
    next=appendAITechnicalNews(next,{teamId,project,need,quote});
  }
  return next;
}

function completeDesigns(gs,teamId,state,today){
  let changed=false;
  const scoped=scopedState(gs,teamId,state);
  let parts=[...(state?.development?.parts||[])];
  const projects=(state?.development?.projects||[]).map((project)=>{
    if(project?.status!=="active"||!project?.finishes_at||project.finishes_at>today)return project;
    changed=true;
    const designId=`part_${project.id}`;
    if(!parts.some((part)=>str(part?.id)===designId)){
      const draft={
        id:designId,name:project.name,slot:project.type,
        version:`AI-${completedDesignCount(state,project.type)+1}`,
        perf:num(project.target_design_perf,project.perf_delta),inv:0,in_manufacturing:0,
        prototype:true,created_from:project.id,ai_team_id:str(teamId),
      };
      parts.push({...draft,technical_profile:derivePartTechnicalProfile(scoped,draft)});
    }
    return {...project,status:"completed",progress:1,completed_at:today};
  });
  return {changed,state:changed?{...state,development:{...(state.development||{}),projects,parts}}:state};
}

function queueManufacturing(gs,teamId,state,today){
  if(activeManufacturing(state).length)return state;
  const parts=state?.development?.parts||[];
  const candidate=parts.slice().reverse().find((part)=>{
    const units=(state?.development?.partUnits||[]).filter((u)=>str(u?.design_id)===str(part?.id));
    return units.length<2&&num(part?.in_manufacturing,0)<=0;
  });
  if(!candidate)return state;
  const scoped=normalizePhysicalPartState(scopedState(gs,teamId,state));
  const quote=partManufactureQuote(scoped,candidate);
  const qty=2;
  const cost=num(quote?.cost,0)*qty;
  if(num(state?.budget,0)<cost)return state;
  const batch=`ai_mfg_${safeId(teamId)}_${safeId(candidate.id)}`;
  const job={
    id:batch,part_id:candidate.id,title:`${candidate.name} batch`,qty,
    unit_cost:num(quote?.cost,0),started_at:today,
    finishes_at:addDaysISO(today,num(quote?.days,2)),duration_days:num(quote?.days,2),
    status:"active",team_id:str(teamId),
  };
  return {
    ...state,budget:num(state.budget,0)-cost,
    development:{
      ...(state.development||{}),
      parts:parts.map((p)=>str(p?.id)===str(candidate.id)?{...p,in_manufacturing:qty}:p),
      manufacturing:[...(state.development?.manufacturing||[]),job],
    },
    finance_log:[...(state.finance_log||[]),{id:`ai_tx_${batch}`,dateISO:today,type:"expense",category:"Manufacturing",amount:-cost,desc:job.title}],
  };
}

function completeManufacturing(gs,teamId,state,today){
  let scoped=normalizePhysicalPartState(scopedState(gs,teamId,state));
  let changed=false;
  let manufacturing=[...(state?.development?.manufacturing||[])];
  for(let i=0;i<manufacturing.length;i+=1){
    const job=manufacturing[i];
    if(job?.status!=="active"||!job?.finishes_at||job.finishes_at>today)continue;
    changed=true;
    scoped=createManufacturedPartUnits(scoped,{designId:job.part_id,qty:job.qty,batchId:job.id,manufacturedAt:today});
    manufacturing[i]={...job,status:"completed",completed_at:today};
    scoped={
      ...scoped,
      development:{
        ...(scoped.development||{}),
        parts:(scoped.development?.parts||[]).map((p)=>str(p?.id)===str(job.part_id)?{...p,in_manufacturing:0}:p),
        manufacturing,
      },
    };
  }
  if(!changed)return state;

  // Install one physical unit per race car. This deliberately happens in car order,
  // so save states can represent split specifications if only one unit is available.
  const latestCompleted=manufacturing.filter((j)=>j?.status==="completed").slice(-1)[0];
  if(latestCompleted){
    const design=(scoped?.development?.parts||[]).find((p)=>str(p?.id)===str(latestCompleted.part_id));
    if(design){
      for(const car of scoped?.garage?.cars||[]){
        if(car?.kind!=="race")continue;
        const unit=warehousePartUnitsForDesign(scoped,design.id)[0];
        if(!unit)break;
        scoped=fitPhysicalPartUnit(scoped,{carId:car.id,slot:design.slot,designId:design.id,unitId:unit.id});
      }
    }
  }
  const normalized=normalizePhysicalPartState(scoped);
  return {
    ...state,
    garage:normalized.garage,
    development:normalized.development,
  };
}

export function tickAITechnicalTeam(gs,teamId,{allowPlanning=true}={}){
  let next=normalizeAITechnicalWorld(gs);
  let state=aiTechnicalTeamState(next,teamId);
  if(!state)return next;
  const today=str(next?.currentDateISO).slice(0,10);
  if(!today)return next;

  state=processAITechnicalMaintenance(next,teamId,state);
  state=processAIReserveCar(next,teamId,state);
  const completed=completeDesigns(next,teamId,state,today);
  state=completed.state;
  state=completeManufacturing(next,teamId,state,today);
  state=queueManufacturing(next,teamId,state,today);
  next=replaceTeamState(next,teamId,state);

  if(allowPlanning&&!activeProjects(state).length&&!activeManufacturing(state).length){
    next=planAITechnicalProject(next,teamId);
  }
  return next;
}

export function tickAITechnicalWorld(gs,{allowPlanning=true}={}){
  let next=normalizeAITechnicalWorld(gs);
  const player=str(next?.team?.team_id??next?.team?.id);
  const ids=teamRows(next)
    .map(teamIdOf)
    .filter((teamId)=>teamId&&teamId!==player&&aiTechnicalTeamState(next,teamId))
    .sort();
  for(const teamId of ids)next=tickAITechnicalTeam(next,teamId,{allowPlanning});
  return next;
}
