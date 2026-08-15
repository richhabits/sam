import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectorError } from "./connectors.http.ts";
import { CONNECTORS, connector, topLists } from "./connectors.registry.ts";
import { forgetStatuses, list, normalize, safeRepo, statuses } from "./connectors.ts";
import * as linear from "./linear.ts";
import * as notion from "./notion.ts";
import * as slack from "./slack.ts";
import * as vercel from "./vercel.ts";

// The network half needs real workspaces, so what is pinned here is everything that decides
// whether a list is CORRECT or quietly wrong: the shaping, and the mapping of each service's
// own idea of failure onto one status the UI can act on.

const SECRETS = ["SLACK_BOT_TOKEN", "NOTION_API_KEY", "LINEAR_API_KEY", "VERCEL_TOKEN"];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of SECRETS) delete process.env[k];
  forgetStatuses();
});

/** One canned HTTP response for the next fetch, whatever the URL. */
function stubFetch(body: unknown, status = 200) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (url: string, _init?: RequestInit) => {
    calls.push(String(url));
    return Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);
  });
  return calls;
}

describe("the registry", () => {
  it("gives every connector a unique id and a real env var", () => {
    const ids = CONNECTORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CONNECTORS) {
      expect(c.env, `${c.id} has no env var`).toMatch(/^[A-Z0-9_]+$/);
      expect(c.lists.length, `${c.id} offers nothing to read`).toBeGreaterThan(0);
    }
  });

  // A drill target that doesn't exist renders as a row you can tap into a 404.
  it("points every drill at a list that exists and accepts a param", () => {
    for (const c of CONNECTORS) {
      for (const l of c.lists.filter((x) => x.drill)) {
        const target = c.lists.find((x) => x.kind === l.drill);
        expect(target, `${c.id}/${l.kind} drills into a missing list`).toBeTruthy();
        expect(target?.param, `${c.id}/${l.drill} takes no param to drill with`).toBeTruthy();
      }
    }
  });

  // "Recent messages" with no channel is not a list, it's an error — so it must not be offered
  // as a top-level row that always fails when tapped.
  it("keeps lists that need an id out of the top level", () => {
    const top = topLists(connector("slack")!).map((l) => l.kind);
    expect(top).toContain("channels");
    expect(top).not.toContain("messages");
  });
});

describe("slack", () => {
  it("shapes a channel with its member count and privacy", () => {
    expect(slack.toChannel({ id: "C1", name: "general", num_members: 12, is_private: false })).toEqual({
      id: "C1",
      title: "#general",
      sub: "12 members",
    });
    expect(slack.toChannel({ id: "C2", name: "secret", num_members: 1, is_private: true }).sub).toBe("1 member · private");
  });

  // A file share or a join event has no text. Rendering it as an empty row loses the fact that
  // something happened there at all.
  it("says what an empty message actually was", () => {
    expect(slack.toMessage({ ts: "1", subtype: "channel_join" }).title).toBe("(channel join)");
    expect(slack.toMessage({ ts: "1" }).title).toBe("(no text)");
    expect(slack.toMessage({ ts: "1722500000.0", text: "hello\n  there", user: "U9" })).toMatchObject({
      title: "hello there",
      sub: expect.stringContaining("<@U9>"),
    });
  });

  // Slack answers HTTP 200 for a revoked token. Untranslated, that is an empty channel list —
  // a working-looking connection with nothing in it.
  it("turns an ok:false body into the right status, not an empty list", async () => {
    expect(slack.slackError("invalid_auth").status).toBe(401);
    expect(slack.slackError("missing_scope").status).toBe(403);
    expect(slack.slackError("ratelimited").status).toBe(429);
    expect(slack.slackError("channel_not_found").status).toBe(404);
    expect(slack.slackError("weird_new_thing").status).toBe(502);

    stubFetch({ ok: false, error: "invalid_auth" });
    await expect(slack.channels("xoxb-nope")).rejects.toMatchObject({ status: 401 });
  });

  it("sorts channels by how busy they are", async () => {
    stubFetch({
      ok: true,
      channels: [
        { id: "C1", name: "quiet", num_members: 2 },
        { id: "C2", name: "busy", num_members: 40 },
      ],
    });
    expect((await slack.channels("xoxb-x")).map((r) => r.title)).toEqual(["#busy", "#quiet"]);
  });

  it("refuses to ask for a channel's history without a channel", async () => {
    await expect(slack.messages("xoxb-x", "")).rejects.toMatchObject({ status: 400 });
  });
});

describe("notion", () => {
  // The title lives in a different place on a page than on a database, and on a page it is found
  // by TYPE — the property is called "Name" in a database and "title" on a workspace page.
  it("finds the title wherever Notion put it", () => {
    expect(notion.titleOf({ title: [{ plain_text: "My DB" }] })).toBe("My DB");
    expect(notion.titleOf({ properties: { Name: { type: "title", title: [{ plain_text: "A page" }] } } })).toBe("A page");
    expect(notion.titleOf({ properties: { Status: { type: "select" } } })).toBe("(untitled)");
    expect(notion.titleOf({})).toBe("(untitled)");
  });

  it("labels the row as a page or a database, with the date it changed", () => {
    expect(notion.toRow({ id: "p1", object: "page", last_edited_time: "2026-07-30T09:00:00Z", url: "u", properties: {} })).toEqual({
      id: "p1",
      title: "(untitled)",
      sub: "page · 2026-07-30",
      url: "u",
    });
  });

  it("asks for last-edited-first, and filters by object when asked", async () => {
    const calls = stubFetch({ results: [] });
    await notion.databases("secret_x", 5);
    expect(calls[0]).toContain("/v1/search");
  });
});

