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
import { buildRaceEntryState } from "../src/domain/raceEntry.js";
import { activeTestDriverContracts } from "../src/domain/developmentTesting.js";
import { applyRaceComponentWear, componentWearForRaceRow } from "../src/domain/componentWear.js";
import { applyRaceTeamMorale, teamOperationalMorale } from "../src/domain/teamMorale.js";
import { componentConditionForCar } from "../src/domain/garage.js";
import { normalizePhysicalPartState, partUnitById, partUnitsForDesign } from "../src/domain/partUnits.js";

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
  gs.driverRatings=gs.driverRatings.map((row)=>row.driver_id==="D4"?{
    ...row,qualifying:64,racecraft:63,consistency:62,tire_management:61,
    race_intelligence:60,pressure_handling:60,adaptability:60,mentality:60,technical_feedback:60,
  }:row);
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


test("race entry never revives historical contracts when the live career collection is empty",()=>{
  const gs=baseState();
  gs.dbContracts=[...gs.contracts];
  gs.contracts=[];
  const state=buildRaceEntryState(gs,{
    roundIndex:0,
    gp:{year:1980,gp_id:"GP1",race_date:"1980-03-10"},
  });
  assert.ok(state.entries.length>0);
  assert.equal(state.entries.some((entry)=>entry.driver_id),false);
});

test("test-driver development never falls back to historical contracts once live contracts exist",()=>{
  const gs=baseState();
  gs.dbContracts=[
    {year:1980,team_id:"T1",driver_id:"D3",role:"test_driver",status:"active"},
  ];
  gs.contracts=[];
  assert.deepEqual(activeTestDriverContracts(gs,"T1"),[]);
});


test("standard car components are created at full health and wear even without developed parts",()=>{
  let gs=baseState();
  gs.development={parts:[]};
  let garage=syncGarageState(gs,{});
  gs={...gs,garage};

  assert.equal(componentConditionForCar(gs,garage.cars[0],"gearbox"),100);

  for(let round=0;round<8;round++){
    gs=applyRaceComponentWear(gs,{
      gp:{gp_id:"GP"+(round+1),race_date:"1980-03-10"},
      race:[{driver:{driver_id:"D1"},retired:false}],
    });
  }

  const car=gs.garage.cars.find((row)=>row.id==="car_1");
  assert.ok(componentConditionForCar(gs,car,"gearbox")<70,"gearbox should require attention during a full season");
  assert.ok(componentConditionForCar(gs,car,"fuel_system")<80,"fuel system should wear during a full season");
  assert.equal(car.componentCondition.turbocharger,undefined,"normally aspirated 1980 cars must not seed a turbo component");
  assert.ok(gs.componentWearLog.some((row)=>row.component_source==="base_component"));
});

test("worn standard components reduce live car reliability and race performance",()=>{
  const gs=baseState();
  const garage=syncGarageState(gs,{});
  const healthy={...gs,garage};
  const wornGarage={
    ...garage,
    cars:garage.cars.map((car)=>car.id==="car_1"?{
      ...car,
      componentCondition:{
        ...(car.componentCondition||{}),
        gearbox:28,
        cooling:32,
        turbocharger:30,
      },
    }:car),
  };
  const worn={...gs,garage:wornGarage};
  const healthyPerf=teamCarPerformance(healthy,"T1","D1");
  const wornPerf=teamCarPerformance(worn,"T1","D1");
  assert.ok(wornPerf.reliability<healthyPerf.reliability-3);
  assert.ok(wornPerf.race<healthyPerf.race);
});

test("installed components lose condition after a normal GP",()=>{
  const gs=baseState();
  const garage=syncGarageState(gs,{});
  garage.cars[0].installedParts={aero_front:"P1"};
  const next=applyRaceComponentWear({...gs,garage},{
    gp:{gp_id:"GP1",race_date:"1980-03-10"},
    race:[{
      driver:{driver_id:"D1"},
      retired:false,
      retirement_reason:null,
    }],
  });
  const installedUnitId=next.garage.cars.find((row)=>row.id==="car_1").installedParts.aero_front;
  const unit=partUnitById(next,installedUnitId);
  assert.equal(unit.condition,97.2);
  assert.ok(next.componentWearLog.some((row)=>row.part_id==="P1"&&row.part_unit_id===installedUnitId&&row.driver_id==="D1"));
});

test("serious accident creates substantially more component wear than a clean finish",()=>{
  const gs=baseState();
  const garage=syncGarageState(gs,{});
  garage.cars[0].installedParts={aero_front:"P1"};
  const clean=applyRaceComponentWear({...gs,garage},{
    race:[{driver:{driver_id:"D1"},retired:false}],
  });
  const crash=applyRaceComponentWear({...gs,garage},{
    race:[{
      driver:{driver_id:"D1"},
      retired:true,
      retirement_reason:"Accident",
      incident_severity:"high",
      incident_severity_score:0.9,
    }],
  });
  const cleanUnitId=clean.garage.cars.find((row)=>row.id==="car_1").installedParts.aero_front;
  const crashUnitId=crash.garage.cars.find((row)=>row.id==="car_1").installedParts.aero_front;
  const cleanCondition=partUnitById(clean,cleanUnitId).condition;
  const crashCondition=partUnitById(crash,crashUnitId).condition;
  assert.ok(crashCondition<cleanCondition-5);
});

