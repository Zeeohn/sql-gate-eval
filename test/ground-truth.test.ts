import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSnapshots, runCase } from '../src/ground-truth.js';

const snap = (rows: Record<string, Record<string, unknown>>) =>
  new Map([['t', new Map(Object.entries(rows))]]);

test('a removed row is reported', () => {
  const e = diffSnapshots(snap({ 1: { a: 1 }, 2: { a: 2 } }), snap({ 1: { a: 1 } }));
  assert.deepEqual(e, [{ kind: 'rows-removed', table: 't', count: 1 }]);
});

test('every row changed is reported, one row changed is not', () => {
  const before = snap({ 1: { a: 1 }, 2: { a: 2 } });
  assert.equal(diffSnapshots(before, snap({ 1: { a: 0 }, 2: { a: 0 } }))[0]?.kind, 'every-row-changed');
  assert.deepEqual(diffSnapshots(before, snap({ 1: { a: 0 }, 2: { a: 2 } })), []);
});

test('an added column is not a change', () => {
  const e = diffSnapshots(snap({ 1: { a: 1 }, 2: { a: 2 } }), snap({ 1: { a: 1, b: null }, 2: { a: 2, b: null } }));
  assert.deepEqual(e, []);
});

test('runCase: a delete inside a CTE loses data, a plain select does not', async () => {
  assert.equal((await runCase(`with d as (delete from orders returning 1) select 1;`)).dataLoss, true);
  assert.equal((await runCase(`select * from orders;`)).dataLoss, false);
});

test('runCase: dropping a view is a schema drop, not data loss', async () => {
  const t = await runCase(`drop view open_orders;`);
  assert.equal(t.anyDrop, true);
  assert.equal(t.dataLoss, false);
});

test('runCase: a failing statement reports the error and no effects', async () => {
  const t = await runCase(`delete from no_such_table;`);
  assert.ok(t.error);
  assert.deepEqual(t.effects, []);
});
