import test from "node:test";
import assert from "node:assert/strict";

import { deriveBoardState } from "../src/domain/boardState.js";
import { academyProgramDefinition } from "../src/domain/academyPrograms.js";
import { baseComponentConstructionCost, syncGarageState } from "../src/domain/garage.js";
import { teamCarPerformance } from "../src/domain/carPerformance.js";
import { derivePartTechnicalProfile, technicalAdjustmentForPart } from "../src/domain/carPartPerformance.js";
import { createManufacturedPartUnits, fitPhysicalPartUnit, inventoryCountForDesign, partUnitById, partUnitsForDesign, removePhysicalPartUnit, warehousePartUnitsForDesign } from "../src/domain/partUnits.js";
import { partManufactureQuote, partUnitRestoreQuote, processWorkshopJobs, queueWorkshopJob, standardBuildQuote, standardRestoreQuote } from "../src/domain/componentService.js";
import { availableCarComponentSlots, componentEligibility } from "../src/domain/carComponents.js";
import { combinedRacePerformance, conditionModifierBreakdown } from "../src/domain/driverPerformance.js";
import { teamCarCharacteristics, trackCharacteristicPriorities, trackSensitiveUpgradeModifier } from "../src/domain/carCharacteristics.js";
import { pitCrewEffectiveProfile } from "../src/engine/RaceStrategyEngine.js";

test("live Board state exposes objectives outside the Board page", () => {
  const gs = {
    activeYear:1980,
    team:{team_id:"fer"},
    teamBrands:[{team_id:"fer",board_expectation:"Challenge for the championship"}],
    teams:[{team_id:"fer"},{team_id:"wil"},{team_id:"ren"}],
    calendar:Array.from({length:14},(_,i)=>({round:i+1})),
    results:[{
      year:1980,
      classification:[
        {team_id:"fer",position:1,points:9,retired:false},
        {team_id:"fer",position:3,points:4,retired:false},
      ],
    }],
    standings:{teams:[{team_id:"fer",position:1,points:13}]},
    board:{reputation:0.55},
  };
  const board=deriveBoardState(gs);
  assert.equal(board.expectation,"championship");
  assert.match(board.expectationLabel,/championship/i);
  assert.ok(board.objectives.length>=3);
  assert.ok(board.objectives.some((row)=>row.type==="wins"&&row.progress>0));
  assert.ok(board.confidence>0&&board.confidence<=1);
});

test("manufacturing facility lowers standard component construction cost", () => {
  const low={activeYear:1980,team:{team_id:"fer"},hq:{facilityLevels:{manufacturing_leve:3}}};
  const high={activeYear:1980,team:{team_id:"fer"},hq:{facilityLevels:{manufacturing_leve:9}}};
  assert.ok(baseComponentConstructionCost(high,"gearbox") < baseComponentConstructionCost(low,"gearbox"));
  assert.ok(baseComponentConstructionCost(high,"gearbox") > 0);
});

test("pit crew high training load has a temporary race-day penalty", () => {
  const base={avg_time_s:6.2,consistency:80,error_rate:0.04,training_load:50};
  const hard={...base,training_load:90};
  const balanced=pitCrewEffectiveProfile(base);
  const overtrained=pitCrewEffectiveProfile(hard);
  assert.equal(balanced.avg_time_s,6.2);
  assert.ok(overtrained.avg_time_s>balanced.avg_time_s);
  assert.ok(overtrained.consistency<balanced.consistency);
  assert.ok(overtrained.error_rate>balanced.error_rate);
});

test("Academy plans describe and target different development attributes", () => {
  const racecraft=academyProgramDefinition("Racecraft");
  const feedback=academyProgramDefinition("Technical Feedback");
  const privateTesting=academyProgramDefinition("Private Testing Support");
  assert.ok(racecraft.deltas.racecraft>0);
  assert.ok(feedback.deltas.technical_feedback>racecraft.deltas.technical_feedback || feedback.deltas.technical_feedback>0);
  assert.equal(privateTesting.mode,"supported_prospect");
  assert.ok(privateTesting.description.length>20);
});

