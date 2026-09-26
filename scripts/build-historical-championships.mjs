import fs from "node:fs/promises";
import path from "node:path";
import {
  championshipRuleForYear,
  countChampionshipPoints,
  pointsForPosition,
} from "../src/domain/championshipRules.js";
import {
  canonicalTeamName,
  createTeamIdentityResolver,
  normalizeTeamIdentityName,
} from "../src/domain/teamIdentity.js";

const root=process.cwd();
const dataDir=path.join(root,"public","data");
const target=path.join(dataDir,"historical_championships.json");

const unwrap=(value)=>{
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    if(value.result!==undefined&&value.result!==null&&value.result!=="")return unwrap(value.result);
    if(value.value!==undefined&&value.value!==null&&value.value!=="")return unwrap(value.value);
    if(value.text!==undefined&&value.text!==null&&value.text!=="")return unwrap(value.text);
  }
  return value;
};
const first=(row,keys,fallback=undefined)=>{
  for(const key of keys){
    if(!row||!Object.prototype.hasOwnProperty.call(row,key))continue;
    const value=unwrap(row[key]);
    if(value!==undefined&&value!==null&&value!=="")return value;
  }
  return fallback;
};
const num=(value,fallback=NaN)=>{
  const n=Number(unwrap(value));
  return Number.isFinite(n)?n:fallback;
};
const canon=(value)=>String(unwrap(value)??"")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"")
  .replace(/[^a-z0-9]+/g,"")
  .trim();

async function readJson(name,fallback=[]){
  try{return JSON.parse(await fs.readFile(path.join(dataDir,name),"utf8"));}
  catch{return fallback;}
}
async function readRootJson(rel,fallback={}){
  try{return JSON.parse(await fs.readFile(path.join(root,rel),"utf8"));}
  catch{return fallback;}
}

const [raceRows,drivers,teams,driverCareer,constructorRef]=await Promise.all([
  readJson("race_results.json",[]),
  readJson("drivers.json",[]),
  readJson("teams.json",[]),
  readJson("driver_career.json",[]),
  readRootJson("data/reference/constructor_id_map.json",{constructors:[]}),
]);

const driverByArchive=new Map();
const driverByName=new Map();
const driverNameById=new Map();
for(const driver of drivers){
  const id=String(first(driver,["driver_id","id"],""));
  if(!id)continue;
  driverNameById.set(id,String(first(driver,["display_name","driver_name","name"],id)));
  const archiveId=num(first(driver,["driverID_arch","driverId_arch","driverId"],NaN),NaN);
  if(Number.isFinite(archiveId))driverByArchive.set(archiveId,id);
  for(const value of [driver.display_name,driver.driver_name,driver.name,driver.full_name]){
    const key=canon(value);
    if(key&&!driverByName.has(key))driverByName.set(key,id);
  }
}

const constructorNameByArchiveId=new Map(
  (constructorRef?.constructors||[])
    .map((row)=>[Number(row?.constructorId),String(row?.constructorName||"")])
    .filter(([id,name])=>Number.isFinite(id)&&name)
);
const teamResolver=createTeamIdentityResolver(teams);

function resolveDriver(row){
  const direct=String(first(row,["driver_id","person_id"],""));
  if(direct&&driverNameById.has(direct))return direct;
  const archive=num(first(row,["driverId","driverID"],NaN),NaN);
  if(Number.isFinite(archive)&&driverByArchive.has(archive))return driverByArchive.get(archive);
  const name=String(first(row,["driver_name","driverName","display_name","name"],""));
  return driverByName.get(canon(name))||direct||(Number.isFinite(archive)?`archive_driver_${archive}`:"");
}

function rawConstructorName(row){
  const archive=num(first(row,["constructorId"],NaN),NaN);
  const fromRef=Number.isFinite(archive)?constructorNameByArchiveId.get(archive):"";
  return String(first(
    row,
    ["constructor_name","constructorName","constructor","team_name","team"],
    fromRef||""
  )||fromRef||"").trim();
}

function constructorIdentity(rawName){
  const name=canonicalTeamName(String(rawName||"").trim());
  const resolved=teamResolver.resolve({team_name:name});
  if(resolved.id)return {id:resolved.id,name:resolved.name||name};
  const key=normalizeTeamIdentityName(name);
  return {
    id:key?`legacy_constructor_${key}`:"",
    name:name||"Unknown constructor",
  };
}

