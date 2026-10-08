import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Marque } from '@/components/Marque';
import { BadgeAVerifier } from '@/components/ui/Champ';

export const metadata: Metadata = { title: 'Confidentialité' };

/**
 * Information des personnes (RGPD, articles 13 et 14). Page publique : elle ne
 * lit aucune donnée. Texte à faire valider (voir docs/rgpd/registre-traitements.md).
 */
export default function PageConfidentialite() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6">
      <Marque />
      <h1 className="text-2xl font-bold">Vos données personnelles</h1>
      <p className="rounded-xl border-2 border-alerte bg-alerte-fond p-3 text-alerte">
        Texte en cours de validation. Les points marqués <BadgeAVerifier /> ne sont pas encore confirmés.
      </p>

      <Section titre="Qui traite vos données ?">
        <p>L’entreprise H’DECOR (peinture &amp; décoration), dont les coordonnées figurent sur chaque devis et chaque facture.</p>
      </Section>

      <Section titre="Pourquoi ?">
        <ul className="list-disc pl-5">
          <li>Établir votre devis et réaliser les travaux (mesures précontractuelles, puis exécution du contrat).</li>
          <li>Facturer et tenir la comptabilité (obligation légale).</li>
          <li>Vous recontacter au sujet d’une demande sans suite, pendant une durée limitée (intérêt légitime).</li>
        </ul>
        <p className="mt-2 text-sm">Bases légales <BadgeAVerifier /></p>
      </Section>

      <Section titre="Quelles données ?">
        <p>
          Identité, coordonnées (email, téléphone, adresse), adresse du chantier, devis, factures et paiements, photos du chantier
          et, si vous signez en ligne, votre signature. Aucune donnée sensible n’est demandée.
        </p>
      </Section>

      <Section titre="Combien de temps ?">
        <ul className="list-disc pl-5">
          <li>Demande sans devis ni facture : anonymisée automatiquement après une durée sans activité fixée par l’entreprise. <BadgeAVerifier /></li>
          <li>Factures et devis acceptés : conservés pendant la durée légale de conservation des pièces comptables (10 ans). <BadgeAVerifier /></li>
        </ul>
      </Section>

      <Section titre="Qui y a accès ?">
        <p>
          Le dirigeant de H’DECOR, son comptable, et les prestataires techniques qui hébergent l’application (Supabase, Vercel),
          dans l’Union européenne. <BadgeAVerifier />
        </p>
        <p className="mt-2">Vos données ne sont ni vendues ni utilisées pour de la publicité. Ce site n’utilise aucun cookie de suivi.</p>
      </Section>

      <Section titre="Vos droits">
        <p>
          Vous pouvez demander l’accès à vos données, leur rectification, leur effacement, leur portabilité, ou vous opposer à
          leur traitement, en écrivant à H’DECOR (coordonnées sur vos documents). Les factures déjà émises sont conservées
          malgré une demande d’effacement, car la loi l’impose.
        </p>
        <p className="mt-2">
          En cas de désaccord, vous pouvez saisir la CNIL :{' '}
          <a href="https://www.cnil.fr" className="inline-flex min-h-11 items-center underline underline-offset-4" rel="noopener noreferrer">www.cnil.fr</a>.
        </p>
      </Section>
    </main>
  );
}

function Section({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-lg font-bold">{titre}</h2>
      {children}
    </section>
  );
}
