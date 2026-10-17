/* ==========================================================================
   Agora Factures — module de stockage commun
   --------------------------------------------------------------------------
   • IndexedDB : documents (factures, reçus, brouillons), compteurs de
     numérotation, métadonnées (logo…).
   • localStorage : préférences simples (réglages de l'application).

   Aucune donnée n'est envoyée sur un serveur : tout reste dans le
   navigateur de l'utilisateur. Ce stockage N'EST PAS chiffré.
   ========================================================================== */
(function (global) {
  'use strict';

  var AGORA = global.AGORA || (global.AGORA = {});

  var NOM_DB = 'agora-factures';
  var VERSION_DB = 1;
  var STORE_DOCUMENTS = 'documents';
  var STORE_COMPTEURS = 'compteurs';
  var STORE_META = 'meta';
  var CLE_REGLEGES = 'agora.reglages.v1';

  var dbPromise = null;

  function disponible() {
    return typeof global.indexedDB !== 'undefined' && global.indexedDB !== null;
  }

  function erreurStockage(e, contexte) {
    var brut = (e && (e.target && e.target.error ? e.target.error.message : e.message)) || String(e || '');
    var err = new Error('Stockage local indisponible (' + (contexte || 'opération') + ') : ' + brut);
    err.code = (e && e.target && e.target.error && e.target.error.name) || 'ERREUR_STOCKAGE';
    err.contexte = contexte;
    return err;
  }

  /** Ouvre (et crée si besoin) la base IndexedDB. */
  function ouvrir() {
    if (!disponible()) {
      return Promise.reject(new Error('Votre navigateur n\'expose pas IndexedDB (mode privé ?). L\'application ne peut pas fonctionner.'));
    }
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resoudre, rejeter) {
      var requete;
      try {
        requete = global.indexedDB.open(NOM_DB, VERSION_DB);
      } catch (e) {
        rejeter(erreurStockage(e, 'ouverture'));
        return;
      }
      requete.onupgradeneeded = function (evenement) {
        var db = evenement.target.result;
        if (!db.objectStoreNames.contains(STORE_DOCUMENTS)) {
          var docs = db.createObjectStore(STORE_DOCUMENTS, { keyPath: 'id' });
          docs.createIndex('numero', 'numero', { unique: false });
          docs.createIndex('type', 'type', { unique: false });
          docs.createIndex('statut', 'statut', { unique: false });
          docs.createIndex('dateEmission', 'dateEmission', { unique: false });
          docs.createIndex('clientNom', 'clientNom', { unique: false });
          docs.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_COMPTEURS)) {
          db.createObjectStore(STORE_COMPTEURS, { keyPath: 'cle' });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'cle' });
        }
      };
      requete.onsuccess = function () {
        var db = requete.result;
        db.onversionchange = function () { db.close(); dbPromise = null; };
        resoudre(db);
      };
      requete.onerror = function (e) { dbPromise = null; rejeter(erreurStockage(e, 'ouverture')); };
      requete.onblocked = function () { rejeter(new Error('Une autre fenêtre bloque la mise à jour de la base locale. Fermez les autres onglets puis réessayez.')); };
    });
    return dbPromise;
  }

  function transaction(stores, mode) {
    return ouvrir().then(function (db) {
      return db.transaction(stores, mode);
    });
  }

  function requeter(store, mode, action) {
    return transaction([store], mode).then(function (tx) {
      return new Promise(function (resoudre, rejeter) {
        var objet = tx.objectStore(store);
        var req;
        try {
          req = action(objet);
        } catch (e) {
          rejeter(erreurStockage(e, store));
          return;
        }
        if (req && typeof req.then === 'function') {
          req.then(resoudre, function (e) { rejeter(erreurStockage(e, store)); });
          return;
        }
        tx.oncomplete = function () { resoudre(req ? req.result : undefined); };
        tx.onerror = function (e) { rejeter(erreurStockage(e, store)); };
        tx.onabort = function (e) { rejeter(erreurStockage(e, store)); };
      });
    });
  }

  function reqToPromise(req) {
    return new Promise(function (resoudre, rejeter) {
      req.onsuccess = function () { resoudre(req.result); };
      req.onerror = function (e) { rejeter(erreurStockage(e, 'requête')); };
    });
  }

  /* ------------------------------------------------------------ documents */

  function identifiant() {
    var t = Date.now().toString(36);
    var a = '';
    var octets = (global.crypto && global.crypto.getRandomValues)
      ? global.crypto.getRandomValues(new Uint8Array(6))
      : null;
    if (octets) {
      for (var i = 0; i < octets.length; i++) a += octets[i].toString(36);
    } else {
      a = Math.random().toString(36).slice(2, 10);
    }
    return 'doc_' + t + '_' + a;
  }

  function normaliserDocument(doc) {
    var maintenant = new Date().toISOString();
    var d = doc && typeof doc === 'object' ? doc : {};
    if (!d.id) d.id = identifiant();
    if (!d.type) d.type = 'facture';
    if (!d.statut) d.statut = 'brouillon';
    if (!d.devise) d.devise = 'XOF';
    d.lignes = Array.isArray(d.lignes) ? d.lignes : [];
    d.paiements = Array.isArray(d.paiements) ? d.paiements : [];
    d.vendeur = d.vendeur || {};
    d.client = d.client || {};
    d.clientNom = (d.client && d.client.nom) || '';
    if (!d.createdAt) d.createdAt = maintenant;
    d.updatedAt = maintenant;
    return d;
  }

  /* ------------------------------------------------------- assainissement */
  function chaineSure(v, max) {
    if (v === null || v === undefined) return '';
    if (typeof v !== 'string') v = String(v);
    // Supprime les caractères de contrôle (compatibilité IndexedDB / JSON).
    return v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max || 2000);
  }

  function nombreSur(v, defaut) {
    var n = typeof v === 'number' ? v : Number(String(v === null || v === undefined ? '' : v).replace(',', '.').replace(/\s/g, ''));
    if (!isFinite(n)) n = typeof defaut === 'number' ? defaut : 0;
    return n;
  }

  var STATUTS_AUTORISES = ['brouillon', 'en_attente', 'payee', 'partielle', 'en_retard', 'annulee'];

  /**
   * Nettoie un document importé (sauvegarde) : aucune donnée non validée
   * n'entre dans la base. Retourne null si le document est inexploitable.
   */
  function assainirDocumentImporte(doc) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
    var id = chaineSure(doc.id, 120);
    var type = doc.type === 'recu' ? 'recu' : (doc.type === 'facture' ? 'facture' : null);
    if (!id || !type) return null;

    var lignes = Array.isArray(doc.lignes) ? doc.lignes : [];
    lignes = lignes.filter(function (l) { return l && typeof l === 'object'; }).map(function (l) {
      return {
        id: chaineSure(l.id, 40) || ('l_' + Math.random().toString(36).slice(2, 9)),
        designation: chaineSure(l.designation, 300),
        quantite: Math.abs(nombreSur(l.quantite, 0)),
        prixUnitaire: nombreSur(l.prixUnitaire, 0),
        remise: Math.max(0, nombreSur(l.remise, 0)),
        tauxTva: Math.min(100, Math.max(0, nombreSur(l.tauxTva, 0)))
      };
    });

    var paiements = Array.isArray(doc.paiements) ? doc.paiements : [];
    paiements = paiements.filter(function (p) { return p && typeof p === 'object'; }).map(function (p) {
      return {
        id: chaineSure(p.id, 40) || ('p_' + Math.random().toString(36).slice(2, 9)),
        date: /^\d{4}-\d{2}-\d{2}/.test(String(p.date || '')) ? String(p.date).slice(0, 10) : aujourdhuiIso(),
        montant: Math.max(0, nombreSur(p.montant, 0)),
        methode: chaineSure(p.methode, 40),
        reference: chaineSure(p.reference, 120)
      };
    });

    var statut = STATUTS_AUTORISES.indexOf(doc.statut) !== -1 ? doc.statut : 'brouillon';
    var maintenant = new Date().toISOString();

    var copie = {
      id: id,
      type: type,
      numero: doc.numero === null || doc.numero === undefined ? null : chaineSure(doc.numero, 60),
      statut: statut,
      dateEmission: /^\d{4}-\d{2}-\d{2}/.test(String(doc.dateEmission || '')) ? String(doc.dateEmission).slice(0, 10) : aujourdhuiIso(),
      dateEcheance: /^\d{4}-\d{2}-\d{2}/.test(String(doc.dateEcheance || '')) ? String(doc.dateEcheance).slice(0, 10) : null,
      devise: chaineSure(doc.devise, 8).toUpperCase() || 'XOF',
      tvaActive: doc.tvaActive !== false,
      tvaMode: doc.tvaMode === 'inclusive' ? 'inclusive' : 'exclusive',
      modeRemise: doc.modeRemise === 'montant' ? 'montant' : 'pourcent',
      modele: chaineSure(doc.modele, 20) || 'classique',
      remiseGlobale: (doc.remiseGlobale && typeof doc.remiseGlobale === 'object')
        ? {
          type: doc.remiseGlobale.type === 'montant' ? 'montant' : 'pourcent',
          valeur: Math.max(0, nombreSur(doc.remiseGlobale.valeur, 0))
        }
        : { type: 'pourcent', valeur: 0 },
      vendeur: objetCoordonnees(doc.vendeur, ['nom', 'adresse', 'telephone', 'email', 'fiscal', 'logo']),
      client: objetCoordonnees(doc.client, ['nom', 'adresse', 'telephone', 'email']),
      clientNom: '',
      lignes: lignes,
      paiements: paiements,
      notes: chaineSure(doc.notes, 1000),
      conditions: chaineSure(doc.conditions, 1000),
      createdAt: typeof doc.createdAt === 'string' ? doc.createdAt : maintenant,
      updatedAt: maintenant
    };
    copie.clientNom = (copie.client && copie.client.nom) || '';
    if (doc.annuleeLe) copie.annuleeLe = String(doc.annuleeLe);
    if (doc.motifAnnulation) copie.motifAnnulation = chaineSure(doc.motifAnnulation, 300);
    return copie;
  }

  function objetCoordonnees(source, cles) {
    var entree = (source && typeof source === 'object') ? source : {};
    var sortie = {};
    cles.forEach(function (cle) {
      var max = cle === 'adresse' ? 400 : (cle === 'logo' ? 2000000 : 120);
      var valeur = chaineSure(entree[cle], max);
      if (cle === 'logo' && valeur && valeur.indexOf('data:image/') !== 0) valeur = '';
      sortie[cle] = valeur;
    });
    return sortie;
  }

  function aujourdhuiIso() {
    var d = new Date();
    var pad = function (n) { return String(n).length < 2 ? '0' + n : String(n); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /** Crée ou met à jour un document. Retourne le document enregistré. */
  function enregistrerDocument(doc) {
    var propre = normaliserDocument(doc);
    return transaction([STORE_DOCUMENTS], 'readwrite').then(function (tx) {
      return new Promise(function (resoudre, rejeter) {
        var store = tx.objectStore(STORE_DOCUMENTS);
        var req = store.put(propre);
        req.onsuccess = function () { resoudre(propre); };
        req.onerror = function (e) { rejeter(erreurStockage(e, 'enregistrement')); };
        tx.onabort = function (e) { rejeter(erreurStockage(e, 'enregistrement')); };
      });
    });
  }

  function obtenirDocument(id) {
    return requeter(STORE_DOCUMENTS, 'readonly', function (store) { return store.get(id); });
  }

  function listerDocuments() {
    return requeter(STORE_DOCUMENTS, 'readonly', function (store) { return store.getAll(); });
  }

  /** Liste filtrée côté IndexedDB par index (type ou statut). */
  function listerParIndex(index, valeur) {
    return requeter(STORE_DOCUMENTS, 'readonly', function (store) {
      if (!store.indexNames.contains(index)) return store.getAll();
      return store.index(index).getAll(valeur);
    });
  }

  function supprimerDocument(id) {
    return requeter(STORE_DOCUMENTS, 'readwrite', function (store) { return store.delete(id); });
  }

  function viderDocuments() {
    return requeter(STORE_DOCUMENTS, 'readwrite', function (store) { return store.clear(); });
  }

  function compterDocuments() {
    return requeter(STORE_DOCUMENTS, 'readonly', function (store) { return store.count(); });
  }

  /* ----------------------------------------------------------- métadonnées */
  function lireMeta(cle) {
    return requeter(STORE_META, 'readonly', function (store) { return store.get(cle); })
      .then(function (r) { return r ? r.valeur : null; });
  }

  function ecrireMeta(cle, valeur) {
    return requeter(STORE_META, 'readwrite', function (store) { return store.put({ cle: cle, valeur: valeur }); })
      .then(function () { return valeur; });
  }

  function supprimerMeta(cle) {
    return requeter(STORE_META, 'readwrite', function (store) { return store.delete(cle); });
  }

  /* --------------------------------------------------------- numérotation */
  function cleCompteur(prefixe, portee) {
    return prefixe + '|' + (portee || '-');
  }

  function porteeSelon(reglage, dateIso) {
    var d = String(dateIso || '').slice(0, 10);
    var annee = d.slice(0, 4) || String(new Date().getFullYear());
    if (reglage === 'annuel') return annee;
    if (reglage === 'mensuel') return annee + '-' + (d.slice(5, 7) || '01');
    return '';
  }

  function formaterNumero(modele, tokens) {
    var sortie = String(modele || '{PREFIX}-{AAAA}-{SEQ4}');
    sortie = sortie.replace(/\{SEQ(\d+)\}/g, function (_, n) {
      var l = parseInt(n, 10);
      return String(tokens.SEQ).padStart(l, '0');
    });
    var map = {
      '{SEQ}': String(tokens.SEQ),
      '{PREFIX}': tokens.PREFIX,
      '{AAAA}': tokens.AAAA,
      '{AA}': tokens.AAAA.slice(2),
      '{MM}': tokens.MM,
      '{JJ}': tokens.JJ,
      '{TYPE}': tokens.TYPE.toUpperCase()
    };
    Object.keys(map).forEach(function (k) {
      sortie = sortie.split(k).join(map[k]);
    });
    return sortie;
  }

  /**
   * Lit le prochain numéro SANS le consommer (utilisé pour l'aperçu).
   */
  function prochainNumero(type, reglages, dateIso) {
    var r = reglages || {};
    var num = (r.numerotation || {});
    var prefixe = type === 'recu' ? (num.prefixeRecu || 'R') : (num.prefixeFacture || 'F');
    var portee = porteeSelon(num.remiseAZero, dateIso);
    var cle = cleCompteur(prefixe, portee);
    var d = String(dateIso || AGORA.calculs.aujourdhui()).slice(0, 10);
    var annee = d.slice(0, 4);
    return requeter(STORE_COMPTEURS, 'readonly', function (store) { return store.get(cle); })
      .then(function (enreg) {
        var suivant = Math.max((enreg ? enreg.valeur : 0) + 1, num.depart || 1);
        return formaterNumero(num.modele, {
          SEQ: suivant,
          PREFIX: prefixe,
          AAAA: annee,
          MM: d.slice(5, 7),
          JJ: d.slice(8, 10),
          TYPE: type
        });
      });
  }

  /**
   * Réserve un numéro unique de façon atomique (transaction readwrite).
   * Un numéro déjà attribué n'est JAMAIS réattribué, même après suppression.
   */
  function reserverNumero(type, reglages, dateIso) {
    var r = reglages || {};
    var num = (r.numerotation || {});
    var prefixe = type === 'recu' ? (num.prefixeRecu || 'R') : (num.prefixeFacture || 'F');
    var portee = porteeSelon(num.remiseAZero, dateIso);
    var cle = cleCompteur(prefixe, portee);
    var d = String(dateIso || AGORA.calculs.aujourdhui()).slice(0, 10);

    return transaction([STORE_COMPTEURS], 'readwrite').then(function (tx) {
      return new Promise(function (resoudre, rejeter) {
        var store = tx.objectStore(STORE_COMPTEURS);
        var req = store.get(cle);
        req.onsuccess = function () {
          var valeur = (req.result ? req.result.valeur : 0) + 1;
          if (valeur < (num.depart || 1)) valeur = num.depart || 1;
          store.put({ cle: cle, valeur: valeur, prefixe: prefixe, portee: portee });
          resoudre(formaterNumero(num.modele, {
            SEQ: valeur,
            PREFIX: prefixe,
            AAAA: d.slice(0, 4),
            MM: d.slice(5, 7),
            JJ: d.slice(8, 10),
            TYPE: type
          }));
        };
        req.onerror = function (e) { rejeter(erreurStockage(e, 'numérotation')); };
        tx.onabort = function (e) { rejeter(erreurStockage(e, 'numérotation')); };
      });
    });
  }

  /** Extrait le numéro de séquence d'un numéro existant (dernier groupe de chiffres). */
  function extraireSequence(numero) {
    var m = /(\d+)(?!.*\d)/.exec(String(numero || ''));
    return m ? parseInt(m[1], 10) : 0;
  }

  /**
   * Recalcule les compteurs à partir des documents existants
   * (indispensable après une restauration de sauvegarde).
   */
  function synchroniserCompteurs(reglages, documents) {
    var r = reglages || {};
    var num = (r.numerotation || {});
    var map = {};
    var docs = documents || [];
    docs.forEach(function (doc) {
      var prefixe = doc.type === 'recu' ? (num.prefixeRecu || 'R') : (num.prefixeFacture || 'F');
      var portee = porteeSelon(num.remiseAZero, doc.dateEmission);
      var cle = cleCompteur(prefixe, portee);
      var seq = extraireSequence(doc.numero);
      if (!map[cle] || seq > map[cle]) map[cle] = seq;
    });
    var cles = Object.keys(map);
    if (!cles.length) return Promise.resolve(0);
    return transaction([STORE_COMPTEURS], 'readwrite').then(function (tx) {
      return new Promise(function (resoudre, rejeter) {
        var store = tx.objectStore(STORE_COMPTEURS);
        cles.forEach(function (cle) {
          var get = store.get(cle);
          get.onsuccess = function () {
            var actuel = get.result ? get.result.valeur : 0;
            if (map[cle] > actuel) {
              store.put({ cle: cle, valeur: map[cle], prefixe: cle.split('|')[0], portee: cle.split('|')[1] });
            }
          };
        });
        tx.oncomplete = function () { resoudre(cles.length); };
        tx.onerror = function (e) { rejeter(erreurStockage(e, 'compteurs')); };
      });
    });
  }

  function listerCompteurs() {
    return requeter(STORE_COMPTEURS, 'readonly', function (store) { return store.getAll(); });
  }

  function reinitialiserCompteur(cle, valeur) {
    if (!cle) return Promise.resolve(null);
    return requeter(STORE_COMPTEURS, 'readwrite', function (store) {
      return store.put({ cle: cle, valeur: valeur || 0, prefixe: cle.split('|')[0], portee: cle.split('|')[1] });
    });
  }

  /* -------------------------------------------------------- préférences */
  function lireReglagesBruts() {
    try {
      var brut = global.localStorage.getItem(CLE_REGLEGES);
      return brut ? JSON.parse(brut) : null;
    } catch (e) {
      return null;
    }
  }

  function ecrireReglagesBruts(objet) {
    try {
      global.localStorage.setItem(CLE_REGLEGES, JSON.stringify(objet));
      return true;
    } catch (e) {
      throw new Error('Impossible d\'enregistrer les préférences (' + (e && e.name ? e.name : 'erreur') + '). Le stockage est peut-être plein.');
    }
  }

  function supprimerReglages() {
    try { global.localStorage.removeItem(CLE_REGLEGES); } catch (e) { /* silencieux */ }
  }

  /* ------------------------------------------------------ export / import */
  var FORMAT_EXPORT = 'agora-factures-sauvegarde';
  var VERSION_EXPORT = 1;

  function exporterDonnees() {
    return Promise.all([
      listerDocuments(),
      listerCompteurs(),
      lireMeta('logo'),
      Promise.resolve(lireReglagesBruts())
    ]).then(function (resultats) {
      return {
        format: FORMAT_EXPORT,
        version: VERSION_EXPORT,
        exporteLe: new Date().toISOString(),
        application: 'Agora Factures',
        documents: resultats[0] || [],
        compteurs: resultats[1] || [],
        logo: resultats[2] || null,
        reglages: resultats[3] || null
      };
    });
  }

  /**
   * Contrôle et restaure une sauvegarde.
   * @param {Object} donnees objet parsé depuis le fichier JSON
   * @param {Object} options {mode: 'remplacer'|'fusionner'}
   */
  function importerDonnees(donnees, options) {
    options = options || {};
    var mode = options.mode === 'fusionner' ? 'fusionner' : 'remplacer';
    if (!donnees || typeof donnees !== 'object' || Array.isArray(donnees)) {
      throw new Error('Fichier illisible : un objet JSON était attendu.');
    }
    if (donnees.format && donnees.format !== FORMAT_EXPORT) {
      throw new Error('Ce fichier n\'est pas une sauvegarde Agora Factures (format « ' + donnees.format + ' »).');
    }
    if (!Array.isArray(donnees.documents)) throw new Error('Sauvegarde invalide : la liste « documents » est absente.');

    var refuses = 0;
    var documents = [];
    donnees.documents.forEach(function (d) {
      var propre = assainirDocumentImporte(d);
      if (propre) documents.push(propre);
      else refuses++;
    });
    if (!documents.length) {
      throw new Error('Sauvegarde inutilisable : aucun document valide (vérifiez le format du fichier).');
    }

    return ouvrir().then(function (db) {
      return new Promise(function (resoudre, rejeter) {
        var tx = db.transaction([STORE_DOCUMENTS, STORE_COMPTEURS, STORE_META], 'readwrite');
        var store = tx.objectStore(STORE_DOCUMENTS);
        var compteurs = tx.objectStore(STORE_COMPTEURS);
        var meta = tx.objectStore(STORE_META);
        var compteur = { ajoutes: 0, remplaces: 0, ignores: 0, refuses: refuses };

        tx.oncomplete = function () { resoudre(compteur); };
        tx.onerror = function (e) { rejeter(erreurStockage(e, 'import')); };
        tx.onabort = function (e) { rejeter(erreurStockage(e, 'import')); };

        if (mode === 'remplacer') {
          store.clear();
          compteurs.clear();
        }

        documents.forEach(function (doc) {
          var reqGet = store.get(doc.id);
          reqGet.onsuccess = function () {
            var existe = !!reqGet.result;
            if (existe && mode === 'fusionner') {
              compteur.ignores++;
              return;
            }
            store.put(doc);
            if (existe) compteur.remplaces++; else compteur.ajoutes++;
          };
        });

        if (mode === 'remplacer' && Array.isArray(donnees.compteurs)) {
          donnees.compteurs.forEach(function (c) {
            if (!c || typeof c !== 'object' || typeof c.cle !== 'string' || !c.cle) return;
            var valeurEntiere = Math.max(0, parseInt(c.valeur, 10));
            compteurs.put({
              cle: c.cle.slice(0, 80),
              valeur: isFinite(valeurEntiere) ? valeurEntiere : 0,
              prefixe: String(c.cle).split('|')[0],
              portee: String(c.cle).split('|')[1] || ''
            });
          });
        }
        // Le logo n'est accepté qu'en image embarquée (data URL) : aucune
        // référence distante n'est stockée ni chargée.
        if (typeof donnees.logo === 'string' && donnees.logo.indexOf('data:image/') === 0 &&
          donnees.logo.length <= 2 * 1024 * 1024) {
          meta.put({ cle: 'logo', valeur: donnees.logo });
        }
        if (donnees.reglages && typeof donnees.reglages === 'object' && mode === 'remplacer') {
          try { ecrireReglagesBruts(donnees.reglages); } catch (e) { /* non bloquant */ }
        }
      });
    }).then(function (compteur) {
      var reglages = (AGORA.parametres && AGORA.parametres.lire) ? AGORA.parametres.lire() : null;
      return listerDocuments().then(function (docs) {
        return synchroniserCompteurs(reglages, docs).then(function () { return compteur; });
      });
    });
  }

  /** Efface TOUTES les données locales (documents, compteurs, métadonnées, préférences). */
  function effacerTout() {
    return ouvrir().then(function (db) {
      return new Promise(function (resoudre, rejeter) {
        var tx = db.transaction([STORE_DOCUMENTS, STORE_COMPTEURS, STORE_META], 'readwrite');
        tx.objectStore(STORE_DOCUMENTS).clear();
        tx.objectStore(STORE_COMPTEURS).clear();
        tx.objectStore(STORE_META).clear();
        tx.oncomplete = function () { supprimerReglages(); resoudre(true); };
        tx.onerror = function (e) { rejeter(erreurStockage(e, 'effacement')); };
        tx.onabort = function (e) { rejeter(erreurStockage(e, 'effacement')); };
      });
    });
  }

  /** Estimation de l'occupation (peut être indisponible selon les navigateurs). */
  function estimationEspace() {
    if (global.navigator && navigator.storage && navigator.storage.estimate) {
      return navigator.storage.estimate().then(function (e) {
        return { usage: e.usage || 0, quota: e.quota || 0 };
      }).catch(function () { return null; });
    }
    return Promise.resolve(null);
  }

  /** Demande (si disponible) un stockage persistant, moins susceptible d'être purgé. */
  function demanderPersistance() {
    if (global.navigator && navigator.storage && navigator.storage.persist) {
      return navigator.storage.persist().catch(function () { return false; });
    }
    return Promise.resolve(false);
  }

  AGORA.stockage = {
    NOM_DB: NOM_DB,
    VERSION_DB: VERSION_DB,
    STORE_DOCUMENTS: STORE_DOCUMENTS,
    CLE_REGLEGES: CLE_REGLEGES,
    FORMAT_EXPORT: FORMAT_EXPORT,
    VERSION_EXPORT: VERSION_EXPORT,
    disponible: disponible,
    ouvrir: ouvrir,
    identifiant: identifiant,
    normaliserDocument: normaliserDocument,
    assainirDocumentImporte: assainirDocumentImporte,
    enregistrerDocument: enregistrerDocument,
    obtenirDocument: obtenirDocument,
    listerDocuments: listerDocuments,
    listerParIndex: listerParIndex,
    supprimerDocument: supprimerDocument,
    viderDocuments: viderDocuments,
    compterDocuments: compterDocuments,
    lireMeta: lireMeta,
    ecrireMeta: ecrireMeta,
    supprimerMeta: supprimerMeta,
    prochainNumero: prochainNumero,
    reserverNumero: reserverNumero,
    synchroniserCompteurs: synchroniserCompteurs,
    listerCompteurs: listerCompteurs,
    reinitialiserCompteur: reinitialiserCompteur,
    extraireSequence: extraireSequence,
    porteeSelon: porteeSelon,
    cleCompteur: cleCompteur,
    formaterNumero: formaterNumero,
    lireReglagesBruts: lireReglagesBruts,
    ecrireReglagesBruts: ecrireReglagesBruts,
    supprimerReglages: supprimerReglages,
    exporterDonnees: exporterDonnees,
    importerDonnees: importerDonnees,
    effacerTout: effacerTout,
    estimationEspace: estimationEspace,
    demanderPersistance: demanderPersistance
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = AGORA.stockage;

})(typeof globalThis !== 'undefined' ? globalThis : this);
