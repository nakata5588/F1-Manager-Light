import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import DriverModal from "../components/entity/DriverModal.jsx";

export default function DriverProfilePage(){
  const {driverId}=useParams();
  const navigate=useNavigate();
  return <DriverModal
    entity={{type:"driver",id:driverId,tab:"overview"}}
    pageMode
    onBack={()=>navigate(-1)}
  />;
}
