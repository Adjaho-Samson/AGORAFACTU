/* ==========================================================================
   Tests d'intégration statique : cohérence des fichiers et des références.
   Vérifie que chaque ressource référencée (HTML, CSS, JS, manifest,
   Service Worker) existe réellement, et que les pages déclarent bien les
   identifiants attendus par les modules JavaScript.
   Exécution : node tests/ressources.test.mjs
   ========================================================================== */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decrire, test, egal, vrai, bilan } from './micro-test.mjs';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function listeFichiers(dossier, accumulateur = []) {
  for (const entree of readdirSync(dossier)) {
    if (['.git', 'node_modules', 'coverage', 'dist'].includes(entree)) continue;
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) listeFichiers(chemin, accumulateur);
    else accumulateur.push(chemin);
  }
  return accumulateur;
}

// « offline.html » est une page de repli volontairement autonome (aucun script,
// aucun stockage) : elle doit rester affichable même si tout le reste échoue.
const fichiersHtml = listeFichiers(RACINE)
  .filter((f) => f.endsWith('.html'))
  .filter((f) => !f.endsWith('offline.html'));

decrire('Structure du projet', () => {
  const attendus = [
    'index.html',
    'manifest.json',
    'sw.js',
    'README.md',
    'css/global.css',
    'css/document.css',
    'css/print.css',
    'css/dashboard.css',
    'css/facture.css',
    'css/historique.css',
    'css/parametres.css',
    'js/app.js',
    'js/calculs.js',
    'js/stockage.js',
    'js/parametres.js',
    'js/documents.js',
    'js/factures.js',
    'js/historique.js',
    'js/dashboard.js',
    'js/pdf.js',
    'js/pwa.js',
    'pages/dashboard.html',
    'pages/facture.html',
    'pages/historique.html',
    'pages/parametres.html',
    'lib/jspdf.umd.min.js',
    'assets/icons/icon-192.png',
    'assets/icons/icon-512.png',
    'assets/icons/icon-maskable-512.png',
    'assets/icons/apple-touch-icon.png'
  ];
  attendus.forEach((chemin) => {
    test('présent : ' + chemin, () => vrai(existsSync(resolve(RACINE, chemin)), 'fichier manquant'));
  });

  test('la logique est répartie dans plusieurs modules (garde-fou monofichier)', () => {
    const modules = listeFichiers(resolve(RACINE, 'js')).filter((f) => f.endsWith('.js'));
    vrai(modules.length >= 8, 'nombre de modules insuffisant : ' + modules.length);
    const total = modules.reduce((somme, f) => somme + statSync(f).size, 0);
    const plusGros = modules.map((f) => statSync(f).size).sort((a, b) => b - a)[0];
    vrai(plusGros < total * 0.4, 'un module concentre plus de 40 % du code applicatif');
  });
});

