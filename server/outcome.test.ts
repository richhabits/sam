import { describe, expect, it } from "vitest";
import { assertNever, err, isErr, isOk, match, ok, type Outcome, unwrapOr } from "./outcome.ts";

// Outcome: failures are RETURNED as a typed error, not thrown/swallowed. match() forks exhaustively;
// assertNever() turns an unhandled state-machine case into a compile error (and a loud runtime throw).

describe("Outcome — construct and narrow", () => {
  it("ok/err build the tagged shapes; isOk/isErr narrow", () => {
    const good: Outcome<number, string> = ok(42);
    const bad: Outcome<number, string> = err("nope");
    expect(good).toEqual({ ok: true, value: 42 });
    expect(bad).toEqual({ ok: false, error: "nope" });
    expect(isOk(good)).toBe(true);
    expect(isErr(bad)).toBe(true);
    if (isOk(good)) expect(good.value).toBe(42);   // narrowed to the value arm
    if (isErr(bad)) expect(bad.error).toBe("nope"); // narrowed to the error arm
  });
});

describe("match — exhaustive fork", () => {
  it("runs the ok arm for a value and the err arm for an error", () => {
    const render = (o: Outcome<number, string>) => match(o, { ok: (v) => `= ${v}`, err: (e) => `! ${e}` });
    expect(render(ok(7))).toBe("= 7");
    expect(render(err("boom"))).toBe("! boom");
  });
  it("unwrapOr returns the value or the fallback", () => {
    expect(unwrapOr(ok("x"), "fb")).toBe("x");
    expect(unwrapOr(err("e") as Outcome<string, string>, "fb")).toBe("fb");
  });
});

describe("assertNever — exhaustiveness guard", () => {
  type State = "closed" | "open" | "half-open";
  const canAttempt = (s: State): boolean => {
    switch (s) {
      case "closed":
      case "half-open": return true;
      case "open": return false;
      default: return assertNever(s, "State");   // adding a 4th State here would fail to compile
    }
  };
  it("handles every declared state", () => {
    expect(canAttempt("closed")).toBe(true);
    expect(canAttempt("half-open")).toBe(true);
    expect(canAttempt("open")).toBe(false);
  });
  it("throws LOUDLY if an unexpected value slips past the types at runtime", () => {
    expect(() => canAttempt("bogus" as State)).toThrow(/unreachable State/);
  });
});
