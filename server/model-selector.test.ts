import { describe, it, expect } from "vitest";
import { getModelSelectorCatalogue, loadModelSelection, saveModelSelection } from "./model-selector.ts";

describe("DYNAMIC MODEL SELECTOR & ZERO-COST CATALOG", () => {
  it("returns full model catalogue with zero-cost baseline and BYOK models", () => {
    const cat = getModelSelectorCatalogue();
    expect(cat.totalModelsCount).toBeGreaterThanOrEqual(8);
    expect(cat.zeroCostBaselineCount).toBeGreaterThanOrEqual(5);

    const auto = cat.models.find((m) => m.id === "auto-zero-cost");
    expect(auto).toBeDefined();
    expect(auto?.isReady).toBe(true);
    expect(auto?.isZeroCostBaseline).toBe(true);

    const cerebras = cat.models.find((m) => m.id === "cerebras-llama-70b");
    expect(cerebras).toBeDefined();
    expect(cerebras?.category).toBe("fast");

    const claude = cat.models.find((m) => m.id === "claude-3-5-sonnet");
    expect(claude).toBeDefined();
    expect(claude?.category).toBe("premium-byok");
  });

  it("updates and persists active model selection", () => {
    const original = loadModelSelection();
    expect(original.activeModelId).toBeDefined();

    saveModelSelection({ activeModelId: "cerebras-llama-70b" });
    const updated = loadModelSelection();
    expect(updated.activeModelId).toBe("cerebras-llama-70b");

    // Restore to default
    saveModelSelection({ activeModelId: "auto-zero-cost" });
    expect(loadModelSelection().activeModelId).toBe("auto-zero-cost");
  });
});
