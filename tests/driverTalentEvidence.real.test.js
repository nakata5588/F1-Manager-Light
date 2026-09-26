import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  buildDriverTalentEvidence,
  buildDriverTalentEvidenceAudit,
} from "../src/domain/driverTalentEvidence.js";

const root=process.cwd();
const dataDir=path.join(root,"public","data");

async function readJson(name,fallback=[]){
  try{return JSON.parse(await fs.readFile(path.join(dataDir,name),"utf8"));}
  catch{return fallback;}
}
const norm=(value)=>String(value||"").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"").trim();

test("real historical archive produces one analysis row per canonical driver",async(t)=>{
  const [drivers,events,carCompetitiveness,careerRows]=await Promise.all([
    readJson("drivers.json",[]),
    readJson("race_results_archive.json",[]),
    readJson("car_competitiveness_by_year.json",[]),
    readJson("driver_career.json",[]),
  ]);

  if(!events.length){
    t.skip("race_results_archive.json is derived; run npm run season:generate before this real-data test");
    return;
  }

  assert.ok(drivers.length>500,"canonical driver database should be populated");
  const evidence=buildDriverTalentEvidence({drivers,events,carCompetitiveness,careerRows});
  assert.equal(evidence.length,drivers.length);

  const ids=evidence.map(row=>row.driver_id);
  assert.equal(new Set(ids).size,ids.length,"each canonical driver must have exactly one evidence row");
  assert.ok(evidence.filter(row=>row.sample.starts>0).length>100,"historical archive should resolve a substantial F1 sample");

  for(const row of evidence){
    assert.equal(Object.hasOwn(row,"ceilings"),false);
    assert.equal(Object.hasOwn(row,"talent_rating"),false);
  }

  const audit=buildDriverTalentEvidenceAudit(evidence);
  assert.equal(audit.stage,"D7.R1B");
  assert.equal(audit.total_drivers,drivers.length);
  assert.ok(audit.top_relative_evidence.length>0);
  assert.ok(audit.normalization_coverage.era_normalized>100);
  assert.ok(audit.normalization_coverage.opposition_context>100);
});

test("well-documented historical stars are recognized as high-confidence evidence cases",async(t)=>{
  const [drivers,events,carCompetitiveness,careerRows]=await Promise.all([
    readJson("drivers.json",[]),
    readJson("race_results_archive.json",[]),
    readJson("car_competitiveness_by_year.json",[]),
    readJson("driver_career.json",[]),
  ]);
  if(!events.length){
    t.skip("race_results_archive.json is derived; run npm run season:generate before this real-data test");
    return;
  }

  const evidence=buildDriverTalentEvidence({drivers,events,carCompetitiveness,careerRows});
  for(const wanted of ["Ayrton Senna","Alain Prost"]){
    const row=evidence.find(item=>norm(item.display_name)===norm(wanted));
    assert.ok(row,wanted+" should resolve to a canonical evidence profile");
    assert.ok(row.sample.starts>=100,wanted+" should have a large historical race sample");
    assert.equal(row.confidence.band,"HIGH",wanted+" should be a high-confidence evidence case");
    assert.ok(Number.isFinite(row.comparative_evidence_percentiles.composite));
    assert.ok(Number.isFinite(row.era_normalized_percentiles.composite));
    assert.ok(row.r1a_comparative_evidence_percentiles);
    assert.equal(row.normalization_context.stage,"D7.R1B");
  }
});
