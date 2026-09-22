import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useGame } from "./state/GameStore";
import { useEventStore } from "./state/EventStore";
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
      <DatabaseBinder />
      <ThemeBinder />
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
          <Route path="/Inbox" element={<Inbox />} />
          <Route path="/Drivers" element={<Drivers />} />
          <Route path="/Teams" element={<Teams />} />
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
