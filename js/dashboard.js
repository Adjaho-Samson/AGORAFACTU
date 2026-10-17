/* ==========================================================================
   Agora Factures — tableau de bord (dashboard.html)
   --------------------------------------------------------------------------
   Toutes les statistiques proviennent d'IndexedDB : elles sont recalculées
   à partir des lignes et des paiements enregistrés (jamais depuis l'écran).
   Les documents annulés sont exclus des montants encaissés et facturés.
   ========================================================================== */
(function (global) {
  'use strict';

  var AGORA = global.AGORA || (global.AGORA = {});
  var app = AGORA.app;
  var doc = global.document;
  var calculs = AGORA.calculs;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var etat = { documents: [], periode: '30j' };

  /* ------------------------------------------------------------- agrégats */
  function calculerStats(liste, debutIso, finIso, periodeActive) {
    var stats = {
      encaisse: 0,
      facture: 0,
      reste: 0,
      total: 0,
      payes: 0,
      enAttente: 0,
      enRetard: 0,
      partiels: 0,
      annules: 0,
      brouillons: 0,
      factures: 0,
      recus: 0,
      parJour: {}
    };
    (liste || []).forEach(function (d) {
      var date = d.dateEmission || '';
      var dansPeriode = !periodeActive ||
        ((!debutIso || date >= debutIso) && (!finIso || date <= finIso));
      if (!dansPeriode) return;

      var m = AGORA.documents.montants(d);
      var statut = calculs.statutEffectif(d);

      if (d.statut === 'annulee') {
        stats.annules++;                 // compté, mais dans aucun montant
        return;
      }
      if (d.statut === 'brouillon') {
        stats.brouillons++;              // ni montant, ni statut de paiement
        return;
      }

      stats.total++;
      stats.facture += m.total;
      stats.encaisse += m.totalPaye;
      if (m.solde > 0) stats.reste += m.solde;
      if (statut === 'payee') stats.payes++;
      else if (statut === 'en_retard') stats.enRetard++;
      else if (statut === 'partielle') stats.partiels++;
      else stats.enAttente++;
      if (d.type === 'recu') stats.recus++; else stats.factures++;

      // évolution : uniquement les documents non annulés
      if (!stats.parJour[date]) stats.parJour[date] = { facture: 0, encaisse: 0, count: 0 };
      stats.parJour[date].facture += m.total;
      stats.parJour[date].encaisse += m.totalPaye;
      stats.parJour[date].count++;
    });
    return stats;
  }

  function bornesPeriode(cle) {
    var maintenant = new Date();
    var fin = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate());
    var debut = null;
    var granularite = 'jour';
    switch (cle) {
      case '7j':
        debut = new Date(fin); debut.setDate(debut.getDate() - 6); granularite = 'jour'; break;
      case '30j':
        debut = new Date(fin); debut.setDate(debut.getDate() - 29); granularite = 'jour'; break;
      case 'annee':
        debut = new Date(fin.getFullYear(), fin.getMonth() - 11, 1); granularite = 'mois'; break;
      case 'tout':
        debut = null; granularite = 'annee'; break;
      default:
        debut = null; granularite = 'mois';
    }
    function iso(d) { return d.getFullYear() + '-' + calculs.pad(d.getMonth() + 1) + '-' + calculs.pad(d.getDate()); }
    return { debutIso: debut ? iso(debut) : null, finIso: iso(fin), granularite: granularite };
  }

  function cleBucket(dateIso, granularite) {
    if (!dateIso) return '—';
    if (granularite === 'annee') return dateIso.slice(0, 4);
    if (granularite === 'mois') return dateIso.slice(0, 7);
    return dateIso.slice(0, 10);
  }

  function libelleBucket(cle, granularite) {
    if (granularite === 'annee') return cle;
    if (granularite === 'mois') {
      var parties = cle.split('-');
      var mois = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
      return mois[parseInt(parties[1], 10) - 1] + ' ' + parties[0].slice(2);
    }
    var p = cle.split('-');
    return p[2] + '/' + p[1];
  }

  function serieBuckets(bornes) {
    var clefs = [];
    if (bornes.granularite === 'jour' && bornes.debutIso) {
      var d = new Date(bornes.debutIso + 'T00:00:00');
      var fin = new Date(bornes.finIso + 'T00:00:00');
      while (d <= fin) {
        clefs.push(d.getFullYear() + '-' + calculs.pad(d.getMonth() + 1) + '-' + calculs.pad(d.getDate()));
        d.setDate(d.getDate() + 1);
      }
    } else if (bornes.granularite === 'mois' && bornes.debutIso) {
      var dm = new Date(bornes.debutIso.slice(0, 7) + '-01T00:00:00');
      var fm = new Date(bornes.finIso.slice(0, 7) + '-01T00:00:00');
      while (dm <= fm) {
        clefs.push(dm.getFullYear() + '-' + calculs.pad(dm.getMonth() + 1));
        dm.setMonth(dm.getMonth() + 1);
      }
    } else {
      // toutes années présentes dans les données
      var annees = {};
      etat.documents.forEach(function (x) {
        if (x.dateEmission) annees[x.dateEmission.slice(0, 4)] = true;
      });
      clefs = Object.keys(annees).sort();
      if (!clefs.length) clefs = [String(new Date().getFullYear())];
    }
    return clefs.map(function (cle) {
      return { cle: cle, libelle: libelleBucket(cle, bornes.granularite), facture: 0, encaisse: 0, count: 0 };
    });
  }

  /* ------------------------------------------------------------- rendu SVG */
  function svg(balise, attributs) {
    var e = doc.createElementNS(SVG_NS, balise);
    Object.keys(attributs || {}).forEach(function (k) { e.setAttribute(k, attributs[k]); });
    return e;
  }

  function graphiqueBarres(serie, options) {
    options = options || {};
    var largeur = 720, hauteur = 240;
    var marge = { haut: 16, droite: 12, bas: 34, gauche: 58 };
    var racine = svg('svg', { viewBox: '0 0 ' + largeur + ' ' + hauteur, class: 'graphique', role: 'img' });
    racine.appendChild(svg('title', {})).textContent = options.titre || 'Évolution des montants';

    if (!serie.length) return racine;

    var max = 0;
    serie.forEach(function (b) { if (b.facture > max) max = b.facture; });
    if (max <= 0) max = 1;

    var w = largeur - marge.gauche - marge.droite;
    var h = hauteur - marge.haut - marge.bas;
    var pas = w / serie.length;
    var largeurBarre = Math.max(4, Math.min(38, pas * 0.62));

    // Lignes de repère
    for (var i = 0; i <= 4; i++) {
      var valeur = max * i / 4;
      var y = marge.haut + h - (h * i / 4);
      racine.appendChild(svg('line', {
        x1: marge.gauche, y1: y, x2: largeur - marge.droite, y2: y,
        stroke: i === 0 ? '#c7d0de' : '#eef1f6', 'stroke-width': 1
      }));
      var etiquette = svg('text', { x: marge.gauche - 6, y: y + 3, 'text-anchor': 'end', class: 'graphe-axe' });
      etiquette.textContent = options.formaterCourt ? options.formaterCourt(valeur) : String(Math.round(valeur));
      racine.appendChild(etiquette);
    }

    serie.forEach(function (b, index) {
      var x = marge.gauche + pas * index + (pas - largeurBarre) / 2;
      var hTotal = (b.facture / max) * h;
      var hEncaisse = (b.encaisse / max) * h;
      var yBase = marge.haut + h;
      if (hTotal > 0) {
        racine.appendChild(svg('rect', {
          x: x, y: yBase - hTotal, width: largeurBarre, height: Math.max(1, hTotal),
          rx: 2, fill: '#a9caf5', class: 'barre-facture'
        }));
      }
      if (hEncaisse > 0) {
        racine.appendChild(svg('rect', {
          x: x, y: yBase - hEncaisse, width: largeurBarre, height: Math.max(1, hEncaisse),
          rx: 2, fill: '#12375f', class: 'barre-encaisse'
        }));
      }
      if (b.facture > 0 || b.encaisse > 0) {
        var infobulle = svg('title', {});
        infobulle.textContent = b.libelle + ' · facturé ' + (options.formater ? options.formater(b.facture) : b.facture) +
          ' · encaissé ' + (options.formater ? options.formater(b.encaisse) : b.encaisse);
        racine.lastChild.appendChild(infobulle);
      }
      if (serie.length <= 14 || index % Math.ceil(serie.length / 12) === 0) {
        var texte = svg('text', {
          x: marge.gauche + pas * index + pas / 2, y: hauteur - 12,
          'text-anchor': 'middle', class: 'graphe-axe'
        });
        texte.textContent = b.libelle;
        racine.appendChild(texte);
      }
    });

    return racine;
  }

  function barresRepartition(items, total) {
    var conteneur = app.creer('div', { class: 'repartition' });
    items.forEach(function (item) {
      var pct = total > 0 ? (item.valeur / total) * 100 : 0;
      var ligne = app.creer('div', { class: 'repartition-ligne' });
      ligne.appendChild(app.creer('span', { class: 'repartition-libelle', text: item.libelle }));
      var piste = app.creer('div', { class: 'repartition-piste' });
      var barre = app.creer('div', { class: 'repartition-barre' });
      barre.style.width = pct.toFixed(1) + '%';
      barre.style.background = item.couleur;
      piste.appendChild(barre);
      ligne.appendChild(piste);
      ligne.appendChild(app.creer('span', { class: 'repartition-valeur', text: pct.toFixed(0) + ' % · ' + item.valeur }));
      conteneur.appendChild(ligne);
    });
    return conteneur;
  }

  /* ---------------------------------------------------------------- rendu */
  function rendre() {
    var reglages = AGORA.parametres.lire();
    var formater = function (v) { return AGORA.parametres.formaterMontant(v, reglages.devise); };
    var formaterCourt = function (v) {
      if (v >= 1000000) return (v / 1000000).toFixed(1) + ' M';
      if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1) + ' k';
      return String(Math.round(v));
    };

    var bornes = bornesPeriode(etat.periode);
    var statsPeriode = calculerStats(etat.documents, bornes.debutIso, bornes.finIso, etat.periode !== 'tout');
    var statsGlobal = calculerStats(etat.documents, null, null, false);

    var vide = app.$('#etat-vide-tableau-de-bord');
    var contenu = app.$('#contenu-tableau-de-bord');
    if (vide && contenu) {
      var aucunDocument = (etat.documents || []).length === 0;
      vide.classList.toggle('cache', !aucunDocument);
      contenu.classList.toggle('cache', aucunDocument);
      if (aucunDocument) return;
    }

    // Indicateurs (période sélectionnée pour les montants)
    app.$('#kpi-encaisse').textContent = formater(statsPeriode.encaisse);
    app.$('#kpi-facture').textContent = formater(statsPeriode.facture);
    app.$('#kpi-reste').textContent = formater(statsPeriode.reste);
    app.$('#kpi-documents').textContent = String(statsPeriode.total + statsPeriode.brouillons);
    app.$('#kpi-payes').textContent = String(statsPeriode.payes);
    app.$('#kpi-impayes').textContent = String(statsPeriode.enAttente + statsPeriode.partiels + statsPeriode.enRetard);
    app.$('#kpi-retard').textContent = String(statsPeriode.enRetard);
    app.$('#kpi-annules').textContent = String(statsPeriode.annules);
    app.$('#kpi-brouillons').textContent = String(statsGlobal.brouillons);
    var sousTitre = app.$('#kpi-periode-libelle');
    if (sousTitre) {
      sousTitre.textContent = ({
        '7j': '7 derniers jours',
        '30j': '30 derniers jours',
        'annee': '12 derniers mois',
        'tout': 'depuis le début'
      })[etat.periode] || '';
    }

    // Évolution
    var serie = serieBuckets(bornes);
    var index = {};
    serie.forEach(function (b) { index[b.cle] = b; });
    Object.keys(statsPeriode.parJour).forEach(function (date) {
      var cle = cleBucket(date, bornes.granularite);
      if (index[cle]) {
        index[cle].facture += statsPeriode.parJour[date].facture;
        index[cle].encaisse += statsPeriode.parJour[date].encaisse;
        index[cle].count += statsPeriode.parJour[date].count;
      }
    });
    var zoneGraphe = app.$('#zone-graphique');
    if (zoneGraphe) {
      zoneGraphe.innerHTML = '';
      zoneGraphe.appendChild(graphiqueBarres(serie, { formater: formater, formaterCourt: formaterCourt, titre: 'Évolution des montants' }));
      var legende = app.creer('div', { class: 'graphe-legende' });
      legende.appendChild(app.creer('span', {}, [
        app.creer('i', { class: 'puce puce-facture' }), app.creer('span', { text: 'Montant facturé' })
      ]));
      legende.appendChild(app.creer('span', {}, [
        app.creer('i', { class: 'puce puce-encaisse' }), app.creer('span', { text: 'Montant encaissé' })
      ]));
      zoneGraphe.appendChild(legende);
    }

    // Répartition des statuts
    var zoneRepartition = app.$('#zone-repartition');
    if (zoneRepartition) {
      zoneRepartition.innerHTML = '';
      var items = [
        { libelle: 'Payés', valeur: statsPeriode.payes, couleur: '#16803d' },
        { libelle: 'En attente', valeur: statsPeriode.enAttente, couleur: '#f59e0b' },
        { libelle: 'Partiellement payés', valeur: statsPeriode.partiels, couleur: '#1d6fd8' },
        { libelle: 'En retard', valeur: statsPeriode.enRetard, couleur: '#c62828' },
        { libelle: 'Annulés', valeur: statsPeriode.annules, couleur: '#8a95a5' }
      ].filter(function (i) { return i.valeur > 0; });
      var totalStatuts = items.reduce(function (a, i) { return a + i.valeur; }, 0);
      if (!items.length) {
        zoneRepartition.appendChild(app.creer('p', { class: 'muet petit', text: 'Aucun document sur la période sélectionnée.' }));
      } else {
        zoneRepartition.appendChild(barresRepartition(items, totalStatuts));
      }
    }

    // Derniers documents
    rendreRecents();
  }

  function rendreRecents() {
    var corps = app.$('#corps-recents');
    if (!corps) return;
    corps.innerHTML = '';
    var recents = etat.documents.slice().sort(function (a, b) {
      var da = String(a.dateEmission || '') + String(a.createdAt || '');
      var db = String(b.dateEmission || '') + String(b.createdAt || '');
      return da < db ? 1 : (da > db ? -1 : 0);
    }).slice(0, 8);

    recents.forEach(function (d) {
      var m = AGORA.documents.montants(d);
      var statut = calculs.statutEffectif(d);
      var info = calculs.statutInfo(statut);
      var tr = app.creer('tr');
      tr.appendChild(app.creer('td', { class: 'mono gras', dataset: { libelle: 'Numéro' }, text: d.numero || '(brouillon)' }));
      tr.appendChild(app.creer('td', { dataset: { libelle: 'Type' }, text: d.type === 'recu' ? 'Reçu' : 'Facture' }));
      tr.appendChild(app.creer('td', { dataset: { libelle: 'Client' }, text: (d.client && d.client.nom) || '—' }));
      tr.appendChild(app.creer('td', { dataset: { libelle: 'Date' }, text: calculs.formaterDate(d.dateEmission) }));
      tr.appendChild(app.creer('td', {
        class: 'nombre montant', dataset: { libelle: 'Montant' },
        text: AGORA.parametres.formaterMontant(m.total, d.devise)
      }));
      var tdStatut = app.creer('td', { dataset: { libelle: 'Statut' } });
      tdStatut.appendChild(app.creer('span', { class: 'pastille ' + info.classe, text: info.libelle }));
      tr.appendChild(tdStatut);
      var tdActions = app.creer('td', { class: 'actions', dataset: { libelle: 'Actions' } });
      var groupe = app.creer('div', { class: 'groupe-boutons aligne-droite' });
      var voir = app.creer('button', { class: 'btn btn-petit btn-fantome', type: 'button', title: 'Consulter', 'aria-label': 'Consulter ' + (d.numero || ''), html: app.icone('voir') });
      voir.addEventListener('click', function () { AGORA.historique.actions.voir(d.id); });
      groupe.appendChild(voir);
      if (d.statut === 'brouillon') {
        var lien = app.creer('a', {
          class: 'btn btn-petit btn-fantome', href: app.url('pages/facture.html?id=' + encodeURIComponent(d.id)),
          title: 'Modifier', 'aria-label': 'Modifier ' + (d.numero || ''), html: app.icone('modifier')
        });
        groupe.appendChild(lien);
      } else if (d.statut !== 'annulee' && m.solde > 0) {
        var payer = app.creer('button', { class: 'btn btn-petit btn-succes', type: 'button', title: 'Enregistrer un paiement', 'aria-label': 'Paiement ' + (d.numero || ''), html: app.icone('paiement') });
        payer.addEventListener('click', function () { AGORA.historique.actions.payer(d.id); });
        groupe.appendChild(payer);
      }
      tdActions.appendChild(groupe);
      tr.appendChild(tdActions);
      corps.appendChild(tr);
    });
  }

  function charger() {
    return AGORA.stockage.listerDocuments().then(function (liste) {
      etat.documents = liste || [];
      rendre();
    }, function (e) {
      app.erreurUtilisateur(e, 'Chargement du tableau de bord');
    });
  }

  function init() {
    var selecteur = app.$('#periode-tableau-de-bord');
    if (selecteur) {
      selecteur.value = etat.periode;
      selecteur.addEventListener('change', function () {
        etat.periode = selecteur.value;
        rendre();
      });
    }
    var actualiser = app.$('#bouton-actualiser-tableau-de-bord');
    if (actualiser) actualiser.addEventListener('click', charger);
    charger();
  }

  app.pret(function () {
    if (doc.body && doc.body.dataset.page === 'dashboard') init();
  });

  AGORA.dashboard = {
    etat: etat,
    charger: charger,
    calculerStats: calculerStats,
    bornesPeriode: bornesPeriode,
    serieBuckets: serieBuckets,
    cleBucket: cleBucket
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
