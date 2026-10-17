/* ==========================================================================
   Tests d'accessibilité (contrastes, libellés, navigation clavier).
   --------------------------------------------------------------------------
   Les contrastes sont RÉELLEMENT calculés (formule WCAG 2.1) à partir des
   variables de thème déclarées dans les feuilles de style : une régression de
   couleur est donc détectée automatiquement.
   Exécution : node tests/accessibilite.test.mjs
   ========================================================================== */
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { decrire, test, egal, vrai, bilan } from './micro-test.mjs';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lire = (chemin) => readFileSync(join(RACINE, chemin), 'utf8');
const PAGES = ['index.html', 'offline.html', 'pages/dashboard.html', 'pages/facture.html',
  'pages/historique.html', 'pages/parametres.html'];
// « offline.html » est une page de repli sans script : elle n'a ni notifications
// ni lien d'évitement (aucune interaction possible). Les autres contrôles
// d'accessibilité (langue, titres, contrastes) s'y appliquent normalement.
const PAGES_SANS_SCRIPT = ['offline.html'];

/* --------------------------------------------------------- contrastes */
function luminanceRelative(hex) {
  const h = hex.replace('#', '');
  const composantes = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lineaires = composantes.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lineaires[0] + 0.7152 * lineaires[1] + 0.0722 * lineaires[2];
}

