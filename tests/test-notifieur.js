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
verifie('les evenements sans date sont ecartes', lus.length === 3, lus.length + ' sejours');

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
// Un blocage Airbnb n'est PAS un trou : l'hote bloque en general pour
// des clients qui viennent en direct. Ce sont meme ceux a qui il faut le
// plus penser, puisque aucune plateforme ne relance a sa place.
verifie('un blocage Airbnb compte comme une arrivee en direct',
  lus[1].plateforme === 'direct', lus[1].plateforme);
verifie('un evenement booking est etiquete Booking', lus[2].plateforme === 'booking');
verifie('un UID d\'un autre domaine ne ment pas sur la plateforme',
  sejoursGite.plateformeDe('x@example.com', 'Reserved') === 'inconnu');

// J-1 DES DEUX COTES : on previent la veille de l'arrivee pour ecrire le
// message d'accueil, la veille du depart pour celui de sortie. Le jour
// meme, les gens sont deja en route.
const veilleArrivee = sejoursGite.sejoursAAnnoncer(lus, '2026-08-27');
verifie('la veille de l\'arrivee, l\'arrivee est annoncee',
  veilleArrivee.arrivees.length === 1 && veilleArrivee.departs.length === 0);
const veilleDepart = sejoursGite.sejoursAAnnoncer(lus, '2026-08-29');
verifie('la veille du depart, le depart est annonce',
  veilleDepart.departs.length === 1 && veilleDepart.arrivees.length === 0);
// ⚠ CETTE ASSERTION DISAIT L'INVERSE JUSQU'AU 31 AOUT 2026. Le jour
// meme ne produisait rien, et c'est exactement ce qui a laisse passer
// un message d'accueil. Le libelle distinct est teste plus bas.
verifie('le jour meme de son arrivee, un dernier rappel part',
  sejoursGite.sejoursAAnnoncer(lus, '2026-08-28').arrivees.length === 1);
verifie('un jour sans rien ne produit rien',
  sejoursGite.sejoursAAnnoncer(lus, '2026-09-15').arrivees.length === 0
  && sejoursGite.sejoursAAnnoncer(lus, '2026-09-15').departs.length === 0);

// --- La section dans le digest ---------------------------------------
const etatGite = {
  'info_2026-08-28': { nbPersons: 3, comment: 'Livret en allemand en premier', lang: 'de' }
};
const digestGite = messages.digestDuMatin([], '2026-08-27', '07:30', lus, etatGite).texte;

// En tete parce que c'est la seule chose du digest qui engage quelqu'un
// d'autre que soi, et la seule qu'on ne rattrape pas le lendemain.
const digestMixte = messages.digestDuMatin(
  [tache({ titre: 'Une tache du jour', echeance: '2026-08-27', echeanceHeure: '09:00' })],
  '2026-08-27', '07:30', lus, etatGite).texte;
verifie('la section gite passe AVANT le programme des taches',
  digestMixte.indexOf('Arrivée demain') < digestMixte.indexOf('Au programme')
  && digestMixte.indexOf('Au programme') !== -1);
verifie('...et le digest ne dit plus « rien au programme » quand le gite parle',
  digestGite.indexOf('Rien au programme') === -1);
verifie('la plateforme est nommee', digestGite.indexOf('Arrivée demain — Airbnb') !== -1);
// Le nombre de personnes et la LANGUE viennent de l'etat menage : on
// n'accueille pas trois Allemands comme un couple de Francais.
verifie('le nombre de personnes et la langue y sont',
  digestGite.indexOf('3 personnes') !== -1 && digestGite.indexOf('en allemand') !== -1);
verifie('la periode est lisible', digestGite.indexOf('du 28 au 30 août') !== -1, digestGite);
verifie('le commentaire du menage est repris',
  digestGite.indexOf('Livret en allemand en premier') !== -1);
verifie('le lien de reservation est la, entier',
  digestGite.indexOf('details/HMY45JSW55') !== -1);

// Un depart n'a pas de nombre de personnes a annoncer : ils s'en vont.
const digestDepart = messages.digestDuMatin([], '2026-08-29', '07:30', lus, etatGite).texte;
verifie('un depart s\'annonce sans compter les personnes',
  digestDepart.indexOf('Départ demain') !== -1 && digestDepart.indexOf('3 personnes') === -1);

// L'etat menage est un CONFORT : son absence ne doit pas priver du rappel.
const sansEtat = messages.digestDuMatin([], '2026-08-27', '07:30', lus, null).texte;
verifie('sans l\'etat menage, le rappel part quand meme',
  sansEtat.indexOf('Arrivée demain — Airbnb') !== -1 && sansEtat.indexOf('personnes') === -1);

// Un jour sans sejour ne doit pas laisser de section vide.
verifie('aucune section gite quand rien n\'arrive',
  messages.digestDuMatin([], '2026-09-15', '07:30', lus, etatGite).texte.indexOf('🏠') === -1);

// --- 11. Coherence config / regles / Worker --------------------------
console.log('\n11. Coherence entre les fichiers');
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
  /messagesDus\([\s\S]{0,80}listeComplete/.test(workerSource));
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

// LE SOIR N'EST PAS UNE COPIE DU MATIN, C'EST UN FILET.
// Une tache se coche, donc le notifieur sait qu'elle est faite et se
// tait. Le gite n'a pas de « fait » : rien ne dira jamais que le message
// est parti. Et l'oubli ne coute pas a celui qui oublie, mais aux gens
// qui arrivent. C'est la seule repetition assumee de la journee.
const soirGite = messages.bilanDuSoir([], '2026-08-27', '20:00', lus, etatGite).texte;
verifie('le gite figure aussi au bilan du soir',
  soirGite.indexOf('Arrivée demain — Airbnb') !== -1);
