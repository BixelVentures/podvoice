// Pure helpers for scripts/green-check.mjs. No network, no browser, no secrets: unit-tested in
// tests/podview/green-check.test.mjs.

// Text the user must never see standing in PodView (music-player rule 3, robot regression 13 Nov).
export const PERSISTENT_ERROR = /afvist|ukendt udfald|kunne ikke genskabes/i;

// Known, harmless log lines from the 13 Nov notes. Everything else at WARNING/ERROR is red.
export const LOG_ALLOWLIST = [
  /device_registry\.async_update_device/i, // deprecation warning from podconnect, harmless
  /ClientConnectionResetError: Cannot write to closing transport/i, // iPad websocket closed
  /retirement_prepare outcome=request_failed/i, // old hand-over remnant, step 4B/5 removes it
  /output_room_queue_unavailable.*409|room_queue_state.*rejected.*409/i, // old bound-queue path
  /\/api\/outputs\/[^ ]*.*\b409\b/i, // OwnTone retirement 409
];

const LEVEL = /\b(WARNING|WARN|ERROR|CRITICAL|FATAL)\b|level=(warn|warning|error|fatal)\b/i;

export function isProblemLine(line) {
  return LEVEL.test(line) && !LOG_ALLOWLIST.some(rule => rule.test(line));
}

// Lines that appeared in `after` since `before` was read. Add-on logs are a rolling tail, so the
// last line of `before` is the anchor; when it has scrolled out, every line in `after` is new.
export function newLogLines(before, after) {
  const old = before.split('\n').filter(Boolean);
  const now = after.split('\n').filter(Boolean);
  if (!old.length) return now;
  const anchor = old.at(-1);
  const index = now.lastIndexOf(anchor);
  return index < 0 ? now : now.slice(index + 1);
}

// Home Assistant system_log entries newer than the start of the run.
export function newSystemLogEntries(entries, startedAtSeconds) {
  return entries.filter(entry => {
    const level = String(entry.level || '').toUpperCase();
    if (!['WARNING', 'ERROR', 'CRITICAL'].includes(level)) return false;
    if ((entry.timestamp ?? entry.last_occurred ?? 0) < startedAtSeconds) return false;
    const text = `${entry.name || ''} ${[].concat(entry.message || []).join(' ')} ${entry.exception || ''}`;
    return !LOG_ALLOWLIST.some(rule => rule.test(text));
  });
}

// One control's observed state signatures over one action, in order. A flash is a state that comes
// back after something else (A→B→A) or more than `maxChanges` changes ("wish → confirmed" is one).
export function flashOf(sequence, maxChanges = 1) {
  const changes = [];
  for (const value of sequence) if (changes.at(-1) !== value) changes.push(value);
  const reverted = changes.some((value, index) => changes.indexOf(value) < index);
  return reverted || changes.length - 1 > maxChanges ? changes : null;
}

export function flashes(history, maxChanges = 1) {
  const found = [];
  for (const [control, sequence] of Object.entries(history)) {
    const changes = flashOf(sequence, maxChanges);
    if (changes) found.push({control, changes});
  }
  return found;
}

// Sound is only allowed 08:00–17:59 Europe/Copenhagen.
export function soundAllowed(date = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {hour: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Copenhagen'}).format(date),
  );
  return hour >= 8 && hour < 18;
}

// The add-on backup that `update.install` with `backup: true` made right before the current version.
// Supervisor names these "addon_<slug>_<version>"; the newest one with an older version wins.
export function rollbackBackup(backups, slug, installedVersion) {
  return (
    backups
      .filter(b => b.type === 'partial' && (b.content?.addons || []).includes(slug))
      .map(b => ({...b, version: String(b.name || '').match(/_(\d[^_]*)$/)?.[1] || null}))
      .filter(b => b.version && b.version !== installedVersion)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null
  );
}

export function redact(text, secret) {
  return secret ? String(text).split(secret).join('***') : String(text);
}

export function summary(results) {
  const red = results.filter(r => r.status === 'fejl');
  const skipped = results.filter(r => r.status === 'sprunget');
  return {
    green: red.length === 0,
    line: red.length
      ? `RØD: ${red.length} af ${results.length} tjek fejlede` + (skipped.length ? `, ${skipped.length} sprunget` : '')
      : `GRØN: ${results.length - skipped.length} tjek bestået` +
        (skipped.length ? `, ${skipped.length} sprunget` : ''),
  };
}
