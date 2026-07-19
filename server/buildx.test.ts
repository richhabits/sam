import { describe, it, expect } from "vitest";
import { loadSkills, routeSkill } from "./skills.ts";

// The buildx skill was landed 2026-07-18. Two things nearly made it inert, and neither was
// visible from reading the file:
//   1. it sat at incoming-cowork/skills-buildx-SKILL.md — a skill only loads from
//      skills/<id>/SKILL.md, so it was just text;
//   2. once placed, "I want to build my own git" still routed to the `build` skill, because
//      routeSkill counted matches equally: build scored 2 ("build","git") vs buildx 1
//      ("build my own"). Its flagship request went to the wrong skill.
// Scoring is now weighted by trigger specificity. These pin both.
describe("buildx skill", () => {
  const skills = loadSkills();
  const buildx = skills.find((s) => s.id === "buildx");

  it("is discovered by the loader", () => {
    expect(buildx, "buildx not found — is it at skills/buildx/SKILL.md?").toBeTruthy();
    expect(buildx!.triggers.length).toBeGreaterThan(5);
    expect(buildx!.body.length).toBeGreaterThan(500);
  });

  it("wins the build-your-own requests it exists for", () => {
    for (const msg of [
      "I want to build my own git",
      "let's build my own redis",
      "build your own database from scratch",
      "how does a shell actually work under the hood",
      "write my own regex engine",
    ]) {
      expect(routeSkill(msg, skills)?.id, `"${msg}" routed wrong`).toBe("buildx");
    }
  });

  it("does NOT steal ordinary build/debug work from the build skill", () => {
    for (const msg of [
      "fix my vercel deploy bug",
      "the api crashed, debug this typescript error",
    ]) {
      expect(routeSkill(msg, skills)?.id, `"${msg}" routed wrong`).toBe("build");
    }
  });

  it("only names tools SAM actually has", () => {
    // read_webpage did not exist; the skill told SAM to call it. A skill that instructs a
    // nonexistent tool fails at the worst moment — mid-task, in front of the user.
    const named = buildx!.body.match(/`([a-z][a-z0-9_]{3,})`/g) ?? [];
    expect(named.join(" ")).not.toMatch(/read_webpage/);
    expect(buildx!.body).toContain("open_url");
  });

  it("keeps the finance lock — money never gets the toy treatment", () => {
    // The safety-relevant line: trading/finance builds route to a strict finance-safety constitution
    // and its gates, not to a weekend tutorial. No side door to money via "just learning".
    expect(buildx!.body).toMatch(/finance-safety/);
    expect(buildx!.body.toLowerCase()).toMatch(/trading|finance/);
  });

  it("keeps proof-gated milestones — the no-fake-receipts rule applied to learning", () => {
    expect(buildx!.body.toLowerCase()).toMatch(/proof/);
    expect(buildx!.body.toLowerCase()).toMatch(/milestone/);
  });
});
