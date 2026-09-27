import fs from "node:fs/promises";
import path from "node:path";
import {
  discoverSupportedYears,
  materializeSeasonPack,
} from "../src/data/seasonPackMaterializer.js";

const root=process.cwd();
const dataDir=path.join(root,"public","data");

const REQUIRED_FIELDS=[
  "current_ability",
  "potential_ability",
  "pace",
  "qualifying",
  "start_launch",
  "racecraft",
  "wet_skill",
  "consistency",
  "tire_management",
  "race_intelligence",
  "technical_feedback",
  "adaptability",
  "ers_fuel_management",
  "mentality",
  "pressure_handling",
];

const PERMANENT_FIELDS=[
  "leadership",
  "team_player",
  "car_development_impact",
  "aggression",
  "crash_likelihood",
];

const EXPECTED_YEARS=Array.from({length:75},(_,index)=>1950+index);

function unbox(value){
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    if(
      Object.prototype.hasOwnProperty.call(value,"formula") &&
      Object.prototype.hasOwnProperty.call(value,"result")
    ){
      return value.result===undefined||value.result===null||value.result===""?null:unbox(value.result);
    }
    if(value.result!==undefined&&value.result!==null&&value.result!=="")return unbox(value.result);
    if(value.value!==undefined&&value.value!==null&&value.value!=="")return unbox(value.value);
    if(value.text!==undefined&&value.text!==null&&value.text!=="")return unbox(value.text);
  }
  return value;
}

function pick(row,keys,fallback=undefined){
  for(const key of keys){
    const value=unbox(row?.[key]);
    if(value!==undefined&&value!==null&&value!=="")return value;
  }
  return fallback;
}

function driverId(row){
  return String(pick(row,["driver_id","person_id","id"],"")).trim();
}

function rowYear(row){
  const value=Number(pick(row,["year","season_year","season"],NaN));
  return Number.isInteger(value)?value:null;
}

function isFiniteRatingValue(value){
  if(value===null||value===undefined||value==="")return false;
  return Number.isFinite(Number(value));
}

function missingRatingFields(row){
  return [...REQUIRED_FIELDS,...PERMANENT_FIELDS].filter((key)=>!isFiniteRatingValue(row?.[key]));
}

function sourceKind(row){
  const source=String(row?.source||"");
  if(source==="historical_rating_snapshot_r2b")return "historical";
  if(source==="talent_profile_starting_materializer")return "generated";
  return "legacy";
}

async function readJson(name,fallback=[]){
  try{
    return JSON.parse(await fs.readFile(path.join(dataDir,name),"utf8"));
  }catch{
    return fallback;
  }
}

const [
  drivers,calendar,teams,driverRatings,historicalRatingSnapshots,driverRatingProfiles,
  driverYearStatus,driverOpeningState,driverDevelopmentHistory,driverAvailabilityHistory,driverTeamHistory,
  teamEngineHistory,carCompetitiveness,driverCareer,driverHistory,staffRatings,staffCore,
  teamBrands,teamEngines,contracts,sponsorsContracts,rules,qualifyingRules,qualifyingRuleOverrides,eraSafety,
  accidentModel,facilities,carStats,staffContracts,tyres,pointsSystems,penaltiesRules,
  financialRules,agendaBlocks,contractRules,youthIntakeRules,scoutingZones,
  trackLayoutByYear,teamSeasons,coreTracks,
]=await Promise.all([
  readJson("drivers.json"),
  readJson("calendar.json"),
  readJson("teams.json"),
  readJson("driver_ratings.json"),
  readJson("historical_rating_snapshots.json"),
  readJson("driver_rating_profiles.json"),
  readJson("driver_year_status.json"),
  readJson("driver_opening_state.json"),
  readJson("driver_development_history.json"),
  readJson("driver_availability_history.json"),
  readJson("driver_team_history.json"),
  readJson("team_engine_history.json"),
  readJson("car_competitiveness_by_year.json"),
  readJson("driver_career.json"),
  readJson("driver_f1_history.json"),
  readJson("staff_ratings.json"),
  readJson("staff_core.json"),
  readJson("team_brands.json"),
  readJson("team_engines.json"),
  readJson("contracts.json"),
  readJson("sponsors_contracts.json"),
  readJson("rules.json"),
  readJson("qualifying_rules.json"),
  readJson("qualifying_rule_overrides.json",[]),
  readJson("era_safety.json"),
  readJson("accident_model.json",[]),
  readJson("facilities.json"),
  readJson("car_stats_by_year.json"),
  readJson("staff_contracts.json"),
  readJson("tyres_catalog.json"),
  readJson("points_systems.json"),
  readJson("penalties_rules.json"),
  readJson("financial_rules.json"),
  readJson("agenda_blocks.json"),
  readJson("contract_rules.json"),
  readJson("youth_intake_rules.json"),
  readJson("scouting_zones.json"),
  readJson("track_layout_by_year.json"),
  readJson("team_seasons.json"),
  readJson("core_tracks.json"),
]);

