import { describe, expect, it } from 'vitest';
import { cheminInterneSur } from '../redirection';
import { schemaCodeTotp, schemaConnexion, schemaNouveauMotDePasse } from '../validation/auth';

describe('cheminInterneSur (redirection ouverte)', () => {
  it.each(['/clients', '/clients/123?onglet=devis', '/'])('accepte %s', (c) => expect(cheminInterneSur(c)).toBe(c));
  it.each([
    'https://pirate.example', '//pirate.example', '/\\pirate.example', 'clients', '',
    '/\u0000x', '/a\\b', 'javascript:alert(1)', undefined, 42, '/' + 'a'.repeat(600),
  ])('refuse %s', (c) => expect(cheminInterneSur(c)).toBe('/'));
});

describe('schémas d’authentification', () => {
  it('normalise l’email', () => {
    expect(schemaConnexion.parse({ email: '  Yorick@Exemple.FR ', motDePasse: 'x' }).email).toBe('yorick@exemple.fr');
  });
  it('refuse un email invalide avec un message français', () => {
    const r = schemaConnexion.safeParse({ email: 'pas-un-email', motDePasse: 'x' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe('Adresse email invalide.');
  });
  it('mot de passe : 12 caractères minimum et confirmation identique', () => {
    expect(schemaNouveauMotDePasse.safeParse({ motDePasse: 'court', confirmation: 'court' }).success).toBe(false);
    expect(schemaNouveauMotDePasse.safeParse({ motDePasse: 'douze-caract', confirmation: 'douze-caracX' }).success).toBe(false);
    expect(schemaNouveauMotDePasse.safeParse({ motDePasse: 'douze-caract', confirmation: 'douze-caract' }).success).toBe(true);
  });
  it('code TOTP : exactement 6 chiffres', () => {
    const id = '4008914e-c2da-44f3-aab5-3b02e92e8a2d';
    expect(schemaCodeTotp.safeParse({ code: ' 123456 ', facteurId: id }).success).toBe(true);
    expect(schemaCodeTotp.safeParse({ code: '12345', facteurId: id }).success).toBe(false);
    expect(schemaCodeTotp.safeParse({ code: '12a456', facteurId: id }).success).toBe(false);
  });
});
