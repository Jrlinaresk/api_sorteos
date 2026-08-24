import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalMediaStorageProvider } from './local-media-storage.provider';

describe('LocalMediaStorageProvider', () => {
  let testRoot: string;
  let provider: LocalMediaStorageProvider;

  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'media-storage-test-'));
    provider = new LocalMediaStorageProvider(
      new ConfigService({ MEDIA_LOCAL_ROOT: join(testRoot, 'objects') }),
    );
  });

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
  });

  it('writes and opens a regular object without exposing a filesystem path', async () => {
    const source = join(testRoot, 'source.png');
    const contents = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await writeFile(source, contents);

    const stored = await provider.put({
      sourcePath: source,
      key: '2026/08/opaque.png',
      contentType: 'image/png',
    });
    const opened = await provider.open(stored.key);
    const chunks: Buffer[] = [];
    for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk));

    expect(stored).toEqual({
      key: '2026/08/opaque.png',
      size: contents.length,
    });
    expect(Buffer.concat(chunks)).toEqual(contents);
  });

  it('rejects traversal before writing outside its root', async () => {
    const source = join(testRoot, 'source.png');
    await writeFile(source, 'safe');

    await expect(
      provider.put({
        sourcePath: source,
        key: '../escaped.png',
        contentType: 'image/png',
      }),
    ).rejects.toThrow('Clave de almacenamiento inválida');
  });

  it('never overwrites or removes an existing opaque key', async () => {
    const firstSource = join(testRoot, 'first.png');
    const secondSource = join(testRoot, 'second.png');
    await writeFile(firstSource, 'first');
    await writeFile(secondSource, 'second');
    const input = {
      sourcePath: firstSource,
      key: '2026/08/collision.png',
      contentType: 'image/png',
    };
    await provider.put(input);

    await expect(
      provider.put({ ...input, sourcePath: secondSource }),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    const opened = await provider.open(input.key);
    const chunks: Buffer[] = [];
    for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('first');
  });

  it('rejects a symbolic-link upload source', async () => {
    const target = join(testRoot, 'target.png');
    const source = join(testRoot, 'link.png');
    await writeFile(target, 'safe');
    await symlink(target, source);

    await expect(
      provider.put({
        sourcePath: source,
        key: '2026/08/opaque.png',
        contentType: 'image/png',
      }),
    ).rejects.toThrow('no es un archivo regular');
  });
});
