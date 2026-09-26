import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { inferDriverWorldEntries } from "../src/domain/driverWorldEntry.js";
import {
  inferDriverFeederPlacements,
  buildDriverFeederPlacementAudit,
} from "../src/domain/driverFeederPlacement.js";

const root=process.cwd();
const dataDir=path.join(root,"public","data");

async function readJson(name,fallback=[]){
  try{return JSON.parse(await fs.readFile(path.join(dataDir,name),"utf8"));}
  catch{return fallback;}
}
const norm=(value)=>String(value||"")
  .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .toLowerCase().replace(/[^a-z0-9]+/g,"").trim();

async function load(){
  const [drivers,driverYearStatus,driverCareer,driverDevelopmentHistory,driverHistory]=await Promise.all([
    readJson("drivers.json",[]),
    readJson("driver_year_status.json",[]),
    readJson("driver_career.json",[]),
    readJson("driver_development_history.json",[]),
    readJson("driver_f1_history.json",[]),
  ]);
  const entries=inferDriverWorldEntries(drivers,{
    driverYearStatus,driverCareer,driverDevelopmentHistory,driverHistory,
  });
  return {drivers,entries};
}

test("1980 generic feeder placement covers canonical world-entry population",async()=>{
  const {drivers,entries}=await load();
  const placements=inferDriverFeederPlacements(drivers,entries,1980);
  const audit=buildDriverFeederPlacementAudit(placements);

  assert.equal(placements.length,drivers.length);
  assert.equal(audit.year,1980);
  assert.ok((audit.placement_counts.YOUTH||0)>0);
  assert.ok((audit.placement_counts.LOWER_SERIES||0)>0);
  assert.ok((audit.placement_counts.F1_READY||0)>0);
  assert.ok((audit.placement_counts.HISTORICAL_OPENING_STATE||0)>20);
});

test("1980 sentinels map to generic feeder buckets without replaying future F1 history",async()=>{
  const {drivers,entries}=await load();
  const placements=inferDriverFeederPlacements(drivers,entries,1980);
  const find=(name)=>placements.find(row=>norm(row.display_name)===norm(name));

  const senna=find("Ayrton Senna");
  assert.ok(senna);
  assert.equal(senna.placement,"YOUTH");
  assert.equal(senna.can_hire_academy,true);
  assert.equal(senna.can_hire_f1,false);
  assert.equal(senna.forced_future_f1_debut,false);

  const moreno=find("Roberto Moreno");
  assert.ok(moreno);
  assert.equal(moreno.placement,"LOWER_SERIES");

  for(const name of ["Michele Alboreto","Derek Warwick"]){
    const row=find(name);
    assert.ok(row,name+" should resolve");
    assert.equal(row.placement,"F1_READY");
    assert.equal(row.can_hire_f1,true);
  }

  for(const name of ["Michael Schumacher","Lewis Hamilton","Fernando Alonso"]){
    const row=find(name);
    assert.ok(row,name+" should resolve");
    assert.equal(row.placement,"NOT_IN_WORLD");
    assert.equal(row.scoutable,false);
  }
});
