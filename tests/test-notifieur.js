// ============================================================
// test-notifieur.js — Le notifieur Telegram
// ============================================================
// Lancer :  node tests/test-notifieur.js
//
// OU PORTE L'EFFORT. Un notifieur se juge sur ce qu'il envoie ET sur ce
// qu'il n'envoie pas — et le second cas est invisible. Un message qui ne
// part pas ne se remarque pas : personne ne se dit « tiens, je n'ai rien
// recu a 8 h 45 ». C'est la panne silencieuse par excellence, celle
// contre laquelle tout ce projet a ete ecrit ; il serait absurde que son
// notifieur en soit atteint.
//
// Ces tests ne touchent NI le reseau, NI Cloudflare. Ils exercent la
// logique pure (notifieur-messages.js) et relisent les fichiers de
// configuration pour verifier qu'ils ne se contredisent pas.
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.join(__dirname, '..');

const messages = require(path.join(REPO, 'notifieur', 'notifieur-messages.js'));
const calcul = require(path.join(REPO, 'taches', 'taches-calcul.js'));

let echecs = 0;
function verifie(nom, condition, detail) {
  if (condition) console.log('  ok   ' + nom);
  else { console.log('  ECHEC ' + nom + (detail ? ' -> ' + detail : '')); echecs++; }
}

const AJD = '2026-08-19';
const tache = (extra) => Object.assign({
  id: 't' + Math.random().toString(36).slice(2, 8),
  titre: 'Tache', detail: '', projet: '', important: false, urgentForce: false,
  echeance: '', creneauJour: '', creneauHeure: '', creneauDuree: 0,
  faite: false, faiteLe: '', nbReports: 0,
  creePar: 'cyril.samson41@gmail.com',
}, extra || {});

const cles = (liste) => liste.map((m) => m.cle).join(',');

// --- 1. Le partage du coeur de calcul --------------------------------
console.log('\n1. Le coeur de calcul est partage, pas recopie');
// Si le notifieur recopiait « en retard » ou « ca commence bientot », les
// deux definitions divergeraient un jour — et cette divergence-la serait
// muette, contrairement a celle de l'affichage qu'on finirait par voir.
verifie('taches-calcul.js s\'exporte pour le Worker',
  typeof calcul.estEnRetard === 'function' && typeof calcul.aUnCreneau === 'function');

// ⚠ Ces deux-la dependent de toDate(), qui vit dans hub-utils.js et
// n'existe pas dans le Worker. Les exporter inviterait a les appeler,
// et ca planterait a 7 h 30 du matin sans personne pour le voir.
verifie('comparerDansBloc n\'est PAS expose au Worker',
  calcul.comparerDansBloc === undefined);
verifie('rangerParBloc non plus', calcul.rangerParBloc === undefined);

// Le fichier doit rester utilisable par une balise <script> : le garde
// `typeof module` est ce qui permet les deux mondes.
const sourceCalcul = fs.readFileSync(path.join(REPO, 'taches', 'taches-calcul.js'), 'utf8');
verifie('l\'export est garde par typeof module',
  /if \(typeof module !== 'undefined' && module\.exports\)/.test(sourceCalcul));

// La preuve que le navigateur n'est pas casse : on recharge le fichier
// dans un contexte SANS `module`, comme une balise <script>.
const bacASable = { console, Date, Math, RegExp, isNaN, String, Number, Array, Object, JSON };
vm.createContext(bacASable);
let chargementNavigateurOk = true;
try {
  vm.runInContext(sourceCalcul, bacASable);
} catch (erreur) {
  chargementNavigateurOk = false;
}
verifie('...et le fichier se charge encore sans `module` (le navigateur)',
  chargementNavigateurOk && typeof bacASable.estEnRetard === 'function');

