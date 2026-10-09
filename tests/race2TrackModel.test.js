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
    gp:{track_id:"tr_0018",gp_name:"Argentine Grand Prix",year:1955},
  });

  assert.equal(model.year,1955);
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
  assert.ok(high.severity>0.9);
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
  assert.ok(fast.straightTargetKmh<=320);
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
