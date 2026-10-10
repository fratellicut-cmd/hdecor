import { describe, expect, it } from 'vitest';
import { aujourdHuiParis, finDeJourParis, heureParis, instantParis } from '../dates';

describe('heures de Paris', () => {
  it('hiver (UTC+1) et été (UTC+2)', () => {
    expect(instantParis('2026-01-15', '07:30').toISOString()).toBe('2026-01-15T06:30:00.000Z');
    expect(instantParis('2026-07-15', '07:30').toISOString()).toBe('2026-07-15T05:30:00.000Z');
  });
  it('jour du changement d’heure (29 mars 2026, 2 h -> 3 h ; 25 octobre 2026, 3 h -> 2 h)', () => {
    expect(instantParis('2026-03-29', '01:30').toISOString()).toBe('2026-03-29T00:30:00.000Z');
    expect(instantParis('2026-03-29', '04:00').toISOString()).toBe('2026-03-29T02:00:00.000Z');
    expect(instantParis('2026-10-25', '12:00').toISOString()).toBe('2026-10-25T11:00:00.000Z');
  });
  it('aller-retour heure locale', () => {
    const i = instantParis('2026-10-09', '18:45');
    expect([aujourdHuiParis(i), heureParis(i)]).toEqual(['2026-10-09', '18:45']);
    expect(heureParis(instantParis('2026-12-31', '23:59'))).toBe('23:59');
    expect(aujourdHuiParis(new Date(finDeJourParis('2026-10-09').getTime() + 1_000))).toBe('2026-10-10');
  });
});
