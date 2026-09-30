// POST /api/restart: exit cleanly so the supervisor (scripts/sam-server-supervisor.sh) starts
// SAM again. Used to apply add-on (MCP) changes, which load at boot.
//
// Only this machine may ask (trusted local), and only when a supervisor will bring SAM back:
// inside the desktop app the server shares the app's process, so exiting would quit the app.
export function restartRefusal(opts: { trustedLocal: boolean; supervised: boolean }): { status: number; error: string } | null {
  if (!opts.trustedLocal) return { status: 403, error: "restart SAM from this computer only" };
  if (!opts.supervised) return { status: 409, error: "SAM isn't running under its supervisor, so it wouldn't come back. Restart the SAM app instead." };
  return null;
}

export function isSupervised(env: Record<string, string | undefined> = process.env): boolean {
  return env.SAM_SUPERVISED === "1";
}
