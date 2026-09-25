// src/engine/RedFlagWorkEngine.js
// RW5.2D4.5 — work performed while a live race is suspended.
//
// This module changes Save World state only. RaceStrategyEngine consumes the
// resulting red_flag_tyre command so the tyre change also affects subsequent
// simulation without being treated as a pit stop.

import { redFlagWorkPolicyForYear } from "./RedFlagLifecycleEngine.js";

const idOf=(row)=>String(row?.tyre_id??row?.id??"");
const driverIdOf=(row)=>String(row?.driver_id??row?.id??"");

function playerTeamId(gs){
  return String(gs?.team?.team_id??gs?.team?.id??"");
}

function allTyres(gs){
  const candidates=[
    ...(Array.isArray(gs?.tyres)?gs.tyres:[]),
    ...(Array.isArray(gs?.dbTyres)?gs.dbTyres:[]),
  ];
  const seen=new Set();
  return candidates.filter((row)=>{
    const id=idOf(row);
    if(!id||seen.has(id))return false;
    seen.add(id);
    return true;
  });
}

function tyreAvailableForTeam(gs,teamId,tyreId){
  const year=Number(gs?.activeYear)||1980;
  const tid=String(teamId||"");
  const id=String(tyreId||"");
  const options=allTyres(gs).filter((row)=>{
    const from=Number(row?.year_from??row?.year??year);
    const to=Number(row?.year_to??row?.year??year);
    if(Number.isFinite(from)&&year<from)return false;
    if(Number.isFinite(to)&&year>to)return false;
    const rowTeam=String(row?.team_id??"");
    if(rowTeam&&rowTeam!==tid)return false;
    return true;
  });
  return options.find((row)=>idOf(row)===id)||null;
}

function tyreLabel(tyre){
  return String(tyre?.compound_name||tyre?.name||tyre?.compound||idOf(tyre)||"tyre");
}

function lifecycleFor(gs){
  return gs?.raceWeekendState?.live_race?.red_flag_lifecycle||null;
}

function validSuspension(gs){
  const weekend=gs?.raceWeekendState;
  const live=weekend?.live_race;
  const lifecycle=lifecycleFor(gs);
  return Boolean(
    weekend?.phase==="race"&&
    live?.status==="red_flag"&&
    lifecycle&&
    lifecycle?.phase==="suspended"&&
    lifecycle?.work_locked!==true
  );
}

export function redFlagWorkCapability(gs,{driverId}={}){
  const year=Number(gs?.activeYear)||1980;
  const policy=lifecycleFor(gs)?.work_policy||redFlagWorkPolicyForYear(year);
  const did=String(driverId||"");
  const row=(gs?.raceWeekendState?.live_race?.classification||[])
    .find((candidate)=>String(candidate?.driver_id??"")===did)||null;
  const ownsDriver=Boolean(row&&String(row?.team_id??"")===playerTeamId(gs));
  return {
    allowed:validSuspension(gs)&&ownsDriver&&!row?.retired,
    policy,
    tyre_change:Boolean(policy?.tyre_change),
    genuine_accident_repair:Boolean(policy?.genuine_accident_repair),
    front_wing_adjustment:Boolean(policy?.front_wing_adjustment),
    // The current live-race model has no persistent per-car damage state yet.
    damage_repair_available:false,
    front_wing_adjustment_available:false,
    reason:!validSuspension(gs)
      ?"work_window_closed"
      :!ownsDriver
        ?"not_player_driver"
        :row?.retired
          ?"driver_retired"
          :null,
  };
}

export function applyRedFlagTyreChange(gs,{driverId,tyreId}={}){
  if(!validSuspension(gs))return gs;
  const weekend=gs.raceWeekendState;
  const live=weekend.live_race;
  const lifecycle=live.red_flag_lifecycle;
  const did=String(driverId||"");
  const row=(live.classification||[]).find((candidate)=>String(candidate?.driver_id??"")===did);
  if(!row||row?.retired||String(row?.team_id??"")!==playerTeamId(gs))return gs;

  const policy=lifecycle?.work_policy||redFlagWorkPolicyForYear(gs?.activeYear);
  if(policy?.tyre_change!==true)return gs;

  const tyre=tyreAvailableForTeam(gs,row.team_id,tyreId);
  if(!tyre)return gs;

  const sequence=Math.max(1,Number(lifecycle?.sequence)||1);
  const effectiveLap=Math.max(1,Number(live?.current_lap)||1);
  const existingCommands=weekend?.race_strategy?.live_commands?.[did]||[];
  const nextCommands=existingCommands.filter((command)=>!(
    command?.type==="red_flag_tyre"&&
    Number(command?.red_flag_sequence||0)===sequence
  ));
  nextCommands.push({
    type:"red_flag_tyre",
    tyre_id:idOf(tyre),
    effective_lap:effectiveLap,
    red_flag_sequence:sequence,
    issued_lap:effectiveLap,
    issued_sector:Math.max(1,Number(live?.current_sector)||1),
  });

  const previousTyre=row?.tyre||null;
  const updatedRows=(live.classification||[]).map((candidate)=>{
    if(String(candidate?.driver_id??"")!==did)return candidate;
    return {
      ...candidate,
      tyre:{
        ...(candidate?.tyre||{}),
        tyre_id:idOf(tyre),
        compound:tyreLabel(tyre),
        category:String(tyre?.category||candidate?.tyre?.category||"dry"),
        condition:100,
        age_laps:0,
        stint_number:Math.max(1,Number(candidate?.tyre?.stint_number)||1)+1,
        stint_start_lap:effectiveLap,
        source:"red_flag_work",
      },
    };
  });

  const action={
    type:"tyre_change",
    driver_id:did,
    team_id:String(row?.team_id??""),
    lap:effectiveLap,
    sector:Math.max(1,Number(live?.current_sector)||1),
    red_flag_sequence:sequence,
    tyre_from_id:previousTyre?.tyre_id??null,
    tyre_from:previousTyre?.compound??null,
    tyre_to_id:idOf(tyre),
    tyre_to:tyreLabel(tyre),
    free_service:true,
  };
  const workLog=[
    ...(Array.isArray(lifecycle?.work_log)?lifecycle.work_log:[])
      .filter((entry)=>!(entry?.type==="tyre_change"&&String(entry?.driver_id??"")===did)),
    action,
  ];

  return {
    ...gs,
    raceWeekendState:{
      ...weekend,
      race_strategy:{
        ...weekend.race_strategy,
        live_commands:{
          ...(weekend?.race_strategy?.live_commands||{}),
          [did]:nextCommands,
        },
      },
      live_race:{
        ...live,
        classification:updatedRows,
        red_flag_lifecycle:{
          ...lifecycle,
          work_log:workLog,
        },
        events:[...(live.events||[]),{
          event_key:`red_flag_work:tyre:${sequence}:${did}`,
          lap:effectiveLap,
          sector:Math.max(1,Number(live?.current_sector)||1),
          type:"red_flag_work",
          work_type:"tyre_change",
          driver_id:did,
          team_id:String(row?.team_id??""),
          tyre_from_id:previousTyre?.tyre_id??null,
          tyre_from:previousTyre?.compound??null,
          tyre_to_id:idOf(tyre),
          tyre_to:tyreLabel(tyre),
          message:`${did} changed from ${previousTyre?.compound||"current"} to ${tyreLabel(tyre)} tyres during the Red Flag.`,
        }],
      },
    },
  };
}
