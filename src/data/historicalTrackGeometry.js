import { TRACK_LAYOUT_GEOMETRY } from "./trackLayoutGeometry.js";
import ARGENTINA_1974_1981_F1TRACK from "./tracks/tr_0018_1974_1981.f1track.js";

const freezeGeometry=(geometry,quality)=>Object.freeze({
  ...geometry,
  view_box:Object.freeze([...(geometry?.view_box||[0,0,1000,1000])]),
  points:Object.freeze((geometry?.points||[]).map((point)=>Object.freeze([...point]))),
  pit_lane_points:Array.isArray(geometry?.pit_lane_points)
    ?Object.freeze(geometry.pit_lane_points.map((point)=>Object.freeze([...point])))
    :undefined,
  quality,
});

const LEGACY_BUENOS_AIRES_GEOMETRY=freezeGeometry(
  ARGENTINA_1974_1981_F1TRACK.minimap,
  "legacy_presentation_fallback"
);

export const HISTORICAL_TRACK_PRESENTATION_FALLBACKS=Object.freeze({
  tr_0018_provisional:LEGACY_BUENOS_AIRES_GEOMETRY
});

export const HISTORICAL_TRACK_GEOMETRY=Object.freeze({
  tr_0018_provisional:freezeGeometry({
    ...ARGENTINA_1974_1981_F1TRACK.functional,
    race_direction:ARGENTINA_1974_1981_F1TRACK.race_direction,
    start_finish_direction:ARGENTINA_1974_1981_F1TRACK.start_finish_direction,
    source_package:ARGENTINA_1974_1981_F1TRACK.package_id,
  },"historical_verified")
});

Object.assign(TRACK_LAYOUT_GEOMETRY,HISTORICAL_TRACK_GEOMETRY);

export default HISTORICAL_TRACK_GEOMETRY;
