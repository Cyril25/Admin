// ============================================================
// test-taches.js — La to-do priorisee
// ============================================================
// Charge taches-calcul.js et taches.js avec un DOM minimal simule.
//
// Lancer :  node tests/test-taches.js
//
// OU PORTE L'EFFORT. Cette page a la meme faiblesse que le calendrier
// de cueillette : une erreur y est SILENCIEUSE. Une liste mal priorisee
// reste une liste plausible, on la suit sans se douter de rien. Les
// tests pilotent donc la date du jour a la main et verifient les
// verdicts, frontieres comprises.
//
// Le cas a ne jamais casser est le COMPTEUR DE REPORTS : c'est le seul
// mecanisme qui distingue une tache en retard d'une tache morte. S'il
// se met a compter ce qui n'est pas un report — dater une tache qui
// n'avait pas de date, corriger une saisie vers l'arriere — il gonfle
// tout seul, on cesse de le croire, et le signal disparait.
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.join(__dirname, '..');
const DOSSIER = path.join(REPO, 'taches');

// --- DOM minimal -------------------------------------------------
const elements = {};
function fakeEl(id) {
  return {
    id, value: '', checked: false, innerHTML: '', textContent: '', style: {},
    focus() {}, remove() {}, appendChild() {}, querySelector() { return null; },
  };
}
const document = {
  addEventListener() {},
  getElementById(id) { elements[id] = elements[id] || fakeEl(id); return elements[id]; },
  createElement(tag) {
    if (tag === 'a') {
      const a = { href: '', download: '', click() { telechargements.push({ href: a.href, download: a.download }); } };
      return a;
    }
    let txt = '';
    return {
      appendChild(node) { txt += node.data; },
      get innerHTML() {
        return txt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      },
    };
  },
  createTextNode(t) { return { data: String(t) }; },
};

const telechargements = [];
const blobs = new Map();
class FakeBlob {
  constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; }
}
const FakeURL = {
  createObjectURL(blob) { const u = 'blob:' + blobs.size; blobs.set(u, blob); return u; },
  revokeObjectURL() {},
};

// --- Faux Firestore ----------------------------------------------
// On capture DEUX choses : ce qui part en ecriture, et la forme de la
// requete de lecture. La seconde compte autant : sans son `where`, la
// regle de securite rejette tout et la page est vide sans rien dire.
const ecritures = [];
const requetes = [];
const fauxDb = {
  // La bascule vers la date unique ecrit en LOT : sans batch(), le test
  // ne verrait rien partir.
  batch() {
    const operations = [];
    return {
      update(ref, data) { operations.push({ type: 'update', id: ref.id, data }); },
      commit() { operations.forEach((o) => ecritures.push(o)); return Promise.resolve(); },
    };
  },
  collection(nom) {
    return {
      where(champ, operateur, valeur) {
        requetes.push({ collection: nom, champ, operateur, valeur });
        return { onSnapshot() {} };
      },
      doc(id) {
        const reference = id || 'nouveau-doc';
        return {
          id: reference,
          update(data) { ecritures.push({ type: 'update', id: reference, data }); return Promise.resolve(); },
          delete() { ecritures.push({ type: 'delete', id: reference }); return Promise.resolve(); },
        };
      },
      add(data) { ecritures.push({ type: 'add', data }); return Promise.resolve({ id: 'nouveau-doc' }); },
      onSnapshot() {},
    };
  },
};

const sandbox = {
  document, console, Blob: FakeBlob, URL: FakeURL, JSON, Date, Promise,
  Object, Array, String, Number, Math, RegExp, isNaN,
  firebase: { firestore: Object.assign(() => fauxDb, {
    FieldValue: {
      serverTimestamp: () => ({ __serveur: true }),
      // La bascule EFFACE les anciens champs plutot que de les vider :
      // un champ vide traine, un champ supprime disparait.
      delete: () => ({ __efface: true }),
    },
  }) },
  window: { location: { pathname: '/taches/', search: '', hostname: 'admin.ofildudoubs.fr' } },
};
sandbox.window.document = document;
vm.createContext(sandbox);

