import ARGENTINA_1974_1981_F1TRACK from "./tracks/tr_0018_1974_1981.f1track.js";

const raceView=ARGENTINA_1974_1981_F1TRACK.race_view;

export const HISTORICAL_TRACK_ENVIRONMENTS=Object.freeze({
  tr_0018_provisional:Object.freeze({
    asset:null,
    native_width:Number(raceView.view_box?.[2]||1619),
    native_height:Number(raceView.view_box?.[3]||971),
    view_box:raceView.view_box,
    calibration_transform:raceView.geometry_transform,
    presentation_only:true,
    runtime_mode:"f1track_procedural",
    package_id:ARGENTINA_1974_1981_F1TRACK.package_id,
    reference_year:ARGENTINA_1974_1981_F1TRACK.reference_year,
    layout:"Circuit No. 15",
    start_finish_location:"upper_straight",
    start_finish_direction:ARGENTINA_1974_1981_F1TRACK.start_finish_direction,
    sector_colors:ARGENTINA_1974_1981_F1TRACK.intelligence.sector_colors,
    pit_lane_color:ARGENTINA_1974_1981_F1TRACK.intelligence.pit_lane_color,
    contains_track_surface:false,
    contains_track_intel:false,
    visual_style:"f1track_procedural_environment",
    procedural_environment:raceView.environment,
    race_view_style:raceView.style,
    pit_lane_transform:raceView.pit_lane_transform,
  })
});

export default HISTORICAL_TRACK_ENVIRONMENTS;
