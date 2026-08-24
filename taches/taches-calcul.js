// ============================================================
// taches-calcul.js — Le cœur de la priorisation, sans écran
// ============================================================
// Uniquement des fonctions pures : des dates, un booléen, un classement.
// Aucun DOM, aucun Firestore, aucun effet de bord — et c'est ce qui
// permet de le charger AUSSI sur la page d'accueil, qui n'a besoin que
// de compter les retards pour poser son compteur sur la tuile.
//
// Sans ce fichier, l'accueil recopierait la règle « en retard » et les
// deux définitions divergeraient un jour, en silence : la tuile
// annoncerait deux retards et la page en montrerait trois.
//
// ------------------------------------------------------------
// POURQUOI UN SEUL BOOLÉEN SAISI À LA MAIN, ET PAS DEUX
// ------------------------------------------------------------
// La matrice d'Eisenhower a deux axes, mais ils ne vieillissent pas de
// la même façon. L'importance d'une tâche ne bouge pas toute seule ;
// son urgence, si — c'est la définition même du mot. Un « urgent = oui »
// coché il y a trois semaines a exactement le défaut qu'on reproche au
// calendrier : l'information se périme sans que rien ne bouge, et un
// « urgent = non » sur une tâche due demain est simplement faux.
//
// L'urgence est donc RECALCULÉE à chaque affichage à partir de
// l'échéance : une tâche traverse la frontière toute seule en
// vieillissant, sans entretien. `urgentForce` ne couvre que le cas que
// le calcul ne peut pas voir — l'urgence sans date (« rappeler le
// plombier avant qu'il ne parte »).
//
// ------------------------------------------------------------
// UNE SEULE DATE, ET POURQUOI ON EST REVENU EN ARRIÈRE
// ------------------------------------------------------------
// Ce projet a d'abord séparé deux dates : `echeance` (avant quand ça
// doit être fait) et `creneauJour` + `creneauHeure` (quand je m'y
// colle). L'argument était solide sur le papier — les confondre est la
// maladie de Google Calendar, où une contrainte devient un rendez-vous
// et passe sans rien dire.
//
// ⚠ L'USAGE A TRANCHÉ CONTRE. Sur 38 tâches réelles au 24 août 2026 :
//   - 26 portaient les deux dates, dont 20 LA MÊME (77 %) ;
//   - 0 tâche n'a JAMAIS eu un créneau sans échéance ;
//   - 6 seulement différaient, dont 3 encore ouvertes.
//
// Autrement dit : le formulaire demandait deux dates, et on répondait
// deux fois la même. La distinction était juste en théorie et vide en
// pratique — pire, elle donnait l'impression d'un doublon à chaque
// saisie, ce qui est exactement ce qu'elle était devenue.
//
// Il reste donc UNE date, avec une HEURE FACULTATIVE :
//   echeance       'AAAA-MM-JJ'  quand c'est dû, ou quand je le fais
//   echeanceHeure  'HH:MM' ou '' l'heure, si on en a décidé une
//   echeanceDuree  minutes       pour la grille de semaine
//
// CE QU'ON A PERDU, et qu'il faut assumer plutôt que redécouvrir :
//   - « dû vendredi, je le fais mardi » n'est plus exprimable ;
//   - les signaux « planifié après l'échéance » et « urgent sans
//     créneau » n'ont plus d'objet et ont été supprimés.
//
// CE QU'ON A GAGNÉ, et qui n'était pas prévu : le classement se répare
// tout seul. Avant, une tâche qu'on faisait dans deux heures tombait
// dans « Le reste », parce que le créneau ne pesait rien sur la
// priorité — seule l'échéance comptait. Maintenant sa date EST son
// échéance : elle est urgente, et elle remonte.
//
// ⚠ NE PAS REFAIRE LA SÉPARATION sans nouvelles données d'usage. Elle a
// été essayée, mesurée, et retirée pour cette raison-là.
//
// ------------------------------------------------------------
// POURQUOI UNE CHAÎNE 'AAAA-MM-JJ' ET PAS UN TIMESTAMP FIRESTORE
// ------------------------------------------------------------
// « En retard » est une question de JOUR DU CALENDRIER, pas d'instant.
// Un Timestamp posé à minuit heure de Paris se relit la veille au soir
// sous un autre fuseau, et la tâche bascule ou non selon l'endroit d'où
// on regarde. Une chaîne, elle, se compare telle quelle — l'ordre
// lexicographique de ce format EST l'ordre chronologique —, se pose
// dans un <input type="date"> sans conversion, et rend les tests
// déterministes.
//
// C'est le seul endroit du hub qui s'écarte du Timestamp, et l'écart
// est délibéré : ailleurs on horodate un événement qui a eu lieu, ici
// on vise un jour à venir. `createdAt` et `updatedAt` restent, eux, de
// vrais Timestamps serveur.
// ============================================================

