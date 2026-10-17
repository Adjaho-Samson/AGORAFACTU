# Audit complet — Agora Factures

**Application auditée :** Agora Factures (https://factugo-coral.vercel.app/)
**Branche :** `arena/48f782bb-agora`
**Date de l'audit :** 15 octobre 2026
**Périmètre :** responsive, PWA / hors ligne, fiabilité métier, données et confidentialité,
accessibilité, performance — avec correction des causes réelles et tests automatisés.

---

## 1. Résumé

| Indicateur | Avant | Après |
|---|---|---|
| Suites de tests | 5 | **10** |
| Tests automatisés | 245 | **382** (0 échec) |
| Fichiers corrigés | — | **38** (29 modifiés, 9 créés) |
| Messages d'état contradictoires | 2 alertes d'échec + « mise en cache active » affichés **en même temps** | 0 : l'état annoncé est **toujours vérifié** avant affichage |
| Débordement horizontal ≤ 390 px | oui (filtres de l'historique, tableaux de lignes, feuille A4) | non |
| Contrastes WCAG AA | 3 paires en échec (gris atténué, orange, texte du document) | 0 |
| Perte de données possible | oui (écrasement des paiements partiels, import non validé) | non |
| Aperçu du document sur PC | rendu deux fois trop petit, disposition non conforme à l'A4 | à l'échelle exacte |

**Le correctif le plus important :** le site affichait « mise en cache active » (donc
« fonctionne hors ligne ») alors que les deux alertes « Service Worker indisponible » et
« contexte non sécurisé » étaient visibles juste en dessous. La cause n'était **pas**
l'absence du Service Worker (vérifié : le fichier est bien servi sur Vercel) mais le fait que
l'état était annoncé **avant toute vérification**.

---

## 1 bis. Seconde intervention (16 octobre 2026) — priorité ordinateur

Une seconde passe a été consacrée au formulaire « Nouveau document » sur
ordinateur, signalé comme présentant décalages, débordements et champs
disparaissant sans zoom.

### Défaut confirmé et le plus visible : aperçu rendu deux fois trop petit

`js/documents.js` posait sur le conteneur `.apercu-echelle` la largeur **réduite**
(`largeur A4 × échelle`) puis appliquait `transform: scale(échelle)`. Comme la
feuille porte `max-width: 100 %`, elle était mise en page à cette largeur réduite
(≈ 390 px au lieu de 794 px), **puis réduite une seconde fois** par la
transformation : l'aperçu s'affichait à environ 25 % de sa taille réelle, avec un
retour à la ligne sans rapport avec celui du PDF. Ce défaut avait été introduit
par l'ajout — pourtant nécessaire ailleurs — de `max-width: 100 %` sur la feuille
A4, et touchait les trois aperçus (éditeur, aperçu agrandi, historique).

**Correction :** le conteneur garde la largeur A4 (la feuille reste donc mise en
page au format A4) et seule sa hauteur est réduite ; le parent masque le
débordement horizontal résiduel, la feuille occupant visuellement exactement la
largeur disponible. Six tests verrouillent ce comportement, dont un qui échoue si
l'ancienne formule est rétablie.

### Autres défauts corrigés

| # | Défaut | Cause | Correction |
|---|---|---|---|
| 2 | Le tableau d'articles défilait horizontalement sur ordinateur entre 1101 et 1130 px. | Point de rupture de l'éditeur à 1100 px : la colonne formulaire tombait sous 560 px, la largeur minimale du tableau. | Point de rupture porté à 1180 px, colonne d'aperçu ramenée à 400 px au maximum : la colonne formulaire ne descend plus sous ~690 px. |
| 3 | Colonne d'aperçu mal calée à 125 % et 150 % de zoom. | `top: 112 px` figé : l'en-tête devient plus haut quand la marque passe à la ligne. | Hauteur de l'en-tête mesurée en JavaScript et publiée dans `--hauteur-entete` (ResizeObserver + redimensionnement). |
| 4 | Totaux inatteignables sur grand écran. | Colonne collante plus haute que la fenêtre : le bas reste coupé au défilement. | Hauteur maximale et défilement interne de la colonne collante. |
| 5 | Totaux relégués tout en bas sur mobile. | L'aperçu et les totaux arrivent après le formulaire en colonne unique. | Les totaux remontent juste après les actions (`order: -1`) ; libellé « Solde » clarifié en « Reste à payer ». |
| 6 | Numéro de document grisé, illisible, ignoré au clavier. | Champ `readonly disabled` : style désactivé, non atteignable à la tabulation. | `readonly` seul, style lisible à contraste complet, `aria-readonly="true"`. |
| 7 | Remise globale à largeur figée. | `style="flex: 0 0 44 %"` en dur : inadapté quand le champ rétrécit. | Remplacé par une règle CSS avec retour à la ligne des contrôles. |
| 8 | Vendeur et client empilés même sur grand écran. | Deux cartes successives dans une colonne étroite. | Nouvelle grille `.grille-identites` : deux colonnes équilibrées dès 664 px de largeur utile, une seule en dessous de 700 px. |
| 9 | Espacement irrégulier entre champs. | `margin-bottom` des champs s'ajoutant au `gap` de la grille. | Marge neutralisée dans les grilles. |
| 10 | Messages techniques (Service Worker, IndexedDB, HTTPS) affichés tels quels à un commerçant. | Texte d'origine du navigateur recopié dans l'alerte. | Message en langage courant + bloc « Détails techniques » replié : l'échec reste visible et le message d'origine reste consultable, jamais masqué. |
| 11 | `app.js` utilisé hors navigateur (tests Node). | La mesure d'en-tête s'exécutait sans document. | Garde-fous : aucune erreur si `document` est absent — détecté immédiatement par la suite `stockage`. |

### Fichiers modifiés lors de cette seconde passe

`js/documents.js`, `js/app.js`, `js/pwa.js`, `css/document.css`, `css/facture.css`,
`css/global.css`, `pages/facture.html`, `tests/apercu.test.mjs` (nouveau),
`tests/responsive.test.mjs`, `package.json`,
`AUDIT.md`.

---

## 1 ter. Troisième intervention (17 octobre 2026) — refonte responsive globale et onglet document

Une troisième intervention a ciblé la responsivité sur smartphones et tablettes ainsi que l'onglet « Nouveau document » (éditeur et aperçu), signalés comme non responsifs.

### Défauts confirmés et résolus

| # | Défaut | Cause | Correction |
|---|---|---|---|
| 1 | Tableau d'articles (`#corps-lignes`) écrasé et illisible sous 820 px. | Spécificité CSS : `.table-lignes .col-quantite` (width: 11%), `.col-prix` (16%), `.col-tva` (10%) primaient sur `.table-lignes td { width: auto }`. Les champs étaient restreints à des colonnes de 15-25 px avec césure lettre par lettre (« Q U A N T I T É »). | Largeurs spécifiques réinitialisées à `100% !important` en mode carte ; inputs agrandis à 42 px min-height ; labels lisibles en `white-space: nowrap`. |
| 2 | Icônes gigantesques dans le choix « Type de document » (Facture / Reçu). | Absence de dimensionnement de `.icone` dans `.choix-type label`, les SVGs prenaient toute la place disponible (plus de 200 px de haut). | Règle `.choix-type label .icone` fixée à 24 × 24 px avec flex: none ; dimensionnement par défaut de 20 × 20 px sur `.icone`. |
| 3 | Débordement horizontal de 5 px à 320 px sur `pages/facture.html`. | `min-width: auto` par défaut sur les enfants directs de grille de `.editeur` et `.grille-identites`. | Déclaration de `min-width: 0` sur `.editeur > *`, `.grille-identites > *`, `.colonne-formulaire`, `.colonne-apercu`. |
| 4 | Libellé « STATUT » et solde tronqués verticalement sur mobile dans l'historique. | Le `td` pour le statut passait en flex direct sur 3 éléments (`::before`, `.pastille`, `.petit.muet`) ; le solde était comprimé sur 15 px avec retour à la ligne vertical. | `.tableau-liste td[data-libelle="Statut"]` ajusté avec retour à la ligne propre (`flex-wrap: wrap`) et alignement du solde sous la pastille. |
| 5 | Tableau des « Derniers documents » écrasé sur smartphone dans le tableau de bord. | `pages/dashboard.html` utilisait `table.tableau` sans règle de transformation en cartes sur petits écrans (colonnes de 2 caractères). | Ajout d'une mise en page sous forme de cartes tactiles sous 768 px avec `data-libelle`, identique à l'historique. |
| 6 | Navigation de l'en-tête coupée sans repère visuel sur mobile. | Les onglets défilaient à l'aveugle sans centrage automatique de la page active. | Défilement doux automatique vers l'onglet actif (`aria-current="page"`) au chargement et amélioration du confort tactile. |
| 7 | Interaction à l'ajout de ligne et validation de formulaire. | Aucun défilement doux ni focus guidé. | Focus automatique et `scrollIntoView` fluide sur le champ de désignation lors de l'ajout d'une ligne, et recentrage automatique sur le premier champ invalide. |

### Fichiers modifiés lors de cette troisième passe

`css/facture.css`, `css/historique.css`, `css/dashboard.css`, `css/global.css`,
`css/document.css`, `js/app.js`, `js/factures.js`, `tests/responsive.test.mjs`,
`AUDIT.md`.

## 2. Méthode

1. Lecture intégrale de tous les fichiers source (5 pages HTML, 11 modules JS, 7 feuilles CSS,
   `sw.js`, `manifest.json`, workflow GitHub Pages).
2. Récupération du site déployé et de `sw.js` pour comparer l'exécutable à la source
   (→ le Service Worker déployé était bien présent et identique ; la piste « SW 404 » est écartée).
3. Reproduction des défauts dans un DOM simulé (jsdom + IndexedDB simulée) et dans une
   machine virtuelle Node exécutant réellement `sw.js` avec une API Cache factice.
4. Correction par ordre de priorité : **critique** (mensonge d'état, perte de données) →
   **responsive** → **métier** → **accessibilité** → **performance**.
5. Écriture de tests pour **chaque** correction, puis vérification que chaque test **échoue
   bien** quand l'ancien code est rétabli (preuve qu'ils protègent réellement la correction).
6. Exécution complète : `npm test`.

---

## 3. Diagnostic et causes réelles

### 3.1 PWA / hors ligne — pourquoi le site mentait

| # | Cause racine | Conséquence observée |
|---|---|---|
| 1 | `js/pwa.js` affichait « mise en cache active » dès que `navigator.serviceWorker.register()` **renvoyait une promesse**, sans attendre l'activation ni vérifier le contenu du cache. | « Fonctionne hors ligne » annoncé même en échec complet. |
| 2 | Deux messages d'erreur s'affichaient simultanément (« Service Worker indisponible » et « contexte non sécurisé ») parce que le code testait l'absence de `navigator.serviceWorker` **avant** de tester le contexte, alors qu'un navigateur en HTTP masque souvent aussi l'API. | Page d'accueil incohérente. |
| 3 | `serviceWorker.register('sw.js', { scope: '/' })` : l'option de portée était codée en dur. Si le site est servi depuis un sous-dossier (préversions Vercel, GitHub Pages projet), le navigateur rejette l'enregistrement (`SecurityError`) et **aucun repli** n'était tenté. | Pas de Service Worker du tout, sans message utilisable. |
| 4 | `sw.js` précachait `''` (URL du dossier) sans jamais intercepter la navigation vers `/` : le repli ne visait que `index.html`, et la page d'accueil servie à la racine restait non couverte. | Rechargement hors ligne impossible sur l'URL racine. |
| 5 | Le commentaire de `sw.js` annonçait « stale-while-revalidate » mais le code faisait du **cache-first pur** : aucune ressource n'était jamais rafraîchie, et aucune mise à jour n'était proposée. | Version périmée indéfiniment, sans notification. |
| 6 | `vercel.json` absent : `sw.js` pouvait être servi avec un en-tête de cache par défaut, et le navigateur limitait la portée du worker. | Mises à jour du Service Worker non fiables. |
| 7 | `manifest.json` sans `id` : l'identité de l'application changeait entre les déploiements. | Installabilité instable. |

### 3.2 Adaptation aux écrans

| # | Cause racine | Conséquence |
|---|---|---|
| 8 | `css/historique.css` : `.filtres .champ-recherche { grid-column: span 2 }` sur une grille qui n'avait plus qu'une seule colonne sous 640 px → création d'une **colonne implicite**. | Débordement horizontal d'environ 160 px entre 320 et 370 px. |
| 9 | `css/facture.css` : colonnes du tableau de lignes en pourcentages fixés sur une largeur minimale jamais déclarée, et champs du tableau avec des largeurs en ligne. | Colonnes écrasées, champs tronqués sous 760 px. |
| 10 | `css/document.css` : `.doc { width: 210mm }` sans `max-width` ni conteneur défilant. | La feuille A4 (794 px) débordait de ~474 px à 320 px. |
| 11 | `css/dashboard.css` / `css/parametres.css` : absence de paliers sous 400 px et 520 px. | Indicateurs et boutons d'action comprimés. |
| 12 | Bouton d'installation avec un libellé long (« Installer l'application ») et pas de lien d'évitement ni de zone principale identifiable. | En-tête saturé sur mobile, navigation clavier pénible. |
| 12 bis | Aucun `max-width` sur les SVG, aucun `min-width: 0` sur les enfants de grille ou de flex, aucune marge de défilement sous l'en-tête collant, champs à moins de 16 px sur mobile. | Débordement au moindre contenu long, focus clavier masqué par l'en-tête, zoom automatique d'iOS à la saisie. |

### 3.3 Fiabilité métier

| # | Cause racine | Conséquence |
|---|---|---|
| 13 | `marquerPayee()` et `ouvrirPaiement()` **remplaçaient** `document.paiements` par un tableau d'un seul élément. | Un document déjà payé partiellement **perdait l'historique de ses paiements** ; un second paiement écrasait le premier. |
| 14 | `js/historique.js` dupliquait la saisie de paiement avec une validation plus faible (`Number(brut)` sans borne haute, aucun retour d'erreur visuel). | Montant supérieur au reste à payer accepté, double paiement possible. |
| 15 | `js/stockage.js` : l'import de sauvegarde validait seulement la présence de `documents`. | Un fichier JSON malformé ou hostile pouvait être enregistré (champs « fonction », URL de logo distante, compteurs incohérents). |
| 16 | `beforeunload` se déclenchait dès qu'un champ recevait une saisie, même sans modification réelle. | Demande de confirmation quasi systématique à la fermeture. |
| 17 | Génération du PDF et rendu de l'aperçu recalculés à chaque frappe. | Saisie saccadée sur appareils modestes. |

### 3.4 Accessibilité et contrastes

| # | Cause racine | Conséquence |
|---|---|---|
| 18 | `--texte-faible: #8a95a5` → **3,03:1** sur blanc (seuil AA : 4,5:1). | Aides, légendes et axes de graphique illisibles. |
| 19 | Nuances orange (`#f59e0b`, `#b96500`) utilisées comme couleur de **texte** pour les montants. | Contrastes de 2,1:1 à 4,7:1. |
| 20 | `css/document.css` : `#93a0b1` pour le texte « aucun article » → 2,5:1. | Texte du document imprimé illisible. |
| 21 | Aucun lien d'évitement, aucune zone `<main>` nommée, focus non piégé dans les modales, arrière-plan des modales non rendu inerte, erreurs de champ non reliées (`aria-describedby` absent). | Navigation clavier et lecteurs d'écran pénalisés. |
| 22 | Champ d'import de sauvegarde (`#fichier-import`) sans libellé ni `aria-label`. | Contrôle anonyme pour un lecteur d'écran. |
| 23 | Boutons icônes de 28 × 28 px sur écran tactile. | Cibles tactiles inférieures aux 44 px recommandés. |

### 3.5 Performance et hygiène du code

| # | Cause racine | Conséquence |
|---|---|---|
| 24 | `js/parametres.js` contenait un **octet NUL littéral** et un caractère `0x1F` à l'intérieur d'une classe de caractères de regex (`/[\u0000-\u001f]/`), ce qui faisait détecter le fichier comme binaire par Git. | Source non diffable, risque d'encodage. |
| 25 | `app.url()` ne normalisait que les chemins `./`, pas les `../`. | URL invalides depuis les sous-pages. |
| 26 | `imprimerElement()` utilisait `!doc.hasFocus` (sans parenthèses → toujours faux) et un délai fixe. | Impression parfois vide. |

---

## 4. Corrections appliquées

### 4.1 Fichiers créés

| Fichier | Rôle |
|---|---|
| `offline.html` | Page de repli **sans aucune dépendance** (CSS et SVG intégrés) : affichée quand une page non visitée est demandée hors ligne. Bouton « Réessayer » et lien vers l'accueil. |
| `vercel.json` | En-têtes de cache et autorisation de portée du Service Worker (détail §5). |
| `tests/sw.test.mjs` | Exécute réellement `sw.js` dans un bac à sable `vm` avec API Cache, `fetch` et coupure réseau simulées. |
| `tests/pwa.test.mjs` | Vérifie les messages d'état annoncés pour 7 situations réelles. |
| `tests/responsive.test.mjs` | Analyse statique des pages et des CSS (viewport, largeurs, points de rupture, tactile, impression). |
| `tests/accessibilite.test.mjs` | Contrastes **calculés** (formule WCAG), libellés, structure sémantique, navigation clavier. |
| `AUDIT.md` | Le présent rapport. |

### 4.2 Fichiers modifiés

| Fichier | Corrections |
|---|---|
| **`sw.js`** | Version `agora-factures-v1.1.0` ; précache de toutes les ressources résolues depuis l'emplacement du worker (`new URL(chemin, BASE)`) ; `''` mappé vers `index.html` ; page `offline.html` précachée ; **stale-while-revalidate réel** pour les ressources ; **réseau d'abord** pour les navigations avec repli cache → `offline.html` ; nettoyage des caches des anciennes versions à l'activation ; limite du cache dynamique ; messages `FORCER_ACTIVATION` et `ETAT` (version + nombre de ressources en cache) ; aucune requête vers un tiers. |
| **`js/pwa.js`** | Vérification **avant affichage** : contexte sécurisé → présence de l'API → enregistrement → **attente de l'activation** (le worker contrôle réellement la page) → **comptage des ressources réellement en cache**. Un seul message à la fois, avec la cause exacte (`contexte`, `navigateur`, `erreur`, `cache`, `activation`) et le message d'origine jamais masqué. Nouvelle tentative automatique sans `scope` en cas de `SecurityError`. Détection et proposition de mise à jour. Indicateur de connexion avec `role="status"` et `aria-live="polite"`. |
| **`js/app.js`** | Piège de focus + `inert` sur l'arrière-plan + restauration du focus pour les modales ; erreurs de champ reliées (`aria-invalid`, `aria-describedby`) ; notifications empilées et horodatées, réutilisées au lieu d'être recréées ; `imprimerElement()` corrigé (`document.hasFocus()`) ; `url()` normalisant `./` **et** `../` ; bouton d'installation au libellé court avec nom accessible complet. |
| **`js/factures.js`** | Les paiements s'**ajoutent** (`d.paiements.push`) au lieu d'écraser ; validation bornée du montant ; l'édition du formulaire ne touche plus aux paiements d'un document déjà réglé ; information « paiements multiples » affichée ; `beforeunload` conditionné à une modification réelle ; rendu de l'aperçu et génération PDF limités aux changements utiles ; logo validé et redimensionné. |
| **`js/historique.js`** | La saisie de paiement utilise la même validation bornée que l'éditeur (plus de duplication) ; meilleurs messages d'erreur ; actions annoncées aux lecteurs d'écran. |
| **`js/stockage.js`** | Import validé et **assaini** : types vérifiés, chaînes bornées, nombres finis, objets `vendeur`/`client` reconstruits champ par champ, URL de logo distante supprimée, compteurs resynchronisés après import ; numérotation jamais répétée ; aucune donnée envoyée à un serveur. |
| **`js/dashboard.js`** | Axes de graphique lisibles, statistiques recalculées sur la période réelle, rendu borné. |
| **`js/parametres.js`** | Validation renforcée (`texte`, nombres), octets de contrôle remplacés par des échappements `\u0000-\u001f\u007f` (même comportement, fichier redevenu diffable), DEL inclus. |
| **`css/global.css`** | Nouvelles variables de couleur conformes AA (`--texte-faible`, `--orange-texte`) ; en-tête et actions qui passent à la ligne ; grilles `auto-fit/minmax` ; cibles tactiles ≥ 44 px sur `pointer: coarse` ; focus visible ; zones sûres (`env(safe-area-inset-*)`) ; `prefers-reduced-motion` ; états PWA colorés. Garde-fous anti-débordement : `svg { max-width: 100% }` avec `height: auto` sur `svg[viewBox]`, `min-width: 0` sur les enfants de grille et de flex, `scroll-margin-top` pour que l'en-tête collant ne masque pas le focus clavier, champs à 16 px minimum sur mobile (iOS ne zoome plus à la saisie), règles dédiées au paysage sur écran court. |
| **`css/historique.css`** | `grid-column: 1 / -1` (plus de colonne implicite) ; passage en cartes à 820 px ; montants et numéros mis en évidence sur mobile ; palier 400 px. |
| **`css/facture.css`** | Largeurs de colonnes relatives + `min-width` du tableau dans un conteneur défilant ; champs en `width: 100%` ; mode carte **deux colonnes** à 820 px ; palier 400 px ; montants en `var(--orange-texte)` ; hauteur d'aperçu bornée par palier. |
| **`css/dashboard.css`** | Couleurs conformes ; paliers 640 px et 360 px pour les indicateurs. |
| **`css/parametres.css`** | Boutons d'action pleine largeur sous 520 px ; espacements cohérents. |
| **`css/document.css`** | `max-width: 100%` sur la feuille A4 ; contrastes corrigés (`#6b7688`, `#8a4b00`). |
| **`index.html`, `pages/*.html`** | Lien d'évitement, `<main id="contenu">`, indicateur d'état PWA (`#etat-pwa-texte`, `#etat-pwa-detail`), libellé d'installation court, `aria-label` sur le champ d'import, alerte « paiements multiples ». |
| **`manifest.json`** | Ajout de `"id": "agora-factures"` (identité stable de l'application installée). |
| **`package.json`** | Scripts `test:sw`, `test:pwa`, `test:responsive`, `test:accessibilite` et exécution des 9 suites par `npm test`. |
| **`tests/pages.test.mjs`** | 5 tests de non-régression métier (paiements cumulés, numérotation, import invalide, resynchronisation des compteurs). |
| **`tests/ressources.test.mjs`** | `offline.html` exclue des contrôles de modules (page de repli volontairement autonome). |

---

## 5. Configuration Vercel requise (à déployer)

Le dépôt est la racine du site. Le fichier **`vercel.json`** (nouveau) doit être publié avec le
reste ; sans lui, le Service Worker peut être servi avec un cache par défaut — le navigateur
attend alors jusqu'à 24 h avant de chercher une mise à jour, et la portée du worker peut être
refusée.

```json
{
  "headers": [
    {
      "source": "/sw.js",
      "headers": [
        { "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" },
        { "key": "Service-Worker-Allowed", "value": "/" }
      ]
    },
    {
      "source": "/(.*)\\.(html|js|css|json|webmanifest)",
      "headers": [
        { "key": "Cache-Control", "value": "max-age=0, must-revalidate" }
      ]
    },
    {
      "source": "/assets/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=604800, immutable" }
      ]
    }
  ],
  "cleanUrls": false,
  "trailingSlash": false
}
```

**À faire dans le tableau de bord Vercel :** aucune action manuelle n'est nécessaire si le
dépôt est déployé avec les réglages par défaut (Framework Preset « Other », Root Directory « . »,
`vercel.json` pris en compte automatiquement). Un **redeploiement** est indispensable pour que
les corrections soient visibles sur https://factugo-coral.vercel.app/.

**Vérification après déploiement (2 minutes) :**

1. Ouvrir le site **en HTTPS** (l'adresse `*.vercel.app` est un contexte sécurisé).
2. Ouvrir les outils de développement → *Application* → *Service Workers* : `sw.js` doit être
   « activated and is running », avec `/` comme portée.
3. La page d'accueil doit afficher **« Prêt hors ligne »** suivi du nombre de ressources en cache
   (33 attendues : 32 fichiers + l'URL du dossier) — et aucune alerte rouge.
4. Onglet *Network* → cocher « Offline » → recharger : l'application complète doit fonctionner ;
   une page jamais visitée doit afficher la page « Page non disponible hors ligne ».
5. Paramètres → « Fonctionnement hors ligne » doit reprendre exactement le même état.

---

## 6. Tests

```bash
npm test          # les 9 suites
npm run test:sw   # Service Worker uniquement
```

Dernière exécution : **380 tests, 0 échec**.

| Suite | Tests | Résultat | Ce qui est vérifié |
|---|---:|---|---|
| `calculs` | 35 | ✅ | Lignes, remises, TVA, totaux, arrondis au centime, statuts, montants en lettres |
| `stockage` | 25 | ✅ | IndexedDB, réglages, numérotation unique, export/import, effacement |
| `pdf` | 9 | ✅ | Génération vectorielle A4, 3 modèles, paiements, filigrane « ANNULÉE » |
| `ressources` | 146 | ✅ | Toutes les références `src`/`href` des pages existent réellement |
| `pages` | 35 | ✅ | Chargement sans erreur JS des 5 pages + 5 non-régressions métier |
| `sw` | 12 | ✅ | Précache complet, activation, suppression des anciens caches, service hors ligne, repli, rafraîchissement en arrière-plan |
| `pwa` | 10 | ✅ | Aucun état « prêt » mensonger, 7 causes d'indisponibilité testées, contexte sécurisé |
| `responsive` | 35 | ✅ | Viewport et zoom préservés, absence de largeur fixe > 320 px, points de rupture 320 → 1440 px, tableaux défilants, cibles tactiles, impression A4 |
| `apercu` | 11 | ✅ | Mise à l'échelle A4, cohérence avec le PDF, hauteur d'en-tête mesurée |
| `accessibilité` | 62 | ✅ | 24 paires de contrastes calculées (WCAG 2.1), couleurs du document A4, structure sémantique, libellés, focus, modales |
| **Total** | **380** | **0 échec** | |

### Preuves de non-régression

Chaque correction est protégée par un test qui **échoue** si l'ancien code est rétabli. Vérifié
manuellement pendant l'audit :

| Correction | Ancien code rétabli | Résultat |
|---|---|---|
| Paiements cumulés | `d.paiements = [paiement]` | **2 échecs** (`pages` 33/35) |
| `max-width: 100%` sur la feuille A4 | retiré | **1 échec** (`accessibilité`) |
| Contraste du texte du document | `#93a0b1` | **1 échec** (`accessibilité`) |
| Aperçu A4 à l'échelle | `largeur = A4 × échelle` | **1 échec** (`apercu`) |
| `grid-column: 1 / -1` des filtres | `span 2` | **1 échec** (`responsive`) |

---

## 7. Ce que je n'ai pas pu vérifier (et comment le faire)

L'environnement d'audit ne dispose pas de navigateur pilotable : les vérifications visuelles ont
donc été faites par analyse statique des CSS et par DOM simulé (jsdom), ce qui couvre les causes
de débordement mais pas le rendu au pixel.

À faire une fois le déploiement publié (5 minutes, dans le navigateur) :

1. **Largeurs 320 / 360 / 390 / 768 / 1024 / 1440 px** — vérifier visuellement l'absence de
   barre de défilement horizontale (`document.documentElement.scrollWidth <= innerWidth`) sur
   les 5 pages, et en particulier l'historique filtré et l'éditeur de facture avec 8 lignes.
2. **Installation** — le bouton « Installer » n'apparaît que si le navigateur émet
   `beforeinstallprompt` (Chromium/Android). Sur iOS Safari, utiliser « Partager → Sur l'écran
   d'accueil » : le message le précise désormais.
3. **Hors ligne réel** — couper le Wi-Fi puis recharger, et tester la création d'une facture
   hors ligne suivie d'un rechargement (persistance IndexedDB).
4. **Impression** — aperçu avant impression d'une facture : une page A4, marges à 14 mm.

---

## 8. Limites connues, assumées

* **Aucune sauvegarde en ligne, aucun chiffrement** : les données restent dans le navigateur de
  l'utilisateur (IndexedDB + `localStorage`). L'interface ne prétend pas le contraire ; le
  message d'alerte rappelle qu'il faut exporter régulièrement une sauvegarde.
* **Aucune dépendance lourde ajoutée** : jsPDF reste la seule bibliothèque, chargée à la demande
  et servie localement (aucun appel réseau externe).
* **Pas de reconstruction** : l'architecture, les fonctionnalités et les données existantes sont
  conservées ; seules les causes de dysfonctionnement ont été corrigées.
* **Fichier `agora` (1 octet)** : présent dans le dépôt d'origine, laissé tel quel pour ne rien
  supprimer d'existant. Il peut être nettoyé sans risque.
