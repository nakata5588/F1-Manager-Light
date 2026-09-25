import test from "node:test";
import assert from "node:assert/strict";

import {
  createNewSaveMeta,
  extractGameStateFromStoredSave,
  prepareGameStateForSave,
} from "../src/core/saveSafety.js";
import { rngFor } from "../src/core/random.js";
import {
  applyRaceRelationshipConsequences,
  driverRelationshipConsequenceProfile,
  teamOrderComplianceProfile,
} from "../src/domain/driverRelationshipConsequences.js";
import { issueLiveRaceCommand } from "../src/engine/LiveRaceEngine.js";

function relation({
  driver="D1",
  type,
  target,
  team="T1",
  trust=50,
  respect=50,
  affinity=50,
  satisfaction=50,
  rivalry=0,
  active=true,
}){
  return {
    driver_id:driver,
    target_type:type,
    target_id:target,
    team_id:team,
    trust,
    respect,
    affinity,
    satisfaction,
    rivalry,
    score:(trust+respect+affinity+satisfaction)/4,
    active,
  };
}

function relationMap(rows){
  return Object.fromEntries(rows.map((row)=>[
    [row.driver_id,row.target_type,row.target_id].join("|"),
    row,
  ]));
}

function auditState(seed="d70-integration"){
  return {
    activeYear:1980,
    currentDateISO:"1980-07-01",
    currentRound:8,
    saveMeta:createNewSaveMeta({year:1980,teamId:"T1",seed}),
    team:{team_id:"T1",name:"Player Team"},
    drivers:[
      {driver_id:"D1",display_name:"Driver One",team_id:"T1"},
      {driver_id:"D2",display_name:"Driver Two",team_id:"T1"},
    ],
    contracts:[
      {year:1980,team_id:"T1",driver_id:"D1",role:"Main Driver",status:"active"},
      {year:1980,team_id:"T1",driver_id:"D2",role:"Second Driver",status:"active"},
    ],
    staffCore:[
      {staff_id:"E1",staff_name:"Engineer One",role_primary:"race_engineer"},
    ],
    staffContracts:[
      {year:1980,team_id:"T1",staff_id:"E1",staff_name:"Engineer One",role:"race_engineer",status:"active"},
    ],
    driverAttributes:{
      D1:{confidence:50,morale:50,preparation:50,fatigue:0},
      D2:{confidence:50,morale:50,preparation:50,fatigue:0},
    },
    driverMentalStateLog:{
      D1:[{source:"pre_audit",reason:"Existing state",deltas:{morale:-1}}],
    },
    driverRelationships:{
      version:2,
      relations:relationMap([
        relation({type:"team",target:"T1",trust:28,respect:48,affinity:35,satisfaction:24}),
        relation({type:"manager",target:"player_manager",trust:32,respect:42,affinity:35,satisfaction:28}),
        relation({type:"race_engineer",target:"E1",trust:70,respect:72,affinity:68,satisfaction:65}),
        relation({type:"teammate",target:"D2",trust:25,respect:45,affinity:20,satisfaction:25,rivalry:82}),
      ]),
      log:[{source:"pre_audit",driver_id:"D1"}],
    },
    driverRivalries:{
      version:1,
      pairs:{
        "D1|D2":{
          pair_key:"D1|D2",
          driver_a_id:"D1",
          driver_b_id:"D2",
          rivalry:88,
          respect_a_to_b:42,
          respect_b_to_a:44,
          status:"intense",
          active:true,
          years:[1980],
        },
      },
      log:[{source:"pre_audit",pair_key:"D1|D2"}],
    },
    driverStaffAssignments:{
      version:1,
      assignments:{
        "D1|race_engineer":{
          driver_id:"D1",
          staff_id:"E1",
          team_id:"T1",
          role:"race_engineer",
          active:true,
          start_year:1980,
        },
      },
      history:[],
    },
    raceEntryState:{
      entries:[
        {driver_id:"D1",team_id:"T1"},
        {driver_id:"D2",team_id:"T1"},
      ],
    },
    raceWeekendState:{
      key:"1980-d70-audit",
      phase:"race",
      race_strategy:{live_commands:{}},
      live_race:{
        status:"running",
        current_lap:10,
        current_sector:3,
        total_laps:50,
        events:[],
        classification:[
          {driver_id:"D1",position:4,retired:false,gap_to_previous_ms:1200},
          {driver_id:"D2",position:5,retired:false,gap_to_previous_ms:900},
        ],
      },
    },
  };
}

