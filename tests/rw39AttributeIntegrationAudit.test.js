import test from "node:test";
import assert from "node:assert/strict";
import { createRaceState } from "../src/race2/core/RaceState.js";
import { startRaceState } from "../src/race2/core/RaceSimulation.js";
import { raceTargetSpeedProfile } from "../src/race2/core/RaceDynamics.js";
import { advanceRaceResources } from "../src/race2/core/RaceResources.js";
import { raceOvertakeOpportunityFactors } from "../src/race2/core/RaceOvertaking.js";

const tyres=[
  {tyre_id:"hard",compound_name:"Hard",category:"dry",grip_index:72,wear_rate:0.014,warmup_time_s:2.8},
  {tyre_id:"soft",compound_name:"Soft",category:"dry",grip_index:86,wear_rate:0.029,warmup_time_s:2.1},
];
function input(){
  return {
    year:1980,schemaVersion:13,engineVersion:"rw2",weekendKey:"rw39-attribute-audit",seed:"rw39-fixed",
    entries:[{driverId:"D1",carId:"C1",teamId:"T1",status:"confirmed"},{driverId:"D2",carId:"C2",teamId:"T2",status:"confirmed"}],
    drivers:[
      {driverId:"D1",teamId:"T1",performance:{raceScore:85,overtaking:92,defending:75,aggression:74,tyreManagement:80}},
      {driverId:"D2",teamId:"T2",performance:{raceScore:70,overtaking:68,defending:80,aggression:50,tyreManagement:55}},
    ],
    cars:[
      {carId:"C1",driverId:"D1",teamId:"T1",performance:{overall:88,race:88,power:92,chassis:86,reliability:85},
       resourceSetup:{tyres,strategy:{startTyreId:"soft",paceMode:"attack"}}},
      {carId:"C2",driverId:"D2",teamId:"T2",performance:{overall:70,race:70,power:70,chassis:70,reliability:85},
       resourceSetup:{tyres,strategy:{startTyreId:"hard",paceMode:"conserve"}}},
    ],
    startingGrid:[{grid:1,driver_id:"D2",team_id:"T2"},{grid:2,driver_id:"D1",team_id:"T1"}],
    weather:{state:"SUNNY",track_temp_c:30,air_temp_c:22},
    track:{schemaVersion:2,trackId:"rw39-test",year:1980,lengthM:5000,laps:15,traits:{tyreWear:65,overtakingDifficulty:50},
      startFinish:{progress:0,distanceM:0},
      sectors:[{id:"s1",sector:1,startM:0,endM:1666,lengthM:1666},{id:"s2",sector:2,startM:1666,endM:3333,lengthM:1667},{id:"s3",sector:3,startM:3333,endM:5000,lengthM:1667}],
      speedProfile:{source:"neutral",detailed:false,sampleSpacingM:5000,windowM:null,samples:[{distanceM:0,severity:0}]},
    },
  };
}
function state(){return startRaceState(createRaceState(input(),{stepMs:100}));}
function byId(s,id){return s.cars.find(c=>c.carId===id);}
function replaceCar(s,id,changes){return {...s,cars:s.cars.map(c=>c.carId===id?{...c,...changes}:c)};}
function target(s,id){return raceTargetSpeedProfile(s,byId(s,id)).targetSpeedKmh;}
function opportunity(s){
  return raceOvertakeOpportunityFactors(s,byId(s,"C1"),byId(s,"C2"),{gapM:12,closingSpeedMs:2,towStrength:0.3});
}

test("RW39 driver and car inputs survive RaceState snapshot and affect canonical pace",()=>{
  const s=state();
  assert.equal(byId(s,"C1").performance.driver.raceScore,85);
  assert.equal(byId(s,"C1").performance.car.power,92);
  const baseline=target(s,"C1");
  const weakerDriver=replaceCar(s,"C1",{performance:{...byId(s,"C1").performance,driver:{...byId(s,"C1").performance.driver,raceScore:40}}});
  const weakerCar=replaceCar(s,"C1",{performance:{...byId(s,"C1").performance,car:{...byId(s,"C1").performance.car,power:40,race:40,chassis:40}}});
  assert.ok(baseline>target(weakerDriver,"C1"),"driver raceScore must affect effective speed");
  assert.ok(baseline>target(weakerCar,"C1"),"car power/chassis/race must affect effective speed");
});

test("RW39 tyre compound, tyre wear, thermal state, pace mode and damage each change real target pace",()=>{
  const s=state();
  const c=byId(s,"C1");
  assert.equal(c.tyre.tyre_id,"soft");
  assert.equal(byId(s,"C2").tyre.tyre_id,"hard");
  const base=target(s,"C1");
  const hard=replaceCar(s,"C1",{tyre:{...c.tyre,tyre_id:"hard",grip_index:72}});
  const worn=replaceCar(s,"C1",{tyre:{...c.tyre,condition:24,grip_multiplier:0.78}});
  const overheated=replaceCar(s,"C1",{tyre:{...c.tyre,temperature_c:(c.tyre.optimal_temperature_c??90)+45}});
  const conserve=replaceCar(s,"C1",{resources:{...c.resources,paceMode:"conserve"}});
  const damaged=replaceCar(s,"C1",{damage:{pace_loss_s_per_lap:3.0,aero_loss_pct:30,handling_loss_pct:30,braking_loss_pct:20}});
  assert.ok(base>target(hard,"C1"),"higher compound grip should increase pace");
  assert.ok(base>target(worn,"C1"),"worn tyre should reduce pace");
  assert.ok(base>target(overheated,"C1"),"overheated tyre should reduce pace");
  assert.ok(base>target(conserve,"C1"),"attack should be faster than conserve");
  assert.ok(base>target(damaged,"C1"),"damage should reduce pace");
});

test("RW39 distance produces real tyre wear and fuels performance on later steps",()=>{
  const s=state(),car=byId(s,"C1");
  const moved={...car,absoluteDistanceM:car.absoluteDistanceM+5000};
  const [advanced]=advanceRaceResources(s,[moved],{stepMs:100});
  assert.ok(advanced.tyre.condition<car.tyre.condition);
  assert.ok(advanced.tyre.age_laps>=1);
  assert.ok(advanced.fuelKg<car.fuelKg);
  assert.ok(advanced.tyre.wear_per_lap_pct>0);
});

test("RW39 battle opportunities read real driver, compound, strategy, wear and damage edges",()=>{
  const s=state(),attacker=byId(s,"C1"),defender=byId(s,"C2");
  const base=opportunity(s);
  assert.ok(base);
  assert.ok(base.contributions.driver>0,"attacking driver ability must matter");
  assert.ok(base.contributions.compound>0,"soft/hard compound grip must matter");
  assert.ok(base.contributions.strategy>0,"attack/conserve must matter");
  const worn=replaceCar(s,"C1",{tyre:{...attacker.tyre,condition:25,grip_multiplier:0.78}});
  const damaged=replaceCar(s,"C1",{damage:{pace_loss_s_per_lap:3,aero_loss_pct:30,handling_loss_pct:30}});
  assert.ok(opportunity(worn).contributions.tyreWear<base.contributions.tyreWear,"wear must change opportunity");
  assert.ok(opportunity(damaged).contributions.damage<base.contributions.damage,"damage must change opportunity");
  const strongDefender=replaceCar(s,"C2",{performance:{...defender.performance,driver:{...defender.performance.driver,defending:100}}});
  assert.ok(opportunity(strongDefender).contributions.driver<base.contributions.driver,"defending skill must matter");
});
