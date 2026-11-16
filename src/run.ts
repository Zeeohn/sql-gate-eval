// Score a destructive-SQL gate against execution ground truth.
//
//   npm run eval                       # gate from ../supabase-mcp (default)
//   npm run eval -- --gate <path.ts>   # any module exporting isDestructiveSql(sql)
//   npm run eval -- --min-recall 1     # exit 1 if data-loss recall is below 1 (CI gate)
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CASES } from './corpus.js';
import { runCase, type Truth } from './ground-truth.js';

const DEFAULT_GATE = '../supabase-mcp/packages/mcp-server-supabase/src/tools/destructive-sql.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

type Row = { id: string; group: string; sql: string; truth: Truth; gate: boolean };

function describe(t: Truth): string {
  return t.effects
    .map((e) =>
      e.kind === 'dropped'
        ? `dropped ${e.objectType} ${e.identity}`
        : e.kind === 'rows-removed'
          ? `${e.count} rows removed from ${e.table}`
          : `every row of ${e.table} changed (${e.count})`
    )
    .join('; ');
}

const oneLine = (sql: string) => sql.replace(/\s+/g, ' ').trim();

async function main() {
  const gatePath = resolve(arg('--gate') ?? DEFAULT_GATE);
  const gate = (await import(pathToFileURL(gatePath).href)) as { isDestructiveSql(sql: string): boolean };

  const rows: Row[] = [];
  for (const k of CASES) {
    rows.push({ ...k, truth: await runCase(k.sql), gate: gate.isDestructiveSql(k.sql) });
  }

  const scored = rows.filter((r) => !r.truth.error);
  const errored = rows.filter((r) => r.truth.error);
  // Data loss is what the gate must catch. A pure schema drop (view, function,
  // index, constraint) is reported, but not counted as a miss or a false alarm.
  const lossy = scored.filter((r) => r.truth.dataLoss);
  const harmless = scored.filter((r) => !r.truth.anyDrop && !r.truth.dataLoss);
  const schemaOnly = scored.filter((r) => r.truth.anyDrop && !r.truth.dataLoss);
  const missed = lossy.filter((r) => !r.gate);
  const falseAlarms = harmless.filter((r) => r.gate);
  const recall = lossy.length ? (lossy.length - missed.length) / lossy.length : 1;

  const groups = [...new Set(rows.map((r) => r.group))];
  const lines: string[] = [];
  lines.push(`# Destructive-SQL gate: execution-checked results`, '');
  lines.push(`Gate: \`${arg('--gate') ?? DEFAULT_GATE}\``, '');
  lines.push(`| Cases | Lost data when run | Caught | **Missed** | Harmless | **False alarms** | Schema-only drops | Errored |`);
  lines.push(`|---|---|---|---|---|---|---|---|`);
  lines.push(
    `| ${rows.length} | ${lossy.length} | ${lossy.length - missed.length} | **${missed.length}** | ${harmless.length} | **${falseAlarms.length}** | ${schemaOnly.length} | ${errored.length} |`,
    ''
  );
  lines.push(`Data-loss recall: **${(recall * 100).toFixed(1)}%**`, '');

  lines.push(`## By group`, '', `| Group | Lost data | Missed | Harmless | False alarms |`, `|---|---|---|---|---|`);
  for (const g of groups) {
    const inG = (rs: Row[]) => rs.filter((r) => r.group === g).length;
    lines.push(`| ${g} | ${inG(lossy)} | ${inG(missed)} | ${inG(harmless)} | ${inG(falseAlarms)} |`);
  }
  lines.push('');

  const table = (title: string, rs: Row[], effects: boolean) => {
    lines.push(`## ${title} (${rs.length})`, '');
    if (!rs.length) return lines.push('None.', '');
    lines.push(effects ? `| Case | SQL | What it did |` : `| Case | SQL |`, effects ? `|---|---|---|` : `|---|---|`);
    for (const r of rs) {
      const sql = '`' + oneLine(r.sql).replace(/\|/g, '\\|') + '`';
      lines.push(effects ? `| ${r.id} | ${sql} | ${describe(r.truth)} |` : `| ${r.id} | ${sql} |`);
    }
    lines.push('');
  };
  table('Missed: lost data, gate said safe', missed, true);
  table('False alarms: changed nothing, gate asked', falseAlarms, false);
  table('Schema-only drops (not scored)', schemaOnly.map((r) => r), true);
  if (errored.length) {
    lines.push(`## Errored in Postgres (not scored)`, '');
    for (const r of errored) lines.push(`- ${r.id}: \`${oneLine(r.sql)}\`: ${r.truth.error}`);
    lines.push('');
  }

  const report = lines.join('\n');
  mkdirSync('results', { recursive: true });
  writeFileSync('results/report.md', report);
  writeFileSync('results/results.json', JSON.stringify(rows, null, 2));
  console.log(report);

  const min = arg('--min-recall');
  if (min !== undefined && recall < Number(min)) {
    console.error(`recall ${recall.toFixed(3)} is below --min-recall ${min}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