// Le seuil d'urgence. Sept jours = « cette semaine », l'horizon auquel
// on planifie vraiment. Le changer ne déplace que la frontière entre
// les deux blocs du milieu.
var JOURS_URGENCE = 7;

// Au-delà de ce nombre de reports, une tâche n'est plus en retard :
// elle est enlisée. Personne n'écrit jamais ce constat tout seul, d'où
// le compteur — c'est lui qui autorise enfin à abandonner.
var REPORTS_ENLISEMENT = 3;

// L'ordre de cette liste EST l'ordre de la page. Le retard passe devant
// tout, y compris devant une urgence du jour : c'est le seul moyen qu'un
// oubli ne se reperde pas dans le flux.
var BLOCS = [
    {
        cle: 'retard',
        titre: 'En retard',
        icone: 'fa-solid fa-triangle-exclamation',
        aide: 'Ce qui aurait dû être fait.'
    },
    {
        cle: 'urgent',
        titre: 'Urgent',
        icone: 'fa-solid fa-fire',
        aide: 'Échéance dans les ' + JOURS_URGENCE + ' jours.'
    },
    {
        cle: 'important',
        titre: 'Important, non urgent',
        icone: 'fa-solid fa-chess',
        aide: 'Ce qui compte et qu\'on a encore le temps de bien faire.'
    },
    {
        cle: 'reste',
        titre: 'Le reste',
        icone: 'fa-solid fa-inbox',
        aide: 'Ni important, ni pressé.'
    }
];

// ------------------------------------------------------------
// 1. Le calendrier
// ------------------------------------------------------------
// Tout passe par des chaînes 'AAAA-MM-JJ'. Les seules conversions vers
// un objet Date se font en UTC : Date.UTC ignore l'heure d'été, alors
// qu'une soustraction de dates locales rend 23 ou 25 heures deux fois
// par an — et fait basculer un « en retard de 1 j » en « 0 j ».

function isoDuJour(date) {
    if (!date || isNaN(date.getTime())) return '';
    var mois = String(date.getMonth() + 1);
    var jour = String(date.getDate());
    if (mois.length < 2) mois = '0' + mois;
    if (jour.length < 2) jour = '0' + jour;
    return date.getFullYear() + '-' + mois + '-' + jour;
}

function aujourdhui() {
    return isoDuJour(new Date());
}

function isoValide(iso) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''));
}

function isoVersUTC(iso) {
    if (!isoValide(iso)) return null;
    var bouts = String(iso).split('-');
    var ms = Date.UTC(Number(bouts[0]), Number(bouts[1]) - 1, Number(bouts[2]));
    return isNaN(ms) ? null : ms;
}

// Positif si `isoFin` est après `isoDebut`. null si l'une des deux
// n'est pas une date : au rendu, une absence doit se voir comme une
// absence, jamais comme un zéro.
function joursEntre(isoDebut, isoFin) {
    var a = isoVersUTC(isoDebut);
    var b = isoVersUTC(isoFin);
    if (a === null || b === null) return null;
    return Math.round((b - a) / 86400000);
}

function ajouterJours(iso, nombre) {
    var ms = isoVersUTC(iso);
    if (ms === null) return '';
    var date = new Date(ms + nombre * 86400000);
    // Relu en UTC, puisque c'est en UTC qu'on l'a construit.
    var mois = String(date.getUTCMonth() + 1);
    var jour = String(date.getUTCDate());
    if (mois.length < 2) mois = '0' + mois;
    if (jour.length < 2) jour = '0' + jour;
    return date.getUTCFullYear() + '-' + mois + '-' + jour;
}

