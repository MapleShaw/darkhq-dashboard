'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  clampLimit,
  normalizeRun,
  normalizeStatus,
  parseOutput,
  splitJobId,
  readTaskRuns,
} = require('./task-runs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhq-task-runs-'));
}

function write(baseDir, jobId, fileName, content) {
  const jobDir = path.join(baseDir, jobId);
  if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });
  fs.writeFileSync(path.join(jobDir, fileName), JSON.stringify(content, null, 2), 'utf8');
}

function testClampLimit() {
  assert.strictEqual(clampLimit('5'), 5);
  assert.strictEqual(clampLimit(5), 5);
  assert.strictEqual(clampLimit('-3'), 50);
  assert.strictEqual(clampLimit(300), 200);
  assert.strictEqual(clampLimit(null, 20), 20);
}

function testSplitJobId() {
  assert.deepStrictEqual(splitJobId('assistant-readonly_audit'), { actor: 'assistant', taskType: 'readonly_audit' });
  assert.deepStrictEqual(splitJobId('tech-smoke-check'), { actor: 'tech', taskType: 'smoke-check' });
  assert.deepStrictEqual(splitJobId('daily-brief'), { actor: null, taskType: 'daily-brief' });
  assert.deepStrictEqual(splitJobId(''), { actor: null, taskType: null });
}

function testParseOutput() {
  const o1 = { summary: 'hi', actor: 'tech', evidence: ['a.md'] };
  const r1 = parseOutput(o1);
  assert.strictEqual(r1.summary, 'hi');
  assert.strictEqual(r1.parsed.actor, 'tech');

  const o2 = JSON.stringify({ summary: 'hello', evidence: [] });
  const r2 = parseOutput(o2);
  assert.strictEqual(r2.summary, 'hello');

  const r3 = parseOutput('just a string');
  assert.strictEqual(r3.summary, 'just a string');
  assert.strictEqual(r3.parsed, null);

  const r4 = parseOutput(null);
  assert.strictEqual(r4.summary, '');
  assert.strictEqual(r4.parsed, null);
}

function testNormalizeStatus() {
  assert.strictEqual(normalizeStatus('success'), 'success');
  assert.strictEqual(normalizeStatus('ok'), 'success');
  assert.strictEqual(normalizeStatus('failed'), 'failed');
  assert.strictEqual(normalizeStatus('error'), 'failed');
  assert.strictEqual(normalizeStatus('needs_confirmation'), 'needs_confirmation');
  assert.strictEqual(normalizeStatus('needs-confirmation'), 'needs_confirmation');
  assert.strictEqual(normalizeStatus('pending_confirmation'), 'needs_confirmation');
  assert.strictEqual(normalizeStatus('weird-old-status'), 'unknown');
}

function testNormalizeRun() {
  const run = normalizeRun({
    jobId: 'tech-smoke-check',
    status: 'success',
    output: JSON.stringify({ actor: 'tech', taskType: 'smoke-check', summary: 'all good', evidence: ['a.md'], artifacts: [], blockers: [], nextAction: 'none' }),
    startedAt: '2026-07-18T10:00:00Z',
    durationMs: 1200,
  });
  assert.strictEqual(run.actor, 'tech');
  assert.strictEqual(run.taskType, 'smoke-check');
  assert.strictEqual(run.status, 'success');
  assert.strictEqual(run.summary, 'all good');
}

function testNormalizeRunOldStringOutput() {
  const run = normalizeRun({
    jobId: 'update-check',
    status: 'success',
    output: 'update check completed',
    startedAt: '2026-07-01T12:00:00Z',
  });
  assert.strictEqual(run.jobId, 'update-check');
  assert.strictEqual(run.status, 'success');
  assert.strictEqual(run.summary, 'update check completed');
  assert.deepStrictEqual(run.evidence, []);
}

function testNormalizeRunInvalidRecord() {
  assert.strictEqual(normalizeRun(null), null);
  assert.strictEqual(normalizeRun('string'), null);
  assert.strictEqual(normalizeRun({ startedAt: '2026-07-01T12:00:00Z' }), null);
}

