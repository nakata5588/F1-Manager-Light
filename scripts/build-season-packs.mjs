import fs from "node:fs/promises";
import path from "node:path";
import {
  discoverSupportedYears,
  materializeSeasonPack,
} from "../src/data/seasonPackMaterializer.js";

const root=process.cwd();
const dataDir=path.join(root,"public","data");
const outRoot=path.join(dataDir,"seasons");

async function readJson(name,fallback=[]){
  try{return JSON.parse(await fs.readFile(path.join(dataDir,name),"utf8"));}
  catch{return fallback;}
}

await fs.mkdir(outRoot,{recursive:true});

const [
  drivers,calendar,teams,driverRatings,driverCareer,driverHistory,staffRatings,staffCore,
  teamBrands,teamEngines,contracts,sponsorsContracts,rules,eraSafety,
  accidentModel,facilities,carStats,staffContracts,tyres,pointsSystems,penaltiesRules,
  financialRules,agendaBlocks,contractRules,youthIntakeRules,scoutingZones,
  trackLayoutByYear,teamSeasons,
]=await Promise.all([
  readJson("drivers.json"),
  readJson("calendar.json"),
  readJson("teams.json"),
  readJson("driver_ratings.json"),
  readJson("driver_career.json"),
  readJson("driver_f1_history.json"),
  readJson("staff_ratings.json"),
  readJson("staff_core.json"),
  readJson("team_brands.json"),
  readJson("team_engines.json"),
  readJson("contracts.json"),
  readJson("sponsors_contracts.json"),
  readJson("rules.json"),
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
]);

const globalData={
  drivers,calendar,teams,driverRatings,driverCareer,driverHistory,staffRatings,staffCore,
  teamBrands,teamEngines,contracts,sponsorsContracts,rules,eraSafety,
  accidentModel:Array.isArray(accidentModel)?accidentModel:Object.values(accidentModel||{}),
  facilities,carStats,staffContracts,tyres,pointsSystems,penaltiesRules,financialRules,
  agendaBlocks,contractRules,youthIntakeRules,scoutingZones,trackLayoutByYear,teamSeasons,
};

const requestedArg=process.argv.find((arg)=>arg.startsWith("--years="));
const requested=requestedArg
  ? requestedArg.slice("--years=".length).split(",").map(Number).filter(Number.isInteger)
  : null;
const supported=discoverSupportedYears(globalData);
const years=requested?.length?requested:supported;

const index={
  format:"f1ml-season-index",
  schemaVersion:1,
  generatedAt:null,
  years:[],
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

await fs.writeFile(path.join(outRoot,"index.json"),JSON.stringify(index,null,2)+"\n","utf8");

const ready=index.years.filter((x)=>x.ready).length;
const warningCount=index.years.filter((x)=>x.warnings?.length).length;
console.log(`Generated ${index.years.length} Season Packs (${ready} structurally ready, ${warningCount} with coverage warnings).`);

for(const target of [1975,1980,1989,1999,2014,2020]){
  const row=index.years.find((x)=>x.year===target);
  if(row) console.log(`  ${target}: ${row.ready?"READY":"NOT READY"} · ${row.counts.teams||0} teams · ${row.counts.drivers||0} drivers · ${row.counts.calendar||0} GPs${row.warnings?.length?" · "+row.warnings.join(", "):""}`);
}
