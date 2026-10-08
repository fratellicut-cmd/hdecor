/** Date du jour à Paris, au format AAAA-MM-JJ (jamais la date UTC du serveur). */
export function aujourdHuiParis(instant: Date = new Date()): string {
  const p = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(instant);
  const v = (t: string) => p.find((x) => x.type === t)!.value;
  return `${v('year')}-${v('month')}-${v('day')}`;
}
