import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDriverTalentEvidence,
  buildDriverTalentEvidenceAudit,
} from "../src/domain/driverTalentEvidence.js";
import { __driverTalentNormalizationInternals } from "../src/domain/driverTalentNormalization.js";

const drivers=[
  {driver_id:"d_fast",display_name:"Fast Driver"},
  {driver_id:"d_slow",display_name:"Slow Driver"},
  {driver_id:"d_weak",display_name:"Weak Car Hero"},
  {driver_id:"d_strong",display_name:"Strong Car Driver"},
  {driver_id:"d_none",display_name:"No F1 Evidence"},
];

function event(year,round,classification){
  return {year,round,classification};
}

test("teammate-relative evidence rewards the better driver in the same machinery",()=>{
  const events=[
    event(1980,1,[
      {driver_id:"d_fast",team_id:"t_1",grid:1,position:1},
      {driver_id:"d_slow",team_id:"t_1",grid:4,position:4},
      {driver_id:"d_weak",team_id:"t_2",grid:2,position:2},
      {driver_id:"d_strong",team_id:"t_2",grid:3,position:3},
    ]),
    event(1980,2,[
      {driver_id:"d_fast",team_id:"t_1",grid:2,position:1},
      {driver_id:"d_slow",team_id:"t_1",grid:4,position:3},
      {driver_id:"d_weak",team_id:"t_2",grid:1,position:2},
      {driver_id:"d_strong",team_id:"t_2",grid:3,position:4},
    ]),
  ];
  const rows=buildDriverTalentEvidence({drivers,events});
  const fast=rows.find(row=>row.driver_id==="d_fast");
  const slow=rows.find(row=>row.driver_id==="d_slow");

  assert.ok(fast.raw_signals.teammate_qualifying_advantage>0);
  assert.ok(slow.raw_signals.teammate_qualifying_advantage<0);
  assert.ok(fast.raw_signals.teammate_race_advantage>slow.raw_signals.teammate_race_advantage);
  assert.ok(
    fast.comparative_evidence_percentiles.composite>
    slow.comparative_evidence_percentiles.composite
  );
});

test("car-adjusted evidence can recognize overperformance without equating finishing position with talent",()=>{
  const events=[
    event(1981,1,[
      {driver_id:"d_strong",team_id:"t_strong",grid:1,position:1},
      {driver_id:"d_weak",team_id:"t_weak",grid:2,position:2},
      {driver_id:"d_fast",team_id:"t_weak",grid:4,position:4},
      {driver_id:"d_slow",team_id:"t_strong",grid:3,position:3},
    ]),
  ];
  const carCompetitiveness=[
    {year:1981,team_id:"t_strong",qualifying_index:100,overall_competitiveness_proxy:100},
    {year:1981,team_id:"t_weak",qualifying_index:20,overall_competitiveness_proxy:20},
  ];
  const rows=buildDriverTalentEvidence({drivers,events,carCompetitiveness});
  const weak=rows.find(row=>row.driver_id==="d_weak");
  const strong=rows.find(row=>row.driver_id==="d_strong");

  assert.ok(weak.raw_signals.car_adjusted_qualifying>strong.raw_signals.car_adjusted_qualifying);
  assert.ok(weak.raw_signals.car_adjusted_race>strong.raw_signals.car_adjusted_race);
});

test("tiny samples stay low-confidence even when the observed result is excellent",()=>{
  const oneRace=buildDriverTalentEvidence({
    drivers,
    events:[
      event(1980,1,[
        {driver_id:"d_fast",team_id:"t_1",grid:1,position:1},
        {driver_id:"d_slow",team_id:"t_1",grid:2,position:2},
      ]),
    ],
    carCompetitiveness:[
      {year:1980,team_id:"t_1",qualifying_index:50,overall_competitiveness_proxy:50},
    ],
  });
  const fast=oneRace.find(row=>row.driver_id==="d_fast");
  assert.ok(fast.confidence.score<=15);
  assert.notEqual(fast.confidence.band,"HIGH");
});

