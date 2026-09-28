import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStartingRatingCalibration,
  driverOpeningAge,
  driverStartingStage,
  f1CareerTalentFloor,
  materializeDriverStartingRating,
  materializeMissingStartingRatings,
  repairTalentProfileFromF1Career,
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


test("full F1 career evidence repairs implausibly low latent ceilings without naming drivers",()=>{
  const weak=peakProfile({
    peak_ability:56.2,
    peak_pace:63.6,
    peak_qualifying:63.2,
    peak_racecraft:63.6,
    peak_consistency:55,
  });
  const history=[
    {year:2011,driver_id:"D1",starts:19,wins:0,podiums:0,poles:0,best_finish:10},
    {year:2012,driver_id:"D1",starts:20,wins:1,podiums:1,poles:1,best_finish:1},
    {year:2013,driver_id:"D1",starts:19,wins:0,podiums:0,poles:0,best_finish:5},
  ];
  assert.equal(f1CareerTalentFloor(history),80);
  const repaired=repairTalentProfileFromF1Career(weak,history);
  assert.equal(repaired.peak_ability,80);
  assert.ok(repaired.peak_pace>=80);
  assert.ok(repaired.peak_racecraft>=80);
  assert.equal(repaired._talent_profile_repair_source,"full_f1_career_achievement_floor");

  const rows=materializeMissingStartingRatings({
    drivers:[{driver_id:"D1",display_name:"Generic F1 Winner",dob:"1984-03-09",f1_rookie_season:2011}],
    existingRatings:[],
    profiles:[weak],
    year:2011,
    placements:[],
    historicalSnapshots:[],
    careerHistory:history,
  });
  assert.equal(rows.length,1);
  assert.ok(rows[0].current_ability>=60,rows[0].current_ability);
  assert.equal(rows[0].potential_ability,80);
  assert.ok(rows[0].potential_ability>=rows[0].current_ability);
});

test("Decline stage becomes age-sensitive instead of leaving old veterans at peak pace",()=>{
  const profile=peakProfile({
    decline_start_age:35,
    peak_ability:99,
  });
  const at35=materializeDriverStartingRating({
    driver:{driver_id:"D1",display_name:"Veteran",dob:"1985-01-01",f1_rookie_season:2005},
    profile,
    year:2020,
  });
  const at41=materializeDriverStartingRating({
    driver:{driver_id:"D1",display_name:"Veteran",dob:"1979-01-01",f1_rookie_season:2001},
    profile,
    year:2020,
  });
  assert.equal(at35.career_stage,"Decline");
  assert.equal(at41.career_stage,"Decline");
  assert.ok(at41.current_ability<at35.current_ability-5,[at35.current_ability,at41.current_ability]);
  assert.ok(at41.pace<at35.pace-10,[at35.pace,at41.pace]);
  assert.equal(at41.potential_ability,99);
});
