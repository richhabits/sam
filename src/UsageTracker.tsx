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
    <div style={{ marginTop: 16, marginBottom: 24, padding: 16, background: "#111", borderRadius: 16, border: "1px solid #222" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#fff", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: totalCooling > 0 ? "#F26101" : "#00E676", display: "flex" }}><Icon name="pulse" size={16} /></span>
          API Usage Tracker
        </div>
        <div style={{ fontSize: 12, color: "#888", background: "#1A1A1A", padding: "4px 10px", borderRadius: 20 }}>
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
            <div key={pool.provider} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "#1A1A1A", borderRadius: 12, border: allExhausted ? "1px solid rgba(242, 97, 1, 0.4)" : "1px solid #2A2A2A" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: "#fff", textTransform: "capitalize" }}>{pool.provider}</div>
                <div style={{ fontSize: 12, color: "#888" }}>{pool.uses} requests served</div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                {isCooling && timeRemaining > 0 && (
                  <div style={{ fontSize: 12, color: "#F26101", fontWeight: 500 }}>
                    Cooling: {timeRemaining}s
                  </div>
                )}
                
                <div style={{ display: "flex", alignItems: "center", gap: 6, background: allExhausted ? "rgba(242, 97, 1, 0.1)" : "rgba(0, 230, 118, 0.1)", padding: "4px 10px", borderRadius: 12 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: allExhausted ? "#F26101" : "#00E676" }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: allExhausted ? "#F26101" : "#00E676" }}>
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
