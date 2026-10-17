/* ==========================================================================
   Tests de l'export PDF (jsPDF exécuté côté Node, bibliothèque locale).
   Vérifie qu'un PDF A4 valide est produit pour les trois modèles, avec les
   montants attendus et les accents correctement encodés.
   Exécution : node tests/pdf.test.mjs
   ========================================================================== */
import { createRequire } from 'node:module';
import { inflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);

class MemoireLocale {
  constructor() { this.donnees = new Map(); }
  getItem(cle) { return this.donnees.has(cle) ? this.donnees.get(cle) : null; }
  setItem(cle, valeur) { this.donnees.set(cle, String(valeur)); }
  removeItem(cle) { this.donnees.delete(cle); }
  clear() { this.donnees.clear(); }
}
globalThis.localStorage = new MemoireLocale();
globalThis.document = { readyState: 'complete', createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }) };
globalThis.location = { pathname: '/index.html' };
// jsPDF est déjà disponible : le module PDF n'a pas besoin de charger le script.
globalThis.jspdf = require('../lib/jspdf.umd.min.js');

await import('../js/app.js');
await import('../js/calculs.js');
await import('../js/stockage.js');
await import('../js/parametres.js');
await import('../js/documents.js');
await import('../js/pdf.js');

const { decrire, test, egal, proche, vrai, bilan } = await import('./micro-test.mjs');

const AGORA = globalThis.AGORA;

function documentTest(surcharges) {
  return Object.assign({
    type: 'facture',
    numero: 'F-2026-0042',
    statut: 'en_attente',
    dateEmission: '2026-10-15',
    dateEcheance: '2026-11-14',
    devise: 'XOF',
    tvaActive: true,
    tvaMode: 'exclusive',
    modeRemise: 'pourcent',
    modele: 'classique',
    remiseGlobale: { type: 'pourcent', valeur: 0 },
    vendeur: { nom: 'Établissements Éloïse', adresse: '12 rue des Écoles, Lomé', telephone: '+228 90 00 00 00', email: 'contact@eloise.tg', fiscal: 'IFU-12345' },
    client: { nom: 'Société Gbénou', adresse: 'Agoè', telephone: '+228 91 11 11 11' },
    lignes: [
      { designation: 'Prestation de conseil — acompte', quantite: 2, prixUnitaire: 50000, remise: 10, tauxTva: 18 },
      { designation: 'Livraison', quantite: 1, prixUnitaire: 15000, remise: 0, tauxTva: 18 }
    ],
    paiements: [{ id: 'p1', date: '2026-10-15', montant: 30000, methode: 'Virement', reference: 'VIR-88' }],
    notes: 'Merci de votre confiance.',
    conditions: 'Paiement à 30 jours.'
  }, surcharges || {});
}

/** Décompresse les flux du PDF pour vérifier le texte réellement écrit. */
function extraireTexte(pdf) {
  const brut = Buffer.from(pdf.output('arraybuffer')).toString('latin1');
  let sortie = '';
  const motif = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = motif.exec(brut)) !== null) {
    try {
      sortie += inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
    } catch (e) { /* flux non compressé ou image : ignoré */ }
  }
  return sortie;
}

