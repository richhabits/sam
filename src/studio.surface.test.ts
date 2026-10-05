// Studio must be a create surface, not a junk drawer of fake engines.
// Source-text assertions: a render test cannot tell you a label is lying.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const studio = readFileSync(join(import.meta.dirname, "StudioView.tsx"), "utf8");
const app = readFileSync(join(import.meta.dirname, "App.tsx"), "utf8");
const gate = readFileSync(join(import.meta.dirname, "FlipItGate.tsx"), "utf8");
const preload = readFileSync(join(import.meta.dirname, "..", "electron", "preload.ts"), "utf8");
const main = readFileSync(join(import.meta.dirname, "..", "electron", "main.ts"), "utf8");

describe("Studio is a Higgsfield-class create surface", () => {
  it("exposes Image, Video, Motion, Speak and Canvas as real modes", () => {
    for (const mode of ["image", "video", "motion", "speak", "canvas"]) {
      expect(studio, `${mode} mode`).toContain(`id: "${mode}"`);
    }
    expect(studio).toContain('label: "Image"');
    expect(studio).toContain('label: "Video"');
    expect(studio).toContain('label: "Motion"');
    expect(studio).toContain('label: "Speak"');
    expect(studio).toContain('label: "Canvas"');
  });

  it("calls the lanes SAM actually has", () => {
    expect(studio).toContain("/api/studio/image");
    expect(studio).toContain("/api/studio/video");
    expect(studio).toContain("/api/studio/motion/control");
    expect(studio).toContain("/api/studio/lipsync");
    expect(studio).toContain("/api/studio/enhance");
    expect(studio).toContain("/api/studio/vary");
    expect(studio).toContain("/api/studio/extend");
    expect(studio).toContain("preferFree");
    expect(studio).toContain(">Queue<");
    expect(studio).toContain(">Vary<");
    expect(studio).toContain(">Extend<");
  });

  it("does not advertise engines SAM does not run", () => {
    expect(studio).not.toContain("Flux.1 Cinematic");
    expect(studio).not.toContain("Higgsfield V2");
    expect(studio).not.toContain("OpenAI Sora");
    expect(studio).not.toContain("Wan 2.1");
    expect(studio).not.toContain("Director Pro");
  });

  it("keeps a style list the preview route can paint", () => {
    expect(studio).toMatch(/const STYLES/);
    expect(studio).toContain('id: "cinematic"');
    expect(studio).toContain('id: "dusk"');
  });

  it("persists generations and offers one-click reuse or refine", () => {
    expect(studio).toContain("sam.studio.history");
    expect(studio).toContain("localStorage.setItem(HISTORY_KEY");
    expect(studio).toContain("reuseActive");
    expect(studio).toContain("refineActive");
    expect(studio).toContain(">Reuse<");
    expect(studio).toContain(">Refine<");
  });

  it("does not silently pass a still off as a video", () => {
    expect(studio).toContain("VIDEO_KEY_ERROR");
    expect(studio).toContain("Make a still");
    expect(studio).not.toContain("made a still instead");
  });
});

describe("header tabs open the job they name", () => {
  it("Studio copy is a create studio, not a fake director desk", () => {
    expect(app).not.toContain("SAM Studio Director");
    expect(app).not.toContain("Higgsfield 3D");
    expect(app).toMatch(/title="Studio — .*image.*video/i);
  });

  it("Agent is a real tab that focuses chat", () => {
    expect(app).toMatch(/title="Agent — chat with SAM"[^>]*onClick=\{/);
    expect(app).not.toContain("Used Web Search");
    expect(app).not.toContain("Used Python Tool");
  });

  it("Memory and Look are on the Agent chrome, Team cards start a job", () => {
    expect(app).toContain('aria-label="Memory"');
    expect(app).toContain('aria-label="Look"');
    expect(app).toContain("Start a team job");
    expect(app).toContain("setInput(`/team");
  });

  it("The Yard is an in-HUD workspace, and can still pop out", () => {
    expect(preload).toContain("openYard");
    expect(main).toContain("open-yard");
    expect(app).toContain('surface === "yard"');
    expect(app).toContain("popOutYard");
    expect(app).toContain("YardView");
    expect(app).toContain("persistToolTrace");
    expect(app).toContain("tool-trace");
  });

  it("FLIP IT is an add-on unless the server says the desk is built in", () => {
    expect(gate).toContain("flipitBuiltin === true");
    expect(gate).not.toContain("flipitBuiltin !== false");
    expect(gate).toContain("Connect add-on");
    expect(gate).toContain("?open=connectors");
  });
});
