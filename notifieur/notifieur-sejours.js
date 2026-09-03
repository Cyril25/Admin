// ============================================================
// notifieur-sejours.js — Lire le calendrier du gîte
// ============================================================
// Le flux iCal de `menage-state.cyril-samson41.workers.dev/ical`
// fusionne les calendriers Airbnb et Booking du gîte de Labergement.
// Ce fichier le lit et en tire les séjours ; il ne décide de rien
// d'autre, et ne touche ni au réseau ni à l'horloge.
//
// À QUOI ÇA SERT : rappeler, à chaque moment utile, le geste que
// personne ne fera à la place de l'hôte — demander l'heure d'arrivée,
// envoyer la procédure, donner le code de la boîte à clés. Aucune
// plateforme ne s'en charge, et c'est typiquement ce qu'on oublie.
//
// ------------------------------------------------------------
// TROIS SORTES D'ÉVÉNEMENTS, ET IL A FALLU LES DONNÉES POUR LE VOIR
// ------------------------------------------------------------
//   SUMMARY:Reserved              @airbnb.com   → réservation Airbnb,
//       avec l'URL de la réservation en DESCRIPTION ;
//   SUMMARY:Airbnb (Not available) @airbnb.com  → dates bloquées sur
//       Airbnb. Le flux ne dit pas pourquoi — mais quand le blocage dure
//       plusieurs jours, l'hôte a bloqué pour des clients qui viennent EN
//       DIRECT. Ce sont de vraies arrivées, et ce sont même celles qu'il
//       ne faut surtout pas manquer : aucune plateforme ne relancera pour
//       lui. Vérifié sur l'état ménage : les blocages du 19-27 décembre et
//       du 28 décembre-2 janvier portent un `info_` avec un prénom ;
//   SUMMARY:CLOSED - Not available @booking.com → indiscernable. Booking
//       n'exporte rien qui distingue un séjour d'un inventaire fermé.
//
// ⚠ LES DEUX CALENDRIERS SONT INDÉPENDANTS. Vérifié sur les données :
// aucune date réservée côté Booking n'apparaît en blocage côté Airbnb.
// Il n'y a donc pas de doublon à dédupliquer — mais si un jour le
// cross-blocking était activé entre les deux plateformes, chaque séjour
// apparaîtrait DEUX fois et il faudrait fusionner les chevauchements.
//
// ------------------------------------------------------------
// LES DATES SONT DÉJÀ CELLES QU'ON VEUT
// ------------------------------------------------------------
// En iCal, un DTEND en VALUE=DATE est théoriquement exclusif. Airbnb,
// lui, y met la date de départ réelle : DTSTART 20260828 / DTEND
// 20260830 se lit « du 28 au 30 », et c'est bien ce que l'hôte voit.
// Deux sources le confirment — l'affichage du site ménage, et la liste
// `_futureCheckouts` de l'état, qui contient le 30. On prend donc les
// dates telles quelles, sans décalage.
// ============================================================

var calcul = require('../taches/taches-calcul.js');

// ------------------------------------------------------------
// 1. Lire le format iCal
// ------------------------------------------------------------
// Une ligne iCal se replie au-delà de 75 octets : la suite commence par
// une espace ou une tabulation. Sans dépliage, l'URL de réservation
// arriverait coupée en deux et le lien serait mort — c'est justement le
// cas dans ce flux, où DESCRIPTION est toujours repliée.
function deplier(texte) {
    return String(texte || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n[ \t]/g, '');
}

// Les valeurs iCal échappent virgules, points-virgules et sauts de ligne.
function desechapper(valeur) {
    return String(valeur || '')
        .replace(/\\n/gi, '\n')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(/\\\\/g, '\\');
}

// 'DTSTART;VALUE=DATE:20260828' → '2026-08-28'. Rend '' si la ligne ne
// porte pas une date pleine : un séjour sans date n'est pas un séjour,
// et vaut mieux ignoré qu'inventé.
function dateIcal(valeur) {
    var brute = String(valeur || '').trim();
    var jour = /^(\d{4})(\d{2})(\d{2})/.exec(brute);
    if (!jour) return '';
    var iso = jour[1] + '-' + jour[2] + '-' + jour[3];
    return calcul.isoValide(iso) ? iso : '';
}

// ------------------------------------------------------------
// 2. D'où vient le séjour
// ------------------------------------------------------------
// La plateforme ne se lit PAS dans un libellé : elle se lit dans le
// domaine de l'UID. C'est le seul champ que les deux plateformes
// remplissent de façon fiable.
function plateformeDe(uid, resume) {
    var domaine = String(uid || '').split('@')[1] || '';
    if (domaine.indexOf('booking') !== -1) return 'booking';
    if (domaine.indexOf('airbnb') !== -1) {
        // Sur Airbnb, seul « Reserved » est une réservation de la
        // plateforme. Tout autre libellé est un blocage — et un blocage,
        // chez cet hôte, veut généralement dire des clients en direct.
        return String(resume || '').trim() === 'Reserved' ? 'airbnb' : 'direct';
    }
    return 'inconnu';
}

