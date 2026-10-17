/* ==========================================================================
   Tests de l'aperçu A4 (mise à l'échelle, cohérence avec le PDF).
   --------------------------------------------------------------------------
   Un défaut a été constaté : le conteneur d'aperçu recevait la largeur
   RÉDUITE (largeur A4 × échelle). Comme « .doc { max-width: 100% } » résout
   sa largeur sur celle du conteneur, la feuille était mise en page à la
   largeur réduite puis réduite une seconde fois par la transformation :
   l'aperçu s'affichait deux fois trop petit, avec un retour à la ligne
   différent de celui du PDF. Ces tests verrouillent le comportement correct.
   Exécution : node tests/apercu.test.mjs
   ========================================================================== */
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';
import { decrire, test, egal, vrai, proche, bilan } from './micro-test.mjs';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Charge calculs.js + parametres.js + documents.js dans un DOM simulé. */
function chargerDocuments() {
  const erreurs = [];
  const consoleVirtuelle = new VirtualConsole();
  consoleVirtuelle.on('jsdomError', (e) => erreurs.push(e.message));
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://app.local/', runScripts: 'dangerously', pretendToBeVisual: true,
    virtualConsole: consoleVirtuelle
  });
  const { window } = dom;
  window.indexedDB = new IDBFactory();
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  ['js/app.js', 'js/calculs.js', 'js/parametres.js', 'js/documents.js'].forEach((src) => {
    const element = window.document.createElement('script');
    element.textContent = readFileSync(join(RACINE, src), 'utf8');
    window.document.body.appendChild(element);
  });
  if (erreurs.length) throw new Error('erreurs au chargement : ' + erreurs.join(' | '));
  return window;
}

/** Simule une largeur de conteneur et une hauteur de feuille (jsdom ne calcule rien). */
function fabriquer(window, largeurConteneur, hauteurFeuille) {
  const doc = window.document;
  const zone = doc.createElement('div');
  zone.className = 'zone-apercu';
  const conteneur = doc.createElement('div');
  conteneur.className = 'apercu-echelle';
  const feuille = doc.createElement('div');
  feuille.className = 'doc';
  conteneur.appendChild(feuille);
  zone.appendChild(conteneur);
  doc.body.appendChild(zone);
  Object.defineProperty(zone, 'clientWidth', { configurable: true, value: largeurConteneur });
  Object.defineProperty(feuille, 'offsetHeight', { configurable: true, value: hauteurFeuille });
  return { zone, conteneur, feuille };
}

const LARGEUR_A4 = 210 * (96 / 25.4);   // 794 px environ

const window = chargerDocuments();
const ajuster = window.AGORA.documents.ajusterEchelle;

decrire('Mise à l\'échelle de l\'aperçu A4', () => {
  test('le conteneur garde la largeur A4 : la feuille n\'est réduite qu\'une fois', () => {
    const { zone, conteneur } = fabriquer(window, 400, 1123);
    const echelle = ajuster(zone, conteneur);
    proche(parseFloat(conteneur.style.width), LARGEUR_A4, 0.5,
      'le conteneur doit garder la largeur A4 (' + LARGEUR_A4.toFixed(1) + ' px), sinon « max-width: 100% » réduit la feuille une seconde fois');
    proche(echelle, 398 / LARGEUR_A4, 0.001, 'échelle attendue = largeur disponible / largeur A4');
  });

  test('la hauteur du conteneur est la hauteur visible (non la hauteur A4)', () => {
    const { zone, conteneur } = fabriquer(window, 400, 1123);
    const echelle = ajuster(zone, conteneur);
    proche(parseFloat(conteneur.style.height), 1123 * echelle, 1,
      'la boîte doit occuper la hauteur réduite pour ne pas créer de vide');
    vrai(conteneur.style.transform.startsWith('scale('), 'transformation attendue');
  });

  test('la feuille occupe visuellement toute la largeur disponible', () => {
    const { zone, conteneur } = fabriquer(window, 400, 1123);
    const echelle = ajuster(zone, conteneur);
    // Largeur visible = largeur de mise en page × échelle.
    proche(LARGEUR_A4 * echelle, 398, 1, 'la feuille doit remplir la zone sans débordement');
  });

  test('sur un grand écran, aucune réduction n\'est appliquée', () => {
    const { zone, conteneur } = fabriquer(window, 900, 1123);
    const echelle = ajuster(zone, conteneur);
    egal(echelle, 1, 'au-delà de la largeur A4, l\'échelle doit rester à 1');
    proche(parseFloat(conteneur.style.height), 1123, 1, 'hauteur réelle attendue');
  });

  test('sur un petit écran, l\'échelle reste lisible (plancher à 20 %)', () => {
    const { zone, conteneur } = fabriquer(window, 120, 1123);
    const echelle = ajuster(zone, conteneur);
    egal(echelle, 0.2, 'un plancher évite une feuille illisible');
  });

  test('un conteneur absent ne provoque aucune erreur', () => {
    egal(ajuster(null, null), undefined, 'sortie silencieuse attendue');
  });
});

