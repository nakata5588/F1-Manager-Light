// src/domain/driverDerivedRatings.js
// Canonical derived driver ratings used by presentation/comparison surfaces
// and, where explicitly appropriate, as read-model inputs to simulation.
// These are composites of existing permanent attributes; they are NOT new
// persisted driver attributes and do not replace their underlying raw inputs.

const DEFINITIONS=Object.freeze({
  overtaking:Object.freeze({
    label:"Overtaking",
    weights:Object.freeze({
      racecraft:0.40,
      aggression:0.30,
      race_intelligence:0.20,
      pressure_handling:0.10,
    }),
  }),
  defending:Object.freeze({
    label:"Defending",
    weights:Object.freeze({
      racecraft:0.45,
      consistency:0.25,
      mentality:0.20,
      aggression:0.10,
    }),
  }),
  strategy_intelligence:Object.freeze({
    label:"Strategy Intelligence",
    weights:Object.freeze({
      race_intelligence:0.40,
      technical_feedback:0.25,
      adaptability:0.20,
      mentality:0.15,
    }),
  }),
  setup_feedback:Object.freeze({
    label:"Setup Feedback",
    weights:Object.freeze({
      technical_feedback:0.60,
      adaptability:0.20,
      mentality:0.20,
    }),
  }),
  development_impact:Object.freeze({
    label:"Development Impact",
    weights:Object.freeze({
      technical_feedback:0.30,
      leadership:0.20,
      car_development_impact:0.50,
    }),
  }),
  mistake_propensity:Object.freeze({
    label:"Mistake Propensity",
    inverse:true,
    // Special inverse-risk composite. The weights document influence; the
    // implementation below converts "better is higher" traits into risk and
    // treats aggression only as excess risk above a controlled threshold.
    weights:Object.freeze({
      crash_likelihood:0.30,
      consistency:0.20,
      pressure_handling:0.15,
      race_intelligence:0.15,
      racecraft:0.07,
      adaptability:0.05,
      mentality:0.05,
      aggression:0.03,
    }),
  }),
});

function unwrap(value){
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    if(value.result!==undefined&&value.result!==null&&value.result!=="")return unwrap(value.result);
    if(value.value!==undefined&&value.value!==null&&value.value!=="")return unwrap(value.value);
  }
  return value;
}
function clamp(value,min=0,max=100){
  return Math.max(min,Math.min(max,Number(value)||0));
}
function round1(value){
  return Number(Number(value||0).toFixed(1));
}
function numericAttribute(attrs,key){
  if(!attrs)return null;
  const aliases=key==="aggression"?["aggression","agression"]:[key];
  for(const alias of aliases){
    const raw=unwrap(attrs?.[alias]);
    if(raw===null||raw===undefined||String(raw).trim()==="")continue;
    const value=Number(raw);
    if(Number.isFinite(value))return clamp(value);
  }
  return null;
}
function inverseRisk(value){
  return 100-value;
}
function aggressionRisk(value){
  // Aggression is not itself a mistake. Only unusually high aggression adds a
  // small risk signal; 65 or below contributes no additional propensity.
  return clamp((value-65)*(100/35));
}
function mistakeBaseline(attrs){
  const crash=numericAttribute(attrs,"crash_likelihood");
  const consistency=numericAttribute(attrs,"consistency");
  const pressure=numericAttribute(attrs,"pressure_handling");
  const intelligence=numericAttribute(attrs,"race_intelligence");
  const racecraft=numericAttribute(attrs,"racecraft");
  const adaptability=numericAttribute(attrs,"adaptability");
  const mentality=numericAttribute(attrs,"mentality");
  const aggression=numericAttribute(attrs,"aggression");
  if([crash,consistency,pressure,intelligence,racecraft,adaptability,mentality,aggression].some((value)=>value===null)){
    return null;
  }
  return round1(
    crash*0.30+
    inverseRisk(consistency)*0.20+
    inverseRisk(pressure)*0.15+
    inverseRisk(intelligence)*0.15+
    inverseRisk(racecraft)*0.07+
    inverseRisk(adaptability)*0.05+
    inverseRisk(mentality)*0.05+
    aggressionRisk(aggression)*0.03
  );
}
function evidenceSortKey(entry){
  return [
    String(entry?.dateISO||""),
    String(Number(entry?.year)||0).padStart(4,"0"),
    String(Number(entry?.round)||0).padStart(3,"0"),
    String(entry?.gp_id||entry?.gp_name||""),
  ].join("|");
}
function mistakeEvidence(performanceEntries=[]){
  const entries=(Array.isArray(performanceEntries)?performanceEntries:[])
    .slice()
    .sort((a,b)=>evidenceSortKey(b).localeCompare(evidenceSortKey(a)))
    .slice(0,12);

  let eligibleWeight=0;
  let driverErrorWeight=0;
  let sample=0;
  let confirmedDriverErrors=0;

  entries.forEach((entry,index)=>{
    const responsibility=String(entry?.incident_responsibility??entry?.retirement_responsibility??"").toLowerCase();
    const hasUnclassifiedIncident=Boolean(
      entry?.retired||
      entry?.retirement_reason||
      entry?.incident_kind||
      entry?.incident_reason
    );
    const weight=Math.pow(0.90,index);

    if(responsibility==="driver_error"){
      eligibleWeight+=weight;
      driverErrorWeight+=weight;
      confirmedDriverErrors+=1;
      sample+=1;
      return;
    }
    if(
      responsibility==="mechanical"||
      responsibility==="racing_incident"||
      responsibility==="unknown"||
      hasUnclassifiedIncident
    ){
      return;
    }

    // A classified clean race is weak positive evidence: it dilutes recent
    // confirmed errors without ever turning historical ambiguity into praise.
    eligibleWeight+=weight;
    sample+=1;
  });

  // Six pseudo-races pull small samples toward the attribute baseline. The
  // recent-evidence overlay is deliberately capped because crash_likelihood
  // and the underlying permanent traits already carry most of the signal.
  const priorWeight=6;
  const adjustment=eligibleWeight>0
    ?Math.min(10,18*driverErrorWeight/(priorWeight+eligibleWeight))
    :0;

  return {
    adjustment:round1(adjustment),
    sample,
    confirmedDriverErrors,
  };
}

