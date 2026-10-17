/* ==========================================================================
   Agora Factures — Service Worker
   --------------------------------------------------------------------------
   Stratégies :
     • App shell (HTML/CSS/JS/icônes/bibliothèques) : précaché à l'installation,
       servi en « stale-while-revalidate » -> rapide, toujours à jour, et
       disponible hors ligne.
     • Navigations : réseau d'abord, repli sur le cache puis page hors ligne.
     • Jamais de requête vers un serveur tiers : tout est local.

   Chemins : toutes les ressources sont résolues depuis l'emplacement du
   Service Worker (new URL(chemin, BASE)), ce qui fonctionne aussi bien à la
   racine d'un domaine que dans un sous-dossier (Pages projet, préversions).

   Mise à jour : le numéro de version ci-dessous change à chaque évolution de
   l'application. Le nouveau worker réinstalle le précache dans un cache
   nommé d'après la version et SUPPRIME les anciens caches : aucune ressource
   périmée n'est conservée, et aucune donnée utilisateur n'est touchée
   (IndexedDB / localStorage ne sont jamais dans le cache).
   ========================================================================== */

/* eslint-env serviceworker */
/* global self, caches, fetch, clients */

/* ⚠ À incrémenter à chaque déploiement modifiant un fichier de l'app shell. */
var VERSION = 'agora-factures-v1.1.0';
var CACHE_APP = VERSION + '-app';
var CACHE_DYNAMIQUE = VERSION + '-donnees';
var PREFIXE_CACHE = 'agora-factures-';
var MAX_ENTREES_DYNAMIQUES = 80;

// Liste des ressources indispensables (chemins relatifs à la racine de l'app)
var BASE = new URL('./', self.location).href;

var RESSOURCES = [
  '',
  'index.html',
  'offline.html',
  'manifest.json',
  'pages/dashboard.html',
  'pages/facture.html',
  'pages/historique.html',
  'pages/parametres.html',
  'css/global.css',
  'css/document.css',
  'css/print.css',
  'css/dashboard.css',
  'css/facture.css',
  'css/historique.css',
  'css/parametres.css',
  'js/app.js',
  'js/calculs.js',
  'js/stockage.js',
  'js/parametres.js',
  'js/documents.js',
  'js/factures.js',
  'js/historique.js',
  'js/dashboard.js',
  'js/pdf.js',
  'js/pwa.js',
  'lib/jspdf.umd.min.js',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-maskable-512.png',
  'assets/icons/apple-touch-icon.png',
  'assets/icons/favicon-16.png',
  'assets/icons/favicon-32.png',
  'assets/images/logo-default.svg'
];

var URLS_PRECACHE = RESSOURCES.map(function (chemin) { return new URL(chemin, BASE).href; });
var URL_HORS_LIGNE = new URL('offline.html', BASE).href;

/* --------------------------------------------------------------- outils */
function estNavigation(requete) {
  return requete.mode === 'navigate' ||
    (requete.method === 'GET' && (requete.headers.get('accept') || '').indexOf('text/html') !== -1);
}

function estPrecache(url) {
  return URLS_PRECACHE.indexOf(url) !== -1;
}

function copier(cache, requete, reponse) {
  if (!reponse || !reponse.ok || reponse.status === 206) return Promise.resolve(null);
  var copie = reponse.clone();
  return cache.put(requete, copie).catch(function () { return null; });
}

/** Borne la taille du cache dynamique (documents consultés, images…). */
function purgerDynamique() {
  return caches.open(CACHE_DYNAMIQUE).then(function (cache) {
    return cache.keys();
  }).then(function (cles) {
    var excedent = cles.length - MAX_ENTREES_DYNAMIQUES;
    if (excedent <= 0) return null;
    return caches.open(CACHE_DYNAMIQUE).then(function (cache) {
      return Promise.all(cles.slice(0, excedent).map(function (cle) { return cache.delete(cle); }));
    });
  }).catch(function () { return null; });
}