function roundTrip(state){
  const saved=prepareGameStateForSave(state);
  const loaded=extractGameStateFromStoredSave({
    meta:{name:"D7.0 integration audit"},
    gameState:saved,
  });
  return {saved,loaded};
}

test("D7.0 Save/Load preserves Driver relationship consequence state",()=>{
  const {saved,loaded}=roundTrip(auditState());

  assert.deepEqual(loaded.driverRelationships,saved.driverRelationships);
  assert.deepEqual(loaded.driverRivalries,saved.driverRivalries);
  assert.deepEqual(loaded.driverStaffAssignments,saved.driverStaffAssignments);
  assert.deepEqual(loaded.driverMentalStateLog,saved.driverMentalStateLog);

  const before=driverRelationshipConsequenceProfile(saved,"D1",{teamId:"T1",teammateId:"D2"});
  const after=driverRelationshipConsequenceProfile(loaded,"D1",{teamId:"T1",teammateId:"D2"});
  assert.deepEqual(after,before);
  assert.equal(after.engineer.staff_id,"E1");
  assert.ok(after.strongest_rival);
});

test("D7.0 relationship mental consequences remain functional after Save/Load",()=>{
  const {loaded}=roundTrip(auditState());
  const result={
    year:1980,
    round:8,
    gp_id:"GP8",
    classification:[
      {driver_id:"D1",team_id:"T1",position:2,status:"Finished",retired:false},
      {driver_id:"D2",team_id:"T1",position:3,status:"Finished",retired:false},
    ],
  };

  const beforeConfidence=loaded.driverAttributes.D1.confidence;
  const beforeLogLength=(loaded.driverMentalStateLog.D1||[]).length;
  const next=applyRaceRelationshipConsequences(loaded,result);

  assert.ok(next.driverAttributes.D1.confidence>beforeConfidence);
  assert.ok((next.driverMentalStateLog.D1||[]).length>beforeLogLength);
  assert.ok(
    (next.driverMentalStateLog.D1||[]).some((row)=>row.source==="relationship_consequences")
  );
});

test("D7.0 loaded careers still execute relationship-aware live team orders",()=>{
  let chosen=null;
  for(let i=1;i<=200;i++){
    const candidate=auditState("d70-team-order-"+i);
    const compliance=teamOrderComplianceProfile(candidate,"D1","D2",{teamId:"T1"});
    const roll=rngFor(
      candidate,
      "team-order-compliance:1980-d70-audit:D1:D2:11"
    ).next();
    if(roll<=compliance.probability){
      chosen=candidate;
      break;
    }
  }
  assert.ok(chosen,"expected to find a deterministic compliant team-order seed");

  const expected=teamOrderComplianceProfile(chosen,"D1","D2",{teamId:"T1"});
  const {loaded}=roundTrip(chosen);
  const restored=teamOrderComplianceProfile(loaded,"D1","D2",{teamId:"T1"});
  assert.deepEqual(restored,expected);

  const next=issueLiveRaceCommand(loaded,{
    driverId:"D1",
    type:"team_order",
    teamOrder:"yield",
    teammateId:"D2",
  });
  const commands=next.raceWeekendState.race_strategy.live_commands.D1||[];
  const command=commands.at(-1);

  assert.equal(command?.type,"team_order");
  assert.equal(command?.team_order,"yield");
  assert.equal(command?.teammate_id,"D2");
  assert.equal(command?.relationship_compliance,expected.probability);
});
