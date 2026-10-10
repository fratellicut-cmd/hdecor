import { describe, expect, it } from 'vitest';
import { dateLimiteLevee, engagementClient, etatReserves, lireReserves, texteDecision } from '../pv';

describe('PV de réception', () => {
  it('date limite de levée : réception + délai, changement de mois et d’année', () => {
    expect(dateLimiteLevee('2026-10-10', 15)).toBe('2026-10-25');
    expect(dateLimiteLevee('2026-12-20', 15)).toBe('2027-01-04');
    expect(dateLimiteLevee('2026-10-10', null)).toBeNull();
  });
  it('engagement du client en langage courant', () => {
    expect(engagementClient([], null)).toBe('En signant, vous confirmez que les travaux sont terminés et que vous les acceptez sans réserve.');
    expect(engagementClient([{ description: 'a' }, { description: 'b' }], '2026-10-25'))
      .toBe('En signant, vous acceptez les travaux, sauf les 2 points listés, que l’entreprise doit reprendre avant le 25/10/2026.');
    expect(engagementClient([{ description: 'a' }], null)).toBe('En signant, vous acceptez les travaux, sauf le point listé, que l’entreprise doit reprendre.');
  });
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
    expect(etatReserves([{ description: 'a', levee_le: '2026-10-09' }]).libelle).toBe('Toutes les réserves sont déclarées levées');
    expect(etatReserves([]).libelle).toBe('Sans réserve');
  });
});
