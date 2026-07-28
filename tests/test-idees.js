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

const sandbox = {
  document, console, Blob: FakeBlob, URL: FakeURL, JSON, Date,
  window: { location: { pathname: '/idees.html', search: '', hostname: 'admin.ofildudoubs.fr' } },
};
sandbox.window.document = document;
vm.createContext(sandbox);

// escapeHtml / showToast viennent de auth.js : on ne charge que ce qu'il faut
vm.runInContext(`
  function escapeHtml(t){ var d=document.createElement('div'); d.appendChild(document.createTextNode(t==null?'':t)); return d.innerHTML; }
  function showToast(){}
`, sandbox);
vm.runInContext(fs.readFileSync(path.join(REPO, 'idees.js'), 'utf8'), sandbox);

// --- Donnees factices --------------------------------------------
const jour = (n) => ({ toDate: () => new Date(2026, 6, n) });
sandbox.idees = [
  { id: 'a1', numero: 1, titre: 'Cron pour les randos', projet: "O'Fil du Doubs", importance: 'normale', complexite: 'M', etat: 'idee',      createdAt: jour(1) },
  { id: 'a2', numero: 2, titre: 'Quick win evident',    projet: "O'Fil du Doubs", importance: 'haute',   complexite: 'S', etat: 'a_faire',   createdAt: jour(2) },
  { id: 'a3', numero: 3, titre: 'Gros chantier',        projet: 'Collections',    importance: 'haute',   complexite: 'L', etat: 'a_creuser', createdAt: jour(3) },
  { id: 'a4', numero: 4, titre: 'Deja faite',           projet: 'Le Fuverat',     importance: 'basse',   complexite: 'S', etat: 'faite',     createdAt: jour(4) },
  { id: 'a5', numero: 5, titre: 'Sans projet ni cplx',  projet: '',               importance: 'normale', complexite: '',  etat: 'en_cours',  createdAt: jour(5) },
];
sandbox.premierChargement = false;

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
sandbox.idees = [];
verifie('Premiere idee = #1', sandbox.prochainNumero() === 1);

console.log('\n' + (echecs === 0 ? 'Tous les tests passent.' : echecs + ' test(s) en echec.'));
process.exit(echecs === 0 ? 0 : 1);
