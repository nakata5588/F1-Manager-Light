import fs from "node:fs/promises";
import path from "node:path";
import { readJsonOptional, readJsonRequired } from "./lib/json-source.mjs";
import {
  discoverSupportedYears,
  materializeSeasonPack,
} from "../src/data/seasonPackMaterializer.js";

const root=process.cwd();
const dataDir=path.join(root,"public","data");
const outRoot=path.join(dataDir,"seasons");

const requiredJson=(name)=>readJsonRequired(path.join(dataDir,name),{label:name});
const optionalJson=(name,fallback=[])=>readJsonOptional(path.join(dataDir,name),fallback);

await fs.mkdir(outRoot,{recursive:true});

const [
  drivers,calendar,teams,driverRatings,historicalRatingSnapshots,driverRatingProfiles,
  driverYearStatus,driverOpeningState,driverDevelopmentHistory,driverAvailabilityHistory,driverTeamHistory,
  teamEngineHistory,carCompetitiveness,driverCareer,series,seriesRules,lowerSeriesTeams,driverHistory,historicalChampionships,teamLineageHistory,staffRatings,staffCore,
  teamBrands,teamEngines,contracts,sponsorsContracts,rules,qualifyingRules,qualifyingRuleOverrides,eraSafety,
  accidentModel,facilities,carStats,staffContracts,tyres,pointsSystems,penaltiesRules,
  financialRules,agendaBlocks,contractRules,youthIntakeRules,scoutingZones,
  trackLayoutByYear,teamSeasons,coreTracks,
]=await Promise.all([
  requiredJson("drivers.json"),
  requiredJson("calendar.json"),
  requiredJson("teams.json"),
  requiredJson("driver_ratings.json"),
  optionalJson("historical_rating_snapshots.json"),
  requiredJson("driver_rating_profiles.json"),
  optionalJson("driver_year_status.json"),
  optionalJson("driver_opening_state.json"),
  optionalJson("driver_development_history.json"),
  optionalJson("driver_availability_history.json"),
  optionalJson("driver_team_history.json"),
  optionalJson("team_engine_history.json"),
  optionalJson("car_competitiveness_by_year.json"),
  requiredJson("driver_career.json"),
  requiredJson("series.json"),
  requiredJson("series_rules.json"),
  requiredJson("lower_series_teams.json"),
  requiredJson("driver_f1_history.json"),
  requiredJson("historical_championships.json"),
  optionalJson("team_lineage_history.json",[]),
  requiredJson("staff_ratings.json"),
  requiredJson("staff_core.json"),
  requiredJson("team_brands.json"),
  requiredJson("team_engines.json"),
  requiredJson("contracts.json"),
  requiredJson("sponsors_contracts.json"),
  requiredJson("rules.json"),
  requiredJson("qualifying_rules.json"),
  optionalJson("qualifying_rule_overrides.json",[]),
  requiredJson("era_safety.json"),
  optionalJson("accident_model.json",[]),
  requiredJson("facilities.json"),
  optionalJson("car_stats_by_year.json"),
  requiredJson("staff_contracts.json"),
  requiredJson("tyres_catalog.json"),
  requiredJson("points_systems.json"),
  requiredJson("penalties_rules.json"),
  requiredJson("financial_rules.json"),
  requiredJson("agenda_blocks.json"),
  requiredJson("contract_rules.json"),
  requiredJson("youth_intake_rules.json"),
  requiredJson("scouting_zones.json"),
  requiredJson("track_layout_by_year.json"),
  requiredJson("team_seasons.json"),
  requiredJson("core_tracks.json"),
]);

const globalData={
  drivers,calendar,teams,driverRatings,historicalRatingSnapshots,driverRatingProfiles,
  driverYearStatus,driverOpeningState,driverDevelopmentHistory,driverAvailabilityHistory,driverTeamHistory,
  teamEngineHistory,carCompetitiveness,driverCareer,series,seriesRules,lowerSeriesTeams,driverHistory,historicalChampionships,teamLineageHistory,staffRatings,staffCore,
  teamBrands,teamEngines,contracts,sponsorsContracts,rules,qualifyingRules,qualifyingRuleOverrides,eraSafety,
  accidentModel:Array.isArray(accidentModel)?accidentModel:Object.values(accidentModel||{}),
  facilities,carStats,staffContracts,tyres,pointsSystems,penaltiesRules,financialRules,
  agendaBlocks,contractRules,youthIntakeRules,scoutingZones,trackLayoutByYear,teamSeasons,coreTracks,
};

const requestedArg=process.argv.find((arg)=>arg.startsWith("--years="));
const requested=requestedArg
  ? requestedArg.slice("--years=".length).split(",").map(Number).filter(Number.isInteger)
  : null;
const supported=discoverSupportedYears(globalData);
const years=requested?.length?requested:supported;

let existingIndex={years:[]};
if(requested?.length){
  try{
    existingIndex=JSON.parse(await fs.readFile(path.join(outRoot,"index.json"),"utf8"));
  }catch{
    existingIndex={years:[]};
  }
}
const index={
  format:"f1ml-season-index",
  schemaVersion:1,
  generatedAt:null,
  years:requested?.length&&Array.isArray(existingIndex?.years)
    ?existingIndex.years.filter((row)=>!years.includes(Number(row?.year)))
    :[],
};

for(const year of years){
  const pack=materializeSeasonPack(globalData,year);
  const dir=path.join(outRoot,String(year));
  await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(dir,"season.json"),JSON.stringify(pack,null,2)+"\n","utf8");
  index.years.push({
    year,
    ready:Boolean(pack.validation?.ok),
    issues:pack.validation?.issues||[],
    warnings:pack.validation?.warnings||[],
    counts:pack.validation?.counts||{},
    path:`/data/seasons/${year}/season.json`,
  });
}

index.years.sort((a,b)=>Number(a?.year)-Number(b?.year));
await fs.writeFile(path.join(outRoot,"index.json"),JSON.stringify(index,null,2)+"\n","utf8");

const ready=index.years.filter((x)=>x.ready).length;
const warningCount=index.years.filter((x)=>x.warnings?.length).length;
console.log(`Generated ${index.years.length} Season Packs (${ready} structurally ready, ${warningCount} with coverage warnings).`);

for(const target of [1975,1980,1989,1999,2014,2020]){
  const row=index.years.find((x)=>x.year===target);
  if(row) console.log(`  ${target}: ${row.ready?"READY":"NOT READY"} · ${row.counts.teams||0} teams · ${row.counts.drivers||0} drivers · ${row.counts.calendar||0} GPs${row.warnings?.length?" · "+row.warnings.join(", "):""}`);
}
