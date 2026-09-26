import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  canonicalTeamId,
  canonicalTeamIdentity,
  canonicalTeamName,
  createTeamIdentityResolver,
  mergeCanonicalTeamRows,
  resolveHistoricalTeamIdentity,
  resolveHistoricalTeamId,
} from "../src/domain/teamIdentity.js";

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

  const wrapped=canonicalTeamIdentity({
    team_id:{formula:"=LOOKUP()",result:"t_0040"},
    team_name:{formula:"=LOOKUP()",result:"Team Lotus"},
  });
  assert.equal(wrapped.team_id.result,"t_0005");
  assert.equal(wrapped.team_name.result,"Lotus");
  assert.equal(wrapped.team_id.formula,"=LOOKUP()");

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


test("historical team resolver is centralized and preserves canonical historical IDs",()=>{
  const teams=[
    {team_id:"t_0005",team_name:"Lotus",short_name:"Lotus"},
    {team_id:"t_0179",team_name:"Lotus-Ford",short_name:"Lotus-Ford"},
    {team_id:"t_0059",team_name:"Wolf",short_name:"Wolf"},
    {team_id:"t_0035",team_name:"Lola",short_name:"Lola"},
    {team_id:"t_0200",team_name:"Haas F1 Team",short_name:"Haas"},
  ];

  const resolver=createTeamIdentityResolver(teams);

  assert.equal(resolver.resolveId({team_id:"t_0040"}),"t_0005");
  assert.equal(resolver.resolveId({team_name:"Walter Wolf"}),"t_0059");
  assert.equal(resolver.resolveId({team_id:"archive_constructor_27",team_name:"Walter Wolf"}),"t_0059");
  assert.equal(resolver.resolveId({team_name:"Lotus-Ford"}),"t_0179");
  assert.equal(resolveHistoricalTeamId({team_name:"Lotus-Ford"},teams),"t_0179");

  const wolf=resolveHistoricalTeamIdentity({team_name:"Walter Wolf"},teams);
  assert.equal(wolf.id,"t_0059");
  assert.equal(wolf.name,"Wolf");
  assert.equal(wolf.match,"fuzzy_name");
});

test("historical team resolver refuses ambiguous fuzzy matches",()=>{
  const teams=[
    {team_id:"t_0035",team_name:"Lola",short_name:"Lola"},
    {team_id:"t_0200",team_name:"Haas F1 Team",short_name:"Haas"},
  ];
  const resolved=resolveHistoricalTeamIdentity({team_name:"Haas Lola"},teams);

  assert.equal(resolved.id,"");
  assert.equal(resolved.match,"ambiguous_name");
  assert.deepEqual(resolved.ambiguous_candidate_ids,["t_0035","t_0200"]);
});
