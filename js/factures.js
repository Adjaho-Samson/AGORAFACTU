/* ==========================================================================
   Agora Factures — éditeur de document (facture.html)
   --------------------------------------------------------------------------
   Gère : le choix facture / reçu, la saisie vendeur / client / lignes,
   les calculs en temps réel, l'aperçu, la validation, l'enregistrement
   (brouillon ou document émis), l'impression et l'export PDF.
   ========================================================================== */
(function (global) {
  'use strict';

  var AGORA = global.AGORA || (global.AGORA = {});
  var app = AGORA.app;
  var doc = global.document;
  var calculs = AGORA.calculs;
  var $ = function (s) { return app.$(s); };

  var etat = {
    doc: null,
    logo: null,          // logo utilisé par ce document (data URL)
    logoReglages: null,  // logo du profil
    reglages: null,
    numeroApercu: '',
    id: null,
    modifie: false,
    initialise: false
  };

  /* ------------------------------------------------------------ utilitaires */
  function nombreOu(input, defaut, min, max) {
    var brut = String(input.value === null || input.value === undefined ? '' : input.value).trim();
    if (brut === '') {
      app.champErreur(input, '');
      if (defaut === undefined) { input.value = ''; return null; }
      input.value = String(defaut);
      return defaut;
    }
    if (!calculs.estNombre(brut.replace(/\s/g, ''))) {
      app.champErreur(input, 'Nombre invalide');
      return null;
    }
    var n = calculs.nombre(brut, 0);
    if (typeof min === 'number' && n < min) {
      app.champErreur(input, 'Minimum ' + min);
      return null;
    }
    if (typeof max === 'number' && n > max) {
      app.champErreur(input, 'Maximum ' + max);
      return null;
    }
    app.champErreur(input, '');
    return n;
  }

  function majBadgeStatut() {
    var bloc = $('#bloc-statut');
    if (!bloc) return;
    var statut = calculs.statutEffectif(etat.doc);
    var info = calculs.statutInfo(statut);
    bloc.className = 'pastille ' + info.classe;
    bloc.textContent = info.libelle;
  }

  /* --------------------------------------------------------- lignes (DOM) */
  function ligneHtml(ligne, index) {
    var tr = doc.createElement('tr');
    tr.dataset.index = String(index);

    var tdDesignation = doc.createElement('td');
    tdDesignation.dataset.libelle = 'Désignation';
    var designation = doc.createElement('input');
    designation.type = 'text';
    designation.className = 'ligne-designation';
    designation.value = ligne.designation || '';
    designation.placeholder = 'Désignation de l\'article ou du service';
    designation.setAttribute('aria-label', 'Désignation ligne ' + (index + 1));
    tdDesignation.appendChild(designation);
    tr.appendChild(tdDesignation);

    function celluleNumerique(nom, valeur, options) {
      var td = doc.createElement('td');
      td.dataset.libelle = options && options.libelle ? options.libelle : '';
      if (options && options.classe) td.className = options.classe;
      var input = doc.createElement('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.className = 'ligne-' + nom + ' nombre';
      input.value = valeur === null || valeur === undefined ? '' : String(valeur);
      input.setAttribute('aria-label', (options && options.libelle ? options.libelle : nom) + ' ligne ' + (index + 1));
      td.appendChild(input);
      td.appendChild(app.creer('div', { class: 'erreur' }));
      tr.appendChild(td);
      return input;
    }

    var qte = celluleNumerique('quantite', ligne.quantite, { libelle: 'Quantité', classe: 'col-quantite' });
    var pu = celluleNumerique('prix', ligne.prixUnitaire, { libelle: 'Prix unitaire', classe: 'col-prix' });
    var remise = celluleNumerique('remise', ligne.remise, { libelle: 'Remise', classe: 'col-remise' });
    var tva = celluleNumerique('tva', ligne.tauxTva, { libelle: 'TVA %', classe: 'col-tva' });
    if (!etat.doc.tvaActive) tva.disabled = true;

    var tdMontant = doc.createElement('td');
    tdMontant.className = 'nombre ligne-montant col-montant-total';
    tdMontant.dataset.libelle = 'Montant';
    tr.appendChild(tdMontant);

    var tdActions = doc.createElement('td');
    var bouton = doc.createElement('button');
    bouton.type = 'button';
    bouton.className = 'btn btn-danger btn-icone';
    bouton.title = 'Supprimer la ligne';
    bouton.setAttribute('aria-label', 'Supprimer la ligne ' + (index + 1));
    bouton.innerHTML = app.icone('supprimer');
    bouton.addEventListener('click', function () { supprimerLigne(index); });
    tdActions.appendChild(bouton);
    tr.appendChild(tdActions);

    function surEntree() {
      lireLignes();
      maj(false);
    }
    designation.addEventListener('input', function () {
      etat.doc.lignes[index].designation = designation.value;
      etat.modifie = true;
      maj(true);
    });
    [qte, pu, remise, tva].forEach(function (input) {
      input.addEventListener('input', surEntree);
      input.addEventListener('blur', function () { lireLignes(); maj(false); });
    });

    return tr;
  }

  function rendreLignes() {
    var corps = $('#corps-lignes');
    if (!corps) return;
    corps.innerHTML = '';
    etat.doc.lignes.forEach(function (ligne, index) {
      corps.appendChild(ligneHtml(ligne, index));
    });
    majEtatColonnes();
  }

  function majEtatColonnes() {
    var entetes = {
      remise: $('#entete-remise'),
      tva: $('#entete-tva')
    };
    if (entetes.remise) entetes.remise.classList.toggle('cache', etat.doc.modeRemise === 'aucune');
    if (entetes.tva) entetes.tva.classList.toggle('cache', !etat.doc.tvaActive);
    app.$$('.ligne-remise').forEach(function (i) { i.parentNode.classList.toggle('cache', etat.doc.modeRemise === 'aucune'); });
    app.$$('.ligne-tva').forEach(function (i) {
      i.parentNode.classList.toggle('cache', !etat.doc.tvaActive);
      i.disabled = !etat.doc.tvaActive;
    });
  }

  function ajouterLigne() {
    lireFormulaire();
    etat.doc.lignes.push(AGORA.documents.ligneVide(etat.reglages));
    etat.modifie = true;
    rendreLignes();
    maj(true);
    var inputs = app.$$('.ligne-designation');
    if (inputs.length) {
      inputs[inputs.length - 1].focus();
      if (inputs[inputs.length - 1].scrollIntoView) {
        inputs[inputs.length - 1].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  function supprimerLigne(index) {
    if (etat.doc.lignes.length <= 1) {
      app.notifier('Un document doit contenir au moins une ligne.', 'avertissement');
      return;
    }
    lireFormulaire();
    etat.doc.lignes.splice(index, 1);
    etat.modifie = true;
    rendreLignes();
    maj(true);
  }

  /* ------------------------------------------------------ lecture / écriture */
  function lireLignes() {
    var corps = $('#corps-lignes');
    if (!corps) return;
    app.$$('tr', corps).forEach(function (tr, index) {
      var ligne = etat.doc.lignes[index];
      if (!ligne) return;
      var designation = tr.querySelector('.ligne-designation');
      var qte = tr.querySelector('.ligne-quantite');
      var pu = tr.querySelector('.ligne-prix');
      var remise = tr.querySelector('.ligne-remise');
      var tva = tr.querySelector('.ligne-tva');
      if (designation) ligne.designation = String(designation.value).slice(0, 300);
      var q = nombreOu(qte, 0, 0, 1000000);
      if (q !== null) ligne.quantite = q;
      var p = nombreOu(pu, 0, -1000000000, 1000000000);
      if (p !== null) ligne.prixUnitaire = p;
      var r = nombreOu(remise, 0, 0, 1000000000);
      if (r !== null) ligne.remise = r;
      var t = nombreOu(tva, 0, 0, 100);
      if (t !== null) ligne.tauxTva = t;
    });
  }

  function lireFormulaire() {
    var d = etat.doc;
    d.type = ($('#type-recu') && $('#type-recu').checked) ? 'recu' : 'facture';
    d.dateEmission = $('#doc-date').value || calculs.aujourdhui();
    d.dateEcheance = $('#doc-echeance').value || null;
    d.devise = ($('#doc-devise').value || 'XOF').toUpperCase();
    d.modele = $('#doc-modele').value;
    d.tvaActive = $('#tva-active').checked;
    d.tvaMode = $('#tva-mode').value;
    d.modeRemise = $('#remise-mode').value;
    var typeRemiseGlobale = $('#remise-globale-type').value;
    var valeurRemise = nombreOu($('#remise-globale-valeur'), 0, 0, 1000000000);
    d.remiseGlobale = {
      type: typeRemiseGlobale === 'montant' ? 'montant' : 'pourcent',
      valeur: valeurRemise === null ? 0 : valeurRemise
    };

    d.vendeur = {
      nom: $('#vendeur-nom').value.trim(),
      adresse: $('#vendeur-adresse').value.trim(),
      telephone: $('#vendeur-telephone').value.trim(),
      email: $('#vendeur-email').value.trim(),
      fiscal: $('#vendeur-fiscal').value.trim(),
      logo: etat.logo
    };
    d.client = {
      nom: $('#client-nom').value.trim(),
      telephone: $('#client-telephone').value.trim(),
      adresse: $('#client-adresse').value.trim(),
      email: $('#client-email').value.trim()
    };
    d.notes = $('#doc-notes').value;
    d.conditions = $('#doc-conditions').value;

    lirePaiement(d);
    return d;
  }

  /**
   * Lit la section « Paiement » du formulaire.
   *
   * Règle importante : le formulaire ne représente qu'un seul paiement
   * immédiat. Un document qui possède DÉJÀ plusieurs paiements ne doit jamais
   * être écrasé : la lecture est alors neutralisée et les paiements existants
   * sont conservés tels quels (ils se gèrent depuis la boîte de dialogue
   * « Enregistrer un paiement »). Sans cette précaution, ouvrir une facture
   * partiellement réglée puis « Marquer comme payée » effaçait les paiements
   * précédents au lieu de les compléter.
   */
  function lirePaiement(d) {
    var caseActive = $('#paiement-actif');
    var estRecu = d.type === 'recu';
    if (estRecu && caseActive) caseActive.checked = true;
    var actif = caseActive ? caseActive.checked : false;

    if (!actif && !estRecu) {
      // Aucun paiement demandé : un brouillon jamais enregistré repart à zéro.
      if (!d.id && d.statut === 'brouillon') d.paiements = [];
      return d;
    }

    // Paiements déjà enregistrés en nombre : on ne touche à rien.
    if ((d.paiements || []).length > 1) return d;

    var montant = nombreOu($('#paiement-montant'), undefined, 0, 1000000000);
    var valeur = montant === null ? 0 : montant;
    var methode = $('#paiement-methode').value;
    var date = $('#paiement-date').value || calculs.aujourdhui();
    var reference = $('#paiement-reference').value.trim();

    if (valeur > 0) {
      var existant = d.paiements && d.paiements.length ? d.paiements[0] : null;
      d.paiements = [{
        id: existant ? existant.id : 'p_' + Math.random().toString(36).slice(2, 9),
        date: date,
        montant: valeur,
        methode: methode,
        reference: reference
      }];
    } else {
      d.paiements = [];
    }
    return d;
  }

  /** Affiche l'état réel de la section paiement (paiements multiples…). */
  function majEtatPaiement() {
    var d = etat.doc;
    var nombre = (d.paiements || []).length;
    var multiple = nombre > 1;
    var note = $('#note-paiements-multiples');
    if (note) {
      note.classList.toggle('cache', !multiple);
      var compte = $('#nb-paiements');
      if (compte) compte.textContent = String(nombre);
      var total = $('#total-paiements');
      if (total) {
        total.textContent = AGORA.parametres.formaterMontant(
          calculs.totalPaiements(d.paiements), d.devise);
      }
    }
    ['#paiement-montant', '#paiement-date', '#paiement-methode', '#paiement-reference']
      .forEach(function (selecteur) {
        var champ = $(selecteur);
        if (!champ) return;
        champ.disabled = multiple;
        champ.classList.toggle('desactive', multiple);
      });
    var action = $('#bouton-paiement');
    if (action) action.classList.toggle('cache', !d.id);
  }

  function remplirFormulaire() {
    var d = etat.doc;
    $('#type-facture').checked = d.type !== 'recu';
    $('#type-recu').checked = d.type === 'recu';
    $('#doc-date').value = d.dateEmission || calculs.aujourdhui();
    $('#doc-echeance').value = d.dateEcheance || '';
    $('#doc-devise').value = d.devise || 'XOF';
    $('#doc-modele').value = d.modele || 'classique';
    $('#tva-active').checked = d.tvaActive !== false;
    $('#tva-mode').value = d.tvaMode || 'exclusive';
    $('#remise-mode').value = d.modeRemise || 'pourcent';
    $('#remise-globale-type').value = (d.remiseGlobale && d.remiseGlobale.type) || 'pourcent';
    $('#remise-globale-valeur').value = (d.remiseGlobale && d.remiseGlobale.valeur) || '';

    $('#vendeur-nom').value = (d.vendeur && d.vendeur.nom) || '';
    $('#vendeur-adresse').value = (d.vendeur && d.vendeur.adresse) || '';
    $('#vendeur-telephone').value = (d.vendeur && d.vendeur.telephone) || '';
    $('#vendeur-email').value = (d.vendeur && d.vendeur.email) || '';
    $('#vendeur-fiscal').value = (d.vendeur && d.vendeur.fiscal) || '';

    $('#client-nom').value = (d.client && d.client.nom) || '';
    $('#client-telephone').value = (d.client && d.client.telephone) || '';
    $('#client-adresse').value = (d.client && d.client.adresse) || '';
    $('#client-email').value = (d.client && d.client.email) || '';

    $('#doc-notes').value = d.notes || '';
    $('#doc-conditions').value = d.conditions || '';

    var paiement = (d.paiements && d.paiements[0]) || null;
    if ($('#paiement-actif')) $('#paiement-actif').checked = !!paiement;
    $('#paiement-montant').value = paiement ? paiement.montant : '';
    $('#paiement-methode').value = paiement ? paiement.methode : 'Especes';
    $('#paiement-date').value = paiement ? paiement.date : calculs.aujourdhui();
    $('#paiement-reference').value = paiement ? (paiement.reference || '') : '';

    majModeType();
    rendreLignes();
    majEtatPaiement();
    if (reconstructionApercu) reconstructionApercu.annuler();
    maj(true);
  }

  function majModeType() {
    var estRecu = etat.doc.type === 'recu';
    app.$$('.si-recu').forEach(function (e) { e.classList.toggle('cache', !estRecu); });
    app.$$('.si-facture').forEach(function (e) { e.classList.toggle('cache', estRecu); });
    var titre = $('#titre-page-editeur');
    if (titre) titre.textContent = estRecu ? 'Nouveau reçu' : 'Nouvelle facture';
    var echeance = $('#champ-echeance');
    if (echeance) echeance.classList.toggle('cache', estRecu);
    var blocPaiement = $('#bloc-paiement');
    if (blocPaiement) blocPaiement.classList.remove('cache');
    var paiementActif = $('#paiement-actif');
    if (paiementActif) {
      paiementActif.disabled = estRecu;
      if (estRecu) paiementActif.checked = true;
    }
    var labelMontant = $('#label-paiement-montant');
    if (labelMontant) labelMontant.textContent = estRecu ? 'Montant reçu *' : 'Montant reçu';
  }

  /* --------------------------------------------------------- calcul / aperçu */
  /**
   * Reconstruction de l'aperçu A4. C'est l'opération la plus coûteuse de la
   * page (plusieurs centaines de nœuds + mesure de mise en page) : elle est
   * limitée à une exécution par fenêtre de 110 ms pendant la saisie, les
   * totaux restant quant à eux mis à jour immédiatement.
   */
  var reconstructionApercu = null;

  function rendreApercu() {
    var d = etat.doc;
    var zone = $('#zone-apercu');
    if (!zone) return;
    var element = AGORA.documents.rendreHtml(d, {
      logo: etat.logo,
      modele: d.modele,
      couleur: etat.reglages.impression.couleur,
      signature: etat.reglages.impression.signature,
      montantEnLettres: etat.reglages.impression.montantEnLettres,
      afficherLogo: etat.reglages.impression.afficherLogo
    });
    var conteneur = doc.createElement('div');
    conteneur.className = 'apercu-echelle';
    conteneur.appendChild(element);
    zone.innerHTML = '';
    zone.appendChild(conteneur);
    AGORA.documents.ajusterEchelle(zone, conteneur);
  }

  function maj(reconstruireLignesMontants) {
    var d = etat.doc;
    var m = AGORA.documents.montants(d);

    // Montants affichés
    $('#resume-sous-total').textContent = AGORA.parametres.formaterMontant(m.sousTotal, d.devise);
    $('#resume-remises').textContent = AGORA.parametres.formaterMontant(m.remisesLignes + m.remiseGlobale, d.devise);
    $('#resume-base').textContent = AGORA.parametres.formaterMontant(m.baseImposable, d.devise);
    $('#resume-tva').textContent = AGORA.parametres.formaterMontant(m.tva, d.devise);
    $('#resume-total').textContent = AGORA.parametres.formaterMontant(m.total, d.devise);
    $('#resume-paye').textContent = AGORA.parametres.formaterMontant(m.totalPaye, d.devise);
    $('#resume-solde').textContent = AGORA.parametres.formaterMontant(m.solde, d.devise);

    var libelleBase = $('#libelle-base');
    if (libelleBase) {
      libelleBase.textContent = !d.tvaActive
        ? 'Montant HT'
        : (d.tvaMode === 'inclusive' ? 'Total HT (extrait)' : 'Base imposable');
    }

    var blocTvaDetail = $('#resume-tva-detail');
    if (blocTvaDetail) {
      blocTvaDetail.innerHTML = '';
      if (d.tvaActive && m.tvaParTaux.length > 1) {
        m.tvaParTaux.forEach(function (tv) {
          var l = doc.createElement('div');
          l.className = 'ligne-resume petit muet';
          l.textContent = 'TVA ' + calculs.formaterNombre(tv.taux, 2) + ' % : ' + AGORA.parametres.formaterMontant(tv.tva, d.devise);
          blocTvaDetail.appendChild(l);
        });
      }
    }

    // Montant de chaque ligne
    if (reconstruireLignesMontants !== false) {
      var corps = $('#corps-lignes');
      if (corps) {
        app.$$('tr', corps).forEach(function (tr, i) {
          var cellule = tr.querySelector('.ligne-montant');
          if (cellule && m.lignes[i]) cellule.textContent = AGORA.parametres.formaterMontant(m.lignes[i].total, d.devise);
        });
      }
    }

    majBadgeStatut();
    majEtatPaiement();

    // Aperçu A4 : reconstruit au plus une fois par fenêtre de 110 ms.
    if (!reconstructionApercu) reconstructionApercu = app.limiter(rendreApercu, 110);
    reconstructionApercu.appeler();
  }

  /* ------------------------------------------------------------ validation */
  function valider(pourEmission) {
    app.viderErreurs(doc);
    var erreurs = [];
    var d = etat.doc;

    if (!d.vendeur.nom) erreurs.push({ champ: '#vendeur-nom', message: 'Le nom du vendeur est obligatoire.' });
    if (d.vendeur.email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(d.vendeur.email)) {
      erreurs.push({ champ: '#vendeur-email', message: 'E-mail du vendeur invalide.' });
    }
    if (pourEmission && !d.client.nom) {
      erreurs.push({ champ: '#client-nom', message: 'Le nom du client est obligatoire.' });
    }
    if (d.client.email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(d.client.email)) {
      erreurs.push({ champ: '#client-email', message: 'E-mail du client invalide.' });
    }
    if (!d.dateEmission) erreurs.push({ champ: '#doc-date', message: 'La date d\'émission est obligatoire.' });
    if (d.dateEcheance && d.dateEcheance < d.dateEmission) {
      erreurs.push({ champ: '#doc-echeance', message: 'L\'échéance ne peut pas précéder la date d\'émission.' });
    }
    if (!/^[A-Za-z]{3}$/.test(d.devise)) {
      erreurs.push({ champ: '#doc-devise', message: 'Devise invalide (3 lettres).' });
    }

    var lignesRenseignees = d.lignes.filter(function (l) {
      return (l.designation && l.designation.trim()) || (l.prixUnitaire > 0 && l.quantite > 0);
    });
    if (pourEmission && !lignesRenseignees.length) {
      erreurs.push({ message: 'Ajoutez au moins un article ou un service.' });
    }
    if (pourEmission) {
      d.lignes.forEach(function (l, i) {
        if ((l.prixUnitaire > 0 || l.quantite > 0) && !String(l.designation || '').trim()) {
          erreurs.push({ message: 'La ligne ' + (i + 1) + ' n\'a pas de désignation.' });
        }
      });
    }

    var m = AGORA.documents.montants(d);
    if (pourEmission && m.total <= 0) {
      erreurs.push({ message: 'Le total du document doit être supérieur à zéro.' });
    }
    if (d.type === 'recu' && pourEmission && m.totalPaye <= 0) {
      erreurs.push({ champ: '#paiement-montant', message: 'Un reçu doit correspondre à un paiement enregistré.' });
    }

    erreurs.forEach(function (e) {
      if (e.champ) app.champErreur($(e.champ), e.message);
    });
    return erreurs;
  }

  /* --------------------------------------------------------- enregistrement */
  function enregistrer(mode) {
    // mode : 'brouillon' | 'emis'
    lireLignes();
    lireFormulaire();
    var pourEmission = mode === 'emis';
    var erreurs = valider(pourEmission);
    if (erreurs.length) {
      app.notifier(erreurs[0].message || 'Corrigez les erreurs du formulaire.', 'erreur', 6000);
      var premier = erreurs[0].champ ? $(erreurs[0].champ) : null;
      if (premier) {
        if (premier.scrollIntoView) premier.scrollIntoView({ behavior: 'smooth', block: 'center' });
        premier.focus();
      }
      return Promise.resolve(false);
    }

    var d = etat.doc;
    var nouveau = !d.id;

    // Garde-fou : un second clic pendant l'enregistrement ne doit pas
    // consommer un second numéro de facture.
    if (etat.enregistrementEnCours) {
      app.notifier('Enregistrement déjà en cours…', 'info', 2000);
      return Promise.resolve(false);
    }
    etat.enregistrementEnCours = true;
    var terminer = function () { etat.enregistrementEnCours = false; };

    var suite = nouveau && !d.numero
      ? AGORA.stockage.reserverNumero(d.type, etat.reglages, d.dateEmission).then(function (numero) {
        d.numero = numero;
        return d;
      })
      : Promise.resolve(d);

    return suite.then(function () {
      var m = AGORA.documents.montants(d);
      if (mode === 'emis') {
        if (d.type === 'recu') {
          d.statut = (m.totalPaye >= m.total) ? 'payee' : 'partielle';
        } else {
          d.statut = calculs.statutSelonPaiement(m.total, m.totalPaye, d.statut === 'brouillon' ? 'en_attente' : d.statut);
          if (d.statut === 'brouillon') d.statut = 'en_attente';
        }
      } else {
        d.statut = 'brouillon';
      }
      return AGORA.stockage.enregistrerDocument(d);
    }).then(function (sauve) {
      etat.doc = sauve;
      etat.id = sauve.id;
      etat.modifie = false;
      if (global.history && global.history.replaceState) {
        global.history.replaceState(null, '', global.location.pathname + '?id=' + encodeURIComponent(sauve.id));
      }
      majNumero();
      majBadgeStatut();
      // Le formulaire est resynchronisé avec l'état réellement enregistré
      // (notamment la section paiement, qui peut comporter plusieurs règlements).
      remplirFormulaire();
      majActionsStatut();
      app.notifier(mode === 'emis'
        ? (sauve.type === 'recu' ? 'Reçu enregistré (' + sauve.numero + ').' : 'Facture émise (' + sauve.numero + ').')
        : 'Brouillon enregistré (' + sauve.numero + ').', 'succes');
      terminer();
      return true;
    }, function (e) {
      terminer();
      app.erreurUtilisateur(e, 'Enregistrement');
      return false;
    });
  }

  function majNumero() {
    var champ = $('#doc-numero');
    if (!champ) return;
    if (etat.doc.numero) {
      champ.value = etat.doc.numero;
      champ.dataset.etat = 'attribue';
    } else {
      champ.value = '';
      champ.placeholder = etat.numeroApercu ? ('Sera : ' + etat.numeroApercu) : 'Attribué à l\'enregistrement';
      champ.dataset.etat = 'apercu';
    }
  }

  function majActionsStatut() {
    var d = etat.doc;
    var annulee = d.statut === 'annulee';
    var bloc = $('#actions-statut');
    if (!bloc) return;
    bloc.classList.toggle('cache', !d.id);
    app.$$('button', bloc).forEach(function (b) { b.disabled = annulee && b.dataset.action !== 'reactiver'; });
    if ($('#bouton-annuler')) $('#bouton-annuler').classList.toggle('cache', annulee || !d.id || d.statut === 'brouillon');
    var m = AGORA.documents.montants(d);
    var reglee = m.solde <= 0 && m.total > 0;
    if ($('#bouton-marquer-payee')) {
      $('#bouton-marquer-payee').classList.toggle('cache', annulee || !d.id || d.statut === 'brouillon' || reglee);
    }
    if ($('#bouton-paiement')) {
      $('#bouton-paiement').classList.toggle('cache', annulee || !d.id || reglee);
    }
  }

  /* ------------------------------------------------------------- paiements */
  function ouvrirPaiement() {
    lireLignes();
    lireFormulaire();
    var m = AGORA.documents.montants(etat.doc);
    var corps = doc.createElement('div');

    var champMontant = app.creer('input', { type: 'text', inputmode: 'decimal', id: 'p-montant', value: String(m.solde > 0 ? m.solde : 0) });
    var champDate = app.creer('input', { type: 'date', id: 'p-date', value: calculs.aujourdhui() });
    var champMethode = app.creer('select', { id: 'p-methode' });
    ['Especes', 'Virement', 'Cheque', 'Mobile money', 'Carte bancaire', 'Autre'].forEach(function (methode) {
      champMethode.appendChild(app.creer('option', { value: methode, text: methode }));
    });
    var champReference = app.creer('input', { type: 'text', id: 'p-reference', placeholder: 'facultatif' });

    corps.appendChild(app.creer('div', { class: 'champ' }, [
      app.creer('label', { for: 'p-montant', text: 'Montant reçu (' + etat.doc.devise + ')' }),
      champMontant,
      app.creer('div', { class: 'erreur' })
    ]));
    corps.appendChild(app.creer('div', { class: 'champ' }, [
      app.creer('label', { for: 'p-date', text: 'Date du paiement' }),
      champDate,
      app.creer('div', { class: 'erreur' })
    ]));
    corps.appendChild(app.creer('div', { class: 'champ' }, [
      app.creer('label', { for: 'p-methode', text: 'Moyen de paiement' }),
      champMethode
    ]));
    corps.appendChild(app.creer('div', { class: 'champ' }, [
      app.creer('label', { for: 'p-reference', text: 'Référence' }),
      champReference
    ]));
    corps.appendChild(app.creer('p', {
      class: 'petit muet',
      text: 'Total : ' + AGORA.parametres.formaterMontant(m.total, etat.doc.devise) +
        ' · déjà payé : ' + AGORA.parametres.formaterMontant(m.totalPaye, etat.doc.devise) +
        ' · reste : ' + AGORA.parametres.formaterMontant(m.solde, etat.doc.devise)
    }));

    var historique = app.creer('div', { class: 'champ' });
    historique.appendChild(app.creer('span', { class: 'legende', text: 'Historique des paiements' }));
    if (!etat.doc.paiements.length) {
      historique.appendChild(app.creer('p', { class: 'petit muet', text: 'Aucun paiement enregistré.' }));
    } else {
      var table = app.creer('table', { class: 'tableau' });
      table.innerHTML = '<thead><tr><th>Date</th><th>Méthode</th><th class="nombre">Montant</th><th></th></tr></thead>';
      var tb = app.creer('tbody');
      etat.doc.paiements.forEach(function (p, i) {
        var tr = app.creer('tr', {}, [
          app.creer('td', { text: calculs.formaterDate(p.date) }),
          app.creer('td', { text: (p.methode || '—') + (p.reference ? ' · ' + p.reference : '') }),
          app.creer('td', { class: 'nombre', text: AGORA.parametres.formaterMontant(p.montant, etat.doc.devise) }),
          (function () {
            var td = app.creer('td');
            var b = app.creer('button', { class: 'btn btn-danger btn-petit', type: 'button', html: app.icone('supprimer'), 'aria-label': 'Supprimer le paiement' });
            b.addEventListener('click', function () {
              etat.doc.paiements.splice(i, 1);
              app.fermerModale(modale);
              ouvrirPaiement();
            });
            td.appendChild(b);
            return td;
          })()
        ]);
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      historique.appendChild(app.creer('div', { class: 'table-enveloppe' }, [table]));
    }
    corps.appendChild(historique);

    var modale = app.ouvrirModale({
      titre: 'Enregistrer un paiement',
      corps: corps,
      actions: [
        { libelle: 'Annuler', classe: 'btn-fantome', action: function () { } },
        {
          libelle: 'Enregistrer',
          classe: 'btn-principal',
          action: function () {
            var montant = nombreOu(champMontant, undefined, 0.01, 1000000000);
            if (montant === null) return false;
            etat.doc.paiements.push({
              id: 'p_' + Math.random().toString(36).slice(2, 9),
              date: champDate.value || calculs.aujourdhui(),
              montant: montant,
              methode: champMethode.value,
              reference: champReference.value.trim()
            });
            etat.modifie = true;
            return enregistrer('emis');
          }
        }
      ]
    });
  }

  function annulerDocument() {
    var d = etat.doc;
    var m = AGORA.documents.montants(d);
    if (m.totalPaye > 0) {
      app.notifier('Ce document comporte des paiements enregistrés. Supprimez-les avant de l\'annuler.', 'avertissement', 6000);
      return;
    }
    var corps = doc.createElement('div');
    corps.appendChild(app.creer('p', { text: 'Le document ' + d.numero + ' sera marqué comme annulé. Il restera consultable dans l\'historique et sera exclu des montants encaissés.' }));
    var champMotif = app.creer('textarea', { id: 'motif-annulation', rows: '2', placeholder: 'Erreur de saisie, doublon, commande annulée…' });
    corps.appendChild(app.creer('div', { class: 'champ' }, [
      app.creer('label', { for: 'motif-annulation', text: 'Motif (facultatif)' }),
      champMotif
    ]));
    app.ouvrirModale({
      titre: 'Annuler le document',
      corps: corps,
      actions: [
        { libelle: 'Annuler', classe: 'btn-fantome', action: function () { } },
        {
          libelle: 'Annuler le document',
          classe: 'btn-danger',
          action: function () {
            d.statut = 'annulee';
            d.annuleeLe = new Date().toISOString();
            d.motifAnnulation = champMotif.value.trim();
            return AGORA.stockage.enregistrerDocument(d).then(function (sauve) {
              etat.doc = sauve;
              maj(true);
              majBadgeStatut();
              majActionsStatut();
              app.notifier('Document annulé.', 'succes');
            }, function (e) { app.erreurUtilisateur(e, 'Annulation'); });
          }
        }
      ]
    });
  }

  function marquerPayee() {
    lireLignes();
    lireFormulaire();
    var m = AGORA.documents.montants(etat.doc);
    var manquant = Math.max(0, m.solde);
    if (etat.enregistrementEnCours) {
      app.notifier('Opération déjà en cours…', 'info', 2000);
      return;
    }
    if (manquant <= 0) {
      app.notifier('Ce document est déjà soldé.', 'info');
      return;
    }
    app.confirmer({
      titre: 'Marquer comme payée',
      message: 'Un paiement du solde restant (' + AGORA.parametres.formaterMontant(manquant, etat.doc.devise) + ') sera enregistré à la date du jour.',
      texteConfirmer: 'Marquer payée'
    }).then(function (oui) {
      if (!oui) return;
      etat.doc.paiements.push({
        id: 'p_' + Math.random().toString(36).slice(2, 9),
        date: calculs.aujourdhui(),
        montant: manquant,
        methode: 'Especes',
        reference: ''
      });
      enregistrer('emis');
    });
  }

  /* -------------------------------------------------------------- aperçu */
  function ouvrirApercu() {
    lireLignes();
    lireFormulaire();
    var d = etat.doc;
    var element = AGORA.documents.rendreHtml(d, {
      logo: etat.logo,
      modele: d.modele,
      couleur: etat.reglages.impression.couleur,
      signature: etat.reglages.impression.signature,
      montantEnLettres: etat.reglages.impression.montantEnLettres,
      afficherLogo: etat.reglages.impression.afficherLogo
    });
    var conteneur = doc.createElement('div');
    conteneur.className = 'zone-apercu';
    var echelle = doc.createElement('div');
    echelle.className = 'apercu-echelle';
    echelle.appendChild(element);
    conteneur.appendChild(echelle);
    var modale = app.ouvrirModale({
      titre: (d.type === 'recu' ? 'Reçu' : 'Facture') + (d.numero ? ' n° ' + d.numero : ' (brouillon)'),
      corps: conteneur,
      large: true,
      classe: 'apercu-dialogue',
      actions: [
        {
          libelle: 'Imprimer',
          classe: 'btn-secondaire',
          action: function () { imprimerDoc(element); return false; }
        },
        {
          libelle: 'PDF',
          classe: 'btn-bleu',
          action: function () {
            exporterPdf();
            return false;
          }
        },
        { libelle: 'Fermer', classe: 'btn-fantome', action: function () { } }
      ]
    });
    global.setTimeout(function () {
      AGORA.documents.ajusterEchelle(conteneur, echelle);
    }, 30);
    var redimensionner = function () { AGORA.documents.ajusterEchelle(conteneur, echelle); };
    global.addEventListener('resize', redimensionner);
    modale.element.addEventListener('DOMNodeRemoved', function () {
      global.removeEventListener('resize', redimensionner);
    });
  }

  function imprimerDoc(elementCible) {
    var element = elementCible;
    if (!element) {
      lireLignes();
      lireFormulaire();
      element = AGORA.documents.rendreHtml(etat.doc, {
        logo: etat.logo,
        modele: etat.doc.modele,
        couleur: etat.reglages.impression.couleur,
        signature: etat.reglages.impression.signature,
        montantEnLettres: etat.reglages.impression.montantEnLettres,
        afficherLogo: etat.reglages.impression.afficherLogo
      });
    }
    app.imprimerElement(element);
  }

  function exporterPdf() {
    lireLignes();
    lireFormulaire();
    var erreurs = valider(false);
    if (erreurs.length && erreurs[0].champ) {
      app.notifier(erreurs[0].message, 'avertissement');
    }
    app.notifier('Génération du PDF…', 'info', 2000);
    AGORA.pdf.telechargerPdf(etat.doc, {
      logo: etat.logo,
      modele: etat.doc.modele,
      couleur: etat.reglages.impression.couleur,
      signature: etat.reglages.impression.signature,
      montantEnLettres: etat.reglages.impression.montantEnLettres,
      afficherLogo: etat.reglages.impression.afficherLogo
    }).then(function () {
      app.notifier('PDF généré.', 'succes');
    }, function (e) {
      app.erreurUtilisateur(e, 'PDF');
    });
  }

  /* ---------------------------------------------------------------- logo */
  function gererLogo() {
    var fichier = $('#vendeur-logo');
    if (fichier) {
      fichier.addEventListener('change', function (e) {
        var f = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!f) return;
        app.lireFichierImage(f, 480, 240).then(function (dataUrl) {
          etat.logo = dataUrl;
          afficherLogo();
          etat.modifie = true;
          maj(true);
          app.notifier('Logo ajouté au document.', 'succes');
        }, function (err) { app.erreurUtilisateur(err, 'Logo'); });
      });
    }
    var supprimer = $('#vendeur-logo-supprimer');
    if (supprimer) {
      supprimer.addEventListener('click', function () {
        etat.logo = null;
        afficherLogo();
        etat.modifie = true;
        maj(true);
      });
    }
    var restaurer = $('#vendeur-restaurer');
    if (restaurer) {
      restaurer.addEventListener('click', function () {
        var r = etat.reglages.vendeur;
        $('#vendeur-nom').value = r.nom || '';
        $('#vendeur-adresse').value = r.adresse || '';
        $('#vendeur-telephone').value = r.telephone || '';
        $('#vendeur-email').value = r.email || '';
        $('#vendeur-fiscal').value = r.fiscal || '';
        etat.logo = etat.logoReglages;
        afficherLogo();
        lireFormulaire();
        maj(true);
        app.notifier('Profil vendeur restauré depuis les paramètres.', 'succes');
      });
    }
  }

  function afficherLogo() {
    var zone = $('#vendeur-logo-apercu');
    if (!zone) return;
    if (etat.logo) {
      zone.innerHTML = '<img alt="Aperçu du logo">';
      zone.querySelector('img').src = etat.logo;
    } else {
      zone.innerHTML = '<span class="petit muet">Aucun logo</span>';
    }
  }

  /* ------------------------------------------------------------ initialisation */
  function nouveauDocument(type) {
    etat.doc = AGORA.documents.creerVide(type, etat.reglages, etat.logoReglages);
    etat.logo = etat.logoReglages;
    etat.id = null;
    etat.modifie = false;
    majNumeroApercu(type);
    remplirFormulaire();
    afficherLogo();
    majActionsStatut();
  }

  function majNumeroApercu(type) {
    AGORA.stockage.prochainNumero(type || etat.doc.type, etat.reglages, $('#doc-date').value || calculs.aujourdhui())
      .then(function (n) {
        etat.numeroApercu = n;
        majNumero();
      }, function () { majNumero(); });
  }

  function majNumeroType() {
    if (etat.doc && !etat.doc.numero) majNumeroApercu();
  }

  function init() {
    etat.reglages = AGORA.parametres.lire();

    // Devises
    var selectDevise = $('#doc-devise');
    var liste = Object.keys(calculs.DEVISES);
    liste.forEach(function (code) {
      selectDevise.appendChild(app.creer('option', { value: code, text: code + ' — ' + calculs.DEVISES[code].libelle }));
    });
    if (liste.indexOf(etat.reglages.devise) === -1) {
      selectDevise.appendChild(app.creer('option', { value: etat.reglages.devise, text: etat.reglages.devise }));
    }

    // Modèles
    var selectModele = $('#doc-modele');
    AGORA.parametres.MODELES.forEach(function (m) {
      selectModele.appendChild(app.creer('option', { value: m.code, text: m.libelle }));
    });

    // Méthodes de paiement
    var selectMethode = $('#paiement-methode');
    ['Especes', 'Virement', 'Cheque', 'Mobile money', 'Carte bancaire', 'Autre'].forEach(function (methode) {
      selectMethode.appendChild(app.creer('option', { value: methode, text: methode }));
    });

    var params = new URLSearchParams(global.location.search);
    var id = params.get('id');
    var copie = params.get('copie');
    var type = params.get('type') === 'recu' ? 'recu' : (etat.reglages.app.dernierType || 'facture');

    AGORA.parametres.logo().then(function (logo) {
      etat.logoReglages = logo;
      if (id) {
        return AGORA.stockage.obtenirDocument(id).then(function (document_) {
          if (!document_) {
            app.notifier('Document introuvable : création d\'un nouveau document.', 'avertissement');
            etat.doc = AGORA.documents.creerVide(type, etat.reglages, logo);
            etat.logo = logo;
            remplirFormulaire();
            majNumeroApercu();
          } else {
            etat.doc = document_;
            etat.id = document_.id;
            etat.logo = (document_.vendeur && document_.vendeur.logo) || logo;
            remplirFormulaire();
            majNumero();
          }
          finaliser();
        });
      }
      if (copie) {
        return AGORA.stockage.obtenirDocument(copie).then(function (document_) {
          if (document_) {
            etat.doc = AGORA.documents.dupliquer(document_, false);
            etat.doc.dateEmission = calculs.aujourdhui();
            if (etat.doc.dateEcheance && etat.doc.dateEcheance < etat.doc.dateEmission) etat.doc.dateEcheance = null;
          } else {
            etat.doc = AGORA.documents.creerVide(type, etat.reglages, logo);
          }
          etat.logo = (etat.doc.vendeur && etat.doc.vendeur.logo) || logo;
          remplirFormulaire();
          majNumeroApercu(etat.doc.type);
          app.notifier('Document dupliqué : un nouveau numéro sera attribué.', 'info');
          finaliser();
        });
      }
      etat.doc = AGORA.documents.creerVide(type, etat.reglages, logo);
      etat.logo = logo;
      remplirFormulaire();
      majNumeroApercu(type);
      finaliser();
    }, function (e) {
      app.erreurUtilisateur(e, 'Chargement');
      etat.doc = AGORA.documents.creerVide(type, etat.reglages, null);
      remplirFormulaire();
      finaliser();
    });

    function finaliser() {
      if (etat.initialise) return;
      etat.initialise = true;

      // Écouteurs globaux de recalcul
      // (les radios de type et le champ de fichier ont leur propre gestionnaire)
      app.$$('input, select, textarea').forEach(function (champ) {
        if (champ.closest && (champ.closest('#corps-lignes') || champ.closest('.choix-type'))) return;
        if (champ.type === 'file' || champ.type === 'radio') return;
        champ.addEventListener('input', function () {
          etat.modifie = true;
          lireFormulaire();
          maj(true);
        });
        champ.addEventListener('change', function () {
          etat.modifie = true;
          lireFormulaire();
          if (champ === $('#tva-active')) majEtatColonnes();
          if (champ === $('#remise-mode')) majEtatColonnes();
          if (champ === $('#doc-modele')) maj(true);
          maj(true);
        });
      });

      $('#type-facture').addEventListener('change', changerType);
      $('#type-recu').addEventListener('change', changerType);
      $('#doc-date').addEventListener('change', majNumeroType);

      $('#ajouter-ligne').addEventListener('click', ajouterLigne);
      $('#bouton-brouillon').addEventListener('click', function () { enregistrer('brouillon'); });
      $('#bouton-enregistrer').addEventListener('click', function () { enregistrer('emis'); });
      $('#bouton-apercu').addEventListener('click', ouvrirApercu);
      $('#bouton-imprimer').addEventListener('click', function () { imprimerDoc(); });
      $('#bouton-pdf').addEventListener('click', exporterPdf);
      $('#bouton-paiement').addEventListener('click', ouvrirPaiement);
      if ($('#bouton-annuler')) $('#bouton-annuler').addEventListener('click', annulerDocument);
      if ($('#bouton-marquer-payee')) $('#bouton-marquer-payee').addEventListener('click', marquerPayee);
      $('#bouton-nouveau').addEventListener('click', function () {
        var partir = function () {
          etat.doc = AGORA.documents.creerVide(etat.doc.type, etat.reglages, etat.logoReglages);
          etat.logo = etat.logoReglages;
          etat.id = null;
          if (global.history && global.history.replaceState) global.history.replaceState(null, '', global.location.pathname);
          remplirFormulaire();
          majNumeroApercu();
          majActionsStatut();
        };
        if (!etat.modifie) return partir();
        app.confirmer({
          titre: 'Abandonner les modifications ?',
          message: 'Les saisies non enregistrées seront perdues.',
          texteConfirmer: 'Nouveau document',
          danger: true
        }).then(function (oui) { if (oui) partir(); });
      });

      gererLogo();

      global.addEventListener('resize', function () {
        var zone = $('#zone-apercu');
        var conteneur = zone ? zone.querySelector('.apercu-echelle') : null;
        if (conteneur) AGORA.documents.ajusterEchelle(zone, conteneur);
      });

      global.addEventListener('beforeunload', function (e) {
        if (!etat.modifie) return undefined;
        e.preventDefault();
        e.returnValue = '';
        return '';
      });

      majActionsStatut();
      afficherLogo();
      maj(true);
    }
  }

  function changerType() {
    var nouveauType = $('#type-recu').checked ? 'recu' : 'facture';
    if (etat.doc.type === nouveauType) return;
    var appliquer = function () {
      lireFormulaire();
      etat.doc.type = nouveauType;
      if (etat.doc.id) {
        // un document déjà enregistré ne change pas de numéro : on prévient
        app.notifier('Le type a changé ; le numéro déjà attribué est conservé.', 'avertissement');
      } else {
        etat.doc.numero = null;
      }
      etat.reglages = AGORA.parametres.enregistrer({ app: { dernierType: nouveauType } });
      majModeType();
      majNumeroApercu(nouveauType);
      maj(true);
    };
    if (!etat.doc.id && etat.modifie) {
      app.confirmer({
        titre: 'Changer de type de document ?',
        message: 'Les informations saisies sont conservées. Un nouveau numéro sera attribué selon le type choisi.',
        texteConfirmer: 'Changer'
      }).then(function (oui) { if (oui) appliquer(); else { $('#type-facture').checked = etat.doc.type !== 'recu'; $('#type-recu').checked = etat.doc.type === 'recu'; } });
    } else {
      appliquer();
    }
  }

  app.pret(function () {
    if (doc.body && doc.body.dataset.page === 'facture') init();
  });

  AGORA.factures = {
    etat: etat,
    enregistrer: enregistrer,
    maj: maj
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
