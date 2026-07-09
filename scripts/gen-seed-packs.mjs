#!/usr/bin/env node
// Generate the 6 seed SAM Packs (unsigned .sampack JSON) into packs/. They double as marketing —
// each shows what SAM can do for a real use-case. Import runs the safety pipeline; these carry only
// skills/prompts/watched-folder templates (no code), so they're safe playbooks.
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "packs");
mkdirSync(out, { recursive: true });

const skill = (id, title, body) => ({ id, body: `---\nname: ${title}\ntier: free\n---\n\n# ${title}\n\n${body}` });
const pack = (name, description, contents) => ({
  format: "sampack/1",
  meta: { name, description, author: "HECTIC", createdAt: 0 },
  contents: { skills: [], tools: [], prompts: [], watchedTemplates: [], ...contents },
});

const PACKS = {
  "landlord-dispute": pack("Landlord Dispute Assistant", "Fight an unfair deposit deduction or disrepair issue — evidence-first, calm, and by the book.", {
    skills: [skill("landlord_dispute", "Landlord Dispute Assistant",
      "Help a tenant handle a deposit or disrepair dispute in England/Wales.\n- Establish the facts + timeline; list the evidence they have (photos, inventory, messages).\n- Cite the relevant rights plainly (deposit protection, the 'reasonable wear and tear' standard) — flag when to check current gov.uk guidance.\n- Draft a firm, polite letter/email to the landlord or agent.\n- If unresolved, explain the deposit-scheme dispute (ADR) route and how to submit evidence.\nAlways: facts first, no legal bluffing, suggest free routes before paid.")],
    prompts: [{ title: "Deposit challenge", text: "My landlord is deducting £{amount} from my deposit for {reason}. Draft a firm letter challenging it." }],
    watchedTemplates: [{ label: "Tenancy docs", hint: "~/Documents/Tenancy" }],
  }),
  "planning-application": pack("Planning Application Helper", "Navigate a UK planning application or objection without a consultant.", {
    skills: [skill("planning_application", "Planning Application Helper",
      "Guide a householder through a planning application or a neighbour objection.\n- Clarify what they're doing (extension, change of use) and whether it's permitted development.\n- Explain the process + typical timelines in plain English; flag to verify on the local council portal.\n- Draft a clear design-and-access style summary or a reasoned objection letter grounded in material planning considerations (overlooking, light, character) — not personal grievances.")],
    prompts: [{ title: "Objection letter", text: "Draft a planning objection to application {ref} on the grounds of {concern}." }],
  }),
  "content-studio": pack("Content Studio", "Turn one idea into a week of on-brand content across channels.", {
    skills: [skill("content_studio", "Content Studio",
      "Act as a sharp content lead.\n- Take one idea and produce a hook, a long post, 3 short variants, and a caption set.\n- Keep the brand voice consistent; punchy, no fluff.\n- Suggest a posting cadence and the single best channel to start.")],
    prompts: [{ title: "Repurpose", text: "Turn this into a week of content across X, LinkedIn and Instagram: {idea}" }],
    watchedTemplates: [{ label: "Brand assets", hint: "~/Documents/Brand" }],
  }),
  "dev-sidekick": pack("Dev Sidekick", "A pragmatic pair-programmer for small projects — read the repo, explain, fix.", {
    skills: [skill("dev_sidekick", "Dev Sidekick",
      "Be a pragmatic senior engineer.\n- Read the relevant files before answering; cite paths.\n- Prefer the simplest change that works; explain the why in plain English.\n- Never claim something runs unless a tool actually ran it; if a test fails, say so.")],
    prompts: [{ title: "Explain this repo", text: "Give me a 5-bullet map of this codebase and where to start." }],
    watchedTemplates: [{ label: "Projects", hint: "~/Developer" }],
  }),
  "research-analyst": pack("Research Analyst", "Multi-source, fact-checked briefings with citations.", {
    skills: [skill("research_analyst", "Research Analyst",
      "Produce a tight, cited briefing.\n- Search multiple sources; prefer primary + recent.\n- Separate fact from inference; flag uncertainty.\n- End with a 3-bullet 'what this means' and the sources used.")],
    prompts: [{ title: "Brief me", text: "Give me a cited briefing on {topic} — key facts, the debate, and what it means." }],
  }),
  "home-ops": pack("Home Ops", "Run the household admin — bills, renewals, reminders, the boring stuff.", {
    skills: [skill("home_ops", "Home Ops",
      "Be the calm household operator.\n- Track renewals/bills the user mentions and remind before they're due.\n- Draft the annoying emails (cancellations, complaints, queries) firmly and briefly.\n- Suggest the cheapest sensible option; never overspend.")],
    prompts: [{ title: "Cancel something", text: "Draft an email to cancel my {service} subscription effective {date}." }],
    watchedTemplates: [{ label: "Household", hint: "~/Documents/Home" }],
  }),
};

for (const [file, p] of Object.entries(PACKS)) writeFileSync(join(out, `${file}.sampack`), JSON.stringify(p, null, 2));
console.log(`✓ Wrote ${Object.keys(PACKS).length} seed packs → packs/`);
