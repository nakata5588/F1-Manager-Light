import test from "node:test";
import assert from "node:assert/strict";

import { deriveBoardState } from "../src/domain/boardState.js";
import { academyProgramDefinition } from "../src/domain/academyPrograms.js";
import { baseComponentConstructionCost, syncGarageState } from "../src/domain/garage.js";
import { createManufacturedPartUnits, fitPhysicalPartUnit, inventoryCountForDesign, partUnitsForDesign, removePhysicalPartUnit } from "../src/domain/partUnits.js";
import { availableCarComponentSlots, componentEligibility } from "../src/domain/carComponents.js";
import { conditionModifierBreakdown } from "../src/domain/driverPerformance.js";
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

  next=fitPhysicalPartUnit(next,{carId:"car_1",slot:"aero_rear",designId:"RW1"});
  assert.equal(inventoryCountForDesign(next,"RW1"),1);
  const fittedId=next.garage.cars.find((car)=>car.id==="car_1").installedParts.aero_rear;
  assert.ok(fittedId);
  assert.ok(units.some((unit)=>unit.id===fittedId));

  next=removePhysicalPartUnit(next,{carId:"car_1",slot:"aero_rear"});
  assert.equal(inventoryCountForDesign(next,"RW1"),2);
  assert.equal(next.garage.cars.find((car)=>car.id==="car_1").installedParts.aero_rear,undefined);
});
