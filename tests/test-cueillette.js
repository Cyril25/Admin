// ============================================================
// test-cueillette.js — Le calendrier de cueillette du Haut-Doubs
// ============================================================
// Lancer :  node tests/test-cueillette.js
//
// OU PORTE L'EFFORT. Cette page est une machine a dates : tout son
// interet tient dans « quel statut, aujourd'hui ? », et une erreur y est
// SILENCIEUSE — un calendrier faux reste un calendrier plausible. On
// pilote donc la date du jour a la main et on verifie les verdicts.
//
// Le cas a ne jamais casser est l'ISOLATION PAR SAISON : un forcage
// saisi pour 2026 ne doit rien changer en 2027. Sans ce garde-fou, le
// referentiel derive d'annee en annee, personne ne s'en apercoit, et
// l'outil devient pire que pas d'outil du tout.
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.join(__dirname, '..');
const DOSSIER = path.join(REPO, 'cueillette');

// --- DOM minimal -------------------------------------------------
const elements = {};
function fakeEl(id) {
  return { id, value: '', innerHTML: '', textContent: '', style: {}, className: '',
           getAttribute() { return null; }, focus() {}, remove() {}, appendChild() {} };
}
const document = {
  addEventListener() {},
  getElementById(id) { elements[id] = elements[id] || fakeEl(id); return elements[id]; },
  querySelectorAll() { return []; },
  body: { appendChild() {}, removeChild() {} },
  createElement(tag) {
    if (tag === 'a') { const a = { href: '', download: '', click() { telechargements.push({ href: a.href, download: a.download }); } }; return a; }
    let txt = '';
    return {
      appendChild(node) { txt += node.data; },
      get innerHTML() { return txt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    };
  },
  createTextNode(t) { return { data: String(t) }; },
};

const telechargements = [];
const blobs = new Map();
class FakeBlob { constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; } }
const FakeURL = {
  createObjectURL(blob) { const u = 'blob:' + blobs.size; blobs.set(u, blob); return u; },
  revokeObjectURL() {},
};

// Faux Firestore : ce qui PART en base compte plus que ce que l'ecran montre.
const ecritures = [];
const fauxDb = {
  collection(nom) {
    return {
      doc(id) {
        const reference = id || 'nouveau-doc';
        return {
          id: reference,
          update(data) { ecritures.push({ type: 'update', collection: nom, id: reference, data }); return Promise.resolve(); },
          delete() { ecritures.push({ type: 'delete', collection: nom, id: reference }); return Promise.resolve(); },
        };
      },
      add(data) { ecritures.push({ type: 'add', collection: nom, data }); return Promise.resolve({ id: 'nouveau-doc' }); },
      onSnapshot() {},
    };
  },
};

const toasts = [];
const sandbox = {
  document, console, Blob: FakeBlob, URL: FakeURL, JSON, Date, Promise,
  Object, Array, String, Number, Math, isNaN, parseInt, RegExp,
  firebase: { firestore: Object.assign(() => fauxDb, {
    FieldValue: { serverTimestamp: () => ({ __serveur: true }) },
  }) },
  window: { location: { pathname: '/cueillette/index.html', search: '' } },
};
sandbox.window.document = document;
vm.createContext(sandbox);

// Ce que auth.js fournit en vrai, simule : charger le vigile Firebase
// complet n'apporterait rien ici.
vm.runInContext(`
  var HUB = { user: null, membre: null, effectif: null, impersonation: '' };
  function normaliserEmail(e) { return String(e || '').trim().toLowerCase(); }
  function estSuperadmin() { return !!(HUB.effectif && HUB.effectif.role === 'superadmin'); }
  function escapeHtml(t){ var d=document.createElement('div'); d.appendChild(document.createTextNode(t==null?'':t)); return d.innerHTML; }
  function showToast(m, t){ toasts.push({ message: m, type: t }); }
`, sandbox);
sandbox.toasts = toasts;