export function driverDerivedRatingDefinitions(){
  return DEFINITIONS;
}

export function driverMistakePropensity(attrs,{performanceEntries=[]}={}){
  const baseline=mistakeBaseline(attrs);
  if(baseline===null){
    return {
      value:null,
      baseline:null,
      evidenceAdjustment:0,
      evidenceSample:0,
      confirmedDriverErrors:0,
    };
  }
  const evidence=mistakeEvidence(performanceEntries);
  return {
    value:round1(clamp(baseline+evidence.adjustment)),
    baseline,
    evidenceAdjustment:evidence.adjustment,
    evidenceSample:evidence.sample,
    confirmedDriverErrors:evidence.confirmedDriverErrors,
  };
}

export function driverDerivedRating(attrs,key,context={}){
  const definition=DEFINITIONS[key];
  if(!definition)return null;
  if(key==="mistake_propensity"){
    return driverMistakePropensity(attrs,context).value;
  }

  let weighted=0;
  let weightTotal=0;
  for(const [attribute,weight] of Object.entries(definition.weights)){
    const value=numericAttribute(attrs,attribute);
    if(value===null)return null;
    weighted+=value*weight;
    weightTotal+=weight;
  }
  if(weightTotal<=0)return null;
  return Number((weighted/weightTotal).toFixed(1));
}

export function driverDerivedRatings(attrs,context={}){
  const out={};
  for(const [key,definition] of Object.entries(DEFINITIONS)){
    const mistake=key==="mistake_propensity"
      ?driverMistakePropensity(attrs,context)
      :null;
    out[key]={
      key,
      label:definition.label,
      value:mistake?.value??driverDerivedRating(attrs,key,context),
      weights:definition.weights,
      inverse:Boolean(definition.inverse),
      ...(mistake?{
        baseline:mistake.baseline,
        evidenceAdjustment:mistake.evidenceAdjustment,
        evidenceSample:mistake.evidenceSample,
        confirmedDriverErrors:mistake.confirmedDriverErrors,
      }:{}),
    };
  }
  return out;
}
