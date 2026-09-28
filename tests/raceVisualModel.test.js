import test from "node:test";
import assert from "node:assert/strict";
import {
  RACE_VISUAL_MOTION_MODES,
  advanceVisualTimelineProgress,
  applyVisualPitLaneState,
  buildRaceVisualModel,
  createVisualRaceTimeline,
  driverReferenceSectorMs,
  driverVisualMotionDurationMs,
  interpolateVisualGap,
  pitPhase,
  raceVisualSnapshotKey,
  visualMotionMode,
  visualMotionProgress,
  visualPitLaneState,
  visualRaceTimelineFrame,
} from "../src/domain/raceVisualModel.js";
import { createLivePitState } from "../src/engine/LivePitStopEngine.js";
import { normaliseRaceCarDamage, raceCarDamageSummary, raceCarEraForYear } from "../src/domain/raceCarVisual.js";

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


const VERIFIED_PIT_CONTEXT={
  hasPitLane:true,
  pitEntryProgress:0.9499,
  pitExitProgress:0.0789,
};

function pitRow(phase,{
  elapsed=500,
  total=1000,
  queuePosition=1,
  queueTotalMs=0,
  completed=false,
  active=true,
  lossTotalMs=24000,
}={}){
  return {
    driver_id:"pit-driver",
    position:5,
    gap_to_leader_ms:12000,
    pit_state:{
      active,
      completed,
      phase,
      phase_elapsed_ms:elapsed,
      phase_total_ms:total,
      queue_total_ms:queueTotalMs,
      loss_elapsed_ms:5000,
      loss_total_ms:lossTotalMs,
      pit_traffic:{box_queue_position:queuePosition,double_stack:queuePosition>1},
    },
  };
}

test("RW6.7B 1 — PIT_ENTRY progressively leaves the racing line at PIT IN",()=>{
  const visual=visualPitLaneState(pitRow("pit_entry"),VERIFIED_PIT_CONTEXT);
  assert.equal(visual.path,"pit_transition");
  assert.equal(visual.track_anchor_progress,0.9499);
  assert.equal(visual.pit_lane_progress,0);
  assert.ok(Math.abs(visual.pit_lane_mix-0.5)<1e-9);
  assert.equal(pitPhase(pitRow("pit_entry")),"pit_entry");
  assert.equal(visualMotionMode(pitRow("pit_entry")),RACE_VISUAL_MOTION_MODES.PIT_ENTRY);
});

test("RW6.7B 2 — PIT_LANE advances on normalized validated pit-lane progress",()=>{
  const visual=visualPitLaneState(pitRow("pit_lane"),VERIFIED_PIT_CONTEXT);
  assert.equal(visual.path,"pit_lane");
  assert.ok(Math.abs(visual.pit_lane_progress-0.25)<1e-9);
  assert.equal(visual.pit_lane_mix,1);
  assert.equal(visual.stopped,false);
});

test("RW6.7B 3 — PIT_QUEUE remains stopped before the box",()=>{
  const visual=visualPitLaneState(pitRow("pit_queue",{queuePosition:2,queueTotalMs:2500}),VERIFIED_PIT_CONTEXT);
  assert.equal(visual.stopped,true);
  assert.equal(visual.path,"pit_lane");
  assert.ok(visual.pit_lane_progress<0.5);
});

test("RW6.7B 4 — PIT_BOX remains stationary at the box anchor",()=>{
  const a=visualPitLaneState(pitRow("pit_box",{elapsed:100,total:5000}),VERIFIED_PIT_CONTEXT);
  const b=visualPitLaneState(pitRow("pit_box",{elapsed:4900,total:5000}),VERIFIED_PIT_CONTEXT);
  assert.equal(a.stopped,true);
  assert.equal(a.pit_lane_progress,0.5);
  assert.equal(b.pit_lane_progress,a.pit_lane_progress);
  assert.equal(visualMotionMode(pitRow("pit_box")),RACE_VISUAL_MOTION_MODES.PIT_BOX);
});