// hub-utils.js pour de vrai : le charger ici est ce qui fait echouer ce
// test si index.html oubliait la balise <script>.
vm.runInContext(fs.readFileSync(path.join(REPO, 'hub-utils.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(DOSSIER, 'especes.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(DOSSIER, 'cueillette.js'), 'utf8'), sandbox);

let echecs = 0;
function verifie(nom, condition, detail) {
  if (condition) console.log('  ok   ' + nom);
  else { console.log('  ECHEC ' + nom + (detail ? ' -> ' + detail : '')); echecs++; }
}

const { statutEspece, evaluerCalendrier, construireForcage, ESPECES, getEspece } = sandbox;
const le = (annee, mois, jour) => new Date(annee, mois - 1, jour);
const statutDe = (id, date, forcages) => statutEspece(getEspece(id), forcages || [], date).statut;

// ==================================================================
// 1. Arithmetique des dates
// ==================================================================
console.log('\n1. Arithmetique des dates');
verifie('ecart de 0 jour entre une date et elle-meme',
  sandbox.ecartJours(le(2026, 7, 30), le(2026, 7, 30)) === 0);
verifie('ecart compte des jours pleins',
  sandbox.ecartJours(le(2026, 7, 30), le(2026, 8, 5)) === 6,
  String(sandbox.ecartJours(le(2026, 7, 30), le(2026, 8, 5))));
verifie('ecart negatif vers le passe',
  sandbox.ecartJours(le(2026, 8, 5), le(2026, 7, 30)) === -6);

// Le passage a l'heure d'ete fait une journee de 23 h : sans Math.round
// dans ecartJours, le compte se decale d'un jour deux fois par an.
verifie('le changement d\'heure de mars ne fausse pas le compte',
  sandbox.ecartJours(le(2026, 3, 28), le(2026, 3, 30)) === 2,
  String(sandbox.ecartJours(le(2026, 3, 28), le(2026, 3, 30))));
verifie('...celui d\'octobre non plus',
  sandbox.ecartJours(le(2026, 10, 24), le(2026, 10, 26)) === 2,
  String(sandbox.ecartJours(le(2026, 10, 24), le(2026, 10, 26))));

verifie('une fenetre normale ne chevauche pas l\'annee',
  sandbox.chevaucheAnnee({ mois: 4, jour: 15 }, { mois: 5, jour: 31 }) === false);
verifie('une fenetre nov -> fev chevauche l\'annee',
  sandbox.chevaucheAnnee({ mois: 11, jour: 1 }, { mois: 2, jour: 15 }) === true);
verifie('meme mois, fin apres debut : pas de chevauchement',
  sandbox.chevaucheAnnee({ mois: 6, jour: 1 }, { mois: 6, jour: 30 }) === false);
verifie('meme mois, fin avant debut : chevauchement',
  sandbox.chevaucheAnnee({ mois: 6, jour: 30 }, { mois: 6, jour: 1 }) === true);

// ==================================================================
// 2. Les statuts, sans aucun forcage
// ==================================================================
// Reference : la girolle (25 juin -> 31 oct) et la morille (15 avr -> 31 mai).
console.log('\n2. Statuts sur le referentiel seul');

verifie('girolle en plein aout : en cours',
  statutDe('girolle', le(2026, 8, 15)) === 'en_cours', statutDe('girolle', le(2026, 8, 15)));
verifie('girolle le jour exact de l\'ouverture : en cours',
  statutDe('girolle', le(2026, 6, 25)) === 'en_cours', statutDe('girolle', le(2026, 6, 25)));
verifie('girolle le jour exact de la fermeture : en cours',
  statutDe('girolle', le(2026, 10, 31)) === 'en_cours', statutDe('girolle', le(2026, 10, 31)));
verifie('girolle le lendemain de la fermeture : plus en cours',
  statutDe('girolle', le(2026, 11, 1)) !== 'en_cours', statutDe('girolle', le(2026, 11, 1)));

verifie('girolle deux semaines avant : bientot',
  statutDe('girolle', le(2026, 6, 12)) === 'bientot', statutDe('girolle', le(2026, 6, 12)));
verifie('girolle a 21 jours pile : encore bientot',
  statutDe('girolle', le(2026, 6, 4)) === 'bientot', statutDe('girolle', le(2026, 6, 4)));
verifie('girolle a 22 jours : plus tard',
  statutDe('girolle', le(2026, 6, 3)) === 'plus_tard', statutDe('girolle', le(2026, 6, 3)));

// LE test qui justifie le quatrieme statut. Fin juillet, le cepe de
// Bordeaux ouvre le 25 aout : ce n'est ni « en cours », ni « bientot »,
// et le ranger dans « termine » ferait passer la meilleure recolte de
// l'annee pour une occasion manquee.
console.log('\n   Le piege : « plus tard » n\'est pas « termine »');
verifie('le 30 juillet, le cepe (25 aout) est PLUS TARD, pas termine',
  statutDe('cepe', le(2026, 7, 30)) === 'plus_tard', statutDe('cepe', le(2026, 7, 30)));
verifie('le 30 juillet, la morille (avr-mai) est bien TERMINEE',
  statutDe('morille', le(2026, 7, 30)) === 'termine', statutDe('morille', le(2026, 7, 30)));
verifie('le 1er janvier, la morille n\'est pas terminee : elle n\'a pas commence',
  statutDe('morille', le(2026, 1, 1)) === 'plus_tard', statutDe('morille', le(2026, 1, 1)));
verifie('le 1er decembre, la morille reste terminee',
  statutDe('morille', le(2026, 12, 1)) === 'termine', statutDe('morille', le(2026, 12, 1)));

// ==================================================================
// 3. Forcages : les trois modes
// ==================================================================
console.log('\n3. Les trois modes de forcage');

const decalage = [{ espece: 'morille', annee: 2026, mode: 'decalage', jours: 14, motif: 'Gelees tardives a Mouthe', creePar: 'cyril@x.fr' }];
verifie('sans forcage, la morille est en cours le 20 mai',
  statutDe('morille', le(2026, 5, 20)) === 'en_cours');
verifie('decalee de +14 j, elle est encore en cours le 10 juin',
  statutDe('morille', le(2026, 6, 10), decalage) === 'en_cours',
  statutDe('morille', le(2026, 6, 10), decalage));
verifie('...et pas encore ouverte le 20 avril',
  statutDe('morille', le(2026, 4, 20), decalage) !== 'en_cours',
  statutDe('morille', le(2026, 4, 20), decalage));

const enAvance = [{ espece: 'morille', annee: 2026, mode: 'decalage', jours: -10, motif: 'Printemps precoce', creePar: 'cyril@x.fr' }];
verifie('un decalage negatif ouvre la fenetre plus tot',
  statutDe('morille', le(2026, 4, 8), enAvance) === 'en_cours',
  statutDe('morille', le(2026, 4, 8), enAvance));

const fenetre = [{ espece: 'girolle', annee: 2026, mode: 'fenetre',
                   debut: { mois: 8, jour: 1 }, fin: { mois: 8, jour: 20 },
                   motif: 'Canicule : une seule poussee', creePar: 'cyril@x.fr' }];
verifie('une fenetre imposee remplace les dates theoriques',
  statutDe('girolle', le(2026, 8, 10), fenetre) === 'en_cours');
verifie('...et ferme en dehors, la ou le referentiel disait oui',
  statutDe('girolle', le(2026, 9, 15), fenetre) !== 'en_cours',
  statutDe('girolle', le(2026, 9, 15), fenetre));

const suspension = [{ espece: 'cepe', annee: 2026, mode: 'suspension', motif: 'Arrete prefectoral', creePar: 'cyril@x.fr' }];
verifie('une suspension prend le pas sur une fenetre ouverte',
  statutDe('cepe', le(2026, 9, 20), suspension) === 'suspendu',
  statutDe('cepe', le(2026, 9, 20), suspension));
verifie('une suspension se voit aussi a l\'approche (bientot)',
  statutDe('cepe', le(2026, 8, 15), suspension) === 'suspendu',
  statutDe('cepe', le(2026, 8, 15), suspension));
// Une suspension lointaine ne doit pas remonter en tete toute l'annee :
// elle n'a d'interet que quand la fenetre est proche ou ouverte.
verifie('une suspension lointaine ne masque pas le statut normal',
  statutDe('cepe', le(2026, 3, 1), suspension) === 'plus_tard',
  statutDe('cepe', le(2026, 3, 1), suspension));

// ==================================================================
// 4. L'ISOLATION PAR SAISON — le garde-fou central
// ==================================================================
// Sans le champ `annee`, un decalage saisi pour une annee de gelees
// tardives resterait actif l'annee suivante. Le calendrier deriverait
// sans que rien ne le signale : c'est la panne silencieuse que ce
// mecanisme existe pour empecher.
console.log('\n4. Isolation par saison (le garde-fou central)');

verifie('le decalage 2026 agit bien en 2026',
  statutDe('morille', le(2026, 6, 10), decalage) === 'en_cours');
verifie('le MEME decalage n\'agit PAS en 2027',
  statutDe('morille', le(2027, 6, 10), decalage) !== 'en_cours',
  statutDe('morille', le(2027, 6, 10), decalage));
verifie('...ni en 2025',
  statutDe('morille', le(2025, 6, 10), decalage) !== 'en_cours',
  statutDe('morille', le(2025, 6, 10), decalage));
verifie('une suspension 2026 ne suspend rien en 2027',
  statutDe('cepe', le(2027, 9, 20), suspension) === 'en_cours',
  statutDe('cepe', le(2027, 9, 20), suspension));
verifie('une fenetre imposee en 2026 ne s\'impose pas en 2027',
  statutDe('girolle', le(2027, 9, 15), fenetre) === 'en_cours',
  statutDe('girolle', le(2027, 9, 15), fenetre));

// L'annee stockee en chaine (ce que renvoie un <select>) doit compter
// comme l'annee stockee en nombre.
const anneeTexte = [{ espece: 'morille', annee: '2026', mode: 'decalage', jours: 14, motif: 'x', creePar: 'a@b.fr' }];
verifie('une annee saisie en texte est comparee comme un nombre',
  statutDe('morille', le(2026, 6, 10), anneeTexte) === 'en_cours',
  statutDe('morille', le(2026, 6, 10), anneeTexte));

// ==================================================================
// 5. Priorite entre forcages concurrents
// ==================================================================
// Deux personnes constatent la meme secheresse : l'affichage ne doit pas
// dependre de l'ordre de lecture de Firestore.
console.log('\n5. Priorite entre forcages concurrents');

const concurrents = [
  { espece: 'cepe', annee: 2026, mode: 'decalage', jours: 20, motif: 'retard', creePar: 'a@b.fr' },
  { espece: 'cepe', annee: 2026, mode: 'suspension', motif: 'arrete prefectoral', creePar: 'c@d.fr' },
  { espece: 'cepe', annee: 2026, mode: 'fenetre', debut: { mois: 9, jour: 1 }, fin: { mois: 9, jour: 10 }, motif: 'observe', creePar: 'e@f.fr' },
];
verifie('une interdiction l\'emporte sur un ajustement de dates',
  statutDe('cepe', le(2026, 9, 20), concurrents) === 'suspendu',
  statutDe('cepe', le(2026, 9, 20), concurrents));

const inverse = concurrents.slice().reverse();
verifie('...quel que soit l\'ordre de lecture',
  statutDe('cepe', le(2026, 9, 20), inverse) === 'suspendu',
  statutDe('cepe', le(2026, 9, 20), inverse));

const sansSuspension = concurrents.filter((f) => f.mode !== 'suspension');
verifie('a defaut, la fenetre imposee passe avant le decalage',
  statutDe('cepe', le(2026, 9, 5), sansSuspension) === 'en_cours'
    && statutDe('cepe', le(2026, 9, 20), sansSuspension) !== 'en_cours',
  statutDe('cepe', le(2026, 9, 20), sansSuspension));

// ==================================================================
// 6. Tri et regroupement
// ==================================================================
console.log('\n6. Tri de la liste');

const evaluation = evaluerCalendrier(ESPECES, [], le(2026, 8, 15));
const statuts = evaluation.map((e) => e.statut);
const rangs = { en_cours: 0, suspendu: 1, bientot: 2, plus_tard: 3, termine: 4 };
let trie = true;
for (let i = 1; i < statuts.length; i++) {
  if (rangs[statuts[i]] < rangs[statuts[i - 1]]) trie = false;
}
verifie('les statuts sont groupes dans l\'ordre de decision', trie, statuts.join(','));
verifie('mi-aout, il y a bien des especes en cours',
  evaluation.filter((e) => e.statut === 'en_cours').length > 0);

// Dans « en cours », ce qui ferme le plus tot d'abord : c'est ce qui est
// urgent, et c'est le seul tri qui aide a decider une sortie.
const enCours = evaluation.filter((e) => e.statut === 'en_cours');
let urgenceOk = true;
for (let i = 1; i < enCours.length; i++) {
  if (enCours[i].joursRestants < enCours[i - 1].joursRestants) urgenceOk = false;
}
verifie('dans « en cours », ce qui ferme le plus tot vient en premier', urgenceOk,
  enCours.map((e) => e.espece.id + ':' + e.joursRestants).join(' '));

verifie('chaque espece du referentiel recoit un statut',
  evaluation.length === ESPECES.length);
verifie('aucun statut inconnu',
  evaluation.every((e) => rangs[e.statut] !== undefined),
  evaluation.map((e) => e.statut).filter((s) => rangs[s] === undefined).join(','));

// La myrtille a un pic (25 juil -> 20 aout) : mi-aout on est dedans.
const myrtille = evaluation.filter((e) => e.espece.id === 'myrtille')[0];
verifie('le pic est signale quand on y est', myrtille && myrtille.dansLePic === true);
const girolleAoutTard = evaluerCalendrier([getEspece('girolle')], [], le(2026, 7, 1))[0];
verifie('...et pas quand on n\'y est pas', girolleAoutTard.dansLePic === false);

// ==================================================================
// 7. Validation de la saisie d'un forcage
// ==================================================================
console.log('\n7. Validation de la saisie');

const valide = construireForcage({ espece: 'morille', annee: '2026', mode: 'decalage', jours: '14', motif: 'Gelees tardives' });
verifie('un decalage complet est accepte', !valide.erreur && valide.doc.jours === 14, valide.erreur);
verifie('l\'annee est stockee en nombre', valide.doc.annee === 2026 && typeof valide.doc.annee === 'number');

verifie('un motif vide est refuse',
  !!construireForcage({ espece: 'morille', annee: '2026', mode: 'decalage', jours: '14', motif: '   ' }).erreur);
verifie('une espece inconnue est refusee',
  !!construireForcage({ espece: 'licorne', annee: '2026', mode: 'decalage', jours: '14', motif: 'x' }).erreur);
verifie('un decalage de 0 jour est refuse (ce n\'est pas un forcage)',
  !!construireForcage({ espece: 'morille', annee: '2026', mode: 'decalage', jours: '0', motif: 'x' }).erreur);
verifie('un decalage absurde (> 120 j) est refuse',
  !!construireForcage({ espece: 'morille', annee: '2026', mode: 'decalage', jours: '200', motif: 'x' }).erreur);
verifie('une fenetre sans dates est refusee',
  !!construireForcage({ espece: 'morille', annee: '2026', mode: 'fenetre', motif: 'x' }).erreur);

const fenetreOk = construireForcage({ espece: 'girolle', annee: '2026', mode: 'fenetre', debut: '2000-08-01', fin: '2000-08-20', motif: 'Canicule' });
verifie('une fenetre imposee ne retient que le mois et le jour',
  !fenetreOk.erreur && fenetreOk.doc.debut.mois === 8 && fenetreOk.doc.debut.jour === 1
    && fenetreOk.doc.fin.mois === 8 && fenetreOk.doc.fin.jour === 20
    && fenetreOk.doc.debut.annee === undefined,
  JSON.stringify(fenetreOk));

const suspensionOk = construireForcage({ espece: 'cepe', annee: '2026', mode: 'suspension', motif: 'Arrete prefectoral' });
verifie('une suspension n\'exige ni jours ni dates',
  !suspensionOk.erreur && suspensionOk.doc.mode === 'suspension', suspensionOk.erreur);

// ==================================================================
// 8. Ce qui part reellement en base
// ==================================================================
console.log('\n8. Ecritures Firestore');

sandbox.db = fauxDb;
sandbox.HUB.user = { email: 'Cyril.Samson41@Gmail.com' };
sandbox.HUB.membre = { email: 'cyril.samson41@gmail.com', role: 'superadmin' };
sandbox.HUB.effectif = sandbox.HUB.membre;
sandbox.forcages = [];
sandbox.idEnEdition = null;

// Le DOM simule cree ses elements a la demande : on passe par
// getElementById, comme le fait la page.
const champ = (id) => document.getElementById(id);
function saisir(valeurs) {
  Object.keys(valeurs).forEach((id) => { champ(id).value = valeurs[id]; });
}

saisir({
  'f-espece': 'morille',
  'f-annee': '2026',
  'f-mode': 'decalage',
  'f-jours': '14',
  'f-debut': '',
  'f-fin': '',
  'f-motif': 'Gelees tardives dans le val de Mouthe',
});
ecritures.length = 0;
sandbox.sauverForcage();

verifie('la creation ecrit bien un document', ecritures.length === 1, JSON.stringify(ecritures));
const cree = ecritures[0];
verifie('...dans la collection « cueillette »', cree && cree.collection === 'cueillette', cree && cree.collection);
verifie('...avec l\'auteur reel, normalise en minuscules',
  cree && cree.data.creePar === 'cyril.samson41@gmail.com', cree && cree.data.creePar);
verifie('...et la saison, sans laquelle le forcage deborderait',
  cree && cree.data.annee === 2026, cree && String(cree.data.annee));

// Sous impersonation, l'ecriture part avec le jeton du superadmin : y
// inscrire l'identite impersonnee ferait mentir la trace ET ferait
// echouer la regle Firestore, qui compare au jeton reel.
sandbox.HUB.effectif = { email: 'marie@gmail.com', role: 'membre', projets: ['cueillette'] };
ecritures.length = 0;
sandbox.sauverForcage();
verifie('sous impersonation, creePar nomme l\'utilisateur REEL',
  ecritures[0] && ecritures[0].data.creePar === 'cyril.samson41@gmail.com',
  ecritures[0] && ecritures[0].data.creePar);
sandbox.HUB.effectif = sandbox.HUB.membre;

// Modifier : creePar ne doit jamais repartir, sinon on s'attribuerait
// l'observation d'un autre — et la regle Firestore refuserait l'ecriture.
sandbox.forcages = [{ id: 'f1', espece: 'morille', annee: 2026, mode: 'decalage', jours: 14, motif: 'x', creePar: 'marie@gmail.com' }];
sandbox.idEnEdition = 'f1';
ecritures.length = 0;
sandbox.sauverForcage();
verifie('la modification n\'ecrit pas creePar',
  ecritures[0] && ecritures[0].data.creePar === undefined, JSON.stringify(ecritures[0] && ecritures[0].data));
verifie('...et c\'est bien un update sur le bon document',
  ecritures[0] && ecritures[0].type === 'update' && ecritures[0].id === 'f1');

// Ecrire sur le forcage de quelqu'un d'autre doit etre refuse AVANT le
// reseau : un message clair vaut mieux qu'une erreur de permissions.
sandbox.HUB.membre = { email: 'marie@gmail.com', role: 'membre', projets: ['cueillette'] };
sandbox.HUB.effectif = sandbox.HUB.membre;
sandbox.HUB.user = { email: 'marie@gmail.com' };
sandbox.forcages = [{ id: 'f2', espece: 'cepe', annee: 2026, mode: 'suspension', motif: 'x', creePar: 'quelquun@dautre.fr' }];
sandbox.idEnEdition = 'f2';
ecritures.length = 0;
toasts.length = 0;
sandbox.sauverForcage();
verifie('modifier le forcage d\'un autre n\'envoie RIEN', ecritures.length === 0, JSON.stringify(ecritures));
verifie('...et le dit', toasts.length === 1 && toasts[0].type === 'error', JSON.stringify(toasts));

// ==================================================================
// 9. Coherence du referentiel
// ==================================================================
console.log('\n9. Coherence du referentiel');

const ids = ESPECES.map((e) => e.id);
verifie('les identifiants sont uniques', new Set(ids).size === ids.length,
  ids.filter((id, i) => ids.indexOf(id) !== i).join(','));
verifie('aucun identifiant vide ou a espace',
  ids.every((id) => /^[a-z0-9-]+$/.test(id)), ids.filter((id) => !/^[a-z0-9-]+$/.test(id)).join(','));

const categoriesConnues = sandbox.CATEGORIES.map((c) => c.valeur);
verifie('chaque espece a une categorie declaree',
  ESPECES.every((e) => categoriesConnues.indexOf(e.categorie) !== -1),
  ESPECES.filter((e) => categoriesConnues.indexOf(e.categorie) === -1).map((e) => e.id).join(','));

const dateValide = (md) => md && md.mois >= 1 && md.mois <= 12 && md.jour >= 1 && md.jour <= 31;
verifie('toutes les fenetres ont un debut et une fin valides',
  ESPECES.every((e) => dateValide(e.debut) && dateValide(e.fin)),
  ESPECES.filter((e) => !dateValide(e.debut) || !dateValide(e.fin)).map((e) => e.id).join(','));
verifie('les pics declares sont valides',
  ESPECES.every((e) => !e.pic || (dateValide(e.pic.debut) && dateValide(e.pic.fin))),
  ESPECES.filter((e) => e.pic && !(dateValide(e.pic.debut) && dateValide(e.pic.fin))).map((e) => e.id).join(','));

// Un pic hors de sa fenetre annoncerait « pleine saison » sur une
// espece fermee.
const dansFenetre = (md, e) => {
  const jour = new Date(2001, md.mois - 1, md.jour);
  const debut = new Date(2001, e.debut.mois - 1, e.debut.jour);
  const fin = new Date(sandbox.chevaucheAnnee(e.debut, e.fin) ? 2002 : 2001, e.fin.mois - 1, e.fin.jour);
  return jour >= debut && jour <= fin;
};
verifie('chaque pic tombe a l\'interieur de sa fenetre',
  ESPECES.every((e) => !e.pic || (dansFenetre(e.pic.debut, e) && dansFenetre(e.pic.fin, e))),
  ESPECES.filter((e) => e.pic && !(dansFenetre(e.pic.debut, e) && dansFenetre(e.pic.fin, e))).map((e) => e.id).join(','));

verifie('effort et rendement sont notes de 1 a 3',
  ESPECES.every((e) => [1, 2, 3].indexOf(e.effort) !== -1 && [1, 2, 3].indexOf(e.rendement) !== -1),
  ESPECES.filter((e) => [1, 2, 3].indexOf(e.effort) === -1 || [1, 2, 3].indexOf(e.rendement) === -1).map((e) => e.id).join(','));
verifie('chaque espece a un biotope renseigne',
  ESPECES.every((e) => e.biotope && e.biotope.length > 10),
  ESPECES.filter((e) => !e.biotope || e.biotope.length <= 10).map((e) => e.id).join(','));

// Le perimetre annonce doit rester celui pour lequel les fenetres ont
// ete etablies : les elargir sans rouvrir le referentiel les rendrait
// fausses.
verifie('le perimetre altitude est bien 800-1200 m',
  sandbox.ALTITUDE_MIN === 800 && sandbox.ALTITUDE_MAX === 1200);
['Mouthe', 'Labergement-Sainte-Marie', 'Vaux-et-Chantegrue', 'Pontarlier', 'Frasne', 'Levier'].forEach((secteur) => {
  verifie('le secteur « ' + secteur + ' » est couvert', sandbox.SECTEURS.indexOf(secteur) !== -1);
});

// Un champignon sans mention de confusion est un piege : ce sont les
// especes ou l'erreur se paie le plus cher.
const champignonsSansConfusion = ESPECES.filter((e) => e.categorie === 'champignon' && !e.confusion);
verifie('chaque champignon dit a quoi il peut etre confondu',
  champignonsSansConfusion.length === 0, champignonsSansConfusion.map((e) => e.id).join(','));

// ==================================================================
// 10. Rendu : echappement et validite des onclick
// ==================================================================
console.log('\n10. Rendu');

const carte = sandbox.carteEspece(evaluerCalendrier([getEspece('cepe-ete')], [], le(2026, 7, 15))[0]);
verifie('la carte nomme l\'espece', carte.indexOf('Cèpe d&#39;été') !== -1 || carte.indexOf("Cèpe d'été") !== -1);

// « Cèpe d'été » porte une apostrophe : c'est exactement le bug qui a
// deja casse les filtres de la page Idees.
const onclicks = carte.match(/onclick="([^"]*)"/g) || [];
verifie('la carte produit au moins un onclick', onclicks.length > 0);
let onclickOk = true;
onclicks.forEach((brut) => {
  const code = brut.slice(9, -1).replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  try { new Function(code); } catch (e) { onclickOk = false; console.log('       -> ' + code); }
});
verifie('chaque onclick genere est du JavaScript valide', onclickOk);

