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
const sejoursGite = require(path.join(REPO, 'notifieur', 'notifieur-sejours.js'));

// Les fichiers relus tels quels : plusieurs assertions verifient que le
// code, la configuration et les regles ne se contredisent pas. Declares
// ici, en tete, pour qu'aucun deplacement d'assertion ne les rende
// inaccessibles.
const regles = fs.readFileSync(path.join(REPO, 'firestore.rules'), 'utf8');
const configSource = fs.readFileSync(path.join(REPO, 'config.js'), 'utf8');
const workerSource = fs.readFileSync(path.join(REPO, 'notifieur', 'worker.js'), 'utf8');
const wrangler = fs.readFileSync(path.join(REPO, 'notifieur', 'wrangler.toml'), 'utf8');

let echecs = 0;
function verifie(nom, condition, detail) {
  if (condition) console.log('  ok   ' + nom);
  else { console.log('  ECHEC ' + nom + (detail ? ' -> ' + detail : '')); echecs++; }
}

const AJD = '2026-08-19';
const tache = (extra) => Object.assign({
  id: 't' + Math.random().toString(36).slice(2, 8),
  titre: 'Tache', detail: '', projet: '', important: false, urgentForce: false,
  echeance: '', echeanceHeure: '', echeanceDuree: 0,
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
  typeof calcul.estEnRetard === 'function' && typeof calcul.aUneHeure === 'function');

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

// --- 2. Le rappel avant l'heure d'une tache --------------------------
console.log('\n2. Le rappel avant l\'heure d\'une tache');
// Seules les taches A HEURE FIXE en recoivent un. Une tache due un jour
// sans heure precise n'a pas de moment a anticiper : elle figure au
// digest du matin, et c'est tout.
const aNeufHeures = tache({ id: 'c1', titre: 'Appeler le couvreur',
  echeance: AJD, echeanceHeure: '09:00', echeanceDuree: 60 });

verifie('rien 20 min avant', messages.rappelsCreneaux([aNeufHeures], AJD, '08:40').length === 0);
verifie('le rappel part pile a 15 min',
  messages.rappelsCreneaux([aNeufHeures], AJD, '08:45').length === 1);
verifie('...et encore a 5 min', messages.rappelsCreneaux([aNeufHeures], AJD, '08:55').length === 1);
// Passe l'heure, ce n'est plus un rappel mais un constat : « dans -3 min »
// ne veut rien dire, et le bilan du soir le reprendra.
verifie('plus rien une fois l\'heure passee',
  messages.rappelsCreneaux([aNeufHeures], AJD, '09:00').length === 0);
verifie('ni pendant', messages.rappelsCreneaux([aNeufHeures], AJD, '09:30').length === 0);

verifie('une tache faite ne rappelle rien',
  messages.rappelsCreneaux([Object.assign({}, aNeufHeures, { faite: true })], AJD, '08:50').length === 0);
// ⚠ UNE TACHE SANS HEURE N'A PAS DE RAPPEL. Elle est due ce jour-la,
// sans moment precis : il n'y a rien a anticiper d'un quart d'heure.
verifie('une tache SANS heure ne declenche aucun rappel',
  messages.rappelsCreneaux([tache({ echeance: AJD })], AJD, '08:50').length === 0);
verifie('une tache d\'un autre jour non plus',
  messages.rappelsCreneaux([tache({ echeance: '2026-08-25', echeanceHeure: '09:00' })], AJD, '08:50').length === 0);

// LE CAS QUI TOMBE ENTRE DEUX JOURS. Une tache a 00:05 demain doit etre
// rappelee a 23:50 CE SOIR — soit une minute « negative » dans le repere
// de la journee. Sans les minutes signees, ce rappel n'existerait jamais.
const justeApresMinuit = tache({ echeance: '2026-08-20', echeanceHeure: '00:05' });
verifie('une tache juste apres minuit est rappelee la veille au soir',
  messages.rappelsCreneaux([justeApresMinuit], AJD, '23:55').length === 1,
  'rappel absent a 23:55');
verifie('...et pas trop tot', messages.rappelsCreneaux([justeApresMinuit], AJD, '23:40').length === 0);

const texte = messages.rappelsCreneaux([aNeufHeures], AJD, '08:50')[0].texte;
verifie('le message annonce le bon delai', texte.indexOf('Dans 10 min') !== -1, texte.split('\n')[0]);
verifie('...le titre', texte.indexOf('Appeler le couvreur') !== -1);
verifie('...et les bornes horaires', texte.indexOf('09:00 – 10:00') !== -1, texte);

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
const deplacee = Object.assign({}, aNeufHeures, { echeanceHeure: '14:00' });
verifie('changer l\'heure change la cle, donc redonne droit a un rappel',
  messages.cleRappel(aNeufHeures) !== messages.cleRappel(deplacee),
  messages.cleRappel(aNeufHeures));
verifie('...et changer de jour aussi',
  messages.cleRappel(aNeufHeures)
  !== messages.cleRappel(Object.assign({}, aNeufHeures, { echeance: '2026-08-21' })));
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
  tache({ id: 'd1', titre: 'Rendez-vous couvreur', echeance: AJD, echeanceHeure: '14:00', echeanceDuree: 90 }),
  tache({ id: 'd2', titre: 'Coup de fil matinal', echeance: AJD, echeanceHeure: '09:00', echeanceDuree: 15 }),
  tache({ id: 'd3', titre: 'Relancer assurance', echeance: '2026-08-05' }),
  tache({ id: 'd4', titre: 'Ranger le garage', echeance: '2026-08-15', nbReports: 4 }),
  tache({ id: 'd5', titre: 'Sortir les poubelles', echeance: AJD }),
  tache({ id: 'd6', titre: 'Un jour peut-etre', echeance: '' }),
  tache({ id: 'd7', titre: 'Deja reglee', echeance: AJD, echeanceHeure: '11:00', faite: true }),
];
const digest = messages.digestDuMatin(journee, AJD, '07:30').texte;

