export function getLiffMode(search) {
  const states = [];
  let params = new URLSearchParams(search);
  for (let depth = 0; depth < 3; depth += 1) {
    states.push(params);
    const nestedState = params.get("liff.state");
    if (!nestedState) break;
    let decodedState = nestedState;
    for (let pass = 0; pass < 2 && /%[0-9a-f]{2}/i.test(decodedState); pass += 1) {
      try { decodedState = decodeURIComponent(decodedState); } catch { break; }
    }
    params = new URLSearchParams(decodedState.startsWith("?") ? decodedState : `?${decodedState}`);
  }
  if (states.some((state) => state.get("mode") === "payment")) return "payment";
  for (const state of states.slice(1).reverse()) {
    const nestedMode = state.get("liff");
    if (nestedMode === "payment" || nestedMode === "signup" || nestedMode === "live") return nestedMode;
  }
  const directMode = states[0]?.get("liff");
  return ["payment", "signup", "live"].includes(directMode) ? directMode : null;
}
