import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useGame } from "./state/GameStore";
import { useEventStore } from "./state/EventStore";
import { contentMaxForLayout, effectiveAnimations, effectiveUiScale, viewportLayout } from "./domain/userPreferences.js";
import HubLayout from "./layouts/HubLayout.jsx";
import RaceWeekendLayout from "./layouts/RaceWeekendLayout.jsx";

import EntityModalRoot from "./components/entity/EntityModalRoot.jsx";
import EntityClickBus from "./components/entity/EntityClickBus.jsx";
import { bindEntityDeepLinkOnce } from "./state/ModalStore.js";
import SeasonSummaryModal from "./components/entity/SeasonSummaryModal.jsx";
import { Toaster } from "./components/ui/Toaster.jsx";

import Academy from "./pages/Academy.jsx";
import AssetTest from "./pages/AssetTest.jsx";
import Board from "./pages/Board.jsx";
import CalendarPage from "./pages/CalendarPage.jsx";
import CarPage from "./pages/Car.jsx";
import Drivers from "./pages/Drivers.jsx";
import Finances from "./pages/Finances.jsx";
import Home from "./pages/Home.jsx";
import MyDrivers from "./pages/MyDrivers.jsx";
import MyStaff from "./pages/MyStaff.jsx";
import Teams from "./pages/Teams.jsx";
import HQ from "./pages/HQ.jsx";
import Inbox from "./pages/Inbox.jsx";
import LoadGame from "./pages/LoadGame.jsx";
import MainMenu from "./pages/MainMenu.jsx";
import NewGame from "./pages/NewGame.jsx";
import CreateTeam from "./pages/CreateTeam.jsx";
import Scouting from "./pages/Scouting.jsx";
import Settings from "./pages/Settings.jsx";
import Staff from "./pages/Staff.jsx";
import Standings from "./pages/Standings.jsx";
import Team from "./pages/Team.jsx";
import Results from "./pages/Results.jsx";
import RaceWeekend from "./pages/RaceWeekend.jsx";
import DriverProfilePage from "./pages/DriverProfilePage.jsx";
import TeamProfilePage from "./pages/TeamProfilePage.jsx";
import StaffProfilePage from "./pages/StaffProfilePage.jsx";
import ManagerProfile from "./pages/ManagerProfile.jsx";

import DebugToolbar from "@/components/dev/DebugToolbar";

let databaseLoadPromise = null;

function DatabaseBinder() {
  const loadData = useGame((s) => s.loadData);
  const dbReady = useGame((s) => Boolean(
    s.gameState?.dbDrivers?.length &&
    s.gameState?.dbTeams?.length &&
    s.gameState?.dbCalendar?.length
  ));

  useEffect(() => {
    if (dbReady) return;
    if (!databaseLoadPromise) {
      databaseLoadPromise = Promise.resolve(loadData())
        .catch((error) => console.error("[Database] loadData failed:", error))
        .finally(() => { databaseLoadPromise = null; });
    }
  }, [dbReady, loadData]);

  return null;
}

function SessionPersistenceBinder() {
  const saveLocal = useGame((s) => s.saveLocal);

  useEffect(() => {
    const persist = () => {
      try { saveLocal(); } catch (error) {
        console.warn("[Session] rolling checkpoint failed:", error);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") persist();
    };

    window.addEventListener("pagehide", persist);
    window.addEventListener("beforeunload", persist);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", persist);
      window.removeEventListener("beforeunload", persist);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [saveLocal]);

  return null;
}

function ThemeBinder() {
  const uiTheme = useGame((s) => s.gameState?.settings?.uiTheme);
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = uiTheme || "auto";
    if (uiTheme === "dark") el.classList.add("dark");
    else if (uiTheme === "light") el.classList.remove("dark");
    else {
      const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
      const apply = () => (mq?.matches ? el.classList.add("dark") : el.classList.remove("dark"));
      apply();
      mq?.addEventListener?.("change", apply);
      return () => mq?.removeEventListener?.("change", apply);
    }
  }, [uiTheme]);
  return null;
}

