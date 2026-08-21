import { describe, it, expect } from "vitest";
import {
  parseMacBatteryOutput,
  getHardwareVitals,
  type BatteryStatus,
} from "./hardware-monitor.ts";

describe("S.A.M. Hardware & Battery Sentinel", () => {
  it("parses macOS pmset charging output accurately", () => {
    const output = `Now drawing from 'AC Power'
 -InternalBattery-0 (id=1234567)	87%; charging; 0:42 remaining present: true`;
    const batt = parseMacBatteryOutput(output);
    expect(batt.hasBattery).toBe(true);
    expect(batt.percent).toBe(87);
    expect(batt.isCharging).toBe(true);
    expect(batt.powerSource).toBe("ac");
    expect(batt.timeRemainingMinutes).toBe(42);
  });

  it("parses macOS pmset discharging output accurately", () => {
    const output = `Now drawing from 'Battery Power'
 -InternalBattery-0 (id=1234567)	18%; discharging; 1:15 remaining present: true`;
    const batt = parseMacBatteryOutput(output);
    expect(batt.hasBattery).toBe(true);
    expect(batt.percent).toBe(18);
    expect(batt.isCharging).toBe(false);
    expect(batt.powerSource).toBe("battery");
    expect(batt.timeRemainingMinutes).toBe(75);
  });

  it("handles desktop/AC-only output without battery present", () => {
    const output = `Now drawing from 'AC Power'\nNo battery found.`;
    const batt = parseMacBatteryOutput(output);
    expect(batt.hasBattery).toBe(false);
    expect(batt.percent).toBe(100);
    expect(batt.isCharging).toBe(true);
    expect(batt.powerSource).toBe("ac");
  });

  it("computes live hardware vitals without throwing", () => {
    const vitals = getHardwareVitals();
    expect(vitals.timestamp).toBeGreaterThan(0);
    expect(vitals.cpuCount).toBeGreaterThan(0);
    expect(vitals.totalMemoryBytes).toBeGreaterThan(0);
    expect(vitals.freeMemoryBytes).toBeGreaterThan(0);
    expect(vitals.memorySaturationPct).toBeGreaterThanOrEqual(0);
    expect(vitals.memorySaturationPct).toBeLessThanOrEqual(100);
    expect(typeof vitals.isThrottled).toBe("boolean");
  });
});