function testActorFilter() {
  const base = tmpDir();
  write(base, 'tech-smoke-check', '2026-07-18T10-00-00Z.json', {
    jobId: 'tech-smoke-check', status: 'success',
    output: JSON.stringify({ actor: 'tech', taskType: 'smoke-check', summary: 'ok', evidence: [], artifacts: [], blockers: [], nextAction: 'none' }),
    startedAt: '2026-07-18T10:00:00Z', durationMs: 100,
  });
  write(base, 'assistant-readonly_audit', '2026-07-18T09-00-00Z.json', {
    jobId: 'assistant-readonly_audit', status: 'needs_confirmation',
    output: JSON.stringify({ actor: 'assistant', taskType: 'readonly_audit', summary: 'audit', evidence: [], artifacts: [], blockers: [], nextAction: 'ask_main' }),
    startedAt: '2026-07-18T09:00:00Z', durationMs: 200,
  });
  write(base, 'daily-log', '2026-07-01T00-00-00Z.json', {
    jobId: 'daily-log', status: 'success',
    output: 'log done', startedAt: '2026-07-01T00:00:00Z',
  });

  const all = readTaskRuns(base, { limit: 50 });
  assert.strictEqual(all.runs.length, 3);

  const techOnly = readTaskRuns(base, { limit: 50, actor: 'tech' });
  assert.strictEqual(techOnly.runs.length, 1);
  assert.strictEqual(techOnly.runs[0].actor, 'tech');

  const statusOk = readTaskRuns(base, { limit: 50, status: 'success' });
  assert.strictEqual(statusOk.runs.length, 2);

  const noMatch = readTaskRuns(base, { limit: 50, actor: 'content' });
  assert.strictEqual(noMatch.runs.length, 0);

  fs.rmSync(base, { recursive: true, force: true });
}

function testCorruptFiles() {
  const base = tmpDir();
  write(base, 'tech-smoke-check', '2026-07-18T10-00-00Z.json', {
    jobId: 'tech-smoke-check', status: 'success',
    output: JSON.stringify({ actor: 'tech', taskType: 'smoke-check', summary: 'ok', evidence: [], artifacts: [], blockers: [], nextAction: 'none' }),
    startedAt: '2026-07-18T10:00:00Z', durationMs: 100,
  });
  fs.writeFileSync(path.join(base, 'tech-smoke-check', 'bad.json'), 'not-json', 'utf8');
  fs.writeFileSync(path.join(base, 'tech-smoke-check', 'bad2.json'), '{invalid}', 'utf8');

  const all = readTaskRuns(base, { limit: 50 });
  assert.strictEqual(all.runs.length, 1);
  assert.strictEqual(all.errors.length, 2);

  fs.rmSync(base, { recursive: true, force: true });
}

function testSortDesc() {
  const base = tmpDir();
  write(base, 'a', '2026-07-18T10-00-00Z.json', {
    jobId: 'a', status: 'success', output: '{}',
    startedAt: '2026-07-18T10:00:00Z',
  });
  write(base, 'b', '2026-07-18T12-00-00Z.json', {
    jobId: 'b', status: 'success', output: '{}',
    startedAt: '2026-07-18T12:00:00Z',
  });
  write(base, 'c', '2026-07-18T08-00-00Z.json', {
    jobId: 'c', status: 'success', output: '{}',
    startedAt: '2026-07-18T08:00:00Z',
  });

  const all = readTaskRuns(base, { limit: 50 });
  assert.deepStrictEqual(all.runs.map(r => r.jobId), ['b', 'a', 'c']);

  fs.rmSync(base, { recursive: true, force: true });
}

function testNoEscapeInjection() {
  const base = tmpDir();
  write(base, 'tech-smoke-check', '2026-07-18T10-00-00Z.json', {
    jobId: 'tech-smoke-check', status: 'success',
    output: JSON.stringify({ actor: 'tech', taskType: 'smoke-check', summary: '<script>alert(1)</script>', evidence: ['<img src=x>'], artifacts: [], blockers: [], nextAction: 'none' }),
    startedAt: '2026-07-18T10:00:00Z', durationMs: 100,
  });

  const all = readTaskRuns(base, { limit: 50 });
  const r = all.runs[0];
  assert.strictEqual(r.summary, '<script>alert(1)</script>');
  assert.strictEqual(r.evidence[0], '<img src=x>');

  // Ensure API response doesn't accidentally pre-escape into doubled entities
  assert(!r.summary.includes('&lt;'));
  // Escaping is UI responsibility

  fs.rmSync(base, { recursive: true, force: true });
}

