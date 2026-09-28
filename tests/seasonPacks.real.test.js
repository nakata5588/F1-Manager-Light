import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { isRaceDriverContract } from "../src/domain/contractRoles.js";

const root=process.cwd();
const targetYears=[1975,1980,1981,1982,1983,1984,1985,1987,1989,1999,2007,2011,2012,2014,2015,2020];
const expectedTeamCounts={
  1975:19,
  1980:15,
  1989:20,
  1999:11,
  2007:11,
  2011:12,
  2012:12,
  2014:11,
  2015:10,
  2020:10,
};

async function readPack(year){
  const file=path.join(root,"public","data","seasons",String(year),"season.json");
  return JSON.parse(await fs.readFile(file,"utf8"));
}

for(const year of targetYears){
  test(`generated Season Pack ${year} is structurally playable`,async()=>{
    const pack=await readPack(year);
    assert.equal(pack.format,"f1ml-season-pack");
    assert.equal(pack.year,year);
    assert.equal(pack.validation?.ok,true,`${year}: ${JSON.stringify(pack.validation)}`);

    const state=pack.state||{};
    assert.ok(state.calendar.length>0,`${year} must have a calendar`);
    if(expectedTeamCounts[year]!=null){
      assert.equal(
        state.teams.length,
        expectedTeamCounts[year],
        `${year} managerial team identity count changed unexpectedly`
      );
    }else{
      assert.ok(state.teams.length>=2,`${year} must have at least two teams`);
    }
    assert.ok(state.drivers.length>=4,`${year} must have at least 4 visible drivers`);
    assert.ok(Array.isArray(state.driverHistory),`${year} must carry driver history in the Season Pack`);
    assert.ok(Array.isArray(state.coreTracks)&&state.coreTracks.length>0,`${year} must expose circuit profiles for race-weekend gameplay`);
    assert.ok(Array.isArray(state.trackLayoutByYear),`${year} must expose effective track layouts`);
    assert.ok(state.qualifyingRules&&typeof state.qualifyingRules==="object",`${year} must carry Qualifying rules into the Season Pack`);
    assert.equal(Object.prototype.hasOwnProperty.call(state.qualifyingRules,"classification"),false,`${year} Qualifying rules must never carry a historical classification`);
    if(year===1980){
      assert.ok(state.trackLayoutByYear.length>0,"1980 track layouts must resolve year_from/year_to ranges");
      assert.ok(state.trackLayoutByYear.every((row)=>1980>=Number(row.year_from)&&1980<=Number(row.year_to)),"1980 pack contains an out-of-range track layout");
      assert.equal(Number(state.qualifyingRules.session_count),2,"1980 must seed two Qualifying sessions");
      assert.equal(state.qualifyingRules.strategy,"best_time_across_sessions");
      assert.equal(Number(state.qualifyingRules.max_starters),24,"1980 normal grid limit must be 24");
      const monaco=(state.qualifyingRules.event_overrides||[]).find((row)=>String(row.gp_id)==="gp_006");
      assert.ok(monaco,"1980 Monaco Qualifying override must be present");
      assert.equal(Number(monaco.max_starters),20,"1980 Monaco starting-grid limit must be 20");
    }
    if(year===1987){
      const priorIds=new Set(state.driverHistory.filter((r)=>Number(r.year)<1987).map((r)=>String(r.driver_id)));
      assert.ok(priorIds.size>=10,`1987 pack must include veteran pre-1987 history; found ${priorIds.size} drivers`);
    }

    const teamIds=new Set(state.teams.map((t)=>String(t.team_id)));
    const driverIds=new Set(state.drivers.map((d)=>String(d.driver_id)));
    for(const row of state.contracts||[]){
      assert.ok(teamIds.has(String(row.team_id)),`${year} contract references missing team ${row.team_id}`);
      assert.ok(driverIds.has(String(row.driver_id)),`${year} contract references missing driver ${row.driver_id}`);
    }

    const driverContracts=(state.contracts||[]).filter(isRaceDriverContract);
    const assignedDriverIds=new Set();
    for(const seat of driverContracts){
      const did=String(seat.driver_id);
      assert.equal(assignedDriverIds.has(did),false,`${year} driver ${did} cannot occupy two starting teams`);
      assignedDriverIds.add(did);
    }
    assert.equal(
      (state.contracts||[]).some((row)=>["season_results_bootstrap","ai_grid_bootstrap"].includes(String(row?.source||""))),
      false,
      `${year} New Game must not invent Jan-1 driver contracts`
    );

    for(const race of state.calendar||[]){
      for(const forbidden of ["winner","winner_id","winner_driver_id","winner_team_id","race_winner","classification","results"]){
        assert.equal(Object.prototype.hasOwnProperty.call(race,forbidden),false,`${year} calendar leaked historical outcome '${forbidden}'`);
      }
    }
  });
}

