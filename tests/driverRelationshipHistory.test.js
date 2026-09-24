import test from "node:test";
import assert from "node:assert/strict";
import {
  formatRelationshipYears,
  historicalDriverRelationshipRecords,
} from "../src/domain/driverRelationshipHistory.js";

function fixture(){
  return {
    activeYear:1980,
    dbTeams:[
      {team_id:"T1",team_name:"Ferrari"},
      {team_id:"T2",team_name:"McLaren"},
    ],
    dbDrivers:[
      {driver_id:"D1",display_name:"Gilles Villeneuve"},
      {driver_id:"D2",display_name:"Jody Scheckter"},
      {driver_id:"D3",display_name:"Future Driver"},
      {driver_id:"D4",display_name:"Reserve Only"},
    ],
    dbDriverCareer:[
      {year:1977,series_division:"F1",team_id:"T2",team_name:"McLaren",driver_id:"D1",driver_name:"Gilles Villeneuve",races:1},
      {year:1978,series_division:"F1",team_id:"T1",team_name:"Ferrari",driver_id:"D1",driver_name:"Gilles Villeneuve",races:16},
      {year:1979,series_division:"F1",team_id:"T1",team_name:"Ferrari",driver_id:"D1",driver_name:"Gilles Villeneuve",races:15},
      {year:1979,series_division:"F1",team_id:"T1",team_name:"Ferrari",driver_id:"D2",driver_name:"Jody Scheckter",races:15},
      {year:1978,series_division:"F1",team_id:"T1",team_name:"Ferrari",driver_id:"D4",driver_name:"Reserve Only",races:0},
      {year:1981,series_division:"F1",team_id:"T1",team_name:"Ferrari",driver_id:"D3",driver_name:"Future Driver",races:12},
    ],
  };
}

test("historical relationships derive completed teams and raced team-mates only",()=>{
  const records=historicalDriverRelationshipRecords(fixture(),{
    driverId:"D1",
    driverName:"Gilles Villeneuve",
  });

  const ferrari=records.find((row)=>row.target_type==="team"&&row.target_id==="T1");
  const mclaren=records.find((row)=>row.target_type==="team"&&row.target_id==="T2");
  const jody=records.find((row)=>row.target_type==="teammate"&&row.target_id==="D2");

  assert.deepEqual(ferrari.years,[1978,1979]);
  assert.deepEqual(mclaren.years,[1977]);
  assert.deepEqual(jody.years,[1979]);
  assert.equal(jody.active,false);
  assert.equal(jody.historical,true);
  assert.equal(records.some((row)=>row.target_id==="D3"),false,"future seasons must never leak");
  assert.equal(records.some((row)=>row.target_id==="D4"),false,"zero-start historical rows are not race team-mates");
});

test("historical relationship year labels collapse contiguous seasons",()=>{
  assert.equal(formatRelationshipYears([1977]),"1977");
  assert.equal(formatRelationshipYears([1977,1978,1979]),"1977–1979");
  assert.equal(formatRelationshipYears([1977,1979]),"1977, 1979");
});