// --- 2. Le rappel avant un creneau -----------------------------------
console.log('\n2. Le rappel avant un creneau');
const aNeufHeures = tache({ id: 'c1', titre: 'Appeler le couvreur',
  creneauJour: AJD, creneauHeure: '09:00', creneauDuree: 60 });

verifie('rien 20 min avant', messages.rappelsCreneaux([aNeufHeures], AJD, '08:40').length === 0);
verifie('le rappel part pile a 15 min',
  messages.rappelsCreneaux([aNeufHeures], AJD, '08:45').length === 1);
verifie('...et encore a 5 min', messages.rappelsCreneaux([aNeufHeures], AJD, '08:55').length === 1);
// Passe l'heure, ce n'est plus un rappel mais un constat : « dans -3 min »
// ne veut rien dire, et le creneau manque a sa propre vue dans la page.
verifie('plus rien une fois l\'heure passee',
  messages.rappelsCreneaux([aNeufHeures], AJD, '09:00').length === 0);
verifie('ni pendant le creneau', messages.rappelsCreneaux([aNeufHeures], AJD, '09:30').length === 0);

verifie('une tache faite ne rappelle rien',
  messages.rappelsCreneaux([Object.assign({}, aNeufHeures, { faite: true })], AJD, '08:50').length === 0);
verifie('une tache sans creneau non plus',
  messages.rappelsCreneaux([tache({ echeance: AJD })], AJD, '08:50').length === 0);
verifie('un creneau d\'un autre jour non plus',
  messages.rappelsCreneaux([tache({ creneauJour: '2026-08-25', creneauHeure: '09:00' })], AJD, '08:50').length === 0);

// LE CAS QUI TOMBE ENTRE DEUX JOURS. Un creneau a 00:05 demain doit etre
// rappele a 23:50 CE SOIR — soit une minute « negative » dans le repere
// de la journee. Sans les minutes signees, ce rappel n'existerait jamais.
const justeApresMinuit = tache({ creneauJour: '2026-08-20', creneauHeure: '00:05' });
verifie('un creneau juste apres minuit est rappele la veille au soir',
  messages.rappelsCreneaux([justeApresMinuit], AJD, '23:55').length === 1,
  'rappel absent a 23:55');
verifie('...et pas trop tot', messages.rappelsCreneaux([justeApresMinuit], AJD, '23:40').length === 0);

const texte = messages.rappelsCreneaux([aNeufHeures], AJD, '08:50')[0].texte;
verifie('le message annonce le bon delai', texte.indexOf('Dans 10 min') !== -1, texte.split('\n')[0]);
verifie('...le titre', texte.indexOf('Appeler le couvreur') !== -1);
verifie('...et les bornes du creneau', texte.indexOf('09:00 – 10:00') !== -1, texte);

// --- 3. La cle de deduplication --------------------------------------
console.log('\n3. La cle de deduplication');
// Le cron tourne toutes les 5 min : sans memoire, le rappel de 9 h
// repartirait a 8 h 45, 8 h 50 ET 8 h 55.
verifie('la cle est stable d\'un tour a l\'autre',
  messages.rappelsCreneaux([aNeufHeures], AJD, '08:45')[0].cle
  === messages.rappelsCreneaux([aNeufHeures], AJD, '08:55')[0].cle);

// ⚠ LE CAS A NE PAS CASSER. Replanifier doit redonner droit a un rappel.
// Si la cle ne portait que l'identifiant de la tache, une tache deplacee
// de mardi a jeudi resterait marquee « deja prevenu » et passerait sous
// silence — exactement la panne muette qu'on cherche a eviter.
const deplacee = Object.assign({}, aNeufHeures, { creneauHeure: '14:00' });
verifie('replanifier change la cle, donc redonne droit a un rappel',
  messages.cleRappel(aNeufHeures) !== messages.cleRappel(deplacee),
  messages.cleRappel(aNeufHeures));
verifie('...et changer de jour aussi',
  messages.cleRappel(aNeufHeures)
  !== messages.cleRappel(Object.assign({}, aNeufHeures, { creneauJour: '2026-08-21' })));
