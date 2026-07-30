// ============================================================
// test-idees.js — La page Idees / Projets
// ============================================================
// Charge idees.js avec un DOM minimal simule et verifie tri, filtres,
// echappement et export JSON sur des donnees factices.
//
// Lancer :  node tests/test-idees.js
//
// Le bloc « echappement » couvre un bug reel : un projet dont le nom
// contient une apostrophe (« O'Fil du Doubs ») cassait les onclick.
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.join(__dirname, '..', 'idees');

// --- DOM minimal -------------------------------------------------
const elements = {};
function fakeEl(id) {
  return {
    id, value: '', innerHTML: '', textContent: '', style: {},
    focus() {}, remove() {}, appendChild() {},
  };
}
const document = {
  addEventListener() {},
  getElementById(id) { elements[id] = elements[id] || fakeEl(id); return elements[id]; },
  createElement(tag) {
    if (tag === 'a') { const a = { href: '', download: '', click() { telechargements.push({ href: a.href, download: a.download }); } }; return a; }
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

// Stubs pour l'export : on capture le contenu du Blob et le nom de fichier.
const telechargements = [];
const blobs = new Map();
class FakeBlob {
  constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; }
}
const FakeURL = {
  createObjectURL(blob) { const u = 'blob:' + blobs.size; blobs.set(u, blob); return u; },
  revokeObjectURL() {},
};

// Faux Firestore : le carnet ecrit desormais un auteur, et c'est ce qui
// PART EN BASE qui compte, pas ce que l'ecran affiche.
const ecritures = [];
const fauxDb = {
  batch() {
    const operations = [];
    return {
      update(ref, data) { operations.push({ type: 'update', id: ref.id, data }); },
      commit() { operations.forEach((o) => ecritures.push(o)); return Promise.resolve(); },
    };
  },
  collection() {
    return {
      doc(id) {
        const reference = id || 'nouveau-doc';
        return {
          id: reference,
          update(data) { ecritures.push({ type: 'update', id: reference, data }); return Promise.resolve(); },
        };
      },
      add(data) { ecritures.push({ type: 'add', data }); return Promise.resolve({ id: 'nouveau-doc' }); },
      onSnapshot() {},
    };
  },
};

const sandbox = {
  document, console, Blob: FakeBlob, URL: FakeURL, JSON, Date, Promise,
  Object, Array, String, Number,
  firebase: { firestore: Object.assign(() => fauxDb, {
    FieldValue: { serverTimestamp: () => ({ __serveur: true }) },
  }) },
  window: { location: { pathname: '/idees.html', search: '', hostname: 'admin.ofildudoubs.fr' } },
};
sandbox.window.document = document;
vm.createContext(sandbox);

// Les registres reels : si un slug ou un libelle change, ce test le voit.
vm.runInContext(fs.readFileSync(path.join(REPO, '..', 'projets.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(REPO, '..', 'sites.js'), 'utf8'), sandbox);

// Ce que auth.js fournit en vrai. On le simule plutot que de le charger :
// auth.js branche un vigile Firebase complet dont on n'a pas besoin ici.
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
`, sandbox);

// escapeHtml / showToast viennent de auth.js : on ne charge que ce qu'il faut
vm.runInContext(`
  function escapeHtml(t){ var d=document.createElement('div'); d.appendChild(document.createTextNode(t==null?'':t)); return d.innerHTML; }
  function showToast(){}
`, sandbox);
// hub-utils.js fournit toDate / formatDateFr / escapeAttr / jsAttr,
// que idees.js ne definit plus lui-meme (T14). Le charger ici est ce
// qui fait echouer ce test si la page oublie la balise <script>.
vm.runInContext(fs.readFileSync(path.join(REPO, '..', 'hub-utils.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(REPO, 'idees.js'), 'utf8'), sandbox);

// --- Donnees factices --------------------------------------------
const PROPRIO = 'cyril.samson41@gmail.com';
const MARIE = 'marie@gmail.com';

const jour = (n) => ({ toDate: () => new Date(2026, 6, n) });
sandbox.idees = [
  { id: 'a1', numero: 1, titre: 'Cron pour les randos', projet: "O'Fil du Doubs", importance: 'normale', complexite: 'M', etat: 'idee',      createdAt: jour(1), creePar: PROPRIO },
  { id: 'a2', numero: 2, titre: 'Quick win evident',    projet: "O'Fil du Doubs", importance: 'haute',   complexite: 'S', etat: 'a_faire',   createdAt: jour(2), creePar: MARIE },
  { id: 'a3', numero: 3, titre: 'Gros chantier',        projet: 'Collections',    importance: 'haute',   complexite: 'L', etat: 'a_creuser', createdAt: jour(3), creePar: PROPRIO },
  { id: 'a4', numero: 4, titre: 'Deja faite',           projet: 'Le Fuverat',     importance: 'basse',   complexite: 'S', etat: 'faite',     createdAt: jour(4), creePar: MARIE },
  // Sans auteur ET avec un projet hors registre : l'idee d'avant le champ
  // libre ferme. Les deux cas de reprise dans une seule ligne.
  { id: 'a5', numero: 5, titre: 'Sans projet ni cplx',  projet: '',               importance: 'normale', complexite: '',  etat: 'en_cours',  createdAt: jour(5) },
];
sandbox.premierChargement = false;

// Par defaut : le proprietaire, superadmin, voit et modifie tout.
function connecte(email, fiche) {
  sandbox.HUB.user = { email };
  sandbox.HUB.membre = fiche;
  sandbox.HUB.effectif = fiche;
  sandbox.HUB.impersonation = '';
}
const ficheProprio = { email: PROPRIO, nom: 'Cyril', role: 'superadmin', projets: [], sites: [] };
const ficheMarie = {
  email: MARIE, nom: 'Marie', role: 'membre',
  projets: ['idees', 'exterieur'], sites: ['ofildudoubs'],
};
connecte(PROPRIO, ficheProprio);
// onHubReady() n'est pas appele hors navigateur : on branche le faux
// Firestore a la main.
sandbox.db = fauxDb;

let echecs = 0;
function verifie(nom, condition, detail) {
  if (condition) { console.log('  ok   ' + nom); }
  else { console.log('  ECHEC ' + nom + (detail ? ' -> ' + detail : '')); echecs++; }
}

// --- 1. Filtre par defaut : les etats actifs seulement ------------
console.log('\n1. Filtres');
let visibles = sandbox.getIdeesFiltrees();
verifie('« Actives » masque l\'idee faite', visibles.length === 4, visibles.length + ' visibles');

sandbox.filtreEtat = 'toutes';
verifie('« Toutes » montre tout', sandbox.getIdeesFiltrees().length === 5);

sandbox.filtreProjet = "O'Fil du Doubs";
verifie('Filtre projet avec apostrophe', sandbox.getIdeesFiltrees().length === 2);

sandbox.filtreProjet = 'Sans projet';
verifie('Projet vide regroupe sous « Sans projet »', sandbox.getIdeesFiltrees().length === 1);

sandbox.filtreProjet = 'tous';
elements['search-input'].value = 'CRON';
verifie('Recherche insensible a la casse', sandbox.getIdeesFiltrees().length === 1);
elements['search-input'].value = '';

// --- 2. Tri quick wins -------------------------------------------
console.log('\n2. Tri');
sandbox.renderIdees();
let html = elements['idees-list'].innerHTML;
let ordre = [...html.matchAll(/>#(\d+)</g)].map((m) => m[1]).join(',');
// Scores attendus (importance*4 + complexite) : #2=0, #3=2, #1=5, #5=7, #4=8
verifie('Quick wins d\'abord (haute+S, haute+L, puis normales, cplx inconnue en dernier)',
  ordre === '2,3,1,5,4', 'ordre = ' + ordre);

sandbox.trierPar('numero');
ordre = [...elements['idees-list'].innerHTML.matchAll(/>#(\d+)</g)].map((m) => m[1]).join(',');
verifie('Tri par numero decroissant au 1er clic', ordre === '5,4,3,2,1', 'ordre = ' + ordre);
sandbox.trierPar('numero');
ordre = [...elements['idees-list'].innerHTML.matchAll(/>#(\d+)</g)].map((m) => m[1]).join(',');
verifie('2e clic inverse le sens', ordre === '1,2,3,4,5', 'ordre = ' + ordre);

// --- 3. Echappement ----------------------------------------------
console.log('\n3. Echappement');
verifie('jsAttr protege l\'apostrophe pour JS', sandbox.jsAttr("O'Fil") === "O\\'Fil", sandbox.jsAttr("O'Fil"));
verifie('jsAttr protege le guillemet pour HTML', sandbox.jsAttr('a"b') === 'a&quot;b');
verifie('jsAttr protege l\'antislash', sandbox.jsAttr('a\\b') === 'a\\\\b');

sandbox.filtreProjet = 'tous';
sandbox.renderFiltres();
const boutons = elements['projet-filter'].innerHTML;
const appel = boutons.match(/onclick="filtrerParProjet\('([^"]*?)'\)"/);
verifie('Bouton de filtre « O\'Fil du Doubs » syntaxiquement valide',
  boutons.includes("filtrerParProjet('O\\'Fil du Doubs')"), appel ? appel[0] : 'introuvable');

// Le test qui compte : ce que le navigateur executera doit parser.
const decodeHtml = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
let jsExecutable = true, erreurJs = '';
for (const m of boutons.matchAll(/onclick="([^"]*)"/g)) {
  try { new vm.Script(decodeHtml(m[1])); } catch (e) { jsExecutable = false; erreurJs = decodeHtml(m[1]) + ' :: ' + e.message; }
}
verifie('Tous les onclick des filtres sont du JS valide apres decodage HTML', jsExecutable, erreurJs);

// Idem sur les lignes du tableau
jsExecutable = true; erreurJs = '';
for (const m of elements['idees-list'].innerHTML.matchAll(/onclick="([^"]*)"/g)) {
  try { new vm.Script(decodeHtml(m[1])); } catch (e) { jsExecutable = false; erreurJs = decodeHtml(m[1]) + ' :: ' + e.message; }
}
verifie('Tous les onclick des lignes sont du JS valide apres decodage HTML', jsExecutable, erreurJs);

// --- 4. Export JSON ------------------------------------------------
console.log('\n4. Export JSON');
sandbox.filtreEtat = 'actives';   // filtre restrictif actif volontairement
sandbox.filtreProjet = 'Collections';
sandbox.exporterJson();

verifie('Un telechargement declenche', telechargements.length === 1);
const dl = telechargements[0];
verifie('Nom de fichier date', /^idees-ofildudoubs-\d{4}-\d{2}-\d{2}\.json$/.test(dl.download), dl.download);

const brut = blobs.get(dl.href).parts[0];
let paye = null;
try { paye = JSON.parse(brut); } catch (e) { /* teste ci-dessous */ }
verifie('Le contenu est du JSON valide', paye !== null);
verifie('L\'export ignore les filtres et prend TOUT', paye && paye.idees.length === 5,
  paye ? paye.idees.length + ' idees' : '-');
verifie('Trie par numero croissant', paye && paye.idees.map((i) => i.numero).join(',') === '1,2,3,4,5');
verifie('Compteur coherent', paye && paye.nombre === paye.idees.length);
verifie('Horodatages en ISO', paye && /^\d{4}-\d{2}-\d{2}T/.test(paye.idees[0].createdAt), paye ? paye.idees[0].createdAt : '-');
verifie('Apostrophe preservee telle quelle (pas d\'echappement HTML)',
  paye && paye.idees[0].projet === "O'Fil du Doubs", paye ? paye.idees[0].projet : '-');
verifie('Type MIME JSON', blobs.get(dl.href).type.indexOf('application/json') === 0);

const vide = telechargements.length;
const gardees = sandbox.idees;
sandbox.idees = [];
sandbox.exporterJson();
verifie('Aucun telechargement si la base est vide', telechargements.length === vide);
sandbox.idees = gardees;

// --- 5. Numerotation ----------------------------------------------
console.log('\n5. Numerotation');
verifie('prochainNumero = max + 1', sandbox.prochainNumero() === 6, String(sandbox.prochainNumero()));
const avantNum = sandbox.idees;
sandbox.idees = [];
verifie('Premiere idee = #1', sandbox.prochainNumero() === 1);
sandbox.idees = avantNum;

// --- 6. Liste fermee des projets ----------------------------------
console.log('\n6. Liste fermee des projets');
const valeurs = (l) => l.map((s) => s.valeur).join(',');

connecte(PROPRIO, ficheProprio);
const tousSujets = sandbox.sujetsAutorises();
verifie('Le superadmin peut viser tous les projets et tous les sites',
  tousSujets.length === sandbox.PROJETS.length + sandbox.SITES.length,
  tousSujets.length + ' pour ' + (sandbox.PROJETS.length + sandbox.SITES.length));
verifie('Les deux registres sont distingues',
  tousSujets.some((s) => s.groupe === 'Projets du hub') && tousSujets.some((s) => s.groupe === 'Sites'));

// Le cas qui compte : un membre ne peut noter une idee que sur ce a quoi
// il a acces. Sinon la liste deroulante ne sert a rien.
connecte(MARIE, ficheMarie);
const sujetsMarie = sandbox.sujetsAutorises();
verifie('Un membre ne voit que ses projets et ses sites',
  valeurs(sujetsMarie) === 'Idees / Projets,Exterieur de la maison,O\'Fil du Doubs',
  valeurs(sujetsMarie));
verifie('...pas les projets qu\'elle n\'a pas',
  !valeurs(sujetsMarie).includes('Comptes fournisseurs'));
verifie('...ni les sites qu\'elle n\'a pas',
  !valeurs(sujetsMarie).includes('Le Fuverat'));

// C'est le LIBELLE qui est stocke, et il doit correspondre aux valeurs
// deja en base : « O'Fil du Doubs » et « Collections » sont des noms de
// sites, les idees existantes s'y rattachent sans migration.
verifie('Les libelles collent aux valeurs deja saisies',
  sandbox.SITES.some((s) => s.nom === "O'Fil du Doubs")
  && sandbox.SITES.some((s) => s.nom === 'Collections'));

// Une idee d'avant la liste fermee porte un libelle qui n'y est plus.
// L'enregistrer ne doit pas l'effacer en silence.
connecte(PROPRIO, ficheProprio);
sandbox.remplirSelectProjet('stock-watch');
verifie('Un projet hors registre est conserve comme « herite »',
  elements['f-projet'].innerHTML.includes('Hérité')
  && elements['f-projet'].innerHTML.includes('stock-watch'),
  elements['f-projet'].innerHTML.slice(-160));
verifie('...et reste la valeur selectionnee', elements['f-projet'].value === 'stock-watch');

sandbox.remplirSelectProjet('');
verifie('Sans projet, l\'option « aucun » est proposee',
  elements['f-projet'].innerHTML.includes('— aucun —'));

// --- 7. Qui peut modifier quoi ------------------------------------
console.log('\n7. Qui peut modifier quoi');
connecte(MARIE, ficheMarie);
verifie('Un membre modifie ses propres idees', sandbox.peutModifier(sandbox.idees[1]));
verifie('...mais pas celles des autres', !sandbox.peutModifier(sandbox.idees[0]));
// Les idees d'avant le suivi des auteurs n'appartiennent a personne :
// personne d'autre que le superadmin ne doit y toucher.
verifie('...ni celles sans auteur', !sandbox.peutModifier(sandbox.idees[4]));

connecte(PROPRIO, ficheProprio);
verifie('Le superadmin modifie tout',
  sandbox.idees.every((i) => sandbox.peutModifier(i)));

// Le filtre « les miennes » repose sur la meme fonction.
connecte(MARIE, ficheMarie);
sandbox.filtreEtat = 'toutes';
sandbox.filtreProjet = 'tous';
sandbox.filtreAuteur = 'miennes';
verifie('Le filtre « les miennes » ne garde que ses idees',
  sandbox.getIdeesFiltrees().map((i) => i.id).join(',') === 'a2,a4',
  sandbox.getIdeesFiltrees().map((i) => i.id).join(','));
sandbox.filtreAuteur = 'toutes';

// --- 8. Le tableau dit qui, et verrouille le reste ----------------
console.log('\n8. Rendu selon les droits');
connecte(MARIE, ficheMarie);
sandbox.renderIdees();
const tableau = elements['idees-list'].innerHTML;
verifie('La colonne « Par » existe', tableau.includes('>Par'));
// Ses propres idees portent en plus une pastille : on cherche donc
// « >marie » et non « >marie< ».
verifie('L\'auteur est affiche sans son domaine',
  tableau.includes('>marie ') && tableau.includes('>cyril.samson41<'),
  'auteur absent ou affiche en entier');
verifie('Ses propres idees portent une pastille', tableau.includes('idee-moi'));
verifie('L\'adresse complete reste en infobulle', tableau.includes(MARIE));
verifie('Une idee sans auteur affiche un tiret', tableau.includes('>—<'));
// Le select d'etat d'une idee d'autrui doit etre inerte : sans « disabled »
// on proposerait une action que Firestore refusera.
verifie('Les etats des idees d\'autrui sont verrouilles',
  (tableau.match(/idee-etat-select[^>]*disabled/g) || []).length === 3,
  (tableau.match(/idee-etat-select[^>]*disabled/g) || []).length + ' verrouilles sur 5');
verifie('Les siennes restent modifiables',
  (tableau.match(/idee-etat-select(?![^>]*disabled)/g) || []).length === 2);
verifie('L\'icone d\'action distingue consulter et modifier',
  tableau.includes('fa-eye') && tableau.includes('fa-pen'));

// La modale s'ouvre quand meme sur l'idee d'un autre — la lire est utile.
sandbox.ouvrirModale('a1');
verifie('La modale d\'une idee d\'autrui s\'ouvre en lecture seule',
  elements['f-titre'].disabled === true && elements['f-projet'].disabled === true);
verifie('...sans bouton Enregistrer', elements['btn-enregistrer'].style.display === 'none');
verifie('...sans bouton Supprimer', elements['btn-delete'].style.display === 'none');
verifie('...et le dit', /Lecture seule/.test(elements['f-lecture-seule'].textContent));

sandbox.ouvrirModale('a2');
verifie('La modale de sa propre idee est modifiable',
  elements['f-titre'].disabled === false
  && elements['btn-enregistrer'].style.display === ''
  && elements['btn-delete'].style.display === '');

// --- 9. Ce qui part en base ---------------------------------------
console.log('\n9. Ecritures');
connecte(MARIE, ficheMarie);
ecritures.length = 0;
sandbox.idEnEdition = null;
elements['f-titre'].value = 'Nouvelle idee de Marie';
elements['f-detail'].value = '';
elements['f-projet'].value = "O'Fil du Doubs";
elements['f-importance'].value = 'normale';
elements['f-complexite'].value = '';
elements['f-etat'].value = 'idee';
sandbox.sauverIdee();
const creation = ecritures.find((e) => e.type === 'add');
verifie('Une idee creee porte son auteur',
  !!creation && creation.data.creePar === MARIE, creation && creation.data.creePar);

// Modifier ne doit jamais reecrire l'auteur : les regles l'interdisent, et
// une idee qui change de main en silence serait pire qu'une idee mal rangee.
ecritures.length = 0;
sandbox.idEnEdition = 'a2';
sandbox.sauverIdee();
const maj = ecritures.find((e) => e.type === 'update');
verifie('Une modification ne touche pas a l\'auteur',
  !!maj && !('creePar' in maj.data), maj && Object.keys(maj.data).join(','));

// Ecrire sur l'idee d'un autre doit etre refuse AVANT l'aller-retour
// reseau : le message est plus clair qu'une erreur de permissions.
ecritures.length = 0;
sandbox.idEnEdition = 'a1';
sandbox.sauverIdee();
verifie('Enregistrer l\'idee d\'un autre n\'ecrit rien', ecritures.length === 0);
ecritures.length = 0;
sandbox.changerEtat('a1', 'faite');
verifie('Changer l\'etat de l\'idee d\'un autre n\'ecrit rien', ecritures.length === 0);
sandbox.idEnEdition = null;

// --- 10. Coherence avec les regles Firestore ----------------------
console.log('\n10. Coherence avec les regles');
const bloc = fs.readFileSync(path.join(REPO, '..', 'firestore.rules'), 'utf8')
  .split('match /idees/')[1].split('match /')[0];
verifie('La lecture reste ouverte a tous ceux qui ont le droit',
  /allow read: if aAcces\('idees'\)/.test(bloc));
verifie('La creation exige un auteur egal a l\'appelant',
  /request\.resource\.data\.creePar == idAppelant\(\)/.test(bloc));
verifie('La modification est reservee a l\'auteur ou au superadmin',
  /allow update: if superadmin\(\)/.test(bloc)
  && /resource\.data\.creePar == idAppelant\(\)/.test(bloc));
verifie('L\'auteur ne peut pas etre change',
  /request\.resource\.data\.creePar == resource\.data\.creePar/.test(bloc));
// La lecture n'etant PAS cloisonnee, aucun `where` n'est necessaire —
// contrairement a la page Comptes du site Collections.
verifie('Aucune requete filtree n\'est requise ici',
  fs.readFileSync(path.join(REPO, 'idees.js'), 'utf8').indexOf(".where('creePar'") === -1);

console.log('\n' + (echecs === 0 ? 'Tous les tests passent.' : echecs + ' test(s) en echec.'));
process.exit(echecs === 0 ? 0 : 1);
