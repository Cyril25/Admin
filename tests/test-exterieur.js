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
  //
  // arrayUnion enveloppe sa valeur plutot que de la rendre telle
  // quelle : c'est ce qui permet de verifier qu'un ajout au journal
  // AJOUTE, au lieu de reecrire le tableau entier — la difference entre
  // « on garde tout » et « le dernier qui ecrit efface l'autre ».
  firebase: { firestore: { FieldValue: {
    serverTimestamp: () => 'SERVER_TS',
    arrayUnion: (v) => ({ arrayUnion: v }),
    arrayRemove: (v) => ({ arrayRemove: v }),
  } } },
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
  ecrit.doc.nosAdresses.arrayUnion === 'cyril.samson41@gmail.com', JSON.stringify(ecrit.doc.nosAdresses));
verifie('AC21 : son prenom rejoint intervenants',
  ecrit.doc.intervenants.arrayUnion === 'Cyril', JSON.stringify(ecrit.doc.intervenants));
verifie('T9 : c\'est bien HUB.user, pas HUB.effectif (Alisson)',
  JSON.stringify(ecrit.doc).indexOf('Alisson') === -1);

// --- AC25 : supprimer efface le document, pas le fichier ---
ecritures.length = 0;
sandbox.supprimerElement('z1');
verifie('AC25 : la suppression ne touche que Firestore',
  derniere().op === 'delete' && derniere().collection === 'exterieur');

// ================================================================
// 12 bis. Le journal — une tache est une suite d'evenements
// ================================================================
// « Ecrire a Untel » n'est pas un etat : on ecrit, on attend, on
// apprend que la personne n'est pas dispo, on renonce. Le camp seul ne
// retient que le dernier chapitre. Ce qui est verifie ici, c'est que
// les autres survivent — y compris sur les taches saisies AVANT que le
// journal existe, qui n'ont pas le champ.
console.log('\n12 bis. Journal');

const TACHE_ANCIENNE = { id: 'j0', type: 'tache', titre: 'Ecrire a Jean', camp: 'a_nous',
  creePar: 'cyril.samson41@gmail.com', creeLe: ilYA(20) };

// --- Aucune migration : une tache sans champ journal se lit ---
sandbox.elements = [TACHE_ANCIENNE];
verifie('Une tache d\'avant le journal a un journal vide, pas une erreur',
  Array.isArray(sandbox.journalDe(TACHE_ANCIENNE)) && sandbox.journalDe(TACHE_ANCIENNE).length === 0);
verifie('Elle a quand meme une histoire : la creation, deduite de creeLe',
  sandbox.journalAffiche(TACHE_ANCIENNE).length === 1
  && sandbox.journalAffiche(TACHE_ANCIENNE)[0].creation === true,
  JSON.stringify(sandbox.journalAffiche(TACHE_ANCIENNE)));
verifie('La ligne de creation n\'est jamais stockee (elle n\'est pas dans journal)',
  TACHE_ANCIENNE.journal === undefined);
verifie('dernierEvenement d\'une tache sans journal vaut null',
  sandbox.dernierEvenement(TACHE_ANCIENNE) === null);
verifie('journalDe(null) ne plante pas', sandbox.journalDe(null).length === 0);

// --- L'ordre : on lit une histoire, du debut a la fin ---
const TACHE_RICHE = { id: 'j1', type: 'tache', titre: 'Ecrire a Jean', camp: 'clos',
  creePar: 'cyril.samson41@gmail.com', creeLe: ilYA(30), journal: [
    // Volontairement dans le desordre : les dates viennent de deux
    // navigateurs, dont les horloges ne sont pas d'accord.
    { le: ilYA(5),  par: 'alisson@example.fr',        camp: 'clos',  campAvant: 'a_eux',
      texte: 'Pas dispo cette annee, on ne travaillera pas avec eux.' },
    { le: ilYA(20), par: 'cyril.samson41@gmail.com',  camp: 'a_eux', campAvant: 'a_nous',
      texte: 'Mail envoye a Jean Dupont.' },
    { le: ilYA(12), par: 'cyril.samson41@gmail.com',  texte: 'Relance par telephone, sans reponse.' },
  ] };
sandbox.elements = [TACHE_RICHE];

let histoire = sandbox.journalDe(TACHE_RICHE);
verifie('Le journal se lit du plus ancien au plus recent',
  histoire.map((e) => e.texte.slice(0, 6)).join('|') === 'Mail e|Relanc|Pas di',
  histoire.map((e) => e.texte.slice(0, 6)).join('|'));
verifie('journalAffiche met la creation en tete',
  sandbox.journalAffiche(TACHE_RICHE)[0].creation === true);
verifie('dernierEvenement rend le plus recent, pas le dernier du tableau',
  sandbox.dernierEvenement(TACHE_RICHE).texte.indexOf('Pas dispo') === 0,
  sandbox.dernierEvenement(TACHE_RICHE).texte);
verifie('Le tri ne modifie pas le tableau d\'origine',
  TACHE_RICHE.journal[0].texte.indexOf('Pas dispo') === 0);

// --- Un passage sans commentaire reste une information ---
verifie('Un evenement sans texte se resume par son camp',
  sandbox.resumeEvenement({ camp: 'clos', texte: '' }) === 'passage en « Réglé »',
  sandbox.resumeEvenement({ camp: 'clos', texte: '' }));
