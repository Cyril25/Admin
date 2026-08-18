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
    FieldValue: { serverTimestamp: () => ({ __serveur: true }) },
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

// --- 12. Les creneaux ------------------------------------------------
console.log('\n12. Le creneau, qui n\'est PAS l\'echeance');
// LA DECISION CENTRALE DE LA PLANIF. `echeance` dit avant quand ca doit
// etre fait, `creneauJour`/`creneauHeure` disent quand on s'y colle.
// Les confondre, c'est refaire Google Calendar : la contrainte devient
// un evenement a 14 h, et si on ne le fait pas a 14 h, il passe.
sandbox.aujourdhui = () => AJD;

verifie('un creneau demande un jour ET une heure',
  sandbox.aUnCreneau(tache({ creneauJour: AJD, creneauHeure: '14:00' }))
  && !sandbox.aUnCreneau(tache({ creneauJour: AJD, creneauHeure: '' }))
  && !sandbox.aUnCreneau(tache({ creneauJour: '', creneauHeure: '14:00' })));
verifie('une heure invalide est refusee',
  !sandbox.heureValide('25:00') && !sandbox.heureValide('9:00')
  && !sandbox.heureValide('14:60') && sandbox.heureValide('09:05'));
verifie('minutes <-> heure font l\'aller-retour',
  sandbox.heureDeMinutes(sandbox.minutesDeHeure('14:30')) === '14:30');
verifie('un creneau ne franchit pas minuit',
  sandbox.bornesCreneau(tache({ creneauJour: AJD, creneauHeure: '23:00', creneauDuree: 240 })).fin === 1440,
  String(sandbox.bornesCreneau(tache({ creneauJour: AJD, creneauHeure: '23:00', creneauDuree: 240 })).fin));
verifie('une duree absente retombe sur la valeur par defaut',
  sandbox.dureeCreneau(tache({ creneauJour: AJD, creneauHeure: '09:00' })) === sandbox.DUREE_DEFAUT);

// L'echeance reste un JOUR : poser un creneau ne doit rien changer au
// calcul du retard, sinon on aurait casse le mecanisme en l'enrichissant.
const planifieeTard = tache({ echeance: '2026-08-11', creneauJour: '2026-08-25', creneauHeure: '10:00' });
verifie('poser un creneau ne change pas le bloc de la tache',
  sandbox.blocDe(planifieeTard, AJD) === 'retard', sandbox.blocDe(planifieeTard, AJD));
verifie('...ni le nombre de jours de retard',
  sandbox.joursDeRetard(planifieeTard, AJD) === 7);

// --- 13. Les trois signaux -------------------------------------------
console.log('\n13. Les trois signaux que la separation rend possibles');
verifie('PLANIFIE APRES L\'ECHEANCE se detecte',
  sandbox.planifieApresEcheance(planifieeTard));
verifie('...et pas quand le creneau precede l\'echeance',
  !sandbox.planifieApresEcheance(tache({ echeance: '2026-08-25', creneauJour: '2026-08-20', creneauHeure: '10:00' })));
verifie('...ni le jour meme de l\'echeance',
  !sandbox.planifieApresEcheance(tache({ echeance: '2026-08-25', creneauJour: '2026-08-25', creneauHeure: '10:00' })));
verifie('...ni sur une tache faite',
  !sandbox.planifieApresEcheance(Object.assign({}, planifieeTard, { faite: true })));

verifie('URGENT SANS CRENEAU se detecte',
  sandbox.sansCreneauAlorsQueProche(tache({ echeance: '2026-08-20' }), AJD));
verifie('...y compris sur un retard',
  sandbox.sansCreneauAlorsQueProche(tache({ echeance: '2026-08-01' }), AJD));
verifie('...mais pas quand le creneau est pose',
  !sandbox.sansCreneauAlorsQueProche(tache({ echeance: '2026-08-20', creneauJour: AJD, creneauHeure: '09:00' }), AJD));
verifie('...ni sur une tache lointaine, qui a le temps',
  !sandbox.sansCreneauAlorsQueProche(tache({ echeance: '2026-12-01', important: true }), AJD));

// CRENEAU MANQUE n'est PAS un retard : l'echeance tient peut-etre encore.
// Les confondre reviendrait a crier au loup un jour trop tot.
const creneauHier = tache({ echeance: '2026-12-01', creneauJour: '2026-08-17', creneauHeure: '09:00' });
verifie('CRENEAU MANQUE se detecte la veille',
  sandbox.creneauManque(creneauHier, AJD, '12:00'));
verifie('...et la tache n\'est pas pour autant en retard',
  !sandbox.estEnRetard(creneauHier, AJD));
