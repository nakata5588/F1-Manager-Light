import test from "node:test";
import assert from "node:assert/strict";

import {
  aeroTestingRemaining,
  aerodynamicTestingPeriods,
  componentDevelopmentRule,
  defaultAeroAllocation,
  developmentRegulationProfile,
  normalizedAeroAllocation,
  recordAeroTestingUsage,
  usesAerodynamicTesting,
} from "../src/domain/developmentRegulations.js";
import { developmentObjectivesForSlot } from "../src/domain/developmentProject.js";

function fixture(year=1980,date=`${year}-02-01`){
  return {
    activeYear:year,
    currentDateISO:date,
    team:{team_id:"PLAYER"},
    standings:{teams:[
      {team_id:"PLAYER",position:8,points:10},
      {team_id:"RIVAL",position:1,points:100},
    ]},
    historySeasons:[
      {year:year-1,standings:{teams:[
        {team_id:"PLAYER",position:1,points:120},
        {team_id:"RIVAL",position:2,points:100},
      ]}},
    ],
    carParts:[],
  };
}

test("1980 uses physical wind-tunnel development with no CFD or FIA quota",()=>{
  const gs=fixture(1980,"1980-06-01");
  const profile=developmentRegulationProfile(gs,"PLAYER");
  assert.equal(profile.scheme,"pre_cfd_open");
  assert.equal(profile.cfd_available,false);
  assert.equal(profile.wind_tunnel_available,true);
  assert.equal(profile.hard_quota,false);
  assert.equal(profile.limits,null);
  assert.equal(componentDevelopmentRule(gs,"PLAYER","gearbox").rule,"free");
  assert.equal(componentDevelopmentRule(gs,"PLAYER","aero_front").rule,"free");
});

test("aero testing is only consumed by aerodynamically relevant component families",()=>{
  const gs=fixture(1980);
  assert.equal(usesAerodynamicTesting(gs,"aero_front"),true);
  assert.equal(usesAerodynamicTesting(gs,"underfloor"),true);
  assert.equal(usesAerodynamicTesting(gs,"suspension"),true);
  assert.equal(usesAerodynamicTesting(gs,"gearbox"),false);
  assert.equal(usesAerodynamicTesting(gs,"brakes"),false);

  const mechanical=normalizedAeroAllocation(gs,"PLAYER","gearbox",{windTunnel:25,cfd:40},{});
  assert.equal(mechanical.wind_tunnel,0);
  assert.equal(mechanical.cfd,0);
});

test("CFD becomes an internal development resource from the 1990 era",()=>{
  const profile=developmentRegulationProfile(fixture(1990),"PLAYER");
  assert.equal(profile.scheme,"internal_cfd_open");
  assert.equal(profile.cfd_available,true);
  assert.equal(profile.hard_quota,false);
});

test("2014-2020 is recognised as FIA-restricted without inventing one universal quota",()=>{
  const profile=developmentRegulationProfile(fixture(2014),"PLAYER");
  assert.equal(profile.scheme,"fia_restricted_unmodelled");
  assert.equal(profile.regulated_aero_testing,true);
  assert.equal(profile.hard_quota,false);
});

test("2021 ATR uses the documented 90 percent allowance for the reigning champion",()=>{
  const gs=fixture(2021,"2021-02-01");
  const profile=developmentRegulationProfile(gs,"PLAYER");
  assert.equal(profile.scheme,"fia_atr");
  assert.equal(profile.period.number,1);
  assert.equal(profile.championship_position,1);
  assert.equal(profile.coefficient,90);
  assert.equal(profile.limits.wind_tunnel_hours,72);
  assert.equal(profile.limits.cfd_mauh,5.4);
  assert.equal(profile.limits.wind_tunnel_runs,288);
});

test("2022-2026 ATR uses the 70-115 sliding scale and current position for the second half",()=>{
  const gs=fixture(2025,"2025-09-01");
  const profile=developmentRegulationProfile(gs,"PLAYER");
  assert.ok(profile.period.number>=4);
  assert.equal(profile.championship_position,8);
  assert.equal(profile.coefficient,105);
  assert.equal(profile.limits.wind_tunnel_hours,84);
  assert.equal(profile.limits.cfd_mauh,6.3);
});

test("ATR calendar contains six contiguous periods and period six ends 31 December",()=>{
  const rows=aerodynamicTestingPeriods(2025);
  assert.equal(rows.length,6);
  assert.equal(rows[0].start,"2025-01-01");
  assert.equal(rows.at(-1).end,"2025-12-31");
  for(let i=1;i<rows.length;i+=1){
    const previous=new Date(rows[i-1].end+"T00:00:00Z");
    previous.setUTCDate(previous.getUTCDate()+1);
    assert.equal(rows[i].start,previous.toISOString().slice(0,10));
  }
});

test("ATR usage is deducted from the current period and rejects over-allocation",()=>{
  const gs=fixture(2025,"2025-02-01");
  const profile=developmentRegulationProfile(gs,"PLAYER");
  let development={projects:[],aeroTestingUsage:[]};
  development=recordAeroTestingUsage(development,profile,{windTunnel:20,cfd:1.25});
  const remaining=aeroTestingRemaining(development,profile);
  assert.equal(remaining.wind_tunnel_hours_remaining,36);
  assert.equal(remaining.cfd_mauh_remaining,2.95);

  const valid=normalizedAeroAllocation(gs,"PLAYER","aero_front",{windTunnel:10,cfd:0.5},development);
  assert.equal(valid.allowed,true);
  const invalid=normalizedAeroAllocation(gs,"PLAYER","aero_front",{windTunnel:40,cfd:0.5},development);
  assert.equal(invalid.allowed,false);
  assert.equal(invalid.reason,"wind_tunnel_quota");
});

test("modern default aero allocation never exceeds the current ATR balance",()=>{
  const gs=fixture(2025,"2025-02-01");
  const profile=developmentRegulationProfile(gs,"PLAYER");
  const development=recordAeroTestingUsage({aeroTestingUsage:[]},profile,{windTunnel:54,cfd:4.0});
  const allocation=defaultAeroAllocation(gs,"PLAYER","aero_front",development);
  assert.equal(allocation.windTunnel,2);
  assert.equal(allocation.cfd,0.2);
});

test("2026 gearbox is reliability-only while PU elements leave normal team development",()=>{
  const gs=fixture(2026,"2026-04-01");
  const gearbox=componentDevelopmentRule(gs,"PLAYER","gearbox");
  assert.equal(gearbox.rule,"homologated_reliability");
  assert.deepEqual(gearbox.allowed_objectives,["reliability"]);
  assert.deepEqual(developmentObjectivesForSlot(gs,"gearbox","PLAYER").map((row)=>row.id),["reliability"]);

  const turbo=componentDevelopmentRule(gs,"PLAYER","turbocharger");
  assert.equal(turbo.rule,"pu_homologated");
  assert.equal(turbo.can_start_project,false);
  assert.deepEqual(developmentObjectivesForSlot(gs,"turbocharger","PLAYER"),[]);
});

test("1980 keeps all era-eligible component design objectives unrestricted by homologation",()=>{
  const gs=fixture(1980);
  const gearbox=developmentObjectivesForSlot(gs,"gearbox","PLAYER").map((row)=>row.id);
  assert.ok(gearbox.includes("balanced"));
  assert.ok(gearbox.includes("reliability"));
  assert.ok(gearbox.includes("power_delivery"));
});
