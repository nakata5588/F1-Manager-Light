import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TRACK_LAYOUT_ASSETS } from "../src/data/trackLayoutAssets.js";
import { TRACK_LAYOUT_GEOMETRY } from "../src/data/trackLayoutGeometry.js";
import { historicalTrackLapLengthKm, calibrateTrackGeometry, focusTrackViewBox, orientTrackGeometry, pointAtTrackProgress, raceEventTrackProgress, resolveTrackLayout, trackEnvironmentProfile, trackGeometryViewBox, trackIntelligenceProfile, trackMarkerSegment, trackMiniMapGeometry, trackPresentationGeometry, trackPresentationSplineEligible, trackRuntimeGeometry, trackSectorPolylinePoints, visualTrackProgress } from "../src/domain/trackLayout.js";
import { buildPitLanePresentationGeometry, deterministicTrackScatter, offsetTrackPolyline, sampleOpenPolylinePoint, simplifyClosedPolyline, simplifyTrackPresentationGeometry, trackHeadingDegrees, trackRibbonPolygon } from "../src/domain/trackSceneGeometry.js";
import { clampTrackViewBox, dampTrackViewBox, followTrackViewBox, panTrackViewBox, trackCameraZoomFactor, trackFollowZoomFromWheel, trackLodForZoom, trackMarkerScaleForViewBox, zoomTrackViewBox } from "../src/domain/trackCamera.js";
import { buildClosedRacingLine } from "../src/domain/raceSplineV3.js";

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
  assert.equal(longBeachRuntime.source,"f1track_functional");
  assert.equal(longBeachRuntime.geometry.quality,"derived_provisional");
  assert.equal(trackPresentationSplineEligible(longBeach,longBeachRuntime),false);
});

test("Track 3.0 1980 layout provenance baseline is explicit for every championship venue",()=>{
  const expected=new Map([
    ["tr_0018",["exact",1980,"historical_verified"]],
    ["tr_0028",["exact",1980,"derived_provisional"]],
    ["tr_0067",["exact",1980,"derived_provisional"]],
    ["tr_0088",["exact",1980,"derived_provisional"]],
    ["tr_0026",["exact",1980,"derived_provisional"]],
    ["tr_0056",["exact",1980,"derived_provisional"]],
    ["tr_0035",["generic_fallback",null,"derived_provisional"]],
    ["tr_0081",["generic_fallback",null,"derived_provisional"]],
    ["tr_0041",["future_fallback",2002,"derived_provisional"]],
    ["tr_0022",["generic_fallback",null,"derived_provisional"]],
    ["tr_0058",["generic_fallback",null,"derived_provisional"]],
    ["tr_0047",["exact",1980,"derived_provisional"]],
    ["tr_0030",["generic_fallback",null,"derived_provisional"]],
    ["tr_0090",["generic_fallback",null,"derived_provisional"]],
  ]);
  const calendar=JSON.parse(fs.readFileSync(path.join(root,"public/data/calendar.json"),"utf8"));
  const calendarTrackIds=[...new Set(
    calendar
      .filter((row)=>Number(row.year)===1980)
      .map((row)=>String(row?.track_id?.result??row?.track_id??""))
      .filter(Boolean)
  )].sort();
  assert.deepEqual(
    [...expected.keys()].sort(),
    calendarTrackIds,
    "provenance baseline must track the actual 1980 championship calendar"
  );
  for(const [trackId,[resolution,sourceYear,quality]] of expected){
    const resolved=resolveTrackLayout({trackId,year:1980});
    assert.equal(resolved.resolution,resolution,trackId);
    assert.equal(resolved.source_year,sourceYear,trackId);
    assert.equal(resolved.geometry?.quality,quality,trackId);
  }
});

