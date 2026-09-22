// src/domain/carPerformance.js
//
// Shared car-performance model. This is intentionally independent from the UI
// so race simulation, comparisons and the Garage/Car page use the same numbers.
import { baseConditionAdjustmentForCar, garageCarForDriver, installedAdjustmentForCar } from "./garage.js";

const unwrap=(v)=>{
  if(v&&typeof v==="object"&&!Array.isArray(v))return v.result ?? v.value ?? null;
  return v;
};
const pick=(o,keys,fb=undefined)=>{
  for(const k of keys){
    const v=unwrap(o?.[k]);
    if(v!==undefined&&v!==null&&v!=="")return v;
  }
  return fb;
};
const n=(v,fb=NaN)=>{const x=Number(unwrap(v));return Number.isFinite(x)?x:fb;};
const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));
const round1=(v)=>Math.round(Number(v||0)*10)/10;

const CHASSIS_KEYS=[
  ["chassis_spec",0.25],
  ["aero_spec",0.24],
  ["gearbox_spec",0.12],
  ["suspension_spec",0.13],
  ["brakes_spec",0.10],
  ["cooling_spec",0.08],
  ["electronics_spec",0.04],
  ["turbo_spec",0.02],
  ["kers_spec",0.01],
  ["ers_mgu_k",0.005],
  ["ers_mgu_h",0.005],
];

function weightedAvailable(row,pairs){
  let total=0,sum=0;
  for(const [key,w] of pairs){
    const value=n(row?.[key],NaN);
    if(!Number.isFinite(value))continue;
    total+=w;
    sum+=clamp(value)*w;
  }
  return total>0?sum/total:null;
}
function rowForTeam(rows,teamId,year){
  const list=Array.isArray(rows)?rows:[];
  const exact=list.find((r)=>
    String(pick(r,["team_id","team","constructor_id","constructor"],""))===String(teamId) &&
    (!Number.isFinite(Number(year)) || !Number.isFinite(n(pick(r,["year","season_year"],NaN),NaN)) || n(pick(r,["year","season_year"],NaN),NaN)===Number(year))
  );
  if(exact)return exact;
  return list.find((r)=>String(pick(r,["team_id","team","constructor_id","constructor"],""))===String(teamId))||null;
}

export function teamCarPerformance(gs,teamId,driverId=null){
  const year=Number(gs?.activeYear);
  const car=rowForTeam(gs?.carStats||gs?.dbCarStats||[],teamId,year)||{};
  const engine=rowForTeam(gs?.teamEngines||gs?.dbTeamEngines||[],teamId,year)||{};

  const chassis=weightedAvailable(car,CHASSIS_KEYS);
  const enginePower=n(pick(engine,["power","engine_power","Ovrl","overall"],NaN),NaN);
  const integration=n(pick(engine,["chassis_integration"],NaN),NaN);
  const engineOverall=n(pick(engine,["Ovrl","overall"],NaN),NaN);

  const power=Number.isFinite(enginePower)
    ? (Number.isFinite(integration)?enginePower*0.82+integration*0.18:enginePower)
    : (Number.isFinite(engineOverall)?engineOverall:(chassis??70));

  let carReliability=n(pick(car,["reliability"],NaN),NaN);
  if(Number.isFinite(carReliability)&&carReliability<=1)carReliability*=100;
  let engineReliability=n(pick(engine,["reliability_override"],NaN),NaN);
  if(Number.isFinite(engineReliability)&&engineReliability<=1)engineReliability*=100;
  if(!Number.isFinite(engineReliability))engineReliability=n(pick(engine,["reliability"],NaN),NaN);

  const reliability=Number.isFinite(carReliability)&&Number.isFinite(engineReliability)
    ? carReliability*0.55+engineReliability*0.45
    : Number.isFinite(carReliability)?carReliability:Number.isFinite(engineReliability)?engineReliability:75;

  const aero=n(car?.aero_spec,chassis??70);
  const chassisSpec=n(car?.chassis_spec,chassis??70);
  const gearbox=n(car?.gearbox_spec,chassis??70);
  const brakes=n(car?.brakes_spec,chassis??70);
  const suspension=n(car?.suspension_spec,chassis??70);

  const qualifying=clamp(
    aero*0.30+chassisSpec*0.22+power*0.28+gearbox*0.10+suspension*0.10
  );
  const race=clamp(
    (chassis??70)*0.52+power*0.28+reliability*0.08+brakes*0.06+suspension*0.06
  );
  let installed={qualifying:0,race:0,reliability:0};
  let condition={qualifying:0,race:0,reliability:0};
  if(String(teamId??"")===String(gs?.team?.team_id??gs?.team?.id??"")){
    if(driverId){
      const garageCar=garageCarForDriver(gs,driverId);
      if(garageCar){
        installed=installedAdjustmentForCar(gs,garageCar);
        condition=baseConditionAdjustmentForCar(gs,garageCar);
      }
    }else{
      const raceCars=(gs?.garage?.cars||[]).filter((x)=>x?.kind==="race");
      if(raceCars.length){
        const installedRows=raceCars.map((x)=>installedAdjustmentForCar(gs,x));
        const conditionRows=raceCars.map((x)=>baseConditionAdjustmentForCar(gs,x));
        installed={
          qualifying:installedRows.reduce((a,b)=>a+b.qualifying,0)/installedRows.length,
          race:installedRows.reduce((a,b)=>a+b.race,0)/installedRows.length,
          reliability:installedRows.reduce((a,b)=>a+b.reliability,0)/installedRows.length,
        };
        condition={
          qualifying:conditionRows.reduce((a,b)=>a+b.qualifying,0)/conditionRows.length,
          race:conditionRows.reduce((a,b)=>a+b.race,0)/conditionRows.length,
          reliability:conditionRows.reduce((a,b)=>a+b.reliability,0)/conditionRows.length,
        };
      }
    }
  }

  const finalQualifying=clamp(qualifying+installed.qualifying+condition.qualifying);
  const finalRace=clamp(race+installed.race+condition.race);
  const finalReliability=clamp(reliability+installed.reliability+condition.reliability);
  const overall=clamp(finalQualifying*0.42+finalRace*0.48+finalReliability*0.10);

  return {
    team_id:String(teamId??""),
    overall:round1(overall),
    qualifying:round1(finalQualifying),
    race:round1(finalRace),
    reliability:round1(finalReliability),
    chassis:round1(chassis??70),
    power:round1(power),
    development_bonus:{
      qualifying:round1(installed.qualifying),
      race:round1(installed.race),
      reliability:round1(installed.reliability),
    },
    wear_penalty:{
      qualifying:round1(condition.qualifying),
      race:round1(condition.race),
      reliability:round1(condition.reliability),
    },
    source:{car,engine},
  };
}

