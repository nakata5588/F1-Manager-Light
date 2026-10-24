import test from "node:test";
import assert from "node:assert/strict";

import {
  TRACK_CONTEXT_TYPES,
  TRACK_MODEL_SCHEMA_VERSION,
  buildTrackModel,
  trackContextAtDistance,
  trackDistanceAtProgress,
  trackForwardGapM,
  trackPoseAtDistance,
  trackProgressAtDistance,
  trackSectorAtDistance,
  wrapTrackDistanceM,
} from "../src/race2/track/TrackModel.js";
import { raceTargetSpeedProfile } from "../src/race2/core/RaceDynamics.js";

function argentinaState(){
  return {
    activeYear:1980,
    trackLayoutByYear:[{
      track_id:"tr_0018",
      year_from:1974,
      year_to:1981,
      lap_length_km:5.968,
      laps:53,
      drs_zones:0,
      pit_lane_loss_s:18.5,
    }],
    coreTracks:[{
      track_id:"tr_0018",
      track_name:"Buenos Aires",
      lap_length_km:5.968,
      overtaking_difficulty:48,
      tyre_wear:62,
      crash_risk:58,
    }],
  };
}

test("RW8.1 builds a metre-based model from the verified F1Track functional geometry",()=>{
  const model=buildTrackModel(argentinaState(),{
    gp:{track_id:"tr_0018",gp_name:"Argentine Grand Prix",year:1980},
  });

  assert.equal(model.schemaVersion,TRACK_MODEL_SCHEMA_VERSION);
  assert.equal(model.trackId,"tr_0018");
  assert.equal(model.layoutId,"tr_0018_provisional");
  assert.equal(model.lengthM,5968);
  assert.equal(model.laps,53);
  assert.equal(model.geometry.source,"f1track_functional");
  assert.equal(model.resolution.exact,true);
  assert.ok(model.geometry.sourcePointCount>200);
  assert.ok(model.racingLine.points.length>model.geometry.sourcePointCount);
  assert.equal(model.racingLine.parameterization,"centripetal");
  assert.equal(model.racingLine.straight_preservation,true);
  assert.ok(model.racingLine.straight_segment_count>0);
  assert.equal(model.width.physicalWidthM,12.5);
  assert.equal(model.width.usableRaceWidthM,11.25);
  assert.equal(model.width.source,"era_default_estimate");
  assert.equal(model.sectors.length,3);
  assert.equal(model.sectors[2].endM,5968);
  assert.equal(model.pitLane.available,true);
  assert.ok(model.pitLane.entryM>model.sectors[1].endM);
  assert.ok(model.pitLane.exitM<model.sectors[0].endM);
  assert.equal(model.traits.drsZones,0);
  assert.equal(model.speedProfile.detailed,true);
  assert.equal(model.speedProfile.source,"verified_functional_geometry");
  assert.ok(model.speedProfile.samples.length>=72);
  assert.ok(Math.max(...model.speedProfile.samples.map((row)=>row.severity))>0.25);
});

test("RW8.3B corner severity comes only from verified functional geometry",()=>{
  const model=buildTrackModel(argentinaState(),{
    gp:{track_id:"tr_0018",gp_name:"Argentine Grand Prix",year:1980},
  });
  const severities=model.speedProfile.samples.map((row)=>row.severity);
  assert.ok(Math.max(...severities)>Math.min(...severities));
});

test("Track 4.0 derives semantic gameplay context from the canonical model",()=>{
  const model=buildTrackModel(argentinaState(),{
    gp:{track_id:"tr_0018",gp_name:"Argentine Grand Prix",year:1980},
  });
  const contexts=model.speedProfile.samples.map((row)=>trackContextAtDistance(model,row.distanceM));
  const types=new Set(contexts.map((row)=>row.type));

  assert.ok(types.has(TRACK_CONTEXT_TYPES.STRAIGHT));
  assert.ok(
    types.has(TRACK_CONTEXT_TYPES.FAST_CORNER)
    ||types.has(TRACK_CONTEXT_TYPES.MEDIUM_CORNER)
    ||types.has(TRACK_CONTEXT_TYPES.SLOW_CORNER)
  );
  for(const context of contexts){
    assert.ok(context.overtakingOpportunity>=0&&context.overtakingOpportunity<=1);
    assert.ok(context.slipstreamSuitability>=0&&context.slipstreamSuitability<=1);
    assert.ok(context.speedReference>=0.2&&context.speedReference<=1);
    assert.equal(context.widthM,11.25);
  }
});

