// src/domain/driverStartingRating.js
// D7.R4 — all-eras development-curve + prior-career calibration materializer.
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

const CAREER_FLOOR_ATTRIBUTE_OFFSETS=Object.freeze({
  peak_pace:0,
  peak_qualifying:1,
  peak_start_launch:3,
  peak_wet_skill:4,
  peak_racecraft:0,
  peak_consistency:4,
  peak_tire_management:3,
  peak_race_intelligence:2,
  peak_technical_feedback:5,
  peak_resource_management:4,
  peak_adaptability:3,
  peak_mentality:2,
  peak_pressure_handling:2,
  peak_leadership:6,
  peak_team_player:5,
  peak_car_development_impact:5,
});

export function f1CareerTalentFloor(historyRows=[]){
  const rows=Array.isArray(historyRows)?historyRows:[];
  if(!rows.length)return null;
  const totals=rows.reduce((acc,row)=>({
    starts:acc.starts+Math.max(0,num(row?.starts??row?.races,0)),
    wins:acc.wins+Math.max(0,num(row?.wins,0)),
    podiums:acc.podiums+Math.max(0,num(row?.podiums,0)),
    poles:acc.poles+Math.max(0,num(row?.poles,0)),
    bestFinish:Math.min(acc.bestFinish,num(row?.best_finish,999)),
  }),{starts:0,wins:0,podiums:0,poles:0,bestFinish:999});

  // Full-career evidence is allowed only to repair the permanent latent talent
  // ceiling. It never selects a January race seat or copies a future season's
  // current performance into the opening state.
  let floor=totals.starts>0?58:null;
  if(totals.starts>=20)floor=Math.max(floor,62);
  if(totals.starts>=50)floor=Math.max(floor,64);
  if(totals.starts>=100)floor=Math.max(floor,66);
  if(totals.bestFinish<=10)floor=Math.max(floor,64);
  if(totals.bestFinish<=5)floor=Math.max(floor,68);
  if(totals.podiums>=1)floor=Math.max(floor,74);
  if(totals.wins>=1)floor=Math.max(floor,80);
  if(totals.wins>=5||totals.podiums>=20)floor=Math.max(floor,85);
  if(totals.wins>=10||totals.podiums>=40||totals.poles>=15)floor=Math.max(floor,90);
  if(totals.wins>=20||totals.podiums>=70||totals.poles>=30)floor=Math.max(floor,94);
  if(totals.wins>=35||totals.podiums>=90||totals.poles>=50)floor=Math.max(floor,97);
  return Number.isFinite(floor)?floor:null;
}

export function repairTalentProfileFromF1Career(profile,historyRows=[]){
  if(!profile)return profile;
  const floor=f1CareerTalentFloor(historyRows);
  const original=num(profile?.peak_ability,null);
  if(!Number.isFinite(floor)||!Number.isFinite(original)||original>=floor)return profile;

  const patched={...profile,peak_ability:round1(floor)};
  for(const [peakKey,offset] of Object.entries(CAREER_FLOOR_ATTRIBUTE_OFFSETS)){
    const raw=num(profile?.[peakKey],null);
    if(!Number.isFinite(raw))continue;
    patched[peakKey]=round1(Math.max(raw,clamp(floor-offset,35,99)));
  }
  patched._talent_profile_peak_original=round1(original);
  patched._talent_profile_peak_effective=round1(floor);
  patched._talent_profile_repair_source="full_f1_career_achievement_floor";
  return patched;
}


