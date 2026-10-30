// Plan morning-digest. Section 2 builds against this file, so it changes only with the reader.
export type RunStatus = 'ok' | 'retry' | 'fail';

// One job in one night. Times keep the offset from the log (styleguide).
export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  fails: number;
  lastStatus: RunStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

// One night. `rows` are sorted by job, so the page and the JSON share one order (ADR 0001).
// `counts` adds up the parsed lines; `badLines` are the lines that did not parse.
export type DigestNight = {
  night: string;
  rows: DigestRow[];
  badLines: number;
  counts: Record<RunStatus, number>;
};

// Lives in `src/digest/read.ts`. Returns null when the night has no file or is not a
// `YYYY-MM-DD` name. An empty file returns a night with no rows.
export type ReadNight = (runsDir: string, night: string) => DigestNight | null;
