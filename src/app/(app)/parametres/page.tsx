import type { Metadata } from 'next';
import Link from 'next/link';
import { lireParametres } from '@/lib/parametres';
import { clientServeur } from '@/lib/supabase/serveur';
import { BadgeAVerifier } from '@/components/ui/Champ';

export const metadata: Metadata = { title: 'Paramètres' };

export default async function PageParametres() {
  const p = await lireParametres();
  const supabase = await clientServeur();
  const [{ data: assurances }, { data: taux }] = await Promise.all([
    supabase.from('assurances').select('type'),
    supabase.from('taux_tva').select('a_verifier'),
  ]);
  const types = new Set((assurances ?? []).map((a) => a.type));
  const sections: { href: string; titre: string; detail: string; manque?: boolean; aVerifier?: boolean }[] = [
    { href: '/parametres/entreprise', titre: 'Entreprise', detail: 'Identité, SIRET, adresse, IBAN', manque: !p.siret || !p.iban || !p.adresse_ligne1 },
    { href: '/parametres/fiscal', titre: 'Statut fiscal', detail: p.regime_tva === 'franchise' ? 'Franchise en base de TVA' : 'Assujetti à la TVA', aVerifier: p.mention_franchise_a_verifier || !p.seuils_confirmes_le },
    { href: '/parametres/assurances', titre: 'Assurances', detail: 'Décennale et RC Pro', manque: !types.has('decennale') || !types.has('rc_pro') },
    { href: '/parametres/conditions', titre: 'Conditions et tarifs', detail: 'Paiement, pénalités, devis, taux horaire', manque: p.taux_penalites_bp === null, aVerifier: p.valeurs_a_verifier.length > 0 },
    { href: '/parametres/mentions', titre: 'Médiateur et mentions', detail: 'Médiateur de la consommation, pied de page', manque: !p.mediateur_nom },
    { href: '/parametres/taux-tva', titre: 'Taux de TVA', detail: 'Taux proposés dans les devis', aVerifier: (taux ?? []).some((t) => t.a_verifier) },
    { href: '/parametres/journal', titre: 'Journal des actions', detail: 'Qui a créé, modifié ou effacé quoi, et quand' },
    { href: '/confidentialite', titre: 'Confidentialité', detail: 'Données traitées, durées de conservation, droits' },
  ];
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">Paramètres</h1>
      <ul className="flex flex-col gap-3">
        {sections.map((s) => (
          <li key={s.href}>
            <Link href={s.href} className="flex min-h-16 flex-col justify-center gap-1 rounded-2xl border border-trait bg-white px-4 py-3">
              <span className="flex flex-wrap items-center gap-2 text-lg font-bold">
                {s.titre}
                {s.manque ? <span className="rounded-md border border-danger bg-danger-fond px-2 py-0.5 text-xs font-bold text-danger">À COMPLÉTER</span> : null}
                {s.aVerifier ? <BadgeAVerifier /> : null}
              </span>
              <span className="text-encre-douce">{s.detail}</span>
            </Link>
          </li>
        ))}
      </ul>
      <section aria-labelledby="titre-logo" className="flex items-center gap-4 rounded-2xl border-2 border-dashed border-trait bg-white p-4">
        <div aria-hidden className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-anthracite text-2xl font-black text-or-clair">H</div>
        <div className="flex flex-col gap-1">
          <h2 id="titre-logo" className="flex flex-wrap items-center gap-2 font-bold">
            Logo officiel
            <span className="rounded-md border border-danger bg-danger-fond px-2 py-0.5 text-xs font-bold text-danger">À FOURNIR</span>
          </h2>
          <p className="text-sm text-encre-douce">
            Emplacement réservé : l’icône ci-contre est provisoire. Le logo H’DECOR (PNG ou JPEG haute qualité) sera déposé ici
            et utilisé sur les devis et factures (phase Documents).
          </p>
        </div>
      </section>
    </div>
  );
}
