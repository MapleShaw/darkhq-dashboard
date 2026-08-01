'use strict';

const assert = require('assert');
const cron = require('./cron');
const { normalizeCronJobs, openclawEnv } = cron._test;

function testPausedJobPrimaryStatus() {
  const jobs = normalizeCronJobs([{
    id: 'paused-job',
    name: 'Paused Job',
    enabled: false,
    status: 'disabled',
    state: { lastRunStatus: 'ok', lastRunAtMs: Date.parse('2026-07-30T02:00:00Z') },
    schedule: { kind: 'cron', expr: '0 10 * * *', tz: 'Asia/Shanghai' },
  }], {}, {});
  assert.strictEqual(jobs[0].enabled, false);
  assert.strictEqual(jobs[0].status, 'ok');
  assert.strictEqual(jobs[0].lastRunStatus, 'ok');
  assert.strictEqual(jobs[0].runtimeStatus, 'disabled');
  assert.strictEqual(jobs[0].lastRun, '2026-07-30T02:00:00.000Z');
}

function testOpenClawPathPrefersNode24() {
  const env = openclawEnv();
  assert(env.PATH.startsWith('/home/openclaw/.nvm/versions/node/v24.18.0/bin:'), env.PATH);
}

testPausedJobPrimaryStatus();
testOpenClawPathPrefersNode24();
console.log('routes/cron tests passed');
