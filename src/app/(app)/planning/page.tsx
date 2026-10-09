import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { aujourdHuiParis, finDeJourParis, heureParis, instantParis } from '@/domain/dates';
import { ajouterJours } from '@/domain/devis-document';
import { formaterEuros } from '@/domain/formats';
import { LIBELLES_EVENEMENT } from '@/lib/validation/planning';
import { marquerRappelFait, supprimerEvenement } from './actions';
import { FormulaireEvenement, FormulaireRappel, type EvenementSaisie } from '@/components/planning/Formulaires';
import { ActionConfirmee } from '@/components/formulaire/ActionConfirmee';
import { Carte } from '@/components/ui/Carte';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'Planning' };

type Vue = 'jour' | 'semaine' | 'mois';
const bouton = 'inline-flex min-h-12 items-center justify-center rounded-xl px-3 font-semibold';
const JOURS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

const jourSemaine = (d: string) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;   // lundi = 0
const libelleJour = (d: string) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${d}T12:00:00Z`));
const libelleMois = (d: string) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${d}T12:00:00Z`));

function bornes(vue: Vue, date: string): { du: string; au: string; avant: string; apres: string } {
  if (vue === 'jour') return { du: date, au: date, avant: ajouterJours(date, -1), apres: ajouterJours(date, 1) };
  if (vue === 'semaine') {
    const lundi = ajouterJours(date, -jourSemaine(date));
    return { du: lundi, au: ajouterJours(lundi, 6), avant: ajouterJours(lundi, -7), apres: ajouterJours(lundi, 7) };
  }
  const premier = `${date.slice(0, 7)}-01`;
  const suivant = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 1)).toISOString().slice(0, 10);
  const precedent = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10);
  return { du: premier, au: ajouterJours(suivant, -1), avant: precedent, apres: suivant };
}

function jours(du: string, au: string): string[] {
  const r: string[] = [];
  for (let d = du; d <= au; d = ajouterJours(d, 1)) r.push(d);
  return r;
}

