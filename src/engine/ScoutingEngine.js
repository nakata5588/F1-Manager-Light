// src/engine/ScoutingEngine.js
const pick=(o,keys,fb=undefined)=>{for(const k of keys){const v=o?.[k];if(v!==undefined&&v!==null&&v!=="")return v;}return fb;};
const idOf=(o)=>String(pick(o,["driver_id","person_id","id"],""));
const countryKey=(value)=>{
  const raw=String(value||"").trim().toLowerCase();
  const aliases={"uk":"united kingdom","great britain":"united kingdom","england":"united kingdom","usa":"united states","united states of america":"united states","brasil":"brazil","deutschland":"germany"};
  return aliases[raw]||raw;
};
const zoneCountries=(zone)=>{
  const arr=Array.isArray(zone?.countries)?zone.countries:String(zone?.countries_csv||"").split(",").map(x=>x.trim()).filter(Boolean);
  return new Set(arr.map(countryKey));
};
const driverCountry=(d)=>pick(d,["country_name","nationality","country"],"");
function simpleHash(text){let h=2166136261;for(const ch of String(text||"")){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return Math.abs(h>>>0);}

function eligibleProspects(gs){
  return (gs?.drivers||[])
    .filter((d)=>Boolean(d?.active_lower_series))
    .filter((d)=>["junior_only","lower_series"].includes(String(d?.status||"")))
    .filter((d)=>{
      const age=Number(d?.age);
      return Number.isFinite(age)&&age>=16&&age<=24;
    });
}

function discoverForRegion(gs,zone,assignmentId){
  if(!zone)return [];
  const ratings=new Map((gs?.driverRatings||[]).map(r=>[idOf(r),r]));
  const countries=zoneCountries(zone);
  const eligible=eligibleProspects(gs).filter(d=>countries.has(countryKey(driverCountry(d))));
  const amount=Math.max(2,Math.min(5,Math.round(3*Number(zone?.talent_boost||1))));
  return eligible.map(d=>{
    const r=ratings.get(idOf(d))||{};
    const potential=Number(pick(r,["potential_ability","potential","current_ability"],50));
    const jitter=(simpleHash(`${assignmentId}:${idOf(d)}`)%1600)/100;
    return {id:idOf(d),score:potential+jitter};
  }).sort((a,b)=>b.score-a.score).slice(0,amount).map(x=>x.id);
}

function buildDriverReport(gs,driverId,depth="deep"){
  const d=(gs?.drivers||[]).find(x=>idOf(x)===String(driverId));
  const r=(gs?.driverRatings||[]).find(x=>idOf(x)===String(driverId))||{};
  if(!d)return {subject:"Scouting report completed",body:"The scouting assignment is complete, but the driver record is no longer available."};
  const name=d.display_name||d.name||driverId;
  const ability=pick(r,["current_ability","overall","pace"],"unknown");
  const potential=pick(r,["potential_ability","potential"],"unknown");
  const age=Number.isFinite(Number(d.age))?d.age:"—";
  const deep=String(depth||"deep").toLowerCase()==="deep";
  return {
    subject:`${deep?"Deep":"Light"} scouting report — ${name}`,
    body:deep
      ?`${name} · Age ${age} · ${driverCountry(d)||"Unknown nationality"}\n\nCurrent Ability: ${ability}\nPotential: ${potential}\nSeries: ${d.lower_series_name||"Lower Series"}\n\nThe full report is now available in the driver profile.`
      :`${name} · Age ${age} · ${driverCountry(d)||"Unknown nationality"}\n\nThe light report is complete. Overall and attribute estimate ranges have been narrowed. Potential remains an estimate. Commission Deep scouting for exact current ratings and the full potential assessment.`,
  };
}

export function processScoutingTick(gs){
  const scouting=gs?.scouting||{};
  const assignments=Array.isArray(scouting.assignments)?scouting.assignments:[];
  const today=String(gs?.currentDateISO||"").slice(0,10);
  if(!today||!assignments.some(a=>a.status==="active"&&a.finishes_at&&a.finishes_at<=today))return gs;

  const zones=Array.isArray(gs?.dbScoutingZones)?gs.dbScoutingZones:[];
  const drivers=Array.isArray(gs?.drivers)?gs.drivers:[];
  const driverById=new Map(drivers.map(d=>[idOf(d),d]));
  const messages=[];

  const nextAssignments=assignments.map((a)=>{
    if(a.status!=="active"||!a.finishes_at||a.finishes_at>today)return a;

    if(a.mode==="region"){
      const zone=zones.find(z=>String(z.zone_id)===String(a.zone_id));
      const discovered_ids=discoverForRegion(gs,zone,a.id);
      const names=discovered_ids.map(id=>driverById.get(String(id))).filter(Boolean).map(d=>d.display_name||d.name||id);
      messages.push({
        id:`scouting_report_${a.id}`,
        date:today,
        from:"Chief Scout",
        type:"SCOUTING",
        tag:"Scouting",
        subject:`Regional scouting report — ${a.region||zone?.name||"Region"}`,
        body:names.length
          ? `The regional assignment is complete.\n\nRecommended prospects:\n• ${names.join("\n• ")}\n\nOpen Scouting → Prospects to review the discovered drivers.`
          : "The regional assignment is complete. No suitable young prospects were identified in the current historical talent pool.",
        unread:true,
      });
      return {...a,status:"completed",completed_at:today,discovered_ids,report_delivered:true};
    }

    const report=buildDriverReport(gs,a.prospect_id,a.depth||"deep");
    messages.push({
      id:`scouting_report_${a.id}`,
      date:today,
      from:"Chief Scout",
      type:"SCOUTING",
      tag:"Scouting",
      subject:report.subject,
      body:report.body,
      unread:true,
    });
    return {...a,status:"completed",completed_at:today,report_delivered:true};
  });

  return {
    ...gs,
    scouting:{...scouting,assignments:nextAssignments},
    inbox:[...messages,...(gs?.inbox||[])],
  };
}
