// Verify a generated Season Pack actually uses Results-derived car attributes.
// Not a race-time calculation: this inspects the finished build artifact.
import fs from "node:fs/promises";
import { prepareVerifiedCarResults } from "./lib/verified-car-results.mjs";
import { materializeHistoricalCarBaselines } from "../src/domain/historicalCarResultBaseline.js";

const root=new URL("../",import.meta.url);
async function read(path,fallback=[]){
  try{return JSON.parse(await fs.readFile(new URL(path,root),"utf8"));}
  catch(err){if(err.code==="ENOENT")return fallback;throw err;}
}
const year=Number(process.argv.find(s=>s.startsWith("--year="))?.slice(7)??2000);
const [results,teams,drivers,reference,entries,pack]=await Promise.all([
  read("public/data/race_results.json"),read("public/data/teams.json"),
  read("public/data/drivers.json"),read("data/reference/constructor_id_map.json",{constructors:[]}),
  read("public/data/f1_entry_list_history.json"),
  read(`public/data/seasons/${year}/season.json`,null),
]);
if(!results.length||!pack?.state?.carStats)throw Error("Missing raw Results or generated Season Pack: build data and selected season first");
const verified=prepareVerifiedCarResults({results,teams,drivers,constructorReference:reference,entryRows:entries,years:[year]});
const baseline=materializeHistoricalCarBaselines(verified.rows,year);
const teamNameById=new Map((pack.state.teams||[]).map(t=>[String(t.team_id),t.team_name]));
const ranking=pack.state.carStats.map(r=>({
  team_id:r.team_id,team:teamNameById.get(String(r.team_id))??r.team_id,
  chassis:Number(r.chassis_spec??0),aero:Number(r.aero_spec??0),
  reliability:Number(r.reliability??0),
  source:r.generation_source??"explicit",
  evidence:r.historical_baseline_source??null,
  confidence:r.historical_baseline_confidence??null,
})).sort((a,b)=>b.chassis-a.chassis);
const generated=ranking.filter(x=>x.source==="historical_results_inference");
const summary={
  year,rawResultRows:verified.coverage[0]?.total??0,
  exactEntrantRows:verified.coverage[0]?.exact??0,
  excludedEstimatedEntrant:verified.coverage[0]?.estimated??0,
  unresolvedDriver:verified.coverage[0]?.unmappedDriver??0,
  verifiedBaselineTeams:baseline.filter(x=>x.confidence==="medium").length,
  generatedCarTeams:generated.length,
  ranking,
};
console.log("HISTORICAL_CAR_SEASON_PACK_AUDIT="+JSON.stringify(summary));
if(!generated.length)throw Error(`No Results-derived cars in Season Pack ${year}`);
