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
import {
  constructorTechnicalIdentity,
  createTeamConstructorBridgeResolver,
  groupBridgeByTeamSeason,
} from "../src/domain/teamConstructorBridge.js";
import { createHistoricalResultTeamResolver } from "../src/domain/historicalResultTeamResolver.js";

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


test("Team/Entrant bridge keeps constructor identity separate from managerial identity",()=>{
  const teams=[
    {team_id:"t_0005",team_name:"Lotus"},
    {team_id:"t_0094",team_name:"BRP"},
    {team_id:"t_0171",team_name:"Lotus-Climax"},
    {team_id:"t_0175",team_name:"Lotus-BRM"},
  ];
  const resolver=createTeamConstructorBridgeResolver({
    teams,
    constructorReference:[
      {constructorId:172,constructorName:"Lotus-Climax"},
      {constructorId:176,constructorName:"Lotus-BRM"},
    ],
    entryRows:[
      {year:1963,driver_id:"d_clark",team_id:"t_0005",team_name:"Lotus"},
      {year:1963,driver_id:"d_hall",team_id:"t_0094",team_name:"BRP"},
    ],
  });

  const clark=resolver.resolve(
    {year:1963,driver_id:"d_clark",constructorId:172,constructorName:"Lotus-Climax"},
    {driverId:"d_clark"}
  );
  assert.equal(clark.team_id,"t_0005");
  assert.equal(clark.constructor_id,"t_0171");
  assert.equal(clark.constructor_name,"Lotus-Climax");
  assert.equal(clark.chassis_name,"Lotus");
  assert.equal(clark.engine_name,"Climax");
  assert.equal(clark.relation_basis,"entry_list_driver");
  assert.equal(clark.exact_entrant,true);

  const hall=resolver.resolve(
    {year:1963,driver_id:"d_hall",constructorId:176,constructorName:"Lotus-BRM"},
    {driverId:"d_hall"}
  );
  assert.equal(hall.team_id,"t_0094");
  assert.equal(hall.constructor_id,"t_0175");
  assert.equal(hall.constructor_name,"Lotus-BRM");
  assert.equal(hall.relation_basis,"entry_list_driver");
});

test("constructor-family fallback groups technical variants without rewriting constructor IDs",()=>{
  const teams=[
    {team_id:"t_0005",team_name:"Lotus"},
    {team_id:"t_0171",team_name:"Lotus-Climax"},
    {team_id:"t_0175",team_name:"Lotus-BRM"},
  ];
  const resolver=createTeamConstructorBridgeResolver({teams});

  const climax=resolver.resolve({year:1963,constructor_id:"t_0171",constructor_name:"Lotus-Climax"});
  const brm=resolver.resolve({year:1963,constructor_id:"t_0175",constructor_name:"Lotus-BRM"});

  assert.equal(climax.team_id,"t_0005");
  assert.equal(brm.team_id,"t_0005");
  assert.equal(climax.constructor_id,"t_0171");
  assert.equal(brm.constructor_id,"t_0175");
  assert.equal(climax.relation_basis,"constructor_family_fallback");
  assert.equal(climax.confidence,"MEDIUM");

  const grouped=groupBridgeByTeamSeason([climax,brm]);
  assert.equal(grouped.length,1);
  assert.equal(grouped[0].team_id,"t_0005");
  assert.deepEqual(grouped[0].constructor_ids,["t_0171","t_0175"]);
  assert.deepEqual(grouped[0].constructor_names,["Lotus-BRM","Lotus-Climax"]);
});

test("team-season bridge keeps exact technical identity separate from estimated constructor-family evidence",()=>{
  const exact={
    year:1980,team_id:"t_0005",team_name:"Lotus",
    constructor_id:"t_lotus",constructor_name:"Lotus-Ford",
    chassis_name:"Lotus",engine_name:"Ford",exact_entrant:true,
    relation_basis:"entry_list_driver",confidence:"HIGH",
  };
  const estimated={
    year:1980,team_id:"t_0005",team_name:"Lotus",
    constructor_id:"t_other",constructor_name:"Shadow-Ford",
    chassis_name:"Shadow",engine_name:"Ford",exact_entrant:false,
    relation_basis:"historical_result_resolver",confidence:"MEDIUM",
  };
  const grouped=groupBridgeByTeamSeason([exact,estimated]);
  assert.equal(grouped.length,1);
  assert.deepEqual(grouped[0].exact_chassis_names,["Lotus"]);
  assert.deepEqual(grouped[0].exact_constructor_names,["Lotus-Ford"]);
  assert.deepEqual(grouped[0].chassis_names,["Lotus","Shadow"]);
});

test("technical constructor parsing does not claim an entrant identity",()=>{
  assert.deepEqual(constructorTechnicalIdentity("BRP-BRM"),{
    constructor_name:"BRP-BRM",
    chassis_name:"BRP",
    engine_name:"BRM",
    constructor_family:"brp",
  });
  assert.deepEqual(constructorTechnicalIdentity("Ferrari"),{
    constructor_name:"Ferrari",
    chassis_name:"Ferrari",
    engine_name:"",
    constructor_family:"ferrari",
  });
});


test("shared historical result resolver reconciles constructorId through canonical managerial identity",()=>{
  const teams=[
    {team_id:"t_0005",team_name:"Lotus"},
    {team_id:"t_0171",team_name:"Lotus-Climax"},
  ];
  const resolver=createHistoricalResultTeamResolver({
    teams,
    constructorReference:[{constructorId:172,constructorName:"Lotus-Climax"}],
  });

  const historical=resolver.resolve({constructorId:172});
  assert.equal(historical.id,"t_0005");
  assert.equal(historical.known,true);

  const overloaded={constructor_id:"t_0171",constructorId:172};
  assert.equal(resolver.resolve(overloaded).id,"t_0171");
  assert.equal(
    resolver.resolve(overloaded,{ignoreDirectIds:true}).id,
    "t_0005",
    "bridge reconciliation must ignore overloaded technical IDs"
  );
});

test("Team/Entrant bridge reuses historical constructorId reconciliation",()=>{
  const resolver=createTeamConstructorBridgeResolver({
    teams:[
      {team_id:"t_0005",team_name:"Lotus"},
      {team_id:"t_0171",team_name:"Lotus-Climax"},
    ],
    constructorReference:[{constructorId:172,constructorName:"Lotus-Climax"}],
  });

  const link=resolver.resolve({year:1963,constructorId:172});
  assert.equal(link.team_id,"t_0005");
  assert.equal(link.constructor_id,"t_0171");
  assert.equal(link.relation_basis,"historical_result_resolver");
  assert.equal(link.exact_entrant,false);
});
