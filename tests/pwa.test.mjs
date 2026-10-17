/* ==========================================================================
   Tests du module PWA (js/pwa.js) — exactitude des messages d'état.
   --------------------------------------------------------------------------
   Le navigateur est simulé (Service Worker, Cache API, contexte sécurisé).
   On vérifie surtout que l'application n'annonce JAMAIS « prêt hors ligne »
   sans l'avoir vérifié, et que chaque cause d'échec est expliquée.
   Exécution : node tests/pwa.test.mjs
   ========================================================================== */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { decrire, test, egal, vrai, faux, bilan } = await import('./micro-test.mjs');

/**
 * Charge index.html dans un navigateur simulé.
 * @param {Object} options
 *   • url            : URL de la page (détermine le contexte sécurisé)
 *   • serviceWorker  : false pour simuler un navigateur sans Service Worker
 *   • enregistrer    : fonction register() (résout ou rejette)
 *   • active         : le worker est-il actif et contrôle-t-il la page
 *   • ressources     : nombre de ressources présentes dans le cache
 */
async function chargerIndex(options = {}) {
  const url = options.url || 'https://app.local/index.html';
  const erreurs = [];
  const consoleVirtuelle = new VirtualConsole();
  consoleVirtuelle.on('jsdomError', (e) => erreurs.push(e.message));
  consoleVirtuelle.on('error', (m) => erreurs.push('console.error: ' + m));

  const dom = new JSDOM(readFileSync(resolve(RACINE, 'index.html'), 'utf8'), {
    url, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: consoleVirtuelle
  });
  const { window } = dom;

  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    value: url.startsWith('https:') || url.includes('localhost')
  });

  // --- Cache API simulée -------------------------------------------------
  const stockage = new Map();
  Object.defineProperty(window, 'caches', {
    configurable: true,
    value: {
      keys: () => Promise.resolve(['agora-factures-v1.1.0-app']),
      open: (nom) => Promise.resolve({
        keys: () => Promise.resolve(
          new Array(options.ressources === undefined ? 27 : options.ressources).fill(0).map((_, i) => ({ url: 'r' + i }))
        )
      }),
      delete: (nom) => { stockage.delete(nom); return Promise.resolve(true); }
    }
  });

  // --- navigator.serviceWorker ------------------------------------------
  const appels = [];
  if (options.serviceWorker !== false) {
    const ecouteurs = {};
    const registration = {
      active: options.active === false ? null : {},
      waiting: null,
      installing: null,
      update: () => Promise.resolve(registration),
      addEventListener: (type, fn) => { (ecouteurs[type] = ecouteurs[type] || []).push(fn); },
      removeEventListener: () => {}
    };
    const container = {
      register: (scriptUrl, opts) => {
        appels.push({ scriptUrl, opts });
        if (options.enregistrer) return options.enregistrer(scriptUrl, opts);
        return Promise.resolve(registration);
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      get controller() { return options.active === false ? null : {}; }
    };
    Object.defineProperty(window.navigator, 'serviceWorker', { configurable: true, value: container });
  }

  // --- exécution des scripts de la page ---------------------------------
  const html = readFileSync(resolve(RACINE, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  for (const src of scripts) {
    const element = window.document.createElement('script');
    element.textContent = readFileSync(resolve(RACINE, src), 'utf8');
    window.document.body.appendChild(element);
  }
  await new Promise((r) => setTimeout(r, options.attente || 250));

  return { dom, window, document: window.document, erreurs, appels, AGORA: window.AGORA };
}

const visible = (element) => !!element && !element.classList.contains('cache');

/* ------------------------------------------------------------------ tests */
decrire('État PWA annoncé à l\'utilisateur', () => {
  test('contexte sécurisé, worker actif et cache rempli : « prêt hors ligne »', async () => {
    const { window, document: doc, appels, erreurs } = await chargerIndex();
    const etat = window.AGORA.pwa.etat();
    egal(etat.code, 'actif');
    egal(etat.raison, '');
    vrai(etat.ressourcesEnCache >= 1, 'nombre de ressources en cache non mesuré');
    egal(doc.querySelector('#etat-pwa-texte').textContent, 'Prêt hors ligne');
    vrai(doc.querySelector('#etat-pwa-detail').textContent.includes('ressource(s) en cache'),
      'le détail doit indiquer le nombre de ressources réellement en cache');
    vrai(doc.querySelector('.cache-si-sw') && visible(doc.querySelector('.cache-si-sw')),
      'l\'indicateur de cache doit être visible');
    faux(visible(doc.querySelector('#alerte-sans-sw')), 'aucune alerte ne doit s\'afficher');
    faux(visible(doc.querySelector('#alerte-non-securise')), 'le contexte est sécurisé');
    egal(appels.length, 1, 'une seule tentative d\'enregistrement attendue');
    egal(appels[0].scriptUrl, './sw.js');
    egal(appels[0].opts.scope, './');
    egal(erreurs.length, 0, 'erreurs JS : ' + erreurs.join(' | '));
  });

  test('navigateur sans Service Worker : raison exacte, jamais « prêt »', async () => {
    const { window, document: doc } = await chargerIndex({ serviceWorker: false });
    const etat = window.AGORA.pwa.etat();
    egal(etat.code, 'indisponible');
    egal(etat.raison, 'navigateur');
    egal(doc.querySelector('#etat-pwa-texte').textContent, 'Hors ligne non disponible');
    vrai(visible(doc.querySelector('#alerte-sans-sw')), 'l\'alerte doit être affichée');
    vrai(doc.querySelector('#alerte-sans-sw').textContent.includes('Service Workers'),
      'la raison « navigateur » doit être explicite');
    faux(visible(doc.querySelector('.cache-si-sw')), 'le cache ne doit jamais être annoncé actif');
  });

  test('contexte non sécurisé (HTTP) : aucune tentative, message dédié', async () => {
    const { window, document: doc, appels, erreurs } = await chargerIndex({ url: 'http://app.local/index.html' });
    const etat = window.AGORA.pwa.etat();
    egal(etat.code, 'indisponible');
    egal(etat.raison, 'contexte');
    faux(etat.contexteSecurise, 'le contexte doit être détecté comme non sécurisé');
    egal(appels.length, 0, 'aucun enregistrement ne doit être tenté en HTTP');
    vrai(visible(doc.querySelector('#alerte-non-securise')), 'l\'alerte de contexte doit être affichée');
    vrai(doc.querySelector('#alerte-non-securise').textContent.includes('http://app.local'),
      'l\'adresse réelle doit être rappelée');
    // Un seul message d'erreur, pas deux messages contradictoires.
    faux(visible(doc.querySelector('#alerte-sans-sw')), 'pas d\'alerte redondante sur l\'absence de Service Worker');
    egal(erreurs.length, 0, 'erreurs JS : ' + erreurs.join(' | '));
  });

  test('échec d\'enregistrement : le message technique est affiché', async () => {
    const { window, document: doc } = await chargerIndex({
      enregistrer: () => Promise.reject(new Error('Erreur réseau simulée'))
    });
    const etat = window.AGORA.pwa.etat();
    egal(etat.code, 'indisponible');
    egal(etat.raison, 'erreur');
    vrai(etat.detail.includes('Erreur réseau simulée'), 'détail attendu : ' + etat.detail);
    vrai(visible(doc.querySelector('#alerte-sans-sw')), 'l\'alerte doit être affichée');
    vrai(doc.querySelector('#alerte-sans-sw').textContent.includes('Erreur réseau simulée'),
      'le message d\'origine doit être visible (jamais masqué)');
    faux(visible(doc.querySelector('.cache-si-sw')), 'le cache ne doit pas être annoncé actif');
  });

  test('scope refusé : l\'enregistrement est retenté sans scope explicite', async () => {
    let tentatives = 0;
    const { window, appels } = await chargerIndex({
      enregistrer: (scriptUrl, opts) => {
        tentatives++;
        if (tentatives === 1) {
          const e = new Error('The path of the provided scope is not under the allowed scope');
          e.name = 'SecurityError';
          return Promise.reject(e);
        }
        return Promise.resolve({
          active: {}, waiting: null, installing: null,
          update: () => Promise.resolve(), addEventListener: () => {}, removeEventListener: () => {}
        });
      }
    });
    egal(appels.length, 2, 'une seconde tentative est attendue');
    egal(appels[1].opts, undefined, 'la seconde tentative ne doit pas préciser de scope');
    egal(window.AGORA.pwa.etat().code, 'actif');
  });

  test('cache vide : le hors ligne n\'est pas annoncé comme disponible', async () => {
    const { window, document: doc } = await chargerIndex({ ressources: 0 });
    const etat = window.AGORA.pwa.etat();
    egal(etat.code, 'indisponible');
    egal(etat.raison, 'cache');
    faux(visible(doc.querySelector('.cache-si-sw')), 'le cache ne doit pas être annoncé actif');
    vrai(visible(doc.querySelector('#alerte-sans-sw')), 'une explication doit être affichée');
  });

  test('worker non actif : pas de faux positif', async () => {
    const { window, document: doc } = await chargerIndex({ active: false, attente: 400 });
    const etat = window.AGORA.pwa.etat();
    faux(etat.code === 'actif', 'l\'état « actif » ne doit pas être annoncé');
    faux(visible(doc.querySelector('.cache-si-sw')), 'le cache ne doit pas être annoncé actif');
  });
});

decrire('Détection du contexte et installation', () => {
  test('contexteSecurise() : https, localhost et 127.0.0.1 uniquement', async () => {
    const securise = await chargerIndex({ url: 'https://app.local/index.html', attente: 60 });
    vrai(securise.window.AGORA.pwa.contexteSecurise(), 'https doit être sécurisé');
    const local = await chargerIndex({ url: 'http://localhost:8080/index.html', attente: 60 });
    vrai(local.window.AGORA.pwa.contexteSecurise(), 'localhost doit être sécurisé');
    const ip = await chargerIndex({ url: 'http://127.0.0.1:8080/index.html', attente: 60 });
    vrai(ip.window.AGORA.pwa.contexteSecurise(), '127.0.0.1 doit être sécurisé');
    const distant = await chargerIndex({ url: 'http://192.168.1.10/index.html', attente: 60 });
    faux(distant.window.AGORA.pwa.contexteSecurise(), 'une IP LAN en HTTP n\'est pas un contexte sécurisé');
    const fichier = await chargerIndex({ url: 'file:///home/user/index.html', attente: 60 });
    faux(fichier.window.AGORA.pwa.contexteSecurise(), 'file:// n\'est pas un contexte sécurisé');
  });

  test('le bouton d\'installation reste masqué sans proposition du navigateur', async () => {
    const { document: doc } = await chargerIndex({ attente: 200 });
    const bouton = doc.querySelector('#bouton-installer');
    vrai(bouton.classList.contains('cache'), 'le bouton ne doit pas apparaître sans beforeinstallprompt');
    vrai(bouton.textContent.trim() === 'Installer' || bouton.textContent.includes('Installer'),
      'libellé court attendu : ' + bouton.textContent.trim());
    vrai(bouton.querySelector('.sr-only') !== null, 'le nom accessible complet doit être conservé');
  });

  test('l\'indicateur de connexion est un « status » annoncé aux lecteurs d\'écran', async () => {
    const { document: doc } = await chargerIndex({ attente: 100 });
    const indicateur = doc.querySelector('#indicateur-connexion');
    egal(indicateur.getAttribute('role'), 'status');
    egal(indicateur.getAttribute('aria-live'), 'polite');
    vrai(indicateur.querySelector('.libelle-etat').textContent.length > 0, 'libellé absent');
    vrai(indicateur.querySelector('.icone') !== null, 'icône d\'état absente');
  });
});

await bilan('PWA (états et messages)');
