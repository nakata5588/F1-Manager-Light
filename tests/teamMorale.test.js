import test from "node:test";
import assert from "node:assert/strict";
import {
  applyRaceTeamMorale,
  teamOperationalMorale,
  teamWorkRateMultiplier,
} from "../src/domain/teamMorale.js";
import { standardBuildQuote } from "../src/domain/componentService.js";

function baseState(){
  return {
    activeYear:1980,
    currentDateISO:"1980-05-18",
    team:{team_id:"T1"},
    contracts:[
      {year:1980,driver_id:"D1",team_id:"T1",role:"Main Driver",status:"active",contract_until_year:1981},
      {year:1980,driver_id:"D2",team_id:"T1",role:"Second Driver",status:"active",contract_until_year:1981},
    ],
    facilities:[{year:1980,team_id:"T1",manufacturing_leve:5}],
  };
}

test("DNFs lower team operational morale while wins can raise it",()=>{
  const gs=baseState();
  const afterDnf=applyRaceTeamMorale(gs,{
    gp:{gp_name:"Test GP"},
    race:[
      {driver:{driver_id:"D1"},pos:15,retired:true,retirement_reason:"Engine"},
      {driver:{driver_id:"D2"},pos:16,retired:true,retirement_reason:"Accident"},
    ],
  });
  assert.ok(teamOperationalMorale(afterDnf,"T1")<50);
  assert.ok(afterDnf.teamMoraleLog.T1.at(-1).delta<0);

  const afterWin=applyRaceTeamMorale(afterDnf,{
    gp:{gp_name:"Recovery GP"},
    race:[
      {driver:{driver_id:"D1"},pos:1,retired:false},
      {driver:{driver_id:"D2"},pos:3,retired:false},
    ],
  });
  assert.ok(teamOperationalMorale(afterWin,"T1")>teamOperationalMorale(afterDnf,"T1"));
});

test("team morale changes technical lead-time multiplier",()=>{
  const low={...baseState(),teamOperationalState:{T1:{morale:20}}};
  const neutral={...baseState(),teamOperationalState:{T1:{morale:50}}};
  const high={...baseState(),teamOperationalState:{T1:{morale:85}}};

  assert.ok(teamWorkRateMultiplier(high,"T1")<1);
  assert.equal(teamWorkRateMultiplier(neutral,"T1"),1);
  assert.ok(teamWorkRateMultiplier(low,"T1")>1);

  const lowQuote=standardBuildQuote(low,"aero_front");
  const neutralQuote=standardBuildQuote(neutral,"aero_front");
  const highQuote=standardBuildQuote(high,"aero_front");
  assert.ok(lowQuote.days>=neutralQuote.days);
  assert.ok(highQuote.days<=neutralQuote.days);
});


test("race morale updates every team in the classification, not only the player team",()=>{
  const base=baseState();
  const gs={
    ...base,
    contracts:[
      ...base.contracts,
      {year:1980,driver_id:"D3",team_id:"T2",role:"Main Driver",status:"active",contract_until_year:1981},
      {year:1980,driver_id:"D4",team_id:"T2",role:"Second Driver",status:"active",contract_until_year:1981},
    ],
  };

  const next=applyRaceTeamMorale(gs,{
    gp:{gp_name:"Multi Team GP"},
    race:[
      {driver:{driver_id:"D1"},pos:1,retired:false},
      {driver:{driver_id:"D2"},pos:4,retired:false},
      {driver:{driver_id:"D3"},pos:12,retired:true,retirement_reason:"Engine"},
      {driver:{driver_id:"D4"},pos:8,retired:false},
    ],
  });

  assert.ok(next.teamOperationalState.T1);
  assert.ok(next.teamOperationalState.T2);
  assert.ok(teamOperationalMorale(next,"T1")>50);
  assert.ok(teamOperationalMorale(next,"T2")<50);
  assert.ok(next.teamMoraleLog.T1?.length);
  assert.ok(next.teamMoraleLog.T2?.length);
});
