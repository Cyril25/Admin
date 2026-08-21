// ============================================================
// notifieur-messages.js — Quoi envoyer, et quand
// ============================================================
// Fonctions pures : on donne des tâches, un jour, une heure, et on
// obtient la liste des messages à envoyer. Aucun réseau, aucun secret,
// aucune horloge — tout entre par les paramètres.
//
// C'est délibéré, et c'est ce qui rend ce fichier testable : un
// notifieur se juge sur ce qu'il envoie ET sur ce qu'il n'envoie pas, et
// aucune des deux ne se vérifie à l'œil. Un message qui ne part pas ne
// se remarque pas — c'est la panne silencieuse par excellence, celle
// contre laquelle ce projet tout entier a été écrit.
//
// La glu — s'authentifier, lire Firestore, appeler Telegram — vit dans
// worker.js, qui n'a aucune décision à prendre.
//
// ⚠ AUCUNE HORLOGE ICI. `ajd` et `heure` sont fournis par le Worker, qui
// les calcule à l'heure de PARIS. Un Worker Cloudflare tourne en UTC :
// `new Date()` y donnerait la mauvaise journée tous les soirs entre 22 h
// et minuit, et le digest du matin partirait un jour trop tôt.
// ============================================================

var calcul = require('../taches/taches-calcul.js');

// ------------------------------------------------------------
// 1. Réglages
// ------------------------------------------------------------

// Combien de temps avant un créneau on prévient. Le cron tourne toutes
// les 5 minutes : 15 laisse trois occasions de tomber dans la fenêtre,
// donc un tick manqué ne fait pas manquer le rappel.
var MINUTES_AVANT_CRENEAU = 15;

// L'heure du digest, à Paris.
var HEURE_DIGEST = '07:30';

// Passé cette fenêtre, ce n'est plus le matin. Sans elle, un Worker
// déployé — ou réparé — à 23 h enverrait aussitôt le digest du jour,
// pour rien.
var FENETRE_DIGEST_MINUTES = 4 * 60;

// Envoyer le digest MÊME quand il n'y a rien.
//
// Une ligne de plus par jour, contre une ambiguïté en moins : sans ça,
// le silence voudrait dire à la fois « rien à faire » et « le notifieur
// est cassé », et on ne saurait jamais lequel des deux. Tout ce projet
// existe parce que les choses disparaissent sans bruit ; son notifieur
// ne va pas se mettre à faire pareil.
//
// Se met à false en une ligne si la ligne quotidienne agace.
var DIGEST_MEME_SI_VIDE = true;

// ------------------------------------------------------------
// 2. Le temps, en minutes signées
// ------------------------------------------------------------
// Un créneau peut tomber demain : ses minutes depuis minuit ne suffisent
// pas à le comparer à maintenant. On compte donc les minutes depuis
// minuit AUJOURD'HUI, ce qui donne 1445 pour demain 00:05 et un nombre
// négatif pour hier.
//
// Sans ça, un créneau à 00:05 n'aurait jamais son rappel de 15 minutes —
// il faudrait le poser à 23:50 la veille, c'est-à-dire à une minute
// négative dans le repère de la journée.
function minutesDepuisAujourdhui(ajd, jour, heure) {
    var jours = calcul.joursEntre(ajd, jour);
    var minutes = calcul.minutesDeHeure(heure);
    if (jours === null || minutes === null) return null;
    return jours * 1440 + minutes;
}

function debutCreneau(tache, ajd) {
    if (!calcul.aUnCreneau(tache)) return null;
    return minutesDepuisAujourdhui(ajd, tache.creneauJour, tache.creneauHeure);
}