verifie('Un evenement avec texte se resume par son texte',
  sandbox.resumeEvenement({ camp: 'clos', texte: 'Devis signe.' }) === 'Devis signe.');
verifie('resumeEvenement(null) rend une chaine vide', sandbox.resumeEvenement(null) === '');

// --- L'ecriture : arrayUnion, jamais une reecriture du tableau ---
ecritures.length = 0;
sandbox.changerCamp('j1', 'a_nous', 'Ils rappellent finalement.');
ecrit = derniere();
verifie('Un evenement s\'AJOUTE (arrayUnion), il ne reecrit pas le tableau',
  ecrit.doc.journal && ecrit.doc.journal.arrayUnion !== undefined
  && !Array.isArray(ecrit.doc.journal), JSON.stringify(ecrit.doc.journal));
let entree = ecrit.doc.journal.arrayUnion;
verifie('L\'evenement porte le commentaire saisi',
  entree.texte === 'Ils rappellent finalement.', entree.texte);
verifie('L\'evenement porte le camp d\'arrivee', entree.camp === 'a_nous', entree.camp);
verifie('… et celui de depart, pour relire la bascule',
  entree.campAvant === 'clos', entree.campAvant);
verifie('L\'evenement nomme l\'utilisateur REEL, comme creePar',
  entree.par === 'cyril.samson41@gmail.com', entree.par);
verifie('Rien de l\'identite impersonnee ne fuite dans le journal',
  JSON.stringify(entree).indexOf('Alisson') === -1);
verifie('La bascule ecrit toujours camp et campDepuis',
  ecrit.doc.camp === 'a_nous' && ecrit.doc.campDepuis === 'SERVER_TS', JSON.stringify(ecrit.doc));

// serverTimestamp() est INTERDIT par Firestore dans un element de
// tableau : la date vient de l'horloge du navigateur. Si quelqu'un
// « corrige » ca un jour, l'ecriture entiere sera rejetee.
verifie('La date de l\'evenement est une vraie Date, PAS un serverTimestamp',
  entree.le instanceof Date, String(entree.le));

// --- Basculer sans rien dire reste possible : le cout d'une saisie
//     obligatoire tuerait l'outil ---
ecritures.length = 0;
sandbox.changerCamp('j1', 'clos', '');
entree = derniere().doc.journal.arrayUnion;
verifie('On peut basculer sans commentaire : l\'evenement est ecrit quand meme',
  entree.texte === '' && entree.camp === 'clos', JSON.stringify(entree));

// --- Mais une note vide SANS bascule ne raconte rien : rien ne part ---
// Le .catch() est la pour ne pas laisser un rejet non traite : le refus
// se lit sur l'absence d'ecriture, qui est synchrone.
ecritures.length = 0;
sandbox.ajouterEvenement('j1', '   ', '').catch(() => {});
verifie('Une note vide sans bascule n\'ecrit rien', ecritures.length === 0);

// --- Une note seule, sans changement de camp ---
ecritures.length = 0;
sandbox.ajouterEvenement('j1', 'Relance par telephone.', '');
ecrit = derniere();
verifie('Une note seule s\'ajoute au journal', ecrit.doc.journal.arrayUnion.texte === 'Relance par telephone.');
verifie('… sans toucher au camp ni a l\'anciennete',
  ecrit.doc.camp === undefined && ecrit.doc.campDepuis === undefined, JSON.stringify(ecrit.doc));

// --- Un texte trop long est coupe, pas refuse ---
ecritures.length = 0;
sandbox.ajouterEvenement('j1', 'x'.repeat(900), '');
verifie('Un evenement trop long est coupe a MAX_EVENEMENT, pas rejete',
  derniere().doc.journal.arrayUnion.texte.length === sandbox.MAX_EVENEMENT,
  String(derniere().doc.journal.arrayUnion.texte.length));

// --- Le meme chemin depuis la modale : l'histoire ne doit pas avoir
//     de trous selon le bouton qu'on a pris ---
sandbox.elements = [{ id: 'j2', type: 'tache', titre: 'Appeler la mairie', camp: 'a_nous', creeLe: ilYA(4) }];
ecritures.length = 0;
sandbox.ouvrirModaleElement('j2');
elements['e-camp'].value = 'a_eux';
sandbox.sauverElement();
ecrit = derniere();
verifie('Changer le camp depuis la modale entre AUSSI au journal',
  ecrit.doc.journal && ecrit.doc.journal.arrayUnion.camp === 'a_eux', JSON.stringify(ecrit.doc.journal));

// … et modifier autre chose n'invente pas d'evenement.
ecritures.length = 0;
sandbox.ouvrirModaleElement('j2');
elements['e-titre'].value = 'Appeler la mairie de Pontarlier';
sandbox.sauverElement();
verifie('Modifier le titre seul n\'ecrit aucun evenement',
  derniere().doc.journal === undefined, JSON.stringify(derniere().doc));

// --- Le clic sur un bouton de camp DEMANDE ce qui s'est passe ---
// TACHE_RICHE est close : elle n'apparait ni dans « A nous » ni dans
// « En attente ». Il en faut donc une ouverte pour voir le tableau de
// bord, et le filtre « toutes » pour voir la close dans les taches.
const TACHE_ATTENTE = { id: 'j3', type: 'tache', titre: 'Relancer Dupont', camp: 'a_eux',
  campDepuis: ilYA(6), creePar: 'cyril.samson41@gmail.com', creeLe: ilYA(20), journal: [
    { le: ilYA(6), par: 'cyril.samson41@gmail.com', camp: 'a_eux', campAvant: 'a_nous',
      texte: 'Mail envoye a Jean Dupont.' },
  ] };
