import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { archiveZip } from '../zip';

describe('archive ZIP', () => {
  it('relue par une bibliothèque indépendante (zipfile de Python) : noms accentués, binaire intact, CRC vérifiés', () => {
    const binaire = new Uint8Array(70_000).map((_, i) => (i * 7919) % 256);
    const z = archiveZip([{ nom: 'avant/séjour 1.jpg', contenu: binaire }, { nom: 'lisez-moi.txt', contenu: 'Photos du chantier — accord du client noté.' }]);
    const f = path.join(mkdtempSync(path.join(tmpdir(), 'hdecor-zip-')), 'a.zip');
    writeFileSync(f, z);
    const script = [
      'import hashlib, json, sys, zipfile',
      'z = zipfile.ZipFile(sys.argv[1])',
      'assert z.testzip() is None',
      'print(json.dumps([[i.filename, i.file_size, hashlib.sha256(z.read(i)).hexdigest()] for i in z.infolist()]))',
    ].join('\n');
    const lu = JSON.parse(execFileSync('python3', ['-I', '-c', script, f], { encoding: 'utf8' })) as [string, number, string][];
    const sha = execFileSync('python3', ['-I', '-c', 'import hashlib,sys; print(hashlib.sha256(bytes((i*7919)%256 for i in range(70000))).hexdigest())'], { encoding: 'utf8' }).trim();
    expect(lu[0]).toEqual(['avant/séjour 1.jpg', 70_000, sha]);
    expect(lu[1]![0]).toBe('lisez-moi.txt');
  });
});