const globalData={
  drivers,calendar,teams,driverRatings,historicalRatingSnapshots,driverRatingProfiles,
  driverYearStatus,driverOpeningState,driverDevelopmentHistory,driverAvailabilityHistory,driverTeamHistory,
  teamEngineHistory,carCompetitiveness,driverCareer,driverHistory,staffRatings,staffCore,
  teamBrands,teamEngines,contracts,sponsorsContracts,rules,qualifyingRules,qualifyingRuleOverrides,eraSafety,
  accidentModel:Array.isArray(accidentModel)?accidentModel:Object.values(accidentModel||{}),
  facilities,carStats,staffContracts,tyres,pointsSystems,penaltiesRules,financialRules,
  agendaBlocks,contractRules,youthIntakeRules,scoutingZones,trackLayoutByYear,teamSeasons,coreTracks,
};

const canonicalDriverIds=new Set((drivers||[]).map(driverId).filter(Boolean));
const profileById=new Map((driverRatingProfiles||[]).map((row)=>[driverId(row),row]).filter(([id])=>id));

const snapshotYearsById=new Map();
for(const row of historicalRatingSnapshots||[]){
  const id=driverId(row);
  const year=rowYear(row);
  if(!id||year===null)continue;
  if(!snapshotYearsById.has(id))snapshotYearsById.set(id,new Set());
  snapshotYearsById.get(id).add(year);
}

const legacyYearsById=new Map();
for(const row of driverRatings||[]){
  const id=driverId(row);
  const year=rowYear(row);
  if(!id||year===null)continue;
  if(!legacyYearsById.has(id))legacyYearsById.set(id,[]);
  legacyYearsById.get(id).push(year);
}
for(const years of legacyYearsById.values())years.sort((a,b)=>a-b);

const supportedYears=discoverSupportedYears(globalData);
const failures=[];

if(
  supportedYears.length!==EXPECTED_YEARS.length ||
  supportedYears.some((year,index)=>year!==EXPECTED_YEARS[index])
){
  failures.push(
    "Supported historical New Game years must be exactly 1950-2024 with no gaps; got "+
    JSON.stringify(supportedYears)
  );
}

const canonicalDuplicates=(drivers||[])
  .map(driverId)
  .filter(Boolean)
  .filter((id,index,all)=>all.indexOf(id)!==index);
if(canonicalDuplicates.length){
  failures.push("Canonical driver database contains duplicate IDs: "+[...new Set(canonicalDuplicates)].join(", "));
}

const summaries=[];

