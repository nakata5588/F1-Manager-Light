import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const source = path.join(root, "public", "data", "race_results.json");
const target = path.join(root, "public", "data", "team_seasons.json");

const unwrap = (v) => {
  if (v && typeof v === "object" && !Array.isArray(v)) return v.result ?? v.value ?? null;
  return v;
};
const canon=(v)=>String(unwrap(v)??"").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"").trim();
const own=(o,key)=>o&&Object.prototype.hasOwnProperty.call(o,key)?o[key]:undefined;
const firstOwn=(o,keys)=>{
  for(const key of keys){
    const value=own(o,key);
    if(value!==undefined&&value!==null&&value!=="")return value;
  }
  return undefined;
};

async function readJson(file,fallback=[]){
  try{return JSON.parse(await fs.readFile(file,"utf8"));}
  catch{return fallback;}
}

async function isFresh() {
  try {
    const [src, out] = await Promise.all([fs.stat(source), fs.stat(target)]);
    return out.mtimeMs >= src.mtimeMs;
  } catch {
    return false;
  }
}

if (await isFresh()) {
  console.log("team_seasons.json is up to date");
  process.exit(0);
}

const [rows,teams,drivers,constructorReference] = await Promise.all([
  readJson(source,[]),
  readJson(path.join(root,"public","data","teams.json"),[]),
  readJson(path.join(root,"public","data","drivers.json"),[]),
  readJson(path.join(root,"data","reference","constructor_id_map.json"),{constructors:[]}),
]);

const teamNameToId=new Map();
for(const t of teams){
  const id=String(unwrap(t.team_id??t.id)??"");
  if(!id)continue;
  for(const value of [t.team_name,t.name,t.short_name,t.official_name]){
    const key=canon(value); if(key&&!teamNameToId.has(key))teamNameToId.set(key,id);
  }
}
const driverNameToId=new Map();
for(const d of drivers){
  const id=String(unwrap(d.driver_id??d.id)??"");
  if(!id)continue;
  for(const value of [d.display_name,d.driver_name,d.name,d.full_name]){
    const key=canon(value); if(key&&!driverNameToId.has(key))driverNameToId.set(key,id);
  }
}

const constructorNumericToName=new Map(
  (constructorReference?.constructors||[]).map((row)=>[Number(row.constructorId),String(row.constructorName||"")])
);
const driverArchiveIdToId=new Map();
for(const d of drivers){
  const id=String(unwrap(d.driver_id??d.id)??"");
  const archiveId=Number(unwrap(d.driverID_arch??d.driverId_arch??d.driverId));
  if(id&&Number.isFinite(archiveId))driverArchiveIdToId.set(archiveId,id);
}

function resolveTeam(row){
  const canonicalDirect=String(unwrap(firstOwn(row,["team_id","constructor_id"]))??"");
  if(canonicalDirect)return canonicalDirect;

  const numericConstructorId=Number(unwrap(firstOwn(row,["constructorId"])));
  const refName=Number.isFinite(numericConstructorId) ? constructorNumericToName.get(numericConstructorId) : "";
  const name=unwrap(firstOwn(row,["team_name","constructor_name","constructorName","constructor","team"])) || refName;
  const mapped=teamNameToId.get(canon(name));
  if(mapped)return mapped;

  if(Number.isFinite(numericConstructorId)) return "archive_constructor_" + numericConstructorId;
  const key=canon(name);
  return key ? "legacy_team_" + key : "";
}
function resolveDriver(row){
  const direct=String(unwrap(firstOwn(row,["driver_id","person_id"]))??"");
  if(direct)return direct;
  const archiveId=Number(unwrap(firstOwn(row,["driverId"])));
  if(Number.isFinite(archiveId)&&driverArchiveIdToId.has(archiveId))return driverArchiveIdToId.get(archiveId);
  const name=unwrap(firstOwn(row,["driver_name","display_name","driverName","name"]));
  return driverNameToId.get(canon(name))||"";
}

const byKey = new Map();
let sourceIndex=0;
for(const r of Array.isArray(rows) ? rows : []) {
  const year=Number(unwrap(firstOwn(r,["year","season_year"])));
  const team_id=resolveTeam(r);
  const numericConstructorId=Number(unwrap(firstOwn(r,["constructorId"])));
  const refName=Number.isFinite(numericConstructorId)?constructorNumericToName.get(numericConstructorId):"";
  const team_name=String(unwrap(firstOwn(r,["team_name","constructor_name","constructorName","constructor","team"]))??refName??"");
  const driver_id=resolveDriver(r);
  const roundRaw=Number(unwrap(firstOwn(r,["round","raceRound","roundNumber"])));
  const raceDate=String(unwrap(firstOwn(r,["race_date","date","dateISO"]))??"");
  if(!Number.isFinite(year)||!team_id){sourceIndex++;continue;}
  const key=String(year)+"|"+team_id;
  if(!byKey.has(key))byKey.set(key,{year,team_id,team_name,driver_ids:new Set(),drivers:new Map()});
  const rec=byKey.get(key);
  if(driver_id){
    rec.driver_ids.add(driver_id);
    const prev=rec.drivers.get(driver_id)||{
      driver_id,
      appearances:0,
      first_round:null,
      first_date:null,
      first_source_index:sourceIndex,
    };
    prev.appearances += 1;
    if(Number.isFinite(roundRaw) && (prev.first_round==null || roundRaw<prev.first_round)) prev.first_round=roundRaw;
    if(raceDate && (!prev.first_date || raceDate<prev.first_date)) prev.first_date=raceDate;
    prev.first_source_index=Math.min(prev.first_source_index,sourceIndex);
    rec.drivers.set(driver_id,prev);
  }
  if(!rec.team_name&&team_name)rec.team_name=team_name;
  sourceIndex++;
}

const output=[...byKey.values()]
  .map((row)=>({
    year:row.year,
    team_id:row.team_id,
    team_name:row.team_name,
    driver_count:row.driver_ids.size,
    driver_ids:[...row.driver_ids].sort(),
    drivers:[...row.drivers.values()].sort((a,b)=>{
      const ar=Number.isFinite(a.first_round)?a.first_round:999;
      const br=Number.isFinite(b.first_round)?b.first_round:999;
      return ar-br || a.first_source_index-b.first_source_index || b.appearances-a.appearances || a.driver_id.localeCompare(b.driver_id);
    }),
  }))
  .sort((a,b)=>a.year-b.year||a.team_name.localeCompare(b.team_name));

await fs.writeFile(target,JSON.stringify(output,null,2)+"\n","utf8");
console.log("Generated team_seasons.json: "+output.length+" team-season rows from "+rows.length+" race-result rows");
