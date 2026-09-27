const BUENOS_AIRES_CALIBRATION=Object.freeze({
  x:0,
  y:0,
  scale_x:1,
  scale_y:1,
  rotation_deg:0,
  origin_x:824.5,
  origin_y:477
});

export const HISTORICAL_TRACK_ENVIRONMENTS=Object.freeze({
  tr_0018_provisional:Object.freeze({
    asset:"/tracks/historical/buenos-aires-no15-1980.webp",
    native_width:1649,
    native_height:954,
    view_box:[0,0,1649,954],
    calibration_transform:BUENOS_AIRES_CALIBRATION,
    presentation_only:true,
    reference_year:1980,
    layout:"Circuit No. 15",
    start_finish_location:"upper_straight",
    start_finish_direction:"right",
    sector_colors:["#ef4444","#22d3ee","#facc15"],
    pit_lane_color:"#2563eb",
    contains_track_surface:true,
    contains_track_intel:true,
    visual_style:"single_raster_environment"
  })
});

export default HISTORICAL_TRACK_ENVIRONMENTS;
