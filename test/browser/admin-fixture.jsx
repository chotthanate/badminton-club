import React, { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import BadmintonApp from "../../src/BadmintonApp.jsx";
import { fixture, subscribe, snapshot, armFailure, armReadFailure, armSlowRead } from "./admin-fixture-state.js";
import "../../src/badminton.css";

function Fixture() {
  useSyncExternalStore(subscribe, snapshot);
  return <><aside style={{ position: "relative", zIndex: 100, padding: 12, background: "#f4ead2", fontFamily: "sans-serif" }}>
    <strong>Local fixture · all repository and auth calls are mocked</strong>
    <div><button onClick={armFailure} type="button">Fixture: fail next write</button><button onClick={armReadFailure} type="button">Fixture: fail next refresh</button><button onClick={armSlowRead} type="button">Fixture: delay next full refresh</button></div>
    <output data-testid="fixture-summary">{JSON.stringify({ pending: fixture.inFlight, maxParallelWrites: fixture.maxParallelWrites, writes: fixture.writes, failures: fixture.failures, reads: fixture.reads })}</output>
  </aside><BadmintonApp /></>;
}
const root = import.meta.hot?.data.fixtureRoot || createRoot(document.getElementById("root"));
if (import.meta.hot) { import.meta.hot.data.fixtureRoot = root; import.meta.hot.accept(); }
root.render(<Fixture />);