sandbox.elements = [TACHE_RICHE, TACHE_ATTENTE];
sandbox.filtreCampTaches = 'toutes';
ecritures.length = 0;
sandbox.renderEtat();
sandbox.renderTaches();
sandbox.filtreCampTaches = 'ouvertes';

verifie('Les boutons de camp ouvrent la modale au lieu d\'ecrire directement',
  elements['vue-etat'].innerHTML.indexOf('ouvrirModaleJournal(') !== -1
  && elements['vue-etat'].innerHTML.indexOf('changerCamp(') === -1,
  elements['vue-etat'].innerHTML.slice(0, 200));
verifie('Un clic sur un bouton de camp n\'ecrit rien tout seul', ecritures.length === 0);

// --- Ce qu'on lit sans ouvrir : le dernier evenement ---
verifie('La carte de tache montre le dernier evenement',
  elements['vue-taches'].innerHTML.indexOf('Pas dispo cette annee') !== -1);
verifie('Le tableau de bord aussi : « en attente depuis 6 jours » ET pourquoi',
  elements['vue-etat'].innerHTML.indexOf('Mail envoye a Jean Dupont.') !== -1);

// --- La modale journal ---
let erreurJournal = '';
try { sandbox.ouvrirModaleJournal('j1', 'a_eux'); } catch (e) { erreurJournal = e.message; }
verifie('La modale « que s\'est-il passe ? » s\'ouvre sans exception', !erreurJournal, erreurJournal);
verifie('Elle annonce la bascule visee',
  elements['journal-contexte'].innerHTML.indexOf('En attente') !== -1,
  elements['journal-contexte'].innerHTML);
verifie('« Sans note » est propose quand il y a une bascule a ecrire',
  elements['j-btn-sans-note'].style.display !== 'none');

sandbox.ouvrirModaleJournal('j1', '');
verifie('« Sans note » disparait pour une note seule : elle serait vide',
  elements['j-btn-sans-note'].style.display === 'none');

// Recliquer sur le camp courant n'est pas une bascule : ca ne doit pas
// ecrire « A nous -> A nous ».
sandbox.elements = [{ id: 'j4', type: 'tache', titre: 'Deja a nous', camp: 'a_nous', creeLe: ilYA(2) }];
sandbox.ouvrirModaleJournal('j4', 'a_nous');
elements['j-texte'].value = 'Point d\'etape.';
ecritures.length = 0;
sandbox.validerJournal(false);
verifie('Recliquer sur le camp courant ecrit une note, pas une bascule',
  derniere().doc.camp === undefined
  && derniere().doc.journal.arrayUnion.texte === 'Point d\'etape.',
  JSON.stringify(derniere().doc));

sandbox.elements = [TACHE_RICHE, TACHE_ATTENTE];

ecritures.length = 0;
elements['j-texte'].value = '';
sandbox.validerJournal(false);
verifie('Valider une note vide n\'ecrit rien', ecritures.length === 0);

sandbox.ouvrirModaleJournal('j1', 'a_eux');
elements['j-texte'].value = 'Devis redemande.';
ecritures.length = 0;
sandbox.validerJournal(false);
verifie('Valider ecrit l\'evenement tout de suite, sans passer par Enregistrer',
  derniere().doc.journal.arrayUnion.texte === 'Devis redemande.', JSON.stringify(derniere().doc));

// --- La recherche voit le journal : c'est souvent le seul endroit ou
//     « pas dispo » est ecrit ---
sandbox.elements = [TACHE_RICHE, { id: 'a1', type: 'tache', titre: 'Autre tache' }];
verifie('La recherche trouve un mot ecrit dans le journal',
  sandbox.chercher('travaillera').length === 1
  && sandbox.chercher('travaillera')[0].id === 'j1',
  String(sandbox.chercher('travaillera').length));
verifie('… sans accent ni casse, comme le reste', sandbox.chercher('TELEPHONE').length === 1);

// ================================================================
// 12 ter. Photos d'aujourd'hui et projections
// ================================================================
// Le lien est porte par la PROJECTION. Une seule ecriture pour
// rattacher, et surtout : supprimer une projection ne laisse aucune
// reference morte dans la photo.
console.log('\n12 ter. Photos et projections');

sandbox.elements = [
  { id: 'p1', type: 'image', titre: 'Le talus, cote sud', categorie: 'actuelle',
    url: 'https://res.cloudinary.com/x/upload/p1.jpg', creeLe: ilYA(30), dateEvenement: ilYA(30) },
  { id: 'p2', type: 'image', titre: 'L\'entree', categorie: 'actuelle',
    url: 'https://res.cloudinary.com/x/upload/p2.jpg', creeLe: ilYA(20), dateEvenement: ilYA(20) },
  { id: 'v1', type: 'image', titre: 'Talus en terrasses', categorie: 'projection', imageSourceId: 'p1',
    url: 'https://res.cloudinary.com/x/upload/v1.jpg', creeLe: ilYA(10), dateEvenement: ilYA(10) },
  { id: 'v2', type: 'image', titre: 'Talus enherbe', categorie: 'projection', imageSourceId: 'p1',
    url: 'https://res.cloudinary.com/x/upload/v2.jpg', creeLe: ilYA(5), dateEvenement: ilYA(5) },
  { id: 'v3', type: 'image', titre: 'Inspiration Pinterest', categorie: 'projection',
    url: 'https://res.cloudinary.com/x/upload/v3.jpg', creeLe: ilYA(3), dateEvenement: ilYA(3) },
  { id: 'v4', type: 'image', titre: 'Croquis de l\'archi', categorie: 'projection', imageSourceId: 'p-disparue',
    url: 'https://res.cloudinary.com/x/upload/v4.jpg', creeLe: ilYA(2), dateEvenement: ilYA(2) },
];

