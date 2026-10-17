/* ==========================================================================
   Agora Factures — socle applicatif
   --------------------------------------------------------------------------
   Utilitaires partagés par toutes les pages : chemins relatifs, accès DOM,
   notifications, modales, impressions, téléchargements, icônes.
   Aucune donnée n'est envoyée à un serveur.
   ========================================================================== */
(function (global) {
  'use strict';

  var AGORA = global.AGORA || (global.AGORA = {});
  var doc = global.document;

  /* ------------------------------------------------------------ chemins */
  var BASE = (function () {
    var chemin = (global.location && global.location.pathname) || '/';
    return chemin.indexOf('/pages/') !== -1 ? '../' : './';
  })();

  function base() { return BASE; }
  function url(cheminRelatif) { return BASE + String(cheminRelatif).replace(/^\.?\//, ''); }

  /* -------------------------------------------------------------- DOM */
  function $(selecteur, contexte) { return (contexte || doc).querySelector(selecteur); }
  function $$(selecteur, contexte) {
    return Array.prototype.slice.call((contexte || doc).querySelectorAll(selecteur));
  }

  function creer(balise, attributs, enfants) {
    var el = doc.createElement(balise);
    if (attributs) {
      Object.keys(attributs).forEach(function (cle) {
        var valeur = attributs[cle];
        if (valeur === null || valeur === false || valeur === undefined) return;
        if (cle === 'class') el.className = valeur;
        else if (cle === 'html') el.innerHTML = valeur;
        else if (cle === 'text') el.textContent = valeur;
        else if (cle.slice(0, 2) === 'on' && typeof valeur === 'function') {
          el.addEventListener(cle.slice(2).toLowerCase(), valeur);
        } else if (cle === 'dataset') {
          Object.keys(valeur).forEach(function (k) { el.dataset[k] = valeur[k]; });
        } else if (valeur === true) el.setAttribute(cle, '');
        else el.setAttribute(cle, valeur);
      });
    }
    (Array.isArray(enfants) ? enfants : enfants ? [enfants] : []).forEach(function (enfant) {
      if (enfant === null || enfant === undefined) return;
      el.appendChild(typeof enfant === 'string' ? doc.createTextNode(enfant) : enfant);
    });
    return el;
  }

  /** Échappe le texte saisi par l'utilisateur avant insertion en HTML. */
  function echapper(texte) {
    return String(texte === null || texte === undefined ? '' : texte)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function pret(fn) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  /* ---------------------------------------------------------- icônes SVG */
  var ICONES = {
    accueil: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
    tableau: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    document: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/>',
    historique: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    parametres: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 15H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 8.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 4.6V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.6 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 20.4 11H21a2 2 0 1 1 0 4z"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    moins: '<path d="M5 12h14"/>',
    imprimante: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="7" rx="2"/><path d="M6 16h12v5H6z"/>',
    telecharger: '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>',
    recherche: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    copier: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
    modifier: '<path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4 16.5z"/><path d="M13.5 6.5 17.5 10.5"/>',
    supprimer: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    check: '<path d="M4 12.5 9 17.5 20 6.5"/>',
    croix: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
    alerte: '<path d="M12 3 2 20h20z"/><path d="M12 9v5"/><path d="M12 17.2v.1"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8v.1"/>',
    devise: '<circle cx="12" cy="12" r="9"/><path d="M8 9h8"/><path d="M8 13h8"/><path d="M12 9v7"/><path d="M9 12.5h6"/>',
    paiement: '<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/><path d="M6 15h4"/>',
    horsLigne: '<path d="M2 2l20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M5 13a10 10 0 0 1 4-2.3"/><path d="M15 10.8A10 10 0 0 1 19 13"/><path d="M12 20v.1"/>',
    enLigne: '<path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8.5 16a5 5 0 0 1 7 0"/><path d="M12 20v.1"/>',
    installer: '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><rect x="3" y="17" width="18" height="4" rx="1.5"/>',
    tri: '<path d="M7 4v16"/><path d="M4 17l3 3 3-3"/><path d="M17 20V4"/><path d="M14 7l3-3 3 3"/>',
    filtre: '<path d="M3 5h18"/><path d="M6 12h12"/><path d="M10 19h4"/>',
    annuler: '<circle cx="12" cy="12" r="9"/><path d="M6 6l12 12"/>',
    brouillon: '<path d="M4 20h4L18 10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5z"/>',
    sauvegarde: '<path d="M4 4h11l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M8 4v6h7"/><path d="M8 20v-6h8v6"/>',
    voir: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/>'
  };

  function icone(nom, classe) {
    var chemin = ICONES[nom] || ICONES.info;
    var svg = '<svg class="icone' + (classe ? ' ' + classe : '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + chemin + '</svg>';
    return svg;
  }

  function iconeElement(nom, classe) {
    var span = doc.createElement('span');
    span.innerHTML = icone(nom, classe);
    return span.firstChild;
  }

  /* -------------------------------------------------------- notifications */
  function notifier(message, type, duree) {
    var zone = $('#zone-notifications');
    if (!zone) {
      zone = creer('div', { id: 'zone-notifications', 'aria-live': 'polite', 'aria-atomic': 'false' });
      doc.body.appendChild(zone);
    }
    var nomIcone = type === 'succes' ? 'check' : (type === 'erreur' ? 'alerte' : (type === 'avertissement' ? 'alerte' : 'info'));
    var bloc = creer('div', { class: 'notification ' + (type || 'info'), role: 'status' });
    bloc.innerHTML = icone(nomIcone) + '<p></p>';
    bloc.querySelector('p').textContent = message;
    zone.appendChild(bloc);
    var delai = typeof duree === 'number' ? duree : (type === 'erreur' ? 7000 : 4000);
    global.setTimeout(function () {
      if (bloc.parentNode) bloc.parentNode.removeChild(bloc);
    }, delai);
    return bloc;
  }

  function erreurUtilisateur(e, contexte) {
    var message = (e && e.message) ? e.message : 'Une erreur inattendue est survenue.';
    if (contexte) message = contexte + ' : ' + message;
    // eslint-disable-next-line no-console
    if (global.console && console.error) console.error('[Agora Factures]', message, e || '');
    notifier(message, 'erreur');
  }

  /* ------------------------------------------------------------- modales */
  var pileModales = [];

  /** Éléments focusables d'un conteneur (ordre du document). */
  function focusables(conteneur) {
    return $$('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]),' +
      ' select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', conteneur)
      .filter(function (el) {
        return !el.hasAttribute('hidden') && el.offsetParent !== null || el === doc.activeElement;
      });
  }

  /** Rend le reste de la page inerte (navigation clavier + lecteurs d'écran). */
  function isolerArrierePlan(activer) {
    var garder = ['fond-modale', 'zone-notifications', 'zone-impression'];
    $$('body > *').forEach(function (el) {
      if (garder.indexOf(el.id) !== -1 || el.classList.contains('fond-modale')) return;
      if (activer) {
        if (el.hasAttribute('inert')) el.dataset.inertPrecedent = '1';
        el.setAttribute('inert', '');
      } else if (el.dataset.inertPrecedent) {
        el.removeAttribute('inert');
        delete el.dataset.inertPrecedent;
      } else {
        el.removeAttribute('inert');
      }
    });
  }

  function ouvrirModale(options) {
    options = options || {};
    var fond = creer('div', { class: 'fond-modale' + (options.classe ? ' ' + options.classe : ''), role: 'dialog', 'aria-modal': 'true' });
    var boite = creer('div', { class: 'modale' + (options.large ? ' modale-large' : '') });
    var titreId = 'titre-modale-' + (pileModales.length + 1);
    boite.setAttribute('aria-labelledby', titreId);

    var entete = creer('header', {}, [
      creer('h2', { id: titreId, text: options.titre || '' }),
      creer('button', {
        class: 'btn btn-fantome btn-icone', type: 'button', 'aria-label': 'Fermer',
        html: icone('croix'),
        onclick: function () { fermerModale(api); }
      })
    ]);
    boite.appendChild(entete);

    var corps = creer('div', { class: 'corps-modale' });
    if (typeof options.corps === 'string') corps.innerHTML = options.corps;
    else if (options.corps && options.corps.nodeType) corps.appendChild(options.corps);
    else if (Array.isArray(options.corps)) options.corps.forEach(function (c) { corps.appendChild(c); });
    boite.appendChild(corps);

    var pied = creer('footer');
    (options.actions || []).forEach(function (action) {
      var bouton = creer('button', {
        class: 'btn ' + (action.classe || 'btn-fantome'),
        type: 'button',
        text: action.libelle
      });
      bouton.addEventListener('click', function () {
        var resultat = action.action ? action.action(api) : undefined;
        if (resultat === false) return;      // le gestionnaire garde la main
        if (resultat && typeof resultat.then === 'function') {
          resultat.then(function () { fermerModale(api); }, function (e) { erreurUtilisateur(e); });
          return;
        }
        fermerModale(api);
      });
      pied.appendChild(bouton);
    });
    if ((options.actions || []).length) boite.appendChild(pied);

    fond.appendChild(boite);
    doc.body.appendChild(fond);
    doc.body.style.overflow = 'hidden';

    var api = {
      element: fond,
      boite: boite,
      corps: corps,
      fermer: function () { fermerModale(api); }
    };

    fond.addEventListener('click', function (e) {
      if (e.target === fond && options.fermetureFond !== false) fermerModale(api);
    });
    doc.addEventListener('keydown', gererTouche);

    function gererTouche(e) {
      if (pileModales[pileModales.length - 1] !== api) return;
      if (e.key === 'Escape' && options.fermetureEchap !== false) {
        e.preventDefault();
        if (options.annuler) options.annuler();
        fermerModale(api);
        return;
      }
      // Piège de focus : Tab / Maj+Tab restent dans la boîte de dialogue.
      if (e.key !== 'Tab') return;
      var elements = focusables(boite);
      if (!elements.length) return;
      var premier = elements[0];
      var dernier = elements[elements.length - 1];
      if (e.shiftKey && (doc.activeElement === premier || !boite.contains(doc.activeElement))) {
        e.preventDefault();
        dernier.focus();
      } else if (!e.shiftKey && doc.activeElement === dernier) {
        e.preventDefault();
        premier.focus();
      }
    }
    api._gererTouche = gererTouche;

    // Mémorise l'élément actif pour le restaurer à la fermeture.
    api._focusPrecedent = doc.activeElement;

    var focusable = boite.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled])') ||
      boite.querySelector('button:not([aria-label="Fermer"]):not([disabled])');
    if (focusable) focusable.focus();
    else entete.querySelector('button').focus();

    pileModales.push(api);
    if (pileModales.length === 1) isolerArrierePlan(true);
    return api;
  }

  function fermerModale(api) {
    var index = pileModales.indexOf(api);
    if (index !== -1) pileModales.splice(index, 1);
    doc.removeEventListener('keydown', api._gererTouche);
    if (api.element.parentNode) api.element.parentNode.removeChild(api.element);
    if (!pileModales.length) {
      doc.body.style.overflow = '';
      isolerArrierePlan(false);
    }
    // Le focus revient là où il était avant l'ouverture (navigation clavier).
    var precedent = api._focusPrecedent;
    if (precedent && typeof precedent.focus === 'function' && doc.contains(precedent)) {
      try { precedent.focus({ preventScroll: true }); } catch (e) { precedent.focus(); }
    } else if (pileModales.length) {
      var boite = pileModales[pileModales.length - 1].boite;
      var suivant = boite.querySelector('button');
      if (suivant) suivant.focus();
    }
  }

  /** Boîte de confirmation — indispensable avant toute action destructive. */
  function confirmer(options) {
    options = options || {};
    return new Promise(function (resoudre) {
      var corps = creer('div');
      if (options.message) corps.appendChild(creer('p', { text: options.message }));
      if (options.details) corps.appendChild(creer('p', { class: 'petit muet', text: options.details }));
      var modale = ouvrirModale({
        titre: options.titre || 'Confirmation',
        corps: corps,
        classe: options.classe,
        fermetureEchap: true,
        annuler: function () { resoudre(false); },
        actions: [
          { libelle: options.texteAnnuler || 'Annuler', classe: 'btn-fantome', action: function () { resoudre(false); } },
          {
            libelle: options.texteConfirmer || 'Confirmer',
            classe: options.danger ? 'btn-danger' : 'btn-principal',
            action: function () { resoudre(true); }
          }
        ]
      });
      modale.fermetureFond = true;
    });
  }

  /* ---------------------------------------------------------- impression */
  function imprimerElement(elementHtml, options) {
    options = options || {};
    var zone = $('#zone-impression');
    if (!zone) {
      zone = creer('div', { id: 'zone-impression' });
      doc.body.appendChild(zone);
    }
    zone.innerHTML = '';
    var copie = elementHtml.cloneNode(true);
    if (options.classe) copie.classList.add(options.classe);
    zone.appendChild(copie);
    doc.body.classList.add('mode-impression');
    var nettoye = false;
    var nettoyer = function () {
      if (nettoye) return;
      nettoye = true;
      doc.body.classList.remove('mode-impression');
      zone.innerHTML = '';
      global.removeEventListener('afterprint', nettoyer);
      if (api && api._minuterieSecours) global.clearTimeout(api._minuterieSecours);
    };
    var api = { nettoyer: nettoyer };
    global.addEventListener('afterprint', nettoyer);
    // Laisse le temps au navigateur de peindre le document avant d'ouvrir la
    // boîte d'impression (les images du logo doivent être décodées).
    global.setTimeout(function () {
      try { global.print(); } catch (e) { erreurUtilisateur(e, 'Impression'); nettoyer(); }
    }, 150);
    // Sécurité : si afterprint n'est pas déclenché (aperçu fermé sans
    // impression, certains navigateurs mobiles) on nettoie au retour du focus.
    api._minuterieSecours = global.setTimeout(function () {
      var focus = (typeof doc.hasFocus === 'function') ? doc.hasFocus() : true;
      if (!nettoye && focus && !doc.hidden) nettoyer();
      else if (!nettoye) api._minuterieSecours = global.setTimeout(nettoyer, 60000);
    }, 20000);
    return api;
  }

  /* -------------------------------------------------------- téléchargement */
  function telecharger(nomFichier, contenu, typeMime) {
    var blob = contenu instanceof Blob ? contenu : new Blob([contenu], { type: typeMime || 'application/octet-stream' });
    var objetUrl = URL.createObjectURL(blob);
    var lien = creer('a', { href: objetUrl, download: nomFichier });
    doc.body.appendChild(lien);
    lien.click();
    doc.body.removeChild(lien);
    global.setTimeout(function () { URL.revokeObjectURL(objetUrl); }, 4000);
  }

  function nomFichierSur(nom) {
    return String(nom).replace(/[^\w\-.àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ ]+/g, '_').replace(/\s+/g, '-');
  }

  /* ------------------------------------------------------------- fichiers */
  function lireFichierTexte(fichier) {
    return new Promise(function (resoudre, rejeter) {
      if (!fichier) return rejeter(new Error('Aucun fichier sélectionné.'));
      if (fichier.size > 20 * 1024 * 1024) return rejeter(new Error('Fichier trop volumineux (20 Mo maximum).'));
      var lecteur = new FileReader();
      lecteur.onload = function () { resoudre(String(lecteur.result)); };
      lecteur.onerror = function () { rejeter(new Error('Lecture du fichier impossible.')); };
      lecteur.readAsText(fichier);
    });
  }

  function lireFichierImage(fichier, maxLargeur, maxHauteur) {
    return new Promise(function (resoudre, rejeter) {
      if (!fichier) return rejeter(new Error('Aucun fichier sélectionné.'));
      if (fichier.type && fichier.type.indexOf('image/') !== 0) {
        return rejeter(new Error('Le fichier doit être une image (PNG, JPEG, WEBP ou SVG).'));
      }
      if (fichier.size > 3 * 1024 * 1024) return rejeter(new Error('Image trop lourde (3 Mo maximum).'));
      var lecteur = new FileReader();
      lecteur.onload = function () {
        var dataUrl = String(lecteur.result);
        if (fichier.type === 'image/svg+xml') { resoudre(dataUrl); return; }
        var image = new Image();
        image.onload = function () {
          var l = maxLargeur || 480;
          var h = maxHauteur || 240;
          var rapport = Math.min(1, l / image.width, h / image.height);
          var canvas = doc.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.width * rapport));
          canvas.height = Math.max(1, Math.round(image.height * rapport));
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          try {
            resoudre(canvas.toDataURL('image/png'));
          } catch (e) {
            resoudre(dataUrl);
          }
        };
        image.onerror = function () { rejeter(new Error('Image illisible.')); };
        image.src = dataUrl;
      };
      lecteur.onerror = function () { rejeter(new Error('Lecture de l\'image impossible.')); };
      lecteur.readAsDataURL(fichier);
    });
  }

  /* ------------------------------------------------------- temporisation */
  /**
   * Regroupe les appels répétés d'une fonction (saisie clavier,
   * redimensionnement) : une seule exécution après `delai` ms d'inactivité.
   * @returns {{appeler: Function, immediat: Function, annuler: Function}}
   */
  function debouncer(fn, delai) {
    var minuteur = null;
    var attente = typeof delai === 'number' ? delai : 120;
    function annuler() {
      if (minuteur) global.clearTimeout(minuteur);
      minuteur = null;
    }
    return {
      appeler: function () {
        var args = arguments;
        annuler();
        minuteur = global.setTimeout(function () {
          minuteur = null;
          fn.apply(null, args);
        }, attente);
      },
      immediat: function () {
        var args = arguments;
        annuler();
        fn.apply(null, args);
      },
      annuler: annuler,
      enAttente: function () { return minuteur !== null; }
    };
  }

  /** Exécute une fonction à la prochaine image (évite les rendus en rafale). */
  function prochaineImage(fn) {
    if (global.requestAnimationFrame) return global.requestAnimationFrame(fn);
    return global.setTimeout(fn, 16);
  }

  /**
   * Limite la fréquence d'exécution d'une fonction : le premier appel est
   * immédiat, les suivants sont regroupés en fin de fenêtre (`delai` ms).
   * Utilisé pour les rendus coûteux (aperçu A4) pendant la saisie.
   */
  function limiter(fn, delai) {
    var dernier = 0;
    var minuteur = null;
    var attente = typeof delai === 'number' ? delai : 100;
    function executer() {
      minuteur = null;
      dernier = Date.now();
      fn();
    }
    return {
      appeler: function () {
        if (minuteur) return;
        var reste = attente - (Date.now() - dernier);
        if (reste <= 0) executer();
        else minuteur = global.setTimeout(executer, reste);
      },
      immediat: function () {
        if (minuteur) global.clearTimeout(minuteur);
        executer();
      },
      annuler: function () {
        if (minuteur) global.clearTimeout(minuteur);
        minuteur = null;
      }
    };
  }

  /* ------------------------------------------------------------- divers */
  var compteurErreurs = 0;

  /**
   * Affiche (ou efface) le message d'erreur d'un champ.
   * Le message est relié au champ par aria-describedby : les lecteurs d'écran
   * le restituent lors de la saisie, et non seulement visuellement.
   */
  function champErreur(champ, message) {
    if (!champ) return;
    var bloc = champ.parentNode ? champ.parentNode.querySelector('.erreur') : null;
    if (bloc) {
      bloc.textContent = message || '';
      if (message) {
        if (!bloc.id) bloc.id = 'erreur-champ-' + (++compteurErreurs);
        var decrit = (champ.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
        if (decrit.indexOf(bloc.id) === -1) {
          decrit.push(bloc.id);
          champ.setAttribute('aria-describedby', decrit.join(' '));
        }
      }
    }
    if (champ.classList) champ.classList.toggle('invalide', !!message);
    if (message) champ.setAttribute('aria-invalid', 'true');
    else champ.removeAttribute('aria-invalid');
  }

  /** Regroupe plusieurs messages d'erreur sous un même champ (liste à puces). */
  function erreursChamp(champ, messages) {
    if (!champ) return;
    champErreur(champ, (messages || []).filter(Boolean).join(' '));
  }

  function viderErreurs(conteneur) {
    $$('.erreur', conteneur || doc).forEach(function (e) { e.textContent = ''; });
    $$('.invalide', conteneur || doc).forEach(function (e) { e.classList.remove('invalide'); });
  }

  /* ------------------------------------------------- hauteur de l'en-tête */
  /* L'en-tête est collant et sa hauteur change avec le zoom, la largeur ou
     le passage à la ligne de la marque. On publie donc sa hauteur réelle
     dans une variable CSS : les éléments collants (colonne d'aperçu)
     se calent correctement au lieu d'utiliser une valeur figée, fausse
     à 125 % ou 150 % de zoom. */
  function mesurerEntete() {
    // app.js est aussi chargé hors navigateur (tests Node) : sans document,
    // la mesure est simplement ignorée.
    if (!doc || typeof doc.querySelector !== 'function') return;
    var entete = doc.querySelector('.app-header');
    if (!entete) return;
    var hauteur = Math.round(entete.getBoundingClientRect().height);
    if (hauteur > 0) doc.documentElement.style.setProperty('--hauteur-entete', hauteur + 'px');
  }

  function surveillerEntete() {
    if (!doc || typeof doc.querySelector !== 'function') return;
    mesurerEntete();
    var lienActif = doc.querySelector('.app-nav [aria-current="page"]');
    if (lienActif && typeof lienActif.scrollIntoView === 'function') {
      try {
        lienActif.scrollIntoView({ inline: 'center', block: 'nearest' });
      } catch (e) { }
    }
    var entete = doc.querySelector('.app-header');
    if (entete && typeof global.ResizeObserver === 'function') {
      new global.ResizeObserver(mesurerEntete).observe(entete);
    }
    if (typeof global.addEventListener !== 'function') return;
    global.addEventListener('resize', limiter(mesurerEntete, 150), { passive: true });
    global.addEventListener('orientationchange', function () {
      global.setTimeout(mesurerEntete, 150);
    });
    if (doc.fonts && typeof doc.fonts.ready === 'object') {
      doc.fonts.ready.then(mesurerEntete, function () { });
    }
  }

  AGORA.app = {
    mesurerEntete: mesurerEntete,
    BASE: BASE,
    base: base,
    url: url,
    $: $,
    $$: $$,
    creer: creer,
    echapper: echapper,
    pret: pret,
    ICONES: ICONES,
    icone: icone,
    iconeElement: iconeElement,
    notifier: notifier,
    erreurUtilisateur: erreurUtilisateur,
    ouvrirModale: ouvrirModale,
    fermerModale: fermerModale,
    confirmer: confirmer,
    imprimerElement: imprimerElement,
    telecharger: telecharger,
    nomFichierSur: nomFichierSur,
    lireFichierTexte: lireFichierTexte,
    lireFichierImage: lireFichierImage,
    champErreur: champErreur,
    erreursChamp: erreursChamp,
    viderErreurs: viderErreurs,
    debouncer: debouncer,
    limiter: limiter,
    prochaineImage: prochaineImage,
    focusables: focusables
  };

  pret(surveillerEntete);

})(typeof globalThis !== 'undefined' ? globalThis : this);