function contraste(couleur1, couleur2) {
  const l1 = luminanceRelative(couleur1);
  const l2 = luminanceRelative(couleur2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Lit les variables CSS déclarées dans :root (global.css). */
function variablesTheme() {
  const css = lire('css/global.css');
  const bloc = /:root\s*\{([\s\S]*?)\}/.exec(css);
  const variables = {};
  [...bloc[1].matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)].forEach((m) => {
    variables[m[1]] = m[2];
  });
  return variables;
}

const T = variablesTheme();

/* Paires « texte / fond » réellement utilisées par l'interface. */
const PAIRES = [
  ['texte principal sur blanc', T['--texte'], '#ffffff', 4.5],
  ['texte secondaire sur blanc', T['--texte-doux'], '#ffffff', 4.5],
  ['texte atténué sur blanc (aides, légendes)', T['--texte-faible'], '#ffffff', 4.5],
  ['texte atténué sur fond gris', T['--texte-faible'], T['--gris-clair'], 4.5],
  ['texte secondaire sur fond gris', T['--texte-doux'], T['--gris-clair'], 4.5],
  ['texte orange sur blanc (soldes, remises)', T['--orange-texte'], '#ffffff', 4.5],
  ['vert « succès » sur blanc', T['--vert'], '#ffffff', 4.5],
  ['rouge « danger » sur blanc', T['--rouge'], '#ffffff', 4.5],
  ['bleu foncé sur blanc (titres)', T['--bleu-fonce'], '#ffffff', 4.5],
  ['lien bleu sur blanc', T['--bleu'], '#ffffff', 4.5],
  ['texte sur bouton principal', '#ffffff', T['--bleu-fonce'], 4.5],
  ['texte sur bouton danger', '#ffffff', T['--rouge'], 4.5],
  ['pastille verte', T['--vert'], T['--vert-pale'], 4.5],
  ['pastille rouge', T['--rouge'], T['--rouge-pale'], 4.5],
  ['pastille bleue', T['--bleu-fonce'], T['--bleu-pale'], 4.5],
  ['pastille orange', T['--orange-texte'], T['--orange-pale'], 4.5],
  ['pastille grise', T['--texte-doux'], T['--gris'], 4.5],
  ['alerte information', '#10416f', T['--bleu-pale'], 4.5],
  ['alerte avertissement', '#8a4b00', T['--orange-pale'], 4.5],
  ['alerte erreur', '#8f1d1d', T['--rouge-pale'], 4.5],
  ['notification succès', '#ffffff', '#137a3a', 4.5],
  ['notification avertissement', '#ffffff', '#a75b00', 4.5],
  ['lien de navigation', '#cfe0f5', T['--bleu-fonce-2'], 4.5],
  ['indicateur de connexion', '#e8f1fd', T['--bleu-fonce'], 4.5],
];

decrire('Contrastes (WCAG 2.1 AA)', () => {
  test('toutes les variables de couleur sont bien déclarées', () => {
    ['--texte', '--texte-doux', '--texte-faible', '--orange-texte', '--vert', '--rouge',
      '--bleu-fonce', '--bleu', '--blanc', '--gris-clair', '--gris'].forEach((cle) => {
      vrai(!!T[cle], 'variable manquante : ' + cle);
    });
  });

  PAIRES.forEach(([nom, texte, fond, seuil]) => {
    test('contraste AA : ' + nom, () => {
      const ratio = contraste(texte, fond);
      vrai(ratio >= seuil, nom + ' : ' + ratio.toFixed(2) + ':1 (minimum ' + seuil + ':1) — ' +
        texte + ' sur ' + fond);
    });
  });

  test('toutes les couleurs de texte du document A4 sont lisibles sur blanc', () => {
    // La feuille « document » (facture, devis, reçu) a un fond blanc uniforme :
    // chaque couleur de texte déclarée peut donc être vérifiée isolément.
    const css = lire('css/document.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const couleurs = new Set([...css.matchAll(/(?:^|[^\w-])color:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1]));
    vrai(couleurs.size >= 4, 'aucune couleur de texte détectée (analyse à revoir)');
    couleurs.forEach((couleur) => {
      const ratio = contraste(couleur, '#ffffff');
      vrai(ratio >= 4.5, 'document.css : ' + couleur + ' sur blanc = ' + ratio.toFixed(2) + ':1 (minimum 4,5:1)');
    });
  });

  test('la feuille A4 ne peut pas déborder horizontalement', () => {
    const css = lire('css/document.css');
    const regle = /\.doc\s*\{([\s\S]*?)\}/.exec(css);
    vrai(/max-width:\s*100%/.test(regle[1]),
      '« width: 210mm » sans max-width provoque un débordement de ~474 px sur mobile');
  });

  test('le gris « atténué » n\'est plus utilisé à 3:1', () => {
    // Ancienne valeur #8a95a5 : 3,03:1 sur blanc (échec AA).
    vrai(contraste(T['--texte-faible'], '#ffffff') >= 4.5,
      'contraste insuffisant : ' + contraste(T['--texte-faible'], '#ffffff').toFixed(2));
  });
});

/* ------------------------------------------------------------- structure */
decrire('Structure et sémantique des pages', () => {
  PAGES.forEach((page) => {
    test(page + ' : langue, titre unique et zone de notification', () => {
      const html = lire(page);
      if (PAGES_SANS_SCRIPT.includes(page)) {
        vrai(/<html lang="fr">/.test(html), page + ' : langue non déclarée');
        egal([...html.matchAll(/<h1[\s>]/g)].length, 1, page + ' : un seul <h1> attendu');
        return;
      }
      vrai(/<html lang="fr">/.test(html), page + ' : langue non déclarée');
      const titres = [...html.matchAll(/<h1[\s>]/g)].length;
      egal(titres, 1, page + ' : un seul <h1> par page attendu (' + titres + ' trouvés)');
      vrai(/id="zone-notifications"/.test(html) && /aria-live="polite"/.test(html),
        page + ' : zone de notification absente');
      vrai(/<nav[^>]*aria-label="Navigation principale"/.test(html), page + ' : navigation non nommée');
    });

    test(page + ' : lien d\'évitement et cible principale', () => {
      const html = lire(page);
      if (PAGES_SANS_SCRIPT.includes(page)) return;   // page de repli, sans navigation
      const lien = /<a class="lien-evitement" href="#([\w-]+)">/.exec(html);
      vrai(!!lien, page + ' : lien d\'évitement absent');
      vrai(new RegExp('id="' + lien[1] + '"').test(html), page + ' : cible « ' + lien[1] + ' » absente');
    });

    test(page + ' : toutes les images ont un attribut alt', () => {
      const html = lire(page);
      const images = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
      images.forEach((balise) => vrai(/\balt=/.test(balise), page + ' : image sans alt → ' + balise));
    });

    test(page + ' : aucun tabindex positif (ordre de tabulation naturel)', () => {
      const html = lire(page);
      const positifs = [...html.matchAll(/tabindex="([1-9]\d*)"/g)];
      egal(positifs.length, 0, page + ' : tabindex positif interdit');
    });
  });

  test('un style de focus visible est déclaré', () => {
    const global = lire('css/global.css');
    vrai(/:focus-visible\s*\{[^}]*outline/.test(global), 'aucun contour de focus');
    const facture = lire('css/facture.css');
    vrai(/:focus-visible/.test(facture), 'le focus des choix de type doit être visible');
  });
});

/* ------------------------------------------------------------- libellés */
function controlesSansLibelle(html) {
  const motifs = [...html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)];
  const idsLabelles = new Set([...html.matchAll(/<label[^>]*for="([^"]+)"/g)].map((m) => m[1]));
  // Libellé implicite : <label …><input id="x"> texte</label>
  [...html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)].forEach((bloc) => {
    [...bloc[1].matchAll(/<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"/g)].forEach((m) => {
      idsLabelles.add(m[1]);
    });
  });
  return motifs.filter(([, balise, attributs]) => {
    if (/\btype="(hidden|submit|button|reset)"/.test(attributs)) return false;
    if (/\baria-label=/.test(attributs) || /\baria-labelledby=/.test(attributs)) return false;
    const id = /\bid="([^"]+)"/.exec(attributs);
    if (id && idsLabelles.has(id[1])) return false;
    return true;
  }).map(([, balise, attributs]) => balise + ' ' + attributs.slice(0, 90));
}

