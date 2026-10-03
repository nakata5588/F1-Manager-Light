import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TRACK_LAYOUT_ASSETS } from "../src/data/trackLayoutAssets.js";
import { TRACK_LAYOUT_GEOMETRY } from "../src/data/trackLayoutGeometry.js";
import { calibrateTrackGeometry, focusTrackViewBox, orientTrackGeometry, pointAtTrackProgress, raceEventTrackProgress, resolveTrackLayout, trackEnvironmentProfile, trackGeometryViewBox, trackIntelligenceProfile, trackMarkerSegment, trackMiniMapGeometry, trackPresentationGeometry, trackPresentationSplineEligible, trackRuntimeGeometry, trackSectorPolylinePoints, visualTrackProgress } from "../src/domain/trackLayout.js";
import { buildPitLanePresentationGeometry, deterministicTrackScatter, offsetTrackPolyline, sampleOpenPolylinePoint, simplifyClosedPolyline, simplifyTrackPresentationGeometry, trackHeadingDegrees, trackRibbonPolygon } from "../src/domain/trackSceneGeometry.js";
import { clampTrackViewBox, dampTrackViewBox, followTrackViewBox, panTrackViewBox, trackCameraZoomFactor, trackFollowZoomFromWheel, trackLodForZoom, trackMarkerScaleForViewBox, zoomTrackViewBox } from "../src/domain/trackCamera.js";

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

test("RW19 canonical Race View shares TrackModel geometry selection and only smooths verified sources",()=>{
  const argentina=resolveTrackLayout({trackId:"tr_0018",year:1980});
  const argentinaRuntime=trackRuntimeGeometry(argentina);
  assert.equal(argentinaRuntime.source,"f1track_functional");
  assert.equal(argentinaRuntime.geometry.quality,"historical_verified");
  assert.equal(trackPresentationSplineEligible(argentina,argentinaRuntime),true);

  const longBeach=resolveTrackLayout({trackId:"tr_0088",year:1980});
  const longBeachRuntime=trackRuntimeGeometry(longBeach);
  assert.equal(longBeachRuntime.source,"track_layout_geometry");
  assert.equal(longBeachRuntime.geometry.quality,"derived_provisional");
  assert.equal(trackPresentationSplineEligible(longBeach,longBeachRuntime),false);
});

test("Track 3.0 1980 layout provenance baseline is explicit for every championship venue",()=>{
  const expected=new Map([
    ["tr_0018",["exact",1980,"historical_verified"]],
    ["tr_0028",["generic_fallback",null,"derived_provisional"]],
    ["tr_0067",["future_fallback",2016,"derived_provisional"]],
    ["tr_0088",["future_fallback",2000,"derived_provisional"]],
    ["tr_0026",["generic_fallback",null,"derived_provisional"]],
    ["tr_0056",["generic_fallback",null,"derived_provisional"]],
    ["tr_0035",["generic_fallback",null,"derived_provisional"]],
    ["tr_0081",["generic_fallback",null,"derived_provisional"]],
    ["tr_0041",["future_fallback",2002,"derived_provisional"]],
    ["tr_0022",["generic_fallback",null,"derived_provisional"]],
    ["tr_0058",["generic_fallback",null,"derived_provisional"]],
    ["tr_0047",["generic_fallback",null,"derived_provisional"]],
    ["tr_0030",["generic_fallback",null,"derived_provisional"]],
    ["tr_0090",["generic_fallback",null,"derived_provisional"]],
  ]);
  assert.equal(expected.size,14);
  for(const [trackId,[resolution,sourceYear,quality]] of expected){
    const resolved=resolveTrackLayout({trackId,year:1980});
    assert.equal(resolved.resolution,resolution,trackId);
    assert.equal(resolved.source_year,sourceYear,trackId);
    assert.equal(resolved.geometry?.quality,quality,trackId);
  }
});

