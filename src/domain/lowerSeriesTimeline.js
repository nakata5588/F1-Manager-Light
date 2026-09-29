// src/domain/lowerSeriesTimeline.js
//
// LS8 — read-only presentation model for the Lower Series World UI.
//
// This module only interprets canonical Save-World facts already produced by
// LowerSeriesEngine, Prospect/F1 Interest, Career Movement and the F1 contract
// market. It does not decide performance, promotions or call-ups.

import { lowerSeriesMovementLabel } from "./lowerSeriesCareerMovement.js";

const rows=(value)=>Array.isArray(value)?value:[];
const text=(value)=>value==null?"":String(value).trim();
const num=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const n=Number(value);
  return Number.isFinite(n)?n:fallback;
};
const driverIdOf=(row)=>text(row?.driver_id??row?.person_id??row?.id);
const teamIdOf=(row)=>text(row?.team_id??row?.constructor_id??row?.id);

function entries(snapshot){
  if(Array.isArray(snapshot?.entries))return snapshot.entries;
  if(snapshot?.entries&&typeof snapshot.entries==="object")return Object.values(snapshot.entries);
  return [];
}

function teamName(gameState,teamId){
  const id=text(teamId);
  if(!id)return null;
  const all=[...rows(gameState?.teams),...rows(gameState?.dbTeams)];
  const team=all.find((row)=>teamIdOf(row)===id);
  return text(team?.short_name??team?.team_name??team?.name)||id;
}

function driverName(gameState,driverId){
  const id=text(driverId);
  if(!id)return null;
  const all=[...rows(gameState?.dbDrivers),...rows(gameState?.drivers)];
  const driver=all.find((row)=>driverIdOf(row)===id);
  return text(driver?.display_name??driver?.driver_name??driver?.name)||id;
}

export function lowerSeriesSeasonSnapshots(world){
  if(!world||typeof world!=="object")return [];
  const byYear=new Map();
  for(const snapshot of [...rows(world.history),world]){
    const year=num(snapshot?.season_year,null);
    if(Number.isInteger(year))byYear.set(year,snapshot);
  }
  return [...byYear.entries()]
    .sort((a,b)=>a[0]-b[0])
    .map(([,snapshot])=>snapshot);
}

function standingsRow(snapshot,entry){
  const seriesId=text(entry?.series_id);
  const standings=snapshot?.standings?.[seriesId]||null;
  const driverId=driverIdOf(entry);
  const row=rows(standings?.drivers).find((candidate)=>driverIdOf(candidate)===driverId)||null;
  return {standings,row};
}

function bestInterest(prospect){
  if(prospect?.best_f1_interest)return prospect.best_f1_interest;
  return rows(prospect?.f1_interest)
    .slice()
    .sort((a,b)=>num(b?.score,0)-num(a?.score,0))[0]||null;
}

export function lowerSeriesDriverSeasonHistory(gameState,driverId){
  const id=text(driverId);
  if(!id)return [];
  const snapshots=lowerSeriesSeasonSnapshots(gameState?.lowerSeriesWorld);

  return snapshots
    .map((snapshot)=>{
      const entry=entries(snapshot).find((row)=>driverIdOf(row)===id);
      if(!entry)return null;
      const {standings,row}=standingsRow(snapshot,entry);
      const prospect=snapshot?.prospects?.[id]||null;
      const interest=bestInterest(prospect);
      const movement=entry?.career_movement||null;
      return {
        season_year:num(snapshot?.season_year,null),
        driver_id:id,
        driver_name:driverName(gameState,id),
        series_id:text(entry?.series_id)||null,
        series_name:text(entry?.series_name)||null,
        series_level:num(entry?.series_level,null),
        lower_team_id:text(entry?.lower_team_id)||null,
        lower_team_name:text(entry?.team_name)||null,
        position:num(row?.position,null),
        starts:num(row?.starts,0),
        wins:num(row?.wins,0),
        podiums:num(row?.podiums,0),
        points:num(row?.points,0),
        champion:Boolean(
          standings?.complete&&
          text(standings?.champion_driver_id)===id
        ),
        prospect_reputation:num(prospect?.prospect_reputation,null),
        performance_score:num(prospect?.performance?.score,null),
        best_f1_interest:interest?{
          ...interest,
          f1_team_name:teamName(gameState,interest?.f1_team_id),
        }:null,
        career_movement:movement?{...movement}:null,
        movement_label:movement?lowerSeriesMovementLabel(movement):null,
        source:"lower_series_save_world",
      };
    })
    .filter(Boolean);
}

