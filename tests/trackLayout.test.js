import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TRACK_LAYOUT_ASSETS } from "../src/data/trackLayoutAssets.js";
import { TRACK_LAYOUT_GEOMETRY } from "../src/data/trackLayoutGeometry.js";
import { focusTrackViewBox, orientTrackGeometry, pointAtTrackProgress, raceEventTrackProgress, resolveTrackLayout, trackGeometryViewBox, trackIntelligenceProfile, trackMarkerSegment, trackSectorPolylinePoints, visualTrackProgress } from "../src/domain/trackLayout.js";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"..");

test("RW6 layout resolver prefers an exact historical range",()=>{
  const layouts=[
    {layout_id:"old",track_id:"t",year_from:1970,year_to:1979,reference_year:1979},
    {layout_id:"exact",track_id:"t",year_from:1980,year_to:1982,reference_year:1980},
    {layout_id:"future",track_id:"t",year_from:1985,year_to:1987,reference_year:1985},
  ];
  assert.equal(resolveTrackLayout({trackId:"t",year:1981,layouts}).layout.layout_id,"exact");
  assert.equal(resolveTrackLayout({trackId:"t",year:1981,layouts}).resolution,"exact");
});

test("RW6 fallback backtracks to the latest past layout before using a future one",()=>{
  const layouts=[
    {layout_id:"1979",track_id:"t",year_from:1977,year_to:1979,reference_year:1979},
    {layout_id:"1986",track_id:"t",year_from:1986,year_to:1988,reference_year:1986},
  ];
  const resolved=resolveTrackLayout({trackId:"t",year:1984,layouts});
  assert.equal(resolved.layout.layout_id,"1979");
  assert.equal(resolved.resolution,"past_fallback");
});

test("RW6 fallback can use the earliest future layout when no past version exists",()=>{
  const layouts=[
    {layout_id:"2002",track_id:"t",year_from:2002,year_to:2002,reference_year:2002},
    {layout_id:"2010",track_id:"t",year_from:2010,year_to:2010,reference_year:2010},
  ];
  const resolved=resolveTrackLayout({trackId:"t",year:1980,layouts});
  assert.equal(resolved.layout.layout_id,"2002");
  assert.equal(resolved.resolution,"future_fallback");
});

test("RW6 undated artwork remains available as a provisional generic fallback",()=>{
  const layouts=[{layout_id:"generic",track_id:"t",year_from:null,year_to:null,reference_year:null}];
  assert.equal(resolveTrackLayout({trackId:"t",year:1980,layouts}).resolution,"generic_fallback");
});

test("RW6 supplied 1980 calendar has a 2D asset and derived geometry for every race track",()=>{
  const calendar=JSON.parse(fs.readFileSync(path.join(root,"public/data/calendar.json"),"utf8"));
  const ids=[...new Set(calendar.filter((row)=>Number(row.year)===1980).map((row)=>String(row?.track_id?.result??row?.track_id??"")))];
  assert.equal(ids.length,14);
  for(const trackId of ids){
    const resolved=resolveTrackLayout({trackId,year:1980});
    assert.ok(resolved.layout,`${trackId} must resolve a layout`);
    assert.ok(resolved.geometry,`${trackId} must expose display geometry`);
    assert.ok(resolved.geometry.points.length>=48,`${trackId} geometry must be dense enough for animation`);
  }
});

test("RW6 known later Hockenheim artwork is explicitly a future fallback in 1980",()=>{
  const resolved=resolveTrackLayout({trackId:"tr_0041",year:1980});
  assert.equal(resolved.resolution,"future_fallback");
  assert.equal(resolved.source_year,2002);
  assert.equal(resolved.layout.historical_status,"provisional");
});

test("RW6 geometry interpolation wraps around the circuit",()=>{
  const geometry={points:[[0,0],[1000,0],[1000,1000],[0,1000]]};
  assert.deepEqual(pointAtTrackProgress(geometry,0),{x:0,y:0});
  assert.deepEqual(pointAtTrackProgress(geometry,0.25),{x:1000,y:0});
  assert.deepEqual(pointAtTrackProgress(geometry,1),{x:0,y:0});
});

test("RW6 visual progress places cars behind the leader according to visible gap only",()=>{
  const leader=visualTrackProgress({gap_to_leader_ms:0},{currentLap:4,currentSector:2,referenceLapMs:90000,index:0});
  const follower=visualTrackProgress({gap_to_leader_ms:9000},{currentLap:4,currentSector:2,referenceLapMs:90000,index:1});
  assert.ok(leader>follower);
  assert.ok(Math.abs((leader-follower)-0.10035)<0.002);
});

for(const layout of TRACK_LAYOUT_ASSETS){
  test(`RW6 manifest integrity ${layout.layout_id}`,()=>{
    assert.match(layout.track_id,/^tr_\d{4}$/);
    const geometry=TRACK_LAYOUT_GEOMETRY[layout.layout_id];
    assert.ok(geometry);
    for(const point of geometry.points){
      assert.equal(point.length,2);
      assert.ok(point[0]>=0&&point[0]<=1000);
      assert.ok(point[1]>=0&&point[1]<=1000);
    }
  });
}


test("RW6.2.1 auto-fit viewBox crops unused geometry space while keeping marker padding",()=>{
  const viewBox=trackGeometryViewBox({points:[[100,200],[900,200],[900,800],[100,800]]});
  assert.deepEqual(viewBox,[56,156,888,688]);
  const [x,y,width,height]=viewBox;
  assert.ok(x<100&&y<200);
  assert.ok(x+width>900&&y+height>800);
  assert.ok(width<1000&&height<1000,"auto-fit should be tighter than the legacy 1000x1000 viewBox");
});

