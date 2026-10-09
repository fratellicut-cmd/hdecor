import { describe, expect, it } from 'vitest';
import { libelleAction, libelleTable, numeroDocument, resumeModification } from '../journal';

describe('journal d’audit : présentation', () => {
  it('libellés français, inconnu affiché tel quel', () => {
    expect(libelleAction('UPDATE')).toBe('Modification');
    expect(libelleTable('factures')).toBe('Facture');
    expect(libelleTable('table_future')).toBe('table_future');
  });
  it('numéro de document lu après puis avant', () => {
    expect(numeroDocument(null, { numero: 'FAC-2026-0001' })).toBe('FAC-2026-0001');
    expect(numeroDocument({ numero: 'DEV-2026-0003' }, null)).toBe('DEV-2026-0003');
    expect(numeroDocument({}, ['x'])).toBeNull();
  });
  it('changement de statut détaillé', () => {
    expect(resumeModification({ statut: 'envoye' }, { statut: 'accepte', accepte_le: '2026-10-08' }))
      .toBe('statut : envoye → accepte, accepte_le');
  });
  it('modification sans champ journalisé : signalée sans détail (données personnelles)', () => {
    expect(resumeModification({}, {})).toBe('Coordonnées ou textes (non détaillés : données personnelles)');
    expect(resumeModification({ id: 'x' }, { id: 'x', organisation_id: 'y' })).toBe('Coordonnées ou textes (non détaillés : données personnelles)');
  });
  it('entrée malformée : rien', () => {
    expect(resumeModification(null, null)).toBeNull();
    expect(resumeModification('x', 3)).toBeNull();
  });
});