test("RW8.3B historical fallback geometry never drives race physics",()=>{
  const model=buildTrackModel(argentinaState(),{
    gp:{track_id:"tr_0018",gp_name:"Argentine Grand Prix",year:1965},
  });

  assert.equal(model.year,1965);
  assert.equal(model.speedProfile.detailed,false);
  assert.equal(model.speedProfile.source,"neutral");
  assert.deepEqual(model.speedProfile.samples,[{distanceM:0,severity:0}]);
});

test("RW8.1 distance is continuous, wraps at the finish line and maps back to the same pose",()=>{
  const model=buildTrackModel(argentinaState(),{
    gp:{track_id:"tr_0018",year:1980},
  });

  assert.equal(trackProgressAtDistance(model,0),0);
  assert.equal(trackProgressAtDistance(model,model.lengthM),0);
  assert.equal(wrapTrackDistanceM(model,-25),model.lengthM-25);
  assert.equal(trackForwardGapM(model,model.lengthM-20,15),35);

  const start=trackPoseAtDistance(model,0);
  const finish=trackPoseAtDistance(model,model.lengthM);
  assert.ok(start&&finish);
  assert.ok(Math.abs(start.x-finish.x)<1e-9);
  assert.ok(Math.abs(start.y-finish.y)<1e-9);
  assert.equal(start.distanceAlongLapM,0);
});

test("RW8.1 sectors are derived once from track intelligence in physical metres",()=>{
  const model=buildTrackModel(argentinaState(),{
    gp:{track_id:"tr_0018",year:1980},
  });
  const first=model.sectors[0].endM;
  const second=model.sectors[1].endM;

  assert.equal(trackSectorAtDistance(model,first-0.1),1);
  assert.equal(trackSectorAtDistance(model,first+0.1),2);
  assert.equal(trackSectorAtDistance(model,second+0.1),3);
});

test("RW8.1 progress conversion respects a non-zero start/finish anchor",()=>{
  const model={lengthM:1000,startFinish:{progress:0.8}};
  assert.ok(Math.abs(trackDistanceAtProgress(model,0.1)-300)<1e-9);
  assert.ok(Math.abs(trackProgressAtDistance(model,300)-0.1)<1e-9);
  assert.ok(Math.abs(trackProgressAtDistance(model,-100)-0.7)<1e-9);
});

test("RW8.1 can build a physical model without display geometry",()=>{
  const gs={
    activeYear:1980,
    trackLayoutByYear:[{
      track_id:"test_track",
      year_from:1970,
      year_to:1990,
      lap_length_km:5,
      laps:60,
    }],
    coreTracks:[{track_id:"test_track",lap_length_km:5}],
  };
  const model=buildTrackModel(gs,{gp:{track_id:"test_track",year:1980}});

  assert.equal(model.lengthM,5000);
  assert.equal(model.laps,60);
  assert.equal(model.racingLine,null);
  assert.equal(model.geometry.source,"none");
  assert.equal(model.speedProfile.detailed,false);
  assert.equal(model.speedProfile.source,"neutral");
  assert.deepEqual(model.speedProfile.samples,[{distanceM:0,severity:0}]);
  assert.equal(trackPoseAtDistance(model,100),null);
  assert.equal(trackSectorAtDistance(model,100),1);
});

test("Albert Park 2000 gets a provisional 16-corner speed profile, not a flat 330 km/h lap",()=>{
  const gs={
    activeYear:2000,
    coreTracks:[{
      track_id:"tr_0019",track_name:"Albert Park Grand Prix Circuit",
      lap_length_km:5.303,overtaking_difficulty:60,tyre_wear:65,
    }],
  };
  const model=buildTrackModel(gs,{
    gp:{track_id:"tr_0019",year:2000,laps:58,gp_name:"Australian Grand Prix"},
  });
  assert.equal(model.lengthM,5303);
  assert.equal(model.laps,58);
  assert.equal(model.speedProfile.source,"historical_turn_reference_approximate");
  assert.equal(model.speedProfile.provisional,true);
  assert.equal(model.speedProfile.referenceCorners,16);
  assert.ok(model.speedProfile.samples.length>=100);
  const low=model.speedProfile.samples.reduce((a,b)=>a.severity<b.severity?a:b);
  const high=model.speedProfile.samples.reduce((a,b)=>a.severity>b.severity?a:b);
  assert.ok(low.severity<0.1);
  assert.ok(high.severity>0.75,"the historic physical model must contain substantial braking zones");
  const car={
    speedMs:0,
    performance:{car:{power:85,race:85,chassis:85},driver:{raceScore:85}},
  };
  const slow=raceTargetSpeedProfile({track:model},{
    ...car,distanceAlongLapM:high.distanceM,
  });
  const fast=raceTargetSpeedProfile({track:model},{
    ...car,distanceAlongLapM:low.distanceM,
  });
  assert.ok(slow.targetSpeedKmh<fast.targetSpeedKmh-70);
  assert.ok(fast.straightTargetKmh<=350);
  assert.ok(slow.targetSpeedKmh>=50);
});