// ------------------------------------------------------------
// 3. Échappement Telegram
// ------------------------------------------------------------
// Les messages partent en parse_mode HTML. Un titre contenant « < » ou
// « & » ferait rejeter l'envoi par l'API — donc un rappel perdu, en
// silence, sur la tâche la plus mal nommée.
function echapper(texte) {
    return String(texte == null ? '' : texte)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function titreDe(tache) {
    return echapper(tache.titre || '(sans titre)');
}

function libelleDuree(minutes) {
    if (minutes < 60) return minutes + ' min';
    var heures = Math.floor(minutes / 60);
    var reste = minutes % 60;
    return heures + ' h' + (reste ? String(reste) : '');
}

// ------------------------------------------------------------
// 4. Rappel avant un créneau
// ------------------------------------------------------------
// La clé porte le créneau lui-même, pas seulement la tâche : replanifier
// doit redonner droit à un rappel. Sans le jour et l'heure dedans, une
// tâche déplacée de mardi à jeudi resterait marquée « déjà prévenu » et
// passerait sous silence.
function cleRappel(tache) {
    return 'creneau:' + tache.id + ':' + tache.creneauJour + 'T' + tache.creneauHeure;
}

function rappelsCreneaux(taches, ajd, heure) {
    var maintenant = calcul.minutesDeHeure(heure);
    if (maintenant === null) return [];

    return (taches || []).filter(function(tache) {
        if (tache.faite || !calcul.aUnCreneau(tache)) return false;
        var debut = debutCreneau(tache, ajd);
        if (debut === null) return false;
        // Fenêtre fermée à droite : passé l'heure de début, ce n'est plus
        // un rappel mais un constat, et « dans -3 min » ne veut rien dire.
        return (debut - MINUTES_AVANT_CRENEAU) <= maintenant && maintenant < debut;
    }).map(function(tache) {
        return { cle: cleRappel(tache), texte: texteRappel(tache, ajd, heure) };
    });
}

function texteRappel(tache, ajd, heure) {
    var debut = debutCreneau(tache, ajd);
    var dans = debut - calcul.minutesDeHeure(heure);
    var bornes = calcul.bornesCreneau(tache);

    var lignes = [];
    lignes.push('⏰ <b>Dans ' + dans + ' min</b> — ' + titreDe(tache));
    lignes.push(calcul.heureDeMinutes(bornes.debut) + ' – ' + calcul.heureDeMinutes(bornes.fin)
        + ' · ' + libelleDuree(calcul.dureeCreneau(tache)));

    if (tache.projet) lignes.push('📁 ' + echapper(tache.projet));
    if (tache.detail) {
        lignes.push('');
        lignes.push(echapper(tache.detail));
    }

    // Le créneau posé après l'échéance : c'est le moment de le dire, pas
    // à la relecture du planning trois semaines plus tard.
    if (calcul.planifieApresEcheance(tache)) {
        lignes.push('⚠️ Ce créneau est APRÈS l\'échéance du ' + echapper(tache.echeance) + '.');
    }
    return lignes.join('\n');
}

// ------------------------------------------------------------
// 5. Le digest du matin
// ------------------------------------------------------------
// Une seule fois par jour, d'où la clé datée. C'est le message qui
// répond au problème d'origine : l'accumulation qu'on ne voit plus.
function cleDigest(ajd) {
    return 'digest:' + ajd;
}

// Sortie a part, parce que le Worker s'en sert AVANT de lire Firestore :
// hors de cette fenetre, il sait qu'il n'aura pas besoin de la liste
// complete et se contente des creneaux du jour. Une lecture de moins,
// 287 fois par jour.
//
// Avant l'heure, ce n'est pas l'heure. Après la fenêtre, ce n'est plus
// le matin — mieux vaut sauter un jour que mentir sur l'heure.
function dansLaFenetreDuDigest(heure) {
    var maintenant = calcul.minutesDeHeure(heure);
    var ouverture = calcul.minutesDeHeure(HEURE_DIGEST);
    if (maintenant === null || ouverture === null) return false;
    return maintenant >= ouverture && maintenant <= ouverture + FENETRE_DIGEST_MINUTES;
}

function digestDuMatin(taches, ajd, heure) {
    if (!dansLaFenetreDuDigest(heure)) return null;

    var duJour = calcul.creneauxDuJour(taches, ajd)
        .filter(function(tache) { return !tache.faite; })
        .sort(function(a, b) {
            return calcul.minutesDeHeure(a.creneauHeure) - calcul.minutesDeHeure(b.creneauHeure);
        });

    var retards = (taches || []).filter(function(tache) {
        return calcul.estEnRetard(tache, ajd);
    }).sort(function(a, b) {
        return calcul.joursDeRetard(b, ajd) - calcul.joursDeRetard(a, ajd);
    });

    // Les retards sont EXCLUS de cette section : ils ont déjà la leur,
    // et pour une tâche en retard c'est le retard qui est le titre, pas
    // l'absence de créneau. Sur une carte, deux badges cohabitent très
    // bien ; dans un message qu'on lit d'un œil au réveil, la même tâche
    // citée deux fois se lit comme un bug.
    var sansCreneau = (taches || []).filter(function(tache) {
        return calcul.sansCreneauAlorsQueProche(tache, ajd)
            && !calcul.estEnRetard(tache, ajd);
    });

    if (!duJour.length && !retards.length && !sansCreneau.length && !DIGEST_MEME_SI_VIDE) {
        return null;
    }

    return { cle: cleDigest(ajd), texte: texteDigest(ajd, duJour, retards, sansCreneau) };
}

function texteDigest(ajd, duJour, retards, sansCreneau) {
    var lignes = ['☀️ <b>' + echapper(jourEnLettres(ajd)) + '</b>'];

    if (duJour.length) {
        lignes.push('');
        lignes.push('<b>Au programme</b>');
        duJour.forEach(function(tache) {
            var bornes = calcul.bornesCreneau(tache);
            lignes.push('• ' + calcul.heureDeMinutes(bornes.debut) + ' — ' + titreDe(tache)
                + ' <i>(' + libelleDuree(calcul.dureeCreneau(tache)) + ')</i>');
        });
    }

    if (retards.length) {
        lignes.push('');
        lignes.push('🔴 <b>En retard (' + retards.length + ')</b>');
        retards.forEach(function(tache) {
            var jours = calcul.joursDeRetard(tache, ajd);
            // L'enlisement se dit ici aussi : c'est le seul endroit qui
            // ose annoncer qu'une tâche n'attend plus une date mais une
            // décision, et il ne sert à rien s'il reste dans la page.
            var suffixe = calcul.estEnlisee(tache)
                ? ' — reportée ' + tache.nbReports + ' fois'
                : '';
            lignes.push('• ' + titreDe(tache) + ' <i>(' + jours + ' j)</i>' + suffixe);
        });
    }

    if (sansCreneau.length) {
        lignes.push('');
        lignes.push('📌 <b>Sans créneau (' + sansCreneau.length + ')</b>');
        lignes.push('<i>Ça arrive, et aucun moment n\'est décidé.</i>');
        sansCreneau.forEach(function(tache) {
            lignes.push('• ' + titreDe(tache));
        });
    }

    // Le cas vide est un message à part entière, pas une omission : le
    // silence ne doit jamais vouloir dire deux choses à la fois.
    if (!duJour.length && !retards.length && !sansCreneau.length) {
        lignes.push('');
        lignes.push('Rien au programme, rien en retard. 🌱');
    }

    return lignes.join('\n');
}

// Reconstruit en Date LOCALE, comme partout ailleurs dans ce projet :
// passer la chaîne à `new Date()` la lirait comme minuit UTC.
function jourEnLettres(iso) {
    if (!calcul.isoValide(iso)) return String(iso || '');
    var bouts = iso.split('-');
    var date = new Date(Number(bouts[0]), Number(bouts[1]) - 1, Number(bouts[2]));
    return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ------------------------------------------------------------
// 6. Tout ce qui doit partir maintenant
// ------------------------------------------------------------
// Le digest d'abord : au réveil, on veut la vue d'ensemble avant le
// rappel de 8 h 00.
//
// La déduplication n'est PAS ici — elle demande de la mémoire, donc le
// KV du Worker. Cette fonction dit ce qui est DÛ ; le Worker retire ce
// qui est déjà PARTI. Séparer les deux est ce qui permet de tester la
// décision sans inventer un faux stockage.
// ⚠ `avecDigest` n'est PAS une commodite. Le Worker ne lit la liste
// complete que lorsqu'un digest est possible ; le reste du temps il n'a
// en main que les creneaux d'aujourd'hui et demain. Calculer un digest
// sur cette liste tronquee annoncerait « 0 en retard » avec aplomb.
//
// La dedup du KV le rattraperait — le digest du jour est deja parti —
// mais se reposer dessus reviendrait a produire un message faux et a
// esperer que personne ne le lise. Le refus est donc explicite.
function messagesDus(taches, ajd, heure, avecDigest) {
    var messages = [];
    if (avecDigest !== false) {
        var digest = digestDuMatin(taches, ajd, heure);
        if (digest) messages.push(digest);
    }
    return messages.concat(rappelsCreneaux(taches, ajd, heure));
}

module.exports = {
    MINUTES_AVANT_CRENEAU: MINUTES_AVANT_CRENEAU,
    HEURE_DIGEST: HEURE_DIGEST,
    FENETRE_DIGEST_MINUTES: FENETRE_DIGEST_MINUTES,
    DIGEST_MEME_SI_VIDE: DIGEST_MEME_SI_VIDE,
    minutesDepuisAujourdhui: minutesDepuisAujourdhui,
    debutCreneau: debutCreneau,
    echapper: echapper,
    cleRappel: cleRappel,
    cleDigest: cleDigest,
    dansLaFenetreDuDigest: dansLaFenetreDuDigest,
    rappelsCreneaux: rappelsCreneaux,
    digestDuMatin: digestDuMatin,
    messagesDus: messagesDus
};
