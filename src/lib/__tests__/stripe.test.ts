import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { signatureStripeValide, TOLERANCE_SIGNATURE_S } = await import('../stripe');

const secret = 'whsec_test_fictif';
const corps = '{"id":"evt_1","type":"checkout.session.completed"}';
const signe = (t: number, c = corps, s = secret) => createHmac('sha256', s).update(`${t}.${c}`).digest('hex');
const t = 1_800_000_000;

describe('signature du webhook Stripe', () => {
  it('acceptée : bonne clé, corps intact, horodatage récent', () => {
    expect(signatureStripeValide(corps, `t=${t},v1=${signe(t)}`, secret, t + 10)).toBe(true);
  });
  it('acceptée parmi plusieurs signatures v1 (rotation de clé)', () => {
    expect(signatureStripeValide(corps, `t=${t},v1=${'0'.repeat(64)},v1=${signe(t)}`, secret, t)).toBe(true);
  });
  it.each([
    ['corps modifié', `t=${t},v1=${signe(t)}`, corps.replace('evt_1', 'evt_2'), t],
    ['autre clé', `t=${t},v1=${signe(t, corps, 'autre')}`, corps, t],
    ['horodatage trop ancien (rejeu)', `t=${t},v1=${signe(t)}`, corps, t + TOLERANCE_SIGNATURE_S + 1],
    ['horodatage dans le futur', `t=${t},v1=${signe(t)}`, corps, t - TOLERANCE_SIGNATURE_S - 1],
    ['sans v1', `t=${t}`, corps, t],
    ['seulement v0 (mode test non signé)', `t=${t},v0=${signe(t)}`, corps, t],
    ['en-tête illisible', 'n’importe quoi', corps, t],
  ])('refusée : %s', (_, entete, c, maintenant) => {
    expect(signatureStripeValide(c, entete, secret, maintenant)).toBe(false);
  });
  it('refusée sans en-tête ou sans secret', () => {
    expect(signatureStripeValide(corps, null, secret, t)).toBe(false);
    expect(signatureStripeValide(corps, `t=${t},v1=${signe(t, corps, '')}`, '', t)).toBe(false);
  });
});
