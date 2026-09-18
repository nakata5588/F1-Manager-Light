import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root=process.cwd();
const targetYears=[1975,1980,1989,1999,2014,2020];
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
    assert.equal(
      state.teams.length,
      expectedTeamCounts[year],
      `${year} managerial team identity count changed unexpectedly`
    );
    assert.ok(state.drivers.length>=4,`${year} must have at least 4 visible drivers`);

    const teamIds=new Set(state.teams.map((t)=>String(t.team_id)));
    const driverIds=new Set(state.drivers.map((d)=>String(d.driver_id)));
    for(const row of state.contracts||[]){
      assert.ok(teamIds.has(String(row.team_id)),`${year} contract references missing team ${row.team_id}`);
      assert.ok(driverIds.has(String(row.driver_id)),`${year} contract references missing driver ${row.driver_id}`);
    }

    const driverContracts=(state.contracts||[]).filter((row)=>/driver|main|second/i.test(String(row.role||"driver")));
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
