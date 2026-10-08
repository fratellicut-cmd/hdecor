import type { ReactNode } from 'react';

export function Carte({ titre, children, action }: { titre?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-trait bg-white p-4 shadow-sm">
      {titre || action ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          {titre ? <h2 className="text-lg font-bold">{titre}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}