verifie('la cle du digest porte le jour', messages.cleDigest(AJD) === 'digest:' + AJD);

// La fenetre est sortie a part pour que le Worker la consulte AVANT de
// lire Firestore : hors d'elle, il se contente des creneaux du jour.
verifie('la fenetre du digest se consulte sans les taches',
  messages.dansLaFenetreDuDigest('07:30') === true
  && messages.dansLaFenetreDuDigest('07:00') === false
  && messages.dansLaFenetreDuDigest('12:00') === false);
verifie('un digest refuse explicitement ne part pas',
  messages.messagesDus([], AJD, '07:30', false).length === 0
  && messages.messagesDus([], AJD, '07:30', true).length === 1);

// --- 4. La fenetre du digest -----------------------------------------
console.log('\n4. La fenetre du digest');
const rien = [];
verifie('rien avant l\'heure', messages.digestDuMatin(rien, AJD, '07:00') === null);
verifie('le digest part a l\'heure dite', messages.digestDuMatin(rien, AJD, '07:30') !== null);
verifie('...et rattrape un reveil tardif', messages.digestDuMatin(rien, AJD, '10:00') !== null);
// Sans cette borne, un Worker deploye — ou repare — a 23 h enverrait
// aussitot le digest du jour, pour rien.
verifie('mais plus rien passe la fenetre du matin',
  messages.digestDuMatin(rien, AJD, '12:00') === null);
verifie('ni le soir', messages.digestDuMatin(rien, AJD, '23:00') === null);

// Le silence ne doit jamais vouloir dire deux choses a la fois : « rien
// a faire » et « le notifieur est casse » doivent se distinguer.
verifie('un jour vide produit quand meme un message',
  messages.digestDuMatin(rien, AJD, '07:30').texte.indexOf('Rien au programme') !== -1);

// --- 5. Le contenu du digest -----------------------------------------
console.log('\n5. Le contenu du digest');
const journee = [
  tache({ id: 'd1', titre: 'Rendez-vous couvreur', creneauJour: AJD, creneauHeure: '14:00', creneauDuree: 90 }),
  tache({ id: 'd2', titre: 'Coup de fil matinal', creneauJour: AJD, creneauHeure: '09:00', creneauDuree: 15 }),
  tache({ id: 'd3', titre: 'Relancer assurance', echeance: '2026-08-05' }),
  tache({ id: 'd4', titre: 'Ranger le garage', echeance: '2026-08-15', nbReports: 4 }),
  tache({ id: 'd5', titre: 'Declarer les impots', echeance: '2026-08-21' }),
  tache({ id: 'd6', titre: 'Un jour peut-etre', echeance: '' }),
  tache({ id: 'd7', titre: 'Deja reglee', creneauJour: AJD, creneauHeure: '11:00', faite: true }),
];
const digest = messages.digestDuMatin(journee, AJD, '07:30').texte;

verifie('les creneaux du jour sont la, dans l\'ordre horaire',
  digest.indexOf('09:00 — Coup de fil matinal') < digest.indexOf('14:00 — Rendez-vous couvreur')
  && digest.indexOf('09:00 — Coup de fil matinal') !== -1, digest);
verifie('une tache faite ne figure pas au programme', digest.indexOf('Deja reglee') === -1);
verifie('les retards sont comptes', digest.indexOf('En retard (2)') !== -1);
verifie('...le plus ancien en tete',
  digest.indexOf('Relancer assurance') < digest.indexOf('Ranger le garage'));
// L'enlisement ne sert a rien s'il reste dans la page : c'est le seul
// constat qui autorise a abandonner une tache.
verifie('l\'enlisement se dit aussi dans le message',
  digest.indexOf('reportée 4 fois') !== -1, digest);
