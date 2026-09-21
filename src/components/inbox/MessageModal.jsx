import { useMemo } from "react";
import { X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../../state/GameStore.js";

const idOf=(row,keys)=>String(keys.map((key)=>row?.[key]).find((v)=>v!==undefined&&v!==null&&v!=="")??"");
const firstArray=(...values)=>values.find((value)=>Array.isArray(value)&&value.length)||[];

function escapeRegex(value){
  return String(value).replace(/[.*+?^\x24{}()|[\]\\]/g,"\\$&");
}

function buildEntityCandidates(gs,message){
  const out=[];
  const push=(type,id,name,priority=0)=>{
    const cleanName=String(name||"").trim();
    const cleanId=String(id||"").trim();
    if(!type||!cleanId||cleanName.length<2)return;
    out.push({type:String(type),id:cleanId,name:cleanName,priority});
  };

  for(const entity of message?.entities||[]){
    push(entity?.type||entity?.entity,entity?.id,entity?.name||entity?.label,100);
  }

  const drivers=firstArray(gs?.drivers,gs?.dbDrivers);
  const teams=firstArray(gs?.teams,gs?.dbTeams,gs?.constructors,gs?.dbConstructors);
  const staff=firstArray(gs?.staffCore,gs?.dbStaffCore);

  const driverById=new Map(drivers.map((row)=>[idOf(row,["driver_id","person_id","id"]),row]));
  const teamById=new Map(teams.map((row)=>[idOf(row,["team_id","constructor_id","id"]),row]));
  const staffById=new Map(staff.map((row)=>[idOf(row,["staff_id","person_id","id"]),row]));

  if(message?.driver_id!=null){
    const row=driverById.get(String(message.driver_id));
    push("driver",message.driver_id,row?.display_name||row?.name||message?.driver_name,90);
  }
  if(message?.team_id!=null){
    const row=teamById.get(String(message.team_id));
    push("team",message.team_id,row?.team_name||row?.name||row?.short_name||message?.team_name,90);
  }
  if(message?.staff_id!=null){
    const row=staffById.get(String(message.staff_id));
    push("staff",message.staff_id,row?.staff_name||row?.display_name||row?.name||message?.staff_name,90);
  }

  for(const row of drivers){
    push("driver",idOf(row,["driver_id","person_id","id"]),row?.display_name||row?.name,10);
  }
  for(const row of teams){
    const id=idOf(row,["team_id","constructor_id","id"]);
    push("team",id,row?.team_name||row?.name,10);
    if(row?.short_name&&String(row.short_name)!==String(row?.team_name||row?.name||""))push("team",id,row.short_name,5);
  }
  for(const row of staff){
    push("staff",idOf(row,["staff_id","person_id","id"]),row?.staff_name||row?.display_name||row?.name,10);
  }

  const byName=new Map();
  for(const entity of out.sort((a,b)=>b.priority-a.priority||b.name.length-a.name.length)){
    const key=entity.name.toLocaleLowerCase();
    if(!byName.has(key))byName.set(key,entity);
  }
  return [...byName.values()].sort((a,b)=>b.name.length-a.name.length);
}

function EntityRichText({text,candidates,className=""}){
  const value=String(text??"");
  if(!value||!candidates.length)return <span className={className}>{value}</span>;

  const names=candidates.map((entity)=>escapeRegex(entity.name)).filter(Boolean);
  if(!names.length)return <span className={className}>{value}</span>;

  const entityByName=new Map(candidates.map((entity)=>[entity.name.toLocaleLowerCase(),entity]));
  const re=new RegExp("(?:^|[^\\p{L}\\p{N}_])("+names.join("|")+")(?=$|[^\\p{L}\\p{N}_])","giu");
  const nodes=[];
  let cursor=0;
  let key=0;

  for(const match of value.matchAll(re)){
    const matchedName=match[1];
    const full=match[0];
    const start=(match.index??0)+full.length-matchedName.length;
    if(start>cursor)nodes.push(value.slice(cursor,start));
    const entity=entityByName.get(matchedName.toLocaleLowerCase());
    if(entity){
      nodes.push(
        <button
          key={"entity-"+key++}
          type="button"
          data-entity={entity.type}
          data-id={entity.id}
          className="font-semibold text-sky-700 hover:underline"
          title={"Open "+entity.type+" profile"}
        >
          {matchedName}
        </button>
      );
    }else{
      nodes.push(matchedName);
    }
    cursor=start+matchedName.length;
  }
  if(cursor<value.length)nodes.push(value.slice(cursor));
  return <span className={className}>{nodes}</span>;
}

export default function MessageModal({ message, onClose }) {
  const navigate = useNavigate();
  const gs = useGame((s)=>s.gameState);
  const candidates=useMemo(()=>buildEntityCandidates(gs,message),[gs,message]);

  if (!message) return null;
  const effects = message?.meta?.effects || [];
  const dateLabel = message?.dateISO || message?.date || "";
  const actions = message?.actions || message?.meta?.actions || [];
  const title = message?.title || message?.subject || "Message";

  return (
    <div className="fixed inset-0 z-[10000] bg-black/40 flex items-center justify-center p-3">
      <div className="w-full max-w-3xl rounded-2xl bg-white text-slate-950 border border-slate-200 shadow-xl">
        <div className="flex items-start gap-3 p-4 border-b border-slate-200">
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-wide text-slate-500">{dateLabel}</div>
            <h2 className="text-xl font-semibold leading-tight"><EntityRichText text={title} candidates={candidates}/></h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100" aria-label="Close"><X size={18}/></button>
        </div>

        <div className="p-4 space-y-4 bg-white">
          {message?.subtitle && (
            <div className="text-sm text-slate-700"><EntityRichText text={message.subtitle} candidates={candidates}/></div>
          )}

          {!!effects.length && (
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="font-semibold mb-2">Outcome</div>
              <ul className="space-y-1">
                {effects.map((e, idx) => {
                  const pos = (e.delta ?? 0) > 0;
                  const neg = (e.delta ?? 0) < 0;
                  return (
                    <li key={idx} className="text-sm">
                      <span data-entity={e.entity || "driver"} data-id={e.id} className="entity-link-driver font-medium cursor-pointer" title="Open profile">
                        {e.name || e.id}
                      </span>
                      {": "}
                      <span className="text-slate-700">{e.label || e.attr}</span>{" "}
                      {isFinite(e.before) && isFinite(e.after) ? (
                        <>
                          <span className="font-medium">{e.before}</span>{" → "}
                          <span className={"font-semibold "+(pos ? "text-green-600" : neg ? "text-red-600" : "")}>{e.after}</span>
                          {isFinite(e.delta) && e.delta !== 0 && (
                            <span className={"ml-1 "+(pos ? "text-green-600" : "text-red-600")}>
                              ({e.delta > 0 ? "+" : ""}{e.delta})
                            </span>
                          )}
                        </>
                      ) : (
                        isFinite(e.delta) && (
                          <span className={(pos ? "text-green-600" : neg ? "text-red-600" : "")+" font-semibold"}>
                            {e.delta > 0 ? "+" : ""}{e.delta}
                          </span>
                        )
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {message?.body && (
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
              <EntityRichText text={message.body} candidates={candidates}/>
            </div>
          )}

          {message?.__debugJSON && (
            <details className="mt-2">
              <summary className="text-xs text-slate-500 cursor-pointer">Meta</summary>
              <pre className="text-xs p-2 rounded bg-slate-50 overflow-auto text-slate-800">{message.__debugJSON}</pre>
            </details>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 p-3 border-t border-slate-200 bg-white rounded-b-2xl">
          <div className="flex flex-wrap gap-2">
            {actions.map((action, idx) => (
              <button
                key={action?.label || idx}
                type="button"
                onClick={() => {
                  const route = action?.route;
                  onClose?.();
                  if (route) navigate(route);
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-700"
              >
                {action?.label || "Open"}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50">Close</button>
        </div>
      </div>
    </div>
  );
}
