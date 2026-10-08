// Types de la base, générés par `npm run types:db` (ne pas modifier
// types-base.ts à la main) et raccourcis d'usage courant.
import type { Database } from './types-base';

export type { Database };
type Public = Database['public'];
export type Ligne<T extends keyof Public['Tables']> = Public['Tables'][T]['Row'];
export type Insertion<T extends keyof Public['Tables']> = Public['Tables'][T]['Insert'];
export type MiseAJour<T extends keyof Public['Tables']> = Public['Tables'][T]['Update'];
export type Vue<T extends keyof Public['Views']> = Public['Views'][T]['Row'];
