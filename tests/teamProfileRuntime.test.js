import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalTeamId, canonicalTeamName, mergeCanonicalTeamRows } from "../src/domain/teamIdentity.js";

test("Team Profile initializes display name before historical logo candidates", async()=>{
  const source=await readFile(new URL("../src/components/entity/TeamModal.jsx",import.meta.url),"utf8");
  const nameIndex=source.indexOf("const name = team?.team_name");
  const logoIndex=source.indexOf("const logoCandidates = useMemo");
  assert.ok(nameIndex>=0,"Team Profile display name declaration must exist");
  assert.ok(logoIndex>=0,"Team Profile logo resolver must exist");
  assert.ok(nameIndex<logoIndex,"Team display name must be initialized before logo candidate resolution");
});


test("Team Lotus historical duplicate resolves to canonical Lotus identity",()=>{
  assert.equal(canonicalTeamId("t_0040"),"t_0005");
  assert.equal(canonicalTeamId("t_0005"),"t_0005");
  assert.equal(canonicalTeamName("Team Lotus"),"Lotus");
  assert.equal(canonicalTeamName("Lotus F1"),"Lotus F1");
  assert.equal(canonicalTeamName("Lotus-Ford"),"Lotus-Ford");

  const merged=mergeCanonicalTeamRows([
    {team_id:"t_0005",team_name:"Lotus",short_name:"LOT",founded_year:1952},
    {team_id:"t_0040",team_name:"Team Lotus",short_name:"Team",team_base:"United Kingdom"},
    {team_id:"t_0206",team_name:"Lotus F1",short_name:"Lotus"},
  ]);
  const lotus=merged.filter((row)=>row.team_id==="t_0005");
  assert.equal(lotus.length,1);
  assert.equal(lotus[0].team_name,"Lotus");
  assert.equal(lotus[0].short_name,"LOT");
  assert.equal(merged.some((row)=>row.team_id==="t_0206"&&row.team_name==="Lotus F1"),true);
});
