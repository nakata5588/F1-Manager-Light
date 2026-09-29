// src/race2/track/TrackModel.js
// RW8.1: canonical continuous track coordinate system for Race Weekend 2.0.
// Race physics use metres. Display geometry is only a deterministic mapping
// from physical distance to an on-screen pose.

import { resolveTrackLayout, trackIntelligenceProfile } from "../../domain/trackLayout.js";
import { buildClosedRacingLine, racingLinePoseAtDistance } from "../../domain/raceSplineV3.js";

export const TRACK_MODEL_SCHEMA_VERSION=2;

const text=(value)=>String(value??"");
const finite=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
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
const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,Number(value)||0));

function headingDeltaDeg(a,b){
  let delta=((Number(b)||0)-(Number(a)||0))%360;
  if(delta>180)delta-=360;
  if(delta<-180)delta+=360;
  return Math.abs(delta);
}

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

export function trackCornerSeverityAtDistance(model,distanceAlongLapM){
  const profile=model?.speedProfile;
  const samples=Array.isArray(profile?.samples)?profile.samples:[];
  if(!samples.length)return 0;
  if(samples.length===1)return clamp(samples[0]?.severity,0,1);
  const length=positive(model?.lengthM,0);
  if(length<=0)return 0;
  const wrapped=wrapTrackDistanceM(model,distanceAlongLapM)??0;
  const spacing=positive(profile?.sampleSpacingM,length/samples.length);
  const rawIndex=Math.floor(wrapped/spacing);
  const index=((rawIndex%samples.length)+samples.length)%samples.length;
  const nextIndex=(index+1)%samples.length;
  const startDistance=index*spacing;
  const t=clamp((wrapped-startDistance)/Math.max(1e-9,spacing),0,1);
  const a=clamp(samples[index]?.severity,0,1);
  const b=clamp(samples[nextIndex]?.severity,0,1);
  return a+(b-a)*t;
}

export function trackCornerSeverityAhead(model,distanceAlongLapM,lookaheadM,{samples=5}={}){
  const distance=Math.max(0,Number(lookaheadM)||0);
  const count=Math.max(1,Math.min(12,Math.round(Number(samples)||5)));
  let maximum=trackCornerSeverityAtDistance(model,distanceAlongLapM);
  if(distance<=0)return maximum;
  for(let index=1;index<=count;index+=1){
    const probe=Number(distanceAlongLapM||0)+(distance*index/count);
    maximum=Math.max(maximum,trackCornerSeverityAtDistance(model,probe));
  }
  return maximum;
}

export function buildTrackSpeedProfile(model,{detailed=null}={}){
  const length=positive(model?.lengthM,0);
  const hasLine=positive(model?.racingLine?.total_length,0)>0;
  const trusted=detailed==null
    ?Boolean(
      model?.geometry?.source==="f1track_functional"&&
      /verified/i.test(String(model?.geometry?.quality??""))
    )
    :Boolean(detailed);

  if(length<=0||!hasLine||!trusted){
    return {
      source:"neutral",
      detailed:false,
      sampleSpacingM:length>0?Number(length.toFixed(3)):null,
      windowM:null,
      samples:[{distanceM:0,severity:0}],
    };
  }

  const sampleCount=Math.max(72,Math.min(180,Math.round(length/45)));
  const spacing=length/sampleCount;
  const windowM=Math.max(30,Math.min(70,length/120));
  const raw=[];

  for(let index=0;index<sampleCount;index+=1){
    const distance=index*spacing;
    const before=trackPoseAtDistance(model,distance-windowM);
    const after=trackPoseAtDistance(model,distance+windowM);
    const turn=before&&after?headingDeltaDeg(before.heading,after.heading):0;
    raw.push(clamp(turn/55,0,1));
  }

  const smoothed=raw.map((value,index)=>{
    const previous=raw[(index-1+raw.length)%raw.length];
    const next=raw[(index+1)%raw.length];
    return clamp(previous*0.25+value*0.5+next*0.25,0,1);
  });

  return {
    source:"verified_functional_geometry",
    detailed:true,
    sampleSpacingM:Number(spacing.toFixed(3)),
    windowM:Number(windowM.toFixed(3)),
    samples:smoothed.map((severity,index)=>({
      distanceM:Number((index*spacing).toFixed(3)),
      severity:Number(severity.toFixed(4)),
    })),
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
  const racingLineContract=racingLine?{
    points:racingLine.points.map((point)=>[Number(point[0]),Number(point[1])]),
    cumulative:racingLine.cumulative.map(Number),
    total_length:Number(racingLine.total_length),
    source_count:Number(racingLine.source_count),
    samples_per_segment:Number(racingLine.samples_per_segment),
  }:null;
  const geometryContract={
    source:geometrySource,
    quality:geometry?.quality??layout?.geometry_status??null,
    viewBox:visualViewBox(geometry),
    sourcePointCount:sourcePoints.length,
    pitLanePointCount:clonePoints(geometry?.pit_lane_points).length,
  };
  const startFinish={progress:startFinishProgress,distanceM:0};
  const speedProfile=buildTrackSpeedProfile({
    lengthM,
    racingLine:racingLineContract,
    geometry:geometryContract,
    startFinish,
  });
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
    geometry:{...geometryContract,pitLanePointCount:pitPoints.length},
    racingLine:racingLineContract,
    startFinish,
    sectors,
    speedProfile,
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
