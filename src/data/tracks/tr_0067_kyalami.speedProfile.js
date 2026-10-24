// Original Kyalami, clockwise: nine named bends, 1967–1985.
// References: https://sahistory.org.za/place/kyalami-grand-prix-circuit
// https://www.gdecarli.it/php2/circuit.php?var1=713&var2=2
// Position/width/severity numbers are PROVISIONAL simulation estimates,
// not verified historical GPS, timing, telemetric or SVG-derived physics.
// The circuit's cartographic SVG is visual only, not this source.
export const KYALAMI_TURNS=Object.freeze([
  ["Kink",0.065,0.20,0.014],
  ["Crowthorne",0.230,0.94,0.045],
  ["Barbeque",0.345,0.48,0.030],
  ["Jukskei",0.440,0.42,0.033],
  ["Sunset",0.535,0.52,0.034],
  ["Clubhouse",0.642,0.93,0.045],
  ["Esses 1",0.739,0.70,0.023],
  ["Esses 2",0.772,0.77,0.023],
  ["Leeukop",0.892,0.94,0.048],
].map(Object.freeze));
export function provisionalKyalamiSpeedProfile(trackId,year,lengthM,layoutId){
  const y=Number(year),length=Number(lengthM);
  if(String(trackId)!=="tr_0067"||String(layoutId)!=="tr_0067_original"||
     !Number.isFinite(y)||y<1967||y>1985||
     !Number.isFinite(length)||length<=0)return null;
  const count=Math.max(100,Math.min(180,Math.round(length/35))),spacing=length/count;
  return {
    source:"historical_named_turn_reference_approximate",
    detailed:true,provisional:true,referenceEra:"1967-1985",
    referenceTurns:9,alignment:"unverified_normalized_distance_estimate",
    brakingModel:"distance_sensitive",cornerRetentionFactor:0.83,
    sampleSpacingM:Number(spacing.toFixed(6)),windowM:null,
    samples:Array.from({length:count},(_,i)=>{
      const fraction=i/count;
      let severity=0;
      for(const [,position,peak,width] of KYALAMI_TURNS){
        const d=Math.abs(fraction-position),wrapped=Math.min(d,1-d);
        const sigma=width*1.3*0.58;
        severity=Math.max(severity,peak*0.92*Math.exp(-0.5*(wrapped/sigma)**2));
      }
      return {distanceM:Number((i*spacing).toFixed(3)),
        severity:Number(severity.toFixed(4))};
    }),
  };
}