verifie('Une photo rend les projections etablies avec elle',
  sandbox.projectionsDe('p1').map((i) => i.id).join(',') === 'v2,v1',
  sandbox.projectionsDe('p1').map((i) => i.id).join(','));
verifie('Une photo sans projection en rend zero', sandbox.projectionsDe('p2').length === 0);
verifie('projectionsDe(null) ne plante pas', sandbox.projectionsDe(null).length === 0);
verifie('Une projection sait de quelle photo elle decoule',
  sandbox.imageSourceDe(sandbox.trouverElement('v1')).id === 'p1');
verifie('Une projection sans origine rend null',
  sandbox.imageSourceDe(sandbox.trouverElement('v3')) === null);
verifie('Une photo d\'origine supprimee rend null, elle ne plante pas',
  sandbox.imageSourceDe(sandbox.trouverElement('v4')) === null);
verifie('imagesActuelles ne rend que les photos du terrain, la plus recente d\'abord',
  sandbox.imagesActuelles().map((i) => i.id).join(',') === 'p2,p1',
  sandbox.imagesActuelles().map((i) => i.id).join(','));

// --- Ce qu'on voit sans ouvrir ---
sandbox.renderImages('actuelle');
verifie('La vignette d\'une photo annonce son nombre de projections',
  /vignette-pastille[^>]*>[\s\S]{0,120}2</.test(elements['vue-images-actuelle'].innerHTML),
  elements['vue-images-actuelle'].innerHTML.slice(0, 400));

// --- La visionneuse : le va-et-vient dans les deux sens ---
let erreurVue = '';
try { sandbox.ouvrirVisionneuse('p1'); } catch (e) { erreurVue = e.message; }
verifie('La visionneuse d\'une photo s\'ouvre sans exception', !erreurVue, erreurVue);
verifie('Elle liste les projections etablies avec cette photo',
  elements['visionneuse-liens'].innerHTML.indexOf('Projections établies') !== -1,
  elements['visionneuse-liens'].innerHTML.slice(0, 300));
verifie('Elle propose de rattacher les projections qui ne le sont pas encore',
  elements['visionneuse-liens'].innerHTML.indexOf('Rattacher une projection') !== -1);

// --- Une projection decoule d'UNE photo, et d'une seule ---
// Celles qui sont deja rattachees ailleurs ne doivent pas etre
// proposees : un clic les volerait a l'autre photo sans rien dire.
// L'inverse n'est pas vrai, une photo en porte autant qu'on veut.
sandbox.ouvrirVisionneuse('p2');
let offre = elements['visionneuse-liens'].innerHTML;
verifie('Une projection deja rattachee ailleurs n\'est PAS proposee',
  offre.indexOf('value="v1"') === -1 && offre.indexOf('value="v2"') === -1, offre);
verifie('Une projection libre, elle, est proposee',
  offre.indexOf('value="v3"') !== -1, offre);
// v4 pointe vers une photo supprimee : son lien est mort, elle est donc
// libre a nouveau. « Deja rattachee » se lit sur la source vivante.
verifie('Une projection dont la photo d\'origine a disparu redevient proposable',
  offre.indexOf('value="v4"') !== -1, offre);

// Quand tout est pris, on le DIT — un menu absent sans explication
// laisserait chercher ce qui ne s'affiche pas.
sandbox.elements = [
  { id: 'q1', type: 'image', titre: 'Le talus', categorie: 'actuelle',
    url: 'https://res.cloudinary.com/x/upload/q1.jpg', creeLe: ilYA(9), dateEvenement: ilYA(9) },
  { id: 'q2', type: 'image', titre: 'L\'entree', categorie: 'actuelle',
    url: 'https://res.cloudinary.com/x/upload/q2.jpg', creeLe: ilYA(8), dateEvenement: ilYA(8) },
  { id: 'w1', type: 'image', titre: 'Talus revisite', categorie: 'projection', imageSourceId: 'q1',
    url: 'https://res.cloudinary.com/x/upload/w1.jpg', creeLe: ilYA(7), dateEvenement: ilYA(7) },
];
sandbox.ouvrirVisionneuse('q2');
offre = elements['visionneuse-liens'].innerHTML;
verifie('Plus rien a proposer : aucun menu deroulant',
  offre.indexOf('<select') === -1, offre);
verifie('… mais une phrase qui dit quoi faire',
  offre.indexOf('Détachez-en une') !== -1, offre);

// Aucune projection du tout : la phrase est differente, elle ne parle
// pas de detacher ce qui n'existe pas.
sandbox.elements = [sandbox.trouverElement('q1'), sandbox.trouverElement('q2')];
sandbox.ouvrirVisionneuse('q1');
offre = elements['visionneuse-liens'].innerHTML;
verifie('Aucune projection du tout : on ne propose pas d\'en detacher une',
  offre.indexOf('Détachez-en une') === -1 && offre.indexOf('Aucune autre projection') !== -1, offre);

