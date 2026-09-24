import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TRACK_LAYOUT_ASSETS } from "../src/data/trackLayoutAssets.js";
import { TRACK_LAYOUT_GEOMETRY } from "../src/data/trackLayoutGeometry.js";
import { pointAtTrackProgress, resolveTrackLayout, trackGeometryViewBox, visualTrackProgress } from "../src/domain/trackLayout.js";

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
