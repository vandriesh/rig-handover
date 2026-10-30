import type { DigestNight, DigestRow } from '../digest/types.js';

const DASH = '—';

function DigestTableRow({ row }: { row: DigestRow }) {
  const warn = row.retries >= 3 || row.fails > 0;
  return (
    <tr class={warn ? 'warn' : undefined}>
      <td>{row.job}</td>
      <td>{row.owner ?? DASH}</td>
      <td>{row.runs}</td>
      <td>{row.retries}</td>
      <td>{row.lastStatus}</td>
      <td>{row.lastError === null || row.lastError === '' ? DASH : row.lastError}</td>
      <td>{row.firstAt}</td>
      <td>{row.lastAt}</td>
    </tr>
  );
}

export function DigestPage({ digest }: { digest: DigestNight }) {
  return (
    <>
      <h1>digest {digest.night}</h1>
      {digest.badLines > 0 && (
        <p class="warn">{digest.badLines === 1 ? '1 bad line' : `${digest.badLines} bad lines`}</p>
      )}
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>last status</th>
              <th>last error</th>
              <th>first</th>
              <th>last</th>
            </tr>
          </thead>
          <tbody>
            {digest.rows.map((row) => (
              <DigestTableRow row={row} />
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function DigestMissing({ night }: { night: string }) {
  return (
    <>
      <h1>digest {night}</h1>
      <p class="mute">no run log for {night}</p>
    </>
  );
}