verifie('l\'urgence sans creneau est signalee', digest.indexOf('Declarer les impots') !== -1);
verifie('ce qui n\'est ni urgent ni en retard reste dehors',
  digest.indexOf('Un jour peut-etre') === -1);

// ⚠ PAS DEUX FOIS LA MEME TACHE. Sur une carte, « en retard » et « sans
// creneau » cohabitent tres bien ; dans un message lu d'un oeil au
// reveil, la meme tache citee deux fois se lit comme un bug.
verifie('une tache en retard n\'est pas repetee sous « sans creneau »',
  (digest.match(/Relancer assurance/g) || []).length === 1,
  (digest.match(/Relancer assurance/g) || []).length + ' occurrences');

// --- 6. L'echappement ------------------------------------------------
console.log('\n6. L\'echappement HTML');
// Les messages partent en parse_mode HTML : un titre contenant « < » ou
// « & » ferait REJETER l'envoi par l'API Telegram. Donc un rappel perdu,
// en silence, sur la tache la plus mal nommee.
const piegee = tache({ id: 'x', titre: 'Devis <b>gros</b> & cie',
  creneauJour: AJD, creneauHeure: '09:00' });
const rappelPiege = messages.rappelsCreneaux([piegee], AJD, '08:50')[0].texte;
verifie('les chevrons du titre sont echappes',
  rappelPiege.indexOf('&lt;b&gt;gros&lt;/b&gt;') !== -1, rappelPiege);
verifie('l\'esperluette aussi', rappelPiege.indexOf('&amp; cie') !== -1);
// Les balises du gabarit, elles, doivent survivre : c'est leur role.
verifie('le gras du gabarit reste du HTML', rappelPiege.indexOf('<b>Dans') !== -1);
verifie('echapper() ne touche pas au texte ordinaire',
  messages.echapper('Rien de special') === 'Rien de special');

// --- 7. Le creneau pose apres l'echeance -----------------------------
console.log('\n7. Le creneau pose apres l\'echeance');
// Le dire au moment du rappel, et pas a la relecture du planning trois
// semaines plus tard, quand il est trop tard pour en faire quelque chose.
const debordee = tache({ id: 'z', titre: 'Trop tard', echeance: '2026-08-10',
  creneauJour: AJD, creneauHeure: '09:00' });
verifie('le rappel avertit que le creneau est apres l\'echeance',
  messages.rappelsCreneaux([debordee], AJD, '08:50')[0].texte.indexOf('APRÈS l\'échéance') !== -1);
verifie('...et se tait quand tout est en ordre',
  messages.rappelsCreneaux([aNeufHeures], AJD, '08:50')[0].texte.indexOf('APRÈS') === -1);

// --- 8. Tout ce qui est du en un tour --------------------------------
console.log('\n8. Tout ce qui est du en un tour');
const tour = messages.messagesDus(journee, AJD, '07:30');
verifie('le digest passe en tete, avant les rappels',
  tour.length > 0 && tour[0].cle.indexOf('digest:') === 0, cles(tour));
verifie('hors fenetre du digest, il ne reste que les rappels',
  messages.messagesDus(journee, AJD, '13:50').every((m) => m.cle.indexOf('creneau:') === 0),
  cles(messages.messagesDus(journee, AJD, '13:50')));
verifie('a une heure creuse, rien ne part',
  messages.messagesDus(journee, AJD, '17:00').length === 0,
  cles(messages.messagesDus(journee, AJD, '17:00')));

