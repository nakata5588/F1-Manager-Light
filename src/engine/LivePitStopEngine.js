// src/engine/LivePitStopEngine.js
// RW5.3B.2A — live pit-stop lifecycle.
//
// RaceStrategyEngine remains the authority for the final pit-stop cost.
// This module only unfolds that already-calculated loss over an explicit,
// saveable lifecycle so Live Race can show the stop happening in time.

const num=(value,fallback=0)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const clamp=(value,min=0,max=Infinity)=>Math.max(min,Math.min(max,num(value,min)));

export const LIVE_PIT_PHASES=Object.freeze([
  "pit_entry",
  "pit_lane",
  "pit_queue",
  "pit_box",
  "pit_release",
  "pit_exit",
  "rejoin",
]);

function phaseDurationsMs(stop){
  const baseLaneMs=Math.max(0,Math.round(num(stop?.pit_lane_loss_s,0)*1000));
  const trafficMs=Math.max(0,Math.round(num(stop?.pit_lane_traffic_loss_s,0)*1000));
  const queueMs=Math.max(0,Math.round(num(stop?.queue_delay_s,0)*1000));
  const stationaryMs=Math.max(0,Math.round(num(stop?.stationary_s,0)*1000));
  const releaseMs=Math.max(0,Math.round(num(stop?.release_delay_s,0)*1000));

  // These are shares of already-authoritative timing, never SVG distances.
  // RW5.3C keeps queue and release holds explicit while lane traffic is
  // experienced during the pit-lane phase.
  const entry=Math.round(baseLaneMs*0.15);
  const lane=Math.round(baseLaneMs*0.38)+trafficMs;
  const exit=Math.round(baseLaneMs*0.32);
  const rejoin=Math.max(0,baseLaneMs-entry-(lane-trafficMs)-exit);

  return [
    {phase:"pit_entry",duration_ms:entry,loss_ms:entry},
    {phase:"pit_lane",duration_ms:lane,loss_ms:lane},
    {phase:"pit_queue",duration_ms:queueMs,loss_ms:queueMs},
    {phase:"pit_box",duration_ms:stationaryMs,loss_ms:stationaryMs},
    {phase:"pit_release",duration_ms:releaseMs,loss_ms:releaseMs},
    {phase:"pit_exit",duration_ms:exit,loss_ms:exit},
    {phase:"rejoin",duration_ms:rejoin,loss_ms:rejoin},
  ];
}

export function livePitStopKey(driverId,stop,sequence=1){
  return [
    String(driverId||"driver"),
    Math.max(1,Number(stop?.lap)||1),
    Math.max(1,Number(sequence)||1),
    String(stop?.tyre_to||"tyre"),
  ].join(":");
}

