import fs from "node:fs/promises";
import path from "node:path";
import { isRaceDriverContract } from "../src/domain/contractRoles.js";

const root=process.cwd();
const dataDir=path.join(root,"public","data");
const seasonsDir=path.join(dataDir,"seasons");

async function readJson(file,fallback=null){
  try{return JSON.parse(await fs.readFile(file,"utf8"));}
  catch{return fallback;}
}
const num=(value,fallback=NaN)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const idOf=(row)=>String(row?.driver_id??row?.person_id??row?.id??"");
const median=(values)=>{
  const source=values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  return source.length?source[Math.floor(source.length/2)]:null;
};
const percentile=(values,p)=>{
  const source=values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!source.length)return null;
  return source[Math.min(source.length-1,Math.max(0,Math.floor((source.length-1)*p)))];
};

const index=await readJson(path.join(seasonsDir,"index.json"),{years:[]});
const championships=await readJson(path.join(dataDir,"historical_championships.json"),{drivers:[]});
const champRows=Array.isArray(championships?.drivers)?championships.drivers:[];

const champByDriver=new Map();
for(const row of champRows){
  const id=idOf(row);
  if(!id)continue;
  if(!champByDriver.has(id))champByDriver.set(id,[]);
  champByDriver.get(id).push(row);
}
for(const rows of champByDriver.values())rows.sort((a,b)=>num(a.year)-num(b.year));

const observations=[];
for(const item of index.years||[]){
  const year=num(item?.year,NaN);
  if(!Number.isInteger(year)||year<1950||year>2024)continue;
  const pack=await readJson(path.join(seasonsDir,String(year),"season.json"),null);
  if(!pack?.state)continue;
  const ratings=new Map((pack.state.driverRatings||[]).map((row)=>[idOf(row),row]).filter(([id])=>id));
  const drivers=new Map((pack.state.drivers||[]).map((row)=>[idOf(row),row]).filter(([id])=>id));
  const raceContracts=(pack.state.contracts||[]).filter(isRaceDriverContract);

  for(const contract of raceContracts){
    const id=idOf(contract);
    const rating=ratings.get(id)||{};
    const driver=drivers.get(id)||{};
    const current=num(rating.current_ability??rating.overall,NaN);
    const potential=num(rating.potential_ability??rating.potential,NaN);
    if(!Number.isFinite(current))continue;
    const prior=(champByDriver.get(id)||[]).filter((row)=>num(row.year)<year);
    const prev=prior.find((row)=>num(row.year)===year-1)||null;
    const titles=prior.filter((row)=>num(row.position)===1).length;
    const best=prior.length?Math.min(...prior.map((row)=>num(row.position,999))):null;
    const totalWins=prior.reduce((sum,row)=>sum+Math.max(0,num(row.wins,0)),0);
    const totalPodiums=prior.reduce((sum,row)=>sum+Math.max(0,num(row.podiums,0)),0);
    const lastTitleYear=titles
      ?Math.max(...prior.filter((row)=>num(row.position)===1).map((row)=>num(row.year)))
      :null;

    observations.push({
      year,
      driver_id:id,
      name:String(driver.display_name??driver.driver_name??rating.driver_name??id),
      age:num(driver.age,NaN),
      team_id:String(contract.team_id||""),
      role:String(contract.role||""),
      source:String(rating.source||""),
      current,
      potential:Number.isFinite(potential)?potential:null,
      stage:String(rating.career_stage||""),
      titles,
      best,
      totalWins,
      totalPodiums,
      previousPosition:prev?num(prev.position,NaN):null,
      previousWins:prev?num(prev.wins,0):0,
      previousPodiums:prev?num(prev.podiums,0):0,
      lastTitleYear,
    });
  }
}

const decadeGroups=new Map();
for(const row of observations){
  const decade=Math.floor(row.year/10)*10;
  if(!decadeGroups.has(decade))decadeGroups.set(decade,[]);
  decadeGroups.get(decade).push(row.current);
}

console.log("\nD7.R4 — All-Eras Historical Rating Audit");
console.log(`Race-seat observations: ${observations.length}`);
console.log("Decade  Rows  P10   Median  P90   Min   Max");
for(const [decade,values] of [...decadeGroups.entries()].sort((a,b)=>a[0]-b[0])){
  const min=Math.min(...values),max=Math.max(...values);
  console.log(
    `${String(decade)+"s"}  ${String(values.length).padStart(4)}  ${String(percentile(values,.10)?.toFixed(1)).padStart(4)}  ${String(median(values)?.toFixed(1)).padStart(6)}  ${String(percentile(values,.90)?.toFixed(1)).padStart(4)}  ${String(min.toFixed(1)).padStart(4)}  ${String(max.toFixed(1)).padStart(4)}`
  );
}

const invalidPotential=observations.filter((row)=>Number.isFinite(row.potential)&&row.potential+1e-9<row.current);
const previousChampions=observations.filter((row)=>row.previousPosition===1);
const previousTop3=observations.filter((row)=>Number.isFinite(row.previousPosition)&&row.previousPosition<=3);
const titleHolders=observations.filter((row)=>row.titles>0);
const implausiblyLowPreviousChampion=previousChampions.filter((row)=>row.current<84);
const implausiblyLowRecentTop3=previousTop3.filter((row)=>row.current<78);

const byDriver=new Map();
for(const row of observations){
  if(!byDriver.has(row.driver_id))byDriver.set(row.driver_id,[]);
  byDriver.get(row.driver_id).push(row);
}
const jumps=[];
for(const rows of byDriver.values()){
  rows.sort((a,b)=>a.year-b.year);
  for(let i=1;i<rows.length;i++){
    const prev=rows[i-1],cur=rows[i];
    if(cur.year!==prev.year+1)continue;
    const delta=Number((cur.current-prev.current).toFixed(1));
    if(Math.abs(delta)>=18)jumps.push({driver_id:cur.driver_id,name:cur.name,from:prev.year,to:cur.year,from_ovr:prev.current,to_ovr:cur.current,delta});
  }
}

const weakest=(rows,count=15)=>rows.slice().sort((a,b)=>a.current-b.current||a.year-b.year).slice(0,count);
console.log("\nLowest OVR among drivers entering a season as reigning champion");
console.table(weakest(previousChampions).map((row)=>({
  YEAR:row.year,DRIVER:row.name,OVR:row.current,POT:row.potential,AGE:row.age,PREV_POS:row.previousPosition,SOURCE:row.source,
})));

console.log("\nLowest OVR among prior World Champions still on the grid");
console.table(weakest(titleHolders).map((row)=>({
  YEAR:row.year,DRIVER:row.name,OVR:row.current,POT:row.potential,AGE:row.age,TITLES:row.titles,LAST_TITLE:row.lastTitleYear,SOURCE:row.source,
})));

console.log("\nDiagnostics");
console.log(JSON.stringify({
  observations:observations.length,
  potential_below_current:invalidPotential.length,
  reigning_champion_below_84:implausiblyLowPreviousChampion.length,
  previous_top3_below_78:implausiblyLowRecentTop3.length,
  year_to_year_jumps_ge_18:jumps.length,
},null,2));

if(invalidPotential.length){
  console.error("Potential < Current Ability examples:",invalidPotential.slice(0,20));
  process.exitCode=1;
}
if(implausiblyLowPreviousChampion.length){
  console.error("Reigning champion OVR quality-gate failures:",implausiblyLowPreviousChampion.slice(0,20));
  process.exitCode=1;
}