function seasonEvents(gameState,snapshot){
  const year=num(snapshot?.season_year,null);
  if(!Number.isInteger(year))return [];
  const output=[];

  for(const entry of entries(snapshot)){
    const id=driverIdOf(entry);
    if(!id)continue;
    const {standings,row}=standingsRow(snapshot,entry);
    const prospect=snapshot?.prospects?.[id]||null;
    const interest=bestInterest(prospect);
    const name=driverName(gameState,id);

    if(
      standings?.complete&&
      text(standings?.champion_driver_id)===id
    ){
      output.push({
        id:`lower-series:${year}:champion:${id}:${text(entry?.series_id)}`,
        year,
        type:"champion",
        driver_id:id,
        driver_name:name,
        series_id:text(entry?.series_id)||null,
        series_name:text(entry?.series_name)||null,
        title:`${name} wins ${text(entry?.series_name)||"Lower Series"}`,
        detail:`P1 · ${num(row?.wins,0)} wins · ${num(row?.points,0)} pts`,
        source:"lower_series_save_world",
      });
    }

    if(interest&&text(interest?.status)&&text(interest.status)!=="none"){
      output.push({
        id:`lower-series:${year}:interest:${id}:${text(interest?.f1_team_id)}`,
        year,
        type:"f1_interest",
        driver_id:id,
        driver_name:name,
        series_id:text(entry?.series_id)||null,
        series_name:text(entry?.series_name)||null,
        f1_team_id:text(interest?.f1_team_id)||null,
        f1_team_name:teamName(gameState,interest?.f1_team_id),
        title:`${name} attracts F1 interest`,
        detail:`${teamName(gameState,interest?.f1_team_id)||"F1 team"} · ${text(interest?.status).replaceAll("_"," ")} · score ${num(interest?.score,0)}`,
        source:"lower_series_prospect_interest",
      });
    }

    const movement=entry?.career_movement;
    if(movement){
      const label=lowerSeriesMovementLabel(movement);
      const meaningful=
        movement?.effective_outcome==="promoted"||
        movement?.effective_outcome==="promotion_pending"||
        movement?.effective_outcome==="promotion_blocked"||
        movement?.f1_ready===true||
        movement?.effective_outcome==="f1_ready";
      if(meaningful){
        output.push({
          id:`lower-series:${year}:movement:${id}`,
          year,
          type:movement?.f1_ready?"f1_ready":"movement",
          driver_id:id,
          driver_name:name,
          series_id:text(entry?.series_id)||null,
          series_name:text(entry?.series_name)||null,
          title:`${name}: ${label}`,
          detail:movement?.f1_ready
            ?`Level ${num(movement?.from_level,2)} performance opened the F1 path`
            :`Level ${num(movement?.from_level,"—")} → ${num(movement?.target_level,"—")} · ${text(movement?.effective_outcome??movement?.decision).replaceAll("_"," ")}`,
          movement:{...movement},
          source:"lower_series_career_movement",
        });
      }
    }
  }

  return output;
}

function callUpEvents(gameState){
  const output=[];
  for(const contract of rows(gameState?.contracts)){
    const callUp=contract?.lower_series_call_up;
    if(!callUp||typeof callUp!=="object")continue;
    const driverId=driverIdOf(contract);
    if(!driverId)continue;
    const acceptedAt=text(callUp?.accepted_at??contract?.signed_at??contract?.start_date);
    const year=num(
      acceptedAt.slice(0,4),
      num(contract?.contract_start_year??contract?.year,null)
    );
    if(!Number.isInteger(year))continue;
    const teamId=teamIdOf(contract);
    const role=text(callUp?.accepted_role??contract?.role)||"F1 Driver";
    const name=driverName(gameState,driverId);
    output.push({
      id:`lower-series:${year}:call-up:${driverId}:${teamId}:${role}`,
      year,
      type:"f1_call_up",
      driver_id:driverId,
      driver_name:name,
      f1_team_id:teamId||null,
      f1_team_name:teamName(gameState,teamId),
      series_id:text(callUp?.series_id)||null,
      title:`${name} earns an F1 call-up`,
      detail:`${teamName(gameState,teamId)||teamId||"F1 team"} · ${role}`,
      date:acceptedAt||null,
      source:"canonical_f1_contract",
    });
  }
  return output;
}

export function lowerSeriesCareerTimeline(gameState,{
  driverId=null,
  limit=null,
}={}){
  const wanted=text(driverId);
  const events=lowerSeriesSeasonSnapshots(gameState?.lowerSeriesWorld)
    .flatMap((snapshot)=>seasonEvents(gameState,snapshot));
  events.push(...callUpEvents(gameState));

  const seen=new Set();
  const output=events
    .filter((event)=>!wanted||event.driver_id===wanted)
    .filter((event)=>{
      if(seen.has(event.id))return false;
      seen.add(event.id);
      return true;
    })
    .sort((a,b)=>
      num(b?.year,0)-num(a?.year,0)||
      text(b?.date).localeCompare(text(a?.date))||
      text(a?.driver_name).localeCompare(text(b?.driver_name))||
      text(a?.id).localeCompare(text(b?.id))
    );

  return Number.isInteger(Number(limit))&&Number(limit)>0
    ?output.slice(0,Number(limit))
    :output;
}

export function lowerSeriesWorldSummary(gameState){
  const world=gameState?.lowerSeriesWorld;
  if(!world||typeof world!=="object"){
    return {
      season_year:null,
      series:0,
      drivers:0,
      f1_ready:0,
      promotions:0,
      f1_interest:0,
    };
  }

  const entriesNow=entries(world);
  const prospects=world.prospects&&typeof world.prospects==="object"
    ?Object.values(world.prospects)
    :[];

  return {
    season_year:num(world?.season_year,null),
    series:rows(world?.series).filter((row)=>text(row?.series_id)).length,
    drivers:entriesNow.length,
    f1_ready:entriesNow.filter((row)=>Boolean(row?.career_movement?.f1_ready)).length,
    promotions:entriesNow.filter((row)=>row?.career_movement?.effective_outcome==="promoted").length,
    f1_interest:prospects.filter((prospect)=>{
      const interest=bestInterest(prospect);
      return interest&&text(interest?.status)!=="none";
    }).length,
  };
}
