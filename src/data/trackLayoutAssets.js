import { HISTORICAL_TRACK_PRESENTATION_FALLBACKS } from "./historicalTrackGeometry.js";
import { HISTORICAL_TRACK_ENVIRONMENTS } from "./historicalTrackEnvironment.js";
import ARGENTINA_1974_1981_F1TRACK from "./tracks/tr_0018_1974_1981.f1track.js";
import { BUENOS_AIRES_NO2_F1TRACK, BUENOS_AIRES_NO9_F1TRACK, BUENOS_AIRES_NO6_F1TRACK } from "./tracks/tr_0018_historical_eras.f1track.js";
import ALBERT_PARK_1996_2020_F1TRACK from "./tracks/tr_0019_1996_2020.f1track.js";
import { INTERLAGOS_LONG_F1TRACK, INTERLAGOS_SHORT_F1TRACK } from "./tracks/tr_0028_interlagos.f1track.js";
import { IMOLA_F1TRACK_FAMILIES } from "./tracks/tr_0047_imola.f1track.js";
import { SILVERSTONE_F1TRACK_FAMILIES } from "./tracks/tr_0079_silverstone.f1track.js";
import { KYALAMI_F1TRACK_FAMILIES } from "./tracks/tr_0067_kyalami.f1track.js";
import { LONG_BEACH_F1TRACK_FAMILIES } from "./tracks/tr_0088_long_beach.f1track.js";
import { ZOLDER_F1TRACK_FAMILIES } from "./tracks/tr_0026_zolder.f1track.js";

const BUENOS_AIRES_ENVIRONMENT=HISTORICAL_TRACK_ENVIRONMENTS.tr_0018_provisional;

