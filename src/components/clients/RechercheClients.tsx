'use client';

import { useEffect, useRef, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';

type Filtres = { q: string; type?: 'particulier' | 'professionnel'; anonymises: boolean };

/**
 * Recherche instantanée : la liste est rendue par le serveur à partir de
 * l'adresse (?q=…&type=…). Chaque frappe met l'adresse à jour après une
 * courte pause, sans recharger la page.
 *
 * Amélioration progressive : c'est un vrai formulaire GET (la touche Entrée
 * fonctionne même avant le chargement du JavaScript), et ce qui a été tapé
 * avant ce chargement (téléphone lent) déclenche la recherche dès qu'il est prêt.
 */
export function RechercheClients({ filtres }: { filtres: Filtres }) {
  const router = useRouter();
  const chemin = usePathname();
  const [enCours, demarrer] = useTransition();
  const champ = useRef<HTMLInputElement>(null);
  const minuteur = useRef<ReturnType<typeof setTimeout>>(undefined);

  const aller = (f: Filtres) => {
    const p = new URLSearchParams();
    if (f.q.trim()) p.set('q', f.q.trim());
    if (f.type) p.set('type', f.type);
    if (f.anonymises) p.set('anonymises', '1');
    const s = p.toString();
    demarrer(() => router.replace(s ? `${chemin}?${s}` : chemin, { scroll: false }));
  };
  const saisie = () => champ.current?.value ?? filtres.q;

  useEffect(() => {
    if (champ.current && champ.current.value.trim() !== filtres.q.trim()) aller({ ...filtres, q: champ.current.value });
    return () => clearTimeout(minuteur.current);
    // Uniquement au montage : rattrape une saisie faite avant le chargement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <form action={chemin} role="search" className="flex flex-col gap-3"
      onSubmit={(e) => { e.preventDefault(); clearTimeout(minuteur.current); aller({ ...filtres, q: saisie() }); }}>
      <label htmlFor="recherche" className="sr-only">Rechercher un client</label>
      <input
        ref={champ}
        id="recherche"
        name="q"
        type="search"
        defaultValue={filtres.q}
        onChange={() => {
          clearTimeout(minuteur.current);
          minuteur.current = setTimeout(() => aller({ ...filtres, q: saisie() }), 250);
        }}
        placeholder="Nom, téléphone, ville, email…"
        autoComplete="off"
        enterKeyHint="search"
        className="min-h-12 w-full rounded-xl border-2 border-trait bg-white px-3 text-base focus:border-anthracite"
      />
      {filtres.type ? <input type="hidden" name="type" value={filtres.type} /> : null}
      {filtres.anonymises ? <input type="hidden" name="anonymises" value="1" /> : null}
      <div className="flex flex-wrap gap-2" aria-label="Filtres">
        {([undefined, 'particulier', 'professionnel'] as const).map((t) => (
          <button key={t ?? 'tous'} type="button" aria-pressed={filtres.type === t}
            onClick={() => aller({ ...filtres, q: saisie(), type: t })}
            className={`min-h-11 rounded-full border-2 px-4 font-semibold ${filtres.type === t ? 'border-anthracite bg-anthracite text-creme' : 'border-trait bg-white'}`}>
            {t === undefined ? 'Tous' : t === 'particulier' ? 'Particuliers' : 'Professionnels'}
          </button>
        ))}
        <button type="button" aria-pressed={filtres.anonymises}
          onClick={() => aller({ ...filtres, q: saisie(), anonymises: !filtres.anonymises })}
          className={`min-h-11 rounded-full border-2 px-4 font-semibold ${filtres.anonymises ? 'border-anthracite bg-anthracite text-creme' : 'border-trait bg-white'}`}>
          Fiches anonymisées
        </button>
      </div>
      <p aria-live="polite" className="sr-only">{enCours ? 'Recherche…' : ''}</p>
    </form>
  );
}