for(const year of supportedYears){
  const pack=materializeSeasonPack(globalData,year);
  const visibleDrivers=Array.isArray(pack?.state?.drivers)?pack.state.drivers:[];
  const ratings=Array.isArray(pack?.state?.driverRatings)?pack.state.driverRatings:[];

  const visibleIds=visibleDrivers.map(driverId).filter(Boolean);
  const visibleSet=new Set(visibleIds);
  const ratingRowsById=new Map();

  for(const rating of ratings){
    const id=driverId(rating);
    if(!ratingRowsById.has(id))ratingRowsById.set(id,[]);
    ratingRowsById.get(id).push(rating);
  }

  let missing=0;
  let duplicates=0;
  let incomplete=0;
  let unusable=0;
  let generated=0;
  let historical=0;
  let legacy=0;
  let provenanceErrors=0;
  let nonCanonicalRatings=0;
  let extraRatings=0;

  for(const rating of ratings){
    const id=driverId(rating);
    if(!id||!canonicalDriverIds.has(id)){
      nonCanonicalRatings++;
      continue;
    }
    if(!visibleSet.has(id))extraRatings++;

    const kind=sourceKind(rating);
    if(kind==="historical")historical++;
    else if(kind==="generated")generated++;
    else legacy++;

    const exactSnapshot=Boolean(snapshotYearsById.get(id)?.has(year));
    const eligibleLegacyYears=(legacyYearsById.get(id)||[]).filter((sourceYear)=>sourceYear<=year);
    const hasEligibleLegacy=eligibleLegacyYears.length>0;

    let expectedKind;
    if(exactSnapshot)expectedKind="historical";
    else if(hasEligibleLegacy)expectedKind="legacy";
    else expectedKind="generated";

    if(kind!==expectedKind){
      provenanceErrors++;
      failures.push(
        `${year} ${id}: rating provenance mismatch; expected ${expectedKind}, got ${kind} (${String(rating?.source||"no source")})`
      );
    }

    if(kind==="generated"&&!profileById.has(id)){
      provenanceErrors++;
      failures.push(`${year} ${id}: generated fallback has no Talent Profile`);
    }

    if(kind==="generated"&&profileById.has(id)){
      const expectedPeak=Number(profileById.get(id)?.peak_ability);
      const actualPotential=Number(rating?.potential_ability);
      if(Number.isFinite(expectedPeak)&&Math.abs(actualPotential-expectedPeak)>0.11){
        provenanceErrors++;
        failures.push(
          `${year} ${id}: generated potential ${actualPotential} does not match Talent Profile peak ${expectedPeak}`
        );
      }
    }

    if(kind==="historical"&&!exactSnapshot){
      provenanceErrors++;
      failures.push(`${year} ${id}: historical snapshot source used without an exact-year snapshot`);
    }

    if(kind==="legacy"&&!hasEligibleLegacy){
      provenanceErrors++;
      const future=(legacyYearsById.get(id)||[]).filter((sourceYear)=>sourceYear>year);
      failures.push(
        `${year} ${id}: legacy rating has no source row at or before the New Game year`+
        (future.length?`; future-only rows: ${future.join(",")}`:"")
      );
    }
  }

  for(const id of visibleIds){
    const rows=ratingRowsById.get(id)||[];
    if(rows.length===0){
      missing++;
      unusable++;
      const visibleDriver=visibleDrivers.find((row)=>driverId(row)===id)||null;
      const rawDriverMatches=(drivers||[]).filter((row)=>driverId(row)===id).slice(0,3);
      const worldMatches=(pack?.state?.driverWorldEntry||[]).filter((row)=>driverId(row)===id).slice(0,3);
      const feederMatches=(pack?.state?.driverFeederPlacement||[]).filter((row)=>driverId(row)===id).slice(0,3);
      failures.push(
        `${year} ${id}: visible driver has no rating row; context=`+
        JSON.stringify({visibleDriver,rawDriverMatches,worldMatches,feederMatches})
      );
      continue;
    }
    if(rows.length!==1){
      duplicates+=Math.max(0,rows.length-1);
      unusable++;
      failures.push(`${year} ${id}: visible driver has ${rows.length} rating rows`);
      continue;
    }

    const missingFields=missingRatingFields(rows[0]);
    if(missingFields.length){
      incomplete++;
      unusable++;
      failures.push(`${year} ${id}: incomplete rating fields: ${missingFields.join(", ")}`);
    }
  }

  if(nonCanonicalRatings){
    failures.push(`${year}: ${nonCanonicalRatings} rating rows reference non-canonical driver IDs`);
  }
  if(extraRatings){
    failures.push(`${year}: ${extraRatings} rating rows do not belong to visible pack.state.drivers`);
  }

  summaries.push({
    year,
    drivers:visibleIds.length,
    ratings:ratings.length,
    historical,
    generated,
    legacy,
    missing,
    duplicates,
    incomplete,
    nonCanonicalRatings,
    extraRatings,
    provenanceErrors,
    visibleDriversWithoutUsableRating:unusable,
  });
}

const sourceFiles=[
  path.join(root,"src","domain","driverStartingRating.js"),
  path.join(root,"src","data","seasonPackMaterializer.js"),
];
const forbiddenSpecialCases=["Senna","Prost","Schumacher","Hamilton","Alonso"];
for(const file of sourceFiles){
  const content=await fs.readFile(file,"utf8");
  for(const term of forbiddenSpecialCases){
    if(new RegExp(`\\b${term}\\b`,"i").test(content)){
      failures.push(
        `Hardcoded named-driver exception detected in ${path.relative(root,file)}: ${term}`
      );
    }
  }
}

console.log("All-years driver rating coverage audit");
console.log("Year  Drivers Ratings Historical Generated Legacy Missing Dup Incomplete Unusable");
for(const row of summaries){
  console.log(
    String(row.year).padEnd(6)+
    String(row.drivers).padStart(7)+
    String(row.ratings).padStart(8)+
    String(row.historical).padStart(11)+
    String(row.generated).padStart(10)+
    String(row.legacy).padStart(7)+
    String(row.missing).padStart(8)+
    String(row.duplicates).padStart(4)+
    String(row.incomplete).padStart(11)+
    String(row.visibleDriversWithoutUsableRating).padStart(9)
  );
}

const failedYears=summaries.filter((row)=>
  row.visibleDriversWithoutUsableRating>0 ||
  row.nonCanonicalRatings>0 ||
  row.extraRatings>0 ||
  row.provenanceErrors>0
);

console.log(
  `Audited ${summaries.length} seasons (${supportedYears[0]}-${supportedYears.at(-1)}), `+
  `${summaries.reduce((sum,row)=>sum+row.drivers,0)} visible driver-season rows.`
);
console.log(
  `visibleDriversWithoutUsableRating=${summaries.reduce((sum,row)=>sum+row.visibleDriversWithoutUsableRating,0)}; `+
  `failedYears=${failedYears.length}.`
);

if(failures.length){
  console.error("\nDriver rating coverage audit FAILED:");
  for(const failure of failures)console.error("- "+failure);
  process.exitCode=1;
}else{
  console.log("Driver rating coverage audit PASSED.");
}