// ------------------------------------------------------------
// 2. Les deux axes
// ------------------------------------------------------------
function estEnRetard(tache, ajd) {
    if (!tache || tache.faite) return false;
    if (!isoValide(tache.echeance)) return false;
    // Le jour même n'est PAS un retard : on a jusqu'à ce soir.
    return tache.echeance < ajd;
}

function joursDeRetard(tache, ajd) {
    if (!estEnRetard(tache, ajd)) return 0;
    return joursEntre(tache.echeance, ajd) || 0;
}

function estUrgente(tache, ajd) {
    if (!tache || tache.faite) return false;
    // Le forçage ne sert qu'à l'urgence sans date. Il est volontairement
    // le SEUL morceau d'urgence saisi à la main.
    if (tache.urgentForce) return true;
    var jours = joursEntre(ajd, tache.echeance);
    if (jours === null) return false;
    // Un retard est traité par son propre bloc : `estUrgente` ne
    // regarde que devant, sinon une tâche appartiendrait aux deux.
    return jours >= 0 && jours <= JOURS_URGENCE;
}

function estEnlisee(tache) {
    return !!tache && !tache.faite && (tache.nbReports || 0) >= REPORTS_ENLISEMENT;
}

// ------------------------------------------------------------
// 3. Le classement
// ------------------------------------------------------------
function blocDe(tache, ajd) {
    if (!tache) return 'reste';
    if (tache.faite) return 'faites';
    if (estEnRetard(tache, ajd)) return 'retard';
    if (estUrgente(tache, ajd)) return 'urgent';
    if (tache.important) return 'important';
    return 'reste';
}

function comparerDansBloc(a, b) {
    // L'important d'abord, DANS TOUS LES BLOCS — y compris parmi les
    // retards. Trier le tas du retour de vacances par ancienneté, ce
    // serait se condamner à voir toujours la même croûte en tête
    // pendant que l'important pourrit trois écrans plus bas.
    if (!!a.important !== !!b.important) return a.important ? -1 : 1;

    // Puis l'échéance la plus proche — donc, parmi les retards, la plus
    // dépassée. Les tâches sans date passent en dernier : ne pas avoir
    // été datée est déjà une façon de dire qu'elle n'est pas pressante.
    var ea = isoValide(a.echeance) ? a.echeance : '￿';
    var eb = isoValide(b.echeance) ? b.echeance : '￿';
    if (ea !== eb) return ea < eb ? -1 : 1;

    // Puis l'HEURE, quand il y en a une. Deux tâches du même jour, l'une
    // à 12 h 45 et l'autre à 19 h, doivent se lire dans cet ordre-là.
    // Sans cette comparaison elles retombaient sur leur date de création,
    // c'est-à-dire sur rien.
    //
    // Sans heure en dernier, pour la même raison qu'une tâche sans date :
    // n'avoir pas décidé d'un moment n'est pas un rang.
    var ha = heureValide(a.echeanceHeure) ? a.echeanceHeure : '￿';
    var hb = heureValide(b.echeanceHeure) ? b.echeanceHeure : '￿';
    if (ha !== hb) return ha < hb ? -1 : 1;

    // À égalité stricte, la plus ancienne : elle attend depuis plus
    // longtemps.
    var ca = toDate(a.createdAt);
    var cb = toDate(b.createdAt);
    return (ca ? ca.getTime() : 0) - (cb ? cb.getTime() : 0);
}

// Range une liste de tâches par bloc, chaque bloc déjà trié. Rend un
// objet { retard: [...], urgent: [...], important: [...], reste: [...],
// faites: [...] } — toujours les cinq clés, même vides, pour que
// l'appelant n'ait pas à s'en méfier.
function rangerParBloc(taches, ajd) {
    var rangement = { retard: [], urgent: [], important: [], reste: [], faites: [] };

    (taches || []).forEach(function(tache) {
        rangement[blocDe(tache, ajd)].push(tache);
    });

    ['retard', 'urgent', 'important', 'reste'].forEach(function(cle) {
        rangement[cle].sort(comparerDansBloc);
    });

    // Les tâches faites se lisent à l'envers : la dernière réglée en
    // tête, c'est ce qu'on vient de faire qu'on veut revoir.
    rangement.faites.sort(function(a, b) {
        var fa = isoValide(a.faiteLe) ? a.faiteLe : '';
        var fb = isoValide(b.faiteLe) ? b.faiteLe : '';
        if (fa !== fb) return fa < fb ? 1 : -1;
        return 0;
    });

    return rangement;
}

