import test from "node:test";
import assert from "node:assert/strict";

import {
  REGULATION_VOTE_MIN_LEAD_SEASONS,
  approveFutureTechnicalRegulationChange,
  approvedTechnicalRegulationChanges,
  minimumRegulationVoteEffectiveSeason,
  nextSeasonRegulationImpact,
  regulationImpactAreaSummary,
  regulationVoteTiming,
  technicalRegulationSnapshot,
  validateRegulationVoteProposal,
} from "../src/domain/nextSeasonRegulations.js";

function fixture(year=1980){
  return {
    activeYear:year,
    currentDateISO:`${year}-06-01`,
    team:{team_id:"PLAYER"},
    standings:{teams:[{team_id:"PLAYER",position:5,points:20}]},
    historySeasons:[],
    regulationGovernance:{version:1,votes:[],approved_changes:[]},
  };
}

test("regulation votes can never take effect for the immediately following season",()=>{
  const gs=fixture(1980);
  assert.equal(REGULATION_VOTE_MIN_LEAD_SEASONS,2);
  assert.equal(minimumRegulationVoteEffectiveSeason(1980),1982);

  const nextSeason=validateRegulationVoteProposal(gs,{effective_season:1981});
  assert.equal(nextSeason.allowed,false);
  assert.equal(nextSeason.reason,"next_season_rules_locked");
  assert.equal(nextSeason.minimum_effective_season,1982);

  const later=validateRegulationVoteProposal(gs,{effective_season:1982});
  assert.equal(later.allowed,true);
  assert.equal(later.lead_seasons,2);
});

test("approved career regulation changes enforce the same lead-time guard at write and read time",()=>{
  const gs=fixture(1980);
  const rejected=approveFutureTechnicalRegulationChange(gs,{
    id:"too_soon",
    effective_season:1981,
    title:"Late aero rewrite",
    severity:"major",
    areas:["aero"],
  });
  assert.deepEqual(rejected,gs);

  const approved=approveFutureTechnicalRegulationChange(gs,{
    id:"future_aero",
    effective_season:1982,
    title:"Future aero rewrite",
    severity:"major",
    areas:["aero","chassis"],
  });
  assert.equal(approved.regulationGovernance.approved_changes.length,1);
  assert.equal(approved.regulationGovernance.approved_changes[0].approved_season,1980);

  const target=approvedTechnicalRegulationChanges(approved,1982);
  assert.equal(target.length,1);
  assert.equal(target[0].id,"future_aero");

  const malformed={
    ...approved,
    regulationGovernance:{
      ...approved.regulationGovernance,
      approved_changes:[
        ...approved.regulationGovernance.approved_changes,
        {id:"malformed",approved_season:1980,effective_season:1981,severity:"major",areas:["powertrain"]},
      ],
    },
  };
  assert.equal(approvedTechnicalRegulationChanges(malformed,1981).length,0);
});

test("the next-season ruleset is explicitly locked against new current-season votes",()=>{
  const impact=nextSeasonRegulationImpact(fixture(1980),{targetSeason:1981});
  assert.equal(impact.governance.next_season_locked,true);
  assert.equal(impact.governance.minimum_vote_effective_season,1982);
  assert.match(impact.governance.note,/1981 car rules are locked/i);

  const timing=regulationVoteTiming(1980,1981);
  assert.equal(timing.allowed,false);
});

test("stable adjacent seasons produce no regulation-reset penalty",()=>{
  const impact=nextSeasonRegulationImpact(fixture(1980),{targetSeason:1981});
  assert.equal(impact.severity,"none");
  assert.equal(impact.label,"Stable");
  assert.equal(impact.changes.length,0);
  for(const row of Object.values(impact.knowledge_retention)){
    assert.equal(row.percent,100);
  }
});

test("structural component changes are detected from the era-aware component catalogue",()=>{
  const impact=nextSeasonRegulationImpact(fixture(1988),{targetSeason:1989});
  assert.equal(impact.severity,"medium");
  assert.ok(impact.changes.some((change)=>change.type==="component_removed"&&/turbocharger/i.test(change.title)));
  assert.equal(impact.knowledge_retention.powertrain.percent,72);

  const current=technicalRegulationSnapshot(fixture(1988),1988);
  const future=technicalRegulationSnapshot(fixture(1988),1989);
  assert.ok(current.components.some((row)=>row.slot==="turbocharger"));
  assert.equal(future.components.some((row)=>row.slot==="turbocharger"),false);
});

test("large multi-area structural transitions can produce a Major regulation impact",()=>{
  const impact=nextSeasonRegulationImpact(fixture(2013),{targetSeason:2014});
  assert.equal(impact.severity,"major");
  assert.ok(impact.changes.some((change)=>change.type==="aero_testing_changed"));
  assert.ok(impact.changes.some((change)=>change.type==="component_added"));
  assert.ok(regulationImpactAreaSummary(impact).length>=2);
});

test("approved future career rules contribute only when they become effective",()=>{
  let gs=fixture(1980);
  gs=approveFutureTechnicalRegulationChange(gs,{
    id:"1982_chassis",
    effective_season:1982,
    title:"Chassis dimensional package",
    summary:"A future voted structural package.",
    severity:"medium",
    areas:["chassis"],
  });

  const next=nextSeasonRegulationImpact(gs,{targetSeason:1981});
  assert.equal(next.changes.some((change)=>change.id==="1982_chassis"),false);

  const future=nextSeasonRegulationImpact(gs,{targetSeason:1982});
  assert.ok(future.changes.some((change)=>change.id==="1982_chassis"));
  assert.ok(future.knowledge_retention.chassis.percent<100);
});
