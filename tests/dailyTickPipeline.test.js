import test from "node:test";
import assert from "node:assert/strict";

import {
  DAILY_TICK_STAGE_IDS,
  DailyTickPipelineError,
  runDailyTickPipeline,
} from "../src/engine/DailyTickEngine.js";
import {
  scheduleEventFromBlock,
  triggerDailyTick,
} from "../src/engine/EventEngine.js";

test("F0.2 daily tick has one explicit canonical gameplay stage order",()=>{
  assert.deepEqual(DAILY_TICK_STAGE_IDS,[
    "events",
    "scouting",
    "driver-availability",
    "workshop",
    "player-technical",
    "technology-adoption",
    "ai-technical",
    "technology-news",
    "rules",
    "progression",
    "next-season-car",
    "economy",
    "driver-market",
    "driver-negotiations",
    "inbox",
  ]);
});

test("F0.2 pipeline carries state through every stage in order",()=>{
  const calls=[];
  const result=runDailyTickPipeline(
    {currentDateISO:"1980-02-02",value:0},
    {
      stages:[
        {id:"one",run:(state)=>{calls.push(["one",state.value]);return {...state,value:state.value+1};}},
        {id:"two",run:(state)=>{calls.push(["two",state.value]);return {...state,value:state.value+2};}},
        {id:"three",run:(state)=>{calls.push(["three",state.value]);return {...state,value:state.value+3};}},
      ],
    }
  );

  assert.deepEqual(calls,[["one",0],["two",1],["three",3]]);
  assert.equal(result.state.value,6);
  assert.deepEqual(result.completedStages,["one","two","three"]);
  assert.equal(result.dateISO,"1980-02-02");
});

test("F0.2 pipeline is fail-fast and reports the exact failed gameplay stage",()=>{
  const source={currentDateISO:"1980-03-03",value:0};
  const calls=[];

  assert.throws(
    ()=>runDailyTickPipeline(source,{
      stages:[
        {id:"first",run:(state)=>{calls.push("first");return {...state,value:1};}},
        {id:"broken",run:()=>{calls.push("broken");throw new Error("boom");}},
        {id:"must-not-run",run:(state)=>{calls.push("must-not-run");return state;}},
      ],
    }),
    (error)=>{
      assert.ok(error instanceof DailyTickPipelineError);
      assert.equal(error.stage,"broken");
      assert.equal(error.dateISO,"1980-03-03");
      assert.deepEqual(error.completedStages,["first"]);
      assert.match(error.message,/boom/);
      return true;
    }
  );

  assert.deepEqual(calls,["first","broken"]);
  assert.deepEqual(source,{currentDateISO:"1980-03-03",value:0});
});

test("F0.2 pipeline rejects invalid stage return contracts",()=>{
  assert.throws(
    ()=>runDailyTickPipeline(
      {currentDateISO:"1980-04-04"},
      {stages:[{id:"bad-return",run:()=>null}]}
    ),
    (error)=>error instanceof DailyTickPipelineError
      &&error.stage==="bad-return"
      &&/did not return a gameState object/.test(error.message)
  );
});

test("F0.2 gameplay event processing requires the Save World date",()=>{
  assert.throws(
    ()=>triggerDailyTick({eventsQueue:[]}),
    /currentDateISO/
  );

  assert.throws(
    ()=>scheduleEventFromBlock({block_id:"training",name:"Training",effects:{}},{}),
    /dateISO or currentDateISO/
  );

  const event=scheduleEventFromBlock(
    {block_id:"training",name:"Training",effects:{}},
    {currentDateISO:"1980-05-01",id:"event-test"}
  );
  assert.equal(event.dateISO,"1980-05-02");
  assert.equal(event.id,"event-test");
});
