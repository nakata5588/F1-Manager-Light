import { TRACK_LAYOUT_GEOMETRY } from "./trackLayoutGeometry.js";
import ARGENTINA_1974_1981_F1TRACK from "./tracks/tr_0018_1974_1981.f1track.js";
import { BUENOS_AIRES_NO2_F1TRACK, BUENOS_AIRES_NO9_F1TRACK, BUENOS_AIRES_NO6_F1TRACK } from "./tracks/tr_0018_historical_eras.f1track.js";
import ALBERT_PARK_1996_2020_F1TRACK from "./tracks/tr_0019_1996_2020.f1track.js";
import { INTERLAGOS_LONG_F1TRACK, INTERLAGOS_SHORT_F1TRACK } from "./tracks/tr_0028_interlagos.f1track.js";
import { IMOLA_F1TRACK_FAMILIES } from "./tracks/tr_0047_imola.f1track.js";
import { SILVERSTONE_F1TRACK_FAMILIES } from "./tracks/tr_0079_silverstone.f1track.js";

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
  tr_0018_no2:freezeGeometry(BUENOS_AIRES_NO2_F1TRACK.functional,"derived_provisional"),
  tr_0018_no9:freezeGeometry(BUENOS_AIRES_NO9_F1TRACK.functional,"derived_provisional"),
  tr_0018_no6_senna:freezeGeometry(BUENOS_AIRES_NO6_F1TRACK.functional,"derived_provisional"),
  tr_0018_provisional:freezeGeometry({
    ...ARGENTINA_1974_1981_F1TRACK.functional,
    race_direction:ARGENTINA_1974_1981_F1TRACK.race_direction,
    start_finish_direction:ARGENTINA_1974_1981_F1TRACK.start_finish_direction,
    source_package:ARGENTINA_1974_1981_F1TRACK.package_id,
  },"historical_verified"),
  tr_0019_1996_2020:freezeGeometry(ALBERT_PARK_1996_2020_F1TRACK.functional,"derived_provisional"),
  tr_0028_long:freezeGeometry(INTERLAGOS_LONG_F1TRACK.functional,"derived_provisional"),
  tr_0028_short:freezeGeometry(INTERLAGOS_SHORT_F1TRACK.functional,"derived_provisional"),
  ...Object.fromEntries(IMOLA_F1TRACK_FAMILIES.map((pkg)=>[
    pkg.layout_id,freezeGeometry(pkg.functional,pkg.functional.quality)
  ])),
  ...Object.fromEntries(SILVERSTONE_F1TRACK_FAMILIES.map((pkg)=>[
    pkg.layout_id,freezeGeometry(pkg.functional,pkg.functional.quality)
  ]))
});

Object.assign(TRACK_LAYOUT_GEOMETRY,HISTORICAL_TRACK_GEOMETRY);

export default HISTORICAL_TRACK_GEOMETRY;
