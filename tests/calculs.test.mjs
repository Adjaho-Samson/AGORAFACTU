/* Tests unitaires du moteur de calcul — exécution : npm test  (ou node tests/calculs.test.mjs) */
import calculs from '../js/calculs.js';
import { decrire, test, egal, proche, vrai, faux, bilan } from './micro-test.mjs';

const base = {
  lignes: [
    { designation: 'A', quantite: 2, prixUnitaire: 100, remise: 0, tauxTva: 18 }
  ],
  tvaActive: true,
  tvaMode: 'exclusive',
  modeRemise: 'pourcent',
  remiseGlobale: { type: 'pourcent', valeur: 0 },
  paiements: []
};

decrire('Arrondis monétaires', () => {
  test('arrondi half-up de 1,005 -> 1,01', () => egal(calculs.arrondir(1.005), 1.01));
  test('arrondi half-up de 2,675 -> 2,68', () => egal(calculs.arrondir(2.675), 2.68));
  test('arrondi négatif symétrique', () => egal(calculs.arrondir(-1.005), -1.01));
  test('conversion en centimes stable', () => egal(calculs.versCentimes('1 234,56'), 123456));
  test('0,1 + 0,2 arrondi donne 0,3', () => egal(calculs.arrondir(0.1 + 0.2), 0.3));
  test('pas de NaN sur une saisie invalide', () => egal(calculs.arrondir('abc'), 0));
  test('estNombre rejette le texte', () => {
    vrai(calculs.estNombre('12,5'));
    faux(calculs.estNombre('12,5,5'));
    faux(calculs.estNombre(''));
  });
});

decrire('Calcul d’une ligne', () => {
  test('ligne simple HT + TVA 18 %', () => {
    const l = calculs.calculerLigne({ quantite: 3, prixUnitaire: 10.5, remise: 0, tauxTva: 18 }, {});
    egal(l.brut, 31.5);
    egal(l.tva, 5.67);
    egal(l.total, 37.17);
  });

  test('remise en pourcentage', () => {
    const l = calculs.calculerLigne({ quantite: 1, prixUnitaire: 100, remise: 10, tauxTva: 18 },
      { modeRemise: 'pourcent' });
    egal(l.brut, 100);
    egal(l.remise, 10);
    egal(l.base, 90);
    egal(l.tva, 16.2);
    egal(l.total, 106.2);
  });

  test('remise en montant', () => {
    const l = calculs.calculerLigne({ quantite: 1, prixUnitaire: 100, remise: 25, tauxTva: 0 },
      { modeRemise: 'montant' });
    egal(l.remise, 25);
    egal(l.total, 75);
  });

  test('remise en montant plafonnée au montant de la ligne', () => {
    const l = calculs.calculerLigne({ quantite: 1, prixUnitaire: 10, remise: 999, tauxTva: 0 },
      { modeRemise: 'montant' });
    egal(l.remise, 10);
    egal(l.total, 0);
  });

  test('remise en pourcentage bornée à 100', () => {
    const l = calculs.calculerLigne({ quantite: 1, prixUnitaire: 50, remise: 250, tauxTva: 0 },
      { modeRemise: 'pourcent' });
    egal(l.remise, 50);
  });

  test('TVA désactivée', () => {
    const l = calculs.calculerLigne({ quantite: 1, prixUnitaire: 100, remise: 0, tauxTva: 18 },
      { tvaActive: false });
    egal(l.tva, 0);
    egal(l.total, 100);
  });

  test('taux de TVA à 0 autorisé', () => {
    const l = calculs.calculerLigne({ quantite: 1, prixUnitaire: 100, remise: 0, tauxTva: 0 }, {});
    egal(l.total, 100);
  });

  test('prix TTC (TVA incluse) : extraction de la TVA', () => {
    const l = calculs.calculerLigne({ quantite: 1, prixUnitaire: 118, remise: 0, tauxTva: 18 },
      { tvaMode: 'inclusive' });
    egal(l.base, 100);
    egal(l.tva, 18);
    egal(l.total, 118);
  });

  test('valeurs négatives ou invalides ramenées à 0', () => {
    const l = calculs.calculerLigne({ quantite: 'abc', prixUnitaire: null, remise: undefined, tauxTva: 'x' }, {});
    egal(l.brut, 0);
    egal(l.total, 0);
  });
});

