/** Date du jour à Paris, au format AAAA-MM-JJ (jamais la date UTC du serveur). */
export function aujourdHuiParis(instant: Date = new Date()): string {
  const p = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(instant);
  const v = (t: string) => p.find((x) => x.type === t)!.value;
  return `${v('year')}-${v('month')}-${v('day')}`;
}

/** Décalage de Paris (minutes) à un instant donné : +60 en hiver, +120 en été. */
function decalageParis(instant: Date): number {
  const nom = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', timeZoneName: 'longOffset' })
    .formatToParts(instant).find((p) => p.type === 'timeZoneName')!.value; // « GMT+02:00 »
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(nom);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** Dernière seconde du jour AAAA-MM-JJ à Paris (23:59:59, heure d'été comprise), en instant UTC. */
export function finDeJourParis(dateIso: string): Date {
  const [a, m, j] = dateIso.split('-').map(Number);
  const utc = Date.UTC(a!, m! - 1, j!, 23, 59, 59);
  return new Date(utc - decalageParis(new Date(utc)) * 60_000);
}

/**
 * Instant UTC d'une heure locale de Paris (« 2026-10-09 », « 07:30 »). Le
 * décalage est celui de cette heure locale (heure d'été comprise) ; une heure
 * qui n'existe pas (passage à l'heure d'été) est décalée d'une heure.
 */
export function instantParis(dateIso: string, heure: string): Date {
  const [a, m, j] = dateIso.split('-').map(Number);
  const [h, min] = heure.split(':').map(Number);
  const utc = Date.UTC(a!, m! - 1, j!, h!, min!);
  const essai = utc - decalageParis(new Date(utc)) * 60_000;
  return new Date(utc - decalageParis(new Date(essai)) * 60_000);
}

/** Heure locale de Paris « HH:MM » d'un instant. */
export function heureParis(instant: Date): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant);
}
