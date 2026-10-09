import { describe, expect, it } from 'vitest';
import { controlerDelaisRelances, schemaModeleMessage } from '../validation/messages';

describe('délais des rappels d’impayés', () => {
  it('croissants : acceptés', () => expect(controlerDelaisRelances({ impaye_1: 7, impaye_2: 15, impaye_3: 30 })).toBeNull());
  it('2e rappel pas après le 1er : refusé', () => expect(controlerDelaisRelances({ impaye_1: 15, impaye_2: 15, impaye_3: 30 })).toMatch(/2e rappel/));
  it('dernier rappel avant le 2e : refusé', () => expect(controlerDelaisRelances({ impaye_1: 7, impaye_2: 30, impaye_3: 20 })).toMatch(/dernier rappel/));
  it('niveau absent : non contrôlé', () => expect(controlerDelaisRelances({ impaye_1: 7, impaye_3: 30 })).toBeNull());
});

describe('modèle de message', () => {
  const s = schemaModeleMessage('impaye_1');
  const ok = { sujet: 'Rappel {numero}', corps: 'Bonjour {client}, {lien}', delai_jours: '7', actif: 'on' };
  it('valide : champs connus, lien présent', () => expect(s.safeParse(ok).success).toBe(true));
  it('champ inconnu refusé', () => expect(s.safeParse({ ...ok, sujet: 'Rappel {inconnu}' }).success).toBe(false));
  it('sans {lien} refusé', () => expect(s.safeParse({ ...ok, corps: 'Bonjour' }).success).toBe(false));
  it('envoi de facture sans délai ni case « actif » (champs absents du formulaire) : accepté', () => {
    expect(schemaModeleMessage('envoi_facture').safeParse({ sujet: 'Facture {numero}', corps: '{lien}' }).success).toBe(true);
  });
  it('devis : pas de délai lu (réglé dans Conditions)', () => {
    const r = schemaModeleMessage('envoi_devis').safeParse({ sujet: 'Devis {numero}', corps: '{lien}', delai_jours: '3' });
    expect(r.success).toBe(true);
    expect(r.success && r.data.delai_jours).toBeUndefined();
  });
});
