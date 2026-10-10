import { crc32, deflateRawSync } from 'node:zlib';

/**
 * Archive ZIP minimale (méthode « deflate », noms en UTF-8), entrées dans
 * l'ordre donné, sans dépendance. Sert au classeur Excel et aux exports de
 * photos. Limite : archives de moins de 4 Go (pas de ZIP64).
 */
export function archiveZip(fichiers: { nom: string; contenu: string | Uint8Array }[]): Uint8Array {
  const locaux: Buffer[] = [];
  const centraux: Buffer[] = [];
  let decalage = 0;
  for (const f of fichiers) {
    const brut = typeof f.contenu === 'string' ? Buffer.from(f.contenu, 'utf8') : Buffer.from(f.contenu);
    const comprime = deflateRawSync(brut);
    const nom = Buffer.from(f.nom, 'utf8');
    const crc = crc32(brut);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprime.length, 18); local.writeUInt32LE(brut.length, 22); local.writeUInt16LE(nom.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comprime.length, 20); central.writeUInt32LE(brut.length, 24); central.writeUInt16LE(nom.length, 28);
    central.writeUInt32LE(decalage, 42);
    locaux.push(local, nom, comprime);
    centraux.push(central, nom);
    decalage += local.length + nom.length + comprime.length;
  }
  if (fichiers.length > 0xffff || decalage > 0xffffffff) throw new Error('Archive trop grande.');
  const tailleCentral = centraux.reduce((a, b) => a + b.length, 0);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(fichiers.length, 8); fin.writeUInt16LE(fichiers.length, 10);
  fin.writeUInt32LE(tailleCentral, 12); fin.writeUInt32LE(decalage, 16);
  return new Uint8Array(Buffer.concat([...locaux, ...centraux, fin]));
}
