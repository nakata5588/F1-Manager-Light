// src/domain/driverAttributeGroups.js
// Shared Driver attribute groups for UI, development focus and behaviour summaries.
// Group scores are simple means of the listed attributes. Inverse attributes
// (currently crash likelihood) are converted to a positive "better is higher"
// score before averaging.

import { driverDerivedRatings } from "./driverDerivedRatings.js";

const GROUPS=Object.freeze([
  Object.freeze({
    key:"pace",
    label:"Pace",
    description:"Raw speed across qualifying, starts and race laps.",
    attributes:Object.freeze([
      Object.freeze({field:"pace",label:"Pace",capOffset:3}),
      Object.freeze({field:"qualifying",label:"Qualifying",capOffset:3}),
      Object.freeze({field:"start_launch",label:"Start & Launch",capOffset:2}),
    ]),
  }),
  Object.freeze({
    key:"racecraft",
    label:"Racecraft",
    description:"Wheel-to-wheel judgement, positioning and decision making under pressure.",
    attributes:Object.freeze([
      Object.freeze({field:"racecraft",label:"Racecraft",capOffset:3}),
      Object.freeze({field:"race_intelligence",label:"Race Intelligence",capOffset:4}),
      Object.freeze({field:"pressure_handling",label:"Pressure Handling",capOffset:4}),
    ]),
  }),
  Object.freeze({
    key:"control",
    label:"Control",
    description:"Consistency and adaptability when conditions, grip or car behaviour change.",
    attributes:Object.freeze([
      Object.freeze({field:"consistency",label:"Consistency",capOffset:4}),
      Object.freeze({field:"wet_skill",label:"Wet Skill",capOffset:5}),
      Object.freeze({field:"adaptability",label:"Adaptability",capOffset:5}),
    ]),
  }),
  Object.freeze({
    key:"management",
    label:"Management",
    description:"Ability to preserve tyres and manage the car's available race resources.",
    attributes:Object.freeze([
      Object.freeze({field:"tire_management",label:"Tyre Management",capOffset:5}),
      Object.freeze({field:"ers_fuel_management",label:"ERS / Fuel",capOffset:5}),
    ]),
  }),
  Object.freeze({
    key:"technical",
    label:"Technical",
    description:"Quality of setup feedback and contribution to long-term car development.",
    attributes:Object.freeze([
      Object.freeze({field:"technical_feedback",label:"Technical Feedback",capOffset:6}),
      Object.freeze({field:"car_development_impact",label:"Car Development Impact",capOffset:6}),
    ]),
  }),
  Object.freeze({
    key:"mental",
    label:"Mental",
    description:"Resilience, leadership and willingness to work for the team.",
    attributes:Object.freeze([
      Object.freeze({field:"mentality",label:"Mentality",capOffset:4}),
      Object.freeze({field:"leadership",label:"Leadership",capOffset:6}),
      Object.freeze({field:"team_player",label:"Team Player",capOffset:6}),
    ]),
  }),
  Object.freeze({
    key:"risk",
    label:"Risk",
    description:"Controlled aggression: attacking intent balanced against incident tendency.",
    attributes:Object.freeze([
      Object.freeze({field:"aggression",aliases:Object.freeze(["aggression","agression"]),label:"Aggression",capOffset:4,trainingMultiplier:0.65}),
      Object.freeze({field:"crash_likelihood",label:"Crash Likelihood",inverse:true,capOffset:5,trainingMultiplier:0.80}),
    ]),
  }),
]);

const GROUP_MAP=new Map(GROUPS.map((group)=>[group.key,group]));

const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,Number(value)||0));
const round1=(value)=>Math.round(Number(value||0)*10)/10;
const round2=(value)=>Math.round(Number(value||0)*100)/100;

function unbox(value){
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    if(value.result!==undefined&&value.result!==null&&value.result!=="")return unbox(value.result);
    if(value.value!==undefined&&value.value!==null&&value.value!=="")return unbox(value.value);
  }
  return value;
}

export function driverAttributeGroups(){
  return GROUPS;
}

export function driverAttributeGroup(key){
  return GROUP_MAP.get(String(key||""))||null;
}

export function driverAttributeValue(rating,attribute){
  if(!rating||!attribute)return null;
  const aliases=attribute.aliases||[attribute.field];
  for(const field of aliases){
    const value=Number(unbox(rating?.[field]));
    if(Number.isFinite(value))return clamp(value);
  }
  return null;
}