var LIBELLES_PLATEFORME = {
    airbnb: 'Airbnb',
    booking: 'Booking',
    direct: 'en direct',
    inconnu: 'origine inconnue'
};

function libellePlateforme(plateforme) {
    return LIBELLES_PLATEFORME[plateforme] || LIBELLES_PLATEFORME.inconnu;
}

// L'URL de la réservation, quand la plateforme la donne — Airbnb la met
// dans DESCRIPTION. Elle vaut de l'or dans un message : un lien à
// toucher plutôt qu'une réservation à retrouver à la main.
function lienDeReservation(description) {
    var trouve = /(https?:\/\/\S+)/.exec(String(description || ''));
    return trouve ? trouve[1] : '';
}

// ------------------------------------------------------------
// 2 bis. LES BLOCAGES D'UN SEUL JOUR NE SONT PAS DES SÉJOURS
// ------------------------------------------------------------
// ⚠ CETTE RÈGLE A COÛTÉ UNE FAUSSE NOTIFICATION. Le 3 septembre 2026 à
// 17 h, « Arrivée ce soir · en direct » est parti alors que personne
// n'arrivait : le flux portait un blocage `Airbnb (Not available)` du
// 3 au 4 septembre, et tout blocage était lu comme une arrivée.
//
// Les plateformes exportent des blocages qui ne sont PAS des séjours,
// et on les reconnaît à leur durée d'un seul jour :
//
//   • LE JOUR MÊME DEVENU NON RÉSERVABLE. Le préavis d'Airbnb ferme la
//     journée en cours ; elle ressort en blocage d'un jour, et elle
//     apparaît le matin même — d'où une notification qui tombe sans que
//     rien n'ait changé au calendrier. C'était le cas du 3 septembre.
//   • LA BORNE DES 12 MOIS. Airbnb bloque un jour à l'exacte limite de
//     sa fenêtre de réservation, et ce jour glisse avec le calendrier :
//     le 24 août 2026 le flux portait 2027-08-24, le 3 septembre il
//     portait 2027-09-03. Booking fait pareil avec un `CLOSED` fourre-
//     tout qui court jusqu'à la fin de sa propre fenêtre.
//
// Un vrai séjour en direct, lui, dure plusieurs jours — vérifié sur
// l'état ménage, où les blocages de décembre portent un prénom.
//
// ⚠ CE QU'ON ACCEPTE DE PERDRE : une vraie nuit unique en direct, que
// l'hôte bloquerait pour un seul soir, deviendrait invisible. C'est le
// prix, et c'est celui que paie déjà la page ménage, qui applique
// exactement cette règle (`durationDays <= 1 && summary.includes('Not
// available')`) et affichait donc juste ce jour-là. Les distinguer
// demanderait de recouper avec `info_`, ce que seul un endpoint partagé
// pourrait faire proprement.
//
// La règle porte sur le LIBELLÉ et pas sur la plateforme : une
// réservation `Reserved` d'une seule nuit reste un séjour.
function estArtefactDeCalendrier(sejour) {
    if (String(sejour.resume || '').indexOf('Not available') === -1) return false;
    var jours = calcul.joursEntre(sejour.debut, sejour.fin);
    return jours !== null && jours <= 1;
}

// ------------------------------------------------------------
// 3. L'analyseur
// ------------------------------------------------------------
// Rend [{ debut, fin, plateforme, lien, resume }], les séjours sans
// dates exploitables écartés, et les blocages d'un jour avec eux.
function analyserIcal(texte) {
    var lignes = deplier(texte).split('\n');
    var sejours = [];
    var courant = null;

    lignes.forEach(function(ligne) {
        if (ligne.indexOf('BEGIN:VEVENT') === 0) {
            courant = { debut: '', fin: '', uid: '', resume: '', description: '' };
            return;
        }
        if (ligne.indexOf('END:VEVENT') === 0) {
            if (courant && courant.debut && courant.fin) {
                var sejour = {
                    debut: courant.debut,
                    fin: courant.fin,
                    resume: courant.resume,
                    plateforme: plateformeDe(courant.uid, courant.resume),
                    lien: lienDeReservation(courant.description)
                };
                if (!estArtefactDeCalendrier(sejour)) sejours.push(sejour);
            }
            courant = null;
            return;
        }
        if (!courant) return;

        // Le nom d'une propriété peut porter des paramètres après un
        // point-virgule : DTSTART;VALUE=DATE:20260828.
        var separateur = ligne.indexOf(':');
        if (separateur === -1) return;
        var nom = ligne.slice(0, separateur).split(';')[0].toUpperCase();
        var valeur = ligne.slice(separateur + 1);

        if (nom === 'DTSTART') courant.debut = dateIcal(valeur);
        else if (nom === 'DTEND') courant.fin = dateIcal(valeur);
        else if (nom === 'UID') courant.uid = valeur.trim();
        else if (nom === 'SUMMARY') courant.resume = desechapper(valeur).trim();
        else if (nom === 'DESCRIPTION') courant.description = desechapper(valeur);
    });

    return sejours;
}