const maxRoundByYear=new Map();
for(const row of raceRows){
  const year=num(first(row,["year","season_year","season"],NaN),NaN);
  const round=num(first(row,["round","race_round","round_number"],NaN),NaN);
  if(Number.isFinite(year)&&Number.isFinite(round)){
    maxRoundByYear.set(year,Math.max(maxRoundByYear.get(year)||0,round));
  }
}

const driverSeasons=new Map();
const constructorCandidates=new Map();

for(const row of Array.isArray(raceRows)?raceRows:[]){
  const year=num(first(row,["year","season_year","season"],NaN),NaN);
  const round=num(first(row,["round","race_round","round_number"],NaN),NaN);
  if(!Number.isInteger(year)||!Number.isFinite(round))continue;

  const driverId=resolveDriver(row);
  const sourcePoints=num(first(row,["points"],0),0);
  const position=num(first(row,["position","positionOrder","position_order","finish_position","pos"],NaN),NaN);
  const constructor=constructorIdentity(rawConstructorName(row));

  if(driverId){
    const key=`${year}|${driverId}`;
    const rec=driverSeasons.get(key)||{
      year,
      driver_id:driverId,
      driver_name:driverNameById.get(driverId)||String(first(row,["driver_name","driverName","name"],driverId)),
      events:new Map(),
      constructors:new Map(),
      wins:0,
      podiums:0,
    };
    rec.events.set(round,(rec.events.get(round)||0)+sourcePoints);
    if(constructor.id){
      const affiliation=rec.constructors.get(constructor.id)||{id:constructor.id,name:constructor.name,starts:0,raw_points:0};
      affiliation.starts+=1;
      affiliation.raw_points+=sourcePoints;
      rec.constructors.set(constructor.id,affiliation);
    }
    if(position===1&&sourcePoints>0)rec.wins+=1;
    if(position>=1&&position<=3&&sourcePoints>0)rec.podiums+=1;
    driverSeasons.set(key,rec);
  }

  const rule=championshipRuleForYear(year);
  if(!rule.constructorChampionship||!constructor.id)continue;

  let constructorPoints=0;
  if(year>=1979){
    // From 1979 onward all points actually awarded to the drivers count for
    // the constructor. This preserves half-points, double points and bonuses
    // already present in the historical race-result source.
    constructorPoints=sourcePoints;
  }else if(sourcePoints>0&&Number.isFinite(position)){
    // 1958-1978: only the best car of a constructor scores. Constructor points
    // exclude the 1958-59 fastest-lap bonus and use the separate 1961 win value.
    constructorPoints=pointsForPosition(rule.constructorRacePoints,position);
  }

  const raceKey=`${year}|${round}|${constructor.id}`;
  const raceRec=constructorCandidates.get(raceKey)||{
    year,round,constructor_id:constructor.id,constructor_name:constructor.name,values:[],
  };
  raceRec.values.push(constructorPoints);
  constructorCandidates.set(raceKey,raceRec);
}

const careerOverrides=new Map();
for(const row of Array.isArray(driverCareer)?driverCareer:[]){
  const year=num(first(row,["year","season_year"],NaN),NaN);
  if(year<2021)continue;
  const series=String(first(row,["series_division","series"],"F1")).toUpperCase();
  if(series&&series!=="F1")continue;
  const driverId=resolveDriver(row);
  const points=num(first(row,["points"],NaN),NaN);
  if(!driverId||!Number.isFinite(points))continue;
  const key=`${year}|${driverId}`;
  // Career imports can contain multiple team stints with the season total
  // repeated, so max is safer than sum for an official-total override.
  careerOverrides.set(key,Math.max(careerOverrides.get(key)??-Infinity,points));
}

