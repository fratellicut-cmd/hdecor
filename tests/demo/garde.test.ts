import { describe, expect, it } from 'vitest';
import { refusDemo } from './garde';

const ok = { baseActive: 'hdecor_demo', urlSupabase: 'http://127.0.0.1:54321', urlSite: 'http://localhost:3000', env: {} };

describe('garde du jeu de démonstration', () => {
  it('accepte la démo locale', () => expect(refusDemo(ok)).toEqual([]));
  it('refuse une autre base, même locale', () => {
    expect(refusDemo({ ...ok, baseActive: 'hdecor_dev' })[0]).toMatch(/hdecor_dev/);
    expect(refusDemo({ ...ok, baseActive: null })[0]).toMatch(/inconnue/);
  });
  it('refuse une base ou un serveur distant', () => {
    expect(refusDemo({ ...ok, urlSupabase: 'https://abcd.supabase.co' })).toEqual(['NEXT_PUBLIC_SUPABASE_URL n’est pas une adresse locale.']);
    expect(refusDemo({ ...ok, urlSupabase: undefined })).toHaveLength(1);
    expect(refusDemo({ ...ok, urlSite: 'https://hdecor.fr' })).toEqual(['Le serveur visé n’est pas local.']);
  });
  it('refuse si un envoi réel est possible', () => {
    expect(refusDemo({ ...ok, env: { RESEND_API_KEY: 're_x' } })[0]).toMatch(/RESEND_API_KEY/);
    expect(refusDemo({ ...ok, env: { STRIPE_SECRET_KEY: 'sk_test' } })[0]).toMatch(/STRIPE_SECRET_KEY/);
  });
});
