import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMetadata } from '../src/metadata.js';

test('Metadata file supports objects and clearing, and rejects conflicting sources', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'activitysmith-metadata-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const file = join(directory, 'metadata.json');
  for (const value of [{ready:false, count:0, empty:''}, {}]) {
    await writeFile(file, JSON.stringify(value));
    assert.deepEqual(await loadMetadata({metadataFile:file}), value);
  }
  await assert.rejects(loadMetadata({metadata:'{}', metadataFile:file}), /either/);
  await assert.rejects(loadMetadata({metadataFile:join(directory, 'missing.json')}), /ENOENT/);
  assert.equal(await loadMetadata({}), undefined);
});

test('Metadata limits match the API', async () => {
  for (const value of [
    Object.fromEntries(Array.from({length:51}, (_,i) => [`key${i}`, i])),
    {['x'.repeat(101)]: 'value'}, {field:'x'.repeat(4001)},
    {a:'x'.repeat(4000), b:'x'.repeat(4000), c:'x'.repeat(4000), d:'x'.repeat(4000), e:'x'.repeat(1000)},
  ]) await assert.rejects(loadMetadata({metadata:JSON.stringify(value)}));
});
