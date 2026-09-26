import test from "node:test";
import assert from "node:assert/strict";
import {
  talentCeilingFromPercentile,
  regularizeTalentPercentile,
  inferDriverTalentProfile,
  inferDriverTalentProfiles,
  buildDriverTalentProfileAudit,
} from "../src/domain/driverTalentProfileInference.js";

function evidence(overrides={}){
  return {
    driver_id:"d_test",
    display_name:"Test Driver",
    evidence_scope:"historical_f1_results",
    sample:{starts:120,seasons:8,teams:3},
    confidence:{score:90,band:"HIGH"},
    comparative_evidence_percentiles:{
      qualifying:80,
      race:80,
      peak:80,
      consistency:80,
      composite:80,
    },
    ...overrides,
  };
}

test("percentile-to-ceiling mapping is monotonic and reserves the extreme top for extreme evidence",()=>{
  const p25=talentCeilingFromPercentile(25);
  const p50=talentCeilingFromPercentile(50);
  const p90=talentCeilingFromPercentile(90);
  const p99=talentCeilingFromPercentile(99);

  assert.ok(p25<p50);
  assert.ok(p50<p90);
  assert.ok(p90<p99);
  assert.ok(p50>=68&&p50<=76);
  assert.ok(p99>=98);
});

test("low-confidence evidence regresses extreme percentiles toward neutral",()=>{
  const high=regularizeTalentPercentile(98,90,1);
  const low=regularizeTalentPercentile(98,20,1);
  const none=regularizeTalentPercentile(98,0,1);

  assert.ok(high>low);
  assert.ok(low>50);
  assert.equal(none,50);
});

test("same overall evidence can produce different permanent talent shapes",()=>{
  const qualifier=inferDriverTalentProfile(evidence({
    driver_id:"d_q",
    comparative_evidence_percentiles:{
      qualifying:98,race:62,peak:92,consistency:68,composite:80,
    },
  }));
  const racer=inferDriverTalentProfile(evidence({
    driver_id:"d_r",
    comparative_evidence_percentiles:{
      qualifying:62,race:98,peak:92,consistency:68,composite:80,
    },
  }));

  assert.ok(qualifier.ceilings.qualifying>racer.ceilings.qualifying);
  assert.ok(racer.ceilings.racecraft>qualifier.ceilings.racecraft);
  assert.notDeepEqual(qualifier.ceilings,racer.ceilings);
});

test("directly supported attributes receive more evidence confidence than proxy-only traits",()=>{
  const profile=inferDriverTalentProfile(evidence());
  assert.ok(
    profile.attribute_confidence.pace.score>
    profile.attribute_confidence.technical_feedback.score
  );
  assert.equal(profile.attribute_confidence.pace.source,"direct");
  assert.equal(profile.attribute_confidence.technical_feedback.source,"proxy");
  assert.equal(profile.attribute_confidence.wet_skill.source,"proxy");
});

test("R1C does not invent crash or aggression tendency from generic race results",()=>{
  const profile=inferDriverTalentProfile(evidence());
  assert.equal(profile.tendencies.aggression,null);
  assert.equal(profile.tendencies.crash_likelihood,null);
  assert.equal(profile.tendencies.status,"not_inferred_from_generic_race_results");
  assert.ok(profile.inference_flags.includes("AGGRESSION_AND_CRASH_TENDENCY_NOT_INFERRED"));
});

test("R1C profile is permanent talent only and contains no current ability",()=>{
  const profile=inferDriverTalentProfile(evidence());
  assert.equal(Object.hasOwn(profile,"current_ability"),false);
  assert.equal(Object.hasOwn(profile.ceilings,"current_ability"),false);
  assert.ok(Number.isFinite(profile.peak_ability));
  assert.equal(profile.stage,"D7.R1C");
  assert.equal(profile.authority,"analysis_only");
});

test("poor samples cannot create elite ceilings from one extreme observation",()=>{
  const profile=inferDriverTalentProfile(evidence({
    confidence:{score:10,band:"INSUFFICIENT"},
    sample:{starts:1,seasons:1,teams:1},
    comparative_evidence_percentiles:{
      qualifying:100,race:100,peak:100,consistency:100,composite:100,
    },
  }));

  assert.ok(profile.peak_ability<85);
  assert.notEqual(profile.talent_band,"GENERATIONAL");
  assert.notEqual(profile.talent_band,"ELITE");
});

test("every evidence row yields exactly one deterministic candidate profile",()=>{
  const rows=[
    evidence({driver_id:"d_2",display_name:"Two"}),
    evidence({driver_id:"d_1",display_name:"One"}),
    evidence({
      driver_id:"d_3",
      display_name:"Three",
      confidence:{score:0,band:"INSUFFICIENT"},
      sample:{starts:0,seasons:0,teams:0},
      comparative_evidence_percentiles:{
        qualifying:null,race:null,peak:null,consistency:null,composite:null,
      },
    }),
  ];
  const first=inferDriverTalentProfiles(rows);
  const second=inferDriverTalentProfiles(rows);

  assert.deepEqual(first,second);
  assert.deepEqual(first.map(row=>row.driver_id),["d_1","d_2","d_3"]);
  assert.equal(first.length,3);
  assert.ok(first[2].inference_flags.includes("NO_F1_RACE_EVIDENCE"));

  const audit=buildDriverTalentProfileAudit(first);
  assert.equal(audit.stage,"D7.R1C");
  assert.equal(audit.authority,"analysis_only");
  assert.equal(audit.total_profiles,3);
});
