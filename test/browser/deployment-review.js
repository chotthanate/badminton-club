import migration from "../../supabase/migrations/20261024195328_live_departures_court_extensions_and_withdrawals.sql?raw";
import lineBot from "../../supabase/functions/line-bot/index.ts?raw";

const files = [
  ["migration", "20261024195328_live_departures_court_extensions_and_withdrawals.sql", migration],
  ["line-bot", "line-bot/index.ts", lineBot],
];
const container = document.getElementById("source-files");
for (const [id, name, source] of files) {
  const section = document.createElement("section");
  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = name;
  const textarea = document.createElement("textarea");
  textarea.id = id;
  textarea.readOnly = true;
  textarea.value = source;
  textarea.spellcheck = false;
  const description = document.createElement("small");
  description.textContent = `${source.split("\n").length} lines · ${source.length} characters`;
  section.append(label, textarea, description);
  container.append(section);
}
