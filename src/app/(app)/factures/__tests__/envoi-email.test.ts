import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Envoi et relance d'une facture par email, action serveur réelle, base simulée :
 * une seule réservation de l'envoi (clé primaire), un seul email, et les liens
 * de consultation désactivés seulement après un email parti.
 */

type Op = { table: string; op: string; valeurs: unknown; filtres: [string, string, unknown][]; unique: boolean };

const etat = vi.hoisted(() => {
  // Variables publiques exigées à l'import (valeurs factices, aucun appel réseau : la base et l'email sont simulés).
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:1';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'cle-factice-pour-les-tests-unitaires';
  process.env.NEXT_PUBLIC_SITE_URL ??= 'https://exemple.test';
  return { ops: [] as unknown[], envoisReserves: new Set<string>(), liens: 0, emailOk: true, emails: 0 };
});

function fauxSb() {
  const resoudre = (o: Op) => {
    etat.ops.push(o);
    if (o.table === 'envois' && o.op === 'insert') {
      const id = (o.valeurs as { id: string }).id;
      if (etat.envoisReserves.has(id)) return { data: null, error: { code: '23505' } };
      etat.envoisReserves.add(id);
      return { data: null, error: null };
    }
    if (o.table === 'envois' && o.op === 'select') return { data: o.unique ? null : [], error: null };
    if (o.table === 'liens_publics' && o.op === 'insert') return { data: { id: `lien-${++etat.liens}` }, error: null };
    if (o.table === 'modeles_messages') {
      const m = (code: string) => ({ code, sujet: 'Facture {numero}', corps: 'Bonjour, voici le lien : {lien}', delai_jours: 0 });
      return { data: o.unique ? m('envoi_facture') : ['impaye_1', 'impaye_2', 'impaye_3'].map(m), error: null };
    }
    if (o.table === 'parametres_entreprise') return { data: { raison_sociale: 'Entreprise test', email: 'pro@test' }, error: null };
    if (o.table === 'v_factures') {
      return { data: { id: 'f1', numero: 'FAC-2026-0001', type: 'facture', statut: 'emise', date_echeance: '2020-01-01', reste_a_payer_cents: 10000,
        copie_client: { nom_affiche: 'Mme Test' }, client_id: 'c1' }, error: null };
    }
    if (o.table === 'clients') return { data: { email: 'client@test', anonymise_le: null }, error: null };
    return { data: null, error: null };
  };
  const table = (nom: string) => {
    const o: Op = { table: nom, op: 'select', valeurs: null, filtres: [], unique: false };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (v: unknown) => { o.op = 'insert'; o.valeurs = v; return b; },
      update: (v: unknown) => { o.op = 'update'; o.valeurs = v; return b; },
      upsert: (v: unknown) => { o.op = 'upsert'; o.valeurs = v; return b; },
      maybeSingle: () => { o.unique = true; return Promise.resolve(resoudre(o)); },
      single: () => { o.unique = true; return Promise.resolve(resoudre(o)); },
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(resoudre(o)).then(ok, ko),
    };
    for (const f of ['eq', 'neq', 'is', 'in', 'gt', 'lt', 'gte', 'lte', 'order', 'limit']) {
      b[f] = (k: string, v: unknown) => { o.filtres.push([f, k, v]); return b; };
    }
    return b;
  };
  return { from: table, rpc: async () => ({ error: null }) };
}

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('redirect'); } }));
vi.mock('@/lib/dal', () => ({ verifierSession: async () => ({ organisationId: 'org', userId: 'u' }) }));
vi.mock('@/lib/supabase/serveur', () => ({ clientServeur: async () => fauxSb() }));
vi.mock('@/lib/email', () => ({
  emailConfigure: () => true,
  envoyerEmail: async () => {
    etat.emails += 1;
    return etat.emailOk ? { ok: true, id: 'resend-1' } : { ok: false, nonConfigure: false, erreur: 'Adresse refusée par le fournisseur.' };
  },
}));
vi.mock('@/lib/liens', async (orig) => ({ ...(await orig<typeof import('@/lib/liens')>()), urlPublique: (j: string) => `https://exemple.test/f/${j}` }));
vi.mock('@/lib/factures', async (orig) => ({
  ...(await orig<typeof import('@/lib/factures')>()),
  chargerFacture: async () => ({
    facture: { id: 'f1', statut: 'emise', numero: 'FAC-2026-0001', date_echeance: '2026-11-01', copie_client: { nom_affiche: 'Mme Test' },
      reste_a_payer_cents: 10000, net_a_payer_cents: 10000 },
    client: { email: 'client@test' },
  }),
}));

const { envoyerFacture, relancerFacture } = await import('../actions');

const formulaire = (champs: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(champs)) fd.set(k, v);
  return fd;
};
const ID = '11111111-1111-4111-8111-111111111111';
const ENVOI = '22222222-2222-4222-8222-222222222222';
const ops = () => etat.ops as Op[];
const majLiens = () => ops().filter((o) => o.table === 'liens_publics' && o.op === 'update');

beforeEach(() => {
  etat.ops = []; etat.envoisReserves.clear(); etat.liens = 0; etat.emailOk = true; etat.emails = 0;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('envoi d’une facture par email', () => {
  it('réussi : une seule réservation, un email, puis seuls les ANCIENS liens sont désactivés', async () => {
    const r = await envoyerFacture({}, formulaire({ id: ID, id_nouveau: ENVOI, canal: 'email' }));
    expect(r.succes).toBe('Email envoyé à client@test.');
    expect(ops().filter((o) => o.table === 'envois' && o.op === 'insert')).toHaveLength(1);
    expect(etat.emails).toBe(1);
    expect(majLiens()).toHaveLength(1);
    expect(majLiens()[0]!.filtres).toContainEqual(['neq', 'id', 'lien-1']);
  });

  it('échoué : aucun lien désactivé, le lien proposé au partage reste valable', async () => {
    etat.emailOk = false;
    const r = await envoyerFacture({}, formulaire({ id: ID, id_nouveau: ENVOI, canal: 'email' }));
    expect(r.message).toBe('Adresse refusée par le fournisseur. Partagez le lien à la main.');
    expect(r.lien).toMatch(/^https:\/\/exemple\.test\/f\//);
    expect(etat.emails).toBe(1);
    expect(majLiens()).toEqual([]);
  });
});

describe('relance d’une facture par email', () => {
  it('échouée : message à partager, noté comme rappel partagé (niveau et lien transmis), aucun lien désactivé', async () => {
    etat.emailOk = false;
    const r = await relancerFacture({}, formulaire({ id: ID, id_nouveau: ENVOI, canal: 'email' }));
    expect(r.message).toBe('Adresse refusée par le fournisseur. Partagez le message à la main.');
    expect(r).toMatchObject({ niveau: 'impaye_1', lienId: 'lien-1' });
    expect(r.texte).toContain(r.lien!);
    expect(majLiens()).toEqual([]);
    expect(ops().filter((o) => o.table === 'envois' && o.op === 'insert')).toHaveLength(1);
  });

  it('réussie : seuls les anciens liens sont désactivés', async () => {
    const r = await relancerFacture({}, formulaire({ id: ID, id_nouveau: ENVOI, canal: 'email' }));
    expect(r.succes).toBe('Rappel 1 envoyé par email à client@test.');
    expect(majLiens()).toHaveLength(1);
    expect(majLiens()[0]!.filtres).toContainEqual(['neq', 'id', 'lien-1']);
  });
});
