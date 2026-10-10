import { timingSafeEqual } from 'node:crypto';
import { clientAdmin } from '@/lib/supabase/admin';
import { emailConfigure, envoyerEmail } from '@/lib/email';
import { envPublique } from '@/lib/env';

/**
 * Tâche planifiée : rappels échus -> notifications (une par rappel, jamais
 * deux fois), puis, pour les entreprises qui l'ont choisi (Réglages >
 * Notifications), un email récapitulatif des notifications non encore
 * envoyées des dernières 48 h, à l'adresse de l'entreprise.
 * Fréquence : vercel.json (une fois par jour sur l'offre gratuite ; plus
 * souvent sur une offre payante ou par un service externe, voir
 * docs/MISE_EN_PRODUCTION.md). Protégée par CRON_SECRET.
 */
export const dynamic = 'force-dynamic';

const FENETRE_MS = 48 * 3600_000;

function autorise(requete: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return false;
  const attendu = Buffer.from(`Bearer ${secret}`);
  const recu = Buffer.from(requete.headers.get('authorization') ?? '');
  return recu.length === attendu.length && timingSafeEqual(recu, attendu);
}

export async function GET(requete: Request) {
  if (!autorise(requete)) return new Response('Non autorisé.', { status: 401 });
  const admin = clientAdmin();
  const { data: rappels, error } = await admin.rpc('notifier_rappels_echus');
  if (error) {
    console.error('Notifications : rappels illisibles', error.code);
    return Response.json({ ok: false }, { status: 500 });
  }
  if (!emailConfigure()) return Response.json({ ok: true, rappels, emails: 0, raison: 'email non configuré' });

  const { data: abonnes, error: e2 } = await admin.from('parametres_entreprise').select('organisation_id, email').eq('notifier_par_email', true).not('email', 'is', null);
  if (e2) return Response.json({ ok: false }, { status: 500 });
  const depuis = new Date(Date.now() - FENETRE_MS).toISOString();
  const site = envPublique.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  let emails = 0;
  let echecs = 0;
  for (const a of abonnes) {
    const { data: liste } = await admin.from('notifications').select('id, titre, lien')
      .eq('organisation_id', a.organisation_id).is('emailee_le', null).gte('cree_le', depuis).order('cree_le').limit(50);
    if (!liste?.length) continue;
    const texte = ['Bonjour,', '', 'Du nouveau dans H’DECOR :', '', ...liste.map((n) => `- ${n.titre} : ${site}${n.lien}`), '',
      'Vous recevez ce message parce que les notifications par email sont activées (Réglages > Notifications).'].join('\n');
    const r = await envoyerEmail({ a: a.email!, sujet: `H’DECOR : ${liste.length} notification${liste.length > 1 ? 's' : ''}`, texte });
    if (!r.ok) { echecs += 1; continue; }
    const { error: e3 } = await admin.from('notifications').update({ emailee_le: new Date().toISOString() }).in('id', liste.map((n) => n.id));
    if (e3) console.error('Notifications envoyées mais non marquées', e3.code);
    emails += 1;
  }
  return Response.json({ ok: echecs === 0, rappels, emails, echecs });
}
