import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ clientAdmin: () => { throw new Error('pas de réseau dans les tests'); } }));

const { viderFileSuppression, TENTATIVES_MAX } = await import('../stockage-admin');
type ClientFile = Parameters<typeof viderFileSuppression>[1] & object;

function faux(lignes: { id: number; espace: string; chemin: string; tentatives: number }[], echecs: string[] = []) {
  const journal: string[] = [];
  const client: ClientFile = {
    lire: async () => ({ data: lignes, error: null }),
    supprimerFichier: async (espace, chemin) => {
      journal.push(`suppr ${espace}:${chemin}`);
      return { error: echecs.includes(chemin) ? { message: 'Storage indisponible' } : null };
    },
    retirer: async (id) => { journal.push(`retire ${id}`); return { error: null }; },
    noterEchec: async (id, t, e) => { journal.push(`echec ${id} ${t} ${e}`); return { error: null }; },
    compterAbandonnes: async () => ({ count: 0, error: null }),
  };
  return { client, journal };
}

describe('viderFileSuppression', () => {
  it('supprime chaque fichier dans SON espace, puis le retire de la file', async () => {
    const { client, journal } = faux([
      { id: 1, espace: 'documents', chemin: 'org/d1.pdf', tentatives: 0 },
      { id: 2, espace: 'photos', chemin: 'org/p1.jpg', tentatives: 2 },
    ]);
    expect(await viderFileSuppression({}, client)).toEqual({ supprimes: 2, enEchec: 0, abandonnes: 0 });
    expect(journal).toEqual(['suppr documents:org/d1.pdf', 'retire 1', 'suppr photos:org/p1.jpg', 'retire 2']);
  });

  it('en cas d’échec : la ligne reste, tentatives + 1 et erreur notée', async () => {
    const { client, journal } = faux([{ id: 3, espace: 'photos', chemin: 'org/x.jpg', tentatives: 4 }], ['org/x.jpg']);
    expect(await viderFileSuppression({}, client)).toEqual({ supprimes: 0, enEchec: 1, abandonnes: 0 });
    expect(journal).toEqual(['suppr photos:org/x.jpg', 'echec 3 5 Storage indisponible']);
  });

  it('lecture de la file impossible : erreur, rien n’est supprimé', async () => {
    const { client, journal } = faux([]);
    client.lire = async () => ({ data: null, error: { message: 'timeout' } });
    await expect(viderFileSuppression({}, client)).rejects.toThrow('timeout');
    expect(journal).toEqual([]);
  });

  it('retrait de la file impossible : erreur remontée (jamais silencieuse)', async () => {
    const { client } = faux([{ id: 5, espace: 'documents', chemin: 'org/a.pdf', tentatives: 0 }]);
    client.retirer = async () => ({ error: { message: 'refus' } });
    await expect(viderFileSuppression({}, client)).rejects.toThrow('refus');
  });

  it('signale les fichiers abandonnés après le nombre maximal de tentatives', async () => {
    const { client } = faux([]);
    client.compterAbandonnes = async () => ({ count: 2, error: null });
    const alerte = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await viderFileSuppression({}, client)).toEqual({ supprimes: 0, enEchec: 0, abandonnes: 2 });
    expect(alerte).toHaveBeenCalledWith(expect.stringContaining(`${TENTATIVES_MAX} tentatives`));
    alerte.mockRestore();
  });
});
