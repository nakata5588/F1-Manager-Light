import test from "node:test";
import assert from "node:assert/strict";

import {
  TRACK_MODEL_SCHEMA_VERSION,
  buildTrackModel,
  trackDistanceAtProgress,
  trackForwardGapM,
  trackPoseAtDistance,
  trackProgressAtDistance,
  trackSectorAtDistance,
  wrapTrackDistanceM,
} from "../src/race2/track/TrackModel.js";

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
  assert.equal(model.sectors.length,3);
  assert.equal(model.sectors[2].endM,5968);
  assert.equal(model.pitLane.available,true);
  assert.ok(model.pitLane.entryM>model.sectors[1].endM);
  assert.ok(model.pitLane.exitM<model.sectors[0].endM);
  assert.equal(model.traits.drsZones,0);
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
  assert.equal(trackPoseAtDistance(model,100),null);
  assert.equal(trackSectorAtDistance(model,100),1);
});