test("low component condition reduces the live car reliability value",()=>{
  const gs=baseState();
  const garage=syncGarageState(gs,{});
  garage.cars[0].installedParts={aero_front:"P1"};
  const healthy=normalizePhysicalPartState({...gs,garage});
  const unitId=healthy.garage.cars[0].installedParts.aero_front;
  const worn=normalizePhysicalPartState({
    ...healthy,
    development:{
      ...healthy.development,
      partUnits:healthy.development.partUnits.map((unit)=>unit.id===unitId?{...unit,condition:30}:unit),
    },
  });
  const healthyPerf=teamCarPerformance(healthy,"T1","D1");
  const wornPerf=teamCarPerformance(worn,"T1","D1");
  assert.ok(wornPerf.qualifying<healthyPerf.qualifying);
  assert.ok(wornPerf.race<healthyPerf.race);
  assert.ok(wornPerf.reliability<healthyPerf.reliability);
});

test("two cars can use the same design while their physical units wear independently",()=>{
  const base=baseState();
  base.development.parts=[{id:"P1",name:"Front Wing V1",slot:"aero_front",perf:3,condition:100,inv:0}];
  const garage=syncGarageState(base,{});
  garage.cars[0].installedParts={aero_front:"P1"};
  garage.cars[1].installedParts={aero_front:"P1"};
  let gs=normalizePhysicalPartState({...base,garage});

  const car1=gs.garage.cars.find((row)=>row.id==="car_1");
  const car2=gs.garage.cars.find((row)=>row.id==="car_2");
  assert.notEqual(car1.installedParts.aero_front,car2.installedParts.aero_front);
  assert.equal(partUnitsForDesign(gs,"P1").length,2);

  const unit1=car1.installedParts.aero_front;
  const unit2=car2.installedParts.aero_front;
  gs=applyRaceComponentWear(gs,{
    race:[{driver:{driver_id:"D1"},retired:false}],
  });

  assert.ok(partUnitById(gs,unit1).condition<100);
  assert.equal(partUnitById(gs,unit2).condition,100);
});


test("every DNF causes component damage and critical accidents cause multi-component heavy damage",()=>{
  const normalGearbox=componentWearForRaceRow({
    retired:false,laps_completed:60,race_laps:60,
  },"gearbox");
  const mechanicalGearbox=componentWearForRaceRow({
    retired:true,retirement_reason:"Gearbox",laps_completed:30,race_laps:60,
  },"gearbox");
  const genericDnfFront=componentWearForRaceRow({
    retired:true,retirement_reason:"Retired",laps_completed:30,race_laps:60,
  },"aero_front");
  const criticalCrash={
    retired:true,retirement_reason:"Accident",incident_severity:"critical",
    incident_severity_score:0.99,laps_completed:25,race_laps:60,
  };

  assert.ok(mechanicalGearbox>normalGearbox+10,"mechanical DNF must materially damage the failed component");
  assert.ok(genericDnfFront>componentWearForRaceRow({retired:false,laps_completed:30,race_laps:60},"aero_front")+3);
  assert.ok(componentWearForRaceRow(criticalCrash,"aero_front")>50);
  assert.ok(componentWearForRaceRow(criticalCrash,"suspension")>40);
  assert.ok(componentWearForRaceRow(criticalCrash,"underfloor")>35);
});

test("an accident marked on a classified finisher still causes crash damage",()=>{
  const clean=componentWearForRaceRow({
    retired:false,laps_completed:60,race_laps:60,
  },"aero_front");
  const incident=componentWearForRaceRow({
    retired:false,laps_completed:60,race_laps:60,
    incident_kind:"collision",incident_severity:"medium",
  },"aero_front");
  assert.ok(incident>clean+10);
});

test("Team Morale drops on DNF, drops less for an accident, and rises for points above expectation",()=>{
  const base={
    currentDateISO:"1980-06-01",
    teamOperationalState:{T1:{team_id:"T1",morale:50}},
    teamMoraleLog:{},
  };
  const mechanical=applyRaceTeamMorale(base,{
    gp:{gp_name:"Mechanical GP"},
    race:[{team_id:"T1",retired:true,retirement_reason:"Engine",position:20,points:0}],
  });
  assert.equal(teamOperationalMorale(mechanical,"T1"),47);

  const accident=applyRaceTeamMorale(base,{
    gp:{gp_name:"Crash GP"},
    race:[{team_id:"T1",retired:true,retirement_reason:"Accident",position:20,points:0}],
  });
  assert.equal(teamOperationalMorale(accident,"T1"),48);

  const strong=applyRaceTeamMorale(base,{
    gp:{gp_name:"Strong GP"},
    race:[{
      team_id:"T1",retired:false,position:6,points:2,
      driver_performance:{expected_finish:11},
    }],
  });
  assert.ok(teamOperationalMorale(strong,"T1")>51);
  assert.ok(strong.teamOperationalState.T1.reasons.some((row)=>row.key==="points"));
  assert.ok(strong.teamOperationalState.T1.reasons.some((row)=>row.key==="above_expectation"));
});
