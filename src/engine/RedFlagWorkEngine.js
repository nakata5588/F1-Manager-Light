// src/engine/RedFlagWorkEngine.js
// RW5.2D4.5 — work performed while a live race is suspended.
//
// RaceStrategyEngine consumes red_flag_tyre commands so tyre work affects the
// resumed race without being treated as a pit stop.

import { redFlagWorkPolicyForYear } from "./RedFlagLifecycleEngine.js";

const idOf=(row)=>String(row?.tyre_id??row?.id??"");

function playerTeamId(gs){
  return String(gs?.team?.team_id??gs?.team?.id??"");
}

function driverName(gs,driverId){
  const row=(gs?.drivers||[]).find((driver)=>String(driver?.driver_id??driver?.id??"")===String(driverId??""));
  return String(row?.display_name||row?.name||driverId||"Driver");
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

function tyresForTeamLocal(gs,teamId){
  const year=Number(gs?.activeYear)||1980;
  const tid=String(teamId||"");
  const active=allTyres(gs).filter((row)=>{
    const from=Number(row?.year_from??row?.year??year);
    const to=Number(row?.year_to??row?.year??year);
    if(Number.isFinite(from)&&year<from)return false;
    if(Number.isFinite(to)&&year>to)return false;
    const rowTeam=String(row?.team_id??"");
    if(rowTeam&&rowTeam!==tid)return false;
    return true;
  });
  const supplier=gs?.raceStrategyWorld?.teamSuppliers?.[tid]||null;
  const matching=supplier
    ?active.filter((row)=>String(row?.supplier||"")===String(supplier))
    :[];
  return matching.length?matching:active;
}

function tyreAvailableForTeam(gs,teamId,tyreId){
  return tyresForTeamLocal(gs,teamId).find((row)=>idOf(row)===String(tyreId||""))||null;
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

function targetCategory(lifecycle){
  const wetness=Number(lifecycle?.track_snapshot?.track_wetness);
  if(Number.isFinite(wetness)){
    if(wetness>=0.72)return "wet";
    if(wetness>=0.20)return "intermediate";
    return "dry";
  }
  const state=String(lifecycle?.track_snapshot?.state||"SUNNY").toUpperCase();
  if(["STORM","HEAVY_RAIN"].includes(state))return "wet";
  if(["LIGHT_RAIN","WETTING","DRYING"].includes(state))return "intermediate";
  return "dry";
}

function bestTyreForCategory(gs,teamId,category){
  const matching=tyresForTeamLocal(gs,teamId)
    .filter((row)=>String(row?.category||"dry")===String(category||"dry"))
    .slice()
    .sort((a,b)=>{
      const grip=Number(b?.grip_index||0)-Number(a?.grip_index||0);
      if(grip!==0)return grip;
      return Number(a?.wear_rate||0)-Number(b?.wear_rate||0);
    });
  return matching[0]||null;
}

function applyTyreChange(gs,{row,tyre,source="player"}={}){
  if(!row||!tyre)return gs;
  const weekend=gs.raceWeekendState;
  const live=weekend.live_race;
  const lifecycle=live.red_flag_lifecycle;
  const did=String(row.driver_id||"");
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
    source,
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
    source,
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
      .filter((entry)=>!(
        entry?.type==="tyre_change"&&
        String(entry?.driver_id??"")===did&&
        Number(entry?.red_flag_sequence||0)===sequence
      )),
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
          work_source:source,
          driver_id:did,
          driver_name:driverName(gs,did),
          team_id:String(row?.team_id??""),
          tyre_from_id:previousTyre?.tyre_id??null,
          tyre_from:previousTyre?.compound??null,
          tyre_to_id:idOf(tyre),
          tyre_to:tyreLabel(tyre),
          message:`${driverName(gs,did)} changed from ${previousTyre?.compound||"current"} to ${tyreLabel(tyre)} tyres during the Red Flag.`,
        }],
      },
    },
  };
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
    // Persistent car damage is not yet represented in LiveRace rows.
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
  const live=gs.raceWeekendState.live_race;
  const lifecycle=live.red_flag_lifecycle;
  const did=String(driverId||"");
  const row=(live.classification||[]).find((candidate)=>String(candidate?.driver_id??"")===did);
  if(!row||row?.retired||String(row?.team_id??"")!==playerTeamId(gs))return gs;
  const policy=lifecycle?.work_policy||redFlagWorkPolicyForYear(gs?.activeYear);
  if(policy?.tyre_change!==true)return gs;
  const tyre=tyreAvailableForTeam(gs,row.team_id,tyreId);
  if(!tyre)return gs;
  return applyTyreChange(gs,{row,tyre,source:"player"});
}

export function applyAutomaticRedFlagWork(gs){
  if(!validSuspension(gs))return gs;
  let working=gs;
  const lifecycle=lifecycleFor(gs);
  const policy=lifecycle?.work_policy||redFlagWorkPolicyForYear(gs?.activeYear);
  if(policy?.tyre_change!==true)return gs;

  const desired=targetCategory(lifecycle);
  const playerTeam=playerTeamId(gs);
  const rows=[...(gs?.raceWeekendState?.live_race?.classification||[])];

  for(const original of rows){
    const did=String(original?.driver_id??"");
    if(!did||original?.retired||String(original?.team_id??"")===playerTeam)continue;
    const current=(working?.raceWeekendState?.live_race?.classification||[])
      .find((row)=>String(row?.driver_id??"")===did)||original;
    const currentCategory=String(current?.tyre?.category||"dry");
    const condition=Number(current?.tyre?.condition??100);
    const mismatch=currentCategory!==desired;
    const worn=Number.isFinite(condition)&&condition<55;
    if(!mismatch&&!worn)continue;

    const replacement=bestTyreForCategory(working,current.team_id,desired)
      ||bestTyreForCategory(working,current.team_id,currentCategory);
    if(!replacement)continue;
    working=applyTyreChange(working,{row:current,tyre:replacement,source:"ai"});
  }
  return working;
}