const avecForcage = sandbox.carteEspece(evaluerCalendrier([getEspece('morille')], decalage, le(2026, 6, 10))[0]);
verifie('une fenetre forcee affiche aussi la fenetre theorique',
  avecForcage.indexOf('theorique') !== -1 || avecForcage.indexOf('théorique') !== -1);
verifie('...et le motif du forcage', avecForcage.indexOf('Gelees tardives a Mouthe') !== -1);

// Un motif malveillant ne doit pas s'executer : c'est du texte saisi
// librement et reaffiche sur l'ecran de tout le monde.
const xss = [{ espece: 'morille', annee: 2026, mode: 'suspension', motif: '<img src=x onerror=alert(1)>', creePar: 'a@b.fr' }];
const carteXss = sandbox.carteEspece(evaluerCalendrier([getEspece('morille')], xss, le(2026, 5, 1))[0]);
verifie('un motif contenant du HTML est echappe',
  carteXss.indexOf('<img src=x') === -1 && carteXss.indexOf('&lt;img') !== -1);

// ==================================================================
// 11. Coherence avec le hub et les regles Firestore
// ==================================================================
console.log('\n11. Coherence hub / regles');

const regles = fs.readFileSync(path.join(REPO, 'firestore.rules'), 'utf8');
const projets = fs.readFileSync(path.join(REPO, 'projets.js'), 'utf8');
const html = fs.readFileSync(path.join(DOSSIER, 'index.html'), 'utf8');