// Les registres reels : si un slug ou un libelle change, ce test le voit.
vm.runInContext(fs.readFileSync(path.join(REPO, 'projets.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(REPO, 'sites.js'), 'utf8'), sandbox);

// Ce que auth.js fournit en vrai, simule : le charger brancherait un
// vigile Firebase complet dont ce test n'a pas besoin.
vm.runInContext(`
  var HUB = { user: null, membre: null, effectif: null, impersonation: '' };
  function normaliserEmail(e) { return String(e || '').trim().toLowerCase(); }
  function estSuperadmin() { return !!(HUB.effectif && HUB.effectif.role === 'superadmin'); }
  function estSuperadminReel() { return !!(HUB.membre && HUB.membre.role === 'superadmin'); }
  function aAcces(slug) {
    if (!HUB.effectif) return false;
    if (HUB.effectif.role === 'superadmin') return true;
    return (HUB.effectif.projets || []).indexOf(slug) !== -1;
  }
  function aAccesSite(slug) {
    if (!HUB.effectif) return false;
    if (HUB.effectif.role === 'superadmin') return true;
    return (HUB.effectif.sites || []).indexOf(slug) !== -1;
  }
  function escapeHtml(t){ var d=document.createElement('div'); d.appendChild(document.createTextNode(t==null?'':t)); return d.innerHTML; }
  var toasts = [];
  function showToast(m, t){ toasts.push({ message: m, type: t }); }
`, sandbox);

vm.runInContext(fs.readFileSync(path.join(REPO, 'hub-utils.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(DOSSIER, 'taches-calcul.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(DOSSIER, 'taches.js'), 'utf8'), sandbox);

let echecs = 0;
function verifie(nom, condition, detail) {
  if (condition) console.log('  ok   ' + nom);
  else { console.log('  ECHEC ' + nom + (detail ? ' -> ' + detail : '')); echecs++; }
}

// Le DOM simule ne cree un element qu'au premier acces : on passe donc
// toujours par ce raccourci plutot que par le cache directement.
const el = (id) => document.getElementById(id);

const AJD = '2026-08-18';
const tache = (extra) => Object.assign({
  id: 't' + Math.random().toString(36).slice(2, 8),
  titre: 'Tache', detail: '', projet: '', important: false, urgentForce: false,
  echeance: '', faite: false, faiteLe: '', nbReports: 0,
  creePar: 'cyril.samson41@gmail.com', createdAt: new Date('2026-08-01T10:00:00Z'),
}, extra || {});

// --- 1. Le calendrier ------------------------------------------------
console.log('\n1. Le calendrier');
verifie('joursEntre compte les jours dans le bon sens',
  sandbox.joursEntre('2026-08-18', '2026-08-21') === 3,
  String(sandbox.joursEntre('2026-08-18', '2026-08-21')));
verifie('...et rend un negatif vers le passe',
  sandbox.joursEntre('2026-08-18', '2026-08-15') === -3);

// LE PIEGE : le dernier dimanche de mars, une soustraction de dates
// LOCALES rend 23 heures et l'arrondi fait tomber un jour. Date.UTC
// ignore l'heure d'ete — sans ca, deux fois par an, un « en retard de
// 1 j » s'afficherait « 0 j » et la tache changerait de bloc.
verifie('le passage a l\'heure d\'ete ne mange pas un jour',
  sandbox.joursEntre('2026-03-28', '2026-03-30') === 2,
  String(sandbox.joursEntre('2026-03-28', '2026-03-30')));
verifie('...ni le retour a l\'heure d\'hiver',
  sandbox.joursEntre('2026-10-24', '2026-10-26') === 2,
  String(sandbox.joursEntre('2026-10-24', '2026-10-26')));

verifie('ajouterJours franchit un changement de mois',
  sandbox.ajouterJours('2026-08-30', 7) === '2026-09-06',
  sandbox.ajouterJours('2026-08-30', 7));
verifie('...et une annee bissextile',
  sandbox.ajouterJours('2028-02-28', 1) === '2028-02-29',
  sandbox.ajouterJours('2028-02-28', 1));
verifie('une date absente rend null, jamais zero',
  sandbox.joursEntre(AJD, '') === null && sandbox.joursEntre(AJD, 'demain') === null);
verifie('isoDuJour formate sur deux chiffres',
  sandbox.isoDuJour(new Date(2026, 0, 5)) === '2026-01-05',
  sandbox.isoDuJour(new Date(2026, 0, 5)));

// --- 2. Le retard ----------------------------------------------------
console.log('\n2. Le retard');
verifie('hier est en retard', sandbox.estEnRetard(tache({ echeance: '2026-08-17' }), AJD));
verifie('AUJOURD\'HUI n\'est pas en retard — on a jusqu\'a ce soir',
  !sandbox.estEnRetard(tache({ echeance: AJD }), AJD));
verifie('demain non plus', !sandbox.estEnRetard(tache({ echeance: '2026-08-19' }), AJD));
verifie('une tache sans date n\'est jamais en retard',
  !sandbox.estEnRetard(tache({ echeance: '' }), AJD));
verifie('une tache faite n\'est plus en retard',
  !sandbox.estEnRetard(tache({ echeance: '2026-01-01', faite: true }), AJD));
verifie('le nombre de jours de retard est exact',
  sandbox.joursDeRetard(tache({ echeance: '2026-08-11' }), AJD) === 7,
  String(sandbox.joursDeRetard(tache({ echeance: '2026-08-11' }), AJD)));

// --- 3. L'urgence deduite --------------------------------------------
console.log('\n3. L\'urgence deduite de l\'echeance');
// C'est le choix de conception central : l'urgence n'est pas cochee,
// elle est calculee. Une tache doit donc traverser la frontiere toute
// seule en vieillissant, et ces assertions verrouillent ou elle est.
verifie('a J+7 c\'est urgent (la frontiere est incluse)',
  sandbox.estUrgente(tache({ echeance: '2026-08-25' }), AJD));
verifie('a J+8 ca ne l\'est pas encore',
  !sandbox.estUrgente(tache({ echeance: '2026-08-26' }), AJD));
verifie('le jour meme est urgent', sandbox.estUrgente(tache({ echeance: AJD }), AJD));
verifie('une tache sans date n\'est pas urgente d\'elle-meme',
  !sandbox.estUrgente(tache({ echeance: '' }), AJD));
verifie('le forcage rend urgente une tache sans date',
  sandbox.estUrgente(tache({ echeance: '', urgentForce: true }), AJD));
verifie('une tache faite n\'est jamais urgente',
  !sandbox.estUrgente(tache({ echeance: AJD, faite: true }), AJD));
// Sans cette borne, une tache en retard serait a la fois « en retard »
// et « urgente », et apparaitrait dans deux blocs.
verifie('un retard n\'est PAS aussi classe urgent',
  !sandbox.estUrgente(tache({ echeance: '2026-08-01' }), AJD));

// --- 4. Les quatre blocs ---------------------------------------------
console.log('\n4. Les quatre blocs');
verifie('retard avant tout', sandbox.blocDe(tache({ echeance: '2026-08-01' }), AJD) === 'retard');
verifie('echeance proche -> urgent',
  sandbox.blocDe(tache({ echeance: '2026-08-20' }), AJD) === 'urgent');
verifie('important et lointain -> important',
  sandbox.blocDe(tache({ important: true, echeance: '2026-12-01' }), AJD) === 'important');
verifie('important sans aucune date -> important (le cas qui disparait ailleurs)',
  sandbox.blocDe(tache({ important: true, echeance: '' }), AJD) === 'important');
verifie('ni l\'un ni l\'autre -> le reste',
  sandbox.blocDe(tache({ echeance: '' }), AJD) === 'reste');
verifie('faite -> bloc a part',
  sandbox.blocDe(tache({ important: true, echeance: '2026-01-01', faite: true }), AJD) === 'faites');
verifie('l\'ordre des blocs met le retard en premier',
  sandbox.BLOCS[0].cle === 'retard' && sandbox.BLOCS[1].cle === 'urgent'
  && sandbox.BLOCS[2].cle === 'important' && sandbox.BLOCS[3].cle === 'reste',
  sandbox.BLOCS.map((b) => b.cle).join(','));

// --- 5. L'ordre a l'interieur d'un bloc ------------------------------
console.log('\n5. L\'ordre a l\'interieur d\'un bloc');
// LE CAS DU RETOUR DE VACANCES. Quarante retards d'un coup : trier par
// anciennete mettrait la meme croute en tete pour toujours, pendant que
// l'important pourrit trois ecrans plus bas. L'important passe devant,
// dans TOUS les blocs.
const tas = [
  tache({ id: 'vieux-banal', echeance: '2026-06-01', important: false }),
  tache({ id: 'recent-important', echeance: '2026-08-16', important: true }),
  tache({ id: 'vieux-important', echeance: '2026-07-01', important: true }),
];
const range = sandbox.rangerParBloc(tas, AJD);
verifie('les trois sont en retard', range.retard.length === 3);
verifie('l\'important passe devant, meme moins ancien',
  range.retard.map((t) => t.id).join(',') === 'vieux-important,recent-important,vieux-banal',
  range.retard.map((t) => t.id).join(','));

const melange = [
  tache({ id: 'sans-date', echeance: '' }),
  tache({ id: 'lointain', echeance: '2026-12-01' }),
];
const range2 = sandbox.rangerParBloc(melange, AJD);
verifie('une tache sans date passe apres celles qui en ont une',
  range2.reste.map((t) => t.id).join(',') === 'lointain,sans-date',
  range2.reste.map((t) => t.id).join(','));

// LE BUG SIGNALE EN AOUT. Deux taches importantes du meme jour, l'une a
// 12:45 et l'autre a 19:00, sortaient dans l'ordre de leur CREATION :
// le tri ne regardait que la date et ignorait l'heure. A date egale,
// c'est pourtant elle qui dit dans quel ordre les choses s'enchainent.
const memeJournee = [
  tache({ id: 'soir', important: true, echeance: AJD, echeanceHeure: '19:00',
          createdAt: new Date('2026-08-01T08:00:00Z') }),
  tache({ id: 'midi', important: true, echeance: AJD, echeanceHeure: '12:45',
          createdAt: new Date('2026-08-02T08:00:00Z') }),
];
verifie('a date egale, l\'heure la plus tot passe devant',
  sandbox.rangerParBloc(memeJournee, AJD).urgent.map((t) => t.id).join(',') === 'midi,soir',
  sandbox.rangerParBloc(memeJournee, AJD).urgent.map((t) => t.id).join(','));

// Sans heure en dernier, comme une tache sans date : n'avoir pas decide
// d'un moment n'est pas un rang.
const avecEtSans = [
  tache({ id: 'sans-heure', important: true, echeance: AJD }),
  tache({ id: 'a-heure', important: true, echeance: AJD, echeanceHeure: '23:00' }),
];
verifie('une tache sans heure passe apres celles qui en ont une',
  sandbox.rangerParBloc(avecEtSans, AJD).urgent.map((t) => t.id).join(',') === 'a-heure,sans-heure',
  sandbox.rangerParBloc(avecEtSans, AJD).urgent.map((t) => t.id).join(','));

// La DATE commande, l'heure ne fait que departager a date egale.
const dateDAbord = [
  tache({ id: 'due-tard', important: true, echeance: '2026-10-01', echeanceHeure: '08:00' }),
  tache({ id: 'due-tot', important: true, echeance: '2026-09-01', echeanceHeure: '20:00' }),
];
verifie('la date commande, l\'heure ne fait que departager',
  sandbox.rangerParBloc(dateDAbord, AJD).important.map((t) => t.id).join(',') === 'due-tot,due-tard',
  sandbox.rangerParBloc(dateDAbord, AJD).important.map((t) => t.id).join(','));

verifie('rangerParBloc rend toujours les cinq cles, meme vides',
  ['retard', 'urgent', 'important', 'reste', 'faites']
    .every((c) => Array.isArray(sandbox.rangerParBloc([], AJD)[c])));

const faites = sandbox.rangerParBloc([
  tache({ id: 'reglee-lundi', faite: true, faiteLe: '2026-08-10' }),
  tache({ id: 'reglee-hier', faite: true, faiteLe: '2026-08-17' }),
], AJD);
verifie('les taches faites se lisent a l\'envers, la derniere reglee en tete',
  faites.faites.map((t) => t.id).join(',') === 'reglee-hier,reglee-lundi',
  faites.faites.map((t) => t.id).join(','));

// --- 6. Le compteur de reports ---------------------------------------
console.log('\n6. Le compteur de reports');
// LE CAS A NE JAMAIS CASSER. Ce compteur est la seule chose qui separe
// « en retard » de « morte ». Un compteur qui gonfle tout seul ne vaut
// rien : on cesse de le regarder, et le signal disparait.
let champs = sandbox.champsDeReport(tache({ echeance: '2026-08-10', nbReports: 1 }), '2026-08-25');
verifie('repousser une date compte un report', champs.nbReports === 2, String(champs.nbReports));
verifie('...et retient la premiere date visee',
  champs.echeanceInitiale === '2026-08-10', String(champs.echeanceInitiale));

champs = sandbox.champsDeReport(tache({ echeance: '', nbReports: 0 }), '2026-08-25');
verifie('DATER une tache qui n\'avait pas de date n\'est pas un report',
  champs.nbReports === 0, String(champs.nbReports));

champs = sandbox.champsDeReport(tache({ echeance: '2026-08-25', nbReports: 2 }), '2026-08-20');
verifie('AVANCER une date n\'est pas un report — c\'est une correction',
  champs.nbReports === 2, String(champs.nbReports));

champs = sandbox.champsDeReport(tache({ echeance: '2026-08-25', nbReports: 2 }), '2026-08-25');
verifie('reenregistrer sans toucher a la date ne compte rien',
  champs.nbReports === 2, String(champs.nbReports));

champs = sandbox.champsDeReport(
  tache({ echeance: '2026-08-10', nbReports: 3, echeanceInitiale: '2026-05-02' }), '2026-09-01');
verifie('la premiere date visee ne se reecrit jamais',
  champs.echeanceInitiale === undefined, String(champs.echeanceInitiale));

verifie('trois reports = enlisee',
  sandbox.estEnlisee(tache({ nbReports: 3 })) && !sandbox.estEnlisee(tache({ nbReports: 2 })));
verifie('une tache faite n\'est pas enlisee, quel que soit son passe',
  !sandbox.estEnlisee(tache({ nbReports: 9, faite: true })));

// --- 7. Ce qui part reellement en base -------------------------------
console.log('\n7. Ce qui part reellement en base');
sandbox.db = fauxDb;
sandbox.HUB.user = { email: 'Cyril.Samson41@Gmail.com' };
sandbox.HUB.membre = { email: 'cyril.samson41@gmail.com', role: 'superadmin', projets: [], sites: [] };
sandbox.HUB.effectif = sandbox.HUB.membre;
sandbox.taches = [];

ecritures.length = 0;
sandbox.idEnEdition = null;
el('f-titre').value = 'Appeler le ramoneur';
el('f-detail').value = '';
el('f-projet').value = '';
el('f-important').value = 'oui';
el('f-echeance').value = '2026-09-01';
el('f-urgent-force').checked = false;
sandbox.sauverTache();

let ajout = ecritures.find((e) => e.type === 'add');
verifie('la creation pose un auteur', !!ajout && !!ajout.data.creePar);
verifie('...normalise en minuscules',
  ajout && ajout.data.creePar === 'cyril.samson41@gmail.com', ajout && ajout.data.creePar);
verifie('l\'echeance part en chaine AAAA-MM-JJ, pas en Timestamp',
  ajout && ajout.data.echeance === '2026-09-01' && typeof ajout.data.echeance === 'string',
  ajout && typeof ajout.data.echeance);
verifie('important est un booleen, pas la chaine "oui"',
  ajout && ajout.data.important === true, ajout && String(ajout.data.important));
verifie('une tache nait non faite et sans report',
  ajout && ajout.data.faite === false && ajout.data.nbReports === 0);

// Sous impersonation, l'ecriture doit porter l'utilisateur REEL : la
// regle Firestore compare `creePar` au jeton, et une trace qui nomme
// quelqu'un d'autre serait a la fois refusee et mensongere.
ecritures.length = 0;
sandbox.HUB.impersonation = 'marie@gmail.com';
sandbox.HUB.effectif = { email: 'marie@gmail.com', role: 'membre', projets: ['taches'], sites: [] };
sandbox.idEnEdition = null;
el('f-titre').value = 'Tache saisie sous impersonation';
sandbox.sauverTache();
ajout = ecritures.find((e) => e.type === 'add');
verifie('sous impersonation, l\'auteur reste l\'utilisateur REEL',
  ajout && ajout.data.creePar === 'cyril.samson41@gmail.com', ajout && ajout.data.creePar);
sandbox.HUB.impersonation = '';
sandbox.HUB.effectif = sandbox.HUB.membre;

// A la modification, `creePar` ne doit jamais repartir : les regles
// l'interdisent, et une tache qui change d'auteur en silence serait
// pire qu'une tache mal rangee.
ecritures.length = 0;
sandbox.taches = [tache({ id: 'abc', echeance: '2026-08-01', nbReports: 0 })];
sandbox.idEnEdition = 'abc';
el('f-titre').value = 'Tache modifiee';
el('f-echeance').value = '2026-09-15';
sandbox.sauverTache();
const maj = ecritures.find((e) => e.type === 'update');
verifie('la modification ne reecrit pas l\'auteur',
  maj && maj.data.creePar === undefined, maj && String(maj.data.creePar));
verifie('repousser la date DEPUIS LA MODALE compte aussi un report',
  maj && maj.data.nbReports === 1, maj && String(maj.data.nbReports));
verifie('...et y retient la premiere date visee',
  maj && maj.data.echeanceInitiale === '2026-08-01', maj && String(maj.data.echeanceInitiale));

ecritures.length = 0;
sandbox.cloturerTache('abc');
const cloture = ecritures.find((e) => e.type === 'update');
verifie('clore pose faite ET la date de cloture',
  cloture && cloture.data.faite === true && /^\d{4}-\d{2}-\d{2}$/.test(cloture.data.faiteLe),
  cloture && String(cloture.data.faiteLe));

ecritures.length = 0;
sandbox.rouvrirTache('abc');
const rouverte = ecritures.find((e) => e.type === 'update');
verifie('rouvrir VIDE la date de cloture, sinon le badge ment',
  rouverte && rouverte.data.faite === false && rouverte.data.faiteLe === '',
  rouverte && String(rouverte.data.faiteLe));

ecritures.length = 0;
sandbox.taches = [tache({ id: 'abc', echeance: '2026-08-01', nbReports: 0 })];
sandbox.reporterA('abc', 7);
const reporte = ecritures.find((e) => e.type === 'update');
verifie('le bouton « +1 semaine » repousse a aujourd\'hui + 7',
  reporte && reporte.data.echeance === sandbox.ajouterJours(sandbox.aujourdhui(), 7),
  reporte && reporte.data.echeance);
verifie('...et incremente le compteur', reporte && reporte.data.nbReports === 1);

// --- 8. Le `where` obligatoire ---------------------------------------
console.log('\n8. Le cloisonnement en lecture');
// UNE REGLE N'EST PAS UN FILTRE. La regle de lecture exige
// `creePar == idAppelant()` : sans la clause `where` correspondante,
// Firestore rejette la requete EN BLOC et la page est entierement vide
// — pas vide parce qu'il n'y a rien, vide parce qu'on a ete refuse.
requetes.length = 0;
sandbox.HUB.impersonation = '';
sandbox.HUB.effectif = sandbox.HUB.membre;
sandbox.onHubReady();
verifie('la lecture filtre sur creePar',
  requetes.length === 1 && requetes[0].champ === 'creePar' && requetes[0].operateur === '==',
  JSON.stringify(requetes));
verifie('...avec l\'email reel normalise',
  requetes[0] && requetes[0].valeur === 'cyril.samson41@gmail.com', requetes[0] && requetes[0].valeur);

// Sous impersonation, la page ne doit RIEN demander : la liste est
// personnelle, et afficher celle du superadmin sous l'etiquette de
// quelqu'un d'autre serait un contresens.
requetes.length = 0;
el('note-impersonation').innerHTML = '';
sandbox.HUB.impersonation = 'marie@gmail.com';
sandbox.HUB.effectif = { email: 'marie@gmail.com', role: 'membre', projets: ['taches'], sites: [] };
sandbox.onHubReady();
verifie('sous impersonation, aucune requete ne part', requetes.length === 0, JSON.stringify(requetes));
verifie('...et l\'ecran l\'explique au lieu de rester vide',
  el('note-impersonation').innerHTML.length > 0);
sandbox.HUB.impersonation = '';
sandbox.HUB.effectif = sandbox.HUB.membre;

// --- 9. Le rendu ------------------------------------------------------
console.log('\n9. Le rendu');
// La date du jour est pilotee a la main : sans ca, ce bloc changerait
// de verdict tout seul le lendemain.
const vraiAujourdhui = sandbox.aujourdhui;
sandbox.aujourdhui = () => AJD;

sandbox.taches = [
  tache({ id: 'r1', titre: 'Relancer le couvreur', echeance: '2026-07-20', important: true, nbReports: 4 }),
  tache({ id: 'u1', titre: 'Reserver le controle technique', echeance: '2026-08-20' }),
  tache({ id: 'i1', titre: 'Refaire le budget', important: true, echeance: '' }),
  tache({ id: 'z1', titre: 'Trier les photos', echeance: '' }),
  tache({ id: 'f1', titre: 'Payer la taxe', faite: true, faiteLe: '2026-08-12' }),
];
sandbox.filtreEtat = 'toutes';
sandbox.premierChargement = false;
// Par renderVue() et non renderTaches() : c'est le vrai point d'entree
// de la page, celui qui declenche aussi les avertissements du haut.
sandbox.renderVue();
const html = el('taches-blocs').innerHTML;

verifie('les cinq blocs sont rendus',
  ['bloc-taches--retard', 'bloc-taches--urgent', 'bloc-taches--important',
   'bloc-taches--reste', 'bloc-taches--faites'].every((c) => html.indexOf(c) !== -1));
verifie('le retard est annonce en jours',
  html.indexOf('en retard de 29 j') !== -1, 'badge de retard absent ou faux');
verifie('une tache sans date le dit', html.indexOf('sans date') !== -1);
verifie('le compteur de reports s\'affiche', html.indexOf('reportee 4 fois') !== -1
  || html.indexOf('reportée 4 fois') !== -1);
verifie('...en rouge une fois l\'enlisement atteint', html.indexOf('badge-enlisee') !== -1);
verifie('les boutons de report ne sont proposes QUE sur le retard',
  (html.match(/reporterA\(/g) || []).length === 2,
  (html.match(/reporterA\(/g) || []).length + ' occurrences pour 1 tache en retard');
verifie('l\'avertissement d\'enlisement se declenche',
  el('note-enlisement').innerHTML.indexOf('reportée') !== -1
  || el('note-enlisement').innerHTML.indexOf('reportee') !== -1,
  el('note-enlisement').innerHTML.slice(0, 60));

sandbox.filtreEtat = 'a_faire';
sandbox.renderTaches();
verifie('le filtre « a faire » masque le bloc des faites',
  el('taches-blocs').innerHTML.indexOf('bloc-taches--faites') === -1);

// Une tache FAITE dont l'echeance est passee n'est plus « en retard » :
// le badge de retard disparait, mais la date, elle, reste derriere nous.
// Sans garde-fou, le libelle relatif affiche « dans -8 j ».
sandbox.filtreEtat = 'toutes';
sandbox.taches = [tache({ id: 'vieille-faite', echeance: '2026-08-10', faite: true, faiteLe: '2026-08-12' })];
sandbox.renderTaches();
verifie('une tache faite en retard n\'affiche pas un nombre de jours negatif',
  el('taches-blocs').innerHTML.indexOf('dans -') === -1,
  'libelle relatif negatif dans le rendu');

// Un bloc vide ne doit pas s'afficher : un titre pose sur du vide fait
// croire qu'on attend quelque chose a cet endroit.
sandbox.filtreEtat = 'a_faire';
sandbox.taches = [tache({ id: 'seule', echeance: '' })];
sandbox.renderTaches();
verifie('un bloc vide ne s\'affiche pas',
  el('taches-blocs').innerHTML.indexOf('bloc-taches--retard') === -1
  && el('taches-blocs').innerHTML.indexOf('bloc-taches--reste') !== -1);

// --- 10. Echappement --------------------------------------------------
console.log('\n10. Echappement');
// Le bug reel du carnet d'idees : un projet nomme « O'Fil du Doubs »
// cassait les onclick. Meme grammaire ici, meme piege.
sandbox.taches = [tache({
  id: "id'avec\"quotes",
  titre: 'Devis <script>alert(1)</script> pour O\'Fil du Doubs',
  detail: 'Ligne & ligne',
  projet: "O'Fil du Doubs",
  echeance: '2026-07-01',
})];
sandbox.renderTaches();
const htmlEchappe = el('taches-blocs').innerHTML;
verifie('aucune balise script ne ressort intacte',
  htmlEchappe.indexOf('<script>') === -1);
verifie('l\'esperluette est echappee', htmlEchappe.indexOf('Ligne &amp; ligne') !== -1);

const onclicks = [];
htmlEchappe.replace(/onclick="([^"]*)"/g, (m, code) => { onclicks.push(code); return m; });
verifie('des onclick ont bien ete generes', onclicks.length > 0);
let onclicksValides = 0;
onclicks.forEach((code) => {
  const decode = code.replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  try { new vm.Script(decode); onclicksValides++; } catch (e) { /* compte comme echec */ }
});
verifie('chaque onclick genere est du JavaScript valide',
  onclicksValides === onclicks.length,
  onclicksValides + '/' + onclicks.length + ' valides');

// --- 11. Export JSON --------------------------------------------------
console.log('\n11. Export JSON');
// Firestore sur le plan gratuit n'a pas de sauvegarde : ce bouton est
// le seul filet, et il doit tout emporter, filtres compris.
sandbox.taches = [
  tache({ id: 'e1', titre: 'A', echeance: '2026-07-01' }),
  tache({ id: 'e2', titre: 'B', faite: true, faiteLe: '2026-08-01' }),
];
sandbox.filtreEtat = 'a_faire';
telechargements.length = 0;
sandbox.exporterJson();
verifie('un fichier est bien produit', telechargements.length === 1);
const contenu = JSON.parse(blobs.get(telechargements[0].href).parts[0]);
verifie('l\'export IGNORE les filtres — une sauvegarde partielle est un faux filet',
  contenu.nombre === 2, String(contenu.nombre));
verifie('le bloc calcule part avec, pour se relire un an plus tard',
  contenu.taches.every((t) => typeof t.bloc === 'string'));
verifie('les horodatages sortent en ISO lisible',
  contenu.taches.every((t) => t.createdAt === null || /^\d{4}-\d{2}-\d{2}T/.test(t.createdAt)));

sandbox.aujourdhui = vraiAujourdhui;

// --- 12. Une seule date, avec une heure facultative -------------------
console.log('\n12. Une seule date, avec une heure facultative');
// ⚠ LE RETOURNEMENT DU 24 AOUT 2026. Le projet separait `echeance` (la
// contrainte) et `creneauJour`/`creneauHeure` (la decision). L'usage a
// tranche contre : sur 38 taches reelles, 20 des 26 qui portaient les
// deux avaient LA MEME date, et aucune n'a jamais eu un creneau seul.
// Il ne reste qu'une date, avec une heure facultative.
sandbox.aujourdhui = () => AJD;

verifie('une heure demande une date',
  sandbox.aUneHeure(tache({ echeance: AJD, echeanceHeure: '14:00' }))
  && !sandbox.aUneHeure(tache({ echeance: '', echeanceHeure: '14:00' }))
  && !sandbox.aUneHeure(tache({ echeance: AJD, echeanceHeure: '' })));
verifie('une heure invalide est refusee',
  !sandbox.heureValide('25:00') && !sandbox.heureValide('9:00') && sandbox.heureValide('09:05'));
verifie('une tache ne franchit pas minuit',
  sandbox.bornesHeure(tache({ echeance: AJD, echeanceHeure: '23:00', echeanceDuree: 240 })).fin === 1440);
verifie('une duree absente retombe sur la valeur par defaut',
  sandbox.dureeEcheance(tache({ echeance: AJD, echeanceHeure: '09:00' })) === sandbox.DUREE_DEFAUT);

// ⚠ LE DEFAUT QUE LA FUSION CORRIGE. Avant, une tache qu'on faisait dans
// deux heures tombait dans « Le reste » : le creneau ne pesait rien sur
// la priorite, seule l'echeance comptait. Maintenant sa date EST son
// echeance, donc elle est urgente et elle remonte.
verifie('une tache a faire cet apres-midi est URGENTE, pas « le reste »',
  sandbox.blocDe(tache({ echeance: AJD, echeanceHeure: '16:00' }), AJD) === 'urgent',
  sandbox.blocDe(tache({ echeance: AJD, echeanceHeure: '16:00' }), AJD));
verifie('...et une tache a faire demain aussi',
  sandbox.blocDe(tache({ echeance: '2026-08-19', echeanceHeure: '09:00' }), AJD) === 'urgent');
// L'heure ne change RIEN au classement : c'est la date qui decide.
verifie('poser une heure ne change pas le bloc',
  sandbox.blocDe(tache({ echeance: '2026-12-01' }), AJD)
  === sandbox.blocDe(tache({ echeance: '2026-12-01', echeanceHeure: '09:00' }), AJD));

// --- 13. L'heure passee ----------------------------------------------
console.log('\n13. L\'heure passee');
// Seul survivant des trois signaux que la separation permettait. Les
// deux autres — « planifie apres l'echeance » et « urgent sans
// creneau » — n'ont plus d'objet : une date ne peut pas etre en retard
// sur elle-meme.
verifie('planifieApresEcheance a bien disparu',
  sandbox.planifieApresEcheance === undefined);
verifie('sansCreneauAlorsQueProche aussi', sandbox.sansCreneauAlorsQueProche === undefined);

const ceMatin = tache({ echeance: AJD, echeanceHeure: '09:00', echeanceDuree: 60 });
verifie('une heure du matin est passee l\'apres-midi',
  sandbox.heureDepassee(ceMatin, AJD, '14:00'));
verifie('...mais pas pendant qu\'elle court', !sandbox.heureDepassee(ceMatin, AJD, '09:30'));
verifie('...ni avant qu\'elle commence', !sandbox.heureDepassee(ceMatin, AJD, '08:00'));
// ⚠ CE N'EST PAS UN RETARD : la tache est due AUJOURD'HUI, la journee
// n'est pas finie. Les confondre reviendrait a crier au loup un jour
// trop tot.
verifie('une heure passee n\'est PAS un retard',
  sandbox.heureDepassee(ceMatin, AJD, '14:00') && !sandbox.estEnRetard(ceMatin, AJD));
verifie('une tache d\'un autre jour n\'a pas d\'heure passee aujourd\'hui',
  !sandbox.heureDepassee(tache({ echeance: '2026-08-25', echeanceHeure: '09:00' }), AJD, '23:00'));
verifie('une tache faite non plus',
  !sandbox.heureDepassee(Object.assign({}, ceMatin, { faite: true }), AJD, '14:00'));
verifie('sans heure courante exploitable, aucun signal n\'est invente',
  !sandbox.heureDepassee(ceMatin, AJD, 'plus tard'));

// Les badges correspondants doivent SE VOIR : les calculer sans les
// afficher est le genre de fil qui casse en silence.
sandbox.heureCourante = () => '14:00';
sandbox.vue = 'liste';
sandbox.filtreEtat = 'toutes';
sandbox.taches = [
  tache({ id: 'h1', titre: 'Heure passee', echeance: AJD, echeanceHeure: '09:00' }),
  tache({ id: 'h2', titre: 'Heure a venir', echeance: AJD, echeanceHeure: '18:00' }),
];
sandbox.renderVue();
const htmlHeures = el('taches-blocs').innerHTML;
verifie('le badge d\'heure passee s\'affiche', htmlHeures.indexOf('badge-heure-passee') !== -1);
verifie('...et celui d\'une heure a venir aussi', htmlHeures.indexOf('badge-heure"') !== -1);
verifie('le bouton « Retirer l\'heure » n\'apparait que sur les taches a heure',
  (htmlHeures.match(/retirerHeure\(/g) || []).length === 2);

// --- 14. La semaine ---------------------------------------------------
console.log('\n14. La semaine');
// Semaine ISO : elle commence le lundi. getUTCDay() rend 0 pour
// dimanche — sans le decalage, la semaine du dimanche commencerait le
// lendemain, ce qui est le bug classique de tout calendrier maison.
verifie('le lundi d\'un mardi est la veille',
  sandbox.lundiDeLaSemaine('2026-08-18') === '2026-08-17', sandbox.lundiDeLaSemaine('2026-08-18'));
verifie('le lundi d\'un DIMANCHE est six jours avant, pas le lendemain',
  sandbox.lundiDeLaSemaine('2026-08-23') === '2026-08-17', sandbox.lundiDeLaSemaine('2026-08-23'));
verifie('le lundi d\'un lundi est lui-meme',
  sandbox.lundiDeLaSemaine('2026-08-17') === '2026-08-17');
verifie('la semaine fait sept jours consecutifs',
  sandbox.joursDeLaSemaine('2026-08-17').join(',')
  === '2026-08-17,2026-08-18,2026-08-19,2026-08-20,2026-08-21,2026-08-22,2026-08-23',
  sandbox.joursDeLaSemaine('2026-08-17').join(','));
verifie('...et franchit un changement de mois',
  sandbox.joursDeLaSemaine('2026-08-31')[6] === '2026-09-06',
  sandbox.joursDeLaSemaine('2026-08-31')[6]);

const semaine = [
  tache({ id: 'c1', echeance: '2026-08-18', echeanceHeure: '09:00' }),
  tache({ id: 'c2', echeance: '2026-08-19', echeanceHeure: '09:00' }),
  tache({ id: 'e1', echeance: '2026-08-18' }),
  tache({ id: 'ef', echeance: '2026-08-18', faite: true }),
];
// Deux populations distinctes dans la grille : celles qui ont une heure
// vont dans les blocs, les autres en bandeau. Une tache sans heure
// posee dans la grille se verrait inventer un horaire.
verifie('les taches a heure fixe du jour sont isolees',
  sandbox.avecHeureLeJour(semaine, '2026-08-18').map((t) => t.id).join(',') === 'c1');
verifie('celles sans heure aussi, taches faites exclues',
  sandbox.sansHeureLeJour(semaine, '2026-08-18').map((t) => t.id).join(',') === 'e1',
  sandbox.sansHeureLeJour(semaine, '2026-08-18').map((t) => t.id).join(','));

// --- 15. Les voies paralleles ----------------------------------------
console.log('\n15. Les voies paralleles');
// Empiles, deux creneaux qui se chevauchent se cachent l'un l'autre et
// on planifie par-dessus sans le voir.
let voies = sandbox.repartirEnVoies([
  tache({ id: 'a', echeance: AJD, echeanceHeure: '09:00', echeanceDuree: 60 }),
  tache({ id: 'b', echeance: AJD, echeanceHeure: '09:30', echeanceDuree: 60 }),
]);
verifie('deux taches qui se chevauchent prennent deux voies',
  voies[0].voie === 0 && voies[1].voie === 1);
verifie('...et se partagent la largeur',
  voies.every((v) => v.nbVoies === 2), voies.map((v) => v.nbVoies).join(','));

voies = sandbox.repartirEnVoies([
  tache({ id: 'a', echeance: AJD, echeanceHeure: '09:00', echeanceDuree: 60 }),
  tache({ id: 'b', echeance: AJD, echeanceHeure: '10:00', echeanceDuree: 60 }),
]);
verifie('deux taches qui se suivent restent pleine largeur',
  voies.every((v) => v.nbVoies === 1 && v.voie === 0),
  voies.map((v) => v.voie + '/' + v.nbVoies).join(' '));

// LE CAS QUI COMPTE : les voies se comptent par GRAPPE. Un doublon a 9 h
// ne doit pas retrecir tout le reste de la journee, qui n'y est pour rien.
voies = sandbox.repartirEnVoies([
  tache({ id: 'a', echeance: AJD, echeanceHeure: '09:00', echeanceDuree: 60 }),
  tache({ id: 'b', echeance: AJD, echeanceHeure: '09:30', echeanceDuree: 60 }),
  tache({ id: 'seul', echeance: AJD, echeanceHeure: '15:00', echeanceDuree: 60 }),
]);
const isole = voies.find((v) => v.tache.id === 'seul');
verifie('un chevauchement du matin ne retrecit pas l\'apres-midi',
  isole.nbVoies === 1, 'nbVoies = ' + isole.nbVoies);

// Une tache planifiee a 6 h ne doit pas devenir invisible sous pretexte
// que la grille commence a 7 h.
const plage = sandbox.plageHoraire([tache({ echeance: AJD, echeanceHeure: '06:15', echeanceDuree: 30 })]);
verifie('la plage s\'etend pour couvrir un creneau matinal',
  plage.debut === 6 * 60, String(plage.debut));
verifie('...et reste arrondie a l\'heure pleine', plage.debut % 60 === 0 && plage.fin % 60 === 0);
verifie('sans aucune heure, la plage garde les bornes par defaut',
  sandbox.plageHoraire([]).debut === sandbox.HEURE_DEBUT_GRILLE * 60
  && sandbox.plageHoraire([]).fin === sandbox.HEURE_FIN_GRILLE * 60);

// --- 16. Le rendu de la grille ---------------------------------------
console.log('\n16. Le rendu de la grille');
sandbox.heureCourante = () => '12:00';
sandbox.lundiAffiche = '2026-08-17';
sandbox.vue = 'semaine';
sandbox.taches = [
  tache({ id: 'g1', titre: 'Appeler le couvreur', echeance: '2026-08-18', echeanceHeure: '09:00', echeanceDuree: 60 }),
  tache({ id: 'g2', titre: 'Devis chauffage', echeance: '2026-08-19' }),
];
sandbox.renderSemaine();
const grille = el('vue-semaine').innerHTML;
verifie('les sept colonnes sont rendues',
  (grille.match(/class="semaine-colonne/g) || []).length === 8,
  (grille.match(/class="semaine-colonne/g) || []).length + ' (7 jours + la colonne des heures)');
// Deux etages, et leur separation EST le sujet de la vue : ce qui a une
// heure va dans la grille, ce qui n'en a pas reste en bandeau. Poser une
// tache sans heure dans les heures lui en inventerait une.
verifie('une tache A HEURE FIXE apparait comme bloc dans la grille',
  grille.indexOf('semaine-bloc') !== -1 && grille.indexOf('Appeler le couvreur') !== -1);
verifie('une tache SANS heure reste dans le bandeau',
  grille.indexOf('semaine-echeance') !== -1 && grille.indexOf('Devis chauffage') !== -1);
verifie('les cases vides sont cliquables',
  (grille.match(/ouvrirChoixTache\(/g) || []).length > 0);
verifie('le jour courant est distingue',
  grille.indexOf('semaine-colonne--aujourdhui') !== -1);

const onclicksGrille = [];
grille.replace(/onclick="([^"]*)"/g, (m, code) => { onclicksGrille.push(code); return m; });
let grilleValides = 0;
onclicksGrille.forEach((code) => {
  const decode = code.replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  try { new vm.Script(decode); grilleValides++; } catch (e) { /* echec */ }
});
verifie('chaque onclick de la grille est du JavaScript valide',
  grilleValides === onclicksGrille.length && onclicksGrille.length > 0,
  grilleValides + '/' + onclicksGrille.length);

// « Certains titres apparaissent et d'autres pas » : sous 34 px, l'heure
// et le titre ne tenaient pas tous les deux, et c'est le TITRE qui
// debordait — donc la seule chose qui identifie la tache.
sandbox.taches = [
  tache({ id: 'court', titre: 'Coup de fil rapide', echeance: '2026-08-18', echeanceHeure: '11:00', echeanceDuree: 15 }),
  tache({ id: 'long', titre: 'Rendez-vous couvreur', echeance: '2026-08-18', echeanceHeure: '14:00', echeanceDuree: 120 }),
];
sandbox.renderSemaine();
const grilleCourts = el('vue-semaine').innerHTML;
verifie('le titre d\'une tache COURTE est present dans le rendu',
  grilleCourts.indexOf('Coup de fil rapide') !== -1);
verifie('...et son bloc passe en mode compact',
  grilleCourts.indexOf('semaine-bloc--compact') !== -1);
verifie('un bloc long garde les deux lignes',
  (grilleCourts.match(/semaine-bloc--compact/g) || []).length === 1,
  (grilleCourts.match(/semaine-bloc--compact/g) || []).length + ' bloc(s) compact(s) pour 1 tache courte');
verifie('aucun bloc ne descend sous la hauteur d\'une ligne lisible',
  (grilleCourts.match(/height:(\d+(?:\.\d+)?)px/g) || [])
    .map((m) => Number(m.replace(/[^\d.]/g, '')))
    .filter((h) => h !== sandbox.HAUTEUR_HEURE)
    .every((h) => h >= sandbox.HAUTEUR_BLOC_MINI));

// --- 17. Poser et retirer une heure ----------------------------------
console.log('\n17. Poser et retirer une heure');
ecritures.length = 0;
sandbox.taches = [
  tache({ id: 'libre', titre: 'A placer', echeance: '2026-08-25' }),
  tache({ id: 'deja', titre: 'Deja a l heure', echeance: '2026-08-19', echeanceHeure: '10:00' }),
  tache({ id: 'close', titre: 'Reglee', faite: true }),
];
sandbox.ouvrirChoixTache('2026-08-20', '14:00');
verifie('seules les taches ouvertes ET sans heure sont proposees',
  el('choix-liste').innerHTML.indexOf('A placer') !== -1
  && el('choix-liste').innerHTML.indexOf('Deja a l heure') === -1
  && el('choix-liste').innerHTML.indexOf('Reglee') === -1);

sandbox.planifierTache('libre');
const pose = ecritures.find((e) => e.type === 'update');
verifie('poser une heure ecrit l\'heure et une duree',
  pose && pose.data.echeanceHeure === '14:00' && pose.data.echeanceDuree === sandbox.DUREE_DEFAUT,
  pose && JSON.stringify(pose.data));
// ⚠ DEPUIS LA FUSION, POSER UNE HEURE DEPLACE LA DATE. Il n'y en a plus
// qu'une : choisir « jeudi 14 h » dans la grille, c'est dire que la
// tache est due jeudi.
verifie('...et DEPLACE la date, puisqu\'il n\'y en a plus qu\'une',
  pose && pose.data.echeance === '2026-08-20', pose && pose.data.echeance);
// La date recule ici (du 25 au 20) : ce n'est pas un report, et le
// compteur ne doit pas bouger.
verifie('avancer la date en posant une heure ne compte pas un report',
  pose && pose.data.nbReports === 0, pose && String(pose.data.nbReports));

// Repousser, en revanche, en compte un.
ecritures.length = 0;
sandbox.taches = [tache({ id: 'libre', titre: 'A placer', echeance: '2026-08-19' })];
sandbox.ouvrirChoixTache('2026-08-26', '09:00');
sandbox.planifierTache('libre');
const repousse = ecritures.find((e) => e.type === 'update');
verifie('repousser la date en posant une heure compte un report',
  repousse && repousse.data.nbReports === 1, repousse && String(repousse.data.nbReports));

// Retirer l'heure n'est PAS reporter : la tache reste due le meme jour,
// on renonce seulement au moment precis.
ecritures.length = 0;
sandbox.taches = [tache({ id: 'deja', echeance: '2026-08-19', echeanceHeure: '10:00', echeanceDuree: 60 })];
sandbox.retirerHeure('deja');
const retire = ecritures.find((e) => e.type === 'update');
verifie('retirer l\'heure vide l\'heure et la duree',
  retire && retire.data.echeanceHeure === '' && retire.data.echeanceDuree === 0);
verifie('...sans toucher a la date ni au compteur de reports',
  retire && retire.data.echeance === undefined && retire.data.nbReports === undefined);

// Une heure sans date ne veut rien dire : on la laisse tomber en
// silence plutot que de refuser la saisie, l'heure etant facultative.
ecritures.length = 0;
sandbox.taches = [];
sandbox.idEnEdition = null;
el('f-titre').value = 'Sans date';
el('f-echeance').value = '';
el('f-echeance-h').value = '14';
el('f-echeance-m').value = '30';
el('f-echeance-duree').value = '90';
sandbox.sauverTache();
const sansDate = ecritures.find((e) => e.type === 'add');
verifie('une heure sans date n\'est pas ecrite',
  sansDate && sansDate.data.echeanceHeure === '' && sansDate.data.echeanceDuree === 0,
  sansDate && JSON.stringify(sansDate.data));

ecritures.length = 0;
el('f-echeance').value = '2026-08-20';
sandbox.sauverTache();
const avecHeure = ecritures.find((e) => e.type === 'add');
verifie('une date avec heure part complete',
  avecHeure && avecHeure.data.echeance === '2026-08-20'
  && avecHeure.data.echeanceHeure === '14:30' && avecHeure.data.echeanceDuree === 90,
  avecHeure && JSON.stringify(avecHeure.data));

el('f-echeance').value = '';
el('f-echeance-h').value = '';

// --- 17bis. La saisie de l'heure -------------------------------------
console.log('\n17bis. La saisie de l\'heure');
// Deux listes fermees plutot qu'un <input type="time">, qui acceptait
// n'importe quelle minute et ouvrait, selon le navigateur, la liste des
// soixante.
verifie('seuls les quarts d\'heure sont proposes',
  sandbox.MINUTES_CRENEAU.join(',') === '00,15,30,45');

// ⚠ DEPUIS LA FUSION, L'HEURE EST FACULTATIVE ET VIDE PAR DEFAUT.
// Avant, le champ proposait d'emblee l'heure pleine suivante : c'etait
// juste pour un creneau qu'on posait exprès, ce serait inventer une
// heure a chaque saisie maintenant que la plupart des taches sont dues
// un jour, sans moment precis.
sandbox.remplirSelectsHeure('');
verifie('une nouvelle tache s\'ouvre SANS heure',
  el('f-echeance-h').value === '', '[' + el('f-echeance-h').value + ']');
verifie('la liste des heures offre une option vide, puis les 24 heures',
  (el('f-echeance-h').innerHTML.match(/<option/g) || []).length === 25,
  (el('f-echeance-h').innerHTML.match(/<option/g) || []).length + ' options');
verifie('heureSaisie rend une chaine vide quand aucune heure n\'est choisie',
  sandbox.heureSaisie() === '', '[' + sandbox.heureSaisie() + ']');

// LE CAS A NE PAS PERDRE : une minute heritee du temps de l'<input
// type="time"> ne doit pas se faire arrondir en silence a la simple
// ouverture de la modale.
sandbox.remplirSelectsHeure('14:37');
verifie('une minute heritee est conservee, pas arrondie',
  el('f-echeance-m').value === '37', el('f-echeance-m').value);
verifie('...et vient s\'ajouter aux quatre quarts',
  (el('f-echeance-m').innerHTML.match(/<option/g) || []).length === 5);
verifie('...et l\'heure suit', el('f-echeance-h').value === '14');

sandbox.remplirSelectsHeure('09:30');
verifie('une minute normale n\'ajoute pas d\'option',
  (el('f-echeance-m').innerHTML.match(/<option/g) || []).length === 4);
verifie('heureSaisie recompose bien HH:MM', sandbox.heureSaisie() === '09:30', sandbox.heureSaisie());

el('f-echeance-h').value = '';

// --- 17ter. La bascule vers la date unique ---------------------------
console.log('\n17ter. La bascule vers la date unique');
// ⚠ RATTRAPAGE TEMPORAIRE. Les taches d'avant la fusion portent encore
// `creneauJour`, un second champ de date que le modele n'a plus : leur
// heure serait invisible tant qu'elles ne sont pas basculees.
sandbox.db = fauxDb;
sandbox.taches = [
  tache({ id: 'v1', echeance: '2026-08-20', creneauJour: '2026-08-20', creneauHeure: '14:00', creneauDuree: 30 }),
  tache({ id: 'v2', echeance: '2026-10-11', creneauJour: '2026-09-01', creneauHeure: '10:00', creneauDuree: 15 }),
  tache({ id: 'v3', echeance: '2026-08-30' }),
];
verifie('seules les taches portant un ancien creneau sont a basculer',
  sandbox.tachesAFusionner().map((t) => t.id).join(',') === 'v1,v2',
  sandbox.tachesAFusionner().map((t) => t.id).join(','));

ecritures.length = 0;
sandbox.fusionnerLesDates();
const bascules = ecritures.filter((e) => e.type === 'update');
verifie('les deux partent en un seul lot', bascules.length === 2, bascules.length + ' ecritures');

const v1 = bascules.find((e) => e.id === 'v1');
verifie('quand les deux dates coincident, rien ne change de jour',
  v1 && v1.data.echeance === '2026-08-20' && v1.data.echeanceHeure === '14:00'
  && v1.data.echeanceDuree === 30, v1 && JSON.stringify(v1.data));

// ⚠ LE CRENEAU GAGNE quand les deux different : c'est la date qu'on
// avait decidee, elle porte l'heure, et c'est toujours la plus proche —
// rien ne risque d'etre decouvert trop tard.
const v2 = bascules.find((e) => e.id === 'v2');
verifie('quand elles different, c\'est le CRENEAU qui devient la date',
  v2 && v2.data.echeance === '2026-09-01', v2 && v2.data.echeance);
verifie('...avec son heure et sa duree',
  v2 && v2.data.echeanceHeure === '10:00' && v2.data.echeanceDuree === 15);

// Les anciens champs doivent DISPARAITRE, pas rester a trainer : sinon
// la banniere de bascule ne s'eteindrait jamais et on la verrait tous
// les jours sans savoir quoi en faire.
verifie('les trois anciens champs sont supprimes du document',
  bascules.every((e) => e.data.creneauJour !== undefined
    && e.data.creneauHeure !== undefined && e.data.creneauDuree !== undefined));

// --- 18. Coherence avec les regles et le reste du hub -----------------
console.log('\n18. Coherence avec les regles Firestore');
const regles = fs.readFileSync(path.join(REPO, 'firestore.rules'), 'utf8');
const blocTaches = (regles.match(/match \/taches\/\{document\}[\s\S]*?\n    \}/) || [''])[0];

verifie('la collection taches a bien un bloc match', blocTaches.length > 0);
verifie('la LECTURE est cloisonnee par creePar',
  /allow read:[\s\S]*?resource\.data\.creePar == idAppelant\(\)/.test(blocTaches));
// C'est le seul projet du hub ou le superadmin ne voit pas tout, et
// c'est deliberé : une liste de corvees personnelles n'est pas un
// carnet commun. Si la clause reapparait, elle doit etre voulue.
verifie('le superadmin n\'a PAS de passe-droit sur les taches',
  blocTaches.indexOf('superadmin()') === -1,
  'une clause superadmin() est reapparue dans le bloc taches');
verifie('creePar est immuable a la modification',
  /request\.resource\.data\.creePar == resource\.data\.creePar/.test(blocTaches));
verifie('la creation impose son propre nom',
  /allow create:[\s\S]*?request\.resource\.data\.creePar == idAppelant\(\)/.test(blocTaches));

const registre = sandbox.PROJETS.find((p) => p.slug === 'taches');
verifie('le projet est declare au registre', !!registre);
verifie('...et son dossier existe',
  registre && fs.existsSync(path.join(REPO, registre.url, 'index.html')));

// Le client doit filtrer ce que la regle exige. Verifie sur le TEXTE
// des deux fichiers concernes : la page, et l'accueil qui compte.
const sourceTaches = fs.readFileSync(path.join(DOSSIER, 'taches.js'), 'utf8');
const sourceAccueil = fs.readFileSync(path.join(REPO, 'accueil.js'), 'utf8');
verifie('taches.js interroge avec le where obligatoire',
  /\.where\('creePar', '==', moiReel\(\)\)/.test(sourceTaches));
verifie('accueil.js aussi', /\.where\('creePar', '==', moi\)/.test(sourceAccueil));

// Deux definitions de « en retard » finiraient par diverger : la tuile
// annoncerait deux retards quand la page en montre trois.
verifie('l\'accueil REUTILISE compterEnRetard au lieu de recopier la regle',
  /compterEnRetard\(/.test(sourceAccueil) && !/echeance <\s*aujourd/.test(sourceAccueil));
const accueilHtml = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
verifie('...et index.html charge bien taches-calcul.js',
  accueilHtml.indexOf('taches/taches-calcul.js') !== -1);
verifie('...ainsi que hub-utils.js, dont escapeAttr depend',
  accueilHtml.indexOf('hub-utils.js') !== -1);

const pageHtml = fs.readFileSync(path.join(DOSSIER, 'index.html'), 'utf8');
verifie('la page declare son projet et sa racine',
  /data-projet="taches"/.test(pageHtml) && /data-racine="\.\.\/"/.test(pageHtml));
verifie('la page charge le coeur de calcul avant elle-meme',
  pageHtml.indexOf('taches-calcul.js') < pageHtml.indexOf('src="taches.js"'));

console.log('\n' + (echecs === 0 ? 'Tous les tests passent.' : echecs + ' test(s) en echec.'));
process.exit(echecs === 0 ? 0 : 1);