test("RW6.7B 5 — PIT_RELEASE remains stationary until the authoritative hold ends",()=>{
  const a=visualPitLaneState(pitRow("pit_release",{elapsed:100,total:3000}),VERIFIED_PIT_CONTEXT);
  const b=visualPitLaneState(pitRow("pit_release",{elapsed:2900,total:3000}),VERIFIED_PIT_CONTEXT);
  assert.equal(a.stopped,true);
  assert.equal(a.pit_lane_progress,0.5);
  assert.equal(b.pit_lane_progress,0.5);
  assert.equal(visualMotionMode(pitRow("pit_release")),RACE_VISUAL_MOTION_MODES.PIT_RELEASE);
});

test("RW6.7B 6 — PIT_EXIT advances through the final half of the pit lane",()=>{
  const visual=visualPitLaneState(pitRow("pit_exit"),VERIFIED_PIT_CONTEXT);
  assert.equal(visual.path,"pit_lane");
  assert.ok(Math.abs(visual.pit_lane_progress-0.75)<1e-9);
  assert.equal(visual.track_anchor_progress,0.0789);
});

test("RW6.7B 7 — REJOIN progressively returns from pit lane to racing line at PIT OUT",()=>{
  const visual=visualPitLaneState(pitRow("rejoin"),VERIFIED_PIT_CONTEXT);
  assert.equal(visual.path,"pit_transition");
  assert.equal(visual.pit_lane_progress,1);
  assert.equal(visual.track_anchor_progress,0.0789);
  assert.ok(Math.abs(visual.pit_lane_mix-0.5)<1e-9);
  assert.equal(visualMotionMode(pitRow("rejoin")),RACE_VISUAL_MOTION_MODES.REJOIN);
});

test("RW6.7B 8 — completed pit lifecycle returns to normal track progression",()=>{
  const row=pitRow("completed",{completed:true,active:false});
  const visual=visualPitLaneState(row,VERIFIED_PIT_CONTEXT);
  assert.equal(visual.active,false);
  assert.equal(visual.path,"track");
  assert.equal(visual.pit_lane_mix,0);
  assert.equal(visual.pit_lane_progress,null);
  assert.equal(visualMotionMode(row),RACE_VISUAL_MOTION_MODES.RACING);
});

test("RW6.7B 9 — visual pit playback preserves the engine-authoritative total pit loss",()=>{
  const engineState=createLivePitState({
    driverId:"D1",
    stop:{
      lap:5,
      pit_lane_loss_s:12,
      stationary_s:6.4,
      queue_delay_s:1.5,
      pit_lane_traffic_loss_s:0.8,
      release_delay_s:0.6,
      total_loss_s:21.3,
      tyre_from:"A",
      tyre_to:"B",
    },
  });
  assert.equal(engineState.loss_total_ms,21300);
  const before=structuredClone(engineState);
  visualPitLaneState({driver_id:"D1",pit_state:engineState},VERIFIED_PIT_CONTEXT);
  assert.deepEqual(engineState,before);
  assert.equal(engineState.loss_total_ms,21300);
});

test("RW6.7B 10 — visual geometry availability never changes pit timing data",()=>{
  const row=pitRow("pit_lane",{lossTotalMs:28750});
  const before=structuredClone(row.pit_state);
  visualPitLaneState(row,{...VERIFIED_PIT_CONTEXT,hasPitLane:true});
  visualPitLaneState(row,{...VERIFIED_PIT_CONTEXT,hasPitLane:false});
  assert.deepEqual(row.pit_state,before);
  assert.equal(row.pit_state.loss_total_ms,28750);
});

test("RW6.7B 11 — Save/Load mid-pit restores the same deterministic visual position",()=>{
  const original=pitRow("pit_lane",{elapsed:620,total:1600,queuePosition:2,queueTotalMs:2400});
  const restored=JSON.parse(JSON.stringify(original));
  assert.deepEqual(
    visualPitLaneState(restored,VERIFIED_PIT_CONTEXT),
    visualPitLaneState(original,VERIFIED_PIT_CONTEXT)
  );
});

