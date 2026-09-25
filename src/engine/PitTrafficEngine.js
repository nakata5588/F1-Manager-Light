// src/engine/PitTrafficEngine.js
// RW5.3C — pit traffic, double stacking and pit-box queuing.
//
// RaceStrategyEngine owns when a stop happens and its base service cost.
// This module resolves conflicts between already-planned stops without using
// circuit SVG geometry. It adds only operational pit-lane/box delays.

const num=(value,fallback=0)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const clamp=(value,min=0,max=Infinity)=>Math.max(min,Math.min(max,num(value,min)));
const driverId=(row)=>String(row?.driver_id??row?.driver?.driver_id??row?.driver?.id??row?.id??"");
const teamId=(row)=>String(row?.team_id??row?.driver?.team_id??row?.driver?.team??"");

function crewPrepSeconds(crew={}){
  const consistency=clamp(crew?.consistency,0,100);
  const fatigue=clamp(crew?.fatigue,0,100);
  return Number(clamp(2.45-consistency*0.015+fatigue*0.012,0.65,2.8).toFixed(2));
}

function baseEntrySeconds(row,stopIndex){
  const stop=row?.pit_stops?.[stopIndex];
  const lap=Math.max(1,Math.round(num(stop?.lap,1)));
  const lapSeconds=(row?.lap_times_ms||[])
    .slice(0,Math.max(0,lap-1))
    .reduce((sum,value)=>sum+Math.max(0,num(value,0))/1000,0);
  const previousPitSeconds=(row?.pit_stops||[])
    .slice(0,Math.max(0,stopIndex))
    .reduce((sum,item)=>sum+Math.max(0,num(item?.base_total_loss_s,item?.total_loss_s)),0);
  return lapSeconds+previousPitSeconds;
}

function releaseHoldEnabled(year){
  // This is an era-policy approximation, not a historical replay of stewarding.
  // Older eras keep the conflict visible but do not apply a modern-style hold.
  return Number(year)>=1994;
}

function laneTrafficLoss(conflictCount,{year=1980}={}){
  if(conflictCount<=0)return 0;
  const perCar=Number(year)>=1994?0.22:0.16;
  return Number(Math.min(1.25,conflictCount*perCar).toFixed(2));
}

