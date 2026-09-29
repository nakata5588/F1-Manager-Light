import test from "node:test";
import assert from "node:assert/strict";
import { inferDriverFeederPlacement, inferDriverFeederPlacements, feederPlacementRuntimePatch } from "../src/domain/driverFeederPlacement.js";

function driver(overrides={}){
  return {
    driver_id:"d_test",
    display_name:"Test Driver",
    dob:"1960-03-21",
    ...overrides,
  };
}
function entry(overrides={}){
  return {
    driver_id:"d_test",
    display_name:"Test Driver",
    first_world_year:1978,
    reference_f1_debut_year:1984,
    reference_f1_last_year:1994,
    ...overrides,
  };
}

test("young pre-F1 drivers are Youth and academy-only",()=>{
  const row=inferDriverFeederPlacement(driver(),entry(),1980);
  assert.equal(row.placement,"YOUTH");
  assert.equal(row.age,19);
  assert.equal(row.can_hire_academy,true);
  assert.equal(row.can_hire_f1,false);
  assert.equal(row.market_policy,"ACADEMY_ONLY");
  assert.equal(row.uncertainty,"HIGH");
});

test("older driver one year from reference debut is F1-ready",()=>{
  const d=driver({dob:"1956-12-23"});
  const e=entry({first_world_year:1975,reference_f1_debut_year:1981,reference_f1_last_year:1994});
  const row=inferDriverFeederPlacement(d,e,1980);
  assert.equal(row.placement,"F1_READY");
  assert.equal(row.can_hire_f1,true);
  assert.equal(row.forced_future_f1_debut,false);
});

test("older driver several years from reference debut remains Lower Series",()=>{
  const d=driver({dob:"1959-02-11"});
  const e=entry({first_world_year:1976,reference_f1_debut_year:1982,reference_f1_last_year:1995});
  const row=inferDriverFeederPlacement(d,e,1980);
  assert.equal(row.placement,"LOWER_SERIES");
  assert.equal(row.can_hire_f1,true);
  assert.equal(row.scouting_profile,"STANDARD_OR_DEEP");
});

test("drivers not yet in the active world are unavailable",()=>{
  const d=driver({dob:"1969-01-03"});
  const e=entry({first_world_year:1989,reference_f1_debut_year:1991,reference_f1_last_year:2012});
  const row=inferDriverFeederPlacement(d,e,1980);
  assert.equal(row.placement,"NOT_IN_WORLD");
  assert.equal(row.scoutable,false);
  assert.equal(row.can_hire_f1,false);
});

test("historical F1-window drivers delegate exact status to Opening State",()=>{
  const d=driver({dob:"1955-02-24"});
  const e=entry({first_world_year:1976,reference_f1_debut_year:1980,reference_f1_last_year:1993});
  const row=inferDriverFeederPlacement(d,e,1980);
  assert.equal(row.placement,"HISTORICAL_OPENING_STATE");
  assert.equal(row.market_policy,"DELEGATE_TO_OPENING_STATE");
  assert.equal(row.can_hire_f1,null);
});

test("career-ended drivers stay out of feeder placement",()=>{
  const d=driver({dob:"1940-01-01"});
  const e=entry({first_world_year:1960,reference_f1_debut_year:1962,reference_f1_last_year:1975});
  const row=inferDriverFeederPlacement(d,e,1980);
  assert.equal(row.placement,"RETIRED_REFERENCE");
  assert.equal(row.scoutable,false);
});


test("W3 runtime patch converts generic feeder placement into existing market flags",()=>{
  const youth=feederPlacementRuntimePatch(
    inferDriverFeederPlacement(driver(),entry(),1980)
  );
  assert.equal(youth.status,"junior_only");
  assert.equal(youth.age,19);
  assert.equal(youth.active_lower_series,true);
  assert.equal(youth.canHireAcademy,true);
  assert.equal(youth.canHireF1,false);
  assert.equal(youth.feeder_placement,"YOUTH");

  const ready=feederPlacementRuntimePatch(
    inferDriverFeederPlacement(
      driver({dob:"1956-12-23"}),
      entry({first_world_year:1975,reference_f1_debut_year:1981,reference_f1_last_year:1994}),
      1980
    )
  );
  assert.equal(ready.status,"lower_series");
  assert.equal(ready.lower_series_name,"F1 Ready");
  assert.equal(ready.canHireF1,true);
  assert.equal(ready.feeder_placement,"F1_READY");
});


