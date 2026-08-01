#!/usr/bin/env node
'use strict';

const assert = require('assert');
const http = require('http');
const { once } = require('events');
const {
  deriveJobId,
  validateResult,
  toRunPayload,
  mergeBots,
  redactSecrets,
  reportResult,
} = require('./darkhq-report');

function sample(overrides = {}) {
  return {
    taskId: 'assistant-darkhq-cron-audit-2026-07-18',
    actor: 'assistant',
    taskType: 'readonly_audit',
    title: '幽灵任务审计',
    status: 'success',
    summary: '幽灵任务审计完成并留档',
    evidence: ['docs/main/audits/ghost-tasks-2026-07-18.md'],
    artifacts: ['docs/main/audits/ghost-tasks-2026-07-18.result.json'],
    blockers: [],
    nextAction: 'handoff_tech',
    startedAt: '2026-07-18T09:00:00.000+08:00',
    finishedAt: '2026-07-18T09:10:00.000+08:00',
    durationMs: 600000,
    ...overrides,
  };
}

async function withMockServer(handler, fn) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function testValidMapping() {
  const r = validateResult(sample());
  assert.strictEqual(deriveJobId(r), 'assistant-readonly_audit');
  const payload = toRunPayload(r);
  assert.strictEqual(payload.status, 'success');
  assert.strictEqual(payload.durationMs, 600000);
  assert.strictEqual(payload.startedAt, '2026-07-18T01:00:00.000Z');
  const output = JSON.parse(payload.output);
  assert.strictEqual(output.actor, 'assistant');
  assert.strictEqual(output.title, '幽灵任务审计');
  assert.deepStrictEqual(output.evidence, ['docs/main/audits/ghost-tasks-2026-07-18.md']);
}

async function testInvalidActorStatus() {
  assert.throws(() => validateResult(sample({ actor: 'boss' })), /Invalid actor/);
  assert.throws(() => validateResult(sample({ status: 'maybe' })), /Invalid status/);
}

async function test401AndRedaction() {
  const secret = 'super-secret-token-for-test';
  await withMockServer(async (req, res) => {
    assert.strictEqual(req.headers.authorization, `Bearer ${secret}`);
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: `Unauthorized Bearer ${secret}` }));
  }, async (baseUrl) => {
    await assert.rejects(
      () => reportResult(sample(), { baseUrl, env: { DASHBOARD_TOKEN: secret } }),
      (err) => {
        assert.match(err.message, /HTTP 401/);
        assert(!err.message.includes(secret), 'error leaked token');
        assert.match(redactSecrets(`Bearer ${secret}`, { DASHBOARD_TOKEN: secret }), /Bearer \[REDACTED\]/);
        return true;
      }
    );
  });
}

async function testMergeDoesNotOverwriteOtherBots() {
  const existing = [
    { id: 'main', lastTaskName: 'keep-main', weekTasks: 7, custom: 'm' },
    { id: 'assistant', lastTaskName: 'old', weekTasks: 2, custom: 'a' },
    { id: 'content', lastTaskName: 'keep-content', weekTasks: 3, custom: 'c' },
    { id: 'intel', lastTaskName: 'keep-intel', weekTasks: 4, custom: 'i' },
    { id: 'tech', lastTaskName: 'keep-tech', weekTasks: 5, custom: 't' },
  ];
  const merged = mergeBots(existing, sample());
  assert.strictEqual(merged.length, 5);
  assert.strictEqual(merged.find((b) => b.id === 'main').lastTaskName, 'keep-main');
  assert.strictEqual(merged.find((b) => b.id === 'content').custom, 'c');
  const assistant = merged.find((b) => b.id === 'assistant');
  assert.strictEqual(assistant.custom, 'a');
  assert.strictEqual(assistant.weekTasks, 3);
  assert.strictEqual(assistant.lastTaskStatus, 'success');
}