export function driverAttributeGroupScore(rating,groupKey){
  const group=driverAttributeGroup(groupKey);
  if(!group)return null;
  const values=[];
  for(const attribute of group.attributes){
    const raw=driverAttributeValue(rating,attribute);
    if(raw===null)continue;
    values.push(attribute.inverse?100-raw:raw);
  }
  if(!values.length)return null;
  return round1(values.reduce((sum,value)=>sum+value,0)/values.length);
}

function band(score){
  const value=Number(score);
  if(!Number.isFinite(value))return "unknown";
  if(value>=85)return "elite";
  if(value>=75)return "strong";
  if(value>=65)return "good";
  if(value>=55)return "average";
  return "weak";
}

const BEHAVIOUR=Object.freeze({
  pace:Object.freeze({
    elite:"Has elite speed and can regularly extract lap time in qualifying, starts and race pace.",
    strong:"Usually extracts strong speed from the car and should be competitive over one lap and race stints.",
    good:"Has useful pace but may not consistently maximise every phase of a weekend.",
    average:"Can deliver acceptable speed, although outright pace can limit results against stronger drivers.",
    weak:"Raw speed is a clear limitation and can leave the driver dependent on strategy or attrition.",
  }),
  racecraft:Object.freeze({
    elite:"Excellent wheel-to-wheel judgement: decisive in traffic and composed when races become complex.",
    strong:"Usually makes good racing decisions and handles close combat with confidence.",
    good:"Competent in traffic, with occasional weaknesses in positioning or pressure situations.",
    average:"Can lose opportunities in wheel-to-wheel situations and under sustained pressure.",
    weak:"Race judgement is a major weakness and the driver is vulnerable in close combat.",
  }),
  control:Object.freeze({
    elite:"Very stable across changing grip, weather and car balance, with few performance swings.",
    strong:"Generally consistent and adapts quickly when conditions change.",
    good:"Reliable in normal conditions but less convincing when grip or balance changes rapidly.",
    average:"Performance can fluctuate and difficult conditions expose mistakes or adaptation delays.",
    weak:"Struggles to maintain control and consistency when the race environment changes.",
  }),
  management:Object.freeze({
    elite:"Excellent at preserving tyres and race resources, opening flexible strategic options.",
    strong:"Usually protects tyres and resources well enough to extend or attack stints effectively.",
    good:"Reasonable resource management, though aggressive races can expose wear or efficiency weaknesses.",
    average:"Can lose strategic flexibility through tyre wear or inefficient resource use.",
    weak:"Poor stint management regularly compromises strategy and late-race performance.",
  }),
  technical:Object.freeze({
    elite:"Provides exceptional technical feedback and materially improves setup and development direction.",
    strong:"A valuable technical reference who helps engineers find setup and development gains.",
    good:"Provides useful feedback, although not always enough to lead technical direction.",
    average:"Feedback is serviceable but offers limited advantage to setup or long-term development.",
    weak:"Struggles to communicate useful technical information to the engineering team.",
  }),
  mental:Object.freeze({
    elite:"Highly resilient and influential, with strong leadership and team-first behaviour.",
    strong:"Usually handles pressure and team responsibilities well while supporting the wider group.",
    good:"Mentally dependable with some leadership value, though setbacks can still affect performance.",
    average:"Can be affected by setbacks and offers limited leadership influence.",
    weak:"Mental resilience and team contribution are significant weaknesses.",
  }),
  risk:Object.freeze({
    elite:"Combines controlled aggression with a very low incident tendency; attacks without giving away unnecessary risk.",
    strong:"Assertive but generally controlled, with a good balance between attack and incident avoidance.",
    good:"Reasonable risk balance, though aggressive situations can still produce avoidable incidents.",
    average:"Risk management is inconsistent and the driver can either over-commit or become too cautious.",
    weak:"The aggression/error balance is poor and creates a significant incident risk.",
  }),
});

export function driverAttributeGroupBehaviourForScore(groupKey,score){
  const key=band(score);
  return {
    score:Number.isFinite(Number(score))?round1(score):null,
    band:key,
    text:BEHAVIOUR?.[groupKey]?.[key]||"Insufficient data to assess this area.",
  };
}

export function driverAttributeGroupBehaviour(rating,groupKey){
  return driverAttributeGroupBehaviourForScore(groupKey,driverAttributeGroupScore(rating,groupKey));
}

