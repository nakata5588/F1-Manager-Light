// src/domain/driverCareerTimeline.js
//
// Presentation-only career timeline for Driver / Person profiles.
//
// It composes the driver's already-authoritative career rows (historical + F1
// Save World) with Lower Series Save-World history and accepted F1 call-ups.
// It never decides ratings, promotions, results or contracts.

import {
  lowerSeriesCareerTimeline,
  lowerSeriesDriverSeasonHistory,
} from "./lowerSeriesTimeline.js";

export const DRIVER_CAREER_TIMELINE_MODEL="driver_full_career_timeline_v1";

const rows=(value)=>Array.isArray(value)?value:[];
const text=(value)=>value==null?"":String(value).trim();
const num=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};

function seriesName(row){
  return text(row?.series_division??row?.series??row?.series_name)||"F1";
}

function seasonDetail(row){
  const parts=[];
  const position=num(row?.champ_pos??row?.position,null);
  if(Number.isFinite(position)&&row?.__showChampionshipPosition!==false){
    parts.push(`Championship P${position}`);
  }
  const starts=num(row?.starts??row?.races,0);
  const wins=num(row?.wins,0);
  const podiums=num(row?.podiums,0);
  const points=num(row?.points,0);
  if(starts>0)parts.push(`${starts} starts`);
  if(wins>0)parts.push(`${wins} win${wins===1?"":"s"}`);
  if(podiums>0)parts.push(`${podiums} podium${podiums===1?"":"s"}`);
  if(Number.isFinite(points)&&points!==0)parts.push(`${points} pts`);
  return parts.join(" · ")||"Season entry";
}

function lowerSeasonDetail(row){
  const parts=[];
  if(Number.isFinite(row?.position))parts.push(`Championship P${row.position}`);
  if(row?.starts>0)parts.push(`${row.starts} starts`);
  if(row?.wins>0)parts.push(`${row.wins} win${row.wins===1?"":"s"}`);
  if(row?.podiums>0)parts.push(`${row.podiums} podium${row.podiums===1?"":"s"}`);
  if(Number.isFinite(row?.points)&&row.points!==0)parts.push(`${row.points} pts`);
  if(Number.isFinite(row?.prospect_reputation))parts.push(`Prospect Rep ${row.prospect_reputation}`);
  return parts.join(" · ")||"Lower Series season";
}

function eventPriority(type){
  return {
    season:10,
    lower_series_season:10,
    team_change:20,
    champion:30,
    f1_interest:40,
    movement:50,
    f1_ready:60,
    f1_call_up:70,
  }[type]??99;
}

export function driverFullCareerTimeline(gameState,driverId,{
  careerRows=[],
}={}){
  const id=text(driverId);
  if(!id)return [];

  const events=[];
  const seasonByKey=new Map();

  // Historical / F1 season rows are already normalised by DriverProfile.
  for(const row of rows(careerRows)){
    const year=num(row?.year,null);
    if(!Number.isInteger(year))continue;
    const series=seriesName(row);
    const team=text(row?.team_name??row?.team??row?.team_id)||"—";
    const key=`${year}|${series.toUpperCase()}|${team.toUpperCase()}`;
    seasonByKey.set(key,{
      id:`career:${year}:${series}:${team}`,
      year,
      date:null,
      type:series.toUpperCase()==="F1"?"season":"lower_series_season",
      driver_id:id,
      series_name:series,
      team_name:team,
      title:`${series} — ${team}`,
      detail:seasonDetail(row),
      championship_position:num(row?.champ_pos,null),
      champion:!row?.__live&&num(row?.champ_pos,null)===1&&row?.__showChampionshipPosition!==false,
      source:row?.__simulated?"f1_save_world":"historical_career",
    });

    if(row?.__transfer){
      const from=text(row.__transfer?.from)||"Previous team";
      const to=text(row.__transfer?.to)||team;
      events.push({
        id:`career:${year}:transfer:${from}:${to}:${num(row.__transfer?.round,0)}`,
        year,
        date:null,
        type:"team_change",
        driver_id:id,
        series_name:series,
        team_name:to,
        title:`Moved to ${to}`,
        detail:`${from} → ${to}${Number.isFinite(num(row.__transfer?.round,null))?` · Round ${num(row.__transfer.round)}`:""}`,
        source:"career_transfer_annotation",
      });
    }
  }

  // Save-World Lower Series seasons supersede a generic historical row for the
  // same year/series/team because they contain the actual alternate-history data.
  for(const row of lowerSeriesDriverSeasonHistory(gameState,id)){
    const year=num(row?.season_year,null);
    if(!Number.isInteger(year))continue;
    const series=text(row?.series_name??row?.series_id)||"Lower Series";
    const team=text(row?.lower_team_name??row?.lower_team_id)||"Team not assigned";
    const key=`${year}|${series.toUpperCase()}|${team.toUpperCase()}`;
    seasonByKey.set(key,{
      id:`lower-season:${year}:${text(row?.series_id)}:${text(row?.lower_team_id)}`,
      year,
      date:null,
      type:"lower_series_season",
      driver_id:id,
      series_id:text(row?.series_id)||null,
      series_name:series,
      team_name:team,
      title:`${series} — ${team}`,
      detail:lowerSeasonDetail(row),
      championship_position:num(row?.position,null),
      champion:Boolean(row?.champion),
      prospect_reputation:num(row?.prospect_reputation,null),
      best_f1_interest:row?.best_f1_interest?{...row.best_f1_interest}:null,
      career_movement:row?.career_movement?{...row.career_movement}:null,
      source:"lower_series_save_world",
    });
  }

  events.push(...seasonByKey.values());

  // Meaningful Lower-Series milestones are preserved as separate timeline
  // events. The season row remains the statistical summary for that year.
  for(const event of lowerSeriesCareerTimeline(gameState,{driverId:id})){
    if(!["champion","f1_interest","movement","f1_ready","f1_call_up"].includes(event?.type))continue;
    events.push({
      ...event,
      id:`profile:${event.id}`,
      source:event.source||"lower_series_save_world",
    });
  }

  // F1 championship titles are milestones of the full career too.
  for(const season of seasonByKey.values()){
    if(season.type!=="season"||!season.champion)continue;
    events.push({
      id:`career:${season.year}:f1-title:${id}`,
      year:season.year,
      date:null,
      type:"champion",
      driver_id:id,
      series_name:"F1",
      team_name:season.team_name,
      title:"Formula 1 World Champion",
      detail:season.team_name,
      source:season.source,
    });
  }

  const seen=new Set();
  return events
    .filter((event)=>{
      const signature=[
        event.type,
        event.year,
        text(event.series_name),
        text(event.team_name??event.f1_team_name),
        text(event.title),
      ].join("|").toUpperCase();
      if(seen.has(signature))return false;
      seen.add(signature);
      return true;
    })
    .sort((a,b)=>
      num(a?.year,9999)-num(b?.year,9999)||
      text(a?.date).localeCompare(text(b?.date))||
      eventPriority(a?.type)-eventPriority(b?.type)||
      text(a?.title).localeCompare(text(b?.title))
    )
    .map((event,index)=>({
      ...event,
      timeline_index:index,
      model:DRIVER_CAREER_TIMELINE_MODEL,
    }));
}