test("Albert Park provisional physical profile is layout-era-scoped; verified Argentina remains independent",()=>{
  const track={track_id:"tr_0019",track_name:"Albert Park",lap_length_km:5.303};
  const gs={activeYear:2022,coreTracks:[track]};
  const future=buildTrackModel(gs,{gp:{track_id:"tr_0019",year:2022,laps:58}});
  assert.equal(future.speedProfile.source,"neutral");
  assert.equal(future.speedProfile.detailed,false);
  const historic=buildTrackModel(argentinaState(),{gp:{track_id:"tr_0018",year:1980}});
  assert.equal(historic.speedProfile.source,"verified_functional_geometry");
  assert.equal(historic.speedProfile.detailed,true);
});

test("Albert Park 2000 projects its layout into the canonical race state without replacing pace calibration",()=>{
  const gs={
    activeYear:2000,
    coreTracks:[{track_id:"tr_0019",track_name:"Albert Park Grand Prix Circuit",lap_length_km:5.303}],
  };
  const model=buildTrackModel(gs,{
    gp:{track_id:"tr_0019",year:2000,laps:58,gp_name:"Australian Grand Prix"},
  });
  assert.equal(model.lengthM,5303);
  assert.equal(model.laps,58);
  assert.equal(model.raceDirection,"clockwise");
  assert.equal(model.geometry.source,"f1track_functional");
  assert.equal(model.geometry.quality,"derived_provisional");
  assert.ok(model.racingLine.points.length>model.geometry.sourcePointCount);
  assert.equal(model.startFinish.progress,0);
  assert.ok(trackPoseAtDistance(model,0));
  assert.ok(trackPoseAtDistance(model,5303-1));
  assert.equal(model.pitLane.available,true);
  assert.ok(model.pitLane.entryM>model.sectors[1].endM);
  assert.ok(model.pitLane.exitM<model.sectors[0].endM);
  // No reinterpretation of stylized map curvature as 2000 physical speeds.
  assert.equal(model.speedProfile.source,"historical_turn_reference_approximate");
  assert.equal(model.speedProfile.provisional,true);
  assert.equal(model.speedProfile.referenceCorners,16);
});

test("2022 Albert Park does not reuse the old 16-turn racing line",()=>{
  const gs={activeYear:2022,coreTracks:[{track_id:"tr_0019",lap_length_km:5.278}]};
  const model=buildTrackModel(gs,{gp:{track_id:"tr_0019",year:2022,laps:58}});
  assert.equal(model.racingLine,null);
  assert.equal(model.geometry.source,"none");
  assert.equal(model.speedProfile.source,"neutral");
});

test("Interlagos canonical lap lengths follow historical periods without per-year layout copies",()=>{
  const core={track_id:"tr_0028",track_name:"Autodromo Jose Carlos Pace",lap_length_km:4.309};
  const cases=[
    [1973,7960,"tr_0028_long"],
    [1977,7960,"tr_0028_long"],
    [1979,7873,"tr_0028_long"],
    [1980,7873,"tr_0028_long"],
    [1990,4325,"tr_0028_short"],
    [1995,4325,"tr_0028_short"],
    [1996,4292,"tr_0028_short"],
    [1998,4292,"tr_0028_short"],
    [1999,4309,"tr_0028_short"],
    [2000,4309,"tr_0028_short"],
    [2024,4309,"tr_0028_short"],
  ];
  for(const [year,lengthM,layoutId] of cases){
    const model=buildTrackModel({activeYear:year,coreTracks:[core]},{
      gp:{track_id:"tr_0028",year,laps:71},
    });
    assert.equal(model.lengthM,lengthM,`${year} must not inherit the 4309m generic track length`);
    assert.equal(model.layoutId,layoutId,String(year));
    assert.equal(model.trackId,"tr_0028");
    assert.equal(model.raceDirection,"counterclockwise");
    assert.equal(model.geometry.source,"f1track_functional");
    assert.equal(model.geometry.quality,"derived_provisional");
    assert.ok(model.racingLine?.points?.length>200);
    assert.ok(trackPoseAtDistance(model,0));
    assert.ok(trackPoseAtDistance(model,lengthM-1));
    if(year===1979||year===1980){
      assert.equal(model.speedProfile.source,"historical_named_turn_reference_approximate");
      assert.equal(model.speedProfile.provisional,true);
      assert.equal(model.speedProfile.alignment,"unverified_normalized_distance_estimate");
      assert.ok(Math.max(...model.speedProfile.samples.map((sample)=>sample.severity))>0.8);
    }else{
      assert.equal(model.speedProfile.source,"neutral",
        "SVG-derived curvature is not a verified physical speed profile");
    }
    assert.equal(model.pitLane.available,false,
      "do not invent historic Interlagos pit lane geometry");
  }
});

