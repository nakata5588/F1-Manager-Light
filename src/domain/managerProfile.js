// src/domain/managerProfile.js
// Player Team Principal profile and bounded gameplay modifiers.
//
// Design principles:
// - The manager is Save World state, never historical database seed data.
// - Backgrounds are trade-offs rather than free points.
// - Experience trades starting strength/reputation against long-term potential.
// - Manager effects stay deliberately smaller than car, driver and specialist-staff effects.

const ATTR_KEYS=Object.freeze([
  "leadership",
  "personnel",
  "negotiation",
  "technical",
  "commercial",
  "race_management",
]);

const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,Number(value)||0));
const round=(value,digits=3)=>Number(Number(value||0).toFixed(digits));
const text=(value)=>String(value??"").trim();

export const MANAGER_ATTRIBUTES=Object.freeze([
  Object.freeze({key:"leadership",label:"Leadership",shortLabel:"Leadership",description:"Board trust, team response and leadership under pressure."}),
  Object.freeze({key:"personnel",label:"People Management",shortLabel:"People",description:"Driver relationships and how strongly the team reacts to results."}),
  Object.freeze({key:"negotiation",label:"Negotiation",shortLabel:"Negotiation",description:"Personal terms and contract negotiation outcomes."}),
  Object.freeze({key:"technical",label:"Technical Understanding",shortLabel:"Technical",description:"Project coordination, lead time and development risk. It never replaces specialist staff."}),
  Object.freeze({key:"commercial",label:"Commercial",shortLabel:"Commercial",description:"Sponsor negotiation outcomes and future commercial-management hooks."}),
  Object.freeze({key:"race_management",label:"Race Management",shortLabel:"Race Mgmt",description:"Race-control judgement and execution. No direct car-pace bonus."}),
]);

export const MANAGER_BACKGROUNDS=Object.freeze([
  Object.freeze({
    id:"newcomer",
    label:"Newcomer",
    description:"Balanced starting profile with no specialist background.",
    attributes:{leadership:50,personnel:50,negotiation:50,technical:50,commercial:50,race_management:50},
  }),
  Object.freeze({
    id:"former_driver",
    label:"Former Driver",
    description:"Strong race understanding and driver empathy, with less commercial experience.",
    attributes:{leadership:50,personnel:54,negotiation:44,technical:46,commercial:44,race_management:62},
  }),
  Object.freeze({
    id:"engineer",
    label:"Engineer / Technical",
    description:"Technical depth and race understanding at the expense of commercial and people skills.",
    attributes:{leadership:50,personnel:44,negotiation:44,technical:64,commercial:43,race_management:55},
  }),
  Object.freeze({
    id:"team_management",
    label:"Team Management",
    description:"Leadership and people management specialist with a broad management base.",
    attributes:{leadership:62,personnel:60,negotiation:54,technical:42,commercial:44,race_management:38},
  }),
  Object.freeze({
    id:"commercial",
    label:"Commercial / Business",
    description:"Negotiation and sponsor specialist with less technical and race-operational depth.",
    attributes:{leadership:48,personnel:44,negotiation:62,technical:38,commercial:66,race_management:42},
  }),
]);

export const MANAGER_EXPERIENCE_LEVELS=Object.freeze([
  Object.freeze({
    id:"rookie",
    label:"Rookie",
    description:"Lower starting ability and reputation, but the highest long-term growth ceiling.",
    attributeOffset:-3,
    reputation:18,
    potential:92,
  }),
  Object.freeze({
    id:"experienced",
    label:"Experienced",
    description:"Balanced starting ability, reputation and development ceiling.",
    attributeOffset:0,
    reputation:35,
    potential:84,
  }),
  Object.freeze({
    id:"veteran",
    label:"Veteran",
    description:"Stronger starting ability and reputation, but less long-term growth headroom.",
    attributeOffset:4,
    reputation:52,
    potential:76,
  }),
]);

export function managerBackground(id){
  return MANAGER_BACKGROUNDS.find((row)=>row.id===String(id))||MANAGER_BACKGROUNDS[0];
}

export function managerExperience(id){
  return MANAGER_EXPERIENCE_LEVELS.find((row)=>row.id===String(id))||MANAGER_EXPERIENCE_LEVELS[0];
}

export function deriveManagerAttributes({background="newcomer",experience="rookie"}={}){
  const bg=managerBackground(background);
  const xp=managerExperience(experience);
  return Object.fromEntries(
    ATTR_KEYS.map((key)=>[key,Math.round(clamp(Number(bg.attributes?.[key]??50)+Number(xp.attributeOffset||0),1,99))])
  );
}

export function managerDisplayName(manager){
  if(!manager)return "Team Principal";
  const combined=(text(manager.first_name)+" "+text(manager.last_name)).trim();
  return text(manager.display_name)||combined||"Team Principal";
}

