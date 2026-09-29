// src/domain/seriesCatalog.js
//
// Canonical read-only helpers for the historical single-seater series catalogue.
// The database describes real series and historical eligibility rules; Save World
// simulation remains responsible for future placements and results.

const rows=(value)=>Array.isArray(value)?value:[];

function text(value){
  return value==null?"":String(value).trim();
}

function numberOrNull(value){
  if(value===null||value===undefined||value==="")return null;
  const n=Number(value);
  return Number.isFinite(n)?n:null;
}

function yearRangeMatch(year,fromValue,toValue){
  const y=Number(year);
  if(!Number.isInteger(y))return false;
  const from=numberOrNull(fromValue);
  const to=numberOrNull(toValue);
  if(from!==null&&y<from)return false;
  if(to!==null&&y>to)return false;
  return true;
}

export function seriesIdOf(series){
  return text(series?.series_id??series?.id);
}

export function seriesNameOf(series){
  return text(series?.series_name??series?.name??series?.short_name??series?.series_short_name??seriesIdOf(series));
}

export const SERIES_COMPETITION_MODELS=Object.freeze({
  TEAM_BASED:"TEAM_BASED",
  CENTRAL_OPERATION:"CENTRAL_OPERATION",
});

export function seriesCompetitionModel(series){
  const raw=text(
    series?.competition_model??
    series?.competitionModel??
    series?.team_model??
    series?.entry_model
  ).toUpperCase().replace(/[^A-Z0-9]+/g,"_");
  if(["CENTRAL_OPERATION","CENTRAL","SPEC_CENTRAL","DRIVER_ONLY","INDIVIDUAL"].includes(raw)){
    return SERIES_COMPETITION_MODELS.CENTRAL_OPERATION;
  }
  return SERIES_COMPETITION_MODELS.TEAM_BASED;
}

export function seriesHasTeamCompetition(series){
  return seriesCompetitionModel(series)===SERIES_COMPETITION_MODELS.TEAM_BASED;
}

function normalized(value){
  return text(value).toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]+/g,"");
}

function legacyIdentityLevel(series){
  const category=normalized(series?.category);
  const short=normalized(series?.short_name??series?.series_short_name);
  const name=normalized(series?.series_name??series?.name);

  // The pre-LS database used division 4 for its generic F4 row. The new
  // historical pyramid reserves level 4 for Formula Regional and level 5 for
  // entry-level F4/Formula Ford/Formula Junior categories.
  if(
    category.includes("formula4")||
    category.includes("formulaford")||
    category.includes("formulajunior")||
    category.includes("formulaabarth")||
    ["f4","bf4","if4"].includes(short)||
    name.includes("formula4")
  )return 5;
  if(category.includes("formularegional")||name.includes("formularegional"))return 4;
  return null;
}

export function seriesLevelOf(series){
  const explicit=numberOrNull(series?.series_level??series?.level);
  if(explicit!==null)return explicit;
  return legacyIdentityLevel(series)??numberOrNull(series?.series_division??series?.division);
}

export function isSeriesActiveInYear(series,year){
  return yearRangeMatch(year,series?.start_year??series?.year_from,series?.end_year??series?.year_to);
}

export function activeSeriesForYear(seriesRows,year,{levels=null}={}){
  const allowed=Array.isArray(levels)&&levels.length
    ? new Set(levels.map(Number).filter(Number.isFinite))
    : null;

  return rows(seriesRows)
    .filter((series)=>seriesIdOf(series)&&isSeriesActiveInYear(series,year))
    .filter((series)=>!allowed||allowed.has(seriesLevelOf(series)))
    .slice()
    .sort((a,b)=>{
      const levelA=seriesLevelOf(a)??999;
      const levelB=seriesLevelOf(b)??999;
      if(levelA!==levelB)return levelA-levelB;
      return text(a?.series_name??a?.name).localeCompare(text(b?.series_name??b?.name));
    });
}

export function seriesRulesForYear(ruleRows,seriesId,year){
  const id=text(seriesId);
  if(!id)return [];

  return rows(ruleRows)
    .filter((rule)=>text(rule?.series_id)===id)
    .filter((rule)=>yearRangeMatch(year,rule?.valid_from??rule?.year_from,rule?.valid_to??rule?.year_to))
    .slice()
    .sort((a,b)=>{
      const fromA=numberOrNull(a?.valid_from??a?.year_from)??-Infinity;
      const fromB=numberOrNull(b?.valid_from??b?.year_from)??-Infinity;
      if(fromA!==fromB)return fromB-fromA;
      return text(a?.series_rule_id??a?.rule_id).localeCompare(text(b?.series_rule_id??b?.rule_id));
    });
}

export function seriesRuleForYear(ruleRows,seriesId,year){
  return seriesRulesForYear(ruleRows,seriesId,year)[0]??null;
}

function birthYearOf(driver){
  const direct=numberOrNull(driver?.birth_year);
  if(direct!==null)return direct;

  const raw=text(driver?.birthdate_iso??driver?.birthdate??driver?.dob??driver?.date_of_birth);
  const match=raw.match(/^(\d{4})/);
  return match?Number(match[1]):null;
}

export function driverAgeInSeriesYear(driver,year){
  const y=Number(year);
  const born=birthYearOf(driver);
  if(!Number.isInteger(y)||born===null)return null;
  return Math.max(0,y-born);
}

export function seriesAgeEligibility(driver,rule,year){
  const age=driverAgeInSeriesYear(driver,year);
  const minAge=numberOrNull(rule?.min_age);
  const maxAge=numberOrNull(rule?.max_age);
  const reasons=[];

  if(age!==null&&minAge!==null&&age<minAge)reasons.push("below_min_age");
  if(age!==null&&maxAge!==null&&age>maxAge)reasons.push("above_max_age");

  return {
    eligible:reasons.length===0,
    age,
    min_age:minAge,
    max_age:maxAge,
    reasons,
  };
}


export function eligibleSeriesForDriver(seriesRows,ruleRows,driver,year,{levels=null}={}){
  return activeSeriesForYear(seriesRows,year,{levels})
    .map((series)=>{
      const series_id=seriesIdOf(series);
      const rule=seriesRuleForYear(ruleRows,series_id,year);
      const ageEligibility=seriesAgeEligibility(driver,rule,year);
      return {series,rule,ageEligibility};
    })
    .filter((row)=>row.ageEligibility.eligible);
}