test("Interlagos year-specific metadata and running-race meter snapshots remain authoritative",()=>{
  const core={track_id:"tr_0028",lap_length_km:4.309};
  const gs={
    activeYear:1980,
    coreTracks:[core],
    trackLayoutByYear:[{track_id:"tr_0028",year_from:1980,year_to:1980,lap_length_km:7.873,laps:40}],
  };
  const model=buildTrackModel(gs,{gp:{track_id:"tr_0028",year:1980}});
  assert.equal(model.lengthM,7873);
  assert.equal(model.laps,40);
  const saved=buildTrackModel(gs,{
    gp:{track_id:"tr_0028",year:1980},
    trackSnapshot:{track_id:"tr_0028",length_m:7860},
  });
  assert.equal(saved.lengthM,7860,"explicit running race metre lengths must survive reloads");
});

test("Buenos Aires F1 historic year maps resolve from same tr_0018 identity, not core default 5.8km",()=>{
  const gs={coreTracks:[{track_id:"tr_0018",lap_length_km:5.8,track_name:"Buenos Aires"}]};
  const cases=[
    [1953,3912,"tr_0018_no2","clockwise"],
    [1954,3912,"tr_0018_no2","counterclockwise"],
    [1955,3912,"tr_0018_no2","clockwise"],
    [1958,3912,"tr_0018_no2","clockwise"],
    [1960,3912,"tr_0018_no2","clockwise"],
    [1972,3345,"tr_0018_no9","clockwise"],
    [1973,3345,"tr_0018_no9","clockwise"],
    [1974,5968,"tr_0018_provisional","clockwise"],
    [1980,5968,"tr_0018_provisional","clockwise"],
    [1995,4259,"tr_0018_no6_senna","clockwise"],
    [1998,4259,"tr_0018_no6_senna","clockwise"],
  ];
  for(const [year,length,layout,direction] of cases){
    const model=buildTrackModel({...gs,activeYear:year},{gp:{track_id:"tr_0018",year,laps:52}});
    assert.equal(model.trackId,"tr_0018",String(year));
    assert.equal(model.layoutId,layout,String(year));
    assert.equal(model.raceDirection,direction,String(year));
    assert.equal(model.lengthM,length,`historical race length for ${year}`);
    assert.equal(model.resolution.exact,true,String(year));
    assert.ok(model.racingLine?.points?.length>250,String(year));
    assert.ok(trackPoseAtDistance(model,length-5),String(year));
    if(year<1974||year>=1995){
      assert.equal(model.geometry.quality,"derived_provisional",String(year));
      assert.equal(model.speedProfile.source,"neutral",
        "historical illustration must not change physical race speeds");
      assert.equal(model.pitLane.available,false,
        "unverified early historical pit lanes must not be invented");
    }else{
      assert.equal(model.geometry.quality,"historical_verified",String(year));
      assert.equal(model.speedProfile.source,"verified_functional_geometry",String(year));
      assert.equal(model.pitLane.available,true,String(year));
    }
  }
});

test("Buenos Aires outside known GP configurations never projects an anachronistic racing line",()=>{
  const gs={coreTracks:[{track_id:"tr_0018",lap_length_km:5.8}]};
  for(const year of [1950,1965,1970,1985,1990,1999,2024]){
    const model=buildTrackModel({...gs,activeYear:year},{gp:{track_id:"tr_0018",year}});
    assert.equal(model.geometry.source,"none",String(year));
    assert.equal(model.racingLine,null,String(year));
    assert.equal(model.speedProfile.source,"neutral",String(year));
  }
});