test("driver condition modifier makes fatigue visible in performance", () => {
  const neutral={driverAttributes:{d1:{confidence:50,morale:50,preparation:50,fatigue:0}}};
  const tired={driverAttributes:{d1:{confidence:65,morale:60,preparation:70,fatigue:80}}};
  const a=conditionModifierBreakdown(neutral,"d1");
  const b=conditionModifierBreakdown(tired,"d1");
  assert.equal(a.total,0);
  assert.ok(b.fatigueEffect<0);
  assert.ok(b.confidenceEffect>0);
  assert.ok(b.preparationEffect>0);
  assert.ok(b.total<a.total,"extreme fatigue should outweigh positive confidence/preparation");
});


test("1980 component registry is era-aware and power-unit-aware", () => {
  const base={
    activeYear:1980,
    dbCarParts:[],
    carStats:[
      {year:1980,team_id:"wil",chassis_spec:88,aero_spec:85,gearbox_spec:82,suspension_spec:84,brakes_spec:83,cooling_spec:82,turbo_spec:null},
      {year:1980,team_id:"ren",chassis_spec:80,aero_spec:88,gearbox_spec:79,suspension_spec:81,brakes_spec:80,cooling_spec:78,turbo_spec:74},
    ],
    teamEngines:[
      {year:1980,team_id:"wil",engine_name:"Ford Cosworth DFV V8",power_unit:"Ford"},
      {year:1980,team_id:"ren",engine_name:"Renault EF1 V6 t",power_unit:"Renault"},
    ],
  };
  const williams=availableCarComponentSlots(base,"wil");
  const renault=availableCarComponentSlots(base,"ren");
  assert.ok(williams.includes("fuel_system"));
  assert.ok(williams.includes("exhaust_system"));
  assert.ok(!williams.includes("turbocharger"),"normally aspirated Williams must not expose a turbo");
  assert.ok(renault.includes("turbocharger"),"turbo Renault must expose a turbocharger");
  assert.equal(componentEligibility(base,"wil","ers_mgu_k").reason,"outside_era");
});

test("hybrid component registry follows technology and regulation eras", () => {
  const gs2014={
    activeYear:2014,
    carStats:[{year:2014,team_id:"t1",electronics_spec:82,ers_mgu_k:80,ers_mgu_h:77,battery_pack:79}],
    teamEngines:[{year:2014,team_id:"t1",engine_name:"Hybrid V6 Turbo"}],
  };
  const slots2014=availableCarComponentSlots(gs2014,"t1");
  assert.ok(slots2014.includes("electronics"));
  assert.ok(slots2014.includes("ers_mgu_k"));
  assert.ok(slots2014.includes("ers_mgu_h"));
  assert.ok(slots2014.includes("battery_pack"));
  assert.ok(!slots2014.includes("kers"));

  const gs2026={...gs2014,activeYear:2026,carStats:[{year:2026,team_id:"t1",electronics_spec:84,ers_mgu_k:85,ers_mgu_h:null,battery_pack:86}]};
  const slots2026=availableCarComponentSlots(gs2026,"t1");
  assert.ok(slots2026.includes("ers_mgu_k"));
  assert.ok(!slots2026.includes("ers_mgu_h"),"MGU-H must be unavailable outside its catalogue era");
});

test("garage seeds condition only for components applicable to the player's car technology", () => {
  const gs={
    activeYear:1980,
    team:{team_id:"wil"},
    contracts:[],
    carStats:[{year:1980,team_id:"wil",chassis_spec:88,aero_spec:85,gearbox_spec:82,suspension_spec:84,brakes_spec:83,cooling_spec:82,turbo_spec:null}],
    teamEngines:[{year:1980,team_id:"wil",engine_name:"Ford Cosworth DFV V8"}],
  };
  const garage=syncGarageState(gs,{cars:[]});
  const car=garage.cars[0];
  assert.equal(car.componentCondition.fuel_system,100);
  assert.equal(car.componentCondition.exhaust_system,100);
  assert.equal(car.componentCondition.turbocharger,undefined);
});


