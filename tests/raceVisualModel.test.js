import test from "node:test";
import assert from "node:assert/strict";
import {
  RACE_VISUAL_MOTION_MODES,
  buildRaceVisualModel,
  driverReferenceSectorMs,
  driverVisualMotionDurationMs,
  interpolateVisualGap,
  visualMotionMode,
} from "../src/domain/raceVisualModel.js";

test("RW6.7A uses each driver's own sector pace for visual motion",()=>{
  const fast={driver_id:"fast",sector_2_ms:29000};
  const slow={driver_id:"slow",sector_2_ms:32000};
  assert.equal(driverReferenceSectorMs(fast,2,{fallbackSectorMs:30500}),29000);
  assert.equal(driverReferenceSectorMs(slow,2,{fallbackSectorMs:30500}),32000);
  assert.ok(driverVisualMotionDurationMs(fast,{currentSector:2,globalSectorMs:30500})<driverVisualMotionDurationMs(slow,{currentSector:2,globalSectorMs:30500}));
});

test("RW6.7A falls back to observed lap pace and then global sector pace",()=>{
  assert.equal(driverReferenceSectorMs({last_lap_ms:93000},1,{fallbackSectorMs:30000}),31000);
  assert.equal(driverReferenceSectorMs({},1,{fallbackSectorMs:30400}),30400);
});

test("continuous visual gaps interpolate without changing authoritative endpoints",()=>{
  assert.equal(interpolateVisualGap(1200,600,0),1200);
  assert.equal(interpolateVisualGap(1200,600,0.5),900);
  assert.equal(interpolateVisualGap(1200,600,1),600);
});

test("visual motion modes are descriptive only and preserve engine ownership",()=>{
  assert.equal(visualMotionMode({retired:true}),RACE_VISUAL_MOTION_MODES.RETIRED);
  assert.equal(visualMotionMode({pit_state:"pit_entry"}),RACE_VISUAL_MOTION_MODES.PIT_ENTRY);
  assert.equal(visualMotionMode({},{currentControl:"VSC"}),RACE_VISUAL_MOTION_MODES.VSC);
  assert.equal(visualMotionMode({},{currentControl:"SAFETY_CAR"}),RACE_VISUAL_MOTION_MODES.SAFETY_CAR);
  assert.equal(visualMotionMode({},{currentControl:"RED_FLAG"}),RACE_VISUAL_MOTION_MODES.RED_FLAG);
});

test("visual model mirrors authoritative race state and adds presentation timing",()=>{
  const rows=[
    {driver_id:"a",position:1,gap_to_leader_ms:0,sector_1_ms:30000},
    {driver_id:"b",position:2,gap_to_leader_ms:850,interval_ms:850,sector_1_ms:30600},
  ];
  const model=buildRaceVisualModel(rows,{currentSector:1,globalSectorMs:30300});
  assert.equal(model[0].authoritative_position,1);
  assert.equal(model[1].authoritative_position,2);
  assert.equal(model[1].authoritative_gap_ms,850);
  assert.equal(model[1].sector_duration_ms,30600);
  assert.equal(model[1].motion_mode,RACE_VISUAL_MOTION_MODES.RACING);
});