export function managerAge(manager,dateISO=null){
  const dob=text(manager?.date_of_birth);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dob))return null;
  const ref=text(dateISO)||String(new Date().toISOString()).slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(ref))return null;
  const [by,bm,bd]=dob.split("-").map(Number);
  const [ry,rm,rd]=ref.split("-").map(Number);
  let age=ry-by;
  if(rm<bm||(rm===bm&&rd<bd))age-=1;
  return Number.isFinite(age)&&age>=0?age:null;
}

export function managerReputationLabel(value){
  const rep=clamp(value);
  if(rep>=85)return "World Class";
  if(rep>=68)return "International";
  if(rep>=50)return "Continental";
  if(rep>=30)return "National";
  return "Local";
}

export function managerCareerJobStatusLabel(job){
  const status=text(job?.status).toLowerCase();
  const reason=text(job?.end_reason).toLowerCase();
  if(job?.end_year==null&&(!status||status==="active"))return "Active";
  if(status==="fired"||reason==="board_dismissal")return "Dismissed";
  if(status==="contract_ended"||reason==="contract_not_renewed")return "Contract ended";
  if(status==="active")return "Completed";
  if(!status)return job?.end_year==null?"Active":"Completed";
  return status
    .replaceAll("_"," ")
    .replace(/\b\w/g,(letter)=>letter.toUpperCase());
}

export function createManagerProfile(input={},context={}){
  const year=Number(context?.year??input?.career_start_year)||1980;
  const team=context?.team||{};
  const hasExistingJob=Boolean(input?.current_job&&typeof input.current_job==="object");
  const teamId=hasExistingJob
    ?text(input?.current_team_id??input?.current_job?.team_id)
    :text(team?.team_id??team?.id??input?.current_team_id);
  const teamName=(hasExistingJob
    ?text(input?.current_team_name??input?.current_job?.team_name)
    :text(team?.team_name??team?.name??team?.short_name??input?.current_team_name))||"Unattached";
  const background=managerBackground(input?.background).id;
  const experience=managerExperience(input?.experience_level).id;
  const xp=managerExperience(experience);
  const firstName=text(input?.first_name);
  const lastName=text(input?.last_name);
  const displayName=(firstName+" "+lastName).trim()||text(input?.display_name)||"Team Principal";
  const joinedAt=text(input?.joined_at)||String(year).padStart(4,"0")+"-01-01";

  return {
    profile_version:2,
    manager_id:text(input?.manager_id)||"player_manager",
    first_name:firstName,
    last_name:lastName,
    display_name:displayName,
    nationality_name:text(input?.nationality_name),
    nationality_code:text(input?.nationality_code).toUpperCase(),
    date_of_birth:text(input?.date_of_birth),
    place_of_birth:text(input?.place_of_birth),
    portrait_data_url:text(input?.portrait_data_url)||null,
    portrait_file_name:text(input?.portrait_file_name)||null,
    background,
    experience_level:experience,
    reputation:clamp(input?.reputation??xp.reputation),
    potential:clamp(input?.potential??xp.potential),
    attributes:{
      ...deriveManagerAttributes({background,experience}),
      ...(input?.attributes&&typeof input.attributes==="object"
        ?Object.fromEntries(ATTR_KEYS.map((key)=>[key,Math.round(clamp(input.attributes[key]??deriveManagerAttributes({background,experience})[key],1,99))]))
        :{}),
    },
    career_start_year:Number(input?.career_start_year)||year,
    current_team_id:teamId||null,
    current_team_name:teamName||null,
    current_job:{
      ...(input?.current_job&&typeof input.current_job==="object"?input.current_job:{}),
      team_id:teamId||null,
      team_name:teamName||null,
      role:"Team Principal",
      joined_at:text(input?.current_job?.joined_at)||joinedAt,
      start_year:Number(input?.current_job?.start_year)||year,
      contract_until_year:Number(input?.current_job?.contract_until_year)||year+2,
      status:text(input?.current_job?.status)||"active",
    },
    career_history:Array.isArray(input?.career_history)&&input.career_history.length
      ?input.career_history.map((job)=>({
        ...job,
        role:"Team Principal",
      }))
      :[{
        team_id:teamId||null,
        team_name:teamName||null,
        role:"Team Principal",
        joined_at:joinedAt,
        start_year:year,
        end_year:null,
        status:"active",
      }],
    achievements:Array.isArray(input?.achievements)?input.achievements:[],
    development:{
      xp:Math.max(0,Number(input?.development?.xp||0)),
      level:Math.max(1,Number(input?.development?.level||1)),
      last_progression_at:input?.development?.last_progression_at||null,
      processed_result_keys:Array.isArray(input?.development?.processed_result_keys)
        ?[...new Set(input.development.processed_result_keys.map(String).filter(Boolean))]
        :[],
      processed_seasons:Array.isArray(input?.development?.processed_seasons)
        ?[...new Set(input.development.processed_seasons.map(Number).filter(Number.isFinite))].sort((a,b)=>a-b)
        :[],
      races_managed:Math.max(0,Number(input?.development?.races_managed||0)),
      points_races:Math.max(0,Number(input?.development?.points_races||0)),
      podiums:Math.max(0,Number(input?.development?.podiums||0)),
      wins:Math.max(0,Number(input?.development?.wins||0)),
      constructor_titles:Math.max(0,Number(input?.development?.constructor_titles||0)),
      driver_titles:Math.max(0,Number(input?.development?.driver_titles||0)),
      last_regression_key:text(input?.development?.last_regression_key)||null,
      last_regression_at:input?.development?.last_regression_at||null,
      last_regression_reason:text(input?.development?.last_regression_reason)||null,
      attribute_regressions:Math.max(0,Number(input?.development?.attribute_regressions||0)),
      reputation_lost:Math.max(0,Number(input?.development?.reputation_lost||0)),
      history:Array.isArray(input?.development?.history)
        ?input.development.history.filter((row)=>row&&typeof row==="object").slice(0,60).map((row)=>({
          ...row,
          attribute_changes:Array.isArray(row?.attribute_changes)
            ?row.attribute_changes.filter((change)=>change&&typeof change==="object")
            :[],
        }))
        :[],
    },
  };
}

