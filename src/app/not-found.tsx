import Link from 'next/link';
import { PageErreur, classeLienBouton } from '@/components/PageErreur';

export default function PageIntrouvable() {
  return (
    <main>
      <title>Page introuvable · H&apos;DECOR</title>
      <PageErreur
        titre="Page introuvable"
        texte="Cette page n’existe pas ou plus (lien erroné, fiche effacée ou anonymisée)."
        actions={<Link href="/" className={`${classeLienBouton} bg-anthracite text-creme`}>Retour à l’accueil</Link>}
      />
    </main>
  );
}
