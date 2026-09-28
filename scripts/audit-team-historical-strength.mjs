import fs from "node:fs/promises";
import path from "node:path";

const root=process.cwd();
const seasonsDir=path.join(root,"public","data","seasons");

async function readJson(file,fallback=null){
  try{return JSON.parse(await fs.readFile(file,"utf8"));}
  catch{return fallback;}
}
const idOf=(row)=>String(row?.team_id??row?.id??"");
const finiteScore=(value)=>Number.isFinite(Number(value))&&Number(value)>=0&&Number(value)<=100;

const index=await readJson(path.join(seasonsDir,"index.json"),{years:[]});
const years=(index.years||[])
  .map((row)=>Number(row?.year))
  .filter((year)=>Number.isInteger(year)&&year>=1950&&year<=2024)
  .sort((a,b)=>a-b);

if(years.length!==75||years[0]!==1950||years.at(-1)!==2024){
  throw new Error(`T3.2 requires 75 generated Season Packs (1950-2024); found ${years.length}.`);
}

const problems=[];
const observations=[];
const anchorYears=new Set([1950,1960,1970,1980,1990,2000,2009,2010,2020,2024]);

for(const year of years){
  const pack=await readJson(path.join(seasonsDir,String(year),"season.json"),null);
  if(!pack?.state){
    problems.push({year,issue:"missing_pack_state"});
    continue;
  }
  const teams=Array.isArray(pack.state.teams)?pack.state.teams:[];
  const strengths=Array.isArray(pack.state.teamHistoricalStrength)?pack.state.teamHistoricalStrength:[];
  const teamIds=new Set(teams.map(idOf).filter(Boolean));
  const strengthIds=new Set(strengths.map(idOf).filter(Boolean));

  if(teamIds.size!==strengthIds.size){
    problems.push({year,issue:"strength_count_mismatch",teams:teamIds.size,strengths:strengthIds.size});
  }
  for(const id of teamIds){
    if(!strengthIds.has(id))problems.push({year,team_id:id,issue:"missing_strength"});
  }

  for(const row of strengths){
    const id=idOf(row);
    const scores=[
      "heritage_strength",
      "sporting_strength",
      "recent_competitiveness",
      "structural_strength",
      "competitive_strength",
      "overall",
    ];
    for(const key of scores){
      if(!finiteScore(row?.[key])){
        problems.push({year,team_id:id,issue:"invalid_score",key,value:row?.[key]});
      }
    }
    if(Number(row?.evidence_through_year)!==year-1){
      problems.push({year,team_id:id,issue:"future_evidence_boundary",value:row?.evidence_through_year});
    }
    if((row?.recent_seasons||[]).some((sample)=>Number(sample?.year)>=year)){
      problems.push({year,team_id:id,issue:"selected_or_future_recent_evidence"});
    }
    observations.push({...row,year});
  }

  if(anchorYears.has(year)){
    console.log(`\nT3.2 Historical Team Strength — ${year}`);
    console.table(
      strengths.slice().sort((a,b)=>Number(b.overall)-Number(a.overall)).map((row)=>({
        TEAM:teams.find((team)=>idOf(team)===idOf(row))?.team_name||idOf(row),
        ID:idOf(row),
        OVERALL:row.overall,
        STRUCT:row.structural_strength,
        SPORT:row.sporting_strength,
        RECENT:row.recent_competitiveness,
        HERITAGE:row.heritage_strength,
        SEASONS:row.seasons_before_start,
        WINS:row.historical_wins,
        CT:row.constructors_titles,
        DT:row.drivers_titles,
      }))
    );
  }
}

// A long-established multiple-title Team must separate naturally from a recent
// low-history entrant. This is a regression sentinel, not a named override.
const p2009=await readJson(path.join(seasonsDir,"2009","season.json"),null);
if(p2009?.state){
  const byId=new Map((p2009.state.teamHistoricalStrength||[]).map((row)=>[idOf(row),row]));
  const established=byId.get("t_0010"); // Ferrari
  const recent=byId.get("t_0021"); // Force India
  if(established&&recent&&Number(established.structural_strength)<=Number(recent.structural_strength)){
    problems.push({
      year:2009,
      issue:"established_team_not_structurally_stronger_than_recent_entrant",
      established:established.structural_strength,
      recent:recent.structural_strength,
    });
  }
}

console.log("\nT3.2 — Historical Team Strength Audit");
console.log(JSON.stringify({
  seasons:years.length,
  team_season_observations:observations.length,
  problems:problems.length,
  min_overall:observations.length?Math.min(...observations.map((row)=>Number(row.overall))):null,
  max_overall:observations.length?Math.max(...observations.map((row)=>Number(row.overall))):null,
},null,2));

if(problems.length){
  console.error("Historical Team Strength failures:",problems.slice(0,40));
  process.exitCode=1;
}