test("Imola canonical TrackModel uses correct lengths without yearly geometry copies",()=>{
  const core={track_id:"tr_0047",track_name:"Imola",lap_length_km:4.909};
  const cases=[
    [1953,5018,"tr_0047_original"],
    [1963,5018,"tr_0047_original"],
    [1972,5018,"tr_0047_original"],
    [1973,5122,"tr_0047_1973"],
    [1974,5060,"tr_0047_1974_1994"],
    [1978,5060,"tr_0047_1974_1994"],
    [1979,5040,"tr_0047_1974_1994"],
    [1980,5040,"tr_0047_1974_1994"],
    [1981,5040,"tr_0047_1974_1994"],
    [1994,5040,"tr_0047_1974_1994"],
    [1995,4959,"tr_0047_1995_2006"],
    [2000,4959,"tr_0047_1995_2006"],
    [2006,4959,"tr_0047_1995_2006"],
    [2008,4909,"tr_0047_modern"],
    [2020,4909,"tr_0047_modern"],
    [2024,4909,"tr_0047_modern"],
  ];
  for(const [year,metres,layout] of cases){
    const model=buildTrackModel({activeYear:year,coreTracks:[core]},{
      gp:{year,track_id:"tr_0047",laps:62}
    });
    assert.equal(model.trackId,"tr_0047");
    assert.equal(model.layoutId,layout,String(year));
    assert.equal(model.lengthM,metres,String(year));
    assert.equal(model.laps,62);
    assert.equal(model.raceDirection,"counterclockwise");
    assert.equal(model.geometry.source,"f1track_functional");
    assert.equal(model.resolution.exact,true);
    assert.ok(model.racingLine?.points?.length>=24,
      "a simplified racing line must still provide continuous renderable poses");
    assert.ok(trackPoseAtDistance(model,metres-1));
    assert.equal(model.pitLane.available,false,"No imagined pit geometry");
    assert.equal(model.speedProfile.source,"neutral","No inferred real physics from sketches");
  }
});

test("Imola 2007 construction era does not inherit another period's racing line",()=>{
  const model=buildTrackModel({
    activeYear:2007,coreTracks:[{track_id:"tr_0047",lap_length_km:4.909}]
  },{gp:{track_id:"tr_0047",year:2007}});
  assert.equal(model.racingLine,null);
  assert.equal(model.geometry.source,"none");
  assert.equal(model.speedProfile.source,"neutral");
});

test("Silverstone canonical TrackModel uses period lap distances without annual geometry copies",()=>{
  const core={track_id:"tr_0079",track_name:"Silverstone Circuit",lap_length_km:5.141};
  const examples=[
    [1950,4649,"tr_0079_classic"],
    [1951,4649,"tr_0079_classic"],
    [1952,4711,"tr_0079_classic"],
    [1969,4711,"tr_0079_classic"],
    [1973,4711,"tr_0079_classic"],
    [1975,4719,"tr_0079_woodcote"],
    [1979,4719,"tr_0079_woodcote"],
    [1981,4719,"tr_0079_woodcote"],
    [1985,4719,"tr_0079_woodcote"],
    [1987,4778,"tr_0079_bridge"],
    [1990,4778,"tr_0079_bridge"],
    [1991,5226,"tr_0079_1991_1993"],
    [1993,5226,"tr_0079_1991_1993"],
    [1994,5057,"tr_0079_1994_2009"],
    [1995,5057,"tr_0079_1994_2009"],
    [1996,5072,"tr_0079_1994_2009"],
    [1997,5140,"tr_0079_1994_2009"],
    [1999,5140,"tr_0079_1994_2009"],
    [2000,5141,"tr_0079_1994_2009"],
    [2009,5141,"tr_0079_1994_2009"],
    [2010,5901,"tr_0079_arena"],
    [2011,5891,"tr_0079_arena"],
    [2024,5891,"tr_0079_arena"],
  ];
  for(const [year,metres,layout] of examples){
    const gs={activeYear:year,coreTracks:[core]};
    const model=buildTrackModel(gs,{gp:{track_id:"tr_0079",year,laps:52}});
    assert.equal(model.trackId,"tr_0079");
    assert.equal(model.layoutId,layout,"layout "+year);
    assert.equal(model.lengthM,metres,"length "+year);
    assert.equal(model.laps,52);
    assert.equal(model.raceDirection,"clockwise");
    assert.equal(model.geometry.source,"f1track_functional");
    assert.equal(model.geometry.quality,"derived_provisional");
    assert.equal(model.resolution.exact,true);
    assert.ok(model.racingLine?.points?.length>=24,"renderable spline "+year);
    assert.ok(trackPoseAtDistance(model,metres-1),"continuous on final corner "+year);
    assert.equal(model.speedProfile.source,"neutral","no cartographic corner physics "+year);
    assert.equal(model.pitLane.available,false,"no invented pit geometry "+year);
  }
});


