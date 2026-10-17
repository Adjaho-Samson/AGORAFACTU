/* ==========================================================================
   Tests d'adaptation aux écrans (analyse statique des pages et des CSS).
   --------------------------------------------------------------------------
   Contrôles automatisés, reproductibles, sur les largeurs 320 → 1440 px :
     • balise viewport correcte, zoom jamais bloqué ;
     • absence de largeur fixe supérieure à la largeur d'un petit écran ;
     • points de rupture couvrant 320, 360, 390, 768, 1024 et 1440 px ;
     • conteneurs de tableaux réellement défilants ;
     • cibles tactiles et zones sûres (encoches) prises en compte ;
     • grilles souples (auto-fit / 1fr) plutôt que colonnes figées.
   Exécution : node tests/responsive.test.mjs
   ========================================================================== */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decrire, test, egal, vrai, faux, bilan } from './micro-test.mjs';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function lire(cheminRelatif) { return readFileSync(join(RACINE, cheminRelatif), 'utf8'); }
function fichiersCss() {
  return readdirSync(join(RACINE, 'css')).filter((f) => f.endsWith('.css')).map((f) => 'css/' + f);
}
const PAGES = ['index.html', 'offline.html', 'pages/dashboard.html', 'pages/facture.html',
  'pages/historique.html', 'pages/parametres.html'];

/** Retire les commentaires d'une feuille de style (analyse plus sûre). */
function sansCommentaires(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }

