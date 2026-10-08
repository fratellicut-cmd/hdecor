import Link from 'next/link';

export function EnTeteSection({ titre }: { titre: string }) {
  return (
    <div className="mb-4 flex flex-col gap-1">
      <Link href="/parametres" className="inline-flex min-h-12 items-center underline underline-offset-4">← Paramètres</Link>
      <h1 className="text-2xl font-bold">{titre}</h1>
    </div>
  );
}
