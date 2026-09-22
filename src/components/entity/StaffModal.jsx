import React, { useMemo } from "react";
import { X } from "lucide-react";
import { useGame } from "../../state/GameStore.js";
import { flagFromCountry } from "./EntityVisuals.jsx";

const unbox=(v)=>v&&typeof v==="object"&&!Array.isArray(v)?(v.result??v.value??v):v;
const pick=(o,keys,fb=undefined)=>{for(const k of keys){const v=unbox(o?.[k]);if(v!==undefined&&v!==null&&v!=="")return v;}return fb;};
const staffIdOf=(o)=>String(pick(o,["staff_id","person_id","id"],""));
const nice=(s)=>String(s||"Staff").replace(/_/g," ").replace(/\b\w/g,m=>m.toUpperCase());

function overallOf(rating){
  const ignored=new Set(["staff_id","staff_name","year"]);
  const vals=Object.entries(rating||{}).filter(([k,v])=>!ignored.has(k)&&Number.isFinite(Number(v))).map(([,v])=>Number(v));
  return vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):null;
}

export default function StaffModal({entity,onClose,pageMode=false}){
  const gs=useGame(s=>s.gameState);
  const year=Number(gs?.activeYear);
  const coreList=gs?.staffCore?.length?gs.staffCore:gs?.dbStaffCore||[];
  const ratings=gs?.staffRatings?.length?gs.staffRatings:gs?.dbStaffRatings||[];
  const contracts=gs?.staffContracts?.length?gs.staffContracts:gs?.dbStaffContracts||[];
  const id=String(entity.id);

  const staff=useMemo(()=>coreList.find(s=>staffIdOf(s)===id)||null,[coreList,id]);
  const rating=useMemo(()=>ratings.find(r=>staffIdOf(r)===id)||null,[ratings,id]);
  const contract=useMemo(()=>contracts.find(c=>staffIdOf(c)===id && (!Number.isFinite(year)||!Number.isFinite(Number(c?.year))||Number(c?.year)===year))||null,[contracts,id,year]);

  if(!staff&&!contract){
    return <div className="p-6"><div className="flex justify-between"><h3 className="font-semibold">Staff member not found</h3>{!pageMode&&<button onClick={onClose}><X size={18}/></button>}</div><p className="text-sm text-gray-500">{id}</p></div>;
  }

  const name=pick(staff,["staff_name","display_name","name"],pick(contract,["staff_name","name"],id));
  const country=pick(staff,["country_name","country","nationality"],"");
  const role=nice(pick(contract,["role","position"],pick(staff,["role_primary"],"Staff")));
  const overall=overallOf(rating);
  const skills=Object.entries(rating||{}).filter(([k,v])=>!["staff_id","staff_name","year"].includes(k)&&Number.isFinite(Number(v))).sort((a,b)=>Number(b[1])-Number(a[1]));

  return <div className={pageMode?"min-h-[calc(100vh-5rem)] rounded-2xl border bg-white text-slate-950 shadow-xl":"max-h-[92vh] overflow-y-auto"}>
    <div className="p-5 border-b flex items-start justify-between gap-3">
      <div><h2 className="text-2xl font-bold">{name}</h2><p className="text-sm text-gray-500">{flagFromCountry(country,pick(staff,["country_code"],""))} {country||"—"} · {role}</p></div>
      {!pageMode&&<button onClick={onClose} className="p-2 rounded hover:bg-gray-100"><X size={18}/></button>}
    </div>
    <div className="p-5 grid gap-5">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Info label="Overall" value={overall??"—"}/>
        <div className="border rounded-lg p-3">
          <div className="text-xs text-gray-500">Team</div>
          {(contract?.team_id ?? contract?.team) ? (
            <button
              type="button"
              data-entity="team"
              data-id={contract?.team_id ?? contract?.team}
              className="font-medium hover:text-sky-600 hover:underline"
            >
              {pick(contract,["team_name","team"],"Free")}
            </button>
          ) : (
            <div className="font-medium">Free</div>
          )}
        </div>
        <Info label="Contract to" value={pick(contract,["contract_until","contract_until_year","end_year","end_date"],"—")}/>
        <Info label="Salary" value={fmtMoney(pick(contract,["salary","salary_yearly"],null))}/>
        <Info label="Primary role" value={role}/>
      </div>
      <div>
        <h3 className="font-semibold mb-2">Attributes</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {skills.map(([k,v])=><div key={k} className="border rounded-lg p-3"><div className="text-xs text-gray-500">{nice(k)}</div><div className="text-lg font-semibold">{v}</div></div>)}
          {!skills.length&&<div className="text-sm text-gray-500">No ratings available for this season.</div>}
        </div>
      </div>
    </div>
  </div>;
}

function fmtMoney(v){const n=Number(v);return Number.isFinite(n)?new Intl.NumberFormat("en-GB",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(n):"—";}
function Info({label,value}){return <div className="border rounded-lg p-3"><div className="text-xs text-gray-500">{label}</div><div className="font-medium">{value??"—"}</div></div>;}
