import test from "node:test";
import assert from "node:assert/strict";
import {
  driverDerivedRating,
  driverDerivedRatings,
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