export function normalizeManagerProfile(manager,context={}){
  if(!manager||typeof manager!=="object")return null;
  return createManagerProfile(manager,{
    year:context?.year??manager?.career_start_year,
    team:context?.team||{
      team_id:manager?.current_team_id,
      name:manager?.current_team_name,
    },
  });
}

export function managerAttribute(manager,key,fallback=50){
  const value=Number(manager?.attributes?.[key]);
  return Number.isFinite(value)?clamp(value):clamp(fallback);
}


export function managerAppliesToTeam(gs,teamId=null){
  const manager=gs?.manager;
  if(!manager)return false;
  const job=manager?.current_job&&typeof manager.current_job==="object"?manager.current_job:null;
  if(job&&String(job?.status||"active").toLowerCase()!=="active")return false;
  const assigned=String(
    manager?.current_team_id??
    job?.team_id??
    (!job?(gs?.team?.team_id??gs?.team?.id):"")??
    ""
  );
  const target=String(teamId??assigned);
  return Boolean(assigned)&&target===assigned;
}

export function managerGameplayEffects(gs,{teamId=null}={}){
  const manager=gs?.manager;
  const active=Boolean(manager)&&managerAppliesToTeam(gs,teamId);
  if(!active){
    return {
      active:false,
      boardConfidenceDelta:0,
      contractAcceptanceDelta:0,
      sponsorAcceptanceDelta:0,
      positiveMoraleMultiplier:1,
      negativeMoraleMultiplier:1,
      relationshipPositiveMultiplier:1,
      relationshipNegativeMultiplier:1,
      technicalTimeMultiplier:1,
      technicalRiskMultiplier:1,
      raceExecutionErrorMultiplier:1,
    };
  }

  const leadership=(managerAttribute(manager,"leadership")-50)/50;
  const personnel=(managerAttribute(manager,"personnel")-50)/50;
  const negotiation=(managerAttribute(manager,"negotiation")-50)/50;
  const technical=(managerAttribute(manager,"technical")-50)/50;
  const commercial=(managerAttribute(manager,"commercial")-50)/50;
  const race=(managerAttribute(manager,"race_management")-50)/50;
  const peopleBlend=(leadership+personnel)/2;

  return {
    active:true,
    boardConfidenceDelta:round(leadership*0.05,4),
    contractAcceptanceDelta:round(negotiation*0.08,4),
    sponsorAcceptanceDelta:round(commercial*0.08,4),
    positiveMoraleMultiplier:round(1+peopleBlend*0.12,4),
    negativeMoraleMultiplier:round(1-peopleBlend*0.12,4),
    relationshipPositiveMultiplier:round(1+personnel*0.10,4),
    relationshipNegativeMultiplier:round(1-personnel*0.10,4),
    technicalTimeMultiplier:round(1-technical*0.06,4),
    technicalRiskMultiplier:round(1-technical*0.10,4),
    raceExecutionErrorMultiplier:round(1-race*0.08,4),
  };
}

export function managerEffectSummary(gs){
  const effects=managerGameplayEffects(gs);
  return [
    {key:"leadership",label:"Board trust",value:effects.boardConfidenceDelta,format:"pp",active:true},
    {key:"personnel",label:"Team morale response",value:effects.positiveMoraleMultiplier-1,format:"percent",active:true},
    {key:"negotiation",label:"Driver contract acceptance",value:effects.contractAcceptanceDelta,format:"pp",active:true},
    {key:"technical",label:"Development lead time",value:effects.technicalTimeMultiplier-1,format:"inverse_percent",active:true},
    {key:"commercial",label:"Sponsor acceptance",value:effects.sponsorAcceptanceDelta,format:"pp",active:true},
    {key:"race_management",label:"Pit execution error chance",value:effects.raceExecutionErrorMultiplier-1,format:"error_percent",active:true},
  ];
}
