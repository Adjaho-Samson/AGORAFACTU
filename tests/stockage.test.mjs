/* ==========================================================================
   Tests du module de stockage (IndexedDB + localStorage).
   L'environnement de test utilise fake-indexeddb : aucune base réelle n'est
   touchée, la base est recréée à chaque exécution.
   Exécution : node tests/stockage.test.mjs
   ========================================================================== */
import 'fake-indexeddb/auto';

// --- Environnement minimal attendu par les modules navigateur -------------
class MemoireLocale {
  constructor() { this.donnees = new Map(); }
  getItem(cle) { return this.donnees.has(cle) ? this.donnees.get(cle) : null; }
  setItem(cle, valeur) { this.donnees.set(cle, String(valeur)); }
  removeItem(cle) { this.donnees.delete(cle); }
  clear() { this.donnees.clear(); }
}
globalThis.localStorage = new MemoireLocale();
globalThis.document = { readyState: 'complete' };
globalThis.location = { pathname: '/index.html' };

const { decrire, test, egal, vrai, faux, bilan } = await import('./micro-test.mjs');
await import('../js/app.js');
await import('../js/calculs.js');
await import('../js/stockage.js');
await import('../js/parametres.js');
await import('../js/documents.js');

const AGORA = globalThis.AGORA;
const stockage = AGORA.stockage;
const parametres = AGORA.parametres;
const calculs = AGORA.calculs;

function documentTest(surcharges) {
  return Object.assign({
    type: 'facture',
    numero: null,
    statut: 'brouillon',
    dateEmission: '2026-10-15',
    dateEcheance: '2026-11-14',
    devise: 'XOF',
    tvaActive: true,
    tvaMode: 'exclusive',
    modeRemise: 'pourcent',
    modele: 'classique',
    remiseGlobale: { type: 'pourcent', valeur: 0 },
    vendeur: { nom: 'Boutique Agora', adresse: 'Lomé', telephone: '+228 90 00 00 00' },
    client: { nom: 'Client Test', telephone: '+228 91 11 11 11' },
    lignes: [
      { designation: 'Prestation', quantite: 2, prixUnitaire: 50000, remise: 10, tauxTva: 18 }
    ],
    paiements: [],
    notes: '',
    conditions: ''
  }, surcharges || {});
}

/* --------------------------------------------------------------- CRUD */
decrire('Documents : création, lecture, modification, suppression', () => {
  test('enregistrer puis relire un document', async () => {
    const doc = documentTest();
    const sauve = await stockage.enregistrerDocument(doc);
    vrai(!!sauve.id, 'identifiant non généré');
    egal(sauve.createdAt !== undefined, true);
    const relu = await stockage.obtenirDocument(sauve.id);
    egal(relu.client.nom, 'Client Test');
    egal(relu.id, sauve.id);
  });

  test('les index secondaires sont renseignés', async () => {
    const d = documentTest({ numero: 'F-2026-9001', client: { nom: 'Indexé' } });
    const sauve = await stockage.enregistrerDocument(d);
    egal(sauve.clientNom, 'Indexé');
    const parType = await stockage.listerParIndex('type', 'facture');
    vrai(parType.length >= 1, 'index type vide');
    const parNumero = await stockage.listerParIndex('numero', 'F-2026-9001');
    egal(parNumero.length, 1);
  });

  test('la modification conserve l\'identifiant et met à jour updatedAt', async () => {
    const sauve = await stockage.enregistrerDocument(documentTest({ numero: 'F-2026-9002' }));
    const avant = sauve.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    sauve.statut = 'payee';
    const maj = await stockage.enregistrerDocument(sauve);
    egal(maj.id, sauve.id);
    egal(maj.statut, 'payee');
    vrai(maj.updatedAt >= avant, 'updatedAt non mis à jour');
    egal((await stockage.listerDocuments()).filter((d) => d.id === sauve.id).length, 1);
  });

  test('suppression effective', async () => {
    const sauve = await stockage.enregistrerDocument(documentTest({ numero: 'F-2026-9003' }));
    await stockage.supprimerDocument(sauve.id);
    egal(await stockage.obtenirDocument(sauve.id), undefined);
  });

  test('un document est normalisé même s\'il est incomplet', async () => {
    const sauve = await stockage.enregistrerDocument({});
    egal(Array.isArray(sauve.lignes), true);
    egal(Array.isArray(sauve.paiements), true);
    egal(sauve.statut, 'brouillon');
    egal(sauve.type, 'facture');
  });
});

