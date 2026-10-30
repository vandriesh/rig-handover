import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { DigestNight } from '../src/digest/types.js';

// Two jobs in the wrong order, one null owner, one line that does not parse.
const NIGHT_ONE = [
  '{"at":"2026-01-01T01:00:00+01:00","job":"b/job","status":"ok","owner":"rook"}',
  '{"at":"2026-01-01T02:00:00+01:00","job":"a/job","status":"ok","owner":null}',
  '{"at":"2026-01-01T03:00:00+01:00","job":"c/job","sta',
].join('\n');

// One job with 3 retries (warn), one job that is fine (no warn).
const NIGHT_THREE = [
  '{"at":"2026-01-03T01:00:00+01:00","job":"d/job","status":"retry","owner":"rook"}',
  '{"at":"2026-01-03T02:00:00+01:00","job":"d/job","status":"retry","owner":"rook"}',
  '{"at":"2026-01-03T03:00:00+01:00","job":"d/job","status":"retry","owner":"rook"}',
  '{"at":"2026-01-03T04:00:00+01:00","job":"e/job","status":"ok","owner":"rook"}',
].join('\n');

let runsDir: string;
let config: { adapter: string; installed: string; beatEverySeconds: number; runsDir: string };

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-routes-'));
  writeFileSync(join(runsDir, '2026-01-01.jsonl'), NIGHT_ONE);
  writeFileSync(join(runsDir, '2026-01-02.jsonl'), '');
  writeFileSync(join(runsDir, '2026-01-03.jsonl'), NIGHT_THREE);
  config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir };
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

// The part of the page that belongs to one job: the chunk from its `<tr` to the next one.
function rowOf(html: string, job: string): string {
  return html.split('<tr').find((chunk) => chunk.includes(job)) ?? '';
}

describe('GET /digest/:night', () => {
  it('renders a found night with the owner dash and the bad line count', async () => {
    const res = await createApp(config).request('/digest/2026-01-01');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('digest 2026-01-01');
    expect(html).toContain('a/job');
    expect(html).toContain('b/job');
    expect(html).toContain('—');
    expect(html).toContain('1 bad line');
  });

  it('lists a/job before b/job', async () => {
    const html = await (await createApp(config).request('/digest/2026-01-01')).text();
    expect(html.indexOf('a/job')).toBeLessThan(html.indexOf('b/job'));
  });

  it('marks a row with 3 or more retries and leaves the others unmarked', async () => {
    const html = await (await createApp(config).request('/digest/2026-01-03')).text();
    expect(rowOf(html, 'd/job')).toContain('class="warn"');
    expect(rowOf(html, 'e/job')).not.toContain('class="warn"');
  });

  it('returns 404 for a night with no file', async () => {
    const res = await createApp(config).request('/digest/2026-01-09');
    const html = await res.text();
    expect(res.status).toBe(404);
    expect(html).toContain('no run log for');
  });

  it('says nothing ran for an empty file', async () => {
    const res = await createApp(config).request('/digest/2026-01-02');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });
});

describe('GET /api/digest/:night', () => {
  it('returns the night as JSON', async () => {
    const res = await createApp(config).request('/api/digest/2026-01-01');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestNight;
    expect(body).toHaveProperty('night', '2026-01-01');
    expect(body).toHaveProperty('counts');
    expect(body.badLines).toBe(1);
    expect(body.rows[0].job).toBe('a/job');
    expect(body.rows[0].owner).toBeNull();
  });

  it('returns 404 with an error body for a night with no file', async () => {
    const res = await createApp(config).request('/api/digest/2026-01-09');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log', night: '2026-01-09' });
  });

  it('returns no rows for an empty file', async () => {
    const res = await createApp(config).request('/api/digest/2026-01-02');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestNight;
    expect(body.rows).toEqual([]);
  });

  it('lists the jobs in the same order as the page', async () => {
    const body = (await (await createApp(config).request('/api/digest/2026-01-01')).json()) as DigestNight;
    const html = await (await createApp(config).request('/digest/2026-01-01')).text();
    const jsonOrder = body.rows.map((r) => r.job);
    const pageOrder = [...jsonOrder].sort((x, y) => html.indexOf(x) - html.indexOf(y));
    expect(jsonOrder).toEqual(pageOrder);
    expect(jsonOrder).toEqual(['a/job', 'b/job']);
  });
});