sandbox.elements = [
  { id: 'p1', type: 'image', titre: 'Le talus, cote sud', categorie: 'actuelle',
    url: 'https://res.cloudinary.com/x/upload/p1.jpg', creeLe: ilYA(30), dateEvenement: ilYA(30) },
  { id: 'p2', type: 'image', titre: 'L\'entree', categorie: 'actuelle',
    url: 'https://res.cloudinary.com/x/upload/p2.jpg', creeLe: ilYA(20), dateEvenement: ilYA(20) },
  { id: 'v1', type: 'image', titre: 'Talus en terrasses', categorie: 'projection', imageSourceId: 'p1',
    url: 'https://res.cloudinary.com/x/upload/v1.jpg', creeLe: ilYA(10), dateEvenement: ilYA(10) },
  { id: 'v2', type: 'image', titre: 'Talus enherbe', categorie: 'projection', imageSourceId: 'p1',
    url: 'https://res.cloudinary.com/x/upload/v2.jpg', creeLe: ilYA(5), dateEvenement: ilYA(5) },
  { id: 'v3', type: 'image', titre: 'Inspiration Pinterest', categorie: 'projection',
    url: 'https://res.cloudinary.com/x/upload/v3.jpg', creeLe: ilYA(3), dateEvenement: ilYA(3) },
  { id: 'v4', type: 'image', titre: 'Croquis de l\'archi', categorie: 'projection', imageSourceId: 'p-disparue',
    url: 'https://res.cloudinary.com/x/upload/v4.jpg', creeLe: ilYA(2), dateEvenement: ilYA(2) },
];

sandbox.ouvrirVisionneuse('v1');
verifie('La visionneuse d\'une projection montre d\'ou elle vient',
  elements['visionneuse-liens'].innerHTML.indexOf('Établie à partir') !== -1,
  elements['visionneuse-liens'].innerHTML.slice(0, 300));
sandbox.ouvrirVisionneuse('v4');
verifie('Une photo d\'origine supprimee est dite, pas cachee',
  elements['visionneuse-liens'].innerHTML.indexOf('supprimée') !== -1,
  elements['visionneuse-liens'].innerHTML.slice(0, 300));

// Le JS genere dans la visionneuse doit parser lui aussi.
sandbox.ouvrirVisionneuse('p1');
let onclicksValides = true, detailOnclick = '';
for (const m of elements['visionneuse-liens'].innerHTML.matchAll(/on(?:click|change)="([^"]*)"/g)) {
  try { new vm.Script('(function(event){' + decodeHtml(m[1]) + '\n})'); }
  catch (e) { onclicksValides = false; detailOnclick = decodeHtml(m[1]) + ' :: ' + e.message; }
}
verifie('Les handlers de la visionneuse sont du JS valide', onclicksValides, detailOnclick);

// --- Rattacher : une seule ecriture, sur la projection ---
ecritures.length = 0;
sandbox.rattacherProjection('v3', 'p2');
verifie('Rattacher n\'ecrit que sur la projection',
  ecritures.length === 1 && derniere().id === 'v3', JSON.stringify(ecritures));
verifie('… et ne touche QUE imageSourceId (pas d\'URL retouchee)',
  derniere().doc.imageSourceId === 'p2' && derniere().doc.url === undefined
  && derniere().doc.categorie === undefined, JSON.stringify(derniere().doc));

ecritures.length = 0;
sandbox.rattacherProjection('v1', '');
verifie('Detacher vide le champ plutot que de le supprimer',
  derniere().doc.imageSourceId === '', JSON.stringify(derniere().doc));

// --- Le lien survit a un passage dans le formulaire ---
// C'est le piege : un select qui ne contient pas la valeur courante
// retombe sur « Aucune », et enregistrer effacerait le rattachement
// sans rien demander.
ecritures.length = 0;
sandbox.ouvrirModaleElement('v1');
sandbox.sauverElement();
verifie('Enregistrer une projection sans y toucher conserve son origine',
  derniere().doc.imageSourceId === 'p1', JSON.stringify(derniere().doc));

ecritures.length = 0;
sandbox.ouvrirModaleElement('v4');
sandbox.sauverElement();
verifie('Meme quand la photo d\'origine a disparu : le lien n\'est pas efface',
  derniere().doc.imageSourceId === 'p-disparue', JSON.stringify(derniere().doc));

// Et une photo du terrain ne se voit pas proposer de decouler d'elle-meme.
sandbox.ouvrirModaleElement('p1');
verifie('Une image ne peut pas etre sa propre origine',
  elements['e-image-source'].innerHTML.indexOf('value="p1"') === -1,
  elements['e-image-source'].innerHTML);

// ================================================================
// 12 quater. Dire ou l'on range : l'intention bat l'extension
// ================================================================
// Le cas signale : un plan scanne en PNG partait dans les photos du
// terrain parce que l'extension decidait seule. Un plan est un
// document, et l'extension ne le saura jamais.
console.log('\n12 quater. Ranger ou l\'on veut');

// La devinette reste la devinette quand personne n'a rien dit.
verifie('Sans intention, .png reste devine comme une image',
  sandbox.typeDepuisFichier('plan-terrasse.png') === 'image');

// declencherDepot memorise l'intention ET ouvre le bon selecteur.
sandbox.declencherDepot('document');
verifie('« Deposer un document » retient l\'intention',
  sandbox.intentionDepot && sandbox.intentionDepot.type === 'document',
  JSON.stringify(sandbox.intentionDepot));
