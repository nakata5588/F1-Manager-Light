// src/domain/carComponents.js
// Canonical component catalogue and eligibility rules.
// UI, wear, development and AI should consume this module instead of
// hard-coding component lists.

const unwrap=(v)=>v&&typeof v==="object"&&!Array.isArray(v)?(v.result??v.value??null):v;
const pick=(o,keys,fb=undefined)=>{for(const key of keys){const v=unwrap(o?.[key]);if(v!==undefined&&v!==null&&v!=="")return v;}return fb;};
const num=(v,fb=NaN)=>{const n=Number(unwrap(v));return Number.isFinite(n)?n:fb;};

export const COMPONENT_FALLBACK_CATALOG=Object.freeze([
  {part_type:"chassis",label:"Chassis",era_start_year:1950,era_end_year:null,impact_area:"chassis",base_weight:165,base_drag:0.25,base_downforce:0.40,base_reliability:0.80},
  {part_type:"aero_front",label:"Front Wing",era_start_year:1968,era_end_year:null,impact_area:"aero",base_weight:10,base_drag:0.05,base_downforce:0.18,base_reliability:0.85},
  {part_type:"aero_rear",label:"Rear Wing",era_start_year:1968,era_end_year:null,impact_area:"aero",base_weight:12,base_drag:0.07,base_downforce:0.22,base_reliability:0.83},
  {part_type:"suspension",label:"Suspension",era_start_year:1950,era_end_year:null,impact_area:"chassis",base_weight:40,base_drag:0.03,base_downforce:0.10,base_reliability:0.78},
  {part_type:"gearbox",label:"Gearbox",era_start_year:1950,era_end_year:null,impact_area:"powertrain",base_weight:55,base_drag:0.02,base_downforce:0.05,base_reliability:0.75},
  {part_type:"brakes",label:"Brakes",era_start_year:1950,era_end_year:null,impact_area:"chassis",base_weight:20,base_drag:0.01,base_downforce:0.02,base_reliability:0.82},
  {part_type:"cooling",label:"Cooling",era_start_year:1950,era_end_year:null,impact_area:"cooling",base_weight:25,base_drag:0.04,base_downforce:0.00,base_reliability:0.80},
  {part_type:"turbocharger",label:"Turbocharger",era_start_year:1977,era_end_year:1988,impact_area:"powertrain",base_weight:18,base_drag:0.06,base_downforce:0.05,base_reliability:0.70},
  {part_type:"electronics",label:"Electronics",era_start_year:1990,era_end_year:null,impact_area:"reliability",base_weight:8,base_drag:0.01,base_downforce:0.00,base_reliability:0.85},
  {part_type:"kers",label:"KERS",era_start_year:2009,era_end_year:2013,impact_area:"hybrid",base_weight:30,base_drag:0.02,base_downforce:0.01,base_reliability:0.75},
  {part_type:"ers_mgu_k",label:"MGU-K",era_start_year:2014,era_end_year:null,impact_area:"hybrid",base_weight:35,base_drag:0.03,base_downforce:0.02,base_reliability:0.78},
  {part_type:"ers_mgu_h",label:"MGU-H",era_start_year:2014,era_end_year:2025,impact_area:"hybrid",base_weight:25,base_drag:0.02,base_downforce:0.01,base_reliability:0.70},
  {part_type:"battery_pack",label:"Battery Pack",era_start_year:2009,era_end_year:null,impact_area:"hybrid",base_weight:40,base_drag:0.02,base_downforce:0.00,base_reliability:0.80},
  {part_type:"fuel_system",label:"Fuel System",era_start_year:1950,era_end_year:null,impact_area:"powertrain",base_weight:22,base_drag:0.01,base_downforce:0.00,base_reliability:0.82},
  {part_type:"exhaust_system",label:"Exhaust System",era_start_year:1950,era_end_year:null,impact_area:"powertrain",base_weight:18,base_drag:0.02,base_downforce:0.01,base_reliability:0.80},
]);

export const COMPONENT_STAT_KEY=Object.freeze({
  chassis:"chassis_spec",
  aero_front:"aero_spec",
  aero_rear:"aero_spec",
  suspension:"suspension_spec",
  gearbox:"gearbox_spec",
  brakes:"brakes_spec",
  cooling:"cooling_spec",
  turbocharger:"turbo_spec",
  electronics:"electronics_spec",
  kers:"kers_spec",
  ers_mgu_k:"ers_mgu_k",
  ers_mgu_h:"ers_mgu_h",
  battery_pack:"battery_pack",
  fuel_system:null,
  exhaust_system:null,
});

const SPECIAL_TECH_SLOTS=new Set(["turbocharger","electronics","kers","ers_mgu_k","ers_mgu_h","battery_pack"]);

