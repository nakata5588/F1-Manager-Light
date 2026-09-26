import test from "node:test";
import assert from "node:assert/strict";
import {
  inferDriverWorldEntry,
  inferDriverWorldEntries,
  driverWorldStageAtYear,
  buildDriverWorldEntryAudit,
} from "../src/domain/driverWorldEntry.js";

function driver(overrides={}){
  return {
    driver_id:"d_test",
    display_name:"Test Driver",
    dob:"1960-03-21",
    career_start_year:null,
    f1_rookie_season:1984,
    ...overrides,
  };
}

test("missing career-start evidence infers world entry before F1 without forcing the debut",()=>{
  const d=driver({display_name:"Ayrton-shaped fixture"});
  const entry=inferDriverWorldEntry(d,{});

  assert.equal(entry.first_world_year,1978);
  assert.equal(entry.entry_level,"YOUTH");
  assert.equal(entry.entry_source,"inferred_from_f1_debut");
  assert.equal(entry.reference_f1_debut_year,1984);
  assert.equal(entry.reference_only.forced_future_f1_debut,false);
  assert.equal(entry.reference_only.forced_future_team,false);

  const y1980=driverWorldStageAtYear(d,entry,1980);
  assert.equal(y1980.active_world,true);
  assert.equal(y1980.stage,"YOUTH");
  assert.equal(y1980.age,19);
});

test("explicit career start outranks debut-horizon inference",()=>{
  const d=driver({
    dob:"1969-01-03",
    career_start_year:1989,
    f1_rookie_season:1991,
  });
  const entry=inferDriverWorldEntry(d,{});
  assert.equal(entry.first_world_year,1989);
  assert.equal(entry.entry_source,"legacy_career_start");
  assert.equal(entry.entry_level,"LOWER_SERIES");
});

test("specific lower-series evidence outranks a later legacy career start",()=>{
  const d=driver({
    driver_id:"d_lower",
    dob:"1970-05-01",
    career_start_year:1990,
    f1_rookie_season:1992,
  });
  const context={
    driverDevelopmentHistory:[
      {
        driver_id:"d_lower",
        event_year:1988,
        event_type:"FORMULA_3_RESULT",
        series_or_level:"FORMULA_3",
      },
    ],
  };
  const entry=inferDriverWorldEntry(d,context);
  assert.equal(entry.first_world_year,1988);
  assert.equal(entry.entry_source,"specific_pre_f1_evidence");
  assert.equal(entry.entry_confidence,"HIGH");
});

test("future-F1-derived prospect rows are corroboration, not independent world-entry evidence",()=>{
  const d=driver({driver_id:"d_future"});
  const entry=inferDriverWorldEntry(d,{
    driverYearStatus:[
      {
        driver_id:"d_future",
        year:1982,
        world_status:"PROSPECT_2Y",
        source:"derived from first future F1 record",
      },
    ],
  });
  assert.equal(entry.first_world_year,1978);
  assert.equal(entry.entry_source,"inferred_from_f1_debut");
  assert.equal(entry.evidence.first_prospect_status_year,1982);
  assert.equal(entry.evidence.prospect_status_is_future_f1_derived,true);
});

test("inference never activates a driver before age 16",()=>{
  const d=driver({
    dob:"1997-09-30",
    f1_rookie_season:2015,
  });
  const entry=inferDriverWorldEntry(d,{});
  assert.equal(entry.first_world_year,2013);
  assert.equal(entry.entry_level,"YOUTH");
  assert.ok(entry.entry_age>=15&&entry.entry_age<=16);
});

test("drivers outside their world-entry window stay absent from the active world",()=>{
  const d=driver({
    dob:"1969-01-03",
    career_start_year:1989,
    f1_rookie_season:1991,
  });
  const entry=inferDriverWorldEntry(d,{});
  const before=driverWorldStageAtYear(d,entry,1980);
  assert.equal(before.active_world,false);
  assert.equal(before.stage,"NOT_IN_WORLD");
});

test("world-entry generation is deterministic and one-to-one",()=>{
  const drivers=[
    driver({driver_id:"d_2",display_name:"Two"}),
    driver({driver_id:"d_1",display_name:"One",career_start_year:1980,f1_rookie_season:1982}),
  ];
  const a=inferDriverWorldEntries(drivers,{});
  const b=inferDriverWorldEntries(drivers,{});
  assert.deepEqual(a,b);
  assert.deepEqual(a.map(row=>row.driver_id),["d_1","d_2"]);

  const audit=buildDriverWorldEntryAudit(a,drivers,{auditYears:[1980]});
  assert.equal(audit.stage,"D7.W1");
  assert.equal(audit.authority,"analysis_only");
  assert.equal(audit.total_drivers,2);
  assert.equal(audit.resolved,2);
});