verifie('le projet est declare dans le registre', /slug: 'cueillette'/.test(projets));
verifie('la collection a son bloc match', /match \/cueillette\/\{/.test(regles));
verifie('la lecture est gardee par le droit projet', /allow read: if aAcces\('cueillette'\)/.test(regles));
verifie('la creation impose creePar = l\'appelant',
  /allow create: if aAcces\('cueillette'\)[\s\S]{0,120}creePar == idAppelant\(\)/.test(regles));
verifie('creePar est immuable a la modification',
  /request\.resource\.data\.creePar == resource\.data\.creePar/.test(regles.split('match /cueillette/')[1] || ''));

verifie('le body declare le projet', /data-projet="cueillette"/.test(html));
verifie('...et la racine du hub', /data-racine="\.\.\/"/.test(html));
verifie('index.html charge hub-utils.js', /hub-utils\.js/.test(html));
verifie('index.html charge le referentiel puis la logique',
  html.indexOf('especes.js') !== -1 && html.indexOf('especes.js') < html.indexOf('cueillette.js'));

// Le referentiel est de la STRUCTURE, pas de la donnee : s'il finissait
// en base, on perdrait la revue en pull request sur des fenetres dont
// une erreur envoie quelqu'un ramasser au mauvais moment.
verifie('le referentiel n\'est pas stocke en base',
  !/collection\('cueillette'\)[\s\S]{0,80}especes/i.test(fs.readFileSync(path.join(DOSSIER, 'cueillette.js'), 'utf8')));

console.log('\n' + (echecs === 0 ? 'Tous les tests passent.' : echecs + ' test(s) en echec.'));
process.exit(echecs === 0 ? 0 : 1);
