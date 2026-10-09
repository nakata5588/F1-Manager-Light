import test from "node:test";
import assert from "node:assert/strict";
import {
  historicalScalar,historicalFirst,historicalNameKey,historicalResultYear,
  createHistoricalDriverResolver,
} from "../scripts/lib/historical-results-normalizer.mjs";

test("wrapped 2000 Results year and season_year use identical normalization",()=>{
  assert.equal(historicalResultYear({year:{result:{value:2000}}}),2000);
  assert.equal(historicalResultYear({year:null,season_year:{text:"2000"}}),2000);
  assert.ok(Number.isNaN(historicalResultYear({year:""})));
  assert.equal(historicalFirst({year:{result:"",value:2000}},["year"]),2000);
  assert.equal(historicalScalar({text:{value:"2000"}}),"2000");
});
test("historic driver ID, archival ID and names share one resolver",()=>{
  const drivers=[{driver_id:"d_0001",driverID_arch:{value:7},display_name:"José Álvarez"}];
  const resolve=createHistoricalDriverResolver(drivers);
  assert.equal(resolve({driver_id:{result:"d_0001"}}),"d_0001");
  assert.equal(resolve({driverId:{text:7}}),"d_0001");
  assert.equal(resolve({driver_name:"JOSE ALVAREZ"}),"d_0001");
  assert.equal(historicalNameKey("José Álvarez"),"josealvarez");
  assert.equal(resolve({driver_id:"d_nonexistent"}),"");
  assert.equal(resolve({driver_id:"d_nonexistent"},{allowUnknownDirect:true}),"d_nonexistent");
});
test("unknown archive IDs cannot silently match an unrelated driver",()=>{
  const resolve=createHistoricalDriverResolver([{driver_id:"d_0002",driverID_arch:0,display_name:"Driver Two"}]);
  assert.equal(resolve({driverId:null}),"");
  assert.equal(resolve({driverId:"",driver_name:"Unmapped Driver"}),"");
});