test("feeder placement unwraps exported Excel value objects for identity matching",()=>{
  const d=driver({
    driver_id:{formula:"=\"d_wrapped\"",result:{text:"d_wrapped"}},
    display_name:{value:"Wrapped Driver"},
    dob:{value:"1960-03-21"},
  });
  const e=entry({
    driver_id:{formula:"=\"d_wrapped\"",result:{text:"d_wrapped"}},
    display_name:{value:"Wrapped Driver"},
    first_world_year:{value:1978},
    reference_f1_debut_year:{value:1984},
    reference_f1_last_year:{value:1994},
  });
  const rows=inferDriverFeederPlacements([d],[e],1980);
  assert.equal(rows.length,1);
  assert.equal(rows[0].driver_id,"d_wrapped");
  assert.notEqual(rows[0].driver_id,"[object Object]");
});


test("F1-ready opening placement resolves the unique active level-2 series",()=>{
  const d=driver({dob:"1956-12-23"});
  const e=entry({first_world_year:1975,reference_f1_debut_year:1981,reference_f1_last_year:1994});
  const row=inferDriverFeederPlacement(d,e,1980,{
    series:[
      {series_id:"s_f2_old",series_name:"European Formula Two Championship",short_name:"F2",series_level:2,start_year:1967,end_year:1984},
      {series_id:"s_bf3",series_name:"British Formula Three",short_name:"BF3",series_level:3,start_year:1951,end_year:2014},
    ],
    seriesRules:[],
    driverCareer:[],
  });
  assert.equal(row.placement,"F1_READY");
  assert.equal(row.series_id,"s_f2_old");
  assert.equal(row.series_level,2);
  assert.equal(row.series_resolution,"single_active_eligible_series");

  const runtime=feederPlacementRuntimePatch(row);
  assert.equal(runtime.lower_series_id,"s_f2_old");
  assert.equal(runtime.lower_series_name,"European Formula Two Championship");
  assert.equal(runtime.lower_series_level,2);
});

test("same-level ambiguity remains a candidate pool instead of inventing a championship",()=>{
  const d=driver({dob:"1958-01-01"});
  const e=entry({first_world_year:1976,reference_f1_debut_year:1982,reference_f1_last_year:1992});
  const row=inferDriverFeederPlacement(d,e,1980,{
    series:[
      {series_id:"s_a",series_name:"Series A",series_level:2,start_year:1970,end_year:1990},
      {series_id:"s_b",series_name:"Series B",series_level:2,start_year:1970,end_year:1990},
    ],
    seriesRules:[],
    driverCareer:[],
  });
  assert.equal(row.placement,"LOWER_SERIES");
  assert.equal(row.series_id,null);
  assert.equal(row.series_level,2);
  assert.equal(row.series_resolution,"candidate_pool");
  assert.deepEqual(row.series_candidates.map((candidate)=>candidate.series_id),["s_a","s_b"]);
});

test("documented age limits remove an inferred series candidate",()=>{
  const d=driver({dob:"1955-01-01"});
  const e=entry({first_world_year:1974,reference_f1_debut_year:1982,reference_f1_last_year:1992});
  const row=inferDriverFeederPlacement(d,e,1980,{
    series:[
      {series_id:"s_level2",series_name:"Level Two",series_level:2,start_year:1970,end_year:1990},
    ],
    seriesRules:[
      {series_rule_id:"rule",series_id:"s_level2",valid_from:1970,valid_to:1990,max_age:23},
    ],
    driverCareer:[
      {driver_id:"d_test",year:1980,series_division:"F2"},
    ],
  });
  assert.equal(row.series_id,null);
  assert.equal(row.series_level,2);
  assert.equal(row.series_resolution,"no_catalog_match");
});

test("exact opening career series_id is preserved even when several series share a level",()=>{
  const d=driver({dob:"1958-01-01"});
  const e=entry({first_world_year:1976,reference_f1_debut_year:1983,reference_f1_last_year:1992});
  const row=inferDriverFeederPlacement(d,e,1980,{
    series:[
      {series_id:"s_a",series_name:"Series A",series_level:3,start_year:1970,end_year:1990},
      {series_id:"s_b",series_name:"Series B",series_level:3,start_year:1970,end_year:1990},
    ],
    seriesRules:[],
    driverCareer:[
      {driver_id:"d_test",year:1980,series_id:"s_b",series_division:"F3"},
    ],
  });
  assert.equal(row.series_id,"s_b");
  assert.equal(row.series_name,"Series B");
  assert.equal(row.series_resolution,"historical_series_id");
  assert.equal(row.forced_future_series,false);
});