/* --------------------------------------------------------- numérotation */
decrire('Numérotation unique', () => {
  test('les numéros réservés sont consécutifs et uniques', async () => {
    const reglages = parametres.lire();
    const numeros = [];
    for (let i = 0; i < 5; i++) {
      numeros.push(await stockage.reserverNumero('facture', reglages, '2026-10-15'));
    }
    egal(new Set(numeros).size, 5, 'doublon détecté : ' + numeros.join(', '));
    egal(numeros[0], 'F-2026-0001'.replace('0001', String(1).padStart(4, '0')));
    egal(numeros[4].slice(-4), '0005');
  });

  test('un numéro déjà attribué n\'est jamais réattribué', async () => {
    const reglages = parametres.lire();
    const d = documentTest({ numero: await stockage.reserverNumero('facture', reglages, '2026-10-15') });
    const sauve = await stockage.enregistrerDocument(d);
    await stockage.supprimerDocument(sauve.id);
    // même après suppression, le compteur a progressé
    const suivant = await stockage.prochainNumero('facture', reglages, '2026-10-15');
    egal(suivant.slice(-4), '0007');
    const reserve = await stockage.reserverNumero('facture', reglages, '2026-10-15');
    egal(reserve, suivant);
  });

  test('les reçus utilisent leur propre compteur', async () => {
    const reglages = parametres.lire();
    const numero = await stockage.reserverNumero('recu', reglages, '2026-10-15');
    egal(numero.startsWith('R-'), true, 'préfixe inattendu : ' + numero);
  });

  test('la remise à zéro annuelle sépare les compteurs', async () => {
    const reglages = parametres.enregistrer({ numerotation: { remiseAZero: 'annuel' } });
    const en2026 = await stockage.reserverNumero('facture', reglages, '2026-10-15');
    const en2027 = await stockage.reserverNumero('facture', reglages, '2027-01-05');
    // le compteur 2026 a déjà progressé, celui de 2027 repart de zéro
    egal(en2026.slice(-4), '0008');
    egal(en2027.slice(-4), '0001');
    vrai(en2026.includes('2026') && en2027.includes('2027'));
  });

  test('le modèle de numéro accepte les jetons', async () => {
    const reglages = parametres.enregistrer({
      numerotation: { modele: '{PREFIX}/{AA}{MM}/{SEQ5}', remiseAZero: 'jamais', prefixeFacture: 'FA' }
    });
    const numero = await stockage.reserverNumero('facture', reglages, '2026-03-04');
    egal(numero, 'FA/2603/00001');
  });

  test('prochainNumero n\'est pas consommé', async () => {
    const reglages = parametres.enregistrer({ numerotation: { modele: '{PREFIX}-{AAAA}-{SEQ4}', remiseAZero: 'jamais' } });
    const a = await stockage.prochainNumero('facture', reglages, '2026-10-15');
    const b = await stockage.prochainNumero('facture', reglages, '2026-10-15');
    egal(a, b);
  });

  test('synchroniserCompteurs recale le compteur sur les documents existants', async () => {
    await stockage.effacerTout();
    const reglages = parametres.enregistrer({
      numerotation: { modele: '{PREFIX}-{AAAA}-{SEQ4}', remiseAZero: 'jamais', prefixeFacture: 'F' }
    });
    await stockage.enregistrerDocument(documentTest({ numero: 'F-2026-0450', dateEmission: '2026-10-15' }));
    await stockage.synchroniserCompteurs(reglages, await stockage.listerDocuments());
    const suivant = await stockage.prochainNumero('facture', reglages, '2026-10-15');
    egal(suivant, 'F-2026-0451');
  });
});

/* ------------------------------------------------------ export / import */
decrire('Sauvegarde, restauration et effacement', () => {
  test('l\'export contient les documents, les compteurs et les réglages', async () => {
    await stockage.enregistrerDocument(documentTest({ numero: 'F-2026-1000' }));
    const donnees = await stockage.exporterDonnees();
    egal(donnees.format, stockage.FORMAT_EXPORT);
    vrai(Array.isArray(donnees.documents) && donnees.documents.length > 0);
    vrai(Array.isArray(donnees.compteurs));
    vrai(!!donnees.exporteLe);
    JSON.parse(JSON.stringify(donnees)); // sérialisable
  });

  test('un fichier étranger est rejeté', async () => {
    let erreur = null;
    try {
      await stockage.importerDonnees({ format: 'autre-chose', documents: [] }, { mode: 'remplacer' });
    } catch (e) { erreur = e; }
    vrai(!!erreur, 'aucune erreur levée');
    vrai(/Agora Factures/.test(erreur.message), 'message inattendu : ' + erreur.message);
  });

  test('une sauvegarde sans documents est rejetée', async () => {
    let erreur = null;
    try {
      await stockage.importerDonnees({ format: stockage.FORMAT_EXPORT }, { mode: 'remplacer' });
    } catch (e) { erreur = e; }
    vrai(!!erreur, 'aucune erreur levée');
  });

  test('restauration en mode « remplacer »', async () => {
    const sauvegarde = {
      format: stockage.FORMAT_EXPORT,
      version: 1,
      documents: [Object.assign(documentTest({ numero: 'F-2025-0001' }), { id: 'doc_import_1' })],
      compteurs: []
    };
    const compteur = await stockage.importerDonnees(sauvegarde, { mode: 'remplacer' });
    egal(compteur.ajoutes, 1);
    const liste = await stockage.listerDocuments();
    egal(liste.length, 1);
    egal(liste[0].id, 'doc_import_1');
  });

  test('restauration en mode « fusionner » (pas de doublon)', async () => {
    const sauvegarde = {
      format: stockage.FORMAT_EXPORT,
      documents: [
        Object.assign(documentTest({ numero: 'F-2025-0001' }), { id: 'doc_import_1' }),
        Object.assign(documentTest({ numero: 'F-2025-0002' }), { id: 'doc_import_2' })
      ]
    };
    const compteur = await stockage.importerDonnees(sauvegarde, { mode: 'fusionner' });
    egal(compteur.ignores, 1);
    egal(compteur.ajoutes, 1);
    egal((await stockage.listerDocuments()).length, 2);
  });

  test('effacement total', async () => {
    await stockage.effacerTout();
    egal((await stockage.listerDocuments()).length, 0);
    egal((await stockage.listerCompteurs()).length, 0);
    egal(await stockage.lireMeta('logo'), null);
  });
});