test("Season Pack index exposes the requested multi-era validation years",async()=>{
  const index=JSON.parse(await fs.readFile(path.join(root,"public","data","seasons","index.json"),"utf8"));
  assert.equal(index.format,"f1ml-season-index");
  const years=new Map(index.years.map((row)=>[Number(row.year),row]));
  for(const year of targetYears){
    assert.ok(years.has(year),`Season index is missing ${year}`);
    assert.equal(years.get(year).ready,true,`${year} is not ready: ${JSON.stringify(years.get(year))}`);
  }
});


test("derived F1 history covers the sparse manual-career eras",async()=>{
  const file=path.join(root,"public","data","driver_f1_history.json");
  const rows=JSON.parse(await fs.readFile(file,"utf8"));
  for(const year of [1980,1987,1989,1999,2014,2020]){
    const ids=new Set(rows.filter((r)=>Number(r.year)===year).map((r)=>String(r.driver_id)));
    assert.ok(ids.size>=20,`${year} historical profile coverage is too sparse: ${ids.size} drivers`);
  }
});


test("1980 Shadow uses Round 1 evidence to repair incomplete race-seat metadata",async()=>{
  const pack=await readPack(1980);
  const shadow=(pack.state.teams||[]).find((t)=>String(t.team_name||t.name)==="Shadow");
  assert.ok(shadow,"1980 Shadow must exist");

  const teamSeasons=JSON.parse(
    await fs.readFile(path.join(root,"public","data","team_seasons.json"),"utf8")
  );
  const shadowSeason=teamSeasons.find((row)=>
    Number(row.year)===1980&&String(row.team_id)===String(shadow.team_id)
  );
  assert.ok(shadowSeason,"1980 Shadow Results-derived team-season row must exist");

  const acceptedRoundOne=new Set(
    (Array.isArray(shadowSeason.first_race_driver_candidates)?shadowSeason.first_race_driver_candidates:[])
      .filter((row)=>{
        if(Number(row.first_round)!==1)return false;
        if(row.exact_entrant===true)return true;
        const levels=Array.isArray(row.confidence)?row.confidence:[row.confidence];
        return levels.some((value)=>["HIGH","MEDIUM"].includes(String(value||"").toUpperCase()));
      })
      .map((row)=>String(row.driver_id))
  );

  const contracts=(pack.state.contracts||[]).filter((c)=>String(c.team_id)===String(shadow.team_id));
  const raceSeats=contracts.filter(isRaceDriverContract);
  assert.equal(raceSeats.length,2,"Round 1 evidence should fill Shadow's missing opening race seat");

  const seeded=raceSeats.filter((row)=>String(row.source||"")==="first_race_seed");
  assert.ok(seeded.length>=1,"Shadow should expose the repaired seat as an explicit first_race_seed");
  assert.ok(
    seeded.every((row)=>acceptedRoundOne.has(String(row.driver_id))),
    "Shadow fallback seats must be supported by accepted Round 1 Results evidence"
  );

  const kennedyWasRoundOneEvidence=acceptedRoundOne.has("d_0862");
  assert.equal(
    raceSeats.some((row)=>String(row.driver_id)==="d_0862"),
    kennedyWasRoundOneEvidence,
    "stale test-driver metadata may be upgraded only when Round 1 Results prove the race relationship"
  );
});






