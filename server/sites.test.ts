import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { renderSite, saveSite, siteFilename } from "./sites.ts";

describe("make a site", () => {
  it("writes one page inside the vault and nowhere else", () => {
    const file = saveSite({ name: "Northline", line: "A quieter kind of work.", points: ["One brief.", "One page."] });
    expect(file.includes(`${sep}sites${sep}`)).toBe(true);
    expect(resolve(file).startsWith(resolve(process.env.VAULT_DIR || ""))).toBe(true);
    const html = readFileSync(file, "utf8");
    expect(html).toContain("Northline");
    expect(html).toContain("A quieter kind of work.");
    expect(html).not.toContain("checkout");
    expect(html).not.toContain("testimonial");
  });

  it("a hostile name cannot escape the folder", () => {
    expect(siteFilename("../../etc/passwd")).not.toContain("..");
    expect(siteFilename("../../etc/passwd")).not.toContain("/");
  });

  it("still renders when the brief is thin", () => {
    const html = renderSite({ name: "", line: "" });
    expect(html).toContain("<h1>");
    expect(html).toContain("Not published");
  });
});
