import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  buildDriverTalentEvidence,
} from "../src/domain/driverTalentEvidence.js";
import {
  inferDriverTalentProfiles,
  buildDriverTalentProfileAudit,
} from "../src/domain/driverTalentProfileInference.js";

const root=process.cwd();
const dataDir=path.join(root,"public","data");

async function readJson(name,fallback=[]){
  try{return JSON.parse(await fs.readFile(path.join(dataDir,name),"utf8"));}
  catch{return fallback;}
}
const norm=(value)=>String(value||"").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"").trim();

test("real historical population produces one candidate Talent Profile per canonical driver",async(t)=>{
  const [drivers,events,carCompetitiveness,careerRows]=await Promise.all([
    readJson("drivers.json",[]),
    readJson("race_results_archive.json",[]),
    readJson("car_competitiveness_by_year.json",[]),
    readJson("driver_career.json",[]),
  ]);
  if(!events.length){
    t.skip("race_results_archive.json is derived; run season generation before this real-data test");
    return;
  }

  const evidence=buildDriverTalentEvidence({drivers,events,carCompetitiveness,careerRows});
  const profiles=inferDriverTalentProfiles(evidence);
  assert.equal(profiles.length,drivers.length);
  assert.equal(new Set(profiles.map(row=>row.driver_id)).size,profiles.length);

  for(const profile of profiles){
    assert.equal(profile.stage,"D7.R1C");
    assert.equal(profile.authority,"analysis_only");
    assert.equal(Object.hasOwn(profile,"current_ability"),false);
    assert.equal(profile.tendencies.crash_likelihood,null);
    assert.equal(profile.tendencies.aggression,null);
    assert.ok(Number.isFinite(profile.peak_ability));
  }

  const audit=buildDriverTalentProfileAudit(profiles);
  assert.equal(audit.total_profiles,drivers.length);
  assert.ok(audit.profiles_with_f1_starts>100);
  assert.ok(audit.top_profiles.length>0);
});

test("historical star sentinels emerge as high-talent candidate profiles without hand-authored overrides",async(t)=>{
  const [drivers,events,carCompetitiveness,careerRows]=await Promise.all([
    readJson("drivers.json",[]),
    readJson("race_results_archive.json",[]),
    readJson("car_competitiveness_by_year.json",[]),
    readJson("driver_career.json",[]),
  ]);
  if(!events.length){
    t.skip("race_results_archive.json is derived; run season generation before this real-data test");
    return;
  }

  const evidence=buildDriverTalentEvidence({drivers,events,carCompetitiveness,careerRows});
  const profiles=inferDriverTalentProfiles(evidence);

  const sentinels=[
    ["Ayrton Senna",88],
    ["Alain Prost",84],
    ["Michael Schumacher",88],
    ["Jim Clark",88],
  ];
  for(const [wanted,minPeak] of sentinels){
    const profile=profiles.find(item=>norm(item.display_name)===norm(wanted));
    assert.ok(profile,wanted+" should resolve to a candidate Talent Profile");
    assert.ok(
      profile.peak_ability>=minPeak,
      wanted+" should emerge as a high-talent candidate from historical evidence"
    );
    assert.ok(
      profile.profile_confidence.score>=60,
      wanted+" should not be a low-confidence historical profile"
    );
  }
});
