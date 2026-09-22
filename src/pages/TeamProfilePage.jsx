import React from "react";
import { ArrowLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import TeamModal from "../components/entity/TeamModal.jsx";

export default function TeamProfilePage(){
  const {teamId}=useParams();
  const navigate=useNavigate();
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={()=>navigate(-1)}
        className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white"
      >
        <ArrowLeft size={14}/> Back
      </button>
      <TeamModal entity={{type:"team",id:teamId,tab:"overview"}} pageMode />
    </div>
  );
}
