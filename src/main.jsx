import React from "react";
import { createRoot } from "react-dom/client";
import BadmintonApp from "./BadmintonApp.jsx";
import LiffPaymentApp from "./LiffPaymentApp.jsx";
import LiffSignupApp from "./LiffSignupApp.jsx";
import LiveQueueApp from "./LiveQueueApp.jsx";
import { getLiffMode } from "./liffMode.js";
import "./badminton.css";

const liffMode = getLiffMode(window.location.search);

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {liffMode === "payment" ? <LiffPaymentApp /> : liffMode === "signup" ? <LiffSignupApp /> : liffMode === "live" ? <LiveQueueApp /> : <BadmintonApp />}
  </React.StrictMode>,
);