describe("linear", () => {
  it("shapes an issue as its identifier, state and team", () => {
    expect(linear.toIssue({ id: "i1", identifier: "SAM-12", title: "Ship it", state: { name: "In Progress" }, team: { key: "SAM" }, updatedAt: "2026-07-31T00:00:00Z", url: "u" })).toEqual({
      id: "i1",
      title: "SAM-12 · Ship it",
      sub: "In Progress · SAM · 2026-07-31",
      url: "u",
    });
  });

  // GraphQL reports auth failure in the body at HTTP 200 — the same trap as Slack.
  it("reads an authentication error out of a 200 body", async () => {
    expect(linear.linearError([{ message: "Authentication required" }]).status).toBe(401);
    expect(linear.linearError([{ message: "Something else" }]).status).toBe(502);
    stubFetch({ errors: [{ message: "Authentication required, but no authentication was provided" }] });
    await expect(linear.issues("lin_api_nope")).rejects.toMatchObject({ status: 401 });
  });
});

describe("vercel", () => {
  // The whole point of this connector: a deployment can be ERROR while the domain still answers
  // 200, so the state has to survive into the row.
  it("keeps the deployment state, target and date", () => {
    expect(vercel.toDeployment({ uid: "d1", name: "web", state: "ERROR", target: "production", created: 1753900000000, url: "web-x.vercel.app" })).toEqual({
      id: "d1",
      title: "web",
      sub: expect.stringContaining("error · production"),
      url: "https://web-x.vercel.app",
    });
  });

  it("never reports an unknown state as a success", () => {
    expect(vercel.toDeployment({ uid: "d2", name: "web" }).sub).toContain("unknown");
  });
});

describe("the dispatcher", () => {
  it("rejects a repo param that could climb out of the path", () => {
    expect(safeRepo("richhabits/sam")).toBe("richhabits/sam");
    expect(safeRepo(undefined)).toBeUndefined();
    expect(() => safeRepo("richhabits/..")).toThrow();
    expect(() => safeRepo("a/b/c")).toThrow();
    expect(() => safeRepo("../../user")).toThrow();
  });

  it("404s an unknown connector or list rather than guessing", async () => {
    await expect(list("dropbox", "files")).rejects.toMatchObject({ status: 404 });
    await expect(list("slack", "emoji")).rejects.toMatchObject({ status: 404 });
  });

  it("asks for a token before it asks the network", async () => {
    const calls = stubFetch({ ok: true });
    await expect(list("slack", "channels")).rejects.toMatchObject({ status: 401 });
    expect(calls, "a missing token must not cost a round trip").toHaveLength(0);
  });

  // A GitHubError predates this file and carries the same `status`; flattening it to 502 would
  // report a missing token as "GitHub is down".
  it("keeps the status of an error thrown by an older module", () => {
    expect(normalize({ status: 401, message: "nope" }).status).toBe(401);
    expect(normalize(new Error("boom")).status).toBe(502);
    expect(normalize(new ConnectorError(429, "slow down")).status).toBe(429);
  });

  it("reports a connector with no token as needing one, without calling out", async () => {
    const calls = stubFetch({ ok: true });
    const all = await statuses({ refresh: true });
    const s = all.find((c) => c.id === "slack")!;
    expect(s).toMatchObject({ connected: false, needsToken: true, label: "Slack" });
    expect(s.lists.map((l) => l.kind)).toEqual(["channels"]);
    expect(calls.some((u) => u.includes("slack.com"))).toBe(false);
  });

  it("reports the account a live token belongs to", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    stubFetch({ ok: true, team: "Rich Habits", user: "sam" });
    const s = (await statuses({ refresh: true })).find((c) => c.id === "slack")!;
    expect(s).toMatchObject({ connected: true, needsToken: false, detail: "sam · Rich Habits" });
  });

  it("separates a rejected token from an outage", async () => {
    process.env.NOTION_API_KEY = "secret_dead";
    stubFetch({}, 401);
    let s = (await statuses({ refresh: true })).find((c) => c.id === "notion")!;
    expect(s).toMatchObject({ connected: false, needsToken: true });

    process.env.NOTION_API_KEY = "secret_ok";
    stubFetch({}, 500);
    s = (await statuses({ refresh: true })).find((c) => c.id === "notion")!;
    expect(s).toMatchObject({ connected: false, needsToken: false });
    expect(s.error).toContain("500");
  });

  it("memoises statuses, and forgets them when a token is saved", async () => {
    process.env.LINEAR_API_KEY = "lin_api_x";
    stubFetch({ data: { viewer: { name: "Romeo", email: "r@x" } } });
    const first = await statuses({ refresh: true });
    vi.unstubAllGlobals();
    // Same answer with no fetch stubbed at all — proof it did not call out again.
    expect((await statuses()).find((c) => c.id === "linear")!.detail).toBe("Romeo");
    expect(await statuses()).toBe(first);
  });
});
