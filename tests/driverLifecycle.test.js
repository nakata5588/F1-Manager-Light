import test from "node:test";
import assert from "node:assert/strict";
import {
  driverLifecycleSnapshot,
  driverMonthlyCareerDevelopmentPlan,
  driverPreviousMonthPerformance,
} from "../src/domain/driverLifecycle.js";
import { applyProgressionTick } from "../src/engine/ProgressionEngine.js";

const rating={
  year:1980,
  driver_id:"D1",
  current_ability:78,
  potential_ability:86,
  pace:82,
  qualifying:80,
  start_launch:78,
  racecraft:80,
  wet_skill:76,
  consistency:79,
  tire_management:77,
  race_intelligence:80,
  technical_feedback:74,
  adaptability:77,
  ers_fuel_management:74,
  mentality:79,
  pressure_handling:79,
  crash_likelihood:18,
};

function state(overrides={}){
  return {
    activeYear:1980,
    currentDateISO:"1980-02-01",
    careerMeta:{sourceSeason:1980},
    team:{team_id:"T1",team_name:"Player Team"},
    drivers:[{driver_id:"D1",display_name:"Driver One",age:28,f1_rookie_season:1978}],
    driverRatings:[{...rating}],
    contracts:[{year:1980,driver_id:"D1",team_id:"T1",role:"Main Driver",status:"active",contract_until_year:1981}],
    facilities:[{year:1980,team_id:"T1",simulator_level:5}],
    driverAttributes:{D1:{confidence:50,fatigue:0,morale:50,preparation:50}},
    driverPerformanceLog:{},
    driverForm:{},
    driverAttrLog:{},
    medicalHistory:[],
    results:[],
    ...overrides,
  };
}

test("lifecycle supports youth, rookie, developing, prime, veteran, decline and retirement window",()=>{
  const youth=driverLifecycleSnapshot(
    state({drivers:[{driver_id:"D1",age:18}],driverRatings:[{...rating,current_ability:62,potential_ability:85}]}),
    "D1"
  );
  assert.equal(youth.stage,"youth");

  const rookieState=state({
    drivers:[{driver_id:"D1",age:22}],
    results:[{year:1980,dateISO:"1980-01-15",classification:[{driver_id:"D1",position:8}]}],
  });
  assert.equal(driverLifecycleSnapshot(rookieState,"D1").stage,"rookie");

  const developing=driverLifecycleSnapshot(
    state({
      drivers:[{driver_id:"D1",age:29,f1_rookie_season:1978}],
      driverRatings:[{...rating,current_ability:76,potential_ability:88}],
      driverForm:{D1:{score:80,label:"Strong",sample:5}},
    }),
    "D1"
  );
  assert.equal(developing.stage,"developing");

  const prime=driverLifecycleSnapshot(
    state({
      drivers:[{driver_id:"D1",age:27,f1_rookie_season:1977}],
      driverRatings:[{...rating,current_ability:83,potential_ability:84}],
      driverForm:{D1:{score:72,label:"Good",sample:5}},
    }),
    "D1"
  );
  assert.equal(prime.stage,"prime");

  const veteran=driverLifecycleSnapshot(
    state({
      drivers:[{driver_id:"D1",age:35,f1_rookie_season:1970}],
      driverForm:{D1:{score:80,label:"Strong",sample:5}},
    }),
    "D1"
  );
  assert.equal(veteran.stage,"veteran","strong older drivers should not be forced into decline");

  const declining=driverLifecycleSnapshot(
    state({
      drivers:[{driver_id:"D1",age:35,f1_rookie_season:1970}],
      driverForm:{D1:{score:46,label:"Poor",sample:5}},
      driverAttrLog:{D1:[
        {dateISO:"1980-01-10",attr:"pace",delta:-0.3},
        {dateISO:"1980-01-20",attr:"consistency",delta:-0.2},
      ]},
    }),
    "D1"
  );
  assert.equal(declining.stage,"decline");

  const retirement=driverLifecycleSnapshot(
    state({drivers:[{driver_id:"D1",age:40,f1_rookie_season:1965}]}),
    "D1"
  );
  assert.equal(retirement.stage,"retirement_window");
});

test("age does not create negative development pressure for young drivers",()=>{
  const young=driverLifecycleSnapshot(
    state({
      drivers:[{driver_id:"D1",age:23,f1_rookie_season:1980}],
      driverRatings:[{...rating,current_ability:72,potential_ability:86}],
      driverForm:{D1:{score:70,label:"Good",sample:3}},
    }),
    "D1"
  );
  assert.equal(young.negativeFactors.some((row)=>row.key==="age"),false);

  const plateau=driverLifecycleSnapshot(
    state({
      drivers:[{driver_id:"D1",age:34,f1_rookie_season:1978}],
      driverForm:{D1:{score:70,label:"Good",sample:5}},
    }),
    "D1"
  );
  assert.equal(plateau.negativeFactors.some((row)=>row.key==="age"),false);

  const older=driverLifecycleSnapshot(
    state({
      drivers:[{driver_id:"D1",age:35,f1_rookie_season:1975}],
      driverForm:{D1:{score:70,label:"Good",sample:5}},
    }),
    "D1"
  );
  assert.ok(older.negativeFactors.some((row)=>row.key==="age"));
});