function testPathTraversalBlocked() {
  const base = tmpDir();
  write(base, 'good', '2026-07-18T10-00-00Z.json', {
    jobId: 'good', status: 'success', output: '{}', startedAt: '2026-07-18T10:00:00Z',
  });

  // try crafting weird actor filter; readTaskRuns should only descend within base
  const all = readTaskRuns(base, { limit: 50, actor: '../../../etc' });
  assert.strictEqual(all.runs.length, 0);
  fs.rmSync(base, { recursive: true, force: true });
}

function testBadFieldsAreContained() {
  const huge = 'x'.repeat(5000);
  const run = normalizeRun({
    jobId: 'tech-smoke-check',
    status: 'SUCCESS',
    output: JSON.stringify({
      actor: 'bad-actor',
      taskType: huge,
      summary: huge,
      evidence: [huge, '', null],
      artifacts: 'one-artifact',
      blockers: { bad: true },
      nextAction: huge,
      finishedAt: 'not a date',
    }),
    startedAt: 'not a date either',
    durationMs: -1,
  }, { mtimeIso: '2026-07-18T10:00:00.000Z' });

  assert.strictEqual(run.actor, 'tech');
  assert.strictEqual(run.status, 'success');
  assert.strictEqual(run.startedAt, '2026-07-18T10:00:00.000Z');
  assert.strictEqual(run.finishedAt, null);
  assert.strictEqual(run.durationMs, null);
  assert.strictEqual(run.summary.length, 4000);
  assert.strictEqual(run.taskType.length, 300);
  assert.deepStrictEqual(run.evidence.map((x) => x.length), [1000, 4]);
  assert.deepStrictEqual(run.artifacts, ['one-artifact']);
  assert.deepStrictEqual(run.blockers, ['[object Object]']);
  assert.strictEqual(run.nextAction.length, 1000);
}

function testAssistantNeedsConfirmationFromTopLevelAndBotRuntime() {
  const run = normalizeRun({
    jobId: 'assistant-readonly_audit',
    lastTaskStatus: 'needs_confirmation',
    output: JSON.stringify({ actor: 'assistant', taskType: 'readonly_audit', summary: '幽灵任务审计已完成：需要确认。' }),
    startedAt: '2026-07-18T10:00:00.000Z',
  });
  assert.strictEqual(run.actor, 'assistant');
  assert.strictEqual(run.status, 'needs_confirmation');
  assert.strictEqual(run.taskType, 'readonly_audit');
  assert.strictEqual(run.title, '幽灵任务审计');
  assert.match(run.summary, /幽灵任务审计/);
}

function testTechSuccessAndLongTextPreserved() {
  const longSummary = 'DarkHQ 任务流水修复完成。'.repeat(320);
  const run = normalizeRun({
    jobId: 'tech-darkhq_task_flow',
    status: 'ok',
    output: JSON.stringify({ actor: 'tech', taskType: 'darkhq_task_flow', summary: longSummary }),
    startedAt: '2026-07-19T10:00:00.000Z',
  });
  assert.strictEqual(run.status, 'success');
  assert.strictEqual(run.actor, 'tech');
  assert.strictEqual(run.taskType, 'darkhq_task_flow');
  assert.strictEqual(run.title, '修复 DarkHQ 任务卡片');
  assert.strictEqual(run.summary.length, 4000);
}

function testIncompleteNotPromotedToSuccess() {
  const run = normalizeRun({
    jobId: 'assistant-readonly_audit',
    output: JSON.stringify({ actor: 'assistant', status: 'needs_confirmation', summary: 'awaiting decision' }),
    startedAt: '2026-07-18T10:00:00.000Z',
  });
  assert.strictEqual(run.status, 'needs_confirmation');
}

(async () => {
  testClampLimit();
  testSplitJobId();
  testParseOutput();
  testNormalizeStatus();
  testNormalizeRun();
  testNormalizeRunOldStringOutput();
  testNormalizeRunInvalidRecord();
  testActorFilter();
  testCorruptFiles();
  testSortDesc();
  testNoEscapeInjection();
  testPathTraversalBlocked();
  testBadFieldsAreContained();
  testAssistantNeedsConfirmationFromTopLevelAndBotRuntime();
  testTechSuccessAndLongTextPreserved();
  testIncompleteNotPromotedToSuccess();
  console.log('task-runs tests passed');
})().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
