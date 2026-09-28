// src/race2/track/TrackModel.js
// RW8.1: canonical continuous track coordinate system for Race Weekend 2.0.
// Race physics use metres. Display geometry is only a deterministic mapping
// from physical distance to an on-screen pose.

import { resolveTrackLayout, trackIntelligenceProfile } from "../../domain/trackLayout.js";
import { buildClosedRacingLine, racingLinePoseAtDistance } from "../../domain/raceSplineV3.js";

export const TRACK_MODEL_SCHEMA_VERSION=1;

const text=(value)=>String(value??"");
const finite=(value,fallback=null)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const positive=(value,fallback=null)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)&&parsed>0?parsed:fallback;
};
const wrap01=(value)=>{
  const n=Number(value)||0;
  return ((n%1)+1)%1;
};

function trackIdOf(gp,trackId){
  return text(trackId??gp?.track_id??gp?.circuit_id??gp?.track?.track_id)||null;
}

function yearOf(gs,gp,year){
  return finite(year,finite(gs?.activeYear,finite(gp?.year??gp?.season_year,null)));
}

function trackRows(gs){
  return Array.isArray(gs?.trackLayoutByYear)&&gs.trackLayoutByYear.length
    ?gs.trackLayoutByYear
    :(Array.isArray(gs?.dbTrackLayoutByYear)?gs.dbTrackLayoutByYear:[]);
}

function rowForTrackYear(rows,trackId,year){
  const id=text(trackId);
  const candidates=(Array.isArray(rows)?rows:[]).filter((row)=>
    text(row?.track_id??row?.circuit_id)===id
  );
  if(!candidates.length)return null;
  if(year==null)return candidates[0];

  return candidates.find((row)=>{
    const from=finite(row?.year_from??row?.year,-Infinity);
    const to=finite(row?.year_to??row?.year,Infinity);
    return year>=from&&year<=to;
  })??candidates[0];
}

function coreTrackFor(gs,trackId){
  const rows=Array.isArray(gs?.coreTracks)&&gs.coreTracks.length
    ?gs.coreTracks
    :(Array.isArray(gs?.dbCoreTracks)?gs.dbCoreTracks:[]);
  return rows.find((row)=>text(row?.track_id??row?.circuit_id)===text(trackId))??null;
}

function firstPositive(...values){
  for(const value of values){
    const n=positive(value,null);
    if(n!=null)return n;
  }
  return null;
}

function geometryForResolution(resolved){
  const functional=resolved?.track_package?.functional;
  if(Array.isArray(functional?.points)&&functional.points.length>=3){
    return {geometry:functional,source:"f1track_functional"};
  }
  if(Array.isArray(resolved?.geometry?.points)&&resolved.geometry.points.length>=3){
    return {geometry:resolved.geometry,source:"track_layout_geometry"};
  }
  return {geometry:null,source:"none"};
}

function clonePoints(points){
  return (Array.isArray(points)?points:[])
    .filter((point)=>Array.isArray(point)&&Number.isFinite(Number(point[0]))&&Number.isFinite(Number(point[1])))
    .map((point)=>[Number(point[0]),Number(point[1])]);
}

function visualViewBox(geometry){
  const box=Array.isArray(geometry?.view_box)&&geometry.view_box.length===4
    ?geometry.view_box.map(Number)
    :null;
  return box?.every(Number.isFinite)?box:null;
}

function relativeProgressFromStart(startFinishProgress,absoluteProgress){
  return wrap01(wrap01(absoluteProgress)-wrap01(startFinishProgress));
}

export function trackDistanceAtProgress(model,absoluteProgress){
  const length=positive(model?.lengthM,0);
  if(length<=0)return null;
  const start=finite(model?.startFinish?.progress,0);
  return relativeProgressFromStart(start,absoluteProgress)*length;
}

export function trackProgressAtDistance(model,distanceAlongLapM){
  const length=positive(model?.lengthM,0);
  if(length<=0)return null;
  const start=finite(model?.startFinish?.progress,0);
  const distance=Number(distanceAlongLapM)||0;
  const relative=((distance%length)+length)%length;
  return wrap01(start+(relative/length));
}

export function wrapTrackDistanceM(model,distanceAlongLapM){
  const length=positive(model?.lengthM,0);
  if(length<=0)return null;
  const distance=Number(distanceAlongLapM)||0;
  return ((distance%length)+length)%length;
}

export function trackForwardGapM(model,fromDistanceM,toDistanceM){
  const length=positive(model?.lengthM,0);
  if(length<=0)return null;
  const from=wrapTrackDistanceM(model,fromDistanceM);
  const to=wrapTrackDistanceM(model,toDistanceM);
  return ((to-from)%length+length)%length;
}

export function trackSectorAtDistance(model,distanceAlongLapM){
  const distance=wrapTrackDistanceM(model,distanceAlongLapM);
  if(distance==null)return null;
  const boundaries=(model?.sectors||[])
    .slice(0,2)
    .map((sector)=>positive(sector?.endM,null))
    .filter((value)=>value!=null)
    .sort((a,b)=>a-b);
  if(boundaries.length!==2)return Math.min(3,Math.max(1,Math.floor((distance/(positive(model?.lengthM,1)/3)))+1));
  if(distance<boundaries[0])return 1;
  if(distance<boundaries[1])return 2;
  return 3;
}

export function trackPoseAtDistance(model,distanceAlongLapM){
  const line=model?.racingLine;
  const total=positive(line?.total_length,0);
  if(total<=0)return null;
  const progress=trackProgressAtDistance(model,distanceAlongLapM);
  if(progress==null)return null;
  const pose=racingLinePoseAtDistance(line,progress*total);
  if(!pose)return null;
  return {
    ...pose,
    distanceAlongLapM:wrapTrackDistanceM(model,distanceAlongLapM),
    trackProgress:progress,
  };
}