const driverRows=[];
const sprintSupplementByConstructor=new Map();
for(const [key,rec] of driverSeasons){
  const rule=championshipRuleForYear(rec.year);
  const events=[...rec.events.entries()]
    .map(([round,points])=>({round:Number(round),points:Number(points)}))
    .sort((a,b)=>a.round-b.round);
  const rawPoints=Number(events.reduce((sum,event)=>sum+event.points,0).toFixed(3));
  let points=countChampionshipPoints(events,rule.driverCounting);
  let source="race_results_rules";
  const official=careerOverrides.get(key);
  if(rec.year>=2021&&Number.isFinite(official)&&Math.abs(official-points)>0.0001){
    const delta=Number((official-points).toFixed(3));
    points=official;
    source="race_results_rules+career_total_override";
    const preferred=[...rec.constructors.values()].sort((a,b)=>b.starts-a.starts||b.raw_points-a.raw_points)[0];
    if(preferred&&delta!==0){
      const ckey=`${rec.year}|${preferred.id}`;
      sprintSupplementByConstructor.set(ckey,(sprintSupplementByConstructor.get(ckey)||0)+delta);
    }
  }
  const preferred=[...rec.constructors.values()]
    .sort((a,b)=>b.starts-a.starts||b.raw_points-a.raw_points||String(a.name).localeCompare(String(b.name)))[0]||null;
  driverRows.push({
    year:rec.year,
    driver_id:rec.driver_id,
    driver_name:rec.driver_name,
    constructor_id:preferred?.id||null,
    constructor_name:preferred?.name||"—",
    points:Number(points.toFixed(3)),
    raw_points:rawPoints,
    discarded_points:Number((rawPoints-points).toFixed(3)),
    wins:rec.wins,
    podiums:rec.podiums,
    source,
  });
}

const constructorSeasons=new Map();
for(const raceRec of constructorCandidates.values()){
  const rule=championshipRuleForYear(raceRec.year);
  const points=rule.constructorCarsScoring==="best_one"
    ?Math.max(0,...raceRec.values)
    :raceRec.values.reduce((sum,value)=>sum+Number(value||0),0);
  const key=`${raceRec.year}|${raceRec.constructor_id}`;
  const rec=constructorSeasons.get(key)||{
    year:raceRec.year,
    constructor_id:raceRec.constructor_id,
    constructor_name:raceRec.constructor_name,
    events:[],
  };
  rec.events.push({round:raceRec.round,points:Number(points.toFixed(3))});
  constructorSeasons.set(key,rec);
}

const constructorRows=[];
for(const [key,rec] of constructorSeasons){
  const rule=championshipRuleForYear(rec.year);
  const events=rec.events.slice().sort((a,b)=>a.round-b.round);
  const rawPoints=Number(events.reduce((sum,event)=>sum+event.points,0).toFixed(3));
  let points=countChampionshipPoints(events,rule.constructorCounting);
  const supplement=sprintSupplementByConstructor.get(key)||0;
  if(rec.year>=2021&&supplement){
    points=Number((points+supplement).toFixed(3));
  }

  // Sporting sanctions that alter a season total rather than an individual
  // race result. Keep these explicit and narrow.
  const nameKey=canon(rec.constructor_name);
  let adjustment=0;
  let status="classified";
  if(rec.year===2020&&nameKey.includes("racingpoint"))adjustment=-15;
  if(rec.year===2007&&nameKey.includes("mclaren")){
    status="excluded";
  }
  if(status==="excluded")continue;
  points=Number((points+adjustment).toFixed(3));

  constructorRows.push({
    year:rec.year,
    constructor_id:rec.constructor_id,
    constructor_name:rec.constructor_name,
    points,
    raw_points:rawPoints,
    discarded_points:Number((rawPoints-countChampionshipPoints(events,rule.constructorCounting)).toFixed(3)),
    adjustment,
    source:supplement?"race_results_rules+sprint_supplement":"race_results_rules",
  });
}

function assignPositions(rows,keyName){
  const ordered=rows.slice().sort((a,b)=>
    Number(b.points)-Number(a.points)||
    Number(b.wins||0)-Number(a.wins||0)||
    String(a[keyName]||"").localeCompare(String(b[keyName]||""))
  );
  let lastPoints=null;
  let position=0;
  return ordered.map((row,index)=>{
    if(lastPoints===null||Number(row.points)!==Number(lastPoints))position=index+1;
    lastPoints=Number(row.points);
    return {...row,position};
  });
}

const years=[...new Set(driverRows.map((row)=>row.year))].sort((a,b)=>a-b);
const output={
  schema_version:1,
  source:"race_results + canonical championship rules",
  first_year:years[0]??null,
  last_year:years.at(-1)??null,
  drivers:years.flatMap((year)=>assignPositions(
    driverRows.filter((row)=>row.year===year),
    "driver_name"
  )),
  constructors:years.flatMap((year)=>assignPositions(
    constructorRows.filter((row)=>row.year===year),
    "constructor_name"
  )),
};

await fs.writeFile(target,JSON.stringify(output,null,2)+"\n","utf8");
console.log(
  `Generated historical_championships.json: ${output.drivers.length} driver-season + ${output.constructors.length} constructor-season rows (${output.first_year||"—"}-${output.last_year||"—"}).`
);
