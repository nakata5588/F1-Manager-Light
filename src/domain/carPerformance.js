// src/domain/carPerformance.js
//
// Shared car-performance model. This is intentionally independent from the UI
// so race simulation, comparisons and the Garage/Car page use the same numbers.
import { baseConditionAdjustmentForCar, garageCarForDriver, installedAdjustmentForCar } from "./garage.js";
import { carReliabilityProfile } from "./carReliability.js";
import { aiTechnicalCarForDriver, aiTechnicalScopedState } from "../engine/AITechnicalEngine.js";

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

  const reliabilityProfile=carReliabilityProfile(gs,teamId,driverId);
  const reliability=Number(reliabilityProfile?.historical?.combined_pct??75);

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
  let installed={qualifying:0,race:0,reliability:0,technical:{weight_delta_kg:0,drag_delta:0,downforce_delta:0,design_reliability_delta_pct:0}};
  let condition={qualifying:0,race:0,reliability:0};
  {
    const isPlayer=String(teamId??"")===String(gs?.team?.team_id??gs?.team?.id??"");
    const sourceState=isPlayer?gs:aiTechnicalScopedState(gs,teamId);
    if(sourceState){
      if(driverId){
        const garageCar=isPlayer
          ?garageCarForDriver(gs,driverId)
          :aiTechnicalCarForDriver(gs,teamId,driverId);
        if(garageCar){
          installed=installedAdjustmentForCar(sourceState,garageCar);
          condition=baseConditionAdjustmentForCar(sourceState,garageCar);
        }
      }else{
        const raceCars=(sourceState?.garage?.cars||[]).filter((x)=>x?.kind==="race");
      if(raceCars.length){
        const installedRows=raceCars.map((x)=>installedAdjustmentForCar(sourceState,x));
        const conditionRows=raceCars.map((x)=>baseConditionAdjustmentForCar(sourceState,x));
        installed={
          qualifying:installedRows.reduce((a,b)=>a+b.qualifying,0)/installedRows.length,
          race:installedRows.reduce((a,b)=>a+b.race,0)/installedRows.length,
          reliability:installedRows.reduce((a,b)=>a+b.reliability,0)/installedRows.length,
          technical:{
            weight_delta_kg:installedRows.reduce((a,b)=>a+Number(b?.technical?.weight_delta_kg||0),0)/installedRows.length,
            drag_delta:installedRows.reduce((a,b)=>a+Number(b?.technical?.drag_delta||0),0)/installedRows.length,
            downforce_delta:installedRows.reduce((a,b)=>a+Number(b?.technical?.downforce_delta||0),0)/installedRows.length,
            design_reliability_delta_pct:installedRows.reduce((a,b)=>a+Number(b?.technical?.design_reliability_delta_pct||0),0)/installedRows.length,
          },
        };
        condition={
          qualifying:conditionRows.reduce((a,b)=>a+b.qualifying,0)/conditionRows.length,
          race:conditionRows.reduce((a,b)=>a+b.race,0)/conditionRows.length,
          reliability:conditionRows.reduce((a,b)=>a+b.reliability,0)/conditionRows.length,
        };
      }
      }
    }
  }

  const finalQualifying=clamp(qualifying+installed.qualifying+condition.qualifying);
  const finalRace=clamp(race+installed.race+condition.race);
  const finalReliability=clamp(reliabilityProfile?.reliability_pct??reliability);
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
      reliability:round1(reliabilityProfile?.design_delta_pct||0),
    },
    technical_delta:{
      weight_kg:Number(Number(installed?.technical?.weight_delta_kg||0).toFixed(2)),
      drag:Number(Number(installed?.technical?.drag_delta||0).toFixed(4)),
      downforce:Number(Number(installed?.technical?.downforce_delta||0).toFixed(4)),
      design_reliability_pct:round1(installed?.technical?.design_reliability_delta_pct||0),
    },
    wear_penalty:{
      qualifying:round1(condition.qualifying),
      race:round1(condition.race),
      reliability:-round1(reliabilityProfile?.condition_penalty_pct||0),
    },
    reliability_profile:reliabilityProfile,
    source:{car,engine},
  };
}

export function raceReliabilityProfile(gs,teamId,driverId=null){
  const profile=carReliabilityProfile(gs,teamId,driverId);
  return {
    ...profile,
    base_car_reliability_pct:round1(profile?.historical?.combined_pct||75),
    practice_bonus_pct:0,
    facility_bonus_pct:0,
    development_bonus_pct:round1(profile?.design_delta_pct||0),
    car_performance:teamCarPerformance(gs,teamId,driverId),
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
