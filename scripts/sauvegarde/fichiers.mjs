// Fichiers de la sauvegarde (voir fichiers.sql) :
//   node fichiers.mjs exporter <liste.csv> <dossier>   télécharge chaque fichier (clé service)
//   node fichiers.mjs importer <liste.csv> <dossier>   redépose chaque fichier (sans écraser)
//   node fichiers.mjs verifier <liste.csv> <dossier>   présence et empreintes SHA-256
// Variables : NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (exporter, importer).
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const [mode, liste, dossier] = process.argv.slice(2);
if (!['exporter', 'importer', 'verifier'].includes(mode) || !liste || !dossier) {
  console.error('Usage : node fichiers.mjs exporter|importer|verifier <liste.csv> <dossier>');
  process.exit(2);
}
const ESPACES = new Set(['documents', 'signatures', 'justificatifs', 'photos', 'marque']);
const lignes = (await readFile(liste, 'utf8')).split('\n').filter(Boolean).map((l) => {
  const [espace, chemin, sha] = l.split(',');
  // Chemins rangés par l'application : <organisation>/… sans « .. » ni caractère spécial.
  if (!ESPACES.has(espace) || !/^[0-9a-f-]{36}\/[a-z0-9\-/.]+$/.test(chemin) || chemin.includes('..')) throw new Error(`Ligne invalide : ${l}`);
  return { espace, chemin, sha: sha || null };
});
const local = (f) => path.join(dossier, f.espace, f.chemin);
const sha = (o) => createHash('sha256').update(o).digest('hex');
const api = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let erreurs = 0;
if (mode === 'exporter') {
  const sb = api();
  for (const f of lignes) {
    const { data, error } = await sb.storage.from(f.espace).download(f.chemin);
    if (error || !data) { console.error(`Manquant dans le stockage : ${f.espace}/${f.chemin}`); erreurs++; continue; }
    await mkdir(path.dirname(local(f)), { recursive: true });
    await writeFile(local(f), Buffer.from(await data.arrayBuffer()));
  }
} else if (mode === 'importer') {
  const sb = api();
  for (const f of lignes) {
    const octets = await readFile(local(f));
    const { error } = await sb.storage.from(f.espace).upload(f.chemin, octets, { upsert: false });
    if (error) { console.error(`Dépôt refusé : ${f.espace}/${f.chemin} (${error.message})`); erreurs++; }
  }
} else {
  for (const f of lignes) {
    let octets;
    try { octets = await readFile(local(f)); } catch { console.error(`Absent : ${f.espace}/${f.chemin}`); erreurs++; continue; }
    if (f.sha && sha(octets) !== f.sha) { console.error(`Empreinte différente : ${f.espace}/${f.chemin}`); erreurs++; }
  }
}
const avecEmpreinte = lignes.filter((f) => f.sha).length;
console.log(`${mode} : ${lignes.length} fichier(s)${mode === 'verifier' ? `, dont ${avecEmpreinte} document(s) à empreinte contrôlée` : ''}, ${erreurs} erreur(s).`);
process.exit(erreurs ? 1 : 0);
