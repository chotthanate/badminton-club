import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import AppErrorBoundary from "./AppErrorBoundary.jsx";
import { getLiffMode } from "./liffMode.js";
import "./badminton.css";

const BadmintonApp = lazy(() => import("./BadmintonApp.jsx"));
const LiffPaymentApp = lazy(() => import("./LiffPaymentApp.jsx"));
const LiffSignupApp = lazy(() => import("./LiffSignupApp.jsx"));
const LiveQueueApp = lazy(() => import("./LiveQueueApp.jsx"));
const TournamentLiveApp = lazy(() => import("./TournamentLiveApp.jsx"));

const liffMode = getLiffMode(window.location.search);
const appMode = new URLSearchParams(window.location.search).get("app");

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <Suspense fallback={<main className="badminton-app badminton-auth-page"><section className="badminton-auth-card"><p>กำลังเปิดระบบ…</p></section></main>}>
        {appMode === "tournament-live" ? <TournamentLiveApp /> : liffMode === "payment" ? <LiffPaymentApp /> : liffMode === "signup" ? <LiffSignupApp /> : liffMode === "live" ? <LiveQueueApp /> : <BadmintonApp />}
      </Suspense>
    </AppErrorBoundary>
  </React.StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => console.warn("Service worker registration failed", error)));
}
