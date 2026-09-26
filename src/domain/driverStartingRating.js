// src/domain/driverStartingRating.js
// D7.R1D / D7.R2 — development-curve calibration + Starting Rating Materializer.
//
// Historical Starting Conditions -> Dynamic Alternative Future:
// - Talent Profile peak values are latent ceilings calibrated from the full archive.
// - Current attributes at New Game come from a generic career-stage curve.
// - We NEVER back-fill a driver's starting attributes from that same driver's
//   later historical results/snapshots.
// - Once New Game starts, Save World progression owns future development.

import { abilityAttributeScore } from "./driverRating.js";

const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));
const round1=(v)=>Math.round(Number(v||0)*10)/10;
const num=(value,fallback=null)=>{
  if(value===undefined||value===null||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const text=(value)=>String(value??"").trim();
const driverId=(row)=>text(row?.driver_id??row?.person_id??row?.id);

const FACTOR_KEYS=Object.freeze([
  "factor_speed",
  "factor_experience",
  "factor_mental",
  "factor_team",
]);

// Median factors from the current R2_HISTORICAL_SMOOTHED calibration archive.
// buildStartingRatingCalibration() recalculates these from supplied snapshots;
// these values are deterministic fallbacks for legacy/fallback runtime paths.
export const STARTING_RATING_FACTOR_DEFAULTS=Object.freeze({
  "Junior / Prospect":Object.freeze({
    factor_speed:0.542,
    factor_experience:0.366,
    factor_mental:0.422,
    factor_team:0.341,
  }),
  Rookie:Object.freeze({
    factor_speed:0.678,
    factor_experience:0.628,
    factor_mental:0.645,
    factor_team:0.626,
  }),
  Developing:Object.freeze({
    factor_speed:0.846,
    factor_experience:0.738,
    factor_mental:0.699,
    factor_team:0.618,
  }),
  Prime:Object.freeze({
    factor_speed:0.960,
    factor_experience:0.970,
    factor_mental:0.955,
    factor_team:0.925,
  }),
  Veteran:Object.freeze({
    factor_speed:0.940,
    factor_experience:0.990,
    factor_mental:0.990,
    factor_team:0.970,
  }),
  Decline:Object.freeze({
    factor_speed:0.960,
    factor_experience:0.997,
    factor_mental:0.995,
    factor_team:0.988,
  }),
});

const GROUP_FLOORS=Object.freeze({
  speed:35,
  experience:30,
  mental:40,
  team:35,
});

const ATTRIBUTE_BLUEPRINT=Object.freeze([
  ["pace","peak_pace","speed"],
  ["qualifying","peak_qualifying","speed"],
  ["start_launch","peak_start_launch","speed"],
  ["wet_skill","peak_wet_skill","speed"],

  ["racecraft","peak_racecraft","experience"],
  ["consistency","peak_consistency","experience"],
  ["tire_management","peak_tire_management","experience"],
  ["race_intelligence","peak_race_intelligence","experience"],
  ["technical_feedback","peak_technical_feedback","experience"],
  ["ers_fuel_management","peak_resource_management","experience"],

  ["adaptability","peak_adaptability","mental"],
  ["mentality","peak_mentality","mental"],
  ["pressure_handling","peak_pressure_handling","mental"],

  ["leadership","peak_leadership","team"],
  ["team_player","peak_team_player","team"],
  ["car_development_impact","peak_car_development_impact","team"],
]);

function median(values){
  const source=(values||[]).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  return source.length?source[Math.floor(source.length/2)]:null;
}

function birthDateParts(driver){
  const raw=text(driver?.dob??driver?.birthdate_iso??driver?.birthdate??driver?.date_of_birth);
  const match=raw.match(/^(\d{4})(?:-(\d{2})-(\d{2}))?/);
  if(!match)return null;
  return {
    year:Number(match[1]),
    month:match[2]?Number(match[2]):1,
    day:match[3]?Number(match[3]):1,
  };
}

export function driverOpeningAge(driver,year){
  const dob=birthDateParts(driver);
  const target=Number(year);
  if(!dob||!Number.isInteger(target))return null;
  let age=target-dob.year;
  if(dob.month>1||(dob.month===1&&dob.day>1))age-=1;
  return age;
}

function stageRows(snapshots,stage){
  return (Array.isArray(snapshots)?snapshots:[])
    .filter((row)=>String(row?.career_stage||"")===String(stage));
}

function factorMedian(rows,key,fallback){
  const value=median((rows||[]).map((row)=>num(row?.[key],null)));
  return Number.isFinite(value)?value:fallback;
}

function juniorAgeBucket(age){
  if(!Number.isFinite(Number(age)))return null;
  if(Number(age)<=19)return "u19";
  if(Number(age)<=21)return "20_21";
  return "22_plus";
}

function inJuniorBucket(row,bucket){
  const age=num(row?.age_start,null);
  if(!Number.isFinite(age))return false;
  if(bucket==="u19")return age<=19;
  if(bucket==="20_21")return age>=20&&age<=21;
  if(bucket==="22_plus")return age>=22;
  return false;
}

export function buildStartingRatingCalibration(historicalSnapshots=[]){
  const stageFactors={};
  for(const stage of Object.keys(STARTING_RATING_FACTOR_DEFAULTS)){
    const rows=stageRows(historicalSnapshots,stage);
    const fallback=STARTING_RATING_FACTOR_DEFAULTS[stage];
    stageFactors[stage]=Object.fromEntries(
      FACTOR_KEYS.map((key)=>[
        key,
        factorMedian(rows,key,fallback[key]),
      ])
    );
  }

  const juniorRows=stageRows(historicalSnapshots,"Junior / Prospect");
  const juniorAgeFactors={};
  for(const bucket of ["u19","20_21","22_plus"]){
    const subset=juniorRows.filter((row)=>inJuniorBucket(row,bucket));
    const weight=subset.length/(subset.length+12);
    juniorAgeFactors[bucket]=Object.fromEntries(
      FACTOR_KEYS.map((key)=>{
        const base=stageFactors["Junior / Prospect"][key];
        const local=factorMedian(subset,key,base);
        return [key,base*(1-weight)+local*weight];
      })
    );
    juniorAgeFactors[bucket].sample_size=subset.length;
  }

  return {
    version:"D7.R1D_CALIBRATION_V1",
    source_rows:Array.isArray(historicalSnapshots)?historicalSnapshots.length:0,
    stage_factors:stageFactors,
    junior_age_factors:juniorAgeFactors,
  };
}

export function driverStartingStage(driver,profile,year,{
  placement=null,
  stageOverride=null,
}={}){
  if(stageOverride)return String(stageOverride);

  const placementKey=String(placement?.placement||placement?.feeder_placement||"");
  if(["YOUTH","LOWER_SERIES","F1_READY"].includes(placementKey)){
    return "Junior / Prospect";
  }

  const target=Number(year);
  const debut=num(
    profile?.derived_f1_debut_year ??
    driver?.f1_rookie_season ??
    driver?.f1_debut_year,
    null
  );
  const age=num(placement?.age,driverOpeningAge(driver,target));
  const peakAge=num(profile?.peak_age,29);
  const declineAge=num(profile?.decline_start_age,35);

  if(Number.isFinite(debut)&&target<debut)return "Junior / Prospect";
  if(Number.isFinite(debut)&&target===debut)return "Rookie";
  if(Number.isFinite(age)&&age<=21&&!Number.isFinite(debut))return "Junior / Prospect";
  if(Number.isFinite(age)&&age<Math.max(22,peakAge-2))return "Developing";
  if(Number.isFinite(age)&&age<declineAge)return "Prime";
  if(Number.isFinite(age)&&age<declineAge+4)return "Veteran";
  return "Decline";
}

export function startingRatingFactors(calibration,stage,age){
  const base={
    ...(STARTING_RATING_FACTOR_DEFAULTS[stage]||STARTING_RATING_FACTOR_DEFAULTS.Developing),
    ...(calibration?.stage_factors?.[stage]||{}),
  };
  if(stage!=="Junior / Prospect")return base;

  const bucket=juniorAgeBucket(age);
  const local=bucket?calibration?.junior_age_factors?.[bucket]:null;
  if(!local)return base;
  return Object.fromEntries(
    FACTOR_KEYS.map((key)=>[key,num(local?.[key],base[key])])
  );
}

function currentFromPeak(peak,factor,group){
  const value=num(peak,null);
  if(!Number.isFinite(value))return null;
  const floor=GROUP_FLOORS[group];
  return round1(clamp(floor+(value-floor)*clamp(factor,0,1)));
}

export function materializeDriverStartingRating({
  driver,
  profile,
  year,
  placement=null,
  historicalSnapshots=[],
  calibration=null,
  stageOverride=null,
}={}){
  if(!driver||!profile)return null;
  const id=driverId(driver)||driverId(profile);
  if(!id)return null;

  const target=Number(year);
  if(!Number.isInteger(target))return null;

  const age=num(placement?.age,driverOpeningAge(driver,target));
  const stage=driverStartingStage(driver,profile,target,{placement,stageOverride});
  const model=calibration||buildStartingRatingCalibration(historicalSnapshots);
  const factors=startingRatingFactors(model,stage,age);

  const rating={
    year:target,
    driver_id:id,
    driver_name:text(driver?.display_name??driver?.driver_name??profile?.display_name??id),
    current_ability:null,
    potential_ability:round1(clamp(num(profile?.peak_ability,70))),
    career_stage:stage,
    development_curve:text(profile?.development_curve||"balanced")||"balanced",
    rating_tier:text(profile?.tier||profile?.rating_tier||""),
    rating_confidence:text(profile?.rating_confidence||"MEDIUM"),
    source:"talent_profile_starting_materializer",
    rating_model:"D7.R2",
    calibration_version:model?.version||"D7.R1D_CALIBRATION_V1",
    calibration_source_rows:num(model?.source_rows,0),
    factor_speed:round1(factors.factor_speed*100)/100,
    factor_experience:round1(factors.factor_experience*100)/100,
    factor_mental:round1(factors.factor_mental*100)/100,
    factor_team:round1(factors.factor_team*100)/100,
  };

  for(const [currentKey,peakKey,group] of ATTRIBUTE_BLUEPRINT){
    const factor=factors["factor_"+group];
    const value=currentFromPeak(profile?.[peakKey],factor,group);
    if(Number.isFinite(value))rating[currentKey]=value;
  }

  const aggression=num(profile?.base_aggression,null);
  const crash=num(profile?.base_crash_likelihood,null);
  if(Number.isFinite(aggression))rating.aggression=round1(clamp(aggression));
  if(Number.isFinite(crash))rating.crash_likelihood=round1(clamp(crash));

  const score=abilityAttributeScore(rating);
  rating.current_ability=round1(clamp(
    Number.isFinite(score)?score:num(profile?.peak_ability,70)*0.7
  ));
  rating.development_headroom=round1(Math.max(0,rating.potential_ability-rating.current_ability));

  return rating;
}

export function materializeMissingStartingRatings({
  drivers=[],
  existingRatings=[],
  profiles=[],
  year,
  placements=[],
  historicalSnapshots=[],
}={}){
  const rows=Array.isArray(existingRatings)?existingRatings:[];
  const byId=new Map(rows.map((row)=>[driverId(row),row]).filter(([id])=>id));
  const profileById=new Map((profiles||[]).map((row)=>[driverId(row),row]).filter(([id])=>id));
  const placementById=new Map((placements||[]).map((row)=>[driverId(row),row]).filter(([id])=>id));
  const calibration=buildStartingRatingCalibration(historicalSnapshots);

  for(const driver of Array.isArray(drivers)?drivers:[]){
    const id=driverId(driver);
    if(!id||byId.has(id))continue;
    const profile=profileById.get(id);
    if(!profile)continue;
    const rating=materializeDriverStartingRating({
      driver,
      profile,
      year,
      placement:placementById.get(id)||null,
      calibration,
    });
    if(rating)byId.set(id,rating);
  }
  return [...byId.values()];
}
