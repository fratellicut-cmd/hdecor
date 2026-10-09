import QRCode from 'qrcode';

/** QR code de virement (EPC/SEPA) dessiné en SVG côté serveur : aucun script, aucun HTML injecté. */
export function QrVirement({ contenu, taille = 200 }: { contenu: string; taille?: number }) {
  const qr = QRCode.create(contenu, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const bord = 4;
  const cases: string[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(x, y)) cases.push(`M${x + bord} ${y + bord}h1v1h-1z`);
  return (
    <svg role="img" aria-label="QR code de virement" width={taille} height={taille} viewBox={`0 0 ${n + 2 * bord} ${n + 2 * bord}`} shapeRendering="crispEdges">
      <rect width="100%" height="100%" fill="#fff" />
      <path d={cases.join('')} fill="#000" />
    </svg>
  );
}
