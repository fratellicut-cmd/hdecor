import type { LigneDetail } from '@/domain/metre';
import { formaterSurface } from '@/domain/metre';

/** Chaque étape du calcul de surface, pour que le client puisse refaire le compte. */
export function DetailCalcul({ lignes, titre = 'Détail du calcul' }: { lignes: LigneDetail[]; titre?: string }) {
  return (
    <details className="rounded-xl border border-trait bg-white p-3">
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold">{titre}</summary>
      <table className="mt-2 w-full text-sm">
        <tbody>
          {lignes.map((l, i) => (
            <tr key={i} className="border-t border-trait align-top">
              <th scope="row" className="py-1 pr-2 text-left font-semibold">{l.libelle}</th>
              <td className="py-1 pr-2 text-encre-douce">{l.calcul}</td>
              <td className="py-1 text-right tabular-nums">{l.resultatMm2 > 0n ? formaterSurface(l.resultatMm2) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
