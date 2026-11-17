// Run malformed input in child processes so an uncaught parser error fails the test.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PassThrough } = require('node:stream');

const coreRoot = path.dirname(require.resolve('playwright-core/package.json', {
  paths: [path.dirname(require.resolve('playwright/package.json'))],
}));
const { PipeTransport } = require(path.join(coreRoot, 'lib/server/pipeTransport.js'));
const flush = () => new Promise(resolve => setImmediate(resolve));

async function fixture(name) {
  const input = new PassThrough();
  const output = new PassThrough();
  const transport = new PipeTransport(output, input);
  const messages = [];
  let closed = 0;
  transport.onmessage = message => messages.push(message);
  transport.onclose = () => closed++;
  try {
    if (name === 'empty-first') {
      input.write(Buffer.from('\0{"id":1}\0 \t\n\0{"id":2}\0'));
      await flush();
      assert.deepEqual(messages, [{ id: 1 }, { id: 2 }]);
    } else if (name === 'empty-following') {
      input.write(Buffer.from('{"id":1}\0\0{"id":2}\0 \t\n\0{"id":3}\0'));
      await flush();
      assert.deepEqual(messages, [{ id: 1 }, { id: 2 }, { id: 3 }]);
    } else if (name === 'empty-only') {
      input.write(Buffer.from('\0 \t\n\0'));
      await flush();
      assert.deepEqual(messages, []);
      assert.equal(closed, 0);
      transport.send({ id: 7 });
      assert.equal(output.read().toString(), '{"id":7}\0');
    } else if (name === 'fragmented-unicode') {
      const wire = Buffer.from('{"id":1,"text":"안녕하세요🙂"}\0{"id":2}\0');
      const cuts = [0, 1, 7, wire.indexOf(Buffer.from('안')) + 1,
        wire.indexOf(Buffer.from('🙂')) + 2, wire.length - 2, wire.length];
      for (let i = 1; i < cuts.length; i++)
        input.write(wire.subarray(cuts[i - 1], cuts[i]));
      await flush();
      assert.deepEqual(messages, [{ id: 1, text: '안녕하세요🙂' }, { id: 2 }]);
    } else if (name === 'pending-rejection') {
      const { CRConnection } = require(path.join(coreRoot, 'lib/server/chromium/crConnection.js'));
      const { createRootSdkObject } = require(path.join(coreRoot, 'lib/server/instrumentation.js'));
      const connection = new CRConnection(createRootSdkObject(), transport, () => {}, { recentLogs: () => [] });
      const pending = connection.rootSession.send('Browser.getVersion');
      const rejected = assert.rejects(pending, /closed/i);
      input.write(Buffer.from('{"private-test-marker":\0'));
      let timeout;
      try {
        await Promise.race([rejected, new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Pending protocol request did not reject')), 1000);
        })]);
      } finally {
        clearTimeout(timeout);
      }
      assert.equal(input.destroyed, true);
      assert.equal(output.destroyed, true);
    } else {
      if (name === 'malformed-following')
        input.write(Buffer.from('{"id":1}\0{"private-test-marker":\0{"id":2}\0'));
      else if (name === 'malformed-fragmented') {
        input.write(Buffer.from('{"private-test-'));
        input.write(Buffer.from('marker":\0{"id":2}\0'));
      } else
        input.write(Buffer.from('{"private-test-marker":\0{"id":2}\0'));
      await flush();
      await flush();
      assert.deepEqual(messages, name === 'malformed-following' ? [{ id: 1 }] : []);
      assert.equal(closed, 1, 'Malformed input must notify disconnect once');
      assert.equal(input.destroyed, true);
      assert.equal(output.destroyed, true);
      assert.throws(() => transport.send({ id: 3 }), /closed/i);
      // A later queued/browser frame must not revive a closed transport.
      transport._dispatch(Buffer.from('{"id":4}\0'));
      await flush();
      assert.deepEqual(messages, name === 'malformed-following' ? [{ id: 1 }] : []);
      assert.equal(closed, 1);
    }
  } finally {
    input.destroy();
    output.destroy();
  }
}

if (process.argv[2] === '--fixture') {
  fixture(process.argv[3]).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  const { test } = require('node:test');
  for (const name of ['empty-first', 'empty-following', 'empty-only', 'fragmented-unicode',
    'malformed-first', 'malformed-following', 'malformed-fragmented', 'pending-rejection']) {
    test(`pipe transport: ${name}`, () => {
      const child = spawnSync(process.execPath, [__filename, '--fixture', name], {
        encoding: 'utf8', timeout: 5000, env: { ...process.env, DEBUG: 'pw:error' },
      });
      assert.equal(child.status, 0, child.error?.message || child.stderr);
      if (name.startsWith('malformed') || name === 'pending-rejection') {
        assert.match(child.stderr, /malformed JSON/i);
        assert.doesNotMatch(child.stderr, /private-test-marker/);
      }
    });
  }
}
