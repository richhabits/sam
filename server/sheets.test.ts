import { describe, expect, it } from "vitest";
import {
  CAPS, analyseCsv, inferKind, looksLikeDate, parseCsv, profileTable, renderReport, sniffDelimiter, toDate, toNumber,
} from "./sheets.ts";

// The parser is where this breaks. Everything downstream — types, stats, findings — is arithmetic
// over whatever the parser handed back, so a quoting bug doesn't produce a wrong number, it
// produces a confidently wrong ANALYSIS. These lean hard on the messy cases: quotes containing the
// delimiter, quotes containing newlines, "" escapes, CRLF, a BOM, and rows that don't match the
// header. The stats tests then prove the findings actually FIRE, because a profile that never
// notices anything is the same as no profile.

describe("parseCsv — quoting", () => {
  it("keeps a comma inside a quoted field", () => {
    const p = parseCsv('name,city\n"Smith, John",London\n');
    expect(p.header).toEqual(["name", "city"]);
    expect(p.rows).toEqual([["Smith, John", "London"]]);
  });

  it("keeps a newline inside a quoted field — the row does not end there", () => {
    const p = parseCsv('id,note\n1,"line one\nline two"\n2,ok\n');
    expect(p.rows).toEqual([["1", "line one\nline two"], ["2", "ok"]]);
    expect(p.rows.length).toBe(2);
  });

  it('unescapes "" to a single quote', () => {
    const p = parseCsv('q\n"he said ""hi"""\n');
    expect(p.rows[0][0]).toBe('he said "hi"');
  });

  it("treats a mid-field quote as a literal character rather than refusing the row", () => {
    const p = parseCsv('a,b\n12" pipe,ok\n');
    expect(p.rows).toEqual([['12" pipe', "ok"]]);
  });

  it("handles an empty quoted field and a quoted field holding only the delimiter", () => {
    const p = parseCsv('a,b,c\n"",",",x\n');
    expect(p.rows).toEqual([["", ",", "x"]]);
  });

  it("survives an unterminated quote at EOF without dropping the data", () => {
    const p = parseCsv('a,b\n1,"never closed\n');
    expect(p.rows).toEqual([["1", "never closed\n"]]);
  });
});

describe("parseCsv — line endings, BOM, blank lines", () => {
  it("handles CRLF", () => {
    const p = parseCsv("a,b\r\n1,2\r\n3,4\r\n");
    expect(p.header).toEqual(["a", "b"]);
    expect(p.rows).toEqual([["1", "2"], ["3", "4"]]);
    expect(p.rows[0][1]).toBe("2");   // the \r must not survive on the last field of a row
  });

  it("handles lone CR line endings (classic Mac exports)", () => {
    const p = parseCsv("a,b\r1,2\r3,4");
    expect(p.rows).toEqual([["1", "2"], ["3", "4"]]);
  });

  it("strips a UTF-8 BOM so the first header name is usable", () => {
    const p = parseCsv("﻿id,name\n1,ada\n");
    expect(p.bom).toBe(true);
    expect(p.header[0]).toBe("id");
    expect(p.header[0].charCodeAt(0)).toBe(0x69);   // 'i', not the BOM
  });

  it("skips blank lines instead of profiling them as empty rows", () => {
    const p = parseCsv("a,b\n1,2\n\n3,4\n\n");
    expect(p.rows).toEqual([["1", "2"], ["3", "4"]]);
    expect(p.blankLines).toBe(2);
  });

  it("reads a last line with no trailing newline", () => {
    const p = parseCsv("a,b\n1,2");
    expect(p.rows).toEqual([["1", "2"]]);
  });

  it("returns an empty result for empty input rather than throwing", () => {
    const p = parseCsv("");
    expect(p.header).toEqual([]);
    expect(p.rows).toEqual([]);
  });
});

