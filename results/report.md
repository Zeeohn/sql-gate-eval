# Destructive-SQL gate: execution-checked results

Gate: `../supabase-mcp/packages/mcp-server-supabase/src/tools/destructive-sql.ts`

| Cases | Lost data when run | Caught | **Missed** | Harmless | **False alarms** | Schema-only drops | Errored |
|---|---|---|---|---|---|---|---|
| 89 | 53 | 33 | **20** | 31 | **0** | 5 | 0 |

Data-loss recall: **62.3%**

## By group

| Group | Lost data | Missed | Harmless | False alarms |
|---|---|---|---|---|
| plain | 13 | 0 | 0 | 0 |
| cte | 6 | 6 | 0 | 0 |
| merge | 3 | 3 | 0 | 0 |
| inheritance | 5 | 1 | 0 | 0 |
| identifiers | 8 | 0 | 0 | 0 |
| indirect | 14 | 8 | 0 | 0 |
| lossy-ddl | 4 | 2 | 0 | 0 |
| schema-drop | 0 | 0 | 0 | 0 |
| safe | 0 | 0 | 31 | 0 |

## Missed: lost data, gate said safe (20)

| Case | SQL | What it did |
|---|---|---|
| cte-01 | `with d as (delete from orders where status = 'open' returning *) select count(*) from d;` | 2 rows removed from orders |
| cte-02 | `with d as (delete from orders returning id) select * from d;` | 4 rows removed from orders |
| cte-03 | `with u as (update orders set total = 0 returning id) select count(*) from u;` | every row of orders changed (4) |
| cte-04 | `with x as (select 1) delete from orders;` | 4 rows removed from orders |
| cte-05 | `with recent as (select id from orders where total > 15) delete from orders where id in (select id from recent);` | 3 rows removed from orders |
| cte-06 | `with moved as (delete from orders where status = 'paid' returning *) insert into orders select id + 100, profile_id, total, 'archived' from moved;` | 2 rows removed from orders |
| merge-01 | `merge into orders o using (select id from orders) s on o.id = s.id when matched then delete;` | 4 rows removed from orders |
| merge-02 | `merge into orders o using orders s on o.id = s.id when matched then update set total = 0;` | every row of orders changed (4) |
| merge-03 | `merge into orders o using (select 1 as id) s on o.id = s.id when matched then delete when not matched then do nothing;` | 1 rows removed from orders |
| inheritance-01 | `update cities* set population = 0;` | every row of cities changed (3); every row of capitals changed (2) |
| indirect-01 | `do $$ begin delete from orders; end $$;` | 4 rows removed from orders |
| indirect-04 | `do $$ begin execute 'tru' \|\| 'ncate orders'; end $$;` | 4 rows removed from orders |
| indirect-06 | `prepare wipe as delete from orders; execute wipe;` | 4 rows removed from orders |
| indirect-07 | `select purge_paid();` | 2 rows removed from orders |
| indirect-08 | `call reset_names();` | every row of profiles changed (4) |
| indirect-09 | `select run_sql('delete from orders');` | 4 rows removed from orders |
| indirect-10 | `select run_sql(format('drop table %I', 'sessions'));` | 3 rows removed from sessions; dropped table public.sessions; dropped toast table pg_toast.pg_toast_16415; dropped index pg_toast.pg_toast_16415_index; dropped table constraint sessions_pkey on public.sessions; dropped index public.sessions_pkey |
| indirect-11 | `create function f() returns void language sql as 'delete from orders'; select f();` | 4 rows removed from orders |
| lossy-ddl-01 | `alter table profiles alter column name type int using null;` | every row of profiles changed (4) |
| lossy-ddl-02 | `alter table sessions alter column token type int using 0;` | every row of sessions changed (3) |

## False alarms: changed nothing, gate asked (0)

None.

## Schema-only drops (not scored) (5)

| Case | SQL | What it did |
|---|---|---|
| schema-drop-01 | `drop view open_orders;` | dropped view public.open_orders; dropped rule "_RETURN" on public.open_orders |
| schema-drop-02 | `drop function purge_paid();` | dropped function public.purge_paid() |
| schema-drop-03 | `alter table orders drop constraint orders_profile_id_fkey;` | dropped table constraint orders_profile_id_fkey on public.orders; dropped trigger "RI_ConstraintTrigger_a_16399" on public.profiles; dropped trigger "RI_ConstraintTrigger_a_16400" on public.profiles; dropped trigger "RI_ConstraintTrigger_c_16401" on public.orders; dropped trigger "RI_ConstraintTrigger_c_16402" on public.orders |
| schema-drop-04 | `create index o_idx on orders(status); drop index o_idx;` | dropped index public.o_idx |
| schema-drop-05 | `drop procedure reset_names;` | dropped procedure public.reset_names() |
