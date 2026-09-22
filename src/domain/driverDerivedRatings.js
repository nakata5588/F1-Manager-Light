// src/domain/driverDerivedRatings.js
// Canonical derived driver ratings used by presentation/comparison surfaces.
// These are composites of existing permanent attributes; they are NOT new
// persisted driver attributes and must never replace the raw simulation inputs.

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
});

function unwrap(value){
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    if(value.result!==undefined&&value.result!==null&&value.result!=="")return unwrap(value.result);
    if(value.value!==undefined&&value.value!==null&&value.value!=="")return unwrap(value.value);
  }
  return value;
}
function numericAttribute(attrs,key){
  if(!attrs)return null;
  const aliases=key==="aggression"?["aggression","agression"]:[key];
  for(const alias of aliases){
    const value=Number(unwrap(attrs?.[alias]));
    if(Number.isFinite(value))return Math.max(0,Math.min(100,value));
  }
  return null;
}

export function driverDerivedRatingDefinitions(){
  return DEFINITIONS;
}

export function driverDerivedRating(attrs,key){
  const definition=DEFINITIONS[key];
  if(!definition)return null;

  let weighted=0;
  let weightTotal=0;
  for(const [attribute,weight] of Object.entries(definition.weights)){
    const value=numericAttribute(attrs,attribute);
    if(value===null)continue;
    weighted+=value*weight;
    weightTotal+=weight;
  }
  if(weightTotal<=0)return null;
  return Number((weighted/weightTotal).toFixed(1));
}

export function driverDerivedRatings(attrs){
  const out={};
  for(const [key,definition] of Object.entries(DEFINITIONS)){
    out[key]={
      key,
      label:definition.label,
      value:driverDerivedRating(attrs,key),
      weights:definition.weights,
    };
  }
  return out;
}
