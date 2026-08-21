// ─────────────────────────────────────────────────────────────
//  S.A.M. · HARDWARE SENTINEL & SYSTEM TELEMETRY
//
//  Native system vitals, battery status, memory saturation,
//  and thermal/power throttle guards for background tasks.
// ─────────────────────────────────────────────────────────────

import os from "node:os";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

export interface BatteryStatus {
  hasBattery: boolean;
  percent: number;
  isCharging: boolean;
  powerSource: "ac" | "battery" | "unknown";
  timeRemainingMinutes?: number;
}

export interface HardwareVitals {
  timestamp: number;
  hostname: string;
  platform: string;
  arch: string;
  uptimeSeconds: number;
  cpuCount: number;
  loadAverage1m: number;
  loadAverage5m: number;
  loadAverage15m: number;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  memorySaturationPct: number;
  battery: BatteryStatus;
  isThrottled: boolean;
  throttleReason?: string;
}

export function parseMacBatteryOutput(output: string): BatteryStatus {
  const clean = String(output || "");
  const percentMatch = clean.match(/(\d+)%/);
  const percent = percentMatch ? parseInt(percentMatch[1], 10) : 100;
  const isCharging = /charging|AC Power/i.test(clean) && !/discharging/i.test(clean);
  const isAC = /AC Power|attached/i.test(clean);

  const timeMatch = clean.match(/(\d+):(\d+)\s+remaining/);
  const timeRemainingMinutes = timeMatch
    ? parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10)
    : undefined;

  return {
    hasBattery: percentMatch !== null,
    percent,
    isCharging,
    powerSource: isAC ? "ac" : "battery",
    timeRemainingMinutes,
  };
}

export function getBatteryStatus(): BatteryStatus {
  if (process.platform === "darwin") {
    try {
      const out = execSync("pmset -g batt", { encoding: "utf8", timeout: 1500 });
      return parseMacBatteryOutput(out);
    } catch {
      return { hasBattery: false, percent: 100, isCharging: true, powerSource: "ac" };
    }
  }

  if (process.platform === "linux") {
    try {
      const capPath = "/sys/class/power_supply/BAT0/capacity";
      const statusPath = "/sys/class/power_supply/BAT0/status";
      if (existsSync(capPath)) {
        const percent = parseInt(readFileSync(capPath, "utf8").trim(), 10) || 100;
        const statusStr = existsSync(statusPath) ? readFileSync(statusPath, "utf8").trim() : "Discharging";
        const isCharging = statusStr.toLowerCase() === "charging" || statusStr.toLowerCase() === "full";
        return {
          hasBattery: true,
          percent,
          isCharging,
          powerSource: isCharging ? "ac" : "battery",
        };
      }
    } catch { /* desktop or container */ }
  }

  return {
    hasBattery: false,
    percent: 100,
    isCharging: true,
    powerSource: "ac",
  };
}

export function getHardwareVitals(): HardwareVitals {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memSaturation = Math.round((usedMem / Math.max(1, totalMem)) * 100);
  const loadAvg = os.loadavg();
  const battery = getBatteryStatus();

  let isThrottled = false;
  let throttleReason: string | undefined;

  if (battery.hasBattery && !battery.isCharging && battery.percent < 20) {
    isThrottled = true;
    throttleReason = `Low battery (${battery.percent}% on battery power)`;
  } else if (memSaturation > 92) {
    isThrottled = true;
    throttleReason = `High memory saturation (${memSaturation}%)`;
  }

  return {
    timestamp: Date.now(),
    hostname: os.hostname(),
    platform: process.platform,
    arch: os.arch(),
    uptimeSeconds: Math.round(os.uptime()),
    cpuCount: os.cpus().length,
    loadAverage1m: Math.round((loadAvg[0] || 0) * 100) / 100,
    loadAverage5m: Math.round((loadAvg[1] || 0) * 100) / 100,
    loadAverage15m: Math.round((loadAvg[2] || 0) * 100) / 100,
    totalMemoryBytes: totalMem,
    freeMemoryBytes: freeMem,
    memorySaturationPct: memSaturation,
    battery,
    isThrottled,
    throttleReason,
  };
}
