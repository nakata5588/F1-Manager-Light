// src/layouts/HubLayout.jsx
import React from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar.jsx";

// ✅ usa o Header oficial (minúsculas!)
import Header from "../components/ui/header";

export default function HubLayout() {
  return (
    <div className="min-h-screen flex bg-gray-100">
      <Sidebar />

      <div className="flex-1 flex flex-col">
        {/* Top header único */}
        <Header pageTitle="" />

        {/* Content */}
        <main className="flex-1">
          <div className="max-w-9xl mx-auto px-4 py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
