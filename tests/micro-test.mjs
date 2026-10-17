/* Micro-harnais de tests (sans dépendance) pour Agora Factures.
   Les tests sont mis en file puis exécutés séquentiellement : les fonctions
   asynchrones sont donc attendues correctement. */

let reussis = 0;
let echoues = 0;
const echecs = [];
const file = [];
let groupe = '';

export function decrire(nom, fn) {
  groupe = nom;
  file.push({ type: 'groupe', nom });
  fn();
  groupe = '';
}

export function test(nom, fn) {
  file.push({ type: 'test', nom, fn, groupe: groupe || 'Tests' });
}

export function egal(reel, attendu, message) {
  if (!Object.is(reel, attendu) && !(typeof reel === 'number' && typeof attendu === 'number' && Math.abs(reel - attendu) < 1e-9)) {
    throw new Error((message ? message + ' — ' : '') + 'attendu ' + JSON.stringify(attendu) + ', reçu ' + JSON.stringify(reel));
  }
}

export function proche(reel, attendu, tolerance, message) {
  if (Math.abs(reel - attendu) > (tolerance === undefined ? 1e-6 : tolerance)) {
    throw new Error((message ? message + ' — ' : '') + 'attendu ~' + attendu + ', reçu ' + reel);
  }
}

export function vrai(valeur, message) {
  if (!valeur) throw new Error(message || 'attendu vrai, reçu ' + JSON.stringify(valeur));
}

export function faux(valeur, message) {
  if (valeur) throw new Error(message || 'attendu faux, reçu ' + JSON.stringify(valeur));
}

export function jette(fn, message) {
  let jete = false;
  try { fn(); } catch (e) { jete = true; }
  if (!jete) throw new Error(message || 'une exception était attendue');
}

/** Exécute la file de tests et affiche le bilan. Retourne le nombre d'échecs. */
export async function executer(titre) {
  for (const entree of file) {
    if (entree.type === 'groupe') {
      console.log('\n\x1b[1m' + entree.nom + '\x1b[0m');
      continue;
    }
    try {
      await entree.fn();
      reussis++;
      console.log('  \x1b[32m✓\x1b[0m ' + entree.nom);
    } catch (e) {
      echoues++;
      const ligne = entree.groupe + ' > ' + entree.nom + ' : ' + e.message;
      echecs.push(ligne);
      console.log('  \x1b[31m✗ ' + entree.nom + '\x1b[0m\n      ' + e.message);
    }
  }
  console.log('\n' + '─'.repeat(60));
  console.log((titre || 'Tests') + ' : \x1b[32m' + reussis + ' réussis\x1b[0m, ' +
    (echoues ? '\x1b[31m' + echoues + ' échoués\x1b[0m' : '0 échoué'));
  if (echoues) {
    console.log('\nÉchecs :');
    echecs.forEach((l) => console.log('  - ' + l));
  }
  return echoues;
}

/** Ancien nom conservé pour compatibilité : exécute et clot le processus. */
export async function bilan(titre) {
  const nb = await executer(titre);
  process.exit(nb ? 1 : 0);
}