function teamIdOf(row){
  return String(pick(row,["team_id","team","constructor_id","constructor"],""));
}

function yearOf(gs){
  return Number(gs?.activeYear)||Number(String(gs?.currentDateISO||"").slice(0,4))||1980;
}

function rowForTeam(rows,teamId,year){
  const list=Array.isArray(rows)?rows:[];
  const exact=list.find((row)=>{
    if(teamIdOf(row)!==String(teamId??""))return false;
    const ry=num(pick(row,["year","season_year"],NaN),NaN);
    return !Number.isFinite(ry)||!Number.isFinite(year)||ry===year;
  });
  if(exact)return exact;
  return list.find((row)=>teamIdOf(row)===String(teamId??""))||null;
}

function normalizedCatalog(gs){
  const src=Array.isArray(gs?.dbCarParts)&&gs.dbCarParts.length
    ? gs.dbCarParts
    : Array.isArray(gs?.carParts)&&gs.carParts.length
      ? gs.carParts
      : COMPONENT_FALLBACK_CATALOG;
  const fallbackByType=new Map(COMPONENT_FALLBACK_CATALOG.map((row)=>[row.part_type,row]));
  return src.map((row)=>{
    const type=String(pick(row,["part_type","slot","type"],""));
    const fallback=fallbackByType.get(type)||{};
    return {
      ...fallback,
      ...row,
      part_type:type,
      label:pick(row,["label","name"],fallback.label||type),
      era_start_year:num(pick(row,["era_start_year","year_from"],fallback.era_start_year??1950),1950),
      era_end_year:pick(row,["era_end_year","year_to"],fallback.era_end_year??null),
      base_reliability:num(pick(row,["base_reliability"],fallback.base_reliability??0.8),0.8),
    };
  }).filter((row)=>row.part_type);
}

function explicitTechnologySupport(gs,teamId,slot){
  if(!SPECIAL_TECH_SLOTS.has(slot))return true;
  const year=yearOf(gs);
  const car=rowForTeam(gs?.carStats||gs?.dbCarStats||[],teamId,year)||{};
  const engine=rowForTeam(gs?.teamEngines||gs?.dbTeamEngines||[],teamId,year)||{};
  const statKey=COMPONENT_STAT_KEY[slot];
  const stat=statKey?num(car?.[statKey],NaN):NaN;

  if(Number.isFinite(stat))return stat>0;

  const engineText=[
    pick(engine,["engine_name","name"],""),
    pick(engine,["power_unit","supplier"],""),
  ].join(" ").toLowerCase();

  if(slot==="turbocharger")return /turbo|\bv6\s*t\b/.test(engineText);
  if(slot==="kers")return /kers/.test(engineText);
  if(slot==="ers_mgu_k")return /mgu[- ]?k|hybrid/.test(engineText);
  if(slot==="ers_mgu_h")return /mgu[- ]?h/.test(engineText);
  if(slot==="battery_pack") {
    return /hybrid|kers|mgu/.test(engineText) ||
      num(car?.kers_spec,NaN)>0 ||
      num(car?.ers_mgu_k,NaN)>0 ||
      num(car?.ers_mgu_h,NaN)>0;
  }
  if(slot==="electronics")return year>=1990;
  return false;
}

export function carComponentCatalog(gs){
  return normalizedCatalog(gs);
}

export function carComponentDefinition(gs,slot){
  return normalizedCatalog(gs).find((row)=>row.part_type===String(slot))||null;
}

export function componentEligibility(gs,teamId,slot){
  const definition=carComponentDefinition(gs,slot);
  if(!definition)return {available:false,reason:"not_in_catalog",definition:null};
  const year=yearOf(gs);
  const from=num(definition.era_start_year,1950);
  const toRaw=unwrap(definition.era_end_year);
  const to=toRaw==null||toRaw===""?Infinity:num(toRaw,Infinity);
  if(year<from||year>to)return {available:false,reason:"outside_era",definition};
  if(!explicitTechnologySupport(gs,teamId,slot))return {available:false,reason:"technology_not_fitted",definition};
  return {available:true,reason:"available",definition};
}

export function availableCarComponentSlots(gs,teamId){
  return normalizedCatalog(gs)
    .filter((row)=>componentEligibility(gs,teamId,row.part_type).available)
    .map((row)=>row.part_type);
}

export function componentLabel(gs,slot){
  return carComponentDefinition(gs,slot)?.label || String(slot||"").replaceAll("_"," ").replace(/\b\w/g,(m)=>m.toUpperCase());
}

export function componentGroup(slot){
  const key=String(slot||"");
  if(["chassis","aero_front","aero_rear","suspension"].includes(key))return "aero";
  return "mechanical";
}
