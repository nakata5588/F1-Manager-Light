import fs from "node:fs/promises";
import path from "node:path";
import { historicalResultCode, historicalResultInfo } from "../src/domain/historicalRaceStatus.js";

const root=process.cwd();
const dataDir=path.join(root,"public","data");
const target=path.join(dataDir,"race_results_archive.json");
const indexTarget=path.join(dataDir,"race_results_archive_index.json");

const unwrap=(v)=>{
  if(v&&typeof v==="object"&&!Array.isArray(v)) return v.result ?? v.value ?? null;
  return v;
};
const first=(o,keys,fb=undefined)=>{
  for(const k of keys){
    if(!o||!Object.prototype.hasOwnProperty.call(o,k))continue;
    const v=unwrap(o[k]);
    if(v!==undefined&&v!==null&&v!=="")return v;
  }
  return fb;
};
const num=(v,fb=null)=>{
  if(v===undefined||v===null||v==="")return fb;
  const n=Number(unwrap(v));
  return Number.isFinite(n)?n:fb;
};
const canon=(v)=>String(v??"").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"").trim();

async function readJson(name,fallback=[]){
  try{return JSON.parse(await fs.readFile(path.join(dataDir,name),"utf8"));}
  catch{return fallback;}
}
async function readRootJson(rel,fallback={}){
  try{return JSON.parse(await fs.readFile(path.join(root,rel),"utf8"));}
  catch{return fallback;}
}

const [rows,drivers,teams,calendar,constructorRef]=await Promise.all([
  readJson("race_results.json",[]),
  readJson("drivers.json",[]),
  readJson("teams.json",[]),
  readJson("calendar.json",[]),
  readRootJson("data/reference/constructor_id_map.json",{constructors:[]}),
]);

const driverArchiveToId=new Map();
const driverNameToId=new Map();
const driverNameById=new Map();
for(const d of drivers){
  const id=String(first(d,["driver_id","id"],""));
  if(!id)continue;
  const archiveId=num(first(d,["driverID_arch","driverId_arch","driverId"],null),null);
  if(archiveId!=null)driverArchiveToId.set(archiveId,id);
  const name=String(first(d,["display_name","driver_name","name","full_name"],id));
  driverNameById.set(id,name);
  for(const n of [d.display_name,d.driver_name,d.name,d.full_name]){
    const key=canon(n);
    if(key&&!driverNameToId.has(key))driverNameToId.set(key,id);
  }
}

const constructorIdToName=new Map(
  (constructorRef?.constructors||[]).map((r)=>[Number(r.constructorId),String(r.constructorName||"")])
);
const teamNameToId=new Map();
const teamNameById=new Map();
for(const t of teams){
  const id=String(first(t,["team_id","id"],""));
  if(!id)continue;
  const name=String(first(t,["team_name","name","short_name"],id));
  teamNameById.set(id,name);
  for(const n of [t.team_name,t.name,t.short_name,t.official_name]){
    const key=canon(n);
    if(key&&!teamNameToId.has(key))teamNameToId.set(key,id);
  }
}
function managerialTeamName(name){
  const raw=String(name||"").trim();
  if(!raw)return raw;
  if(/^team lotus$/i.test(raw))return "Lotus";
  const dash=raw.indexOf("-");
  if(dash>0){
    const base=raw.slice(0,dash).trim();
    if(teamNameToId.has(canon(base)))return base;
  }
  return raw;
}
function resolveTeam(row){
  const direct=String(first(row,["team_id","constructor_id"],""));
  if(direct&&teamNameById.has(direct))return direct;
  const constructorId=num(first(row,["constructorId"],null),null);
  const refName=constructorId!=null?constructorIdToName.get(constructorId):"";
  const raw=String(first(row,["team_name","constructor_name","constructorName","constructor","team"],refName||""));
  const mapped=teamNameToId.get(canon(managerialTeamName(raw)));
  if(mapped)return mapped;
  if(direct)return direct;
  return constructorId!=null?`archive_constructor_${constructorId}`:raw;
}
function resolveDriver(row){
  const direct=String(first(row,["driver_id","person_id"],""));
  if(direct&&driverNameById.has(direct))return direct;
  const archiveId=num(first(row,["driverId","driverID"],null),null);
  if(archiveId!=null&&driverArchiveToId.has(archiveId))return driverArchiveToId.get(archiveId);
  const raw=String(first(row,["driver_name","driverName","display_name","name"],""));
  return driverNameToId.get(canon(raw))||direct||(archiveId!=null?`archive_driver_${archiveId}`:raw);
}
function isFastest(row){
  const rank=num(first(row,["rank","fastestLapRank","fastest_lap_rank"],null),null);
  if(rank===1)return true;
  return ["true","1","yes"].includes(String(first(row,["fastest_lap","fastestLap"],false)).toLowerCase());
}

const calendarByYearRound=new Map();
for(const gp of calendar){
  const year=num(first(gp,["year","season_year","season"],null),null);
  const round=num(first(gp,["round","round_number"],null),null);
  if(year!=null&&round!=null)calendarByYearRound.set(`${year}|${round}`,gp);
}

