import { describe, expect, it } from 'vitest';
import { schemaElement, schemaOuverture, schemaPiece } from '../chantiers';

const messages = (r: { success: boolean; error?: { issues: { message: string }[] } }) => (r.error?.issues ?? []).map((i) => i.message);

describe('messages de saisie du métré (en français, avec l’action à faire)', () => {
  it('ouverture saisie en mètres par réflexe : unité rappelée, jamais « Invalid input »', () => {
    const m = messages(schemaOuverture.safeParse({ type: 'fenetre', largeur_mm: '1,2', hauteur_mm: '1,35', surface_directe_mm2: '', quantite: '1' }));
    expect(m).toContain('Largeur : trop petit (en centimètres, exemple : 83).');
    // 1,35 cm = 13,5 mm : plus précis que le millimètre.
    expect(m).toContain('Hauteur : nombre invalide ou plus précis que le millimètre (en centimètres, exemple : 83).');
    expect(m.join(' ')).not.toMatch(/Invalid/);
  });
  it('valeur illisible : message français', () => {
    const m = messages(schemaPiece.safeParse({ nom: 'Séjour', etage: '', mode_saisie: 'rectangle', longueur_mm: 'abc', largeur_mm: '3', murs: [],
      surface_sol_mm2: '', hauteur_mm: '2,5', multiplicateur: '1', etat_support: '', notes: '', teinte_id: '' }));
    expect(m).toContain('Longueur : nombre invalide ou plus précis que le millimètre (en mètres, exemple : 4,25).');
    expect(m.join(' ')).not.toMatch(/Invalid/);
  });
  it('hauteur sous plafond (obligatoire) absente : « obligatoire »', () => {
    const m = messages(schemaPiece.safeParse({ nom: 'Séjour', etage: '', mode_saisie: 'rectangle', longueur_mm: '4', largeur_mm: '3', murs: [],
      surface_sol_mm2: '', hauteur_mm: '', multiplicateur: '1', etat_support: '', notes: '', teinte_id: '' }));
    expect(m).toEqual(['Hauteur sous plafond : obligatoire (exemple : 4,25).']);
  });
  it('champ facultatif vide : accepté (null) ; ouverture en centimètres acceptée', () => {
    const r = schemaOuverture.safeParse({ type: 'porte', largeur_mm: '83', hauteur_mm: '204', surface_directe_mm2: '', quantite: '1' });
    expect(r.success && r.data).toMatchObject({ largeur_mm: 830, hauteur_mm: 2040, surface_directe_mm2: null });
    const s = schemaOuverture.safeParse({ type: 'autre', largeur_mm: '', hauteur_mm: '', surface_directe_mm2: '1,69', quantite: '1' });
    expect(s.success && s.data).toMatchObject({ largeur_mm: null, hauteur_mm: null });
  });
  it('surface illisible : message français', () => {
    const m = messages(schemaOuverture.safeParse({ type: 'autre', largeur_mm: '', hauteur_mm: '', surface_directe_mm2: 'abc', quantite: '1' }));
    expect(m).toContain('Surface : surface invalide (exemple : 1,69).');
    expect(m.join(' ')).not.toMatch(/Invalid/);
  });
  it('largeur développée « 0,1 » (mètres tapés par réflexe, soit 1 mm) : refusée avec l’unité ; 10 cm acceptés', () => {
    const el = (d: string) => schemaElement.safeParse({ type: 'plinthe', unite: 'ml', quantite_e4: '14', faces: '1', developpe_mm: d, surface_unitaire_mm2: '', notes: '' });
    expect(messages(el('0,1'))).toEqual(['Largeur développée : trop petit (en centimètres, exemple : 83).']);
    const ok = el('10');
    expect(ok.success && ok.data.developpe_mm).toBe(100);
  });
  it('pièce saisie en centimètres : « trop grand » rappelle l’unité', () => {
    const m = messages(schemaPiece.safeParse({ nom: 'Séjour', etage: '', mode_saisie: 'rectangle', longueur_mm: '425', largeur_mm: '3', murs: [],
      surface_sol_mm2: '', hauteur_mm: '2,5', multiplicateur: '1', etat_support: '', notes: '', teinte_id: '' }));
    expect(m).toEqual(['Longueur : trop grand, vérifiez l’unité (en mètres, exemple : 4,25).']);
  });
});
