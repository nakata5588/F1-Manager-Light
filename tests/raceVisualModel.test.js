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
import { raceCarOverlapMetric, resolveRaceCarPhysicalLayout } from "../src/domain/raceCarOccupancy.js";
import { historicalRaceCarLiveriesForYear, historicalRaceCarLivery } from "../src/domain/raceCarLiveries.js";
import {
  RACE_CAR_ROUNDS_1980,
  historicalRaceCarModel,
  historicalRaceCarModelOverridesForYear,
  historicalRaceCarModelTimelineForYear,
} from "../src/domain/raceCarModels.js";
import {
  historicalRaceCarGeometry,
  historicalRaceCarGeometryFamiliesForYear,
  historicalRaceCarGeometryModelsForYear,
} from "../src/domain/raceCarGeometry.js";
import {
  RACE_VIEW_ASPHALT_WIDTH_SVG,
  RACE_VIEW_NOMINAL_TRACK_WIDTH_M,
  raceCarNativeFootprint,
  raceCarNominalLengthM,
  raceCarNominalWidthM,
  raceCarPresentationScale,
  raceCarPresentationTransform,
  raceViewLateralUnitsPerMeter,
} from "../src/domain/raceCarPresentation.js";

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


test("Cars 4.0B separates cars that would occupy the same Race View space",()=>{
  const source=[
    {id:"leader",raceOrder:1,point:{x:100,y:100,heading:0}},
    {id:"trailer",raceOrder:2,point:{x:100,y:100,heading:0}},
  ];
  const resolved=resolveRaceCarPhysicalLayout(source,{markerScale:1,lod:"overview"});
  assert.equal(resolved.length,2);
  assert.ok(raceCarOverlapMetric(resolved[0],resolved[1],{markerScale:1,lod:"overview"})>=0.99);
  assert.notDeepEqual(resolved[0].point,resolved[1].point);
});

test("Cars 4.0B keeps the selected car anchored while resolving overlap around it",()=>{
  const source=[
    {id:"selected",raceOrder:2,selected:true,point:{x:40,y:50,heading:15}},
    {id:"other",raceOrder:1,point:{x:40,y:50,heading:15}},
  ];
  const resolved=resolveRaceCarPhysicalLayout(source,{markerScale:.5,lod:"close"});
  const selected=resolved.find((row)=>row.id==="selected");
  const other=resolved.find((row)=>row.id==="other");
  assert.equal(selected.point.x,40);
  assert.equal(selected.point.y,50);
  assert.ok(raceCarOverlapMetric(selected,other,{markerScale:.5,lod:"close"})>=0.99);
});

test("Cars 4.0B does not move cars that are already physically separated",()=>{
  const source=[
    {id:"a",raceOrder:1,point:{x:0,y:0,heading:0}},
    {id:"b",raceOrder:2,point:{x:80,y:0,heading:0}},
  ];
  const resolved=resolveRaceCarPhysicalLayout(source,{markerScale:1,lod:"overview"});
  assert.deepEqual(resolved.map((row)=>row.point),source.map((row)=>row.point));
});


