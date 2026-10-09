import { crc32, deflateRawSync } from 'node:zlib';

/**
 * Classeur Excel (.xlsx, Office Open XML) minimal, sans dépendance : texte,
 * montants (centimes ENTIERS écrits en décimal exact, jamais via un flottant),
 * dates (numéro de série Excel, format JJ/MM/AAAA), nombres entiers. Une ligne
 * d'en-tête en gras, figée. Pour les exports destinés au comptable.
 */
export type Cellule =
  | { t: 'texte'; v: string | null }
  | { t: 'montant'; cents: bigint | number | null }
  | { t: 'date'; iso: string | null }
  | { t: 'entier'; v: number | null };

export type Feuille = { nom: string; entetes: string[]; lignes: Cellule[][]; largeurs?: number[] };

export const texte = (v: string | null | undefined): Cellule => ({ t: 'texte', v: v ?? null });
export const montant = (cents: bigint | number | null | undefined): Cellule => ({ t: 'montant', cents: cents ?? null });
export const date = (iso: string | null | undefined): Cellule => ({ t: 'date', iso: iso ?? null });
export const entier = (v: number | null | undefined): Cellule => ({ t: 'entier', v: v ?? null });

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // Caractères de contrôle interdits en XML 1.0 (sauf tabulation et retours à la ligne).
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** Lettres de colonne : 0 -> A, 25 -> Z, 26 -> AA. */
export function colonne(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Centimes -> décimal exact « -1234.05 » (texte, sans flottant). */
export function centimesDecimal(c: bigint | number): string {
  const v = BigInt(c);
  const a = v < 0n ? -v : v;
  return `${v < 0n ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
}

/** AAAA-MM-JJ -> numéro de série Excel (jours depuis le 30/12/1899). */
export function serieExcel(iso: string): number {
  const [a, m, j] = iso.slice(0, 10).split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(a, m - 1, j) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/** Les formules ne sont jamais écrites : un texte commençant par = + - @ reste du texte (pas d'injection). */
function cellule(c: Cellule, ref: string): string {
  switch (c.t) {
    case 'texte': return c.v === null || c.v === '' ? '' : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(c.v)}</t></is></c>`;
    case 'montant': return c.cents === null ? '' : `<c r="${ref}" s="2"><v>${centimesDecimal(c.cents)}</v></c>`;
    case 'date': return c.iso === null || c.iso === '' ? '' : `<c r="${ref}" s="3"><v>${serieExcel(c.iso)}</v></c>`;
    case 'entier': return c.v === null ? '' : `<c r="${ref}"><v>${Math.trunc(c.v)}</v></c>`;
  }
}

function feuilleXml(f: Feuille): string {
  const lignes = [f.entetes.map((e) => ({ t: 'texte', v: e }) as Cellule), ...f.lignes];
  const rows = lignes.map((l, r) => `<row r="${r + 1}">${l.map((c, i) => {
    const x = cellule(c, `${colonne(i)}${r + 1}`);
    return r === 0 ? x.replace('t="inlineStr"', 's="1" t="inlineStr"') : x;
  }).join('')}</row>`).join('');
  const largeurs = f.entetes.map((e, i) => f.largeurs?.[i] ?? Math.min(60, Math.max(12, e.length + 2)));
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + `<cols>${largeurs.map((l, i) => `<col min="${i + 1}" max="${i + 1}" width="${l}" customWidth="1"/>`).join('')}</cols>`
    + `<sheetData>${rows}</sheetData></worksheet>`;
}

const nomFeuille = (n: string) => n.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Feuille';

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>'
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
  + '</styleSheet>';

/** Archive ZIP (méthode « deflate »), entrées dans l'ordre donné. */
function zip(fichiers: { nom: string; contenu: string }[]): Uint8Array {
  const locaux: Buffer[] = [];
  const centraux: Buffer[] = [];
  let decalage = 0;
  for (const f of fichiers) {
    const brut = Buffer.from(f.contenu, 'utf8');
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
  const tailleCentral = centraux.reduce((a, b) => a + b.length, 0);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(fichiers.length, 8); fin.writeUInt16LE(fichiers.length, 10);
  fin.writeUInt32LE(tailleCentral, 12); fin.writeUInt32LE(decalage, 16);
  return new Uint8Array(Buffer.concat([...locaux, ...centraux, fin]));
}

export function classeurXlsx(feuilles: Feuille[]): Uint8Array {
  if (!feuilles.length) throw new Error('Classeur vide.');
  const noms = feuilles.map((f, i) => { const n = nomFeuille(f.nom); return feuilles.slice(0, i).some((g) => nomFeuille(g.nom) === n) ? `${n.slice(0, 28)} ${i + 1}` : n; });
  return zip([
    { nom: '[Content_Types].xml', contenu: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + feuilles.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '</Types>' },
    { nom: '_rels/.rels', contenu: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>' },
    { nom: 'xl/workbook.xml', contenu: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + `<sheets>${noms.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { nom: 'xl/_rels/workbook.xml.rels', contenu: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + feuilles.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${feuilles.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + '</Relationships>' },
    { nom: 'xl/styles.xml', contenu: STYLES },
    ...feuilles.map((f, i) => ({ nom: `xl/worksheets/sheet${i + 1}.xml`, contenu: feuilleXml(f) })),
  ]);
}
