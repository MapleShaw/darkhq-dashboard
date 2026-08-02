'use strict';
const assert = require('assert');
const { filterRuns, mergeRuns } = require('./task-runs')._test;

function run(overrides = {}) {
  return {
    id: 'r1', jobId: 'j1', actor: 'tech', status: 'success', startedAt: '2026-08-02T10:00:00.000Z',
    source: 'openclaw-cron', ...overrides,
  };
}

function testMergeSortAndSources() {
  const merged = mergeRuns(
    [run({ id: 'w1', source: 'darkhq-writeback', startedAt: '2026-07-21T10:00:00.000Z' })],
    [run({ id: 'n1', startedAt: '2026-08-02T10:00:00.000Z' })],
  );
  assert.deepStrictEqual(merged.map(x => x.id), ['n1', 'w1']);
  assert.deepStrictEqual(merged.map(x => x.source), ['openclaw-cron', 'darkhq-writeback']);
}

function testFilter() {
  const runs = [
    run({ id: 'a' }),
    run({ id: 'b', actor: 'intel', status: 'failed' }),
  ];
  assert.deepStrictEqual(filterRuns(runs, { actor: 'tech', status: 'ok' }).map(x => x.id), ['a']);
  assert.deepStrictEqual(filterRuns(runs, { actor: 'intel', status: 'error' }).map(x => x.id), ['b']);
  assert.deepStrictEqual(filterRuns(runs, { actor: 'invalid', status: '' }), []);
}

testMergeSortAndSources();
testFilter();
console.log('routes/task-runs tests passed');
