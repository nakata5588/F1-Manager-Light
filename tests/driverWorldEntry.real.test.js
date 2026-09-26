import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  inferDriverWorldEntries,
  driverWorldStageAtYear,
  buildDriverWorldEntryAudit,
} from "../src/domain/driverWorldEntry.js";

const root=process.cwd();
const dataDir=path.join(root,"public","data");

async function readJson(name,fallback=[]){
  try{return JSON.parse(await fs.readFile(path.join(dataDir,name),"utf8"));}
  catch{return fallback;}
}

const norm=(value)=>String(value||"")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g,"")
  .trim();

test("real canonical population produces deterministic world-entry candidates",async()=>{
  const [drivers,driverYearStatus,driverCareer,driverDevelopmentHistory]=await Promise.all([
    readJson("drivers.json",[]),
    readJson("driver_year_status.json",[]),
    readJson("driver_career.json",[]),
    readJson("driver_development_history.json",[]),
  ]);

  assert.ok(drivers.length>500);
  const context={driverYearStatus,driverCareer,driverDevelopmentHistory};
  const a=inferDriverWorldEntries(drivers,context);
  const b=inferDriverWorldEntries(drivers,context);

  assert.deepEqual(a,b);
  assert.equal(a.length,drivers.length);
  assert.equal(new Set(a.map(row=>row.driver_id)).size,a.length);

  const audit=buildDriverWorldEntryAudit(a,drivers,{auditYears:[1980]});
  assert.equal(audit.total_drivers,drivers.length);
  assert.ok(audit.resolved>500);
  assert.ok(audit.year_snapshots["1980"].active_world>0);
});

test("1980 world-entry audit includes Senna pre-F1 but excludes much later generations",async()=>{
  const [drivers,driverYearStatus,driverCareer,driverDevelopmentHistory]=await Promise.all([
    readJson("drivers.json",[]),
    readJson("driver_year_status.json",[]),
    readJson("driver_career.json",[]),
    readJson("driver_development_history.json",[]),
  ]);
  const context={driverYearStatus,driverCareer,driverDevelopmentHistory};
  const entries=inferDriverWorldEntries(drivers,context);

  const findDriver=(name)=>drivers.find(row=>norm(row.display_name)===norm(name));
  const findEntry=(name)=>entries.find(row=>norm(row.display_name)===norm(name));

  const senna=findDriver("Ayrton Senna");
  const sennaEntry=findEntry("Ayrton Senna");
  assert.ok(senna);
  assert.ok(sennaEntry);
  assert.ok(sennaEntry.first_world_year<=1980);
  assert.ok(sennaEntry.reference_f1_debut_year===1984);

  const senna1980=driverWorldStageAtYear(senna,sennaEntry,1980);
  assert.equal(senna1980.active_world,true);
  assert.notEqual(senna1980.stage,"F1_REFERENCE_WINDOW");
  assert.ok(["YOUTH","LOWER_SERIES"].includes(senna1980.stage));

  for(const name of ["Michael Schumacher","Lewis Hamilton","Fernando Alonso"]){
    const driver=findDriver(name);
    const entry=findEntry(name);
    assert.ok(driver,name+" should exist in canonical drivers");
    assert.ok(entry,name+" should have a world-entry candidate");
    const state=driverWorldStageAtYear(driver,entry,1980);
    assert.equal(state.active_world,false,name+" should not exist in the 1980 active world");
  }
});

test("1980 known F1 drivers remain in the historical F1 reference window",async()=>{
  const [drivers,driverYearStatus,driverCareer,driverDevelopmentHistory]=await Promise.all([
    readJson("drivers.json",[]),
    readJson("driver_year_status.json",[]),
    readJson("driver_career.json",[]),
    readJson("driver_development_history.json",[]),
  ]);
  const context={driverYearStatus,driverCareer,driverDevelopmentHistory};
  const entries=inferDriverWorldEntries(drivers,context);

  for(const name of ["Alain Prost","Nelson Piquet"]){
    const driver=drivers.find(row=>norm(row.display_name)===norm(name));
    const entry=entries.find(row=>norm(row.display_name)===norm(name));
    assert.ok(driver&&entry,name+" should resolve");
    const state=driverWorldStageAtYear(driver,entry,1980);
    assert.equal(state.active_world,true);
    assert.equal(state.stage,"F1_REFERENCE_WINDOW");
  }
});
