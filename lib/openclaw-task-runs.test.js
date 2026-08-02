'use strict';
const assert = require('assert');
const {
  entriesFromMaybe, fetchLiveCronRuns, listFromMaybe,
  normalizeJobState, normalizeNativeRun, openclawEnv,
} = require('./openclaw-task-runs');

function response(value) { return Promise.resolve({ stdout: JSON.stringify(value) }); }

function testHelpers() {
  assert.deepStrictEqual(listFromMaybe({ jobs: [{ id: 'a' }] }).map(x => x.id), ['a']);
  assert.deepStrictEqual(entriesFromMaybe({ entries: [{ ts: 1 }] }).map(x => x.ts), [1]);
  assert.ok(openclawEnv({ PATH: '/usr/bin' }).PATH.startsWith('/home/openclaw/.nvm/versions/node/v24.18.0/bin:'));
}

function testNormalizeNativeRun() {
  const run = normalizeNativeRun({
    ts: Date.parse('2026-08-02T03:02:42Z'), runAtMs: Date.parse('2026-08-02T03:00:00Z'),
    action: 'finished', status: 'error', error: 'backup failed', durationMs: 162000,
    sessionId: 'session-1', model: 'glm', provider: 'zenmux',
  }, { id: 'job-1', name: 'Backup', agentId: 'tech' });
  assert.strictEqual(run.actor, 'tech');
  assert.strictEqual(run.title, 'Backup');
  assert.strictEqual(run.status, 'failed');
  assert.strictEqual(run.source, 'openclaw-cron');
  assert.strictEqual(run.summary, 'backup failed');
  assert.strictEqual(run.durationMs, 162000);
}

function testNormalizeJobState() {
  const run = normalizeJobState({ id: 'j1', name: 'One', agentId: 'intel', state: {
    lastRunAtMs: 1785610800025, lastRunStatus: 'ok', lastDurationMs: 1234,
  }});
  assert.strictEqual(run.actor, 'intel');
  assert.strictEqual(run.status, 'success');
  assert.strictEqual(run.durationMs, 1234);
}

async function testFetchUsesOneCliCall() {
  const calls = [];
  const fake = async (_file, args) => {
    calls.push(args);
    return response({ jobs: [
      { id: 'j1', name: 'One', agentId: 'tech', state: { lastRunAtMs: 1785610800025, lastRunStatus: 'ok' } },
      { id: 'j2', name: 'Two', agentId: 'intel', state: { lastRunAtMs: 1785524400020, lastRunStatus: 'error', lastError: 'failed' } },
      { id: 'j3', name: 'Never run', agentId: 'main', state: {} },
    ] });
  };
  const result = await fetchLiveCronRuns({ execFileAsync: fake });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][1], 'list');
  assert.strictEqual(result.jobs, 3);
  assert.strictEqual(result.runs.length, 2);
  assert.strictEqual(result.runs[0].actor, 'tech');
  assert.strictEqual(result.runs[1].status, 'failed');
}

(async () => {
  testHelpers();
  testNormalizeNativeRun();
  testNormalizeJobState();
  await testFetchUsesOneCliCall();
  console.log('openclaw-task-runs tests passed');
})().catch(err => { console.error(err.stack || err.message); process.exit(1); });
