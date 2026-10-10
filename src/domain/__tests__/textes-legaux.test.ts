import { describe, expect, it } from 'vitest';
import { CODES_TEXTES, lireTexte, TEXTES, texteLegal, textesAValider, textesEffectifs } from '../textes-legaux';
import { controlerCumulAcompte, cumulAcomptesEmis } from '../factures';

describe('textes légaux modifiables', () => {
  it('texte par défaut, repères remplacés', () => {
    expect(texteLegal('retractation', {}, { contact: 'H’DECOR, 1 rue X' })).toContain('à : H’DECOR, 1 rue X.');
    expect(texteLegal('mediateur', undefined, { mediateur: 'Médiateur X, www.x.fr' })).toMatch(/^Médiateur de la consommation : Médiateur X, www\.x\.fr\./);
    expect(texteLegal('rappel_reception', null)).toContain('[Références À VÉRIFIER]');
  });
  it('texte personnalisé prioritaire ; vide = texte par défaut', () => {
    expect(texteLegal('devis_recu', { devis_recu: 'Devis reçu le jour de la visite.' })).toBe('Devis reçu le jour de la visite.');
    expect(texteLegal('devis_recu', { devis_recu: '   ' })).toBe(TEXTES.devis_recu.defaut);
  });
  it('saisie : identique au défaut ou vide = non enregistrée ; repère obligatoire ; contrôle des caractères', () => {
    expect(lireTexte('devis_recu', TEXTES.devis_recu.defaut)).toEqual({ texte: null });
    expect(lireTexte('devis_recu', '  ')).toEqual({ texte: null });
    expect(lireTexte('retractation', 'Vous pouvez vous rétracter.')).toEqual({ erreur: 'Gardez {contact} : remplacé à l’impression.' });
    expect(lireTexte('retractation', 'Écrivez à {contact}.\r\nMerci.')).toEqual({ texte: 'Écrivez à {contact}.\nMerci.' });
    expect(lireTexte('devis_recu', 'a\u0007b')).toEqual({ erreur: 'Caractère non autorisé.' });
    expect('erreur' in lireTexte('devis_recu', 'x'.repeat(3001))).toBe(true);
  });
  it('textes effectifs figés dans le document : tous les codes, personnalisés ou par défaut ; textes courts bornés', () => {
    const t = textesEffectifs({ devis_recu: 'Reçu.' });
    expect(Object.keys(t).sort()).toEqual([...CODES_TEXTES].sort());
    expect(t.devis_recu).toBe('Reçu.');
    expect(t.mediateur).toBe(TEXTES.mediateur.defaut);
    expect(lireTexte('devis_recu', 'x'.repeat(301))).toEqual({ erreur: '300 caractères au maximum.' });
  });
  it('tous les textes sont à faire valider tant qu’aucune date n’est saisie', () => {
    expect(textesAValider(null)).toHaveLength(CODES_TEXTES.length);
    expect(textesAValider('2026-10-10')).toEqual([]);
  });
});

describe('cumul des acomptes à l’émission', () => {
  const f = (id: string, statut: string, pct: number) => ({ id, type: 'acompte' as const, statut, acomptePctBp: pct });
  it('cumul des seuls acomptes émis, hors la facture émise', () => {
    expect(cumulAcomptesEmis([f('a', 'emise', 3000), f('b', 'brouillon', 2000), f('c', 'annulee', 1000), f('d', 'emise', 500)], 'd')).toBe(3000);
  });
  it('écart : acompte précédent supprimé ou non émis, ou émis depuis', () => {
    expect(controlerCumulAcompte(null, 3000)).toBeNull();
    expect(controlerCumulAcompte(3000, 3000)).toBeNull();
    expect(controlerCumulAcompte(3000, 0)).toMatch(/Émettez d’abord l’acompte précédent/);
    expect(controlerCumulAcompte(0, 3000)).toMatch(/recréez-le pour un montant exact/);
  });
});
