import "./historicalTrackGeometry.js";

// User-supplied circuit artwork manifest. Historical ranges can be refined without changing callers.
export const TRACK_LAYOUT_ASSETS = [
  {
    "layout_id": "tr_0018_provisional",
    "track_id": "tr_0018",
    "label": "Buenos Aires — Circuit No. 15",
    "year_from": 1974,
    "year_to": 1981,
    "reference_year": 1980,
    "asset": "/tracks/historical/buenos-aires-no15-1980.svg",
    "environment_view_box": [0,0,1649,954],
    "historical_status": "verified",
    "geometry_status": "historical_verified",
    "lap_length_km": 5.968,
    "start_finish_progress": 0,
    "sector_boundaries": [0.3246,0.6940],
    "race_direction": "clockwise",
    "start_finish_direction": "right",
    "pit_entry_progress": 0.9499,
    "pit_exit_progress": 0.0789,
    "sector_colors": ["#ef4444","#22d3ee","#facc15"],
    "pit_lane_color": "#2563eb",
    "track_intelligence_status": "historical_verified",
    "source_label": "Buenos Aires Circuit No. 15 — 1980 historical environment; functional centreline remains engine-independent"
  },
  {"layout_id":"tr_0028_provisional","track_id":"tr_0028","label":"Interlagos","year_from":null,"year_to":null,"reference_year":null,"asset":null,"historical_status":"provisional","geometry_status":"derived_provisional","source_label":"User supplied SVG; source year not encoded"},
  {"layout_id":"tr_0067_provisional","track_id":"tr_0067","label":"Kyalami","year_from":2016,"year_to":2016,"reference_year":2016,"asset":null,"historical_status":"provisional","geometry_status":"derived_provisional","source_label":"2016 Circuit"},
  {"layout_id":"tr_0088_provisional","track_id":"tr_0088","label":"Long Beach","year_from":2000,"year_to":2000,"reference_year":2000,"asset":null,"historical_status":"provisional","geometry_status":"derived_provisional","source_label":"2000 Circuit"},
  {"layout_id":"tr_0026_provisional","track_id":"tr_0026","label":"Zolder","year_from":null,"year_to":null,"reference_year":null,"asset":null,"historical_status":"provisional","geometry_status":"derived_provisional","source_label":"User supplied SVG; source year not encoded"},
  {"layout_id":"tr_0056_provisional","track_id":"tr_0056","label":"Monaco","year_from":null,"year_to":null,"reference_year":null,"asset":null,"historical_status":"provisional","geometry_status":"derived_provisional","source_label":"User supplied SVG; source year not encoded"},
  {"layout_id":"tr_0035_provisional","track_id":"tr_0035","label":"Paul Ricard","year_from":null,"year_to":null,"reference_year":null,"asset":null,"historical_status":"provisional","geometry_status":"derived_provisional","source_label":"User supplied SVG; source year not encoded"},
  {"layout_id":"tr_0081_provisional","track_id":"tr_0081","label":"Brands Hatch","year_from":null,"year_to":null,"reference_year":null,"asset":null,"historical_status":"provisional","geometry_status":"derived_provisional","source_label":"User supplied SVG; source year not encoded"},
  {"layout_id":"tr_0041_provisional","track_id":"tr_0041","label":"Hockenheim","year_from":2002,"year_to":2002,"reference_year":2002,"asset":null,"historical_status":"provisional","geometry_status":"derived_provisional","source_label":"2002 Circuit"},
  {"layout_id":"tr_0022_provisional","track_id":"tr_0022","label":"Austria","year_from":null,"year_to":null,"reference_year":null,"asset":null,"historical_status":"provisional","geometry_status":"derived_provisional","source_label":"User supplied SVG; source year not encoded"},
  {"layout_id":"tr_0058_provisional","track_id":"tr_0058","label":"Zandvoort","year_from":null,"year_to":null,"reference_year":null,"asset":null,"historical_status":"provisional","geometry_status":"derived_provisional","source_label":"User supplied SVG; source year not encoded"},
  {"layout_id":"tr_0047_provisional","track_id":"tr_0047","label":"Imola","year_from":null,"year_to":null,"reference_year":null,"asset":null,"historical_status":"provisional","geometry_status":"derived_provisional","source_label":"User supplied SVG; source year not encoded"},
  {"layout_id":"tr_0030_provisional","track_id":"tr_0030","label":"Montreal","year_from":null,"year_to":null,"reference_year":null,"asset":null,"historical_status":"provisional","geometry_status":"derived_provisional","source_label":"User supplied SVG; source year not encoded"},
  {"layout_id":"tr_0090_provisional","track_id":"tr_0090","label":"Watkins Glen","year_from":null,"year_to":null,"reference_year":null,"asset":null,"historical_status":"provisional","geometry_status":"derived_provisional","source_label":"Long GP Circuit w/chicane"}
];

export default TRACK_LAYOUT_ASSETS;
