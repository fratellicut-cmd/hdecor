import { describe, expect, it } from 'vitest';
import {
  anPrecedent, blocsOuvres, chiffreAffaires, coutAchat, evolutionBp, fichierIcs, finChantier, jaugeSeuil, margeChantier, repartirHt,
  periodesTableauDeBord, premierJourOuvre, statistiquesDevis, tresoreriePrevisionnelle, type DevisResume, type Encaissement,
} from '../pilotage';

describe('périodes du tableau de bord', () => {
  it('mois, trimestre et année en cours, comparés à date égale un an plus tôt', () => {
    const p = periodesTableauDeBord('2026-10-09');
    expect(p.mois).toEqual({ courante: { du: '2026-10-01', au: '2026-10-09' }, precedente: { du: '2025-10-01', au: '2025-10-09' } });
    expect(p.trimestre.courante).toEqual({ du: '2026-10-01', au: '2026-10-09' });
    expect(periodesTableauDeBord('2026-05-20').trimestre.courante.du).toBe('2026-04-01');
    expect(p.annee.precedente).toEqual({ du: '2025-01-01', au: '2025-10-09' });
  });
  it('29 février -> 28 février de l’année précédente', () => expect(anPrecedent('2028-02-29')).toBe('2027-02-28'));
});

describe('chiffre d’affaires encaissé', () => {
  const franchise = (date: string, m: bigint): Encaissement => ({ date, montantCents: m, partHtCents: m });
  it('somme des encaissements de la période, remboursements déduits', () => {
    const e = [franchise('2026-10-01', 30_000n), franchise('2026-10-09', 70_000n), franchise('2026-10-10', 5_000n), franchise('2026-09-30', 1n),
      franchise('2026-10-05', -10_000n)];
    expect(chiffreAffaires(e, { du: '2026-10-01', au: '2026-10-09' })).toEqual({ ttcCents: 90_000n, htCents: 90_000n });
  });
  it('assujetti : part HT au prorata, répartie en cumulé (1 100 TTC dont 1 000 HT ; 550 encaissés -> 500 HT)', () => {
    expect(repartirHt([55_000n], 100_000n, 110_000n, 'assujetti')).toEqual([50_000n]);
    // 333,33 sur 1 200 TTC / 1 000 HT : 333,33 × 1000 / 1200 = 277,775 -> 277,78 ; annulation : exactement l'opposé.
    expect(repartirHt([33_333n, -33_333n], 100_000n, 120_000n, 'assujetti')).toEqual([27_778n, -27_778n]);
  });
  it('3 × 40 € sur 100 € HT / 120 € TTC : 33,33 + 33,34 + 33,33 = 100,00 € HT (pas de dérive d’arrondi)', () => {
    const parts = repartirHt([4_000n, 4_000n, 4_000n], 10_000n, 12_000n, 'assujetti');
    expect(parts).toEqual([3_333n, 3_334n, 3_333n]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(10_000n);
    // Sept paiements de 1/7 d'une facture mixte (1 000 HT dont TVA 20 % et 10 % : 1 150 TTC) : total HT exact.
    const sept = repartirHt([16_429n, 16_429n, 16_428n, 16_429n, 16_428n, 16_429n, 16_428n], 100_000n, 115_000n, 'assujetti');
    expect(sept.reduce((a, b) => a + b, 0n)).toBe(100_000n);
  });
  it('franchise : la part HT est l’encaissement lui-même', () => {
    expect(repartirHt([4_000n, -1_000n], 10_000n, 10_000n, 'franchise')).toEqual([4_000n, -1_000n]);
  });
  it('évolution : +12,5 % ; sans base, rien', () => {
    expect(evolutionBp(112_500n, 100_000n)).toBe(1_250);
    expect(evolutionBp(80_000n, 100_000n)).toBe(-2_000);
    expect(evolutionBp(1n, 0n)).toBeNull();
  });
});

describe('seuils de la micro-entreprise (valeurs de test, pas les seuils légaux)', () => {
  it('paliers 80 % et 95 %, dépassement, seuil non saisi', () => {
    expect(jaugeSeuil(7_999_999n, 10_000_000n, 8_000, 9_500)).toEqual({ niveau: 'ok', pourcentBp: 7_999, resteCents: 2_000_001n });
    expect(jaugeSeuil(8_000_000n, 10_000_000n, 8_000, 9_500).niveau).toBe('alerte');
    expect(jaugeSeuil(9_500_000n, 10_000_000n, 8_000, 9_500).niveau).toBe('critique');
    expect(jaugeSeuil(10_000_000n, 10_000_000n, 8_000, 9_500)).toEqual({ niveau: 'critique', pourcentBp: 10_000, resteCents: 0n });
    expect(jaugeSeuil(10_000_001n, 10_000_000n, 8_000, 9_500).niveau).toBe('depasse');
    expect(jaugeSeuil(5n, null, 8_000, 9_500)).toEqual({ niveau: 'non_renseigne', pourcentBp: null, resteCents: null });
  });
});

describe('statistiques des devis', () => {
  const d = (statut: DevisResume['statut'], dateEmission: string, autres: Partial<DevisResume> = {}): DevisResume => ({
    statut, dateEmission, valideJusquAu: '2026-12-31', accepteLe: null, totalTtcCents: 100_000n, ...autres,
  });
  it('en attente, taux de transformation et délai moyen de signature (12 derniers mois)', () => {
    const s = statistiquesDevis([
      d('envoye', '2026-10-01'), d('envoye', '2026-09-01', { totalTtcCents: 50_000n }),
      d('envoye', '2026-08-01', { valideJusquAu: '2026-08-31' }),                 // expiré : tranché, pas en attente
      d('accepte', '2026-09-01', { accepteLe: '2026-09-04' }),                    // 3 jours
      d('accepte', '2026-06-10', { accepteLe: '2026-06-20' }),                    // 10 jours
      d('refuse', '2026-07-01'),
      d('accepte', '2025-09-01', { accepteLe: '2025-09-02' }),                    // hors fenêtre
      d('brouillon', '2026-10-01'), d('remplace', '2026-05-01'),
    ], '2026-10-09');
    expect(s.enAttente).toEqual({ nombre: 2, montantCents: 150_000n });
    expect([s.tranches, s.acceptes]).toEqual([4, 2]);
    expect(s.tauxTransformationBp).toBe(5_000);
    expect(s.delaiMoyenSignatureDixiemes).toBe(65);   // (3 + 10) / 2 = 6,5 jours
  });
  it('aucun devis tranché : pas de taux', () => expect(statistiquesDevis([], '2026-10-09').tauxTransformationBp).toBeNull());
});

describe('trésorerie prévisionnelle', () => {
  it('factures à encaisser rangées par échéance ; devis signés à facturer', () => {
    const t = tresoreriePrevisionnelle([
      { resteCents: 10_000n, echeance: '2026-10-08' }, { resteCents: 20_000n, echeance: '2026-10-09' },
      { resteCents: 30_000n, echeance: '2026-11-08' }, { resteCents: 40_000n, echeance: '2026-11-09' },
      { resteCents: 50_000n, echeance: '2027-01-07' }, { resteCents: 60_000n, echeance: '2027-01-08' }, { resteCents: 0n, echeance: '2026-01-01' },
    ], [100_000n, 0n, -5n], '2026-10-09');
    expect(t.aEncaisser).toEqual({ en_retard: 10_000n, j30: 50_000n, j60: 40_000n, j90: 50_000n, plus_tard: 60_000n });
    expect(t.totalAEncaisserCents).toBe(210_000n);
    expect(t.aFacturerCents).toBe(100_000n);
  });
});

describe('marge par chantier', () => {
  it('facturé 2 000 HT, achats 450, 20 h passées pour 16 h prévues, taux 45 €/h', () => {
    const m = margeChantier({ factureHtCents: 200_000n, achatsCents: 45_000n, minutesReelles: 1_200, matierePrevueCents: 40_000n,
      minutesPrevues: 960, tauxHoraireCents: 4_500n });
    expect(m).toEqual({ margeBruteCents: 155_000n, tauxMargeBp: 7_750, ecartMatiereCents: 5_000n, ecartMinutes: 240,
      valeurTempsCents: 90_000n, resultatApresTempsCents: 65_000n });
  });
  it('rien facturé : pas de taux ; taux horaire inconnu : pas de valorisation', () => {
    const m = margeChantier({ factureHtCents: 0n, achatsCents: 1_000n, minutesReelles: 30, matierePrevueCents: 0n, minutesPrevues: 0, tauxHoraireCents: null });
    expect([m.margeBruteCents, m.tauxMargeBp, m.valeurTempsCents, m.resultatApresTempsCents]).toEqual([-1_000n, null, null, null]);
  });
  it('prévu inconnu ou partiel : aucun écart présenté (jamais un prévu à 0)', () => {
    const m = margeChantier({ factureHtCents: 100_000n, achatsCents: 18_640n, minutesReelles: 450, matierePrevueCents: null, minutesPrevues: null, tauxHoraireCents: null });
    expect([m.ecartMatiereCents, m.ecartMinutes, m.margeBruteCents]).toEqual([null, null, 81_360n]);
  });
  it('valorisation du temps arrondie au centime (7 min à 45 €/h = 5,25 €)', () => {
    expect(margeChantier({ factureHtCents: 0n, achatsCents: 0n, minutesReelles: 7, matierePrevueCents: 0n, minutesPrevues: 0, tauxHoraireCents: 4_500n })
      .valeurTempsCents).toBe(525n);
  });
  it('coût d’un achat : TTC en franchise, HT si assujetti', () => {
    expect(coutAchat({ htCents: 10_000n, ttcCents: 12_000n }, 'franchise')).toBe(12_000n);
    expect(coutAchat({ htCents: 10_000n, ttcCents: 12_000n }, 'assujetti')).toBe(10_000n);
  });
});

describe('planning : jours ouvrés', () => {
  it('début un samedi -> lundi ; 3 jours depuis jeudi -> mardi ; 0,5 jour -> le jour même', () => {
    expect(premierJourOuvre('2026-10-10')).toBe('2026-10-12');
    expect(finChantier('2026-10-08', 3)).toBe('2026-10-12');
    expect(finChantier('2026-10-08', 0.5)).toBe('2026-10-08');
    expect(finChantier('2026-10-08', 2.5)).toBe('2026-10-12');
    expect(finChantier('2026-10-10', 1)).toBe('2026-10-12');
    // Vendredi 09/10 -> mardi 13/10 : deux plages, rien le samedi ni le dimanche.
    expect(blocsOuvres('2026-10-09', '2026-10-13')).toEqual([{ du: '2026-10-09', au: '2026-10-09' }, { du: '2026-10-12', au: '2026-10-13' }]);
    expect(blocsOuvres('2026-10-05', '2026-10-09')).toEqual([{ du: '2026-10-05', au: '2026-10-09' }]);
    expect(blocsOuvres('2026-10-10', '2026-10-11')).toEqual([]);
  });
});

describe('fichier ICS', () => {
  const ics = fichierIcs([
    { id: 'e1', titre: 'Chantier Martin, séjour; cuisine', debut: '2026-10-12', fin: '2026-10-14', journeeEntiere: true, lieu: '3 avenue des Lilas, Thionville' },
    { id: 'e2', titre: 'RDV métré', debut: '2026-10-15T07:30:00.000Z', fin: '2026-10-15T08:30:00.000Z', journeeEntiere: false,
      description: `Ligne 1\nLigne 2 ${'é'.repeat(80)}` },
  ], new Date('2026-10-09T10:00:00Z'));
  const lignes = ics.split('\r\n');
  it('structure et fins de ligne CRLF', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });
  it('journée entière : fin EXCLUSIVE (lendemain du dernier jour)', () => {
    expect(lignes).toContain('DTSTART;VALUE=DATE:20261012');
    expect(lignes).toContain('DTEND;VALUE=DATE:20261015');
  });
  it('horaire en UTC, échappement ; et ,', () => {
    expect(lignes).toContain('DTSTART:20261015T073000Z');
    expect(lignes).toContain('SUMMARY:Chantier Martin\\, séjour\\; cuisine');
    expect(lignes).toContain('UID:e1@hdecor');
    expect(lignes).toContain('DTSTAMP:20261009T100000Z');
  });
  it('lignes pliées à 75 octets, sans couper un caractère', () => {
    for (const l of lignes) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    const desc = ics.slice(ics.indexOf('DESCRIPTION:')).split('\r\nEND:VEVENT')[0]!.replace(/\r\n /g, '');
    expect(desc).toBe(`DESCRIPTION:Ligne 1\\nLigne 2 ${'é'.repeat(80)}`);
  });
});