// User-supplied circuit artwork manifest. Historical ranges can be refined without changing callers.
export const TRACK_LAYOUT_ASSETS = [
  // Six UNIQUE Silverstone source centerlines for eight F1DB diagram labels;
  // -5/-6/-7 SVGs are byte-for-byte identical and are deduplicated.
  // Epoch-specific lap LENGTHS are facts on a single shared chronology.
  ...SILVERSTONE_F1TRACK_FAMILIES.map((pkg)=>({
    layout_id:pkg.layout_id,
    track_id:"tr_0079",
    label:pkg.name,
    track_package:pkg,
    year_from:pkg.year_from,
    year_to:pkg.year_to,
    reference_year:pkg.reference_year,
    geometry_exact_era_only:true,
    historical_status:"provisional",
    geometry_status:"derived_provisional",
    track_intelligence_status:"derived_provisional",
    lap_length_km:pkg.lap_length_km,
    race_direction:pkg.race_direction,
    start_finish_progress:pkg.intelligence.start_finish_progress,
    sector_boundaries:pkg.intelligence.sector_boundaries,
    pit_entry_progress:null,
    pit_exit_progress:null,
    environment_view_box:pkg.functional.view_box,
    source_label:pkg.functional.derivation,
  })),

  // Same physical venue (tr_0018); only real circuit configurations add geometry.
  // No. 2 was used in reverse for the 1954 GP: same shape, alternate direction.
  ...[BUENOS_AIRES_NO2_F1TRACK,BUENOS_AIRES_NO9_F1TRACK,BUENOS_AIRES_NO6_F1TRACK].map((pkg)=>({
    layout_id:pkg.layout_id,
    track_id:"tr_0018",
    label:pkg.name,
    track_package:pkg,
    year_from:pkg.year_from,
    year_to:pkg.year_to,
    reference_year:pkg.reference_year,
    geometry_exact_era_only:true,
    historical_status:"provisional",
    geometry_status:"derived_provisional",
    track_intelligence_status:"derived_provisional",
    lap_length_km:pkg.lap_length_km,
    race_direction:pkg.race_direction,
    start_finish_progress:pkg.intelligence.start_finish_progress,
    sector_boundaries:pkg.intelligence.sector_boundaries,
    pit_entry_progress:null,
    pit_exit_progress:null,
    environment_view_box:pkg.functional.view_box,
    reverse_direction_years:pkg.layout_id==="tr_0018_no2"?[1954]:[],
    source_label:"F1DB Buenos Aires historical map (Jules Roy CC BY 4.0); provisional display line, not GPS"
  })),
    {
    "layout_id": "tr_0018_provisional",
    "track_id": "tr_0018",
    "geometry_exact_era_only":true,
    "label": "Buenos Aires — Circuit No. 15",
    "track_package": ARGENTINA_1974_1981_F1TRACK,
    "year_from": ARGENTINA_1974_1981_F1TRACK.year_from,
    "year_to": ARGENTINA_1974_1981_F1TRACK.year_to,
    "reference_year": ARGENTINA_1974_1981_F1TRACK.reference_year,
    "environment": BUENOS_AIRES_ENVIRONMENT,
    "presentation_fallback_geometry": HISTORICAL_TRACK_PRESENTATION_FALLBACKS.tr_0018_provisional,
    "asset": null,
    "environment_view_box": BUENOS_AIRES_ENVIRONMENT.view_box,
    "environment_transform": BUENOS_AIRES_ENVIRONMENT.calibration_transform,
    "historical_status": "verified",
    "geometry_status": "historical_verified",
    "lap_length_km": ARGENTINA_1974_1981_F1TRACK.lap_length_km,
    "start_finish_progress": ARGENTINA_1974_1981_F1TRACK.intelligence.start_finish_progress,
    "sector_boundaries": ARGENTINA_1974_1981_F1TRACK.intelligence.sector_boundaries,
    "race_direction": ARGENTINA_1974_1981_F1TRACK.race_direction,
    "start_finish_direction": ARGENTINA_1974_1981_F1TRACK.start_finish_direction,
    "pit_entry_progress": ARGENTINA_1974_1981_F1TRACK.intelligence.pit_entry_progress,
    "pit_exit_progress": ARGENTINA_1974_1981_F1TRACK.intelligence.pit_exit_progress,
    "sector_colors": ARGENTINA_1974_1981_F1TRACK.intelligence.sector_colors,
    "pit_lane_color": ARGENTINA_1974_1981_F1TRACK.intelligence.pit_lane_color,
    "environment_contains_track_surface": BUENOS_AIRES_ENVIRONMENT.contains_track_surface,
    "environment_contains_track_intel": BUENOS_AIRES_ENVIRONMENT.contains_track_intel,
    "track_intelligence_status": "historical_verified",
    "source_label": "Buenos Aires Circuit No. 15 — unified F1Track package with functional, minimap and procedural race-view layers"
  },
  {
    "layout_id":"tr_0019_1996_2020",
    "track_id":"tr_0019",
    "label":"Albert Park — original 16-turn layout",
    "track_package":ALBERT_PARK_1996_2020_F1TRACK,
    "year_from":1996,
    "year_to":2020,
    "reference_year":2000,
    "historical_status":"provisional",
    "geometry_status":"derived_provisional",
    // Unlike 1980 generic fallback assets, never show the old circuit for 2022+.
    "geometry_exact_era_only":true,
    "track_intelligence_status":"derived_provisional",
    "lap_length_km":ALBERT_PARK_1996_2020_F1TRACK.lap_length_km,
    "race_direction":ALBERT_PARK_1996_2020_F1TRACK.race_direction,
    "start_finish_direction":ALBERT_PARK_1996_2020_F1TRACK.start_finish_direction,
    "start_finish_progress":ALBERT_PARK_1996_2020_F1TRACK.intelligence.start_finish_progress,
    "sector_boundaries":ALBERT_PARK_1996_2020_F1TRACK.intelligence.sector_boundaries,
    "pit_entry_progress":ALBERT_PARK_1996_2020_F1TRACK.intelligence.pit_entry_progress,
    "pit_exit_progress":ALBERT_PARK_1996_2020_F1TRACK.intelligence.pit_exit_progress,
    "sector_colors":ALBERT_PARK_1996_2020_F1TRACK.intelligence.sector_colors,
    "pit_lane_color":ALBERT_PARK_1996_2020_F1TRACK.intelligence.pit_lane_color,
    "environment_view_box":ALBERT_PARK_1996_2020_F1TRACK.functional.view_box,
    "source_label":"F1DB melbourne-1 (Jules Roy, CC BY 4.0), 1996–2019 vector map; visually derived, not surveyed GPS"
  },
  // Interlagos keeps ONE track ID; only the large 1990 redesign creates a new line.
  {
    "layout_id":"tr_0028_long",
    "track_id":"tr_0028",
    "label":"Interlagos — original long Grand Prix circuit",
    "track_package":INTERLAGOS_LONG_F1TRACK,
    "year_from":1973,
    "year_to":1989,
    "reference_year":1980,
    "geometry_exact_era_only":true,
    "historical_status":"provisional",
    "geometry_status":"derived_provisional",
    "track_intelligence_status":"derived_provisional",
    "lap_length_km":INTERLAGOS_LONG_F1TRACK.lap_length_km,
    "race_direction":INTERLAGOS_LONG_F1TRACK.race_direction,
    "start_finish_direction":INTERLAGOS_LONG_F1TRACK.start_finish_direction,
    "start_finish_progress":INTERLAGOS_LONG_F1TRACK.intelligence.start_finish_progress,
    "sector_boundaries":INTERLAGOS_LONG_F1TRACK.intelligence.sector_boundaries,
    "pit_entry_progress":null,
    "pit_exit_progress":null,
    "environment_view_box":INTERLAGOS_LONG_F1TRACK.functional.view_box,
    "source_label":"F1DB interlagos-1 (Jules Roy, CC BY 4.0), long GP circuit — illustrative, not surveyed GPS"
  },
  {
    "layout_id":"tr_0028_short",
    "track_id":"tr_0028",
    "label":"Interlagos — short Grand Prix circuit",
    "track_package":INTERLAGOS_SHORT_F1TRACK,
    "year_from":1990,
    "year_to":2099,
    "reference_year":2000,
    "geometry_exact_era_only":true,
    "historical_status":"provisional",
    "geometry_status":"derived_provisional",
    "track_intelligence_status":"derived_provisional",
    "lap_length_km":INTERLAGOS_SHORT_F1TRACK.lap_length_km,
    "race_direction":INTERLAGOS_SHORT_F1TRACK.race_direction,
    "start_finish_direction":INTERLAGOS_SHORT_F1TRACK.start_finish_direction,
    "start_finish_progress":INTERLAGOS_SHORT_F1TRACK.intelligence.start_finish_progress,
    "sector_boundaries":INTERLAGOS_SHORT_F1TRACK.intelligence.sector_boundaries,
    "pit_entry_progress":null,
    "pit_exit_progress":null,
    "environment_view_box":INTERLAGOS_SHORT_F1TRACK.functional.view_box,
    "source_label":"F1DB interlagos-2 (Jules Roy, CC BY 4.0), short GP circuit since 1990 — illustrative, not surveyed GPS"
  },
  // Exactly two championship F1 route families for Kyalami.
  // 1968 distance change is a fact, NOT a third new outline.
  ...KYALAMI_F1TRACK_FAMILIES.map((pkg)=>({
    layout_id:pkg.layout_id,track_id:"tr_0067",label:pkg.name,
    track_package:pkg,year_from:pkg.year_from,year_to:pkg.year_to,
    reference_year:pkg.reference_year,geometry_exact_era_only:true,
    historical_status:"provisional",geometry_status:"derived_provisional",
    track_intelligence_status:"derived_provisional",
    lap_length_km:pkg.lap_length_km,race_direction:pkg.race_direction,
    start_finish_progress:pkg.intelligence.start_finish_progress,
    sector_boundaries:pkg.intelligence.sector_boundaries,
    pit_entry_progress:null,pit_exit_progress:null,
    environment_view_box:pkg.functional.view_box,source_label:pkg.functional.derivation,
  })),
  {"layout_id":"tr_0067_provisional","track_id":"tr_0067","geometry_exact_era_only":true,"label":"Kyalami","year_from":2016,"year_to":2016,"reference_year":2016,"asset":null,"historical_status":"provisional","geometry_status":"derived_provisional","source_label":"2016 Circuit"},
  // Original GP street course 1976–81, 1982 and 1983: one tr_0088.
  ...LONG_BEACH_F1TRACK_FAMILIES.map((pkg)=>({
    layout_id:pkg.layout_id,track_id:"tr_0088",label:pkg.name,
    track_package:pkg,year_from:pkg.year_from,year_to:pkg.year_to,
    reference_year:pkg.reference_year,geometry_exact_era_only:true,
    historical_status:"provisional",geometry_status:"derived_provisional",
    track_intelligence_status:"derived_provisional",
    lap_length_km:pkg.lap_length_km,race_direction:pkg.race_direction,
    start_finish_progress:pkg.intelligence.start_finish_progress,
    sector_boundaries:pkg.intelligence.sector_boundaries,
    pit_entry_progress:null,pit_exit_progress:null,
    environment_view_box:pkg.functional.view_box,
    source_label:pkg.functional.derivation,
  })),
  {"layout_id":"tr_0088_provisional","track_id":"tr_0088","geometry_exact_era_only":true,"label":"Long Beach","year_from":2000,"year_to":2000,"reference_year":2000,"asset":null,"historical_status":"provisional","geometry_status":"derived_provisional","source_label":"2000 Circuit"},
  // Two sourced F1-era road courses; later pit lane upgrades are NOT
  // unsupported extra physical layouts. One canonical ID tr_0026.
  ...ZOLDER_F1TRACK_FAMILIES.map((pkg)=>({
    layout_id:pkg.layout_id,track_id:"tr_0026",label:pkg.name,
    track_package:pkg,year_from:pkg.year_from,year_to:pkg.year_to,
    reference_year:pkg.reference_year,geometry_exact_era_only:true,
    historical_status:"provisional",geometry_status:"derived_provisional",
    track_intelligence_status:"derived_provisional",
    lap_length_km:pkg.lap_length_km,race_direction:pkg.race_direction,
    start_finish_progress:pkg.intelligence.start_finish_progress,
    sector_boundaries:pkg.intelligence.sector_boundaries,
    pit_entry_progress:null,pit_exit_progress:null,
    environment_view_box:pkg.functional.view_box,source_label:pkg.functional.derivation,
  })),
  {"layout_id":"tr_0026_provisional","track_id":"tr_0026","geometry_exact_era_only":true,"label":"Zolder","year_from":null,"year_to":null,"reference_year":null,"asset":null,"historical_status":"provisional","geometry_status":"derived_provisional","source_label":"User supplied SVG; source year not encoded"},
  {"layout_id":"tr_0056_provisional","track_id":"tr_0056","label":"Monaco","year_from":null,"year_to":null,"reference_year":null,"asset":null,"historical_status":"provisional","geometry_status":"derived_provisional","source_label":"User supplied SVG; source year not encoded"},
  {"layout_id":"tr_0035_provisional","track_id":"tr_0035","label":"Paul Ricard","year_from":null,"year_to":null,"reference_year":null,"asset":null,"historical_status":"provisional","geometry_status":"derived_provisional","source_label":"User supplied SVG; source year not encoded"},
  {"layout_id":"tr_0081_provisional","track_id":"tr_0081","label":"Brands Hatch","year_from":null,"year_to":null,"reference_year":null,"asset":null,"historical_status":"provisional","geometry_status":"derived_provisional","source_label":"User supplied SVG; source year not encoded"},
  {"layout_id":"tr_0041_provisional","track_id":"tr_0041","label":"Hockenheim","year_from":2002,"year_to":2002,"reference_year":2002,"asset":null,"historical_status":"provisional","geometry_status":"derived_provisional","source_label":"2002 Circuit"},
  {"layout_id":"tr_0022_provisional","track_id":"tr_0022","label":"Austria","year_from":null,"year_to":null,"reference_year":null,"asset":null,"historical_status":"provisional","geometry_status":"derived_provisional","source_label":"User supplied SVG; source year not encoded"},
  {"layout_id":"tr_0058_provisional","track_id":"tr_0058","label":"Zandvoort","year_from":null,"year_to":null,"reference_year":null,"asset":null,"historical_status":"provisional","geometry_status":"derived_provisional","source_label":"User supplied SVG; source year not encoded"},
  // Same tr_0047 identity for every era. 1953/1973 are explicitly schematic:
  // no claim that a later-era F1DB SVG contains surveyed earlier chicanes.
  ...IMOLA_F1TRACK_FAMILIES.map((pkg)=>({
    layout_id:pkg.layout_id,
    track_id:"tr_0047",
    label:pkg.name,
    track_package:pkg,
    year_from:pkg.year_from,
    year_to:pkg.year_to,
    reference_year:pkg.reference_year,
    geometry_exact_era_only:true,
    historical_status:"provisional",
    geometry_status:pkg.functional.quality,
    track_intelligence_status:"derived_provisional",
    lap_length_km:pkg.lap_length_km,
    race_direction:pkg.race_direction,
    start_finish_direction:pkg.start_finish_direction,
    start_finish_progress:pkg.intelligence.start_finish_progress,
    sector_boundaries:pkg.intelligence.sector_boundaries,
    pit_entry_progress:null,
    pit_exit_progress:null,
    environment_view_box:pkg.functional.view_box,
    source_label:pkg.functional.derivation,
  })),
  {"layout_id":"tr_0030_provisional","track_id":"tr_0030","label":"Montreal","year_from":null,"year_to":null,"reference_year":null,"asset":null,"historical_status":"provisional","geometry_status":"derived_provisional","source_label":"User supplied SVG; source year not encoded"},
  {"layout_id":"tr_0090_provisional","track_id":"tr_0090","label":"Watkins Glen","year_from":null,"year_to":null,"reference_year":null,"asset":null,"historical_status":"provisional","geometry_status":"derived_provisional","source_label":"Long GP Circuit w/chicane"}
];

export default TRACK_LAYOUT_ASSETS;
