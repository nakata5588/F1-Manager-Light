import test from "node:test";
import assert from "node:assert/strict";
import {
  applyDriverRivalryEvent,
  applyRaceDriverRivalries,
  driverRivalry,
  driverRivalryEventLogForDriver,
  driverRivalryRecords,
  globalRivalryBand,
  rivalryPairKey,
} from "../src/domain/driverRivalries.js";

function baseState(overrides={}){
  return {
    activeYear:1980,
    currentDateISO:"1980-07-01",
    calendar:Array.from({length:14},(_,i)=>({year:1980,round:i+1})),
    standings:{drivers:[],teams:[]},
    drivers:[
      {driver_id:"D1",display_name:"Driver One"},
      {driver_id:"D2",display_name:"Driver Two"},
      {driver_id:"D3",display_name:"Driver Three"},
    ],
    ...overrides,
  };
}

function result({
  round=5,
  classification=null,
  incidents=[],
}={}){
  return {
    year:1980,
    round,
    gp_id:"GP"+round,
    raceStrategy:{
      race_control:{
        incidents,
      },
    },
    classification:classification||[
      {driver_id:"D1",team_id:"T1",position:1,status:"Finished",retired:false,gap_to_previous_ms:0},
      {driver_id:"D2",team_id:"T2",position:2,status:"Finished",retired:false,gap_to_previous_ms:1200},
      {driver_id:"D3",team_id:"T3",position:9,status:"Finished",retired:false,gap_to_previous_ms:19000},
    ],
  };
}

test("D6.3E rivalry pair identity is symmetric and uses non-hostile bands",()=>{
  assert.equal(rivalryPairKey("D2","D1"),"D1|D2");
  assert.equal(rivalryPairKey("D1","D1"),"");
  assert.equal(globalRivalryBand(0),"emerging");
  assert.equal(globalRivalryBand(20),"competitive");
  assert.equal(globalRivalryBand(45),"rivalry");
  assert.equal(globalRivalryBand(70),"intense");
  assert.equal(globalRivalryBand(90),"defining");
});

test("D6.3E a genuinely close finish builds global rivalry and mutual respect",()=>{
  const next=applyRaceDriverRivalries(baseState(),result(),{standings:[]});
  const pair=driverRivalry(next,"D1","D2");
  assert.ok(pair);
  assert.equal(pair.close_battles,1);
  assert.equal(pair.collisions,0);
  assert.equal(pair.rivalry,1.3);
  assert.equal(pair.respect_a_to_b,50.2);
  assert.equal(pair.respect_b_to_a,50.35);
  assert.equal(pair.active,false);
});

test("D6.3E repeated close battles persist even if drivers change teams",()=>{
  let gs=baseState();
  gs=applyRaceDriverRivalries(gs,result({round:2}),{standings:[]});
  gs.currentDateISO="1980-08-01";
  gs=applyRaceDriverRivalries(gs,result({
    round:3,
    classification:[
      {driver_id:"D1",team_id:"NEW_A",position:3,status:"Finished",retired:false,gap_to_previous_ms:1800},
      {driver_id:"D2",team_id:"NEW_B",position:4,status:"Finished",retired:false,gap_to_previous_ms:900},
      {driver_id:"D3",team_id:"T3",position:10,status:"Finished",retired:false,gap_to_previous_ms:22000},
    ],
  }),{standings:[]});
  gs.currentDateISO="1980-09-01";
  gs=applyRaceDriverRivalries(gs,result({
    round:4,
    classification:[
      {driver_id:"D2",team_id:"THIRD_B",position:1,status:"Finished",retired:false,gap_to_previous_ms:0},
      {driver_id:"D1",team_id:"THIRD_A",position:2,status:"Finished",retired:false,gap_to_previous_ms:700},
      {driver_id:"D3",team_id:"T3",position:8,status:"Finished",retired:false,gap_to_previous_ms:16000},
    ],
  }),{standings:[]});

  const pair=driverRivalry(gs,"D1","D2");
  assert.equal(Object.keys(gs.driverRivalries.pairs).length,1);
  assert.equal(pair.close_battles,3);
  assert.ok(pair.rivalry>4);
  assert.deepEqual(pair.years,[1980]);
});

