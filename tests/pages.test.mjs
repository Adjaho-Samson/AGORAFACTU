/* ==========================================================================
   Tests d'intégration dans un DOM simulé (jsdom + fake-indexeddb).
   Chaque page est réellement chargée avec ses scripts : on vérifie qu'aucune
   erreur JavaScript n'est levée, que l'interface se construit (aperçu,
   lignes, filtres, indicateurs) et que le parcours « créer → enregistrer →
   retrouver dans l'historique » fonctionne de bout en bout.
   Exécution : node tests/pages.test.mjs
   ========================================================================== */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { decrire, test, egal, vrai, bilan } = await import('./micro-test.mjs');

/** Charge une page HTML avec ses scripts locaux. */
async function chargerPage(cheminRelatif, options = {}) {
  const [cheminPage, query] = String(cheminRelatif).split('?');
  const chemin = resolve(RACINE, cheminPage);
  const erreurs = [];
  const consoleVirtuelle = new VirtualConsole();
  consoleVirtuelle.on('jsdomError', (e) => {
    // jsdom ne sait pas exécuter window.print() : ce n'est pas une erreur applicative
    if (/Not implemented/.test(e.message)) return;
    erreurs.push(e.message + (e.detail ? '\n' + String(e.detail).split('\n').slice(0, 4).join('\n') : ''));
  });
  consoleVirtuelle.on('error', (message) => erreurs.push('console.error: ' + message));

  // URL « https » fictive : les scripts sont injectés manuellement, mais
  // l'application se comporte comme en production (history, chemins relatifs).
  const urlPublique = 'https://app.local/' + cheminPage.replace(/^\.?\//, '') + (query ? '?' + query : '');

  const dom = new JSDOM(readFileSync(chemin, 'utf8'), {
    url: urlPublique,
    runScripts: 'dangerously',
    resources: undefined,          // les scripts locaux sont exécutés manuellement
    pretendToBeVisual: true,
    virtualConsole: consoleVirtuelle
  });

  const { window } = dom;
  // Environnement minimal : IndexedDB (fake) et stockage
  // Base IndexedDB isolée par page chargée (les tests ne se polluent pas entre eux),
  // sauf si une base est explicitement partagée entre deux fenêtres.
  window.indexedDB = options.base || new IDBFactory();
  window.IDBKeyRange = globalThis.IDBKeyRange;
  if (!window.crypto || typeof window.crypto.getRandomValues !== 'function') {
    Object.defineProperty(window, 'crypto', {
      configurable: true,
      value: {
        getRandomValues: (tableau) => {
          for (let i = 0; i < tableau.length; i++) tableau[i] = Math.floor(Math.random() * 256);
          return tableau;
        }
      }
    });
  }

  // Exécution manuelle des scripts locaux, dans l'ordre du document
  const html = readFileSync(chemin, 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const enLigne = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

  for (const src of scripts) {
    const fichier = resolve(dirname(chemin), src);
    const code = readFileSync(fichier, 'utf8');
    const element = window.document.createElement('script');
    element.textContent = code;
    window.document.body.appendChild(element);
  }
  for (const code of enLigne) {
    const element = window.document.createElement('script');
    element.textContent = code;
    window.document.body.appendChild(element);
  }

  // Laisse le temps aux promesses (IndexedDB, logo) de se résoudre
  await new Promise((r) => setTimeout(r, options.attente || 250));
  return { dom, window, document: window.document, erreurs, AGORA: window.AGORA };
}

function viderErreurs(erreurs) {
  return erreurs.filter((e) => !/Not implemented|Could not parse CSS|Error: Not implemented/i.test(e));
}

/** Date ISO décalée de N jours par rapport à aujourd'hui (tests stables dans le temps). */
function isoJours(decalage) {
  const d = new Date();
  d.setDate(d.getDate() + decalage);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * Jeu de données de démonstration (118 000 chacun) :
 *   F-2026-0001 · Alpha SARL · en attente · J-3   (dans la fenêtre 30 jours)
 *   F-2026-0002 · Beta SA    · payée      · J-2   (dans la fenêtre 30 jours)
 *   R-2026-0001 · Gamma      · reçu payé  · J-40  (hors fenêtre 30 jours)
 */
async function semerJeu(window) {
  const stockage = window.AGORA.stockage;
  const base = {
    type: 'facture', statut: 'en_attente', devise: 'XOF',
    tvaActive: true, tvaMode: 'exclusive', modeRemise: 'pourcent', modele: 'classique',
    remiseGlobale: { type: 'pourcent', valeur: 0 },
    vendeur: { nom: 'Vendeur' },
    lignes: [{ designation: 'A', quantite: 1, prixUnitaire: 100000, remise: 0, tauxTva: 18 }],
    paiements: []
  };
  await stockage.enregistrerDocument(Object.assign({}, base, {
    numero: 'F-2026-0001', client: { nom: 'Alpha SARL' }, dateEmission: isoJours(-3)
  }));
  await stockage.enregistrerDocument(Object.assign({}, base, {
    numero: 'F-2026-0002', client: { nom: 'Beta SA' }, statut: 'payee', dateEmission: isoJours(-2),
    paiements: [{ id: 'p1', date: isoJours(-2), montant: 118000, methode: 'Especes' }]
  }));
  await stockage.enregistrerDocument(Object.assign({}, base, {
    numero: 'R-2026-0001', type: 'recu', client: { nom: 'Gamma' }, statut: 'payee',
    dateEmission: isoJours(-40), dateEcheance: null,
    paiements: [{ id: 'p2', date: isoJours(-40), montant: 118000, methode: 'Virement' }]
  }));
}

/* ------------------------------------------------------------------ pages */
decrire('Chargement des pages (aucune erreur JavaScript)', () => {
  const pages = ['index.html', 'pages/dashboard.html', 'pages/facture.html', 'pages/historique.html', 'pages/parametres.html'];
  const chargees = new Map();

  pages.forEach((page) => {
    test(page + ' se charge sans erreur', async () => {
      const resultat = await chargerPage(page);
      chargees.set(page, resultat);
      const probleme = viderErreurs(resultat.erreurs);
      egal(probleme.join(' | '), '', 'erreurs JS : ' + probleme.join(' | '));
      vrai(!!resultat.AGORA, 'espace de noms AGORA absent');
      vrai(!!resultat.AGORA.calculs && !!resultat.AGORA.stockage, 'modules non chargés');
    });
  });

  test('la navigation est présente sur chaque page', async () => {
    for (const page of pages) {
      const resultat = chargees.get(page) || await chargerPage(page);
      const liens = [...resultat.document.querySelectorAll('.app-nav a')].map((a) => a.getAttribute('href'));
      egal(liens.length, 5, page + ' : ' + liens.length + ' liens de navigation');
      vrai(resultat.document.querySelector('[aria-current="page"]') !== null, page + ' : page courante non marquée');
    }
  });

  test('l\'indicateur de connexion est présent partout', async () => {
    for (const page of pages) {
      const resultat = chargees.get(page) || await chargerPage(page);
      vrai(!!resultat.document.querySelector('#indicateur-connexion'), page + ' : indicateur absent');
      vrai(!!resultat.document.querySelector('#zone-notifications'), page + ' : zone de notification absente');
    }
  });
});

/* --------------------------------------------------------------- éditeur */
decrire('Éditeur de document (facture.html)', () => {
  test('une ligne vide et un aperçu sont créés au chargement', async () => {
    const { document: doc, erreurs } = await chargerPage('pages/facture.html');
    egal(viderErreurs(erreurs).join('|'), '');
    egal(doc.querySelectorAll('#corps-lignes tr').length, 1);
    vrai(!!doc.querySelector('#zone-apercu .doc'), 'aperçu non rendu');
    vrai(doc.querySelector('#zone-apercu .doc').classList.contains('modele-classique'), 'modèle par défaut absent');
  });

  test('la saisie d\'une ligne met à jour les totaux et l\'aperçu', async () => {
    const { document: doc, window, erreurs } = await chargerPage('pages/facture.html');
    const designation = doc.querySelector('.ligne-designation');
    const quantite = doc.querySelector('.ligne-quantite');
    const prix = doc.querySelector('.ligne-prix');
    const tva = doc.querySelector('.ligne-tva');

    designation.value = 'Consultation';
    designation.dispatchEvent(new window.Event('input', { bubbles: true }));
    quantite.value = '3';
    prix.value = '10000';
    tva.value = '18';
    prix.dispatchEvent(new window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));

    egal(doc.querySelector('#resume-sous-total').textContent.replace(/\s/g, ' '), '30 000 XOF');
    egal(doc.querySelector('#resume-tva').textContent.replace(/\s/g, ' '), '5 400 XOF');
    egal(doc.querySelector('#resume-total').textContent.replace(/\s/g, ' '), '35 400 XOF');
    vrai(doc.querySelector('#zone-apercu').textContent.includes('Consultation'), 'désignation absente de l\'aperçu');
    egal(viderErreurs(erreurs).join('|'), '');
  });

  test('une valeur numérique invalide est signalée et ignorée', async () => {
    const { document: doc, window } = await chargerPage('pages/facture.html');
    const quantite = doc.querySelector('.ligne-quantite');
    quantite.value = 'abc';
    quantite.dispatchEvent(new window.Event('input', { bubbles: true }));
    quantite.dispatchEvent(new window.Event('blur', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    vrai(quantite.classList.contains('invalide'), 'champ non marqué comme invalide');
    vrai(quantite.parentNode.querySelector('.erreur').textContent.length > 0, 'message d\'erreur non affiché');
    const total = doc.querySelector('#resume-total').textContent;
    vrai(/0 XOF|0,00/.test(total), 'total inattendu : ' + total);
  });

  test('ajouter puis supprimer une ligne fonctionne', async () => {
    const { document: doc, window } = await chargerPage('pages/facture.html');
    doc.querySelector('#ajouter-ligne').click();
    await new Promise((r) => setTimeout(r, 20));
    egal(doc.querySelectorAll('#corps-lignes tr').length, 2);
    const boutons = doc.querySelectorAll('#corps-lignes tr button');
    boutons[1].click();
    await new Promise((r) => setTimeout(r, 20));
    egal(doc.querySelectorAll('#corps-lignes tr').length, 1);
  });

  test('enregistrer un brouillon attribue un numéro et persiste le document', async () => {
    const { document: doc, window, erreurs } = await chargerPage('pages/facture.html');
    doc.querySelector('#vendeur-nom').value = 'Boutique Test';
    doc.querySelector('#client-nom').value = 'Client Test';
    const designation = doc.querySelector('.ligne-designation');
    designation.value = 'Article';
    designation.dispatchEvent(new window.Event('input', { bubbles: true }));
    const prix = doc.querySelector('.ligne-prix');
    prix.value = '5000';
    prix.dispatchEvent(new window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));

    doc.querySelector('#bouton-brouillon').click();
    await new Promise((r) => setTimeout(r, 300));

    const etat = window.AGORA.factures.etat;
    egal(etat.doc.statut, 'brouillon');
    vrai(!!etat.doc.id, 'identifiant non attribué');
    vrai(/^F-\d{4}-\d{4}$/.test(etat.doc.numero || ''), 'numéro inattendu : ' + etat.doc.numero);
    egal(doc.querySelector('#doc-numero').value, etat.doc.numero);
    const liste = await window.AGORA.stockage.listerDocuments();
    egal(liste.length, 1);
    egal(viderErreurs(erreurs).join('|'), '');
  });

  test('ouvrir un brouillon existant pré-remplit le formulaire', async () => {
    // On crée d'abord le brouillon dans une fenêtre, puis on l'ouvre par son
    // identifiant dans une seconde fenêtre partageant la même base IndexedDB.
    const base = new IDBFactory();
    const creation = await chargerPage('pages/facture.html', { base, attente: 250 });
    const docCreation = creation.document;
    docCreation.querySelector('#vendeur-nom').value = 'Vendeur Enregistré';
    docCreation.querySelector('#client-nom').value = 'Client Enregistré';
    const designation = docCreation.querySelector('.ligne-designation');
    designation.value = 'Article sauvegardé';
    designation.dispatchEvent(new creation.window.Event('input', { bubbles: true }));
    const prix = docCreation.querySelector('.ligne-prix');
    prix.value = '2500';
    prix.dispatchEvent(new creation.window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    docCreation.querySelector('#bouton-brouillon').click();
    await new Promise((r) => setTimeout(r, 250));
    const id = creation.window.AGORA.factures.etat.doc.id;
    const numero = creation.window.AGORA.factures.etat.doc.numero;
    vrai(!!id, 'brouillon non enregistré');

    const edition = await chargerPage('pages/facture.html?id=' + encodeURIComponent(id), { base, attente: 350 });
    const etat = edition.window.AGORA.factures.etat;
    vrai(!!etat.doc, 'aucun document chargé');
    egal(etat.doc.id, id);
    egal(etat.doc.numero, numero, 'le numéro déjà attribué doit être conservé');
    egal(edition.document.querySelector('#client-nom').value, 'Client Enregistré');
    egal(viderErreurs(edition.erreurs).join("|"), "");
  });

  test('la duplication propose un document vierge de numéro', async () => {
    const { window } = await chargerPage('pages/facture.html', { attente: 250 });
    const source = await window.AGORA.stockage.enregistrerDocument({
      type: 'facture', numero: 'F-2026-0100', statut: 'payee', dateEmission: '2026-10-01',
      devise: 'XOF', tvaActive: true, tvaMode: 'exclusive', modeRemise: 'pourcent', modele: 'moderne',
      remiseGlobale: { type: 'pourcent', valeur: 0 },
      vendeur: { nom: 'V' }, client: { nom: 'C' },
      lignes: [{ designation: 'A', quantite: 2, prixUnitaire: 1000, remise: 0, tauxTva: 18 }],
      paiements: [{ id: 'p1', date: '2026-10-01', montant: 2360, methode: 'Especes' }]
    });
    const copie = window.AGORA.documents.dupliquer(source, false);
    egal(copie.numero, null);
    egal(copie.id, null);
    egal(copie.statut, 'brouillon');
    egal(copie.paiements.length, 0);
    egal(copie.lignes.length, 1);
    egal(copie.modele, 'moderne');
    egal(window.AGORA.documents.montants(copie).total, 2360);
  });

  test('la prévisualisation et l\'impression préparent un document A4', async () => {
    const { document: doc, window } = await chargerPage('pages/facture.html', { attente: 250 });
    doc.querySelector('#bouton-apercu').click();
    await new Promise((r) => setTimeout(r, 80));
    const modale = doc.querySelector('.fond-modale');
    vrai(!!modale, 'modale d\'aperçu absente');
    vrai(!!modale.querySelector('.doc'), 'document non rendu dans la modale');
    vrai(modale.textContent.includes('Imprimer') && modale.textContent.includes('PDF'),
      'actions d\'impression absentes');

    doc.querySelector('#bouton-imprimer').click();
    await new Promise((r) => setTimeout(r, 120));
    const zone = doc.querySelector('#zone-impression');
    vrai(!!zone, 'zone d\'impression absente');
    vrai(!!zone.querySelector('.doc'), 'document non préparé pour l\'impression');
    vrai(doc.body.classList.contains('mode-impression'), 'classe d\'impression absente');
    egal(viderErreurs([]).join('|'), '');
  });

  test('passer en reçu rend le paiement obligatoire', async () => {
    const { document: doc, window } = await chargerPage('pages/facture.html');
    const recu = doc.querySelector('#type-recu');
    recu.checked = true;
    recu.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    vrai(doc.querySelector('#titre-page-editeur').textContent.includes('reçu'), 'titre non mis à jour');
    vrai(doc.querySelector('#paiement-actif').checked, 'le paiement doit être coché pour un reçu');
    // sans montant -> refus de l'émission
    doc.querySelector('#vendeur-nom').value = 'V';
    doc.querySelector('#client-nom').value = 'C';
    const designation = doc.querySelector('.ligne-designation');
    designation.value = 'X';
    designation.dispatchEvent(new window.Event('input', { bubbles: true }));
    const prix = doc.querySelector('.ligne-prix');
    prix.value = '1000';
    prix.dispatchEvent(new window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    doc.querySelector('#bouton-enregistrer').click();
    await new Promise((r) => setTimeout(r, 200));
    egal(window.AGORA.factures.etat.doc.id, null, 'un reçu sans paiement ne doit pas être émis');
    vrai(doc.querySelector('#zone-notifications').textContent.includes('paiement'),
      'message d\'erreur attendu, reçu : ' + doc.querySelector('#zone-notifications').textContent);
  });
});

/* ------------------------------------------------------------ historique */
decrire('Historique (historique.html)', () => {
  test('l\'état vide s\'affiche sans document', async () => {
    const { document: doc, erreurs } = await chargerPage('pages/historique.html', { attente: 400 });
    egal(viderErreurs(erreurs).join('|'), '');
    vrai(!doc.querySelector('#etat-vide-historique').classList.contains('cache'), 'état vide non affiché');
    vrai(doc.querySelector('#conteneur-tableau').classList.contains('cache'), 'tableau masqué attendu');
  });

  test('les documents enregistrés apparaissent, la recherche et les filtres fonctionnent', async () => {
    const { window, document: doc, erreurs } = await chargerPage('pages/historique.html', { attente: 250 });
    await semerJeu(window);
    await window.AGORA.historique.rafraichir();

    egal(viderErreurs(erreurs).join('|'), '');
    egal(doc.querySelectorAll('#corps-historique tr').length, 3);

    // recherche par client
    const recherche = doc.querySelector('#filtre-recherche');
    recherche.value = 'beta';
    recherche.dispatchEvent(new window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    egal(doc.querySelectorAll('#corps-historique tr').length, 1);
    vrai(doc.querySelector('#corps-historique').textContent.includes('Beta'), 'mauvais résultat de recherche');

    // recherche par numéro
    recherche.value = 'R-2026';
    recherche.dispatchEvent(new window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    egal(doc.querySelectorAll('#corps-historique tr').length, 1);
    vrai(doc.querySelector('#corps-historique').textContent.includes('Reçu'));

    // filtre par type
    recherche.value = '';
    recherche.dispatchEvent(new window.Event('input', { bubbles: true }));
    const type = doc.querySelector('#filtre-type');
    type.value = 'facture';
    type.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    egal(doc.querySelectorAll('#corps-historique tr').length, 2);

    // filtre par statut
    type.value = 'tout';
    type.dispatchEvent(new window.Event('change', { bubbles: true }));
    const statut = doc.querySelector('#filtre-statut');
    statut.value = 'payee';
    statut.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    egal(doc.querySelectorAll('#corps-historique tr').length, 2);

    // tri par montant
    statut.value = 'tout';
    statut.dispatchEvent(new window.Event('change', { bubbles: true }));
    const tri = doc.querySelector('#filtre-tri');
    tri.value = 'montant';
    tri.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    egal(doc.querySelectorAll('#corps-historique tr').length, 3);

    // réinitialisation
    doc.querySelector('#filtres-reinitialiser').click();
    await new Promise((r) => setTimeout(r, 30));
    egal(doc.querySelectorAll('#corps-historique tr').length, 3);
  });

  test('les actions destructives demandent une confirmation', async () => {
    const { document: doc, window } = await chargerPage('pages/historique.html', { attente: 250 });
    await semerJeu(window);
    // un brouillon : c'est le seul cas où la suppression est proposée
    await window.AGORA.stockage.enregistrerDocument({
      type: 'facture', numero: 'F-2026-0003', statut: 'brouillon', dateEmission: isoJours(-1),
      devise: 'XOF', tvaActive: true, tvaMode: 'exclusive', modeRemise: 'pourcent', modele: 'classique',
      remiseGlobale: { type: 'pourcent', valeur: 0 }, vendeur: { nom: 'Vendeur' },
      client: { nom: 'Delta' },
      lignes: [{ designation: 'A', quantite: 1, prixUnitaire: 1000, remise: 0, tauxTva: 0 }],
      paiements: []
    });
    await window.AGORA.historique.rafraichir();
    const lignes = doc.querySelectorAll('#corps-historique tr');
    vrai(lignes.length >= 1);
    const boutonSupprimer = [...lignes[0].querySelectorAll('button')]
      .find((b) => (b.getAttribute('aria-label') || '').startsWith('Supprimer'));
    if (boutonSupprimer) {
      boutonSupprimer.click();
      await new Promise((r) => setTimeout(r, 60));
      vrai(!!doc.querySelector('.fond-modale'), 'aucune confirmation affichée');
      vrai(doc.querySelector('.fond-modale').textContent.includes('Supprimer'), 'libellé de confirmation absent');
    }
  });

  test('l\'enregistrement d\'un paiement partiel met à jour le statut et le solde', async () => {
    const { document: doc, window } = await chargerPage('pages/historique.html', { attente: 250 });
    await semerJeu(window);
    await window.AGORA.historique.rafraichir();

    const boutonPayer = doc.querySelector('#corps-historique tr button[aria-label^="Enregistrer un paiement"]');
    vrai(!!boutonPayer, 'bouton de paiement absent');
    boutonPayer.click();
    await new Promise((r) => setTimeout(r, 120));

    const modale = doc.querySelector('.fond-modale');
    vrai(!!modale, 'modale de paiement absente');
    const champMontant = doc.querySelector('#p-montant');
    vrai(!!champMontant, 'champ montant absent');
    egal(champMontant.value, '118000');

    champMontant.value = '50000';
    const boutonEnregistrer = [...modale.querySelectorAll('button')].find((b) => b.textContent === 'Enregistrer');
    boutonEnregistrer.click();
    await new Promise((r) => setTimeout(r, 300));

    const liste = await window.AGORA.stockage.listerDocuments();
    const facture = liste.find((d) => d.numero === 'F-2026-0001');
    egal(facture.statut, 'partielle');
    egal(facture.paiements.length, 1);
    egal(facture.paiements[0].montant, 50000);
    const m = window.AGORA.documents.montants(facture);
    egal(m.solde, 68000);

    // le tableau est bien rafraîchi
    await new Promise((r) => setTimeout(r, 120));
    vrai(doc.querySelector('#corps-historique').textContent.includes('Partiellement payée'),
      'statut non mis à jour dans le tableau');
  });

  test('la consultation ouvre un aperçu imprimable', async () => {
    const { document: doc, window } = await chargerPage('pages/historique.html', { attente: 250 });
    await semerJeu(window);
    await window.AGORA.historique.rafraichir();
    const boutonVoir = doc.querySelector('#corps-historique tr button[aria-label^="Consulter"]');
    vrai(!!boutonVoir, 'bouton de consultation absent');
    boutonVoir.click();
    await new Promise((r) => setTimeout(r, 200));
    vrai(!!doc.querySelector('.fond-modale .doc'), 'aperçu non ouvert');
    vrai(doc.querySelector('.fond-modale').textContent.includes('Imprimer'), 'action d\'impression absente');
  });
});

/* ------------------------------------------------------------ dashboard */
decrire('Tableau de bord (dashboard.html)', () => {
  test('les indicateurs reflètent les documents enregistrés', async () => {
    const { window, document: doc, erreurs } = await chargerPage('pages/dashboard.html', { attente: 250 });
    await semerJeu(window);
    await window.AGORA.dashboard.charger();
    egal(viderErreurs(erreurs).join('|'), '');
    // Période par défaut : 30 derniers jours -> les 2 factures seulement
    egal(doc.querySelector('#kpi-documents').textContent, '2');
    egal(doc.querySelector('#kpi-payes').textContent, '1');
    egal(doc.querySelector('#kpi-impayes').textContent, '1');
    egal(doc.querySelector('#kpi-annules').textContent, '0');
    vrai(/118\s?000/.test(doc.querySelector('#kpi-encaisse').textContent), 'encaissé : ' + doc.querySelector('#kpi-encaisse').textContent);
    vrai(/236\s?000/.test(doc.querySelector('#kpi-facture').textContent), 'facturé : ' + doc.querySelector('#kpi-facture').textContent);
    vrai(/118\s?000/.test(doc.querySelector('#kpi-reste').textContent), 'reste : ' + doc.querySelector('#kpi-reste').textContent);
  });

  test('la période « depuis le début » inclut tous les documents', async () => {
    const { window, document: doc } = await chargerPage('pages/dashboard.html', { attente: 250 });
    await semerJeu(window);
    await window.AGORA.dashboard.charger();
    const selecteur = doc.querySelector('#periode-tableau-de-bord');
    selecteur.value = 'tout';
    selecteur.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    egal(doc.querySelector('#kpi-documents').textContent, '3');
    egal(doc.querySelector('#kpi-payes').textContent, '2');
    vrai(/236\s?000/.test(doc.querySelector('#kpi-encaisse').textContent), 'encaissé : ' + doc.querySelector('#kpi-encaisse').textContent);
  });

  test('le graphique et la répartition sont rendus', async () => {
    const { window, document: doc } = await chargerPage('pages/dashboard.html', { attente: 250 });
    await semerJeu(window);
    await window.AGORA.dashboard.charger();
    vrai(!!doc.querySelector('#zone-graphique svg'), 'graphique absent');
    vrai(doc.querySelectorAll('#zone-graphique rect').length >= 2, 'barres absentes');
    vrai(doc.querySelectorAll('#zone-repartition .repartition-ligne').length >= 1, 'répartition absente');
    vrai(doc.querySelectorAll('#corps-recents tr').length >= 1, 'documents récents absents');
  });

  test('un document annulé est exclu des montants encaissés', async () => {
    const { window } = await chargerPage('pages/dashboard.html', { attente: 250 });
    await semerJeu(window);
    const liste = await window.AGORA.stockage.listerDocuments();
    const cible = liste.find((d) => d.numero === 'F-2026-0001');
    cible.statut = 'annulee';
    await window.AGORA.stockage.enregistrerDocument(cible);
    const stats = window.AGORA.dashboard.calculerStats(await window.AGORA.stockage.listerDocuments(), null, null, false);
    // 2 documents payés restants (1 facture + 1 reçu)
    egal(stats.annules, 1);
    egal(stats.total, 2);
    egal(stats.encaisse, 236000);
  });

  test('le changement de période relance le calcul', async () => {
    const { document: doc, window } = await chargerPage('pages/dashboard.html', { attente: 250 });
    await semerJeu(window);
    await window.AGORA.dashboard.charger();
    const selecteur = doc.querySelector('#periode-tableau-de-bord');
    selecteur.value = 'tout';
    selecteur.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    vrai(doc.querySelector('#kpi-periode-libelle').textContent.includes('début'), 'libellé de période non mis à jour');
  });
});

/* ----------------------------------------------------------- paramètres */
decrire('Paramètres (parametres.html)', () => {
  test('les listes sont remplies et l\'aperçu de numérotation est affiché', async () => {
    const { document: doc, erreurs } = await chargerPage('pages/parametres.html', { attente: 400 });
    egal(viderErreurs(erreurs).join('|'), '');
    vrai(doc.querySelectorAll('#devise option').length > 10, 'devises non chargées');
    vrai(doc.querySelectorAll('#doc-modele option').length === 3, 'modèles non chargés');
    vrai(doc.querySelectorAll('#num-remise option').length === 3, 'modes de remise à zéro non chargés');
    vrai(/^F-/.test(doc.querySelector('#num-apercu-facture').textContent), 'aperçu facture : ' + doc.querySelector('#num-apercu-facture').textContent);
    vrai(/^R-/.test(doc.querySelector('#num-apercu-recu').textContent), 'aperçu reçu : ' + doc.querySelector('#num-apercu-recu').textContent);
  });

  test('la sauvegarde des paramètres est persistée', async () => {
    const { document: doc, window } = await chargerPage('pages/parametres.html', { attente: 400 });
    doc.querySelector('#v-nom').value = 'Ma Boutique';
    doc.querySelector('#devise').value = 'EUR';
    doc.querySelector('#tva-taux').value = '5,5';
    doc.querySelector('form#formulaire-parametres').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 100));
    const reglages = window.AGORA.parametres.lire();
    egal(reglages.vendeur.nom, 'Ma Boutique');
    egal(reglages.devise, 'EUR');
    egal(reglages.tva.tauxDefaut, 5.5);
    vrai(JSON.parse(window.localStorage.getItem(window.AGORA.stockage.CLE_REGLEGES)).vendeur.nom === 'Ma Boutique',
      'préférence non écrite dans localStorage');
  });

  test('un e-mail invalide est refusé', async () => {
    const { document: doc, window } = await chargerPage('pages/parametres.html', { attente: 400 });
    doc.querySelector('#v-nom').value = 'Test';
    doc.querySelector('#v-email').value = 'pas-un-email';
    doc.querySelector('form#formulaire-parametres').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 60));
    vrai(doc.querySelector('#zone-notifications').textContent.length > 0, 'aucun message affiché');
    vrai(doc.querySelector('#v-email').parentNode.querySelector('.erreur').textContent.length > 0, 'erreur de champ non affichée');
  });

  test('l\'effacement total exige la saisie EFFACER', async () => {
    const { document: doc } = await chargerPage('pages/parametres.html', { attente: 400 });
    doc.querySelector('#bouton-effacer').click();
    await new Promise((r) => setTimeout(r, 60));
    const modale = doc.querySelector('.fond-modale');
    vrai(!!modale, 'modale d\'effacement absente');
    const champs = [...modale.querySelectorAll('input')];
    vrai(champs.length === 1, 'champ de confirmation attendu');
    const bouton = [...modale.querySelectorAll('button')].find((b) => b.textContent.includes('Tout effacer'));
    bouton.click();
    await new Promise((r) => setTimeout(r, 60));
    vrai(modale.parentNode !== null, 'la modale doit rester ouverte sans la saisie EFFACER');
  });
});

/* --------------------------------------------------------- régressions métier */
decrire('Régressions métier (paiements, numérotation, sauvegardes)', () => {
  /** Crée une facture de 118 000 XOF avec un acompte de 50 000. */
  async function factureAcompte(base, options = {}) {
    const depot = await chargerPage('pages/facture.html', { base, attente: 200 });
    const doc = await depot.window.AGORA.stockage.enregistrerDocument({
      type: 'facture', numero: options.numero || 'F-2026-0500', statut: options.statut || 'partielle',
      dateEmission: isoJours(-1), devise: 'XOF',
      tvaActive: true, tvaMode: 'exclusive', modeRemise: 'pourcent', modele: 'classique',
      remiseGlobale: { type: 'pourcent', valeur: 0 },
      vendeur: { nom: 'Vendeur Test' }, client: { nom: 'Client Test' },
      lignes: [{ designation: 'Prestation', quantite: 1, prixUnitaire: 100000, remise: 0, tauxTva: 18 }],
      paiements: options.paiements || [{ id: 'p_acompte', date: isoJours(-1), montant: 50000, methode: 'Especes' }]
    });
    return { depot, doc };
  }

  test('« Marquer comme payée » complète le paiement, il ne l\'écrase pas', async () => {
    const base = new IDBFactory();
    const { doc: source } = await factureAcompte(base);
    const edition = await chargerPage('pages/facture.html?id=' + encodeURIComponent(source.id), { base, attente: 350 });
    const doc = edition.document;

    egal(edition.window.AGORA.factures.etat.doc.paiements.length, 1, 'l\'acompte doit être chargé');

    const bouton = doc.querySelector('#bouton-marquer-payee');
    vrai(!!bouton && !bouton.classList.contains('cache'), 'bouton « Marquer comme payée » non disponible');
    bouton.click();
    await new Promise((r) => setTimeout(r, 120));

    const modale = doc.querySelector('.fond-modale');
    vrai(!!modale, 'confirmation non affichée');
    [...modale.querySelectorAll('button')].find((b) => b.textContent.includes('Marquer payée')).click();
    await new Promise((r) => setTimeout(r, 400));

    const enregistre = (await edition.window.AGORA.stockage.listerDocuments())
      .find((d) => d.id === source.id);
    // Avant la correction, le formulaire ne conservait qu'un seul paiement :
    // l'acompte de 50 000 écrasait le règlement du solde (et inversement).
    egal(enregistre.paiements.length, 2, 'paiements attendus : acompte + solde');
    egal(enregistre.paiements[0].montant, 50000, 'l\'acompte doit être conservé');
    egal(enregistre.statut, 'payee', 'statut attendu : payée');
    egal(edition.window.AGORA.documents.montants(enregistre).solde, 0, 'le solde doit être nul');
  });

  test('un document à paiements multiples n\'est pas modifié par le formulaire', async () => {
    const base = new IDBFactory();
    const { doc: source } = await factureAcompte(base, {
      paiements: [
        { id: 'p1', date: isoJours(-2), montant: 50000, methode: 'Especes' },
        { id: 'p2', date: isoJours(-1), montant: 30000, methode: 'Virement' }
      ]
    });
    const edition = await chargerPage('pages/facture.html?id=' + encodeURIComponent(source.id), { base, attente: 350 });
    const doc = edition.document;

    // Une simple saisie ne doit jamais détruire les paiements enregistrés.
    const client = doc.querySelector('#client-nom');
    client.value = 'Client modifié';
    client.dispatchEvent(new edition.window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));

    egal(edition.window.AGORA.factures.etat.doc.paiements.length, 2, 'les deux paiements doivent subsister');
    vrai(!doc.querySelector('#note-paiements-multiples').classList.contains('cache'),
      'l\'information « paiements multiples » doit être affichée');
    vrai(doc.querySelector('#paiement-montant').disabled,
      'le champ de paiement doit être neutralisé quand il y a plusieurs règlements');

    // Et l'enregistrement conserve bien les deux paiements.
    doc.querySelector('#bouton-enregistrer').click();
    await new Promise((r) => setTimeout(r, 350));
    const enregistre = (await edition.window.AGORA.stockage.listerDocuments()).find((d) => d.id === source.id);
    egal(enregistre.paiements.length, 2, 'paiements perdus à l\'enregistrement');
    egal(enregistre.statut, 'partielle', 'statut attendu : partiellement payée');
  });

  test('la numérotation ne réattribue jamais un numéro déjà utilisé', async () => {
    const base = new IDBFactory();
    const premiere = await chargerPage('pages/facture.html', { base, attente: 250 });
    const doc = premiere.document;
    doc.querySelector('#vendeur-nom').value = 'Vendeur';
    doc.querySelector('#client-nom').value = 'Client';
    const designation = doc.querySelector('.ligne-designation');
    designation.value = 'Article';
    designation.dispatchEvent(new premiere.window.Event('input', { bubbles: true }));
    const prix = doc.querySelector('.ligne-prix');
    prix.value = '1000';
    prix.dispatchEvent(new premiere.window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    doc.querySelector('#bouton-enregistrer').click();
    await new Promise((r) => setTimeout(r, 300));
    const numero1 = premiere.window.AGORA.factures.etat.doc.numero;

    // Deuxième document : numéro forcément différent, même après suppression.
    const seconde = await chargerPage('pages/facture.html', { base, attente: 250 });
    const doc2 = seconde.document;
    doc2.querySelector('#vendeur-nom').value = 'Vendeur';
    doc2.querySelector('#client-nom').value = 'Client 2';
    const designation2 = doc2.querySelector('.ligne-designation');
    designation2.value = 'Article 2';
    designation2.dispatchEvent(new seconde.window.Event('input', { bubbles: true }));
    const prix2 = doc2.querySelector('.ligne-prix');
    prix2.value = '2000';
    prix2.dispatchEvent(new seconde.window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    doc2.querySelector('#bouton-enregistrer').click();
    await new Promise((r) => setTimeout(r, 300));
    const numero2 = seconde.window.AGORA.factures.etat.doc.numero;
    vrai(numero1 !== numero2, 'numéros identiques : ' + numero1 + ' / ' + numero2);
    vrai(parseInt(numero2.slice(-4), 10) > parseInt(numero1.slice(-4), 10), 'le compteur doit progresser');
  });

  test('un fichier de sauvegarde invalide est rejeté sans détruire les données', async () => {
    const base = new IDBFactory();
    const depot = await chargerPage('pages/parametres.html', { base, attente: 300 });
    await depot.window.AGORA.stockage.enregistrerDocument({
      type: 'facture', numero: 'F-2026-0900', statut: 'payee', dateEmission: isoJours(-1),
      devise: 'XOF', vendeur: { nom: 'V' }, client: { nom: 'C' },
      lignes: [{ designation: 'A', quantite: 1, prixUnitaire: 1000, remise: 0, tauxTva: 0 }],
      paiements: []
    });

    let erreur = null;
    try {
      await depot.window.AGORA.stockage.importerDonnees({ format: 'agora-factures-sauvegarde', documents: [1, 2, 3] }, { mode: 'remplacer' });
    } catch (e) { erreur = e; }
    vrai(!!erreur, 'une sauvegarde sans document valide doit être refusée');
    egal((await depot.window.AGORA.stockage.listerDocuments()).length, 1, 'les données existantes doivent être préservées');

    // Un logo distant ne doit jamais être stocké (confidentialité).
    const fusion = await depot.window.AGORA.stockage.importerDonnees({
      format: 'agora-factures-sauvegarde',
      documents: [{
        id: 'doc_x', type: 'facture', numero: 'F-2026-0910', statut: 'brouillon',
        dateEmission: isoJours(-1), devise: 'XOF', vendeur: { nom: 'V', logo: 'https://exemple.com/x.png' },
        client: { nom: 'C' }, lignes: [{ designation: 'A', quantite: '2', prixUnitaire: '1000', remise: 0, tauxTva: 18 }],
        paiements: [{ date: 'hier', montant: 'abc', methode: 'Especes' }]
      }],
      logo: 'https://exemple.com/malveillant.png'
    }, { mode: 'fusionner' });
    egal(fusion.ajoutes, 1);
    const importe = (await depot.window.AGORA.stockage.listerDocuments()).find((d) => d.id === 'doc_x');
    egal(importe.vendeur.logo, '', 'un logo distant ne doit pas être conservé');
    egal(importe.lignes[0].quantite, 2, 'les nombres texte doivent être convertis');
    egal(importe.paiements[0].montant, 0, 'un montant invalide doit être ramené à 0');
    vrai(/^\d{4}-\d{2}-\d{2}$/.test(importe.paiements[0].date), 'date de paiement normalisée attendue');
    egal(await depot.window.AGORA.stockage.lireMeta('logo'), null, 'le logo distant ne doit pas être importé');
    egal((await depot.window.AGORA.stockage.listerDocuments()).length, 2, 'la fusion doit conserver les documents existants');
  });

  test('la restauration recale les compteurs de numérotation', async () => {
    const base = new IDBFactory();
    const depot = await chargerPage('pages/parametres.html', { base, attente: 300 });
    await depot.window.AGORA.stockage.importerDonnees({
      format: 'agora-factures-sauvegarde',
      documents: [{
        id: 'doc_haut', type: 'facture', numero: 'F-2026-0042', statut: 'payee',
        dateEmission: isoJours(-1), devise: 'XOF', vendeur: { nom: 'V' }, client: { nom: 'C' },
        lignes: [{ designation: 'A', quantite: 1, prixUnitaire: 1000, remise: 0, tauxTva: 0 }], paiements: []
      }]
    }, { mode: 'fusionner' });
    const suivant = await depot.window.AGORA.stockage.prochainNumero('facture', depot.window.AGORA.parametres.lire(), isoJours(0));
    vrai(/0043$/.test(suivant), 'le prochain numéro doit suivre le plus haut existant : ' + suivant);
  });
});

await bilan('Pages (DOM simulé)');
