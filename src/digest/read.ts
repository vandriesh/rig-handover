import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunStatus } from './types.js';

type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// The name check stops path traversal: a night that passes cannot leave `runsDir`.
const NIGHT_NAME = /^\d{4}-\d{2}-\d{2}$/;

function isRunStatus(value: unknown): value is RunStatus {
  return value === 'ok' || value === 'retry' || value === 'fail';
}

// Returns null for a bad line: not JSON, or the wrong shape.
function parseLine(line: string): RunLine | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;

  const { at, job, status, owner, error } = value as Record<string, unknown>;
  if (typeof at !== 'string' || typeof job !== 'string' || !isRunStatus(status)) return null;
  if (typeof owner !== 'string' && owner !== null) return null;
  if (error !== undefined && typeof error !== 'string') return null;
  return { at, job, status, owner, error };
}

function readLog(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT_NAME.test(night)) return null;

  const log = readLog(join(runsDir, `${night}.jsonl`));
  if (log === null) return null;

  const rows = new Map<string, DigestRow>();
  const counts: Record<RunStatus, number> = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const line of log.split('\n')) {
    if (line.trim() === '') continue;

    const run = parseLine(line);
    if (run === null) {
      badLines += 1;
      continue;
    }

    counts[run.status] += 1;

    const row: DigestRow = rows.get(run.job) ?? {
      job: run.job,
      owner: run.owner,
      runs: 0,
      retries: 0,
      fails: 0,
      lastStatus: run.status,
      lastError: null,
      firstAt: run.at,
      lastAt: run.at,
    };
    row.runs += 1;
    if (run.status === 'retry') row.retries += 1;
    if (run.status === 'fail') row.fails += 1;
    row.owner = run.owner;
    row.lastStatus = run.status;
    row.lastError = run.error ?? row.lastError;
    row.lastAt = run.at;
    rows.set(run.job, row);
  }

  // `<` compares code units, so the order does not depend on the locale.
  const sorted = [...rows.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  return { night, rows: sorted, badLines, counts };
};
