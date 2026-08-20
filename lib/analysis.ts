import { getScenarios } from "@/data/scenarios";
import { classify } from "./classify";
import { resolveTrace } from "./sandbox";
import {
  AgentVersion,
  Category,
  FailureMode,
  SEVERITY_ORDER,
  VERSIONS,
} from "./types";

/**
 * Cross-version analysis, computed once from the classifier itself.
 * The sandbox is deterministic, so these figures are exactly what a live
 * run of each version produces — no hand-authored numbers.
 */

export interface VersionProfile {
  version: AgentVersion;
  score: number;
  byCategory: Record<Category, { pass: number; total: number }>;
  byMode: Record<FailureMode, number>;
}

function computeProfile(version: AgentVersion): VersionProfile {
  const scenarios = getScenarios(version);
  const byCategory = {} as VersionProfile["byCategory"];
  const byMode = Object.fromEntries(
    SEVERITY_ORDER.map((m) => [m, 0]),
  ) as VersionProfile["byMode"];
  let passes = 0;

  for (const s of scenarios) {
    const { mode } = classify(s, resolveTrace(s));
    byCategory[s.category] ??= { pass: 0, total: 0 };
    byCategory[s.category].total += 1;
    if (mode === null) {
      passes += 1;
      byCategory[s.category].pass += 1;
    } else {
      byMode[mode] += 1;
    }
  }

  return {
    version,
    score: Math.round((100 * passes) / scenarios.length),
    byCategory,
    byMode,
  };
}

let cache: VersionProfile[] | null = null;

export function versionProfiles(): VersionProfile[] {
  if (!cache) cache = VERSIONS.map(computeProfile);
  return cache;
}
