import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDriverTalentEvidence,
  buildDriverTalentEvidenceAudit,
} from "../src/domain/driverTalentEvidence.js";

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

test("R1A remains analysis-only and deterministic",()=>{
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
  assert.equal(audit.stage,"D7.R1A");
  assert.equal(audit.authority,"analysis_only");
});
