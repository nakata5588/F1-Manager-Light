// Albert Park 1996–2020: provisional physical speed profile, NOT surveyed geometry.
// Source: user-supplied 16-corner pre-2022 circuit diagram; compared with
// 2000 Atlas F1 contemporary lap guide and 2000 F1 lap-time references.
// https://atlasf1.autosport.com/2000/aus/preview/auslap.html
// https://www.formula1.com/en/results/2000/awards/fastest-laps
//
// Turn positions are approximate fractions of one lap (0=start/finish).
// Keep these separate from visual SVG geometry: a map image must never be
// silently labelled as precise racing-line provenance or trusted GPS data.
// Once a verified functional F1Track path is available, TrackModel derives
// speed severity from that path instead of using this provisional fallback.
const TURNS=Object.freeze([
  [1,0.085,0.94,0.017],
  [2,0.129,0.40,0.013],
  [3,0.214,1.00,0.018],
  [4,0.250,0.59,0.015],
  [5,0.288,0.24,0.012],
  [6,0.357,0.92,0.019],
  [7,0.399,0.22,0.013],
  [8,0.432,0.24,0.014],
  [9,0.510,0.94,0.019],
  [10,0.547,0.52,0.016],
  [11,0.648,0.61,0.018],
  [12,0.687,0.35,0.014],
  [13,0.775,0.89,0.020],
  [14,0.806,0.68,0.015],
  [15,0.855,0.93,0.019],
  [16,0.908,0.66,0.017],
]);

export const ALBERT_PARK_ORIGINAL_ERA=Object.freeze({
  trackId:"tr_0019",
  yearFrom:1996,
  yearTo:2020,
  corners:TURNS.length,
  source:"historical_turn_reference_approximate",
  // Speeds on straights are limited by preceding turns and acceleration,
  // not an arbitrary circuit-specific top-speed ceiling.
  cornerRetentionFactor:0.90,
  brakingModel:"distance_sensitive",
});

export function provisionalAlbertParkSpeedProfile(trackId,year,lengthM){
  const length=Number(lengthM);
  const yr=Number(year);
  if(
    String(trackId)!==ALBERT_PARK_ORIGINAL_ERA.trackId||
    !Number.isFinite(yr)||
    yr<ALBERT_PARK_ORIGINAL_ERA.yearFrom||
    yr>ALBERT_PARK_ORIGINAL_ERA.yearTo||
    !Number.isFinite(length)||length<=0
  )return null;

  const count=Math.max(100,Math.min(180,Math.round(length/35)));
  const spacing=length/count;
  const samples=Array.from({length:count},(_,i)=>{
    const fraction=i/count;
    let severity=0;
    for(const [,turnFraction,peak,width] of TURNS){
      const delta=Math.abs(fraction-turnFraction);
      const wrappedDelta=Math.min(delta,1-delta);
      // Narrow, physically located turn envelopes: braking distance is owned
      // by canonical RaceDynamics instead of making the whole approach a corner.
      const weight=Math.exp(-0.5*(wrappedDelta/(width*0.58))**2);
      severity=Math.max(severity,peak*0.92*weight);
    }
    return {
      distanceM:Number((i*spacing).toFixed(3)),
      severity:Number(severity.toFixed(4)),
    };
  });
  return {
    source:ALBERT_PARK_ORIGINAL_ERA.source,
    detailed:true,
    provisional:true,
    referenceEra:"1996-2020",
    referenceCorners:TURNS.length,
    sampleSpacingM:Number(spacing.toFixed(6)),
    windowM:null,
    cornerRetentionFactor:ALBERT_PARK_ORIGINAL_ERA.cornerRetentionFactor,
    brakingModel:ALBERT_PARK_ORIGINAL_ERA.brakingModel,
    samples,
  };
}
