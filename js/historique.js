/* ==========================================================================
   Agora Factures — historique des documents (historique.html)
   --------------------------------------------------------------------------
   Recherche, filtres (période / type / statut), tri, consultation,
   modification des brouillons, duplication, paiements, annulation,
   suppression, impression et export PDF.
   Les actions sont exposées (AGORA.historique.actions) pour être réutilisées
   par le tableau de bord.
   ========================================================================== */
(function (global) {
  'use strict';

  var AGORA = global.AGORA || (global.AGORA = {});
  var app = AGORA.app;
  var doc = global.document;
  var calculs = AGORA.calculs;

  var etat = {
    documents: [],
    filtres: { recherche: '', periode: 'tout', type: 'tout', statut: 'tout', du: '', au: '', tri: 'dateEmission', sens: 'desc' }
  };

  /* --------------------------------------------------------- performances */
  /**
   * Les montants sont recalculés une seule fois par document entre deux
   * chargements : le tri, les filtres et le rendu partagent le même cache.
   * (Sur un historique de plusieurs centaines de documents, le tri par montant
   * recalculait auparavant chaque document à chaque comparaison.)
   */
  var cacheMontants = new Map();
  var operationsEnCours = new Set();

  function montantsDe(d) {
    if (!d) return AGORA.documents.montants(d);
    var connu = cacheMontants.get(d.id);
    if (!connu) {
      connu = AGORA.documents.montants(d);
      cacheMontants.set(d.id, connu);
    }
    return connu;
  }

  function reconstruireCache(liste) {
    cacheMontants = new Map();
    (liste || []).forEach(montantsDe);
  }

  /** Empêche les doubles exécutions (double clic, validation répétée). */
  function verrou(cle) {
    if (operationsEnCours.has(cle)) {
      app.notifier('Cette opération est déjà en cours…', 'info', 2000);
      return false;
    }
    operationsEnCours.add(cle);
    return true;
  }

  function deverrouiller(cle) { operationsEnCours.delete(cle); }

  /* ------------------------------------------------------------- filtres */
  function debutPeriode(cle) {
    var maintenant = new Date();
    var d = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate());
    switch (cle) {
      case 'aujourdhui': return d;
      case '7j': d.setDate(d.getDate() - 6); return d;
      case '30j': d.setDate(d.getDate() - 29); return d;
      case 'mois': return new Date(maintenant.getFullYear(), maintenant.getMonth(), 1);
      case 'trimestre': return new Date(maintenant.getFullYear(), Math.floor(maintenant.getMonth() / 3) * 3, 1);
      case 'annee': return new Date(maintenant.getFullYear(), 0, 1);
      default: return null;
    }
  }

  function iso(date) {
    return date.getFullYear() + '-' + calculs.pad(date.getMonth() + 1) + '-' + calculs.pad(date.getDate());
  }

  function appliquerFiltres(liste) {
    var f = etat.filtres;
    var recherche = f.recherche.trim().toLowerCase();
    var debut = debutPeriode(f.periode);
    var debutIso = debut ? iso(debut) : null;
    var duIso = f.du || null;
    var auIso = f.au || null;

    var resultat = liste.filter(function (d) {
      if (f.type !== 'tout' && d.type !== f.type) return false;
      var statut = calculs.statutEffectif(d);
      if (f.statut !== 'tout' && statut !== f.statut) return false;
      if (debutIso && (d.dateEmission || '') < debutIso) return false;
      if (duIso && (d.dateEmission || '') < duIso) return false;
      if (auIso && (d.dateEmission || '') > auIso) return false;
      if (recherche) {
        var champs = [
          d.numero || '',
          (d.client && d.client.nom) || '',
          (d.vendeur && d.vendeur.nom) || '',
          d.type === 'recu' ? 'reçu recu' : 'facture'
        ].join(' ').toLowerCase();
        if (champs.indexOf(recherche) === -1) return false;
      }
      return true;
    });

    var sens = f.sens === 'asc' ? 1 : -1;
    resultat.sort(function (a, b) {
      if (f.tri === 'montant') {
        var ma = montantsDe(a).total;
        var mb = montantsDe(b).total;
        if (ma === mb) return ((a.dateEmission || '') < (b.dateEmission || '') ? 1 : -1) * sens;
        return (ma - mb) * sens;
      }
      if (f.tri === 'client') {
        var ca = String((a.client && a.client.nom) || '').toLowerCase();
        var cb = String((b.client && b.client.nom) || '').toLowerCase();
        if (ca === cb) return 0;
        return (ca < cb ? -1 : 1) * sens;
      }
      if (f.tri === 'numero') {
        var na = String(a.numero || '');
        var nb = String(b.numero || '');
        return (na < nb ? -1 : (na > nb ? 1 : 0)) * sens;
      }
      var da = String(a.dateEmission || '');
      var db = String(b.dateEmission || '');
      if (da === db) return (String(a.createdAt || '') < String(b.createdAt || '') ? -1 : 1) * sens;
      return (da < db ? -1 : 1) * sens;
    });
    return resultat;
  }

  /* ------------------------------------------------------------ rendu */
  function rendre() {
    var liste = appliquerFiltres(etat.documents);
    var corps = app.$('#corps-historique');
    var conteneur = app.$('#conteneur-tableau');
    var vide = app.$('#etat-vide-historique');
    if (!corps) return;

    corps.innerHTML = '';
    liste.forEach(function (d) { corps.appendChild(ligneDocument(d)); });

    var total = 0;
    liste.forEach(function (d) {
      if (d.statut !== 'annulee') total += montantsDe(d).total;
    });
    var resume = app.$('#resume-historique');
    if (resume) {
      resume.textContent = liste.length + ' document(s) · total ' +
        AGORA.parametres.formaterMontant(total, AGORA.parametres.lire().devise);
    }

    if (vide) vide.classList.toggle('cache', liste.length > 0);
    if (conteneur) conteneur.classList.toggle('cache', liste.length === 0);
  }

  function ligneDocument(d) {
    var m = montantsDe(d);
    var statut = calculs.statutEffectif(d);
    var info = calculs.statutInfo(statut);
    var tr = doc.createElement('tr');

    var tdNumero = app.creer('td', { dataset: { libelle: 'Numéro' } });
    tdNumero.appendChild(app.creer('span', { class: 'mono gras', text: d.numero || '(brouillon)' }));
    tr.appendChild(tdNumero);

    tr.appendChild(app.creer('td', { dataset: { libelle: 'Type' }, text: d.type === 'recu' ? 'Reçu' : 'Facture' }));
    tr.appendChild(app.creer('td', { dataset: { libelle: 'Client' }, text: (d.client && d.client.nom) || '—' }));
    tr.appendChild(app.creer('td', { dataset: { libelle: 'Date' }, text: calculs.formaterDate(d.dateEmission) }));
    tr.appendChild(app.creer('td', {
      dataset: { libelle: 'Montant' },
      class: 'nombre montant',
      text: AGORA.parametres.formaterMontant(m.total, d.devise)
    }));

    var tdStatut = app.creer('td', { dataset: { libelle: 'Statut' } });
    var pastille = app.creer('span', { class: 'pastille ' + info.classe, text: info.libelle });
    tdStatut.appendChild(pastille);
    if (m.solde > 0 && d.statut !== 'annulee' && d.statut !== 'brouillon') {
      tdStatut.appendChild(app.creer('div', {
        class: 'petit muet',
        text: 'reste ' + AGORA.parametres.formaterMontant(m.solde, d.devise)
      }));
    }
    tr.appendChild(tdStatut);

    var tdActions = app.creer('td', { class: 'actions', dataset: { libelle: 'Actions' } });
    var groupe = app.creer('div', { class: 'groupe-boutons aligne-droite' });

    groupe.appendChild(boutonAction('voir', 'Consulter', d, function () { voir(d.id); }));

    if (d.statut === 'brouillon') {
      groupe.appendChild(boutonLien('modifier', 'Modifier', app.url('pages/facture.html?id=' + encodeURIComponent(d.id))));
      groupe.appendChild(boutonAction('supprimer', 'Supprimer le brouillon', d, function () { supprimer(d.id); }, 'btn-danger'));
    } else {
      if (d.statut !== 'annulee') {
        if (m.solde > 0) {
          groupe.appendChild(boutonAction('paiement', 'Enregistrer un paiement', d, function () { payer(d.id); }, 'btn-succes'));
          groupe.appendChild(boutonAction('check', 'Marquer payée', d, function () { marquerPayee(d.id); }, 'btn-succes'));
        }
        groupe.appendChild(boutonAction('annuler', 'Annuler le document', d, function () { annuler(d.id); }, 'btn-danger'));
      } else {
        groupe.appendChild(boutonAction('supprimer', 'Supprimer', d, function () { supprimer(d.id); }, 'btn-danger'));
      }
    }

    groupe.appendChild(boutonLien('copier', 'Dupliquer', app.url('pages/facture.html?copie=' + encodeURIComponent(d.id))));
    groupe.appendChild(boutonAction('imprimante', 'Imprimer', d, function () { imprimer(d.id); }));
    groupe.appendChild(boutonAction('telecharger', 'PDF', d, function () { exporterPdf(d.id); }));

    tdActions.appendChild(groupe);
    tr.appendChild(tdActions);
    return tr;
  }

  function boutonAction(icone, libelle, d, action, classe) {
    var b = app.creer('button', {
      class: 'btn btn-petit ' + (classe || 'btn-fantome'),
      type: 'button',
      title: libelle,
      'aria-label': libelle + ' — ' + (d.numero || 'brouillon'),
      html: app.icone(icone)
    });
    b.addEventListener('click', action);
    return b;
  }

  function boutonLien(icone, libelle, href) {
    var a = app.creer('a', {
      class: 'btn btn-petit btn-fantome',
      href: href,
      title: libelle,
      'aria-label': libelle,
      html: app.icone(icone)
    });
    return a;
  }

  /* ------------------------------------------------------------- actions */
  function charger(id) {
    return AGORA.stockage.obtenirDocument(id).then(function (d) {
      if (!d) throw new Error('Document introuvable (il a peut-être été supprimé).');
      return d;
    });
  }

  function optionsRendu(d, reglages, logo) {
    return {
      logo: (d.vendeur && d.vendeur.logo) || logo || null,
      modele: d.modele,
      couleur: reglages.impression.couleur,
      signature: reglages.impression.signature,
      montantEnLettres: reglages.impression.montantEnLettres,
      afficherLogo: reglages.impression.afficherLogo
    };
  }

  function voir(id) {
    Promise.all([charger(id), AGORA.parametres.logo()]).then(function (resultats) {
      var d = resultats[0];
      var reglages = AGORA.parametres.lire();
      var element = AGORA.documents.rendreHtml(d, optionsRendu(d, reglages, resultats[1]));
      var conteneur = app.creer('div', { class: 'zone-apercu' });
      var echelle = app.creer('div', { class: 'apercu-echelle' });
      echelle.appendChild(element);
      conteneur.appendChild(echelle);
      var modale = app.ouvrirModale({
        titre: (d.type === 'recu' ? 'Reçu' : 'Facture') + ' n° ' + (d.numero || '—'),
        corps: conteneur,
        large: true,
        classe: 'apercu-dialogue',
        actions: [
          {
            libelle: 'Imprimer', classe: 'btn-secondaire', action: function () {
              app.imprimerElement(element);
              return false;
            }
          },
          {
            libelle: 'Télécharger PDF', classe: 'btn-bleu', action: function () {
              exporterPdf(d.id);
              return false;
            }
          },
          { libelle: 'Fermer', classe: 'btn-fantome', action: function () { } }
        ]
      });
      var redimensionner = function () { AGORA.documents.ajusterEchelle(conteneur, echelle); };
      global.addEventListener('resize', redimensionner);
      modale.element.addEventListener('DOMNodeRemoved', function () { global.removeEventListener('resize', redimensionner); });
      global.setTimeout(redimensionner, 30);
    }, function (e) { app.erreurUtilisateur(e, 'Consultation'); });
  }

  function imprimer(id) {
    Promise.all([charger(id), AGORA.parametres.logo()]).then(function (resultats) {
      var reglages = AGORA.parametres.lire();
      app.imprimerElement(AGORA.documents.rendreHtml(resultats[0], optionsRendu(resultats[0], reglages, resultats[1])));
    }, function (e) { app.erreurUtilisateur(e, 'Impression'); });
  }

  function exporterPdf(id) {
    charger(id).then(function (d) {
      app.notifier('Génération du PDF…', 'info', 2000);
      return AGORA.parametres.logo().then(function (logo) {
        var reglages = AGORA.parametres.lire();
        return AGORA.pdf.telechargerPdf(d, optionsRendu(d, reglages, logo));
      });
    }).then(function () {
      app.notifier('PDF généré.', 'succes');
    }, function (e) { app.erreurUtilisateur(e, 'PDF'); });
  }

  function payer(id) {
    charger(id).then(function (d) {
      var m = AGORA.documents.montants(d);
      var restant = Math.max(0, m.solde);
      var corps = doc.createElement('div');
      var champMontant = app.creer('input', { type: 'text', inputmode: 'decimal', id: 'p-montant', value: String(restant) });
      var champDate = app.creer('input', { type: 'date', id: 'p-date', value: calculs.aujourdhui() });
      var champMethode = app.creer('select', { id: 'p-methode' });
      ['Especes', 'Virement', 'Cheque', 'Mobile money', 'Carte bancaire', 'Autre'].forEach(function (methode) {
        champMethode.appendChild(app.creer('option', { value: methode, text: methode }));
      });
      var champReference = app.creer('input', { type: 'text', id: 'p-reference', placeholder: 'facultatif' });

      corps.appendChild(app.creer('div', { class: 'champ' }, [
        app.creer('label', { for: 'p-montant', text: 'Montant reçu (' + d.devise + ')' }),
        champMontant,
        app.creer('div', { class: 'erreur' })
      ]));
      corps.appendChild(app.creer('div', { class: 'champ' }, [
        app.creer('label', { for: 'p-date', text: 'Date du paiement' }),
        champDate,
        app.creer('div', { class: 'erreur' })
      ]));
      corps.appendChild(app.creer('div', { class: 'champ' }, [
        app.creer('label', { for: 'p-methode', text: 'Moyen de paiement' }), champMethode
      ]));
      corps.appendChild(app.creer('div', { class: 'champ' }, [
        app.creer('label', { for: 'p-reference', text: 'Référence' }), champReference
      ]));
      corps.appendChild(app.creer('p', {
        class: 'petit muet',
        text: 'Total ' + AGORA.parametres.formaterMontant(m.total, d.devise) +
          ' · déjà payé ' + AGORA.parametres.formaterMontant(m.totalPaye, d.devise) +
          ' · reste ' + AGORA.parametres.formaterMontant(m.solde, d.devise)
      }));

      if (d.paiements.length) {
        var table = app.creer('table', { class: 'tableau' });
        table.innerHTML = '<thead><tr><th>Date</th><th>Méthode</th><th class="nombre">Montant</th></tr></thead>';
        var tb = app.creer('tbody');
        d.paiements.forEach(function (p) {
          tb.appendChild(app.creer('tr', {}, [
            app.creer('td', { text: calculs.formaterDate(p.date) }),
            app.creer('td', { text: p.methode || '—' }),
            app.creer('td', { class: 'nombre', text: AGORA.parametres.formaterMontant(p.montant, d.devise) })
          ]));
        });
        table.appendChild(tb);
        // Enveloppe défilante : le tableau ne provoque jamais de débordement.
        corps.appendChild(app.creer('div', { class: 'champ' }, [
          app.creer('span', { class: 'legende', text: 'Historique' }),
          app.creer('div', { class: 'table-enveloppe' }, [table])
        ]));
      }

      app.ouvrirModale({
        titre: 'Enregistrer un paiement — ' + (d.numero || ''),
        corps: corps,
        actions: [
          { libelle: 'Annuler', classe: 'btn-fantome', action: function () { } },
          {
            libelle: 'Enregistrer', classe: 'btn-principal', action: function () {
              var brut = champMontant.value.replace(/\s/g, '').replace(',', '.');
              var montant = Number(brut);
              if (!isFinite(montant) || montant <= 0) {
                app.notifier('Montant invalide.', 'erreur');
                return false;
              }
              // Garde-fou : un double clic ne doit pas enregistrer deux fois.
              if (!verrou('payer:' + d.id)) return false;
              d.paiements = d.paiements || [];
              d.paiements.push({
                id: 'p_' + Math.random().toString(36).slice(2, 9),
                date: champDate.value || calculs.aujourdhui(),
                montant: montant,
                methode: champMethode.value,
                reference: champReference.value.trim()
              });
              var m2 = AGORA.documents.montants(d);
              d.statut = calculs.statutSelonPaiement(m2.total, m2.totalPaye, d.statut);
              return AGORA.stockage.enregistrerDocument(d).then(function () {
                deverrouiller('payer:' + d.id);
                app.notifier('Paiement enregistré.', 'succes');
                rafraichir();
              }, function (e) {
                deverrouiller('payer:' + d.id);
                app.erreurUtilisateur(e, 'Paiement');
              });
            }
          }
        ]
      });
    }, function (e) { app.erreurUtilisateur(e, 'Paiement'); });
  }

  function marquerPayee(id) {
    charger(id).then(function (d) {
      var m = montantsDe(d);
      var restant = Math.max(0, m.solde);
      if (restant <= 0) {
        app.notifier('Ce document est déjà soldé.', 'info');
        return;
      }
      app.confirmer({
        titre: 'Marquer comme payée',
        message: 'Un paiement de ' + AGORA.parametres.formaterMontant(restant, d.devise) + ' sera enregistré à la date du jour.',
        texteConfirmer: 'Marquer payée'
      }).then(function (oui) {
        if (!oui) return;
        if (!verrou('payer:' + d.id)) return;
        d.paiements = d.paiements || [];
        if (restant > 0) {
          d.paiements.push({
            id: 'p_' + Math.random().toString(36).slice(2, 9),
            date: calculs.aujourdhui(),
            montant: restant,
            methode: 'Especes',
            reference: ''
          });
        }
        var m2 = AGORA.documents.montants(d);
        d.statut = m2.totalPaye >= m2.total ? 'payee' : d.statut;
        AGORA.stockage.enregistrerDocument(d).then(function () {
          deverrouiller('payer:' + d.id);
          app.notifier('Document marqué comme payé.', 'succes');
          rafraichir();
        }, function (e) {
          deverrouiller('payer:' + d.id);
          app.erreurUtilisateur(e, 'Paiement');
        });
      });
    }, function (e) { app.erreurUtilisateur(e, 'Paiement'); });
  }

  function annuler(id) {
    charger(id).then(function (d) {
      var m = montantsDe(d);
      if (m.totalPaye > 0) {
        app.notifier('Ce document comporte des paiements. Supprimez-les avant de l\'annuler.', 'avertissement', 6000);
        return;
      }
      if (d.statut === 'brouillon') {
        app.notifier('Un brouillon se supprime, il ne s\'annule pas.', 'avertissement');
        return;
      }
      var corps = doc.createElement('div');
      corps.appendChild(app.creer('p', {
        text: 'Le document ' + (d.numero || '') + ' sera marqué « Annulée ». Il restera dans l\'historique et sera exclu des montants encaissés.'
      }));
      var champMotif = app.creer('textarea', { id: 'motif-annulation', rows: '2', placeholder: 'Motif (facultatif)' });
      corps.appendChild(app.creer('div', { class: 'champ' }, [
        app.creer('label', { for: 'motif-annulation', text: 'Motif' }), champMotif
      ]));
      app.ouvrirModale({
        titre: 'Annuler le document',
        corps: corps,
        actions: [
          { libelle: 'Annuler', classe: 'btn-fantome', action: function () { } },
          {
            libelle: 'Annuler le document', classe: 'btn-danger', action: function () {
              if (!verrou('annuler:' + d.id)) return false;
              d.statut = 'annulee';
              d.annuleeLe = new Date().toISOString();
              d.motifAnnulation = champMotif.value.trim();
              return AGORA.stockage.enregistrerDocument(d).then(function () {
                deverrouiller('annuler:' + d.id);
                app.notifier('Document annulé.', 'succes');
                rafraichir();
              }, function (e) {
                deverrouiller('annuler:' + d.id);
                app.erreurUtilisateur(e, 'Annulation');
              });
            }
          }
        ]
      });
    }, function (e) { app.erreurUtilisateur(e, 'Annulation'); });
  }

  function supprimer(id) {
    charger(id).then(function (d) {
      var m = montantsDe(d);
      var autorise = d.statut === 'brouillon' || d.statut === 'annulee';
      if (!autorise) {
        app.notifier('Seuls les brouillons et les documents annulés peuvent être supprimés. Annulez d\'abord le document.', 'avertissement', 7000);
        return;
      }
      app.confirmer({
        titre: 'Supprimer définitivement ?',
        message: 'Le document « ' + (d.numero || 'brouillon') + ' » sera supprimé de ce navigateur.',
        details: d.numero ? 'Le numéro ' + d.numero + ' ne sera jamais réattribué.' : '',
        texteConfirmer: 'Supprimer',
        danger: true
      }).then(function (oui) {
        if (!oui) return;
        if (!verrou('supprimer:' + id)) return;
        AGORA.stockage.supprimerDocument(id).then(function () {
          deverrouiller('supprimer:' + id);
          app.notifier('Document supprimé (' + AGORA.parametres.formaterMontant(m.total, d.devise) + ').', 'succes');
          rafraichir();
        }, function (e) {
          deverrouiller('supprimer:' + id);
          app.erreurUtilisateur(e, 'Suppression');
        });
      });
    }, function (e) { app.erreurUtilisateur(e, 'Suppression'); });
  }

  /* ------------------------------------------------------------ cycle */
  function rafraichir() {
    return AGORA.stockage.listerDocuments().then(function (liste) {
      etat.documents = liste || [];
      reconstruireCache(etat.documents);
      rendre();
      return etat.documents;
    }, function (e) {
      app.erreurUtilisateur(e, 'Chargement de l\'historique');
      return [];
    });
  }

  function majEtatFiltres() {
    app.viderErreurs(app.$('#filtres-historique'));
    var f = etat.filtres;
    if (f.du && f.au && f.du > f.au) {
      app.champErreur(app.$('#filtre-au'), 'La fin doit suivre le début.');
      return false;
    }
    return true;
  }

  function init() {
    var recherche = app.$('#filtre-recherche');
    var type = app.$('#filtre-type');
    var statut = app.$('#filtre-statut');
    var periode = app.$('#filtre-periode');
    var du = app.$('#filtre-du');
    var au = app.$('#filtre-au');
    var tri = app.$('#filtre-tri');
    var sens = app.$('#filtre-sens');

    if (statut) {
      Object.keys(calculs.STATUTS).forEach(function (code) {
        statut.appendChild(app.creer('option', { value: code, text: calculs.STATUTS[code].libelle }));
      });
    }

    function maj() {
      etat.filtres.recherche = recherche.value;
      etat.filtres.type = type.value;
      etat.filtres.statut = statut.value;
      etat.filtres.periode = periode.value;
      etat.filtres.du = du.value;
      etat.filtres.au = au.value;
      etat.filtres.tri = tri.value;
      etat.filtres.sens = sens.value;
      var personnalisee = periode.value === 'personnalise';
      du.parentNode.classList.toggle('cache', !personnalisee);
      au.parentNode.classList.toggle('cache', !personnalisee);
      if (!majEtatFiltres()) return;
      rendre();
    }

    [recherche, type, statut, periode, du, au, tri, sens].forEach(function (champ) {
      champ.addEventListener('input', maj);
      champ.addEventListener('change', maj);
    });

    var reinitialiser = app.$('#filtres-reinitialiser');
    if (reinitialiser) {
      reinitialiser.addEventListener('click', function () {
        recherche.value = '';
        type.value = 'tout';
        statut.value = 'tout';
        periode.value = 'tout';
        du.value = '';
        au.value = '';
        tri.value = 'dateEmission';
        sens.value = 'desc';
        maj();
      });
    }

    var actualiser = app.$('#bouton-actualiser');
    if (actualiser) actualiser.addEventListener('click', function () { rafraichir(); });

    rafraichir();
  }

  app.pret(function () {
    if (doc.body && doc.body.dataset.page === 'historique') init();
  });

  AGORA.historique = {
    etat: etat,
    rafraichir: rafraichir,
    appliquerFiltres: appliquerFiltres,
    debutPeriode: debutPeriode,
    actions: {
      voir: voir,
      imprimer: imprimer,
      exporterPdf: exporterPdf,
      payer: payer,
      marquerPayee: marquerPayee,
      annuler: annuler,
      supprimer: supprimer
    }
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
