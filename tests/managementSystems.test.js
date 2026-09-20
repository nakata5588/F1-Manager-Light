import test from "node:test";
import assert from "node:assert/strict";
import { syncGarageState } from "../src/domain/garage.js";
import { teamCarPerformance } from "../src/domain/carPerformance.js";
import {
  activeDriverContract,
  contractAcceptanceChance,
  expectedDriverSalary,
  raceSeatCount,
  terminationCost,
} from "../src/domain/driverContracts.js";
import { applyMarketTick } from "../src/engine/MarketEngine.js";
import { isDriverContract, isRaceDriverContract, isReserveDriverContract, isTestDriverContract } from "../src/domain/contractRoles.js";

function baseState(){
  return {
    activeYear:1980,
    currentDateISO:"1980-02-01",
    team:{team_id:"T1",team_name:"Player Team",budget:5_000_000},
    teams:[
      {team_id:"T1",team_name:"Player Team"},
      {team_id:"T2",team_name:"AI Team"},
    ],
    drivers:[
      {driver_id:"D1",display_name:"Player One",status:"eligible"},
      {driver_id:"D2",display_name:"Player Two",status:"eligible"},
      {driver_id:"D3",display_name:"Free Star",status:"eligible"},
      {driver_id:"D4",display_name:"AI One",status:"eligible"},
    ],
    driverRatings:[
      {driver_id:"D1",current_ability:70,pace:75,reputation:65,market_value:1_000_000},
      {driver_id:"D2",current_ability:68,pace:72,reputation:60,market_value:800_000},
      {driver_id:"D3",current_ability:76,pace:80,reputation:70,market_value:1_500_000},
      {driver_id:"D4",current_ability:65,pace:68,reputation:55,market_value:600_000},
    ],
    contracts:[
      {year:1980,team_id:"T1",driver_id:"D1",role:"Main Driver",salary:500_000},
      {year:1980,team_id:"T1",driver_id:"D2",role:"Second Driver",salary:450_000},
      {year:1980,team_id:"T2",driver_id:"D4",role:"Main Driver",salary:300_000},
    ],
    carStats:[
      {year:1980,team_id:"T1",chassis_spec:70,aero_spec:70,gearbox_spec:70,suspension_spec:70,brakes_spec:70,cooling_spec:70,reliability:80},
      {year:1980,team_id:"T2",chassis_spec:68,aero_spec:68,gearbox_spec:68,suspension_spec:68,brakes_spec:68,cooling_spec:68,reliability:78},
    ],
    teamEngines:[
      {year:1980,team_id:"T1",power:75,reliability:82},
      {year:1980,team_id:"T2",power:72,reliability:80},
    ],
    development:{
      parts:[
        {id:"P1",name:"New Front Wing",slot:"aero_front",perf:3,condition:100,inv:1},
      ],
    },
    inbox:[],
  };
}

test("garage creates two race cars plus reserve/spare from contracts",()=>{
  const gs=baseState();
  const garage=syncGarageState(gs,{});
  assert.equal(garage.cars.length,3);
  assert.equal(garage.cars[0].driver_id,"D1");
  assert.equal(garage.cars[1].driver_id,"D2");
  assert.equal(garage.cars[2].kind,"reserve");
});

test("installed developed part improves the specific fitted car",()=>{
  const gs=baseState();
  const garage=syncGarageState(gs,{});
  const before=teamCarPerformance({...gs,garage},"T1","D1");
  garage.cars[0].installedParts={aero_front:"P1"};
  const after=teamCarPerformance({...gs,garage},"T1","D1");
  assert.ok(after.qualifying>before.qualifying);
  assert.ok(after.race>before.race);
  assert.ok(after.overall>before.overall);
});