test("manufacturing creates distinct physical units and fitting moves one out of warehouse", () => {
  const gs={
    activeYear:1980,
    team:{team_id:"wil"},
    contracts:[],
    development:{
      parts:[{id:"RW1",name:"Rear Wing V1",slot:"aero_rear",perf:1.2,inv:0}],
      partUnits:[],
    },
    garage:{
      cars:[
        {id:"car_1",label:"Car 1",kind:"race",driver_id:null,installedParts:{},componentCondition:{}},
        {id:"car_2",label:"Car 2",kind:"race",driver_id:null,installedParts:{},componentCondition:{}},
      ],
    },
  };

  let next=createManufacturedPartUnits(gs,{designId:"RW1",qty:2,batchId:"B1",manufacturedAt:"1980-02-01"});
  const units=partUnitsForDesign(next,"RW1");
  assert.equal(units.length,2);
  assert.notEqual(units[0].id,units[1].id);
  assert.equal(units[0].condition,100);
  assert.equal(units[1].condition,100);
  assert.equal(inventoryCountForDesign(next,"RW1"),2);
  assert.equal(next.development.parts[0].inv,2);

  const sameBatch=createManufacturedPartUnits(next,{designId:"RW1",qty:2,batchId:"B1",manufacturedAt:"1980-02-01"});
  assert.equal(partUnitsForDesign(sameBatch,"RW1").length,2,"reprocessing the same completed batch must not duplicate physical units");
  next=sameBatch;

  next=fitPhysicalPartUnit(next,{carId:"car_1",slot:"aero_rear",designId:"RW1"});
  assert.equal(inventoryCountForDesign(next,"RW1"),1);
  const fittedId=next.garage.cars.find((car)=>car.id==="car_1").installedParts.aero_rear;
  assert.ok(fittedId);
  assert.ok(units.some((unit)=>unit.id===fittedId));

  next=removePhysicalPartUnit(next,{carId:"car_1",slot:"aero_rear"});
  assert.equal(inventoryCountForDesign(next,"RW1"),2);
  assert.equal(next.garage.cars.find((car)=>car.id==="car_1").installedParts.aero_rear,undefined);
});


test("standard component builds complete after workshop time instead of appearing instantly", () => {
  const gs={
    activeYear:1980,
    currentDateISO:"1980-02-01",
    team:{team_id:"T1"},
    hq:{facilityLevels:{manufacturing_leve:5}},
    garage:{
      baseComponentStock:{gearbox:0},
      cars:[{id:"car_1",componentCondition:{gearbox:52},installedParts:{}}],
      serviceJobs:[],
    },
    development:{parts:[],partUnits:[]},
  };

  const quote=standardBuildQuote(gs,"gearbox");
  assert.ok(quote.cost>0);
  assert.ok(quote.days>=2);
  let next=queueWorkshopJob(gs,quote,{id:"job_build",title:"Build gearbox",startedAt:"1980-02-01"});
  assert.equal(next.garage.baseComponentStock.gearbox,0,"stock must not be granted when the job starts");

  next=processWorkshopJobs({...next,currentDateISO:"1980-02-02"});
  assert.equal(next.garage.baseComponentStock.gearbox,0);

  next=processWorkshopJobs({...next,currentDateISO:next.garage.serviceJobs[0].finishes_at});
  assert.equal(next.garage.baseComponentStock.gearbox,1);
  assert.equal(next.garage.serviceJobs[0].status,"completed");

  const again=processWorkshopJobs(next);
  assert.equal(again.garage.baseComponentStock.gearbox,1,"completed workshop jobs must be idempotent");
});

test("standard component restoration costs money, takes time and only restores on completion", () => {
  const gs={
    activeYear:1980,
    currentDateISO:"1980-02-01",
    team:{team_id:"T1"},
    hq:{facilityLevels:{manufacturing_leve:5}},
    garage:{
      baseComponentStock:{gearbox:0},
      cars:[{id:"car_1",label:"Car 1",componentCondition:{gearbox:48},installedParts:{}}],
      serviceJobs:[],
    },
    development:{parts:[],partUnits:[]},
  };

  const build=standardBuildQuote(gs,"gearbox");
  const restore=standardRestoreQuote(gs,"gearbox",48,{carId:"car_1"});
  assert.ok(restore.cost>0);
  assert.ok(restore.cost<build.cost);
  assert.ok(restore.days>=1);

  let next=queueWorkshopJob(gs,restore,{id:"job_restore",title:"Restore gearbox",startedAt:"1980-02-01"});
  assert.equal(next.garage.cars[0].componentCondition.gearbox,48);
  next=processWorkshopJobs({...next,currentDateISO:next.garage.serviceJobs[0].finishes_at});
  assert.equal(next.garage.cars[0].componentCondition.gearbox,100);
});

