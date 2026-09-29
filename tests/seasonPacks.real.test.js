import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { isRaceDriverContract } from "../src/domain/contractRoles.js";
import { materializeSeasonPackFromDatabaseState, SEASON_PACK_SCHEMA_VERSION, validateLoadedSeasonPack } from "../src/data/seasonPackLoader.js";
import { materializeLowerSeriesWorld } from "../src/domain/lowerSeriesWorld.js";
import { initializeLowerSeriesSeason } from "../src/engine/LowerSeriesEngine.js";
import { teamOrganizationHistoryFromState } from "../src/domain/teamOrganizationHistory.js";
import { teamChampionshipSummary } from "../src/domain/championshipHistory.js";
import { teamReputation } from "../src/domain/teamReputation.js";

const root=process.cwd();
const targetYears=[1975,1980,1981,1982,1983,1984,1985,1987,1988,1989,1999,2007,2009,2010,2011,2012,2014,2015,2020];
const expectedTeamCounts={
  1975:19,
  1980:15,
  1989:20,
  1999:11,
  2007:11,
  2009:10,
  2010:12,
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


test("generated Season Packs use the current schema and stale local packs are rejected",async()=>{
  const pack=await readPack(1980);
  assert.equal(Number(pack.schemaVersion),SEASON_PACK_SCHEMA_VERSION);
  assert.doesNotThrow(()=>validateLoadedSeasonPack(pack,1980));

  const stale={
    ...pack,
    schemaVersion:SEASON_PACK_SCHEMA_VERSION-1,
  };
  assert.throws(
    ()=>validateLoadedSeasonPack(stale,1980),
    /stale/i,
    "long-lived Codespaces must not silently reuse pre-Lower-Series Season Packs"
  );
});

test("1980 generated New Game data materializes a populated Lower Series world",async()=>{
  const pack=await readPack(1980);
  const [series,seriesRules]=await Promise.all([
    fs.readFile(path.join(root,"public","data","series.json"),"utf8").then(JSON.parse),
    fs.readFile(path.join(root,"public","data","series_rules.json"),"utf8").then(JSON.parse).catch(()=>[]),
  ]);

  const opening=materializeLowerSeriesWorld({
    year:1980,
    sourceSeason:1980,
    series,
    seriesRules,
    placements:pack.state?.driverFeederPlacement||[],
    driverCareer:pack.state?.driverCareer||[],
    drivers:pack.state?.drivers||[],
  });
  const state=initializeLowerSeriesSeason({
    activeYear:1980,
    currentDateISO:"1980-01-01",
    saveMeta:{seed:"real-1980-lower-series"},
    contracts:pack.state?.contracts||[],
    drivers:pack.state?.drivers||[],
    dbDrivers:pack.state?.drivers||[],
    driverRatings:pack.state?.driverRatings||[],
    lowerSeriesWorld:opening,
    results:[],
  });

  const world=state.lowerSeriesWorld;
  const entries=Object.values(world?.entries||{});
  const formulaTwo=entries.filter((row)=>Number(row?.series_level)===2&&row?.series_id);
  assert.ok(entries.length>0,"1980 Lower Series Save World must contain feeder drivers");
  assert.ok(formulaTwo.length>0,"1980 must contain at least one concrete Formula Two placement");
  assert.ok(
    (world?.events||[]).some((row)=>Number(row?.series_level)===2),
    "1980 Formula Two must receive a simulated calendar when feeder drivers are present"
  );
});

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
    assert.ok(Array.isArray(state.teamHistoricalStrength),`${year} must carry Historical Team Strength`);
    assert.equal(
      state.teamHistoricalStrength.length,
      state.teams.length,
      `${year} must materialize one strength row per Team`
    );
    assert.ok(
      state.teamHistoricalStrength.every((row)=>
        Number(row.evidence_through_year)===year-1 &&
        Number(row.overall)>=0 && Number(row.overall)<=100 &&
        Number(row.structural_strength)>=0 && Number(row.structural_strength)<=100
      ),
      `${year} Historical Team Strength must be preseason-safe and bounded`
    );
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



test("historical rating calibration keeps 1988 McLaren elite without stale rookie ratings",async()=>{
  const pack=await readPack(1988);
  const ratingById=new Map((pack.state.driverRatings||[]).map((row)=>[String(row.driver_id),row]));
  const contractById=new Map((pack.state.contracts||[]).map((row)=>[String(row.driver_id),row]));
  const prost=ratingById.get("d_0117");
  const senna=ratingById.get("d_0102");
  assert.ok(prost&&senna,"1988 Prost and Senna ratings must exist");
  assert.equal(prost.source,"talent_profile_starting_materializer");
  assert.ok(Number(prost.current_ability)>=90,prost.current_ability);
  assert.ok(Number(senna.current_ability)>=90,senna.current_ability);
  assert.ok(Number(prost.potential_ability)>=Number(prost.current_ability));
  assert.ok(Number(senna.potential_ability)>=Number(senna.current_ability));
  assert.equal(contractById.get("d_0117")?.role,"Main Driver");
  assert.equal(contractById.get("d_0102")?.role,"Second Driver");
});

test("2011 Maldonado receives an F1-career-backed latent floor without selected-season replay",async()=>{
  const pack=await readPack(2011);
  const rating=(pack.state.driverRatings||[]).find((row)=>String(row.driver_id)==="d_0812");
  assert.ok(rating,"2011 Maldonado rating must exist");
  assert.equal(rating.source,"talent_profile_starting_materializer");
  assert.equal(rating.talent_profile_repair_source,"full_f1_career_achievement_floor");
  assert.ok(Number(rating.current_ability)>=60&&Number(rating.current_ability)<=70,rating.current_ability);
  assert.ok(Number(rating.potential_ability)>=75,rating.potential_ability);
  assert.ok(Number(rating.potential_ability)>=Number(rating.current_ability));
});

test("2020 Alfa hierarchy favors Räikkönen and all generated potentials stay valid",async()=>{
  const pack=await readPack(2020);
  const ratingById=new Map((pack.state.driverRatings||[]).map((row)=>[String(row.driver_id),row]));
  const contractById=new Map((pack.state.contracts||[]).map((row)=>[String(row.driver_id),row]));
  const kimi=ratingById.get("d_0008");
  const gio=ratingById.get("d_0840");
  assert.ok(kimi&&gio,"2020 Alfa driver ratings must exist");
  assert.equal(contractById.get("d_0008")?.role,"Main Driver");
  assert.equal(contractById.get("d_0840")?.role,"Second Driver");
  assert.ok(Number(kimi.current_ability)>Number(gio.current_ability));
  assert.ok(Number(kimi.current_ability)>=85&&Number(kimi.current_ability)<=93,kimi.current_ability);
  assert.ok(Number(gio.current_ability)>=55&&Number(gio.current_ability)<=70,gio.current_ability);
  assert.ok(Number(kimi.potential_ability)>=Number(kimi.current_ability));
  assert.ok(Number(gio.potential_ability)>=Number(gio.current_ability));
  assert.equal(gio.talent_profile_repair_source,"full_f1_career_achievement_floor");
});

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








test("2011 runtime fallback keeps Virgin identity and its two Round 1 drivers",async()=>{
  const generated=await readPack(2011);
  const teamSeasons=JSON.parse(
    await fs.readFile(path.join(root,"public","data","team_seasons.json"),"utf8")
  );
  const dbState={
    dbDrivers:generated.state.drivers,
    dbCalendar:generated.state.calendar,
    dbTeams:generated.state.teams,
    dbDriverRatings:generated.state.driverRatings,
    dbDriverRatingProfiles:[],
    dbDriverOpeningState:[],
    dbDriverCareer:generated.state.driverCareer||[],
    dbDriverHistory:generated.state.driverHistory||[],
    dbStaffRatings:generated.state.staffRatings||[],
    dbStaffCore:generated.state.staffCore||[],
    dbTeamBrands:generated.state.teamBrands||[],
    dbTeamEngines:generated.state.teamEngines||[],
    dbContracts:[],
    dbSponsorsContracts:generated.state.sponsorsContracts||[],
    dbRules:generated.state.rules||[],
    dbQualifyingRules:[generated.state.qualifyingRules].filter(Boolean),
    dbQualifyingRuleOverrides:[],
    dbEraSafety:generated.state.eraSafety||[],
    dbAccidentModel:generated.state.accidentModel||[],
    dbFacilities:generated.state.facilities||[],
    dbCarStats:generated.state.carStats||[],
    dbStaffContracts:generated.state.staffContracts||[],
    dbTyres:generated.state.tyres||[],
    dbPointsSystems:generated.state.pointsSystem?[generated.state.pointsSystem]:[],
    dbPenaltiesRules:generated.state.penaltiesRules||[],
    dbFinancialRules:generated.state.financialRules||[],
    dbAgendaBlocks:generated.state.agendaBlocks||[],
    dbContractRules:[],
    dbYouthIntakeRules:[],
    dbScoutingZones:[],
    dbTrackLayoutByYear:generated.state.trackLayoutByYear||[],
    dbTeamSeasons:teamSeasons,
    dbCoreTracks:generated.state.coreTracks||[],
  };

  const runtime=materializeSeasonPackFromDatabaseState(dbState,2011);
  const virgin=(runtime.state.teams||[]).find((row)=>String(row.team_id)==="t_0166");
  assert.ok(virgin,"runtime fallback must keep the 2011 Virgin Team identity");
  assert.equal(String(virgin.team_name),"Virgin");
  assert.equal(
    (runtime.state.teams||[]).some((row)=>["t_0204","t_0207"].includes(String(row.team_id))),
    false,
    "2011 runtime fallback must not replace Virgin with a later Marussia/Manor identity"
  );
  const seats=(runtime.state.contracts||[]).filter(
    (row)=>isRaceDriverContract(row)&&String(row.team_id)==="t_0166"
  );
  assert.equal(seats.length,2,"2011 Virgin must retain its two Results-derived opening drivers");
  assert.ok(seats.every((row)=>String(row.source||"")==="first_race_seed"));
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
  assert.equal(rating.rating_model,"D7.R4");
  assert.equal(Number(rating.potential_ability),99);
  assert.ok(Number(rating.current_ability)>=60&&Number(rating.current_ability)<=64,String(rating.current_ability));
  assert.ok(Number(rating.pace)>=68&&Number(rating.pace)<=71,String(rating.pace));
  assert.ok(Number(rating.racecraft)>=53&&Number(rating.racecraft)<=57,String(rating.racecraft));
  assert.ok(Number(rating.consistency)>=53&&Number(rating.consistency)<=57,String(rating.consistency));
  assert.ok(Number(rating.mentality)>=63&&Number(rating.mentality)<=66,String(rating.mentality));
});


test("2009 long-term Team structure separates Ferrari from recent Force India without using car stats",async()=>{
  const pack=await readPack(2009);
  const byId=new Map((pack.state?.teamHistoricalStrength||[]).map((row)=>[String(row.team_id),row]));
  const ferrari=byId.get("t_0010");
  const forceIndia=byId.get("t_0021");
  assert.ok(ferrari&&forceIndia,"2009 Ferrari and Force India strength rows must exist");
  assert.ok(Number(ferrari.structural_strength)>Number(forceIndia.structural_strength),[ferrari,forceIndia]);
  assert.ok(Number(ferrari.heritage_strength)>Number(forceIndia.heritage_strength),[ferrari,forceIndia]);
  assert.equal(Number(ferrari.evidence_through_year),2008);
  assert.equal(Number(forceIndia.evidence_through_year),2008);
});


test("2024 organisational successors inherit verified structural continuity without collapsing identities",async()=>{
  const pack=await readPack(2024);
  const byId=new Map((pack.state?.teamHistoricalStrength||[]).map((row)=>[String(row.team_id),row]));

  const aston=byId.get("t_0117");
  assert.ok(aston,"2024 Aston Martin strength must exist");
  assert.ok(aston.inherited_team_ids.includes("t_0209"),aston);
  assert.ok(aston.inherited_team_ids.includes("t_0021"),aston);
  assert.ok(Number(aston.structural_strength)>=60,aston);

  const alpine=byId.get("t_0211");
  assert.ok(alpine,"2024 Alpine strength must exist");
  assert.ok(alpine.inherited_team_ids.includes("t_0004"),alpine);
  assert.ok(alpine.inherited_team_ids.includes("t_0032"),alpine);
  assert.ok(Number(alpine.structural_strength)>=80,alpine);

  const rb=byId.get("t_0212");
  assert.ok(rb,"2024 RB strength must exist");
  assert.ok(rb.inherited_team_ids.includes("t_0210"),rb);
  assert.ok(rb.inherited_team_ids.includes("t_0017"),rb);
  assert.ok(rb.inherited_team_ids.includes("t_0029"),rb);
  assert.ok(Number(rb.structural_strength)>25,rb);
});

test("2010 Mercedes strength follows Brawn-Honda-BAR-Tyrrell rather than 1950s Mercedes revival",async()=>{
  const pack=await readPack(2010);
  const mercedes=(pack.state?.teamHistoricalStrength||[]).find((row)=>String(row.team_id)==="t_0131");
  assert.ok(mercedes,"2010 Mercedes strength must exist");
  assert.deepEqual(
    new Set(mercedes.inherited_team_ids),
    new Set(["t_0006","t_0027","t_0022","t_0033"])
  );
  assert.equal(mercedes.first_historical_season,1970);
  assert.ok(
    !(mercedes.lineage_segments||[]).some((segment)=>String(segment.team_id)==="t_0131"&&Number(segment.year_to)<1970),
    "1954-55 Mercedes must not leak into the modern Brackley lineage"
  );
});

test("Teams 4.0A/B real-data regressions keep organisation history canonical and preseason-safe",async()=>{
  const [pack2009,pack2010,pack2020,teamSeasons,driverHistory,historicalChampionships,lineageRows]=await Promise.all([
    readPack(2009),
    readPack(2010),
    readPack(2020),
    fs.readFile(path.join(root,"public","data","team_seasons.json"),"utf8").then(JSON.parse),
    fs.readFile(path.join(root,"public","data","driver_f1_history.json"),"utf8").then(JSON.parse),
    fs.readFile(path.join(root,"public","data","historical_championships.json"),"utf8").then(JSON.parse),
    fs.readFile(path.join(root,"public","data","team_lineage_history.json"),"utf8").then(JSON.parse),
  ]);

  const domainState=(pack,year)=>({
    ...(pack.state||{}),
    activeYear:year,
    dbTeams:pack.state?.teams||[],
    dbTeamSeasons:teamSeasons,
    dbDriverHistory:driverHistory,
    dbHistoricalChampionships:historicalChampionships,
    dbTeamLineageHistory:lineageRows,
    historySeasons:[],
    results:[],
    standings:{drivers:[],teams:[]},
  });

  // Ferrari 2009: the official Results/rules cache is the single title truth.
  const state2009=domainState(pack2009,2009);
  const ferrariHistory=teamOrganizationHistoryFromState(state2009,"t_0010",2009);
  const ferrariStrength=(pack2009.state?.teamHistoricalStrength||[])
    .find((row)=>String(row.team_id)==="t_0010");
  const ferrariTitles=teamChampionshipSummary({
    ...state2009,
    careerMeta:{sourceSeason:2009},
  },"t_0010");
  assert.equal(ferrariHistory?.drivers_titles,15);
  assert.equal(ferrariHistory?.constructors_titles,16);
  assert.equal(ferrariStrength?.drivers_titles,15);
  assert.equal(ferrariStrength?.constructors_titles,16);
  assert.equal(ferrariTitles.driversTitles,15);
  assert.equal(ferrariTitles.constructors,16);
  assert.equal(
    ferrariTitles.constructorTitles.some((row)=>Number(row.year)<1958),
    false,
    "Ferrari must not receive an artificial pre-1958 Constructors title"
  );

  // Force India 2009: inherit only the verified Jordan -> Midland -> Spyker chain.
  const forceIndiaHistory=teamOrganizationHistoryFromState(state2009,"t_0021",2009);
  assert.deepEqual(
    new Set(forceIndiaHistory?.inherited_team_ids||[]),
    new Set(["t_0028","t_0024","t_0023"])
  );
  assert.equal(Number(forceIndiaHistory?.evidence_through_year),2008);
  assert.equal(
    (forceIndiaHistory?.lineage_segments||[]).some((segment)=>Number(segment.year_to)>=2009),
    false,
    "2009 opening history must stop at 2008"
  );

  // Mercedes 2010: modern Brackley lineage, not the disconnected 1950s Mercedes team.
  const state2010=domainState(pack2010,2010);
  const mercedesHistory=teamOrganizationHistoryFromState(state2010,"t_0131",2010);
  assert.deepEqual(
    new Set(mercedesHistory?.inherited_team_ids||[]),
    new Set(["t_0006","t_0027","t_0022","t_0033"])
  );
  assert.equal(Number(mercedesHistory?.evidence_through_year),2009);
  assert.equal(Number(mercedesHistory?.first_historical_season),1970);
  assert.equal(
    (mercedesHistory?.lineage_segments||[]).some((segment)=>
      String(segment.team_id)==="t_0131"&&Number(segment.year_to)<1970
    ),
    false,
    "1954-55 Mercedes must remain disconnected from the 2010 organisation"
  );

  // Williams 2020: New Game and the freshly-started career must share one seed.
  const state2020=domainState(pack2020,2020);
  const williams=(pack2020.state?.teams||[]).find((row)=>
    /williams/i.test(String(row.team_name??row.name??""))
  );
  assert.ok(williams,"2020 Williams must exist");
  const williamsId=String(williams.team_id??williams.id);
  const previewRep=teamReputation(state2020,williamsId);
  const freshCareerRep=teamReputation({
    ...state2020,
    careerMeta:{sourceSeason:2020},
    teamReputationState:{},
    teamReputationLog:{},
  },williamsId);
  assert.equal(freshCareerRep,previewRep);
  assert.ok(previewRep>=60,"Williams 2020 reputation unexpectedly low: "+previewRep);

  const futureInjected=teamReputation({
    ...state2020,
    dbDriverHistory:[
      ...driverHistory,
      {year:2020,series_division:"F1",driver_id:"future",team_id:williamsId,wins:20,podiums:30,starts:40,points:500},
    ],
    dbHistoricalChampionships:{
      drivers:[
        ...(historicalChampionships.drivers||[]),
        {year:2020,constructor_id:williamsId,driver_id:"future",position:1},
      ],
      constructors:[
        ...(historicalChampionships.constructors||[]),
        {year:2020,constructor_id:williamsId,position:1},
      ],
    },
  },williamsId);
  assert.equal(
    futureInjected,
    previewRep,
    "selected-season Results must not change the January 2020 Reputation seed"
  );
});



test("LS3.5 audit: 2007 feeder population and starting-rating calibration",async()=>{
  const pack=await readPack(2007);
  const [series,seriesRules]=await Promise.all([
    fs.readFile(path.join(root,"public","data","series.json"),"utf8").then(JSON.parse),
    fs.readFile(path.join(root,"public","data","series_rules.json"),"utf8").then(JSON.parse).catch(()=>[]),
  ]);
  const opening=materializeLowerSeriesWorld({
    year:2007,
    sourceSeason:2007,
    series,
    seriesRules,
    placements:pack.state?.driverFeederPlacement||[],
    driverCareer:pack.state?.driverCareer||[],
    drivers:pack.state?.drivers||[],
  });
  const initialized=initializeLowerSeriesSeason({
    activeYear:2007,
    currentDateISO:"2007-01-01",
    saveMeta:{seed:"ls35-audit-2007"},
    contracts:pack.state?.contracts||[],
    drivers:pack.state?.drivers||[],
    dbDrivers:pack.state?.drivers||[],
    driverRatings:pack.state?.driverRatings||[],
    lowerSeriesWorld:opening,
    results:[],
  });
  const world=initialized.lowerSeriesWorld;
  const driverById=new Map((pack.state?.drivers||[]).map((row)=>[String(row.driver_id),row]));
  const activePlacements=(pack.state?.driverFeederPlacement||[])
    .filter((row)=>row?.active_pre_f1_world)
    .map((row)=>({
      driver_id:String(row.driver_id||""),
      name:String(driverById.get(String(row.driver_id))?.display_name||row.display_name||row.driver_id||""),
      placement:row.placement||null,
      age:row.age??null,
      series_id:row.series_id??null,
      series_name:row.series_name??null,
      series_level:row.series_level??null,
      series_resolution:row.series_resolution??null,
      candidates:Array.isArray(row.series_candidates)?row.series_candidates.map((candidate)=>candidate.series_id):[],
    }))
    .sort((a,b)=>String(a.name).localeCompare(String(b.name)));

  const gp2Entries=Object.values(world?.entries||{})
    .filter((row)=>String(row?.series_id)==="S_0005")
    .map((row)=>({
      driver_id:String(row.driver_id),
      name:String(driverById.get(String(row.driver_id))?.display_name||row.driver_id),
      placement_status:row.placement_status,
      placement_source:row.placement_source,
      lower_team_id:row.lower_team_id,
      team_name:row.team_name,
    }))
    .sort((a,b)=>a.name.localeCompare(b.name));

  const gp2Career=(pack.state?.driverCareer||[])
    .filter((row)=>/gp2|formula\s*2|\bf2\b/i.test(String(row.series_name??row.series??row.series_division??row.division??"")))
    .map((row)=>({
      driver_id:String(row.driver_id||""),
      name:String(driverById.get(String(row.driver_id))?.display_name||row.driver_name||row.driver_id||""),
      series_id:row.series_id??null,
      series_name:row.series_name??row.series??row.series_division??null,
      team_id:row.team_id??row.entrant_id??null,
      team_name:row.team_name??row.team??row.entrant_name??null,
    }))
    .sort((a,b)=>a.name.localeCompare(b.name));

  const profiles=JSON.parse(
    await fs.readFile(path.join(root,"public","data","driver_rating_profiles.json"),"utf8")
  );
  const nickProfile=profiles.find((row)=>String(row.driver_id)==="d_0002")||null;
  const wantedNames=["Fernando Alonso","Kimi Räikkönen","Lewis Hamilton","Felipe Massa","Robert Kubica","Nico Rosberg","Nick Heidfeld"];
  const ratingById=new Map((pack.state?.driverRatings||[]).map((row)=>[String(row.driver_id),row]));
  const ratingAudit=(pack.state?.drivers||[])
    .filter((driver)=>wantedNames.includes(String(driver.display_name||driver.driver_name||driver.name||"")))
    .map((driver)=>{
      const rating=ratingById.get(String(driver.driver_id))||{};
      return {
        driver_id:String(driver.driver_id),
        name:String(driver.display_name||driver.driver_name||driver.name||driver.driver_id),
        source:rating.source??null,
        career_stage:rating.career_stage??null,
        current_ability:rating.current_ability??null,
        potential_ability:rating.potential_ability??null,
        talent_profile_peak_original:rating.talent_profile_peak_original??null,
        talent_profile_peak_effective:rating.talent_profile_peak_effective??null,
        talent_profile_repair_source:rating.talent_profile_repair_source??null,
        historical_current_floor:rating.historical_current_floor??null,
        historical_current_floor_applied:rating.historical_current_floor_applied??null,
        historical_prior_starts:rating.historical_prior_starts??null,
        historical_prior_wins:rating.historical_prior_wins??null,
        historical_prior_podiums:rating.historical_prior_podiums??null,
        historical_previous_championship_position:rating.historical_previous_championship_position??null,
        historical_recent_best_championship_position:rating.historical_recent_best_championship_position??null,
        historical_continuity_cap_applied:rating.historical_continuity_cap_applied??null,
        historical_continuity_previous_ovr:rating.historical_continuity_previous_ovr??null,
        factor_speed:rating.factor_speed??null,
        factor_experience:rating.factor_experience??null,
        factor_mental:rating.factor_mental??null,
        factor_team:rating.factor_team??null,
        pace:rating.pace??null,
        qualifying:rating.qualifying??null,
        racecraft:rating.racecraft??null,
        consistency:rating.consistency??null,
        mentality:rating.mentality??null,
      };
    })
    .sort((a,b)=>a.name.localeCompare(b.name));

  console.log("LS35_AUDIT_2007="+JSON.stringify({
    active_pre_f1_count:activePlacements.length,
    active_placements:activePlacements,
    gp2_world_entries:gp2Entries,
    gp2_career_rows:gp2Career,
    nick_profile:nickProfile,
    rating_audit:ratingAudit,
  }));

  assert.ok(gp2Entries.length>0,"2007 audit requires GP2 entries");
  assert.ok(ratingAudit.some((row)=>row.name==="Nick Heidfeld"),"2007 audit requires Nick Heidfeld");
});