test("RW6.7B 12 — double stack keeps queued teammate visually separate from car in the box",()=>{
  const inBox=visualPitLaneState(pitRow("pit_box",{queuePosition:1}),VERIFIED_PIT_CONTEXT);
  const queued=visualPitLaneState(pitRow("pit_queue",{queuePosition:2,queueTotalMs:3000}),VERIFIED_PIT_CONTEXT);
  assert.equal(inBox.pit_lane_progress,0.5);
  assert.ok(queued.pit_lane_progress<inBox.pit_lane_progress);
  assert.notEqual(queued.pit_lane_progress,inBox.pit_lane_progress);
});

test("RW6.7B 13 — missing validated pit-lane geometry falls back safely to the main track",()=>{
  const visual=visualPitLaneState(pitRow("pit_lane"),{
    hasPitLane:false,
    pitEntryProgress:0.9499,
    pitExitProgress:0.0789,
  });
  assert.equal(visual.path,"track");
  assert.equal(visual.pit_lane_progress,null);
  assert.equal(visual.pit_lane_mix,0);
  assert.equal(visual.fallback,true);
});

test("RW6.7B 14 — verified PIT IN and PIT OUT anchors are respected",()=>{
  const entry=visualPitLaneState(pitRow("pit_entry",{elapsed:250,total:1000}),VERIFIED_PIT_CONTEXT);
  const rejoin=visualPitLaneState(pitRow("rejoin",{elapsed:250,total:1000}),VERIFIED_PIT_CONTEXT);
  assert.equal(entry.track_anchor_progress,0.9499);
  assert.equal(rejoin.track_anchor_progress,0.0789);
});

test("RW6.7B live pit clock updates visual placement without restarting the sector timeline",()=>{
  const early=pitRow("pit_lane",{elapsed:200,total:2000});
  const late=pitRow("pit_lane",{elapsed:1400,total:2000});
  const phaseChange=pitRow("pit_exit",{elapsed:0,total:2000});
  const keyEarly=raceVisualSnapshotKey([early],{currentLap:5,currentSector:3});
  const keyLate=raceVisualSnapshotKey([late],{currentLap:5,currentSector:3});
  const keyExit=raceVisualSnapshotKey([phaseChange],{currentLap:5,currentSector:3});
  assert.equal(keyEarly,keyLate);
  assert.notEqual(keyEarly,keyExit);

  const frame=[{driver_id:"pit-driver",visual_track_progress:0.9}];
  const earlyApplied=applyVisualPitLaneState(frame,[early],VERIFIED_PIT_CONTEXT)[0];
  const lateApplied=applyVisualPitLaneState(frame,[late],VERIFIED_PIT_CONTEXT)[0];
  assert.ok(lateApplied.visual_pit_lane_progress>earlyApplied.visual_pit_lane_progress);
});


test("Cars Visuals 4.0A selects the 1980 ground-effect family for the target era",()=>{
  assert.equal(raceCarEraForYear(1976),"generic");
  assert.equal(raceCarEraForYear(1977),"ground_effect_1980");
  assert.equal(raceCarEraForYear(1980),"ground_effect_1980");
  assert.equal(raceCarEraForYear(1982),"ground_effect_1980");
  assert.equal(raceCarEraForYear(1983),"generic");
});

test("Cars Visuals 4.0A maps authoritative race damage without changing race physics",()=>{
  const damage={
    components:{
      front_wing:{damage_pct:72.4},
      floor:{damage_pct:38},
      suspension:{damage_pct:12.5},
    },
    overall_damage_pct:58.2,
    severity:"moderate",
    pace_loss_s_per_lap:0.842,
    can_continue:true,
  };
  const values=normaliseRaceCarDamage(damage);
  assert.equal(values.front_wing,72.4);
  assert.equal(values.floor,38);
  assert.equal(values.rear_wing,0);

  const summary=raceCarDamageSummary(damage);
  assert.equal(summary.overall_damage_pct,58.2);
  assert.equal(summary.severity,"moderate");
  assert.equal(summary.pace_loss_s_per_lap,0.842);
  assert.deepEqual(
    summary.damaged_components.map((row)=>row.component),
    ["front_wing","floor","suspension"]
  );
});
