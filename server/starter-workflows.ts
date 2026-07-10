// ─────────────────────────────────────────────────────────────
//  S.A.M. · STARTER WORKFLOWS  (v1.8)
//  Six real, useful workflows shipped ready to install. They double as documentation of the format and
//  as marketing. Two of them (inbox triage, release checklist) END in a dangerous step (send_email,
//  git_push) precisely to show the safety model: the workflow does all the safe prep, then PAUSES at the
//  dangerous step for your OK. `createdAt`/`armed` are set at install time.
// ─────────────────────────────────────────────────────────────

import type { Workflow } from "./workflows.ts";

type Template = Omit<Workflow, "createdAt" | "runs" | "armed">;

export const STARTER_WORKFLOWS: Template[] = [
  {
    id: "inbox-triage", name: "Inbox triage", version: 1,
    description: "Read the inbox, flag what's urgent, and draft replies — then pause before sending.",
    steps: [
      { id: "s1", kind: "tool", label: "Read the latest emails", tool: "read_emails", input: {} },
      { id: "s2", kind: "brain", label: "Triage + draft replies", prompt: "Triage these emails: flag urgent, group by sender, and draft a one-line reply to each that needs one." },
      { id: "s3", kind: "tool", label: "Send the drafted replies", tool: "send_email", input: {} },
    ],
  },
  {
    id: "weekly-review", name: "Weekly review", version: 1,
    description: "Summarise what changed in your watched folders and draft your weekly standup.",
    steps: [
      { id: "s1", kind: "brain", label: "Summarise the week's changes", prompt: "Summarise what changed in my watched folders this week." },
      { id: "s2", kind: "brain", label: "Draft the standup", prompt: "Draft my weekly standup from that summary — wins, in-progress, blockers." },
      { id: "s3", kind: "tool", label: "Save the standup to the vault", tool: "write_file", input: { path: "~/SAM-standup.md" } },
    ],
  },
  {
    id: "research-digest", name: "Research digest", version: 1,
    description: "Research a topic on the live web and return a tight cited digest.",
    steps: [
      { id: "s1", kind: "tool", label: "Research the topic", tool: "research", input: { query: "" } },
      { id: "s2", kind: "brain", label: "Distil into 5 bullets", prompt: "Summarise the top findings into a 5-bullet digest with the sources." },
    ],
  },
  {
    id: "file-org-sweep", name: "File-org sweep", version: 1,
    description: "Find duplicates in a folder and propose a tidy structure (nothing moves without your OK).",
    steps: [
      { id: "s1", kind: "tool", label: "Scan for duplicates", tool: "dedupe_files", input: { dir: "~/Downloads" } },
      { id: "s2", kind: "brain", label: "Propose a tidy structure", prompt: "Propose a clean folder structure for these files and which duplicates to remove." },
    ],
  },
  {
    id: "meeting-notes", name: "Meeting-note processor", version: 1,
    description: "Turn raw meeting notes into decisions, action items with owners, and follow-ups.",
    steps: [
      { id: "s1", kind: "tool", label: "Read the notes file", tool: "read_file", input: { path: "~/notes.md" } },
      { id: "s2", kind: "brain", label: "Structure the notes", prompt: "Turn these raw notes into: decisions, action items (with owners), and follow-ups." },
      { id: "s3", kind: "tool", label: "Save as a note", tool: "create_note", input: { title: "Meeting notes" } },
    ],
  },
  {
    id: "release-checklist", name: "Release checklist", version: 1,
    description: "Check repo status, build a release checklist, then pause before pushing.",
    steps: [
      { id: "s1", kind: "tool", label: "Check repo status", tool: "git_status", input: { dir: "." } },
      { id: "s2", kind: "brain", label: "Build the checklist", prompt: "Given the status, produce a release-readiness checklist and flag anything risky." },
      { id: "s3", kind: "tool", label: "Push the release", tool: "git_push", input: { dir: "." } },
    ],
  },
];