function facilityLevelForTeam(gs,teamId,key){
  const tid=String(teamId??"");
  const player=String(gs?.team?.team_id??gs?.team?.id??"");
  const aliases=key==="manufacturing_level"
    ?["manufacturing_level","manufacturing_leve"]
    :[key];

  if(tid&&tid===player){
    for(const alias of aliases){
      const override=n(gs?.hq?.facilityLevels?.[alias],NaN);
      if(Number.isFinite(override))return clamp(override,1,10);
    }
  }

  const year=Number(gs?.activeYear);
  const rows=Array.isArray(gs?.facilities)&&gs.facilities.length
    ?gs.facilities
    :(gs?.dbFacilities||[]);
  const row=(rows||[]).find((item)=>{
    const rowTeam=String(pick(item,["team_id","team","constructor_id","constructor"],""));
    const rowYear=n(pick(item,["year","season_year"],NaN),NaN);
    return rowTeam===tid&&(!Number.isFinite(year)||!Number.isFinite(rowYear)||rowYear===year);
  })||{};
  for(const alias of aliases){
    const value=n(row?.[alias],NaN);
    if(Number.isFinite(value))return clamp(value,1,10);
  }
  return 5;
}

function completedReliabilityProjectBonus(gs,teamId){
  const tid=String(teamId??"");
  const player=String(gs?.team?.team_id??gs?.team?.id??"");
  const rows=[
    ...(Array.isArray(gs?.development?.projects)?gs.development.projects:[]),
    ...(Array.isArray(gs?.development?.research)?gs.development.research:[]),
  ];
  return rows
    .filter((project)=>{
      const status=String(project?.status||"").toLowerCase();
      if(!["completed","done","finished"].includes(status))return false;
      const label=String(project?.area??project?.focus??project?.name??project?.title??"").toLowerCase();
      if(!label.includes("reliab"))return false;
      const projectTeam=String(project?.team_id??project?.constructor_id??"");
      return projectTeam?projectTeam===tid:tid===player;
    })
    .reduce((sum,project)=>sum+Math.max(0,n(project?.target_gain??project?.gain??project?.reliability_gain,1))*0.4,0);
}

/**
 * Canonical race-day reliability profile.
 *
 * The base comes from the same live car model used by Garage/Car Performance.
 * Practice, facilities and completed reliability work are applied as modest
 * percentage-point modifiers. Both Live Race Control and the direct GP path
 * consume this profile so they cannot disagree about the same car.
 */
export function raceReliabilityProfile(gs,teamId,driverId=null){
  const tid=String(teamId??"");
  const did=driverId==null?null:String(driverId);
  const performance=teamCarPerformance(gs,tid,did);
  const basePct=clamp(n(performance?.reliability,75));

  const practice=(gs?.raceWeekendState?.practice?.results||[]).find(
    (row)=>String(row?.driver_id??"")===String(did??"")
  )||null;
  const practiceBonusPct=did?Math.max(0,n(practice?.reliability_bonus,0)):0;

  const manufacturing=facilityLevelForTeam(gs,tid,"manufacturing_level");
  const facilityBonusPct=(manufacturing-5)*0.4;
  const developmentBonusPct=completedReliabilityProjectBonus(gs,tid);

  const effectivePct=clamp(
    basePct+practiceBonusPct+facilityBonusPct+developmentBonusPct,
    55,
    97
  );

  return {
    team_id:tid,
    driver_id:did,
    reliability:Number((effectivePct/100).toFixed(4)),
    reliability_pct:round1(effectivePct),
    base_car_reliability_pct:round1(basePct),
    practice_bonus_pct:round1(practiceBonusPct),
    facility_bonus_pct:round1(facilityBonusPct),
    development_bonus_pct:round1(developmentBonusPct),
    manufacturing_level:round1(manufacturing),
    car_performance:performance,
    source:"canonical_race_reliability",
  };
}

export function carPerformanceRanking(gs){
  return (gs?.teams||[])
    .map((team)=>{
      const id=String(team?.team_id??team?.id??"");
      return {
        ...teamCarPerformance(gs,id),
        team_name:team?.team_name||team?.name||id,
      };
    })
    .sort((a,b)=>b.overall-a.overall||String(a.team_name).localeCompare(String(b.team_name)))
    .map((row,index)=>({...row,rank:index+1}));
}
