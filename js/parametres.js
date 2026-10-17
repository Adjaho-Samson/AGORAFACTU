/* ==========================================================================
   Agora Factures — réglages de l'application
   --------------------------------------------------------------------------
   • Définit les valeurs par défaut et la validation des réglages.
   • Persiste les préférences simples dans localStorage (via js/stockage.js).
   • Le logo (potentiellement lourd) est stocké dans IndexedDB.
   • Contient également la logique de la page « Paramètres ».
   ========================================================================== */
(function (global) {
  'use strict';

  var AGORA = global.AGORA || (global.AGORA = {});
  var app = AGORA.app;
  var doc = global.document;

  var VERSION_APP = '1.0.0';

  var MODELES = [
    { code: 'classique', libelle: 'Classique', description: 'En-tête bleu, tableau bordé, idéal pour un rendu institutionnel.' },
    { code: 'moderne', libelle: 'Moderne', description: 'Accent bleu clair, lignes aérées, mise en page contemporaine.' },
    { code: 'minimal', libelle: 'Minimaliste', description: 'Noir et blanc, compact : impression économique.' }
  ];

  var DEFAUTS = {
    vendeur: { nom: '', adresse: '', telephone: '', email: '', fiscal: '' },
    devise: 'XOF',
    decimales: null,                 // null = automatique selon la devise
    numerotation: {
      prefixeFacture: 'F',
      prefixeRecu: 'R',
      modele: '{PREFIX}-{AAAA}-{SEQ4}',
      remiseAZero: 'annuel',
      depart: 1
    },
    tva: { active: true, tauxDefaut: 18, mode: 'exclusive' },
    remise: { mode: 'pourcent' },
    document: {
      modele: 'classique',
      delaiEcheance: 30,
      notesDefaut: '',
      conditionsDefaut: ''
    },
    impression: { afficherLogo: true, couleur: true, signature: false, montantEnLettres: true },
    stockage: { rappelSauvegarde: true, delaiRappelJours: 30, derniereSauvegarde: null },
    app: { dernierType: 'facture' }
  };

  var MODES_REMISE_A_ZERO = [
    { code: 'jamais', libelle: 'Continue (jamais remise à zéro)' },
    { code: 'annuel', libelle: 'Remise à zéro chaque année' },
    { code: 'mensuel', libelle: 'Remise à zéro chaque mois' }
  ];

  /* ----------------------------------------------------------- utilitaires */
  function estObjet(v) { return v && typeof v === 'object' && !Array.isArray(v); }

  function fusionProfonde(base, patch) {
    var sortie = {};
    Object.keys(base || {}).forEach(function (k) {
      sortie[k] = estObjet(base[k]) ? fusionProfonde(base[k], {}) : base[k];
    });
    Object.keys(patch || {}).forEach(function (k) {
      if (estObjet(patch[k]) && estObjet(sortie[k])) sortie[k] = fusionProfonde(sortie[k], patch[k]);
      else if (patch[k] !== undefined) sortie[k] = patch[k];
    });
    return sortie;
  }

  function texte(v, max) {
    var s = String(v === null || v === undefined ? '' : v);
    s = s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
    return max && s.length > max ? s.slice(0, max) : s;
  }

  function entier(v, defaut, min, max) {
    var n = parseInt(v, 10);
    if (isNaN(n)) n = defaut;
    if (typeof min === 'number' && n < min) n = min;
    if (typeof max === 'number' && n > max) n = max;
    return n;
  }

  function nombrePositif(v, defaut, max) {
    var n = Number(String(v).replace(',', '.'));
    if (!isFinite(n) || n < 0) n = defaut;
    if (typeof max === 'number' && n > max) n = max;
    return n;
  }

  /** Nettoie et borne toutes les valeurs d'un objet de réglages. */
  function assainir(r) {
    var entree = estObjet(r) ? r : {};
    var sortie = fusionProfonde(DEFAUTS, {});

    var v = estObjet(entree.vendeur) ? entree.vendeur : {};
    sortie.vendeur = {
      nom: texte(v.nom, 120),
      adresse: texte(v.adresse, 400),
      telephone: texte(v.telephone, 40),
      email: texte(v.email, 120),
      fiscal: texte(v.fiscal, 60)
    };

    sortie.devise = texte(entree.devise, 8).toUpperCase() || 'XOF';
    var dec = entree.decimales;
    sortie.decimales = (dec === null || dec === '' || dec === undefined) ? null : entier(dec, 2, 0, 4);

    var n = estObjet(entree.numerotation) ? entree.numerotation : {};
    sortie.numerotation = {
      prefixeFacture: (texte(n.prefixeFacture, 10) || 'F').toUpperCase(),
      prefixeRecu: (texte(n.prefixeRecu, 10) || 'R').toUpperCase(),
      modele: texte(n.modele, 60) || '{PREFIX}-{AAAA}-{SEQ4}',
      remiseAZero: ['jamais', 'annuel', 'mensuel'].indexOf(n.remiseAZero) !== -1 ? n.remiseAZero : 'annuel',
      depart: entier(n.depart, 1, 0, 999999)
    };
    if (sortie.numerotation.modele.indexOf('{SEQ') === -1) sortie.numerotation.modele += '-{SEQ4}';

    var t = estObjet(entree.tva) ? entree.tva : {};
    sortie.tva = {
      active: t.active !== false,
      tauxDefaut: nombrePositif(t.tauxDefaut, 18, 100),
      mode: t.mode === 'inclusive' ? 'inclusive' : 'exclusive'
    };

    var rm = estObjet(entree.remise) ? entree.remise : {};
    sortie.remise = { mode: rm.mode === 'montant' ? 'montant' : 'pourcent' };

    var d = estObjet(entree.document) ? entree.document : {};
    sortie.document = {
      modele: MODELES.some(function (m) { return m.code === d.modele; }) ? d.modele : 'classique',
      delaiEcheance: entier(d.delaiEcheance, 30, 0, 365),
      notesDefaut: texte(d.notesDefaut, 1000),
      conditionsDefaut: texte(d.conditionsDefaut, 1000)
    };

    var i = estObjet(entree.impression) ? entree.impression : {};
    sortie.impression = {
      afficherLogo: i.afficherLogo !== false,
      couleur: i.couleur !== false,
      signature: i.signature === true,
      montantEnLettres: i.montantEnLettres !== false
    };

    var s = estObjet(entree.stockage) ? entree.stockage : {};
    sortie.stockage = {
      rappelSauvegarde: s.rappelSauvegarde !== false,
      delaiRappelJours: entier(s.delaiRappelJours, 30, 1, 365),
      derniereSauvegarde: typeof s.derniereSauvegarde === 'string' ? s.derniereSauvegarde : null
    };

    var a = estObjet(entree.app) ? entree.app : {};
    sortie.app = { dernierType: a.dernierType === 'recu' ? 'recu' : 'facture' };

    return sortie;
  }

  /* ------------------------------------------------------------- lecture */
  var cache = null;

  function lire() {
    if (!cache) {
      var brut = null;
      try {
        brut = AGORA.stockage.lireReglagesBruts();
      } catch (e) {
        brut = null;
      }
      cache = assainir(brut);
    }
    return cache;
  }

  function enregistrer(patch) {
    var actuels = lire();
    var fusion = fusionProfonde(actuels, patch || {});
    cache = assainir(fusion);
    AGORA.stockage.ecrireReglagesBruts(cache);
    return cache;
  }

  function reinitialiser() {
    cache = assainir({});
    AGORA.stockage.supprimerReglages();
    return cache;
  }

  /* ---------------------------------------------------------------- logo */
  var promesseLogo = null;
  var cacheLogo = null;

  function logo() {
    if (cacheLogo) return Promise.resolve(cacheLogo);
    if (!promesseLogo) {
      promesseLogo = AGORA.stockage.lireMeta('logo').then(function (valeur) {
        cacheLogo = (typeof valeur === 'string' && valeur.indexOf('data:image/') === 0) ? valeur : null;
        promesseLogo = null;
        return cacheLogo;
      });
    }
    return promesseLogo;
  }

  function definirLogo(dataUrl) {
    if (typeof dataUrl !== 'string' || dataUrl.indexOf('data:image/') !== 0) {
      return Promise.reject(new Error('Format de logo invalide.'));
    }
    if (dataUrl.length > 1024 * 1024) {
      return Promise.reject(new Error('Logo trop volumineux après redimensionnement.'));
    }
    cacheLogo = dataUrl;
    return AGORA.stockage.ecrireMeta('logo', dataUrl).then(function () { return dataUrl; });
  }

  function supprimerLogo() {
    cacheLogo = null;
    return AGORA.stockage.supprimerMeta('logo').then(function () { return null; });
  }

  /* --------------------------------------------------------- formatage */
  function formaterMontant(montant, devise) {
    var r = lire();
    return AGORA.calculs.formaterMontant(montant, devise || r.devise, { decimales: r.decimales });
  }

  function deviseInfo(devise) {
    var r = lire();
    return AGORA.calculs.deviseInfo(devise || r.devise, { decimales: r.decimales });
  }

  AGORA.parametres = {
    VERSION_APP: VERSION_APP,
    DEFAUTS: DEFAUTS,
    MODELES: MODELES,
    MODES_REMISE_A_ZERO: MODES_REMISE_A_ZERO,
    assainir: assainir,
    fusionProfonde: fusionProfonde,
    lire: lire,
    enregistrer: enregistrer,
    reinitialiser: reinitialiser,
    logo: logo,
    definirLogo: definirLogo,
    supprimerLogo: supprimerLogo,
    formaterMontant: formaterMontant,
    deviseInfo: deviseInfo,
    initPage: initPage
  };

  /* ========================================================================
     Page « Paramètres »
     ======================================================================== */
  function initPage() {
    var formulaire = app.$('#formulaire-parametres');
    if (!formulaire) return;

    var reglages = lire();
    var $ = app.$;

    /* ---------------------------------------------------------- vendeur */
    $('#v-nom').value = reglages.vendeur.nom;
    $('#v-adresse').value = reglages.vendeur.adresse;
    $('#v-telephone').value = reglages.vendeur.telephone;
    $('#v-email').value = reglages.vendeur.email;
    $('#v-fiscal').value = reglages.vendeur.fiscal;

    /* ------------------------------------------------------------ logo */
    var apercuLogo = $('#logo-apercu');
    function afficherLogo(dataUrl) {
      if (dataUrl) {
        apercuLogo.innerHTML = '<img alt="Logo du vendeur">';
        apercuLogo.querySelector('img').src = dataUrl;
      } else {
        apercuLogo.innerHTML = '<span class="petit muet">Aucun logo</span>';
      }
    }
    logo().then(afficherLogo);

    $('#logo-fichier').addEventListener('change', function (e) {
      var fichier = e.target.files && e.target.files[0];
      if (!fichier) return;
      app.lireFichierImage(fichier, 480, 240).then(function (dataUrl) {
        afficherLogo(dataUrl);
        logoEnAttente = dataUrl;
        app.notifier('Logo chargé. Enregistrez pour le conserver.', 'info');
      }, function (err) {
        app.erreurUtilisateur(err, 'Logo');
      });
      e.target.value = '';
    });
    var logoEnAttente = null;

    $('#logo-supprimer').addEventListener('click', function () {
      app.confirmer({
        titre: 'Supprimer le logo ?',
        message: 'Le logo sera retiré de votre profil vendeur.',
        texteConfirmer: 'Supprimer',
        danger: true
      }).then(function (oui) {
        if (!oui) return;
        supprimerLogo().then(function () {
          logoEnAttente = '';
          afficherLogo(null);
          app.notifier('Logo supprimé.', 'succes');
        }, app.erreurUtilisateur);
      });
    });

    /* ----------------------------------------------------------- devise */
    var selectDevise = $('#devise');
    var devisesConnues = Object.keys(AGORA.calculs.DEVISES);
    devisesConnues.forEach(function (code) {
      var info = AGORA.calculs.DEVISES[code];
      selectDevise.appendChild(app.creer('option', { value: code, text: code + ' — ' + info.libelle }));
    });
    if (devisesConnues.indexOf(reglages.devise) === -1) {
      selectDevise.appendChild(app.creer('option', { value: reglages.devise, text: reglages.devise + ' — devise personnalisée' }));
    }
    selectDevise.value = reglages.devise;
    $('#devise-personnalisee').value = devisesConnues.indexOf(reglages.devise) === -1 ? reglages.devise : '';
    selectDevise.addEventListener('change', function () {
      $('#devise-personnalisee').value = '';
      majApercuNumerotation();
    });

    var selectDecimales = $('#decimales');
    [
      { v: '', t: 'Automatique selon la devise' },
      { v: '0', t: '0 décimale (ex. 1 250)' },
      { v: '2', t: '2 décimales (ex. 1 250,00)' },
      { v: '3', t: '3 décimales (ex. 1 250,000)' }
    ].forEach(function (o) {
      selectDecimales.appendChild(app.creer('option', { value: o.v, text: o.t }));
    });
    selectDecimales.value = reglages.decimales === null ? '' : String(reglages.decimales);

    /* ------------------------------------------------------ numérotation */
    $('#num-prefixe-facture').value = reglages.numerotation.prefixeFacture;
    $('#num-prefixe-recu').value = reglages.numerotation.prefixeRecu;
    $('#num-modele').value = reglages.numerotation.modele;
    var selectRemise = $('#num-remise');
    MODES_REMISE_A_ZERO.forEach(function (o) {
      selectRemise.appendChild(app.creer('option', { value: o.code, text: o.libelle }));
    });
    selectRemise.value = reglages.numerotation.remiseAZero;
    $('#num-depart').value = reglages.numerotation.depart;

    var compteurs = {};
    AGORA.stockage.listerCompteurs().then(function (liste) {
      (liste || []).forEach(function (c) { compteurs[c.cle] = c.valeur; });
      afficherCompteurs();
      majApercuNumerotation();
    }, function () { majApercuNumerotation(); });

    function afficherCompteurs() {
      var conteneur = $('#liste-compteurs');
      if (!conteneur) return;
      conteneur.innerHTML = '';
      var cles = Object.keys(compteurs).sort();
      if (!cles.length) {
        conteneur.appendChild(app.creer('p', { class: 'petit muet', text: 'Aucun compteur utilisé pour le moment.' }));
        return;
      }
      var table = app.creer('table', { class: 'tableau' });
      table.innerHTML = '<thead><tr><th>Compteur</th><th class="nombre">Dernier numéro utilisé</th></tr></thead>';
      var corps = app.creer('tbody');
      cles.forEach(function (cle) {
        var tr = app.creer('tr', {}, [
          app.creer('td', { class: 'mono', text: cle.replace('|', ' · ') }),
          app.creer('td', { class: 'nombre mono', text: String(compteurs[cle]) })
        ]);
        corps.appendChild(tr);
      });
      table.appendChild(corps);
      conteneur.appendChild(table);
      conteneur.appendChild(app.creer('p', {
        class: 'aide petit muet',
        text: 'Un numéro déjà attribué n\'est jamais réattribué : les compteurs ne peuvent que progresser.'
      }));
    }

    var timerApercu = null;
    function majApercuNumerotation() {
      if (timerApercu) global.clearTimeout(timerApercu);
      timerApercu = global.setTimeout(function () {
        var provisoire = lireReglagesFormulaire(false);
        var aujourdhui = AGORA.calculs.aujourdhui();
        AGORA.stockage.prochainNumero('facture', provisoire, aujourdhui).then(function (n) {
          $('#num-apercu-facture').textContent = n;
        });
        AGORA.stockage.prochainNumero('recu', provisoire, aujourdhui).then(function (n) {
          $('#num-apercu-recu').textContent = n;
        });
      }, 120);
    }
    ['#num-prefixe-facture', '#num-prefixe-recu', '#num-modele', '#num-remise', '#num-depart']
      .forEach(function (sel) { $(sel).addEventListener('input', majApercuNumerotation); $(sel).addEventListener('change', majApercuNumerotation); });

    /* --------------------------------------------------------- TVA/remise */
    $('#tva-active').checked = reglages.tva.active;
    $('#tva-taux').value = reglages.tva.tauxDefaut;
    $('#tva-mode').value = reglages.tva.mode;
    $('#remise-mode').value = reglages.remise.mode;

    function majEtatTva() {
      var actif = $('#tva-active').checked;
      $('#tva-taux').disabled = !actif;
      $('#tva-mode').disabled = !actif;
    }
    $('#tva-active').addEventListener('change', majEtatTva);
    majEtatTva();

    /* ---------------------------------------------------------- document */
    var selectModele = $('#doc-modele');
    MODELES.forEach(function (m) {
      selectModele.appendChild(app.creer('option', { value: m.code, text: m.libelle + ' — ' + m.description }));
    });
    selectModele.value = reglages.document.modele;
    $('#doc-delai').value = reglages.document.delaiEcheance;
    $('#doc-notes').value = reglages.document.notesDefaut;
    $('#doc-conditions').value = reglages.document.conditionsDefaut;

    /* -------------------------------------------------------- impression */
    $('#imp-logo').checked = reglages.impression.afficherLogo;
    $('#imp-couleur').checked = reglages.impression.couleur;
    $('#imp-signature').checked = reglages.impression.signature;
    $('#imp-lettres').checked = reglages.impression.montantEnLettres;

    /* ---------------------------------------------------------- stockage */
    $('#stock-rappel').checked = reglages.stockage.rappelSauvegarde;
    $('#stock-delai').value = reglages.stockage.delaiRappelJours;

    majInfosStockage();
    function majInfosStockage() {
      AGORA.stockage.compterDocuments().then(function (total) {
        $('#stock-documents').textContent = String(total);
      }, function () { $('#stock-documents').textContent = '—'; });
      AGORA.stockage.estimationEspace().then(function (e) {
        if (!e) { $('#stock-espace').textContent = 'information non disponible'; return; }
        var ko = function (o) { return (o / 1024).toFixed(0) + ' Ko'; };
        $('#stock-espace').textContent = ko(e.usage) + (e.quota ? ' sur environ ' + (e.quota / (1024 * 1024)).toFixed(0) + ' Mo' : '');
      });
      var derniere = reglages.stockage.derniereSauvegarde;
      $('#stock-derniere-sauvegarde').textContent = derniere ? AGORA.calculs.formaterDateHeure(derniere) : 'jamais';
    }

    /* ------------------------------------------------------------ à propos */
    $('#a-propos-version').textContent = VERSION_APP;
    $('#a-propos-navigateur').textContent = global.navigator ? String(global.navigator.userAgent).slice(0, 120) : '—';

    /* --------------------------------------------------------- enregistrement */
    formulaire.addEventListener('submit', function (e) {
      e.preventDefault();
      app.viderErreurs(formulaire);
      var brut = lireReglagesFormulaire(true);
      var erreurs = valider(brut);
      if (erreurs.length) {
        erreurs.forEach(function (err) {
          if (err.champ) app.champErreur($(err.champ), err.message);
        });
        app.notifier(erreurs.length + ' champ(s) à corriger.', 'erreur');
        return;
      }
      try {
        enregistrer(brut);
        if (typeof logoEnAttente === 'string') {
          var promesse = logoEnAttente === '' ? supprimerLogo() : definirLogo(logoEnAttente);
          logoEnAttente = null;
          promesse.catch(function (err) { app.erreurUtilisateur(err, 'Logo'); });
        }
        reglages = lire();
        app.notifier('Paramètres enregistrés.', 'succes');
        majInfosStockage();
      } catch (err) {
        app.erreurUtilisateur(err, 'Enregistrement des paramètres');
      }
    });

    $('#parametres-reinitialiser').addEventListener('click', function () {
      app.confirmer({
        titre: 'Réinitialiser les paramètres ?',
        message: 'Les réglages reviendront à leurs valeurs par défaut. Vos documents ne sont pas supprimés.',
        texteConfirmer: 'Réinitialiser',
        danger: true
      }).then(function (oui) {
        if (!oui) return;
        reinitialiser();
        app.notifier('Paramètres réinitialisés.', 'succes');
        global.setTimeout(function () { global.location.reload(); }, 600);
      });
    });

    function lireReglagesFormulaire(strict) {
      var devisePerso = texte($('#devise-personnalisee').value, 8).toUpperCase();
      var decimalesBrut = $('#decimales').value;
      return {
        vendeur: {
          nom: texte($('#v-nom').value, 120),
          adresse: texte($('#v-adresse').value, 400),
          telephone: texte($('#v-telephone').value, 40),
          email: texte($('#v-email').value, 120).toLowerCase(),
          fiscal: texte($('#v-fiscal').value, 60)
        },
        devise: devisePerso || $('#devise').value || 'XOF',
        decimales: decimalesBrut === '' ? null : entier(decimalesBrut, 2, 0, 4),
        numerotation: {
          prefixeFacture: (texte($('#num-prefixe-facture').value, 10) || 'F').toUpperCase(),
          prefixeRecu: (texte($('#num-prefixe-recu').value, 10) || 'R').toUpperCase(),
          modele: texte($('#num-modele').value, 60) || '{PREFIX}-{AAAA}-{SEQ4}',
          remiseAZero: $('#num-remise').value,
          depart: entier($('#num-depart').value, 1, 0, 999999)
        },
        tva: {
          active: $('#tva-active').checked,
          tauxDefaut: nombrePositif($('#tva-taux').value, 0, 100),
          mode: $('#tva-mode').value
        },
        remise: { mode: $('#remise-mode').value },
        document: {
          modele: $('#doc-modele').value,
          delaiEcheance: entier($('#doc-delai').value, 0, 0, 365),
          notesDefaut: texte($('#doc-notes').value, 1000),
          conditionsDefaut: texte($('#doc-conditions').value, 1000)
        },
        impression: {
          afficherLogo: $('#imp-logo').checked,
          couleur: $('#imp-couleur').checked,
          signature: $('#imp-signature').checked,
          montantEnLettres: $('#imp-lettres').checked
        },
        stockage: {
          rappelSauvegarde: $('#stock-rappel').checked,
          delaiRappelJours: entier($('#stock-delai').value, 30, 1, 365),
          derniereSauvegarde: lire().stockage.derniereSauvegarde
        },
        app: { dernierType: strict ? lire().app.dernierType : lire().app.dernierType }
      };
    }

    function valider(r) {
      var erreurs = [];
      if (r.vendeur.email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(r.vendeur.email)) {
        erreurs.push({ champ: '#v-email', message: 'Adresse e-mail invalide.' });
      }
      if (!r.devise || !/^[A-Z]{3}$/.test(r.devise)) {
        erreurs.push({ champ: '#devise', message: 'La devise doit être un code de 3 lettres (ex. XOF).' });
      }
      if (r.numerotation.modele.indexOf('{SEQ') === -1) {
        erreurs.push({ champ: '#num-modele', message: 'Le modèle doit contenir {SEQ} ou {SEQ4}.' });
      }
      if (r.tva.active && !(r.tva.tauxDefaut >= 0 && r.tva.tauxDefaut <= 100)) {
        erreurs.push({ champ: '#tva-taux', message: 'Le taux de TVA doit être compris entre 0 et 100.' });
      }
      return erreurs;
    }

    /* ------------------------------------------------- sauvegarde / import */
    $('#bouton-exporter').addEventListener('click', function () {
      AGORA.stockage.exporterDonnees().then(function (donnees) {
        var nom = 'agora-factures-sauvegarde-' + AGORA.calculs.aujourdhui() + '.json';
        app.telecharger(nom, JSON.stringify(donnees, null, 2), 'application/json');
        enregistrer({ stockage: { derniereSauvegarde: new Date().toISOString() } });
        reglages = lire();
        majInfosStockage();
        app.notifier('Sauvegarde exportée (' + nom + ').', 'succes');
      }, function (err) { app.erreurUtilisateur(err, 'Export'); });
    });

    $('#fichier-import').addEventListener('change', function (e) {
      var fichier = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!fichier) return;
      app.lireFichierTexte(fichier).then(function (contenu) {
        var donnees;
        try {
          donnees = JSON.parse(contenu);
        } catch (err) {
          throw new Error('Le fichier n\'est pas un JSON valide.');
        }
        if (!donnees || !Array.isArray(donnees.documents)) {
          throw new Error('Le fichier ne contient pas de documents Agora Factures.');
        }
        var corps = app.creer('div');
        corps.appendChild(app.creer('p', {
          text: 'Le fichier contient ' + donnees.documents.length + ' document(s)' +
            (donnees.exporteLe ? ', exporté le ' + AGORA.calculs.formaterDateHeure(donnees.exporteLe) : '') + '.'
        }));
        corps.appendChild(app.creer('p', {
          class: 'petit muet',
          text: '« Fusionner » conserve vos documents actuels et ajoute uniquement les nouveaux. « Remplacer » efface tout avant l\'import : vos données actuelles seront perdues.'
        }));
        app.ouvrirModale({
          titre: 'Restaurer une sauvegarde',
          corps: corps,
          actions: [
            { libelle: 'Annuler', classe: 'btn-fantome', action: function () { } },
            {
              libelle: 'Fusionner',
              classe: 'btn-secondaire',
              action: function () { return restaurer(donnees, 'fusionner'); }
            },
            {
              libelle: 'Remplacer',
              classe: 'btn-danger',
              action: function () { return restaurer(donnees, 'remplacer'); }
            }
          ]
        });
      }, function (err) { app.erreurUtilisateur(err, 'Import'); });
    });

    function restaurer(donnees, mode) {
      return AGORA.stockage.importerDonnees(donnees, { mode: mode }).then(function (compteur) {
        app.notifier('Restauration terminée : ' + compteur.ajoutes + ' ajouté(s), ' +
          compteur.remplaces + ' remplacé(s), ' + compteur.ignores + ' ignoré(s).', 'succes', 6000);
        majInfosStockage();
        AGORA.stockage.listerCompteurs().then(function (liste) {
          compteurs = {};
          (liste || []).forEach(function (c) { compteurs[c.cle] = c.valeur; });
          afficherCompteurs();
          majApercuNumerotation();
        });
      }, function (err) { app.erreurUtilisateur(err, 'Restauration'); });
    }

    $('#bouton-effacer').addEventListener('click', function () {
      var corps = app.creer('div');
      corps.appendChild(app.creer('p', {
        text: 'Cette action supprime définitivement TOUS les documents, les compteurs de numérotation, le logo et les préférences enregistrés dans ce navigateur.'
      }));
      corps.appendChild(app.creer('p', { class: 'petit', text: 'Cette opération est irréversible. Exportez d\'abord une sauvegarde si vous souhaitez conserver vos données.' }));
      var saisie = app.creer('input', { type: 'text', id: 'confirmation-effacement', placeholder: 'EFFACER', autocomplete: 'off' });
      corps.appendChild(app.creer('div', { class: 'champ' }, [
        app.creer('label', { for: 'confirmation-effacement', text: 'Tapez EFFACER pour confirmer' }),
        saisie
      ]));
      app.ouvrirModale({
        titre: 'Effacer toutes les données locales',
        corps: corps,
        actions: [
          { libelle: 'Annuler', classe: 'btn-fantome', action: function () { } },
          {
            libelle: 'Tout effacer',
            classe: 'btn-danger',
            action: function () {
              if (saisie.value.trim().toUpperCase() !== 'EFFACER') {
                app.notifier('Saisissez EFFACER pour confirmer.', 'erreur');
                return false;
              }
              return AGORA.stockage.effacerTout().then(function () {
                app.notifier('Toutes les données locales ont été effacées.', 'succes');
                global.setTimeout(function () { global.location.href = app.url('parametres.html'); global.location.reload(); }, 800);
              }, function (err) { app.erreurUtilisateur(err, 'Effacement'); });
            }
          }
        ]
      });
    });

    $('#bouton-persistance').addEventListener('click', function () {
      AGORA.stockage.demanderPersistance().then(function (ok) {
        if (ok) app.notifier('Stockage persistant accordé par le navigateur.', 'succes');
        else app.notifier('Le navigateur a refusé ou ne gère pas le stockage persistant. Exportez régulièrement vos sauvegardes.', 'avertissement', 6000);
      });
    });

    /* ------------------------------------------------- rappel de sauvegarde */
    (function rappel() {
      var r = lire();
      if (!r.stockage.rappelSauvegarde) return;
      var derniere = r.stockage.derniereSauvegarde;
      if (!derniere) return;
      var ageJours = (Date.now() - new Date(derniere).getTime()) / 86400000;
      if (ageJours > r.stockage.delaiRappelJours) {
        app.notifier('Dernière sauvegarde : ' + Math.round(ageJours) + ' jours. Pensez à exporter vos données.', 'avertissement', 8000);
      }
    })();

    majApercuNumerotation();
  }

  app.pret(function () {
    if (doc.body && doc.body.dataset.page === 'parametres') initPage();
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = AGORA.parametres;

})(typeof globalThis !== 'undefined' ? globalThis : this);
