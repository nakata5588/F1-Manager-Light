// src/domain/playerTechnicalLifecycle.js
// Stage 6.2.2 — player technical lifecycle processing.
//
// Development project completion and Blueprint manufacturing are Save World
// events. They must advance from the game clock, not from mounting a UI page.

import {
  createManufacturedPartUnits,
  normalizePhysicalPartState,
} from "./partUnits.js";
import { derivePartTechnicalProfile } from "./carPartPerformance.js";
import { realizeDevelopmentProjection } from "./developmentProject.js";
import { applyTechnicalKnowledgeGains, completedProjectKnowledgeGains } from "./technicalKnowledge.js";

const str=(value)=>String(value??"");

function dateOnly(value){
  const date=str(value).slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date)?date:"";
}

function due(status,finish,today){
  return status==="active" && Boolean(finish) && str(finish).slice(0,10)<=today;
}

function completeDevelopmentProjects(state,today){
  const dev=state?.development||{};
  const projects=Array.isArray(dev?.projects)?dev.projects:[];
  const parts=Array.isArray(dev?.parts)?[...dev.parts]:[];
  const knowledgeEvents=[];
  let changed=false;

  const nextProjects=projects.map((project)=>{
    if(!due(project?.status,project?.finishes_at,today))return project;

    changed=true;
    const completionDate=dateOnly(project.finishes_at)||today;
    const partId=`part_${project.id}`;
    const realized=project?.technical_projection
      ?realizeDevelopmentProjection(project)
      :null;
    const actualStrength=Number(
      realized?.development_strength ??
      project?.target_design_perf ??
      project?.perf_delta ??
      0
    );

    knowledgeEvents.push({
      project,
      technicalResult:realized,
      completionDate,
    });

    if(!parts.some((part)=>str(part?.id)===partId)){
      const draftPart={
        id:partId,
        name:project?.name||partId,
        slot:project?.type,
        version:`P${parts.filter((part)=>str(part?.slot)===str(project?.type)).length+1}`,
        perf:actualStrength,
        inv:0,
        in_manufacturing:0,
        prototype:true,
        created_from:project?.id,
        development_focus:project?.objective_id||"balanced",
        created_at:completionDate,
      };
      parts.push({
        ...draftPart,
        technical_profile:realized||derivePartTechnicalProfile(state,draftPart),
      });
    }

    return {
      ...project,
      status:"completed",
      progress:1,
      completed_at:completionDate,
      actual_design_perf:actualStrength,
      technical_result:realized||null,
      result_rating:realized?.realization?.result||"legacy",
    };
  });

  if(!changed)return state;
  let next=normalizePhysicalPartState({
    ...state,
    development:{
      ...dev,
      projects:nextProjects,
      parts,
    },
  });
  for(const event of knowledgeEvents){
    next=applyTechnicalKnowledgeGains(
      next,
      completedProjectKnowledgeGains(state,event.project,event.technicalResult),
      {
        dateISO:event.completionDate,
        eventId:`project_${event.project?.id}_knowledge`,
        source:"project",
      }
    );
  }
  return next;
}

function completeBlueprintManufacturing(state,today){
  let next=normalizePhysicalPartState(state);
  const dev=next?.development||{};
  const manufacturing=Array.isArray(dev?.manufacturing)?dev.manufacturing:[];
  if(!manufacturing.some((job)=>due(job?.status,job?.finishes_at,today)))return next;

  const nextManufacturing=[];
  for(const job of manufacturing){
    if(!due(job?.status,job?.finishes_at,today)){
      nextManufacturing.push(job);
      continue;
    }

    const completionDate=dateOnly(job.finishes_at)||today;
    next=createManufacturedPartUnits(next,{
      designId:job?.part_id,
      qty:Number(job?.qty||1),
      batchId:job?.id||null,
      manufacturedAt:completionDate,
    });

    const parts=(next?.development?.parts||[]).map((part)=>
      str(part?.id)===str(job?.part_id)
        ?{
          ...part,
          in_manufacturing:Math.max(
            0,
            Number(part?.in_manufacturing||0)-Number(job?.qty||1)
          ),
        }
        :part
    );
    next={
      ...next,
      development:{
        ...(next?.development||{}),
        parts,
      },
    };
    nextManufacturing.push({
      ...job,
      status:"completed",
      completed_at:completionDate,
    });
  }

  return normalizePhysicalPartState({
    ...next,
    development:{
      ...(next?.development||{}),
      manufacturing:nextManufacturing,
    },
  });
}

export function processPlayerTechnicalLifecycle(input,{dateISO=null}={}){
  if(!input||typeof input!=="object")return input;
  const today=dateOnly(dateISO||input?.currentDateISO);
  if(!today)return input;

  let next=normalizePhysicalPartState(input);
  next=completeDevelopmentProjects(next,today);
  next=completeBlueprintManufacturing(next,today);
  return next;
}
