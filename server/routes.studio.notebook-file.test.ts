import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Audit finding: POST /api/notebooks/:id/source accepted {file: "<any path>"} from any caller that
// cleared the global gate (a paired phone included). notebook.addFile reads that path off the Mac's
// disk and /ask then answers from it — an arbitrary-file-read oracle. A path only means something on
// the machine SAM runs on, so naming one is loopback-only.

const addFile = vi.fn(async () => 3);
const addText = vi.fn(async () => 1);
vi.mock("./notebook.ts", () => ({
  listNotebooks: () => [], ensureNotebook: (t: string) => ({ id: t, title: t }), notebookSources: () => [],
  deleteNotebook: () => true, addUrl: async () => ({ chunks: 1, title: "t" }), addFile, addText,
  retrieve: async () => [], overviewChunks: () => [],
}));
vi.mock("./models.ts", () => ({ runModel: async () => ({ text: "", provider: "x" }) }));
vi.mock("./tools.ts", () => ({ TOOLS: [] }));
vi.mock("./studio-queue.ts", () => ({ enqueueStudioJob: () => "job" }));

describe("POST /api/notebooks/:id/source — file ingestion", () => {
  let server: Server;
  let base: string;
  let fakeRemote: string | null = null;

  beforeAll(async () => {
    const { registerStudioRoutes } = await import("./routes.studio.ts");
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      // Always set (never only when faking): keep-alive reuses the socket, so an earlier test fake address would stick.
      Object.defineProperty(req.socket, "remoteAddress", { value: fakeRemote ?? "127.0.0.1", configurable: true });
      next();
    });
    registerStudioRoutes(app);
    await new Promise<void>((r) => { server = createServer(app).listen(0, "127.0.0.1", () => r()); });
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });
  beforeEach(() => { fakeRemote = null; addFile.mockClear(); addText.mockClear(); });

  const post = (body: unknown) => fetch(`${base}/api/notebooks/nb/source`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("refuses a file path from an off-machine caller and never touches the disk", async () => {
    fakeRemote = "192.168.1.50";
    const res = await post({ file: "~/.ssh/id_ed25519" });
    expect(res.status).toBe(403);
    expect(addFile).not.toHaveBeenCalled();
  });

  it("still lets an off-machine caller add pasted text", async () => {
    fakeRemote = "192.168.1.50";
    const res = await post({ text: "hello", title: "note" });
    expect(res.status).toBe(200);
    expect(addText).toHaveBeenCalled();
  });

  it("lets the machine itself add a file", async () => {
    const res = await post({ file: "/tmp/notes.md" });
    expect(res.status).toBe(200);
    expect(addFile).toHaveBeenCalledWith("nb", "/tmp/notes.md");
  });
});
