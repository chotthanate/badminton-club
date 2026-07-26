import React from "react";
import { createRoot } from "react-dom/client";
import BadmintonApp from "./BadmintonApp.jsx";
import LiffPaymentApp from "./LiffPaymentApp.jsx";
import LiffSignupApp from "./LiffSignupApp.jsx";
import "./badminton.css";

const liffMode = getLiffMode(window.location.search);

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {liffMode === "payment" ? <LiffPaymentApp /> : liffMode === "signup" ? <LiffSignupApp /> : <BadmintonApp />}
  </React.StrictMode>,
);

function getLiffMode(search) {
  const params = new URLSearchParams(search);
  const nestedState = params.get("liff.state");
  if (nestedState) {
    const nestedMode = new URLSearchParams(nestedState.startsWith("?") ? nestedState : `?${nestedState}`).get("liff");
    if (nestedMode === "payment" || nestedMode === "signup") return nestedMode;
  }
  const directMode = params.get("liff");
  return directMode === "payment" || directMode === "signup" ? directMode : null;
}
