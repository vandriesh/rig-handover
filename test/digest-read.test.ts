import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

const NIGHT = '2026-01-01';
const NO_COUNTS = { ok: 0, retry: 0, fail: 0 };

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeNight(text: string): void {
  writeFileSync(join(dir, `${NIGHT}.jsonl`), text);
}

function run(fields: Record<string, unknown>): string {
  return JSON.stringify({ at: '2026-01-01T01:00:00+01:00', job: 'a/job', status: 'ok', owner: 'rook', ...fields });
}

describe('readNight on the real night', () => {
  const night = readNight('runs', '2026-10-28');
  const row = (job: string) => night?.rows.find((r) => r.job === job);

  it('gives one row per job, sorted by job', () => {
    expect(night?.night).toBe('2026-10-28');
    expect(night?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('counts the bad line and adds up the parsed lines', () => {
    expect(night?.badLines).toBe(1);
    expect(night?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('keeps the last error after a job recovers', () => {
    expect(row('fixtures/refresh')).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      fails: 0,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('shows the failed job', () => {
    expect(row('notes/backup')).toMatchObject({
      runs: 1,
      fails: 1,
      lastStatus: 'fail',
      lastError: 'quota exceeded',
    });
  });

  it('keeps a null owner', () => {
    expect(row('digest/render')).toMatchObject({ owner: null, lastError: null });
  });

  it('does not count the bad line in the row of its job', () => {
    expect(row('lane/sync')).toMatchObject({ runs: 8, retries: 1, lastAt: '2026-10-29T05:00:04+01:00' });
  });
});

describe('readNight on a temp folder', () => {
  it('gives a night with no rows for an empty file', () => {
    writeNight('');
    expect(readNight(dir, NIGHT)).toEqual({ night: NIGHT, rows: [], badLines: 0, counts: NO_COUNTS });
  });

  it('does not count blank lines', () => {
    writeNight(`\n   \n\r\n${run({})}\r\n\n`);
    const night = readNight(dir, NIGHT);
    expect(night?.badLines).toBe(0);
    expect(night?.rows).toHaveLength(1);
  });

  it('returns null for a missing file', () => {
    expect(readNight(dir, NIGHT)).toBeNull();
  });

  it('returns null for a missing runs folder', () => {
    expect(readNight(join(dir, 'nothing-here'), NIGHT)).toBeNull();
  });

  it.each(['', 'latest', '26-10-28', '2026-1-1', '2026-10-28.jsonl', '2026-10-28\n', ' 2026-10-28', '٢٠٢٦-١٠-٢٨'])(
    'returns null for the night name %j',
    (night) => {
      writeFileSync(join(dir, `${night}.jsonl`), run({}));
      expect(readNight(dir, night)).toBeNull();
    },
  );

  it('does not read a file outside the runs folder', () => {
    const runsDir = join(dir, 'runs');
    mkdirSync(runsDir);
    writeFileSync(join(dir, 'secret.jsonl'), run({}));
    expect(readNight(runsDir, '../secret')).toBeNull();
  });

  it('rethrows other read errors', () => {
    mkdirSync(join(dir, `${NIGHT}.jsonl`));
    expect(() => readNight(dir, NIGHT)).toThrow(/EISDIR/);
  });

  it.each([
    ['not JSON', '{"at":"2026'],
    ['a JSON null', 'null'],
    ['a JSON number', '42'],
    ['a JSON string', '"ok"'],
    ['a JSON array', '[]'],
    ['an empty object', '{}'],
    ['an `at` that is not a string', run({ at: 1 })],
    ['a `job` that is not a string', run({ job: null })],
    ['an unknown status', run({ status: 'done' })],
    ['a status from the object prototype', run({ status: 'toString' })],
    ['a missing owner', run({ owner: undefined })],
    ['an owner that is not a string', run({ owner: 7 })],
    ['an `error` that is null', run({ error: null })],
    ['an `error` that is not a string', run({ error: 503 })],
  ])('counts %s as a bad line', (_name, line) => {
    writeNight(`${line}\n`);
    expect(readNight(dir, NIGHT)).toEqual({ night: NIGHT, rows: [], badLines: 1, counts: NO_COUNTS });
  });

  it('reads the good lines around a bad line', () => {
    writeNight([run({}), run({ job: 'a/job', status: 'nope' }), '{', run({ status: 'retry' })].join('\n'));
    const night = readNight(dir, NIGHT);
    expect(night?.badLines).toBe(2);
    expect(night?.counts).toEqual({ ok: 1, retry: 1, fail: 0 });
    expect(night?.rows[0]).toMatchObject({ runs: 2, retries: 1, lastStatus: 'retry' });
  });

  it('takes the last fields from the last line of the file, not the latest time', () => {
    writeNight(
      [
        run({ at: '2026-01-01T05:00:00+01:00', status: 'fail', owner: 'rook', error: 'first' }),
        run({ at: '2026-01-01T02:00:00+09:00', status: 'retry', owner: 'lane-07', error: 'second' }),
        run({ at: '2026-01-01T03:00:00Z', status: 'ok', owner: null }),
      ].join('\n'),
    );
    expect(readNight(dir, NIGHT)?.rows).toEqual([
      {
        job: 'a/job',
        owner: null,
        runs: 3,
        retries: 1,
        fails: 1,
        lastStatus: 'ok',
        lastError: 'second',
        firstAt: '2026-01-01T05:00:00+01:00',
        lastAt: '2026-01-01T03:00:00Z',
      },
    ]);
  });

  it('keeps an empty error string', () => {
    writeNight([run({ error: 'real' }), run({ error: '' })].join('\n'));
    expect(readNight(dir, NIGHT)?.rows[0]?.lastError).toBe('');
  });

  it('sorts by code unit, not by locale', () => {
    writeNight(['é', 'a', 'Z', 'B'].map((job) => run({ job })).join('\n'));
    expect(readNight(dir, NIGHT)?.rows.map((r) => r.job)).toEqual(['B', 'Z', 'a', 'é']);
  });

  it('accepts a job name that is also an object property', () => {
    writeNight([run({ job: '__proto__' }), run({ job: 'constructor' }), run({ job: '__proto__' })].join('\n'));
    expect(readNight(dir, NIGHT)?.rows.map((r) => [r.job, r.runs])).toEqual([
      ['__proto__', 2],
      ['constructor', 1],
    ]);
  });
});