decrire('Calcul d’un document', () => {
  test('document simple', () => {
    const m = calculs.calculerDocument(base);
    egal(m.sousTotal, 200);
    egal(m.remisesLignes, 0);
    egal(m.baseImposable, 200);
    egal(m.tva, 36);
    egal(m.total, 236);
    egal(m.totalPaye, 0);
    egal(m.solde, 236);
  });

  test('le total est la somme exacte des totaux de ligne', () => {
    const doc = {
      lignes: [
        { quantite: 3, prixUnitaire: 19.99, remise: 7.5, tauxTva: 18 },
        { quantite: 1.5, prixUnitaire: 1250, remise: 0, tauxTva: 10 },
        { quantite: 7, prixUnitaire: 3.33, remise: 12, tauxTva: 5.5 }
      ],
      tvaActive: true,
      tvaMode: 'exclusive',
      modeRemise: 'pourcent',
      remiseGlobale: { type: 'montant', valeur: 13.37 },
      paiements: []
    };
    const m = calculs.calculerDocument(doc);
    const sommeLignes = m.lignes.reduce((a, l) => a + l.total, 0);
    proche(m.total, Math.round(sommeLignes * 100) / 100, 0.011);
    proche(m.baseImposable + m.tva, m.total, 0.0001);
  });

  test('remise globale en pourcentage', () => {
    const doc = JSON.parse(JSON.stringify(base));
    doc.lignes = [{ quantite: 1, prixUnitaire: 1000, remise: 0, tauxTva: 10 }];
    doc.remiseGlobale = { type: 'pourcent', valeur: 10 };
    const m = calculs.calculerDocument(doc);
    egal(m.remiseGlobale, 100);
    egal(m.baseImposable, 900);
    egal(m.tva, 90);
    egal(m.total, 990);
  });

  test('remise globale en montant', () => {
    const doc = JSON.parse(JSON.stringify(base));
    doc.lignes = [{ quantite: 1, prixUnitaire: 1000, remise: 0, tauxTva: 10 }];
    doc.remiseGlobale = { type: 'montant', valeur: 250 };
    const m = calculs.calculerDocument(doc);
    egal(m.remiseGlobale, 250);
    egal(m.tva, 75);
    egal(m.total, 825);
  });

  test('remise globale plafonnée au montant dû', () => {
    const doc = JSON.parse(JSON.stringify(base));
    doc.lignes = [{ quantite: 1, prixUnitaire: 100, remise: 0, tauxTva: 0 }];
    doc.remiseGlobale = { type: 'montant', valeur: 5000 };
    const m = calculs.calculerDocument(doc);
    egal(m.remiseGlobale, 100);
    egal(m.total, 0);
  });

  test('TVA multi-taux : somme des lignes', () => {
    const doc = {
      lignes: [
        { quantite: 1, prixUnitaire: 100, remise: 0, tauxTva: 18 },
        { quantite: 1, prixUnitaire: 200, remise: 0, tauxTva: 10 }
      ],
      tvaActive: true, tvaMode: 'exclusive', modeRemise: 'pourcent',
      remiseGlobale: { type: 'pourcent', valeur: 0 }, paiements: []
    };
    const m = calculs.calculerDocument(doc);
    egal(m.tva, 38);
    egal(m.tvaParTaux.length, 2);
    egal(m.tvaParTaux[0].taux, 10);
    egal(m.tvaParTaux[0].tva, 20);
    egal(m.tvaParTaux[1].tva, 18);
  });

  test('paiements partiels : solde restant', () => {
    const doc = JSON.parse(JSON.stringify(base));
    doc.paiements = [{ montant: 100 }, { montant: 36 }];
    const m = calculs.calculerDocument(doc);
    egal(m.total, 236);
    egal(m.totalPaye, 136);
    egal(m.solde, 100);
  });

  test('document sans ligne', () => {
    const m = calculs.calculerDocument({ lignes: [], paiements: [] });
    egal(m.total, 0);
    egal(m.solde, 0);
  });

  test('montants toujours finis avec des saisies vides', () => {
    const m = calculs.calculerDocument({
      lignes: [{ quantite: '', prixUnitaire: '', remise: '', tauxTva: '' }],
      paiements: []
    });
    egal(m.total, 0);
    vrai(isFinite(m.total));
  });
});

decrire('Statuts', () => {
  test('retard déduit de l’échéance', () => {
    const doc = { statut: 'en_attente', dateEcheance: '2020-01-01' };
    vrai(calculs.estEnRetard(doc));
    egal(calculs.statutEffectif(doc), 'en_retard');
  });

  test('pas de retard sans échéance', () => {
    faux(calculs.estEnRetard({ statut: 'en_attente', dateEcheance: '' }));
  });

  test('pas de retard si payée', () => {
    faux(calculs.estEnRetard({ statut: 'payee', dateEcheance: '2020-01-01' }));
  });

  test('pas de retard si l’échéance est aujourd’hui', () => {
    faux(calculs.estEnRetard({ statut: 'en_attente', dateEcheance: calculs.aujourdhui() }));
  });

  test('statut dérivé du paiement', () => {
    egal(calculs.statutSelonPaiement(1000, 0, 'en_attente'), 'en_attente');
    egal(calculs.statutSelonPaiement(1000, 400, 'en_attente'), 'partielle');
    egal(calculs.statutSelonPaiement(1000, 1000, 'en_attente'), 'payee');
    egal(calculs.statutSelonPaiement(1000, 1200, 'en_attente'), 'payee');
    egal(calculs.statutSelonPaiement(1000, 500, 'annulee'), 'annulee');
  });
});

decrire('Formatage', () => {
  test('montant XOF sans décimale', () => {
    const s = calculs.formaterMontant(150000, 'XOF');
    vrai(/150\s?000/.test(s.replace(/ | /g, ' ')), 'reçu ' + s);
    vrai(s.indexOf('XOF') !== -1, 'code devise absent : ' + s);
  });

  test('montant EUR avec 2 décimales', () => {
    vrai(/1\s?234,56/.test(calculs.formaterMontant(1234.56, 'EUR')));
  });

  test('date au format français', () => egal(calculs.formaterDate('2026-10-15'), '15/10/2026'));
  test('date vide', () => egal(calculs.formaterDate(''), '—'));

  test('montant en lettres', () => {
    egal(calculs.montantEnLettres(0), 'Zéro');
    vrai(calculs.montantEnLettres(150000, 'XOF').toLowerCase().indexOf('cent') !== -1);
    vrai(calculs.montantEnLettres(1234).length > 5);
  });
});

await bilan('Moteur de calcul');
