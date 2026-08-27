export function isStale(days: number, userVisibleCommits: number, dayThreshold?: number, commitThreshold?: number): boolean;
export function computeStaleness(run?: (cmd: string) => string): {
  tag: string;
  days: number;
  totalCommits: number;
  userVisibleCommits: number;
  stale: boolean;
};
