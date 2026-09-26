import test from "node:test";
import assert from "node:assert/strict";
import { inferDriverFeederPlacement } from "../src/domain/driverFeederPlacement.js";

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
