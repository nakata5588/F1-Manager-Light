import fs from "node:fs/promises";
import path from "node:path";

const root=process.cwd();
const dataDir=path.join(root,"public","data");
const target=path.join(dataDir,"driver_f1_history.json");

const unwrap=(v)=>{
  if(v&&typeof v==="object"&&!Array.isArray(v)) return v.result ?? v.value ?? null;
  return v;
};
const own=(o,k)=>o&&Object.prototype.hasOwnProperty.call(o,k)?o[k]:undefined;
const first=(o,keys,fb=undefined)=>{
  for(const k of keys){
    const v=unwrap(own(o,k));
    if(v!==undefined&&v!==null&&v!=="") return v;
  }
  return fb;
};
const canon=(v)=>String(v??"").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"").trim();
const num=(v,fb=NaN)=>{const n=Number(unwrap(v));return Number.isFinite(n)?n:fb;};

async function readJson(name,fallback=[]){
  try{return JSON.parse(await fs.readFile(path.join(dataDir,name),"utf8"));}
  catch{return fallback;}
}
async function readRootJson(rel,fallback={}){
  try{return JSON.parse(await fs.readFile(path.join(root,rel),"utf8"));}
  catch{return fallback;}
}

const [rows,drivers,teams,constructorRef]=await Promise.all([
  readJson("race_results.json",[]),
  readJson("drivers.json",[]),
  readJson("teams.json",[]),
  readRootJson("data/reference/constructor_id_map.json",{constructors:[]}),
]);

const driverArchiveToId=new Map();
const driverNameToId=new Map();
const driverNameById=new Map();
for(const d of drivers){
  const id=String(first(d,["driver_id","id"],""));
  if(!id)continue;
  const archiveId=num(first(d,["driverID_arch","driverId_arch","driverId"],NaN),NaN);
  if(Number.isFinite(archiveId))driverArchiveToId.set(archiveId,id);
  const name=String(first(d,["display_name","driver_name","name","full_name"],id));
  driverNameById.set(id,name);
  for(const n of [d.display_name,d.driver_name,d.name,d.full_name]){
    const key=canon(n); if(key&&!driverNameToId.has(key))driverNameToId.set(key,id);
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
    const key=canon(n); if(key&&!teamNameToId.has(key))teamNameToId.set(key,id);
  }
}
function resolveManagerialTeamName(name){
  const raw=String(name||"").trim();
  if(!raw)return raw;
  if(/^team lotus$/i.test(raw))return "Lotus";
  const dash=raw.indexOf("-");
  if(dash>0){
    const base=raw.slice(0,dash).trim();
    if(teamNameToId.has(canon(base))) return base;
  }
  return raw;
}
function resolveTeam(row){
  const direct=String(first(row,["team_id","constructor_id"],""));
  if(direct&&teamNameById.has(direct)) return direct;

  const constructorId=num(first(row,["constructorId"],NaN),NaN);
  const refName=Number.isFinite(constructorId)?constructorIdToName.get(constructorId):"";
  const rawName=String(first(row,["team_name","constructor_name","constructorName","constructor","team"],refName||""));
  const managerialName=resolveManagerialTeamName(rawName);
  const mapped=teamNameToId.get(canon(managerialName));
  if(mapped)return mapped;
  if(direct)return direct;
  return Number.isFinite(constructorId)?`archive_constructor_${constructorId}`:"";
}
function resolveDriver(row){
  const direct=String(first(row,["driver_id","person_id"],""));
  if(direct&&driverNameById.has(direct))return direct;
  const archiveId=num(first(row,["driverId"],NaN),NaN);
  if(Number.isFinite(archiveId)&&driverArchiveToId.has(archiveId))return driverArchiveToId.get(archiveId);
  const name=String(first(row,["driver_name","driverName","display_name","name"],""));
  return driverNameToId.get(canon(name))||direct||"";
}
function finishPosition(row){
  return num(first(row,["position","positionOrder","position_order","finish_position","pos"],NaN),NaN);
}
function gridPosition(row){
  return num(first(row,["grid","gridPosition","grid_position","starting_grid"],NaN),NaN);
}
function fastestLap(row){
  const rank=num(first(row,["rank","fastestLapRank","fastest_lap_rank"],NaN),NaN);
  if(rank===1)return true;
  const raw=first(row,["fastest_lap","fastestLap"],false);
  return raw===true || String(raw).toLowerCase()==="true";
}
function isDnf(row){
  if(row?.retired===true)return true;
  const status=String(first(row,["status","statusText","status_text","positionText","result_status"],"")).toLowerCase();
  if(!status)return false;
  if(status==="finished" || /^\+\d+\s+laps?$/.test(status))return false;
  return /(dnf|retir|accident|collision|engine|gearbox|transmission|electrical|hydraulic|suspension|brakes|puncture|fire|oil|fuel|overheat|spun|damage|mechanical|not classified|did not finish)/.test(status);
}