export function buildTrackModel(gs,{gp=null,trackId=null,year=null,trackSnapshot=null,samplesPerSegment=6}={}){
  const id=trackIdOf(gp,trackId??trackSnapshot?.track_id);
  const y=yearOf(gs,gp,year);
  if(!id)return null;

  const metadata=rowForTrackYear(trackRows(gs),id,y);
  const core=coreTrackFor(gs,id);
  const resolved=resolveTrackLayout({trackId:id,year:y});
  const layout=resolved?.layout??null;
  const trackPackage=resolved?.track_package??null;
  const {geometry,source:geometrySource}=geometryForResolution(resolved);

  const lengthKm=firstPositive(
    metadata?.lap_length_km,
    trackSnapshot?.lap_length_km,
    layout?.lap_length_km,
    trackPackage?.lap_length_km,
    core?.lap_length_km
  );
  const lengthM=firstPositive(trackSnapshot?.length_m,trackSnapshot?.lengthM,lengthKm==null?null:lengthKm*1000);
  if(lengthM==null)return null;

  const intelligence=trackIntelligenceProfile(layout);
  const startFinishProgress=wrap01(intelligence.start_finish_progress);
  const boundaryProgress=(intelligence.sector_boundaries||[1/3,2/3]).slice(0,2).map(wrap01);
  const boundaryMeters=boundaryProgress
    .map((progress)=>relativeProgressFromStart(startFinishProgress,progress)*lengthM)
    .sort((a,b)=>a-b);
  const sectorEnds=[boundaryMeters[0]??lengthM/3,boundaryMeters[1]??lengthM*2/3,lengthM];
  const sectorStarts=[0,sectorEnds[0],sectorEnds[1]];
  const sectors=[1,2,3].map((sector,index)=>({
    id:`sector_${sector}`,
    sector,
    startM:Number(sectorStarts[index].toFixed(3)),
    endM:Number(sectorEnds[index].toFixed(3)),
    lengthM:Number((sectorEnds[index]-sectorStarts[index]).toFixed(3)),
  }));

  const sourcePoints=clonePoints(geometry?.points);
  const racingLine=sourcePoints.length>=3
    ?buildClosedRacingLine(sourcePoints,{samplesPerSegment})
    :null;
  const pitPoints=clonePoints(geometry?.pit_lane_points);
  const pitEntryProgress=finite(intelligence?.pit_entry_progress,null);
  const pitExitProgress=finite(intelligence?.pit_exit_progress,null);
  const pitEntryM=pitEntryProgress==null?null:trackDistanceAtProgress({lengthM,startFinish:{progress:startFinishProgress}},pitEntryProgress);
  const pitExitM=pitExitProgress==null?null:trackDistanceAtProgress({lengthM,startFinish:{progress:startFinishProgress}},pitExitProgress);

  const laps=positive(
    metadata?.laps,
    positive(trackSnapshot?.laps,positive(gp?.laps,null))
  );

  return {
    schemaVersion:TRACK_MODEL_SCHEMA_VERSION,
    trackId:id,
    layoutId:layout?.layout_id??trackPackage?.layout_id??null,
    year:y,
    label:layout?.label??trackPackage?.name??core?.track_name??gp?.track_name??gp?.gp_name??id,
    lengthM:Number(lengthM.toFixed(3)),
    laps:laps==null?null:Math.round(laps),
    raceDirection:layout?.race_direction??trackPackage?.race_direction??null,
    resolution:{
      kind:resolved?.resolution??"none",
      exact:Boolean(resolved?.exact),
      fallback:Boolean(resolved?.fallback),
      historicalStatus:layout?.historical_status??null,
      intelligenceStatus:intelligence?.status??null,
    },
    geometry:{
      source:geometrySource,
      quality:geometry?.quality??layout?.geometry_status??null,
      viewBox:visualViewBox(geometry),
      sourcePointCount:sourcePoints.length,
      pitLanePointCount:pitPoints.length,
    },
    racingLine:racingLine?{
      points:racingLine.points.map((point)=>[Number(point[0]),Number(point[1])]),
      cumulative:racingLine.cumulative.map(Number),
      total_length:Number(racingLine.total_length),
      source_count:Number(racingLine.source_count),
      samples_per_segment:Number(racingLine.samples_per_segment),
    }:null,
    startFinish:{
      progress:startFinishProgress,
      distanceM:0,
    },
    sectors,
    pitLane:{
      available:Boolean(pitPoints.length>=2&&pitEntryM!=null&&pitExitM!=null),
      entryProgress:pitEntryProgress==null?null:wrap01(pitEntryProgress),
      exitProgress:pitExitProgress==null?null:wrap01(pitExitProgress),
      entryM:pitEntryM==null?null:Number(pitEntryM.toFixed(3)),
      exitM:pitExitM==null?null:Number(pitExitM.toFixed(3)),
      points:pitPoints,
    },
    traits:{
      drsZones:finite(metadata?.drs_zones,finite(trackSnapshot?.drs_zones,null)),
      pitLaneLossS:finite(metadata?.pit_lane_loss_s,finite(trackSnapshot?.pit_lane_loss_s,null)),
      overtakingDifficulty:finite(core?.overtaking_difficulty,null),
      tyreWear:finite(core?.tyre_wear,null),
      crashRisk:finite(core?.crash_risk,null),
    },
  };
}
