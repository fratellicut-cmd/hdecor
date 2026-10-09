import type { ButtonHTMLAttributes } from 'react';

type Variante = 'principal' | 'secondaire' | 'danger' | 'discret';

const styles: Record<Variante, string> = {
  principal: 'bg-anthracite text-creme hover:bg-black',
  secondaire: 'bg-white text-encre border-2 border-anthracite hover:bg-creme',
  danger: 'bg-danger text-white hover:brightness-90',
  discret: 'bg-transparent text-encre underline underline-offset-4',
};

/** Bouton tactile : 48 px de haut minimum (cible ≥ 44 px, mains sales). */
export function Bouton({
  variante = 'principal',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante }) {
  return (
    <button
      {...props}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold disabled:opacity-60 ${styles[variante]} ${className}`}
    />
  );
}
