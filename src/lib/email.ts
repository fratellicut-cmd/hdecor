import 'server-only';

/**
 * Envoi d'emails par Resend (API HTTP). Clé et expéditeur en variables
 * d'environnement SERVEUR (RESEND_API_KEY, EMAIL_EXPEDITEUR) : jamais dans le
 * code. Sans configuration, rien n'est envoyé et l'appelant le dit (partage
 * du lien à la main) : aucun envoi n'est simulé.
 */
export type ResultatEmail = { ok: true; id: string | null } | { ok: false; nonConfigure: boolean; erreur: string };

export function emailConfigure(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.EMAIL_EXPEDITEUR;
}

export async function envoyerEmail(m: { a: string; sujet: string; texte: string; repondreA?: string | null }): Promise<ResultatEmail> {
  const cle = process.env.RESEND_API_KEY;
  const expediteur = process.env.EMAIL_EXPEDITEUR;
  if (!cle || !expediteur) return { ok: false, nonConfigure: true, erreur: 'Envoi d’emails non configuré.' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${cle}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: expediteur, to: [m.a], subject: m.sujet, text: m.texte, ...(m.repondreA ? { reply_to: m.repondreA } : {}) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return { ok: false, nonConfigure: false, erreur: `Refus du service d’email (${r.status}).` };
    const corps = await r.json().catch(() => ({})) as { id?: unknown };
    return { ok: true, id: typeof corps.id === 'string' ? corps.id : null };
  } catch {
    return { ok: false, nonConfigure: false, erreur: 'Service d’email injoignable.' };
  }
}