const byKey=new Map();
for(const row of Array.isArray(rows)?rows:[]){
  const year=num(first(row,["year","season_year"],NaN),NaN);
  const did=resolveDriver(row);
  const tid=resolveTeam(row);
  if(!Number.isInteger(year)||!did)continue;
  const key=[year,did,tid||""].join("|");
  if(!byKey.has(key)){
    byKey.set(key,{
      year,
      driver_id:did,
      driver_name:driverNameById.get(did)||String(first(row,["driver_name","driverName","name"],did)),
      series_division:"F1",
      team_id:tid||null,
      team_name:teamNameById.get(tid)||String(first(row,["team_name","constructorName","constructor_name","constructor","team"],tid||"—")),
      starts:0,
      races:0,
      wins:0,
      podiums:0,
      poles:0,
      fastest_laps:0,
      dnf:0,
      classified_finishes:0,
      finish_position_sum:0,
      best_finish:null,
      points:0,
      champ_pos:null,
      source:"race_results_derived",
    });
  }
  const rec=byKey.get(key);
  const pos=finishPosition(row);
  const grid=gridPosition(row);
  const retired=isDnf(row);
  rec.starts+=1;
  rec.races+=1;
  if(pos===1&&!retired)rec.wins+=1;
  if(Number.isFinite(pos)&&pos>=1&&pos<=3&&!retired)rec.podiums+=1;
  if(grid===1)rec.poles+=1;
  if(fastestLap(row))rec.fastest_laps+=1;
  if(retired)rec.dnf+=1;
  if(Number.isFinite(pos)&&pos>0){
    rec.classified_finishes+=1;
    rec.finish_position_sum+=pos;
    rec.best_finish=rec.best_finish==null?pos:Math.min(rec.best_finish,pos);
  }
  rec.points=Number((rec.points+num(first(row,["points"],0),0)).toFixed(3));
}

const output=[...byKey.values()]
  .map((row)=>({
    ...row,
    average_finish:row.classified_finishes
      ? Number((row.finish_position_sum/row.classified_finishes).toFixed(2))
      : null,
    points_per_start:row.starts
      ? Number((row.points/row.starts).toFixed(3))
      : 0,
  }))
  .map(({finish_position_sum,...row})=>row)
  .sort((a,b)=>a.year-b.year||a.driver_name.localeCompare(b.driver_name)||String(a.team_name).localeCompare(String(b.team_name)));

await fs.writeFile(target,JSON.stringify(output,null,2)+"\n","utf8");

const years=[...new Set(output.map(r=>r.year))].sort((a,b)=>a-b);
console.log(`Generated driver_f1_history.json: ${output.length} driver-team-season rows from ${rows.length} race-result rows (${years[0]||"—"}-${years.at(-1)||"—"}).`);
for(const y of [1975,1980,1987,1989,1999,2014,2020]){
  const yr=output.filter(r=>r.year===y);
  console.log(`  ${y}: ${yr.length} rows · ${new Set(yr.map(r=>r.driver_id)).size} drivers`);
}
