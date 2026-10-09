import { describe, expect, it } from 'vitest';
import { schemaClient, schemaFiltresClients } from '../validation/clients';

const saisie = (o: Record<string, string>) => ({
  type: 'particulier', civilite: '', nom: 'Müller', prenom: 'Hélène', raison_sociale: '', siret: '', tva_intra: '',
  email: '', telephone: '', fact_ligne1: '', fact_ligne2: '', fact_code_postal: '', fact_ville: '', notes: '', source: '', ...o,
});

describe('schemaClient', () => {
  it('particulier minimal : vides -> null', () => {
    const c = schemaClient.parse(saisie({}));
    expect(c).toMatchObject({ type: 'particulier', nom: 'Müller', prenom: 'Hélène', email: null, civilite: null });
  });
  it('nom obligatoire', () => {
    const r = schemaClient.safeParse(saisie({ nom: '   ' }));
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['nom']);
  });
  it('professionnel sans raison sociale refusé', () => {
    const r = schemaClient.safeParse(saisie({ type: 'professionnel' }));
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['raison_sociale']);
  });
  it('professionnel : SIRET normalisé, TVA en majuscules', () => {
    const c = schemaClient.parse(saisie({ type: 'professionnel', raison_sociale: 'SCI Les Lilas', siret: '732 829 320 00074', tva_intra: 'fr 44 732829320' }));
    expect(c.siret).toBe('73282932000074');
    expect(c.tva_intra).toBe('FR44732829320');
  });
  it('particulier : les champs professionnels masqués ne sont pas enregistrés', () => {
    const c = schemaClient.parse(saisie({ raison_sociale: 'Reste', siret: '73282932000074' }));
    expect(c.raison_sociale).toBeNull();
    expect(c.siret).toBeNull();
  });
  it.each([
    ['email', 'pas-un-email'], ['telephone', '12'], ['fact_code_postal', '5700'], ['siret', '12345678901234'], ['civilite', 'Dr'],
  ])('%s invalide refusé', (champ, valeur) => {
    const r = schemaClient.safeParse(saisie({ type: 'professionnel', raison_sociale: 'X', [champ]: valeur }));
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual([champ]);
  });
  it('type inconnu refusé', () => {
    expect(schemaClient.safeParse(saisie({ type: 'revendeur' })).success).toBe(false);
  });
});

describe('schemaFiltresClients', () => {
  it('valeurs par défaut', () => {
    expect(schemaFiltresClients.parse({})).toEqual({ q: '', type: undefined, anonymises: false, page: 1 });
  });
  it('filtres valides', () => {
    expect(schemaFiltresClients.parse({ q: 'mül', type: 'professionnel', anonymises: '1', page: '3' }))
      .toEqual({ q: 'mül', type: 'professionnel', anonymises: true, page: 3 });
  });
  it('valeurs farfelues ramenées à un état sûr', () => {
    expect(schemaFiltresClients.parse({ q: ['a', 'b'], type: 'x', page: '-4' }))
      .toEqual({ q: '', type: undefined, anonymises: false, page: 1 });
    expect(schemaFiltresClients.parse({ q: 'a'.repeat(500) }).q).toHaveLength(100);
  });
});
