# Agora Factures

Application web progressive (PWA) de facturation et de gestion de reçus, **100 % locale** :
HTML5, CSS3, JavaScript natif, IndexedDB, Service Worker. Aucun backend, aucun compte, aucune
donnée envoyée sur un serveur. Après le premier chargement, l'application fonctionne **hors
connexion** et peut être **installée** comme une application native.

---

## Sommaire

1. [Fonctionnalités](#1-fonctionnalités)
2. [Lancer le projet en local](#2-lancer-le-projet-en-local)
3. [Architecture technique](#3-architecture-technique)
4. [Structure des fichiers](#4-structure-des-fichiers)
5. [Parcours utilisateur](#5-parcours-utilisateur)
6. [Structure des données](#6-structure-des-données)
7. [Interfaces entre modules](#7-interfaces-entre-modules)
8. [Règles métier : calculs, arrondis, statuts, numérotation](#8-règles-métier--calculs-arrondis-statuts-numérotation)
9. [Fonctionnement hors ligne et installation](#9-fonctionnement-hors-ligne-et-installation)
10. [Impression et export PDF](#10-impression-et-export-pdf)
11. [Sauvegarde, restauration et limites du stockage local](#11-sauvegarde-restauration-et-limites-du-stockage-local)
12. [Déploiement en HTTPS](#12-déploiement-en-https)
13. [Tests](#13-tests)
14. [Sécurité et confidentialité](#14-sécurité-et-confidentialité)
15. [Risques techniques traités et limites connues](#15-risques-techniques-traités-et-limites-connues)

---

## 1. Fonctionnalités

**Documents** — facture ou reçu, avec vendeur (nom, adresse, téléphone, e-mail, identifiant
fiscal, logo), client, numérotation automatique unique, date d'émission, échéance facultative,
devise configurable (XOF par défaut), notes et conditions.

**Lignes d'articles** — désignation, quantité, prix unitaire, remise, TVA par ligne. Ajout et
suppression de lignes, remise globale (pourcentage ou montant), TVA activable/désactivable et
configurable (prix saisis HT ou TTC). Aperçu A4 actualisé en temps réel.

**Actions** — enregistrer comme brouillon, enregistrer/émettre le document, prévisualiser,
imprimer, télécharger en PDF, dupliquer, modifier un brouillon, annuler un document émis,
supprimer un brouillon.

**Paiements** — enregistrement de paiements (espèces, virement, chèque, mobile money, carte,
autre) avec date, référence et historique. Paiements partiels, solde restant, statut dérivé des
montants encaissés. Un **reçu correspond obligatoirement à un paiement enregistré**.

**Historique** — recherche (numéro ou client), filtres (période, type, statut), tri (date,
montant, client, numéro), consultation, impression, PDF, duplication, suppression des brouillons
et des documents annulés, annulation des documents émis. Toute action destructive demande une
confirmation.

**Tableau de bord** — chiffre d'affaires encaissé, montant facturé, reste à encaisser, nombre de
documents, payés, impayés, en retard, annulés, graphique d'évolution, répartition des statuts,
derniers documents. État vide invitant à créer un premier document.

**Paramètres** — profil vendeur, logo, devise, décimales, numérotation (préfixes, modèle à
jetons, remise à zéro, premier numéro), TVA, remises, modèle par défaut, options d'impression,
préférences de stockage, export/restauration de sauvegarde, effacement total, informations sur
l'application.

---

## 2. Lancer le projet en local

Le Service Worker exige un contexte sécurisé : `https://` **ou** `http://localhost`.

```bash
# 1. Cloner le dépôt
git clone https://github.com/Adjaho-Samson/AGORA.git
cd AGORA

# 2. Servir le dossier (au choix)
python3 -m http.server 8080          # ou : npx serve .    ou : php -S localhost:8080

# 3. Ouvrir
#    http://localhost:8080/index.html
```

Aucune étape de compilation n'est nécessaire : il n'y a ni bundler ni dépendance à installer pour
utiliser l'application. `npm install` sert **uniquement** à exécuter les tests automatisés
(jsdom, fake-indexeddb).

> Ouvrir `index.html` directement en `file://` affiche l'application, mais le Service Worker (donc
> le mode hors ligne et l'installation) ne sera pas disponible : un avertissement s'affiche.

---

## 3. Architecture technique

| Choix | Détail |
|---|---|
| Rendu | Pages HTML statiques multi-pages (pas de framework) |
| Logique | JavaScript natif (ES5+ compatible navigateurs modernes), modules IIFE exposés via l'espace de noms `window.AGORA` |
| Données | **IndexedDB** : documents, compteurs de numérotation, logo. **localStorage** : réglages simples |
| Hors ligne | Service Worker : précache de l'app shell, cache-first, navigations network-first avec repli |
| Installation | `manifest.json` + icônes PNG (192, 512, maskable, apple-touch, favicons) |
| PDF | jsPDF 2.5.2 servie **localement** depuis `lib/` (aucun CDN) |
| Polices | Pile de polices système : aucune police distante, donc rien à mettre en cache |
| Impression | Feuille `css/print.css` dédiée + clonage du document dans `#zone-impression` |

**Pourquoi des modules IIFE plutôt qu'une SPA ?** L'application reste utilisable même si un
module échoue, les pages sont directement partageables/mettables en cache, et le code reste
auditable sans outillage.

**Découplage des responsabilités** — `calculs.js` ne connaît pas le DOM, `stockage.js` ne connaît
pas l'interface, `documents.js` ne fait que du rendu : chaque module est testable isolément.

---

## 4. Structure des fichiers

```
agora-factures/
├── index.html                 # Accueil
├── manifest.json              # Manifeste PWA
├── sw.js                      # Service Worker (précache + stratégies)
├── README.md
├── package.json               # Scripts de test uniquement
├── pages/
│   ├── dashboard.html         # Tableau de bord
│   ├── facture.html           # Création / édition d'un document
│   ├── historique.html        # Historique, filtres, actions
│   └── parametres.html        # Paramètres, sauvegarde, à propos
├── css/
│   ├── global.css             # Thème, mise en page, composants
│   ├── document.css           # Rendu A4 des 3 modèles + zone d'aperçu
│   ├── print.css              # Feuille d'impression dédiée
│   ├── dashboard.css          # Indicateurs, graphiques, répartition
│   ├── facture.css            # Éditeur et tableau de lignes
│   ├── historique.css         # Filtres et liste
│   └── parametres.css         # Sections de paramètres
├── js/
│   ├── app.js                 # Socle : DOM, modales, notifications, impression, icônes
│   ├── calculs.js             # Moteur de calcul (montants, remises, TVA, arrondis)
│   ├── stockage.js            # IndexedDB + localStorage : CRUD, numérotation, export/import
│   ├── parametres.js          # Réglages (validation, persistance) + page Paramètres
│   ├── documents.js           # Création, duplication et rendu HTML des documents
│   ├── factures.js            # Éditeur de document
│   ├── historique.js          # Liste, filtres, paiements, annulation, suppression
│   ├── dashboard.js           # Statistiques et graphiques SVG
│   ├── pdf.js                 # Export PDF (jsPDF)
│   └── pwa.js                 # Service Worker, état réseau, installation
├── lib/
│   └── jspdf.umd.min.js       # Bibliothèque PDF locale (MIT)
├── assets/
│   ├── icons/                 # icon-192/512, maskable, apple-touch, favicons (+ sources SVG)
│   └── images/logo-default.svg
├── tools/
│   └── generer-icones.py      # Génération des icônes PNG (sans dépendance)
├── tests/                     # Suite de tests automatisés (voir §13)
└── .github/workflows/pages.yml# Déploiement GitHub Pages
```

---

## 5. Parcours utilisateur

```
Accueil
  ├── « Créer une facture » / « Créer un reçu » ──► Éditeur
  │        saisie vendeur / client / lignes / TVA
  │        aperçu A4 en temps réel
  │        ├── Brouillon  ──► numéro attribué, modifiable plus tard
  │        ├── Émettre    ──► statut « En attente » (reçu : paiement obligatoire)
  │        ├── Imprimer / PDF
  │        └── (document enregistré) Enregistrer un paiement / Marquer payée / Annuler
  ├── « Consulter l'historique » ──► recherche, filtres, tri, actions
  ├── « Tableau de bord » ──► indicateurs, évolution, répartition, derniers documents
  └── « Configurer le profil vendeur » ──► Paramètres (profil, devise, numérotation, TVA,
                                            modèle, impression, sauvegarde)
```

---

## 6. Structure des données

### Document (store IndexedDB `documents`, clé `id`)

```js
{
  id: 'doc_m3k9x2_ab12cd',           // identifiant unique
  type: 'facture' | 'recu',
  numero: 'F-2026-0042',             // null tant que le document n'est pas enregistré
  statut: 'brouillon' | 'en_attente' | 'payee' | 'partielle' | 'annulee',
  dateEmission: '2026-10-15',        // AAAA-MM-JJ
  dateEcheance: '2026-11-14' | null,
  devise: 'XOF',
  tvaActive: true,
  tvaMode: 'exclusive' | 'inclusive',
  modeRemise: 'pourcent' | 'montant',
  modele: 'classique' | 'moderne' | 'minimal',
  remiseGlobale: { type: 'pourcent' | 'montant', valeur: 0 },
  vendeur: { nom, adresse, telephone, email, fiscal, logo },
  client:  { nom, telephone, adresse, email },
  lignes: [{ id, designation, quantite, prixUnitaire, remise, tauxTva }],
  paiements: [{ id, date, montant, methode, reference }],
  notes: '', conditions: '',
  montants: { ... },                 // cache recalculé à chaque ouverture (jamais source de vérité)
  createdAt, updatedAt,
  annuleeLe, motifAnnulation
}
```

Index secondaires : `numero`, `type`, `statut`, `dateEmission`, `clientNom`, `updatedAt`.

### Autres stores

* `compteurs` — `{ cle: 'F|2026', valeur: 42 }` : un compteur par préfixe et par portée
  (jamais / année / mois). Un numéro attribué n'est **jamais** réattribué.
* `meta` — `{ cle: 'logo', valeur: 'data:image/png;base64,…' }`.

### Préférences (localStorage, clé `agora.reglages.v1`)

Profil vendeur, devise, décimales, numérotation, TVA, mode de remise, modèle par défaut,
options d'impression, préférences de stockage. Toutes les valeurs sont assainies à la lecture
(plafonnement, typage, liste fermée pour les énumérations).

### Fichier de sauvegarde

```json
{ "format": "agora-factures-sauvegarde", "version": 1, "exporteLe": "…",
  "documents": [ … ], "compteurs": [ … ], "logo": "data:image/png;base64,…", "reglages": { … } }
```

---

## 7. Interfaces entre modules

| Module | Expose | Dépend de |
|---|---|---|
| `AGORA.app` | `$(), $$(), creer(), echapper(), icone(), notifier(), ouvrirModale(), confirmer(), imprimerElement(), telecharger(), lireFichierTexte(), lireFichierImage(), champErreur()` | — |
| `AGORA.calculs` | `calculerLigne(), calculerDocument(), arrondir(), versCentimes(), statutEffectif(), statutSelonPaiement(), formaterMontant(), formaterDate(), montantEnLettres()` | — (aucun DOM) |
| `AGORA.stockage` | `enregistrerDocument(), obtenirDocument(), listerDocuments(), supprimerDocument(), reserverNumero(), prochainNumero(), exporterDonnees(), importerDonnees(), effacerTout(), lireMeta/ecrireMeta()` | `calculs` |
| `AGORA.parametres` | `lire(), enregistrer(), reinitialiser(), assainir(), logo(), definirLogo(), formaterMontant()` | `stockage`, `calculs` |
| `AGORA.documents` | `creerVide(), montants(), rendreHtml(), dupliquer(), ajusterEchelle()` | `calculs`, `parametres` |
| `AGORA.factures` | `etat`, `enregistrer()` | tous |
| `AGORA.historique` | `rafraichir(), appliquerFiltres(), actions.{voir, imprimer, exporterPdf, payer, marquerPayee, annuler, supprimer}` | `documents`, `stockage`, `pdf` |
| `AGORA.dashboard` | `charger(), calculerStats(), bornesPeriode()` | `documents`, `historique.actions` |
| `AGORA.pdf` | `generer(), telechargerPdf()` | `documents`, `parametres`, jsPDF |
| `AGORA.pwa` | `enregistrer(), appliquerMiseAJour(), majIndicateur()` | `app` |

Règle : les montants affichés viennent **toujours** de `AGORA.documents.montants(doc)`, qui
appelle `AGORA.calculs.calculerDocument(doc)`. Aucun écran ne calcule un total lui-même.

---

## 8. Règles métier : calculs, arrondis, statuts, numérotation

### Arrondi

Tous les calculs sont faits en **centièmes entiers** (pas de flottant). L'arrondi est
*half-up vers l'infini* (`0,005 → 0,01`, `-0,005 → -0,01`), appliqué une seule fois par opération
monétaire. Les totaux sont la **somme des lignes déjà arrondies** : le total affiché correspond
donc exactement à la somme des montants de lignes affichés.

### Enchaînement des calculs

1. `brut = quantité × prix unitaire`
2. `remise ligne` = pourcentage (0–100) ou montant (plafonné au brut)
3. `net = brut − remise`
4. remise globale : appliquée au net cumulé, puis **répartie au prorata** sur chaque ligne
5. TVA par ligne : `TVA = base × taux` (HT) ou `base = TTC / (1 + taux)` (TTC)
6. `total = Σ bases + Σ TVA`, `solde = total − Σ paiements`

### Statuts

| Statut | Règle |
|---|---|
| `brouillon` | enregistré sans être émis ; modifiable et supprimable |
| `en_attente` | émis, aucun paiement |
| `partielle` | 0 < montant payé < total |
| `payee` | montant payé ≥ total (action explicite ou paiement enregistré) |
| `en_retard` | **déduit** de l'échéance dépassée (jamais stocké : toujours exact) |
| `annulee` | action explicite ; exclu des montants encaissés et facturés |

Règles d'annulation : un document **qui comporte des paiements ne peut pas être annulé**
(il faut d'abord retirer les paiements) ; un brouillon se supprime, il ne s'annule pas.

### Numérotation

Modèle à jetons : `{PREFIX} {TYPE} {AAAA} {AA} {MM} {JJ} {SEQ} {SEQ4} {SEQ5}`
(ex. `{PREFIX}-{AAAA}-{SEQ4}` → `F-2026-0042`). Le compteur est incrémenté dans une transaction
`readwrite` dédiée : deux documents ne peuvent pas recevoir le même numéro. Une remise à zéro
annuelle ou mensuelle crée un compteur distinct. Après une restauration, les compteurs sont
recalculés à partir des documents existants (`synchroniserCompteurs`).

---

## 9. Fonctionnement hors ligne et installation

Le Service Worker précache à l'installation : les 5 pages HTML, les 7 feuilles CSS, les 10 modules
JavaScript, la bibliothèque PDF, les icônes et le manifeste. Stratégies :

* **app shell / ressources locales** : cache d'abord, puis réseau (avec mise en cache à la volée) ;
* **navigations** : réseau d'abord, repli sur le cache, puis sur la page d'accueil ;
* **mise à jour** : nouvelle version détectée → notification « Une nouvelle version est
  disponible » + bouton « Mettre à jour ». Les données utilisateur (IndexedDB, localStorage) ne
  sont **pas** dans le cache : une mise à jour ne supprime aucune facture.

Sont disponibles hors ligne : création et calcul des documents, aperçu, sauvegarde, consultation
et recherche dans l'historique, modification des brouillons, impression et export PDF (toutes les
dépendances étant locales).

L'installation est proposée via le bouton « Installer l'application » dès que le navigateur
émet `beforeinstallprompt`. Si le navigateur ne la prend pas en charge, un message l'indique
clairement (et rappelle la commande « Ajouter à l'écran d'accueil »). Un indicateur
« En ligne / Hors ligne » est affiché en permanence dans l'en-tête.

---

## 10. Impression et export PDF

* **Impression** : `css/print.css` définit `@page { size: A4 portrait; margin: 12mm }`, masque
  l'interface (en-tête, navigation, boutons, filtres, modales) et n'imprime que le document
  cloné dans `#zone-impression`. Le modèle « Minimaliste » est optimisé pour une impression
  économique (noir et blanc, compact) ; les reçus utilisent une mise en page courte.
* **PDF** : `js/pdf.js` dessine un PDF A4 vectoriel avec jsPDF (texte net, sélectionnable) :
  en-tête vendeur + logo, bloc client, tableau des lignes, totaux, historique des paiements,
  notes, signatures optionnelles, pied de page. Les espaces insécables fines produites par
  `Intl` sont normalisées (les polices PDF standard ne les connaissent pas).
* Si la bibliothèque PDF n'est pas disponible, un message invite à utiliser « Imprimer »
  puis « Enregistrer au format PDF ».

---

## 11. Sauvegarde, restauration et limites du stockage local

* **Export** : `Paramètres → Exporter` produit `agora-factures-sauvegarde-AAAA-MM-JJ.json`
  (documents, compteurs, logo, réglages).
* **Restauration** : le fichier est analysé et validé (format, type, structure) avant import ;
  deux modes sont proposés — *Fusionner* (conserve l'existant, ignore les doublons d'identifiant)
  et *Remplacer* (efface tout avant l'import, avec confirmation explicite).
* **Effacement total** : irréversible, protégé par la saisie du mot `EFFACER`.
* **Limites assumées** : le stockage local n'est **pas chiffré** et peut être supprimé par le
  navigateur (nettoyage des données, mode privé, espace disque faible, désinstallation de
  l'application). L'application le rappelle et propose un rappel de sauvegarde paramétrable
  ainsi que la demande de *stockage persistant* quand le navigateur la gère.

---

## 12. Déploiement en HTTPS

### GitHub Pages (inclus)

Le workflow `.github/workflows/pages.yml` publie le contenu du dépôt sur GitHub Pages à chaque
push sur la branche principale.

1. Déposer le code sur la branche `main`.
2. `Settings → Pages → Build and deployment → Source : GitHub Actions`.
3. Le site est servi en HTTPS sur `https://<utilisateur>.github.io/AGORA/`.

L'application gère automatiquement le chemin de base : tous les liens, scripts et précaches sont
relatifs, elle fonctionne donc aussi bien à la racine d'un domaine que dans un sous-dossier.

### Autre hébergeur statique (Netlify, Cloudflare Pages, Vercel, OVH…)

```bash
# Aucun build : publier le contenu du dossier tel quel
netlify deploy --dir . --prod     # exemple Netlify
```

Vérifier que l'hébergement sert bien les fichiers en HTTPS et respecte les types MIME
(`.js` → `application/javascript`, `.json` → `application/json`, `.webmanifest`/`.json` pour le
manifeste).

### Mise à jour après déploiement

Le Service Worker détecte la nouvelle version et affiche une notification. Un changement de
`VERSION` dans `sw.js` suffit à forcer un nouveau cache.

---

## 13. Tests

```bash
npm install     # jsdom + fake-indexeddb (tests uniquement)
npm test        # les 10 suites automatisées
```

| Suite | Portée | Résultat |
|---|---|---|
| `tests/calculs.test.mjs` | Arrondis, lignes, remises, TVA (HT/TTC), remises globales, multi-taux, paiements, statuts, formatage | **35 / 35** |
| `tests/stockage.test.mjs` | CRUD IndexedDB, index, numérotation unique et non-réattribution, compteurs, export/import (remplacer, fusionner, rejet), effacement, logo, réglages | **25 / 25** |
| `tests/pdf.test.mjs` | PDF A4 valide, 3 modèles, reçu court, accents et montants dans le PDF, pagination, logo invalide, signatures | **9 / 9** |
| `tests/ressources.test.mjs` | Structure, références entre fichiers, manifeste, précache du SW, contrats DOM, absence d'`eval`, absence d'appel réseau | **146 / 146** |
| `tests/pages.test.mjs` | Chargement réel des 5 pages (jsdom), saisie et recalcul, validation, enregistrement, réouverture d'un brouillon, duplication, reçu = paiement obligatoire, impression, historique (recherche, filtres, tri, paiement partiel, aperçu, confirmation), tableau de bord (périodes, annulés exclus), paramètres | **30 / 30** |
| `tests/apercu.test.mjs` | Mise à l'échelle A4 dynamique, facteur d'échelle adaptatif (plancher à 20 %), calcul dynamique de la hauteur d'en-tête collante, isolation du débordement | **11 / 11** |
| `tests/sw.test.mjs` | Service Worker, précache hors ligne, stratégie stale-while-revalidate / cache-first, activation immédiate, mise à jour | **12 / 12** |
| `tests/pwa.test.mjs` | Détection contexte HTTPS/localhost, badge hors ligne accessible, installation, rejet HTTP non sécurisé | **10 / 10** |
| `tests/responsive.test.mjs` | Viewports (320, 360, 390, 768, 1024, 1440 px), safe areas iOS/Android, cibles tactiles >= 44 px, tableau d'articles responsive en cartes, contraintes d'icônes, débordements nuls | **37 / 37** |
| `tests/accessibilite.test.mjs` | WCAG 2.1 AA (contrastes >= 4.5:1 sur blanc et gris, statuts >= 3:1), sémantique, labels, piégeage de focus dans les modales | **62 / 62** |

**Total : 382 assertions, 0 échec.**

Vérifications manuelles à effectuer dans un navigateur (non automatisables ici) :
rendu d'impression réel (aperçu avant impression), installation PWA (Chrome/Edge/Android),
bascule effective en mode avion après le premier chargement, génération d'un PDF avec logo.

---

## 14. Sécurité et confidentialité

* Aucun `eval()`, aucune exécution de code dynamique.
* Le contenu saisi par l'utilisateur est inséré via `textContent`/`createTextNode` : pas
  d'injection HTML dans les aperçus, l'historique ou les modales.
* Tous les formulaires sont validés (types, bornes, e-mails, dates, cohérence échéance / émission).
* Les fichiers importés sont contrôlés (JSON valide, format attendu, structure, taille ≤ 20 Mo,
  images limitées à 3 Mo et redimensionnées localement).
* Aucune requête vers un serveur, aucun secret, aucune télémétrie, aucune dépendance externe à
  l'exécution.
* Actions destructives systématiquement confirmées ; effacement global protégé par une saisie.
* Le stockage local n'est **pas** présenté comme chiffré.

---

## 15. Risques techniques traités et limites connues

| Risque | Traitement |
|---|---|
| Erreurs d'arrondi / totaux incohérents | calculs en centièmes entiers, somme de lignes arrondies, tests dédiés |
| Numéro attribué deux fois | compteur incrémenté en transaction IndexedDB, jamais réattribué, resynchronisé après restauration |
| Perte de données (navigateur, désinstallation) | export JSON, rappel de sauvegarde, demande de stockage persistant, avertissements affichés |
| IndexedDB indisponible (mode privé) | erreur explicite et message compréhensible |
| `localStorage` plein | erreur interceptée et message clair |
| Quota dépassé par le logo | redimensionnement local (canvas, 480 × 240 px) avant stockage |
| Service Worker obsolète | notification de mise à jour + activation manuelle, purge des anciens caches, données préservées |
| Polices PDF non compatibles (espaces fines) | normalisation des espaces avant écriture dans le PDF |
| PDF indisponible hors ligne | bibliothèque servie localement et précachée ; repli sur l'impression navigateur |
| Déploiement en sous-dossier | chemins tous relatifs, base calculée à l'exécution |
| Limites connues | pas de synchronisation multi-appareils, pas de chiffrement local, pas de gestion de stock ni de catalogue produits, pas de multi-devises simultanées dans un même document |

---

## Licence

Code applicatif : MIT. jsPDF (dossier `lib/`) reste sous licence MIT de ses auteurs
(voir `lib/jspdf.LICENSE.txt`). Les icônes sont générées par `tools/generer-icones.py`.
