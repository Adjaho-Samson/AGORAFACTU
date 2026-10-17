/* ==========================================================================
   Agora Factures — export PDF (jsPDF, chargé depuis /lib)
   --------------------------------------------------------------------------
   Le PDF est dessiné directement (texte vectoriel) pour rester net à
   l'impression et lisible par les logiciels de lecture. Les trois modèles
   reprennent la mise en page de l'aperçu HTML.
   La bibliothèque est servie localement : aucune requête réseau.
   ========================================================================== */
(function (global) {
  'use strict';

  var AGORA = global.AGORA || (global.AGORA = {});
  var app = AGORA.app;
  var LIB = 'lib/jspdf.umd.min.js';

  var promesseChargement = null;

  /** Charge jsPDF une seule fois (script local, mis en cache par le SW). */
  function charger() {
    if (global.jspdf && global.jspdf.jsPDF) return Promise.resolve(global.jspdf.jsPDF);
    if (promesseChargement) return promesseChargement;
    promesseChargement = new Promise(function (resoudre, rejeter) {
      var script = global.document.createElement('script');
      script.src = app.url(LIB);
      script.async = true;
      script.onload = function () {
        if (global.jspdf && global.jspdf.jsPDF) resoudre(global.jspdf.jsPDF);
        else rejeter(new Error('La bibliothèque PDF est chargée mais inaccessible.'));
      };
      script.onerror = function () {
        promesseChargement = null;
        rejeter(new Error('Bibliothèque PDF introuvable (' + LIB + '). Utilisez « Imprimer » puis « Enregistrer au format PDF ».'));
      };
      global.document.head.appendChild(script);
    });
    return promesseChargement;
  }

  /**
   * Les polices standard du PDF (WinAnsi) ne connaissent pas les espaces
   * fines insécables produites par Intl (U+202F) : on les normalise.
   */
  var ESPACES_SPECIAUX = /[\u00a0\u2000-\u200a\u202f\u205f]/g;

  function nettoyer(chaine) {
    return String(chaine === null || chaine === undefined ? '' : chaine).replace(ESPACES_SPECIAUX, ' ');
  }

  var THEMES = {
    classique: {
      bandeau: [18, 55, 95],
      texteBandeau: [255, 255, 255],
      accent: [29, 111, 216],
      fonce: [18, 55, 95],
      doux: [90, 102, 118],
      fondLigne: [250, 252, 254],
      bord: [225, 232, 240]
    },
    moderne: {
      bandeau: [234, 242, 253],
      texteBandeau: [18, 55, 95],
      accent: [79, 156, 249],
      fonce: [29, 111, 216],
      doux: [90, 102, 118],
      fondLigne: [250, 252, 254],
      bord: [220, 233, 250]
    },
    minimal: {
      bandeau: [242, 242, 242],
      texteBandeau: [0, 0, 0],
      accent: [0, 0, 0],
      fonce: [0, 0, 0],
      doux: [85, 85, 85],
      fondLigne: [255, 255, 255],
      bord: [180, 180, 180]
    }
  };

  /**
   * Génère le PDF d'un document.
   * @returns {Promise<{pdf: jsPDF, blob: Blob, nom: string}>}
   */
  function generer(docSource, options) {
    options = options || {};
    var calculs = AGORA.calculs;
    var m = AGORA.documents.montants(docSource);
    var modele = options.modele || docSource.modele || 'classique';
    var theme = THEMES[modele] || THEMES.classique;
    var formater = function (v) { return AGORA.parametres.formaterMontant(v, docSource.devise); };
    var estRecu = docSource.type === 'recu';

    return charger().then(function (jsPDF) {
      var pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
      var L = 210, M = 14, LARGE = L - 2 * M;
      var y = M;

      function texte(chaines, x, yy, o) {
        o = o || {};
        chaines = typeof chaines === 'string' ? nettoyer(chaines) : chaines;
        pdf.setFont('helvetica', o.style || 'normal');
        pdf.setFontSize(o.taille || 9);
        pdf.setTextColor(o.couleur ? o.couleur[0] : 30, o.couleur ? o.couleur[1] : 40, o.couleur ? o.couleur[2] : 50);
        pdf.text(chaines, x, yy, o.align ? { align: o.align } : undefined);
      }

      function trait(x1, y1, x2, y2, couleur, epaisseur) {
        pdf.setDrawColor(couleur ? couleur[0] : 200, couleur ? couleur[1] : 205, couleur ? couleur[2] : 215);
        pdf.setLineWidth(epaisseur || 0.2);
        pdf.line(x1, y1, x2, y2);
      }

      function rectangle(x1, y1, w, h, couleur) {
        pdf.setFillColor(couleur[0], couleur[1], couleur[2]);
        pdf.rect(x1, y1, w, h, 'F');
      }

      function nouvellePageSiBesoin(hauteur) {
        if (y + hauteur > 282) {
          pdf.addPage();
          y = M;
          return true;
        }
        return false;
      }

      /* ------------------------------------------------------- en-tête */
      var logo = options.afficherLogo === false ? null : (options.logo || (docSource.vendeur && docSource.vendeur.logo) || null);
      var xVendeur = M;
      var largeurVendeur = LARGE * 0.58;
      if (logo && typeof logo === 'string' && logo.indexOf('data:image/') === 0) {
        try {
          var format = logo.indexOf('data:image/png') === 0 ? 'PNG'
            : (logo.indexOf('data:image/jpeg') === 0 || logo.indexOf('data:image/jpg') === 0) ? 'JPEG'
              : (logo.indexOf('data:image/webp') === 0 ? 'WEBP' : 'PNG');
          pdf.addImage(logo, format, M, y, 28, 16, undefined, 'FAST');
          xVendeur = M + 32;
          largeurVendeur = LARGE * 0.58 - 32;
        } catch (e) {
          /* logo illisible : on continue sans */
        }
      }

      var yVendeur = y + 4;
      texte(pdf.splitTextToSize((docSource.vendeur && docSource.vendeur.nom) || 'Nom du vendeur', largeurVendeur),
        xVendeur, yVendeur, { taille: 12, style: 'bold', couleur: theme.fonce });
      yVendeur += 5 + (pdf.splitTextToSize((docSource.vendeur && docSource.vendeur.nom) || '', largeurVendeur).length - 1) * 4.5;

      var infosVendeur = [];
      var v = docSource.vendeur || {};
      if (v.adresse) infosVendeur.push(v.adresse);
      if (v.telephone) infosVendeur.push('Tél. ' + v.telephone);
      if (v.email) infosVendeur.push(v.email);
      if (v.fiscal) infosVendeur.push('N° fiscal / IFU : ' + v.fiscal);
      if (infosVendeur.length) {
        var lignesV = pdf.splitTextToSize(infosVendeur.join(' · '), largeurVendeur);
        texte(lignesV, xVendeur, yVendeur, { taille: 8.5, couleur: theme.doux });
        yVendeur += lignesV.length * 3.8;
      }

      // Bloc titre (aligné à droite)
      var xDroite = L - M;
      texte(AGORA.documents.titre(docSource), xDroite, y + 6, { taille: 18, style: 'bold', align: 'right', couleur: theme.fonce });
      texte(docSource.numero ? ('N° ' + docSource.numero) : 'N° (à attribuer)', xDroite, y + 13, { taille: 10, style: 'bold', align: 'right' });
      var meta = [];
      meta.push('Date : ' + (docSource.dateEmission ? calculs.formaterDate(docSource.dateEmission) : '—'));
      if (docSource.dateEcheance && !estRecu) meta.push('Échéance : ' + calculs.formaterDate(docSource.dateEcheance));
      meta.push('Statut : ' + calculs.statutInfo(calculs.statutEffectif(docSource)).libelle);
      texte(meta, xDroite, y + 18, { taille: 8.5, align: 'right', couleur: theme.doux });

      y = Math.max(yVendeur, y + 24) + 3;
      if (modele !== 'minimal') {
        rectangle(M, y, LARGE, 0.8, theme.bandeau);
        y += 5;
      } else {
        trait(M, y, L - M, y, [0, 0, 0], 0.3);
        y += 5;
      }

      /* -------------------------------------------------------- client */
      var hauteurClient = 6;
      var infosClient = [];
      var c = docSource.client || {};
      if (c.adresse) infosClient.push(c.adresse);
      if (c.telephone) infosClient.push('Tél. ' + c.telephone);
      if (c.email) infosClient.push(c.email);
      var lignesC = infosClient.length ? pdf.splitTextToSize(infosClient.join(' · '), LARGE * 0.55) : [];
      hauteurClient += 5 + lignesC.length * 3.8;

      if (modele === 'moderne') {
        rectangle(M, y - 1, 1.2, hauteurClient, theme.accent);
        texte(estRecu ? 'REÇU DE' : 'FACTURÉ À', M + 4, y + 2.5, { taille: 7.5, style: 'bold', couleur: theme.doux });
      } else {
        texte(estRecu ? 'REÇU DE' : 'FACTURÉ À', M, y + 2.5, { taille: 7.5, style: 'bold', couleur: theme.doux });
      }
      var xClient = modele === 'moderne' ? M + 4 : M;
      texte((c.nom) || '—', xClient, y + 7.5, { taille: 11, style: 'bold' });
      if (lignesC.length) texte(lignesC, xClient, y + 12, { taille: 8.5, couleur: theme.doux });
      y += hauteurClient + 5;

      /* -------------------------------------------------------- lignes */
      var colonnes = [
        { t: 'Désignation', l: 0.40, a: 'left' },
        { t: 'Qté', l: 0.09, a: 'right' },
        { t: 'P.U.', l: 0.14, a: 'right' },
        { t: 'Remise', l: 0.11, a: 'right' },
        { t: 'TVA', l: 0.09, a: 'center' },
        { t: 'Montant', l: 0.17, a: 'right' }
      ];
      if (!docSource.tvaActive) colonnes.splice(4, 1);
      var avecRemise = m.remisesLignes > 0 || (m.lignes || []).some(function (l) { return l.remise > 0; });
      if (!avecRemise) colonnes = colonnes.filter(function (col) { return col.t !== 'Remise'; });

      var largeurs = colonnes.map(function (col) { return LARGE * col.l; });
      var xs = [];
      var cumul = M;
      colonnes.forEach(function (col, i) {
        xs.push(cumul);
        cumul += largeurs[i];
      });

      function enteteTableau() {
        rectangle(M, y - 3.5, LARGE, 8, theme.bandeau);
        colonnes.forEach(function (col, i) {
          texte(col.t, col.a === 'right' ? xs[i] + largeurs[i] - 2 : (col.a === 'center' ? xs[i] + largeurs[i] / 2 : xs[i] + 2), y + 1.6,
            { taille: 8, style: 'bold', couleur: theme.texteBandeau, align: col.a === 'right' ? 'right' : (col.a === 'center' ? 'center' : 'left') });
        });
        y += 8;
      }
      enteteTableau();

      (m.lignes || []).forEach(function (l, i) {
        var designation = (docSource.lignes[i] && docSource.lignes[i].designation) || '—';
        var idxDesignation = colonnes.findIndex(function (col) { return col.t === 'Désignation'; });
        var lignesD = pdf.splitTextToSize(designation, largeurs[idxDesignation] - 3);
        var hauteur = Math.max(6, lignesD.length * 3.8 + 2.6);
        if (nouvellePageSiBesoin(hauteur + 4)) enteteTableau();
        if (i % 2 === 1 && modele !== 'minimal') rectangle(M, y - 3.2, LARGE, hauteur, theme.fondLigne);

        var valeurs = {
          'Désignation': lignesD,
          'Qté': String(l.quantite),
          'P.U.': formater(l.prixUnitaire),
          'Remise': avecRemise ? formater(l.remise) : '—',
          'TVA': calculs.formaterNombre(l.tauxTva, 2) + ' %',
          'Montant': formater(l.total)
        };
        colonnes.forEach(function (col, j) {
          var x = col.a === 'right' ? xs[j] + largeurs[j] - 2 : (col.a === 'center' ? xs[j] + largeurs[j] / 2 : xs[j] + 2);
          texte(valeurs[col.t], x, y + 0.6, {
            taille: 9,
            align: col.a === 'right' ? 'right' : (col.a === 'center' ? 'center' : 'left'),
            style: col.t === 'Montant' ? 'bold' : 'normal'
          });
        });
        y += hauteur;
        trait(M, y - 3, L - M, y - 3, theme.bord, 0.15);
      });
      if (!(m.lignes || []).length) {
        texte('Aucun article', M + 2, y + 1, { taille: 9, couleur: theme.doux });
        y += 7;
      }

      /* -------------------------------------------------------- totaux */
      y += 4;
      var largeurTotaux = 72;
      var xTotaux = L - M - largeurTotaux;
      var xLibelle = xTotaux + 2;
      var xValeur = L - M - 2;

      function ligneTotal(libelle, valeur, o) {
        o = o || {};
        if (nouvellePageSiBesoin(8)) enteteTableau();
        if (o.fond) rectangle(xTotaux, y - 3.2, largeurTotaux, 6.4, o.fond);
        texte(libelle, xLibelle, y, { taille: o.taille || 9, style: o.style || 'normal', couleur: o.couleurLibelle || theme.doux });
        texte(valeur, xValeur, y, { taille: o.taille || 9, style: o.style || 'normal', align: 'right', couleur: o.couleur || null });
        y += o.hauteur || 5;
      }

      if (options.montantEnLettres) {
        var phrase = 'Arrêté à la somme de : ' + calculs.montantEnLettres(m.total, docSource.devise) + ' ' + docSource.devise;
        texte(pdf.splitTextToSize(phrase, xTotaux - M - 6), M, y, { taille: 8, couleur: theme.doux });
        y += 8;
      }

      ligneTotal('Sous-total', formater(m.sousTotal));
      if (m.remisesLignes > 0) ligneTotal('Remises sur lignes', '- ' + formater(m.remisesLignes), { couleur: [185, 101, 0] });
      if (m.remiseGlobale > 0) ligneTotal('Remise globale', '- ' + formater(m.remiseGlobale), { couleur: [185, 101, 0] });
      if (docSource.tvaActive) {
        ligneTotal(docSource.tvaMode === 'inclusive' ? 'Total HT (extrait)' : 'Base imposable', formater(m.baseImposable));
        if (m.tvaParTaux.length > 1) {
          m.tvaParTaux.forEach(function (tv) {
            ligneTotal('TVA ' + calculs.formaterNombre(tv.taux, 2) + ' %', formater(tv.tva));
          });
        } else {
          var tauxUnique = m.tvaParTaux.length ? m.tvaParTaux[0].taux : ((docSource.lignes[0] && docSource.lignes[0].tauxTva) || 0);
          ligneTotal('TVA (' + calculs.formaterNombre(tauxUnique, 2) + ' %)', formater(m.tva));
        }
      } else {
        ligneTotal('TVA', formater(0));
      }
      if (modele !== 'minimal') rectangle(xTotaux, y - 3.4, largeurTotaux, 0.6, theme.accent);
      else trait(xTotaux, y - 3.4, L - M, y - 3.4, [0, 0, 0], 0.3);
      y += 1;
      ligneTotal('Total ' + (docSource.tvaActive ? 'TTC' : ''), formater(m.total), { taille: 12, style: 'bold', couleur: theme.fonce, hauteur: 7 });
      if (m.totalPaye > 0) ligneTotal('Déjà payé', formater(m.totalPaye));
      if (m.solde !== 0 || m.totalPaye > 0) {
        ligneTotal(m.solde > 0 ? 'Reste à payer' : (m.solde < 0 ? 'Trop-perçu' : 'Solde'), formater(m.solde), { style: 'bold' });
      }

      /* ----------------------------------------------------- paiements */
      if ((docSource.paiements || []).length) {
        y += 4;
        nouvellePageSiBesoin(20);
        texte('PAIEMENTS ENREGISTRÉS', M, y, { taille: 8, style: 'bold', couleur: theme.doux });
        y += 4;
        trait(M, y - 2.5, L - M, y - 2.5, theme.bord, 0.2);
        docSource.paiements.forEach(function (p) {
          if (nouvellePageSiBesoin(6)) enteteTableau();
          texte(calculs.formaterDate(p.date), M, y, { taille: 8.5 });
          texte((p.methode || '—') + (p.reference ? ' · ' + p.reference : ''), M + 32, y, { taille: 8.5 });
          texte(formater(p.montant), L - M - 2, y, { taille: 8.5, align: 'right' });
          y += 4.6;
        });
      }

      /* --------------------------------------------------------- notes */
      if (docSource.notes || docSource.conditions) {
        y += 5;
        var largeurColonne = (LARGE - 8) / 2;
        var yNotes = y;
        if (docSource.notes) {
          texte('NOTES', M, yNotes, { taille: 8, style: 'bold', couleur: theme.doux });
          texte(pdf.splitTextToSize(docSource.notes, largeurColonne), M, yNotes + 4, { taille: 8.5 });
        }
        if (docSource.conditions) {
          texte('CONDITIONS', M + largeurColonne + 8, yNotes, { taille: 8, style: 'bold', couleur: theme.doux });
          texte(pdf.splitTextToSize(docSource.conditions, largeurColonne), M + largeurColonne + 8, yNotes + 4, { taille: 8.5 });
        }
      }

      /* ----------------------------------------------------- signature */
      if (options.signature) {
        y += 16;
        nouvellePageSiBesoin(24);
        trait(M, y + 10, M + 70, y + 10, [150, 160, 175], 0.2);
        trait(L - M - 70, y + 10, L - M, y + 10, [150, 160, 175], 0.2);
        texte('Signature du vendeur', M, y + 14, { taille: 8, couleur: theme.doux });
        texte('Signature du client', L - M, y + 14, { taille: 8, couleur: theme.doux, align: 'right' });
      }

      /* -------------------------------------------------------- pied */
      var totalPages = pdf.getNumberOfPages();
      for (var p = 1; p <= totalPages; p++) {
        pdf.setPage(p);
        var yPied = 289;
        texte('Agora Factures — document généré localement, sans envoi de données.', L / 2, yPied - 4,
          { taille: 7.5, align: 'center', couleur: theme.doux });
        if (docSource.statut === 'annulee') {
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(42);
          pdf.setTextColor(200, 60, 60);
          pdf.text('ANNULÉE', L / 2, 150, { align: 'center', angle: 25 });
        }
        texte('Page ' + p + ' / ' + totalPages, L - M, yPied, { taille: 7.5, align: 'right', couleur: theme.doux });
        texte(docSource.numero ? docSource.numero : 'brouillon', M, yPied, { taille: 7.5, couleur: theme.doux });
      }

      var blob = pdf.output('blob');
      return { pdf: pdf, blob: blob, nom: AGORA.documents.nomFichier(docSource) };
    });
  }

  /** Génère puis déclenche le téléchargement du PDF. */
  function telechargerPdf(docSource, options) {
    return generer(docSource, options).then(function (resultat) {
      app.telecharger(resultat.nom, resultat.blob, 'application/pdf');
      return resultat;
    });
  }

  AGORA.pdf = {
    charger: charger,
    generer: generer,
    telechargerPdf: telechargerPdf,
    THEMES: THEMES
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
