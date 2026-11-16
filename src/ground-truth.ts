// Ground truth by execution: run a SQL case in a fresh in-memory Postgres
// (PGlite) and record what it actually did to the data.
import { PGlite } from '@electric-sql/pglite';

// A small database with the shapes the corpus needs: plain tables, a foreign
// key, table inheritance (the Postgres docs' cities/capitals example), a view,
// and a function and a procedure that delete rows.
const SEED = `
create table profiles (id int primary key, name text, deleted_at timestamptz, whereabouts text, "where" text);
insert into profiles values
  (1, 'ada', null, 'lagos', 'a'), (2, 'bayo', null, 'abuja', 'b'),
  (3, 'chi', now(), 'kano', 'c'), (4, 'dele', null, 'ibadan', 'd');
create table orders (id int primary key, profile_id int references profiles(id) on delete cascade, total numeric, status text);
insert into orders values (1, 1, 10, 'paid'), (2, 1, 20, 'open'), (3, 2, 30, 'open'), (4, 3, 40, 'paid');
create table cities (id int primary key, name text, population int);
create table capitals (state text) inherits (cities);
insert into cities values (1, 'ikeja', 100), (2, 'aba', 200), (3, 'warri', 300);
insert into capitals values (4, 'abuja', 400, 'fct'), (5, 'enugu', 500, 'enugu');
create table sessions (id int primary key, token text);
insert into sessions values (1, 't1'), (2, 't2'), (3, 't3');
create view open_orders as select * from orders where status = 'open';
create function purge_paid() returns int language sql as $$
  with d as (delete from orders where status = 'paid' returning 1) select count(*)::int from d $$;
create procedure reset_names() language sql as $$ update profiles set name = 'x' $$;
create function run_sql(q text) returns void language plpgsql as $$ begin execute q; end $$;

create schema audit;
create table audit.drops (object_type text, identity text);
create function audit.log_drop() returns event_trigger language plpgsql as $$
declare r record;
begin
  for r in select * from pg_event_trigger_dropped_objects() loop
    insert into audit.drops values (r.object_type, r.object_identity);
  end loop;
end $$;
create event trigger log_drops on sql_drop execute function audit.log_drop();
`;

// Tables whose rows we compare before and after. "only" keeps the inherited
// rows of capitals out of the cities count.
const TABLES = ['profiles', 'orders', 'cities', 'capitals', 'sessions'];

// Drops that lose data. Other drops (views, functions, indexes, policies,
// constraints) are reported separately as "schema" removals.
const DATA_DROPS = new Set(['table', 'table column', 'schema', 'materialized view', 'sequence']);

export type Effect =
  | { kind: 'rows-removed'; table: string; count: number }
  | { kind: 'every-row-changed'; table: string; count: number }
  | { kind: 'dropped'; objectType: string; identity: string; data: boolean };

export type Truth = {
  error?: string;
  effects: Effect[];
  dataLoss: boolean; // rows removed, every row rewritten, or a data object dropped
  anyDrop: boolean; // any object dropped at all
};

type Row = Record<string, unknown>;
type Snapshot = Map<string, Map<string, Row>>; // table -> row id -> row as JSON

async function snapshot(db: PGlite): Promise<Snapshot> {
  const snap: Snapshot = new Map();
  for (const table of TABLES) {
    const exists = await db.query<{ t: string | null }>(`select to_regclass('public.${table}')::text as t`);
    if (!exists.rows[0]?.t) continue;
    const res = await db.query<{ id: string; row: Row }>(
      `select id::text as id, to_jsonb(t) as row from only public.${table} t`
    );
    snap.set(table, new Map(res.rows.map((r) => [r.id, r.row])));
  }
  return snap;
}

export function diffSnapshots(before: Snapshot, after: Snapshot): Effect[] {
  const effects: Effect[] = [];
  for (const [table, rows] of before) {
    const now = after.get(table) ?? new Map<string, Row>();
    let removed = 0;
    let changed = 0;
    for (const [id, old] of rows) {
      const cur = now.get(id);
      if (!cur) removed++;
      // Compare only the columns that existed before, so ADD COLUMN is not a
      // change. A dropped column is missing from cur, so it counts.
      else if (Object.keys(old).some((k) => JSON.stringify(old[k]) !== JSON.stringify(cur[k]))) changed++;
    }
    if (removed > 0) effects.push({ kind: 'rows-removed', table, count: removed });
    // A WHERE that hits every row is rare in the corpus; every row rewritten
    // is what an UPDATE without WHERE (or a lossy ALTER) looks like.
    if (rows.size >= 2 && changed === rows.size) {
      effects.push({ kind: 'every-row-changed', table, count: changed });
    }
  }
  return effects;
}

export async function runCase(sql: string): Promise<Truth> {
  const db = new PGlite();
  try {
    await db.exec(SEED);
    const before = await snapshot(db);
    let error: string | undefined;
    try {
      await db.exec(sql);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const effects = diffSnapshots(before, await snapshot(db));
    const drops = await db.query<{ object_type: string; identity: string }>(
      `select object_type, identity from audit.drops where object_type not in ('type')`
    );
    for (const d of drops.rows) {
      effects.push({ kind: 'dropped', objectType: d.object_type, identity: d.identity, data: DATA_DROPS.has(d.object_type) });
    }
    const dataLoss = effects.some((e) => e.kind !== 'dropped' || e.data);
    return { error, effects, dataLoss, anyDrop: drops.rows.length > 0 };
  } finally {
    await db.close();
  }
}
