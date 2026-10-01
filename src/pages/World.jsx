import React from "react";
import { Navigate, useLocation } from "react-router-dom";

export default function World(){
  const { search }=useLocation();
  const params=new URLSearchParams(search);
  const target=params.get("view")==="champions"?"/Champions":"/LowerSeries";
  return <Navigate to={target} replace/>;
}