test("Track 3.0 flags the three known anachronistic 1980 future-layout fallbacks",()=>{
  const futureFallbacks=TRACK_LAYOUT_ASSETS
    .map((layout)=>resolveTrackLayout({trackId:layout.track_id,year:1980}))
    .filter((resolved)=>resolved.resolution==="future_fallback")
    .map((resolved)=>[resolved.layout.track_id,resolved.source_year]);
  assert.deepEqual(futureFallbacks,[["tr_0067",2016],["tr_0088",2000],["tr_0041",2002]]);
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
    const [vx,vy,vw,vh]=Array.isArray(geometry.view_box)&&geometry.view_box.length===4?geometry.view_box:[0,0,1000,1000];
    for(const point of geometry.points){
      assert.equal(point.length,2);
      assert.ok(point[0]>=vx&&point[0]<=vx+vw);
      assert.ok(point[1]>=vy&&point[1]<=vy+vh);
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


test("Track 2.0 Argentina resolves one canonical F1Track package",()=>{
  const resolved=resolveTrackLayout({trackId:"tr_0018",year:1980});
  assert.equal(resolved.resolution,"exact");
  assert.equal(resolved.track_package?.format,"f1track/1.0");
  assert.equal(resolved.track_package?.package_id,"tr_0018_1974_1981");
  assert.equal(resolved.environment.asset,null);
  assert.equal(resolved.environment.runtime_mode,"f1track_procedural");
  assert.deepEqual(resolved.environment.view_box,[0,0,1649,954]);
  assert.equal(resolved.environment.native_width,1649);
  assert.equal(resolved.environment.native_height,954);
  assert.ok(resolved.track_package.functional.points.length>=250);
  assert.ok(resolved.track_package.minimap.points.length>=90);
  assert.equal(resolved.environment.procedural_environment.theme,"parkland");
  assert.equal(resolved.environment.procedural_environment.render_landmarks,false);
  assert.equal(resolved.environment.procedural_environment.tree_count,72);
  assert.equal(resolved.environment.procedural_environment.pit_complex,true);
});

test("Track 1.0B calibration transforms presentation geometry without mutating functional geometry",()=>{
  const functional={points:[[10,20],[30,40]],pit_lane_points:[[20,20]],quality:"test"};
  const transform={x:5,y:-5,scale_x:2,scale_y:3,rotation_deg:0,origin_x:0,origin_y:0};
  const calibrated=calibrateTrackGeometry(functional,transform);
  assert.deepEqual(calibrated.points,[[25,55],[65,115]]);
  assert.deepEqual(calibrated.pit_lane_points,[[45,55]]);
  assert.deepEqual(functional.points,[[10,20],[30,40]],"functional geometry must remain untouched");
});

test("Track 2.0 Argentina keeps functional pit geometry independent and builds presentation merges",()=>{
  const resolved=resolveTrackLayout({trackId:"tr_0018",year:1980});
  const profile=trackIntelligenceProfile(resolved.layout);
  const style=resolved.environment.race_view_style;
  const functionalPit=resolved.geometry.pit_lane_points;
  const snapshot=JSON.parse(JSON.stringify(functionalPit));
  const visual=buildPitLanePresentationGeometry(resolved.geometry,{
    entryProgress:profile.pit_entry_progress,
    exitProgress:profile.pit_exit_progress,
    separation:style.pit_visual_separation,
    mergeFraction:style.pit_merge_fraction,
    samples:style.pit_visual_samples,
    mergeSamples:style.pit_merge_samples,
  });
  const entry=pointAtTrackProgress(resolved.geometry,profile.pit_entry_progress);
  const exit=pointAtTrackProgress(resolved.geometry,profile.pit_exit_progress);
  const distance=(point,target)=>Math.hypot(Number(point?.[0])-Number(target?.x),Number(point?.[1])-Number(target?.y));

  assert.deepEqual(functionalPit,snapshot,"presentation must never mutate functional pit geometry");
  assert.deepEqual(functionalPit[0],[134,208]);
  assert.deepEqual(functionalPit.at(-1),[701,242]);
  assert.ok(distance(visual.pit_lane_points[0],entry)<0.01,"visual pit entry must merge onto the main track");
  assert.ok(distance(visual.pit_lane_points.at(-1),exit)<0.01,"visual pit exit must merge onto the main track");
  assert.ok(visual.pit_lane_points.length>functionalPit.length,"presentation path should add enough samples for smooth merges");

  const sourceMid=sampleOpenPolylinePoint(functionalPit,.5);
  const visualMid=sampleOpenPolylinePoint(visual.pit_lane_points,.5);
  assert.ok(visualMid.y>sourceMid.y+6,"Argentina pit lane should gain visible separation from the main straight");
});


test("Track 2.0 keeps functional, race-view and mini-map geometries separate",()=>{
  const resolved=resolveTrackLayout({trackId:"tr_0018",year:1980});
  const environment=trackEnvironmentProfile(resolved.layout);
  assert.equal(environment.runtime_mode,"f1track_procedural");
  assert.equal(resolved.geometry.quality,"historical_verified");
  const presentation=trackPresentationGeometry(resolved.geometry,resolved.layout);
  const minimap=trackMiniMapGeometry(resolved.layout,resolved.geometry);
  assert.equal(presentation.presentation_source,"f1track_race_view");
  assert.equal(presentation.package_id,"tr_0018_1974_1981");
  assert.deepEqual(presentation.view_box,[0,0,1649,954]);
  assert.equal(minimap.presentation_source,"f1track_minimap");
  assert.deepEqual(minimap.view_box,[0,0,1000,1000]);
  assert.equal(minimap.source_svg,"Autodromo-Oscar-y-Juan-Galvez-White.svg");
  assert.deepEqual(presentation.points[0],resolved.geometry.points[0],"world-first race view uses the canonical functional shape without artwork warping");
  assert.notDeepEqual(minimap.points[0],resolved.geometry.points[0],"mini-map must remain an independent presentation");
});


test("Track 2.1 generated ribbon keeps both edges around the centreline",()=>{
  const geometry={points:[[0,0],[100,0],[100,100],[0,100]]};
  const left=offsetTrackPolyline(geometry,10);
  const right=offsetTrackPolyline(geometry,-10);
  const ribbon=trackRibbonPolygon(geometry,10);
  assert.equal(left.length,4);
  assert.equal(right.length,4);
  assert.equal(ribbon.length,8);
  assert.ok(left.every((point)=>point.every(Number.isFinite)));
  assert.ok(right.every((point)=>point.every(Number.isFinite)));
});

test("Track 2.1 heading follows circuit direction",()=>{
  const geometry={points:[[0,0],[100,0],[100,100],[0,100]]};
  const heading=trackHeadingDegrees(geometry,.125);
  assert.ok(Math.abs(heading)<3,"first straight should point right");
  const second=trackHeadingDegrees(geometry,.375);
  assert.ok(second>80&&second<100,"second straight should point down");
});

test("Track 2.1 deterministic scenery scatter is stable and avoids the track",()=>{
  const geometry={points:[[100,100],[900,100],[900,500],[100,500]]};
  const a=deterministicTrackScatter({bounds:[0,0,1000,600],geometry,count:24,seed:"argentina",minTrackDistance:45});
  const b=deterministicTrackScatter({bounds:[0,0,1000,600],geometry,count:24,seed:"argentina",minTrackDistance:45});
  assert.deepEqual(a,b);
  assert.equal(a.length,24);
});

test("Track 2.1 free camera zoom anchors at cursor and stays inside bounds",()=>{
  const bounds=[0,0,1000,600];
  const zoomed=zoomTrackViewBox(bounds,bounds,{x:800,y:300,factor:.5,minWidth:100,minHeight:60});
  assert.deepEqual(zoomed,[400,150,500,300]);
  const panned=panTrackViewBox(zoomed,bounds,500,500);
  assert.deepEqual(panned,[500,300,500,300]);
  assert.deepEqual(clampTrackViewBox([-50,-50,1200,800],bounds),bounds);
});


test("Track 2.2 camera zoom factor is derived from the actual viewBox",()=>{
  const full=[0,0,1000,600];
  assert.equal(trackCameraZoomFactor(full,full),1);
  const zoomed=[250,150,500,300];
  assert.ok(Math.abs(trackCameraZoomFactor(zoomed,full)-2)<1e-9);
});

test("Track 2.2 car scaling is consistent for wheel and follow cameras",()=>{
  const full=[0,0,1000,600];
  const twoX=[250,150,500,300];
  const fiveX=[400,240,200,120];
  assert.equal(trackMarkerScaleForViewBox(full,full),1);
  const scale2=trackMarkerScaleForViewBox(twoX,full);
  const scale5=trackMarkerScaleForViewBox(fiveX,full);
  assert.ok(scale2<1&&scale2>.45);
  assert.ok(scale5<scale2&&scale5>.16);
  const apparent2=scale2*2;
  const apparent5=scale5*5;
  assert.ok(apparent2>1&&apparent2<2,"2x camera should grow the car moderately, not double it");
  assert.ok(apparent5>apparent2&&apparent5<2.2,"deep zoom should stay bounded instead of producing giant cars");
});


test("Track 2.3 presentation simplification removes tiny straight-line oscillations",()=>{
  const wavy=[
    [0,0],[20,.2],[40,-.35],[60,.28],[80,-.15],[100,0],
    [100,40],[80,40],[60,40],[40,40],[20,40],[0,40],
  ];
  const simplified=simplifyClosedPolyline(wavy,.75);
  assert.ok(simplified.length<wavy.length);
  const top=simplified.filter((point)=>point[1]<5);
  assert.ok(top.length<=3,"near-straight run should collapse to a small number of anchors");
});

test("Track 2.3 simplification never mutates authoritative geometry",()=>{
  const functional={
    points:[[0,0],[25,.2],[50,-.2],[75,.15],[100,0],[100,100],[0,100]],
    pit_lane_points:[[0,4],[25,4.1],[50,3.9],[100,4]],
    quality:"historical_verified",
  };
  const snapshot=JSON.parse(JSON.stringify(functional));
  const presentation=simplifyTrackPresentationGeometry(functional,{tolerance:.75,pitTolerance:.4});
  assert.deepEqual(functional,snapshot);
  assert.equal(presentation.presentation_simplified,true);
  assert.ok(presentation.points.length<functional.points.length);
  assert.ok(presentation.pit_lane_points.length<=functional.pit_lane_points.length);
});

test("Track 2.3 Argentina presentation reduces noisy anchors without changing the functional package",()=>{
  const resolved=resolveTrackLayout({trackId:"tr_0018",year:1980});
  const presentation=trackPresentationGeometry(resolved.geometry,resolved.layout);
  const style=resolved.environment.race_view_style;
  const smoothed=simplifyTrackPresentationGeometry(presentation,{
    tolerance:style.presentation_tolerance,
    pitTolerance:style.pit_presentation_tolerance,
  });
  assert.equal(resolved.geometry.points.length,280);
  assert.ok(smoothed.points.length>=80&&smoothed.points.length<=130);
  assert.ok(smoothed.points.length<resolved.geometry.points.length/2);
  assert.deepEqual(smoothed.points[0],presentation.points[0]);
  assert.equal(resolved.geometry.points.length,280,"authoritative geometry must stay unchanged");
});


test("Track 2.5 wheel zoom preserves follow semantics by changing zoom only",()=>{
  assert.ok(trackFollowZoomFromWheel(5,-100)>5);
  assert.ok(trackFollowZoomFromWheel(5,100)<5);
  assert.equal(trackFollowZoomFromWheel(12,-100,{max:12}),12);
  assert.equal(trackFollowZoomFromWheel(1.35,100,{min:1.35}),1.35);
});

test("Track 2.5 follow camera adds bounded look-ahead without leaving track bounds",()=>{
  const full=[0,0,1000,600];
  const right=followTrackViewBox(full,{x:500,y:300,heading:0},{zoom:5,minWidth:80,minHeight:60,lookAheadRatio:.1});
  assert.equal(right[2],200);
  assert.equal(right[3],120);
  assert.ok(right[0]>400,"right-facing car should be framed slightly ahead");
  const edge=followTrackViewBox(full,{x:990,y:300,heading:0},{zoom:5,minWidth:80,minHeight:60,lookAheadRatio:.2});
  assert.ok(edge[0]+edge[2]<=1000.001);
});

test("Track 2.5 damped camera converges smoothly",()=>{
  const current=[0,0,1000,600];
  const target=[400,240,200,120];
  const next=dampTrackViewBox(current,target,16,{timeConstantMs:82,snap:.001});
  assert.ok(next[0]>0&&next[0]<400);
  assert.ok(next[2]<1000&&next[2]>200);
  const snapped=dampTrackViewBox(target,target,16);
  assert.deepEqual(snapped,target);
});

test("Track 2.5 renderer LOD follows camera zoom",()=>{
  assert.equal(trackLodForZoom(1),"overview");
  assert.equal(trackLodForZoom(1.84),"overview");
  assert.equal(trackLodForZoom(1.85),"medium");
  assert.equal(trackLodForZoom(4.49),"medium");
  assert.equal(trackLodForZoom(4.5),"close");
  assert.equal(trackLodForZoom(10),"close");
});