/** Page affichée lorsqu'une navigation échoue et que rien n'est en cache. */
function pageHorsLigne() {
  return caches.match(URL_HORS_LIGNE).then(function (enCache) {
    if (enCache) return enCache;
    return new Response(
      '<!doctype html><html lang="fr"><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>Hors ligne — Agora Factures</title>' +
      '<body style="font-family:system-ui,Segoe UI,Arial,sans-serif;margin:0;padding:32px;' +
      'background:#f4f6f9;color:#1f2937">' +
      '<div style="max-width:34rem;margin:10vh auto;background:#fff;border:1px solid #dfe5ee;' +
      'border-radius:16px;padding:24px">' +
      '<h1 style="color:#12375f;margin:0 0 8px">Hors ligne</h1>' +
      '<p>Cette page n\'a pas encore été mise en cache. Reconnectez-vous une fois pour ' +
      'l\'ouvrir, puis réessayez.</p></div></body></html>',
      { status: 503, statusText: 'Hors ligne', headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  });
}

/* ------------------------------------------------------------ installation */
self.addEventListener('install', function (evenement) {
  evenement.waitUntil(
    caches.open(CACHE_APP)
      .then(function (cache) {
        // addAll échoue entièrement si un seul fichier manque : on ajoute un par un.
        return Promise.all(URLS_PRECACHE.map(function (url) {
          return cache.add(new Request(url, { cache: 'reload' })).catch(function (erreur) {
            // Une ressource manquante ne doit pas empêcher l'installation ;
            // elle est simplement absente du cache (le réseau la fournira).
            if (self.console && console.warn) {
              console.warn('[SW] précache impossible :', url, erreur && erreur.message);
            }
          });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (evenement) {
  evenement.waitUntil(
    caches.keys().then(function (cles) {
      return Promise.all(cles.map(function (cle) {
        // Seuls les caches de la version courante sont conservés.
        if (cle.indexOf(PREFIXE_CACHE) === 0 && cle !== CACHE_APP && cle !== CACHE_DYNAMIQUE) {
          return caches.delete(cle);
        }
        return null;
      }));
    })
      .then(function () { return purgerDynamique(); })
      // Les ressources précachées sont réinstallées si elles manquent :
      // un déploiement qui modifie sw.js remet donc le cache à niveau.
      .then(function () {
        return caches.open(CACHE_APP).then(function (cache) {
          return Promise.all(URLS_PRECACHE.map(function (url) {
            return cache.match(url).then(function (presente) {
              if (presente) return null;
              return cache.add(new Request(url, { cache: 'reload' })).catch(function () { return null; });
            });
          }));
        });
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (evenement) {
  var donnees = evenement.data || {};
  if (donnees.type === 'FORCER_ACTIVATION') {
    self.skipWaiting();
    self.clients.claim().then(function () {
      if (evenement.ports && evenement.ports[0]) evenement.ports[0].postMessage({ ok: true });
    });
  } else if (donnees.type === 'VIDER_CACHE') {
    evenement.waitUntil(
      caches.keys().then(function (cles) {
        return Promise.all(cles.map(function (cle) { return caches.delete(cle); }));
      }).then(function () {
        if (evenement.ports && evenement.ports[0]) evenement.ports[0].postMessage({ ok: true });
      })
    );
  } else if (donnees.type === 'ETAT') {
    var repondre = function (nombre) {
      if (evenement.ports && evenement.ports[0]) {
        evenement.ports[0].postMessage({ version: VERSION, ressources: nombre });
      }
    };
    caches.open(CACHE_APP)
      .then(function (cache) { return cache.keys(); })
      .then(function (cles) { repondre(cles.length); }, function () { repondre(null); });
  }
});

/* ------------------------------------------------------------------ fetch */
self.addEventListener('fetch', function (evenement) {
  var requete = evenement.request;

  if (requete.method !== 'GET') return;

  var url = new URL(requete.url);
  if (url.origin !== self.location.origin) return;      // aucune dépendance externe
  if (requete.headers.has('range')) return;             // pas de gestion des requêtes partielles

  // 1. Navigations : réseau d'abord (contenu frais), repli cache puis hors ligne
  if (estNavigation(requete)) {
    evenement.respondWith(
      fetch(requete).then(function (reponse) {
        if (reponse && reponse.ok) {
          caches.open(CACHE_DYNAMIQUE).then(function (cache) { return copier(cache, requete, reponse); })
            .then(function () { return purgerDynamique(); });
        }
        return reponse;
      }).catch(function () {
        return caches.match(requete, { ignoreSearch: true })
          .then(function (enCache) {
            if (enCache) return enCache;
            // Repli sur l'accueil uniquement pour la racine du site.
            if (url.pathname === new URL(BASE).pathname || url.pathname === new URL('index.html', BASE).pathname) {
              return caches.match(new URL('index.html', BASE).href);
            }
            return null;
          })
          .then(function (enCache) { return enCache || pageHorsLigne(); });
      })
    );
    return;
  }

  // 2. Ressources de l'application : cache d'abord + revalidation en arrière-plan
  evenement.respondWith(
    caches.match(requete).then(function (enCache) {
      var promesseReseau = fetch(requete).then(function (reponse) {
        if (reponse && reponse.ok) {
          var cacheCible = estPrecache(requete.url) ? CACHE_APP : CACHE_DYNAMIQUE;
          caches.open(cacheCible).then(function (cache) { return copier(cache, requete, reponse); })
            .then(function () { if (cacheCible === CACHE_DYNAMIQUE) return purgerDynamique(); });
        }
        return reponse;
      }).catch(function () { return null; });

      // En cache : on répond immédiatement puis on rafraîchit en tâche de fond.
      // Pas en cache : on attend le réseau (première visite).
      return enCache || promesseReseau.then(function (reponse) {
        return reponse || caches.match(requete, { ignoreSearch: true });
      }).then(function (reponse) {
        return reponse || new Response('', { status: 504, statusText: 'Ressource indisponible hors ligne' });
      });
    })
  );
});
