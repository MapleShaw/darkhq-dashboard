'use strict';
const assert = require('assert');
const {
  cleanLabel, deduplicateTasks, fetchCurrentTasks, inferAgentId, normalizeCron, normalizeTask, pickCurrent,
  readCurrentTasks, refreshCurrentTasks, resetCache,
} = require('./openclaw-current-tasks');

function response(value) { return Promise.resolve({ stdout: JSON.stringify(value) }); }

function testHelpers() {
  assert.strictEqual(cleanLabel('📡 Content Signal Radar'), 'Content Signal Radar');
  assert.strictEqual(inferAgentId('agent:tech:subagent:abc'), 'tech');
  assert.strictEqual(normalizeTask({ status: 'succeeded' }), null);
  assert.strictEqual(normalizeTask({ taskId: 't1', agentId: 'intel', status: 'running', label: '📡 Radar', startedAt: 1000 }).title, 'Radar');
  assert.strictEqual(normalizeCron({ id: 'j1', name: 'Backup', agentId: 'tech', status: 'running', state: { runningAtMs: 2000 } }).agentId, 'tech');
}

function testDeduplicateLifecycleRows() {
  const rows = [
    normalizeTask({ taskId: 'cli-row', sourceId: 'run-1', runId: 'run-1', runtime: 'cli', agentId: 'main', status: 'running', task: '[Subagent Context] very long internal prompt', startedAt: 1000 }),
    normalizeTask({ taskId: 'sub-row', sourceId: 'run-1', runId: 'run-1', runtime: 'subagent', agentId: 'main', status: 'running', label: 'Token 审计', task: 'full task', startedAt: 1000 }),
  ];
  const result = deduplicateTasks(rows);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].title, 'Token 审计');
  assert.strictEqual(result[0].runtime, 'subagent');
}

function testPickCurrent() {
  const result = pickCurrent([
    { agentId: 'tech', title: 'Queued', status: 'queued', startedAt: new Date(3000).toISOString() },
    { agentId: 'tech', title: 'Running', status: 'running', startedAt: new Date(1000).toISOString() },
    { agentId: 'intel', title: 'Old', status: 'running', startedAt: new Date(1000).toISOString() },
    { agentId: 'intel', title: 'New', status: 'running', startedAt: new Date(2000).toISOString() },
  ]);
  assert.strictEqual(result.tech.title, 'Running');
  assert.strictEqual(result.intel.title, 'New');
}

async function testFetchAndDeduplicate() {
  const calls = [];
  const fake = async (_file, args) => {
    calls.push(args.join(' '));
    if (args[0] === 'tasks') return response({ tasks: [
      { taskId: 't1', runtime: 'cron', sourceId: 'j1', agentId: 'tech', status: 'running', label: 'Task ledger backup', startedAt: 3000 },
      { taskId: 't2', runtime: 'subagent', agentId: 'intel', status: 'queued', label: 'Research', createdAt: 4000 },
      { taskId: 'done', agentId: 'main', status: 'succeeded', label: 'Done' },
    ] });
    return response({ jobs: [
      { id: 'j1', name: 'Cron duplicate', agentId: 'tech', status: 'running', state: { runningAtMs: 3000 } },
      { id: 'j2', name: 'Cron only', agentId: 'content', status: 'running', state: { runningAtMs: 2000 } },
    ] });
  };
  const result = await fetchCurrentTasks({ execFileAsync: fake });
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(result.tasks.tech.title, 'Task ledger backup');
  assert.strictEqual(result.tasks.content.title, 'Cron only');
  assert.strictEqual(result.tasks.intel.status, 'queued');
  assert.deepStrictEqual(result.warnings, []);
}

async function testPartialFailure() {
  const fake = async (_file, args) => {
    if (args[0] === 'tasks') throw new Error('tasks unavailable');
    return response({ jobs: [{ id: 'j1', name: 'Live cron', agentId: 'main', status: 'running', state: { runningAtMs: 2000 } }] });
  };
  const result = await fetchCurrentTasks({ execFileAsync: fake });
  assert.strictEqual(result.tasks.main.title, 'Live cron');
  assert.strictEqual(result.sources.tasks.available, false);
  assert.strictEqual(result.sources.cron.available, true);
  assert.strictEqual(result.warnings.length, 1);
}

async function testStaleWhileRevalidate() {
  resetCache();
  const pending = [];
  const fake = () => new Promise((resolve) => pending.push(resolve));
  const started = Date.now();
  const first = readCurrentTasks({ execFileAsync: fake, now: 1000 });
  assert.ok(Date.now() - started < 100, 'readCurrentTasks must not wait for CLI');
  assert.deepStrictEqual(first.tasks, {});
  assert.strictEqual(first.refreshing, true);
  const concurrent = readCurrentTasks({ execFileAsync: fake, now: 1000 });
  assert.strictEqual(concurrent.refreshing, true);
  assert.strictEqual(pending.length, 2, 'concurrent reads must share one refresh');
  pending[0]({ stdout: JSON.stringify({ tasks: [] }) });
  pending[1]({ stdout: JSON.stringify({ jobs: [] }) });
  await new Promise((resolve) => setImmediate(resolve));
  const warm = readCurrentTasks({ now: 1001 });
  assert.strictEqual(warm.refreshing, false);
  assert.strictEqual(warm.cached, true);
}

async function testStaleCacheOnTotalFailure() {
  resetCache();
  const success = async (_file, args) => response(args[0] === 'tasks'
    ? { tasks: [{ taskId: 't1', agentId: 'tech', status: 'running', label: 'Keep me', startedAt: 1000 }] }
    : { jobs: [] });
  await refreshCurrentTasks({ execFileAsync: success, now: 1000 });
  const failure = async () => { throw new Error('simulated total failure'); };
  const degraded = await refreshCurrentTasks({ execFileAsync: failure, now: 40000 });
  assert.strictEqual(degraded.stale, true);
  assert.strictEqual(degraded.tasks.tech.title, 'Keep me');
  assert.ok(degraded.warnings.some((item) => item.includes('simulated total failure')));
}

(async () => {
  testHelpers();
  testDeduplicateLifecycleRows();
  testPickCurrent();
  await testFetchAndDeduplicate();
  await testPartialFailure();
  await testStaleWhileRevalidate();
  await testStaleCacheOnTotalFailure();
  console.log('openclaw-current-tasks tests passed');
})().catch((err) => { console.error(err.stack || err.message); process.exit(1); });
