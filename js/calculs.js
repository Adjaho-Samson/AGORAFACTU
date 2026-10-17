/* ==========================================================================
   Agora Factures — moteur de calcul (montants, remises, TVA, arrondis)

   Module volontairement SANS dépendance au DOM : il est utilisé par
   l'éditeur de documents, l'historique, le tableau de bord, l'export PDF
   et les tests unitaires (tests/calculs.test.mjs).

   Règle d'arrondi retenue
   -----------------------
   Tous les calculs intermédiaires sont effectués en CENTIÈMES (entiers) afin
   d'éliminer les erreurs de virgule flottante. L'arrondi final est
   « half-up vers l'infini » (0,005 -> 0,01 et -0,005 -> -0,01), appliqué une
   seule fois par opération monétaire. Les totaux sont la somme des lignes
   déjà arrondies : le total affiché correspond donc exactement à la somme
   des montants de lignes affichés.
   ========================================================================== */
(function (global) {
  'use strict';

  var AGORA = global.AGORA || (global.AGORA = {});

  /* ------------------------------------------------------------ devises */
  var DEVISES = {
    XOF: { libelle: 'Franc CFA (BCEAO)', decimales: 0, symbole: 'F CFA' },
    XAF: { libelle: 'Franc CFA (BEAC)', decimales: 0, symbole: 'FCFA' },
    GNF: { libelle: 'Franc guinéen', decimales: 0, symbole: 'FG' },
    KMF: { libelle: 'Franc comorien', decimales: 0, symbole: 'CF' },
    CDF: { libelle: 'Franc congolais', decimales: 0, symbole: 'FC' },
    EUR: { libelle: 'Euro', decimales: 2, symbole: '€' },
    USD: { libelle: 'Dollar américain', decimales: 2, symbole: '$' },
    GBP: { libelle: 'Livre sterling', decimales: 2, symbole: '£' },
    CHF: { libelle: 'Franc suisse', decimales: 2, symbole: 'CHF' },
    CAD: { libelle: 'Dollar canadien', decimales: 2, symbole: '$CA' },
    MAD: { libelle: 'Dirham marocain', decimales: 2, symbole: 'DH' },
    TND: { libelle: 'Dinar tunisien', decimales: 2, symbole: 'DT' },
    DZD: { libelle: 'Dinar algérien', decimales: 2, symbole: 'DA' },
    NGN: { libelle: 'Naira nigérian', decimales: 2, symbole: '₦' },
    GHS: { libelle: 'Cedi ghanéen', decimales: 2, symbole: 'GH₵' },
    INR: { libelle: 'Roupie indienne', decimales: 2, symbole: '₹' },
    JPY: { libelle: 'Yen japonais', decimales: 0, symbole: '¥' }
  };

  function deviseInfo(code, reglages) {
    var c = String(code || '').toUpperCase();
    var connue = DEVISES[c] || null;
    var decimales = connue ? connue.decimales : 2;
    if (reglages && typeof reglages.decimales === 'number' && !isNaN(reglages.decimales)) {
      decimales = reglages.decimales;
    }
    return {
      code: c || 'XOF',
      decimales: decimales,
      symbole: connue ? connue.symbole : c,
      libelle: connue ? connue.libelle : c
    };
  }

  /* ------------------------------------------------------------ arrondis */
  function estNombre(v) {
    if (typeof v === 'number') return isFinite(v);
    if (typeof v !== 'string' || v.trim() === '') return false;
    return isFinite(Number(v.replace(',', '.')));
  }

  function nombre(v, defaut) {
    var n;
    if (typeof v === 'number') n = v;
    else if (typeof v === 'string') n = Number(v.replace(',', '.').replace(/\s/g, ''));
    else n = NaN;
    if (!isFinite(n)) return typeof defaut === 'number' ? defaut : 0;
    return n;
  }

  function signe(n) { return n < 0 ? -1 : 1; }

  /** Arrondi entier « half-up vers l'infini » (2.5 -> 3 ; -2.5 -> -3). */
  function arrondirEntier(x) {
    if (!isFinite(x)) return 0;
    var s = signe(x);
    var a = Math.abs(x);
    // Number.EPSILON compense les artefacts du type 1.005 * 100 = 100.49999…
    return s * Math.round(a + a * Number.EPSILON);
  }

  /** Convertit un montant (nombre) en centimes entiers. */
  function versCentimes(v) {
    return arrondirEntier(nombre(v, 0) * 100);
  }

  /** Convertit des centimes entiers en montant décimal (2 décimales). */
  function depuisCentimes(c) {
    return arrondirEntier(nombre(c, 0)) / 100;
  }

  /** Arrondit un montant décimal à 2 décimales. */
  function arrondir(v) {
    return depuisCentimes(versCentimes(v));
  }

  function appliquerPourcentage(cents, pct) {
    var p = nombre(pct, 0);
    if (p === 0) return 0;
    return arrondirEntier(cents * p / 100);
  }

  /* -------------------------------------------------------------- lignes */
  /**
   * Calcule une ligne d'article.
   * @param {Object} ligne  {quantite, prixUnitaire, remise, tauxTva}
   * @param {Object} opts   {modeRemise: 'pourcent'|'montant', tvaActive, tvaMode, ratio}
   * @returns {Object} {quantite, prixUnitaire, brut, remise, net, base, tva, total, tauxTva}
   */
  function calculerLigne(ligne, opts) {
    opts = opts || {};
    var l = ligne || {};
    var modeRemise = opts.modeRemise === 'montant' ? 'montant' : 'pourcent';
    var tvaActive = opts.tvaActive !== false;
    var inclusif = opts.tvaMode === 'inclusive';
    var ratio = typeof opts.ratio === 'number' ? opts.ratio : 1;

    var quantite = Math.abs(nombre(l.quantite, 0));
    var prixUnitaire = nombre(l.prixUnitaire, 0);
    var tauxTva = tvaActive ? Math.max(0, nombre(l.tauxTva, 0)) : 0;

    var prxC = versCentimes(prixUnitaire);
    var brutC = arrondirEntier(quantite * prxC);
    var remiseC = 0;
    if (modeRemise === 'montant') {
      remiseC = Math.min(versCentimes(l.remise), brutC);
    } else {
      var pct = Math.min(Math.max(nombre(l.remise, 0), 0), 100);
      remiseC = Math.min(appliquerPourcentage(brutC, pct), brutC);
    }
    remiseC = Math.max(0, remiseC);
    var netC = brutC - remiseC;

    // Répartition de la remise globale sur la ligne (ratio appliqué au net)
    var netApresC = arrondirEntier(netC * ratio);

    var baseC, tvaC;
    if (inclusif && tauxTva > 0) {
      // Le prix saisi est TTC : on extrait la TVA
      baseC = arrondirEntier(netApresC * 10000 / (10000 + Math.round(tauxTva * 100)));
      tvaC = netApresC - baseC;
    } else {
      baseC = netApresC;
      tvaC = appliquerPourcentage(baseC, tauxTva);
    }

    return {
      quantite: quantite,
      prixUnitaire: depuisCentimes(prxC),
      brut: depuisCentimes(brutC),
      remise: depuisCentimes(remiseC),
      net: depuisCentimes(netApresC),
      base: depuisCentimes(baseC),
      tva: depuisCentimes(tvaC),
      total: depuisCentimes(baseC + tvaC),
      tauxTva: tauxTva
    };
  }

  /* ----------------------------------------------------------- document */
  function totalPaiements(paiements) {
    var total = 0;
    (paiements || []).forEach(function (p) {
      total += versCentimes(p && p.montant);
    });
    return depuisCentimes(total);
  }

  /**
   * Recalcule l'intégralité des montants d'un document.
   * Les montants ne sont JAMAIS lus depuis l'interface : ils sont toujours
   * déduits des lignes et des paiements enregistrés.
   *
   * @param {Object} doc {lignes, tvaActive, tvaMode, modeRemise, remiseGlobale, paiements}
   * @returns {Object} montants détaillés
   */
  function calculerDocument(doc) {
    doc = doc || {};
    var lignes = Array.isArray(doc.lignes) ? doc.lignes : [];
    var tvaActive = doc.tvaActive !== false;
    var tvaMode = doc.tvaMode === 'inclusive' ? 'inclusive' : 'exclusive';
    var modeRemise = doc.modeRemise === 'montant' ? 'montant' : 'pourcent';

    var sousTotalC = 0;
    var remisesC = 0;
    var netC = 0;
    var partiels = lignes.map(function (l) {
      var r = calculerLigne(l, { modeRemise: modeRemise, tvaActive: tvaActive, tvaMode: tvaMode, ratio: 1 });
      sousTotalC += versCentimes(r.brut);
      remisesC += versCentimes(r.remise);
      netC += versCentimes(r.net);
      return r;
    });

    // Remise globale (sur le net HT/TTC des lignes)
    var rg = doc.remiseGlobale || { type: 'pourcent', valeur: 0 };
    var rgValeur = nombre(rg.valeur, 0);
    var remiseGlobaleC = 0;
    if (rgValeur > 0 && netC > 0) {
      remiseGlobaleC = rg.type === 'montant'
        ? Math.min(versCentimes(rgValeur), netC)
        : Math.min(appliquerPourcentage(netC, Math.min(rgValeur, 100)), netC);
    }
    remiseGlobaleC = Math.max(0, remiseGlobaleC);
    var netApresRemiseC = netC - remiseGlobaleC;
    var ratio = netC > 0 ? netApresRemiseC / netC : 0;

    // Second passage : TVA calculée ligne par ligne (somme = total exact)
    var baseC = 0;
    var tvaC = 0;
    var tvaParTaux = {};
    var lignesCalculees = lignes.map(function (l, i) {
      var r = calculerLigne(l, {
        modeRemise: modeRemise,
        tvaActive: tvaActive,
        tvaMode: tvaMode,
        ratio: ratio
      });
      baseC += versCentimes(r.base);
      tvaC += versCentimes(r.tva);
      var cle = String(r.tauxTva);
      if (!tvaParTaux[cle]) tvaParTaux[cle] = { taux: r.tauxTva, base: 0, tva: 0 };
      tvaParTaux[cle].base += versCentimes(r.base);
      tvaParTaux[cle].tva += versCentimes(r.tva);
      r.brut = partiels[i].brut;
      r.remise = partiels[i].remise;
      return r;
    });

    var totalC = baseC + tvaC;
    var totalPayeC = 0;
    (doc.paiements || []).forEach(function (p) { totalPayeC += versCentimes(p && p.montant); });

    var tvaDetail = Object.keys(tvaParTaux)
      .map(function (k) {
        return {
          taux: tvaParTaux[k].taux,
          base: depuisCentimes(tvaParTaux[k].base),
          tva: depuisCentimes(tvaParTaux[k].tva)
        };
      })
      .sort(function (a, b) { return a.taux - b.taux; });

    return {
      sousTotal: depuisCentimes(sousTotalC),
      remisesLignes: depuisCentimes(remisesC),
      remiseGlobale: depuisCentimes(remiseGlobaleC),
      netAvantRemiseGlobale: depuisCentimes(netC),
      netApresRemise: depuisCentimes(netApresRemiseC),
      baseImposable: depuisCentimes(baseC),
      tva: depuisCentimes(tvaC),
      total: depuisCentimes(totalC),
      totalPaye: depuisCentimes(totalPayeC),
      solde: depuisCentimes(totalC - totalPayeC),
      tvaActive: tvaActive,
      tvaMode: tvaMode,
      tvaParTaux: tvaDetail,
      lignes: lignesCalculees
    };
  }

  /* ------------------------------------------------------------ statuts */
  var STATUTS = {
    brouillon: { code: 'brouillon', libelle: 'Brouillon', classe: 'pastille-gris' },
    en_attente: { code: 'en_attente', libelle: 'En attente de paiement', classe: 'pastille-orange' },
    payee: { code: 'payee', libelle: 'Payée', classe: 'pastille-vert' },
    partielle: { code: 'partielle', libelle: 'Partiellement payée', classe: 'pastille-bleu' },
    en_retard: { code: 'en_retard', libelle: 'En retard', classe: 'pastille-rouge' },
    annulee: { code: 'annulee', libelle: 'Annulée', classe: 'pastille-rouge' }
  };

  function aujourdhui() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function pad(n) { return String(n).length < 2 ? '0' + n : String(n); }

  /** Compare deux dates ISO (AAAA-MM-JJ). */
  function comparerDates(a, b) {
    return String(a || '') < String(b || '') ? -1 : (String(a || '') > String(b || '') ? 1 : 0);
  }

  /** Un document est en retard s'il reste dû, qu'il est émis, et que l'échéance est dépassée. */
  function estEnRetard(doc, dateReference) {
    if (!doc) return false;
    if (doc.statut !== 'en_attente' && doc.statut !== 'partielle') return false;
    if (!doc.dateEcheance) return false;
    return comparerDates(doc.dateEcheance, dateReference || aujourdhui()) < 0;
  }

  /**
   * Statut « effectif » : le retard est déduit de la date d'échéance,
   * il n'est pas stocké (il reste donc toujours exact dans le temps).
   */
  function statutEffectif(doc, dateReference) {
    if (!doc) return 'brouillon';
    if (estEnRetard(doc, dateReference)) return 'en_retard';
    return doc.statut || 'brouillon';
  }

  function statutInfo(code) { return STATUTS[code] || STATUTS.brouillon; }

  /** Détermine le statut à appliquer après enregistrement d'un paiement. */
  function statutSelonPaiement(total, totalPaye, statutActuel) {
    var t = versCentimes(total);
    var p = versCentimes(totalPaye);
    if (statutActuel === 'annulee') return 'annulee';
    if (p <= 0) return statutActuel === 'brouillon' ? 'brouillon' : 'en_attente';
    if (p >= t) return 'payee';
    return 'partielle';
  }

  /* ----------------------------------------------------------- formatage */
  function formaterNombre(montant, decimales) {
    var n = nombre(montant, 0);
    var d = typeof decimales === 'number' ? decimales : 2;
    var s;
    if (typeof Intl !== 'undefined' && Intl.NumberFormat) {
      try {
        s = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
      } catch (e) { s = null; }
    }
    if (!s) {
      s = n.toFixed(d);
      var parties = s.split('.');
      s = parties[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (parties[1] ? ',' + parties[1] : '');
    }
    return s;
  }

  function formaterMontant(montant, devise, reglages) {
    var info = deviseInfo(devise, reglages);
    return formaterNombre(montant, info.decimales) + ' ' + info.code;
  }

  function formaterDate(iso) {
    if (!iso) return '—';
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    if (!m) return String(iso);
    return m[3] + '/' + m[2] + '/' + m[1];
  }

  function formaterDateHeure(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return formaterDate(iso) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function montantEnLettres(montant, devise) {
    // Conversion simple (entiers) en français, utile sur les reçus.
    var n = Math.round(nombre(montant, 0));
    if (n === 0) return 'Zéro';
    var unites = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix',
      'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
    var dizaines = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];
    function groupe(val) {
      var out = [];
      var cent = Math.floor(val / 100);
      var reste = val % 100;
      if (cent === 1) out.push('cent');
      else if (cent > 1) out.push(unites[cent] + ' cent' + (reste === 0 ? 's' : ''));
      if (reste === 0) return out.join(' ');
      if (reste < 20) out.push(unites[reste]);
      else {
        var d = Math.floor(reste / 10);
        var u = reste % 10;
        if (d === 7 || d === 9) {
          out.push(dizaines[d] + '-' + (u === 1 && d === 7 ? 'et-' : '') + unites[u + 10]);
        } else {
          out.push(dizaines[d] + (u === 1 && d < 8 ? '-et-' : (u ? '-' : '')) + (u ? unites[u] : ''));
        }
      }
      return out.join(' ');
    }
    var mots = [];
    var milliards = Math.floor(n / 1000000000);
    var millions = Math.floor((n % 1000000000) / 1000000);
    var milliers = Math.floor((n % 1000000) / 1000);
    var resteFinal = n % 1000;
    if (milliards) mots.push((milliards > 1 ? groupe(milliards) + ' ' : 'un ') + 'milliard' + (milliards > 1 ? 's' : ''));
    if (millions) mots.push((millions > 1 ? groupe(millions) + ' ' : 'un ') + 'million' + (millions > 1 ? 's' : ''));
    if (milliers) mots.push((milliers > 1 ? groupe(milliers) + ' ' : 'un ') + 'mille');
    if (resteFinal) mots.push(groupe(resteFinal));
    var texte = mots.join(' ').replace(/\s+/g, ' ').trim();
    return texte.charAt(0).toUpperCase() + texte.slice(1);
  }

  AGORA.calculs = {
    DEVISES: DEVISES,
    STATUTS: STATUTS,
    deviseInfo: deviseInfo,
    estNombre: estNombre,
    nombre: nombre,
    arrondirEntier: arrondirEntier,
    versCentimes: versCentimes,
    depuisCentimes: depuisCentimes,
    arrondir: arrondir,
    appliquerPourcentage: appliquerPourcentage,
    calculerLigne: calculerLigne,
    calculerDocument: calculerDocument,
    totalPaiements: totalPaiements,
    aujourdhui: aujourdhui,
    pad: pad,
    comparerDates: comparerDates,
    estEnRetard: estEnRetard,
    statutEffectif: statutEffectif,
    statutInfo: statutInfo,
    statutSelonPaiement: statutSelonPaiement,
    formaterNombre: formaterNombre,
    formaterMontant: formaterMontant,
    formaterDate: formaterDate,
    formaterDateHeure: formaterDateHeure,
    montantEnLettres: montantEnLettres
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = AGORA.calculs;

})(typeof globalThis !== 'undefined' ? globalThis : this);