decrire('Références entre fichiers', () => {
  fichiersHtml.forEach((fichier) => {
    const contenu = readFileSync(fichier, 'utf8');
    const refs = [];
    const motifs = [
      /(?:src|href)="([^"]+)"/g,
      /url\(([^)]+)\)/g
    ];
    motifs.forEach((motif) => {
      let m;
      while ((m = motif.exec(contenu)) !== null) {
        let ref = m[1].replace(/^['"]|['"]$/g, '').trim();
        if (!ref) continue;
        if (/^(https?:)?\/\//.test(ref) || ref.startsWith('data:') || ref.startsWith('#') || ref.startsWith('mailto:')) continue;
        refs.push(ref.split('#')[0].split('?')[0]);
      }
    });
    [...new Set(refs)].forEach((ref) => {
      test(relative(RACINE, fichier) + ' → ' + ref, () => {
        const cible = resolve(dirname(fichier), ref);
        vrai(existsSync(cible), 'ressource introuvable : ' + cible);
      });
    });
  });

  test('le manifeste déclare des icônes existantes', () => {
    const manifeste = JSON.parse(readFileSync(resolve(RACINE, 'manifest.json'), 'utf8'));
    vrai(manifeste.icons.length >= 4, 'icônes insuffisantes');
    manifeste.icons.forEach((icone) => {
      vrai(existsSync(resolve(RACINE, icone.src)), 'icône manquante : ' + icone.src);
    });
    vrai(manifeste.icons.some((i) => i.purpose === 'maskable'), 'icône maskable absente');
    vrai(manifeste.icons.some((i) => i.sizes === '512x512'), 'icône 512 absente');
    egal(manifeste.display, 'standalone');
  });

  test('les raccourcis du manifeste pointent vers des pages existantes', () => {
    const manifeste = JSON.parse(readFileSync(resolve(RACINE, 'manifest.json'), 'utf8'));
    (manifeste.shortcuts || []).forEach((raccourci) => {
      const cible = resolve(RACINE, raccourci.url.split('?')[0]);
      vrai(existsSync(cible), 'page de raccourci manquante : ' + raccourci.url);
    });
  });

  test('le Service Worker précache des fichiers existants', () => {
    const sw = readFileSync(resolve(RACINE, 'sw.js'), 'utf8');
    const bloc = /var RESSOURCES = \[([\s\S]*?)\];/.exec(sw);
    vrai(!!bloc, 'liste RESSOURCES introuvable');
    const entrees = [...bloc[1].matchAll(/^\s*'([^'\n]*)',?\s*$/gm)].map((m) => m[1]);
    vrai(entrees.length > 20, 'précache trop petit : ' + entrees.length);
    entrees.forEach((entree) => {
      if (!entree) return;
      vrai(existsSync(resolve(RACINE, entree)), 'à précacher mais introuvable : ' + entree);
    });
    vrai(sw.includes("self.skipWaiting"), 'pas de mécanisme de mise à jour');
    vrai(sw.includes('FORCER_ACTIVATION'), 'pas de message de mise à jour');
  });

  test('les principales balises HTML sont fermées (contrôle simple)', () => {
    fichiersHtml.forEach((fichier) => {
      const contenu = readFileSync(fichier, 'utf8');
      ['<html', '</html>', '<body', '</body>', '<main', '</main>'].forEach((balise) => {
        vrai(contenu.includes(balise), relative(RACINE, fichier) + ' : ' + balise + ' absent');
      });
    });
  });
});