test("Virgin-Marussia-Manor identity follows the Results timeline",async()=>{
  const expected=[
    {year:2011,id:"t_0166",name:"Virgin"},
    {year:2012,id:"t_0204",name:"Marussia"},
    {year:2015,id:"t_0207",name:"Manor Marussia"},
  ];

  for(const item of expected){
    const pack=await readPack(item.year);
    const teams=pack.state?.teams||[];
    const team=teams.find((row)=>String(row.team_id)===item.id);
    assert.ok(team,item.year+" must contain "+item.name+" with canonical ID "+item.id);
    assert.equal(String(team.team_name||team.name),item.name);

    const raceContracts=(pack.state?.contracts||[]).filter(
      (row)=>isRaceDriverContract(row)&&String(row.team_id)===item.id
    );
    assert.equal(raceContracts.length,2,item.year+" "+item.name+" must have two opening race drivers");
    if(item.year===2015){
      assert.ok(
        raceContracts.every((row)=>String(row.source||"")==="first_team_appearance_seed"),
        "2015 Manor must use the guarded first-Team-appearance fallback"
      );
      assert.ok(raceContracts.every((row)=>Number(row.source_round)===2));
    }

    const wrongIds=expected
      .filter((other)=>other.year!==item.year)
      .map((other)=>other.id);
    assert.equal(
      teams.some((row)=>wrongIds.includes(String(row.team_id))),
      false,
      item.year+" must not materialize another era of the Virgin/Marussia/Manor lineage"
    );
  }
});

test("2007 opening grid is seeded only from Round 1 Results when contracts are absent",async()=>{
  const pack=await readPack(2007);
  const teams=pack.state?.teams||[];
  const raceContracts=(pack.state?.contracts||[]).filter(isRaceDriverContract);
  const byTeam=new Map();
  for(const row of raceContracts){
    const tid=String(row.team_id);
    if(!byTeam.has(tid))byTeam.set(tid,[]);
    byTeam.get(tid).push(row);
  }

  assert.equal(teams.length,11);
  assert.equal(raceContracts.length,22,"2007 must start with two race seats per participating team");
  for(const team of teams){
    const seats=byTeam.get(String(team.team_id))||[];
    assert.equal(seats.length,2,String(team.team_name||team.team_id)+" must have two opening race seats");
    assert.ok(
      seats.every((row)=>String(row.source||"")==="first_race_seed"),
      String(team.team_name||team.team_id)+" 2007 seats must come from the explicit Round 1 fallback"
    );
    assert.ok(seats.every((row)=>Number(row.source_round)===1));
    assert.ok(seats.every((row)=>row.relationship_only===true));
    assert.ok(seats.every((row)=>row.synthetic===false));
  }

  const seasonRows=JSON.parse(
    await fs.readFile(path.join(root,"public","data","team_seasons.json"),"utf8")
  ).filter((row)=>Number(row.year)===2007);
  const roundOneIds=new Set(
    seasonRows.flatMap((row)=>
      (Array.isArray(row.first_race_driver_candidates)?row.first_race_driver_candidates:[])
        .filter((candidate)=>Number(candidate.first_round)===1)
        .map((candidate)=>String(candidate.driver_id))
    )
  );
  assert.ok(
    raceContracts.every((row)=>roundOneIds.has(String(row.driver_id))),
    "2007 opening grid must not include a driver whose evidence starts after Round 1"
  );
});

test("1980-1985 Season Packs use exact R2B historical rating snapshots",async()=>{
  for(const year of [1980,1981,1982,1983,1984,1985]){
    const pack=await readPack(year);
    assert.equal(pack.ratingModel,"R2B",year+" must advertise the R2B rating model");
    const ratings=Array.isArray(pack.state?.driverRatings)?pack.state.driverRatings:[];
    assert.ok(ratings.length>0,year+" must contain driver ratings");
    assert.ok(
      ratings.some((row)=>String(row.source||"")==="historical_rating_snapshot_r2b"),
      year+" must contain R2B snapshot ratings"
    );
    assert.equal(
      ratings.some((row)=>Number(row.year)!==year),
      false,
      year+" rating rows must be materialized for the selected New Game year"
    );
  }

  const pack1980=await readPack(1980);
  const prost=(pack1980.state?.driverRatings||[]).find((row)=>String(row.driver_id)==="d_0117");
  assert.ok(prost,"1980 Alain Prost rating must exist");
  assert.equal(Number(prost.current_ability),75.6,"1980 Prost must use R2B Current Ability, not the legacy 60 baseline");
  assert.equal(Number(prost.potential_ability),96.8,"1980 Prost must expose the R2B Peak as runtime potential");
  assert.equal(String(prost.source),"historical_rating_snapshot_r2b");
});


test("1981 Giacomelli has exactly one race-team assignment",async()=>{
  const pack=await readPack(1981);
  const rows=(pack.state?.contracts||[]).filter(
    (row)=>isRaceDriverContract(row)&&String(row.driver_id)==="d_0152"
  );
  assert.equal(rows.length,1,"Bruno Giacomelli must occupy exactly one 1981 race seat");
});

