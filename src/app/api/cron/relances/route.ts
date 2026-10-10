import { timingSafeEqual } from 'node:crypto';
import { clientAdmin } from '@/lib/supabase/admin';
import { randomUUID } from 'node:crypto';
import { emailConfigure, envoyerEmail } from '@/lib/email';
import { conclureEnvoi, reserverEnvoi } from '@/lib/envois';
import { expirationLien, expirationLienFacture, nouveauJeton, urlPublique } from '@/lib/liens';
import { remplirModele } from '@/domain/devis';
import { formaterDate, formaterEuros } from '@/domain/formats';

/**
 * Tâche planifiée quotidienne (vercel.json) : relance automatique des devis
 * envoyés et sans réponse (délai et activation dans les Paramètres ; une seule
 * relance par devis, voir devis_a_relancer). Chaque relance porte un NOUVEAU
 * lien de signature (seule l'empreinte des liens est stockée). Sans service
 * d'email configuré, rien n'est envoyé ni enregistré.
 * Puis relance des factures impayées (3 niveaux, délais après l'échéance et
 * activation dans Réglages > Messages ; voir factures_a_relancer) : un niveau
 * par facture et par jour, chacun avec un nouveau lien de consultation.
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
    const [{ data: modele }, { data: p }] = await Promise.all([
      admin.from('modeles_messages').select('sujet, corps, actif').eq('organisation_id', d.organisation_id).eq('code', 'relance_devis').maybeSingle(),
      admin.from('parametres_entreprise').select('email').eq('organisation_id', d.organisation_id).maybeSingle(),
    ]);
    if (!modele?.actif) continue;
    const expire = expirationLien(d.valide_jusqu_au);
    if (!expire) continue;
    // Réservée AVANT le lien et l'email : un second passage simultané est refusé par la base (index unique).
    const envoiId = randomUUID();
    const reservation = await reserverEnvoi(admin, {
      id: envoiId, organisation_id: d.organisation_id, document_type: 'devis', document_id: d.devis_id, nature: 'relance_devis', destinataire: d.email,
    });
    if (reservation === 'deja') continue;
    if (reservation === 'echec') { echecs++; continue; }
    const { jeton, sha256 } = nouveauJeton();
    const { error: eLien } = await admin.from('liens_publics').insert({
      organisation_id: d.organisation_id, devis_id: d.devis_id, finalite: 'signature', jeton_sha256: sha256, expire_le: expire.toISOString(),
    });
    if (eLien) { await conclureEnvoi(admin, envoiId, { ok: false, nonConfigure: false, erreur: 'Lien non créé.' }); echecs++; continue; }
    const valeurs = {
      client: d.client, entreprise: d.entreprise, numero: `${d.numero}${d.version > 1 ? ` (version ${d.version})` : ''}`,
      lien: urlPublique(jeton), valide_jusqu_au: formaterDate(d.valide_jusqu_au),
    };
    // Les réponses du client vont à l'entreprise, pas à l'adresse d'expédition.
    const r = await envoyerEmail({ a: d.email, sujet: remplirModele(modele.sujet, valeurs), texte: remplirModele(modele.corps, valeurs), repondreA: p?.email });
    await conclureEnvoi(admin, envoiId, r);
    if (r.ok) envoyees++; else echecs++;
  }
  const impayes = await relancerImpayes(admin);
  return Response.json({ ok: echecs === 0 && impayes.ok, relances: envoyees, echecs, impayes: impayes.envoyees, echecs_impayes: impayes.echecs });
}

async function relancerImpayes(admin: ReturnType<typeof clientAdmin>): Promise<{ ok: boolean; envoyees: number; echecs: number }> {
  const { data: aRelancer, error } = await admin.rpc('factures_a_relancer');
  if (error) {
    console.error('Relances d’impayés : lecture impossible', error.code);
    return { ok: false, envoyees: 0, echecs: 0 };
  }
  let envoyees = 0;
  let echecs = 0;
  for (const f of aRelancer ?? []) {
    const [{ data: modele }, { data: p }] = await Promise.all([
      admin.from('modeles_messages').select('sujet, corps, actif').eq('organisation_id', f.organisation_id).eq('code', f.code).maybeSingle(),
      admin.from('parametres_entreprise').select('email').eq('organisation_id', f.organisation_id).maybeSingle(),
    ]);
    if (!modele?.actif) continue;
    const envoiId = randomUUID();
    const reservation = await reserverEnvoi(admin, {
      id: envoiId, organisation_id: f.organisation_id, document_type: 'facture', document_id: f.facture_id, nature: f.code, destinataire: f.email,
    });
    if (reservation === 'deja') continue;
    if (reservation === 'echec') { echecs++; continue; }
    const { jeton, sha256 } = nouveauJeton();
    const { data: lienCree, error: eLien } = await admin.from('liens_publics').insert({
      organisation_id: f.organisation_id, facture_id: f.facture_id, finalite: 'consultation', jeton_sha256: sha256,
      expire_le: expirationLienFacture(f.date_echeance).toISOString(),
    }).select('id').single();
    if (eLien || !lienCree) { await conclureEnvoi(admin, envoiId, { ok: false, nonConfigure: false, erreur: 'Lien non créé.' }); echecs++; continue; }
    const valeurs = {
      client: f.client, entreprise: f.entreprise, numero: f.numero, lien: urlPublique(jeton, 'f'),
      montant: formaterEuros(f.reste_cents), echeance: formaterDate(f.date_echeance),
    };
    const r = await envoyerEmail({ a: f.email, sujet: remplirModele(modele.sujet, valeurs), texte: remplirModele(modele.corps, valeurs), repondreA: p?.email });
    await conclureEnvoi(admin, envoiId, r);
    // Un seul lien valable à la fois : email parti -> les anciens liens sont désactivés ; email en échec -> seul le
    // nouveau lien (jamais transmis) l'est, et le client garde celui qu'il a déjà.
    const desactiver = admin.from('liens_publics').update({ revoque_le: new Date().toISOString() })
      .eq('facture_id', f.facture_id).eq('organisation_id', f.organisation_id).is('revoque_le', null);
    const { error: eLiens } = await (r.ok ? desactiver.neq('id', lienCree.id) : desactiver.eq('id', lienCree.id));
    if (eLiens) console.error('Relance : liens de la facture non mis à jour', f.facture_id, eLiens.code);
    if (r.ok) envoyees++; else echecs++;
  }
  return { ok: echecs === 0, envoyees, echecs };
}
