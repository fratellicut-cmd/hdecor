import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { centimesDecimal, classeurXlsx, colonne, date, entier, montant, serieExcel, texte } from '../xlsx';

/** Relit le classeur avec openpyxl (bibliothèque indépendante) : valeurs, formats, noms de feuilles. */
function relire(octets: Uint8Array): { feuilles: string[]; cellules: Record<string, [string, string, string][]> } {
  const dossier = mkdtempSync(path.join(tmpdir(), 'hdecor-xlsx-'));
  const f = path.join(dossier, 'c.xlsx');
  writeFileSync(f, octets);
  const script = [
    'import json, sys, openpyxl',
    'wb = openpyxl.load_workbook(sys.argv[1])',
    'out = {"feuilles": wb.sheetnames, "cellules": {}}',
    'for ws in wb.worksheets:',
    '  out["cellules"][ws.title] = [[c.coordinate, repr(c.value), c.number_format] for row in ws.iter_rows() for c in row if c.value is not None]',
    'print(json.dumps(out))',
  ].join('\n');
  return JSON.parse(execFileSync('python3', ['-I', '-c', script, f], { encoding: 'utf8' }));
}

describe('classeur Excel', () => {
  it('colonnes, montants exacts, dates', () => {
    expect([colonne(0), colonne(25), colonne(26), colonne(701)]).toEqual(['A', 'Z', 'AA', 'ZZ']);
    expect([centimesDecimal(123_405n), centimesDecimal(-5), centimesDecimal(0n)]).toEqual(['1234.05', '-0.05', '0.00']);
    expect(serieExcel('2026-10-09')).toBe(46304);
    expect(serieExcel('1900-03-01')).toBe(61);
  });

  it('relu par openpyxl : feuilles, en-têtes, texte, montants en euros, dates, entiers', () => {
    const octets = classeurXlsx([
      { nom: 'Recettes 10/2026', entetes: ['Date', 'Client', 'Montant', 'Minutes'], lignes: [
        [date('2026-10-09'), texte('Martin & fils <test>'), montant(123_405n), entier(90)],
        [date('2026-10-10'), texte('=1+1'), montant(-5), entier(null)],
      ] },
      { nom: 'Achats', entetes: ['Fournisseur'], lignes: [[texte('Peintures Est, « é »')]] },
    ]);
    const r = relire(octets);
    expect(r.feuilles).toEqual(['Recettes 10 2026', 'Achats']);
    const c = Object.fromEntries(r.cellules['Recettes 10 2026']!.map(([ref, v, fmt]) => [ref, [v, fmt]]));
    expect(c.A1![0]).toBe("'Date'");
    expect(c.A2).toEqual(['datetime.datetime(2026, 10, 9, 0, 0)', 'dd/mm/yyyy']);
    expect(c.B2![0]).toBe("'Martin & fils <test>'");
    expect(c.C2![0]).toBe('1234.05');
    expect(c.C2![1]).toContain('€');
    expect(c.D2![0]).toBe('90');
    expect(c.B3![0]).toBe("'=1+1'");   // texte, jamais une formule
    expect(c.C3![0]).toBe('-0.05');
    expect(c.D3).toBeUndefined();
    expect(r.cellules.Achats![1]![1]).toBe("'Peintures Est, « é »'");
  });

  it('noms de feuille en double rendus distincts ; classeur vide refusé', () => {
    const r = relire(classeurXlsx([{ nom: 'A', entetes: ['x'], lignes: [] }, { nom: 'A', entetes: ['x'], lignes: [] }]));
    expect(r.feuilles).toEqual(['A', 'A 2']);
    expect(() => classeurXlsx([])).toThrow();
  });
});
