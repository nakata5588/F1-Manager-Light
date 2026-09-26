import test from "node:test";
import assert from "node:assert/strict";
import {
  RACE_VISUAL_MOTION_MODES,
  advanceVisualTimelineProgress,
  buildRaceVisualModel,
  createVisualRaceTimeline,
  driverReferenceSectorMs,
  driverVisualMotionDurationMs,
  interpolateVisualGap,
  visualMotionMode,
  visualMotionProgress,
  visualRaceTimelineFrame,
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


test("RW6.7A individual motion stays synchronized while showing relative pace",()=>{
  assert.equal(visualMotionProgress(0,{individualDurationMs:29000,globalDurationMs:30500}),0);
  assert.equal(visualMotionProgress(1,{individualDurationMs:29000,globalDurationMs:30500}),1);

  const fastMid=visualMotionProgress(0.5,{individualDurationMs:29000,globalDurationMs:30500});
  const baselineMid=visualMotionProgress(0.5,{individualDurationMs:30500,globalDurationMs:30500});
  const slowMid=visualMotionProgress(0.5,{individualDurationMs:32000,globalDurationMs:30500});

  assert.ok(fastMid>baselineMid);
  assert.equal(baselineMid,0.5);
  assert.ok(slowMid<baselineMid);
});

test("Track 2.0A relative pace bias stays subtle enough to avoid visual surges",()=>{
  for(const individualDurationMs of [17000,24000,29000,32000,38000,50000]){
    const mid=visualMotionProgress(0.5,{individualDurationMs,globalDurationMs:30000});
    assert.ok(Math.abs(mid-0.5)<=0.066);
  }
});

test("RW6.7A motion curve remains monotonic for extreme but valid pace ratios",()=>{
  for(const individualDurationMs of [17000,50000]){
    let previous=0;
    for(let step=0;step<=20;step+=1){
      const value=visualMotionProgress(step/20,{individualDurationMs,globalDurationMs:30000});
      assert.ok(value>=previous-1e-9);
      previous=value;
    }
    assert.equal(previous,1);
  }
});


test("Track 2.1A visual timeline preserves authoritative endpoints",()=>{
  const previous=[
    {driver_id:"a",position:1,gap_to_leader_ms:0,interval_ms:0,grid_position:1,sector_2_ms:30000},
    {driver_id:"b",position:2,gap_to_leader_ms:900,interval_ms:900,grid_position:2,sector_2_ms:30000},
  ];
  const target=[
    {driver_id:"b",position:1,gap_to_leader_ms:0,interval_ms:0,grid_position:2,sector_2_ms:30000},
    {driver_id:"a",position:2,gap_to_leader_ms:450,interval_ms:450,grid_position:1,sector_2_ms:30000},
  ];
  const timeline=createVisualRaceTimeline(previous,target,{
    previousLap:1,
    previousSector:1,
    currentLap:1,
    currentSector:2,
    referenceLapMs:90000,
    playbackSpeed:1,
    globalSectorMs:30000,
  });

  const start=visualRaceTimelineFrame(timeline,0).rows;
  const end=visualRaceTimelineFrame(timeline,1).rows;
  assert.deepEqual(start.map((row)=>[row.driver_id,row.position,row.gap_to_leader_ms]),[
    ["a",1,0],
    ["b",2,900],
  ]);
  assert.deepEqual(end.map((row)=>[row.driver_id,row.position,row.gap_to_leader_ms]),[
    ["b",1,0],
    ["a",2,450],
  ]);
});

test("Track 2.1A timing order changes at the visual crossing rather than snapshot arrival",()=>{
  const previous=[
    {driver_id:"a",position:1,gap_to_leader_ms:0,interval_ms:0,sector_2_ms:30000},
    {driver_id:"b",position:2,gap_to_leader_ms:900,interval_ms:900,sector_2_ms:30000},
  ];
  const target=[
    {driver_id:"b",position:1,gap_to_leader_ms:0,interval_ms:0,sector_2_ms:30000},
    {driver_id:"a",position:2,gap_to_leader_ms:450,interval_ms:450,sector_2_ms:30000},
  ];
  const timeline=createVisualRaceTimeline(previous,target,{
    previousLap:1,
    previousSector:1,
    currentLap:1,
    currentSector:2,
    referenceLapMs:90000,
    playbackSpeed:1,
    globalSectorMs:30000,
  });

  const before=visualRaceTimelineFrame(timeline,0.60).rows;
  const after=visualRaceTimelineFrame(timeline,0.75).rows;
  assert.equal(before[0].driver_id,"a");
  assert.equal(before[0].position,1);
  assert.equal(after[0].driver_id,"b");
  assert.equal(after[0].position,1);
  assert.ok(Number(before[0].visual_world_progress)>Number(before[1].visual_world_progress));
  assert.ok(Number(after[0].visual_world_progress)>Number(after[1].visual_world_progress));
});

test("Track 2.1A visual gaps come from the same visual positions used by the map",()=>{
  const previous=[
    {driver_id:"a",position:1,gap_to_leader_ms:0,interval_ms:0,sector_2_ms:30000},
    {driver_id:"b",position:2,gap_to_leader_ms:1800,interval_ms:1800,sector_2_ms:30000},
    {driver_id:"c",position:3,gap_to_leader_ms:3600,interval_ms:1800,sector_2_ms:30000},
  ];
  const target=[
    {driver_id:"a",position:1,gap_to_leader_ms:0,interval_ms:0,sector_2_ms:30000},
    {driver_id:"b",position:2,gap_to_leader_ms:900,interval_ms:900,sector_2_ms:30000},
    {driver_id:"c",position:3,gap_to_leader_ms:2700,interval_ms:1800,sector_2_ms:30000},
  ];
  const timeline=createVisualRaceTimeline(previous,target,{
    previousLap:2,
    previousSector:1,
    currentLap:2,
    currentSector:2,
    referenceLapMs:90000,
    playbackSpeed:1,
    globalSectorMs:30000,
  });
  const frame=visualRaceTimelineFrame(timeline,0.5).rows;
  assert.equal(frame[0].gap_to_leader_ms,0);
  for(let index=1;index<frame.length;index+=1){
    const expected=(frame[0].visual_world_progress-frame[index].visual_world_progress)*90000;
    assert.ok(Math.abs(frame[index].gap_to_leader_ms-expected)<1e-6);
    assert.ok(frame[index].interval_ms>=0);
  }
});

test("Track 2.1A timeline progress freezes on pause and resumes without teleport",()=>{
  const paused=advanceVisualTimelineProgress(0.42,{deltaMs:500,durationMs:1000,running:false});
  assert.equal(paused,0.42);
  const resumed=advanceVisualTimelineProgress(paused,{deltaMs:100,durationMs:1000,running:true});
  assert.ok(Math.abs(resumed-0.52)<1e-9);
});

test("Track 2.1A start-finish wrapping keeps forward physical continuity",()=>{
  const grid=[
    {driver_id:"a",position:1,gap_to_leader_ms:0,grid_position:1,sector_1_ms:30000},
  ];
  const sectorOne=[
    {driver_id:"a",position:1,gap_to_leader_ms:0,grid_position:1,sector_1_ms:30000},
  ];
  const timeline=createVisualRaceTimeline(grid,sectorOne,{
    previousLap:0,
    previousSector:0,
    currentLap:1,
    currentSector:1,
    referenceLapMs:90000,
    playbackSpeed:1,
    globalSectorMs:30000,
  });
  assert.ok(timeline.drivers[0].to_world_progress>timeline.drivers[0].from_world_progress);
  assert.ok(timeline.drivers[0].to_world_progress-timeline.drivers[0].from_world_progress<0.5);
});


test("Track 2.1A visual position delta appears only after the crossing",()=>{
  const previous=[
    {driver_id:"a",position:1,gap_to_leader_ms:0,interval_ms:0,sector_2_ms:30000},
    {driver_id:"b",position:2,gap_to_leader_ms:900,interval_ms:900,sector_2_ms:30000},
  ];
  const target=[
    {driver_id:"b",position:1,gap_to_leader_ms:0,interval_ms:0,sector_2_ms:30000},
    {driver_id:"a",position:2,gap_to_leader_ms:450,interval_ms:450,sector_2_ms:30000},
  ];
  const timeline=createVisualRaceTimeline(previous,target,{
    previousLap:1,
    previousSector:1,
    currentLap:1,
    currentSector:2,
    referenceLapMs:90000,
    playbackSpeed:1,
    globalSectorMs:30000,
  });

  const before=visualRaceTimelineFrame(timeline,0.60).rows;
  assert.equal(before.find((row)=>row.driver_id==="a").visual_position_delta,0);
  assert.equal(before.find((row)=>row.driver_id==="b").visual_position_delta,0);

  const after=visualRaceTimelineFrame(timeline,0.75).rows;
  assert.equal(after.find((row)=>row.driver_id==="b").visual_position_delta,1);
  assert.equal(after.find((row)=>row.driver_id==="a").visual_position_delta,-1);

  const endpoint=visualRaceTimelineFrame(timeline,1).rows;
  assert.equal(endpoint.find((row)=>row.driver_id==="b").visual_position_delta,1);
  assert.equal(endpoint.find((row)=>row.driver_id==="a").visual_position_delta,-1);
});