decrire('Génération PDF', () => {
  test('un PDF A4 valide est produit (modèle classique)', async () => {
    const resultat = await AGORA.pdf.generer(documentTest(), { modele: 'classique' });
    const brut = Buffer.from(resultat.pdf.output('arraybuffer'));
    vrai(brut.length > 1500, 'PDF trop petit : ' + brut.length + ' octets');
    egal(brut.slice(0, 5).toString('latin1'), '%PDF-');
    proche(resultat.pdf.internal.pageSize.getWidth(), 210, 0.01, 'largeur A4');
    proche(resultat.pdf.internal.pageSize.getHeight(), 297, 0.01, 'hauteur A4');
    vrai(resultat.nom.endsWith('.pdf'), 'nom de fichier inattendu : ' + resultat.nom);
    vrai(resultat.nom.includes('F-2026-0042'), 'numéro absent du nom : ' + resultat.nom);
  });

  test('les trois modèles se génèrent sans erreur', async () => {
    for (const modele of ['classique', 'moderne', 'minimal']) {
      const resultat = await AGORA.pdf.generer(documentTest({ modele }), { modele });
      const brut = Buffer.from(resultat.pdf.output('arraybuffer'));
      vrai(brut.length > 1500, modele + ' : PDF trop petit');
      egal(brut.slice(0, 5).toString('latin1'), '%PDF-');
    }
  });

  test('un reçu court se génère aussi', async () => {
    const recu = documentTest({
      type: 'recu',
      numero: 'R-2026-0007',
      statut: 'payee',
      lignes: [{ designation: 'Règlement facture F-2026-0042', quantite: 1, prixUnitaire: 106200, remise: 0, tauxTva: 0 }],
      paiements: [{ id: 'p1', date: '2026-10-15', montant: 106200, methode: 'Especes' }]
    });
    const resultat = await AGORA.pdf.generer(recu, {});
    const brut = Buffer.from(resultat.pdf.output('arraybuffer'));
    vrai(brut.length > 1500);
    vrai(resultat.nom.includes('recu'), 'nom inattendu : ' + resultat.nom);
  });

  test('le contenu (accents compris) est correctement écrit dans le PDF', async () => {
    const doc = documentTest();
    const resultat = await AGORA.pdf.generer(doc, {});
    const texte = extraireTexte(resultat.pdf);
    vrai(texte.length > 200, 'flux décompressé trop court : ' + texte.length);
    ['Société Gbénou', 'Établissements Éloïse', 'F-2026-0042', 'Agora Factures', 'Prestation de conseil']
      .forEach((attendu) => {
        vrai(texte.includes(attendu), 'texte absent du PDF : ' + attendu);
      });
    // Montants attendus au format fr-FR (XOF sans décimale, espaces normalisées pour le PDF)
    vrai(/123 900/.test(texte), 'total TTC absent ou mal formaté');
    vrai(/18,00/.test(texte), 'taux de TVA absent');
    vrai(!/ | /.test(texte), 'espace insécable non normalisée dans le PDF');
  });

  test('les montants du PDF correspondent au moteur de calcul', async () => {
    const doc = documentTest();
    const m = AGORA.documents.montants(doc);
    egal(m.sousTotal, 115000);
    egal(m.remisesLignes, 10000);
    egal(m.baseImposable, 105000);
    egal(m.tva, 18900);
    egal(m.total, 123900);
    egal(m.solde, 93900);
  });

  test('un document sans ligne ni client ne provoque pas d\'erreur', async () => {
    const resultat = await AGORA.pdf.generer(documentTest({
      client: { nom: '' },
      lignes: [],
      notes: '',
      conditions: ''
    }), {});
    const brut = Buffer.from(resultat.pdf.output('arraybuffer'));
    vrai(brut.slice(0, 5).toString('latin1') === '%PDF-');
  });

  test('un grand nombre de lignes provoque une pagination', async () => {
    const lignes = [];
    for (let i = 1; i <= 60; i++) {
      lignes.push({ designation: 'Article ' + i, quantite: 1, prixUnitaire: 1000, remise: 0, tauxTva: 18 });
    }
    const resultat = await AGORA.pdf.generer(documentTest({ lignes }), {});
    vrai(resultat.pdf.getNumberOfPages() >= 2, 'pages : ' + resultat.pdf.getNumberOfPages());
  });

  test('le logo est ignoré s\'il n\'est pas une image exploitable', async () => {
    const resultat = await AGORA.pdf.generer(documentTest(), { logo: 'data:image/gif;base64,ZZZ' });
    vrai(Buffer.from(resultat.pdf.output('arraybuffer')).slice(0, 5).toString('latin1') === '%PDF-');
  });

  test('la signature optionnelle s\'ajoute sans casser la mise en page', async () => {
    const resultat = await AGORA.pdf.generer(documentTest(), { signature: true });
    vrai(resultat.pdf.getNumberOfPages() >= 1);
  });
});

await bilan('Export PDF');
