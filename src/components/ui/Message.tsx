import type { ReactNode } from 'react';

const styles = {
  erreur: 'border-danger bg-danger-fond text-danger',
  succes: 'border-succes bg-succes-fond text-succes',
  alerte: 'border-alerte bg-alerte-fond text-alerte',
  info: 'border-trait bg-white text-encre',
};

/** Message de retour après une action (annoncé aux lecteurs d'écran). */
export function Message({ type, children }: { type: keyof typeof styles; children: ReactNode }) {
  return (
    <div role={type === 'erreur' ? 'alert' : 'status'} className={`rounded-xl border-2 px-4 py-3 font-semibold ${styles[type]}`}>
      {children}
    </div>
  );
}