/* --------------------------------------------------------------- logo */
decrire('Métadonnées (logo) et préférences', () => {
  test('le logo est stocké dans IndexedDB', async () => {
    await stockage.ecrireMeta('logo', 'data:image/png;base64,AAAA');
    egal(await stockage.lireMeta('logo'), 'data:image/png;base64,AAAA');
    await stockage.supprimerMeta('logo');
    egal(await stockage.lireMeta('logo'), null);
  });

  test('les préférences sont persistées dans localStorage', async () => {
    parametres.enregistrer({ devise: 'EUR', vendeur: { nom: 'Ma société' } });
    const brut = JSON.parse(globalThis.localStorage.getItem(stockage.CLE_REGLEGES));
    egal(brut.devise, 'EUR');
    egal(brut.vendeur.nom, 'Ma société');
  });

  test('les réglages sont assainis (valeurs bornées et typées)', async () => {
    const propre = parametres.assainir({
      devise: 'eur',
      decimales: 99,
      tva: { active: 'oui', tauxDefaut: 500, mode: 'bizarre' },
      numerotation: { modele: 'SANS-SEQ', depart: -5 },
      document: { modele: 'inconnu' }
    });
    egal(propre.devise, 'EUR');
    egal(propre.decimales <= 4, true);
    egal(propre.tva.active, true);
    egal(propre.tva.tauxDefaut <= 100, true);
    egal(propre.tva.mode, 'exclusive');
    egal(propre.numerotation.modele.includes('{SEQ'), true);
    egal(propre.numerotation.depart >= 0, true);
    egal(propre.document.modele, 'classique');
  });

  test('la réinitialisation restaure les valeurs par défaut', async () => {
    parametres.reinitialiser();
    const r = parametres.lire();
    egal(r.devise, 'XOF');
    egal(r.numerotation.prefixeFacture, 'F');
    egal(r.tva.tauxDefaut, 18);
  });
});

/* ---------------------------------------------------------- intégration */
decrire('Cohérence des montants après rechargement', () => {
  test('les montants sont recalculables depuis les lignes seules', async () => {
    await stockage.effacerTout();
    const doc = documentTest({
      numero: 'F-2026-7777',
      paiements: [{ id: 'p1', date: '2026-10-15', montant: 50000, methode: 'Especes' }]
    });
    const sauve = await stockage.enregistrerDocument(doc);
    delete sauve.montants;              // on ne fait jamais confiance au champ mis en cache
    const m = AGORA.documents.montants(sauve);
    egal(m.sousTotal, 100000);          // 2 × 50 000
    egal(m.remisesLignes, 10000);       // 10 %
    egal(m.baseImposable, 90000);
    egal(m.tva, 16200);                 // 18 % de 90 000
    egal(m.total, 106200);
    egal(m.totalPaye, 50000);
    egal(m.solde, 56200);
  });

  test('le statut découle des paiements enregistrés', async () => {
    const liste = await stockage.listerDocuments();
    const doc = liste[0];
    const m = AGORA.documents.montants(doc);
    egal(calculs.statutSelonPaiement(m.total, m.totalPaye, 'en_attente'), 'partielle');
  });

  test('la duplication ne réutilise pas le numéro', async () => {
    const liste = await stockage.listerDocuments();
    const copie = AGORA.documents.dupliquer(liste[0], false);
    egal(copie.numero, null);
    egal(copie.statut, 'brouillon');
    egal(copie.paiements.length, 0);
    egal(copie.lignes.length, 1);
  });
});

// Exécution séquentielle de la file de tests (les tests asynchrones sont attendus).
await bilan('Stockage');