function compterEnRetard(taches, ajd) {
    return (taches || []).filter(function(tache) {
        return estEnRetard(tache, ajd);
    }).length;
}

// ------------------------------------------------------------
// 4. L'heure de l'échéance — facultative
// ------------------------------------------------------------
// Même parti pris que pour la date : une chaîne locale 'HH:MM', pas un
// instant. On dit « mardi 14 h », pas « mardi 12 h UTC », et personne ne
// veut voir son planning se décaler en changeant de fuseau.
//
// Une tâche sans heure reste une tâche parfaitement valable : elle est
// due ce jour-là, sans moment précis. C'est même le cas le plus courant.

// La plage affichée par défaut. Elle s'étend d'elle-même si un créneau
// tombe en dehors : une tâche planifiee a 6 h ne doit pas devenir
// invisible parce que la grille commence a 7 h.
var HEURE_DEBUT_GRILLE = 7;
var HEURE_FIN_GRILLE = 22;

// Durées proposées, en minutes. Une liste fermée plutôt qu'une saisie
// libre : personne ne planifie 37 minutes, et un champ libre invite à
// une précision qu'on n'a pas.
var DUREE_DEFAUT = 60;
var DUREES = [15, 30, 45, 60, 90, 120, 240, 480];

// Les seules minutes proposées à la saisie. Un `<input type="time">`
// laissait entrer n'importe quelle minute et ouvrait, selon le
// navigateur, la liste des soixante — imprenable au doigt pour un gain
// nul : on ne planifie pas à 14 h 37.
var MINUTES_CRENEAU = ['00', '15', '30', '45'];


function heureValide(hhmm) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(hhmm || ''));
}

function minutesDeHeure(hhmm) {
    if (!heureValide(hhmm)) return null;
    var bouts = String(hhmm).split(':');
    return Number(bouts[0]) * 60 + Number(bouts[1]);
}

function heureDeMinutes(minutes) {
    if (typeof minutes !== 'number' || isNaN(minutes)) return '';
    // Borné à la journée : un créneau ne franchit jamais minuit ici.
    // Le faire déborder demanderait de le couper en deux dans la grille,
    // pour un cas qui ne se présente pas quand on planifie sa journée.
    var borne = Math.max(0, Math.min(1439, Math.round(minutes)));
    var h = String(Math.floor(borne / 60));
    var m = String(borne % 60);
    if (h.length < 2) h = '0' + h;
    if (m.length < 2) m = '0' + m;
    return h + ':' + m;
}

function aUneHeure(tache) {
    return !!tache && isoValide(tache.echeance) && heureValide(tache.echeanceHeure);
}

function dureeEcheance(tache) {
    var duree = tache && Number(tache.echeanceDuree);
    return (duree && duree > 0) ? duree : DUREE_DEFAUT;
}

// Début et fin en minutes depuis minuit. null si la tâche n'a pas
// d'heure — une absence doit se voir comme une absence.
function bornesHeure(tache) {
    if (!aUneHeure(tache)) return null;
    var debut = minutesDeHeure(tache.echeanceHeure);
    return { debut: debut, fin: Math.min(1440, debut + dureeEcheance(tache)) };
}

