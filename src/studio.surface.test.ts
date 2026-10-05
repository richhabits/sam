// Studio must be a create surface, not a junk drawer of fake engines.
// Source-text assertions: a render test cannot tell you a label is lying.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const studio = readFileSync(join(import.meta.dirname, "StudioView.tsx"), "utf8");
const app = readFileSync(join(import.meta.dirname, "App.tsx"), "utf8");
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
});

describe("header tabs open the job they name", () => {
  it("Studio copy is a create studio, not a fake director desk", () => {
    expect(app).not.toContain("SAM Studio Director");
    expect(app).not.toContain("Higgsfield 3D");
    expect(app).toMatch(/title="Studio — .*image.*video/i);
  });

  it("The Yard has a dedicated Electron window, same as Studio", () => {
    expect(preload).toContain("openYard");
    expect(main).toContain("open-yard");
    expect(app).toContain("openYard");
  });
});
