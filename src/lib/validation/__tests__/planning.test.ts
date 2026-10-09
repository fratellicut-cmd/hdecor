import { describe, expect, it } from 'vitest';
import { lireDuree, schemaPlanification } from '../planning';

describe('temps passé saisi au chantier', () => {
  it('formats acceptés', () => {
    expect(lireDuree('7h30')).toBe(450);
    expect(lireDuree('7 h 30')).toBe(450);
    expect(lireDuree('7:30')).toBe(450);
    expect(lireDuree('7H')).toBe(420);
    expect(lireDuree('2,5')).toBe(150);
    expect(lireDuree('2.5h')).toBe(150);
    expect(lireDuree('45 min')).toBe(45);
    expect(lireDuree('8')).toBe(480);
  });
  it('formats refusés (ambigus ou impossibles)', () => {
    expect(lireDuree('2h5')).toBeNull();
    expect(lireDuree('1h60')).toBeNull();
    expect(lireDuree('-2')).toBeNull();
    expect(lireDuree('deux heures')).toBeNull();
  });
});

describe('durée de planification d’un chantier', () => {
  const lire = (duree_jours: string) => schemaPlanification.safeParse({ chantier_id: '11111111-1111-4111-8111-111111111111', date_debut: '2026-10-09', duree_jours });
  it('jours et demi-journées', () => {
    expect(lire('3').data?.duree_jours).toBe(3);
    expect(lire('2,5').data?.duree_jours).toBe(2.5);
    expect(lire('0,5').success).toBe(true);
  });
  it('refusées : hors demi-journée, nulle, plus d’un an', () => {
    expect(lire('2,3').success).toBe(false);
    expect(lire('0,4').success).toBe(false);
    expect(lire('366').success).toBe(false);
  });
});
