/* ==========================================================================
   Agora Factures — module PWA
   --------------------------------------------------------------------------
   • Enregistrement du Service Worker (mise en cache hors ligne).
   • Indicateur d'état de connexion / disponibilité hors ligne.
   • Proposition d'installation quand le navigateur la prend en charge.
   • Mise à jour du Service Worker sans suppression des données utilisateur
     (les données sont dans IndexedDB/localStorage, jamais dans le cache).

   PRINCIPE DIRECTEUR : aucun message n'est affiché sans avoir été vérifié.
   « Prêt hors ligne » n'est annoncé que lorsque :
     1. le Service Worker est réellement enregistré,
     2. un worker est ACTIF et contrôle la page,
     3. le cache de l'application contient bien les ressources attendues.
   Dans le cas contraire, la raison exacte est affichée (navigateur non
   compatible, contexte non sécurisé, fichier introuvable, cache vide…).
   ========================================================================== */
(function (global) {
  'use strict';

  var AGORA = global.AGORA || (global.AGORA = {});
  var app = AGORA.app;
  var doc = global.document;

  var registration = null;
  var evenementInstallation = null;
  var minuteurInstallation = null;

  /* ---------------------------------------------------------------- état */
  var etat = {
    code: 'verification',        // verification | actif | preparation | indisponible
    raison: '',                  // navigateur | contexte | erreur | cache
    detail: '',
    ressourcesEnCache: null,     // null = inconnu
    contexteSecurise: true,
    installee: false,
    installationProposee: false
  };

  var LIBELLES = {
    verification: 'Vérification du mode hors connexion…',
    preparation: 'Préparation du mode hors connexion…',
    actif: 'Disponible hors connexion',
    indisponible: 'Hors connexion indisponible'
  };

  function definirEtat(code, options) {
    options = options || {};
    if (etat.code === code && etat.raison === (options.raison || '') && etat.detail === (options.detail || '')) {
      if (options.ressources === undefined) return etat;
    }
    etat.code = code;
    etat.raison = options.raison || '';
    etat.detail = options.detail || '';
    if (options.ressources !== undefined) etat.ressourcesEnCache = options.ressources;
    majAffichage();
    return etat;
  }

  /** Met à jour les indications utiles, sans exposer les détails techniques. */
  function majAffichage() {
    var actif = etat.code === 'actif';
    var texte = app.$('#etat-pwa-texte');
    if (texte) {
      texte.textContent = LIBELLES[etat.code] || LIBELLES.verification;
      texte.className = 'etat-pwa etat-' + etat.code;
    }
    var detail = app.$('#etat-pwa-detail');
    if (detail) {
      var message = '';
      if (actif) {
        message = 'Vous pouvez créer et consulter vos documents même sans connexion.';
      } else if (etat.code === 'preparation') {
        message = 'Cette préparation ne prend que quelques secondes.';
      } else if (etat.code === 'indisponible') {
        message = "Une connexion sera nécessaire pour rouvrir l'application.";
      }
      detail.textContent = message;
      detail.classList.toggle('cache', !message);
    }

    app.$$('.cache-si-sw').forEach(function (e) {
      e.classList.toggle('cache', !actif);
    });

    var alerteSansSw = app.$('#alerte-sans-sw');
    if (alerteSansSw) {
      var concerne = etat.code === 'indisponible' && etat.raison !== 'contexte';
      alerteSansSw.classList.toggle('cache', !concerne);
      var corpsSw = alerteSansSw.querySelector('p');
      if (corpsSw && concerne) corpsSw.textContent = CONSEQUENCE + ' ' + texteRaison();
    }
    var alerteNonSecurise = app.$('#alerte-non-securise');
    if (alerteNonSecurise) {
      var nonSecurise = !etat.contexteSecurise;
      alerteNonSecurise.classList.toggle('cache', !nonSecurise);
      var corpsSec = alerteNonSecurise.querySelector('p');
      if (corpsSec && nonSecurise) {
        corpsSec.textContent = 'Ouvrez Agora Factures depuis son adresse sécurisée pour ' +
          "l'installer et l'utiliser sans connexion. Vous pouvez continuer à gérer vos documents sur cette page.";
      }
    }
  }

  /* Conséquence et action à effectuer : les erreurs brutes sont conservées
     dans l'état interne et la console, jamais affichées à l'utilisateur. */
  var CONSEQUENCE = 'Le mode hors connexion est indisponible. Vous pouvez continuer ' +
    'à utiliser Agora Factures avec une connexion ; vos documents restent sur cet appareil.';

  function texteRaison() {
    switch (etat.raison) {
      case 'navigateur':
        return "Cet appareil ne propose pas cette fonctionnalité. Utilisez l'application avec une connexion.";
      case 'cache':
        return "La préparation n'a pas abouti. Rechargez la page pour réessayer.";
      case 'erreur':
      default:
        return 'Rechargez la page. Si le message persiste, réessayez plus tard avec une connexion stable.';
    }
  }

  /* ------------------------------------------------- état de connexion */
  function majIndicateur() {
    var indicateur = app.$('#indicateur-connexion');
    if (!indicateur) return;
    var enLigne = global.navigator.onLine !== false;
    indicateur.classList.toggle('hors-ligne', !enLigne);
    indicateur.setAttribute('role', 'status');
    indicateur.setAttribute('aria-live', 'polite');
    indicateur.title = enLigne
      ? 'Connecté — vos documents restent enregistrés sur cet appareil'
      : 'Hors connexion — vous pouvez continuer à travailler';
    var libelle = indicateur.querySelector('.libelle-etat');
    if (libelle) libelle.textContent = enLigne ? 'En ligne' : 'Hors ligne';
    var puce = indicateur.querySelector('.puce');
    if (puce) puce.setAttribute('aria-hidden', 'true');
    var icone = indicateur.querySelector('.icone');
    var svg = app.icone(enLigne ? 'enLigne' : 'horsLigne');
    if (icone) icone.outerHTML = svg;
    else indicateur.insertAdjacentHTML('afterbegin', svg);
  }

  function surveillerConnexion() {
    var dejaNotifie = false;
    global.addEventListener('online', function () {
      majIndicateur();
      if (dejaNotifie) app.notifier('Connexion rétablie.', 'succes');
      dejaNotifie = false;
      verifierMiseAJourDisponible();
    });
    global.addEventListener('offline', function () {
      majIndicateur();
      dejaNotifie = true;
      app.notifier('Vous êtes hors ligne. L\'application reste utilisable.', 'avertissement', 6000);
    });
    majIndicateur();
  }

  /* ------------------------------------------------------ installation */
  function estInstallee() {
    var standalone = (global.matchMedia && global.matchMedia('(display-mode: standalone)').matches) ||
      global.navigator.standalone === true;
    etat.installee = standalone;
    return standalone;
  }

  function majBoutonInstallation() {
    var bouton = app.$('#bouton-installer');
    if (bouton) {
      var visible = !!evenementInstallation && !etat.installee;
      bouton.classList.toggle('cache', !visible);
    }
    var blocIndisponible = app.$('#installation-indisponible');
    if (blocIndisponible) {
      blocIndisponible.classList.toggle('cache', etat.installee || etat.installationProposee);
    }
  }

  function gererInstallation() {
    var bouton = app.$('#bouton-installer');

    global.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      evenementInstallation = e;
      etat.installationProposee = true;
      majBoutonInstallation();
    });

    global.addEventListener('appinstalled', function () {
      evenementInstallation = null;
      etat.installee = true;
      etat.installationProposee = true;
      majBoutonInstallation();
      app.notifier('Agora Factures est installée sur cet appareil.', 'succes');
    });

    if (bouton) {
      bouton.addEventListener('click', function () {
        if (!evenementInstallation) {
          app.notifier('Pour installer Agora Factures, utilisez l\'option « Ajouter à l\'écran d\'accueil » de votre appareil.', 'info', 7000);
          return;
        }
        var evenement = evenementInstallation;
        evenement.prompt();
        evenement.userChoice.then(function (choix) {
          if (choix && choix.outcome === 'accepted') app.notifier('Installation lancée.', 'succes');
          if (evenementInstallation === evenement) evenementInstallation = null;
          majBoutonInstallation();
        }).catch(function () {
          if (evenementInstallation === evenement) evenementInstallation = null;
          majBoutonInstallation();
        });
      });
    }

    estInstallee();
    majBoutonInstallation();

    // Le navigateur ne signale l'installation qu'après le chargement complet :
    // on n'affiche « installation non proposée » qu'après un délai suffisant.
    var annoncer = function () {
      majBoutonInstallation();
      if (!etat.installationProposee && !etat.installee) {
        var bloc = app.$('#installation-indisponible');
        if (bloc) bloc.classList.remove('cache');
      }
    };
    if (doc.readyState === 'complete') global.setTimeout(annoncer, 2500);
    else global.addEventListener('load', function () { global.setTimeout(annoncer, 2500); });
  }

  /* --------------------------------------------------- service worker */
  /** Indique si l'application est servie dans un contexte sécurisé. */
  function contexteSecurise() {
    if (global.location.protocol === 'file:') return false;
    return global.isSecureContext === true ||
      global.location.protocol === 'https:' ||
      global.location.hostname === 'localhost' ||
      global.location.hostname === '127.0.0.1' ||
      global.location.hostname === '[::1]';
  }

  /** Compte réellement les ressources présentes dans le cache applicatif. */
  function compterRessourcesCache() {
    if (!global.caches) return Promise.resolve(null);
    return global.caches.keys().then(function (cles) {
      var noms = cles.filter(function (c) { return c.indexOf('agora-factures-') === 0; });
      if (!noms.length) return 0;
      return Promise.all(noms.map(function (nom) {
        return global.caches.open(nom).then(function (cache) {
          return cache.keys();
        }).then(function (requetes) { return requetes.length; }, function () { return 0; });
      })).then(function (nombres) {
        return nombres.reduce(function (a, b) { return a + b; }, 0);
      });
    }).catch(function () { return null; });
  }

  /**
   * Attend qu'un worker soit actif ET contrôle la page (sinon la mise en
   * cache hors ligne n'est pas encore effective pour cette page).
   */
  function attendreActivation(reg, delaiMax) {
    return new Promise(function (resoudre) {
      var fini = false;
      function fin(ok) {
        if (fini) return;
        fini = true;
        if (minuteur) global.clearTimeout(minuteur);
        if (ecouteur) global.navigator.serviceWorker.removeEventListener('controllerchange', ecouteur);
        resoudre(ok);
      }
      var minuteur = global.setTimeout(function () { fin(!!(reg && reg.active)); }, delaiMax || 9000);
      var ecouteur = function () {
        if (global.navigator.serviceWorker.controller) fin(true);
      };
      global.navigator.serviceWorker.addEventListener('controllerchange', ecouteur);
      (function verifier() {
        if (fini) return;
        if (reg.active && global.navigator.serviceWorker.controller) return fin(true);
        global.setTimeout(verifier, 250);
      })();
    });
  }

  function enregistrer() {
    etat.contexteSecurise = contexteSecurise();

    if (!('serviceWorker' in global.navigator)) {
      definirEtat('indisponible', { raison: 'navigateur' });
      return Promise.resolve(null);
    }
    if (!etat.contexteSecurise) {
      // Le navigateur refuse l'enregistrement hors HTTPS : inutile d'insister,
      // et surtout inutile d'afficher un second message contradictoire.
      definirEtat('indisponible', { raison: 'contexte' });
      return Promise.resolve(null);
    }

    var url = app.url('sw.js');
    var scope = app.base();
    var obtenue = null;

    function tenter(avecScope) {
      var options = avecScope ? { scope: scope } : undefined;
      return global.navigator.serviceWorker.register(url, options);
    }

    return tenter(true)
      .catch(function (e) {
        // Le scope explicite peut être refusé (site servi depuis un sous-dossier,
        // en-tête « Service-Worker-Allowed » absent) : on réessaie sans le préciser.
        var nom = (e && e.name) || '';
        if (nom === 'SecurityError' || /scope/i.test(String((e && e.message) || ''))) {
          return tenter(false);
        }
        throw e;
      })
      .then(function (reg) {
        registration = reg;
        obtenue = reg;
        installerSurveillance(reg);
        definirEtat('preparation');
        return attendreActivation(reg);
      })
      .then(function (actif) {
        if (!actif) {
          definirEtat('indisponible', {
            raison: 'erreur',
            detail: 'le Service Worker n\'a pas pris le contrôle de la page'
          });
          return null;
        }
        return compterRessourcesCache().then(function (nombre) {
          if (nombre === 0) {
            definirEtat('indisponible', {
              raison: 'cache',
              detail: 'le précache n\'a rien enregistré (vérifiez les chemins des ressources)'
            });
            return obtenue;
          }
          definirEtat('actif', { ressources: nombre });
          return obtenue;
        });
      })
      .catch(function (e) {
        var detail = (e && e.message) ? e.message : String(e || 'erreur inconnue');
        if (global.console && console.warn) console.warn('[Agora Factures] Service Worker :', detail);
        definirEtat('indisponible', { raison: 'erreur', detail: detail });
        return null;
      });
  }

  /** Surveillance des mises à jour du Service Worker. */
  function installerSurveillance(reg) {
    if (reg.__agoraSurveille) return;
    reg.__agoraSurveille = true;

    reg.addEventListener('updatefound', function () {
      var nouveau = reg.installing;
      if (!nouveau) return;
      nouveau.addEventListener('statechange', function () {
        if (nouveau.state === 'installed' && global.navigator.serviceWorker.controller) {
          proposerMiseAJour();
        }
      });
    });

    if (reg.waiting && global.navigator.serviceWorker.controller) proposerMiseAJour();

    // Vérification périodique (30 min) et à chaque retour sur l'onglet.
    global.setInterval(function () {
      if (!doc.hidden) reg.update().catch(function () { /* silencieux */ });
    }, 30 * 60 * 1000);
    doc.addEventListener('visibilitychange', function () {
      if (!doc.hidden) verifierMiseAJourDisponible();
    });
  }

  function verifierMiseAJourDisponible() {
    if (!registration) return;
    registration.update().catch(function () { /* silencieux */ });
  }

  function proposerMiseAJour() {
    var zone = app.$('#zone-notifications') || doc.body;
    var deja = app.$$('.notification').some(function (n) { return n.dataset.miseajour === '1'; });
    if (deja) return;
    var conteneur = doc.createElement('div');
    conteneur.className = 'notification info';
    conteneur.dataset.miseajour = '1';
    conteneur.style.pointerEvents = 'auto';
    var texte = doc.createElement('p');
    texte.textContent = 'Une nouvelle version est disponible.';
    var bouton = doc.createElement('button');
    bouton.className = 'btn btn-petit btn-secondaire';
    bouton.type = 'button';
    bouton.textContent = 'Mettre à jour';
    bouton.addEventListener('click', function () { appliquerMiseAJour(); });
    conteneur.appendChild(texte);
    conteneur.appendChild(bouton);
    zone.appendChild(conteneur);
  }

  function appliquerMiseAJour() {
    if (!registration || !registration.waiting) {
      global.location.reload();
      return;
    }
    var canal = new MessageChannel();
    canal.port1.onmessage = function () { global.location.reload(); };
    registration.waiting.postMessage({ type: 'FORCER_ACTIVATION' }, [canal.port2]);
    // Sécurité : rechargement si le Service Worker ne répond pas.
    global.setTimeout(function () { global.location.reload(); }, 1500);
  }

  function init() {
    surveillerConnexion();
    gererInstallation();
    majAffichage();
    enregistrer();
  }

  app.pret(init);

  AGORA.pwa = {
    enregistrer: enregistrer,
    appliquerMiseAJour: appliquerMiseAJour,
    majIndicateur: majIndicateur,
    contexteSecurise: contexteSecurise,
    compterRessourcesCache: compterRessourcesCache,
    obtenirRegistration: function () { return registration; },
    etat: function () {
      return {
        code: etat.code,
        raison: etat.raison,
        detail: etat.detail,
        ressourcesEnCache: etat.ressourcesEnCache,
        contexteSecurise: etat.contexteSecurise,
        installee: etat.installee
      };
    }
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