const creneauCeMatin = tache({ creneauJour: AJD, creneauHeure: '09:00', creneauDuree: 60 });
verifie('un creneau du matin est manque l\'apres-midi',
  sandbox.creneauManque(creneauCeMatin, AJD, '14:00'));
verifie('...mais pas pendant qu\'il court',
  !sandbox.creneauManque(creneauCeMatin, AJD, '09:30'));
verifie('...ni avant qu\'il commence',
  !sandbox.creneauManque(creneauCeMatin, AJD, '08:00'));
verifie('un creneau a venir n\'est jamais manque',
  !sandbox.creneauManque(tache({ creneauJour: '2026-08-25', creneauHeure: '09:00' }), AJD, '23:59'));
verifie('sans heure courante exploitable, aucun signal n\'est invente',
  !sandbox.creneauManque(creneauCeMatin, AJD, 'plus tard'));

// Les trois signaux doivent SE VOIR : les calculer sans les afficher ne
// servirait a rien, et c'est le genre de fil qui casse en silence.
sandbox.heureCourante = () => '12:00';
sandbox.vue = 'liste';
sandbox.filtreEtat = 'toutes';
sandbox.taches = [
  planifieeTard,
  tache({ id: 's1', titre: 'Rien de decide', echeance: '2026-08-20' }),
  creneauHier,
  tache({ id: 'ok', titre: 'Bien calee', echeance: '2026-08-25', creneauJour: '2026-08-20', creneauHeure: '10:00' }),
];
sandbox.renderVue();
const htmlSignaux = el('taches-blocs').innerHTML;
verifie('le badge « planifie apres l\'echeance » s\'affiche',
  htmlSignaux.indexOf('badge-debordee') !== -1);
verifie('le badge « sans creneau » s\'affiche', htmlSignaux.indexOf('badge-sans-creneau') !== -1);
verifie('le badge « creneau manque » s\'affiche', htmlSignaux.indexOf('badge-creneau-manque') !== -1);
verifie('un creneau normal s\'affiche sans alarme',
  htmlSignaux.indexOf('badge-creneau"') !== -1);
