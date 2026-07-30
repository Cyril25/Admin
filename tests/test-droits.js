// ============================================================
// test-droits.js — Le modele de droits du hub
// ============================================================
// Verifie qui voit quoi, et ce que fait (et ne fait pas) l'impersonation.
// On charge config.js + projets.js + sites.js + auth.js dans un contexte
// « vm » avec un DOM minimal simule, puis on pilote HUB a la main.
//
// Lancer :  node tests/test-droits.js
// Sans dependance : ni npm, ni framework — comme le reste du projet.
//
// C'EST LE FILET DU SYSTEME D'ACCES. Si une modification de auth.js,
// projets.js ou firestore.rules fait passer un test au rouge, c'est
// qu'un membre voit quelque chose qu'il ne devrait pas — ou l'inverse.
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.join(__dirname, '..');

const stockage = {};
const sandbox = {
  console,
  document: {
    addEventListener() {},
    getElementById() { return null; },
    body: { getAttribute() { return null; }, classList: { add() {} } },
    createElement() { return { appendChild() {}, innerHTML: '' }; },
    createTextNode(t) { return { data: String(t) }; },
  },
  sessionStorage: {
    getItem: (k) => (k in stockage ? stockage[k] : null),
    setItem: (k, v) => { stockage[k] = v; },
    removeItem: (k) => { delete stockage[k]; },
  },
  location: { pathname: '/index.html', search: '', href: '' },
};
vm.createContext(sandbox);
sandbox.window = sandbox;               // comme dans un navigateur

for (const f of ['config.js', 'projets.js', 'sites.js', 'auth.js']) {
  vm.runInContext(fs.readFileSync(path.join(REPO, f), 'utf8'), sandbox);
}

let echecs = 0;
function verifie(nom, condition, detail) {
  if (condition) console.log('  ok   ' + nom);
  else { console.log('  ECHEC ' + nom + (detail ? ' -> ' + detail : '')); echecs++; }
}

// Installe une situation : qui est connecte, quelle fiche, quelle vue.
function situation(emailConnecte, fiche, ficheEffective) {
  sandbox.HUB.user = emailConnecte ? { email: emailConnecte } : null;
  sandbox.HUB.membre = fiche;
  sandbox.HUB.effectif = ficheEffective || fiche;
  sandbox.HUB.impersonation = ficheEffective && fiche && ficheEffective !== fiche ? ficheEffective.email : '';
}

const PROPRIO = 'cyril.samson41@gmail.com';
const ficheProprio = { email: PROPRIO, nom: 'Cyril', role: 'superadmin', projets: [], sites: [], actif: true };
const ficheCopine = { email: 'marie@gmail.com', nom: 'Marie', role: 'membre', projets: ['exterieur'], sites: ['ofildudoubs'], actif: true };
const ficheSansRien = { email: 'x@gmail.com', nom: 'X', role: 'membre', projets: [], actif: true };

const slugs = (l) => l.map((p) => p.slug).join(',');

// --- 1. Superadmin -------------------------------------------------
console.log('\n1. Superadmin');
situation(PROPRIO, ficheProprio);
// La liste attendue vient du registre : ajouter un projet ne doit pas
// faire echouer ce test-la, seulement ceux qui verifient sa coherence.
verifie('voit tous les sous-projets',
  slugs(sandbox.projetsVisibles()) === slugs(sandbox.PROJETS), slugs(sandbox.projetsVisibles()));
// Le menu, lui, laisse de cote les projets herbergés ailleurs : un lien
// de navigation qui quitte le site n'est pas un lien de navigation.
verifie('le menu ne retient que les projets herberges ici',
  sandbox.projetsDuMenu().every((p) => !p.externe)
  && sandbox.projetsDuMenu().length === sandbox.PROJETS.filter((p) => !p.externe).length,
  slugs(sandbox.projetsDuMenu()));
verifie('a acces a idees', sandbox.aAcces('idees'));
verifie('a acces a exterieur', sandbox.aAcces('exterieur'));
verifie('aura acces a un sous-projet futur non liste', sandbox.aAcces('projet-invente-demain'));
verifie('est superadmin (reel et vu)', sandbox.estSuperadminReel() && sandbox.estSuperadmin());

// --- 2. Membre restreint -------------------------------------------
console.log('\n2. Membre restreint (la copine)');
situation('marie@gmail.com', ficheCopine);
verifie('ne voit que exterieur', slugs(sandbox.projetsVisibles()) === 'exterieur', slugs(sandbox.projetsVisibles()));
verifie('acces a exterieur', sandbox.aAcces('exterieur'));
verifie('PAS d\'acces a idees', !sandbox.aAcces('idees'));
verifie('PAS superadmin', !sandbox.estSuperadmin() && !sandbox.estSuperadminReel());

console.log('\n3. Membre sans aucun droit');
situation('x@gmail.com', ficheSansRien);
verifie('ne voit rien', sandbox.projetsVisibles().length === 0);
verifie('aucun acces', !sandbox.aAcces('idees') && !sandbox.aAcces('exterieur'));

