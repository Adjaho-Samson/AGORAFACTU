/* ==========================================================================
   Tests du Service Worker (sw.js) exécuté dans un environnement simulé.
   --------------------------------------------------------------------------
   Objectif : vérifier RÉELLEMENT le comportement hors ligne, sans navigateur :
     • le précache installe toutes les ressources de l'application ;
     • une nouvelle version supprime les anciens caches ;
     • une navigation hors ligne est servie depuis le cache ;
     • une page jamais visitée renvoie la page « hors ligne » ;
     • une ressource précachée est servie sans réseau ;
     • aucune requête vers un tiers n'est interceptée.
   Exécution : node tests/sw.test.mjs
   ========================================================================== */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { decrire, test, egal, vrai, faux, bilan } = await import('./micro-test.mjs');

const ORIGINE = 'https://app.local';

/* ------------------------------------------------- Cache API simulée */
class CacheSimule {
  constructor(nom) {
    this.nom = nom;
    this.contenu = new Map();
  }
  async add(requete) {
    const url = typeof requete === 'string' ? requete : requete.url;
    const reponse = await fetchSimule(url);
    if (!reponse || !reponse.ok) throw new Error('échec ' + url);
    this.contenu.set(url, reponse.clone());
  }
  async put(requete, reponse) {
    const url = typeof requete === 'string' ? requete : requete.url;
    this.contenu.set(url, reponse.clone());
  }
  async match(requete) {
    const url = typeof requete === 'string' ? requete : requete.url;
    const cle = [...this.contenu.keys()].find((k) => k === url || k.split('?')[0] === String(url).split('?')[0]);
    return cle ? this.contenu.get(cle).clone() : undefined;
  }
  async keys() { return [...this.contenu.keys()].map((url) => ({ url })); }
  async delete(requete) {
    const url = typeof requete === 'string' ? requete : requete.url;
    return this.contenu.delete(url);
  }
}

class CacheStorageSimule {
  constructor() { this.caches = new Map(); }
  async open(nom) {
    if (!this.caches.has(nom)) this.caches.set(nom, new CacheSimule(nom));
    return this.caches.get(nom);
  }
  async keys() { return [...this.caches.keys()]; }
  async delete(nom) { return this.caches.delete(nom); }
  async match(requete) {
    for (const cache of this.caches.values()) {
      const trouve = await cache.match(requete);
      if (trouve) return trouve;
    }
    return undefined;
  }
}

/* ------------------------------------------------------- réseau simulé */
let etatReseau = { enLigne: true, requetes: [], fichiersAbsents: new Set() };