test("better salary offers increase driver acceptance probability",()=>{
  const gs=baseState();
  const expected=expectedDriverSalary(gs,"D3");
  const low=contractAcceptanceChance(gs,"D3",{salary:expected*0.6,years:1,role:"Second Driver"});
  const high=contractAcceptanceChance(gs,"D3",{salary:expected*1.2,years:3,role:"Main Driver"});
  assert.ok(high>low);
  assert.ok(terminationCost(gs,gs.contracts[0])>0);
});

test("driver contract helpers tolerate legacy map-shaped save collections",()=>{
  const gs=baseState();
  gs.contracts=Object.fromEntries(gs.contracts.map((row)=>[row.driver_id,row]));
  gs.driverRatings=Object.fromEntries(gs.driverRatings.map((row)=>[row.driver_id,row]));

  assert.doesNotThrow(()=>expectedDriverSalary(gs,"D1"));
  assert.equal(activeDriverContract(gs,"D1")?.team_id,"T1");
  assert.equal(raceSeatCount(gs,"T1"),2);
  assert.ok(expectedDriverSalary(gs,"D1")>=500_000);
});

test("driver contract helpers fall back to hydrated db collections",()=>{
  const gs=baseState();
  gs.dbContracts=gs.contracts;
  gs.dbDriverRatings=gs.driverRatings;
  gs.contracts=null;
  gs.driverRatings=null;

  assert.equal(activeDriverContract(gs,"D2")?.team_id,"T1");
  assert.equal(raceSeatCount(gs,"T1"),2);
  assert.ok(expectedDriverSalary(gs,"D2")>=450_000);
});

test("AI market fills a vacant race seat with an available driver",()=>{
  const gs=baseState();
  const next=applyMarketTick(gs);
  const aiContracts=(next.contracts||[]).filter((c)=>String(c.team_id)==="T2" && !/reserve|test/i.test(String(c.role||"")));
  assert.equal(aiContracts.length,2);
  assert.ok(aiContracts.some((c)=>String(c.driver_id)==="D3"));
  assert.equal(next._lastAIDriverMarketMonth,"1980-02");
});


test("test and reserve contracts do not occupy race seats",()=>{
  const gs=baseState();
  gs.contracts=[
    {year:1980,team_id:"T2",driver_id:"D4",role:"main_driver"},
    {year:1980,team_id:"T2",driver_id:"D3",role:"test_driver"},
  ];
  assert.equal(isDriverContract(gs.contracts[1]),true);
  assert.equal(isTestDriverContract(gs.contracts[1]),true);
  assert.equal(isReserveDriverContract(gs.contracts[1]),false);
  assert.equal(isRaceDriverContract(gs.contracts[1]),false);
  assert.equal(raceSeatCount(gs,"T2"),1);
});

test("AI market fills a second race seat even when a test driver is contracted",()=>{
  const gs=baseState();
  gs.drivers.push({driver_id:"D5",display_name:"Test Driver",status:"eligible"});
  gs.driverRatings.push({driver_id:"D5",current_ability:55,pace:58,reputation:45,market_value:250_000});
  gs.contracts.push({year:1980,team_id:"T2",driver_id:"D5",role:"test_driver",salary:100_000});
  const next=applyMarketTick(gs);
  const raceContracts=(next.contracts||[]).filter((c)=>String(c.team_id)==="T2" && isRaceDriverContract(c));
  assert.equal(raceContracts.length,2);
  assert.ok(raceContracts.some((c)=>String(c.driver_id)==="D3"));
});


test("garage assigns the spare car to reserve driver, never test driver",()=>{
  const gs=baseState();
  gs.drivers.push(
    {driver_id:"D5",display_name:"Reserve Driver",status:"eligible"},
    {driver_id:"D6",display_name:"Test Driver",status:"eligible"}
  );
  gs.contracts.push(
    {year:1980,team_id:"T1",driver_id:"D5",role:"reserve_driver"},
    {year:1980,team_id:"T1",driver_id:"D6",role:"test_driver"}
  );
  const garage=syncGarageState(gs,{});
  assert.equal(garage.cars[2].driver_id,"D5");
});