// ------------------------------------------------------------
// 5. L'heure passée
// ------------------------------------------------------------
// Seul survivant des trois signaux que la séparation échéance/créneau
// permettait. Les deux autres — « planifié après l'échéance » et
// « urgent sans créneau » — n'ont plus d'objet : il n'y a plus qu'une
// date, elle ne peut pas être en retard sur elle-même.
//
// ⚠ CE N'EST PAS UN RETARD. La tâche est due AUJOURD'HUI : l'heure
// qu'on s'était fixée est passée, mais la journée n'est pas finie. Les
// confondre reviendrait à crier au loup un jour trop tôt.
function heureDepassee(tache, ajd, heureCourante) {
    if (!tache || tache.faite || !aUneHeure(tache)) return false;
    if (tache.echeance !== ajd) return false;

    var bornes = bornesHeure(tache);
    var maintenant = minutesDeHeure(heureCourante);
    // Sans heure courante exploitable, on ne déclare rien : mieux vaut
    // taire un signal que d'en inventer un.
    if (maintenant === null) return false;
    return maintenant > bornes.fin;
}

// ------------------------------------------------------------
// 6. La semaine
// ------------------------------------------------------------
// Semaine ISO : elle commence le lundi. `getUTCDay()` rend 0 pour
// dimanche, d'où le décalage — sans lui, la semaine du dimanche
// commencerait le lendemain.
function lundiDeLaSemaine(iso) {
    var ms = isoVersUTC(iso);
    if (ms === null) return '';
    var jour = new Date(ms).getUTCDay();
    return ajouterJours(iso, -((jour + 6) % 7));
}

function joursDeLaSemaine(isoLundi) {
    var jours = [];
    for (var i = 0; i < 7; i++) jours.push(ajouterJours(isoLundi, i));
    return jours;
}

// Les tâches de ce jour-là QUI ONT UNE HEURE : elles seules peuvent se
// placer dans la grille horaire.
function avecHeureLeJour(taches, iso) {
    return (taches || []).filter(function(tache) {
        return aUneHeure(tache) && tache.echeance === iso;
    });
}

// Celles du même jour SANS heure : elles s'affichent en bandeau
// au-dessus des heures. Les poser dans la grille leur inventerait un
// horaire qu'on n'a pas choisi.
function sansHeureLeJour(taches, iso) {
    return (taches || []).filter(function(tache) {
        return !tache.faite && !aUneHeure(tache) && tache.echeance === iso;
    });
}

// ------------------------------------------------------------
// 7. Les voies parallèles
// ------------------------------------------------------------
// Deux tâches dont les heures se chevauchent doivent rester toutes deux
// lisibles : empilées, la seconde cacherait la première et on poserait
// par-dessus sans le voir.
//
// Les voies se comptent par GRAPPE de chevauchements, pas par journée.
// Sinon un doublon à 9 h réduirait de moitié la largeur de tout le
// reste de la journée, qui n'y est pour rien.
//
// Rend [{ tache, debut, fin, voie, nbVoies }], en minutes.
function repartirEnVoies(creneaux) {
    var elements = (creneaux || []).map(function(tache) {
        var bornes = bornesHeure(tache);
        return { tache: tache, debut: bornes.debut, fin: bornes.fin, voie: 0, nbVoies: 1 };
    }).sort(function(a, b) {
        if (a.debut !== b.debut) return a.debut - b.debut;
        return a.fin - b.fin;
    });

    var grappes = [];
    var courante = [];
    var finMax = -1;
    elements.forEach(function(element) {
        if (courante.length && element.debut >= finMax) {
            grappes.push(courante);
            courante = [];
            finMax = -1;
        }
        courante.push(element);
        if (element.fin > finMax) finMax = element.fin;
    });
    if (courante.length) grappes.push(courante);

    grappes.forEach(function(grappe) {
        var finsDeVoie = [];
        grappe.forEach(function(element) {
            var voie = 0;
            while (voie < finsDeVoie.length && finsDeVoie[voie] > element.debut) voie++;
            element.voie = voie;
            finsDeVoie[voie] = element.fin;
        });
        grappe.forEach(function(element) { element.nbVoies = finsDeVoie.length; });
    });

    return elements;
}

// La plage d'heures à afficher : les constantes, élargies à ce que la
// semaine contient réellement. Arrondie à l'heure pleine des deux côtés,
// pour que la colonne de gauche n'affiche pas « 06:40 ».
function plageHoraire(taches) {
    var debut = HEURE_DEBUT_GRILLE * 60;
    var fin = HEURE_FIN_GRILLE * 60;

    (taches || []).forEach(function(tache) {
        var bornes = bornesHeure(tache);
        if (!bornes) return;
        if (bornes.debut < debut) debut = bornes.debut;
        if (bornes.fin > fin) fin = bornes.fin;
    });

    return {
        debut: Math.floor(debut / 60) * 60,
        fin: Math.min(1440, Math.ceil(fin / 60) * 60)
    };
}