verifie('le bouton Deplanifier n\'apparait que sur les taches planifiees',
  (htmlSignaux.match(/deplanifierTache\(/g) || []).length === 3,
  (htmlSignaux.match(/deplanifierTache\(/g) || []).length + ' pour 3 taches avec creneau');
verifie('l\'avertissement « sans creneau » du haut de page se declenche',
  el('note-sans-creneau').innerHTML.indexOf('sans créneau') !== -1,
  el('note-sans-creneau').innerHTML.slice(0, 60));

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
  tache({ id: 'c1', creneauJour: '2026-08-18', creneauHeure: '09:00' }),
  tache({ id: 'c2', creneauJour: '2026-08-19', creneauHeure: '09:00' }),
  tache({ id: 'e1', echeance: '2026-08-18' }),
  tache({ id: 'ef', echeance: '2026-08-18', faite: true }),
];
verifie('les creneaux du jour sont isoles',
  sandbox.creneauxDuJour(semaine, '2026-08-18').map((t) => t.id).join(',') === 'c1');
verifie('les echeances du jour aussi, taches faites exclues',
  sandbox.echeancesDuJour(semaine, '2026-08-18').map((t) => t.id).join(',') === 'e1',
  sandbox.echeancesDuJour(semaine, '2026-08-18').map((t) => t.id).join(','));

// --- 15. Les voies paralleles ----------------------------------------
console.log('\n15. Les voies paralleles');
// Empiles, deux creneaux qui se chevauchent se cachent l'un l'autre et
// on planifie par-dessus sans le voir.
let voies = sandbox.repartirEnVoies([
  tache({ id: 'a', creneauJour: AJD, creneauHeure: '09:00', creneauDuree: 60 }),
  tache({ id: 'b', creneauJour: AJD, creneauHeure: '09:30', creneauDuree: 60 }),
]);
verifie('deux creneaux qui se chevauchent prennent deux voies',
  voies[0].voie === 0 && voies[1].voie === 1);
verifie('...et se partagent la largeur',
  voies.every((v) => v.nbVoies === 2), voies.map((v) => v.nbVoies).join(','));

voies = sandbox.repartirEnVoies([
  tache({ id: 'a', creneauJour: AJD, creneauHeure: '09:00', creneauDuree: 60 }),
  tache({ id: 'b', creneauJour: AJD, creneauHeure: '10:00', creneauDuree: 60 }),
]);
verifie('deux creneaux qui se suivent restent pleine largeur',
  voies.every((v) => v.nbVoies === 1 && v.voie === 0),
  voies.map((v) => v.voie + '/' + v.nbVoies).join(' '));

// LE CAS QUI COMPTE : les voies se comptent par GRAPPE. Un doublon a 9 h
// ne doit pas retrecir tout le reste de la journee, qui n'y est pour rien.
voies = sandbox.repartirEnVoies([
  tache({ id: 'a', creneauJour: AJD, creneauHeure: '09:00', creneauDuree: 60 }),
  tache({ id: 'b', creneauJour: AJD, creneauHeure: '09:30', creneauDuree: 60 }),
  tache({ id: 'seul', creneauJour: AJD, creneauHeure: '15:00', creneauDuree: 60 }),
]);
const isole = voies.find((v) => v.tache.id === 'seul');
verifie('un chevauchement du matin ne retrecit pas l\'apres-midi',
  isole.nbVoies === 1, 'nbVoies = ' + isole.nbVoies);

// Une tache planifiee a 6 h ne doit pas devenir invisible sous pretexte
// que la grille commence a 7 h.
const plage = sandbox.plageHoraire([tache({ creneauJour: AJD, creneauHeure: '06:15', creneauDuree: 30 })]);
verifie('la plage s\'etend pour couvrir un creneau matinal',
  plage.debut === 6 * 60, String(plage.debut));
verifie('...et reste arrondie a l\'heure pleine', plage.debut % 60 === 0 && plage.fin % 60 === 0);
verifie('sans creneau, la plage garde les bornes par defaut',
  sandbox.plageHoraire([]).debut === sandbox.HEURE_DEBUT_GRILLE * 60
  && sandbox.plageHoraire([]).fin === sandbox.HEURE_FIN_GRILLE * 60);

// --- 16. Le rendu de la grille ---------------------------------------
console.log('\n16. Le rendu de la grille');
sandbox.heureCourante = () => '12:00';
sandbox.lundiAffiche = '2026-08-17';
sandbox.vue = 'semaine';
sandbox.taches = [
  tache({ id: 'g1', titre: 'Appeler le couvreur', creneauJour: '2026-08-18', creneauHeure: '09:00', creneauDuree: 60 }),
  tache({ id: 'g2', titre: 'Devis chauffage', echeance: '2026-08-19' }),
  tache({ id: 'g3', titre: 'Trop tard', echeance: '2026-08-18', creneauJour: '2026-08-21', creneauHeure: '14:00' }),
];
sandbox.renderSemaine();
const grille = el('vue-semaine').innerHTML;
verifie('les sept colonnes sont rendues',
  (grille.match(/class="semaine-colonne/g) || []).length === 8,
  (grille.match(/class="semaine-colonne/g) || []).length + ' (7 jours + la colonne des heures)');
verifie('le creneau apparait comme bloc dans la grille',
  grille.indexOf('semaine-bloc') !== -1 && grille.indexOf('Appeler le couvreur') !== -1);
verifie('l\'echeance apparait dans le BANDEAU, hors des heures',
  grille.indexOf('semaine-echeance') !== -1 && grille.indexOf('Devis chauffage') !== -1);
verifie('un creneau pose apres l\'echeance est marque',
  grille.indexOf('semaine-bloc--debordee') !== -1);
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

// --- 17. Poser et retirer un creneau ---------------------------------
console.log('\n17. Poser et retirer un creneau');
ecritures.length = 0;
sandbox.taches = [
  tache({ id: 'libre', titre: 'A placer', echeance: '2026-08-20' }),
  tache({ id: 'deja', titre: 'Deja placee', creneauJour: '2026-08-19', creneauHeure: '10:00' }),
  tache({ id: 'close', titre: 'Reglee', faite: true }),
];
sandbox.ouvrirChoixTache('2026-08-20', '14:00');
verifie('seules les taches ouvertes ET non planifiees sont proposees',
  el('choix-liste').innerHTML.indexOf('A placer') !== -1
  && el('choix-liste').innerHTML.indexOf('Deja placee') === -1
  && el('choix-liste').innerHTML.indexOf('Reglee') === -1);

sandbox.planifierTache('libre');
const pose = ecritures.find((e) => e.type === 'update');
verifie('poser une tache ecrit le jour, l\'heure et une duree',
  pose && pose.data.creneauJour === '2026-08-20' && pose.data.creneauHeure === '14:00'
  && pose.data.creneauDuree === sandbox.DUREE_DEFAUT,
  pose && JSON.stringify(pose.data));
verifie('...et ne touche PAS a l\'echeance',
  pose && pose.data.echeance === undefined);

// Deplanifier n'est pas reporter : on retire une decision, on ne
// repousse pas une contrainte. Le compteur ne doit pas bouger.
ecritures.length = 0;
sandbox.deplanifierTache('deja');
const retire = ecritures.find((e) => e.type === 'update');
verifie('deplanifier vide les trois champs de creneau',
  retire && retire.data.creneauJour === '' && retire.data.creneauHeure === ''
  && retire.data.creneauDuree === 0);
verifie('...sans compter un report ni toucher a l\'echeance',
  retire && retire.data.nbReports === undefined && retire.data.echeance === undefined);

// Une heure illisible avec un jour pose ne doit RIEN ecrire : mieux
// vaut un refus clair qu'un creneau a moitie enregistre.
ecritures.length = 0;
sandbox.taches = [];
sandbox.idEnEdition = null;
el('f-titre').value = 'Creneau incomplet';
el('f-echeance').value = '';
el('f-creneau-jour').value = '2026-08-20';
el('f-creneau-h').value = '';
el('f-creneau-m').value = '';
sandbox.sauverTache();
verifie('un jour avec une heure illisible est refuse, et rien ne part en base',
  ecritures.length === 0, ecritures.length + ' ecriture(s)');

el('f-creneau-h').value = '14';
el('f-creneau-m').value = '30';
el('f-creneau-duree').value = '90';
sandbox.sauverTache();
const avecCreneau = ecritures.find((e) => e.type === 'add');
verifie('un creneau complet part avec sa duree',
  avecCreneau && avecCreneau.data.creneauJour === '2026-08-20'
  && avecCreneau.data.creneauHeure === '14:30' && avecCreneau.data.creneauDuree === 90,
  avecCreneau && JSON.stringify(avecCreneau.data));

// SANS JOUR, PAS DE CRENEAU. L'heure a beau etre choisie — les listes en
// ont toujours une —, elle ne doit pas partir seule : ce serait une
// seconde echeance deguisee, la confusion que tout ceci evite.
ecritures.length = 0;
el('f-creneau-jour').value = '';
sandbox.sauverTache();
const sansJour = ecritures.find((e) => e.type === 'add');
verifie('une heure choisie sans jour n\'ecrit aucun creneau',
  sansJour && sansJour.data.creneauJour === '' && sansJour.data.creneauHeure === ''
  && sansJour.data.creneauDuree === 0,
  sansJour && JSON.stringify(sansJour.data));

// --- 17bis. La saisie de l'heure -------------------------------------
console.log('\n17bis. La saisie de l\'heure');
// Le « : » d'un <input type="time"> laissait entrer 14:37 et ouvrait,
// selon le navigateur, la liste des soixante minutes.
verifie('l\'heure pleine suivante arrondit vers le haut',
  sandbox.heurePleineSuivante('14:20') === '15:00', sandbox.heurePleineSuivante('14:20'));
verifie('...meme pile a l\'heure', sandbox.heurePleineSuivante('14:00') === '15:00');
verifie('passe 23 h, on propose le lendemain matin plutot qu\'un 00:00 absurde',
  sandbox.heurePleineSuivante('23:30') === '09:00', sandbox.heurePleineSuivante('23:30'));
verifie('...et une heure illisible retombe sur la meme valeur sure',
  sandbox.heurePleineSuivante('') === '09:00');
verifie('seuls les quarts d\'heure sont proposes',
  sandbox.MINUTES_CRENEAU.join(',') === '00,15,30,45');

// Une NOUVELLE tache s'ouvre sur l'heure pleine suivante, minutes a 00 :
// c'est ce qu'on corrigeait a la main a chaque saisie.
sandbox.heureCourante = () => '10:20';
sandbox.remplirSelectsHeure('');
verifie('une nouvelle tache s\'ouvre sur l\'heure pleine suivante',
  el('f-creneau-h').value === '11' && el('f-creneau-m').value === '00',
  el('f-creneau-h').value + ':' + el('f-creneau-m').value);
verifie('les 24 heures sont proposees',
  (el('f-creneau-h').innerHTML.match(/<option/g) || []).length === 24,
  (el('f-creneau-h').innerHTML.match(/<option/g) || []).length + ' options');

// LE CAS A NE PAS PERDRE : une minute heritee du temps de l'<input
// type="time"> ne doit pas se faire arrondir en silence a la simple
// ouverture de la modale.
sandbox.remplirSelectsHeure('14:37');
verifie('une minute heritee est conservee, pas arrondie',
  el('f-creneau-m').value === '37', el('f-creneau-m').value);
verifie('...et vient s\'ajouter aux quatre quarts',
  (el('f-creneau-m').innerHTML.match(/<option/g) || []).length === 5);

sandbox.remplirSelectsHeure('09:30');
verifie('une minute normale n\'ajoute pas d\'option',
  (el('f-creneau-m').innerHTML.match(/<option/g) || []).length === 4
  && el('f-creneau-h').value === '09',
  el('f-creneau-h').value + ':' + el('f-creneau-m').value);

verifie('heureSaisie recompose bien HH:MM',
  sandbox.heureSaisie() === '09:30', sandbox.heureSaisie());

sandbox.heureCourante = () => '12:00';
el('f-creneau-jour').value = '';

sandbox.aujourdhui = vraiAujourdhui;

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
