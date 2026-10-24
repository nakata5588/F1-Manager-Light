// Interlagos long layout as raced in 1979–1980. Physical speed modelling,
// independent of the cartographic SVG. All fractional distances, severity
// and envelope widths below are ESTIMATES, not surveyed corner coordinates.
// Historical corner ordering: Prefeitura de Sao Paulo (history of Interlagos).
// https://prefeitura.sp.gov.br/web/autodromodeinterlagos/historia
// Historical long-layout revision/length: https://autodromodeinterlagos.prefeitura.sp.gov.br/circuito
// 1980 timing: https://www.formula1.com/en/results/1980/races/81/brazil/fastest-laps
//
// Anchors are deliberately provisional and must be calibrated with race
// benchmarks before merge. Do not use this for the post-1990 short circuit.
export const INTERLAGOS_1979_1980_TURNS=Object.freeze([
  ["Curva 1",0.055,0.27,0.018],
  ["Curva 2",0.092,0.30,0.018],
  ["Curva 3",0.230,0.63,0.028],
  ["Curva 4",0.269,0.40,0.020],
  ["Ferradura",0.333,0.90,0.037],
  ["Curva do Lago",0.397,0.45,0.022],
  ["Curva do Sol",0.463,0.23,0.025],
  ["Sargento",0.532,0.97,0.037],
  ["Laranja",0.582,0.44,0.019],
  ["S",0.632,0.82,0.023],
  ["Pinheirinho",0.676,0.83,0.025],
  ["Cotovelo / Bico de Pato",0.716,1.00,0.029],
  ["Mergulho",0.776,0.39,0.025],
  ["Juncao",0.846,0.60,0.024],
  ["Cafe",0.898,0.48,0.025],
].map(Object.freeze));

export function provisionalInterlagosSpeedProfile(trackId,year,lengthM,layoutId){
  const y=Number(year),length=Number(lengthM);
  if(String(trackId)!=="tr_0028"||String(layoutId)!=="tr_0028_long"||
     !Number.isFinite(y)||y<1979||y>1980||
     !Number.isFinite(length)||length<=0)return null;
  const count=Math.max(120,Math.min(180,Math.round(length/40)));
  const spacing=length/count;
  return {
    source:"historical_named_turn_reference_approximate",
    detailed:true,provisional:true,referenceEra:"1979-1980",
    referenceTurns:INTERLAGOS_1979_1980_TURNS.length,
    alignment:"unverified_normalized_distance_estimate",
    brakingModel:"distance_sensitive",
    cornerRetentionFactor:0.78,
    sampleSpacingM:Number(spacing.toFixed(6)),windowM:null,
    samples:Array.from({length:count},(_,i)=>{
      const fraction=i/count;
      let severity=0;
      for(const [,position,peak,width] of INTERLAGOS_1979_1980_TURNS){
        const delta=Math.abs(fraction-position);
        const wrapped=Math.min(delta,1-delta);
        const sigma=width*0.58;
        severity=Math.max(severity,peak*0.92*Math.exp(-0.5*(wrapped/sigma)**2));
      }
      return {
        distanceM:Number((i*spacing).toFixed(3)),
        severity:Number(severity.toFixed(4)),
      };
    }),
  };
}