// --- 9. Le bilan du soir ---------------------------------------------
console.log('\n9. Le bilan du soir');
// IL NE REPETE PAS LE DIGEST : il repond a une autre question. Le matin
// dit ce qui attend, le soir dit ce qui a glisse et ce qu'on peut encore
// sauver.
const SOIR = '20:00';
const journeeDuSoir = [
  tache({ id: 'b1', titre: 'Declarer les impots', echeance: AJD, important: true }),
  tache({ id: 'b2', titre: 'Appeler le garagiste', creneauJour: AJD, creneauHeure: '14:00' }),
  tache({ id: 'b3', titre: 'Rendez-vous couvreur', creneauJour: '2026-08-20', creneauHeure: '09:30', creneauDuree: 90 }),
  tache({ id: 'b4', titre: 'Deja reglee', creneauJour: AJD, creneauHeure: '10:00', faite: true }),
  tache({ id: 'b5', titre: 'Vieux creneau', creneauJour: '2026-08-17', creneauHeure: '11:00' }),
  tache({ id: 'b6', titre: 'Echeance lointaine', echeance: '2026-09-30' }),
];

verifie('rien avant 20 h', messages.bilanDuSoir(journeeDuSoir, AJD, '19:55') === null);
verifie('le bilan part a 20 h', messages.bilanDuSoir(journeeDuSoir, AJD, SOIR) !== null);
verifie('...et rattrape jusqu\'a 23 h', messages.bilanDuSoir(journeeDuSoir, AJD, '23:00') !== null);
// La fenetre ne doit pas franchir minuit : au-dela, le « demain » du
// message ne serait plus demain.
verifie('mais plus rien passe 23 h', messages.bilanDuSoir(journeeDuSoir, AJD, '23:30') === null);

// ⚠ LA DIFFERENCE ASSUMEE AVEC LE MATIN. Le digest part meme a vide,
// parce qu'il porte le battement de coeur qui prouve que le notifieur
// vit. Deux battements par jour, c'en est un de trop.
verifie('le bilan SE TAIT quand il n\'y a rien, contrairement au digest',
  messages.bilanDuSoir([], AJD, SOIR) === null
  && messages.digestDuMatin([], AJD, '07:30') !== null);

const texteBilan = messages.bilanDuSoir(journeeDuSoir, AJD, SOIR).texte;

// C'est lui qui rattrape la bascule en retard : une tache bascule a
// MINUIT, une alerte a cet instant tomberait a 00 h 05. Prevenu le soir,
// on peut encore la finir ou repousser l'echeance deliberement.
verifie('les echeances qui basculent cette nuit sont annoncees',
  texteBilan.indexOf('Declarer les impots') !== -1
  && texteBilan.indexOf('Bascule en retard') !== -1);
verifie('...et une echeance lointaine n\'y figure pas',
  texteBilan.indexOf('Echeance lointaine') === -1);

verifie('les creneaux non tenus du jour sont listes',
  texteBilan.indexOf('Appeler le garagiste') !== -1
  && texteBilan.indexOf('non tenus') !== -1);
verifie('...mais pas une tache deja reglee', texteBilan.indexOf('Deja reglee') === -1);

// ⚠ LE CAS A NE PAS CASSER. Les creneaux des jours PRECEDENTS ont deja
// ete annonces le soir venu. Les repeter chaque soir jusqu'a ce qu'on
// cede ne serait plus un rappel mais du harcelement.
verifie('un creneau d\'un jour PRECEDENT n\'est pas repete tous les soirs',
  texteBilan.indexOf('Vieux creneau') === -1);

verifie('les creneaux de demain sont annonces',
  texteBilan.indexOf('Rendez-vous couvreur') !== -1 && texteBilan.indexOf('Demain') !== -1);

verifie('la cle du bilan porte le jour et differe de celle du digest',
  messages.cleBilan(AJD) === 'bilan:' + AJD && messages.cleBilan(AJD) !== messages.cleDigest(AJD));

// Les deux resumes ne doivent jamais tomber le meme tour : ils
// annonceraient deux fois la meme journee, sous deux angles, a la suite.
verifie('les deux fenetres ne se recouvrent jamais',
  ['07:30', '09:00', '11:30'].every((h) =>
    messages.dansLaFenetreDuDigest(h) && !messages.dansLaFenetreDuBilan(h))
  && ['20:00', '21:30', '23:00'].every((h) =>
    messages.dansLaFenetreDuBilan(h) && !messages.dansLaFenetreDuDigest(h)));