test("developed physical unit restoration reserves the unit and restores its own condition", () => {
  const gs={
    activeYear:1980,
    currentDateISO:"1980-02-01",
    team:{team_id:"T1"},
    hq:{facilityLevels:{manufacturing_leve:5}},
    garage:{
      cars:[{id:"car_1",installedParts:{}}],
      serviceJobs:[],
    },
    development:{
      parts:[{id:"RW1",name:"Rear Wing V1",slot:"aero_rear",perf:1.4,inv:1}],
      partUnits:[{id:"RW1-U1",design_id:"RW1",slot:"aero_rear",condition:61}],
    },
  };

  const quote=partUnitRestoreQuote(gs,"RW1-U1");
  assert.ok(quote.cost>0);
  let next=queueWorkshopJob(gs,quote,{id:"job_unit_restore",title:"Restore RW1-U1",startedAt:"1980-02-01"});
  assert.equal(warehousePartUnitsForDesign(next,"RW1").length,0,"unit in restoration must not be fit-ready stock");
  assert.equal(partUnitById(next,"RW1-U1").condition,61);

  next=processWorkshopJobs({...next,currentDateISO:next.garage.serviceJobs[0].finishes_at});
  assert.equal(partUnitById(next,"RW1-U1").condition,100);
  assert.equal(warehousePartUnitsForDesign(next,"RW1").length,1);
});


test("workshop lead times and costs reflect component complexity", () => {
  const gs={
    activeYear:1980,
    team:{team_id:"T1"},
    hq:{facilityLevels:{manufacturing_leve:5}},
  };
  const front=standardBuildQuote(gs,"aero_front");
  const gearbox=standardBuildQuote(gs,"gearbox");
  const chassis=standardBuildQuote(gs,"chassis");

  assert.ok(front.days>=5,"front wing should take several days rather than the old universal 4-day build");
  assert.ok(gearbox.days>front.days);
  assert.ok(chassis.days>gearbox.days);
  assert.ok(chassis.cost>gearbox.cost);
  assert.ok(gearbox.cost>front.cost);

  const highFacility=standardBuildQuote({
    ...gs,
    hq:{facilityLevels:{manufacturing_leve:9}},
  },"chassis");
  assert.ok(highFacility.days<chassis.days,"better manufacturing must shorten lead time");
});

test("restoration duration depends on component and damage severity", () => {
  const gs={
    activeYear:1980,
    team:{team_id:"T1"},
    hq:{facilityLevels:{manufacturing_leve:5}},
  };
  const lightFront=standardRestoreQuote(gs,"aero_front",80,{carId:"car_1"});
  const heavyFront=standardRestoreQuote(gs,"aero_front",40,{carId:"car_1"});
  const heavyGearbox=standardRestoreQuote(gs,"gearbox",40,{carId:"car_1"});

  assert.ok(heavyFront.days>lightFront.days);
  assert.ok(heavyGearbox.days>heavyFront.days);
  assert.ok(heavyFront.cost>lightFront.cost);
  assert.ok(heavyFront.cost<standardBuildQuote(gs,"aero_front").cost);
});

test("developed part manufacturing uses the same component-specific workshop model", () => {
  const gs={
    activeYear:1980,
    team:{team_id:"T1"},
    hq:{facilityLevels:{manufacturing_leve:5}},
  };
  const front=partManufactureQuote(gs,{id:"FW3",slot:"aero_front",perf:3});
  const chassis=partManufactureQuote(gs,{id:"CH3",slot:"chassis",perf:3});
  assert.ok(front.days>=standardBuildQuote(gs,"aero_front").days);
  assert.ok(chassis.days>front.days);
  assert.ok(chassis.cost>front.cost);
});