// ------------------------------------------------------------
// 8. Le report
// ------------------------------------------------------------
// LE COMPTEUR NE VAUT QUE S'IL NE MENT PAS. Un report, c'est repousser
// une date qui existait déjà. Dater une tâche qui n'en avait pas, ou
// corriger une saisie vers l'arrière, n'en est pas un — sinon le
// compteur gonfle tout seul et on cesse de le croire, ce qui tue
// exactement le signal qu'on cherchait à construire.
//
// Rendu : { echeance, nbReports, echeanceInitiale? } prêt à écrire.
function champsDeReport(tache, nouvelleEcheance) {
    var ancienne = (tache && isoValide(tache.echeance)) ? tache.echeance : '';
    var champs = { echeance: isoValide(nouvelleEcheance) ? nouvelleEcheance : '' };

    var reporte = !!ancienne && !!champs.echeance && champs.echeance > ancienne;
    champs.nbReports = (tache && tache.nbReports) || 0;
    if (reporte) champs.nbReports++;

    // La toute première date visée, gardée une seule fois : c'est elle
    // qui donne la mesure de la dérive, « visée le 3 mars, encore là ».
    if (reporte && !(tache && tache.echeanceInitiale)) {
        champs.echeanceInitiale = ancienne;
    }
    return champs;
}

// ------------------------------------------------------------
// 9. Un seul fichier, deux mondes
// ------------------------------------------------------------
// Ce fichier est chargé de deux façons :
//   - par une balise <script> dans le navigateur — la page des tâches,
//     et l'accueil pour son compteur de retards — où tout ce qui précède
//     est déjà global ;
//   - par le bundler du notifieur Cloudflare (dossier notifieur/), qui a
//     besoin d'un export explicite.
//
// Le garde `typeof module` fait que le navigateur ignore ce bloc, et le
// contexte `vm` des tests aussi. C'est la seule façon de servir les deux
// sans étape de build côté site — contrainte que ce projet n'a jamais eue
// et ne prendra pas pour un envoi de messages.
//
// POURQUOI PARTAGER PLUTÔT QUE RECOPIER : le notifieur doit dire « en
// retard » et « ça commence bientôt » exactement comme la page. Deux
// définitions auraient fini par diverger, et cette divergence-là serait
// muette — un message qui ne part pas ne se remarque pas. C'est le même
// argument qui a mis ce fichier à part pour le compteur d'accueil.
//
// ⚠ `comparerDansBloc` et `rangerParBloc` NE SONT PAS exportés. Ils
// dépendent de `toDate()`, qui vit dans hub-utils.js et n'existe pas dans
// le Worker : les appeler là-bas planterait à 7 h 30 du matin, sans
// personne pour le voir. Un test gèle cette liste.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        // Constantes
        JOURS_URGENCE: JOURS_URGENCE,
        REPORTS_ENLISEMENT: REPORTS_ENLISEMENT,
        DUREE_DEFAUT: DUREE_DEFAUT,
        // Calendrier
        isoValide: isoValide,
        joursEntre: joursEntre,
        ajouterJours: ajouterJours,
        // Heures
        heureValide: heureValide,
        minutesDeHeure: minutesDeHeure,
        heureDeMinutes: heureDeMinutes,
        // Les deux axes
        estEnRetard: estEnRetard,
        joursDeRetard: joursDeRetard,
        estUrgente: estUrgente,
        estEnlisee: estEnlisee,
        blocDe: blocDe,
        compterEnRetard: compterEnRetard,
        // L'heure facultative
        aUneHeure: aUneHeure,
        dureeEcheance: dureeEcheance,
        bornesHeure: bornesHeure,
        avecHeureLeJour: avecHeureLeJour,
        sansHeureLeJour: sansHeureLeJour,
        heureDepassee: heureDepassee
    };
}
