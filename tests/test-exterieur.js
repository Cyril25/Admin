// ============================================================
// test-exterieur.js — Le projet « Exterieur de la maison »
// ============================================================
// Lancer :  node tests/test-exterieur.js
//
// L'essentiel de l'effort porte sur l'analyseur .eml : c'est une
// fonction pure, sans DOM ni reseau, donc la partie la plus testable —
// et celle ou une regression serait la plus silencieuse (un corps mal
// decode ressort en « Ã©tÃ© » sans qu'aucune erreur ne soit levee).
//
// Le reste couvre ce qu'un clic ne rattrape pas : le calcul
// d'anciennete, le seuil de relance, le regroupement des devis par
// sujet, la recherche, et la validite JavaScript des onclick generes.
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RACINE = path.join(__dirname, '..');
const PROJET = path.join(RACINE, 'exterieur');

// --- DOM minimal -------------------------------------------------
const elements = {};
function fakeEl(id) {
  const attributs = {};
  return {
    id, value: '', innerHTML: '', textContent: '', className: '', href: '', src: '', alt: '',
    style: {}, files: null,
    focus() {}, remove() {}, appendChild() {}, click() {}, select() {},
    addEventListener() {}, setAttribute(n, v) { attributs[n] = v; },
    getAttribute(n) { return attributs[n] === undefined ? null : attributs[n]; },
    getElementsByTagName() { return []; },
  };
}
const document = {
  addEventListener() {},
  activeElement: null,
  body: { appendChild() {}, removeChild() {} },
  getElementById(id) { elements[id] = elements[id] || fakeEl(id); return elements[id]; },
  createElement(tag) {
    if (tag === 'div') {
      let txt = '';
      return {
        appendChild(node) { txt += node.data; },
        get innerHTML() {
          return txt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        },
      };
    }
    return fakeEl(tag);
  },
  createTextNode(t) { return { data: String(t) }; },
};

