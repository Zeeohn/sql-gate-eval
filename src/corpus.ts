// The SQL an agent might send to execute_sql. No case carries a hand-written
// label: runCase() executes each one and the database says what happened.
export type Case = { id: string; group: string; sql: string };

const c = (group: string, sqls: string[]): Case[] =>
  sqls.map((sql, i) => ({ id: `${group}-${String(i + 1).padStart(2, '0')}`, group, sql }));

export const CASES: Case[] = [
  // Statements the gate exists for. It should catch all of these.
  ...c('plain', [
    `delete from orders where status = 'paid';`,
    `delete from orders;`,
    `truncate orders;`,
    `drop table sessions;`,
    `drop table if exists orders cascade;`,
    `alter table profiles drop column whereabouts;`,
    `alter table profiles drop whereabouts;`,
    `alter table if exists only public.profiles drop column if exists whereabouts cascade;`,
    `update orders set status = 'void';`,
    `update public.orders as o set total = 0;`,
    `DELETE FROM "orders" WHERE total > 15;`,
    `select 1; delete from orders where id = 1;`,
    `drop schema public cascade;`,
  ]),

  // Writes inside a WITH clause. The statement starts with WITH or SELECT.
  ...c('cte', [
    `with d as (delete from orders where status = 'open' returning *) select count(*) from d;`,
    `with d as (delete from orders returning id) select * from d;`,
    `with u as (update orders set total = 0 returning id) select count(*) from u;`,
    `with x as (select 1) delete from orders;`,
    `with recent as (select id from orders where total > 15) delete from orders where id in (select id from recent);`,
    `with moved as (delete from orders where status = 'paid' returning *) insert into orders select id + 100, profile_id, total, 'archived' from moved;`,
  ]),

  // MERGE (Postgres 15+) can delete or rewrite every matching row.
  ...c('merge', [
    `merge into orders o using (select id from orders) s on o.id = s.id when matched then delete;`,
    `merge into orders o using orders s on o.id = s.id when matched then update set total = 0;`,
    `merge into orders o using (select 1 as id) s on o.id = s.id when matched then delete when not matched then do nothing;`,
  ]),

  // Inheritance syntax: ONLY and the trailing * that means "include children".
  ...c('inheritance', [
    `update cities* set population = 0;`,
    `update only cities set population = 0;`,
    `delete from cities*;`,
    `delete from only capitals where state = 'fct';`,
    `update capitals set population = population + 1;`,
  ]),

  // Identifiers and aliases that contain or look like keywords.
  ...c('identifiers', [
    `update profiles set whereabouts = 'remote';`,
    `update profiles set "where" = 'z';`,
    `update profiles p set name = upper(p.name);`,
    `update "profiles" set name = 'n';`,
    `update profiles set name = 'n' -- where id = 1
    ;`,
    `update profiles set name = 'where ';`,
    `update profiles set name = 'n' /* where id = 1 */;`,
    `update profiles set name = $$x$$;`,
  ]),

  // Destructive SQL run indirectly: DO blocks, dynamic SQL, prepared
  // statements, functions and procedures.
  ...c('indirect', [
    `do $$ begin delete from orders; end $$;`,
    `do $$ begin execute 'delete from orders'; end $$;`,
    `do $$ begin execute format('drop table %I', 'sessions'); end $$;`,
    `do $$ begin execute 'tru' || 'ncate orders'; end $$;`,
    `do $$ declare t text := 'sessions'; begin execute 'drop table ' || t; end $$;`,
    `prepare wipe as delete from orders; execute wipe;`,
    `select purge_paid();`,
    `call reset_names();`,
    `select run_sql('delete from orders');`,
    `select run_sql(format('drop table %I', 'sessions'));`,
    `create function f() returns void language sql as 'delete from orders'; select f();`,
    `explain analyze delete from orders;`,
    `explain (analyze) update orders set total = 0;`,
    `explain (analyze true, buffers) delete from orders where id = 1;`,
  ]),

  // Data loss without DELETE, DROP, TRUNCATE or UPDATE.
  ...c('lossy-ddl', [
    `alter table profiles alter column name type int using null;`,
    `alter table sessions alter column token type int using 0;`,
    `delete from profiles where id = 1;`, // cascades into orders
    `alter table profiles rename column name to n; alter table profiles drop column n;`,
  ]),

  // Other removals: no rows lost, but a definition is gone.
  ...c('schema-drop', [
    `drop view open_orders;`,
    `drop function purge_paid();`,
    `alter table orders drop constraint orders_profile_id_fkey;`,
    `create index o_idx on orders(status); drop index o_idx;`,
    `drop procedure reset_names;`,
  ]),

  // Safe statements. The gate should let these through without asking.
  ...c('safe', [
    `select * from orders;`,
    `select 'drop table orders' as hint;`,
    `-- drop table orders
    select 1;`,
    `select 1 /* delete from orders */;`,
    `insert into orders values (9, 1, 5, 'open');`,
    `update orders set status = 'paid' where id = 2;`,
    `update profiles set name = 'ada l' where id = 1;`,
    `update orders set total = total + 1 where status = 'open';`,
    `create table notes (id int, body text);`,
    `alter table profiles add column bio text;`,
    `create index on orders (status);`,
    `comment on table orders is 'delete me later';`,
    `create policy "owners can delete" on orders for delete using (true);`,
    `explain delete from orders;`,
    `explain (analyze false) delete from orders;`,
    `explain (costs off) update orders set total = 0;`,
    `select * from orders where status = 'drop';`,
    `select deleted_at from profiles;`,
    `create table truncate_log (id int);`,
    `grant select on orders to public;`,
    `select count(*) from cities*;`,
    `with o as (select * from orders) select * from o;`,
    `do $$ begin raise notice 'delete nothing'; end $$;`,
    `select run_sql('select 1');`,
    `create function g() returns int language sql as 'select 1'; select g();`,
    `alter table orders add constraint total_nonneg check (total >= 0);`,
    `merge into orders o using (select 99 as id) s on o.id = s.id when not matched then insert values (99, 1, 1, 'open');`,
    `update only capitals set population = 1 where state = 'fct';`,
    `set statement_timeout = '5s';`,
    `vacuum orders;`,
    `update orders set status = 'void' from profiles where profiles.id = orders.profile_id and profiles.name = 'ada';`,
  ]),
];
