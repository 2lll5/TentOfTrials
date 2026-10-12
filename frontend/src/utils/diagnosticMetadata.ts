/**
 * diagnosticMetadata.ts – Parser, viewer, and compare helpers for build diagnostic JSON.
 */

export interface ArtifactInfo {
  path: string;
  sizeBytes: number;
  /** SHA-256 of artifact content (hex, lower-case). */
  hash: string;
}

export interface ModuleResult {
  name: string;
  status: 'ok' | 'failed' | 'skipped';
  durationMs: number;
  artifacts: ArtifactInfo[];
  /** Error message or short reason when status !== 'ok'. */
  error?: string;
}

  commit: string;
  timestamp: string;
  builder: string;
  /** Map of module name → result. */
  modules: Record<string, ModuleResult>;
}

  }
  return data;
}

/* ------------------------------------------------------------------ */
/*  Compare mode                                                      */
/* ------------------------------------------------------------------ */

export type ChangeType =
  | 'added'      // present in candidate, absent in baseline
  | 'removed'    // present in baseline, absent in candidate
  | 'changed'    // present in both, but artifacts or status differ
  | 'failed'     // status changed to failed
  | 'recovered'; // status changed from failed to ok

export interface ModuleChange {
  moduleName: string;
  changeType: ChangeType;
  baseline?: ModuleResult;
  candidate?: ModuleResult;
  /** Human-readable summary of what changed (no encrypted log contents). */
  summary: string;
}

export interface CompareResult {
  baselineCommit: string;
  candidateCommit: string;
  changes: ModuleChange[];
  unchanged: string[]; // module names that are identical
}

/**
 * Compare two BuildMetadata objects and return a deterministic diff.
 */
export function compareBuildMetadata(
  baseline: BuildMetadata,
  candidate: BuildMetadata,
): CompareResult {
  const baselineModules = baseline.modules;
  const candidateModules = candidate.modules;

  const allModuleNames = new Set([
    ...Object.keys(baselineModules),
    ...Object.keys(candidateModules),
  ]);

  const changes: ModuleChange[] = [];
  const unchanged: string[] = [];

  for (const name of Array.from(allModuleNames).sort()) {
    const b = baselineModules[name];
    const c = candidateModules[name];

    if (!b) {
      changes.push({
        moduleName: name,
        changeType: 'added',
        candidate: c,
        summary: `Module added with status ${c.status}`,
      });
      continue;
    }

    if (!c) {
      changes.push({
        moduleName: name,
        changeType: 'removed',
        baseline: b,
        summary: `Module removed (was ${b.status})`,
      });
      continue;
    }

    const statusChanged = b.status !== c.status;
    const artifactsChanged =
      JSON.stringify(b.artifacts.sort((a, d) => a.path.localeCompare(d.path))) !==
      JSON.stringify(c.artifacts.sort((a, d) => a.path.localeCompare(d.path)));

    if (!statusChanged && !artifactsChanged) {
      unchanged.push(name);
      continue;
    }

    let changeType: ChangeType = 'changed';
    let summary = `Status: ${b.status} → ${c.status}`;

    if (b.status !== 'failed' && c.status === 'failed') {
      changeType = 'failed';
      summary = `Newly failed: ${b.status} → ${c.status}`;
    } else if (b.status === 'failed' && c.status === 'ok') {
      changeType = 'recovered';
      summary = `Recovered: failed → ok`;
    } else if (statusChanged) {
      summary = `Status changed: ${b.status} → ${c.status}`;
    }

    if (artifactsChanged) {
      const bCount = b.artifacts.length;
      const cCount = c.artifacts.length;
      summary += `; artifacts changed (${bCount} → ${cCount})`;
    }

    changes.push({
      moduleName: name,
      changeType,
      baseline: b,
      candidate: c,
      summary,
    });
  }

  // Deterministic ordering: by changeType priority, then module name
  const typeOrder: Record<ChangeType, number> = {
    failed: 0,
    recovered: 1,
    added: 2,
    removed: 3,
    changed: 4,
  };

  changes.sort((a, b) => {
    const diff = typeOrder[a.changeType] - typeOrder[b.changeType];
    if (diff !== 0) return diff;
    return a.moduleName.localeCompare(b.moduleName);
  });

  return {
    baselineCommit: baseline.commit,
    candidateCommit: candidate.commit,
    changes,
    unchanged,
  };
}