const sandbox = {
  document, console, JSON, Date, Math, Promise,
  TextDecoder, Uint8Array, atob, escape, decodeURIComponent,
  setTimeout, navigator: {},
  window: { location: { pathname: '/exterieur/', search: '', hash: '', hostname: 'admin.ofildudoubs.fr' }, addEventListener() {} },
  // Les ecritures ne sont pas testees ici (elles partiraient chez
  // Google) : le stub existe juste pour que le chargement passe.
  firebase: { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TS', arrayUnion: (v) => v, arrayRemove: (v) => v } } },
  HUB: { user: { email: 'cyril.samson41@gmail.com', displayName: 'Cyril Samson' }, effectif: { nom: 'Alisson' } },
};
sandbox.window.document = document;
sandbox.window.HUB = sandbox.HUB;
vm.createContext(sandbox);

// escapeHtml / showToast viennent de auth.js : on ne charge que ce qu'il faut.
vm.runInContext(`
  function escapeHtml(t){ var d=document.createElement('div'); d.appendChild(document.createTextNode(t==null?'':t)); return d.innerHTML; }
  function showToast(){}
  var CLOUDINARY_CLOUD_NAME = 'test-cloud';
  var CLOUDINARY_UPLOAD_PRESET = 'test-preset';
`, sandbox);

// Ordre identique a celui d'index.html : exterieur.js en dernier, il
// reference les fonctions de rendu des vues.
[
  path.join(RACINE, 'hub-utils.js'),
  path.join(PROJET, 'exterieur-donnees.js'),
  path.join(PROJET, 'exterieur-upload.js'),
  path.join(PROJET, 'exterieur-eml.js'),
  path.join(PROJET, 'exterieur-etat.js'),
  path.join(PROJET, 'exterieur-fil.js'),
  path.join(PROJET, 'exterieur-taches.js'),
  path.join(PROJET, 'exterieur-documents.js'),
  path.join(PROJET, 'exterieur-images.js'),
  path.join(PROJET, 'exterieur-emails.js'),
  path.join(PROJET, 'exterieur-carnet.js'),
  path.join(PROJET, 'exterieur-projet.js'),
  path.join(PROJET, 'exterieur.js'),
].forEach((f) => vm.runInContext(fs.readFileSync(f, 'utf8'), sandbox));

let echecs = 0;
function verifie(nom, condition, detail) {
  if (condition) { console.log('  ok   ' + nom); }
  else { console.log('  ECHEC ' + nom + (detail ? ' -> ' + detail : '')); echecs++; }
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const crlf = (lignes) => lignes.join('\r\n');

// ================================================================
// 1. Analyseur .eml
// ================================================================
console.log('\n1. Analyseur .eml');

// --- 1a. Cas nominal, texte brut ---
let mail = sandbox.analyserEml(crlf([
  'From: Jean Dupont <jean@paysage-dupont.fr>',
  'To: cyril.samson41@gmail.com',
  'Subject: Devis terrasse',
  'Date: Fri, 3 Jul 2026 09:12:00 +0200',
  'Content-Type: text/plain; charset=UTF-8',
  '',
  'Bonjour,',
  '',
  'Voici le devis.',
]));
verifie('Cas nominal : parseOk', mail.parseOk === true, JSON.stringify(mail));
verifie('Cas nominal : expediteur', mail.de === 'Jean Dupont <jean@paysage-dupont.fr>', mail.de);
verifie('Cas nominal : objet', mail.objet === 'Devis terrasse', mail.objet);
verifie('Cas nominal : corps', mail.corps === 'Bonjour,\n\nVoici le devis.', JSON.stringify(mail.corps));
verifie('Cas nominal : date d\'envoi lue',
  mail.dateEnvoi instanceof Date && mail.dateEnvoi.getUTCFullYear() === 2026 && mail.dateEnvoi.getUTCMonth() === 6,
  String(mail.dateEnvoi));

// --- 1b. base64 + charset UTF-8 : LE piege ---
// atob() rend du Latin-1. Sans repasse UTF-8, « ete » ressort en
// « Ã©tÃ© » — et parseOk vaudrait quand meme true, donc la degradation
// prevue ne se declencherait pas. C'est le premier cas a ne jamais casser.
mail = sandbox.analyserEml(crlf([
  'From: cyril.samson41@gmail.com',
  'Subject: Talus',
  'Content-Type: text/plain; charset=UTF-8',
  'Content-Transfer-Encoding: base64',
  '',
  b64('Lété a été chaud sur le talus.'),
]));
verifie('base64 + UTF-8 : accents corrects (pas de mojibake)',
  mail.corps === 'Lété a été chaud sur le talus.', JSON.stringify(mail.corps));
verifie('base64 + UTF-8 : pas de « Ã » residuel', mail.corps.indexOf('Ã') === -1, mail.corps);

// --- 1c. quoted-printable, avec saut de ligne souple ---
mail = sandbox.analyserEml(crlf([
  'From: jean@paysage-dupont.fr',
  'Subject: Cloture',
  'Content-Type: text/plain; charset=UTF-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'La cl=C3=B4ture fait 50 m=C3=A8tres, avec un retour c=',
  'ote route.',
]));
verifie('quoted-printable : accents decodes',
  mail.corps.indexOf('clôture') !== -1 && mail.corps.indexOf('mètres') !== -1, JSON.stringify(mail.corps));
verifie('quoted-printable : saut de ligne souple recolle',
  mail.corps.indexOf('cote route') !== -1, JSON.stringify(mail.corps));

// --- 1d. En-tetes encodees (=?UTF-8?B?..?= et =?UTF-8?Q?..?=) ---
mail = sandbox.analyserEml(crlf([
  'From: =?UTF-8?B?' + b64('Jean Dupé') + '?= <jean@paysage-dupont.fr>',
  'Subject: =?UTF-8?Q?Devis_terrasse_=C3=A9t=C3=A9?=',
  'Content-Type: text/plain',
  '',
  'Contenu.',
]));
verifie('En-tete encodee B (base64)', mail.de.indexOf('Jean Dupé') === 0, mail.de);
verifie('En-tete encodee Q (quoted-printable, _ = espace)',
  mail.objet === 'Devis terrasse été', mail.objet);

// --- 1e. En-tete repliee sur plusieurs lignes ---
mail = sandbox.analyserEml(crlf([
  'From: jean@paysage-dupont.fr',
  'Subject: Un objet vraiment tres long',
  '\tqui continue a la ligne suivante',
  'Content-Type: text/plain',
  '',
  'Corps.',
]));
verifie('En-tete repliee depliee',
  mail.objet === 'Un objet vraiment tres long qui continue a la ligne suivante', mail.objet);

// --- 1f. multipart/alternative : text/plain prefere a text/html ---
mail = sandbox.analyserEml(crlf([
  'From: jean@paysage-dupont.fr',
  'Subject: Multipart simple',
  'Content-Type: multipart/alternative; boundary="FRONTIERE"',
  '',
  '--FRONTIERE',
  'Content-Type: text/plain; charset=UTF-8',
  '',
  'Version texte.',
  '--FRONTIERE',
  'Content-Type: text/html; charset=UTF-8',
  '',
  '<p>Version <b>HTML</b>.</p>',
  '--FRONTIERE--',
]));
verifie('multipart/alternative : parseOk', mail.parseOk === true, JSON.stringify(mail));
verifie('multipart/alternative : text/plain prefere',
  mail.corps === 'Version texte.', JSON.stringify(mail.corps));

// --- 1g. multipart/mixed > alternative : ce que Gmail produit avec PJ ---
mail = sandbox.analyserEml(crlf([
  'From: jean@paysage-dupont.fr',
  'Subject: Avec piece jointe',
  'Content-Type: multipart/mixed; boundary="EXT"',
  '',
  '--EXT',
  'Content-Type: multipart/alternative; boundary="INT"',
  '',
  '--INT',
  'Content-Type: text/plain; charset=UTF-8',
  '',
  'Le devis est en piece jointe.',
  '--INT--',
  '--EXT',
  'Content-Type: application/pdf; name="devis.pdf"',
  'Content-Disposition: attachment; filename="devis.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  b64('%PDF-1.4 faux contenu'),
  '--EXT--',
]));
verifie('multipart imbrique (mixed > alternative) : parseOk', mail.parseOk === true, JSON.stringify(mail));
verifie('multipart imbrique : corps trouve',
  mail.corps === 'Le devis est en piece jointe.', JSON.stringify(mail.corps));
verifie('multipart imbrique : piece jointe ignoree',
  mail.corps.indexOf('PDF') === -1, JSON.stringify(mail.corps));

// --- 1h. Trois niveaux : cadrage explicite, on abandonne proprement ---
mail = sandbox.analyserEml(crlf([
  'From: jean@paysage-dupont.fr',
  'Subject: Trop imbrique',
  'Content-Type: multipart/mixed; boundary="A"',
  '',
  '--A',
  'Content-Type: multipart/mixed; boundary="B"',
  '',
  '--B',
  'Content-Type: multipart/alternative; boundary="C"',
  '',
  '--C',
  'Content-Type: text/plain',
  '',
  'Trop profond.',
  '--C--',
  '--B--',
  '--A--',
]));
verifie('Trois niveaux d\'imbrication : parseOk false (degradation)',
  mail.parseOk === false, JSON.stringify(mail));

// --- 1i. Corps HTML seul : detague ---
mail = sandbox.analyserEml(crlf([
  'From: jean@paysage-dupont.fr',
  'Subject: HTML seul',
  'Content-Type: text/html; charset=UTF-8',
  '',
  '<html><body><p>Bonjour</p><br><p>Le devis suit &amp; il est pret.</p></body></html>',
]));
verifie('HTML seul : balises retirees', mail.corps.indexOf('<') === -1, JSON.stringify(mail.corps));
verifie('HTML seul : entites decodees', mail.corps.indexOf('&') !== -1 && mail.corps.indexOf('&amp;') === -1,
  JSON.stringify(mail.corps));

// --- 1j. Fichier illisible : jamais d'exception, jamais de perte ---
['', 'nawak', ' binaire', '{"json": true}'].forEach((entree, i) => {
  let leve = false, resultat = null;
  try { resultat = sandbox.analyserEml(entree); } catch (e) { leve = true; }
  verifie('Entree illisible #' + (i + 1) + ' : aucune exception levee', !leve);
  verifie('Entree illisible #' + (i + 1) + ' : parseOk false',
    resultat && resultat.parseOk === false, JSON.stringify(resultat));
});

// ================================================================
// 2. Sens du mail (envoye / recu)
// ================================================================
console.log('\n2. Sens envoye / recu');
const NOS = ['cyril.samson41@gmail.com', 'alisson@example.fr'];
verifie('Expediteur dans nosAdresses -> envoye',
  sandbox.sensDepuisDe('Cyril <cyril.samson41@gmail.com>', NOS) === 'envoye');
verifie('Expediteur inconnu -> recu',
  sandbox.sensDepuisDe('Jean <jean@paysage-dupont.fr>', NOS) === 'recu');
verifie('Casse ignoree',
  sandbox.sensDepuisDe('CYRIL.SAMSON41@GMAIL.COM', NOS) === 'envoye');
verifie('Adresse nue, sans chevrons',
  sandbox.sensDepuisDe('alisson@example.fr', NOS) === 'envoye');
verifie('Liste vide -> recu (jamais d\'exception)',
  sandbox.sensDepuisDe('jean@paysage-dupont.fr', []) === 'recu');

// AC19 : sens et camp deduits, sans aucune saisie.
verifie('Mail envoye -> camp a_eux (on attend une reponse)',
  sandbox.campParDefaut('email', 'envoye') === 'a_eux');
verifie('Mail recu -> camp a_nous (on doit traiter)',
  sandbox.campParDefaut('email', 'recu') === 'a_nous');
verifie('Document -> camp a_nous', sandbox.campParDefaut('document') === 'a_nous');
verifie('Tache -> camp a_nous', sandbox.campParDefaut('tache') === 'a_nous');
verifie('Image non actionnable -> pas de camp', sandbox.campParDefaut('image') === '');
verifie('Contact non actionnable -> pas de camp', sandbox.campParDefaut('contact') === '');

// ================================================================
// 3. Detection du type et titre depuis le nom de fichier
// ================================================================
console.log('\n3. Type et titre depuis le fichier');
verifie('.eml -> email', sandbox.typeDepuisFichier('reponse-dupont.eml') === 'email');
verifie('.EML majuscules -> email', sandbox.typeDepuisFichier('REPONSE.EML') === 'email');
verifie('.pdf -> document', sandbox.typeDepuisFichier('devis.pdf') === 'document');
verifie('.docx -> document', sandbox.typeDepuisFichier('note.docx') === 'document');
verifie('.jpg -> image', sandbox.typeDepuisFichier('talus.jpg') === 'image');
verifie('.heic -> image', sandbox.typeDepuisFichier('IMG_0042.HEIC') === 'image');
verifie('Extension inconnue -> document (on range plutot que de refuser)',
  sandbox.typeDepuisFichier('truc.xyz') === 'document');
verifie('Sans extension -> document', sandbox.typeDepuisFichier('devis') === 'document');
verifie('Objet File du navigateur accepte aussi',
  sandbox.typeDepuisFichier({ name: 'photo.png' }) === 'image');

// AC24 : le titre pre-rempli, ce qui rend le titre obligatoire indolore.
verifie('devis-terrasse-dupont.pdf -> « Devis terrasse dupont »',
  sandbox.titreDepuisNomFichier('devis-terrasse-dupont.pdf') === 'Devis terrasse dupont',
  sandbox.titreDepuisNomFichier('devis-terrasse-dupont.pdf'));
verifie('Soulignes convertis en espaces',
  sandbox.titreDepuisNomFichier('mail_relance_dupont.eml') === 'Mail relance dupont');
verifie('Nom deja propre conserve',
  sandbox.titreDepuisNomFichier('Devis Terrasse.pdf') === 'Devis Terrasse');
verifie('Nom vide -> chaine vide (le champ sera refuse a la saisie)',
  sandbox.titreDepuisNomFichier('.pdf') === '');

// ================================================================
// 4. Jeu de donnees partage pour les vues
// ================================================================
const JOUR = 86400000;
const ilYA = (n) => ({ toDate: () => new Date(Date.now() - n * JOUR) });
const dans = (n) => ({ toDate: () => new Date(Date.now() + n * JOUR) });

sandbox.elements = [
  // Deux devis « terrasse » ecrits differemment (T10 / AC30) + un « Cloture »
  { id: 'd1', type: 'document', titre: 'Devis Dupont', sujet: 'terrasse', camp: 'a_nous',
    contactId: 'c1', creeLe: ilYA(9), dateEvenement: ilYA(9), url: 'https://res.cloudinary.com/x/d1.pdf' },
  { id: 'd2', type: 'document', titre: 'Devis Martin', sujet: 'Terrasse', camp: 'a_nous',
    contactId: 'c-disparu', creeLe: ilYA(12), dateEvenement: ilYA(12) },
  { id: 'd3', type: 'document', titre: 'Devis TERRASSE bis', sujet: 'TERRASSE', camp: 'clos',
    creeLe: ilYA(20), dateEvenement: ilYA(20) },
  { id: 'd4', type: 'document', titre: 'Devis cloture', sujet: 'cloture', camp: 'a_nous',
    creeLe: ilYA(30), dateEvenement: ilYA(30) },

  // AC6 : bascule en a_eux il y a 18 jours -> au-dela du seuil de 15
  { id: 'm1', type: 'email', objet: 'Demande de devis talus', sens: 'envoye', camp: 'a_eux',
    campDepuis: ilYA(18), contactId: 'c1', corps: 'Bonjour, pourriez-vous chiffrer le talus ?',
    creeLe: ilYA(18), dateEvenement: ilYA(18), parseOk: true },
  { id: 'm2', type: 'email', objet: 'Re: terrasse', sens: 'recu', camp: 'a_nous',
    campDepuis: ilYA(3), corps: 'Voici notre proposition.', creeLe: ilYA(3), dateEvenement: ilYA(3), parseOk: false },

  { id: 't1', type: 'tache', titre: 'Mesurer le talus', camp: 'a_nous', assigneA: 'Alisson',
    dateEcheance: ilYA(2), creeLe: ilYA(15), dateEvenement: ilYA(15) },
  { id: 't2', type: 'tache', titre: 'Appeler la mairie', camp: 'a_nous', assigneA: 'Cyril',
    dateEcheance: dans(5), creeLe: ilYA(10), dateEvenement: ilYA(10) },
  { id: 't3', type: 'tache', titre: 'Choisir les plots', camp: 'clos', creeLe: ilYA(40), dateEvenement: ilYA(40) },

  { id: 'i1', type: 'image', categorie: 'actuelle', url: 'https://res.cloudinary.com/x/i1.jpg',
    creeLe: ilYA(11), dateEvenement: ilYA(11) },
  { id: 'i2', type: 'image', categorie: 'projection', url: 'https://res.cloudinary.com/x/i2.jpg',
    creeLe: ilYA(14), dateEvenement: ilYA(14) },

  { id: 'n1', type: 'note', titre: 'Idee talus', notes: 'Plantes couvre-sol plutot que du gazon.',
    creeLe: ilYA(16), dateEvenement: ilYA(16) },

  { id: 'c1', type: 'contact', prenom: 'Jean', nom: 'Dupont', entreprise: "O'Fil Paysage",
    categorie: 'paysagiste', telephone: '03 81 00 00 00', email: 'jean@paysage-dupont.fr',
    titre: 'Jean Dupont', creeLe: ilYA(25) },
  { id: 'c2', type: 'contact', prenom: 'Marie', nom: 'Martin', entreprise: 'Martin BTP',
    categorie: 'btp', titre: 'Marie Martin', creeLe: ilYA(24) },

  { id: 'l1', type: 'lien', titre: 'Generateur de rendus', url: 'https://exemple.fr/ia',
    commentaire: 'Pour les projections du talus', creeLe: ilYA(22) },
];
sandbox.premierChargement = false;
sandbox.ficheProjet = { intervenants: ['Cyril', 'Alisson'], nosAdresses: NOS };

// ================================================================
// 5. Anciennete et seuil de relance
// ================================================================
console.log('\n5. Anciennete et relance');
verifie('joursDepuis(18 jours) === 18', sandbox.joursDepuis(ilYA(18)) === 18, String(sandbox.joursDepuis(ilYA(18))));
verifie('joursDepuis(aujourd\'hui) === 0', sandbox.joursDepuis(ilYA(0)) === 0);
verifie('joursDepuis(null) === null (serverTimestamp pas encore revenu)',
  sandbox.joursDepuis(null) === null);
verifie('Le seuil de relance est bien 15 jours', sandbox.SEUIL_RELANCE_JOURS === 15);

sandbox.renderEtat();
const htmlEtat = elements['vue-etat'].innerHTML;

// Isole un bloc du tableau de bord : sans ca, « le devis cloture
// n'apparait pas dans Choix » serait faux pour une bonne raison — il
// apparait dans « A nous », ce qui est le comportement attendu.
function blocDe(html, id) {
  const debut = html.indexOf('id="bloc-' + id + '"');
  if (debut === -1) return '';
  const fin = html.indexOf('</section>', debut);
  return html.slice(debut, fin === -1 ? html.length : fin);
}

// AC6 : « 18 jours » + badge « a relancer »
verifie('AC6 : l\'element a_eux depuis 18 jours affiche son anciennete',
  /18 jours/.test(htmlEtat), htmlEtat.slice(0, 200));
verifie('AC6 : au-dela du seuil, le badge « à relancer » apparait',
  htmlEtat.indexOf('à relancer') !== -1);
verifie('L\'element bascule il y a 3 jours ne demande pas de relance',
  (htmlEtat.match(/à relancer/g) || []).length === 1,
  String((htmlEtat.match(/à relancer/g) || []).length));

// AC9 : aucun pourcentage d'avancement, nulle part. Ce n'est pas un
// oubli d'affichage, c'est une decision : le total des taches d'un
// chantier qui se decouvre en avancant est inconnu par nature.
verifie('AC9 : aucun pourcentage d\'avancement nulle part',
  htmlEtat.indexOf('%') === -1);

// AC8 : deux devis ou plus sur un meme sujet -> « a comparer ».
const blocChoix = blocDe(htmlEtat, 'choix');
verifie('AC8 : le bloc Choix annonce « 3 devis, à comparer » pour terrasse',
  blocChoix.indexOf('3 devis, à comparer') !== -1, blocChoix.slice(0, 400));
verifie('AC8 : un sujet a un seul devis (cloture) n\'apparait pas dans Choix',
  blocChoix.toLowerCase().indexOf('cloture') === -1, blocChoix.slice(0, 400));

// AC9 (suite) : « rien n'a bouge depuis N jours ». Il faut pour ca un
// jeu ou RIEN n'est recent — le jeu principal contient un mail de
// trois jours, qui remplit legitimement « cette semaine ».
sandbox.elements = [
  { id: 'x1', type: 'document', titre: 'Vieux devis', creeLe: ilYA(9), dateEvenement: ilYA(9) },
  { id: 'x2', type: 'tache', titre: 'Vieille tache', camp: 'a_nous', creeLe: ilYA(20) },
];
sandbox.renderEtat();
const htmlFige = elements['vue-etat'].innerHTML;
verifie('AC9 : « rien n\'a bougé depuis 9 jours » quand plus rien ne bouge',
  htmlFige.indexOf('a bougé depuis 9 jours') !== -1,
  blocDe(htmlFige, 'mouvement').slice(0, 300));
verifie('AC9 : et toujours aucun pourcentage', htmlFige.indexOf('%') === -1);

// A l'inverse, un element recent doit produire « cette semaine ».
sandbox.elements = [{ id: 'x3', type: 'document', titre: 'Devis frais', creeLe: ilYA(1), dateEvenement: ilYA(1) }];
sandbox.renderEtat();
verifie('Un element recent bascule Mouvement sur « cette semaine »',
  elements['vue-etat'].innerHTML.indexOf('Cette semaine') !== -1);

// Blocs vides : une phrase, pas un trou
sandbox.elements = [];
sandbox.renderEtat();
const htmlVide = elements['vue-etat'].innerHTML;
verifie('Bloc vide : une phrase rassurante plutot qu\'un trou',
  /Rien ne vous attend/.test(htmlVide) && /n.{0,8}attendez personne/.test(htmlVide.replace(/&#39;/g, "'")));
verifie('Base vide : on ne dit pas « rien n\'a bougé depuis 0 jour »',
  htmlVide.indexOf('bougé depuis') === -1 && /démarre/.test(htmlVide));

// ================================================================
// 6. Regroupement des devis par sujet
// ================================================================
console.log('\n6. Regroupement par sujet');
sandbox.elements = [
  { id: 'd1', type: 'document', titre: 'Devis Dupont', sujet: 'terrasse', creeLe: ilYA(9), dateEvenement: ilYA(9) },
  { id: 'd2', type: 'document', titre: 'Devis Martin', sujet: 'Terrasse', creeLe: ilYA(12), dateEvenement: ilYA(12) },
  { id: 'd3', type: 'document', titre: 'Devis bis', sujet: 'TERRASSE', creeLe: ilYA(20), dateEvenement: ilYA(20) },
  { id: 'd4', type: 'document', titre: 'Devis cloture', sujet: 'clôture', creeLe: ilYA(30), dateEvenement: ilYA(30) },
  { id: 'd5', type: 'document', titre: 'Sans sujet', creeLe: ilYA(31), dateEvenement: ilYA(31) },
];

verifie('cleSujet plie la casse', sandbox.cleSujet('TERRASSE') === sandbox.cleSujet('terrasse'));
verifie('cleSujet plie les accents',
  sandbox.cleSujet('clôture') === 'cloture', sandbox.cleSujet('clôture'));
verifie('cleSujet normalise les espaces', sandbox.cleSujet('  mur   bas  ') === 'mur bas');
verifie('cleSujet sur vide reste vide', sandbox.cleSujet('') === '' && sandbox.cleSujet(null) === '');

// AC30 : trois orthographes, un seul groupe
const groupes = sandbox.grouperDocumentsParSujet(sandbox.elementsDeType('document'));
const terrasse = groupes.filter((g) => g.cle === 'terrasse');
verifie('AC30 : « terrasse », « Terrasse » et « TERRASSE » = UN seul groupe',
  terrasse.length === 1 && terrasse[0].devis.length === 3,
  terrasse.length + ' groupe(s), ' + (terrasse[0] ? terrasse[0].devis.length : 0) + ' devis');
verifie('Les documents sans sujet forment un groupe a part, en dernier',
  groupes[groupes.length - 1].orphelins === true && groupes[groupes.length - 1].devis.length === 1);
verifie('Le sujet le plus fourni passe en tete', groupes[0].cle === 'terrasse', groupes[0].cle);

// ================================================================
// 7. Filtrage du fil
// ================================================================
console.log('\n7. Fil');
sandbox.elements = [
  { id: 't1', type: 'tache', titre: 'Tache', creeLe: ilYA(5), dateEvenement: ilYA(5) },
  { id: 'm1', type: 'email', objet: 'Mail', creeLe: ilYA(1), dateEvenement: ilYA(30) },
  { id: 'd1', type: 'document', titre: 'Devis', creeLe: ilYA(2), dateEvenement: ilYA(2) },
  { id: 'i1', type: 'image', url: 'https://res.cloudinary.com/x/i.jpg', creeLe: ilYA(3), dateEvenement: ilYA(3) },
  { id: 'n1', type: 'note', titre: 'Note', creeLe: ilYA(4), dateEvenement: ilYA(4) },
  { id: 'c1', type: 'contact', titre: 'Jean Dupont', creeLe: ilYA(6) },
  { id: 'l1', type: 'lien', titre: 'Un lien', url: 'https://exemple.fr', creeLe: ilYA(7) },
];

const fil = sandbox.elementsDuFil();
verifie('Le fil ne contient que les types evenementiels',
  fil.length === 5, fil.length + ' elements');
verifie('Contacts et liens exclus du fil',
  !fil.some((e) => e.type === 'contact' || e.type === 'lien'));

// R5 : le fil se trie sur dateEvenement, pas sur creeLe. Le mail
// archive hier mais date d'il y a 30 jours doit finir DERNIER.
verifie('AC22 : le fil se trie sur dateEvenement, pas sur la date d\'archivage',
  fil[fil.length - 1].id === 'm1', fil.map((e) => e.id).join(','));

sandbox.filtreTypeFil = 'email';
sandbox.renderFil();
verifie('Le filtre par type ne laisse que ce type',
  (elements['vue-fil'].innerHTML.match(/carte-fil carte-fil--/g) || []).length === 1);
sandbox.filtreTypeFil = 'tous';

// ================================================================
// 8. Taches : tri, filtres, assignation
// ================================================================
console.log('\n8. Taches');
sandbox.elements = [
  { id: 't1', type: 'tache', titre: 'Mesurer le talus', camp: 'a_nous', assigneA: 'Alisson', dateEcheance: ilYA(2), creeLe: ilYA(15) },
  { id: 't2', type: 'tache', titre: 'Appeler la mairie', camp: 'a_nous', assigneA: 'Cyril', dateEcheance: dans(5), creeLe: ilYA(10) },
  { id: 't3', type: 'tache', titre: 'Choisir les plots', camp: 'clos', creeLe: ilYA(40) },
  { id: 't4', type: 'tache', titre: 'Sans echeance ni nom', camp: 'a_nous', creeLe: ilYA(1) },
];

sandbox.filtreCampTaches = 'ouvertes';
sandbox.triTaches = 'echeance';
let taches = sandbox.tachesFiltrees();
verifie('Le filtre « A traiter » masque les taches reglees',
  taches.length === 3 && !taches.some((t) => t.camp === 'clos'), taches.map((t) => t.id).join(','));
verifie('Tri par echeance : la plus en retard d\'abord, sans echeance en dernier',
  taches.map((t) => t.id).join(',') === 't1,t2,t4', taches.map((t) => t.id).join(','));

sandbox.triTaches = 'assigne';
taches = sandbox.tachesFiltrees();
verifie('Tri par personne : ordre alphabetique, les orphelines en dernier',
  taches.map((t) => t.assigneA || '-').join(',') === 'Alisson,Cyril,-',
  taches.map((t) => t.assigneA || '-').join(','));

// AC27 : l'assignation est visible sur la carte
sandbox.triTaches = 'echeance';
sandbox.renderTaches();
const htmlTaches = elements['vue-taches'].innerHTML;
verifie('AC27 : l\'assignation apparait sur la carte de tache',
  /badge-assigne[^>]*>.*Alisson/.test(htmlTaches) || htmlTaches.indexOf('Alisson') !== -1);
verifie('Une tache sans personne est signalee, pas passee sous silence',
  htmlTaches.indexOf('personne') !== -1);
verifie('Une echeance depassee est marquee « en retard »',
  htmlTaches.indexOf('en retard') !== -1);

sandbox.filtreCampTaches = 'clos';
verifie('Le filtre « Reglees » ne laisse que les taches closes',
  sandbox.tachesFiltrees().length === 1);
sandbox.filtreCampTaches = 'ouvertes';

// ================================================================
// 9. Recherche globale
// ================================================================
console.log('\n9. Recherche');
sandbox.elements = [
  { id: 'c1', type: 'contact', prenom: 'Jean', nom: 'Dupont', entreprise: 'Dupont Paysagiste',
    categorie: 'paysagiste', titre: 'Jean Dupont' },
  { id: 'm1', type: 'email', objet: 'Devis paysagiste', corps: 'Bonjour, suite a notre echange...', sens: 'recu' },
  { id: 'd1', type: 'document', titre: 'Devis terrasse', sujet: 'terrasse' },
  { id: 'd2', type: 'document', titre: 'Plan de clôture', sujet: 'clôture' },
  { id: 't1', type: 'tache', titre: 'Rien a voir', notes: 'Acheter du terreau' },
];

// AC10 : une recherche ramene contacts, mails et documents ensemble.
let trouves = sandbox.chercher('paysagiste');
verifie('AC10 : « paysagiste » ramene contact ET mail',
  trouves.length === 2 && trouves.some((e) => e.type === 'contact') && trouves.some((e) => e.type === 'email'),
  trouves.map((e) => e.type).join(','));

verifie('Recherche insensible a la casse', sandbox.chercher('PAYSAGISTE').length === 2);
verifie('Recherche insensible aux accents (cloture trouve cloture)',
  sandbox.chercher('cloture').length === 1, String(sandbox.chercher('cloture').length));
verifie('Recherche accentuee trouve aussi le non accentue',
  sandbox.chercher('clôture').length === 1);
verifie('Recherche dans les notes d\'une tache', sandbox.chercher('terreau').length === 1);
verifie('Recherche vide ne ramene rien (et ne plante pas)',
  sandbox.chercher('').length === 0 && sandbox.chercher(null).length === 0);
verifie('Recherche sans resultat', sandbox.chercher('helicoptere').length === 0);

// ================================================================
// 10. Contact supprime : on tolere, on ne plante pas
// ================================================================
console.log('\n10. Reference morte vers un contact');
sandbox.elements = [
  { id: 'c1', type: 'contact', prenom: 'Jean', nom: 'Dupont', titre: 'Jean Dupont' },
  { id: 'd1', type: 'document', titre: 'Devis vivant', contactId: 'c1', creeLe: ilYA(1), dateEvenement: ilYA(1) },
  { id: 'd2', type: 'document', titre: 'Devis orphelin', contactId: 'c-disparu', creeLe: ilYA(2), dateEvenement: ilYA(2) },
];
verifie('Un contact existant est nomme', sandbox.nomContact('c1') === 'Jean Dupont', sandbox.nomContact('c1'));
verifie('AC26 : un contact disparu affiche « contact supprime »',
  sandbox.nomContact('c-disparu') === 'contact supprimé', sandbox.nomContact('c-disparu'));
verifie('Aucun contactId -> chaine vide', sandbox.nomContact('') === '' && sandbox.nomContact(null) === '');

let plante = false;
try { sandbox.renderFil(); } catch (e) { plante = true; }
verifie('AC26 : le fil s\'affiche sans planter malgre la reference morte', !plante);
verifie('AC26 : la mention apparait bien a l\'ecran',
  elements['vue-fil'].innerHTML.indexOf('contact supprim') !== -1);

// ================================================================
// 11. Echappement des onclick
// ================================================================
// Le test qui compte : ce que le navigateur executera doit parser.
// Un bug reel a deja ete cause par la confusion escapeAttr / jsAttr —
// un projet nomme « O'Fil du Doubs » rendait les boutons inoperants.
console.log('\n11. Echappement');
verifie('jsAttr protege l\'apostrophe pour JS', sandbox.jsAttr("O'Fil") === "O\\'Fil");
verifie('escapeAttr transforme l\'apostrophe en entite (l\'inverse, volontairement)',
  sandbox.escapeAttr("O'Fil") === 'O&#39;Fil');

sandbox.elements = [
  { id: "id-avec-'apostrophe", type: 'document', titre: "Devis d'Alisson", sujet: "l'entree",
    camp: 'a_nous', creeLe: ilYA(1), dateEvenement: ilYA(1) },
  { id: 'id2', type: 'document', titre: 'Autre devis', sujet: "l'entree",
    camp: 'a_eux', campDepuis: ilYA(20), creeLe: ilYA(2), dateEvenement: ilYA(2) },
  { id: 'c1', type: 'contact', prenom: 'Jean', nom: "O'Connor", titre: "Jean O'Connor", categorie: 'btp' },
  { id: 'l1', type: 'lien', titre: "L'inspiration", url: 'https://exemple.fr' },
  { id: 't1', type: 'tache', titre: "Poser l'ossature", camp: 'a_nous', assigneA: 'Cyril', creeLe: ilYA(1) },
];

const decodeHtml = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

[['vue-etat', sandbox.renderEtat],
 ['vue-fil', sandbox.renderFil],
 ['vue-taches', sandbox.renderTaches],
 ['vue-documents', sandbox.renderDocuments],
 ['vue-carnet', sandbox.renderCarnet]].forEach(([id, render]) => {
  render();
  let valide = true, erreur = '';
  let compte = 0;
  for (const m of elements[id].innerHTML.matchAll(/onclick="([^"]*)"/g)) {
    compte++;
    // Un handler inline est un CORPS de fonction, pas un script : le
    // navigateur l'enveloppe. On l'enveloppe pareil, sinon un
    // « return false » legitime passerait pour une erreur de syntaxe.
    try { new vm.Script('(function(event){' + decodeHtml(m[1]) + '\n})'); }
    catch (e) { valide = false; erreur = decodeHtml(m[1]) + ' :: ' + e.message; }
  }
  verifie('Tous les onclick de ' + id + ' sont du JS valide apres decodage HTML (' + compte + ')',
    valide && compte > 0, erreur || 'aucun onclick genere');
});

// ================================================================
// 12. Chemins d'ecriture (avec un faux Firestore)
// ================================================================
// Ce qui part reellement dans la base : la tracabilite, le camp, et le
// fait qu'un depot se valide sans rien saisir.
console.log('\n12. Ecritures');

const ecritures = [];
sandbox.db = {
  collection(nom) {
    return {
      add(doc) { ecritures.push({ op: 'add', collection: nom, doc }); return Promise.resolve({ id: 'nouveau' }); },
      doc(id) {
        return {
          update(doc) { ecritures.push({ op: 'update', collection: nom, id, doc }); return Promise.resolve(); },
          set(doc, opts) { ecritures.push({ op: 'set', collection: nom, id, doc, opts }); return Promise.resolve(); },
          delete() { ecritures.push({ op: 'delete', collection: nom, id }); return Promise.resolve(); },
          get() { return Promise.resolve({ exists: true, data: () => ({ emlBrut: '' }) }); },
        };
      },
    };
  },
};
const derniere = () => ecritures[ecritures.length - 1];

// --- AC24 / AC3 : un devis depose s'enregistre sans rien saisir ---
sandbox.elements = [];
sandbox.ficheProjet = { intervenants: ['Cyril', 'Alisson'], nosAdresses: NOS };
sandbox.ouvrirModaleElement(null, {
  type: 'document',
  url: 'https://res.cloudinary.com/dxoyqxben/raw/upload/abc123',
  nomFichier: 'devis-terrasse-dupont.pdf',
  titre: sandbox.titreDepuisNomFichier('devis-terrasse-dupont.pdf'),
  camp: sandbox.campParDefaut('document'),
});
verifie('AC24 : le titre est deja rempli a l\'ouverture du formulaire',
  elements['e-titre'].value === 'Devis terrasse dupont', elements['e-titre'].value);

sandbox.sauverElement();
let ecrit = derniere();
verifie('AC24 : l\'enregistrement passe sans rien saisir', ecrit && ecrit.op === 'add');
verifie('AC3 : un element de type document est cree', ecrit.doc.type === 'document');
verifie('AC3 : l\'URL du fichier est conservee',
  ecrit.doc.url === 'https://res.cloudinary.com/dxoyqxben/raw/upload/abc123');
verifie('Le camp deduit part bien en base', ecrit.doc.camp === 'a_nous', ecrit.doc.camp);
verifie('campDepuis est pose automatiquement a la creation', ecrit.doc.campDepuis === 'SERVER_TS');
verifie('dateEvenement est pose par defaut', ecrit.doc.dateEvenement === 'SERVER_TS');

// --- AC14 : sous impersonation, la trace nomme l'utilisateur REEL ---
// HUB.user = Cyril, HUB.effectif = Alisson (l'impersonation en cours).
verifie('AC14 : creePar contient l\'adresse REELLE, pas l\'impersonnee',
  ecrit.doc.creePar === 'cyril.samson41@gmail.com', ecrit.doc.creePar);
verifie('AC14 : modifiePar aussi', ecrit.doc.modifiePar === 'cyril.samson41@gmail.com');
verifie('AC14 : rien de l\'identite impersonnee n\'a fuite',
  JSON.stringify(ecrit.doc).indexOf('Alisson') === -1);

// --- Un titre vide est refuse (le contenu d'un PDF n'est pas indexable) ---
const avant = ecritures.length;
elements['e-titre'].value = '   ';
sandbox.sauverElement();
verifie('Un titre vide est refuse : rien n\'est ecrit', ecritures.length === avant);

// --- AC20 : la bascule de camp reinitialise campDepuis ---
sandbox.elements = [{ id: 'z1', type: 'email', objet: 'Devis talus', sens: 'envoye',
  camp: 'a_eux', campDepuis: ilYA(18), corps: 'Bonjour', parseOk: true }];
sandbox.changerCamp('z1', 'a_nous');
ecrit = derniere();
verifie('AC20 : la bascule ecrit le nouveau camp',
  ecrit.op === 'update' && ecrit.id === 'z1' && ecrit.doc.camp === 'a_nous', JSON.stringify(ecrit));
verifie('AC20 : campDepuis repart de maintenant', ecrit.doc.campDepuis === 'SERVER_TS');

// Meme chose depuis la modale : changer le camp doit aussi le remettre a zero.
sandbox.ouvrirModaleElement('z1');
elements['e-camp'].value = 'clos';
sandbox.sauverElement();
ecrit = derniere();
verifie('Modale : changer le camp reinitialise campDepuis aussi',
  ecrit.doc.camp === 'clos' && ecrit.doc.campDepuis === 'SERVER_TS', JSON.stringify(ecrit.doc));

// Ne PAS toucher au camp ne doit pas rajeunir l'anciennete.
sandbox.elements = [{ id: 'z2', type: 'tache', titre: 'Relancer', camp: 'a_eux', campDepuis: ilYA(18) }];
sandbox.ouvrirModaleElement('z2');
elements['e-titre'].value = 'Relancer Dupont';
sandbox.sauverElement();
ecrit = derniere();
verifie('Modifier autre chose ne remet PAS campDepuis a zero',
  ecrit.doc.campDepuis === undefined, JSON.stringify(ecrit.doc));

// --- Le corps abrege ne doit pas perdre son drapeau ---
sandbox.elements = [{ id: 'z3', type: 'email', objet: 'Long mail', sens: 'recu', camp: 'a_nous',
  corps: 'court', corpsTronque: true, parseOk: true }];
sandbox.ouvrirModaleElement('z3');
sandbox.sauverElement();
verifie('Un corps abrege reste marque comme abrege si on n\'y touche pas',
  derniere().doc.corpsTronque === true, JSON.stringify(derniere().doc));

sandbox.ouvrirModaleElement('z3');
elements['e-corps'].value = 'Un corps reecrit entierement a la main.';
sandbox.sauverElement();
verifie('Un corps reecrit n\'est plus marque comme abrege',
  derniere().doc.corpsTronque === false, JSON.stringify(derniere().doc));

// --- AC29 / AC21 : amorcage de la fiche projet ---
ecritures.length = 0;
sandbox.amorcerProjet();
ecrit = derniere();
verifie('AC29 : l\'amorcage utilise set(merge), jamais update()',
  ecrit.op === 'set' && ecrit.opts && ecrit.opts.merge === true, JSON.stringify(ecrit));
verifie('AC29 : il vise bien le singleton _projet', ecrit.id === '_projet');
verifie('AC21 : l\'adresse de la personne connectee rejoint nosAdresses',
  ecrit.doc.nosAdresses === 'cyril.samson41@gmail.com', String(ecrit.doc.nosAdresses));
verifie('AC21 : son prenom rejoint intervenants',
  ecrit.doc.intervenants === 'Cyril', String(ecrit.doc.intervenants));
verifie('T9 : c\'est bien HUB.user, pas HUB.effectif (Alisson)',
  JSON.stringify(ecrit.doc).indexOf('Alisson') === -1);

// --- AC25 : supprimer efface le document, pas le fichier ---
ecritures.length = 0;
sandbox.supprimerElement('z1');
verifie('AC25 : la suppression ne touche que Firestore',
  derniere().op === 'delete' && derniere().collection === 'exterieur');

// ================================================================
// 13. Toutes les vues s'affichent sans planter
// ================================================================
// Un ID de champ mal orthographie ou une concatenation ratee ne se
// voit qu'a l'execution : ce bloc les attrape.
console.log('\n13. Rendu de toutes les vues');
sandbox.elements = [
  { id: 'c1', type: 'contact', prenom: 'Jean', nom: 'Dupont', entreprise: 'Dupont Paysage',
    categorie: 'paysagiste', telephone: '03 81 00 00 00', email: 'jean@dupont.fr',
    commentaire: 'Reactif', titre: 'Jean Dupont', creeLe: ilYA(20) },
  { id: 'l1', type: 'lien', titre: 'Rendus IA', url: 'https://exemple.fr', commentaire: 'Pour le talus', creeLe: ilYA(19) },
  { id: 'm1', type: 'email', objet: 'Devis talus', sens: 'envoye', camp: 'a_eux', campDepuis: ilYA(18),
    corps: 'Bonjour,\n\nPourriez-vous chiffrer ?', corpsTronque: true, parseOk: true,
    url: 'https://res.cloudinary.com/x/m1.eml', creeLe: ilYA(18), dateEvenement: ilYA(18) },
  { id: 'm2', type: 'email', objet: 'Format bizarre', sens: 'recu', camp: 'a_nous',
    corps: '', parseOk: false, creeLe: ilYA(2), dateEvenement: ilYA(2) },
  { id: 'i1', type: 'image', categorie: 'actuelle', url: 'https://res.cloudinary.com/x/upload/i1.jpg',
    creeLe: ilYA(5), dateEvenement: ilYA(5) },
  { id: 'i2', type: 'image', categorie: 'projection', url: 'https://res.cloudinary.com/x/upload/i2.jpg',
    creeLe: ilYA(6), dateEvenement: ilYA(6) },
  { id: 'd1', type: 'document', titre: 'Devis A', sujet: 'terrasse', camp: 'a_nous',
    contactId: 'c1', url: 'https://res.cloudinary.com/x/d1.pdf', creeLe: ilYA(4), dateEvenement: ilYA(4) },
  { id: 't1', type: 'tache', titre: 'Mesurer', camp: 'a_nous', assigneA: 'Cyril',
    dateEcheance: dans(3), creeLe: ilYA(3) },
];
sandbox.ficheProjet = { budgetNotes: 'Enveloppe 15-20 k', ceQuonVeut: 'Terrasse',
  ceQuonNeVeutPas: 'Du beton', intervenants: ['Cyril', 'Alisson'], nosAdresses: NOS,
  modifiePar: 'cyril.samson41@gmail.com', modifieLe: ilYA(1) };

[['etat', () => sandbox.renderEtat()],
 ['fil', () => sandbox.renderFil()],
 ['taches', () => sandbox.renderTaches()],
 ['documents', () => sandbox.renderDocuments()],
 ['images actuelles', () => sandbox.renderImages('actuelle')],
 ['images projections', () => sandbox.renderImages('projection')],
 ['emails', () => sandbox.renderEmails()],
 ['carnet', () => sandbox.renderCarnet()],
 ['projet', () => sandbox.renderProjet()]].forEach(([nom, render]) => {
  let erreur = '';
  try { render(); } catch (e) { erreur = e.message; }
  verifie('La vue « ' + nom + ' » s\'affiche sans exception', !erreur, erreur);
});

// La vue Emails doit signaler le mail mal compris plutot que de le cacher.
verifie('Un mail parseOk=false est signale a l\'ecran',
  elements['vue-emails'].innerHTML.indexOf('mal compris') !== -1);
// Et proposer la copie, sa raison d'etre.
verifie('Le bouton « Copier le corps » est present',
  (elements['vue-emails'].innerHTML.match(/Copier le corps/g) || []).length === 2);

// Les modales s'ouvrent aussi sans planter, tous types confondus.
['tache', 'note', 'document', 'image', 'email'].forEach((type) => {
  let erreur = '';
  try { sandbox.ouvrirModaleElement(null, { type: type }); } catch (e) { erreur = e.message; }
  verifie('La modale s\'ouvre pour le type « ' + type + ' »', !erreur, erreur);
});
['ouvrirModaleContact', 'ouvrirModaleLien'].forEach((fn) => {
  let erreur = '';
  try { sandbox[fn](null); } catch (e) { erreur = e.message; }
  verifie(fn + '(null) s\'ouvre sans exception', !erreur, erreur);
});

// Le routeur : chaque vue declaree a bien un conteneur et une fonction.
console.log('\n14. Routeur');
verifie('Neuf vues declarees dans le selecteur', sandbox.VUES.length === 9, String(sandbox.VUES.length));
const htmlIndex = fs.readFileSync(path.join(PROJET, 'index.html'), 'utf8');
sandbox.VUES.forEach((vue) => {
  verifie('La vue « ' + vue.nom + ' » a son conteneur dans index.html',
    htmlIndex.indexOf('id="vue-' + vue.nom + '"') !== -1);
});
verifie('La vue Resultats a son conteneur', htmlIndex.indexOf('id="vue-resultats"') !== -1);
verifie('AC17 : la vue par defaut est « Ou on en est »', sandbox.VUE_DEFAUT === 'etat');

// Tous les fichiers JS du projet sont bien charges par la page.
fs.readdirSync(PROJET).filter((f) => f.endsWith('.js')).forEach((f) => {
  verifie('index.html charge ' + f, htmlIndex.indexOf('src="' + f + '"') !== -1);
});
verifie('index.html charge hub-utils.js', htmlIndex.indexOf('src="../hub-utils.js"') !== -1);
verifie('CSP : Cloudinary autorise en connect-src (upload + relecture .eml)',
  /connect-src[^;]*api\.cloudinary\.com/.test(htmlIndex) && /connect-src[^;]*res\.cloudinary\.com/.test(htmlIndex));
verifie('CSP : Cloudinary autorise en img-src (vignettes)',
  /img-src[^;]*res\.cloudinary\.com/.test(htmlIndex));
verifie('AC15 : deux entrees distinctes pour les photos (capture ET sans)',
  /id="photo-camera"[^>]*capture="environment"/.test(htmlIndex.replace(/\s+/g, ' '))
  && /id="photo-galerie"[^>]*accept="image\/\*"/.test(htmlIndex.replace(/\s+/g, ' ')));

// ================================================================
// 15. Garanties de bout en bout
// ================================================================
console.log('\n15. Garanties');

// --- AC3 : un PDF s'ouvre dans un onglet, jamais dans une iframe ---
// (c'est ce qui evite d'avoir a ouvrir frame-src dans la CSP)
sandbox.elements = [{ id: 'p1', type: 'document', titre: 'Devis A', sujet: 'terrasse',
  url: 'https://res.cloudinary.com/x/d.pdf', creeLe: ilYA(1), dateEvenement: ilYA(1) }];
sandbox.renderDocuments();
const htmlDocs = elements['vue-documents'].innerHTML;
verifie('AC3 : le PDF s\'ouvre dans un nouvel onglet',
  /target="_blank"[^>]*rel="noopener"/.test(htmlDocs) || /rel="noopener"/.test(htmlDocs));
verifie('AC3 : aucun <iframe> pour afficher un PDF',
  htmlDocs.indexOf('<iframe') === -1);

// --- AC23 : creer une tache ou une note sans deposer de fichier ---
['tache', 'note'].forEach((type) => {
  let erreur = '';
  try { sandbox.ajouterEnEcrivant(type); } catch (e) { erreur = e.message; }
  verifie('AC23 : « Ecrire » ouvre le formulaire pour une ' + type, !erreur, erreur);
  verifie('AC23 : le type est bien ' + type, elements['e-type'].value === type, elements['e-type'].value);
});
elements['e-titre'].value = 'Tailler la haie';
ecritures.length = 0;
sandbox.sauverElement();
verifie('AC23 : la note/tache s\'enregistre sans aucun fichier',
  derniere().op === 'add' && derniere().doc.url === undefined, JSON.stringify(derniere().doc));

// --- AC11 : basculer une image de categorie sans la reteleverser ---
sandbox.elements = [{ id: 'im1', type: 'image', categorie: 'projection',
  url: 'https://res.cloudinary.com/x/upload/im1.jpg', creeLe: ilYA(1), dateEvenement: ilYA(1) }];
ecritures.length = 0;
sandbox.basculerCategorie('im1', 'actuelle');
verifie('AC11 : seule la categorie change',
  derniere().op === 'update' && derniere().doc.categorie === 'actuelle', JSON.stringify(derniere()));
verifie('AC11 : l\'URL n\'est pas retouchee (donc pas de re-upload)',
  derniere().doc.url === undefined);

// --- AC12 : « Copier le corps » met le texte dans le presse-papier ---
let presseDPapier = null;
sandbox.navigator.clipboard = { writeText(t) { presseDPapier = t; return Promise.resolve(); } };
sandbox.elements = [{ id: 'mc1', type: 'email', objet: 'Demande de devis',
  corps: 'Bonjour,\n\nPourriez-vous chiffrer la terrasse ?\n\nCyril', corpsTronque: false, sens: 'envoye' }];
sandbox.copierCorps('mc1');
// La chaine de promesses se resout au tick suivant.
setTimeout(() => {
  verifie('AC12 : le corps integral part dans le presse-papier',
    presseDPapier === 'Bonjour,\n\nPourriez-vous chiffrer la terrasse ?\n\nCyril',
    JSON.stringify(presseDPapier));

  // --- AC16 : un echec reseau ne laisse AUCUN document orphelin ---
  // On simule un XMLHttpRequest qui echoue : rien ne doit partir en base.
  let requeteCreee = null;
  sandbox.XMLHttpRequest = function () {
    requeteCreee = this;
    this.upload = {};
    this.open = function () {};
    this.send = function () { const self = this; setTimeout(() => self.onerror && self.onerror(), 0); };
  };
  sandbox.FormData = function () { this.append = function () {}; };

  ecritures.length = 0;
  let leve = false;
  sandbox.uploadFichier({ name: 'devis.pdf' }, null)
    .then(() => { verifie('AC16 : un upload en echec ne doit pas reussir', false); finir(); })
    .catch((erreur) => {
      verifie('AC16 : l\'echec reseau est bien signale',
        /Cloudinary/.test(erreur.message), erreur.message);
      verifie('AC16 : AUCUN document Firestore orphelin n\'a ete cree',
        ecritures.length === 0, JSON.stringify(ecritures));
      verifie('AC16 : aucune exception ne remonte au-dela de la promesse', !leve);
      finir();
    });
}, 0);

function finir() {
  console.log('\n' + (echecs === 0 ? 'Tous les tests passent.' : echecs + ' test(s) en echec.'));
  process.exit(echecs === 0 ? 0 : 1);
}
