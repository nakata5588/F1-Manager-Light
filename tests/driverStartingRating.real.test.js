import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  buildStartingRatingCalibration,
  materializeDriverStartingRating,
} from "../src/domain/driverStartingRating.js";

const root=process.cwd();
const dataDir=path.join(root,"public","data");

async function readJson(name,fallback=[]){
  try{return JSON.parse(await fs.readFile(path.join(dataDir,name),"utf8"));}
  catch{return fallback;}
}
function median(values){
  const source=[...values].filter(Number.isFinite).sort((a,b)=>a-b);
  return source.length?source[Math.floor(source.length/2)]:null;
}
function percentile(values,p){
  const source=[...values].filter(Number.isFinite).sort((a,b)=>a-b);
  if(!source.length)return null;
  return source[Math.min(source.length-1,Math.floor(source.length*p))];
}

test("R1D generic calibration reproduces R2 current-ability scale without per-driver future replay",async()=>{
  const [drivers,profiles,snapshots]=await Promise.all([
    readJson("drivers.json",[]),
    readJson("driver_rating_profiles.json",[]),
    readJson("historical_rating_snapshots.json",[]),
  ]);
  assert.ok(drivers.length>500);
  assert.ok(profiles.length>500);
  assert.ok(snapshots.length>300);

  const driverById=new Map(drivers.map((row)=>[String(row.driver_id),row]));
  const profileById=new Map(profiles.map((row)=>[String(row.driver_id),row]));
  const calibration=buildStartingRatingCalibration(snapshots);

  const errors=[];
  const juniorErrors=[];
  for(const snapshot of snapshots){
    const id=String(snapshot.driver_id||"");
    const driver=driverById.get(id);
    const profile=profileById.get(id);
    if(!driver||!profile)continue;
    const target=materializeDriverStartingRating({
      driver,
      profile,
      year:Number(snapshot.year),
      placement:{driver_id:id,age:Number(snapshot.age_start)},
      calibration,
      stageOverride:String(snapshot.career_stage||"Developing"),
    });
    const actual=Number(snapshot.current_ability);
    if(!target||!Number.isFinite(actual))continue;
    const error=Math.abs(Number(target.current_ability)-actual);
    errors.push(error);
    if(String(snapshot.career_stage)==="Junior / Prospect")juniorErrors.push(error);
  }

  const med=median(errors);
  const p90=percentile(errors,0.90);
  const juniorMed=median(juniorErrors);
  assert.ok(errors.length>300);
  assert.ok(med<=3,"median Current Ability error "+med);
  assert.ok(p90<=9,"p90 Current Ability error "+p90);
  assert.ok(juniorMed<=2.5,"junior median Current Ability error "+juniorMed);
});

test("1980 Senna materializes from Talent Profile as a high-upside youth with real attributes",async()=>{
  const [drivers,profiles,snapshots]=await Promise.all([
    readJson("drivers.json",[]),
    readJson("driver_rating_profiles.json",[]),
    readJson("historical_rating_snapshots.json",[]),
  ]);
  const driver=drivers.find((row)=>String(row.driver_id)==="d_0102");
  const profile=profiles.find((row)=>String(row.driver_id)==="d_0102");
  assert.ok(driver);
  assert.ok(profile);

  const rating=materializeDriverStartingRating({
    driver,
    profile,
    year:1980,
    placement:{
      driver_id:"d_0102",
      placement:"YOUTH",
      age:19,
      active_pre_f1_world:true,
    },
    calibration:buildStartingRatingCalibration(snapshots),
  });

  assert.equal(rating.career_stage,"Junior / Prospect");
  assert.equal(rating.potential_ability,99);
  assert.ok(rating.current_ability>=60&&rating.current_ability<=64,rating.current_ability);
  assert.ok(rating.pace>=68&&rating.pace<=71,rating.pace);
  assert.ok(rating.racecraft>=53&&rating.racecraft<=57,rating.racecraft);
  assert.ok(rating.consistency>=53&&rating.consistency<=57,rating.consistency);
  assert.ok(rating.mentality>=63&&rating.mentality<=66,rating.mentality);
  assert.ok(rating.current_ability<rating.potential_ability);
  assert.equal(rating.source,"talent_profile_starting_materializer");
  assert.equal(Object.hasOwn(rating,"team_id"),false);
  assert.equal(Object.hasOwn(rating,"f1_rookie_season"),false);
});
