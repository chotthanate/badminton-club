import migration from "../../supabase/migrations/20261023231637_test_round_and_queue_actions.sql?raw";
import mergeMigration from "../../supabase/migrations/20261023232127_safe_member_merge.sql?raw";
import lineBot from "../../supabase/functions/line-bot/index.ts?raw";
import liffProfile from "../../supabase/functions/_shared/liffProfile.js?raw";
import liveQueueTime from "../../supabase/functions/_shared/liveQueueTime.js?raw";
import liffClubContext from "../../supabase/functions/_shared/liffClubContext.js?raw";

const files = [
  ["migration", "20261023231637_test_round_and_queue_actions.sql", migration],
  ["merge-migration", "20261023232127_safe_member_merge.sql", mergeMigration],
  ["line-bot", "line-bot/index.ts", lineBot],
  ["liff-profile", "_shared/liffProfile.js", liffProfile],
  ["live-queue-time", "_shared/liveQueueTime.js", liveQueueTime],
  ["liff-club-context", "_shared/liffClubContext.js", liffClubContext],
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
