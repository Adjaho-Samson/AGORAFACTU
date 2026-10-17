/* ==========================================================================
   Agora Factures — modèle de document et rendu visuel
   --------------------------------------------------------------------------
   Création d'un document vide, duplication, et rendu HTML des trois modèles
   (classique, moderne, minimaliste). Le même DOM sert pour :
     • l'aperçu en temps réel,
     • l'impression (css/print.css),
     • le repère visuel de l'export PDF.
   Le contenu saisi par l'utilisateur est inséré via textContent : aucune
   injection HTML n'est possible.
   ========================================================================== */
(function (global) {
  'use strict';

  var AGORA = global.AGORA || (global.AGORA = {});
  var doc = global.document;

  function el(balise, classe, texte) {
    var e = doc.createElement(balise);
    if (classe) e.className = classe;
    if (texte !== undefined && texte !== null) e.textContent = String(texte);
    return e;
  }

  /** Crée un document vide cohérent avec les réglages courants. */
  function creerVide(type, reglages, logo) {
    var r = (reglages && reglages.document) ? reglages : (AGORA.parametres ? AGORA.parametres.lire() : {});
    var calculs = AGORA.calculs;
    var aujourdhui = calculs.aujourdhui();
    var delai = (r.document && r.document.delaiEcheance) || 0;
    var echeance = null;
    if (delai > 0) {
      var d = new Date(aujourdhui + 'T00:00:00');
      d.setDate(d.getDate() + delai);
      echeance = d.getFullYear() + '-' + calculs.pad(d.getMonth() + 1) + '-' + calculs.pad(d.getDate());
    }
    return {
      id: null,
      type: type === 'recu' ? 'recu' : 'facture',
      numero: null,
      statut: 'brouillon',
      dateEmission: aujourdhui,
      dateEcheance: echeance,
      devise: (r && r.devise) || 'XOF',
      tvaActive: !r.tva || r.tva.active !== false,
      tvaMode: (r.tva && r.tva.mode) || 'exclusive',
      modeRemise: (r.remise && r.remise.mode) || 'pourcent',
      modele: (r.document && r.document.modele) || 'classique',
      remiseGlobale: { type: 'pourcent', valeur: 0 },
      vendeur: {
        nom: (r.vendeur && r.vendeur.nom) || '',
        adresse: (r.vendeur && r.vendeur.adresse) || '',
        telephone: (r.vendeur && r.vendeur.telephone) || '',
        email: (r.vendeur && r.vendeur.email) || '',
        fiscal: (r.vendeur && r.vendeur.fiscal) || '',
        logo: logo || null
      },
      client: { nom: '', telephone: '', adresse: '', email: '' },
      lignes: [ligneVide(r)],
      paiements: [],
      notes: (r.document && r.document.notesDefaut) || '',
      conditions: (r.document && r.document.conditionsDefaut) || '',
      createdAt: null,
      updatedAt: null,
      montants: null
    };
  }

  function ligneVide(reglages) {
    var r = reglages || (AGORA.parametres ? AGORA.parametres.lire() : {});
    return {
      id: 'l_' + Math.random().toString(36).slice(2, 9),
      designation: '',
      quantite: 1,
      prixUnitaire: 0,
      remise: 0,
      tauxTva: (r.tva && r.tva.active !== false) ? (r.tva.tauxDefaut || 0) : 0
    };
  }

  /** Recalcule et attache les montants au document (source de vérité). */
  function montants(docSource) {
    var m = AGORA.calculs.calculerDocument(docSource);
    docSource.montants = m;
    return m;
  }

  function titre(docSource) {
    if (!docSource) return '';
    return docSource.type === 'recu' ? 'REÇU' : 'FACTURE';
  }

  function titreLong(docSource) {
    return docSource && docSource.type === 'recu' ? 'Reçu de paiement' : 'Facture';
  }

  function dupliquer(docSource, garderNumero) {
    var copie = JSON.parse(JSON.stringify(docSource || {}));
    copie.id = null;
    copie.numero = garderNumero ? copie.numero : null;
    copie.statut = 'brouillon';
    copie.createdAt = null;
    copie.updatedAt = null;
    copie.paiements = [];
    copie.lignes = (copie.lignes || []).map(function (l) {
      return {
        id: 'l_' + Math.random().toString(36).slice(2, 9),
        designation: l.designation,
        quantite: l.quantite,
        prixUnitaire: l.prixUnitaire,
        remise: l.remise,
        tauxTva: l.tauxTva
      };
    });
    copie.annuleeLe = null;
    copie.motifAnnulation = null;
    montants(copie);
    return copie;
  }

  /* ------------------------------------------------------------- rendu */
  /**
   * Construit l'élément .doc (A4) correspondant au document.
   * @param {Object} docSource
   * @param {Object} options {logo, modele, couleur, signature, montantEnLettres, afficherLogo}
   */
  function rendreHtml(docSource, options) {
    options = options || {};
    var calculs = AGORA.calculs;
    var formater = function (m) { return AGORA.parametres.formaterMontant(m, docSource.devise); };
    var m = montants(docSource);
    var modele = options.modele || docSource.modele || 'classique';
    var statut = calculs.statutEffectif(docSource);
    var estRecu = docSource.type === 'recu';

    var racine = doc.createElement('div');
    racine.className = 'doc modele-' + modele + (estRecu ? ' doc-recu' : '') +
      (docSource.statut === 'annulee' ? ' doc-annulee' : '');

    /* ------------------------------------------------------------ en-tête */
    var entete = el('div', 'doc-entete');

    var blocVendeur = el('div', 'doc-vendeur');
    var logoUrl = options.afficherLogo === false ? null : (options.logo || (docSource.vendeur && docSource.vendeur.logo) || null);
    if (logoUrl && typeof logoUrl === 'string' && logoUrl.indexOf('data:image/') === 0) {
      var img = doc.createElement('img');
      img.className = 'doc-logo';
      img.src = logoUrl;
      img.alt = 'Logo';
      blocVendeur.appendChild(img);
    }
    var infosVendeur = el('div', 'doc-vendeur-infos');
    infosVendeur.appendChild(el('div', 'doc-vendeur-nom', (docSource.vendeur && docSource.vendeur.nom) || 'Nom du vendeur'));
    var detailsVendeur = [];
    var v = docSource.vendeur || {};
    if (v.adresse) detailsVendeur.push(v.adresse);
    if (v.telephone) detailsVendeur.push('Tél. ' + v.telephone);
    if (v.email) detailsVendeur.push(v.email);
    if (v.fiscal) detailsVendeur.push('N° fiscal / IFU : ' + v.fiscal);
    if (detailsVendeur.length) infosVendeur.appendChild(el('div', 'doc-vendeur-details', detailsVendeur.join('\n')));
    blocVendeur.appendChild(infosVendeur);
    entete.appendChild(blocVendeur);

    var blocTitre = el('div', 'doc-titre-bloc');
    blocTitre.appendChild(el('h1', 'doc-titre', titre(docSource)));
    blocTitre.appendChild(el('div', 'doc-numero', docSource.numero ? ('N° ' + docSource.numero) : 'N° (à attribuer)'));
    var meta = el('div', 'doc-meta');
    meta.appendChild(el('div', null, 'Date : ' + (docSource.dateEmission ? calculs.formaterDate(docSource.dateEmission) : '—')));
    if (docSource.dateEcheance && !estRecu) {
      meta.appendChild(el('div', null, 'Échéance : ' + calculs.formaterDate(docSource.dateEcheance)));
    }
    var ligneStatut = el('div', 'doc-statut', 'Statut : ' + calculs.statutInfo(statut).libelle);
    meta.appendChild(ligneStatut);
    if (docSource.statut === 'annulee' && docSource.motifAnnulation) {
      meta.appendChild(el('div', null, 'Motif : ' + docSource.motifAnnulation));
    }
    blocTitre.appendChild(meta);
    entete.appendChild(blocTitre);
    racine.appendChild(entete);

    /* ------------------------------------------------------------ client */
    var parties = el('div', 'doc-parties');
    var blocClient = el('div', 'doc-client');
    blocClient.appendChild(el('p', 'doc-client-titre', estRecu ? 'Reçu de' : 'Facturé à'));
    blocClient.appendChild(el('div', 'doc-client-nom', (docSource.client && docSource.client.nom) || '—'));
    var detailsClient = [];
    var c = docSource.client || {};
    if (c.adresse) detailsClient.push(c.adresse);
    if (c.telephone) detailsClient.push('Tél. ' + c.telephone);
    if (c.email) detailsClient.push(c.email);
    if (detailsClient.length) blocClient.appendChild(el('div', 'doc-client-details', detailsClient.join('\n')));
    parties.appendChild(blocClient);
    racine.appendChild(parties);

    /* ------------------------------------------------------------ lignes */
    var table = doc.createElement('table');
    table.className = 'doc-lignes';
    var thead = doc.createElement('thead');
    var trh = doc.createElement('tr');
    ['Désignation', 'Qté', 'Prix unitaire', 'Remise', docSource.tvaActive ? 'TVA' : null, 'Montant']
      .forEach(function (libelle, i) {
        if (libelle === null) return;
        var th = el('th', (i === 0 ? null : (i === 4 && docSource.tvaActive ? 'c' : 'n')), libelle);
        trh.appendChild(th);
      });
    thead.appendChild(trh);
    table.appendChild(thead);

    var tbody = doc.createElement('tbody');
    var lignes = m.lignes || [];
    var avecRemise = m.remisesLignes > 0 || lignes.some(function (l) { return l.remise > 0; });
    if (!lignes.length) {
      var trVide = doc.createElement('tr');
      trVide.className = 'doc-ligne-vide';
      var td = el('td', null, 'Aucun article');
      td.colSpan = 6;
      trVide.appendChild(td);
      tbody.appendChild(trVide);
    }
    lignes.forEach(function (l, i) {
      var tr = doc.createElement('tr');
      tr.appendChild(el('td', null, (docSource.lignes[i] && docSource.lignes[i].designation) || '—'));
      tr.appendChild(el('td', 'n', String(l.quantite)));
      tr.appendChild(el('td', 'n', formater(l.prixUnitaire)));
      tr.appendChild(el('td', 'n', avecRemise ? formater(l.remise) : '—'));
      if (docSource.tvaActive) tr.appendChild(el('td', 'c', calculs.formaterNombre(l.tauxTva, 2) + ' %'));
      tr.appendChild(el('td', 'n', formater(l.total)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    racine.appendChild(table);

    /* ------------------------------------------------------------ totaux */
    var pied = el('div', 'doc-pied-doc');
    var gauche = el('div', 'doc-notes-gauche');
    if (options.montantEnLettres) {
      gauche.appendChild(el('div', 'petit', 'Arrêté à la somme de : ' + calculs.montantEnLettres(m.total, docSource.devise) + ' ' + docSource.devise));
    }
    if (estRecu && m.totalPaye > 0) {
      gauche.appendChild(el('div', 'petit', 'Reçu : ' + formater(m.totalPaye)));
    }
    pied.appendChild(gauche);

    var totaux = el('div', 'doc-totaux');
    var t = doc.createElement('table');
    var corpsTotaux = doc.createElement('tbody');

    function ligne(libelle, montant, classe) {
      var tr = doc.createElement('tr');
      if (classe) tr.className = classe;
      tr.appendChild(el('td', 'libelle', libelle));
      tr.appendChild(el('td', 'n', formater(montant)));
      corpsTotaux.appendChild(tr);
    }

    ligne('Sous-total', m.sousTotal);
    if (m.remisesLignes > 0) ligne('Remises sur lignes', -m.remisesLignes, 'remise');
    if (m.remiseGlobale > 0) ligne('Remise globale', -m.remiseGlobale, 'remise');
    if (docSource.tvaActive) {
      ligne(docSource.tvaMode === 'inclusive' ? 'Total HT (extrait)' : 'Base imposable', m.baseImposable);
      if (m.tvaParTaux.length > 1) {
        m.tvaParTaux.forEach(function (tv) {
          ligne('TVA ' + calculs.formaterNombre(tv.taux, 2) + ' %', tv.tva);
        });
      } else {
        ligne('TVA (' + calculs.formaterNombre(m.tvaParTaux.length ? m.tvaParTaux[0].taux : (docSource.lignes[0] ? docSource.lignes[0].tauxTva : 0), 2) + ' %)', m.tva);
      }
    } else {
      ligne('TVA', 0);
    }
    ligne('Total ' + (docSource.tvaActive ? 'TTC' : ''), m.total, 'total');
    if (m.totalPaye > 0) ligne('Déjà payé', m.totalPaye);
    if (m.solde !== 0 || m.totalPaye > 0) {
      ligne(m.solde > 0 ? 'Reste à payer' : (m.solde < 0 ? 'Trop-perçu' : 'Solde'), m.solde, 'solde');
    }
    t.appendChild(corpsTotaux);
    totaux.appendChild(t);
    pied.appendChild(totaux);
    racine.appendChild(pied);

    /* -------------------------------------------------------- paiements */
    if ((docSource.paiements || []).length) {
      var blocPaiements = el('div', 'doc-paiements');
      blocPaiements.appendChild(el('h4', null, 'Paiements enregistrés'));
      var tp = doc.createElement('table');
      var thp = doc.createElement('tr');
      ['Date', 'Méthode', 'Référence', 'Montant'].forEach(function (l, i) {
        thp.appendChild(el('th', i === 3 ? 'n' : null, l));
      });
      tp.appendChild(thp);
      docSource.paiements.forEach(function (p) {
        var tr = doc.createElement('tr');
        tr.appendChild(el('td', null, calculs.formaterDate(p.date)));
        tr.appendChild(el('td', null, p.methode || '—'));
        tr.appendChild(el('td', null, p.reference || '—'));
        tr.appendChild(el('td', 'n', formater(p.montant)));
        tp.appendChild(tr);
      });
      blocPaiements.appendChild(tp);
      racine.appendChild(blocPaiements);
    }

    /* ------------------------------------------------------------- notes */
    if (docSource.notes || docSource.conditions) {
      var notes = el('div', 'doc-notes');
      if (docSource.notes) {
        var blocNotes = el('div');
        blocNotes.appendChild(el('h4', null, 'Notes'));
        blocNotes.appendChild(el('p', null, docSource.notes));
        notes.appendChild(blocNotes);
      }
      if (docSource.conditions) {
        var blocConditions = el('div');
        blocConditions.appendChild(el('h4', null, 'Conditions'));
        blocConditions.appendChild(el('p', null, docSource.conditions));
        notes.appendChild(blocConditions);
      }
      racine.appendChild(notes);
    }

    /* --------------------------------------------------------- signature */
    if (options.signature) {
      var signature = el('div', 'doc-signature');
      var s1 = el('div', 'bloc');
      s1.appendChild(el('div', 'trait', 'Signature du vendeur'));
      var s2 = el('div', 'bloc');
      s2.appendChild(el('div', 'trait', 'Signature du client'));
      signature.appendChild(s1);
      signature.appendChild(s2);
      racine.appendChild(signature);
    }

    /* ---------------------------------------------------------- mentions */
    var mentions = el('div', 'doc-mentions');
    var texte = [];
    texte.push(titreLong(docSource) + ' généré' + (estRecu ? 'e' : '') + ' avec Agora Factures — document conservé localement sur votre appareil.');
    if (!estRecu && docSource.dateEcheance) texte.push('Échéance : ' + calculs.formaterDate(docSource.dateEcheance) + '.');
    mentions.appendChild(el('div', null, texte.join(' ')));
    racine.appendChild(mentions);

    if (docSource.statut === 'annulee') {
      racine.appendChild(el('div', 'doc-filigrane', 'ANNULÉE'));
    }

    if (options.couleur === false) racine.classList.add('doc-sans-couleur');
    return racine;
  }

  /** Met à l'échelle l'aperçu A4 dans son conteneur. */
  /**
   * Met la feuille A4 à l'échelle de son conteneur.
   *
   * Point délicat : la feuille doit rester mise en page à sa largeur A4 réelle
   * (794 px CSS), puis être réduite UNE seule fois par la transformation. Si le
   * conteneur recevait la largeur réduite, « .doc { max-width: 100% } »
   * replacerait la feuille à cette largeur réduite, et la transformation la
   * réduirait une seconde fois : l'aperçu apparaissait deux fois trop petit,
   * avec un retour à la ligne faux par rapport au PDF.
   * Le conteneur garde donc la largeur A4 et seule sa HAUTEUR est réduite ;
   * le conteneur parent masque le débordement horizontal résiduel (la feuille
   * occupe visuellement exactement la largeur disponible).
   */
  function ajusterEchelle(conteneur, element) {
    if (!conteneur || !element) return;
    var largeurDisponible = conteneur.clientWidth - 2; // bordures
    var largeurA4 = 210 * (96 / 25.4);                 // 210 mm en pixels CSS
    var echelle = Math.min(1, Math.max(0.2, largeurDisponible / largeurA4));
    var feuille = element.firstElementChild || element.firstChild;
    var hauteur = feuille ? feuille.offsetHeight : 0;
    element.style.width = largeurA4 + 'px';
    element.style.height = (hauteur * echelle) + 'px';
    element.style.transform = 'scale(' + echelle + ')';
    return echelle;
  }

  function nomFichier(docSource) {
    var type = docSource.type === 'recu' ? 'recu' : 'facture';
    var numero = docSource.numero || 'brouillon';
    return appNom() + '-' + type + '-' + String(numero).replace(/[^\w-]+/g, '-') + '.pdf';
  }

  function appNom() { return 'agora-factures'; }

  AGORA.documents = {
    creerVide: creerVide,
    ligneVide: ligneVide,
    montants: montants,
    rendreHtml: rendreHtml,
    dupliquer: dupliquer,
    titre: titre,
    titreLong: titreLong,
    ajusterEchelle: ajusterEchelle,
    nomFichier: nomFichier
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