decrire('Libellés des champs et des boutons', () => {
  PAGES.forEach((page) => {
    test(page + ' : chaque champ a un libellé associé', () => {
      const orphelins = controlesSansLibelle(lire(page));
      egal(orphelins.join(' | '), '', page + ' : champs sans libellé → ' + orphelins.join(' | '));
    });
  });

  test('les boutons créés dynamiquement portent un nom accessible', async () => {
    const { IDBFactory } = await import('fake-indexeddb');
    const html = lire('pages/historique.html');
    const dom = new JSDOM(html, { url: 'https://app.local/pages/historique.html', runScripts: 'dangerously', pretendToBeVisual: true });
    const { window } = dom;
    window.indexedDB = new IDBFactory();
    const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
    for (const src of scripts) {
      const element = window.document.createElement('script');
      element.textContent = readFileSync(resolve(RACINE, 'pages', src.replace('../', '../')), 'utf8');
      window.document.body.appendChild(element);
    }
    // Un document pour que le tableau se remplisse.
    await window.AGORA.stockage.enregistrerDocument({
      type: 'facture', numero: 'F-2026-0001', statut: 'en_attente', dateEmission: '2026-01-01',
      devise: 'XOF', vendeur: { nom: 'V' }, client: { nom: 'C' },
      lignes: [{ designation: 'A', quantite: 1, prixUnitaire: 1000, remise: 0, tauxTva: 0 }], paiements: []
    });
    await window.AGORA.historique.rafraichir();
    const boutons = [...window.document.querySelectorAll('#corps-historique button')];
    vrai(boutons.length >= 4, 'boutons d\'action non générés : ' + boutons.length);
    boutons.forEach((b) => {
      const nom = (b.getAttribute('aria-label') || b.textContent || '').trim();
      vrai(nom.length > 0, 'bouton sans nom accessible : ' + b.outerHTML.slice(0, 80));
    });
  });

  test('les messages d\'erreur de champ sont reliés au champ (aria-describedby)', () => {
    const source = lire('js/app.js');
    vrai(/aria-describedby/.test(source), 'les erreurs doivent être annoncées par les lecteurs d\'écran');
    vrai(/aria-invalid/.test(source), 'l\'état invalide doit être exposé');
  });

  test('les modales piègent le focus et le restaurent', () => {
    const source = lire('js/app.js');
    vrai(/piège de focus|Piège de focus/.test(source), 'aucun piège de focus dans les modales');
    vrai(/aria-modal/.test(source), 'aria-modal absent');
    vrai(/role:\s*'dialog'/.test(source), 'role=dialog absent');
    vrai(/_focusPrecedent/.test(source), 'le focus précédent doit être restauré');
    vrai(/inert/.test(source), 'l\'arrière-plan doit être rendu inerte');
  });
});

await bilan('Accessibilité');
