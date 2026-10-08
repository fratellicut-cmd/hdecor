/**
 * En-tête de marque. Le logo officiel (grand « H » doré) doit être fourni par
 * le client : en attendant, le nom de l'entreprise est affiché en texte et un
 * emplacement réservé reste visible dans les Paramètres.
 */
export function Marque({ grande = false }: { grande?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`font-black tracking-tight text-encre ${grande ? 'text-4xl' : 'text-xl'}`}>H&apos;DECOR</span>
      <span className="filet-or h-1 w-24 rounded-full" aria-hidden />
      {grande ? <span className="text-sm text-encre-douce">peinture &amp; décoration</span> : null}
    </div>
  );
}