decrire('Cohérence entre l\'aperçu et le rendu du document', () => {
  test('le rendu HTML produit bien une feuille A4 (210 mm) non bornée par le conteneur', () => {
    const element = window.AGORA.documents.rendreHtml(
      window.AGORA.documents.creerVide('facture'), { modele: 'classique' }
    );
    vrai(/(^|\s)doc(\s|$)/.test(element.className),
      'la racine du rendu doit être la feuille « .doc » : ' + element.className);
    const css = readFileSync(join(RACINE, 'css/document.css'), 'utf8');
    const regle = /\.doc\s*\{([\s\S]*?)\}/.exec(css);
    vrai(/width:\s*210mm/.test(regle[1]), 'la feuille doit être dimensionnée en A4');
    vrai(/max-width:\s*100%/.test(regle[1]),
      'la garde anti-débordement reste utile hors conteneur à l\'échelle');
  });

  test('la zone d\'aperçu masque le débordement horizontal résiduel', () => {
    const css = readFileSync(join(RACINE, 'css/document.css'), 'utf8');
    const regle = /\.zone-apercu\s*\{([\s\S]*?)\}/.exec(css);
    vrai(/overflow-x:\s*hidden/.test(regle[1]),
      'sans cela, la boîte non réduite crée une barre de défilement fantôme');
    vrai(/overflow-y:\s*auto/.test(regle[1]), 'le défilement vertical reste possible');
  });

  test('à l\'impression, la feuille reprend sa taille réelle', () => {
    const css = readFileSync(join(RACINE, 'css/document.css'), 'utf8');
    const impression = /@media print\s*\{([\s\S]*)\}/.exec(css);
    vrai(/\.apercu-echelle\s*\{[^}]*transform:\s*none/.test(impression[1]),
      'la transformation doit être annulée à l\'impression');
    vrai(/\.doc\s*\{[^}]*width:\s*auto/.test(impression[1]),
      'la feuille doit être imprimée à sa taille réelle');
  });
});

decrire('Colonne d\'aperçu collante', () => {
  test('la hauteur réelle de l\'en-tête est publiée dans une variable CSS', () => {
    const doc = window.document;
    let entete = doc.querySelector('.app-header');
    if (!entete) {
      entete = doc.createElement('header');
      entete.className = 'app-header';
      doc.body.appendChild(entete);
    }
    // jsdom ne calcule aucune mise en page : on simule la hauteur mesurée.
    Object.defineProperty(entete, 'getBoundingClientRect', {
      configurable: true, value: () => ({ height: 132 })
    });
    window.AGORA.app.mesurerEntete();
    egal(doc.documentElement.style.getPropertyValue('--hauteur-entete'), '132px',
      'la colonne collante doit se caler sous l\'en-tête réel (zoom 125/150 % compris)');
  });

  test('une hauteur nulle n\'écrit aucune valeur (pas de faux positif)', () => {
    const doc = window.document;
    const entete = doc.querySelector('.app-header');
    Object.defineProperty(entete, 'getBoundingClientRect', {
      configurable: true, value: () => ({ height: 0 })
    });
    doc.documentElement.style.removeProperty('--hauteur-entete');
    window.AGORA.app.mesurerEntete();
    egal(doc.documentElement.style.getPropertyValue('--hauteur-entete'), '',
      'sans mesure fiable, la valeur de repli de la CSS doit s\'appliquer');
  });
});

await bilan('Aperçu A4');
