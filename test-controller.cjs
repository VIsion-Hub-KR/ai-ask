// ai-controller.cjs 순수 헬퍼 단위 검증 (브라우저 안 띄움)
const assert = require('assert');
const { resolveSolo, AI_LIST } = require('./ai-controller.cjs');

for (const ai of ['notion', 'gemini', 'chatgpt', 'claude', 'perplexity', 'grok', 'genspark', 'aistudio']) {
  const r = resolveSolo(ai);
  assert.ok(r && r.url && r.name, `resolveSolo(${ai}) 유효해야 함`);
}
assert.strictEqual(resolveSolo('bard'), null, '잘못된 키는 null');
assert.strictEqual(AI_LIST.length, 8, 'AI 8개');
console.log('OK: resolveSolo/AI_LIST');