function DisplayBinder() {
  const display = useGame((s) => s.gameState?.settings?.display);
  useEffect(() => {
    const el=document.documentElement;
    const motionQuery=window.matchMedia?.("(prefers-reduced-motion: reduce)");

    const apply=()=>{
      const width=window.innerWidth||document.documentElement.clientWidth||1440;
      const height=window.innerHeight||document.documentElement.clientHeight||900;
      const layout=viewportLayout(width,height);
      const scale=effectiveUiScale(display?.uiScale,width,height);
      const animations=effectiveAnimations(display?.animations,Boolean(motionQuery?.matches));

      el.dataset.screenLayout=layout;
      el.dataset.uiScale=display?.uiScale||"auto";
      el.dataset.uiScaleEffective=scale;
      el.dataset.uiDensity=display?.informationDensity||"normal";
      el.dataset.animations=animations;
      el.dataset.tooltips=display?.tooltips===false?"off":"on";
      el.style.setProperty("--f1ml-content-max",contentMaxForLayout(layout));
    };

    apply();
    window.addEventListener("resize",apply);
    motionQuery?.addEventListener?.("change",apply);
    return ()=>{
      window.removeEventListener("resize",apply);
      motionQuery?.removeEventListener?.("change",apply);
    };
  }, [display?.uiScale,display?.informationDensity,display?.animations,display?.tooltips]);
  return null;
}

export default function App() {
  useEffect(() => {
    const unbind = bindEntityDeepLinkOnce();
    return () => unbind?.();
  }, []);

  useEffect(() => {
    useEventStore.getState().loadTemplates().catch((e) => {
      console.error("[EventStore] loadTemplates failed:", e);
    });
  }, []);

  const updateSettings = useGame((s) => s.updateSettings);
  useEffect(() => {
    try {
      if (import.meta?.env?.DEV) {
        updateSettings({ developer: { showDevTools: true, verboseLogs: true } });
      }
    } catch {
      // no-op outside Vite
    }
  }, [updateSettings]);

  return (
    <BrowserRouter>
      <SessionPersistenceBinder />
      <DatabaseBinder />
      <ThemeBinder />
      <DisplayBinder />
      <EntityModalRoot />
      <EntityClickBus />
      <Toaster />
      <DebugToolbar />
      <SeasonSummaryModal />

      <Routes>
        <Route path="/" element={<MainMenu />} />
        <Route path="/NewGame" element={<NewGame />} />
        <Route path="/CreateTeam" element={<CreateTeam />} />
        <Route path="/LoadGame" element={<LoadGame />} />

        <Route element={<HubLayout />}>
          <Route path="/Home" element={<Home />} />
          <Route path="/ManagerProfile" element={<ManagerProfile />} />
          <Route path="/Inbox" element={<Inbox />} />
          <Route path="/Drivers" element={<Drivers />} />
          <Route path="/drivers/:driverId" element={<DriverProfilePage />} />
          <Route path="/Teams" element={<Teams />} />
          <Route path="/teams/:teamId" element={<TeamProfilePage />} />
          <Route path="/Team" element={<Team />} />
          <Route path="/MyDrivers" element={<MyDrivers />} />
          <Route path="/MyStaff" element={<MyStaff />} />
          <Route path="/Standings" element={<Standings />} />
          <Route path="/Results" element={<Results />} />
          <Route path="/Settings" element={<Settings />} />
          <Route path="/CalendarPage" element={<CalendarPage />} />
          <Route path="/Development" element={<Navigate to="/Car?view=development" replace />} />
          <Route path="/Car" element={<CarPage />} />
          <Route path="/HQ" element={<HQ />} />
          <Route path="/Finances" element={<Finances />} />
          <Route path="/Board" element={<Board />} />
          <Route path="/Scouting" element={<Scouting />} />
          <Route path="/Academy" element={<Academy />} />
          <Route path="/Staff" element={<Staff />} />
          <Route path="/staff/:staffId" element={<StaffProfilePage />} />
          <Route path="/AssetTest" element={<AssetTest />} />
        </Route>

        <Route element={<RaceWeekendLayout />}>
          <Route path="/RaceWeekend" element={<RaceWeekend />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
