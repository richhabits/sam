// ─────────────────────────────────────────────────────────────
//  S.A.M. · TRIGGERS  (v1.8 — anticipation within consent rails)
//  A local rules layer that turns conditions (a new file in a watched folder, a due reminder, the
//  morning tick) into SUGGESTION CARDS. It NEVER executes: it only surfaces. A card is produced only
//  for a behavior the user has enabled (consent.ts), every surfaced card is written to the autonomy log,
//  and a card whose action would hit a dangerous tool is flagged so the UI shows it — and so that even
//  if the user accepts it, the normal permission gate (authz.ts) still asks before it runs.
//
//  This module has NO capability to run a tool. Acceptance routes a card's action back through the
//  agent loop, which gates it. That separation is the whole safety story: consent decides surfacing,
//  the gate decides execution.
// ─────────────────────────────────────────────────────────────

import { isEnabled, type Behavior } from "./consent.ts";
import { isDangerous } from "./authz.ts";
import { logAutonomy } from "./autonomy-log.ts";

export interface SuggestionCard {
  id: string;
  behavior: Behavior;
  title: string;
  body: string;
  action?: { tool: string; input: any };   // if the user accepts, this runs through the normal gate
  dangerous: boolean;                        // true ⇒ action hits the dangerous gate (always asks)
  createdAt: string;
}

// The world the engine reasons over — passed in (the caller owns the clock + fs) so this is pure + testable.
export interface TriggerWorld {
  now: string;                               // ISO timestamp
  newFiles?: { path: string; name: string }[];
  dueReminders?: { id: string; text: string }[];
}

let seq = 0;

export function evaluateTriggers(world: TriggerWorld): SuggestionCard[] {
  const cards: SuggestionCard[] = [];
  const push = (behavior: Behavior, title: string, body: string, action?: { tool: string; input: any }) => {
    const dangerous = !!action && isDangerous(action.tool);
    cards.push({ id: `sg_${seq++}_${world.now}`, behavior, title, body, action, dangerous, createdAt: world.now });
    logAutonomy({ at: world.now, behavior, kind: "suggested", summary: title, tool: action?.tool });
  };

  if (isEnabled("file-watch-suggestions")) {
    for (const f of (world.newFiles || []).slice(0, 5)) {
      push("file-watch-suggestions", `New file: ${f.name}`,
        `“${f.name}” just landed in a watched folder — want me to summarise it?`,
        { tool: "read_file", input: { path: f.path } });
    }
  }
  if (isEnabled("reminders")) {
    for (const r of world.dueReminders || []) {
      push("reminders", `Reminder: ${r.text}`, r.text);
    }
  }
  return cards;
}
