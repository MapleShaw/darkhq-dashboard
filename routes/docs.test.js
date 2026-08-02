'use strict';

const assert = require('assert');
const docs = require('./docs');
const { normalizeSearchQuery, makeSearchSnippet, searchDocuments } = docs._test;

assert.strictEqual(normalizeSearchQuery('  历史决策  '), '历史决策');
assert.strictEqual(normalizeSearchQuery('x'.repeat(150)).length, 120);

const snippet = makeSearchSnippet('前文 '.repeat(20) + '关键决策：不重启服务。' + ' 后文'.repeat(40), '关键决策');
assert(snippet.includes('关键决策'));
assert(snippet.startsWith('…'));
assert(snippet.endsWith('…'));

const items = [
  { id: 'team-paused-a', title: '普通标题', category: '暂停项目', _body: '这里记录了回退方案' },
  { id: 'team-paused-b', title: '升级清单', category: '项目治理', _body: '没有正文命中' },
];
assert.deepStrictEqual(searchDocuments(items, '回退方案').map((item) => item.id), ['team-paused-a']);
assert.deepStrictEqual(searchDocuments(items, '升级').map((item) => item.id), ['team-paused-b']);
assert(searchDocuments(items, '回退方案')[0].searchSnippet.includes('回退方案'));

console.log('routes/docs tests passed');