export function createLivePitState({
  driverId,
  stop,
  sequence=1,
  requestedLap=null,
  entryLap=null,
  entrySector=3,
  positionBefore=null,
}={}){
  if(!driverId||!stop)return null;
  const phases=phaseDurationsMs(stop);
  const totalFromPhases=phases.reduce((sum,row)=>sum+Number(row.loss_ms||0),0);
  const authoritativeTotal=Math.max(0,Math.round(num(
    stop?.total_loss_s,
    num(stop?.pit_lane_loss_s,0)+
      num(stop?.stationary_s,0)+
      num(stop?.queue_delay_s,0)+
      num(stop?.pit_lane_traffic_loss_s,0)+
      num(stop?.release_delay_s,0)
  )*1000));
  const correction=authoritativeTotal-totalFromPhases;
  if(phases.length&&correction!==0){
    phases[phases.length-1]={
      ...phases[phases.length-1],
      duration_ms:Math.max(0,Number(phases.at(-1).duration_ms||0)+correction),
      loss_ms:Math.max(0,Number(phases.at(-1).loss_ms||0)+correction),
    };
  }

  const firstIndex=Math.max(0,phases.findIndex((row)=>Number(row.duration_ms)>0));
  const first=phases[firstIndex]||{phase:"pit_entry",duration_ms:0,loss_ms:0};
  return {
    active:true,
    completed:false,
    stop_key:livePitStopKey(driverId,stop,sequence),
    driver_id:String(driverId),
    stop_sequence:Math.max(1,Number(sequence)||1),
    requested_lap:requestedLap==null?null:Number(requestedLap),
    stop_lap:Math.max(1,Number(stop?.lap)||1),
    entry_lap:entryLap==null?Math.max(1,(Number(stop?.lap)||1)-1):Math.max(1,Number(entryLap)||1),
    entry_sector:Math.max(1,Math.min(3,Number(entrySector)||3)),
    phase:first.phase,
    phase_index:firstIndex,
    phase_elapsed_ms:0,
    phase_total_ms:Number(first.duration_ms)||0,
    loss_elapsed_ms:0,
    loss_total_ms:authoritativeTotal,
    lane_elapsed_ms:0,
    lane_total_ms:Math.max(0,Math.round((num(stop?.pit_lane_loss_s,0)+num(stop?.pit_lane_traffic_loss_s,0))*1000)),
    queue_elapsed_ms:0,
    queue_total_ms:Math.max(0,Math.round(num(stop?.queue_delay_s,0)*1000)),
    box_elapsed_ms:0,
    stationary_total_ms:Math.max(0,Math.round(num(stop?.stationary_s,0)*1000)),
    release_elapsed_ms:0,
    release_total_ms:Math.max(0,Math.round(num(stop?.release_delay_s,0)*1000)),
    exit_elapsed_ms:0,
    exit_total_ms:phases
      .filter((row)=>["pit_exit","rejoin"].includes(row.phase))
      .reduce((sum,row)=>sum+Number(row.duration_ms||0),0),
    phases,
    service:{
      ...(stop?.service||{}),
      tyre_change:typeof stop?.tyre_changed==="boolean"
        ?Boolean(stop.tyre_changed)
        :String(stop?.tyre_from||"")!==String(stop?.tyre_to||""),
      tyre_from:stop?.tyre_from??null,
      tyre_to:stop?.tyre_to??null,
      refuel:Boolean(stop?.refuelled),
      damage_repair:Boolean(stop?.service?.repair?.repaired_components?.length),
      repair:stop?.service?.repair?structuredClone(stop.service.repair):null,
      tasks:Array.isArray(stop?.service?.tasks)?stop.service.tasks.map((task)=>({...task})):[],
      completed:false,
    },
    crew_error_delay_ms:Math.max(0,Math.round(num(stop?.crew_error_delay_s,0)*1000)),
    crew_error:Boolean(stop?.error),
    pit_traffic:{
      model:stop?.pit_traffic_model||stop?.service?.pit_traffic?.model||null,
      double_stack:Boolean(stop?.double_stack||stop?.service?.pit_traffic?.double_stack),
      box_queue_position:Number(stop?.box_queue_position||stop?.service?.pit_traffic?.box_queue_position||1),
      box_occupied_delay_ms:Math.max(0,Math.round(num(stop?.box_occupied_delay_s,0)*1000)),
      crew_prep_delay_ms:Math.max(0,Math.round(num(stop?.crew_prep_delay_s,0)*1000)),
      pit_lane_traffic_loss_ms:Math.max(0,Math.round(num(stop?.pit_lane_traffic_loss_s,0)*1000)),
      release_delay_ms:Math.max(0,Math.round(num(stop?.release_delay_s,0)*1000)),
      pit_lane_conflict_count:Math.max(0,Math.round(num(stop?.pit_lane_conflict_count,0))),
      release_conflict_count:Math.max(0,Math.round(num(stop?.release_conflict_count,0))),
      release_hold:Boolean(stop?.release_hold),
    },
    race_control:String(stop?.race_control||"GREEN"),
    reason:stop?.reason??null,
    position_before:Number.isFinite(Number(positionBefore))?Number(positionBefore):null,
    position_after:null,
  };
}

