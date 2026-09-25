// src/domain/driverStaffAssignments.js
import { activeDriverContracts, driverIdOf, teamIdOf } from "./driverContracts.js";
import { driverRoleSlot } from "./contractRoles.js";
import { activeStaffContracts, staffIdOf, teamIdOfContract } from "./liveContracts.js";
import { raceEngineerEraCoverage, resolveStaffId, staffContractRole } from "./staffRoles.js";

export const DRIVER_STAFF_ASSIGNMENT_VERSION=1;
const text=(value)=>String(value??"").trim();
const slotOrder={main:0,second:1,reserve:2,test:3};

function normalizeContainer(gs){
  const raw=gs?.driverStaffAssignments;
  return {
    version:DRIVER_STAFF_ASSIGNMENT_VERSION,
    assignments:raw?.assignments&&typeof raw.assignments==="object"&&!Array.isArray(raw.assignments)
      ?{...raw.assignments}
      :{},
    history:Array.isArray(raw?.history)?raw.history.slice():[],
  };
}

function assignmentKey(driverId,role="race_engineer"){
  return [text(driverId),text(role)].join("|");
}

function activeRaceDriversByTeam(gs){
  const grouped=new Map();
  for(const contract of activeDriverContracts(gs,{raceOnly:true})){
    const driverId=driverIdOf(contract);
    const teamId=teamIdOf(contract);
    if(!driverId||!teamId)continue;
    if(!grouped.has(teamId))grouped.set(teamId,[]);
    grouped.get(teamId).push({
      driverId,
      teamId,
      slot:driverRoleSlot(contract)||"second",
    });
  }
  for(const rows of grouped.values()){
    rows.sort((a,b)=>(slotOrder[a.slot]??9)-(slotOrder[b.slot]??9)||a.driverId.localeCompare(b.driverId));
  }
  return grouped;
}

function activeRaceEngineersByTeam(gs){
  const grouped=new Map();
  for(const contract of activeStaffContracts(gs)){
    if(staffContractRole(contract)!=="race_engineer")continue;
    const teamId=teamIdOfContract(contract);
    const staffId=resolveStaffId(gs,contract);
    if(!teamId||!staffId)continue;
    if(!grouped.has(teamId))grouped.set(teamId,[]);
    grouped.get(teamId).push({staffId,teamId,contract});
  }
  for(const rows of grouped.values())rows.sort((a,b)=>a.staffId.localeCompare(b.staffId));
  return grouped;
}

function currentEngineerIds(engineersByTeam,teamId){
  return new Set((engineersByTeam.get(teamId)||[]).map((row)=>row.staffId));
}

export function synchronizeDriverStaffAssignments(gs,{source="staff_assignment_sync"}={}){
  if(!gs||typeof gs!=="object")return gs;
  const container=normalizeContainer(gs);
  const driversByTeam=activeRaceDriversByTeam(gs);
  const engineersByTeam=activeRaceEngineersByTeam(gs);
  const dateISO=text(gs?.currentDateISO).slice(0,10)||null;
  const currentKeys=new Set();

  for(const [teamId,drivers] of driversByTeam){
    const engineers=engineersByTeam.get(teamId)||[];
    if(!engineers.length)continue;
    const validIds=currentEngineerIds(engineersByTeam,teamId);
    const reserved=new Set();

    // Preserve explicit/current one-to-one assignments when the engineer is
    // still contracted to the same team.
    for(const driver of drivers){
      const key=assignmentKey(driver.driverId);
      const existing=container.assignments[key];
      if(existing?.active!==false&&existing?.team_id===teamId&&validIds.has(text(existing?.staff_id))){
        currentKeys.add(key);
        reserved.add(text(existing.staff_id));
        container.assignments[key]={...existing,active:true,updated_at:dateISO};
      }
    }

    const unassigned=drivers.filter((driver)=>!currentKeys.has(assignmentKey(driver.driverId)));
    const unused=engineers.filter((engineer)=>!reserved.has(engineer.staffId));
    const shared=engineers.length<drivers.length;

    unassigned.forEach((driver,index)=>{
      const engineer=unused[index]||engineers[index%engineers.length];
      if(!engineer)return;
      const key=assignmentKey(driver.driverId);
      container.assignments[key]={
        driver_id:driver.driverId,
        staff_id:engineer.staffId,
        team_id:teamId,
        role:"race_engineer",
        active:true,
        assignment_mode:shared?"shared":"dedicated",
        source,
        created_at:container.assignments[key]?.created_at||dateISO,
        updated_at:dateISO,
      };
      currentKeys.add(key);
    });
  }

  // Keep former assignments as history instead of silently deleting them.
  for(const [key,record] of Object.entries(container.assignments)){
    if(!record||record.role!=="race_engineer"||currentKeys.has(key))continue;
    if(record.active!==false){
      container.history.unshift({...record,active:false,ended_at:dateISO});
    }
    delete container.assignments[key];
  }
  container.history=container.history.slice(0,250);

  const hadState=Boolean(gs?.driverStaffAssignments);
  const hasAny=Object.keys(container.assignments).length||container.history.length;
  if(!hadState&&!hasAny&&raceEngineerEraCoverage(gs).status==="not_recorded")return gs;
  return {...gs,driverStaffAssignments:container};
}

export function driverRaceEngineerAssignment(gs,driverId){
  return gs?.driverStaffAssignments?.assignments?.[assignmentKey(driverId)]||null;
}

export function teamRaceEngineerAssignments(gs,teamId){
  const tid=text(teamId);
  return Object.values(gs?.driverStaffAssignments?.assignments||{})
    .filter((row)=>row?.active!==false&&text(row?.team_id)===tid&&row?.role==="race_engineer");
}

export function raceEngineerAssignmentStatus(gs,teamId){
  const era=raceEngineerEraCoverage(gs);
  const assignments=teamRaceEngineerAssignments(gs,teamId);
  const raceDrivers=activeDriverContracts(gs,{teamId:String(teamId),raceOnly:true}).map(driverIdOf).filter(Boolean);
  if(era.status==="not_recorded"){
    return {...era,status:"not_recorded",assignments,driver_count:raceDrivers.length,label:era.label};
  }
  const covered=new Set(assignments.map((row)=>row.driver_id));
  const missing=raceDrivers.filter((driverId)=>!covered.has(driverId));
  return {
    ...era,
    status:missing.length?"incomplete":"covered",
    assignments,
    driver_count:raceDrivers.length,
    covered_drivers:covered.size,
    missing_driver_ids:missing,
    label:missing.length
      ?`${missing.length} race driver${missing.length===1?"":"s"} without a Race Engineer assignment`
      :"Race Engineer assignments complete",
  };
}
