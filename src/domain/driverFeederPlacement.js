// src/domain/driverFeederPlacement.js
// D7.W2 — Generic Feeder Placement.
//
// Analysis-only placement layer built on D7.W1 World Entry.
// It deliberately avoids inventing or simulating specific feeder championships.
//
// Historical seed categories:
//   NOT_IN_WORLD -> YOUTH -> LOWER_SERIES -> F1_READY
//
// Historical F1/opening-state cases are delegated to the existing canonical
// Opening State logic. After New Game, Save World progression must be dynamic.

import { driverWorldStageAtYear } from "./driverWorldEntry.js";

const num=(value,fallback=null)=>{
  if(value===undefined||value===null||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const text=(value)=>String(value??"").trim();

const DEFAULTS=Object.freeze({
  youth_max_age:19,
  f1_ready_min_age:18,
  f1_ready_reference_window_years:1,
});

function basePlacement(driver,entry,year,options={}){
  const settings={...DEFAULTS,...options};
  const world=driverWorldStageAtYear(driver,entry,year,{youthMaxAge:settings.youth_max_age});
  const debut=num(entry?.reference_f1_debut_year,null);
  const target=Number(year);
  const age=num(world?.age,null);
  const yearsToReferenceDebut=Number.isInteger(debut)&&Number.isInteger(target)
    ?debut-target
    :null;

  return {settings,world,debut,target,age,yearsToReferenceDebut};
}

export function inferDriverFeederPlacement(driver,entry,year,options={}){
  const {settings,world,age,yearsToReferenceDebut}=basePlacement(driver,entry,year,options);
  const common={
    driver_id:text(entry?.driver_id??driver?.driver_id??driver?.id),
    display_name:text(entry?.display_name??driver?.display_name??driver?.name),
    year:Number(year),
    stage:"D7.W2",
    authority:"analysis_only",
    model:"generic_feeder_placement_v1",
    age:Number.isFinite(age)?age:null,
    first_world_year:num(entry?.first_world_year,null),
    reference_f1_debut_year:num(entry?.reference_f1_debut_year,null),
    years_to_reference_f1_debut:Number.isInteger(yearsToReferenceDebut)?yearsToReferenceDebut:null,
    forced_future_f1_debut:false,
    forced_future_team:false,
  };

  if(!world?.active_world){
    return {
      ...common,
      placement:world?.stage||"NOT_IN_WORLD",
      active_pre_f1_world:false,
      scoutable:false,
      can_hire_academy:false,
      can_hire_f1:false,
      market_policy:"UNAVAILABLE",
      scouting_profile:"NONE",
      uncertainty:"NONE",
    };
  }

  // W2 does not reinterpret exact historical F1/gap/contract state. That is
  // the responsibility of canonical Opening State / Season Pack materialization.
  if(world.stage==="F1_REFERENCE_WINDOW"){
    return {
      ...common,
      placement:"HISTORICAL_OPENING_STATE",
      active_pre_f1_world:false,
      scoutable:true,
      can_hire_academy:false,
      can_hire_f1:null,
      market_policy:"DELEGATE_TO_OPENING_STATE",
      scouting_profile:"PUBLIC_OR_OPENING_STATE",
      uncertainty:"LOW",
    };
  }

  let placement="LOWER_SERIES";
  if(Number.isFinite(age)&&age<=Number(settings.youth_max_age)){
    placement="YOUTH";
  }else if(
    Number.isFinite(age)&&
    age>=Number(settings.f1_ready_min_age)&&
    Number.isInteger(yearsToReferenceDebut)&&
    yearsToReferenceDebut>=0&&
    yearsToReferenceDebut<=Number(settings.f1_ready_reference_window_years)
  ){
    placement="F1_READY";
  }

  if(placement==="YOUTH"){
    return {
      ...common,
      placement,
      active_pre_f1_world:true,
      scoutable:true,
      can_hire_academy:true,
      can_hire_f1:false,
      market_policy:"ACADEMY_ONLY",
      scouting_profile:"DEEP_SCOUTING_RECOMMENDED",
      uncertainty:"HIGH",
    };
  }

  if(placement==="F1_READY"){
    return {
      ...common,
      placement,
      active_pre_f1_world:true,
      scoutable:true,
      can_hire_academy:false,
      can_hire_f1:true,
      market_policy:"APPROACHABLE_F1_READY",
      scouting_profile:"LIGHT_OR_DEEP",
      uncertainty:"MEDIUM_LOW",
    };
  }

  return {
    ...common,
    placement:"LOWER_SERIES",
    active_pre_f1_world:true,
    scoutable:true,
    can_hire_academy:false,
    can_hire_f1:Number.isFinite(age)?age>=18:false,
    market_policy:"APPROACHABLE_LOWER_SERIES",
    scouting_profile:"STANDARD_OR_DEEP",
    uncertainty:"MEDIUM",
  };
}

export function inferDriverFeederPlacements(drivers=[],entries=[],year,options={}){
  const entryById=new Map((entries||[]).map(row=>[String(row?.driver_id||""),row]));
  return (Array.isArray(drivers)?drivers:[])
    .map(driver=>{
      const id=String(driver?.driver_id??driver?.id??"");
      const entry=entryById.get(id);
      return entry?inferDriverFeederPlacement(driver,entry,year,options):null;
    })
    .filter(Boolean)
    .sort((a,b)=>String(a.driver_id).localeCompare(String(b.driver_id)));
}

export function buildDriverFeederPlacementAudit(placements=[]){
  const source=Array.isArray(placements)?placements:[];
  const counts={};
  const marketPolicies={};
  const scoutingProfiles={};
  for(const row of source){
    counts[row.placement]=(counts[row.placement]||0)+1;
    marketPolicies[row.market_policy]=(marketPolicies[row.market_policy]||0)+1;
    scoutingProfiles[row.scouting_profile]=(scoutingProfiles[row.scouting_profile]||0)+1;
  }

  return {
    format:"f1ml-driver-feeder-placement-audit",
    schema_version:1,
    generated_at:null,
    stage:"D7.W2",
    authority:"analysis_only",
    year:source[0]?.year??null,
    total_profiles:source.length,
    placement_counts:counts,
    market_policy_counts:marketPolicies,
    scouting_profile_counts:scoutingProfiles,
    notes:[
      "D7.W2 uses generic Youth / Lower Series / F1-ready buckets only; no feeder championship is simulated.",
      "Historical F1/opening-state cases are delegated to canonical Opening State rather than reconstructed from career ranges.",
      "Reference F1 debut distance is a historical starting-condition calibration signal only; it does not force Save World promotion.",
      "Youth drivers are academy-only and high-uncertainty; lower-series drivers are scoutable with medium uncertainty; F1-ready drivers are directly approachable.",
      "D7.W3 will later simulate feeder development dynamically after New Game.",
    ],
  };
}

export const DRIVER_FEEDER_PLACEMENT_DEFAULTS=DEFAULTS;