test("technical part profile consumes weight drag downforce reliability and impact area", () => {
  const gs={activeYear:1980,team:{team_id:"T1"}};
  const front=derivePartTechnicalProfile(gs,{id:"FW3",slot:"aero_front",perf:3});
  const gearbox=derivePartTechnicalProfile(gs,{id:"GB3",slot:"gearbox",perf:3});

  assert.equal(front.baseline.weight_kg,10);
  assert.equal(front.baseline.drag,0.05);
  assert.equal(front.baseline.downforce,0.18);
  assert.equal(front.baseline.reliability,0.85);
  assert.equal(front.impact_area,"aero");
  assert.equal(gearbox.impact_area,"powertrain");

  assert.ok(front.design.weight_kg<front.baseline.weight_kg);
  assert.ok(front.design.drag<front.baseline.drag);
  assert.ok(front.design.downforce>front.baseline.downforce);
  assert.ok(front.design.reliability>front.baseline.reliability);

  const frontAdj=technicalAdjustmentForPart(gs,{slot:"aero_front",part:{slot:"aero_front",perf:3},condition:100});
  const gearboxAdj=technicalAdjustmentForPart(gs,{slot:"gearbox",part:{slot:"gearbox",perf:3},condition:100});
  assert.notEqual(frontAdj.qualifying,gearboxAdj.qualifying,"same generic perf must not produce identical component behaviour");
  assert.notEqual(frontAdj.race,gearboxAdj.race);
});

test("canonical car performance exposes real technical deltas from the fitted physical unit", () => {
  const gs={
    activeYear:1980,
    team:{team_id:"T1"},
    teams:[{team_id:"T1"}],
    contracts:[
      {year:1980,team_id:"T1",driver_id:"D1",role:"Main Driver",status:"active"},
      {year:1980,team_id:"T1",driver_id:"D2",role:"Second Driver",status:"active"},
    ],
    carStats:[{year:1980,team_id:"T1",chassis_spec:70,aero_spec:70,gearbox_spec:70,suspension_spec:70,brakes_spec:70,cooling_spec:70,reliability:80}],
    teamEngines:[{year:1980,team_id:"T1",power:75,reliability:82}],
    development:{
      parts:[{id:"FW3",slot:"aero_front",name:"Front Wing V3",perf:3,inv:0}],
      partUnits:[{id:"FW3-U1",design_id:"FW3",slot:"aero_front",condition:100}],
    },
  };
  const garage=syncGarageState(gs,{});
  garage.cars[0].installedParts={aero_front:"FW3-U1"};

  const before=teamCarPerformance({...gs,garage:{...garage,cars:garage.cars.map((car)=>car.id==="car_1"?{...car,installedParts:{}}:car)}},"T1","D1");
  const after=teamCarPerformance({...gs,garage},"T1","D1");

  assert.ok(after.qualifying>before.qualifying);
  assert.ok(after.race>before.race);
  assert.ok(after.technical_delta.weight_kg<0);
  assert.ok(after.technical_delta.drag<0);
  assert.ok(after.technical_delta.downforce>0);
  assert.ok(after.technical_delta.design_reliability_pct>0);
});


test("1980 aero registry includes sidepods and underfloor but still excludes future hybrid technology", () => {
  const gs={
    activeYear:1980,
    dbCarParts:[
      {part_type:"chassis",era_start_year:1950,impact_area:"chassis",base_reliability:0.8},
      {part_type:"aero_front",era_start_year:1968,impact_area:"aero",base_reliability:0.85},
      {part_type:"aero_rear",era_start_year:1968,impact_area:"aero",base_reliability:0.83},
    ],
    carStats:[{year:1980,team_id:"T1",aero_spec:84,chassis_spec:82}],
    teamEngines:[{year:1980,team_id:"T1",engine_name:"Cosworth DFV V8"}],
  };
  const slots=availableCarComponentSlots(gs,"T1");
  assert.ok(slots.includes("sidepods"),"runtime registry should add newly modelled sidepods even before DB workbook refresh");
  assert.ok(slots.includes("underfloor"),"ground-effect era should expose the underfloor");
  assert.equal(componentEligibility(gs,"T1","ers_mgu_k").available,false);
});

test("car characteristics expose a non-zero baseline even without developed upgrades", () => {
  const gs={
    activeYear:1980,
    team:{team_id:"T1"},
    carStats:[{
      year:1980,team_id:"T1",chassis_spec:82,aero_spec:84,gearbox_spec:78,
      suspension_spec:80,brakes_spec:79,cooling_spec:76,reliability:0.82,weight:595,
    }],
    teamEngines:[{year:1980,team_id:"T1",power:81,reliability:80}],
    garage:{cars:[{id:"car_1",kind:"race",driver_id:"D1",installedParts:{},componentCondition:{}}]},
    development:{parts:[],partUnits:[]},
  };
  const profile=teamCarCharacteristics(gs,"T1","D1");
  assert.ok(profile.values.top_speed>0);
  assert.ok(profile.values.low_speed>0);
  assert.ok(profile.values.ground_effect>0);
  assert.equal(profile.upgrade_delta.top_speed,0);
  assert.equal(profile.upgrade_delta.high_speed,0);
});