verifie('dansUneFenetreDeResume couvre bien les deux',
  messages.dansUneFenetreDeResume('07:30') && messages.dansUneFenetreDeResume('20:00')
  && !messages.dansUneFenetreDeResume('15:00'));

// Un tour du soir doit produire le bilan, pas le digest.
const tourDuSoir = messages.messagesDus(journeeDuSoir, AJD, SOIR);
verifie('a 20 h, c\'est le bilan qui part, pas le digest',
  tourDuSoir.length === 1 && tourDuSoir[0].cle.indexOf('bilan:') === 0,
  cles(tourDuSoir));
verifie('...et la liste tronquee le refuse aussi',
  messages.messagesDus(journeeDuSoir, AJD, SOIR, false).length === 0);

// --- 10. Coherence config / regles / Worker --------------------------
console.log('\n10. Coherence entre les fichiers');
const regles = fs.readFileSync(path.join(REPO, 'firestore.rules'), 'utf8');
const configSource = fs.readFileSync(path.join(REPO, 'config.js'), 'utf8');
const workerSource = fs.readFileSync(path.join(REPO, 'notifieur', 'worker.js'), 'utf8');
const wrangler = fs.readFileSync(path.join(REPO, 'notifieur', 'wrangler.toml'), 'utf8');

const adresse = (configSource.match(/var NOTIFIEUR_EMAIL = '([^']+)'/) || [])[1];
verifie('config.js declare une adresse de notifieur', !!adresse, String(adresse));
// Les deux fichiers se contrediraient en SILENCE : le notifieur serait
// refuse par Firestore et se tairait, ce qui ressemble a « rien a dire ».
verifie('firestore.rules reconnait exactement cette adresse',
  regles.indexOf("request.auth.token.email.lower() == '" + adresse + "'") !== -1,
  'adresse absente ou differente dans les regles');

const blocTaches = (regles.match(/match \/taches\/\{document\}[\s\S]*?\n    \}/) || [''])[0];
verifie('le notifieur peut LIRE taches', /allow read: if notifieur\(\)/.test(blocTaches));
// ⚠ Lecture seule. S'il apparait un jour dans un allow write, ce doit
// etre un choix, pas une distraction.
verifie('...et ne peut RIEN ecrire',
  !/allow (create|update|delete|write):[^;]*notifieur\(\)/.test(blocTaches),
  'notifieur() est apparu dans une regle d\'ecriture');

// Aucune autre collection ne doit le nommer : le catch-all final les lui
// ferme toutes, et c'est exactement ce qui rend cette identite sure.
const occurrences = (regles.match(/notifieur\(\)/g) || []).length;
verifie('notifieur() n\'est nomme que la ou il faut (definition + 1 lecture)',
  occurrences === 2, occurrences + ' occurrences');
verifie('la fonction n\'exige pas email_verified, qu\'un compte robot n\'a pas',
  /function notifieur\(\)[\s\S]*?\n    \}/.exec(regles)[0].indexOf('email_verified') === -1);

// Le piege ecarte doit rester ecrit : c'est la raison d'etre de tout ce
// montage, et elle se perdrait au premier « simplifions ».
verifie('les regles expliquent pourquoi pas une cle de compte de service',
  regles.indexOf('compte de service') !== -1);

// ⚠ LE QUOTA. Le plan Spark offre 50 000 lectures/jour ; lire toute la
// base a chacun des 288 reveils ferait dependre le plafond du nombre
// TOTAL de taches, et les taches faites s'accumulent pour toujours.
verifie('le digest lit les taches OUVERTES, pas toutes',
  /fieldPath: 'faite'[\s\S]{0,120}booleanValue: false/.test(workerSource));
