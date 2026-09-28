import test from "node:test";
import assert from "node:assert/strict";

import {
  lockRaceWeekendEngineVersion,
  raceWeekendEngineVersion,
  runRaceWeekendGateway,
  stampRaceWeekendEngineVersion,
} from "../src/race2/gateway/RaceWeekendGateway.js";

test("RW8.0A new weekends default to Legacy and can explicitly lock RW2",()=>{
  assert.equal(lockRaceWeekendEngineVersion(null),"legacy");
  assert.equal(lockRaceWeekendEngineVersion(null,{requestedEngineVersion:"rw2"}),"rw2");
});

test("RW8.0A an existing weekend never switches engine mid-session",()=>{
  assert.equal(
    lockRaceWeekendEngineVersion({engine_version:"legacy"},{requestedEngineVersion:"rw2"}),
    "legacy"
  );
  assert.equal(
    lockRaceWeekendEngineVersion({engine_version:"rw2"},{requestedEngineVersion:"legacy"}),
    "rw2"
  );
  assert.equal(
    raceWeekendEngineVersion({key:"old_save_without_engine_version"}),
    "legacy",
    "old active saves must resolve to Legacy rather than silently switching engine"
  );

  const stamped=stampRaceWeekendEngineVersion({key:"new_weekend"},{requestedEngineVersion:"rw2"});
  const restamped=stampRaceWeekendEngineVersion(stamped,{requestedEngineVersion:"legacy"});
  assert.equal(restamped.engine_version,"rw2");
});

test("RW8.0A gateway selects one engine only",async()=>{
  const calls=[];
  const legacy=async({engineVersion})=>{calls.push(`legacy:${engineVersion}`);return {engineVersion};};
  const rw2=async({engineVersion})=>{calls.push(`rw2:${engineVersion}`);return {engineVersion};};

  const legacyResult=await runRaceWeekendGateway({weekend:{engine_version:"legacy"},legacy,rw2});
  assert.equal(legacyResult.engineVersion,"legacy");
  assert.deepEqual(calls,["legacy:legacy"]);

  calls.length=0;
  const rw2Result=await runRaceWeekendGateway({weekend:{engine_version:"rw2"},legacy,rw2});
  assert.equal(rw2Result.engineVersion,"rw2");
  assert.deepEqual(calls,["rw2:rw2"]);
});

test("RW8.0A RW2 without an implementation fails explicitly instead of falling through to Legacy",async()=>{
  let legacyCalled=false;
  const result=await runRaceWeekendGateway({
    weekend:{engine_version:"rw2"},
    legacy:async()=>{legacyCalled=true;return {ok:true};},
  });

  assert.deepEqual(result,{ok:false,status:"not_implemented",engine_version:"rw2"});
  assert.equal(legacyCalled,false);
});