// --- 4. Filet du proprietaire ---------------------------------------
console.log('\n4. Filet anti-verrouillage du proprietaire');
situation(PROPRIO, { email: PROPRIO, nom: 'Cyril', role: 'membre', projets: [], actif: true });
verifie('reste superadmin REEL meme si sa fiche dit "membre"', sandbox.estSuperadminReel());
verifie('l\'adresse du proprietaire est bien celle des regles', sandbox.SUPERADMIN_EMAIL === PROPRIO);

// Meme en majuscules, l'adresse doit etre reconnue
situation('Cyril.Samson41@Gmail.com', { email: PROPRIO, role: 'membre', projets: [], actif: true });
verifie('insensible a la casse de l\'email', sandbox.estSuperadminReel());

// --- 5. Impersonation ------------------------------------------------
console.log('\n5. Impersonation');
situation(PROPRIO, ficheProprio, ficheCopine);
verifie('la VUE devient celle de la copine', slugs(sandbox.projetsVisibles()) === 'exterieur', slugs(sandbox.projetsVisibles()));
verifie('la vue perd le statut superadmin (menu Membres cache)', !sandbox.estSuperadmin());
verifie('les droits REELS restent superadmin', sandbox.estSuperadminReel());
verifie('la vue perd l\'acces a idees', !sandbox.aAcces('idees'));

// Un non-superadmin ne doit pas pouvoir declencher l'impersonation.
console.log('\n6. Garde-fou de l\'impersonation');
situation('marie@gmail.com', ficheCopine);
delete stockage.hubImpersonation;
sandbox.demarrerImpersonation(PROPRIO);
verifie('un membre simple ne peut pas impersonner', stockage.hubImpersonation === undefined,
  'valeur posee = ' + stockage.hubImpersonation);

situation(PROPRIO, ficheProprio);
sandbox.demarrerImpersonation('MARIE@gmail.com');
verifie('le superadmin peut, et l\'email est normalise',
  stockage.hubImpersonation === 'marie@gmail.com', String(stockage.hubImpersonation));

// --- 7. Coherence registre / regles -----------------------------------
console.log('\n7. Coherence registre <-> regles Firestore');
const regles = fs.readFileSync(path.join(REPO, 'firestore.rules'), 'utf8');
for (const p of sandbox.PROJETS) {
  // Vrai pour TOUS les projets, y compris ceux herberges ailleurs : les
  // regles couvrent le projet Firebase entier, pas un domaine.
  verifie('la collection « ' + p.slug + ' » a un bloc match dans les regles',
    new RegExp('match /' + p.slug + '/\\{').test(regles));

  if (p.externe) {
    // Pas de dossier local a verifier : les pages vivent dans un autre
    // depot. On verifie ce qui est verifiable d'ici — une URL absolue en
    // https, sans quoi la tuile d'accueil partirait en lien relatif.
    verifie('le projet externe « ' + p.slug + ' » pointe une URL absolue https',
      /^https:\/\//.test(p.url), p.url);
  } else {
    verifie('le dossier « ' + p.url + ' » existe avec un index.html',
      fs.existsSync(path.join(REPO, p.url, 'index.html')));
  }
}
verifie('les regles referencent la meme adresse proprietaire que config.js',
  regles.indexOf("'" + sandbox.SUPERADMIN_EMAIL + "'") !== -1);
verifie('un catch-all ferme le reste', /match \/\{document=\*\*\}[\s\S]*?if false/.test(regles));

// --- 8. Sites (raccourcis, pas des droits sur des donnees) -------------
console.log('\n8. Sites');
const slugsSites = (l) => l.map((s) => s.slug).join(',');

situation(PROPRIO, ficheProprio);
verifie('le superadmin voit tous les sites',
  sandbox.sitesVisibles().length === sandbox.SITES.length,
  sandbox.sitesVisibles().length + '/' + sandbox.SITES.length);
verifie('y compris un site ajoute plus tard', sandbox.aAccesSite('site-invente-demain'));

situation('marie@gmail.com', ficheCopine);
verifie('la copine ne voit que le site coche',
  slugsSites(sandbox.sitesVisibles()) === 'ofildudoubs', slugsSites(sandbox.sitesVisibles()));
verifie('pas les autres sites', !sandbox.aAccesSite('billets') && !sandbox.aAccesSite('lephare'));

situation('x@gmail.com', ficheSansRien);
verifie('une fiche sans champ sites ne plante pas et ne voit rien',
  sandbox.sitesVisibles().length === 0);

situation(PROPRIO, ficheProprio, ficheCopine);
verifie('sous impersonation, la vue des sites suit aussi',
  slugsSites(sandbox.sitesVisibles()) === 'ofildudoubs', slugsSites(sandbox.sitesVisibles()));

verifie('aucun site n\'a de bloc match dans les regles (ce sont des liens)',
  sandbox.SITES.every((s) => !new RegExp('match /' + s.slug + '/\\{').test(regles)));

console.log('\n' + (echecs === 0 ? 'Tous les tests passent.' : echecs + ' test(s) en echec.'));
process.exit(echecs === 0 ? 0 : 1);