test("Track 3.0 flags the remaining anachronistic 1980 future-layout geometries still renderable",()=>{
  const futureFallbacks=[...new Set(TRACK_LAYOUT_ASSETS.map((layout)=>layout.track_id))]
    .map((trackId)=>resolveTrackLayout({trackId,year:1980}))
    .filter((resolved)=>resolved.resolution==="future_fallback"&&resolved.geometry)
    .map((resolved)=>[resolved.layout.track_id,resolved.source_year])
    .sort(([a],[b])=>a.localeCompare(b));
  assert.deepEqual(futureFallbacks,[["tr_0041",2002]]);
  // Albert Park 1996–2020 is an era-bound *layout* fallback, not renderable
  // 1980 geometry; never mistake source-year discovery for on-track fidelity.
  const albert1980=resolveTrackLayout({trackId:"tr_0019",year:1980});
  assert.equal(albert1980.resolution,"future_fallback");
  assert.equal(albert1980.geometry,null);
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


test("RW31 spline preserves traced straight runs instead of bowing them through Catmull-Rom",()=>{
  const raw=[
    [0,0],[20,.08],[40,-.06],[60,.05],[80,-.04],[100,0],
    [112,12],[110,32],[100,44],
    [80,44],[60,44],[40,44],[20,44],[0,44],
    [-12,32],[-12,12],
  ];
  const simplified=[
    [0,0],[100,0],[112,12],[110,32],[100,44],[0,44],[-12,32],[-12,12],
  ];
  const line=buildClosedRacingLine(simplified,{
    samplesPerSegment:8,
    parameterization:"centripetal",
    preserveStraights:true,
    straightSourcePoints:raw,
  });
  assert.ok(line.straight_segment_count>=2);
  const firstSegment=line.points.slice(0,8);
  assert.ok(firstSegment.every((point)=>Math.abs(point[1])<1e-9));
  const lowerStart=4*8;
  const lowerSegment=line.points.slice(lowerStart,lowerStart+8);
  assert.ok(lowerSegment.every((point)=>Math.abs(point[1]-44)<1e-9));
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

test("Albert Park 2000 exposes a clockwise original-era centerline with the grid before T1",()=>{
  const resolved=resolveTrackLayout({trackId:"tr_0019",year:2000});
  const runtime=trackRuntimeGeometry(resolved);
  const layout=resolved.layout;
  assert.equal(resolved.resolution,"exact");
  assert.equal(layout.year_from,1996);
  assert.equal(layout.year_to,2020);
  assert.equal(layout.race_direction,"clockwise");
  assert.equal(runtime.source,"f1track_functional");
  assert.equal(runtime.geometry.quality,"derived_provisional");
  assert.equal(trackPresentationSplineEligible(resolved,runtime),false);
  assert.ok(runtime.geometry.points.length>=160);
  const points=runtime.geometry.points;
  // Positive shoelace area in SVG's downward-pointing Y is clockwise.
  const signedArea=points.reduce((total,p,i)=>{
    const next=points[(i+1)%points.length];
    return total+p[0]*next[1]-next[0]*p[1];
  },0)/2;
  assert.ok(signedArea>0,"car traversal follows the historically clockwise circuit");
  assert.ok(points[1][0]<points[0][0]&&points[1][1]<points[0][1],
    "cars leave start/finish on the north-westbound pit straight");
  assert.equal(layout.start_finish_progress,0);
  assert.ok(layout.pit_entry_progress>0.8);
  assert.ok(layout.pit_exit_progress<0.10);
  assert.ok(runtime.geometry.pit_lane_points.length>=10);
  assert.deepEqual(resolved.geometry.points,runtime.geometry.points,
    "legacy track view and canonical Race View use the same source");
});

test("Albert Park original-era geometry cannot silently appear on the reconfigured 2022 layout",()=>{
  const year2020=resolveTrackLayout({trackId:"tr_0019",year:2020});
  assert.equal(year2020.resolution,"exact");
  assert.ok(trackRuntimeGeometry(year2020).geometry?.points.length>=160);
  const year2022=resolveTrackLayout({trackId:"tr_0019",year:2022});
  assert.equal(year2022.resolution,"past_fallback");
  assert.equal(year2022.geometry,null);
  assert.equal(year2022.track_package,null);
  assert.equal(trackRuntimeGeometry(year2022).source,"none");
  const year1955=resolveTrackLayout({trackId:"tr_0019",year:1955});
  assert.equal(year1955.resolution,"future_fallback");
  assert.equal(trackRuntimeGeometry(year1955).geometry,null);
});

test("Interlagos uses a single track ID and exactly two historical shape families",()=>{
  const layouts=TRACK_LAYOUT_ASSETS.filter((row)=>row.track_id==="tr_0028");
  assert.deepEqual(layouts.map((row)=>row.layout_id),["tr_0028_long","tr_0028_short"]);
  assert.deepEqual(layouts.map((row)=>[row.year_from,row.year_to]),[[1973,1989],[1990,2099]]);

  const cases=[
    [1973,"tr_0028_long"],
    [1976,"tr_0028_long"],
    [1979,"tr_0028_long"],
    [1980,"tr_0028_long"],
    [1990,"tr_0028_short"],
    [1996,"tr_0028_short"],
    [1999,"tr_0028_short"],
    [2000,"tr_0028_short"],
    [2024,"tr_0028_short"],
    [2026,"tr_0028_short"],
  ];
  for(const [year,layoutId] of cases){
    const resolved=resolveTrackLayout({trackId:"tr_0028",year});
    const runtime=trackRuntimeGeometry(resolved);
    assert.equal(resolved.resolution,"exact",String(year));
    assert.equal(resolved.layout.layout_id,layoutId,String(year));
    assert.equal(runtime.source,"f1track_functional",String(year));
    assert.equal(runtime.geometry.quality,"derived_provisional",String(year));
    assert.ok(runtime.geometry.points.length>=200,String(year));
    assert.equal(trackPresentationSplineEligible(resolved,runtime),false,
      "cartographic outline must never be treated as surveyed physics");
    let twiceArea=0;
    const points=runtime.geometry.points;
    for(let i=0;i<points.length;i++){
      const next=points[(i+1)%points.length];
      twiceArea+=points[i][0]*next[1]-next[0]*points[i][1];
    }
    assert.ok(twiceArea<0,`${year} must use counter-clockwise track order`);
    assert.deepEqual(resolved.geometry.points,points,
      `${year} canonical and legacy views must use the same centerline`);
  }
  const before=resolveTrackLayout({trackId:"tr_0028",year:1960});
  assert.equal(before.resolution,"future_fallback");
  assert.equal(trackRuntimeGeometry(before).geometry,null,
    "Interlagos F1 GP layout cannot silently be used for earlier decades");
});

test("Interlagos 1990 cutover changes geometry, not the identity or result archive",()=>{
  const original=resolveTrackLayout({trackId:"tr_0028",year:1980});
  const short=resolveTrackLayout({trackId:"tr_0028",year:2000});
  assert.equal(original.layout.track_id,short.layout.track_id);
  assert.notDeepEqual(trackRuntimeGeometry(original).geometry.points,trackRuntimeGeometry(short).geometry.points);
  assert.equal(original.layout.race_direction,"counterclockwise");
  assert.equal(short.layout.race_direction,"counterclockwise");
  assert.equal(original.layout.pit_entry_progress,null);
  assert.equal(short.layout.pit_entry_progress,null);
  assert.equal(trackIntelligenceProfile(original.layout).pit_entry_progress,null);
  assert.equal(trackIntelligenceProfile(short.layout).pit_exit_progress,null);
});


test("Buenos Aires has exactly four era-specific line families, one permanent track identity",()=>{
  const expected=[
    ["tr_0018_no2",1953,1960],
    ["tr_0018_no9",1972,1973],
    ["tr_0018_provisional",1974,1981],
    ["tr_0018_no6_senna",1995,1998],
  ];
  const layouts=TRACK_LAYOUT_ASSETS.filter((layout)=>layout.track_id==="tr_0018")
    .map((layout)=>[layout.layout_id,layout.year_from,layout.year_to])
    .sort((a,b)=>a[1]-b[1]);
  assert.deepEqual(layouts,expected);
  for(const [layoutId,from,to] of expected){
    const resolved=resolveTrackLayout({trackId:"tr_0018",year:from});
    const runtime=trackRuntimeGeometry(resolved);
    assert.equal(resolved.resolution,"exact",layoutId);
    assert.equal(resolved.layout.layout_id,layoutId);
    assert.ok(runtime.geometry?.points?.length>200,layoutId);
    assert.deepEqual(resolved.geometry.points,runtime.geometry.points,
      `${layoutId} legacy and modern geometry must be identical`);
    assert.equal(resolveTrackLayout({trackId:"tr_0018",year:to}).layout.layout_id,layoutId);
  }
});

test("1954 uses the No.2 track path reversed, with the same unchanged start/finish",()=>{
  const original=resolveTrackLayout({trackId:"tr_0018",year:1953});
  const reverse=resolveTrackLayout({trackId:"tr_0018",year:1954});
  const back=resolveTrackLayout({trackId:"tr_0018",year:1955});
  assert.equal(original.layout.layout_id,reverse.layout.layout_id);
  assert.equal(original.track_package?.package_id,reverse.track_package?.package_id);
  assert.equal(original.layout.race_direction,"clockwise");
  assert.equal(reverse.layout.race_direction,"counterclockwise");
  assert.equal(back.layout.race_direction,"clockwise");
  const points=trackRuntimeGeometry(original).geometry.points;
  const reversed=trackRuntimeGeometry(reverse).geometry.points;
  assert.deepEqual(reversed[0],points[0]);
  assert.deepEqual(reversed.slice(1),points.slice(1).reverse());
  assert.deepEqual(reverse.geometry.points,reversed);
  assert.deepEqual(trackRuntimeGeometry(back).geometry.points,points);
  assert.equal(trackPresentationSplineEligible(reverse,trackRuntimeGeometry(reverse)),false);
});

test("Buenos Aires 1961–1971 and post-1981 unrelated years do not reuse old circuits",()=>{
  for(const year of [1950,1961,1965,1971,1982,1991,1999,2024]){
    const result=resolveTrackLayout({trackId:"tr_0018",year});
    assert.equal(trackRuntimeGeometry(result).geometry,null,String(year));
  }
});

test("Buenos Aires No.2 outline has no self-crossing joins from fragmented historical SVG",()=>{
  const shape=trackRuntimeGeometry(resolveTrackLayout({trackId:"tr_0018",year:1953})).geometry.points;
  const oriented=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  for(let i=0;i<shape.length;i++){
    const a=shape[i],b=shape[(i+1)%shape.length];
    for(let j=i+2;j<shape.length;j++){
      if(i===0&&j===shape.length-1)continue;
      const c=shape[j],d=shape[(j+1)%shape.length];
      const intersects=oriented(a,b,c)*oriented(a,b,d)<-1e-8
        &&oriented(c,d,a)*oriented(c,d,b)<-1e-8;
      assert.equal(intersects,false,`historical stroke join crossing ${i}/${j}`);
    }
  }
});

test("Imola has one track ID with five era-specific families",()=>{
  const a=TRACK_LAYOUT_ASSETS.filter(x=>x.track_id==="tr_0047").sort((x,y)=>x.year_from-y.year_from);
  assert.deepEqual(a.map(x=>[x.layout_id,x.year_from,x.year_to]),[
    ["tr_0047_original",1953,1972],
    ["tr_0047_1973",1973,1973],
    ["tr_0047_1974_1994",1974,1994],
    ["tr_0047_1995_2006",1995,2006],
    ["tr_0047_modern",2008,2099],
  ]);
  for(const year of [1953,1963,1972,1973,1974,1979,1980,1981,1994,1995,2000,2006,2008,2020,2024,2026]){
    const resolved=resolveTrackLayout({trackId:"tr_0047",year});
    const runtime=trackRuntimeGeometry(resolved);
    assert.equal(resolved.resolution,"exact",String(year));
    assert.equal(resolved.track_package.track_id,"tr_0047");
    assert.equal(resolved.layout.race_direction,"counterclockwise");
    assert.equal(runtime.source,"f1track_functional");
    assert.equal(runtime.geometry.points.length,240);
    assert.equal(trackPresentationSplineEligible(resolved,runtime),false);
    assert.deepEqual(resolved.geometry.points,runtime.geometry.points);
    const p=runtime.geometry.points;
    const area=p.reduce((sum,point,i)=>{
      const next=p[(i+1)%p.length];
      return sum+point[0]*next[1]-next[0]*point[1];
    },0)/2;
    assert.ok(area<0,String(year)+" must be anticlockwise");
    assert.equal(runtime.geometry.quality,
      year<=1973?"schematic_provisional":"derived_provisional");
  }
  assert.equal(trackRuntimeGeometry(resolveTrackLayout({trackId:"tr_0047",year:1950})).geometry,null);
  assert.equal(trackRuntimeGeometry(resolveTrackLayout({trackId:"tr_0047",year:2007})).geometry,null);
});

test("All five historical Imola centerlines avoid accidental self-intersections",()=>{
  const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  for(const year of [1963,1973,1980,2000,2020]){
    const p=trackRuntimeGeometry(resolveTrackLayout({trackId:"tr_0047",year})).geometry.points;
    for(let i=0;i<p.length;i++)for(let j=i+2;j<p.length;j++){
      if(i===0&&j===p.length-1)continue;
      const a=p[i],b=p[(i+1)%p.length],c=p[j],d=p[(j+1)%p.length];
      const crossing=orient(a,b,c)*orient(a,b,d)<-1e-8
        &&orient(c,d,a)*orient(c,d,b)<-1e-8;
      assert.equal(crossing,false,String(year)+" segments "+i+"/"+j);
    }
  }
});

test("Silverstone has one identity and six unique geographic centerlines for its eight source SVG labels",()=>{
  const items=TRACK_LAYOUT_ASSETS.filter(x=>x.track_id==="tr_0079").sort((a,b)=>a.year_from-b.year_from);
  assert.deepEqual(items.map(x=>[x.layout_id,x.year_from,x.year_to]),[
    ["tr_0079_classic",1949,1974],
    ["tr_0079_woodcote",1975,1986],
    ["tr_0079_bridge",1987,1990],
    ["tr_0079_1991_1993",1991,1993],
    ["tr_0079_1994_2009",1994,2009],
    ["tr_0079_arena",2010,2099],
  ]);
  const years=[1950,1951,1952,1960,1973,1975,1979,1981,1985,1987,1990,1991,1993,1994,1995,1996,1997,1999,2000,2009,2010,2011,2020,2024,2026];
  for(const year of years){
    const res=resolveTrackLayout({trackId:"tr_0079",year});
    const runtime=trackRuntimeGeometry(res);
    assert.equal(res.resolution,"exact",String(year));
    assert.equal(res.track_package.track_id,"tr_0079");
    assert.equal(res.layout.race_direction,"clockwise");
    assert.equal(runtime.source,"f1track_functional");
    assert.equal(runtime.geometry.quality,"derived_provisional");
    assert.equal(runtime.geometry.points.length,240);
    assert.equal(trackPresentationSplineEligible(res,runtime),false);
    assert.deepEqual(res.geometry.points,runtime.geometry.points,String(year));
    const pts=runtime.geometry.points;
    const area=pts.reduce((acc,point,i)=>{
      const next=pts[(i+1)%pts.length];
      return acc+point[0]*next[1]-next[0]*point[1];
    },0)/2;
    assert.ok(area>0,"clockwise order "+year);
    assert.equal(trackIntelligenceProfile(res.layout).pit_entry_progress,null);
    assert.equal(trackIntelligenceProfile(res.layout).pit_exit_progress,null);
  }
  assert.equal(trackRuntimeGeometry(resolveTrackLayout({trackId:"tr_0079",year:1948})).geometry,null,
    "1948 non-championship runway GP needs a separate sourced route");
  const yearsSame=[1994,1996,1997,2000,2009];
  const initial=trackRuntimeGeometry(resolveTrackLayout({trackId:"tr_0079",year:1994})).geometry.points;
  for(const year of yearsSame){
    assert.deepEqual(trackRuntimeGeometry(resolveTrackLayout({trackId:"tr_0079",year})).geometry.points,initial,
      "1994–2009 F1DB SVG 5/6/7 are byte-identical; do not copy");
  }
});

test("Six Silverstone GP illustrations are closed, equispaced and free of SVG join self-intersections",()=>{
  const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  for(const year of [1950,1979,1987,1991,2000,2020]){
    const pts=trackRuntimeGeometry(resolveTrackLayout({trackId:"tr_0079",year})).geometry.points;
    const lengths=pts.map((p,i)=>{
      const q=pts[(i+1)%pts.length];
      return Math.hypot(q[0]-p[0],q[1]-p[1]);
    });
    assert.ok(Math.max(...lengths)<Math.min(...lengths)*1.06,"near-equal samples "+year);
    for(let i=0;i<pts.length;i++)for(let j=i+2;j<pts.length;j++){
      if(i===0&&j===pts.length-1)continue;
      const a=pts[i],b=pts[(i+1)%pts.length],c=pts[j],d=pts[(j+1)%pts.length];
      const crossing=orient(a,b,c)*orient(a,b,d)<-1e-8
        &&orient(c,d,a)*orient(c,d,b)<-1e-8;
      assert.equal(crossing,false,"self-crossing in "+year+": "+i+"/"+j);
    }
  }
});


test("Kyalami chronology maps two F1 routes onto one stable tr_0067 identity",()=>{
  const items=TRACK_LAYOUT_ASSETS.filter(x=>x.track_id==="tr_0067");
  assert.deepEqual(items.filter(x=>x.track_package).map(x=>[x.layout_id,x.year_from,x.year_to]),[
    ["tr_0067_original",1967,1985],["tr_0067_rebuilt",1992,1993]
  ]);
  for(const [year,id,direction,km] of [
    [1967,"tr_0067_original","clockwise",4.094],
    [1968,"tr_0067_original","clockwise",4.104],
    [1970,"tr_0067_original","clockwise",4.104],
    [1980,"tr_0067_original","clockwise",4.104],
    [1985,"tr_0067_original","clockwise",4.104],
    [1992,"tr_0067_rebuilt","counterclockwise",4.261],
    [1993,"tr_0067_rebuilt","counterclockwise",4.261],
  ]){
    const res=resolveTrackLayout({trackId:"tr_0067",year});
    const runtime=trackRuntimeGeometry(res);
    assert.equal(res.exact,true,String(year));
    assert.equal(res.layout.layout_id,id,String(year));
    assert.equal(res.layout.track_id,"tr_0067");
    assert.equal(res.layout.race_direction,direction);
    assert.equal(historicalTrackLapLengthKm("tr_0067",year),km);
    assert.equal(runtime.source,"f1track_functional");
    assert.equal(runtime.geometry.quality,"derived_provisional");
    assert.equal(runtime.geometry.points.length,240);
    assert.equal(trackPresentationSplineEligible(res,runtime),false);
    assert.deepEqual(res.geometry.points,runtime.geometry.points);
    assert.equal(trackIntelligenceProfile(res.layout).pit_entry_progress,null);
    assert.equal(trackIntelligenceProfile(res.layout).pit_exit_progress,null);
    const pts=runtime.geometry.points;
    const area=pts.reduce((sum,p,i)=>{
      const q=pts[(i+1)%pts.length];
      return sum+p[0]*q[1]-q[0]*p[1];
    },0)/2;
    assert.equal(area>0,direction==="clockwise",String(year)+" winding");
  }
  for(const year of [1961,1966,1986,1989,1991,1994,2000,2015,2017]){
    const res=resolveTrackLayout({trackId:"tr_0067",year});
    assert.equal(trackRuntimeGeometry(res).geometry,null,"not renderable "+year);
    assert.equal(historicalTrackLapLengthKm("tr_0067",year),null,"no invented race length "+year);
  }
  const nonF1=resolveTrackLayout({trackId:"tr_0067",year:2016});
  assert.equal(nonF1.exact,true);
  assert.equal(nonF1.layout.layout_id,"tr_0067_provisional");
  assert.equal(historicalTrackLapLengthKm("tr_0067",2016),null);
});

test("Kyalami sampled historic geometry is continuous and has no self crossings",()=>{
  const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  for(const year of [1980,1992]){
    const p=trackRuntimeGeometry(resolveTrackLayout({trackId:"tr_0067",year})).geometry.points;
    const lengths=p.map((a,i)=>Math.hypot(a[0]-p[(i+1)%p.length][0],a[1]-p[(i+1)%p.length][1]));
    assert.ok(Math.max(...lengths)<Math.min(...lengths)*1.07,"uniform sampling "+year);
    for(let i=0;i<p.length;i++)for(let j=i+2;j<p.length;j++){
      if(i===0&&j===p.length-1)continue;
      const a=p[i],b=p[(i+1)%p.length],c=p[j],d=p[(j+1)%p.length];
      assert.equal(orient(a,b,c)*orient(a,b,d)<-1e-8 &&
        orient(c,d,a)*orient(c,d,b)<-1e-8,false,"crossing "+year+" "+i+"/"+j);
    }
  }
});

test("Long Beach three era-bound F1 tracks use one circuit identity and exact calendar lengths",()=>{
  const items=TRACK_LAYOUT_ASSETS.filter(x=>x.track_id==="tr_0088");
  assert.deepEqual(items.filter(x=>x.track_package).map(x=>[x.layout_id,x.year_from,x.year_to]),[
    ["tr_0088_1976_1981",1976,1981],["tr_0088_1982",1982,1982],["tr_0088_1983",1983,1983]
  ]);
  for(const [year,id,km] of [
    [1976,"tr_0088_1976_1981",3.251],[1977,"tr_0088_1976_1981",3.251],
    [1978,"tr_0088_1976_1981",3.251],[1979,"tr_0088_1976_1981",3.251],
    [1980,"tr_0088_1976_1981",3.251],[1981,"tr_0088_1976_1981",3.251],
    [1982,"tr_0088_1982",3.428],[1983,"tr_0088_1983",3.275]
  ]){
    const r=resolveTrackLayout({trackId:"tr_0088",year}),runtime=trackRuntimeGeometry(r);
    assert.equal(r.resolution,"exact",String(year));
    assert.equal(r.layout.layout_id,id,String(year));
    assert.equal(r.track_package.track_id,"tr_0088");
    assert.equal(r.layout.race_direction,"clockwise");
    assert.equal(historicalTrackLapLengthKm("tr_0088",year),km);
    assert.equal(runtime.source,"f1track_functional");
    assert.equal(runtime.geometry.quality,"derived_provisional");
    assert.equal(runtime.geometry.points.length,240);
    assert.deepEqual(r.geometry.points,runtime.geometry.points);
    assert.equal(trackPresentationSplineEligible(r,runtime),false);
    assert.equal(trackIntelligenceProfile(r.layout).pit_entry_progress,null);
    assert.equal(trackIntelligenceProfile(r.layout).pit_exit_progress,null);
    const p=runtime.geometry.points;
    const area=p.reduce((sum,a,i)=>{const b=p[(i+1)%p.length];return sum+a[0]*b[1]-b[0]*a[1]},0)/2;
    assert.ok(area>0,"clockwise "+year);
  }
  assert.deepEqual(trackRuntimeGeometry(resolveTrackLayout({trackId:"tr_0088",year:1976})).geometry.points,
    trackRuntimeGeometry(resolveTrackLayout({trackId:"tr_0088",year:1980})).geometry.points,
    "1978 start move is not a new street layout");
  for(const year of [1975,1984,1990,1999,2001,2026]){
    const r=resolveTrackLayout({trackId:"tr_0088",year});
    assert.equal(trackRuntimeGeometry(r).geometry,null,"no anachronistic map "+year);
    assert.equal(historicalTrackLapLengthKm("tr_0088",year),null,"no false race distance "+year);
  }
  const legacy=resolveTrackLayout({trackId:"tr_0088",year:2000});
  assert.equal(legacy.resolution,"exact");
  assert.equal(legacy.layout.layout_id,"tr_0088_provisional");
  assert.equal(historicalTrackLapLengthKm("tr_0088",2000),null);
});

test("Long Beach three illustrative F1 centerlines avoid crossings, near-uniform sampled arc length",()=>{
  const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  for(const year of [1976,1982,1983]){
    const p=trackRuntimeGeometry(resolveTrackLayout({trackId:"tr_0088",year})).geometry.points;
    const gaps=p.map((a,i)=>Math.hypot(a[0]-p[(i+1)%p.length][0],a[1]-p[(i+1)%p.length][1]));
    // Straight chord length shortens at sharp street-circuit bends: arc length
    // is equally sampled, but vertex-to-vertex chords need not be identical.
    assert.ok(Math.max(...gaps)<Math.min(...gaps)*1.16,"uniform arc samples "+year);
    for(let i=0;i<p.length;i++)for(let j=i+2;j<p.length;j++){
      if(i===0&&j===p.length-1)continue;
      const [a,b,c,d]=[p[i],p[(i+1)%p.length],p[j],p[(j+1)%p.length]];
      assert.equal(orient(a,b,c)*orient(a,b,d)<-1e-8&&
        orient(c,d,a)*orient(c,d,b)<-1e-8,false,"crossing "+year+" "+i+"/"+j);
    }
  }
});

test("Zolder 1973 and 1975–85 use one tr_0026, never the modern variant in 1980",()=>{
  const layouts=TRACK_LAYOUT_ASSETS.filter(row=>row.track_id==="tr_0026");
  assert.deepEqual(layouts.filter(row=>row.track_package)
    .map(row=>[row.layout_id,row.year_from,row.year_to]),[
      ["tr_0026_1972_1974",1972,1974],
      ["tr_0026_1975_1985",1975,1985]
    ]);
  for(const [year,id,km] of [
    [1972,"tr_0026_1972_1974",4.220],
    [1973,"tr_0026_1972_1974",4.220],
    [1974,"tr_0026_1972_1974",4.220],
    [1975,"tr_0026_1975_1985",4.262],
    [1979,"tr_0026_1975_1985",4.262],
    [1980,"tr_0026_1975_1985",4.262],
    [1981,"tr_0026_1975_1985",4.262],
    [1982,"tr_0026_1975_1985",4.262],
    [1983,"tr_0026_1975_1985",4.262],
    [1984,"tr_0026_1975_1985",4.262],
    [1985,"tr_0026_1975_1985",4.262]
  ]){
    const resolved=resolveTrackLayout({trackId:"tr_0026",year});
    const runtime=trackRuntimeGeometry(resolved);
    assert.equal(resolved.resolution,"exact",String(year));
    assert.equal(resolved.layout.layout_id,id,String(year));
    assert.equal(resolved.layout.track_id,"tr_0026");
    assert.equal(resolved.layout.race_direction,"clockwise");
    assert.equal(historicalTrackLapLengthKm("tr_0026",year),km);
    assert.equal(runtime.source,"f1track_functional");
    assert.equal(runtime.geometry.quality,"derived_provisional");
    assert.equal(runtime.geometry.points.length,240);
    assert.deepEqual(resolved.geometry.points,runtime.geometry.points);
    assert.equal(trackPresentationSplineEligible(resolved,runtime),false);
    assert.equal(trackIntelligenceProfile(resolved.layout).pit_entry_progress,null);
    assert.equal(trackIntelligenceProfile(resolved.layout).pit_exit_progress,null);
  }
  assert.notDeepEqual(
    trackRuntimeGeometry(resolveTrackLayout({trackId:"tr_0026",year:1973})).geometry.points,
    trackRuntimeGeometry(resolveTrackLayout({trackId:"tr_0026",year:1980})).geometry.points,
    "1975 chicane really changed driving geometry");
  for(const year of [1950,1963,1971,1986,1994,2000,2026]){
    const res=resolveTrackLayout({trackId:"tr_0026",year});
    assert.equal(trackRuntimeGeometry(res).geometry,null,"no unverified layout "+year);
    assert.equal(historicalTrackLapLengthKm("tr_0026",year),null,"no invented lap length "+year);
  }
});

test("Zolder two historical SVG centrelines have clockwise winding, regular sampling and no crossings",()=>{
  const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  for(const year of [1973,1980]){
    const p=trackRuntimeGeometry(resolveTrackLayout({trackId:"tr_0026",year})).geometry.points;
    const area=p.reduce((sum,a,i)=>{const b=p[(i+1)%p.length];return sum+a[0]*b[1]-b[0]*a[1]},0)/2;
    assert.ok(area>0,"clockwise winding "+year);
    const gaps=p.map((a,i)=>Math.hypot(a[0]-p[(i+1)%p.length][0],a[1]-p[(i+1)%p.length][1]));
    assert.ok(Math.max(...gaps)<Math.min(...gaps)*1.06,"arc-length samples "+year);
    for(let i=0;i<p.length;i++)for(let j=i+2;j<p.length;j++){
      if(i===0&&j===p.length-1)continue;
      const [a,b,c,d]=[p[i],p[(i+1)%p.length],p[j],p[(j+1)%p.length]];
      assert.equal(
        orient(a,b,c)*orient(a,b,d)<-1e-8&&orient(c,d,a)*orient(c,d,b)<-1e-8,
        false,"self crossing "+year+" "+i+"/"+j);
    }
  }
});

test("Monaco six sourced F1 maps keep a single tr_0056 circuit and historical 1980 length",()=>{
  const items=TRACK_LAYOUT_ASSETS.filter(row=>row.track_id==="tr_0056");
  assert.deepEqual(items.filter(row=>row.track_package).map(row=>[
    row.layout_id,row.year_from,row.year_to
  ]),[
    ["tr_0056_1950",1950,1950],
    ["tr_0056_1955_1972",1955,1972],
    ["tr_0056_1973_1975",1973,1975],
    ["tr_0056_1976_1985",1976,1985],
    ["tr_0056_1986_1996",1986,1996],
    ["tr_0056_2003_modern",2003,2099]
  ]);
  for(const [year,id,km] of [
    [1950,"tr_0056_1950",3.180],[1955,"tr_0056_1955_1972",3.145],
    [1965,"tr_0056_1955_1972",3.145],[1972,"tr_0056_1955_1972",3.145],
    [1973,"tr_0056_1973_1975",3.278],[1975,"tr_0056_1973_1975",3.278],
    [1976,"tr_0056_1976_1985",3.312],[1980,"tr_0056_1976_1985",3.312],
    [1985,"tr_0056_1976_1985",3.312],[1986,"tr_0056_1986_1996",3.328],
    [1996,"tr_0056_1986_1996",3.328],[2003,"tr_0056_2003_modern",3.340],
    [2004,"tr_0056_2003_modern",3.340],[2014,"tr_0056_2003_modern",3.340],
    [2015,"tr_0056_2003_modern",3.337],[2019,"tr_0056_2003_modern",3.337],
    [2021,"tr_0056_2003_modern",3.337],[2026,"tr_0056_2003_modern",3.337]
  ]){
    const resolved=resolveTrackLayout({trackId:"tr_0056",year});
    const runtime=trackRuntimeGeometry(resolved);
    assert.equal(resolved.resolution,"exact",String(year));
    assert.equal(resolved.layout.layout_id,id,String(year));
    assert.equal(resolved.layout.track_id,"tr_0056");
    assert.equal(resolved.layout.race_direction,"clockwise");
    assert.equal(historicalTrackLapLengthKm("tr_0056",year),km);
    assert.equal(runtime.source,"f1track_functional");
    assert.equal(runtime.geometry.quality,"derived_provisional");
    assert.equal(runtime.geometry.points.length,240);
    assert.deepEqual(resolved.geometry.points,runtime.geometry.points);
    assert.equal(trackPresentationSplineEligible(resolved,runtime),false);
    assert.equal(trackIntelligenceProfile(resolved.layout).pit_entry_progress,null);
    assert.equal(trackIntelligenceProfile(resolved.layout).pit_exit_progress,null);
  }
  // A sourced line should change only with a physical redesign.
  assert.notDeepEqual(
    trackRuntimeGeometry(resolveTrackLayout({trackId:"tr_0056",year:1972})).geometry.points,
    trackRuntimeGeometry(resolveTrackLayout({trackId:"tr_0056",year:1980})).geometry.points);
  for(const year of [1949,1951,1954,1997,1998,2000,2002]){
    const resolved=resolveTrackLayout({trackId:"tr_0056",year});
    assert.equal(trackRuntimeGeometry(resolved).geometry,null,"no false geometry "+year);
    assert.equal(historicalTrackLapLengthKm("tr_0056",year),null,"no invented km "+year);
  }
});

test("Monaco all six SVG-derived closed centerlines are clockwise and do not self intersect",()=>{
  const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  for(const year of [1950,1965,1974,1980,1990,2004]){
    const pts=trackRuntimeGeometry(resolveTrackLayout({trackId:"tr_0056",year})).geometry.points;
    const area=pts.reduce((sum,a,j)=>{const b=pts[(j+1)%pts.length];return sum+a[0]*b[1]-b[0]*a[1]},0)/2;
    assert.ok(area>0,"clockwise SVG winding "+year);
    const gaps=pts.map((a,j)=>Math.hypot(a[0]-pts[(j+1)%pts.length][0],a[1]-pts[(j+1)%pts.length][1]));
    // Shorter straight chord at hairpins, despite equal arclength samples.
    assert.ok(Math.max(...gaps)<Math.min(...gaps)*1.26,"equal arc sample "+year);
    for(let i=0;i<pts.length;i++)for(let j=i+2;j<pts.length;j++){
      if(i===0&&j===pts.length-1)continue;
      const [a,b,c,d]=[pts[i],pts[(i+1)%pts.length],pts[j],pts[(j+1)%pts.length]];
      assert.equal(orient(a,b,c)*orient(a,b,d)<-1e-8&&
        orient(c,d,a)*orient(c,d,b)<-1e-8,false,"crossing "+year+" "+i+"/"+j);
    }
  }
});
