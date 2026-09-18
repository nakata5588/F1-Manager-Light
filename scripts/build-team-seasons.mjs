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

const [rows,teams,drivers] = await Promise.all([
  readJson(source,[]),
  readJson(path.join(root,"public","data","teams.json"),[]),
  readJson(path.join(root,"public","data","drivers.json"),[]),
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

function resolveTeam(row){
  const direct=String(unwrap(row?.team_id??row?.constructor_id)??"");
  if(direct)return direct;
  const name=unwrap(row?.team_name??row?.constructor_name??row?.constructor??row?.team);
  const mapped=teamNameToId.get(canon(name));
  if(mapped)return mapped;
  const key=canon(name);
  return key ? "legacy_team_" + key : "";
}
function resolveDriver(row){
  const direct=String(unwrap(row?.driver_id??row?.person_id)??"");
  if(direct)return direct;
  const name=unwrap(row?.driver_name??row?.display_name??row?.name);
  return driverNameToId.get(canon(name))||"";
}

const diagnosticRows=(Array.isArray(rows)?rows:[])
  .filter((r)=>[2014,2020].includes(Number(unwrap(r?.year??r?.season_year))))
  .slice(0,8)
  .map((r)=>({
    year:unwrap(r?.year??r?.season_year),
    keys:Object.keys(r).filter((k)=>/team|constructor/i.test(k)),
    values:Object.fromEntries(Object.entries(r).filter(([k])=>/team|constructor/i.test(k))),
    driver_id:unwrap(r?.driver_id),
    driver_name:unwrap(r?.driver_name),
  }));
if(diagnosticRows.length) console.log("[team-seasons diagnostic]",JSON.stringify(diagnosticRows));

const byKey = new Map();
for(const r of Array.isArray(rows) ? rows : []) {
  const year=Number(unwrap(r?.year??r?.season_year));
  const team_id=resolveTeam(r);
  const team_name=String(unwrap(r?.team_name??r?.constructor_name??r?.constructor??r?.team)??"");
  const driver_id=resolveDriver(r);
  if(!Number.isFinite(year)||!team_id)continue;
  const key=String(year)+"|"+team_id;
  if(!byKey.has(key))byKey.set(key,{year,team_id,team_name,driver_ids:new Set()});
  const rec=byKey.get(key);
  if(driver_id)rec.driver_ids.add(driver_id);
  if(!rec.team_name&&team_name)rec.team_name=team_name;
}

const output=[...byKey.values()]
  .map((row)=>({
    year:row.year,
    team_id:row.team_id,
    team_name:row.team_name,
    driver_count:row.driver_ids.size,
    driver_ids:[...row.driver_ids].sort(),
  }))
  .sort((a,b)=>a.year-b.year||a.team_name.localeCompare(b.team_name));

await fs.writeFile(target,JSON.stringify(output,null,2)+"\n","utf8");
console.log("Generated team_seasons.json: "+output.length+" team-season rows from "+rows.length+" race-result rows");