test("Kyalami Race TrackModel uses original and rebuilt period lengths, no cartographic physics",()=>{
  const core={track_id:"tr_0067",track_name:"Kyalami",lap_length_km:4.104};
  for(const [year,metres,layout,direction] of [
    [1967,4094,"tr_0067_original","clockwise"],
    [1968,4104,"tr_0067_original","clockwise"],
    [1980,4104,"tr_0067_original","clockwise"],
    [1985,4104,"tr_0067_original","clockwise"],
    [1992,4261,"tr_0067_rebuilt","counterclockwise"],
    [1993,4261,"tr_0067_rebuilt","counterclockwise"]
  ]){
    const model=buildTrackModel({activeYear:year,coreTracks:[core]},
      {gp:{track_id:"tr_0067",year,laps:year===1980?78:72}});
    assert.equal(model.trackId,"tr_0067");
    assert.equal(model.layoutId,layout,String(year));
    assert.equal(model.lengthM,metres,String(year));
    assert.equal(model.laps,year===1980?78:72);
    assert.equal(model.raceDirection,direction);
    assert.equal(model.geometry.source,"f1track_functional");
    assert.equal(model.geometry.quality,"derived_provisional");
    assert.equal(model.resolution.exact,true);
    assert.ok(model.racingLine?.points?.length>=24);
    assert.ok(trackPoseAtDistance(model,metres-1));
    if(year<=1985){
      assert.equal(model.speedProfile.source,"historical_named_turn_reference_approximate");
      assert.equal(model.speedProfile.provisional,true);
      assert.equal(model.speedProfile.referenceTurns,9);
    }else assert.equal(model.speedProfile.source,"neutral");
    assert.equal(model.pitLane.available,false);
  }
  for(const year of [1966,1989,1994,2000]){
    const model=buildTrackModel({activeYear:year,coreTracks:[core]},
      {gp:{track_id:"tr_0067",year}});
    assert.equal(model.racingLine,null,"no wrong-era geometry "+year);
    assert.equal(model.geometry.source,"none");
  }
});

test("Long Beach Race TrackModel uses sourced F1 distances, no visual-controlled pace",()=>{
  const core={track_id:"tr_0088",track_name:"Long Beach",lap_length_km:3.275};
  for(const [year,metres,layout] of [
    [1976,3251,"tr_0088_1976_1981"],[1978,3251,"tr_0088_1976_1981"],
    [1980,3251,"tr_0088_1976_1981"],[1981,3251,"tr_0088_1976_1981"],
    [1982,3428,"tr_0088_1982"],[1983,3275,"tr_0088_1983"]]){
    const m=buildTrackModel({activeYear:year,coreTracks:[core]},
      {gp:{track_id:"tr_0088",year,laps:80}});
    assert.equal(m.trackId,"tr_0088");assert.equal(m.layoutId,layout,String(year));
    assert.equal(m.lengthM,metres,String(year));assert.equal(m.laps,80);
    assert.equal(m.raceDirection,"clockwise");assert.equal(m.resolution.exact,true);
    assert.equal(m.geometry.source,"f1track_functional");
    assert.equal(m.geometry.quality,"derived_provisional");
    assert.ok(m.racingLine?.points?.length>=24);
    assert.ok(trackPoseAtDistance(m,metres-1),"continuous model "+year);
    assert.equal(m.speedProfile.source,"neutral");
    assert.equal(m.pitLane.available,false);
  }
  for(const year of [1975,1984,1999,2001]){
    const m=buildTrackModel({activeYear:year,coreTracks:[core]},
      {gp:{track_id:"tr_0088",year}});
    assert.equal(m.racingLine,null,"no stale F1 map "+year);
    assert.equal(m.geometry.source,"none");
  }
});