verifie('...mais la ligne d\'action DIFFERE : « envoye ? » et non « envoyer »',
  soirGite.indexOf("message d'arrivée envoyé ?") !== -1
  && soirGite.indexOf('envoyer le message') === -1);
verifie('...tandis que le matin dit bien « envoyer »',
  digestGite.indexOf("envoyer le message d'arrivée") !== -1
  && digestGite.indexOf('envoyé ?') === -1);
// Le detail est repete a dessein : si le message n'est pas parti le
// matin, on veut pouvoir l'ecrire le soir sans rien rouvrir.
verifie('le soir garde le lien et les details, pour agir sur-le-champ',
  soirGite.indexOf('details/HMY45JSW55') !== -1
  && soirGite.indexOf('3 personnes') !== -1);
// Sinon le filet ne servirait que les jours ou il y a aussi des taches.
verifie('un bilan sans taches part quand meme si le gite parle',
  messages.bilanDuSoir([], '2026-08-27', '20:00', lus, etatGite) !== null);
verifie('...et se tait toujours quand il n\'y a vraiment rien',
  messages.bilanDuSoir([], '2026-09-15', '20:00', lus, etatGite) === null);

// ============================================================
// LES DEUX DEFAUTS DU 31 AOUT 2026
// ============================================================
// Un message d'accueil n'est pas parti, et ca a pose de vrais problemes.
// Le diagnostic a trouve deux fautes de conception, pas un bug de calcul.

// ---- Defaut 1 : la panne du calendrier etait INDETECTABLE ----
// `null` veut dire « je n'ai pas pu lire », `[]` veut dire « rien a
// annoncer ». Les confondre faisait disparaitre la section en silence :
// le digest arrivait parfaitement normal, et rien ne distinguait
// « aucune arrivee demain » de « je n'ai rien pu lire ».
const digestPanne = messages.digestDuMatin([], '2026-08-27', '07:30', null, null).texte;
verifie('un calendrier injoignable est ANNONCE, pas tu',
  digestPanne.indexOf('Calendrier du gîte injoignable') !== -1, digestPanne);
verifie('...et le digest part quand meme, le gite etant une source externe',
  messages.digestDuMatin([], '2026-08-27', '07:30', null, null) !== null);
// Un tableau VIDE, lui, doit rester silencieux : il n'y a vraiment rien.
verifie('un calendrier lu mais vide ne dit rien',
  messages.digestDuMatin([], '2026-08-27', '07:30', [], null)
    .texte.indexOf('injoignable') === -1);
verifie('le Worker passe null quand la lecture echoue, pas un tableau vide',
  /let sejours = listeComplete \? null : \[\]/.test(workerSource));

// ---- Defaut 2 : rien ne rattrapait le JOUR MEME ----
// Le notifieur n'annoncait que demain. Des que la veille echouait —
// reseau, message survole, telephone en silencieux — plus rien ne
// rattrapait. Un rappel qui n'a qu'une seule chance n'est pas un filet.
const veille = sejoursGite.sejoursAAnnoncer(lus, '2026-08-27');
const leJourMeme = sejoursGite.sejoursAAnnoncer(lus, '2026-08-28');
verifie('la veille annonce toujours l\'arrivee',
  veille.arrivees.length === 1 && veille.arrivees[0].quand === 'demain');
verifie('LE JOUR MEME l\'annonce aussi, en dernier filet',
  leJourMeme.arrivees.length === 1 && leJourMeme.arrivees[0].quand === 'aujourdhui',
  JSON.stringify(leJourMeme.arrivees.map((a) => a.quand)));
verifie('...et le libelle DIFFERE, pour qu\'on sache que ca se joue',
  messages.digestDuMatin([], '2026-08-28', '07:30', lus, etatGite)
    .texte.indexOf("Arrivée AUJOURD'HUI") !== -1);
verifie('...tandis que la veille dit bien « demain »',
  digestGite.indexOf('Arrivée demain') !== -1
  && digestGite.indexOf("AUJOURD'HUI") === -1);
// Le surlendemain n'est pas annonce : deux jours d'avance seraient du
// bruit, on ne prepare pas un accueil 48 h en avance.
verifie('le surlendemain n\'est pas annonce',
  sejoursGite.sejoursAAnnoncer(lus, '2026-08-26').arrivees.length === 0);
// Le depart aussi doit avoir son filet du jour meme.
verifie('un depart est annonce la veille ET le jour meme',
  sejoursGite.sejoursAAnnoncer(lus, '2026-08-29').departs.length === 1
  && sejoursGite.sejoursAAnnoncer(lus, '2026-08-30').departs.length === 1
  && sejoursGite.sejoursAAnnoncer(lus, '2026-08-30').departs[0].quand === 'aujourdhui');

// ⚠ LE GITE NE DOIT JAMAIS FAIRE TOMBER LE DIGEST. C'est une source
// EXTERNE au hub : si elle est en panne, les taches n'ont pas a en
// souffrir. La section disparait, le reste part, et le bilan le dit.
verifie('le Worker attrape la panne du gite sans laisser tomber le digest',
  /catch \(erreur\)[\s\S]{0,600}giteIndisponible/.test(workerSource));
verifie('le Worker lit le gite pour LES DEUX fenetres, pas seulement le matin',
  /if \(listeComplete\) \{[\s\S]{0,400}lireGite\(\)/.test(workerSource));
verifie('le Worker lit bien les deux endpoints du gite',
  /GITE_API \+ '\/ical'/.test(workerSource) && /GITE_API \+ '\/'/.test(workerSource));

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