test("large repeated samples can become high-confidence",()=>{
  const events=[];
  const carCompetitiveness=[];
  for(let i=0;i<70;i++){
    const year=1980+(i%7);
    events.push(event(year,i+1,[
      {driver_id:"d_fast",team_id:"t_1",grid:1,position:1},
      {driver_id:"d_slow",team_id:"t_1",grid:2,position:2},
    ]));
    if(!carCompetitiveness.some(row=>row.year===year)){
      carCompetitiveness.push({
        year,team_id:"t_1",qualifying_index:50,overall_competitiveness_proxy:50,
      });
    }
  }
  const rows=buildDriverTalentEvidence({drivers,events,carCompetitiveness});
  const fast=rows.find(row=>row.driver_id==="d_fast");
  assert.equal(fast.confidence.band,"HIGH");
});

test("DNFs are context, not automatic negative talent evidence",()=>{
  const rows=buildDriverTalentEvidence({
    drivers,
    events:[
      event(1982,1,[
        {
          driver_id:"d_fast",team_id:"t_1",grid:1,position:4,
          result_code:"R",retired:true,status:"Engine",
        },
        {driver_id:"d_slow",team_id:"t_1",grid:2,position:1},
      ]),
    ],
    carCompetitiveness:[
      {year:1982,team_id:"t_1",qualifying_index:50,overall_competitiveness_proxy:50},
    ],
  });
  const fast=rows.find(row=>row.driver_id==="d_fast");
  assert.equal(fast.sample.dnf,1);
  assert.equal(fast.raw_signals.car_adjusted_race,null);
  assert.equal(fast.raw_signals.teammate_race_advantage,null);
});

test("every canonical driver receives an evidence row, including drivers without F1 results",()=>{
  const rows=buildDriverTalentEvidence({drivers,events:[]});
  assert.equal(rows.length,drivers.length);
  const none=rows.find(row=>row.driver_id==="d_none");
  assert.equal(none.sample.starts,0);
  assert.equal(none.confidence.band,"INSUFFICIENT");
  assert.ok(none.evidence_flags.includes("NO_F1_RACE_EVIDENCE"));
});

test("R1B remains analysis-only, preserves R1A diagnostics and is deterministic",()=>{
  const input={
    drivers,
    events:[
      event(1983,1,[
        {driver_id:"d_fast",team_id:"t_1",grid:1,position:1},
        {driver_id:"d_slow",team_id:"t_1",grid:2,position:2},
      ]),
    ],
  };
  const first=buildDriverTalentEvidence(input);
  const second=buildDriverTalentEvidence(input);
  assert.deepEqual(second,first);
  assert.equal(Object.hasOwn(first[0],"ceilings"),false);
  assert.equal(Object.hasOwn(first[0],"talent_rating"),false);

  const audit=buildDriverTalentEvidenceAudit(first);
  assert.equal(audit.stage,"D7.R1B");
  assert.equal(first[0].normalization_context?.stage,"D7.R1B");
  assert.ok(first[0].r1a_comparative_evidence_percentiles);
  assert.equal(audit.authority,"analysis_only");
});


test("R1B normalizes car competitiveness by season rank rather than raw era scale",()=>{
  const {carPercentileIndex}=__driverTalentNormalizationInternals;
  const index=carPercentileIndex([
    {year:1960,team_id:"old_top",qualifying_index:100,overall_competitiveness_proxy:100},
    {year:1960,team_id:"old_mid",qualifying_index:60,overall_competitiveness_proxy:60},
    {year:1960,team_id:"old_low",qualifying_index:20,overall_competitiveness_proxy:20},
    {year:2000,team_id:"new_top",qualifying_index:10,overall_competitiveness_proxy:10},
    {year:2000,team_id:"new_mid",qualifying_index:6,overall_competitiveness_proxy:6},
    {year:2000,team_id:"new_low",qualifying_index:2,overall_competitiveness_proxy:2},
  ]);

  assert.equal(index.get("1960|old_top").qualifying,index.get("2000|new_top").qualifying);
  assert.equal(index.get("1960|old_mid").race,index.get("2000|new_mid").race);
  assert.equal(index.get("1960|old_low").qualifying,index.get("2000|new_low").qualifying);
});

