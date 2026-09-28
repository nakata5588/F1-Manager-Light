import test from "node:test";
import assert from "node:assert/strict";
import {
  normaliseRaceCarDamage,
  raceCarDamageSummary,
  raceCarEraForYear,
} from "../src/domain/raceCarVisual.js";

test("Cars Visuals 4.0A selects the 1980 ground-effect family for the target era",()=>{
  assert.equal(raceCarEraForYear(1976),"generic");
  assert.equal(raceCarEraForYear(1977),"ground_effect_1980");
  assert.equal(raceCarEraForYear(1980),"ground_effect_1980");
  assert.equal(raceCarEraForYear(1982),"ground_effect_1980");
  assert.equal(raceCarEraForYear(1983),"generic");
});

test("Cars Visuals 4.0A normalises authoritative race damage without changing physics",()=>{
  const damage={
    components:{
      front_wing:{damage_pct:72.4},
      floor:{damage_pct:38},
      suspension:{damage_pct:12.5},
    },
    overall_damage_pct:58.2,
    severity:"moderate",
    pace_loss_s_per_lap:0.842,
    can_continue:true,
  };
  const values=normaliseRaceCarDamage(damage);
  assert.equal(values.front_wing,72.4);
  assert.equal(values.floor,38);
  assert.equal(values.rear_wing,0);

  const summary=raceCarDamageSummary(damage);
  assert.equal(summary.overall_damage_pct,58.2);
  assert.equal(summary.severity,"moderate");
  assert.equal(summary.pace_loss_s_per_lap,0.842);
  assert.deepEqual(
    summary.damaged_components.map((row)=>row.component),
    ["front_wing","floor","suspension"]
  );
});

test("Cars Visuals 4.0A derives a stable summary when only component damage exists",()=>{
  const summary=raceCarDamageSummary({
    components:{
      rear_wing:80,
      cooling:{damage_pct:20},
    },
  });
  assert.equal(summary.damaged_components[0].component,"rear_wing");
  assert.equal(summary.damaged_components[0].severity,"major");
  assert.ok(summary.overall_damage_pct>0);
  assert.equal(summary.can_continue,true);
});