export function driverWheelToWheelBehaviour(overtakingValue,defendingValue){
  const overtaking=Number(overtakingValue);
  const defending=Number(defendingValue);
  if(!Number.isFinite(overtaking)||!Number.isFinite(defending)){
    return {overtaking:null,defending:null,text:"Insufficient data to assess wheel-to-wheel behaviour."};
  }

  let text;
  if(overtaking>=80&&defending>=80){
    text="Excellent wheel-to-wheel driver: strong at creating overtakes and equally capable of protecting position.";
  }else if(overtaking>=80&&defending<65){
    text="Aggressive overtaker who can gain positions, but weak defending makes those positions difficult to protect.";
  }else if(overtaking<65&&defending>=80){
    text="Difficult to pass and strong at protecting position, but lacks the same quality when trying to overtake.";
  }else if(overtaking>=72&&defending>=72){
    text="Well-rounded in wheel-to-wheel racing, with reliable attacking and defensive ability.";
  }else if(overtaking<60&&defending<60){
    text="Wheel-to-wheel racing is a weakness: both overtaking and defending can cost track position.";
  }else if(overtaking>defending+10){
    text="More effective in attack than defence; likely to make passes but comparatively vulnerable when pressured.";
  }else if(defending>overtaking+10){
    text="More effective in defence than attack; protects position well but can struggle to move forward in traffic.";
  }else{
    text="Balanced wheel-to-wheel profile without a major attacking or defensive speciality.";
  }
  return {overtaking:round1(overtaking),defending:round1(defending),text};
}

export function driverRaceBehaviour(rating){
  const derived=driverDerivedRatings(rating);
  return driverWheelToWheelBehaviour(derived?.overtaking?.value,derived?.defending?.value);
}

function potentialOf(rating){
  const potential=Number(unbox(rating?.potential_ability));
  if(Number.isFinite(potential))return clamp(potential);
  const current=Number(unbox(rating?.current_ability));
  return Number.isFinite(current)?clamp(current+5):70;
}

export function driverAttributeTrainingLimit(rating,attribute){
  const raw=driverAttributeValue(rating,attribute);
  if(raw===null)return null;
  const potential=potentialOf(rating);
  const qualityCeiling=clamp(potential+Number(attribute?.capOffset||0),0,98);
  if(attribute?.inverse){
    const floor=clamp(100-qualityCeiling,2,100);
    return {direction:-1,limit:Math.min(raw,floor),potential};
  }
  return {direction:1,limit:Math.max(raw,qualityCeiling),potential};
}

export function driverGroupDevelopmentPlan(rating,groupKey,{baseGain=0.32,efficiency=1}={}){
  const group=driverAttributeGroup(groupKey);
  if(!group||!rating)return [];
  const safeEfficiency=clamp(efficiency,0,1);
  const currentAbility=Number(unbox(rating?.current_ability));
  const potential=potentialOf(rating);
  const potentialGap=Number.isFinite(currentAbility)?Math.max(0,potential-currentAbility):Math.max(0,potential-50);
  if(potentialGap<=0.05)return [];
  const potentialFactor=clamp(potentialGap/12,0.15,1);
  const changes=[];

  for(const attribute of group.attributes){
    const before=driverAttributeValue(rating,attribute);
    const limitInfo=driverAttributeTrainingLimit(rating,attribute);
    if(before===null||!limitInfo)continue;

    const distance=limitInfo.direction>0
      ?Math.max(0,limitInfo.limit-before)
      :Math.max(0,before-limitInfo.limit);
    if(distance<=0.001)continue;

    const headroomFactor=clamp(distance/14,0.12,1);
    const multiplier=Number(attribute.trainingMultiplier??1);
    const magnitude=Number(baseGain)*safeEfficiency*potentialFactor*headroomFactor*multiplier;
    const after=limitInfo.direction>0
      ?Math.min(limitInfo.limit,before+magnitude)
      :Math.max(limitInfo.limit,before-magnitude);
    const roundedAfter=round2(after);
    const delta=round2(roundedAfter-before);
    if(Math.abs(delta)<0.001)continue;

    changes.push({
      field:attribute.field,
      aliases:attribute.aliases||[attribute.field],
      label:attribute.label,
      inverse:Boolean(attribute.inverse),
      before:round2(before),
      after:roundedAfter,
      delta,
      limit:round1(limitInfo.limit),
      potential:round1(limitInfo.potential),
    });
  }
  return changes;
}

export function driverDevelopmentFocus(gs,driverId){
  const dict=gs?.driverDevelopmentFocus||{};
  const raw=dict?.[String(driverId)]??dict?.[String(driverId||"").match(/(\d+)/)?.[1]?.padStart(4,"0")];
  return driverAttributeGroup(raw)?String(raw):null;
}
