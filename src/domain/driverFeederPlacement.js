// src/domain/driverFeederPlacement.js
// D7.W2 / LS1.5B — Feeder Pyramid Placement.
//
// World Entry remains the authority for whether a driver exists in the active
// motorsport world. This layer derives the opening feeder level and, only when
// the historical catalogue supports it unambiguously, a concrete series.
//
// Historical opening evidence may seed the selected New Game season. It never
// forces a future F1 debut, future team, future series or future result after
// the Save World branches away from history.

import { driverWorldStageAtYear } from "./driverWorldEntry.js";
import {
  activeSeriesForYear,
  eligibleSeriesForDriver,
  seriesAgeEligibility,
  seriesIdOf,
  seriesLevelOf,
  seriesNameOf,
  seriesRuleForYear,
} from "./seriesCatalog.js";

const unwrap=(value)=>{
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    if(value.result!==undefined&&value.result!==null&&value.result!=="")return unwrap(value.result);
    if(value.value!==undefined&&value.value!==null&&value.value!=="")return unwrap(value.value);
    if(value.text!==undefined&&value.text!==null&&value.text!=="")return unwrap(value.text);
    if(Object.prototype.hasOwnProperty.call(value,"formula"))return null;
  }
  return value;
};
const num=(value,fallback=null)=>{
  const raw=unwrap(value);
  if(raw===undefined||raw===null||raw==="")return fallback;
  const parsed=Number(raw);
  return Number.isFinite(parsed)?parsed:fallback;
};
const text=(value)=>String(unwrap(value)??"").trim();
const norm=(value)=>text(value)
  .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .toLowerCase().replace(/[^a-z0-9]+/g,"");

const DEFAULTS=Object.freeze({
  youth_max_age:19,
  f1_ready_min_age:18,
  f1_ready_reference_window_years:1,
});

function driverId(row){
  return text(row?.driver_id??row?.person_id??row?.id);
}

function rowYear(row){
  for(const key of ["year","season_year","season","yr"]){
    const value=num(row?.[key],null);
    if(Number.isInteger(value))return value;
  }
  return null;
}

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

function careerRowsAtOpening(driver,year,careerRows=[]){
  const id=driverId(driver);
  return (Array.isArray(careerRows)?careerRows:[])
    .filter((row)=>driverId(row)===id&&rowYear(row)===Number(year));
}

function seriesRuleId(rule){
  return text(rule?.series_rule_id??rule?.rule_id??rule?.id)||null;
}

function careerLevelHint(row){
  const explicit=num(row?.series_level,null);
  if(Number.isFinite(explicit))return explicit;

  const raw=text(row?.series_division??row?.division??row?.series);
  const numeric=Number(raw);
  if(Number.isFinite(numeric)&&numeric>=1&&numeric<=5)return numeric;

  const value=norm(raw);
  if(!value)return null;
  if(value==="f1"||value.includes("formula1"))return 1;
  if(
    value==="f2"||value.includes("formula2")||value.includes("f3000")||
    value.includes("gp2")||value.includes("formula35")||value.includes("formulav835")
  )return 2;
  if(value==="f3"||value.includes("formula3")||value.includes("gp3"))return 3;
  if(value.includes("regional")||value.includes("formulerenault")||value.includes("formularenault"))return 4;
  if(
    value==="f4"||value.includes("formula4")||value.includes("formulaford")||
    value.includes("formulajunior")||value.includes("formulaabarth")
  )return 5;
  return null;
}

function openingTargetLevel(placement,age,yearsToReferenceDebut,careerRows=[]){
  const careerHint=careerRows.map(careerLevelHint).find((level)=>Number.isFinite(level)&&level>1);
  if(Number.isFinite(careerHint))return careerHint;

  if(placement==="F1_READY")return 2;
  if(placement==="YOUTH"){
    return Number.isFinite(age)&&age<=17?5:4;
  }

  if(placement==="LOWER_SERIES"){
    if(Number.isInteger(yearsToReferenceDebut)){
      if(yearsToReferenceDebut<=2)return 2;
      if(yearsToReferenceDebut<=4)return 3;
      return Number.isFinite(age)&&age<=19?4:3;
    }
    if(Number.isFinite(age)){
      if(age<=17)return 5;
      if(age<=19)return 4;
      if(age<=22)return 3;
      return 2;
    }
  }
  return null;
}

