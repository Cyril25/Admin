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
// 4. Le report
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
