import React, { useMemo, useState, useRef } from "react";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "../components/ui/select";
import { useGame } from "../state/GameStore";

/**
 * SETTINGS PAGE
 *
 * Safe-by-default: keeps a local draft and only commits when user clicks Apply.
 * Integrates with GameStore if it exposes updateSettings() or setGameState().
 * Falls back to localStorage so you can plug it in before wiring the store.
 */

const defaultSettings = Object.freeze({
  uiTheme: "auto", // auto | light | dark
  language: "en", // en | pt | fr | es
  dateFormat: "yyyy-MM-dd", // display only
  autosave: true,
  autosaveIntervalMin: 10, // minutes
  notifications: true,
  audio: {
    masterVolume: 70, // 0..100
    sfxVolume: 70,
    musicVolume: 30,
  },
  gameplay: {
    difficulty: "normal", // easy | normal | hard | custom
    simSpeed: 1, // 0.5 | 1 | 2 | 4 (visual speed multiplier)
    rulesEra: "1980", // binds to loaded DB era/year
    enableInjuryRandomEvents: true,
    enableWeatherRandomness: true,
  },
  data: {
    datasource: "json", // json | excel (converter) | remote
    remoteUrl: "", // used if datasource === 'remote'
  },
  developer: {
    showDevTools: false,
    verboseLogs: false,
  },
});

function getInitialSettings(gameState) {
  // Try gameState.settings → localStorage → defaults
  const fromState = gameState?.settings;
  if (fromState) return { ...defaultSettings, ...fromState };
  const ls = localStorage.getItem("f1ml_settings");
  if (ls) {
    try { return { ...defaultSettings, ...JSON.parse(ls) }; } catch {}
  }
  return { ...defaultSettings };
}