verifie('les taches a heure fixe sont la, dans l\'ordre horaire',
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

// ⚠ SECTION NEE DE LA FUSION DES DATES. Les taches dues aujourd'hui SANS
// heure n'apparaissaient nulle part avant : le digest ne montrait que
// les creneaux, or ce sont les plus nombreuses.
verifie('les taches du jour SANS heure ont leur section',
  digest.indexOf('Sortir les poubelles') !== -1
  && digest.indexOf('sans heure fixée') !== -1, digest);
verifie('ce qui n\'est pas du aujourd\'hui reste dehors',
  digest.indexOf('Un jour peut-etre') === -1);

// ⚠ PAS DEUX FOIS LA MEME TACHE. Dans un message lu d'un oeil au reveil,
// la meme tache citee deux fois se lit comme un bug.
verifie('une tache en retard n\'est pas repetee sous « sans heure »',
  (digest.match(/Relancer assurance/g) || []).length === 1,
  (digest.match(/Relancer assurance/g) || []).length + ' occurrences');

// --- 6. L'echappement ------------------------------------------------
console.log('\n6. L\'echappement HTML');
// Les messages partent en parse_mode HTML : un titre contenant « < » ou
// « & » ferait REJETER l'envoi par l'API Telegram. Donc un rappel perdu,
// en silence, sur la tache la plus mal nommee.
const piegee = tache({ id: 'x', titre: 'Devis <b>gros</b> & cie',
  echeance: AJD, echeanceHeure: '09:00' });
const rappelPiege = messages.rappelsCreneaux([piegee], AJD, '08:50')[0].texte;
verifie('les chevrons du titre sont echappes',
  rappelPiege.indexOf('&lt;b&gt;gros&lt;/b&gt;') !== -1, rappelPiege);
verifie('l\'esperluette aussi', rappelPiege.indexOf('&amp; cie') !== -1);
// Les balises du gabarit, elles, doivent survivre : c'est leur role.
verifie('le gras du gabarit reste du HTML', rappelPiege.indexOf('<b>Dans') !== -1);
verifie('echapper() ne touche pas au texte ordinaire',
  messages.echapper('Rien de special') === 'Rien de special');

// --- 8. Tout ce qui est du en un tour --------------------------------
console.log('\n8. Tout ce qui est du en un tour');
const tour = messages.messagesDus(journee, AJD, '07:30');
verifie('le digest passe en tete, avant les rappels',
  tour.length > 0 && tour[0].cle.indexOf('digest:') === 0, cles(tour));
verifie('hors fenetre du digest, il ne reste que les rappels',
  messages.messagesDus(journee, AJD, '13:50').every((m) => m.cle.indexOf('heure:') === 0),
  cles(messages.messagesDus(journee, AJD, '13:50')));
// 17 h est desormais une fenetre du GITE : on prend 15 h, qui n'est une
// fenetre de personne.
verifie('a une heure creuse, rien ne part',
  messages.messagesDus(journee, AJD, '15:00').length === 0,
  cles(messages.messagesDus(journee, AJD, '15:00')));

// --- 9. Le bilan du soir ---------------------------------------------
console.log('\n9. Le bilan du soir');
// IL NE REPETE PAS LE DIGEST : il repond a une autre question. Le matin
// dit ce qui attend, le soir dit ce qui a glisse et ce qu'on peut encore
// sauver.
const SOIR = '20:00';
const journeeDuSoir = [
  tache({ id: 'b1', titre: 'Declarer les impots', echeance: AJD, important: true }),
  tache({ id: 'b2', titre: 'Appeler le garagiste', echeance: AJD, echeanceHeure: '14:00' }),
  tache({ id: 'b3', titre: 'Rendez-vous couvreur', echeance: '2026-08-20', echeanceHeure: '09:30', echeanceDuree: 90 }),
  tache({ id: 'b4', titre: 'Deja reglee', echeance: AJD, echeanceHeure: '10:00', faite: true }),
  tache({ id: 'b5', titre: 'Vieille heure', echeance: '2026-08-17', echeanceHeure: '11:00' }),
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

verifie('les heures passees du jour sont listees',
  texteBilan.indexOf('Appeler le garagiste') !== -1
  && texteBilan.indexOf('Heures passées') !== -1);
verifie('...mais pas une tache deja reglee', texteBilan.indexOf('Deja reglee') === -1);

// ⚠ LE CAS A NE PAS CASSER. Une heure d'un jour PRECEDENT est devenue
// un RETARD et a sa propre section. La reprendre ici jusqu'a ce qu'on
// cede ne serait plus un rappel mais du harcelement.
verifie('une heure d\'un jour PRECEDENT n\'est pas repetee tous les soirs',
  texteBilan.indexOf('Vieille heure') === -1);

verifie('les taches a heure fixe de demain sont annoncees',
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

// --- 10. Le gite : arrivees et departs --------------------------------
console.log('\n10. Le gite : arrivees et departs');
// Le flux iCal fusionne Airbnb et Booking. Le gabarit ci-dessous reprend
// EXACTEMENT les formes rencontrees dans le vrai flux, repliage compris.
const FLUX = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20260828',
  'DTEND;VALUE=DATE:20260830',
  'SUMMARY:Reserved',
  'UID:1418fb94e984-5512b91f50a66cd49c351f7edf411e95@airbnb.com',
  'DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/de',
  ' tails/HMY45JSW55\\nPhone Number (Last 4 Digits): 6792',
  'END:VEVENT',
  // Le blocage d'un jour qui a fait partir « Arrivee ce soir » le
  // 3 septembre 2026 alors que personne n'arrivait. Repris tel quel du
  // vrai flux.
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20260903',
  'DTEND;VALUE=DATE:20260904',
  'SUMMARY:Airbnb (Not available)',
  'UID:7f662ec65913-1e61b62a8c0a7b499d5f9e3595317541@airbnb.com',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261219',
  'DTEND;VALUE=DATE:20261227',
  'SUMMARY:Airbnb (Not available)',
  'UID:7f662ec65913-cef87b81784d1b9a961675a09da7cba2@airbnb.com',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20270620',
  'DTEND;VALUE=DATE:20270621',
  'SUMMARY:CLOSED - Not available',
  'UID:abc@booking.com',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'SUMMARY:Evenement sans dates',
  'UID:zzz@airbnb.com',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

const lus = sejoursGite.analyserIcal(FLUX);
verifie('les evenements sans date sont ecartes, les blocages d\'un jour aussi',
  lus.length === 2, lus.length + ' sejours');

// ⚠ LE REPLIAGE. Une ligne iCal se coupe au-dela de 75 octets et la
// suite commence par une espace. Sans depliage, l'URL de reservation
// arriverait tronquee — un lien mort dans le message, et personne pour
// s'en apercevoir avant d'avoir tape dessus.
verifie('une ligne repliee est recollee : le lien est ENTIER',
  lus[0].lien === 'https://www.airbnb.com/hosting/reservations/details/HMY45JSW55',
  lus[0].lien);

// Les dates se prennent telles quelles : Airbnb met la vraie date de
// depart dans DTEND, contrairement a la lettre de la norme iCal. Deux
// sources le confirment — l'affichage du site menage et _futureCheckouts.
verifie('« du 28 au 30 » se lit sans decalage',
  lus[0].debut === '2026-08-28' && lus[0].fin === '2026-08-30');

// LA PLATEFORME NE SE LIT PAS DANS LE LIBELLE mais dans le domaine de
// l'UID : c'est le seul champ que les deux plateformes remplissent.
verifie('Reserved chez airbnb = une reservation Airbnb', lus[0].plateforme === 'airbnb');
// Un blocage Airbnb QUI DURE n'est pas un trou : l'hote a bloque pour
// des clients qui viennent en direct. Ce sont meme ceux a qui il faut le
// plus penser, puisque aucune plateforme ne relance a sa place.
verifie('un blocage Airbnb de plusieurs jours reste une arrivee en direct',
  lus[1].plateforme === 'direct', lus[1].plateforme);
verifie('un evenement booking est etiquete Booking',
  sejoursGite.plateformeDe('abc@booking.com', 'CLOSED - Not available') === 'booking');
verifie('un UID d\'un autre domaine ne ment pas sur la plateforme',
  sejoursGite.plateformeDe('x@example.com', 'Reserved') === 'inconnu');

// ⚠ LA FAUSSE NOTIFICATION DU 3 SEPTEMBRE 2026. A 17 h, « Arrivee ce
// soir · en direct » est parti alors que personne n'arrivait : le flux
// portait un blocage d'un jour, et tout blocage etait lu comme un
// sejour. La page menage, elle, affichait juste — elle ecarte deja les
// blocages d'un jour. Ce test dit que le notifieur le fait aussi.
verifie('un blocage d\'un jour ne devient pas un sejour',
  !lus.some((s) => s.debut === '2026-09-03'),
  JSON.stringify(lus.map((s) => s.debut)));
verifie('...et il ne declenche donc plus « Arrivee ce soir »',
  sejoursGite.rappelsDus(lus, '2026-09-03', '17:00').length === 0);
verifie('...ni les cinq autres rappels de ce faux sejour',
  sejoursGite.rappelsDus(lus, '2026-09-02', '12:00').length === 0
  && sejoursGite.rappelsDus(lus, '2026-09-02', '18:00').length === 0
  && sejoursGite.rappelsDus(lus, '2026-09-03', '12:00').length === 0
  && sejoursGite.rappelsDus(lus, '2026-09-03', '18:00').length === 0
  && sejoursGite.rappelsDus(lus, '2026-09-04', '11:00').length === 0);

// LES DEUX FORMES D'ARTEFACT, hors flux complet.
verifie('la borne des 12 mois d\'Airbnb est un artefact',
  sejoursGite.estArtefactDeCalendrier(
    { debut: '2027-09-03', fin: '2027-09-04', resume: 'Airbnb (Not available)' }));
verifie('un jour ferme chez Booking aussi',
  sejoursGite.estArtefactDeCalendrier(
    { debut: '2027-06-20', fin: '2027-06-21', resume: 'CLOSED - Not available' }));
// ⚠ LA REGLE PORTE SUR LE LIBELLE, PAS SUR LA DUREE SEULE. Une vraie
// reservation d'une seule nuit reste un sejour : sans cette precision,
// le notifieur se tairait sur un client qui ne dort qu'un soir.
verifie('une reservation d\'une seule nuit n\'est PAS un artefact',
  !sejoursGite.estArtefactDeCalendrier(
    { debut: '2026-08-28', fin: '2026-08-29', resume: 'Reserved' }));
verifie('un blocage de plusieurs jours n\'est PAS un artefact',
  !sejoursGite.estArtefactDeCalendrier(
    { debut: '2026-12-19', fin: '2026-12-27', resume: 'Airbnb (Not available)' }));

// ⚠ CE QUI EST DU DEPEND DESORMAIS DE L'HEURE, pas seulement du jour.
// Chaque rappel a sa fenetre : demander l'heure d'arrivee a midi la
// veille, la procedure a 18 h, le code le jour meme a midi.
verifie('la veille a midi, on demande a quelle heure ils arrivent',
  sejoursGite.rappelsDus(lus, '2026-08-27', '12:00')
    .some((d) => d.rappel.cle === 'heure-arrivee'));
verifie('la veille a 18 h, la procedure entrante',
  sejoursGite.rappelsDus(lus, '2026-08-27', '18:00')
    .some((d) => d.rappel.cle === 'procedure-arrivee'));
verifie('la veille du depart a 18 h, la procedure de depart',
  sejoursGite.rappelsDus(lus, '2026-08-29', '18:00')
    .some((d) => d.rappel.cle === 'procedure-depart'));
// ⚠ LE JOUR MEME EXISTE PARCE QU'IL A MANQUE. Le 31 aout 2026, un
// message d'accueil n'est pas parti : le notifieur n'annoncait alors que
// demain, et des que la veille echouait, plus rien ne rattrapait.
verifie('le jour meme, le code de la boite reste a envoyer',
  sejoursGite.rappelsDus(lus, '2026-08-28', '12:00')
    .some((d) => d.rappel.cle === 'code-boite'));
verifie('un jour sans sejour ne produit rien',
  sejoursGite.rappelsDus(lus, '2026-09-15', '12:00').length === 0);
verifie('hors fenetre non plus',
  sejoursGite.rappelsDus(lus, '2026-08-27', '09:00').length === 0);

function premiereLigne(texte) { return texte.split('\n')[0]; }

// --- Les six rappels du gite -----------------------------------------
const etatGite = {
  'info_2026-08-28': { nbPersons: 3, comment: 'Livret en allemand en premier',
                       lang: 'de', voyageurs: 'Marie et Paul' }
};

// ⚠ UNE SEQUENCE, PAS UNE REPETITION. La premiere version disait trois
// fois « envoyer le message d'arrivee » sans jamais preciser lequel. Une
// repetition, on finit par l'ignorer ; une suite d'actions distinctes,
// on la suit.
verifie('six rappels, chacun son action', sejoursGite.RAPPELS_GITE.length === 6,
  String(sejoursGite.RAPPELS_GITE.length));
verifie('quatre sont des actions, deux des informations',
  sejoursGite.RAPPELS_GITE.filter((r) => r.action).length === 4
  && sejoursGite.RAPPELS_GITE.filter((r) => r.info).length === 2);

// ⚠ LES FENETRES NE SE RECOUVRENT JAMAIS. 17 h et 18 h se suivent d'une
// heure : sans borne haute EXCLUE, les deux seraient ouvertes a 18 h et
// deux messages porteraient la meme cle.
verifie('chaque heure ouvre sa propre fenetre',
  sejoursGite.fenetreGite('11:30') === '11:00'
  && sejoursGite.fenetreGite('12:30') === '12:00'
  && sejoursGite.fenetreGite('17:59') === '17:00'
  && sejoursGite.fenetreGite('18:00') === '18:00');
verifie('...et hors fenetre, rien',
  sejoursGite.fenetreGite('10:30') === '' && sejoursGite.fenetreGite('13:00') === ''
  && sejoursGite.fenetreGite('19:00') === '' && sejoursGite.fenetreGite('07:30') === '');

// ⚠ LA CLE NE PORTE PAS LE SEJOUR. Elle doit etre calculable SANS avoir
// lu le calendrier, pour que le Worker interroge sa memoire d'abord et
// n'aille chercher le flux que s'il reste quelque chose a dire.
verifie('la cle porte la fenetre et le jour, pas le sejour',
  sejoursGite.cleGite('2026-08-27', '12:00') === 'gite:12:00:2026-08-27');
verifie('...donc deux fenetres du meme jour ont des cles distinctes',
  sejoursGite.cleGite('2026-08-27', '12:00') !== sejoursGite.cleGite('2026-08-27', '18:00'));

// --- La sequence complete d'un sejour --------------------------------
// `lus` contient une arrivee le 28 aout et un depart le 30.
const sequence = [
  ['2026-08-27', '12:00', "demander à quelle heure ils pensent arriver"],
  ['2026-08-27', '18:00', "envoyer la procédure d'arrivée"],
  ['2026-08-28', '12:00', 'envoyer le code de la boîte à clés'],
  ['2026-08-28', '17:00', 'Arrivée ce soir'],
  ['2026-08-29', '18:00', 'envoyer la procédure de départ'],
  ['2026-08-30', '11:00', 'Départ ce matin'],
];
sequence.forEach(([jour, heure, attendu]) => {
  const msg = messages.messageGite(lus, jour, heure, etatGite);
  verifie('le ' + jour + ' a ' + heure + ' : ' + attendu.slice(0, 34),
    msg && msg.texte.indexOf(attendu) !== -1, msg ? msg.texte.split('\n')[2] : '(aucun message)');
});

const rappelMidi = messages.messageGite(lus, '2026-08-27', '12:00', etatGite);
verifie('le message part sur le canal partage', rappelMidi.canal === 'gite');
// L'en-tete ne dit plus « Gite » : la maison et la date suffisent.
verifie('l\'en-tete tient en une maison et une date',
  premiereLigne(rappelMidi.texte) === '🏠 <b>jeudi 27 août</b>',
  premiereLigne(rappelMidi.texte));

// ⚠ ACTION ET INFO DOIVENT SE DISTINGUER SANS ETRE LUES. Deux icones de
// meme poids se confondaient a l'usage ; l'asymetrie est donc dans le
// ton — l'action crie, l'info chuchote.
verifie('une action crie en majuscules avec un rond rouge',
  rappelMidi.texte.indexOf('🔴 <b>À FAIRE') !== -1);
const info = messages.messageGite(lus, '2026-08-28', '17:00', etatGite);
verifie('une info chuchote en minuscules',
  info.texte.indexOf('▫️ <i>pour info</i>') !== -1
  && info.texte.indexOf('À FAIRE') === -1);

// ⚠ QUI ECRIT. Dans un groupe partage, le message doit dire s'il est
// pour vous ou pour l'autre — sans quoi on retombe sur « je pensais que
// tu t'en occupais », qui a deja coute un message d'accueil.
verifie('l\'action nomme son responsable',
  rappelMidi.texte.indexOf('À FAIRE — Alisson') !== -1, rappelMidi.texte);
verifie('Airbnb va a Alisson, Booking et le direct a Cyril',
  sejoursGite.responsableDe('airbnb') === 'Alisson'
  && sejoursGite.responsableDe('booking') === 'Cyril'
  && sejoursGite.responsableDe('direct') === 'Cyril');

// Le prenom vient de `voyageurs`, PAS de `comment` : le commentaire
// s'adresse aux personnes du menage et s'affiche pour tout le monde.
verifie('le prenom des voyageurs est repris',
  rappelMidi.texte.indexOf('Marie et Paul') !== -1);
verifie('...ainsi que le nombre et la langue',
  rappelMidi.texte.indexOf('3 pers.') !== -1
  && rappelMidi.texte.indexOf('en allemand') !== -1);
verifie('le commentaire du menage reste distinct du prenom',
  rappelMidi.texte.indexOf('Livret en allemand en premier') !== -1);
verifie('sans etat menage, le rappel part quand meme',
  messages.messageGite(lus, '2026-08-27', '12:00', null).texte.indexOf('À FAIRE') !== -1);

// ⚠ ASYMETRIE ARRIVEE / DEPART. Les voyageurs arrivent en fin
// d'apres-midi mais partent le matin : une ACTION de depart le jour meme
// arriverait apres leur voiture. Le 11 h n'est donc qu'une information.
verifie('aucune action de depart le jour meme',
  sejoursGite.RAPPELS_GITE.filter((r) => r.sur === 'depart' && !r.veille && r.action).length === 0);

verifie('rien hors des fenetres du gite',
  messages.messageGite(lus, '2026-08-27', '07:30', etatGite) === null
  && messages.messageGite(lus, '2026-08-27', '20:00', etatGite) === null);
verifie('rien un jour sans sejour',
  messages.messageGite(lus, '2026-09-15', '12:00', etatGite) === null);

// Le digest personnel ne parle plus du gite : deux publics distincts.
const digestSeul = messages.digestDuMatin([], '2026-08-27', '07:30');
verifie('le digest ne contient rien du gite',
  digestSeul.texte.indexOf('🏠') === -1 && digestSeul.texte.indexOf('À FAIRE') === -1);
verifie('...et porte le canal personnel', digestSeul.canal === 'taches');

// ⚠ LE GITE NE DOIT JAMAIS FAIRE TOMBER LE DIGEST. C'est une source
// EXTERNE au hub : si elle est en panne, les taches n'ont pas a en
// souffrir. La section disparait, le reste part, et le bilan le dit.
verifie('le Worker attrape la panne du gite sans laisser tomber le digest',
  /catch \(erreur\)[\s\S]{0,600}giteIndisponible/.test(workerSource));
// ⚠ LE GITE NE DEPEND PLUS DES FENETRES DES TACHES. Il a les siennes —
// 11 h, 12 h, 17 h, 18 h — et le Worker decide d'aller lire le
// calendrier a partir d'elles SEULES.
verifie('le Worker ouvre le gite sur ses propres fenetres',
  workerSource.indexOf('sejoursGite.fenetreGite(maintenant.heure)') !== -1);
// La memoire est interrogee AVANT le calendrier : la plupart des tours
// n'ont rien a dire du gite, et le flux iCal n'a alors pas a etre lu.
verifie('...et consulte sa memoire avant de lire le flux',
  /restantsPour\(\s+sejoursGite\.cleGite/.test(workerSource)
  && workerSource.indexOf('giteADire') < workerSource.indexOf('lireGite(env)'));
// ⚠ LA PANNE DU 24 AOUT AU 1er SEPTEMBRE 2026. Le Worker appelait le
// calendrier par son URL PUBLIQUE. Les deux Workers vivant sur le meme
// sous-domaine workers.dev, l'appel ne sortait pas sur Internet : il
// restait dans le reseau interne de Cloudflare, ou ce nom ne se resout
// pas, et rendait 404. Aucune notification du gite n'est partie pendant
// huit jours, et aucun test local ne pouvait le voir — depuis un poste,
// la meme URL repond parfaitement.
verifie('le gite est lu par la LIAISON DE SERVICE, pas par son URL publique',
  /env\.GITE\.fetch/.test(workerSource));
verifie('...et la liaison est declaree dans wrangler.toml',
  /binding = "GITE"/.test(wrangler) && /service = "menage-state"/.test(wrangler));
// Le bilan dit par quelle voie la lecture est passee : un binding
// oublie ne doit pas redevenir une panne muette.
verifie('le bilan indique la voie empruntee',
  /giteVia/.test(workerSource));

verifie('le Worker lit bien les deux endpoints du gite',
  /appeler\('\/ical'\)/.test(workerSource) && /appeler\('\/'\)/.test(workerSource));

// Le routage cote Worker : deux jetons, et une LISTE de destinataires.
// Un bot n'ecrit jamais « a plusieurs », il ecrit dans une conversation.
verifie('le Worker route selon le canal du message',
  /envoyerTelegram\(env, texte, message\.canal, message\.restants\)/.test(workerSource));
verifie('...vers un second jeton pour les taches',
  /TELEGRAM_TOKEN_TACHES/.test(workerSource) && /TELEGRAM_CHAT_ID_TACHES/.test(workerSource));
verifie('...et accepte plusieurs destinataires par canal',
  /listeDestinataires/.test(workerSource) && /split\(','\)/.test(workerSource));
// Sans jeton personnel, tout doit partir quand meme : mieux vaut un
// message au mauvais endroit qu'aucun message.
verifie('un jeton personnel manquant se replie sur le bot du gite',
  /canal === 'taches' && env\.TELEGRAM_TOKEN_TACHES/.test(workerSource));
// Une panne technique ne regarde pas les invites du gite.
verifie('les pannes techniques restent sur le canal personnel',
  /const voie = canalDe\(env, 'taches'\);/.test(workerSource));

// ⚠ LA SIMULATION NE DOIT PAS MANGER LE VRAI MESSAGE. Tester le 2
// septembre depuis le 1er envoie de vrais messages — c'est le but, on
// veut les voir arriver — mais si elle ecrivait la cle de dedup, le
// rappel du 2 ne partirait jamais le 2. La memoire est donc ignoree
// dans les deux sens.
verifie('une simulation n ecrit pas la memoire des envois',
  /if \(!simule && servis\.length\) await marquerEnvoye/.test(workerSource));
verifie('...et ne saute rien sous pretexte que ce serait deja parti',
  /const restantsPour = \(cle, destinataires\) => simule/.test(workerSource));
// Un message simule doit se reconnaitre : sinon quelqu'un agit dessus,
// ou ignore le vrai le lendemain en croyant l'avoir deja lu.
verifie('un message simule se signale comme tel',
  /Simulation du/.test(workerSource));

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
  /'panne:' \+ heure, 3600\)/.test(workerSource));
// En texte brut : si l'erreur vient d'un HTML mal forme, l'annoncer en
// HTML echouerait a son tour et la panne resterait muette.
verifie('...et en texte brut, sans parse_mode',
  workerSource.indexOf('Notifieur en panne') !== -1
  && workerSource.indexOf('async function alerterTechnique') !== -1
  && workerSource.slice(workerSource.indexOf('async function alerterTechnique'))
       .indexOf('parse_mode') === -1);

// L'ancienne version de cette assertion cherchait un appel qui n'a
// jamais existe : elle passait sur deux -1 et ne gardait rien. Les deux
// reperes sont desormais verifies presents avant d'etre compares.
const APPEL_ENVOI = 'await envoyerTelegram(env, texte, message.canal, message.restants);';
const APPEL_MARQUE = 'await marquerEnvoye(env, message.cle, servis);';
verifie('l\'envoi est marque APRES coup, jamais avant',
  workerSource.indexOf(APPEL_ENVOI) !== -1
  && workerSource.indexOf(APPEL_MARQUE) !== -1
  && workerSource.indexOf(APPEL_ENVOI) < workerSource.indexOf(APPEL_MARQUE));

// ============================================================
// ⚠ LE DOUBLON DU 3 SEPTEMBRE 2026
// ============================================================
// Telegram a rendu 504 sur le rappel du gite de 11 h. Le message etait
// bien parti — seule la reponse s'est perdue. L'envoi jetait, la cle de
// deduplication n'etait donc pas posee, et le tour de 11 h 05 a tout
// renvoye. L'alerte de panne, elle, ne verifiait pas sa propre reponse :
// elle a ete avalee par le meme hoquet, tout en consommant son blocage
// horaire. Le doublon a ete visible ; sa cause ne l'etait pas.
//
// Le choix retenu, et c'en est un : sur un doute, on prefere la PERTE
// ANNONCEE au doublon silencieux. Un doublon n'apprend rien a personne
// et use la confiance dans le canal ; un doute dit se lit et se verifie.
verifie('un 5xx compte comme recu, et non comme a renvoyer',
  /if \(reponse\.status >= 500\) \{/.test(workerSource)
  && /resultat\.servis\.push\(destinataire\);\s+resultat\.incertains\.push/.test(workerSource));
verifie('...mais ne passe jamais en silence',
  /Envoi incertain/.test(workerSource)
  && /alerterTechnique\(env,\s+'Envoi incertain/.test(workerSource));
verifie('un refus franc, lui, garde sa chance au tour suivant',
  /resultat\.refuses\.push/.test(workerSource)
  && /Telegram a refuse/.test(workerSource.normalize('NFD').replace(/[\u0300-\u036f]/g, '')));
verifie('un canal en panne n entraine pas les autres',
  /faits: servis/.test(workerSource)
  && /memoire\.faits/.test(workerSource)
  && /destinataires\.filter\(\(d\) => faits\.indexOf\(d\) === -1\)/.test(workerSource));
// Deployer ne doit pas vider le KV : les valeurs d'avant sont des
// horodatages nus, illisibles en JSON, et ce refus vaut « tout est parti ».
verifie('...et les anciennes valeurs restent comprises comme completes',
  workerSource.indexOf('let faits = destinataires;') !== -1);
verifie('une alerte technique ne pose sa cle que si elle est partie',
  /if \(reponse\.ok\) partie = true;/.test(workerSource)
  && /if \(!partie \|\| !env\.ENVOIS\) return;/.test(workerSource));
// La valeur de la cle porte le TEXTE de l'alerte : quand le message
// n'arrive pas, c'est la seule trace lisible de ce qui s'est passe.
verifie('...et garde le texte de l alerte comme trace',
  /env\.ENVOIS\.put\(cle, texte\.slice\(0, 200\)/.test(workerSource));

// ⚠ Le depot est PUBLIC. Un secret depose ici serait lisible par tout
// le monde, pour toujours — meme retire au commit suivant.
verifie('wrangler.toml ne contient aucun secret',
  !/TELEGRAM_TOKEN\s*=/.test(wrangler) && !/NOTIFIEUR_MDP\s*=/.test(wrangler)
  && !/FIREBASE_API_KEY\s*=/.test(wrangler));
verifie('le cron est bien declare', /crons = \["\*\/5 \* \* \* \*"\]/.test(wrangler));
verifie('le KV de deduplication est declare', /binding = "ENVOIS"/.test(wrangler));
// Sans eux, le 504 du 3 septembre 2026 a du se deterrer a la main dans
// les valeurs du KV. Une ligne de journal le disait en dix secondes.
verifie('les journaux d invocation sont actives',
  /\[observability\]/.test(wrangler) && /enabled = true/.test(wrangler));

console.log('\n' + (echecs === 0 ? 'Tous les tests passent.' : echecs + ' test(s) en echec.'));
process.exit(echecs === 0 ? 0 : 1);