verifie('les rappels ne lisent que les creneaux du jour et du lendemain',
  /GREATER_THAN_OR_EQUAL/.test(workerSource) && /LESS_THAN_OR_EQUAL/.test(workerSource)
  && /jourSuivant/.test(workerSource));
// Le KV repond avant Firestore : hors fenetre du digest, ou digest deja
// parti, la lecture complete n'a pas lieu du tout.
verifie('le KV est consulte AVANT de choisir la requete',
  workerSource.indexOf('dansLaFenetreDuDigest') < workerSource.indexOf('lireTachesOuvertes(env, jeton)'));
// Une liste tronquee ne doit jamais produire un digest : il annoncerait
// « 0 en retard » avec aplomb.
verifie('les resumes sont refuses quand la liste est tronquee',
  /messagesDus\(taches, maintenant\.jour, maintenant\.heure, listeComplete\)/.test(workerSource));
// Le bilan du soir en a besoin autant que le digest : les echeances qui
// basculent cette nuit n'ont pas de creneau, elles seraient invisibles
// dans la lecture courte.
verifie('le bilan du soir declenche aussi la lecture complete',
  /dansLaFenetreDuBilan\(maintenant\.heure\)/.test(workerSource)
  && /cleBilan\(maintenant\.jour\)/.test(workerSource));
// Deux clauses sur DEUX champs differents reclameraient un index
// composite, donc une etape manuelle de plus et une panne le jour ou on
// l'oublie. Chaque requete ne porte que sur un champ.
verifie('aucune requete ne melange faite et creneauJour',
  !/fieldPath: 'faite'[\s\S]{0,400}fieldPath: 'creneauJour'/.test(workerSource));

verifie('le Worker lit bien la collection taches',
  /collectionId: 'taches'/.test(workerSource));
verifie('...en se connectant comme un utilisateur, sans cle de service',
  /accounts:signInWithPassword/.test(workerSource)
  && workerSource.indexOf('private_key') === -1);
verifie('...et calcule l\'heure de Paris, pas celle du Worker',
  /Europe\/Paris/.test(workerSource) && /Intl\.DateTimeFormat/.test(workerSource));
// Le cron se reveille toutes les 5 min : une panne durable enverrait 288
// messages par jour. On se ferait taire le bot, et le prochain vrai
// rappel se perdrait dans le tas — une alerte qu'on apprend a ignorer ne
// vaut pas mieux que pas d'alerte.
verifie('les messages de panne sont limites a un par heure',
  /expirationTtl: 3600/.test(workerSource) && workerSource.indexOf('panne:') !== -1);
// En texte brut : si l'erreur vient d'un HTML mal forme, l'annoncer en
// HTML echouerait a son tour et la panne resterait muette.
verifie('...et en texte brut, sans parse_mode',
  workerSource.indexOf('Notifieur en panne') !== -1
  && workerSource.slice(workerSource.indexOf('async function signalerPanne'))
       .indexOf('parse_mode') === -1);

verifie('l\'envoi est marque APRES coup, jamais avant',
  workerSource.indexOf('await envoyerTelegram(env, message.texte);') <
  workerSource.indexOf('await marquerEnvoye(env, message.cle);'));

// ⚠ Le depot est PUBLIC. Un secret depose ici serait lisible par tout
// le monde, pour toujours — meme retire au commit suivant.
verifie('wrangler.toml ne contient aucun secret',
  !/TELEGRAM_TOKEN\s*=/.test(wrangler) && !/NOTIFIEUR_MDP\s*=/.test(wrangler)
  && !/FIREBASE_API_KEY\s*=/.test(wrangler));
verifie('le cron est bien declare', /crons = \["\*\/5 \* \* \* \*"\]/.test(wrangler));
verifie('le KV de deduplication est declare', /binding = "ENVOIS"/.test(wrangler));

console.log('\n' + (echecs === 0 ? 'Tous les tests passent.' : echecs + ' test(s) en echec.'));
process.exit(echecs === 0 ? 0 : 1);
