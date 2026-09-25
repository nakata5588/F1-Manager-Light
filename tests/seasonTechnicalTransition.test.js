import test from "node:test";
import assert from "node:assert/strict";

import {
  transitionPhysicalTechnicalWorld,
} from "../src/domain/seasonTechnicalTransition.js";
import {
  createManufacturedPartUnits,
  fitPhysicalPartUnit,
  inventoryCountForDesign,
  partDesignOperational,
  partUnitOperational,
  warehousePartUnitsForDesign,
} from "../src/domain/partUnits.js";
import { partManufactureQuote } from "../src/domain/componentService.js";
import {
  bestDevelopedPartForSlot,
  developmentStrengthTarget,
} from "../src/domain/developmentProject.js";
import { processPlayerTechnicalLifecycle } from "../src/domain/playerTechnicalLifecycle.js";

function scope(){
  return {
    development:{
      projects:[
        {id:"P_ACTIVE",type:"aero_front",status:"active",finishes_at:"1981-01-10",engineers:3},
        {id:"P_PAUSED",type:"chassis",status:"paused",finishes_at:"1981-01-15",engineers:2},
        {id:"P_DONE",type:"brakes",status:"completed",completed_at:"1980-10-01",engineers:2},
      ],
      parts:[
        {id:"D1",name:"1980 Front Wing",slot:"aero_front",version:"P1",perf:3.5,inv:1,in_manufacturing:1,created_at:"1980-06-01"},
      ],
      partUnits:[
        {id:"U1",design_id:"D1",slot:"aero_front",condition:72,status:"active",manufactured_at:"1980-07-01"},
        {id:"U2",design_id:"D1",slot:"aero_front",condition:90,status:"active",manufactured_at:"1980-07-02"},
      ],
      manufacturing:[
        {id:"M1",part_id:"D1",status:"active",qty:1,finishes_at:"1981-01-05"},
        {id:"M0",part_id:"D1",status:"completed",qty:2,completed_at:"1980-08-01"},
      ],
      technicalKnowledge:{version:1,team_id:"PLAYER",areas:{aero:{level:70}},history:[]},
      technicalStrategy:null,
      nextSeasonCar:null,
    },
    garage:{
      reserveCarBuilt:true,
      baseComponentStock:{aero_front:3,chassis:1},
      cars:[
        {id:"car_1",kind:"race",driver_id:"DVR1",installedParts:{aero_front:"U1"},componentCondition:{aero_front:72,chassis:80}},
        {id:"car_2",kind:"race",driver_id:"DVR2",installedParts:{},componentCondition:{aero_front:83,chassis:75}},
        {id:"car_spare",kind:"reserve",driver_id:null,installedParts:{aero_front:"U2"},componentCondition:{aero_front:90}},
      ],
      serviceJobs:[
        {id:"W1",kind:"restore_part_unit",unit_id:"U2",status:"active",finishes_at:"1981-01-03"},
        {id:"W0",kind:"restore_standard",status:"completed",completed_at:"1980-09-01"},
      ],
    },
  };
}

function fixture(){
  const player=scope();
  const ai=scope();
  ai.development.technicalKnowledge={version:1,team_id:"AI",areas:{aero:{level:66}},history:[]};
  return {
    activeYear:1980,
    currentDateISO:"1980-12-31",
    team:{team_id:"PLAYER"},
    teams:[{team_id:"PLAYER"},{team_id:"AI"}],
    carStats:[
      {year:1981,team_id:"PLAYER",chassis_spec:80,aero_spec:82,gearbox_spec:78,suspension_spec:77,brakes_spec:76,cooling_spec:75,reliability:0.82},
      {year:1981,team_id:"AI",chassis_spec:75,aero_spec:74,gearbox_spec:73,suspension_spec:72,brakes_spec:71,cooling_spec:70,reliability:0.76},
    ],
    development:player.development,
    garage:player.garage,
    aiTechnicalWorld:{version:1,teams:{AI:{budget:1_000_000,...ai}}},
  };
}

test("season transition archives Blueprints, retires units and resets the physical garage",()=>{
  const before=fixture();
  const knowledge=before.development.technicalKnowledge;
  const next=transitionPhysicalTechnicalWorld(before,1981);

  assert.equal(next.development.technicalKnowledge,knowledge);
  assert.equal(next.development.parts[0].status,"legacy");
  assert.equal(next.development.parts[0].legal_for_season,false);
  assert.equal(next.development.parts[0].season_year,1980);
  assert.equal(next.development.parts[0].inv,0);
  assert.equal(next.development.parts[0].in_manufacturing,0);
  assert.ok(next.development.partUnits.every((unit)=>unit.status==="retired"));
  assert.ok(next.development.partUnits.every((unit)=>unit.season_year===1980));

  assert.equal(next.development.projects.find((p)=>p.id==="P_ACTIVE").status,"season_ended");
  assert.equal(next.development.projects.find((p)=>p.id==="P_PAUSED").status,"season_ended");
  assert.equal(next.development.projects.find((p)=>p.id==="P_DONE").status,"completed");
  assert.equal(next.development.manufacturing.find((j)=>j.id==="M1").status,"season_ended");
  assert.equal(next.development.manufacturing.find((j)=>j.id==="M0").status,"completed");

  assert.equal(next.garage.reserveCarBuilt,false);
  assert.equal(next.garage.cars.some((car)=>car.id==="car_spare"),false);
  assert.ok(next.garage.cars.every((car)=>Object.keys(car.installedParts||{}).length===0));
  assert.ok(next.garage.cars.every((car)=>Object.values(car.componentCondition||{}).every((v)=>v===100)));
  assert.ok(Object.values(next.garage.baseComponentStock).every((v)=>v===0));
  assert.equal(next.garage.serviceJobs.find((j)=>j.id==="W1").status,"season_ended");
  assert.equal(next.garage.serviceJobs.find((j)=>j.id==="W0").status,"completed");
});