test("Zolder F1 TrackModel shares 1973/1980 periods without SVG corner-speed physics",()=>{
  const core={track_id:"tr_0026",track_name:"Zolder",lap_length_km:4.262};
  for(const [year,metres,id,laps] of [
    [1973,4220,"tr_0026_1972_1974",70],
    [1975,4262,"tr_0026_1975_1985",70],
    [1980,4262,"tr_0026_1975_1985",72],
    [1982,4262,"tr_0026_1975_1985",70],
    [1984,4262,"tr_0026_1975_1985",70]
  ]){
    const m=buildTrackModel({activeYear:year,coreTracks:[core]},
      {gp:{track_id:"tr_0026",year,laps}});
    assert.equal(m.trackId,"tr_0026");
    assert.equal(m.layoutId,id,String(year));
    assert.equal(m.lengthM,metres,String(year));
    assert.equal(m.laps,laps,String(year));
    assert.equal(m.raceDirection,"clockwise");
    assert.equal(m.resolution.exact,true);
    assert.equal(m.geometry.source,"f1track_functional");
    assert.equal(m.geometry.quality,"derived_provisional");
    assert.ok(m.racingLine?.points?.length>=24);
    assert.ok(trackPoseAtDistance(m,metres-1));
    assert.equal(m.speedProfile.source,"neutral");
    assert.equal(m.pitLane.available,false);
  }
  const old=buildTrackModel({activeYear:1990,coreTracks:[core]},
    {gp:{track_id:"tr_0026",year:1990}});
  assert.equal(old.geometry.source,"none");
  assert.equal(old.racingLine,null);
});

test("1980 Argentina canonical lap limit is 53, while a saved race retains its own distance",()=>{
  const gs=argentinaState();
  gs.trackLayoutByYear[0].laps=51;
  const gp={track_id:"tr_0018",gp_name:"Argentine Grand Prix",year:1980,race_date:"1980-01-13"};
  const next=buildTrackModel(gs,{gp});
  assert.equal(next.lengthM,5968);
  assert.equal(next.laps,53);
  const saved=buildTrackModel(gs,{gp,trackSnapshot:{lengthM:5968,laps:51}});
  assert.equal(saved.laps,51,"in-progress saved race must not change race distance");
});


test("Monaco Race TrackModel shares physical lap facts and neutral speed for illustrative SVG",()=>{
  const core={track_id:"tr_0056",track_name:"Circuit de Monaco",lap_length_km:3.337};
  for(const [year,metres,id,laps] of [
    [1950,3180,"tr_0056_1950",100],
    [1965,3145,"tr_0056_1955_1972",100],
    [1974,3278,"tr_0056_1973_1975",78],
    [1980,3312,"tr_0056_1976_1985",76],
    [1986,3328,"tr_0056_1986_1996",78],
    [2004,3340,"tr_0056_2003_modern",78],
    [2026,3337,"tr_0056_2003_modern",78]
  ]){
    const m=buildTrackModel({activeYear:year,coreTracks:[core]},
      {gp:{track_id:"tr_0056",year,laps}});
    assert.equal(m.trackId,"tr_0056");
    assert.equal(m.layoutId,id,String(year));
    assert.equal(m.lengthM,metres,String(year));
    assert.equal(m.laps,laps,String(year));
    assert.equal(m.raceDirection,"clockwise");
    assert.equal(m.resolution.exact,true);
    assert.equal(m.geometry.source,"f1track_functional");
    assert.equal(m.geometry.quality,"derived_provisional");
    assert.ok(m.racingLine?.points?.length>=24);
    assert.ok(trackPoseAtDistance(m,metres-1));
    assert.equal(m.speedProfile.source,"neutral");
    assert.equal(m.pitLane.available,false);
  }
  for(const year of [1954,1997,2002]){
    const m=buildTrackModel({activeYear:year,coreTracks:[core]},
      {gp:{track_id:"tr_0056",year}});
    assert.equal(m.geometry.source,"none","missing era geometry "+year);
    assert.equal(m.racingLine,null);
  }
});

test("Paul Ricard F1 TrackModel uses actual 1980 distance and neutral historical visual physics",()=>{
  const core={track_id:"tr_0035",track_name:"Circuit Paul Ricard",lap_length_km:5.842};
  for(const [year,lengthM,layoutId,laps] of [
    [1971,5810,"tr_0035_original",55],
    [1980,5810,"tr_0035_original",54],
    [1985,5810,"tr_0035_original",53],
    [1986,3813,"tr_0035_short",80],
    [1990,3813,"tr_0035_short",80],
    [2018,5842,"tr_0035_modern",53],
    [2022,5842,"tr_0035_modern",53]
  ]){
    const model=buildTrackModel({activeYear:year,coreTracks:[core]},
      {gp:{track_id:"tr_0035",year,laps}});
    assert.equal(model.trackId,"tr_0035",String(year));
    assert.equal(model.layoutId,layoutId,String(year));
    assert.equal(model.lengthM,lengthM,String(year));
    assert.equal(model.laps,laps);
    assert.equal(model.raceDirection,"clockwise");
    assert.equal(model.resolution.exact,true);
    assert.equal(model.geometry.source,"f1track_functional");
    assert.equal(model.geometry.quality,"derived_provisional");
    assert.ok(model.racingLine?.points?.length>=24);
    assert.ok(trackPoseAtDistance(model,lengthM-1),"physical metres wrap "+year);
    assert.equal(model.speedProfile.source,"neutral");
    assert.equal(model.pitLane.available,false);
  }
  for(const year of [1969,1991,2000,2017,2023]){
    const m=buildTrackModel({activeYear:year,coreTracks:[core]},
      {gp:{track_id:"tr_0035",year}});
    assert.equal(m.geometry.source,"none","not F1 track display "+year);
    assert.equal(m.racingLine,null,"no wrong era line "+year);
  }
});

