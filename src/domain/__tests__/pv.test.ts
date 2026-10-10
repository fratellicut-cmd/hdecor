import { describe, expect, it } from 'vitest';
import { etatReserves, lireReserves, texteDecision } from '../pv';

describe('PV de réception', () => {
  it('réserves saisies une par ligne : puces et numéros retirés, lignes vides ignorées', () => {
    expect(lireReserves('- Reprendre l’angle du plafond\n\n2) Plinthe tachée \n• Trace sur la porte')).toEqual({
      reserves: [{ description: 'Reprendre l’angle du plafond' }, { description: 'Plinthe tachée' }, { description: 'Trace sur la porte' }],
    });
    expect(lireReserves('   \n')).toEqual({ reserves: [] });
  });
  it('bornes : 50 réserves, 500 caractères chacune', () => {
    expect(lireReserves(Array.from({ length: 51 }, (_, i) => `R${i}`).join('\n'))).toEqual({ erreur: '50 réserves au maximum.' });
    expect(lireReserves(`ok\n${'x'.repeat(501)}`)).toEqual({ erreur: 'Réserve 2 : 500 caractères au maximum.' });
  });
  it('décision et état des réserves', () => {
    expect(texteDecision([])).toBe('Le maître d’ouvrage déclare accepter les travaux SANS RÉSERVE.');
    expect(texteDecision([{ description: 'a' }, { description: 'b' }])).toContain('AVEC 2 RÉSERVES');
    expect(etatReserves([{ description: 'a', levee_le: '2026-10-09' }, { description: 'b' }]).libelle).toBe('1 réserve à lever sur 2');
    expect(etatReserves([{ description: 'a', levee_le: '2026-10-09' }]).libelle).toBe('Toutes les réserves sont levées');
    expect(etatReserves([]).libelle).toBe('Sans réserve');
  });
});