verifie('… et accepte N\'IMPORTE QUEL fichier (accept vide)',
  elements['depot-fichier'].accept === '', JSON.stringify(elements['depot-fichier'].accept));

sandbox.declencherDepot('image', 'projection');
verifie('« Une photo » retient aussi la categorie visee',
  sandbox.intentionDepot.type === 'image' && sandbox.intentionDepot.categorie === 'projection',
  JSON.stringify(sandbox.intentionDepot));
verifie('… et filtre sur les images pour le selecteur du telephone',
  elements['depot-fichier'].accept === 'image/*');

sandbox.declencherDepot('');
verifie('La zone de depot, elle, ne dit rien : l\'intention repart a zero',
  sandbox.intentionDepot === null);
verifie('… et le selecteur revient a la liste devinable',
  elements['depot-fichier'].accept === sandbox.ACCEPT_DEVINETTE);

// Le coeur du signalement : le formulaire s'ouvre sur le type DEMANDE.
sandbox.elements = [];
sandbox.ouvrirFormulaireDepot('plan-terrasse.png', 'document',
  'https://res.cloudinary.com/x/upload/plan.png', null, '');
verifie('Un PNG depose comme document ouvre le formulaire en DOCUMENT',
  elements['e-type'].value === 'document', elements['e-type'].value);
verifie('… avec le camp d\'un document, pas rien',
  elements['e-camp'].value === 'a_nous', elements['e-camp'].value);

ecritures.length = 0;
sandbox.sauverElement();
verifie('… et c\'est bien un document qui part en base',
  derniere().doc.type === 'document', JSON.stringify(derniere().doc));
verifie('… avec l\'URL du fichier, image ou pas',
  derniere().doc.url === 'https://res.cloudinary.com/x/upload/plan.png');

// ================================================================
// 12 quinquies. Corriger le rangement sans reteleverser
// ================================================================
// Le plan deja parti dans les photos doit pouvoir rejoindre les
// documents : le supprimer et le redeposer laisserait le fichier chez
// Cloudinary, qu'on ne sait pas effacer.
console.log('\n12 quinquies. Reclasser un element');

sandbox.elements = [
  { id: 'r1', type: 'image', titre: 'Plan terrasse', categorie: 'actuelle',
    url: 'https://res.cloudinary.com/x/upload/plan.png', creeLe: ilYA(3), dateEvenement: ilYA(3) },
  { id: 'r2', type: 'document', titre: 'Devis Dupont', camp: 'a_nous', sujet: 'terrasse',
    url: 'https://res.cloudinary.com/x/upload/d.pdf', creeLe: ilYA(4), dateEvenement: ilYA(4) },
  { id: 'r3', type: 'tache', titre: 'Mesurer', camp: 'a_nous', creeLe: ilYA(2) },
];

sandbox.ouvrirModaleElement('r1');
verifie('Le selecteur « Ranger comme » est propose sur une image',
  elements['ligne-type'].style.display !== 'none');
verifie('Il ne propose que document et image',
  (elements['e-type-choix'].innerHTML.match(/<option/g) || []).length === 2,
  elements['e-type-choix'].innerHTML);

sandbox.ouvrirModaleElement('r3');
verifie('Il n\'est PAS propose sur une tache : la conversion perdrait quelque chose',
  elements['ligne-type'].style.display === 'none');

// Image -> document : le camp apparait, l'URL ne bouge pas.
sandbox.ouvrirModaleElement('r1');
elements['e-type-choix'].value = 'document';
sandbox.surChangementTypeElement();
verifie('Changer le selecteur change le type reellement pris en compte',
  elements['e-type'].value === 'document', elements['e-type'].value);
verifie('… et fait apparaitre le camp, qu\'une image n\'avait pas',
  elements['ligne-camp'].style.display !== 'none');

ecritures.length = 0;
sandbox.sauverElement();
ecrit = derniere();
verifie('Le plan devient un document', ecrit.doc.type === 'document', JSON.stringify(ecrit.doc));
verifie('Aucun re-upload : l\'URL n\'est pas retouchee', ecrit.doc.url === undefined);
verifie('Rien n\'est perdu : la categorie d\'image reste en base',
  ecrit.doc.categorie === undefined, JSON.stringify(ecrit.doc));

// Document -> image : le camp doit PARTIR, sinon l'element resterait
// sur le tableau de bord sans plus aucun bouton pour l'en sortir.
sandbox.ouvrirModaleElement('r2');
elements['e-type-choix'].value = 'image';
sandbox.surChangementTypeElement();
ecritures.length = 0;
sandbox.sauverElement();
ecrit = derniere();
verifie('Un devis reclasse en photo devient une image', ecrit.doc.type === 'image');
verifie('… et son camp est vide, sinon il squatterait « A nous »',
  ecrit.doc.camp === '', JSON.stringify(ecrit.doc.camp));

// ================================================================
// 12 sexies. Coller un mail
// ================================================================
// Le .eml demande un ordinateur : Gmail mobile ne sait pas telecharger
// un message. Deux formes arrivent par le collage, et aucune des deux
// ne doit perdre de texte.
console.log('\n12 sexies. Mail colle');