test("Brands Hatch 1980 Race TrackModel has canonical 4207 metres and neutral visual physics",()=>{
  const core={track_id:"tr_0081",track_name:"Brands Hatch",lap_length_km:4.207};
  for(const [year,metres,layout,laps] of [
    [1964,4265,"tr_0081_original",80],
    [1974,4265,"tr_0081_original",75],
    [1976,4207,"tr_0081_1976_1987",76],
    [1980,4207,"tr_0081_1976_1987",76],
    [1986,4207,"tr_0081_1976_1987",75],
    [1987,4207,"tr_0081_1976_1987",76]
  ]){
    const model=buildTrackModel({activeYear:year,coreTracks:[core]},
      {gp:{track_id:"tr_0081",year,laps}});
    assert.equal(model.trackId,"tr_0081");
    assert.equal(model.layoutId,layout,String(year));
    assert.equal(model.lengthM,metres,String(year));
    assert.equal(model.laps,laps);
    assert.equal(model.raceDirection,"clockwise");
    assert.equal(model.resolution.exact,true);
    assert.equal(model.geometry.source,"f1track_functional");
    assert.equal(model.geometry.quality,"derived_provisional");
    assert.ok(model.racingLine?.points?.length>=24);
    assert.ok(trackPoseAtDistance(model,metres-1));
    assert.equal(model.speedProfile.source,"neutral");
    assert.equal(model.pitLane.available,false);
  }
  for(const year of [1953,1959,1988,1995,2026]){
    const model=buildTrackModel({activeYear:year,coreTracks:[core]},
      {gp:{track_id:"tr_0081",year}});
    assert.equal(model.geometry.source,"none","wrong-era artwork "+year);
    assert.equal(model.racingLine,null);
  }
});

test("Kyalami 1980 historic named-corner provisional model slows for turns, not a flat lap",()=>{
  const gs={activeYear:1980,coreTracks:[{track_id:"tr_0067",lap_length_km:4.104}]};
  const make=(year)=>buildTrackModel({...gs,activeYear:year},
    {gp:{track_id:"tr_0067",year,laps:78}});
  const a=make(1980),p=a.speedProfile;
  assert.equal(a.layoutId,"tr_0067_original");
  assert.equal(p.source,"historical_named_turn_reference_approximate");
  assert.equal(p.provisional,true);
  assert.equal(p.referenceTurns,9);
  assert.equal(p.brakingModel,"distance_sensitive");
  assert.equal(p.alignment,"unverified_normalized_distance_estimate");
  assert.ok(p.samples.length>=100);
  const low=p.samples.reduce((a,b)=>a.severity<b.severity?a:b);
  const high=p.samples.reduce((a,b)=>a.severity>b.severity?a:b);
  assert.ok(low.severity<0.12);
  assert.ok(high.severity>0.78);
  const car={speedMs:70,performance:{
    car:{power:85,race:85,chassis:85},driver:{raceScore:85}
  }};
  const fast=raceTargetSpeedProfile({track:a},{...car,distanceAlongLapM:low.distanceM});
  const slow=raceTargetSpeedProfile({track:a},{...car,distanceAlongLapM:high.distanceM});
  assert.ok(fast.targetSpeedKmh>slow.targetSpeedKmh+75,"genuine local braking");
  assert.ok(slow.targetSpeedKmh>=50);
  assert.ok(fast.straightTargetKmh<=330);
  assert.deepEqual(make(1980).speedProfile,p,"deterministic profile");
  assert.equal(make(1993).speedProfile.source,"neutral",
    "never reuse old Kyalami profile in rebuilt circuit");
});
