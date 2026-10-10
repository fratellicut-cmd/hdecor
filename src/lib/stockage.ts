import 'server-only';
import { clientAdmin } from '@/lib/supabase/admin';

/**
 * Dépôt et lecture des documents (PDF émis, signatures) par le SERVEUR, après
 * ses propres contrôles d'accès (session et organisation, ou jeton de lien
 * public). Espaces privés ; chemin toujours préfixé par l'organisation.
 */
export type Espace = 'documents' | 'signatures' | 'justificatifs' | 'photos';

const CHEMIN = /^[0-9a-f-]{36}\/[a-z0-9\-/.]+$/;

function verifierChemin(organisationId: string, chemin: string) {
  if (!CHEMIN.test(chemin) || !chemin.startsWith(`${organisationId}/`) || chemin.includes('..')) {
    throw new Error('Chemin de document invalide.');
  }
}

/** Dépose un fichier. Sans `ecraser`, un fichier existant n'est jamais remplacé (document émis). */
export async function deposer(espace: Espace, organisationId: string, chemin: string, octets: Uint8Array, type: string, ecraser = false) {
  verifierChemin(organisationId, chemin);
  const { error } = await clientAdmin().storage.from(espace).upload(chemin, octets, { contentType: type, upsert: ecraser });
  if (error) throw new Error(`Dépôt impossible (${espace}) : ${error.message}`);
}

/** Lit un fichier ; null s'il n'existe pas. */
export async function lire(espace: Espace, organisationId: string, chemin: string): Promise<Uint8Array | null> {
  verifierChemin(organisationId, chemin);
  const { data, error } = await clientAdmin().storage.from(espace).download(chemin);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Retire un fichier qui vient d'être déposé et n'est référencé nulle part
 * (émission ou signature refusée juste après le dépôt). Jamais un document émis.
 */
export async function retirer(espace: Espace, organisationId: string, chemin: string) {
  verifierChemin(organisationId, chemin);
  const { error } = await clientAdmin().storage.from(espace).remove([chemin]);
  if (error) throw new Error(`Retrait impossible (${espace}) : ${error.message}`);
}

/**
 * Fichier qui n'est plus référencé (justificatif remplacé, achat supprimé) :
 * retiré tout de suite ; en cas d'échec, mis en file de suppression (la tâche
 * planifiée le reprend ; la file refuse tout document protégé).
 */
export async function oublier(espace: 'justificatifs' | 'photos', organisationId: string, chemin: string) {
  verifierChemin(organisationId, chemin);
  const admin = clientAdmin();
  const { error } = await admin.storage.from(espace).remove([chemin]);
  if (!error) return;
  console.error('Fichier non retiré, mis en file', error.message);
  const { error: e2 } = await admin.from('fichiers_a_supprimer').insert({ organisation_id: organisationId, espace, chemin });
  if (e2) console.error('Fichier orphelin (file refusée)', e2.code);
}