function historicalSeriesMatch(driver,year,seriesRows,seriesRules,careerRows){
  const active=activeSeriesForYear(seriesRows,year);
  if(!active.length||!careerRows.length)return null;

  for(const row of careerRows){
    const explicitId=text(row?.series_id);
    if(explicitId){
      const series=active.find((candidate)=>seriesIdOf(candidate)===explicitId);
      if(series){
        const rule=seriesRuleForYear(seriesRules,explicitId,year);
        const ageEligibility=seriesAgeEligibility(driver,rule,year);
        return {series,rule,ageEligibility,source:"historical_series_id"};
      }
    }
  }

  for(const row of careerRows){
    const label=norm(row?.series_name??row?.series??row?.series_division??row?.division);
    if(!label)continue;
    const matches=active.filter((series)=>{
      const aliases=[
        seriesIdOf(series),
        seriesNameOf(series),
        series?.short_name,
        series?.series_short_name,
        series?.category,
      ].map(norm).filter(Boolean);
      return aliases.includes(label);
    });
    if(matches.length===1){
      const series=matches[0];
      const rule=seriesRuleForYear(seriesRules,seriesIdOf(series),year);
      const ageEligibility=seriesAgeEligibility(driver,rule,year);
      return {series,rule,ageEligibility,source:"historical_series_label"};
    }
  }

  return null;
}

function resolveOpeningSeries(driver,row,options={}){
  const seriesRows=Array.isArray(options.series)?options.series:[];
  const seriesRules=Array.isArray(options.seriesRules)?options.seriesRules:[];
  if(!seriesRows.length||!row?.active_pre_f1_world)return row;

  const careerRows=careerRowsAtOpening(driver,row.year,options.driverCareer);
  const historical=historicalSeriesMatch(
    driver,row.year,seriesRows,seriesRules,careerRows
  );

  if(historical){
    const level=seriesLevelOf(historical.series);
    return {
      ...row,
      series_id:seriesIdOf(historical.series)||null,
      series_name:seriesNameOf(historical.series)||null,
      series_level:Number.isFinite(level)?level:null,
      series_rule_id:seriesRuleId(historical.rule),
      series_resolution:historical.source,
      series_rule_conflict:!historical.ageEligibility.eligible,
      series_candidates:[],
      opening_series_seed:true,
      forced_future_series:false,
    };
  }

  const targetLevel=openingTargetLevel(
    row.placement,row.age,row.years_to_reference_f1_debut,careerRows
  );
  if(!Number.isFinite(targetLevel)){
    return {
      ...row,
      series_id:null,
      series_name:null,
      series_level:null,
      series_rule_id:null,
      series_resolution:"unresolved_level",
      series_candidates:[],
      opening_series_seed:true,
      forced_future_series:false,
    };
  }

  const eligible=eligibleSeriesForDriver(
    seriesRows,seriesRules,driver,row.year,{levels:[targetLevel]}
  );
  const candidates=eligible.map(({series})=>({
    series_id:seriesIdOf(series),
    series_name:seriesNameOf(series),
    series_level:seriesLevelOf(series),
  }));

  if(eligible.length===1){
    const [{series,rule}]=eligible;
    return {
      ...row,
      series_id:seriesIdOf(series)||null,
      series_name:seriesNameOf(series)||null,
      series_level:seriesLevelOf(series),
      series_rule_id:seriesRuleId(rule),
      series_resolution:"single_active_eligible_series",
      series_candidates:[],
      opening_series_seed:true,
      forced_future_series:false,
    };
  }

  return {
    ...row,
    series_id:null,
    series_name:null,
    series_level:targetLevel,
    series_rule_id:null,
    series_resolution:eligible.length>1?"candidate_pool":"no_catalog_match",
    series_candidates:candidates,
    opening_series_seed:true,
    forced_future_series:false,
  };
}