export function priorCareerStrengthSummary(historyRows=[],championshipRows=[],year){
  const target=Number(year);
  const priorHistory=(Array.isArray(historyRows)?historyRows:[])
    .filter((row)=>num(row?.year??row?.season_year,Infinity)<target);
  const priorChampionships=(Array.isArray(championshipRows)?championshipRows:[])
    .filter((row)=>num(row?.year??row?.season_year,Infinity)<target);

  const starts=priorHistory.reduce((sum,row)=>sum+Math.max(0,num(row?.starts??row?.races,0)),0);
  const wins=priorHistory.reduce((sum,row)=>sum+Math.max(0,num(row?.wins,0)),0);
  const podiums=priorHistory.reduce((sum,row)=>sum+Math.max(0,num(row?.podiums,0)),0);
  const poles=priorHistory.reduce((sum,row)=>sum+Math.max(0,num(row?.poles,0)),0);
  const positions=priorChampionships
    .map((row)=>num(row?.position??row?.champ_pos,null))
    .filter(Number.isFinite);
  const titleRows=priorChampionships.filter((row)=>num(row?.position??row?.champ_pos,999)===1);
  const previousSeason=priorChampionships.find((row)=>
    num(row?.year??row?.season_year,NaN)===target-1
  )||null;
  const recent=priorChampionships.filter((row)=>{
    const y=num(row?.year??row?.season_year,NaN);
    return Number.isFinite(y)&&y>=target-3;
  });
  const recentPositions=recent
    .map((row)=>num(row?.position??row?.champ_pos,null))
    .filter(Number.isFinite);

  return {
    starts,
    wins,
    podiums,
    poles,
    titles:titleRows.length,
    best_championship_position:positions.length?Math.min(...positions):null,
    previous_championship_position:previousSeason
      ?num(previousSeason?.position??previousSeason?.champ_pos,null)
      :null,
    recent_best_championship_position:recentPositions.length?Math.min(...recentPositions):null,
    last_title_year:titleRows.length
      ?Math.max(...titleRows.map((row)=>num(row?.year??row?.season_year,-Infinity)))
      :null,
  };
}

export function priorCareerCurrentAbilityFloor(historyRows=[],championshipRows=[],year){
  const target=Number(year);
  if(!Number.isInteger(target))return null;
  const summary=priorCareerStrengthSummary(historyRows,championshipRows,target);
  if(
    summary.starts<=0 &&
    !Number.isFinite(summary.best_championship_position)
  )return null;

  let floor=55;
  if(summary.starts>=10)floor=Math.max(floor,58);
  if(summary.starts>=25)floor=Math.max(floor,60);
  if(summary.starts>=50)floor=Math.max(floor,62);
  if(summary.starts>=100)floor=Math.max(floor,65);
  if(summary.starts>=150)floor=Math.max(floor,67);

  if(summary.podiums>=1)floor=Math.max(floor,70);
  if(summary.podiums>=10)floor=Math.max(floor,74);
  if(summary.podiums>=25)floor=Math.max(floor,78);
  if(summary.podiums>=50)floor=Math.max(floor,82);
  if(summary.podiums>=80)floor=Math.max(floor,85);

  if(summary.wins>=1)floor=Math.max(floor,73);
  if(summary.wins>=3)floor=Math.max(floor,77);
  if(summary.wins>=5)floor=Math.max(floor,80);
  if(summary.wins>=10)floor=Math.max(floor,84);
  if(summary.wins>=20)floor=Math.max(floor,88);
  if(summary.wins>=35)floor=Math.max(floor,91);

  const previous=summary.previous_championship_position;
  if(Number.isFinite(previous)){
    if(previous===1)floor=Math.max(floor,90);
    else if(previous<=3)floor=Math.max(floor,86);
    else if(previous<=5)floor=Math.max(floor,82);
    else if(previous<=10)floor=Math.max(floor,77);
  }

  const recentBest=summary.recent_best_championship_position;
  if(Number.isFinite(recentBest)){
    if(recentBest===1)floor=Math.max(floor,88);
    else if(recentBest<=3)floor=Math.max(floor,84);
    else if(recentBest<=5)floor=Math.max(floor,80);
    else if(recentBest<=10)floor=Math.max(floor,75);
  }

  if(summary.titles>0&&Number.isFinite(summary.last_title_year)){
    const yearsSinceTitle=Math.max(0,(target-1)-summary.last_title_year);
    const multipleTitleBonus=Math.min(3,Math.max(0,summary.titles-1)*1.5);
    const titleFloor=Math.max(76,90-yearsSinceTitle*1.1+multipleTitleBonus);
    floor=Math.max(floor,titleFloor);
  }

  return round1(clamp(floor,0,99));
}