test("Cars 4.0C provides distinct historical livery profiles for all 15 active 1980 teams",()=>{
  const liveries=historicalRaceCarLiveriesForYear(1980);
  assert.equal(liveries.length,15);
  assert.equal(new Set(liveries.map((row)=>row.team_id)).size,15);
  for(const row of liveries){
    assert.match(row.primary,/^#[0-9A-F]{6}$/i);
    assert.match(row.secondary,/^#[0-9A-F]{6}$/i);
    assert.match(row.accent,/^#[0-9A-F]{6}$/i);
    assert.ok(row.pattern);
    assert.ok(row.sponsor);
    assert.ok(row.model);
  }
});

test("Cars 4.0C uses historically recognisable 1980 visual identities without changing other years",()=>{
  const brabham=historicalRaceCarLivery({year:1980,teamId:"t_0003"});
  const mclaren=historicalRaceCarLivery({year:1980,teamId:"t_0009"});
  const lotus=historicalRaceCarLivery({year:1980,teamId:"t_0005"});
  assert.equal(brabham.sponsor,"PARMALAT");
  assert.equal(brabham.model,"BT49");
  assert.equal(mclaren.pattern,"marlboro_chevron");
  assert.equal(lotus.sponsor,"ESSEX");
  assert.equal(historicalRaceCarLivery({year:1981,teamId:"t_0003"}),null);
});


test("Cars 4.1A maps the complete 14-round 1980 championship calendar",()=>{
  assert.equal(RACE_CAR_ROUNDS_1980.length,14);
  assert.deepEqual(
    RACE_CAR_ROUNDS_1980.map((row)=>row.round),
    Array.from({length:14},(_,index)=>index+1)
  );
  assert.equal(RACE_CAR_ROUNDS_1980[0].gp,"Argentina");
  assert.equal(RACE_CAR_ROUNDS_1980.at(-1).gp,"USA");
});

test("Cars 4.1A resolves clean team-wide chassis changes by round",()=>{
  assert.equal(historicalRaceCarModel({year:1980,teamId:"t_0006",round:2}).model,"009");
  assert.equal(historicalRaceCarModel({year:1980,teamId:"t_0006",round:3}).model,"010");
  assert.equal(historicalRaceCarModel({year:1980,teamId:"t_0008",round:7}).model,"F7");
  assert.equal(historicalRaceCarModel({year:1980,teamId:"t_0008",round:9}).model,"F8");
  assert.equal(historicalRaceCarModel({year:1980,teamId:"t_0012",round:2}).model,"D3");
  assert.equal(historicalRaceCarModel({year:1980,teamId:"t_0012",round:4}).model,"D4");
});

test("Cars 4.1A preserves mixed-chassis weekends with entry overrides",()=>{
  assert.equal(historicalRaceCarModel({year:1980,teamId:"t_0001",round:1,driverName:"Alan Jones",driverNumber:27}).model,"FW07");
  assert.equal(historicalRaceCarModel({year:1980,teamId:"t_0001",round:1,driverName:"Carlos Reutemann",driverNumber:28}).model,"FW07B");
  assert.equal(historicalRaceCarModel({year:1980,teamId:"t_0005",round:10,driverName:"Nigel Mansell"}).model,"81B");
  assert.equal(historicalRaceCarModel({year:1980,teamId:"t_0005",round:10,driverName:"Mario Andretti"}).model,"81");
  assert.equal(historicalRaceCarModel({year:1980,teamId:"t_0008",round:8,driverName:"Emerson Fittipaldi"}).model,"F8");
  assert.equal(historicalRaceCarModel({year:1980,teamId:"t_0008",round:8,driverName:"Keke Rosberg"}).model,"F7");
  assert.equal(historicalRaceCarModel({year:1980,teamId:"t_0009",round:11,driverName:"Alain Prost"}).model,"M30");
  assert.equal(historicalRaceCarModel({year:1980,teamId:"t_0009",round:11,driverName:"John Watson"}).model,"M29");
  assert.equal(historicalRaceCarModel({year:1980,teamId:"t_0012",round:3,driverName:"Jan Lammers",driverNumber:9}).model,"D3");
  assert.equal(historicalRaceCarModel({year:1980,teamId:"t_0012",round:3,driverName:"Marc Surer",driverNumber:9}).model,"D4");
  assert.equal(historicalRaceCarModel({year:1980,teamId:"t_0015",round:5,driverName:"Geoff Lees"}).model,"DN12");
  assert.equal(historicalRaceCarModel({year:1980,teamId:"t_0015",round:5,driverName:"David Kennedy"}).model,"DN11");
});

test("Cars 4.1A keeps timeline data declarative and outside the renderer",()=>{
  const timeline=historicalRaceCarModelTimelineForYear(1980);
  const overrides=historicalRaceCarModelOverridesForYear(1980);
  assert.equal(new Set(timeline.map((row)=>row.team_id)).size,15);
  assert.ok(timeline.some((row)=>row.team_id==="t_0006"&&row.model==="010"&&row.from_round===3));
  assert.ok(overrides.some((row)=>row.team_id==="t_0009"&&row.model==="M30"));
  assert.equal(historicalRaceCarModel({year:1981,teamId:"t_0001",round:1}),null);
});

test("Cars 4.1A feeds the round-specific model into the existing 1980 livery profile",()=>{
  assert.equal(historicalRaceCarLivery({year:1980,teamId:"t_0006",round:2}).model,"009");
  assert.equal(historicalRaceCarLivery({year:1980,teamId:"t_0006",round:3}).model,"010");
  assert.equal(historicalRaceCarLivery({year:1980,teamId:"t_0009",round:11,driverName:"Alain Prost"}).model,"M30");
});


test("Cars 4.1B defines seven reusable 1980 geometry families",()=>{
  const families=historicalRaceCarGeometryFamiliesForYear(1980);
  assert.equal(families.length,7);
  assert.equal(new Set(families.map((row)=>row.geometry_family)).size,7);
  assert.deepEqual(
    new Set(families.map((row)=>row.geometry_family)),
    new Set([
      "classic_wedge",
      "narrow_wedge",
      "long_venturi",
      "turbo_long",
      "wide_lowbody",
      "compact_transition",
      "late_ground_effect",
    ])
  );
});

test("Cars 4.1B maps every historical 1980 model used by the game to geometry",()=>{
  const rows=historicalRaceCarGeometryModelsForYear(1980);
  assert.equal(rows.length,22);
  assert.equal(new Set(rows.map((row)=>row.model)).size,22);
  for(const row of rows){
    assert.ok(row.geometry_family);
    assert.ok(Number.isFinite(row.noseTipX));
    assert.ok(Number.isFinite(row.frontAxleX));
    assert.ok(Number.isFinite(row.rearAxleX));
    assert.ok(row.frontAxleX>row.rearAxleX);
  }
});

test("Cars 4.1B gives representative 1980 chassis recognisably different silhouettes",()=>{
  const fw=historicalRaceCarGeometry({year:1980,model:"FW07B"});
  const bt=historicalRaceCarGeometry({year:1980,model:"BT49"});
  const lotus=historicalRaceCarGeometry({year:1980,model:"81"});
  const renault=historicalRaceCarGeometry({year:1980,model:"RE20"});
  const ferrari=historicalRaceCarGeometry({year:1980,model:"312T5"});
  const tyrrell=historicalRaceCarGeometry({year:1980,model:"010"});
  const mclaren=historicalRaceCarGeometry({year:1980,model:"M30"});

  assert.equal(fw.geometry_family,"classic_wedge");
  assert.equal(bt.geometry_family,"narrow_wedge");
  assert.equal(lotus.geometry_family,"long_venturi");
  assert.equal(renault.geometry_family,"turbo_long");
  assert.equal(ferrari.geometry_family,"wide_lowbody");
  assert.equal(tyrrell.geometry_family,"compact_transition");
  assert.equal(mclaren.geometry_family,"late_ground_effect");

  assert.ok((renault.frontAxleX-renault.rearAxleX)>(fw.frontAxleX-fw.rearAxleX));
  assert.ok(ferrari.sidepodRearHalfWidth>tyrrell.sidepodRearHalfWidth);
  assert.ok(ferrari.frontWingHalfWidth>bt.frontWingHalfWidth);
  assert.notEqual(fw.sidepodRearHalfWidth,bt.sidepodRearHalfWidth);
});

test("Cars 4.1B distinguishes chassis revisions without duplicating renderers",()=>{
  const fw07=historicalRaceCarGeometry({year:1980,model:"FW07"});
  const fw07b=historicalRaceCarGeometry({year:1980,model:"FW07B"});
  const lotus81=historicalRaceCarGeometry({year:1980,model:"81"});
  const lotus81b=historicalRaceCarGeometry({year:1980,model:"81B"});
  const m29=historicalRaceCarGeometry({year:1980,model:"M29"});
  const m30=historicalRaceCarGeometry({year:1980,model:"M30"});

  assert.equal(fw07.geometry_family,fw07b.geometry_family);
  assert.notEqual(fw07.sidepodRearHalfWidth,fw07b.sidepodRearHalfWidth);
  assert.equal(lotus81.geometry_family,lotus81b.geometry_family);
  assert.notEqual(lotus81.frontWingHalfWidth,lotus81b.frontWingHalfWidth);
  assert.notEqual(m29.geometry_family,m30.geometry_family);
});

test("Cars 4.1B keeps geometry inside the current Race View visual envelope",()=>{
  for(const row of historicalRaceCarGeometryModelsForYear(1980)){
    assert.ok(row.noseTipX<=20.6);
    assert.ok(row.rearWingX>=-19.6);
    assert.ok(row.frontWingHalfWidth<=10.05);
    assert.ok(row.rearWingHalfWidth<=10.1);
    assert.ok(row.sidepodRearHalfWidth<=6.5);
    assert.ok(row.frontTrackY<=8.65);
    assert.ok(row.rearTrackY<=8.2);
  }
});

test("Cars 4.1B resolves combined season labels safely and leaves other years untouched",()=>{
  assert.equal(historicalRaceCarGeometry({year:1980,model:"FW07/FW07B"}).model,"FW07B");
  assert.equal(historicalRaceCarGeometry({year:1980,model:"81/81B"}).model,"81");
  assert.equal(historicalRaceCarGeometry({year:1980,model:"M29/M30"}).model,"M29");
  assert.equal(historicalRaceCarGeometry({year:1981,model:"FW07B"}),null);
});


test("RW31 widens the nominal race surface while preserving approved 1980 car size",()=>{
  const result=raceCarPresentationScale({
    year:1980,
    model:"FW07",
    trackWidthM:RACE_VIEW_NOMINAL_TRACK_WIDTH_M,
    asphaltWidthSvg:RACE_VIEW_ASPHALT_WIDTH_SVG,
  });

  assert.equal(raceCarNominalWidthM(1980),2.1);
  assert.ok(result.widthRatio>=0.16&&result.widthRatio<=0.18);
  assert.ok(result.targetWidthSvg>=2.8&&result.targetWidthSvg<=3.1);
  assert.ok(result.targetLengthSvg>=5&&result.targetLengthSvg<=6.5);
  assert.ok(result.scale<0.2);
});

test("RW35 car presentation preserves aspect ratio and obeys longitudinal physical scale",()=>{
  const footprint=raceCarNativeFootprint({year:1980,model:"FW07"});
  const transform=raceCarPresentationTransform({
    year:1980,
    model:"FW07",
    trackWidthM:12.5,
    asphaltWidthSvg:32,
    trackLengthM:5968,
    visualTrackLengthSvg:4513.489,
  });
  const renderedWidth=footprint.nativeWidth*transform.scaleY;
  const renderedLength=footprint.nativeLength*transform.scaleX;
  const expectedLength=(4513.489/5968)*raceCarNominalLengthM(1980);
  const maximumWidth=(32/12.5)*raceCarNominalWidthM(1980);
  assert.equal(raceCarNominalWidthM(1980),2.1);
  assert.equal(raceCarNominalLengthM(1980),4.45);
  assert.equal(transform.scaleX,transform.scaleY);
  assert.ok(Math.abs(renderedLength-expectedLength)<0.01);
  assert.ok(renderedWidth<maximumWidth);
});

test("RW31 canonical lateral battle spacing uses rendered track width rather than lap-length scale",()=>{
  const scale=raceCarPresentationScale({
    year:1980,
    model:"FW07",
    trackWidthM:RACE_VIEW_NOMINAL_TRACK_WIDTH_M,
    asphaltWidthSvg:RACE_VIEW_ASPHALT_WIDTH_SVG,
  });
  const lateralUnits=raceViewLateralUnitsPerMeter({
    trackWidthM:RACE_VIEW_NOMINAL_TRACK_WIDTH_M,
    asphaltWidthSvg:RACE_VIEW_ASPHALT_WIDTH_SVG,
  });
  const centreSeparation=2*1.85*lateralUnits;
  assert.ok(centreSeparation>scale.targetWidthSvg);
  assert.ok(centreSeparation<RACE_VIEW_ASPHALT_WIDTH_SVG*.45);
});

test("RW15B historical geometry drives model-specific native footprint without changing target physical width",()=>{
  const narrow=raceCarPresentationScale({year:1980,model:"BT49"});
  const wide=raceCarPresentationScale({year:1980,model:"312T5"});

  assert.notEqual(raceCarNativeFootprint({year:1980,model:"BT49"}).nativeWidth,raceCarNativeFootprint({year:1980,model:"312T5"}).nativeWidth);
  assert.equal(narrow.targetWidthSvg,wide.targetWidthSvg);
  assert.notEqual(narrow.scale,wide.scale);
});

test("RW15B track-width override scales the same car physically rather than by zoom LOD",()=>{
  const narrowTrack=raceCarPresentationScale({year:1980,model:"FW07",trackWidthM:8});
  const wideTrack=raceCarPresentationScale({year:1980,model:"FW07",trackWidthM:14});

  assert.ok(narrowTrack.scale>wideTrack.scale);
  assert.ok(narrowTrack.targetWidthSvg>wideTrack.targetWidthSvg);
  assert.equal(narrowTrack.carWidthM,wideTrack.carWidthM);
});

test("RW15B generic era calibration stays bounded and future-compatible",()=>{
  const old=raceCarPresentationScale({year:1955});
  const modern=raceCarPresentationScale({year:2024});
  const nextGen=raceCarPresentationScale({year:2026});

  assert.equal(old.source,"generic_sprite");
  assert.equal(modern.source,"generic_sprite");
  assert.equal(nextGen.source,"generic_sprite");
  assert.equal(raceCarNominalWidthM(2024),2.0);
  assert.equal(raceCarNominalWidthM(2026),1.9);
  for(const row of [old,modern,nextGen]){
    assert.ok(row.scale>0.08&&row.scale<0.3);
    assert.ok(row.widthRatio>0.1&&row.widthRatio<0.3);
  }
});
