// src/layouts/HubLayout.jsx
import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useGame } from "../state/GameStore.js";
import { playerManagerIsActiveTeamPrincipal } from "../domain/managerEmployment.js";
import Sidebar from "../components/Sidebar.jsx";
import Header from "../components/ui/header";

const PAGE_TITLES = {
  "/Home": "Home",
  "/ManagerProfile": "My Profile",
  "/Inbox": "Inbox",
  "/CalendarPage": "Calendar",
  "/Team": "My Team",
  "/Car": "Cars",
  "/MyDrivers": "Drivers",
  "/MyStaff": "Staff",
  "/Development": "Development",
  "/HQ": "Facilities",
  "/Academy": "Academy",
  "/Scouting": "Scouting",
  "/Standings": "Standings",
  "/Results": "Results",
  "/Finances": "Finances",
  "/Board": "Board",
  "/Teams": "Teams",
  "/Drivers": "Driver Market",
  "/Staff": "Staff Market",
  "/World": "World",
  "/RaceWeekend": "Race Weekend",
  "/Settings": "Settings",
  "/GameSettings": "Settings",
  "/AssetTest": "Asset Test",
};

export default function HubLayout() {
  const { pathname } = useLocation();
  const gameState=useGame((state)=>state.gameState);
  const unemployed=Boolean(gameState?.manager)&&!playerManagerIsActiveTeamPrincipal(gameState);
  const unemployedAllowed=
    pathname==="/ManagerProfile"||
    pathname==="/Inbox"||
    pathname==="/CalendarPage"||
    pathname==="/Standings"||
    pathname==="/Results"||
    pathname==="/World"||
    pathname==="/Champions"||
    pathname==="/Teams"||
    pathname==="/Drivers"||
    pathname==="/Staff"||
    pathname==="/GameSettings"||
    pathname.startsWith("/drivers/")||
    pathname.startsWith("/teams/")||
    pathname.startsWith("/staff/");
  if(unemployed&&!unemployedAllowed){
    return <Navigate to="/ManagerProfile" replace/>;
  }
  const pageTitle =
    PAGE_TITLES[pathname] ||
    (pathname.startsWith("/drivers/") ? "Driver Profile" :
      pathname.startsWith("/teams/") ? "Team Profile" :
      pathname.startsWith("/staff/") ? "Staff Profile" :
      "F1 Manager Light");

  return (
    <div className="min-h-screen flex bg-[#090b10]">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <Header pageTitle={pageTitle} />
        <main className="flex-1 min-w-0 bg-[#090b10]">
          <div className="f1ml-responsive-shell py-4 md:py-5">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
