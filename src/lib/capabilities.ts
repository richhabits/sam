// THE FACE, A2 — the shared shape for capability discovery (the "+" sheet, and eventually the
// "/" menu on the same registry). Not a data file: the actions themselves are component
// closures (camera handlers, chat state, yard navigation), so each surface builds its own array
// of these — the "shared source of truth" is this SHAPE, not a static list, same reasoning as
// why the existing ⌘P palette already builds its `acts` array inline rather than importing one.
//
// `enabled` must be computed from something real — provider health, whether the yard is on,
// whether a permission was granted — never hardcoded true. A disabled entry renders greyed with
// `reason` on tap, or doesn't render at all; it never looks like a live button over nothing.

export type CapabilityGroup = "work" | "capture" | "context" | "make" | "system";

export const GROUP_LABELS: Record<CapabilityGroup, string> = {
  work: "Work",
  capture: "Capture",
  context: "Context",
  make: "Make",
  system: "System",
};

// Work leads — it's where the yard's tasks live, the newest and most action-oriented group.
// System trails — settings-shaped, lowest urgency for a thumb reaching for something to DO.
export const GROUP_ORDER: CapabilityGroup[] = ["work", "capture", "context", "make", "system"];

export interface Capability {
  id: string;
  label: string;
  group: CapabilityGroup;
  icon: string;
  run: () => void;
  enabled: boolean;
  reason?: string;
}

export function groupCapabilities(items: Capability[]): { group: CapabilityGroup; items: Capability[] }[] {
  return GROUP_ORDER.map((group) => ({ group, items: items.filter((i) => i.group === group) })).filter((g) => g.items.length > 0);
}