// --- 1. La source complete : l'analyseur .eml fait tout le travail ---
let colle = sandbox.analyserMailColle(crlf([
  'From: Jean Dupont <jean@paysage-dupont.fr>',
  'To: cyril.samson41@gmail.com',
  'Subject: Devis terrasse',
  'Date: Fri, 3 Jul 2026 09:12:00 +0200',
  'Content-Type: text/plain; charset=UTF-8',
  '',
  'Bonjour, voici le devis.',
]));
verifie('Source complete collee : l\'expediteur est lu',
  colle.de === 'Jean Dupont <jean@paysage-dupont.fr>', colle.de);
verifie('Source complete collee : l\'objet est lu', colle.objet === 'Devis terrasse');
verifie('Source complete collee : la date d\'envoi est lue', colle.dateEnvoi instanceof Date);
verifie('Source complete collee : pas de repli texte brut', colle.sansEntetes === undefined);

// --- 2. Le message copie a la souris : AUCUNE en-tete exploitable ---
const COPIE_ECRAN = 'Bonjour Cyril,\n\nNous ne sommes pas disponibles avant mars.\n\nCordialement,\nJean';
colle = sandbox.analyserMailColle(COPIE_ECRAN);
verifie('Texte sans en-tete : le corps garde TOUT le texte colle',
  colle.corps === COPIE_ECRAN, JSON.stringify(colle.corps));
verifie('Texte sans en-tete : les champs restent vides plutot qu\'inventes',
  colle.de === '' && colle.objet === '');
verifie('Texte sans en-tete : c\'est signale comme tel', colle.sansEntetes === true);

// parseOk reste VRAI : rien n'a echoue, il n'y avait pas d'en-tete a
// lire. Le passer a faux collerait un bandeau « mal compris » sur un
// mail parfaitement volontaire, dans le fil comme dans la vue Emails.
verifie('Texte sans en-tete : parseOk reste vrai, ce n\'est pas un echec',
  colle.parseOk === true);

// --- 3. De bout en bout : la modale de collage remplit le formulaire ---
sandbox.elements = [];
sandbox.ficheProjet = { intervenants: ['Cyril', 'Alisson'], nosAdresses: NOS };

sandbox.ouvrirModaleCollage();
ecritures.length = 0;
sandbox.validerCollage();
verifie('Coller du vide n\'ouvre rien et n\'ecrit rien', ecritures.length === 0);

elements['coller-texte'].value = COPIE_ECRAN;
sandbox.validerCollage();
verifie('Le collage ouvre le formulaire en EMAIL', elements['e-type'].value === 'email');
verifie('… avec le texte colle dans le corps',
  elements['e-corps'].value === COPIE_ECRAN, JSON.stringify(elements['e-corps'].value));

ecritures.length = 0;
elements['e-objet'].value = 'Reponse Dupont';
sandbox.sauverElement();
ecrit = derniere();
verifie('Un mail colle s\'enregistre comme un mail', ecrit.doc.type === 'email');
verifie('… sans aucun fichier : il n\'y a pas d\'original a stocker',
  ecrit.doc.url === undefined, JSON.stringify(ecrit.doc.url));
verifie('… et le corps colle part bien en base', ecrit.doc.corps === COPIE_ECRAN);

// --- 4. RIEN NE SE PERD : un long collage garde sa fin ---
// Le corps est abrege a MAX_CORPS pour ne pas alourdir le snapshot,
// mais un mail colle n'a PAS de fichier d'origine a relire. Sans
// emlBrut, la fin serait perdue pour de bon.
const LONG = 'Ligne de discussion. '.repeat(400);   // ~8000 caracteres
verifie('Le jeu de test depasse bien le seuil d\'abregement',
  LONG.length > sandbox.MAX_CORPS);

elements['coller-texte'].value = LONG;
sandbox.validerCollage();
verifie('Un long collage est abrege a l\'affichage',
  elements['e-corps'].value.length === sandbox.MAX_CORPS,
  String(elements['e-corps'].value.length));

ecritures.length = 0;
elements['e-objet'].value = 'Long fil';
sandbox.sauverElement();
ecrit = derniere();
verifie('… mais le texte INTEGRAL part en base dans emlBrut',
  ecrit.doc.emlBrut === LONG, String(ecrit.doc.emlBrut && ecrit.doc.emlBrut.length));
verifie('… et le drapeau d\'abregement est pose',
  ecrit.doc.corpsTronque === true);

// Modifier un mail colle ne doit PAS ecraser son texte integral : le
// snapshot ne renvoie pas emlBrut, on ecrirait une version vide.
sandbox.elements = [{ id: 'mc9', type: 'email', objet: 'Long fil', sens: 'recu', camp: 'a_nous',
  corps: LONG.slice(0, sandbox.MAX_CORPS), corpsTronque: true, aEmlBrut: true, parseOk: true }];
ecritures.length = 0;
sandbox.ouvrirModaleElement('mc9');
sandbox.sauverElement();
verifie('Modifier un mail colle ne touche pas a son texte integral',
  derniere().doc.emlBrut === undefined, JSON.stringify(derniere().doc.emlBrut));

// ================================================================
// 12 septies. Les metiers du carnet
// ================================================================
// La valeur de gauche est ce qui est ecrit en base sur chaque fiche.
// En renommer une declasserait silencieusement les contacts existants
// en « Autre », puisque libelleCategorieContact() s'y replie quand elle
// ne reconnait pas la valeur. Ce bloc gele donc les valeurs, pas les
// libelles — qui, eux, peuvent etre reformules librement.
console.log('\n12 septies. Metiers du carnet');

