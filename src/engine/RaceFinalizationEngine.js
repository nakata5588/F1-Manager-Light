// src/engine/RaceFinalizationEngine.js
import { incidentDamageStateThrough } from "./CarDamageEngine.js";
import { normalPitRepairRecord } from "./PitServiceEngine.js";

const idOf=(row)=>String(row?.driver_id??row?.driver?.driver_id??row?.id??"");

function finiteNumber(value){
  if(value===null||value===undefined||value==="")return null;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:null;
}

function pointOrdinal(lap,sector=3){
  const l=Math.max(1,Number(lap)||1);
  const s=Math.max(1,Math.min(3,Number(sector)||3));
  return (l-1)*3+s;
}

function pitRepairRecordsFromRow(row){
  const driverId=idOf(row);
  if(!driverId)return [];
  return (row?.pit_stops||[])
    .map((stop,index)=>{
      const record=normalPitRepairRecord({
        driverId,
        teamId:row?.team_id,
        service:stop?.service,
        lap:stop?.lap,
        sector:3,
        stopKey:stop?.stop_key||`official:${driverId}:${Number(stop?.lap)||0}:${index}`,
        source:"official_pit_repair",
      });
      if(!record)return null;
      const serviceOrdinal=finiteNumber(stop?.service?.repair_ordinal);
      return serviceOrdinal===null?record:{...record,repair_ordinal:serviceOrdinal};
    })
    .filter(Boolean);
}

function repairSignature(repair){
  const driverId=String(repair?.driver_id??"");
  const ordinal=finiteNumber(repair?.repair_ordinal??repair?.ordinal)??pointOrdinal(repair?.lap,repair?.sector);
  const components=(repair?.repaired_components||[]).map(String).sort().join(",");
  const source=String(
    repair?.work_source==="pit_stop"||String(repair?.source||"").includes("pit")
      ?"pit_stop"
      :repair?.source||repair?.work_source||"repair"
  );
  const redFlag=repair?.red_flag_sequence==null?"":String(repair.red_flag_sequence);
  return `${driverId}|${ordinal}|${source}|${redFlag}|${components}`;
}

function authoritativeRepairsForRow(row,raceControlPlan){
  const driverId=idOf(row);
  const repairs=[
    ...(raceControlPlan?.damage_repairs||[]).filter((repair)=>String(repair?.driver_id??"")===driverId),
    ...pitRepairRecordsFromRow(row),
  ];
  const bySignature=new Map();
  for(const repair of repairs){
    const key=repairSignature(repair);
    if(!bySignature.has(key))bySignature.set(key,repair);
  }
  return [...bySignature.values()];
}

function finalDamageState(row,raceControlPlan){
  if(!raceControlPlan||!Array.isArray(raceControlPlan?.incidents))return row?.damage_state||null;
  const driverId=idOf(row);
  if(!driverId)return row?.damage_state||null;
  const retired=Boolean(row?.retired)||String(row?.status||"").toUpperCase()==="DNF";
  const throughOrdinal=retired&&finiteNumber(row?.incident_lap)!==null
    ?pointOrdinal(row.incident_lap,row?.incident_sector??1)
    :Math.max(1,Number(row?.race_laps)||1)*3;
  return incidentDamageStateThrough(
    raceControlPlan.incidents,
    driverId,
    throughOrdinal,
    authoritativeRepairsForRow(row,raceControlPlan)
  );
}

export function materializeOfficialRaceRows(rows=[],{raceControlPlan=null}={}){
  const canonical=(rows||[]).map((row,index)=>{
    const retired=Boolean(row?.retired)||String(row?.status||"").toUpperCase()==="DNF";
    const damage=finalDamageState(row,raceControlPlan);
    const damagedComponents=Array.isArray(damage?.damaged_components)?damage.damaged_components:[];
    return {
      ...row,
      pos:Number(row?.pos??row?.position??index+1),
      retired,
      status:retired?"DNF":(row?.status||"Finished"),
      damage_state:damagedComponents.length?structuredClone(damage):null,
      damage_severity:damagedComponents.length?damage.severity:"none",
      damaged_components:[...damagedComponents],
      damage_pace_loss_s_per_lap:damagedComponents.length?Number(damage?.pace_loss_s_per_lap||0):0,
    };
  }).sort((a,b)=>Number(a?.pos??999)-Number(b?.pos??999));

  const finishers=canonical.filter((row)=>!row.retired);
  const winnerTime=finishers.length?finiteNumber(finishers[0]?.total_time_ms):null;
  let previousTime=winnerTime;
  const timingByDriver=new Map();

  finishers.forEach((row,index)=>{
    const total=finiteNumber(row?.total_time_ms);
    const gapToWinner=total!==null&&winnerTime!==null
      ?Math.max(0,total-winnerTime)
      :finiteNumber(row?.gap_to_winner_ms);
    const gapToPrevious=index===0
      ?0
      :total!==null&&previousTime!==null
        ?Math.max(0,total-previousTime)
        :finiteNumber(row?.gap_to_previous_ms);
    timingByDriver.set(idOf(row),{
      total_time_ms:total,
      gap_to_winner_ms:gapToWinner,
      gap_to_previous_ms:gapToPrevious,
    });
    if(total!==null)previousTime=total;
  });

  return canonical.map((row)=>{
    if(row.retired){
      return {
        ...row,
        total_time_ms:null,
        gap_to_winner_ms:null,
        gap_to_previous_ms:null,
      };
    }
    const timing=timingByDriver.get(idOf(row));
    return timing?{...row,...timing}:row;
  });
}
