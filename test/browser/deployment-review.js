import migration from "../../supabase/migrations/20261023215740_reliable_queue_and_member_profiles.sql?raw";
import lineBot from "../../supabase/functions/line-bot/index.ts?raw";
import paymentSubmission from "../../supabase/functions/_shared/paymentSubmission.js?raw";
import liffProfile from "../../supabase/functions/_shared/liffProfile.js?raw";

const files = [
  ["migration", "20261023215740_reliable_queue_and_member_profiles.sql", migration],
  ["line-bot", "line-bot/index.ts", lineBot],
  ["payment-submission", "_shared/paymentSubmission.js", paymentSubmission],
  ["liff-profile", "_shared/liffProfile.js", liffProfile],
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