test("RW6.2.1 auto-fit keeps a safe fallback for missing geometry",()=>{
  assert.deepEqual(trackGeometryViewBox(null),[0,0,1000,1000]);
});


test("RW6.3.1 rotates tall display geometry to use a landscape race view",()=>{
  const geometry={points:[[100,100],[200,100],[200,900],[100,900]]};
  const oriented=orientTrackGeometry(geometry);
  const originalBox=trackGeometryViewBox(geometry,{paddingRatio:0,minPadding:0});
  const orientedBox=trackGeometryViewBox(oriented,{paddingRatio:0,minPadding:0});
  assert.equal(oriented.display_rotation_deg,90);
  assert.ok(originalBox[3]>originalBox[2]);
  assert.ok(orientedBox[2]>orientedBox[3]);
});

test("RW6.3.1 keeps already-wide circuit geometry in its original orientation",()=>{
  const geometry={points:[[100,100],[900,100],[900,400],[100,400]]};
  const oriented=orientTrackGeometry(geometry);
  assert.equal(oriented.display_rotation_deg,0);
  assert.deepEqual(oriented.points,geometry.points);
});

test("RW6.3.1 focused viewBox zooms around the selected car and stays inside track bounds",()=>{
  const full=[0,0,1000,600];
  const focused=focusTrackViewBox(full,{x:950,y:580},{zoom:2});
  assert.ok(focused[2]<full[2]);
  assert.ok(focused[3]<full[3]);
  assert.ok(focused[0]>=full[0]);
  assert.ok(focused[1]>=full[1]);
  assert.ok(focused[0]+focused[2]<=full[0]+full[2]);
  assert.ok(focused[1]+focused[3]<=full[1]+full[3]);
});

test("RW6.3.1 focused viewBox falls back to full view without a valid selected point",()=>{
  assert.deepEqual(focusTrackViewBox([10,20,800,500],null),[10,20,800,500]);
});


test("RW6.4 track intelligence defaults are explicit provisional thirds",()=>{
  const profile=trackIntelligenceProfile({});
  assert.equal(profile.start_finish_progress,0);
  assert.deepEqual(profile.sector_boundaries,[1/3,2/3]);
  assert.equal(profile.pit_entry_progress,null);
  assert.equal(profile.pit_exit_progress,null);
  assert.equal(profile.status,"derived_provisional");
});

test("RW6.4 track intelligence accepts verified per-layout overrides",()=>{
  const profile=trackIntelligenceProfile({
    start_finish_progress:.08,
    sector_boundaries:[.31,.69],
    pit_entry_progress:.91,
    pit_exit_progress:.12,
    track_intelligence_status:"verified",
  });
  assert.ok(Math.abs(profile.start_finish_progress-.08)<1e-9);
  assert.ok(Math.abs(profile.sector_boundaries[0]-.31)<1e-9);
  assert.ok(Math.abs(profile.sector_boundaries[1]-.69)<1e-9);
  assert.ok(Math.abs(profile.pit_entry_progress-.91)<1e-9);
  assert.ok(Math.abs(profile.pit_exit_progress-.12)<1e-9);
  assert.equal(profile.status,"verified");
});

test("RW6.4 incident placement prefers exact track progress and otherwise uses reported sector",()=>{
  assert.equal(raceEventTrackProgress({track_progress:.73,sector:1}),.73);
  assert.ok(Math.abs(raceEventTrackProgress({sector:2})-.5)<1e-9);
  const custom=trackIntelligenceProfile({start_finish_progress:.1,sector_boundaries:[.4,.75]});
  assert.ok(Math.abs(raceEventTrackProgress({sector:1,sector_progress:.5},custom)-.25)<1e-9);
  assert.ok(Math.abs(raceEventTrackProgress({sector:2,sector_progress:.5},custom)-.575)<1e-9);
});

test("RW6.4 marker segment crosses the centreline at the requested progress",()=>{
  const geometry={points:[[0,0],[100,0],[100,100],[0,100]]};
  const segment=trackMarkerSegment(geometry,.25,{length:20});
  assert.deepEqual(segment.center,{x:100,y:0});
  assert.ok(Math.abs((segment.x1+segment.x2)/2-segment.center.x)<1e-9);
  assert.ok(Math.abs((segment.y1+segment.y2)/2-segment.center.y)<1e-9);
});

test("RW6.4 sector overlay samples each profile-aware sector independently",()=>{
  const geometry={points:[[0,0],[100,0],[100,100],[0,100]]};
  const profile=trackIntelligenceProfile({start_finish_progress:0,sector_boundaries:[.25,.75]});
  const first=trackSectorPolylinePoints(geometry,1,profile,{samples:8});
  const second=trackSectorPolylinePoints(geometry,2,profile,{samples:8});
  const third=trackSectorPolylinePoints(geometry,3,profile,{samples:8});
  assert.equal(first.length,9);
  assert.equal(second.length,9);
  assert.equal(third.length,9);
  assert.deepEqual(first[0],[0,0]);
  assert.deepEqual(first.at(-1),[100,0]);
  assert.deepEqual(second[0],[100,0]);
  assert.deepEqual(second.at(-1),[0,100]);
});


test("RW6.6B arc-length interpolation keeps visual speed stable across uneven points",()=>{
  const geometry={points:[[0,0],[10,0],[110,0],[110,110]]};
  const p25=pointAtTrackProgress(geometry,.25);
  const p50=pointAtTrackProgress(geometry,.5);
  // Total closed-loop length is 110 + 110 + sqrt(110^2+110^2).
  // Both samples must be based on travelled distance, not point index.
  assert.ok(p25.x>80&&p25.x<100);
  assert.ok(Math.abs(p25.y)<1e-9);
  assert.ok(p50.x>109);
  assert.ok(p50.y>70&&p50.y<100);
});