describe("parseCsv — ragged rows", () => {
  it("pads short rows, truncates long ones, and counts both", () => {
    const p = parseCsv("a,b,c\n1,2,3\n4,5\n6,7,8,9\n");
    expect(p.rows).toEqual([["1", "2", "3"], ["4", "5", ""], ["6", "7", "8"]]);
    expect(p.ragged).toEqual({ short: 1, long: 1 });
  });

  it("names unnamed header cells so no column is unaddressable", () => {
    const p = parseCsv("a,,c\n1,2,3\n");
    expect(p.header).toEqual(["a", "column_2", "c"]);
  });

  it("caps rows and says it was truncated", () => {
    const src = `a\n${Array.from({ length: 50 }, (_, i) => i).join("\n")}\n`;
    const p = parseCsv(src, { maxRows: 10 });
    expect(p.rows.length).toBe(10);
    expect(p.truncatedRows).toBe(true);
  });

  it("caps columns and says it was truncated", () => {
    const p = parseCsv("a,b,c,d,e\n1,2,3,4,5\n", { maxCols: 3 });
    expect(p.header.length).toBe(3);
    expect(p.truncatedCols).toBe(true);
  });
});

describe("sniffDelimiter", () => {
  it("finds tabs and semicolons", () => {
    expect(sniffDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(sniffDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(sniffDelimiter("a|b|c\n1|2|3")).toBe("|");
  });

  it("is not fooled by commas that only live inside quotes", () => {
    expect(sniffDelimiter('name\taddr\nada\t"12 High St, London"')).toBe("\t");
  });

  it("defaults to comma for a single-column file", () => {
    expect(sniffDelimiter("value\n1\n2")).toBe(",");
  });
});

describe("value typing", () => {
  it("reads dressed-up numbers", () => {
    expect(toNumber("1,234.50")).toBe(1234.5);
    expect(toNumber("£42")).toBe(42);
    expect(toNumber("(1,234.50)")).toBe(-1234.5);   // accounting negative
    expect(toNumber("45%")).toBe(45);               // face value — /100 would silently move every stat
    expect(toNumber("-3.2e4")).toBe(-32000);
    expect(toNumber("")).toBeNull();
    expect(toNumber("N/A")).toBeNull();
    expect(toNumber("1,2")).toBeNull();             // a European decimal is NOT 12
  });

  it("classifies each kind", () => {
    expect(inferKind("12")).toBe("number");
    expect(inferKind("2024-03-01")).toBe("date");
    expect(inferKind("yes")).toBe("boolean");
    expect(inferKind("London")).toBe("text");
    expect(inferKind("2024")).toBe("number");   // a bare year has no date shape
  });

  it("does not call a single letter boolean on its own — 'x'/'y' are axis labels, not true/false", () => {
    expect(inferKind("y")).toBe("text");
    expect(inferKind("n")).toBe("text");
    const p = analyseCsv("axis\nx\ny\nx\ny\n");
    expect(p.cols[0].type).toBe("text");
  });

  it("but a column that is ONLY y/n IS boolean", () => {
    const p = analyseCsv("subscribed\ny\nn\ny\ny\n");
    expect(p.cols[0].type).toBe("boolean");
    expect(p.cols[0].mixed).toBe(false);
  });

  it("a half-numbers half-text column resolves to text, not number", () => {
    // Calling it "number" invites a sum that silently ignores half the rows.
    const p = analyseCsv("v\n1\n2\nn/k\npending\n");
    expect(p.cols[0].type).toBe("text");
    expect(p.cols[0].mixed).toBe(true);
  });

  it("recognises date shapes and rejects impossible ones", () => {
    expect(looksLikeDate("2024-03-01")).toBe(true);
    expect(looksLikeDate("01/03/2024")).toBe(true);
    expect(looksLikeDate("3 Mar 2024")).toBe(true);
    expect(looksLikeDate("2024-13-45")).toBe(false);
    expect(looksLikeDate("hello")).toBe(false);
  });

  it("resolves dates in UTC so the machine's timezone can't shift them", () => {
    expect(toDate("2024-03-01", true)).toBe(Date.UTC(2024, 2, 1));
    expect(toDate("01/03/2024", true)).toBe(Date.UTC(2024, 2, 1));    // day-first
    expect(toDate("01/03/2024", false)).toBe(Date.UTC(2024, 0, 3));   // month-first
  });
});

describe("column stats", () => {
  const csv = [
    "id,city,amount,when,active,notes",
    "1,London,10,2024-01-05,yes,",
    "2,London,12,2024-02-05,yes,",
    "3,Leeds,11,2024-03-05,no,",
    "4,Leeds,9,2024-04-05,yes,",
    "5,York,10,2024-05-05,no,",
  ].join("\n");

  it("types every column and computes numeric stats", () => {
    const p = analyseCsv(csv);
    const by = (n: string) => p.cols.find((c) => c.name === n)!;
    expect(by("id").type).toBe("number");
    expect(by("city").type).toBe("text");
    expect(by("when").type).toBe("date");
    expect(by("active").type).toBe("boolean");
    expect(by("notes").type).toBe("empty");

    const amt = by("amount");
    expect(amt.min).toBe(9);
    expect(amt.max).toBe(12);
    expect(amt.mean).toBeCloseTo(10.4, 5);
    expect(amt.median).toBe(10);
    expect(by("when").minDate).toBe("2024-01-05");
    expect(by("when").maxDate).toBe("2024-05-05");
  });

  it("counts cardinality and top values for a categorical column", () => {
    const city = analyseCsv(csv).cols.find((c) => c.name === "city")!;
    expect(city.cardinality).toBe(3);
    expect(city.top[0]).toEqual({ value: "London", n: 2 });
  });

  it("spots the identifier column", () => {
    const id = analyseCsv(csv).cols.find((c) => c.name === "id")!;
    expect(id.unique).toBe(true);
  });

  it("flags an all-empty column and never divides by its zero count", () => {
    const p = analyseCsv(csv);
    const notes = p.cols.find((c) => c.name === "notes")!;
    expect(notes.filled).toBe(0);
    expect(notes.fillRate).toBe(0);
    expect(notes.min).toBeUndefined();
    expect(p.findings.join(" ")).toMatch(/completely empty column/i);
  });

  it("treats the usual null spellings as null but leaves '-' alone", () => {
    const p = analyseCsv("v\n1\nN/A\nnull\nNONE\n-\n");
    const v = p.cols[0];
    expect(v.nulls).toBe(3);
    expect(v.filled).toBe(2);   // "1" and "-"
  });
});

describe("data-quality findings", () => {
  it("finds a mixed-type column", () => {
    const p = analyseCsv("v\n1\n2\n3\n4\nlots\nmany\n");
    expect(p.cols[0].mixed).toBe(true);
    expect(p.findings.join(" ")).toMatch(/mixed types/i);
  });

  it("does NOT call one stray value in a big column mixed", () => {
    const rows = Array.from({ length: 200 }, (_, i) => String(i)).join("\n");
    const p = analyseCsv(`v\n${rows}\noops\n`);
    expect(p.cols[0].mixed).toBe(false);
  });

  it("finds numeric outliers with the IQR fence and says to use the median", () => {
    const body = Array.from({ length: 20 }, (_, i) => 10 + (i % 5)).join("\n");
    const p = analyseCsv(`amount\n${body}\n99999\n`);
    const c = p.cols[0];
    expect(c.outlierCount).toBe(1);
    expect(c.outliers).toEqual([99999]);
    expect(p.findings.join(" ")).toMatch(/outlier/i);
    expect(p.findings.join(" ")).toMatch(/median/i);
  });

  it("finds duplicate rows", () => {
    const p = analyseCsv("a,b\n1,x\n2,y\n1,x\n1,x\n");
    expect(p.duplicateRows).toBe(2);
    expect(p.findings.join(" ")).toMatch(/duplicate row/i);
  });

  it("finds mostly-empty columns", () => {
    const p = analyseCsv(["a,b", "1,x", "2,", "3,", "4,", "5,"].join("\n"));
    expect(p.cols[1].fillRate).toBeCloseTo(0.2, 5);
    expect(p.findings.join(" ")).toMatch(/Mostly empty/i);
  });

  it("finds a constant column and stray whitespace", () => {
    const p = analyseCsv(["region,city", "UK, London", "UK,London", "UK,Leeds"].join("\n"));
    expect(p.cols[0].constant).toBe(true);
    expect(p.cols[1].padded).toBe(1);
    const f = p.findings.join(" ");
    expect(f).toMatch(/No variation/i);
    expect(f).toMatch(/whitespace/i);
    expect(f).toContain('" London" vs "London"');   // the REAL offender, not an invented example
  });

  it("reports ragged rows as a finding, not just a count", () => {
    const p = analyseCsv("a,b,c\n1,2,3\n4,5\n");
    expect(p.findings.join(" ")).toMatch(/Ragged rows/i);
  });

  it("flags dates the file itself cannot disambiguate", () => {
    const p = analyseCsv("d\n01/02/2024\n03/04/2024\n05/06/2024\n");
    expect(p.cols[0].dateAmbiguous).toBe(true);
    expect(p.findings.join(" ")).toMatch(/Ambiguous dates/i);

    const q = analyseCsv("d\n25/02/2024\n03/04/2024\n");
    expect(q.cols[0].dateAmbiguous).toBe(false);   // the 25 settles it
  });

  it("says nothing is wrong when nothing is wrong", () => {
    const rows = Array.from({ length: 30 }, (_, i) => `${i},${["a", "b", "c"][i % 3]},${10 + (i % 4)}`).join("\n");
    const p = analyseCsv(`id,tag,n\n${rows}\n`);
    const f = p.findings.join(" ");
    expect(f).not.toMatch(/duplicate row/i);
    expect(f).not.toMatch(/mixed types/i);
  });
});

describe("caveats — the tool must admit what it doesn't know", () => {
  it("warns when the sample is too small to conclude anything", () => {
    const p = analyseCsv("a,b\n1,x\n2,y\n");
    expect(p.rows).toBeLessThan(CAPS.smallSample);
    expect(p.caveats.join(" ")).toMatch(/too few to conclude/i);
  });

  it("does not nag about sample size on a decent file", () => {
    const rows = Array.from({ length: 40 }, (_, i) => `${i},x`).join("\n");
    const p = analyseCsv(`a,b\n${rows}\n`);
    expect(p.caveats.join(" ")).not.toMatch(/too few/i);
  });

  it("declares row truncation", () => {
    const src = `a\n${Array.from({ length: 60 }, (_, i) => i).join("\n")}\n`;
    const p = profileTable(parseCsv(src, { maxRows: 10 }));
    expect(p.caveats.join(" ")).toMatch(/cap/i);
  });

  it("declares byte truncation, because stats over a clipped head are not stats over the file", () => {
    const p = analyseCsv("a\n1\n2\n", { truncatedBytes: true, totalBytes: 99_000_000 });
    expect(p.caveats.join(" ")).toMatch(/only the first/i);
  });

  it("says so when there is a header and no data", () => {
    const p = analyseCsv("a,b,c\n");
    expect(p.rows).toBe(0);
    expect(p.findings.join(" ")).toMatch(/No data rows/i);
  });
});

describe("renderReport", () => {
  const csv = ["name,amount,when", "ada,10,2024-01-01", "bob,20,2024-02-01", "ada,10,2024-01-01"].join("\n");

  it("renders a profile table, the findings, and the caveats", () => {
    const md = renderReport(analyseCsv(csv, { source: "sales.csv" }));
    expect(md).toContain("## sales.csv — 3 rows × 3 columns");
    expect(md).toContain("| column | type | filled | distinct | summary |");
    expect(md).toContain("### What stands out");
    expect(md).toMatch(/duplicate row/i);
    expect(md).toContain("### Read this before you act on it");
  });

  it("escapes pipes so a value can't break the markdown table", () => {
    const md = renderReport(analyseCsv('a\n"x|y"\n'));
    expect(md).toContain("x\\|y");
  });

  it("calls out the columns a question names", () => {
    const md = renderReport(analyseCsv(csv), { question: "what's the total amount?" });
    expect(md).toContain("**Your question:**");
    expect(md).toMatch(/- `amount`/);
  });
});

describe("a spreadsheet cell cannot break the table it is rendered into", () => {
  it("escapes backslashes BEFORE pipes, so an already-escaped pipe stays inside its cell", async () => {
    // CodeQL caught this as incomplete sanitisation and it is a real defect: escaping `|` first
    // turns a cell containing `\|` into `\\|` — an escaped backslash followed by a LIVE pipe,
    // which ends the cell early and shunts the rest of the row into the wrong column.
    const csv = 'name,note\nrow1,"a \\| b"\nrow2,"plain"';
    const md = renderReport(profileTable(parseCsv(csv)));
    const rows = md.split("\n").filter((l) => l.trim().startsWith("|"));
    // Every rendered row must have the same number of unescaped pipes as the header.
    const live = (l: string) => (l.match(/(?<!\\)\|/g) || []).length;
    const counts = new Set(rows.map(live));
    expect(counts.size, `ragged table rows: ${[...counts].join(",")}`).toBe(1);
  });

  it("flattens CR as well as LF — a Windows export must not split a row", () => {
    const csv = 'name,note\nrow1,"line1\r\nline2"';
    const md = renderReport(profileTable(parseCsv(csv)));
    for (const line of md.split("\n")) expect(line).not.toMatch(/\r/);
  });
});
