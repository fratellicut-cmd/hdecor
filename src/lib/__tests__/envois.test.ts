import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { conclureEnvoi, reserverEnvoi } = await import('../envois');

/** Faux client : enregistre les appels, renvoie l'erreur demandée. */
function faux(erreur: { code: string } | null) {
  const appels: { op: string; valeurs: unknown; filtres: [string, unknown][] }[] = [];
  const sb = {
    from: () => ({
      insert: async (valeurs: unknown) => { appels.push({ op: 'insert', valeurs, filtres: [] }); return { error: erreur }; },
      update: (valeurs: unknown) => {
        const a = { op: 'update', valeurs, filtres: [] as [string, unknown][] };
        appels.push(a);
        const chaine = { eq: (k: string, v: unknown) => { a.filtres.push([k, v]); return a.filtres.length >= 2 ? Promise.resolve({ error: erreur }) : chaine; } };
        return chaine;
      },
    }),
  };
  return { sb: sb as never, appels };
}
const envoi = { id: 'e1', organisation_id: 'o', document_type: 'facture', document_id: 'f', nature: 'envoi', destinataire: 'a@test' };

describe('envoi réservé avant l’email', () => {
  it('réservé « en cours », canal email', async () => {
    const { sb, appels } = faux(null);
    expect(await reserverEnvoi(sb, envoi)).toBe('reserve');
    expect(appels[0]!.valeurs).toMatchObject({ statut: 'en_cours', canal: 'email', id: 'e1' });
  });
  it('déjà réservé (clé ou index unique) -> rien à envoyer', async () => {
    expect(await reserverEnvoi(faux({ code: '23505' }).sb, envoi)).toBe('deja');
  });
  it('autre erreur -> échec, rien à envoyer', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await reserverEnvoi(faux({ code: '42501' }).sb, envoi)).toBe('echec');
  });
  it('conclusion : seulement un envoi encore « en cours »', async () => {
    const { sb, appels } = faux(null);
    await conclureEnvoi(sb, 'e1', { ok: true, id: 'resend-1' });
    expect(appels[0]!.valeurs).toEqual({ statut: 'envoye', fournisseur_id: 'resend-1', erreur: null });
    expect(appels[0]!.filtres).toEqual([['id', 'e1'], ['statut', 'en_cours']]);
    const echec = faux(null);
    await conclureEnvoi(echec.sb, 'e1', { ok: false, nonConfigure: false, erreur: 'Refus' });
    expect(echec.appels[0]!.valeurs).toEqual({ statut: 'echec', fournisseur_id: null, erreur: 'Refus' });
  });
});