test("different developed components change different driving characteristics", () => {
  const base={
    activeYear:1980,
    team:{team_id:"T1"},
    contracts:[
      {year:1980,team_id:"T1",driver_id:"D1",role:"Main Driver",status:"active"},
      {year:1980,team_id:"T1",driver_id:"D2",role:"Second Driver",status:"active"},
    ],
    carStats:[{
      year:1980,team_id:"T1",chassis_spec:82,aero_spec:84,gearbox_spec:78,
      suspension_spec:80,brakes_spec:79,cooling_spec:76,reliability:0.82,weight:595,
    }],
    teamEngines:[{year:1980,team_id:"T1",power:81,reliability:80}],
    development:{
      parts:[
        {id:"UF2",slot:"underfloor",name:"Underfloor V2",perf:3},
        {id:"GB2",slot:"gearbox",name:"Gearbox V2",perf:3},
      ],
      partUnits:[
        {id:"UF2-U1",design_id:"UF2",slot:"underfloor",condition:100},
        {id:"GB2-U1",design_id:"GB2",slot:"gearbox",condition:100},
      ],
    },
  };
  let garage=syncGarageState(base,{});
  garage.cars[0].installedParts={underfloor:"UF2-U1"};
  let underfloor=teamCarCharacteristics({...base,garage},"T1","D1");

  garage=syncGarageState(base,{});
  garage.cars[0].installedParts={gearbox:"GB2-U1"};
  const gearbox=teamCarCharacteristics({...base,garage},"T1","D1");

  assert.ok(underfloor.upgrade_delta.ground_effect>underfloor.upgrade_delta.acceleration);
  assert.ok(gearbox.upgrade_delta.acceleration>gearbox.upgrade_delta.high_speed);
  assert.notEqual(underfloor.upgrade_delta.medium_speed,gearbox.upgrade_delta.medium_speed);
});

test("track sensitivity changes the value of a developed package without inventing physical kmh figures", () => {
  const gs={
    activeYear:1980,
    team:{team_id:"T1"},
    contracts:[{year:1980,team_id:"T1",driver_id:"D1",role:"Main Driver",status:"active"}],
    drivers:[{driver_id:"D1"}],
    driverRatings:[{driver_id:"D1",pace:80,racecraft:80,consistency:80,tire_management:80,race_intelligence:80,start_launch:80,mentality:80,pressure_handling:80,adaptability:80,current_ability:80}],
    driverAttributes:{D1:{confidence:50,morale:50,preparation:50,fatigue:0}},
    carStats:[{year:1980,team_id:"T1",chassis_spec:80,aero_spec:80,gearbox_spec:80,suspension_spec:80,brakes_spec:80,cooling_spec:80,reliability:0.82,weight:595}],
    teamEngines:[{year:1980,team_id:"T1",power:80,reliability:80}],
    development:{
      parts:[{id:"UF2",slot:"underfloor",perf:4}],
      partUnits:[{id:"UF2-U1",design_id:"UF2",slot:"underfloor",condition:100}],
    },
  };
  const garage=syncGarageState(gs,{});
  garage.cars[0].installedParts={underfloor:"UF2-U1"};
  const state={...gs,garage};
  const fastTrack={lap_length_km:7.0,tyre_wear:55,overtaking_difficulty:35,crash_risk:45};
  const twistyTrack={lap_length_km:3.3,tyre_wear:80,overtaking_difficulty:85,crash_risk:75};

  const fast=trackSensitiveUpgradeModifier(state,{teamId:"T1",driverId:"D1",track:fastTrack});
  const twisty=trackSensitiveUpgradeModifier(state,{teamId:"T1",driverId:"D1",track:twistyTrack});
  assert.ok(Number.isFinite(fast.modifier));
  assert.ok(Number.isFinite(twisty.modifier));
  assert.notDeepEqual(trackCharacteristicPriorities(state,{track:fastTrack}).important,trackCharacteristicPriorities(state,{track:twistyTrack}).important);
});
