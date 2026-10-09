import { timingSafeEqual } from 'node:crypto';
import { clientAdmin } from '@/lib/supabase/admin';
import { emailConfigure, envoyerEmail } from '@/lib/email';
import { expirationLien, nouveauJeton, urlPublique } from '@/lib/liens';
import { remplirModele } from '@/domain/devis';
import { formaterDate } from '@/domain/formats';

/**
 * Tâche planifiée quotidienne (vercel.json) : relance automatique des devis
 * envoyés et sans réponse (délai et activation dans les Paramètres ; une seule
 * relance par devis, voir devis_a_relancer). Chaque relance porte un NOUVEAU
 * lien de signature (seule l'empreinte des liens est stockée). Sans service
 * d'email configuré, rien n'est envoyé ni enregistré.
 * Protégée par CRON_SECRET (en-tête « Authorization: Bearer … »).
 */
export const dynamic = 'force-dynamic';

function autorise(requete: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return false;
  const attendu = Buffer.from(`Bearer ${secret}`);
  const recu = Buffer.from(requete.headers.get('authorization') ?? '');
  return recu.length === attendu.length && timingSafeEqual(recu, attendu);
}

export async function GET(requete: Request) {
  if (!autorise(requete)) return new Response('Non autorisé.', { status: 401 });
  if (!emailConfigure()) return Response.json({ ok: true, relances: 0, raison: 'email non configuré' });

  const admin = clientAdmin();
  const { data: aRelancer, error } = await admin.rpc('devis_a_relancer');
  if (error) {
    console.error('Relances : lecture impossible', error.code);
    return Response.json({ ok: false }, { status: 500 });
  }
  let envoyees = 0;
  let echecs = 0;
  for (const d of aRelancer ?? []) {
    const { data: modele } = await admin.from('modeles_messages').select('sujet, corps, actif')
      .eq('organisation_id', d.organisation_id).eq('code', 'relance_devis').maybeSingle();
    if (!modele?.actif) continue;
    const expire = expirationLien(d.valide_jusqu_au);
    if (!expire) continue;
    const { jeton, sha256 } = nouveauJeton();
    const { error: eLien } = await admin.from('liens_publics').insert({
      organisation_id: d.organisation_id, devis_id: d.devis_id, finalite: 'signature', jeton_sha256: sha256, expire_le: expire.toISOString(),
    });
    if (eLien) { echecs++; continue; }
    const valeurs = {
      client: d.client, entreprise: d.entreprise, numero: `${d.numero}${d.version > 1 ? ` (version ${d.version})` : ''}`,
      lien: urlPublique(jeton), valide_jusqu_au: formaterDate(d.valide_jusqu_au),
    };
    const r = await envoyerEmail({ a: d.email, sujet: remplirModele(modele.sujet, valeurs), texte: remplirModele(modele.corps, valeurs) });
    await admin.from('envois').insert({
      organisation_id: d.organisation_id, document_type: 'devis', document_id: d.devis_id, nature: 'relance_devis', canal: 'email',
      destinataire: d.email, fournisseur_id: r.ok ? r.id : null, statut: r.ok ? 'envoye' : 'echec', erreur: r.ok ? null : r.erreur,
    });
    if (r.ok) envoyees++; else echecs++;
  }
  return Response.json({ ok: echecs === 0, relances: envoyees, echecs });
}