export function applyPitTrafficModel(raceRows=[],{
  year=1980,
  pitCrews={},
}={}){
  const rows=(raceRows||[]).map((row)=>({
    ...row,
    pit_stops:(row?.pit_stops||[]).map((stop)=>({...stop,service:stop?.service?structuredClone(stop.service):stop?.service})),
    strategy_summary:row?.strategy_summary?{...row.strategy_summary}:row?.strategy_summary,
  }));

  const events=[];
  rows.forEach((row,rowIndex)=>{
    (row?.pit_stops||[]).forEach((stop,stopIndex)=>{
      const did=driverId(row);
      const tid=teamId(row);
      if(!did||!tid)return;
      events.push({
        row,
        rowIndex,
        stop,
        stopIndex,
        driver_id:did,
        team_id:tid,
        lap:Math.max(1,Math.round(num(stop?.lap,1))),
        entry_s:baseEntrySeconds(row,stopIndex),
        stationary_s:Math.max(0,num(stop?.stationary_s,0)),
      });
    });
  });

  if(!events.length)return rows;

  events.sort((a,b)=>a.entry_s-b.entry_s||a.rowIndex-b.rowIndex||a.driver_id.localeCompare(b.driver_id));

  const teamState=new Map();
  for(const event of events){
    const crew=pitCrews?.[event.team_id]||{};
    const prepTarget=crewPrepSeconds(crew);
    const previous=teamState.get(event.team_id)||null;
    const occupiedUntil=Math.max(0,num(previous?.service_end_s,0));
    const prepReady=Math.max(occupiedUntil,num(previous?.crew_ready_s,0));
    const occupiedDelay=Math.max(0,occupiedUntil-event.entry_s);
    const prepDelay=Math.max(0,prepReady-Math.max(event.entry_s,occupiedUntil));
    const queueDelay=occupiedDelay+prepDelay;
    const serviceStart=event.entry_s+queueDelay;
    const serviceEnd=serviceStart+event.stationary_s;
    const sameLap=Boolean(previous&&Number(previous.lap)===Number(event.lap));
    const doubleStack=Boolean(sameLap&&queueDelay>0.001);

    Object.assign(event,{
      box_occupied_delay_s:Number(occupiedDelay.toFixed(2)),
      crew_prep_delay_s:Number(prepDelay.toFixed(2)),
      queue_delay_s:Number(queueDelay.toFixed(2)),
      service_start_s:serviceStart,
      service_end_s:serviceEnd,
      double_stack:doubleStack,
      box_queue_position:doubleStack?2:1,
    });

    teamState.set(event.team_id,{
      lap:event.lap,
      service_end_s:serviceEnd,
      crew_ready_s:serviceEnd+prepTarget,
      driver_id:event.driver_id,
    });
  }

  for(const event of events){
    const entryConflicts=events.filter((other)=>
      other!==event&&
      other.team_id!==event.team_id&&
      Math.abs(other.entry_s-event.entry_s)<=3.5
    );
    const trafficLoss=laneTrafficLoss(entryConflicts.length,{year});

    const releaseConflicts=events.filter((other)=>
      other!==event&&
      other.team_id!==event.team_id&&
      Math.abs(other.entry_s-event.service_end_s)<=2.4
    );
    const releaseDelay=releaseHoldEnabled(year)
      ?Math.min(1.8,releaseConflicts.length*0.55)
      :0;

    const baseTotal=Math.max(
      0,
      num(
        event.stop?.base_total_loss_s,
        event.stop?.total_loss_s
      )
    );
    const queueDelay=Math.max(0,num(event.queue_delay_s,0));
    const extra=queueDelay+trafficLoss+releaseDelay;

    event.stop.base_total_loss_s=Number(baseTotal.toFixed(2));
    event.stop.box_occupied_delay_s=Number(num(event.box_occupied_delay_s,0).toFixed(2));
    event.stop.crew_prep_delay_s=Number(num(event.crew_prep_delay_s,0).toFixed(2));
    event.stop.queue_delay_s=Number(queueDelay.toFixed(2));
    event.stop.pit_lane_traffic_loss_s=Number(trafficLoss.toFixed(2));
    event.stop.release_delay_s=Number(releaseDelay.toFixed(2));
    event.stop.pit_traffic_loss_s=Number(extra.toFixed(2));
    event.stop.total_loss_s=Number((baseTotal+extra).toFixed(2));
    event.stop.double_stack=Boolean(event.double_stack);
    event.stop.box_queue_position=Number(event.box_queue_position||1);
    event.stop.pit_lane_conflict_count=entryConflicts.length;
    event.stop.release_conflict_count=releaseConflicts.length;
    event.stop.release_hold=releaseDelay>0;
    event.stop.pit_traffic_model="rw5.3c";
    event.stop.service={
      ...(event.stop?.service||{}),
      pit_traffic:{
        model:"rw5.3c",
        double_stack:Boolean(event.double_stack),
        box_queue_position:Number(event.box_queue_position||1),
        box_occupied_delay_s:event.stop.box_occupied_delay_s,
        crew_prep_delay_s:event.stop.crew_prep_delay_s,
        queue_delay_s:event.stop.queue_delay_s,
        pit_lane_traffic_loss_s:event.stop.pit_lane_traffic_loss_s,
        release_delay_s:event.stop.release_delay_s,
        pit_lane_conflict_count:entryConflicts.length,
        release_conflict_count:releaseConflicts.length,
        release_hold:event.stop.release_hold,
      },
    };
  }

  for(const row of rows){
    const trafficLoss=(row?.pit_stops||[])
      .reduce((sum,stop)=>sum+Math.max(0,num(stop?.pit_traffic_loss_s,0)),0);
    if(trafficLoss>0){
      row.total_time_ms=Math.max(0,num(row?.total_time_ms,0)+Math.round(trafficLoss*1000));
    }
    if(row?.strategy_summary){
      row.strategy_summary={
        ...row.strategy_summary,
        pit_traffic_loss_s:Number(trafficLoss.toFixed(2)),
        double_stack_count:(row?.pit_stops||[]).filter((stop)=>stop?.double_stack).length,
        queued_pit_stop_count:(row?.pit_stops||[]).filter((stop)=>num(stop?.queue_delay_s,0)>0).length,
      };
    }
  }

  return rows;
}