test("drivers who die during the selected season are alive on New Game January 1",async()=>{
  const pack=await readPack(1982);
  const driverIds=new Set((pack.state?.drivers||[]).map((row)=>String(row.driver_id)));
  assert.ok(driverIds.has("d_0203"),"Gilles Villeneuve must exist at 1982 New Game start");
  const orphan=(pack.state?.contracts||[]).filter(
    (row)=>!(pack.state?.drivers||[]).some((d)=>String(d.driver_id)===String(row.driver_id))
  );
  assert.equal(orphan.length,0,"1982 New Game must not contain orphan driver contracts");
});


test("team_seasons never promotes unresolved technical constructors into managerial teams",async()=>{
  const rows=JSON.parse(await fs.readFile(path.join(root,"public","data","team_seasons.json"),"utf8"));
  const invalid=rows.filter((row)=>
    String(row?.team_id||"").startsWith("archive_constructor_") ||
    String(row?.team_id||"").startsWith("legacy_constructor_")
  );
  assert.deepEqual(
    invalid.map((row)=>({year:row.year,team_id:row.team_id,team_name:row.team_name})),
    [],
    "technical constructor fallback IDs must not appear in managerial team_seasons"
  );
});

test("estimated team identity does not fabricate historical rosters",async()=>{
  const rows=JSON.parse(await fs.readFile(path.join(root,"public","data","team_seasons.json"),"utf8"));
  const offenders=rows.filter((row)=>
    Number(row?.exact_entrant_rows||0)===0 &&
    Array.isArray(row?.driver_ids) &&
    row.driver_ids.length>0
  );
  assert.deepEqual(
    offenders.map((row)=>({year:row.year,team_id:row.team_id,drivers:row.driver_ids})),
    [],
    "driver rosters require exact entrant evidence"
  );
});


test("1980 Season Pack materializes Senna in the feeder world without replaying his future F1 debut",async()=>{
  const pack=await readPack(1980);
  const drivers=pack.state?.drivers||[];
  const senna=drivers.find((row)=>String(row.driver_id)==="d_0102");
  assert.ok(senna,"Ayrton Senna must exist in the 1980 active driver world");
  assert.equal(senna.status,"junior_only");
  assert.equal(senna.feeder_placement,"YOUTH");
  assert.equal(Number(senna.age),19);
  assert.equal(senna.active_lower_series,true);
  assert.equal(senna.canHireAcademy,true);
  assert.equal(senna.canHireF1,false);
  assert.equal(
    (pack.state?.contracts||[]).some((row)=>String(row.driver_id)==="d_0102"),
    false,
    "1980 Senna must not receive a fabricated historical F1 contract"
  );

  for(const id of ["d_0030","d_0001","d_0004"]){
    assert.equal(
      drivers.some((row)=>String(row.driver_id)===id),
      false,
      id+" must not leak into the 1980 active world before world-entry"
    );
  }

  assert.ok(Array.isArray(pack.state?.driverWorldEntry));
  assert.ok(Array.isArray(pack.state?.driverFeederPlacement));
  const sennaSeed=(pack.state.driverFeederPlacement||[]).find((row)=>String(row.driver_id)==="d_0102");
  assert.equal(sennaSeed?.forced_future_f1_debut,false);
  assert.equal(sennaSeed?.forced_future_team,false);
});


test("1980 Senna receives materialized starting attributes from Talent Profile",async()=>{
  const pack=await readPack(1980);
  const rating=(pack.state?.driverRatings||[]).find((row)=>String(row.driver_id)==="d_0102");
  assert.ok(rating,"1980 Senna must have a runtime rating row");
  assert.equal(rating.source,"talent_profile_starting_materializer");
  assert.equal(rating.rating_model,"D7.R2");
  assert.equal(Number(rating.potential_ability),99);
  assert.ok(Number(rating.current_ability)>=60&&Number(rating.current_ability)<=64,String(rating.current_ability));
  assert.ok(Number(rating.pace)>=68&&Number(rating.pace)<=71,String(rating.pace));
  assert.ok(Number(rating.racecraft)>=53&&Number(rating.racecraft)<=57,String(rating.racecraft));
  assert.ok(Number(rating.consistency)>=53&&Number(rating.consistency)<=57,String(rating.consistency));
  assert.ok(Number(rating.mentality)>=63&&Number(rating.mentality)<=66,String(rating.mentality));
});
