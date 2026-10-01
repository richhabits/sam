import { useEffect, useState } from "react";
import Icon from "./Icon";

export default function UsageTracker({ pools }: { pools: any[] }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    // Update the countdowns every second
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (!pools || pools.length === 0) return null;

  // Filter out pools with zero keys
  const activePools = pools.filter((p) => p.total > 0);
  if (activePools.length === 0) return null;

  const totalUses = activePools.reduce((sum, p) => sum + p.uses, 0);
  const totalCooling = activePools.reduce((sum, p) => sum + p.cooling, 0);

  return (
    <div style={{ marginTop: 16, marginBottom: 24, padding: 16, background: "var(--surface)", borderRadius: 16, border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: totalCooling > 0 ? "var(--accent-text)" : "var(--c-ok)", display: "flex" }}><Icon name="pulse" size={16} /></span>
          API Usage Tracker
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", background: "var(--user-bubble)", padding: "4px 10px", borderRadius: 20 }}>
          {totalUses} total free requests
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {activePools.map((pool) => {
          const isCooling = pool.cooling > 0;
          const allExhausted = pool.healthy === 0;
          let timeRemaining = 0;
          if (pool.coolingUntil > now) {
            timeRemaining = Math.ceil((pool.coolingUntil - now) / 1000);
          }

          return (
            <div key={pool.provider} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "var(--user-bubble)", borderRadius: 12, border: allExhausted ? "1px solid color-mix(in srgb, var(--accent) 40%, transparent)" : "1px solid var(--border)" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text)", textTransform: "capitalize" }}>{pool.provider}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{pool.uses} requests served</div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                {isCooling && timeRemaining > 0 && (
                  <div style={{ fontSize: 12, color: "var(--accent-text)", fontWeight: 500 }}>
                    Cooling: {timeRemaining}s
                  </div>
                )}
                
                <div style={{ display: "flex", alignItems: "center", gap: 6, background: allExhausted ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "color-mix(in srgb, var(--c-ok) 12%, transparent)", padding: "4px 10px", borderRadius: 12 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: allExhausted ? "var(--accent-text)" : "var(--c-ok)" }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: allExhausted ? "var(--accent-text)" : "var(--c-ok)" }}>
                    {pool.healthy}/{pool.total} healthy
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
