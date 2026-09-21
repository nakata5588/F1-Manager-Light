import test from "node:test";
import assert from "node:assert/strict";
import { syncGarageState } from "../src/domain/garage.js";
import { teamCarPerformance } from "../src/domain/carPerformance.js";
import {
  activeDriverContract,
  contractAcceptanceChance,
  currentDriverTeamId,
  expectedDriverSalary,
  freeAgentDrivers,
  raceSeatCount,
  terminationCost,
} from "../src/domain/driverContracts.js";
import { applyMarketTick } from "../src/engine/MarketEngine.js";
import { processDriverNegotiations } from "../src/engine/NegotiationEngine.js";
import { isDriverContract, isRaceDriverContract, isReserveDriverContract, isTestDriverContract } from "../src/domain/contractRoles.js";
import { buildSeasonResultStats } from "../src/domain/seasonStats.js";
import { applyProgressionTick } from "../src/engine/ProgressionEngine.js";
import { applyEconomyTick } from "../src/engine/EconomyEngine.js";

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

test("AI market opens a negotiation before filling a vacant race seat",()=>{
  const gs=baseState();
  const pending=applyMarketTick(gs);
  const before=(pending.contracts||[]).filter((c)=>String(c.team_id)==="T2" && isRaceDriverContract(c));
  assert.equal(before.length,1);
  const negotiation=(pending.driverNegotiations||[]).find((n)=>
    n.origin==="ai" &&
    String(n.team_id)==="T2" &&
    String(n.driver_id)==="D3" &&
    n.offer?.role==="Second Driver"
  );
  assert.ok(negotiation);
  assert.equal(negotiation.status,"submitted");
  assert.equal(pending._lastAIDriverMarketMonth,"1980-02");

  const due={...pending,currentDateISO:negotiation.response_date};
  const resolved=processDriverNegotiations(due,{forceOutcomeById:{[negotiation.id]:"accepted"}});
  const after=(resolved.contracts||[]).filter((c)=>String(c.team_id)==="T2" && isRaceDriverContract(c));
  assert.equal(after.length,2);
  assert.ok(after.some((c)=>String(c.driver_id)==="D3"));
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

test("AI negotiates a second race seat even when a test driver is contracted",()=>{
  const gs=baseState();
  gs.drivers.push({driver_id:"D5",display_name:"Test Driver",status:"eligible"});
  gs.driverRatings.push({driver_id:"D5",current_ability:55,pace:58,reputation:45,market_value:250_000});
  gs.contracts.push({year:1980,team_id:"T2",driver_id:"D5",role:"test_driver",salary:100_000});
  const pending=applyMarketTick(gs);
  const raceBefore=(pending.contracts||[]).filter((c)=>String(c.team_id)==="T2" && isRaceDriverContract(c));
  assert.equal(raceBefore.length,1);
  const negotiation=(pending.driverNegotiations||[]).find((n)=>
    n.origin==="ai" &&
    String(n.team_id)==="T2" &&
    String(n.driver_id)==="D3" &&
    n.offer?.role==="Second Driver"
  );
  assert.ok(negotiation);

  const due={...pending,currentDateISO:negotiation.response_date};
  const resolved=processDriverNegotiations(due,{forceOutcomeById:{[negotiation.id]:"accepted"}});
  const raceAfter=(resolved.contracts||[]).filter((c)=>String(c.team_id)==="T2" && isRaceDriverContract(c));
  assert.equal(raceAfter.length,2);
  assert.ok(raceAfter.some((c)=>String(c.driver_id)==="D3"));
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


test("activeDriverContract ignores historical/expired rows and returns the current deal",()=>{
  const gs=baseState();
  gs.contracts=[
    {year:1979,team_id:"OLD",driver_id:"D1",role:"Main Driver",contract_start_year:1978,contract_until_year:1979,status:"expired"},
    {year:1980,team_id:"T1",driver_id:"D1",role:"Main Driver",salary:700_000,contract_start_year:1979,contract_until_year:1980,status:"active"},
  ];
  const contract=activeDriverContract(gs,"D1");
  assert.ok(contract);
  assert.equal(contract.team_id,"T1");
  assert.equal(contract.contract_start_year,1979);
  assert.equal(contract.contract_until_year,1980);
});


test("live empty contract collection never resurrects historical db contracts",()=>{
  const gs=baseState();
  gs.dbContracts=[...gs.contracts];
  gs.contracts=[];

  assert.equal(activeDriverContract(gs,"D1"),null);
  assert.equal(currentDriverTeamId(gs,"D1"),"");
  assert.equal(raceSeatCount(gs,"T1"),0);
  assert.ok(freeAgentDrivers(gs).some((driver)=>driver.driver_id==="D1"));
});

test("released driver disappears from garage and current team assignment immediately",()=>{
  const gs=baseState();
  gs.contracts=gs.contracts.map((row)=>
    row.driver_id==="D1"?{...row,status:"released",released_at:"1980-02-01"}:row
  );

  const garage=syncGarageState(gs,{});
  assert.equal(currentDriverTeamId(gs,"D1"),"");
  assert.equal(garage.cars.some((car)=>car.driver_id==="D1"),false);
  assert.equal(garage.cars[0].driver_id,"D2");
});

test("standings counting stats are isolated to the active season",()=>{
  const results=[
    {
      key:"1980:1",year:1980,round:1,
      classification:[
        {driver_id:"D1",team_id:"T1",position:1,points:9,fastest_lap:true},
        {driver_id:"D2",team_id:"T1",position:2,points:6},
      ],
    },
    {
      key:"1981:1",year:1981,round:1,
      classification:[
        {driver_id:"D1",team_id:"T1",position:2,points:6,fastest_lap:true},
        {driver_id:"D3",team_id:"T2",position:1,points:9},
      ],
    },
  ];

  const stats=buildSeasonResultStats(results,1981);
  assert.deepEqual(stats.drivers.get("D1"),{races:1,wins:0,podiums:1,fastestLaps:1});
  assert.deepEqual(stats.drivers.get("D3"),{races:1,wins:1,podiums:1,fastestLaps:0});
  assert.equal(stats.teams.get("T1").races.size,1);
  assert.equal(stats.teams.get("T1").wins,0);
  assert.equal(stats.teams.get("T2").wins,1);
});

test("released drivers no longer receive AI-team training through their former team",()=>{
  const gs=baseState();
  gs.currentDateISO="1980-03-01";
  gs.driverAttributes={};
  gs.contracts=gs.contracts.map((row)=>
    row.driver_id==="D4"?{...row,status:"released",released_at:"1980-02-28"}:row
  );

  const next=applyProgressionTick(gs);
  const changes=Object.values(next.driverAttrLog||{}).flat();
  const d4Changes=changes.filter((row)=>String(row.driverId)==="D4");
  assert.ok(d4Changes.length>0);
  assert.equal(d4Changes.some((row)=>row.source==="ai_training"),false);
});

test("monthly payroll uses live contracts and never revives released historical rows",()=>{
  const gs=baseState();
  gs.currentDateISO="1980-03-01";
  gs.calendar=[];
  gs.standings={drivers:[],teams:[]};
  gs.financeLog=[];
  gs.financeFlags={};
  gs.finances={budget:5_000_000,balance:5_000_000,season_spend:0,season_income:0};

  gs.dbContracts=[
    {year:1980,team_id:"T1",driver_id:"D1",driver_name:"Historical Ghost",role:"Main Driver",salary:12_000_000,status:"active"},
  ];
  gs.contracts=[
    {year:1980,team_id:"T1",driver_id:"D1",driver_name:"Released Driver",role:"Main Driver",salary:500_000,status:"released"},
    {year:1980,team_id:"T1",driver_id:"D2",driver_name:"Live Driver",role:"Second Driver",salary:1_200_000,status:"active"},
  ];

  gs.dbStaffContracts=[
    {year:1980,team_id:"T1",staff_id:"S_OLD",staff_name:"Historical Staff",role:"engineer",salary:1_200_000,status:"active"},
  ];
  gs.staffContracts=[];

  gs.dbSponsorsContracts=[
    {year:1980,team_id:"T1",sponsor_id:"SP_OLD",sponsor_name:"Historical Sponsor",monthly_fee:500_000,status:"active"},
  ];
  gs.sponsorsContracts=[];

  const next=applyEconomyTick(gs);
  const salaries=next.financeLog.filter((row)=>row.category==="Salary - Driver");
  assert.equal(salaries.length,1);
  assert.equal(salaries[0].desc,"Live Driver");
  assert.equal(salaries[0].amount,-100_000);
  assert.equal(next.financeLog.some((row)=>String(row.desc).includes("Historical Ghost")),false);
  assert.equal(next.financeLog.some((row)=>row.category==="Salary - Staff"),false);
  assert.equal(next.financeLog.some((row)=>String(row.category).startsWith("Sponsor")),false);
});
