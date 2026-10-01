import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import TeamModal from "../components/entity/TeamModal.jsx";

export default function TeamProfilePage(){
  const {teamId}=useParams();
  const navigate=useNavigate();
  return <TeamModal
    entity={{type:"team",id:teamId,tab:"overview"}}
    pageMode
    onBack={()=>navigate(-1)}
  />;
}