test("D6.3E collision is a strong rivalry trigger and reduces respect",()=>{
  const next=applyRaceDriverRivalries(baseState(),result({
    incidents:[{
      driver_id:"D1",
      other_driver_id:"D2",
      lap:22,
      kind:"collision",
      reason:"Collision",
      severity_score:0.8,
    }],
  }),{standings:[]});

  const pair=driverRivalry(next,"D2","D1");
  assert.ok(pair);
  assert.equal(pair.collisions,1);
  assert.equal(pair.close_battles,0,"collision pair must not also receive a close-finish trigger");
  assert.equal(pair.rivalry,11);
  assert.equal(pair.respect_a_to_b,47.36);
  assert.equal(pair.respect_b_to_a,47.36);
});

test("D6.3E repeated major incidents can turn an emerging competition into an active rivalry",()=>{
  let gs=baseState();
  for(let round=2;round<=3;round++){
    gs={...gs,currentDateISO:`1980-0${round+4}-01`};
    gs=applyRaceDriverRivalries(gs,result({
      round,
      incidents:[{
        driver_id:"D1",
        other_driver_id:"D2",
        lap:10+round,
        kind:"collision",
        reason:"Collision",
        severity_score:0.8,
      }],
    }),{standings:[]});
  }
  const pair=driverRivalry(gs,"D1","D2");
  assert.ok(pair.rivalry>=22);
  assert.equal(pair.active,true);
  assert.equal(pair.status,"competitive");
});

test("D6.3E close championship contenders build rivalry independently of race finish proximity",()=>{
  const gs=baseState();
  const next=applyRaceDriverRivalries(gs,result({
    round:10,
    classification:[
      {driver_id:"D1",team_id:"T1",position:1,status:"Finished",retired:false,gap_to_previous_ms:0},
      {driver_id:"D3",team_id:"T3",position:2,status:"Finished",retired:false,gap_to_previous_ms:9000},
      {driver_id:"D2",team_id:"T2",position:8,status:"Finished",retired:false,gap_to_previous_ms:18000},
    ],
  }),{
    standings:[
      {driver_id:"D1",position:1,points:55},
      {driver_id:"D2",position:2,points:51},
      {driver_id:"D3",position:3,points:30},
    ],
  });

  const pair=driverRivalry(next,"D1","D2");
  assert.ok(pair);
  assert.equal(pair.championship_battles,1);
  assert.equal(pair.close_battles,0);
  assert.equal(pair.rivalry,1.4,"late-season close title fight gets the late-season bonus");
  assert.equal(pair.respect_a_to_b,50.25);
  assert.equal(pair.respect_b_to_a,50.25);
});

test("D6.3E ordinary distant midfield proximity does not create a rivalry",()=>{
  const next=applyRaceDriverRivalries(baseState(),result({
    classification:[
      {driver_id:"D1",team_id:"T1",position:10,status:"Finished",retired:false,gap_to_previous_ms:9000},
      {driver_id:"D2",team_id:"T2",position:11,status:"Finished",retired:false,gap_to_previous_ms:8000},
    ],
  }),{standings:[]});
  assert.equal(driverRivalry(next,"D1","D2"),null);
  assert.equal(next.driverRivalries,undefined);
});

test("D6.3E driver perspective exposes independent respect and readable event log",()=>{
  let gs=baseState();
  gs=applyDriverRivalryEvent(gs,{
    driverA:"D2",
    driverB:"D1",
    rivalryDelta:20,
    respectDeltaA:3,
    respectDeltaB:-2,
    source:"test_duel",
    reason:"Test duel",
    counters:{close_battles:1},
  });

  const d1=driverRivalryRecords(gs,"D1")[0];
  const d2=driverRivalryRecords(gs,"D2")[0];
  assert.equal(d1.target_id,"D2");
  assert.equal(d1.respect,48);
  assert.equal(d2.target_id,"D1");
  assert.equal(d2.respect,53);
  assert.equal(d1.active,true);

  const d1Log=driverRivalryEventLogForDriver(gs,"D1");
  assert.equal(d1Log[0].target_type,"rival");
  assert.equal(d1Log[0].target_id,"D2");
  assert.equal(d1Log[0].changes.find((row)=>row.field==="respect").delta,-2);
});