const grouped=new Map();
for(const row of Array.isArray(rows)?rows:[]){
  const year=num(first(row,["year","season_year","season"],null),null);
  const round=num(first(row,["round","race_round","round_number"],null),null);
  if(year==null)continue;
  const cal=round!=null?calendarByYearRound.get(`${year}|${round}`):null;
  const gpName=String(first(row,["gp_name","raceName","race","name"],first(cal,["gp_name","name","race"],round!=null?`Round ${round}`:"Grand Prix")));
  const gpId=first(row,["gp_id","race_id","raceId"],first(cal,["gp_id","race_id","id"],null));
  const key=`hist_${year}_${round??"x"}_${String(gpId??gpName).replace(/\s+/g,"_")}`;
  if(!grouped.has(key)){
    grouped.set(key,{
      key,year,round,name:gpName,gp_name:gpName,gp_id:gpId,
      track_id:first(row,["track_id","circuit_id","circuitId"],first(cal,["track_id","circuit_id"],null)),
      dateISO:first(row,["dateISO","race_date","date"],first(cal,["dateISO","race_date","date"],null)),
      historical:true,source:"historical_database",
      classification:[],startingGrid:[],qualifying:[],
    });
  }
  const event=grouped.get(key);
  const driver_id=resolveDriver(row);
  const team_id=resolveTeam(row);
  const driver_name=driverNameById.get(driver_id)||String(first(row,["driver_name","driverName","display_name","name"],driver_id||"—"));
  const team_name=teamNameById.get(team_id)||String(first(row,["team_name","constructorName","constructor_name","constructor","team"],team_id||"—"));
  const position=num(first(row,["position","positionOrder","position_order","finish_position","pos"],null),null);
  const grid=num(first(row,["grid","gridPosition","grid_position","starting_grid"],null),null);
  const statusInfo=historicalResultInfo(row);
  const retired=statusInfo.isDnf;
  const status=statusInfo.label;
  const result_code=historicalResultCode(row);

  event.classification.push({
    position,driver_id,driver_name,team_id,team_name,retired,status,result_code,
    retirement_reason:retired?status:null,
    points:num(first(row,["points"],null),null),
    fastest_lap:isFastest(row),
    laps_completed:num(first(row,["laps","laps_completed"],null),null),
    total_time_ms:num(first(row,["milliseconds","total_time_ms"],null),null),
    grid,
  });
  if(grid!=null&&grid>0){
    event.startingGrid.push({driver_id,grid});
    event.qualifying.push({driver_id,position:grid,best_time_ms:null});
  }
}

const output=[...grouped.values()]
  .map((event)=>({
    ...event,
    classification:event.classification.sort((a,b)=>(Number(a.position)||Infinity)-(Number(b.position)||Infinity)),
    startingGrid:event.startingGrid.sort((a,b)=>Number(a.grid)-Number(b.grid)),
    qualifying:event.qualifying.sort((a,b)=>Number(a.position)-Number(b.position)),
  }))
  .sort((a,b)=>Number(a.year)-Number(b.year)||Number(a.round||0)-Number(b.round||0));

if((rows?.length||0)>100&&!output.length){
  throw new Error(`Historical race archive generation failed: ${rows.length} source rows produced 0 events.`);
}
await fs.writeFile(target,JSON.stringify(output,null,2)+"\n","utf8");

const byDecade=new Map();
for(const event of output){
  const decade=Math.floor(Number(event.year)/10)*10;
  if(!byDecade.has(decade))byDecade.set(decade,[]);
  byDecade.get(decade).push(event);
}
const years=[...new Set(output.map((r)=>r.year))].sort((a,b)=>a-b);
const decadeIndex=[];
for(const [decade,events] of [...byDecade.entries()].sort((a,b)=>a[0]-b[0])){
  const filename=`race_results_archive_${decade}s.json`;
  await fs.writeFile(path.join(dataDir,filename),JSON.stringify(events,null,2)+"\n","utf8");
  const decadeYears=[...new Set(events.map((event)=>Number(event.year)))].sort((a,b)=>a-b);
  decadeIndex.push({
    decade,
    label:`${decade}s`,
    file:filename,
    first_year:decadeYears[0]??null,
    last_year:decadeYears.at(-1)??null,
    years:decadeYears,
    races:events.length,
  });
}
await fs.writeFile(indexTarget,JSON.stringify({
  source:"historical_database",
  first_year:years[0]??null,
  last_year:years.at(-1)??null,
  total_races:output.length,
  decades:decadeIndex,
},null,2)+"\n","utf8");

console.log(`Generated race_results_archive.json: ${output.length} races from ${rows.length} result rows (${years[0]||"—"}-${years.at(-1)||"—"}).`);
console.log(`Generated decade race archives: ${decadeIndex.map((row)=>row.label+":"+row.races).join(" · ")}.`);
