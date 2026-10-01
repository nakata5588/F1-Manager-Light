import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import StaffModal from "../components/entity/StaffModal.jsx";

export default function StaffProfilePage(){
  const {staffId}=useParams();
  const navigate=useNavigate();
  return <StaffModal
    entity={{type:"staff",id:staffId,tab:"overview"}}
    pageMode
    onBack={()=>navigate(-1)}
  />;
}