export function inferDriverFeederPlacement(driver,entry,year,options={}){
  const {settings,world,age,yearsToReferenceDebut}=basePlacement(driver,entry,year,options);
  const common={
    driver_id:text(entry?.driver_id??driver?.driver_id??driver?.id),
    display_name:text(entry?.display_name??driver?.display_name??driver?.name),
    year:Number(year),
    stage:"D7.W2",
    authority:"analysis_only",
    model:"feeder_pyramid_placement_v2",
    age:Number.isFinite(age)?age:null,
    first_world_year:num(entry?.first_world_year,null),
    reference_f1_debut_year:num(entry?.reference_f1_debut_year,null),
    years_to_reference_f1_debut:Number.isInteger(yearsToReferenceDebut)?yearsToReferenceDebut:null,
    forced_future_f1_debut:false,
    forced_future_team:false,
    forced_future_series:false,
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

  let result;
  if(placement==="YOUTH"){
    result={
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
  }else if(placement==="F1_READY"){
    result={
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
  }else{
    result={
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

  return resolveOpeningSeries(driver,result,options);
}

export function inferDriverFeederPlacements(drivers=[],entries=[],year,options={}){
  const entryById=new Map((entries||[]).map(row=>[text(row?.driver_id),row]));
  return (Array.isArray(drivers)?drivers:[])
    .map(driver=>{
      const id=text(driver?.driver_id??driver?.id);
      const entry=entryById.get(id);
      return entry?inferDriverFeederPlacement(driver,entry,year,options):null;
    })
    .filter(Boolean)
    .sort((a,b)=>text(a.driver_id).localeCompare(text(b.driver_id)));
}

export function buildDriverFeederPlacementAudit(placements=[]){
  const source=Array.isArray(placements)?placements:[];
  const counts={};
  const marketPolicies={};
  const scoutingProfiles={};
  const seriesResolutions={};
  for(const row of source){
    counts[row.placement]=(counts[row.placement]||0)+1;
    marketPolicies[row.market_policy]=(marketPolicies[row.market_policy]||0)+1;
    scoutingProfiles[row.scouting_profile]=(scoutingProfiles[row.scouting_profile]||0)+1;
    if(row.series_resolution){
      seriesResolutions[row.series_resolution]=(seriesResolutions[row.series_resolution]||0)+1;
    }
  }

  return {
    format:"f1ml-driver-feeder-placement-audit",
    schema_version:2,
    generated_at:null,
    stage:"D7.W2",
    authority:"analysis_only",
    year:source[0]?.year??null,
    total_profiles:source.length,
    placement_counts:counts,
    market_policy_counts:marketPolicies,
    scouting_profile_counts:scoutingProfiles,
    series_resolution_counts:seriesResolutions,
    notes:[
      "World Entry still decides whether a driver exists; this layer only resolves opening feeder placement.",
      "A concrete feeder series is used only when historical evidence identifies it or the active age-eligible catalogue has exactly one series at the derived level.",
      "Ambiguous same-level championships remain a candidate pool rather than being selected arbitrarily.",
      "Series age limits are applied when documented series_rules exist; missing rules never invent a restriction.",
      "Historical F1/opening-state cases remain delegated to canonical Opening State.",
      "Reference F1 debut distance calibrates the historical opening seed only; it never forces Save World promotion or future series.",
    ],
  };
}

export const DRIVER_FEEDER_PLACEMENT_DEFAULTS=DEFAULTS;

export function feederPlacementRuntimePatch(placement){
  if(!placement||!(placement.authority==="analysis_only"||placement.stage==="D7.W2"))return null;
  const resolvedSeriesName=text(placement.series_name);
  const base={
    feeder_placement:placement.placement,
    age:num(placement.age,null),
    world_entry_year:num(placement.first_world_year,null),
    reference_f1_debut_year:num(placement.reference_f1_debut_year,null),
    active_lower_series:Boolean(placement.active_pre_f1_world),
    lower_series_id:text(placement.series_id)||null,
    lower_series_level:num(placement.series_level,null),
    lower_series_candidates:Array.isArray(placement.series_candidates)
      ?placement.series_candidates.map((row)=>({...row}))
      :[],
    lower_series_resolution:text(placement.series_resolution)||null,
    lower_series_rule_id:text(placement.series_rule_id)||null,
    world_runtime_source:"driver_world_entry_w3",
  };

  if(placement.placement==="YOUTH"){
    return {
      ...base,
      status:"junior_only",
      lower_series_name:resolvedSeriesName||"Youth",
      youth_eligible:true,
      canHireAcademy:true,
      canHireF1:false,
    };
  }
  if(placement.placement==="F1_READY"){
    return {
      ...base,
      status:"lower_series",
      lower_series_name:resolvedSeriesName||"F1 Ready",
      youth_eligible:false,
      canHireAcademy:false,
      canHireF1:true,
    };
  }
  if(placement.placement==="LOWER_SERIES"){
    return {
      ...base,
      status:"lower_series",
      lower_series_name:resolvedSeriesName||"Lower Series",
      youth_eligible:false,
      canHireAcademy:false,
      canHireF1:Boolean(placement.can_hire_f1),
    };
  }
  return null;
}
