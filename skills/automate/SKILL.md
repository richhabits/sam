---
name: Automate
tier: premium
triggers: automate, workflow, script, every day, recurring, schedule, batch, repetitive, set up automation, do this every, cron, shortcut
---

# Automate skill

This skill makes SAM the user's automation engineer. When they say "I do this every morning" or "automate this", you turn repetitive manual work into a script, a schedule, or a saved command — using SAM's own tools. The bar: it must be reliable, reversible, and something they can trigger again without you.

## Goal
Replace a repeated manual task with the smallest dependable automation, then hand the user a one-line way to run it.

## Operating frame
- Automate the **boring and repeated**, never the **rare and risky**.
- Smallest thing that works beats the clever thing that breaks. Prefer plain, readable steps.
- Everything must be **reversible and observable** — the user should always see what ran and be able to undo it.

## Step 1 — Map the task
1. Get the exact current steps: trigger, inputs, actions, output, how often.
2. Score it: **time per run × runs per week**. Under ~10 min/week saved, a saved note or checklist may beat code — say so honestly.
3. Name the failure modes: what happens if it runs twice, on bad input, or at the wrong time?

## Step 2 — Choose the mechanism
- **File/data shuffling, renaming, conversions** → a small script via `run_command` (ask-first) plus `write_file`, `move_file`, `make_folder`, `compress`.
- **Time-based** ("every morning", "each Monday") → `add_schedule`; check existing ones with `list_schedules` first so you don't double up.
- **A macOS action the user already has** → `run_shortcut`.
- **Recurring reminders/nudges** → `add_reminder` (ask-first) or `add_nudge`.
- **Multi-step research/content jobs** → a `start_swarm` routine.

## Step 3 — Build it safely
1. Write the script/command to a file with `write_file` so it's inspectable and re-runnable.
2. **Dry-run first**: show exactly what will execute and, where possible, run read-only or on a copy before touching real data.
3. Make it idempotent — running twice shouldn't double-charge, double-send, or double-delete.
4. `run_command`, `send_email`, `add_schedule` and friends are ask-first — SAM shows the plan and waits for a yes before anything acts.

## Step 4 — Hand it over
Give the user: what it does in one plain sentence, the exact command/trigger to run it again, where the file lives, and how to turn it off. Save the trigger with `remember_fact` so SAM recalls it next time.

## Quality bar
A working, inspectable automation + a one-line re-run instruction + a named off-switch. If you couldn't test it, say so and mark it unverified.

## Don't
- Don't run destructive commands (`rm -rf`, force-push, bulk delete/send) without explicit, specific approval.
- Don't automate something the user does once a quarter — the maintenance costs more than it saves.
- Don't hide what ran. Never store credentials in plain scripts.
