import { describe, it, expect, beforeEach } from "vitest";
import {
  STARTER_PLAYBOOKS,
  seedStarterPlaybooks,
  getStarterPlaybookDef,
} from "./starter-playbooks.ts";
import { renderTemplate, extractParams, listPlaybooks } from "./yard/playbooks.ts";

describe("S.A.M. Yard Starter Playbooks", () => {
  it("includes all 5 core starter playbooks", () => {
    expect(STARTER_PLAYBOOKS.length).toBe(5);
    const ids = STARTER_PLAYBOOKS.map((p) => p.id);
    expect(ids).toContain("fullstack-saas-core");
    expect(ids).toContain("prediction-market-bot");
    expect(ids).toContain("executive-deep-research");
    expect(ids).toContain("studio-video-pipeline");
    expect(ids).toContain("zero-cost-ai-proxy");
  });

  it("extracts parameters and correctly renders default templates", () => {
    const saas = getStarterPlaybookDef("fullstack-saas-core");
    expect(saas).toBeDefined();

    const params = extractParams(saas!.template);
    expect(params).toContain("appName");
    expect(params).toContain("appDomain");

    const rendered = renderTemplate(saas!.template, {
      appName: "RocketShip SaaS",
      appDomain: "Fintech Invoicing",
    });

    expect(rendered).toContain('named "RocketShip SaaS"');
    expect(rendered).toContain("Target domain: Fintech Invoicing.");
  });

  it("preserves unfilled template placeholders without mangling text", () => {
    const research = getStarterPlaybookDef("executive-deep-research");
    const rendered = renderTemplate(research!.template, {});
    expect(rendered).toContain("{{researchTopic}}");
    expect(rendered).toContain("{{focusAngle}}");
  });

  it("seeds starter playbooks into Yard directory without duplication", () => {
    const seededFirst = seedStarterPlaybooks();
    expect(Array.isArray(seededFirst)).toBe(true);

    const all = listPlaybooks();
    expect(all.length).toBeGreaterThanOrEqual(5);

    // Second run should be idempotent
    const seededSecond = seedStarterPlaybooks();
    expect(seededSecond.length).toBe(0);
  });
});