export default function Settings() {
  const fileRef = useRef(null);
  const { gameState, saveGame } = useGame();
  const [draft, setDraft] = useState(() => getInitialSettings(gameState));
  const [status, setStatus] = useState("");

  // Helper: commit to store (if available) and persist to localStorage as backup
  const commit = (next) => {
    try {
      // Persist to localStorage as a safety net
      localStorage.setItem("f1ml_settings", JSON.stringify(next));

      // Try to call store helpers if present
      const store = useGame.getState?.();
      if (store) {
        if (typeof store.updateSettings === "function") {
          store.updateSettings(next);
        } else if (typeof store.setGameState === "function") {
          store.setGameState((prev) => ({ ...prev, settings: next }));
        } else if (typeof store.setState === "function") {
          // Zustand fallback
          store.setState({ gameState: { ...(store.gameState || {}), settings: next } });
        }
      }

      // Save using existing util if available
      if (typeof saveGame === "function") saveGame();
      setStatus("Settings applied ✔");
      setTimeout(() => setStatus(""), 2000);
    } catch (err) {
      console.error(err);
      setStatus("Failed to apply settings. Check console.");
    }
  };

  const handleApply = () => commit(draft);
  const handleResetDefaults = () => setDraft({ ...defaultSettings });
  const handleExport = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "f1ml_settings.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        setDraft((prev) => ({ ...prev, ...imported }));
        setStatus("Imported. Review and Apply to confirm.");
      } catch {
        setStatus("Invalid JSON file.");
      }
    };
    reader.readAsText(file);
  };

  // Small helpers
  const set = (path, value) => {
    setDraft((prev) => {
      const next = structuredClone(prev);
      // apply deep path e.g., 'audio.masterVolume'
      const parts = path.split(".");
      let node = next;
      for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]];
      node[parts.at(-1)] = value;
      return next;
    });
  };

  const years = useMemo(() => {
    // Prefer calendar years from gameState, fall back to default 1980
    const cal = gameState?.calendar || [];
    const uniqueYears = Array.from(new Set(cal.map((c) => String(c.year || (c.date?.split("-")?.[0]))).filter(Boolean)));
    return uniqueYears.length ? uniqueYears : ["1980"];
  }, [gameState?.calendar]);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      {!!status && <div className="text-sm text-emerald-500">{status}</div>}

      {/* GAMEPLAY */}
      <Card className="rounded-2xl">
        <CardContent className="p-4 md:p-6 space-y-4">
          <h2 className="text-lg font-semibold">Gameplay</h2>

          <div className="grid md:grid-cols-3 gap-4">
            {/* Difficulty */}
            <div className="space-y-2">
              <label className="text-sm text-gray-400">Difficulty</label>
              <Select value={draft.gameplay.difficulty} onValueChange={(v) => set("gameplay.difficulty", v)}>
                <SelectTrigger><SelectValue placeholder="Select difficulty" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="hard">Hard</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Sim Speed */}
            <div className="space-y-2">
              <label className="text-sm text-gray-400">Simulation speed (×)</label>
              <Input
                type="number"
                min={0.25}
                max={8}
                step={0.25}
                value={draft.gameplay.simSpeed}
                onChange={(e) => set("gameplay.simSpeed", Number(e.target.value) || 1)}
              />
            </div>

            {/* Era / Year */}
            <div className="space-y-2">
              <label className="text-sm text-gray-400">Rules era / Year</label>
              <Select value={draft.gameplay.rulesEra} onValueChange={(v) => set("gameplay.rulesEra", v)}>
                <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                <SelectContent>
                  {years.map((y) => (<SelectItem key={y} value={String(y)}>{y}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={draft.gameplay.enableInjuryRandomEvents}
                onChange={(e) => set("gameplay.enableInjuryRandomEvents", e.target.checked)}
              />
              <span>Random driver injury events</span>
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={draft.gameplay.enableWeatherRandomness}
                onChange={(e) => set("gameplay.enableWeatherRandomness", e.target.checked)}
              />
              <span>Weather randomness</span>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* INTERFACE */}
      <Card className="rounded-2xl">
        <CardContent className="p-4 md:p-6 space-y-4">
          <h2 className="text-lg font-semibold">Interface</h2>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm text-gray-400">Theme</label>
              <Select value={draft.uiTheme} onValueChange={(v) => set("uiTheme", v)}>
                <SelectTrigger><SelectValue placeholder="Theme" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-gray-400">Language</label>
              <Select value={draft.language} onValueChange={(v) => set("language", v)}>
                <SelectTrigger><SelectValue placeholder="Language" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="pt">Português</SelectItem>
                  <SelectItem value="es">Español</SelectItem>
                  <SelectItem value="fr">Français</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-gray-400">Date format</label>
              <Input value={draft.dateFormat} onChange={(e) => set("dateFormat", e.target.value)} />
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={draft.notifications}
                onChange={(e) => set("notifications", e.target.checked)}
              />
              <span>Enable notifications</span>
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={draft.autosave}
                onChange={(e) => set("autosave", e.target.checked)}
              />
              <span>Autosave</span>
            </label>
            <div className="space-y-2">
              <label className="text-sm text-gray-400">Autosave interval (min)</label>
              <Input
                type="number"
                min={1}
                max={120}
                step={1}
                value={draft.autosaveIntervalMin}
                onChange={(e) => set("autosaveIntervalMin", Math.max(1, Number(e.target.value) || 10))}
              />
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-sm text-gray-400">Master volume</label>
              <input
                type="range"
                min={0}
                max={100}
                value={draft.audio.masterVolume}
                onChange={(e) => set("audio.masterVolume", Number(e.target.value))}
                className="w-full"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm text-gray-400">SFX volume</label>
              <input
                type="range"
                min={0}
                max={100}
                value={draft.audio.sfxVolume}
                onChange={(e) => set("audio.sfxVolume", Number(e.target.value))}
                className="w-full"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm text-gray-400">Music volume</label>
              <input
                type="range"
                min={0}
                max={100}
                value={draft.audio.musicVolume}
                onChange={(e) => set("audio.musicVolume", Number(e.target.value))}
                className="w-full"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* DATA & STORAGE */}
      <Card className="rounded-2xl">
        <CardContent className="p-4 md:p-6 space-y-4">
          <h2 className="text-lg font-semibold">Data & Storage</h2>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm text-gray-400">Datasource</label>
              <Select value={draft.data.datasource} onValueChange={(v) => set("data.datasource", v)}>
                <SelectTrigger><SelectValue placeholder="Datasource" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="json">Local JSON</SelectItem>
                  <SelectItem value="excel">Excel (converter)</SelectItem>
                  <SelectItem value="remote">Remote URL</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {draft.data.datasource === "remote" && (
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm text-gray-400">Remote base URL</label>
                <Input
                  placeholder="https://example.com/f1ml/data/"
                  value={draft.data.remoteUrl}
                  onChange={(e) => set("data.remoteUrl", e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={handleExport}>Export settings</Button>
            <input ref={fileRef} type="file" accept="application/json" onChange={handleImport} className="hidden" />
            <Button variant="secondary" onClick={() => fileRef.current?.click()}>Import settings…</Button>
            <Button
              variant="destructive"
              onClick={() => {
                localStorage.clear();
                setStatus("Local storage cleared.");
              }}
            >
              Clear local storage
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ADVANCED */}
      <Card className="rounded-2xl">
        <CardContent className="p-4 md:p-6 space-y-4">
          <h2 className="text-lg font-semibold">Advanced</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={draft.developer.showDevTools}
                onChange={(e) => set("developer.showDevTools", e.target.checked)}
              />
              <span>Show developer tools</span>
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={draft.developer.verboseLogs}
                onChange={(e) => set("developer.verboseLogs", e.target.checked)}
              />
              <span>Verbose logs</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleApply}>Apply</Button>
            <Button variant="outline" onClick={handleResetDefaults}>Reset to defaults</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