function generatedPreviousYearRating({
  driver,
  profile,
  year,
  calibration,
  historicalSnapshots=[],
  historyRows=[],
  championshipRows=[],
}={}){
  const previousYear=Number(year)-1;
  if(!driver||!profile||!Number.isInteger(previousYear)||previousYear<1950)return null;
  const id=driverId(driver)||driverId(profile);
  const snapshot=(Array.isArray(historicalSnapshots)?historicalSnapshots:[]).find((row)=>
    driverId(row)===id&&num(row?.year??row?.season_year,NaN)===previousYear
  );
  if(snapshot){
    const current=num(snapshot?.current_ability,null);
    if(Number.isFinite(current))return {
      year:previousYear,
      current_ability:current,
      source:"historical_rating_snapshot_r2b",
    };
  }

  const generated=materializeDriverStartingRating({
    driver,
    profile,
    year:previousYear,
    placement:null,
    calibration,
  });
  return applyPriorCareerCurrentAbilityFloor(generated,{
    historyRows,
    championshipRows,
    year:previousYear,
  });
}

function applyGeneratedYearToYearContinuity(rating,{
  driver,
  profile,
  year,
  calibration,
  historicalSnapshots=[],
  historyRows=[],
  championshipRows=[],
  maxIncrease=15,
}={}){
  if(!rating||String(rating?.source||"")!=="talent_profile_starting_materializer")return rating;
  if(String(rating?.career_stage||"")==="Rookie")return rating;
  const current=num(rating?.current_ability,null);
  if(!Number.isFinite(current))return rating;

  const previous=generatedPreviousYearRating({
    driver,
    profile,
    year,
    calibration,
    historicalSnapshots,
    historyRows,
    championshipRows,
  });
  const prior=num(previous?.current_ability,null);
  if(!Number.isFinite(prior)||current-prior<=maxIncrease)return rating;

  const target=round1(prior+maxIncrease);
  const patched={...rating};
  const reduction=current-target;
  for(const [currentKey] of ATTRIBUTE_BLUEPRINT){
    const raw=num(patched?.[currentKey],null);
    if(Number.isFinite(raw))patched[currentKey]=round1(clamp(raw-reduction,0,99));
  }
  const score=abilityAttributeScore(patched);
  patched.current_ability=round1(clamp(
    Number.isFinite(score)?Math.min(score,target):target
  ));
  patched.potential_ability=round1(clamp(Math.max(
    num(patched?.potential_ability,patched.current_ability),
    patched.current_ability
  )));
  patched.development_headroom=round1(Math.max(
    0,
    patched.potential_ability-patched.current_ability
  ));
  patched.historical_continuity_cap_applied=true;
  patched.historical_continuity_previous_ovr=round1(prior);
  patched.historical_continuity_max_increase=maxIncrease;
  patched.calibration_model="D7.R4";
  return patched;
}

function applyPriorCareerCurrentAbilityFloor(rating,{
  historyRows=[],
  championshipRows=[],
  year,
}={}){
  if(!rating)return rating;
  const floor=priorCareerCurrentAbilityFloor(historyRows,championshipRows,year);
  const current=num(rating?.current_ability,null);
  if(!Number.isFinite(floor)||!Number.isFinite(current))return rating;

  const summary=priorCareerStrengthSummary(historyRows,championshipRows,year);
  const metadata={
    historical_current_floor:floor,
    historical_prior_starts:summary.starts,
    historical_prior_wins:summary.wins,
    historical_prior_podiums:summary.podiums,
    historical_prior_titles:summary.titles,
    historical_previous_championship_position:summary.previous_championship_position,
    historical_recent_best_championship_position:summary.recent_best_championship_position,
  };
  if(current>=floor)return {
    ...rating,
    ...metadata,
    historical_current_floor_applied:false,
    historical_current_floor_source:"preseason_f1_record",
    calibration_model:"D7.R4",
  };

  const patched={...rating,...metadata};
  const raiseAttributes=(amount)=>{
    for(const [currentKey] of ATTRIBUTE_BLUEPRINT){
      const raw=num(patched?.[currentKey],null);
      if(Number.isFinite(raw))patched[currentKey]=round1(clamp(raw+amount,0,99));
    }
  };

  raiseAttributes(floor-current);
  let score=abilityAttributeScore(patched);
  if(Number.isFinite(score)&&score<floor)raiseAttributes(floor-score);
  score=abilityAttributeScore(patched);
  patched.current_ability=round1(clamp(
    Number.isFinite(score)?Math.max(score,floor):floor
  ));
  patched.potential_ability=round1(clamp(Math.max(
    num(patched?.potential_ability,patched.current_ability),
    patched.current_ability
  )));
  patched.development_headroom=round1(Math.max(
    0,
    patched.potential_ability-patched.current_ability
  ));
  patched.historical_current_floor_applied=true;
  patched.historical_current_floor_source="preseason_f1_record";
  patched.calibration_model="D7.R4";
  return patched;
}

