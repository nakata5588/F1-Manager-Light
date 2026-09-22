// src/layouts/HubLayout.jsx
import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "../components/Sidebar.jsx";
import Header from "../components/ui/header";

const PAGE_TITLES = {
  "/Home": "Home",
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
  "/RaceWeekend": "Race Weekend",
  "/Settings": "Settings",
  "/AssetTest": "Asset Test",
};

export default function HubLayout() {
  const { pathname } = useLocation();
  const pageTitle = PAGE_TITLES[pathname] || "F1 Manager Light";

  return (
    <div className="min-h-screen flex bg-[#090b10]">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <Header pageTitle={pageTitle} />
        <main className="flex-1 min-w-0 bg-[#090b10]">
          <div className="w-full px-3 md:px-5 py-4 md:py-5">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