function cheminLocal(url) {
  const u = new URL(url);
  if (u.origin !== ORIGINE) return null;
  const relatif = decodeURIComponent(u.pathname.replace(/^\//, ''));
  // « / » désigne la racine du site : c'est index.html qui est servi.
  return resolve(RACINE, relatif === '' ? 'index.html' : relatif);
}

function fetchSimule(url) {
  const u = new URL(url);
  etatReseau.requetes.push(u.href);
  if (!etatReseau.enLigne) return Promise.reject(new TypeError('Failed to fetch'));
  if (u.origin !== ORIGINE) return Promise.reject(new TypeError('origine tierce'));
  const chemin = cheminLocal(url);
  if (!chemin || !existsSync(chemin) || etatReseau.fichiersAbsents.has(chemin)) {
    return Promise.resolve(new Response('', { status: 404, statusText: 'Not Found' }));
  }
  const contenu = readFileSync(chemin);
  const type = chemin.endsWith('.html') ? 'text/html'
    : chemin.endsWith('.css') ? 'text/css'
      : chemin.endsWith('.js') ? 'text/javascript'
        : chemin.endsWith('.json') ? 'application/json'
          : chemin.endsWith('.svg') ? 'image/svg+xml'
            : chemin.endsWith('.png') ? 'image/png' : 'application/octet-stream';
  return Promise.resolve(new Response(contenu, { status: 200, headers: { 'Content-Type': type } }));
}

/* ------------------------------------------------- chargement du worker */
function chargerWorker() {
  const caches = new CacheStorageSimule();
  const ecouteurs = {};
  const self = {
    location: new URL(ORIGINE + '/sw.js'),
    console,
    caches,
    addEventListener: (type, fn) => { (ecouteurs[type] = ecouteurs[type] || []).push(fn); },
    skipWaiting: () => { self.skipWaitingAppele = true; return Promise.resolve(); },
    clients: { claim: () => { self.claimAppele = true; return Promise.resolve(); } }
  };
  const contexte = vm.createContext({
    self, caches,
    console: { log: console.log, warn: () => {}, error: console.error },
    fetch: (r) => fetchSimule(typeof r === 'string' ? r : r.url),
    Response, Request, URL, Headers,
    setTimeout, clearTimeout, Promise, Math, JSON, Object, Array, String, Number, Boolean, Error, TypeError, Map, Set, Date
  });
  const code = readFileSync(resolve(RACINE, 'sw.js'), 'utf8');
  vm.runInContext(code, contexte, { filename: 'sw.js' });
  return {
    self, caches,
    declencher: async (type, evenement) => {
      const liste = ecouteurs[type] || [];
      let attente = Promise.resolve();
      const evt = Object.assign({
        waitUntil: (p) => { attente = Promise.all([attente, p]); },
        respondWith: (p) => { attente = Promise.all([attente, p]); evt.reponse = p; },
        request: null
      }, evenement);
      for (const fn of liste) fn(evt);
      await attente;
      return evt;
    }
  };
}

/**
 * Construit une requête GET. « navigate » n'étant pas accepté par le
 * constructeur Request de Node, on simule une navigation par l'en-tête
 * Accept : c'est exactement le second critère testé par le Service Worker.
 */
function requeteGet(chemin, options = {}) {
  const url = ORIGINE + chemin;
  const entetes = new Headers({ accept: options.html ? 'text/html,application/xhtml+xml' : '*/*' });
  const requete = new Request(url, { method: 'GET', headers: entetes });
  if (options.mode === 'navigate') {
    Object.defineProperty(requete, 'mode', { value: 'navigate', configurable: true });
  }
  return requete;
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ tests */
decrire('Service Worker — installation et précache', () => {
  test('toutes les ressources de l\'application sont précachées', async () => {
    etatReseau = { enLigne: true, requetes: [], fichiersAbsents: new Set() };
    const worker = chargerWorker();
    await worker.declencher('install', {});
    const noms = await worker.caches.keys();
    egal(noms.length, 1, 'un seul cache doit être créé à l\'installation : ' + noms.join(', '));
    const cache = await worker.caches.open(noms[0]);
    const cles = await cache.keys();
    vrai(cles.length >= 25, 'précache trop pauvre : ' + cles.length + ' entrées');
    ['index.html', 'offline.html', 'manifest.json', 'css/global.css', 'js/app.js', 'pages/facture.html', 'lib/jspdf.umd.min.js']
      .forEach((fichier) => {
        vrai(cles.some((c) => c.url === ORIGINE + '/' + fichier), fichier + ' absent du précache');
      });
  });

  test('une ressource manquante n\'empêche pas l\'installation', async () => {
    etatReseau = { enLigne: false, requetes: [], fichiersAbsents: new Set() };
    const worker = chargerWorker();
    // Hors ligne dès l'installation : cas d'une première visite interrompue.
    await worker.declencher('install', {});
    const noms = await worker.caches.keys();
    egal(noms.length, 1, 'le cache doit tout de même exister');
    vrai(worker.self.skipWaitingAppele === true, 'skipWaiting doit être appelé');
  });

  test('l\'activation supprime les caches des anciennes versions', async () => {
    etatReseau = { enLigne: true, requetes: [], fichiersAbsents: new Set() };
    const worker = chargerWorker();
    // Simule un cache d'une version précédente.
    await worker.caches.open('agora-factures-v1.0.0-app');
    await worker.caches.open('agora-factures-v1.0.0-donnees');
    await worker.declencher('install', {});
    await worker.declencher('activate', {});
    const noms = await worker.caches.keys();
    faux(noms.some((n) => n.indexOf('v1.0.0') !== -1), 'les anciens caches doivent être supprimés : ' + noms.join(', '));
    vrai(noms.some((n) => n.indexOf('v1.1.0') !== -1), 'le cache de la version courante doit être conservé');
    vrai(worker.self.claimAppele === true, 'clients.claim() doit être appelé à l\'activation');
  });

  test('l\'activation complète un précache incomplet', async () => {
    etatReseau = { enLigne: false, requetes: [], fichiersAbsents: new Set() };
    const worker = chargerWorker();
    await worker.declencher('install', {});
    etatReseau.enLigne = true;      // le réseau revient avant l'activation
    await worker.declencher('activate', {});
    const cache = await worker.caches.open((await worker.caches.keys())[0]);
    const cles = await cache.keys();
    vrai(cles.length >= 25, 'le précache doit être complété à l\'activation : ' + cles.length);
  });
});

decrire('Service Worker — stratégies de réponse', () => {
  test('une ressource précachée est servie depuis le cache, sans réseau', async () => {
    etatReseau = { enLigne: true, requetes: [], fichiersAbsents: new Set() };
    const worker = chargerWorker();
    await worker.declencher('install', {});
    etatReseau.enLigne = false;
    etatReseau.requetes = [];
    const evt = await worker.declencher('fetch', { request: requeteGet('/css/global.css') });
    const reponse = await evt.reponse;
    egal(reponse.status, 200, 'la feuille de style doit être servie hors ligne');
    vrai((reponse.headers.get('content-type') || '').includes('text/css'), 'contenu inattendu');
  });

  test('une navigation déjà visitée est servie depuis le cache hors ligne', async () => {
    etatReseau = { enLigne: true, requetes: [], fichiersAbsents: new Set() };
    const worker = chargerWorker();
    await worker.declencher('install', {});
    etatReseau.enLigne = false;
    const evt = await worker.declencher('fetch', {
      request: requeteGet('/pages/facture.html', { html: true, mode: 'navigate' })
    });
    const reponse = await evt.reponse;
    egal(reponse.status, 200);
    vrai((await reponse.text()).includes('Nouveau document'), 'la page mise en cache doit être renvoyée');
  });

  test('une page jamais visitée renvoie la page « hors ligne »', async () => {
    etatReseau = { enLigne: true, requetes: [], fichiersAbsents: new Set() };
    const worker = chargerWorker();
    await worker.declencher('install', {});
    etatReseau.enLigne = false;
    const evt = await worker.declencher('fetch', {
      request: requeteGet('/pages/inexistante.html', { html: true, mode: 'navigate' })
    });
    const reponse = await evt.reponse;
    const corps = await reponse.text();
    // La page « hors ligne » est précachée : l'utilisateur obtient une page
    // explicative claire, et non une erreur brute du navigateur.
    vrai(corps.includes('Page non disponible hors ligne'), 'page hors ligne attendue');
    vrai(corps.includes('Revenir à l\'accueil'), 'un lien de retour doit être proposé');
    faux(corps.includes('/pages/inexistante.html'), 'la page demandée ne doit pas être confondue avec la page hors ligne');
  });

  test('la racine est servie même si l\'URL exacte n\'est pas en cache', async () => {
    etatReseau = { enLigne: true, requetes: [], fichiersAbsents: new Set() };
    const worker = chargerWorker();
    await worker.declencher('install', {});
    etatReseau.enLigne = false;
    const evt = await worker.declencher('fetch', { request: requeteGet('/', { html: true, mode: 'navigate' }) });
    const reponse = await evt.reponse;
    egal(reponse.status, 200, 'l\'accueil doit être disponible hors ligne');
  });

  test('en ligne, la ressource est rafraîchie en arrière-plan', async () => {
    etatReseau = { enLigne: true, requetes: [], fichiersAbsents: new Set() };
    const worker = chargerWorker();
    await worker.declencher('install', {});
    etatReseau.requetes = [];
    const evt = await worker.declencher('fetch', { request: requeteGet('/js/app.js') });
    const reponse = await evt.reponse;
    egal(reponse.status, 200);
    await attendre(30);
    vrai(etatReseau.requetes.length >= 1, 'la revalidation réseau doit être déclenchée');
  });

  test('les requêtes non GET et les origines tierces sont ignorées', async () => {
    etatReseau = { enLigne: true, requetes: [], fichiersAbsents: new Set() };
    const worker = chargerWorker();
    await worker.declencher('install', {});
    const post = await worker.declencher('fetch', { request: new Request(ORIGINE + '/css/global.css', { method: 'POST' }) });
    egal(post.reponse, undefined, 'une requête POST ne doit pas être interceptée');
    const tiers = await worker.declencher('fetch', { request: requeteGet('https://exemple.com/style.css') });
    egal(tiers.reponse, undefined, 'une origine tierce ne doit pas être interceptée');
  });

  test('le message FORCER_ACTIVATION déclenche l\'activation immédiate', async () => {
    etatReseau = { enLigne: true, requetes: [], fichiersAbsents: new Set() };
    const worker = chargerWorker();
    await worker.declencher('install', {});
    const evt = await worker.declencher('message', { data: { type: 'FORCER_ACTIVATION' }, ports: [] });
    egal(evt.waitUntil !== undefined, true);
    vrai(worker.self.skipWaitingAppele === true, 'skipWaiting doit être appelé');
  });

  test('le message ETAT renvoie la version et le nombre de ressources', async () => {
    etatReseau = { enLigne: true, requetes: [], fichiersAbsents: new Set() };
    const worker = chargerWorker();
    await worker.declencher('install', {});
    let recu = null;
    const port = { postMessage: (m) => { recu = m; } };
    await worker.declencher('message', { data: { type: 'ETAT' }, ports: [port] });
    await attendre(20);
    vrai(recu && typeof recu.version === 'string', 'version non renvoyée');
    vrai(recu && recu.ressources >= 25, 'nombre de ressources incohérent : ' + JSON.stringify(recu));
  });
});

await bilan('Service Worker (hors ligne)');