// ------------------------------------------------------------
// 4. Qui écrit — la plateforme le dit
// ------------------------------------------------------------
// Dans un groupe partagé, le message doit dire s'il est pour vous ou
// pour l'autre. Sans ça on retombe sur « je pensais que tu t'en
// occupais », qui a déjà coûté un message d'accueil.
//
// La répartition suit le canal de réservation : Airbnb est géré par
// Alisson, Booking par Cyril, et le direct passe par WhatsApp — donc
// Cyril aussi.
var RESPONSABLE = {
    airbnb: 'Alisson',
    booking: 'Cyril',
    direct: 'Cyril',
    inconnu: 'à voir'
};

function responsableDe(plateforme) {
    return RESPONSABLE[plateforme] || RESPONSABLE.inconnu;
}

// ------------------------------------------------------------
// 5. Les six rappels, et pourquoi ceux-là
// ------------------------------------------------------------
// ⚠ CETTE TABLE A REMPLACÉ UNE RÉPÉTITION PAR UNE SÉQUENCE.
//
// La première version disait trois fois la même chose — « envoyer le
// message d'arrivée » — sans jamais préciser lequel. Une répétition, on
// finit par l'ignorer ; une séquence d'actions distinctes, on la suit.
//
// Chaque ligne porte une action réelle, à son moment utile :
//
//   `veille: true`  → la veille de l'événement
//   `veille: false` → le jour même
//   `heure`         → l'heure d'ouverture de sa fenêtre
//
// LES HEURES VIENNENT DE L'USAGE, pas d'une symétrie. 07:30 et 20:00
// avaient été choisis pour le rythme des tâches personnelles : trop tôt
// pour agir le matin, trop tard le soir. Midi et 18 h sont des moments
// où l'on a son téléphone et une main libre — c'est ce qui compte, parce
// que le bon moment n'est pas celui où l'on peut LIRE mais celui où l'on
// peut AGIR.
//
// ⚠ ASYMÉTRIE ARRIVÉE / DÉPART. Les voyageurs arrivent en fin
// d'après-midi mais partent le matin. Un rappel de départ le jour même
// n'existe donc qu'en information (11 h, « le logement est libre ») :
// une action à cette heure-là arriverait après leur voiture.
var RAPPELS_GITE = [
    { cle: 'heure-arrivee', sur: 'arrivee', veille: true, heure: '12:00',
      action: 'demander à quelle heure ils pensent arriver' },

    { cle: 'procedure-arrivee', sur: 'arrivee', veille: true, heure: '18:00',
      action: 'envoyer la procédure d\'arrivée' },

    { cle: 'code-boite', sur: 'arrivee', veille: false, heure: '12:00',
      action: 'envoyer le code de la boîte à clés, si besoin' },

    // Une info, pas une action : elle dit que la maison va être occupée.
    { cle: 'arrivee-ce-soir', sur: 'arrivee', veille: false, heure: '17:00',
      info: 'Arrivée ce soir' },

    { cle: 'procedure-depart', sur: 'depart', veille: true, heure: '18:00',
      action: 'envoyer la procédure de départ' },

    // Celle-ci est opérationnelle : le ménage peut commencer.
    { cle: 'depart-libre', sur: 'depart', veille: false, heure: '11:00',
      info: 'Départ ce matin', suite: 'Le logement est libre.' }
];

// Une heure d'ouverture, puis une heure pleine de rattrapage. Le cron
// passe toutes les 5 minutes : douze occasions suffisent largement, et
// la borne haute est EXCLUE pour que deux fenêtres consécutives — 17 h
// et 18 h — ne se recouvrent jamais.
var FENETRE_RAPPEL_MINUTES = 60;

