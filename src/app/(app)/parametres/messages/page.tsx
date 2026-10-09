import type { Metadata } from 'next';
import Link from 'next/link';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { CHAMPS_MESSAGES, CODES_MESSAGES, estRelanceImpaye, type CodeMessage } from '@/lib/validation/messages';
import { emailConfigure } from '@/lib/email';
import { EnTeteSection } from '@/components/parametres/EnTeteSection';
import { FormulaireMessage } from '@/components/parametres/FormulaireMessage';
import { Carte } from '@/components/ui/Carte';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'Messages et relances' };

const TITRES: Record<CodeMessage, string> = {
  envoi_devis: 'Envoi d’un devis', relance_devis: 'Relance d’un devis non signé', envoi_facture: 'Envoi d’une facture',
  impaye_1: 'Impayé : 1er rappel', impaye_2: 'Impayé : 2e rappel', impaye_3: 'Impayé : dernier rappel',
};

export default async function PageMessages() {
  await verifierSession();
  const sb = await clientServeur();
  const { data, error } = await sb.from('modeles_messages').select('code, sujet, corps, delai_jours, actif');
  const modeles = CODES_MESSAGES.flatMap((code) => {
    const m = data?.find((x) => x.code === code);
    return m ? [{ ...m, code }] : [];
  });
  return (
    <>
      <EnTeteSection titre="Messages et relances" />
      <div className="flex flex-col gap-4">
        {!emailConfigure() ? <Message type="info">L’envoi d’emails n’est pas configuré sur ce serveur : aucun message ne part pour l’instant.</Message> : null}
        <p>
          Les relances d’impayés partent automatiquement, par email, seulement pour une facture envoyée, échue et non réglée. Les délais se
          comptent après l’échéance, et chaque rappel attend au moins l’écart entre les délais depuis le précédent (avec 7, 15 et 30 jours :
          8 jours entre le 1er et le 2e, 15 entre le 2e et le dernier). Sur une facture en retard, « Relancer le client » prépare aussi le
          rappel suivant à la main (SMS, WhatsApp). Le délai de relance des devis se règle dans <Link href="/parametres/conditions" className="inline-flex min-h-11 items-center underline underline-offset-4">Conditions et tarifs</Link>.
        </p>
        {error ? <Message type="erreur">Les messages n’ont pas pu être chargés. Rechargez la page.</Message> : null}
        {modeles.map((m) => (
          <Carte key={m.code} titre={TITRES[m.code]}>
            <FormulaireMessage version={`${m.sujet}|${m.corps}|${m.delai_jours}|${m.actif}`} m={{
              code: m.code, sujet: m.sujet, corps: m.corps, actif: m.actif, champs: CHAMPS_MESSAGES[m.code],
              delai_jours: estRelanceImpaye(m.code) ? String(m.delai_jours ?? '') : null,
            }} />
          </Carte>
        ))}
      </div>
    </>
  );
}
