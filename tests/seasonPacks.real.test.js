import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { isRaceDriverContract } from "../src/domain/contractRoles.js";

const root=process.cwd();
const targetYears=[1975,1980,1987,1989,1999,2014,2020];
const expectedTeamCounts={
  1975:19,
  1980:15,
  1989:20,
  1999:11,
  2014:11,
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
    for(const team of state.teams){
      const tid=String(team.team_id);
      const seats=driverContracts.filter((row)=>String(row.team_id)===tid);
      assert.ok(seats.length>=2,`${year} team ${tid} must start with at least two drivers, found ${seats.length}`);
      for(const seat of seats.slice(0,2)){
        const did=String(seat.driver_id);
        assert.equal(assignedDriverIds.has(did),false,`${year} driver ${did} cannot occupy two starting teams`);
        assignedDriverIds.add(did);
      }
    }

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


test("1980 Shadow keeps test drivers separate from its two race seats",async()=>{
  const pack=await readPack(1980);
  const shadow=(pack.state.teams||[]).find((t)=>String(t.team_name||t.name)==="Shadow");
  assert.ok(shadow,"1980 Shadow must exist");
  const contracts=(pack.state.contracts||[]).filter((c)=>String(c.team_id)===String(shadow.team_id));
  const raceSeats=contracts.filter(isRaceDriverContract);
  const testDrivers=contracts.filter((c)=>/test|reserve/i.test(String(c.role||"")));
  assert.ok(raceSeats.length>=2,"Shadow must have two race seats, found "+raceSeats.length);
  assert.ok(testDrivers.length>=1,"Shadow test-driver contract should remain available without occupying a race seat");
  assert.equal(raceSeats.some((c)=>String(c.driver_id)==="d_0862"),false,"David Kennedy test_driver must not be treated as a race seat");
});