test("legacy Blueprint and retired units cannot be manufactured, fitted or counted as stock",()=>{
  const next=transitionPhysicalTechnicalWorld(fixture(),1981);
  const design=next.development.parts[0];
  const retired=next.development.partUnits[0];

  assert.equal(partDesignOperational(design),false);
  assert.equal(partUnitOperational(retired),false);
  assert.equal(partManufactureQuote(next,design),null);
  assert.equal(inventoryCountForDesign(next,design.id),0);
  assert.equal(warehousePartUnitsForDesign(next,design.id).length,0);
  assert.equal(bestDevelopedPartForSlot(next.development.parts,"aero_front"),null);
  assert.equal(developmentStrengthTarget(next.development.parts,"aero_front",1).current_strength,0);

  const manufactured=createManufacturedPartUnits(next,{
    designId:design.id,qty:2,batchId:"ILLEGAL",manufacturedAt:"1981-01-02",
  });
  assert.equal(manufactured.development.partUnits.length,next.development.partUnits.length);

  const fitted=fitPhysicalPartUnit(next,{
    carId:"car_1",slot:"aero_front",designId:design.id,unitId:retired.id,
  });
  assert.deepEqual(fitted.garage.cars.find((car)=>car.id==="car_1").installedParts,{});
});

test("old manufacturing and development work cannot complete after the rollover",()=>{
  let next=transitionPhysicalTechnicalWorld(fixture(),1981);
  next={...next,activeYear:1981,currentDateISO:"1981-02-01"};
  const processed=processPlayerTechnicalLifecycle(next);

  assert.equal(processed.development.parts.length,1);
  assert.equal(processed.development.partUnits.length,2);
  assert.equal(processed.development.projects.find((p)=>p.id==="P_ACTIVE").status,"season_ended");
  assert.equal(processed.development.manufacturing.find((j)=>j.id==="M1").status,"season_ended");
});

test("first new-season design starts from the materialized baseline rather than the archived 1980 Blueprint",()=>{
  let next=transitionPhysicalTechnicalWorld(fixture(),1981);
  next={
    ...next,
    activeYear:1981,
    currentDateISO:"1981-01-10",
    development:{
      ...next.development,
      projects:[
        ...next.development.projects,
        {
          id:"P_1981",
          name:"1981 Front Wing",
          type:"aero_front",
          status:"active",
          started_at:"1981-01-01",
          finishes_at:"1981-01-10",
          target_design_perf:1.25,
          perf_delta:1.25,
          objective_id:"balanced",
          engineers:3,
        },
      ],
    },
  };
  next=processPlayerTechnicalLifecycle(next);
  const fresh=next.development.parts.find((part)=>part.created_from==="P_1981");

  assert.ok(fresh);
  assert.equal(fresh.status,"current");
  assert.equal(fresh.legal_for_season,true);
  assert.equal(fresh.season_year,1981);
  assert.equal(fresh.version,"P1");
  assert.equal(partDesignOperational(fresh),true);
  assert.ok(partManufactureQuote(next,fresh));

  const built=createManufacturedPartUnits(next,{
    designId:fresh.id,qty:1,batchId:"B1981",manufacturedAt:"1981-01-11",
  });
  const unit=built.development.partUnits.find((row)=>row.design_id===fresh.id);
  assert.equal(unit.status,"active");
  assert.equal(unit.season_year,1981);
});

test("AI physical state undergoes the same season transition as the player",()=>{
  const next=transitionPhysicalTechnicalWorld(fixture(),1981);
  const ai=next.aiTechnicalWorld.teams.AI;

  assert.ok(ai.development.parts.every((part)=>part.status==="legacy"));
  assert.ok(ai.development.partUnits.every((unit)=>unit.status==="retired"));
  assert.ok(ai.garage.cars.every((car)=>Object.keys(car.installedParts||{}).length===0));
  assert.equal(ai.garage.reserveCarBuilt,false);
  assert.equal(ai.garage.cars.some((car)=>car.kind==="reserve"),false);
  assert.equal(ai.physical_season_transition.season,1981);
});

test("physical transition is idempotent for the same target season",()=>{
  const once=transitionPhysicalTechnicalWorld(fixture(),1981);
  const twice=transitionPhysicalTechnicalWorld(once,1981);

  assert.deepEqual(twice.development,once.development);
  assert.deepEqual(twice.garage,once.garage);
  assert.deepEqual(twice.physicalSeasonTransition,once.physicalSeasonTransition);
  assert.deepEqual(twice.aiTechnicalWorld,once.aiTechnicalWorld);
});