test("R1B race evidence rewards front-running quality instead of requiring positions gained",()=>{
  const localDrivers=[
    {driver_id:"leader",display_name:"Leader"},
    {driver_id:"follower",display_name:"Follower"},
  ];
  const events=[];
  for(let round=1;round<=12;round++){
    events.push(event(1990,round,[
      {driver_id:"leader",team_id:"t_1",grid:1,position:1},
      {driver_id:"follower",team_id:"t_1",grid:2,position:2},
    ]));
  }
  const rows=buildDriverTalentEvidence({drivers:localDrivers,events});
  const leader=rows.find(row=>row.driver_id==="leader");
  const follower=rows.find(row=>row.driver_id==="follower");

  assert.ok(
    leader.comparative_evidence_percentiles.race>
    follower.comparative_evidence_percentiles.race,
    "P1 -> P1 should remain strong race evidence even with zero positions gained"
  );
  assert.ok(
    leader.normalization_context.season_evidence[0].race>
    follower.normalization_context.season_evidence[0].race
  );
});

test("R1B gives the same seasonal rank pattern comparable evidence across eras",()=>{
  const localDrivers=[
    {driver_id:"old_star",display_name:"Old Star"},
    {driver_id:"old_peer",display_name:"Old Peer"},
    {driver_id:"new_star",display_name:"New Star"},
    {driver_id:"new_peer",display_name:"New Peer"},
  ];
  const events=[];
  for(let round=1;round<=10;round++){
    events.push(event(1965,round,[
      {driver_id:"old_star",team_id:"old_team",grid:1,position:1},
      {driver_id:"old_peer",team_id:"old_team",grid:2,position:2},
    ]));
    events.push(event(2005,round,[
      {driver_id:"new_star",team_id:"new_team",grid:1,position:1},
      {driver_id:"new_peer",team_id:"new_team",grid:2,position:2},
    ]));
  }
  const rows=buildDriverTalentEvidence({drivers:localDrivers,events});
  const oldStar=rows.find(row=>row.driver_id==="old_star");
  const newStar=rows.find(row=>row.driver_id==="new_star");

  assert.ok(Math.abs(
    oldStar.era_normalized_percentiles.composite-
    newStar.era_normalized_percentiles.composite
  )<=1);
});

test("R1B opposition context values beating a stronger teammate more highly",()=>{
  const localDrivers=[
    {driver_id:"hero_strong",display_name:"Hero Strong"},
    {driver_id:"strong_peer",display_name:"Strong Peer"},
    {driver_id:"hero_weak",display_name:"Hero Weak"},
    {driver_id:"weak_peer",display_name:"Weak Peer"},
    {driver_id:"anchor",display_name:"Anchor"},
  ];
  const events=[];
  for(let round=1;round<=8;round++){
    events.push(event(1980,round,[
      {driver_id:"hero_strong",team_id:"team_a",grid:1,position:1},
      {driver_id:"strong_peer",team_id:"team_a",grid:2,position:2},
      {driver_id:"hero_weak",team_id:"team_b",grid:1,position:1},
      {driver_id:"weak_peer",team_id:"team_b",grid:2,position:2},
    ]));
  }
  for(let round=9;round<=16;round++){
    events.push(event(1980,round,[
      {driver_id:"strong_peer",team_id:"team_c",grid:1,position:1},
      {driver_id:"anchor",team_id:"team_c",grid:2,position:2},
      {driver_id:"anchor",team_id:"team_d",grid:1,position:1},
      {driver_id:"weak_peer",team_id:"team_d",grid:2,position:2},
    ]));
  }
  const rows=buildDriverTalentEvidence({drivers:localDrivers,events});
  const strong=rows.find(row=>row.driver_id==="hero_strong");
  const weak=rows.find(row=>row.driver_id==="hero_weak");

  assert.ok(
    strong.opposition_context.average_teammate_strength>
    weak.opposition_context.average_teammate_strength
  );
  assert.ok(
    strong.comparative_evidence_percentiles.qualifying>=
    weak.comparative_evidence_percentiles.qualifying
  );
});