decrire('Contrats DOM (identifiants attendus par les modules JS)', () => {
  const attendus = {
    'index.html': ['#indicateur-connexion', '#bouton-installer', '#zone-notifications'],
    'pages/dashboard.html': ['#periode-tableau-de-bord', '#kpi-encaisse', '#kpi-facture', '#kpi-reste',
      '#kpi-documents', '#kpi-payes', '#kpi-impayes', '#kpi-retard', '#kpi-annules',
      '#zone-graphique', '#zone-repartition', '#corps-recents', '#etat-vide-tableau-de-bord'],
    'pages/facture.html': ['#type-facture', '#type-recu', '#vendeur-nom', '#client-nom', '#doc-date',
      '#doc-devise', '#doc-modele', '#tva-active', '#tva-mode', '#remise-mode',
      '#corps-lignes', '#ajouter-ligne', '#zone-apercu', '#resume-total', '#resume-solde',
      '#bouton-brouillon', '#bouton-enregistrer', '#bouton-apercu', '#bouton-imprimer', '#bouton-pdf',
      '#paiement-montant', '#paiement-methode', '#paiement-date'],
    'pages/historique.html': ['#filtre-recherche', '#filtre-type', '#filtre-statut', '#filtre-periode',
      '#filtre-tri', '#filtre-sens', '#corps-historique', '#resume-historique', '#etat-vide-historique'],
    'pages/parametres.html': ['#formulaire-parametres', '#v-nom', '#devise', '#decimales',
      '#num-prefixe-facture', '#num-modele', '#num-remise', '#tva-active', '#tva-taux',
      '#doc-modele', '#imp-logo', '#stock-rappel', '#bouton-exporter', '#fichier-import',
      '#bouton-effacer', '#a-propos-version', '#liste-compteurs']
  };
  Object.entries(attendus).forEach(([page, identifiants]) => {
    const contenu = readFileSync(resolve(RACINE, page), 'utf8');
    test(page + ' : identifiants requis', () => {
      identifiants.forEach((id) => {
        const motif = new RegExp('id="' + id.slice(1) + '"');
        vrai(motif.test(contenu), 'identifiant manquant : ' + id);
      });
    });
  });

  test('chaque page charge les modules de base dans le bon ordre', () => {
    fichiersHtml.forEach((fichier) => {
      const contenu = readFileSync(fichier, 'utf8');
      const scripts = [...contenu.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
      const indexApp = scripts.findIndex((s) => s.endsWith('js/app.js'));
      vrai(indexApp !== -1, relative(RACINE, fichier) + ' : app.js absent');
      const indexPwa = scripts.findIndex((s) => s.endsWith('js/pwa.js'));
      if (indexPwa !== -1) vrai(indexPwa > indexApp, 'pwa.js doit être après app.js');
    });
  });

  test('chaque page déclare data-page pour l’initialisation', () => {
    fichiersHtml.forEach((fichier) => {
      const contenu = readFileSync(fichier, 'utf8');
      vrai(/<body data-page="[a-z]+"/.test(contenu), relative(RACINE, fichier) + ' : data-page absent');
    });
  });
});

decrire('Bonnes pratiques de sécurité', () => {
  const fichiersJs = listeFichiers(resolve(RACINE, 'js')).concat([resolve(RACINE, 'sw.js')]);

  test('aucun eval()', () => {
    fichiersJs.forEach((f) => {
      const contenu = readFileSync(f, 'utf8');
      vrai(!/\beval\s*\(/.test(contenu), relative(RACINE, f) + ' utilise eval()');
    });
  });

  test('aucun secret ni URL distante dans le code applicatif', () => {
    fichiersJs.forEach((f) => {
      const contenu = readFileSync(f, 'utf8');
      const urls = [...contenu.matchAll(/https?:\/\/[^\s'"`)]+/g)].map((m) => m[0]);
      urls.forEach((u) => {
        vrai(u.includes('www.w3.org'), 'URL externe inattendue dans ' + relative(RACINE, f) + ' : ' + u);
      });
      vrai(!/api[_-]?key|secret|token\s*[:=]/i.test(contenu), 'secret potentiel dans ' + relative(RACINE, f));
    });
  });

  test('les insertions de texte utilisateur passent par textContent (pas innerHTML direct)', () => {
    const sensible = ['js/documents.js', 'js/historique.js', 'js/dashboard.js'];
    sensible.forEach((f) => {
      const contenu = readFileSync(resolve(RACINE, f), 'utf8');
      const dynamique = [...contenu.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1]);
      dynamique.forEach((expression) => {
        vrai(/^\s*(''|""|'<|"<)/.test(expression) || /app\.icone|icone\(/.test(expression),
          'innerHTML avec contenu dynamique dans ' + f + ' : ' + expression.trim().slice(0, 60));
      });
    });
  });

  test('aucun envoi réseau (fetch/XMLHttpRequest vers un serveur)', () => {
    const fichiers = fichiersJs.filter((f) => !f.endsWith('sw.js'));
    fichiers.forEach((f) => {
      const contenu = readFileSync(f, 'utf8');
      vrai(!/\bXMLHttpRequest\b/.test(contenu), relative(RACINE, f) + ' utilise XMLHttpRequest');
      const fetches = [...contenu.matchAll(/fetch\s*\(([^)]*)\)/g)].map((m) => m[1]);
      fetches.forEach((argument) => {
        vrai(!/https?:\/\//.test(argument), 'fetch distant dans ' + relative(RACINE, f));
      });
    });
  });
});

await bilan('Ressources et structure');
