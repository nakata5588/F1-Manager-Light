import test from "node:test";
import assert from "node:assert/strict";
import {
  driverDerivedRating,
  driverDerivedRatings,
  driverMistakePropensity,
} from "../src/domain/driverDerivedRatings.js";

const attrs={
  racecraft:80,
  aggression:70,
  race_intelligence:60,
  pressure_handling:90,
  consistency:75,
  mentality:85,
  technical_feedback:90,
  adaptability:50,
  leadership:80,
  car_development_impact:70,
  crash_likelihood:20,
};

test("derived ratings reproduce the agreed composite weights",()=>{
  const ratings=driverDerivedRatings(attrs);
  assert.equal(ratings.overtaking.value,74);
  assert.equal(ratings.defending.value,78.8);
  assert.equal(ratings.strategy_intelligence.value,69.3);
  assert.equal(ratings.setup_feedback.value,81);
  assert.equal(ratings.development_impact.value,78);
});

test("derived ratings accept the legacy agression field spelling",()=>{
  const value=driverDerivedRating({...attrs,aggression:undefined,agression:70},"overtaking");
  assert.equal(value,74);
});

test("derived ratings do not fabricate values when a required input is missing",()=>{
  const value=driverDerivedRating({...attrs,pressure_handling:undefined},"overtaking");
  assert.equal(value,null);
});

test("unknown derived rating keys return null",()=>{
  assert.equal(driverDerivedRating(attrs,"not_a_rating"),null);
});


test("consistent intelligent low-risk driver has low Mistake Propensity",()=>{
  const result=driverMistakePropensity({
    racecraft:92,
    aggression:70,
    race_intelligence:94,
    pressure_handling:93,
    consistency:95,
    mentality:90,
    adaptability:92,
    crash_likelihood:8,
  });
  assert.ok(result.value<15);
  assert.equal(result.value,result.baseline);
});

test("inconsistent high-crash driver has high Mistake Propensity",()=>{
  const result=driverMistakePropensity({
    racecraft:35,
    aggression:100,
    race_intelligence:25,
    pressure_handling:30,
    consistency:20,
    mentality:30,
    adaptability:35,
    crash_likelihood:95,
  });
  assert.ok(result.value>75);
});

test("mechanical and ambiguous DNFs do not worsen Mistake Propensity",()=>{
  const baseline=driverMistakePropensity(attrs);
  const withMechanical=driverMistakePropensity(attrs,{performanceEntries:[
    {dateISO:"1980-05-01",retired:true,retirement_reason:"Engine",retirement_responsibility:"mechanical"},
    {dateISO:"1980-04-01",retired:true,retirement_reason:"Retired",retirement_responsibility:"unknown"},
  ]});
  assert.equal(withMechanical.value,baseline.value);
  assert.equal(withMechanical.evidenceAdjustment,0);
});

test("confirmed driver errors raise propensity but one incident is strongly regressed",()=>{
  const baseline=driverMistakePropensity(attrs);
  const oneError=driverMistakePropensity(attrs,{performanceEntries:[
    {dateISO:"1980-05-01",retired:true,incident_responsibility:"driver_error"},
  ]});
  const repeated=driverMistakePropensity(attrs,{performanceEntries:[
    {dateISO:"1980-05-01",retired:true,incident_responsibility:"driver_error"},
    {dateISO:"1980-04-01",retired:false,incident_kind:"spin",incident_responsibility:"driver_error"},
    {dateISO:"1980-03-01",retired:true,incident_responsibility:"driver_error"},
    {dateISO:"1980-02-01",retired:true,incident_responsibility:"driver_error"},
  ]});
  assert.ok(oneError.value>baseline.value);
  assert.ok(oneError.value-baseline.value<4);
  assert.ok(repeated.value>oneError.value);
  assert.ok(repeated.evidenceAdjustment<=10);
});

test("Mistake Propensity accepts legacy agression and remains deterministic",()=>{
  const legacy={...attrs,aggression:undefined,agression:95};
  const entries=[
    {dateISO:"1980-03-01",retired:false},
    {dateISO:"1980-04-01",retired:true,incident_responsibility:"driver_error"},
  ];
  const a=driverMistakePropensity(legacy,{performanceEntries:entries});
  const b=driverMistakePropensity(legacy,{performanceEntries:[...entries].reverse()});
  assert.equal(a.value,b.value);
  assert.equal(a.evidenceAdjustment,b.evidenceAdjustment);
});


test("null and blank required attributes keep Mistake Propensity unavailable",()=>{
  const nullProfile={
    racecraft:null,
    aggression:null,
    race_intelligence:null,
    pressure_handling:null,
    consistency:null,
    mentality:null,
    adaptability:null,
    crash_likelihood:null,
  };
  const blankProfile={
    ...attrs,
    consistency:"",
  };

  assert.equal(driverMistakePropensity(nullProfile).value,null);
  assert.equal(driverMistakePropensity(blankProfile).value,null);
  assert.equal(driverDerivedRating({...attrs,racecraft:null},"overtaking"),null);
});
