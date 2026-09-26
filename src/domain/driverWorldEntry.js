// src/domain/driverWorldEntry.js
// D7.W1 — Historical Driver World Entry.
//
// Analysis-only model that answers:
//   "When does this driver first exist in the active motorsport world?"
//
// It does NOT place the driver into a specific feeder championship, does NOT
// force the historical F1 debut after New Game, and does NOT alter runtime
// Season Packs yet.
//
// Historical Starting Conditions -> Dynamic Alternative Future:
// - historical data may seed that a person already exists in motorsport;
// - the Save World decides what happens after the selected New Game date.

const DEFAULT_MIN_WORLD_AGE=16;
const DEFAULT_MAX_INFERRED_LEAD_YEARS=6;

const text=(value)=>String(value??"").trim();
const upper=(value)=>text(value).toUpperCase();
const num=(value,fallback=null)=>{
  if(value===undefined||value===null||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const yearOf=(value)=>{
  const n=num(value,null);
  if(Number.isInteger(n))return n;
  const match=text(value).match(/^(\d{4})/);
  return match?Number(match[1]):null;
};
const driverId=(row)=>text(row?.driver_id??row?.person_id??row?.id);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

function birthYear(driver){
  return yearOf(driver?.dob??driver?.birthdate_iso??driver?.birthdate??driver?.date_of_birth);
}

function ageAtOpening(driver,year){
  const raw=text(driver?.dob??driver?.birthdate_iso??driver?.birthdate??driver?.date_of_birth);
  const match=raw.match(/^(\d{4})(?:-(\d{2})-(\d{2}))?/);
  if(!match)return null;
  let age=Number(year)-Number(match[1]);
  if(match[2]&&match[3]){
    const month=Number(match[2]);
    const day=Number(match[3]);
    if(month>1||(month===1&&day>1))age-=1;
  }
  return age;
}

function minimumOpeningYearForAge(driver,minAge){
  const born=birthYear(driver);
  if(!Number.isInteger(born))return null;
  const raw=text(driver?.dob??driver?.birthdate_iso??driver?.birthdate??driver?.date_of_birth);
  const match=raw.match(/^(\d{4})(?:-(\d{2})-(\d{2}))?/);
  const birthdayAfterJan1=Boolean(match?.[2]&&match?.[3])&&
    (Number(match[2])>1||(Number(match[2])===1&&Number(match[3])>1));
  return born+Number(minAge)+(birthdayAfterJan1?1:0);
}

function rowsForDriver(rows,did){
  return (Array.isArray(rows)?rows:[]).filter(row=>driverId(row)===did);
}

function earliestYear(rows,selector=(row)=>row?.year){
  const years=(rows||[])
    .map(row=>yearOf(selector(row)))
    .filter(Number.isInteger);
  return years.length?Math.min(...years):null;
}

function f1DebutFromEvidence(driver,{driverYearStatus=[],driverCareer=[],driverDevelopmentHistory=[],driverHistory=[]}={}){
  const direct=yearOf(driver?.f1_rookie_season??driver?.f1_debut_year);
  const did=driverId(driver);
  const statusRows=rowsForDriver(driverYearStatus,did);
  const careerRows=rowsForDriver(driverCareer,did);
  const developmentRows=rowsForDriver(driverDevelopmentHistory,did);
  const historyRows=rowsForDriver(driverHistory,did);

  const statusDebut=earliestYear(
    statusRows.filter(row=>Boolean(row?.f1_entry_list)||upper(row?.world_status).startsWith("F1_"))
  );
  const careerDebut=earliestYear(
    careerRows.filter(row=>upper(row?.series_division??row?.division??row?.series)==="F1")
  );
  const developmentDebut=earliestYear(
    developmentRows.filter(row=>
      upper(row?.series_or_level)==="FORMULA_1"||
      upper(row?.event_type).startsWith("F1_")
    ),
    row=>row?.event_year??row?.year
  );
  const historyDebut=earliestYear(historyRows,row=>row?.year??row?.season_year);

  const candidates=[direct,statusDebut,careerDebut,developmentDebut,historyDebut].filter(Number.isInteger);
  return candidates.length?Math.min(...candidates):null;
}

function f1LastYearFromEvidence(driver,{driverYearStatus=[],driverCareer=[],driverDevelopmentHistory=[],driverHistory=[]}={}){
  const direct=yearOf(driver?.career_end_year??driver?.last_f1_season);
  const did=driverId(driver);
  const years=[];

  if(Number.isInteger(direct))years.push(direct);
  for(const row of rowsForDriver(driverYearStatus,did)){
    if(Boolean(row?.f1_entry_list)||upper(row?.world_status).startsWith("F1_")){
      const year=yearOf(row?.year);
      if(Number.isInteger(year))years.push(year);
    }
  }
  for(const row of rowsForDriver(driverCareer,did)){
    if(upper(row?.series_division??row?.division??row?.series)==="F1"){
      const year=yearOf(row?.year);
      if(Number.isInteger(year))years.push(year);
    }
  }
  for(const row of rowsForDriver(driverDevelopmentHistory,did)){
    if(upper(row?.series_or_level)==="FORMULA_1"||upper(row?.event_type).startsWith("F1_")){
      const year=yearOf(row?.event_year??row?.year);
      if(Number.isInteger(year))years.push(year);
    }
  }
  for(const row of rowsForDriver(driverHistory,did)){
    const year=yearOf(row?.year??row?.season_year);
    if(Number.isInteger(year))years.push(year);
  }
  return years.length?Math.max(...years):null;
}

function deathBeforeOpening(driver,year){
  const raw=text(driver?.death_date);
  if(!raw)return false;
  const exact=raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(exact){
    const opening=`${Number(year)}-01-01`;
    return `${exact[1]}-${exact[2]}-${exact[3]}`<=opening;
  }
  const dy=yearOf(raw);
  return Number.isInteger(dy)&&dy<Number(year);
}

function specificPreF1EvidenceYear(driver,{driverDevelopmentHistory=[],driverCareer=[]}={}){
  const did=driverId(driver);
  const developmentRows=rowsForDriver(driverDevelopmentHistory,did).filter(row=>{
    const level=upper(row?.series_or_level);
    const event=upper(row?.event_type);
    if(!level||level==="UNSPECIFIED"||level==="FORMULA_1")return false;
    if(event.startsWith("F1_"))return false;
    return true;
  });
  const developmentYear=earliestYear(developmentRows,row=>row?.event_year??row?.year);

  const careerRows=rowsForDriver(driverCareer,did).filter(row=>{
    const level=upper(row?.series_division??row?.division??row?.series);
    return Boolean(level)&&level!=="F1";
  });
  const careerYear=earliestYear(careerRows);

  const candidates=[developmentYear,careerYear].filter(Number.isInteger);
  return candidates.length?Math.min(...candidates):null;
}

function prospectEvidence(driver,{driverYearStatus=[]}={}){
  const did=driverId(driver);
  const rows=rowsForDriver(driverYearStatus,did)
    .filter(row=>upper(row?.world_status).startsWith("PROSPECT"))
    .sort((a,b)=>num(a?.year,9999)-num(b?.year,9999));
  const first=rows[0]||null;
  return first?{
    year:yearOf(first?.year),
    source:text(first?.source),
    derived_from_future_f1:/derived from first future f1 record/i.test(text(first?.source)),
  }:null;
}

function validLegacyCareerStart(driver,debut,born,{minWorldAge=DEFAULT_MIN_WORLD_AGE}={}){
  const start=yearOf(driver?.career_start_year);
  if(!Number.isInteger(start))return null;
  if(Number.isInteger(debut)&&start>debut)return null;
  if(Number.isInteger(born)&&start<born+Math.max(12,minWorldAge-2))return null;
  return start;
}

function inferredWorldEntry(driver,debut,{
  minWorldAge=DEFAULT_MIN_WORLD_AGE,
  maxLeadYears=DEFAULT_MAX_INFERRED_LEAD_YEARS,
}={}){
  if(!Number.isInteger(debut))return null;
  const born=birthYear(driver);
  const leadCandidate=debut-Math.max(1,Number(maxLeadYears)||DEFAULT_MAX_INFERRED_LEAD_YEARS);
  if(!Number.isInteger(born))return leadCandidate;
  const minimumYear=minimumOpeningYearForAge(driver,minWorldAge);
  return Math.max(Number.isInteger(minimumYear)?minimumYear:born+Number(minWorldAge),leadCandidate);
}

function levelAtEntry(driver,entryYear,debut,{youthMaxAge=19}={}){
  if(!Number.isInteger(entryYear))return "UNRESOLVED";
  if(Number.isInteger(debut)&&entryYear>=debut)return "F1";
  const age=ageAtOpening(driver,entryYear);
  if(Number.isFinite(age)&&age<=Number(youthMaxAge))return "YOUTH";
  return "LOWER_SERIES";
}

function confidenceFor(source){
  if(source==="specific_pre_f1_evidence")return "HIGH";
  if(source==="legacy_career_start")return "MEDIUM-HIGH";
  if(source==="inferred_from_f1_debut")return "MEDIUM";
  if(source==="f1_debut_only")return "HIGH";
  return "INSUFFICIENT";
}

export function inferDriverWorldEntry(driver,context={},options={}){
  const did=driverId(driver);
  const born=birthYear(driver);
  const debut=f1DebutFromEvidence(driver,context);
  const lastF1Year=f1LastYearFromEvidence(driver,context);
  const specific=specificPreF1EvidenceYear(driver,context);
  const legacy=validLegacyCareerStart(driver,debut,born,options);
  const prospect=prospectEvidence(driver,context);
  const inferred=inferredWorldEntry(driver,debut,options);

  let firstWorldYear=null;
  let source="unresolved";

  if(Number.isInteger(specific)){
    firstWorldYear=specific;
    source="specific_pre_f1_evidence";
  }else if(Number.isInteger(legacy)){
    firstWorldYear=legacy;
    source="legacy_career_start";
  }else if(Number.isInteger(inferred)){
    firstWorldYear=inferred;
    source="inferred_from_f1_debut";
  }else if(Number.isInteger(debut)){
    firstWorldYear=debut;
    source="f1_debut_only";
  }

  // Never put someone into the active motorsport world before birth/minimum age
  // merely because a malformed historical row exists.
  if(Number.isInteger(firstWorldYear)&&Number.isInteger(born)){
    const minimumYear=minimumOpeningYearForAge(
      driver,
      Number(options.minWorldAge??DEFAULT_MIN_WORLD_AGE)
    );
    firstWorldYear=Math.max(
      firstWorldYear,
      Number.isInteger(minimumYear)?minimumYear:born+Number(options.minWorldAge??DEFAULT_MIN_WORLD_AGE)
    );
  }
  if(Number.isInteger(firstWorldYear)&&Number.isInteger(debut)){
    firstWorldYear=Math.min(firstWorldYear,debut);
  }

  const entryAge=Number.isInteger(firstWorldYear)?ageAtOpening(driver,firstWorldYear):null;
  const entryLevel=levelAtEntry(driver,firstWorldYear,debut,options);

  return {
    driver_id:did,
    display_name:text(driver?.display_name??driver?.driver_name??driver?.name??did),
    stage:"D7.W1",
    authority:"analysis_only",
    model:"historical_driver_world_entry_v1",
    birth_year:born,
    reference_f1_debut_year:debut,
    reference_f1_last_year:lastF1Year,
    first_world_year:firstWorldYear,
    entry_age:Number.isFinite(entryAge)?entryAge:null,
    entry_level:entryLevel,
    entry_source:source,
    entry_confidence:confidenceFor(source),
    evidence:{
      specific_pre_f1_year:specific,
      legacy_career_start_year:legacy,
      first_prospect_status_year:prospect?.year??null,
      prospect_status_is_future_f1_derived:prospect?.derived_from_future_f1??false,
    },
    reference_only:{
      historical_f1_debut:true,
      forced_future_f1_debut:false,
      forced_future_team:false,
      note:"World entry seeds existence only. After New Game, Save World progression is dynamic.",
    },
  };
}

export function inferDriverWorldEntries(drivers=[],context={},options={}){
  return (Array.isArray(drivers)?drivers:[])
    .map(driver=>inferDriverWorldEntry(driver,context,options))
    .sort((a,b)=>String(a.driver_id).localeCompare(String(b.driver_id)));
}

export function driverWorldStageAtYear(driver,entry,year,{youthMaxAge=19}={}){
  const target=Number(year);
  const first=num(entry?.first_world_year,null);
  const debut=num(entry?.reference_f1_debut_year,null);
  const lastF1=num(entry?.reference_f1_last_year,null);
  const born=birthYear(driver);

  if(!Number.isInteger(target)){
    return {year:target,active_world:false,stage:"NOT_IN_WORLD",age:null};
  }
  if(Number.isInteger(born)&&target<born){
    return {year:target,active_world:false,stage:"NOT_IN_WORLD",age:null};
  }

  const age=ageAtOpening(driver,target);
  if(deathBeforeOpening(driver,target)){
    return {year:target,active_world:false,stage:"DECEASED",age};
  }
  if(!Number.isInteger(first)||target<first){
    return {year:target,active_world:false,stage:"NOT_IN_WORLD",age};
  }
  if(Number.isInteger(lastF1)&&target>lastF1){
    return {year:target,active_world:false,stage:"RETIRED_REFERENCE",age};
  }

  if(Number.isInteger(debut)&&target>=debut){
    return {year:target,active_world:true,stage:"F1_REFERENCE_WINDOW",age};
  }

  const stage=Number.isFinite(age)&&age<=Number(youthMaxAge)?"YOUTH":"LOWER_SERIES";
  return {year:target,active_world:true,stage,age};
}

export function buildDriverWorldEntryAudit(entries=[],drivers=[],{
  auditYears=[1975,1980,1981,1982,1983,1984,1985],
}={}){
  const source=Array.isArray(entries)?entries:[];
  const driverMap=new Map((drivers||[]).map(row=>[driverId(row),row]));
  const sourceCounts={};
  const confidenceCounts={};
  const entryLevelCounts={};
  for(const row of source){
    sourceCounts[row.entry_source]=(sourceCounts[row.entry_source]||0)+1;
    confidenceCounts[row.entry_confidence]=(confidenceCounts[row.entry_confidence]||0)+1;
    entryLevelCounts[row.entry_level]=(entryLevelCounts[row.entry_level]||0)+1;
  }

  const yearSnapshots={};
  for(const year of auditYears){
    const counts={
      NOT_IN_WORLD:0,
      YOUTH:0,
      LOWER_SERIES:0,
      F1_REFERENCE_WINDOW:0,
      RETIRED_REFERENCE:0,
      DECEASED:0,
    };
    const active=[];
    for(const entry of source){
      const driver=driverMap.get(entry.driver_id)||entry;
      const stage=driverWorldStageAtYear(driver,entry,year);
      counts[stage.stage]=(counts[stage.stage]||0)+1;
      if(stage.active_world)active.push({
        driver_id:entry.driver_id,
        display_name:entry.display_name,
        stage:stage.stage,
        age:stage.age,
      });
    }
    yearSnapshots[String(year)]={
      counts,
      active_world:active.length,
    };
  }

  return {
    format:"f1ml-driver-world-entry-audit",
    schema_version:1,
    generated_at:null,
    stage:"D7.W1",
    authority:"analysis_only",
    total_drivers:source.length,
    resolved:source.filter(row=>Number.isInteger(row.first_world_year)).length,
    unresolved:source.filter(row=>!Number.isInteger(row.first_world_year)).length,
    entry_source_counts:sourceCounts,
    confidence_counts:confidenceCounts,
    entry_level_counts:entryLevelCounts,
    year_snapshots:yearSnapshots,
    notes:[
      "D7.W1 determines when a driver first exists in the motorsport world; it does not simulate feeder championships.",
      "Specific pre-F1 evidence wins over legacy career_start_year; legacy career_start wins over debut-based inference.",
      "When no pre-F1 evidence exists, world entry is inferred no more than six years before the historical F1 debut and never before age 16.",
      "Historical F1 debut/end are reference/calibration only and do not force promotion, team assignment or future results after New Game.",
      "The audit excludes drivers whose historical F1 career had already ended or who were deceased before the selected January 1 opening date from active-world counts.",
      "D7.W2 will map active pre-F1 drivers into generic Youth / Lower Series / F1-ready opening placement.",
    ],
  };
}

export const DRIVER_WORLD_ENTRY_DEFAULTS=Object.freeze({
  min_world_age:DEFAULT_MIN_WORLD_AGE,
  max_inferred_lead_years:DEFAULT_MAX_INFERRED_LEAD_YEARS,
});