function ageAdjustedFactors(factors,stage,age,declineStartAge){
  const base={...factors};
  if(stage!=="Decline"||!Number.isFinite(Number(age)))return base;
  const declineStart=Number.isFinite(Number(declineStartAge))?Number(declineStartAge):35;
  const years=Math.max(0,Number(age)-declineStart);
  if(years<=0)return base;

  return {
    ...base,
    factor_speed:clamp(num(base.factor_speed,0.96)-years*0.045,0.58,1),
    factor_experience:clamp(num(base.factor_experience,0.997)-years*0.018,0.84,1),
    factor_mental:clamp(num(base.factor_mental,0.995)-years*0.020,0.78,1),
    factor_team:clamp(num(base.factor_team,0.988)-years*0.015,0.80,1),
  };
}

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
  const baseFactors=startingRatingFactors(model,stage,age);
  const factors=ageAdjustedFactors(
    baseFactors,
    stage,
    age,
    num(profile?.decline_start_age,35)
  );

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
    rating_model:"D7.R4",
    calibration_version:model?.version||"D7.R1D_CALIBRATION_V1",
    calibration_source_rows:num(model?.source_rows,0),
    talent_profile_peak_original:num(profile?._talent_profile_peak_original, null),
    talent_profile_peak_effective:num(profile?._talent_profile_peak_effective, num(profile?.peak_ability,null)),
    talent_profile_repair_source:text(profile?._talent_profile_repair_source||""),
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
  careerHistory=[],
  championshipHistory=[],
}={}){
  const rows=Array.isArray(existingRatings)?existingRatings:[];
  const byId=new Map(rows.map((row)=>[driverId(row),row]).filter(([id])=>id));
  const profileById=new Map((profiles||[]).map((row)=>[driverId(row),row]).filter(([id])=>id));
  const placementById=new Map((placements||[]).map((row)=>[driverId(row),row]).filter(([id])=>id));
  const calibration=buildStartingRatingCalibration(historicalSnapshots);
  const historyById=new Map();
  for(const row of Array.isArray(careerHistory)?careerHistory:[]){
    const id=driverId(row);
    if(!id)continue;
    if(!historyById.has(id))historyById.set(id,[]);
    historyById.get(id).push(row);
  }
  const championshipsById=new Map();
  for(const row of Array.isArray(championshipHistory)?championshipHistory:[]){
    const id=driverId(row);
    if(!id)continue;
    if(!championshipsById.has(id))championshipsById.set(id,[]);
    championshipsById.get(id).push(row);
  }

  for(const driver of Array.isArray(drivers)?drivers:[]){
    const id=driverId(driver);
    if(!id||byId.has(id))continue;
    const profile=profileById.get(id);
    if(!profile)continue;
    const effectiveProfile=repairTalentProfileFromF1Career(
      profile,
      historyById.get(id)||[]
    );
    const rating=materializeDriverStartingRating({
      driver,
      profile:effectiveProfile,
      year,
      placement:placementById.get(id)||null,
      calibration,
    });
    if(rating)byId.set(id,rating);
  }

  const driverById=new Map(
    (Array.isArray(drivers)?drivers:[]).map((driver)=>[driverId(driver),driver]).filter(([id])=>id)
  );
  return [...byId.values()].map((rating)=>{
    const id=driverId(rating);
    const historyRows=historyById.get(id)||[];
    const championshipRows=championshipsById.get(id)||[];
    const calibrated=applyPriorCareerCurrentAbilityFloor(rating,{
      historyRows,
      championshipRows,
      year,
    });
    if(String(rating?.source||"")!=="talent_profile_starting_materializer")return calibrated;
    const profile=profileById.get(id);
    const driver=driverById.get(id);
    if(!profile||!driver)return calibrated;
    const effectiveProfile=repairTalentProfileFromF1Career(profile,historyRows);
    return applyGeneratedYearToYearContinuity(calibrated,{
      driver,
      profile:effectiveProfile,
      year,
      calibration,
      historicalSnapshots,
      historyRows,
      championshipRows,
    });
  });
}
