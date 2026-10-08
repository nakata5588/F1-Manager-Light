import test from "node:test";
import assert from "node:assert/strict";
import { materializeHistoricalCarBaselines } from "../src/domain/historicalCarResultBaseline.js";

const rows=[];
for(let round=1;round<=12;round++){
  for(const [team_id,driver_id,position,grid,status] of [
    ["ferrari","schumacher",1,1,"Finished"],
    ["ferrari","barrichello",3,3,"Finished"],
    ["minardi","gene",18,21,"Finished"],
    ["minardi","mazzacane",19,22,"Engine"],
  ]){
    rows.push({year:2000,round,team_id,driver_id,position,positionOrder:position,grid,status,points:position===1?10:position===3?4:0});
  }
}
test("2000 baseline aggregates both drivers and ranks consistent front runner above backmarker",()=>{
  const out=materializeHistoricalCarBaselines(rows,2000);
  assert.equal(out.length,2);
  assert.equal(out[0].team_id,"ferrari");
  assert.ok(out[0].race>out[1].race);
  assert.ok(out[0].qualifying>out[1].qualifying);
  assert.ok(out[0].reliability>out[1].reliability);
  assert.equal(out[0].evidence_driver_count,2);
  assert.equal(out[0].evidence_result_count,24);
});
test("result estimator does not use another season or unresolved entrant",()=>{
  const out=materializeHistoricalCarBaselines([...rows,{year:2001,round:1,team_id:"ferrari",driver_id:"other",position:1}],2000);
  assert.equal(out[0].evidence_result_count,24);
  assert.equal(materializeHistoricalCarBaselines([{year:2000,round:1,constructorId:6,driver_id:"a"}],2000).length,0);
});
test("accident is not counted as mechanical failure",()=>{
  const a=materializeHistoricalCarBaselines([{year:2000,round:1,team_id:"t",driver_id:"a",position:20,status:"Collision"}],2000)[0];
  const b=materializeHistoricalCarBaselines([{year:2000,round:1,team_id:"t",driver_id:"a",position:20,status:"Engine"}],2000)[0];
  assert.ok(a.reliability>b.reliability);
});