test("previous-month development plan can regress attributes after sustained poor form and driver errors",()=>{
  const gs=state({
    driverPerformanceLog:{D1:[
      {dateISO:"1980-01-10",score:45,finish_position:12,retired:true,retirement_responsibility:"driver_error"},
      {dateISO:"1980-01-24",score:50,finish_position:9,retired:false,retirement_responsibility:null},
    ]},
  });
  const summary=driverPreviousMonthPerformance(gs,"D1","1980-02-01");
  assert.equal(summary.starts,2);
  assert.equal(summary.driverErrors,1);
  assert.equal(summary.averageScore,47.5);

  const plan=driverMonthlyCareerDevelopmentPlan(gs,"D1",rating,"1980-02-01");
  assert.ok(plan.changes.some((row)=>row.attr==="mentality"&&row.delta<0));
  assert.ok(plan.changes.some((row)=>row.attr==="consistency"&&row.delta<0));
  assert.ok(plan.changes.some((row)=>row.attr==="crash_likelihood"&&row.delta>0));
  assert.ok(plan.reasons.some((reason)=>/Poor monthly Form/.test(reason)));
  assert.ok(plan.reasons.some((reason)=>/driver-error/.test(reason)));
});

test("mechanical DNF never creates permanent driver regression by itself",()=>{
  const gs=state({
    driverPerformanceLog:{D1:[
      {dateISO:"1980-01-10",score:66,retired:true,retirement_responsibility:"mechanical"},
    ]},
  });
  const plan=driverMonthlyCareerDevelopmentPlan(gs,"D1",rating,"1980-02-01");
  assert.equal(plan.mechanicalDnfsIgnored,1);
  assert.equal(plan.changes.some((row)=>Number(row.delta)<0),false);
  assert.equal(plan.changes.some((row)=>row.source==="driver_error_regression"),false);
});

test("serious injury causes a one-time permanent setback in the following month",()=>{
  const gs=state({
    medicalHistory:[{
      driver_id:"D1",
      date:"1980-01-18",
      outcome:"injury",
      injury_severity:"serious",
      injury_reason:"leg fracture",
    }],
  });
  const feb=driverMonthlyCareerDevelopmentPlan(gs,"D1",rating,"1980-02-01");
  assert.ok(feb.changes.some((row)=>row.source==="injury_regression"&&row.attr==="pace"&&row.delta<0));

  const mar=driverMonthlyCareerDevelopmentPlan({...gs,currentDateISO:"1980-03-01"},"D1",rating,"1980-03-01");
  assert.equal(mar.changes.some((row)=>row.source==="injury_regression"),false);
});

test("negative permanent attributes flow through the weighted model and lower Current Ability",()=>{
  const gs=state({
    _lastDriverProgressionMonth:"1980-01",
    drivers:[{driver_id:"D1",display_name:"Driver One",age:30,f1_rookie_season:1978}],
    driverForm:{D1:{score:43,label:"Very Poor",sample:3}},
    driverPerformanceLog:{D1:[
      {dateISO:"1980-01-05",score:42,retired:true,retirement_responsibility:"driver_error"},
      {dateISO:"1980-01-12",score:44,retired:true,retirement_responsibility:"driver_error"},
      {dateISO:"1980-01-26",score:43,retired:false,finish_position:14,retirement_responsibility:null},
    ]},
  });

  const next=applyProgressionTick(gs);
  const after=next.driverRatings.find((row)=>row.driver_id==="D1");
  assert.ok(after.current_ability<78,`expected live OVR below 78, got ${after.current_ability}`);
  assert.ok(after.consistency<79);
  assert.ok(after.mentality<79);
  assert.ok(after.crash_likelihood>18);
  assert.ok(next.driverAbilityLog.D1.at(-1).delta<0);
  assert.ok(next.driverLifecycle.D1);
});

test("the same January incident is not applied again in March",()=>{
  const januaryIncident={
    dateISO:"1980-01-12",
    score:44,
    retired:true,
    retirement_responsibility:"driver_error",
  };
  const feb=driverMonthlyCareerDevelopmentPlan(
    state({driverPerformanceLog:{D1:[januaryIncident]}}),
    "D1",
    rating,
    "1980-02-01"
  );
  const mar=driverMonthlyCareerDevelopmentPlan(
    state({currentDateISO:"1980-03-01",driverPerformanceLog:{D1:[januaryIncident]}}),
    "D1",
    rating,
    "1980-03-01"
  );
  assert.ok(feb.changes.some((row)=>row.source==="driver_error_regression"));
  assert.equal(mar.changes.some((row)=>row.source==="driver_error_regression"),false);
});
