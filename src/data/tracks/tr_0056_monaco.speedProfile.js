// Monaco 1976–1985: historically named turns, provisional physical severity envelope.
// Track family and length: tr_0056_1976_1985, 3.312 km in 1980.
// FIA historical changes: https://www.fia.com/sites/default/files/dossier_media_gpf1_2021_fr.pdf
// Circuit historical turn sequence: https://www.monte-carlo.mc/en/grand-prix-monaco/circuit-monaco/
// 1980 lap/race timing: https://www.formula1.com/en/results/1980/races/85/monaco/fastest-laps
// WARNING: The positions, widths and severity values are CALIBRATION ESTIMATES,
// NOT surveyed distances, FIA braking points, 1980 telemetry, or SVG-derived physics.
// The post-1986 harbour chicane and post-1997 Piscine must NOT inherit this model.
export const MONACO_1976_1985_TURNS=Object.freeze([
  ["Sainte Devote",0.044,0.78,0.016],
  ["Massenet",0.168,0.52,0.023],
  ["Casino",0.202,0.70,0.018],
  ["Mirabeau",0.285,0.88,0.018],
  ["Loews hairpin",0.330,1.00,0.023],
  ["Mirabeau Bas",0.367,0.77,0.014],
  ["Portier",0.413,0.79,0.018],
  ["Harbour chicane (pre-1986)",0.605,0.94,0.028],
  ["Tabac",0.690,0.63,0.017],
  ["Piscine first chicane (pre-1997)",0.752,0.69,0.021],
  ["Piscine second chicane",0.813,0.81,0.018],
  ["Rascasse",0.895,0.98,0.027],
  ["Anthony Noghes",0.953,0.87,0.020],
].map(Object.freeze));

export function provisionalMonacoSpeedProfile(trackId,year,lengthM,layoutId){
  const y=Number(year),length=Number(lengthM);
  if(String(trackId)!=="tr_0056"||String(layoutId)!=="tr_0056_1976_1985"||
    !Number.isInteger(y)||y<1976||y>1985||
    !Number.isFinite(length)||Math.abs(length-3312)>80)return null;
  const count=144,spacing=length/count;
  return {
    source:"historical_named_turn_reference_approximate",
    detailed:true,provisional:true,referenceEra:"1976-1985",
    referenceTurns:MONACO_1976_1985_TURNS.length,
    alignment:"unverified_normalized_distance_estimate",
    brakingModel:"distance_sensitive",
    cornerRetentionFactor:0.72,
    sampleSpacingM:Number(spacing.toFixed(6)),windowM:null,
    samples:Array.from({length:count},(_,i)=>{
      const fraction=i/count;
      let severity=0;
      for(const [,position,peak,width] of MONACO_1976_1985_TURNS){
        const delta=Math.abs(fraction-position);
        const wrapped=Math.min(delta,1-delta);
        severity=Math.max(severity,peak*0.95*Math.exp(-0.5*(wrapped/(width*0.65))**2));
      }
      return {distanceM:Number((i*spacing).toFixed(3)),severity:Number(severity.toFixed(4))};
    }),
  };
}