// L'heure d'ouverture de la fenêtre en cours, ou '' hors de toute
// fenêtre. Le Worker s'en sert AVANT de lire le calendrier : la plupart
// des tours n'ont rien à faire du gîte.
function fenetreGite(heureCourante) {
    var maintenant = calcul.minutesDeHeure(heureCourante);
    if (maintenant === null) return '';

    for (var i = 0; i < RAPPELS_GITE.length; i++) {
        var ouverture = calcul.minutesDeHeure(RAPPELS_GITE[i].heure);
        if (maintenant >= ouverture && maintenant < ouverture + FENETRE_RAPPEL_MINUTES) {
            return RAPPELS_GITE[i].heure;
        }
    }
    return '';
}

// ⚠ LA CLÉ PORTE LA FENÊTRE ET LE JOUR, PAS LE SÉJOUR.
//
// C'est délibéré : elle doit être calculable SANS avoir lu le
// calendrier, pour que le Worker puisse interroger sa mémoire avant de
// décider s'il vaut la peine d'aller le chercher. Un même rappel ne
// pouvant tomber qu'une fois par jour, ça suffit à ne rien envoyer deux
// fois.
function cleGite(ajd, fenetre) {
    return 'gite:' + fenetre + ':' + ajd;
}

// Ce qui est dû maintenant : [{ rappel, sejour }].
//
// Plusieurs rappels peuvent tomber dans la même fenêtre — typiquement à
// 18 h, la procédure de départ d'un séjour et celle d'arrivée du
// suivant, quand les deux s'enchaînent. Ils partent alors dans un seul
// message, chacun dans son bloc.
function rappelsDus(sejours, ajd, heureCourante) {
    var fenetre = fenetreGite(heureCourante);
    if (!fenetre) return [];

    var demain = calcul.ajouterJours(ajd, 1);
    var dus = [];

    RAPPELS_GITE.forEach(function(rappel) {
        if (rappel.heure !== fenetre) return;
        var jourVise = rappel.veille ? demain : ajd;
        var champ = (rappel.sur === 'arrivee') ? 'debut' : 'fin';

        (sejours || []).forEach(function(sejour) {
            if (sejour[champ] === jourVise) dus.push({ rappel: rappel, sejour: sejour });
        });
    });

    // Les actions avant les informations : ce qui demande un geste passe
    // devant ce qui ne demande que d'être lu.
    return dus.sort(function(a, b) {
        var ordre = function(x) { return x.rappel.action ? 0 : 1; };
        return ordre(a) - ordre(b);
    });
}

// ------------------------------------------------------------
// 5. Les détails de l'état ménage
// ------------------------------------------------------------
// L'endpoint d'état porte, sous `info_<date d'arrivée>`, le nombre de
// personnes et la LANGUE. Les deux comptent pour écrire le message :
// on n'accueille pas trois Allemands comme un couple de Français.
//
// Absent : on n'invente rien, la ligne de détail disparaît simplement.
function detailsArrivee(etat, dateArrivee) {
    var info = etat && etat['info_' + dateArrivee];
    if (!info) return null;
    return {
        personnes: Number(info.nbPersons) || 0,
        langue: String(info.lang || '').toLowerCase(),
        // ⚠ `voyageurs` et `comment` ne servent PAS au même public. Le
        // commentaire s'adresse aux personnes qui font le ménage
        // (« mettre le livret en allemand en premier ») et s'affiche
        // pour tout le monde ; `voyageurs` est le prénom des occupants,
        // saisi dans la vue admin de la page ménage et réservé aux
        // notifications. Les mélanger ferait passer un prénom dans les
        // consignes de ménage, et une consigne dans un message d'accueil.
        //
        // Nommé `voyageurs` et non `qui` : sur la page ménage, « Qui ? »
        // désigne déjà la personne qui a fait le ménage.
        voyageurs: String(info.voyageurs || '').trim(),
        commentaire: String(info.comment || '').trim()
    };
}

var LANGUES = { fr: 'en français', de: 'en allemand', en: 'en anglais',
                es: 'en espagnol', it: 'en italien', nl: 'en néerlandais',
                pt: 'en portugais' };

function libelleLangue(code) {
    return LANGUES[code] || '';
}

module.exports = {
    deplier: deplier,
    desechapper: desechapper,
    dateIcal: dateIcal,
    plateformeDe: plateformeDe,
    libellePlateforme: libellePlateforme,
    lienDeReservation: lienDeReservation,
    estArtefactDeCalendrier: estArtefactDeCalendrier,
    analyserIcal: analyserIcal,
    RAPPELS_GITE: RAPPELS_GITE,
    FENETRE_RAPPEL_MINUTES: FENETRE_RAPPEL_MINUTES,
    responsableDe: responsableDe,
    fenetreGite: fenetreGite,
    cleGite: cleGite,
    rappelsDus: rappelsDus,
    detailsArrivee: detailsArrivee,
    libelleLangue: libelleLangue
};