async function testHttpEndToEndAndNoOverwrite() {
  const secret = 'another-secret-token-for-test';
  const calls = [];
  const existing = [
    { id: 'main', lastTaskName: 'main-before', weekTasks: 1 },
    { id: 'assistant', lastTaskName: 'assistant-before', weekTasks: 1 },
    { id: 'content', lastTaskName: 'content-before', weekTasks: 1 },
    { id: 'intel', lastTaskName: 'intel-before', weekTasks: 1 },
    { id: 'tech', lastTaskName: 'tech-before', weekTasks: 1 },
  ];
  await withMockServer(async (req, res) => {
    assert.strictEqual(req.headers.authorization, `Bearer ${secret}`);
    if (req.method === 'POST' && req.url === '/api/cron/assistant-readonly_audit/runs') {
      const body = JSON.parse(await readBody(req));
      calls.push({ kind: 'run', body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, record: { jobId: 'assistant-readonly_audit', ...body } }));
    } else if (req.method === 'GET' && req.url === '/api/bots') {
      calls.push({ kind: 'get-bots' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, bots: existing }));
    } else if (req.method === 'POST' && req.url === '/api/bots/status') {
      const body = JSON.parse(await readBody(req));
      calls.push({ kind: 'status', body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
    }
  }, async (baseUrl) => {
    const result = await reportResult(sample(), { baseUrl, env: { DASHBOARD_TOKEN: secret } });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.jobId, 'assistant-readonly_audit');
  });
  assert.deepStrictEqual(calls.map((c) => c.kind), ['run', 'get-bots', 'status']);
  const postedBots = calls.find((c) => c.kind === 'status').body.bots;
  assert.strictEqual(postedBots.find((b) => b.id === 'main').lastTaskName, 'main-before');
  assert.strictEqual(postedBots.find((b) => b.id === 'tech').lastTaskName, 'tech-before');
  assert.notStrictEqual(postedBots.find((b) => b.id === 'assistant').lastTaskName, 'assistant-before');
}

async function testTaskNameHidesInternalTaskType() {
  const existing = [
    { id: 'main', weekTasks: 1 },
    { id: 'assistant', weekTasks: 1 },
    { id: 'content', weekTasks: 1 },
    { id: 'intel', weekTasks: 1 },
    { id: 'tech', weekTasks: 1 },
  ];
  const result = sample({
    actor: 'tech',
    taskType: 'darkhq_task_flow',
    status: 'success',
    title: '修复 DarkHQ 任务卡片',
    summary: 'DarkHQ 任务流水修复完成，机器人最近任务卡片不再显示内部标识。',
  });
  const merged = mergeBots(existing, result);
  const tech = merged.find((b) => b.id === 'tech');
  assert.strictEqual(tech.lastTaskStatus, 'success');
  assert.strictEqual(tech.lastTaskTitle, result.title);
  assert.strictEqual(tech.lastTaskSummary, result.summary);
  assert.notStrictEqual(tech.lastTaskTitle, tech.lastTaskSummary);
  assert(!tech.lastTaskTitle.includes('darkhq_task_flow:'), 'lastTaskTitle should not be prefixed by internal taskType');
}

async function testExplicitResolutionMetadata() {
  const r = validateResult(sample({
    status: 'success',
    resolvedAt: '2026-07-19T13:00:00.000Z',
    resolutionSummary: 'Maple 已确认并完成后续处理。',
  }));
  const output = JSON.parse(toRunPayload(r).output);
  assert.strictEqual(output.resolvedAt, '2026-07-19T13:00:00.000Z');
  assert.match(output.resolutionSummary, /已确认/);
  assert.throws(() => validateResult(sample({ status: 'needs_confirmation', resolvedAt: '2026-07-19T13:00:00.000Z', resolutionSummary: '错误关闭' })), /resolution must end/);
}

(async () => {
  await testValidMapping();
  await testInvalidActorStatus();
  await test401AndRedaction();
  await testMergeDoesNotOverwriteOtherBots();
  await testHttpEndToEndAndNoOverwrite();
  await testTaskNameHidesInternalTaskType();
  await testExplicitResolutionMetadata();
  console.log('darkhq-report tests passed');
})().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
