import test from "node:test";
import assert from "node:assert/strict";
import { combinedQualifyingPerformance, combinedRacePerformance } from "../src/domain/driverPerformance.js";
import { raceAccidentChance } from "../src/engine/GPEngine.js";
import { applyProgressionTick } from "../src/engine/ProgressionEngine.js";

const driver={driver_id:"d_1",display_name:"Driver One",dob:"1960-01-01",age:20};
const rating={
  year:1980,driver_id:"d_1",current_ability:70,potential_ability:86,
  pace:78,qualifying:76,start_launch:74,racecraft:77,wet_skill:72,
  consistency:75,tire_management:74,race_intelligence:73,technical_feedback:70,
  adaptability:72,ers_fuel_management:70,mentality:74,pressure_handling:73,
  crash_likelihood:20,
};

function gsFor(carScore=80,fatigue=0){
  return {
    activeYear:1980,
    currentDateISO:"1980-02-01",
    team:{team_id:"t_user"},
    teams:[{team_id:"t_user",team_name:"User"},{team_id:"t_ai",team_name:"AI"}],
    drivers:[driver,{...driver,driver_id:"d_2",display_name:"Veteran",dob:"1940-01-01",age:40}],
    contracts:[
      {year:1980,team_id:"t_ai",driver_id:"d_1",role:"Main Driver"},
      {year:1980,team_id:"t_ai",driver_id:"d_2",role:"Second Driver"},
    ],
    driverRatings:[
      {...rating},
      {...rating,driver_id:"d_2",current_ability:72,potential_ability:72,pace:76,qualifying:75},
    ],
    driverAttributes:{
      d_1:{confidence:50,fatigue,morale:50,preparation:50},
      d_2:{confidence:50,fatigue:0,morale:50,preparation:50},
    },
    carStats:[
      {year:1980,team_id:"t_ai",chassis_spec:carScore,aero_spec:carScore,gearbox_spec:carScore,suspension_spec:carScore,brakes_spec:carScore,cooling_spec:carScore,reliability:0.85},
    ],
    teamEngines:[
      {year:1980,team_id:"t_ai",power:carScore,reliability:80,reliability_override:0.85,chassis_integration:carScore},
    ],
    facilities:[{year:1980,team_id:"t_ai",simulator_level:5}],
    results:[],
  };
}

test("specific driver attributes and car performance affect qualifying/race scores",()=>{
  const base=gsFor(75,0);
  const goodCar=gsFor(90,0);
  const baseQ=combinedQualifyingPerformance({gs:base,driver,rating,teamId:"t_ai"});
  const goodCarQ=combinedQualifyingPerformance({gs:goodCar,driver,rating,teamId:"t_ai"});
  assert.ok(goodCarQ>baseQ,"better car should improve qualifying performance");

  const betterQuali={...rating,qualifying:90};
  assert.ok(
    combinedQualifyingPerformance({gs:base,driver,rating:betterQuali,teamId:"t_ai"})>baseQ,
    "qualifying attribute must matter directly"
  );

  const betterRace={...rating,racecraft:92,consistency:88};
  const baseR=combinedRacePerformance({gs:base,driver,rating,teamId:"t_ai"});
  assert.ok(
    combinedRacePerformance({gs:base,driver,rating:betterRace,teamId:"t_ai"})>baseR,
    "racecraft and consistency must matter directly"
  );
});

test("high fatigue lowers both qualifying and race performance",()=>{
  const fresh=gsFor(80,0);
  const tired=gsFor(80,85);
  const qFresh=combinedQualifyingPerformance({gs:fresh,driver,rating,teamId:"t_ai"});
  const qTired=combinedQualifyingPerformance({gs:tired,driver,rating,teamId:"t_ai"});
  const rFresh=combinedRacePerformance({gs:fresh,driver,rating,teamId:"t_ai"});
  const rTired=combinedRacePerformance({gs:tired,driver,rating,teamId:"t_ai"});
  assert.ok(qTired<qFresh);
  assert.ok(rTired<rFresh);
});

test("monthly progression develops young AI drivers and regresses veteran raw pace",()=>{
  const gs=gsFor(80,0);
  const beforeYoung={...gs.driverRatings[0]};
  const beforeOld={...gs.driverRatings[1]};
  const next=applyProgressionTick(gs);
  const young=next.driverRatings.find(r=>r.driver_id==="d_1");
  const old=next.driverRatings.find(r=>r.driver_id==="d_2");

  const youngChanged=["pace","qualifying","racecraft","consistency","tire_management","race_intelligence","pressure_handling","adaptability","mentality","technical_feedback"]
    .some(k=>Number(young[k])>Number(beforeYoung[k]));
  assert.ok(youngChanged,"young AI driver should receive natural/AI development");
  assert.ok(Number(young.current_ability)>=Number(beforeYoung.current_ability));

  assert.ok(Number(old.pace)<Number(beforeOld.pace),"40-year-old driver should lose raw pace");
  assert.equal(next._lastDriverProgressionMonth,"1980-02");
});

test("monthly progression only runs once per calendar month",()=>{
  const gs=gsFor(80,0);
  const first=applyProgressionTick(gs);
  const snapshot=JSON.stringify(first.driverRatings);
  const sameMonth=applyProgressionTick({...first,currentDateISO:"1980-02-15"});
  assert.equal(JSON.stringify(sameMonth.driverRatings),snapshot);
});


test("1980 uses a 15 percent neutral accident baseline with driver and fatigue modifiers",()=>{
  const neutral=gsFor(80,0);
  neutral.accidentModel=[{year:1980,damage_DNF_prob:0.16}];
  const base=raceAccidentChance(neutral,{crash_likelihood:35},"d_1");
  assert.equal(base,0.15);

  const risky=raceAccidentChance(neutral,{crash_likelihood:80},"d_1");
  assert.ok(risky>base);

  const tired=gsFor(80,90);
  tired.accidentModel=neutral.accidentModel;
  const tiredRisk=raceAccidentChance(tired,{crash_likelihood:35},"d_1");
  assert.ok(tiredRisk>base);
});

test("confidence and morale affect performance now while preparation is deferred until Practice",()=>{
  const base=gsFor(80,0);
  const driverId="d_1";
  const normal=combinedRacePerformance({gs:base,driver,rating,teamId:"t_ai"});

  const positive={
    ...base,
    driverAttributes:{
      ...base.driverAttributes,
      [driverId]:{confidence:80,morale:80,preparation:50,fatigue:0},
    },
  };
  const highPrepOnly={
    ...base,
    driverAttributes:{
      ...base.driverAttributes,
      [driverId]:{confidence:50,morale:50,preparation:100,fatigue:0},
    },
  };

  assert.ok(combinedRacePerformance({gs:positive,driver,rating,teamId:"t_ai"})>normal);
  assert.equal(
    combinedRacePerformance({gs:highPrepOnly,driver,rating,teamId:"t_ai"}),
    normal,
    "preparation should remain tracked but inactive until the Practice/GP-prep loop"
  );
});