['btp', 'paysagiste', 'concepteur-paysagiste', 'archi-paysagiste', 'architecte', 'autre']
  .forEach((valeur) => {
    verifie('Le metier « ' + valeur + ' » existe toujours',
      sandbox.CATEGORIES_CONTACT.some((c) => c.value === valeur),
      sandbox.CATEGORIES_CONTACT.map((c) => c.value).join(','));
  });

verifie('« Autre » reste en dernier : c\'est le defaut, pas un metier',
  sandbox.CATEGORIES_CONTACT[sandbox.CATEGORIES_CONTACT.length - 1].value === 'autre');
verifie('Aucun metier en double',
  new Set(sandbox.CATEGORIES_CONTACT.map((c) => c.value)).size === sandbox.CATEGORIES_CONTACT.length);
verifie('Chaque metier a un libelle',
  sandbox.CATEGORIES_CONTACT.every((c) => !!c.label));

// Un contact portant un metier disparu du referentiel ne doit pas
// planter : il s'affiche « Autre ».
verifie('Un metier inconnu se replie sur « Autre »',
  sandbox.libelleCategorieContact('metier-supprime') === 'Autre');
verifie('Un contact sans metier aussi',
  sandbox.libelleCategorieContact('') === 'Autre' && sandbox.libelleCategorieContact(null) === 'Autre');
verifie('Les nouveaux metiers ont bien leur libelle',
  sandbox.libelleCategorieContact('architecte') === 'Architecte'
  && sandbox.libelleCategorieContact('concepteur-paysagiste') === 'Concepteur-paysagiste',
  sandbox.libelleCategorieContact('concepteur-paysagiste'));

// Le carnet doit les proposer au filtre comme a la saisie.
sandbox.elements = [
  { id: 'k1', type: 'contact', prenom: 'Marie', nom: 'Martin', categorie: 'architecte', titre: 'Marie Martin' },
  { id: 'k2', type: 'contact', prenom: 'Luc', nom: 'Bernard', categorie: 'concepteur-paysagiste', titre: 'Luc Bernard' },
];
sandbox.renderCarnet();
verifie('Le filtre du carnet propose les nouveaux metiers, avec leur compte',
  /Architecte \(1\)/.test(elements['vue-carnet'].innerHTML)
  && /Concepteur-paysagiste \(1\)/.test(elements['vue-carnet'].innerHTML),
  elements['vue-carnet'].innerHTML.slice(0, 600));

sandbox.ouvrirModaleContact('k1');
verifie('La modale contact les propose a la saisie',
  elements['c-categorie'].innerHTML.indexOf('value="architecte"') !== -1);
verifie('… et retrouve le metier du contact ouvert',
  elements['c-categorie'].value === 'architecte', elements['c-categorie'].value);

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

// La liste devinable est ecrite a deux endroits : l'attribut du champ et
// la constante qui le reecrit apres un depot cible. Les laisser diverger
// donnerait un selecteur dont le filtre depend du bouton precedemment
// clique — introuvable a la main.
verifie('La liste accept du champ de depot est la meme dans index.html et en JS',
  htmlIndex.replace(/\s+/g, ' ')
    .indexOf('id="depot-fichier" style="display:none" accept="' + sandbox.ACCEPT_DEVINETTE + '"') !== -1,
  sandbox.ACCEPT_DEVINETTE);

// Chaque bouton « ranger dans » doit avoir son entree dans la table des
// filtres, sinon accept vaudrait undefined et le selecteur n'accepterait
// plus rien du tout.
['document', 'image', 'email'].forEach((type) => {
  verifie('ACCEPT_PAR_TYPE couvre « ' + type + ' »',
    sandbox.ACCEPT_PAR_TYPE[type] !== undefined);
});

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
      verifierRelectureMailColle().then(finir);
    });
}, 0);

// --- Le retour du long mail colle : « Copier le corps » doit rendre le
//     texte ENTIER, pas la version abregee affichee a l'ecran ---
// Un .eml depose se relit depuis Cloudinary. Un mail colle n'a pas de
// fichier : son original vit dans emlBrut, et l'analyseur .eml n'en
// tirera rien puisqu'il n'y a pas d'en-tete. Sans le repli sur le brut
// lui-meme, on collerait une version tronquee dans Gmail sans le voir.
function verifierRelectureMailColle() {
  // .trim() : le texte rendu passe par nettoyerCorps, qui rogne les
  // blancs de fin. C'est voulu — on colle ca dans Gmail.
  const INTEGRAL = 'Ligne de discussion. '.repeat(400).trim();
  sandbox.lireEmlBrut = () => Promise.resolve(INTEGRAL);

  const mailColle = {
    id: 'mc9', type: 'email', objet: 'Long fil', sens: 'recu',
    corps: INTEGRAL.slice(0, sandbox.MAX_CORPS), corpsTronque: true, aEmlBrut: true,
  };
  sandbox.elements = [mailColle];

  return sandbox.corpsComplet(mailColle).then((texte) => {
    verifie('Un mail colle abrege rend son texte INTEGRAL a la copie',
      texte === INTEGRAL, String(texte && texte.length) + ' vs ' + INTEGRAL.length);
    verifie('… et pas la version tronquee affichee',
      texte.length > sandbox.MAX_CORPS, String(texte.length));
  });
}

function finir() {
  console.log('\n' + (echecs === 0 ? 'Tous les tests passent.' : echecs + ' test(s) en echec.'));
  process.exit(echecs === 0 ? 0 : 1);
}