/** Supprime les conditions @media (les règles qu'elles contiennent restent). */
function sansConditionsMedia(css) { return css.replace(/@media[^{]+\{/g, '{'); }

/** Extrait les blocs « media query » avec leur condition. */
function extraireMedia(css) {
  const blocs = [];
  const motif = /@media\s*([^{]+)\{/g;
  let m;
  while ((m = motif.exec(css)) !== null) {
    let profondeur = 1;
    let i = m.index + m[0].length;
    while (i < css.length && profondeur > 0) {
      if (css[i] === '{') profondeur++;
      else if (css[i] === '}') profondeur--;
      i++;
    }
    blocs.push({ condition: m[1].trim(), corps: css.slice(m.index + m[0].length, i - 1) });
  }
  return blocs;
}

function largeursMax(css) {
  return extraireMedia(css)
    .map((b) => /max-width\s*:\s*(\d+)px/.exec(b.condition))
    .filter(Boolean)
    .map((m) => parseInt(m[1], 10));
}

/* ------------------------------------------------------------ viewport */
decrire('Viewport et zoom', () => {
  PAGES.forEach((page) => {
    test(page + ' : balise viewport correcte', () => {
      const html = lire(page);
      const meta = /<meta name="viewport" content="([^"]+)"/.exec(html);
      vrai(!!meta, page + ' : balise viewport absente');
      vrai(/width=device-width/.test(meta[1]), page + ' : width=device-width absent');
      vrai(/initial-scale=1/.test(meta[1]), page + ' : initial-scale absent');
      faux(/user-scalable\s*=\s*(no|0)/.test(meta[1]), page + ' : le zoom ne doit pas être bloqué');
      const maximum = /maximum-scale\s*=\s*([\d.]+)/.exec(meta[1]);
      if (maximum) vrai(parseFloat(maximum[1]) >= 5, page + ' : maximum-scale trop restrictif');
    });
  });

  test('aucune page n\'utilise de largeur fixe en attribut HTML', () => {
    PAGES.forEach((page) => {
      const html = lire(page);
      const largeurs = [...html.matchAll(/width="(\d{2,})"/g)].map((m) => parseInt(m[1], 10));
      largeurs.forEach((l) => vrai(l <= 64, page + ' : largeur d\'image fixe trop grande (' + l + ' px)'));
    });
  });
});

/* ---------------------------------------------------- largeurs et grilles */
decrire('Largeurs et grilles', () => {
  test('aucune largeur fixe ne dépasse la largeur d\'un petit écran', () => {
    // Exceptions justifiées : éléments volontairement plus larges que l'écran
    // MAIS placés dans un conteneur défilant (.table-enveloppe / .zone-apercu).
    const exceptions = ['min-width: 560px'];
    fichiersCss().forEach((fichier) => {
      const css = sansCommentaires(lire(fichier));
      // « max-width » ne force jamais de débordement : on ne teste que
      // « width » et « min-width » (le motif évite de matcher max-width).
      // Les conditions « (min-width: 640px) » ne sont pas des déclarations :
      // on les retire pour n'analyser que les propriétés CSS.
      const declarations = [...sansConditionsMedia(css)
        .matchAll(/(?:^|[^\w-])(min-width|width)\s*:\s*(\d{3,})px/g)];
      declarations.forEach((d) => {
        const valeur = parseInt(d[2], 10);
        const contexte = css.slice(Math.max(0, d.index - 200), d.index);
        if (exceptions.some((e) => d[0].trim() === e)) return;
        vrai(valeur <= 320, fichier + ' : ' + d[0] + ' dépasse 320 px (débordement horizontal assuré)');
        vrai(!/table-lignes/.test(contexte) || valeur <= 600, fichier + ' : ' + d[0]);
      });
    });
  });

  test('les grilles utilisent des colonnes souples', () => {
    const global = sansCommentaires(lire('css/global.css'));
    vrai(/\.grille-champs[\s\S]{0,200}repeat\(auto-fit,\s*minmax\(/.test(global),
      'les champs doivent se réorganiser automatiquement');
    vrai(/\.grille-2[\s\S]{0,200}repeat\(auto-fit,\s*minmax\(/.test(global), 'grille-2 figée');
    vrai(/\.grille-3[\s\S]{0,200}repeat\(auto-fit,\s*minmax\(/.test(global), 'grille-3 figée');
    const dashboard = sansCommentaires(lire('css/dashboard.css'));
    vrai(/\.grille-kpi[\s\S]{0,200}repeat\(auto-fit,\s*minmax\(/.test(dashboard), 'les indicateurs doivent être souples');
  });

  test('les tableaux sont enveloppés dans un conteneur défilant', () => {
    const global = sansCommentaires(lire('css/global.css'));
    vrai(/\.table-enveloppe\s*\{[^}]*overflow-x:\s*auto/.test(global),
      'les tableaux doivent pouvoir défiler horizontalement');
    PAGES.forEach((page) => {
      const html = lire(page);
      const tableaux = [...html.matchAll(/<table class="([^"]+)"/g)].map((m) => m[1]);
      tableaux.forEach((classe) => {
        const avant = html.slice(0, html.indexOf('<table class="' + classe + '"'));
        vrai(/table-enveloppe[^<]*$/.test(avant.slice(-120)), page + ' : tableau « ' + classe + ' » non enveloppé');
      });
    });
  });

  test('la grille de filtres ne crée pas de colonne implicite', () => {
    const historique = sansCommentaires(lire('css/historique.css'));
    const regle = /\.filtres\s+\.champ-recherche\s*\{([^}]*)\}/.exec(historique);
    vrai(!!regle, 'règle de recherche absente');
    vrai(/grid-column:\s*1\s*\/\s*-1/.test(regle[1]),
      '« span 2 » créait une colonne implicite (débordement sous ~370 px) : ' + regle[1].trim());
  });

  test('l\'en-tête peut se réorganiser sans déborder', () => {
    const global = sansCommentaires(lire('css/global.css'));
    const barre = /\.app-header\s+\.barre\s*\{([^}]*)\}/.exec(global);
    vrai(!!barre, 'règle .barre absente');
    vrai(/flex-wrap:\s*wrap/.test(barre[1]), 'l\'en-tête doit pouvoir passer à la ligne');
    const actions = /\.app-header\s+\.actions\s*\{([^}]*)\}/.exec(global);
    vrai(/flex-wrap:\s*wrap/.test(actions[1]), 'les actions de l\'en-tête doivent pouvoir passer à la ligne');
  });

  test('le aperçu A4 est mis à l\'échelle et jamais débordant', () => {
    const document_ = sansCommentaires(lire('css/document.css'));
    vrai(/\.apercu-echelle\s*\{[^}]*transform-origin/.test(document_), 'origine de transformation absente');
    const facture = sansCommentaires(lire('css/facture.css'));
    vrai(/#zone-apercu\s*\{[^}]*max-height/.test(facture), 'hauteur d\'aperçu non bornée');
    vrai(/\.zone-apercu\s*\{[^}]*overflow-y:\s*auto/.test(document_), 'l\'aperçu doit pouvoir défiler verticalement');
    vrai(/\.zone-apercu\s*\{[^}]*overflow-x:\s*hidden/.test(document_),
      'la feuille mise à l\'échelle occupe exactement la largeur : la barre horizontale serait un artefact');
  });
});

/* ------------------------------------------------------ points de rupture */
decrire('Points de rupture (320, 360, 390, 768, 1024, 1440 px)', () => {
  test('les feuilles de style couvrent toutes les familles d\'écrans', () => {
    const tous = fichiersCss().flatMap((f) => largeursMax(sansCommentaires(lire(f))));
    const tranches = [
      { nom: 'très petits (≤ 400)', min: 0, max: 400 },
      { nom: 'petits (401 → 520)', min: 401, max: 520 },
      { nom: 'mobiles (521 → 700)', min: 521, max: 700 },
      { nom: 'tablettes (701 → 1000)', min: 701, max: 1000 },
      { nom: 'petits portables (1001 → 1200)', min: 1001, max: 1200 }
    ];
    tranches.forEach((t) => {
      vrai(tous.some((l) => l >= t.min && l <= t.max),
        'aucun point de rupture pour « ' + t.nom + ' » : ' + JSON.stringify([...new Set(tous)].sort((a, b) => a - b)));
    });
  });

  test('320 et 360 px : règles dédiées présentes', () => {
    const global = sansCommentaires(lire('css/global.css'));
    vrai(largeursMax(global).includes(360), 'pas de palier à 360 px dans global.css');
    vrai(largeursMax(global).includes(480), 'pas de palier à 480 px dans global.css');
    const dashboard = sansCommentaires(lire('css/dashboard.css'));
    vrai(largeursMax(dashboard).includes(360), 'pas de palier à 360 px dans dashboard.css');
    const historique = sansCommentaires(lire('css/historique.css'));
    vrai(largeursMax(historique).includes(400), 'pas de palier à 400 px dans historique.css');
  });

  test('1024 et 1440 px : mise en page deux colonnes préservée', () => {
    const facture = sansCommentaires(lire('css/facture.css'));
    const editeur = /\.editeur\s*\{([^}]*)\}/.exec(facture);
    vrai(/grid-template-columns:/.test(editeur[1]), 'l\'éditeur doit rester en deux colonnes sur grand écran');
    const rupture = extraireMedia(facture).find((b) => /max-width:\s*1180px/.test(b.condition));
    vrai(!!rupture && /grid-template-columns:\s*1fr/.test(rupture.corps),
      'l\'éditeur doit passer en une seule colonne sous 1180 px');
    // Au-delà, la colonne formulaire reste assez large pour le tableau d'articles.
    const regle = /\.editeur\s*\{([\s\S]*?)\}/.exec(facture);
    const maxApercu = /minmax\(\d+px,\s*(\d+)px\)/.exec(regle[1]);
    vrai((1180 - 32) - parseInt(maxApercu[1], 10) - 24 - 48 >= 560,
      'sous cette largeur, le tableau d\'articles défilerait horizontalement sur PC');
  });
});

/* -------------------------------------------------------------- tactile */
decrire('Confort tactile et zones sûres', () => {
  test('les cibles tactiles atteignent 44 px', () => {
    const global = sansCommentaires(lire('css/global.css'));
    const tactile = extraireMedia(global).find((b) => /pointer:\s*coarse/.test(b.condition));
    vrai(!!tactile, 'aucune règle spécifique au tactile');
    vrai(/\.btn-petit\s*\{[^}]*min-height:\s*44px/.test(tactile.corps), 'boutons compacts trop petits au toucher');
    vrai(/\.btn-icone\s*\{[^}]*min-height:\s*44px/.test(tactile.corps), 'boutons icônes trop petits au toucher');
  });

  test('les zones sûres (encoches) sont respectées', () => {
    const global = sansCommentaires(lire('css/global.css'));
    vrai(/env\(safe-area-inset-bottom/.test(global), 'les notifications doivent éviter la zone sûre du bas');
    const modale = /\.modale > footer\s*\{([^}]*)\}/.exec(global);
    vrai(/env\(safe-area-inset-bottom/.test(modale[1]), 'le pied de modale doit éviter la zone sûre');
  });

  test('les préférences d\'animation sont respectées', () => {
    const global = sansCommentaires(lire('css/global.css'));
    const reduit = extraireMedia(global).find((b) => /prefers-reduced-motion/.test(b.condition));
    vrai(!!reduit, 'aucune prise en compte de prefers-reduced-motion');
  });

  test('le zoom et le défilement horizontal de la page ne sont pas bloqués', () => {
    const global = sansCommentaires(lire('css/global.css'));
    faux(/body\s*\{[^}]*overflow-x:\s*hidden/.test(global),
      'masquer le défilement horizontal cacherait les débordements au lieu de les corriger');
  });
});

/* ----------------------------------------------------------- impression */
decrire('Impression A4', () => {
  test('la feuille d\'impression cible le format A4 portrait', () => {
    const impression = sansCommentaires(lire('css/print.css'));
    vrai(/@page\s*\{[^}]*size:\s*A4\s*portrait/.test(impression), 'format A4 absent');
    vrai(/body\.mode-impression > \*:not\(#zone-impression\)/.test(impression),
      'seul le document doit être imprimé');
  });
});

decrire('Garde-fous et confort mobile', () => {
  const global = sansCommentaires(lire('css/global.css'));

  test('aucun média (image, SVG, iframe) ne peut dépasser son conteneur', () => {
    vrai(/svg\s*\{[^}]*max-width:\s*100%/.test(global), 'les SVG doivent être bornés');
    vrai(/svg\[viewBox\]\s*\{[^}]*height:\s*auto/.test(global),
      'un SVG réduit doit conserver ses proportions');
    vrai(/img\s*\{[^}]*max-width:\s*100%/.test(global), 'les images doivent être bornées');
  });

  test('les enfants de grille peuvent se réduire (min-width: 0)', () => {
    // Le sélecteur s'étend sur plusieurs lignes : on cherche le bloc complet.
    const regle = /\.grille-champs > \*[\s\S]*?\{[\s\S]*?\}/.exec(global);
    vrai(!!regle && /min-width:\s*0/.test(regle[0]),
      'sans « min-width: 0 », un contenu long fait déborder la colonne');
    vrai(/\.grille-kpi > \*/.test(global), 'les indicateurs du tableau de bord doivent être couverts');
  });

  test('le focus clavier n\'est jamais masqué par l\'en-tête collant', () => {
    vrai(/scroll-margin-top:\s*\d+px/.test(global),
      'un élément atteint au clavier doit rester visible sous l\'en-tête collant');
  });

  test('iOS ne zoome pas à la saisie (champs à 16 px minimum)', () => {
    const blocs = extraireMedia(global).filter((b) =>
      /max-width:\s*640px/.test(b.condition) || /pointer:\s*coarse/.test(b.condition));
    vrai(blocs.length > 0, 'palier mobile absent');
    const regle = blocs.find((b) => /input,\s*select,\s*textarea[^\n]*\{[^}]*font-size:\s*16px/.test(b.corps));
    vrai(!!regle, 'sous 16 px, iOS zoome automatiquement au focus : la mise en page « saute »');
  });

  test('le paysage sur mobile reste utilisable', () => {
    const paysage = extraireMedia(global).find((b) =>
      /orientation:\s*landscape/.test(b.condition) && /max-height:\s*480px/.test(b.condition));
    vrai(!!paysage, 'aucune règle pour les écrans courts en paysage');
    vrai(/position:\s*static/.test(paysage.corps),
      'l\'en-tête collant doit libérer la hauteur utile en paysage');
  });

  test('la navigation horizontale de l\'en-tête reste défilable', () => {
    vrai(/\.app-nav\s*\{[^}]*overflow-x:\s*auto/.test(global),
      'la navigation doit défiler plutôt que déborder sur petits écrans');
    vrai(/\.app-nav a\s*\{[^}]*white-space:\s*nowrap/.test(global),
      'les libellés de navigation ne doivent pas se couper');
  });
});

decrire('Éditeur « Nouveau document » — disposition sur ordinateur', () => {
  const facture = sansCommentaires(lire('css/facture.css'));
  const html = lire('pages/facture.html');

  test('la colonne d\'aperçu ne peut pas étouffer le formulaire', () => {
    const regle = /\.editeur\s*\{([\s\S]*?)\}/.exec(facture);
    const colonnes = /grid-template-columns:\s*([^;]+);/.exec(regle[1]);
    vrai(/minmax\(0,\s*1fr\)/.test(colonnes[1]), 'la colonne formulaire doit rester souple');
    const max = /minmax\(\d+px,\s*(\d+)px\)/.exec(colonnes[1]);
    vrai(!!max && parseInt(max[1], 10) <= 400,
      'colonne d\'aperçu trop large (' + (max && max[1]) + ' px) : le formulaire serait à l\'étroit');
  });

  test('le passage en une colonne intervient avant que le tableau ne défile', () => {
    // Sous 1180 px, la colonne formulaire tomberait sous la largeur minimale
    // du tableau d'articles (560 px) : on passe donc en une colonne plus tôt.
    const rupture = extraireMedia(facture).find((b) => /max-width:\s*1180px/.test(b.condition));
    vrai(!!rupture, 'point de rupture à 1180 px absent (anciennement 1100 px)');
    vrai(/grid-template-columns:\s*1fr/.test(rupture.corps), 'une seule colonne attendue');
    vrai(/position:\s*static/.test(rupture.corps), 'l\'aperçu ne doit plus être collant');
  });

  test('vendeur et client sont présentés côte à côte quand la place le permet', () => {
    vrai(/class="grille-identites"/.test(html), 'les deux cartes doivent être regroupées');
    const regle = /\.grille-identites\s*\{([\s\S]*?)\}/.exec(facture);
    vrai(/repeat\(auto-fit,\s*minmax\(min\(320px,\s*100%\),\s*1fr\)\)/.test(regle[1]),
      'deux colonnes équilibrées dès 664 px de largeur utile, sans jamais déborder');
    const etroite = extraireMedia(facture).find((b) => /max-width:\s*700px/.test(b.condition));
    vrai(!!etroite && /grid-template-columns:\s*1fr/.test(etroite.corps),
      'en dessous de 700 px, les cartes se remettent l\'une sous l\'autre');
  });

  test('aucune largeur n\'est imposée en style en ligne', () => {
    faux(/<[^>]+style="[^"]*(flex|width)\s*:/.test(html),
      'un style en ligne (remise globale) ne s\'adapte pas à la largeur disponible');
    vrai(/#remise-globale-type\s*\{[^}]*flex:/.test(facture),
      'la largeur de la remise doit être définie en CSS');
    vrai(/\.champ-ligne\s*\{[^}]*flex-wrap:\s*wrap/.test(facture),
      'les contrôles d\'une même ligne doivent pouvoir passer à la ligne');
  });

  test('le numéro de document est lisible (lecture seule, non désactivé)', () => {
    const champ = /<input[^>]*id="doc-numero"[^>]*>/.exec(html);
    vrai(/readonly/.test(champ[0]), 'le numéro doit rester en lecture seule');
    faux(/\sdisabled/.test(champ[0]),
      'un champ désactivé est grisé, illisible et ignoré au clavier : utiliser readonly');
    vrai(/aria-readonly="true"/.test(champ[0]), 'l\'état doit être annoncé');
  });

  test('la colonne collante reste entièrement atteignable', () => {
    const regles = [...facture.matchAll(/\.colonne-apercu\s*\{([\s\S]*?)\}/g)].map((m) => m[1]);
    const collante = regles.find((corps) => /position:\s*sticky/.test(corps));
    vrai(/max-height:/.test(collante) && /overflow-y:\s*auto/.test(collante),
      'une colonne collante plus haute que la fenêtre rendrait les totaux inatteignables');
    const mobile = extraireMedia(facture).find((b) => /max-width:\s*1180px/.test(b.condition));
    vrai(/max-height:\s*none/.test(mobile.corps),
      'en colonne unique, la limite de hauteur doit être levée');
  });

  test('les totaux remontent devant l\'aperçu en colonne unique', () => {
    vrai(/carte-totaux/.test(html), 'la carte des totaux doit être identifiable');
    const mobile = extraireMedia(facture).find((b) => /max-width:\s*1180px/.test(b.condition));
    vrai(/order:\s*-1/.test(mobile.corps),
      'sur mobile, le montant à payer doit suivre les actions sans descendre en bas de page');
    vrai(/Reste à payer/.test(html), 'libellé explicite attendu pour le solde');
  });

  test('la colonne collante se cale sur la hauteur réelle de l\'en-tête', () => {
    const regles = [...facture.matchAll(/\.colonne-apercu\s*\{([\s\S]*?)\}/g)].map((m) => m[1]);
    vrai(regles.some((corps) => /var\(--hauteur-entete/.test(corps)),
      'une valeur figée (112 px) est fausse dès que l\'en-tête passe sur deux lignes (zoom 125/150 %)');
    const source = lire('js/app.js');
    vrai(/function mesurerEntete/.test(source), 'la hauteur doit être mesurée');
    vrai(/ResizeObserver/.test(source), 'la hauteur doit suivre les changements de disposition');
  });
});

decrire('Éditeur « Nouveau document » — adaptation sur mobile et tablette', () => {
  const facture = sansCommentaires(lire('css/facture.css'));

  test('les cellules du tableau d\'articles occupent toute la largeur sous 820 px', () => {
    const mobile = extraireMedia(facture).find((b) => /max-width:\s*820px/.test(b.condition));
    vrai(!!mobile, 'règle 820 px absente dans facture.css');
    vrai(/\.col-quantite[^{]*\{[^}]*width:\s*100%/i.test(mobile.corps),
      'la largeur de 11 % écrasait les champs de saisie sur petit écran');
  });

  test('les icônes de choix de document ne peuvent pas déborder', () => {
    vrai(/\.choix-type[^{]*\.icone\s*\{[^}]*width:\s*\d+px/.test(facture),
      'les icônes svg doivent être dimensionnées pour ne pas occuper toute la carte');
  });
});

await bilan('Adaptation aux écrans');
