import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStartingRatingCalibration,
  driverOpeningAge,
  driverStartingStage,
  materializeDriverStartingRating,
  materializeMissingStartingRatings,
} from "../src/domain/driverStartingRating.js";

const peakProfile=(overrides={})=>({
  driver_id:"D1",
  display_name:"High Talent",
  development_curve:"balanced",
  peak_age:29,
  decline_start_age:35,
  peak_ability:99,
  peak_pace:99,
  peak_qualifying:99,
  peak_start_launch:97,
  peak_wet_skill:95,
  peak_racecraft:99,
  peak_consistency:98,
  peak_tire_management:96,
  peak_race_intelligence:99,
  peak_technical_feedback:97,
  peak_resource_management:96,
  peak_adaptability:97,
  peak_mentality:99,
  peak_pressure_handling:99,
  peak_leadership:98,
  peak_team_player:96,
  peak_car_development_impact:97,
  base_aggression:55,
  base_crash_likelihood:18,
  rating_confidence:"MEDIUM",
  ...overrides,
});

test("January opening age does not give a future birthday early",()=>{
  assert.equal(driverOpeningAge({dob:"1960-03-21"},1980),19);
  assert.equal(driverOpeningAge({dob:"1960-01-01"},1980),20);
});

test("pre-F1 feeder placement uses Junior / Prospect stage",()=>{
  const driver={driver_id:"D1",dob:"1960-03-21",f1_rookie_season:1984};
  assert.equal(
    driverStartingStage(driver,peakProfile(),1980,{placement:{placement:"YOUTH",age:19}}),
    "Junior / Prospect"
  );
  assert.equal(
    driverStartingStage(driver,peakProfile(),1984,{placement:null}),
    "Rookie"
  );
});

test("high latent talent materializes as promising youth, not peak-form adult",()=>{
  const rating=materializeDriverStartingRating({
    driver:{driver_id:"D1",display_name:"High Talent",dob:"1960-03-21",f1_rookie_season:1984},
    profile:peakProfile(),
    year:1980,
    placement:{driver_id:"D1",placement:"YOUTH",age:19},
  });

  assert.equal(rating.career_stage,"Junior / Prospect");
  assert.equal(rating.potential_ability,99);
  assert.ok(rating.current_ability>=60&&rating.current_ability<=65,rating.current_ability);
  assert.ok(rating.pace>=68&&rating.pace<=71,rating.pace);
  assert.ok(rating.racecraft>=54&&rating.racecraft<=57,rating.racecraft);
  assert.ok(rating.mentality>=64&&rating.mentality<=66,rating.mentality);
  assert.equal(rating.aggression,55);
  assert.equal(rating.crash_likelihood,18);
  assert.equal(rating.source,"talent_profile_starting_materializer");
  assert.equal(rating.rating_model,"D7.R2");
  assert.ok(rating.development_headroom>30);
});

test("same stage preserves talent ordering without hard-coded star overrides",()=>{
  const driver={driver_id:"D1",dob:"1960-03-21",f1_rookie_season:1984};
  const placement={driver_id:"D1",placement:"YOUTH",age:19};
  const elite=materializeDriverStartingRating({
    driver,profile:peakProfile(),year:1980,placement,
  });
  const ordinary=materializeDriverStartingRating({
    driver:{...driver,driver_id:"D2"},
    profile:peakProfile({
      driver_id:"D2",
      peak_ability:78,
      peak_pace:80,
      peak_qualifying:79,
      peak_start_launch:78,
      peak_wet_skill:76,
      peak_racecraft:78,
      peak_consistency:77,
      peak_tire_management:76,
      peak_race_intelligence:77,
      peak_technical_feedback:75,
      peak_resource_management:75,
      peak_adaptability:77,
      peak_mentality:78,
      peak_pressure_handling:77,
      peak_leadership:74,
      peak_team_player:76,
      peak_car_development_impact:74,
    }),
    year:1980,
    placement:{...placement,driver_id:"D2"},
  });
  assert.ok(elite.current_ability>ordinary.current_ability);
  assert.ok(elite.pace>ordinary.pace);
  assert.ok(elite.potential_ability>ordinary.potential_ability);
});

test("existing historical or editorial rating rows always outrank generated fallback",()=>{
  const existing={year:1980,driver_id:"D1",current_ability:77,pace:81,source:"historical_rating_snapshot_r2b"};
  const rows=materializeMissingStartingRatings({
    drivers:[{driver_id:"D1",dob:"1960-03-21"}],
    existingRatings:[existing],
    profiles:[peakProfile()],
    placements:[{driver_id:"D1",placement:"YOUTH",age:19}],
    year:1980,
  });
  assert.equal(rows.length,1);
  assert.equal(rows[0].current_ability,77);
  assert.equal(rows[0].source,"historical_rating_snapshot_r2b");
});

test("calibration falls back deterministically when no archive is supplied",()=>{
  const calibration=buildStartingRatingCalibration([]);
  assert.equal(calibration.version,"D7.R1D_CALIBRATION_V1");
  assert.equal(calibration.source_rows,0);
  assert.equal(calibration.stage_factors["Junior / Prospect"].factor_speed,0.542);
});