export default async function PagePlanning({ searchParams }: PageProps<'/planning'>) {
  await verifierSession();
  const sp = await searchParams;
  const aujourdhui = aujourdHuiParis();
  const vue = z.enum(['jour', 'semaine', 'mois']).catch('semaine').parse(sp.vue);
  const date = z.iso.date().catch(aujourdhui).parse(sp.date);
  const b = bornes(vue, date);
  const debut = instantParis(b.du, '00:00').toISOString();
  const fin = finDeJourParis(b.au).toISOString();
  const sb = await clientServeur();
  const [{ data: evenements, error }, { data: rappels }, { data: echeances }, { data: chantiers }] = await Promise.all([
    sb.from('evenements').select('id, type, titre, debut, fin, journee_entiere, notes, chantier_id').lte('debut', fin).gte('fin', debut).order('debut').limit(500),
    sb.from('rappels').select('id, titre, echeance, chantier_id').eq('statut', 'a_envoyer').gte('echeance', debut).lte('echeance', fin).order('echeance').limit(200),
    sb.from('v_factures').select('id, numero, date_echeance, reste_a_payer_cents').eq('statut', 'emise').neq('type', 'avoir')
      .gt('reste_a_payer_cents', 0).gte('date_echeance', b.du).lte('date_echeance', b.au).limit(200),
    sb.from('chantiers').select('id, nom, ville').neq('statut', 'termine').order('created_at', { ascending: false }).limit(300),
  ]);
  const listeChantiers = (chantiers ?? []).map((c) => ({ id: c.id, libelle: [c.nom, c.ville].filter(Boolean).join(' · ') }));
  const nomChantier = (id: string | null) => (id ? listeChantiers.find((c) => c.id === id)?.libelle : null);
  // Un événement de plusieurs jours apparaît chaque jour qu'il couvre.
  const duJour = (j: string) => (evenements ?? []).filter((e) => aujourdHuiParis(new Date(e.debut)) <= j && aujourdHuiParis(new Date(e.fin)) >= j);
  const rappelsDuJour = (j: string) => (rappels ?? []).filter((r) => aujourdHuiParis(new Date(r.echeance)) === j);
  const echeancesDuJour = (j: string) => (echeances ?? []).filter((f) => f.date_echeance === j);
  const lien = (v: Vue, d: string) => `/planning?vue=${v}&date=${d}`;
  const saisie = (e: NonNullable<typeof evenements>[number]): EvenementSaisie => ({
    id: e.id, type: e.type, chantier_id: e.chantier_id ?? '', titre: e.titre, journee_entiere: e.journee_entiere, notes: e.notes ?? '',
    date_debut: aujourdHuiParis(new Date(e.debut)), date_fin: aujourdHuiParis(new Date(e.fin)),
    heure_debut: e.journee_entiere ? '' : heureParis(new Date(e.debut)), heure_fin: e.journee_entiere ? '' : heureParis(new Date(e.fin)),
  });
  const titre = vue === 'mois' ? libelleMois(b.du) : vue === 'jour' ? libelleJour(b.du) : `Semaine du ${libelleJour(b.du)}`;

  const Jour = ({ j }: { j: string }) => {
    const ev = duJour(j);
    const rp = rappelsDuJour(j);
    const ec = echeancesDuJour(j);
    return (
      <section aria-label={libelleJour(j)} className={`rounded-2xl border bg-white p-3 ${j === aujourdhui ? 'border-2 border-anthracite' : 'border-trait'}`}>
        <h2 className="mb-1 font-bold first-letter:uppercase">{libelleJour(j)}{j === aujourdhui ? ' · aujourd’hui' : ''}</h2>
        {!ev.length && !rp.length && !ec.length ? <p className="text-sm text-encre-douce">Rien de prévu.</p> : null}
        <ul className="flex flex-col gap-2">
          {ev.map((e) => (
            <li key={e.id} className="rounded-xl bg-creme p-2">
              <p className="font-semibold">
                <span className="mr-2 rounded-md border border-anthracite px-1.5 text-xs uppercase">{LIBELLES_EVENEMENT[e.type as keyof typeof LIBELLES_EVENEMENT]}</span>
                {e.journee_entiere ? '' : `${heureParis(new Date(e.debut))} – ${heureParis(new Date(e.fin))} · `}{e.titre}
              </p>
              {e.chantier_id ? <Link href={`/chantiers/${e.chantier_id}`} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">{nomChantier(e.chantier_id) ?? 'Chantier'}</Link> : null}
              {e.notes ? <p className="text-sm whitespace-pre-line text-encre-douce">{e.notes}</p> : null}
              <details>
                <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold underline underline-offset-4">Modifier</summary>
                <div className="mt-2 flex flex-col gap-3">
                  <FormulaireEvenement evenement={saisie(e)} chantiers={listeChantiers} />
                  <ActionConfirmee action={supprimerEvenement} champs={{ id: e.id }} libelle="Supprimer" variante="danger" confirmation="Je supprime cet événement" />
                </div>
              </details>
            </li>
          ))}
          {rp.map((r) => (
            <li key={r.id} className="flex flex-col rounded-xl border border-dashed border-trait p-2">
              <p className="font-semibold">⏰ {heureParis(new Date(r.echeance))} · {r.titre}</p>
              <ActionConfirmee action={marquerRappelFait} champs={{ id: r.id }} libelle="C’est fait" variante="discret" />
            </li>
          ))}
          {ec.map((f) => (
            <li key={f.id}>
              <Link href={`/factures/${f.id}`} className="flex min-h-11 items-center text-sm font-semibold underline underline-offset-4">
                € Échéance de la facture {f.numero} : {formaterEuros(f.reste_a_payer_cents!)}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Planning</h1>
        <a href="/planning/agenda.ics" className={`${bouton} border-2 border-anthracite bg-white text-sm`}>Exporter vers Google Agenda</a>
      </div>
      {error ? <Message type="erreur">Le planning n’a pas pu être chargé. Rechargez la page.</Message> : null}
      <nav aria-label="Vue" className="grid grid-cols-3 gap-2">
        {(['jour', 'semaine', 'mois'] as const).map((v) => (
          <Link key={v} href={lien(v, date)} aria-current={vue === v ? 'page' : undefined}
            className={`${bouton} border-2 ${vue === v ? 'border-anthracite bg-anthracite text-creme' : 'border-trait bg-white'}`}>{v[0]!.toUpperCase() + v.slice(1)}</Link>
        ))}
      </nav>
      <div className="flex items-center justify-between gap-2">
        <Link href={lien(vue, b.avant)} className={`${bouton} border-2 border-trait bg-white`} aria-label="Période précédente">←</Link>
        <p className="text-center font-bold first-letter:uppercase">{titre}</p>
        <Link href={lien(vue, b.apres)} className={`${bouton} border-2 border-trait bg-white`} aria-label="Période suivante">→</Link>
      </div>
      {date !== aujourdhui ? <Link href={lien(vue, aujourdhui)} className="inline-flex min-h-11 items-center self-center underline underline-offset-4">Revenir à aujourd’hui</Link> : null}

      {vue === 'mois' ? (
        <div className="grid grid-cols-7 gap-1 text-center text-sm">
          {JOURS.map((j) => <div key={j} className="font-semibold text-encre-douce">{j}</div>)}
          {Array.from({ length: jourSemaine(b.du) }, (_, i) => <div key={`v${i}`} />)}
          {jours(b.du, b.au).map((j) => {
            const n = duJour(j).length + rappelsDuJour(j).length + echeancesDuJour(j).length;
            return (
              <Link key={j} href={lien('jour', j)} aria-label={`${libelleJour(j)} : ${n} élément${n > 1 ? 's' : ''}`}
                className={`flex min-h-12 flex-col items-center justify-center rounded-lg border ${j === aujourdhui ? 'border-2 border-anthracite' : 'border-trait'} bg-white`}>
                <span className="font-semibold">{Number(j.slice(8))}</span>
                {n ? <span className="text-xs font-bold text-or-fonce">{'●'.repeat(Math.min(n, 3))}</span> : null}
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-2">{jours(b.du, b.au).map((j) => <Jour key={j} j={j} />)}</div>
      )}

      <Carte titre="Ajouter">
        <details>
          <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold underline underline-offset-4">+ Un rendez-vous ou un événement</summary>
          <div className="mt-2">
            <FormulaireEvenement chantiers={listeChantiers} evenement={{ type: 'rendez_vous', chantier_id: '', titre: '', date_debut: vue === 'jour' ? date : aujourdhui,
              date_fin: '', journee_entiere: false, heure_debut: '08:00', heure_fin: '09:00', notes: '' }} />
          </div>
        </details>
        <details>
          <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold underline underline-offset-4">+ Un rappel</summary>
          <div className="mt-2"><FormulaireRappel aujourdhui={vue === 'jour' ? date : aujourdhui} /></div>
        </details>
        <p className="mt-2 text-sm text-encre-douce">Pour planifier un chantier sur plusieurs jours, ouvrez-le : « Planifier le chantier ».</p>
      </Carte>
    </div>
  );
}