function withDerivedPhaseClocks(state){
  const phase=String(state?.phase||"");
  const elapsed=Math.max(0,Number(state?.phase_elapsed_ms)||0);
  const lanePhases=new Set(["pit_entry","pit_lane"]);
  const exitPhases=new Set(["pit_exit","rejoin"]);
  const phases=Array.isArray(state?.phases)?state.phases:[];
  const beforeIndex=Math.max(0,Number(state?.phase_index)||0);
  const completedBefore=phases.slice(0,beforeIndex);

  const laneElapsed=completedBefore
    .filter((row)=>lanePhases.has(row.phase))
    .reduce((sum,row)=>sum+Number(row.duration_ms||0),0)
    +(lanePhases.has(phase)?elapsed:0);
  const queueElapsed=completedBefore
    .filter((row)=>row.phase==="pit_queue")
    .reduce((sum,row)=>sum+Number(row.duration_ms||0),0)
    +(phase==="pit_queue"?elapsed:0);
  const boxElapsed=completedBefore
    .filter((row)=>row.phase==="pit_box")
    .reduce((sum,row)=>sum+Number(row.duration_ms||0),0)
    +(phase==="pit_box"?elapsed:0);
  const releaseElapsed=completedBefore
    .filter((row)=>row.phase==="pit_release")
    .reduce((sum,row)=>sum+Number(row.duration_ms||0),0)
    +(phase==="pit_release"?elapsed:0);
  const exitElapsed=completedBefore
    .filter((row)=>exitPhases.has(row.phase))
    .reduce((sum,row)=>sum+Number(row.duration_ms||0),0)
    +(exitPhases.has(phase)?elapsed:0);

  const boxIndex=phases.findIndex((row)=>row.phase==="pit_box");
  const serviceCompleted=boxIndex<0||Number(state?.phase_index)>boxIndex||Boolean(state?.completed);

  return {
    ...state,
    lane_elapsed_ms:Math.min(Number(state?.lane_total_ms)||0,laneElapsed),
    queue_elapsed_ms:Math.min(Number(state?.queue_total_ms)||0,queueElapsed),
    box_elapsed_ms:Math.min(Number(state?.stationary_total_ms)||0,boxElapsed),
    release_elapsed_ms:Math.min(Number(state?.release_total_ms)||0,releaseElapsed),
    exit_elapsed_ms:Math.min(Number(state?.exit_total_ms)||0,exitElapsed),
    service:{...(state?.service||{}),completed:serviceCompleted},
  };
}

export function advanceLivePitState(input,deltaMs=0){
  if(!input||input.completed||!input.active)return input;
  let state={
    ...input,
    phases:(input.phases||[]).map((row)=>({...row})),
    service:{...(input.service||{})},
  };
  let remaining=Math.max(0,Math.round(Number(deltaMs)||0));
  const phases=state.phases;
  let index=Math.max(0,Math.min(phases.length-1,Number(state.phase_index)||0));
  let phaseElapsed=Math.max(0,Number(state.phase_elapsed_ms)||0);
  let lossElapsed=Math.max(0,Number(state.loss_elapsed_ms)||0);

  while(remaining>0&&index<phases.length){
    const phase=phases[index];
    const duration=Math.max(0,Number(phase.duration_ms)||0);
    const room=Math.max(0,duration-phaseElapsed);
    if(room<=0){
      index+=1;
      phaseElapsed=0;
      continue;
    }
    const consumed=Math.min(room,remaining);
    phaseElapsed+=consumed;
    lossElapsed+=consumed;
    remaining-=consumed;
    if(phaseElapsed>=duration){
      index+=1;
      phaseElapsed=0;
    }
  }

  const completed=index>=phases.length||lossElapsed>=Number(state.loss_total_ms||0);
  if(completed){
    state={
      ...state,
      active:false,
      completed:true,
      phase:"completed",
      phase_index:phases.length,
      phase_elapsed_ms:0,
      phase_total_ms:0,
      loss_elapsed_ms:Number(state.loss_total_ms)||lossElapsed,
    };
  }else{
    const phase=phases[index];
    state={
      ...state,
      phase:phase.phase,
      phase_index:index,
      phase_elapsed_ms:phaseElapsed,
      phase_total_ms:Number(phase.duration_ms)||0,
      loss_elapsed_ms:Math.min(Number(state.loss_total_ms)||Infinity,lossElapsed),
    };
  }
  return withDerivedPhaseClocks(state);
}

export function settleLivePitState(state){
  if(!state||state.completed)return state;
  return advanceLivePitState(state,Math.max(0,Number(state.loss_total_ms||0)-Number(state.loss_elapsed_ms||0)));
}

export function livePitProgress(state){
  const total=Math.max(0,Number(state?.loss_total_ms)||0);
  const elapsed=clamp(state?.loss_elapsed_ms,0,total||0);
  return total>0?elapsed/total:(state?.completed?1:0);
}

export function completedLivePitRecord(state,{positionAfter=null}={}){
  if(!state)return null;
  return {
    ...state,
    active:false,
    completed:true,
    phase:"completed",
    position_after:Number.isFinite(Number(positionAfter))?Number(positionAfter):state?.position_after??null,
  };
}
