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
var sejoursGite = require('./notifieur-sejours.js');

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

// L'heure du bilan du soir, à Paris.
var HEURE_BILAN = '20:00';

// Trois heures, pas quatre comme le matin : la fenêtre ne doit pas
// franchir minuit. Au-delà, le « demain » du message ne serait plus
// demain, et les créneaux annoncés seraient ceux d'après-demain.
var FENETRE_BILAN_MINUTES = 3 * 60;

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

function debutHeure(tache, ajd) {
    if (!calcul.aUneHeure(tache)) return null;
    return minutesDepuisAujourdhui(ajd, tache.echeance, tache.echeanceHeure);
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
// 4. Rappel avant l'heure d'une tâche
// ------------------------------------------------------------
// Seules les tâches À HEURE FIXE en reçoivent un. Une tâche due un jour
// sans heure précise n'a pas de moment à anticiper : elle figure au
// digest du matin, et c'est tout.
//
// La clé porte la date ET l'heure, pas seulement la tâche : repousser
// doit redonner droit à un rappel. Sans elles, une tâche déplacée de
// mardi à jeudi resterait marquée « déjà prévenu » et passerait sous
// silence.
function cleRappel(tache) {
    return 'heure:' + tache.id + ':' + tache.echeance + 'T' + tache.echeanceHeure;
}

function rappelsCreneaux(taches, ajd, heure) {
    var maintenant = calcul.minutesDeHeure(heure);
    if (maintenant === null) return [];

    return (taches || []).filter(function(tache) {
        if (tache.faite || !calcul.aUneHeure(tache)) return false;
        var debut = debutHeure(tache, ajd);
        if (debut === null) return false;
        // Fenêtre fermée à droite : passé l'heure, ce n'est plus un
        // rappel mais un constat, et « dans -3 min » ne veut rien dire.
        return (debut - MINUTES_AVANT_CRENEAU) <= maintenant && maintenant < debut;
    }).map(function(tache) {
        return { cle: cleRappel(tache), texte: texteRappel(tache, ajd, heure) };
    });
}

function texteRappel(tache, ajd, heure) {
    var debut = debutHeure(tache, ajd);
    var dans = debut - calcul.minutesDeHeure(heure);
    var bornes = calcul.bornesHeure(tache);

    var lignes = [];
    lignes.push('⏰ <b>Dans ' + dans + ' min</b> — ' + titreDe(tache));
    lignes.push(calcul.heureDeMinutes(bornes.debut) + ' – ' + calcul.heureDeMinutes(bornes.fin)
        + ' · ' + libelleDuree(calcul.dureeEcheance(tache)));

    if (tache.projet) lignes.push('📁 ' + echapper(tache.projet));
    if (tache.detail) {
        lignes.push('');
        lignes.push(echapper(tache.detail));
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

// ------------------------------------------------------------
// 5 bis. Le gîte — arrivées et départs de demain
// ------------------------------------------------------------
// Une section du digest, pas un message à part : elle tomberait à la
// même minute que lui, et deux notifications simultanées font qu'on en
// lit une distraitement.
//
// C'est la seule partie du notifieur qui ne parle pas de `taches`. Elle
// vient du flux iCal du gîte, analysé par notifieur-sejours.js — et
// c'est délibérément le digest du matin qui la porte : prévenir la
// veille laisse le temps d'écrire, prévenir le jour même ne sert plus à
// rien puisque les gens sont déjà en route.
function periodeCourte(debut, fin) {
    var d = dateLocale(debut);
    var f = dateLocale(fin);
    if (!d || !f) return '';
    var memeMois = (d.getMonth() === f.getMonth() && d.getFullYear() === f.getFullYear());
    var jourSeul = { day: 'numeric' };
    var jourEtMois = { day: 'numeric', month: 'long' };
    return 'du ' + d.toLocaleDateString('fr-FR', memeMois ? jourSeul : jourEtMois)
        + ' au ' + f.toLocaleDateString('fr-FR', jourEtMois);
}

function dateLocale(iso) {
    if (!calcul.isoValide(iso)) return null;
    var bouts = iso.split('-');
    return new Date(Number(bouts[0]), Number(bouts[1]) - 1, Number(bouts[2]));
}

// `etat` est le JSON de l'endpoint ménage : il porte, sous
// `info_<date d'arrivée>`, le nombre de personnes et la LANGUE. Les deux
// comptent pour écrire le message — on n'accueille pas trois Allemands
// comme un couple de Français. Absent, la ligne disparaît sans bruit.
// ⚠ POURQUOI CETTE SECTION EST LA SEULE QU'ON RÉPÈTE DANS LA JOURNÉE.
//
// Une tâche se coche : le notifieur sait qu'elle est faite et se tait.
// Le gîte n'a pas de « fait » — rien ne dira jamais que le message est
// parti. Le choix est donc binaire : une seule chance, ou deux.
//
// Et l'oubli ne coûte pas à celui qui oublie. Une corvée repoussée
// n'ennuie que soi ; des clients qui arrivent sans code d'entrée, non.
// C'est le seul endroit du notifieur où répéter se justifie.
//
// Le soir n'est donc pas une copie mais un FILET, et la ligne d'action
// le dit : « envoyer » le matin, « envoyé ? » le soir. Le reste du bloc
// est identique, pour pouvoir écrire sur-le-champ sans rien rouvrir.
function lignesSejour(sejour, sens, etat, mode) {
    var lignes = [];
    var quoi = (sens === 'arrivee') ? 'Arrivée' : 'Départ';
    // « aujourd'hui » n'est pas « demain » : c'est le dernier rappel
    // avant que ça se joue, et il doit se lire comme tel.
    var quand = (sejour.quand === 'aujourdhui') ? "AUJOURD'HUI" : 'demain';

    lignes.push('🏠 <b>' + quoi + ' ' + quand + ' — '
        + echapper(sejoursGite.libellePlateforme(sejour.plateforme)) + '</b>');

    var precisions = [];
    if (sens === 'arrivee') {
        var details = sejoursGite.detailsArrivee(etat, sejour.debut);
        if (details && details.personnes) {
            precisions.push(details.personnes + ' personne' + (details.personnes > 1 ? 's' : ''));
        }
        if (details && sejoursGite.libelleLangue(details.langue)) {
            precisions.push(sejoursGite.libelleLangue(details.langue));
        }
    }
    precisions.push(periodeCourte(sejour.debut, sejour.fin));
    lignes.push(echapper(precisions.filter(Boolean).join(' · ')));

    var lequel = (sens === 'arrivee') ? "d'arrivée" : 'de départ';
    lignes.push(mode === 'rappel'
        ? '→ message ' + lequel + ' envoyé ?'
        : '→ envoyer le message ' + lequel);

    // Le lien de réservation vaut de l'or dans un message : un lien à
    // toucher plutôt qu'une réservation à retrouver à la main. Airbnb le
    // donne ; les blocages et Booking, non.
    if (sejour.lien) lignes.push(echapper(sejour.lien));

    if (sens === 'arrivee') {
        var infos = sejoursGite.detailsArrivee(etat, sejour.debut);
        if (infos && infos.commentaire) lignes.push('<i>' + echapper(infos.commentaire) + '</i>');
    }

    return lignes;
}

// ⚠ `sejours === null` SIGNIFIE « JE N'AI PAS PU LIRE », et ce n'est pas
// la même chose qu'un tableau vide, qui signifie « rien à annoncer ».
//
// La confusion des deux a coûté un message d'accueil le 31 août 2026 :
// quand le calendrier ne répondait pas, la section disparaissait
// simplement, et le digest arrivait parfaitement normal. Rien ne
// distinguait « aucune arrivée demain » de « je n'ai rien pu lire » —
// la panne silencieuse exacte contre laquelle ce projet est écrit.
//
// Désormais le digest le DIT. Un message de trop vaut mieux qu'un
// silence ambigu : c'est le même raisonnement que le digest qui part
// même les jours vides.
function sectionSejours(sejours, ajd, etat, mode) {
    // ⚠ SEUL `null` veut dire « je n'ai pas pu lire ». `undefined` — un
    // appelant qui ne passe simplement pas de séjours — ne doit rien
    // déclencher : confondre les deux ferait crier à la panne un appelant
    // qui n'a jamais demandé le gîte.
    if (sejours === null) {
        return ['', '⚠️ <b>Calendrier du gîte injoignable</b>',
                '<i>Impossible de savoir s\'il y a une arrivée ou un départ. '
                + 'À vérifier à la main.</i>'];
    }

    var aVenir = sejoursGite.sejoursAAnnoncer(sejours, ajd);
    if (!aVenir.arrivees.length && !aVenir.departs.length) return [];

    var lignes = [];
    // Les départs d'abord : le ménage s'enchaîne derrière, c'est ce qui
    // engage le plus de monde.
    aVenir.departs.forEach(function(sejour) {
        lignes.push('');
        lignes = lignes.concat(lignesSejour(sejour, 'depart', etat, mode));
    });
    aVenir.arrivees.forEach(function(sejour) {
        lignes.push('');
        lignes = lignes.concat(lignesSejour(sejour, 'arrivee', etat, mode));
    });
    return lignes;
}

function digestDuMatin(taches, ajd, heure, sejours, etat) {
    if (!dansLaFenetreDuDigest(heure)) return null;

    var duJour = calcul.avecHeureLeJour(taches, ajd)
        .filter(function(tache) { return !tache.faite; })
        .sort(function(a, b) {
            return calcul.minutesDeHeure(a.echeanceHeure) - calcul.minutesDeHeure(b.echeanceHeure);
        });

    var retards = (taches || []).filter(function(tache) {
        return calcul.estEnRetard(tache, ajd);
    }).sort(function(a, b) {
        return calcul.joursDeRetard(b, ajd) - calcul.joursDeRetard(a, ajd);
    });

    // Les tâches dues aujourd'hui SANS heure fixée. Elles n'étaient
    // visibles nulle part avant la fusion des dates, puisque le digest ne
    // montrait que les créneaux — or ce sont les plus nombreuses.
    // Retards exclus : ils ont déjà leur section, et une même tâche citée
    // deux fois dans un message qu'on lit d'un œil se lit comme un bug.
    var sansHeure = calcul.sansHeureLeJour(taches, ajd).filter(function(tache) {
        return !calcul.estEnRetard(tache, ajd);
    });

    var gite = sectionSejours(sejours, ajd, etat, 'annonce');

    if (!duJour.length && !retards.length && !sansHeure.length && !gite.length
        && !DIGEST_MEME_SI_VIDE) {
        return null;
    }

    return { cle: cleDigest(ajd), texte: texteDigest(ajd, duJour, retards, sansHeure, gite) };
}

function texteDigest(ajd, duJour, retards, sansHeure, gite) {
    var lignes = ['☀️ <b>' + echapper(jourEnLettres(ajd)) + '</b>'];

    // Le gîte EN TÊTE : c'est la seule chose du digest qui engage
    // quelqu'un d'autre que soi, et la seule qu'on ne puisse pas
    // rattraper le lendemain.
    lignes = lignes.concat(gite || []);

    if (duJour.length) {
        lignes.push('');
        lignes.push('<b>Au programme</b>');
        duJour.forEach(function(tache) {
            var bornes = calcul.bornesHeure(tache);
            lignes.push('• ' + calcul.heureDeMinutes(bornes.debut) + ' — ' + titreDe(tache)
                + ' <i>(' + libelleDuree(calcul.dureeEcheance(tache)) + ')</i>');
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

    if (sansHeure.length) {
        lignes.push('');
        lignes.push('📌 <b>Aujourd\'hui, sans heure fixée (' + sansHeure.length + ')</b>');
        sansHeure.forEach(function(tache) {
            lignes.push('• ' + titreDe(tache));
        });
    }

    // Le cas vide est un message à part entière, pas une omission : le
    // silence ne doit jamais vouloir dire deux choses à la fois.
    if (!duJour.length && !retards.length && !sansHeure.length && !(gite || []).length) {
        lignes.push('');
        lignes.push('Rien au programme, rien en retard. 🌱');
    }

    return lignes.join('\n');
}

// Reconstruit en Date LOCALE, comme partout ailleurs dans ce projet :
// passer la chaîne à `new Date()` la lirait comme minuit UTC.
function jourEnLettres(iso) {
    var date = dateLocale(iso);
    if (!date) return String(iso || '');
    return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ------------------------------------------------------------
// 6. Le bilan du soir
// ------------------------------------------------------------
// IL NE RÉPÈTE PAS LE DIGEST DU MATIN — il répond à une autre question.
// Le matin dit ce qui attend ; le soir dit ce qui a glissé, et ce qu'on
// peut encore sauver avant que la journée ne se referme.
//
// ⚠ C'EST LUI QUI RATTRAPE LES BASCULES EN RETARD. Une tâche bascule à
// MINUIT, quand la date change : une alerte à cet instant-là tomberait
// vers 00 h 05, à l'heure la plus inutile qui soit pour apprendre qu'on
// a oublié quelque chose. Prévenu le soir, on a encore le choix — la
// finir, ou repousser l'échéance délibérément, ce qui incrémente le
// compteur de reports et reste honnête. C'est la raison pour laquelle
// le déclencheur « bascule en retard » n'existe pas séparément.
//
// Il absorbe aussi le CRÉNEAU MANQUÉ, dont un signalement à chaque
// glissement aurait été bavard : groupé une fois le soir, il devient
// une invitation à replanifier au lieu d'un reproche répété.
function cleBilan(ajd) {
    return 'bilan:' + ajd;
}

function dansLaFenetreDuBilan(heure) {
    var maintenant = calcul.minutesDeHeure(heure);
    var ouverture = calcul.minutesDeHeure(HEURE_BILAN);
    if (maintenant === null || ouverture === null) return false;
    return maintenant >= ouverture && maintenant <= ouverture + FENETRE_BILAN_MINUTES;
}

function bilanDuSoir(taches, ajd, heure, sejours, etat) {
    if (!dansLaFenetreDuBilan(heure)) return null;

    // Échéance AUJOURD'HUI et pas close : à minuit, ce sera un retard.
    // Ce soir, ça ne l'est pas encore — d'où le temps qui reste.
    var basculent = (taches || []).filter(function(tache) {
        return !tache.faite && tache.echeance === ajd;
    });

    // Les heures du JOUR seulement, passées et toujours ouvertes. Celles
    // des jours précédents sont devenues des retards et ont leur propre
    // section ; les répéter ici jusqu'à ce qu'on cède ne serait plus un
    // rappel mais du harcèlement.
    var nonTenus = (taches || []).filter(function(tache) {
        return calcul.heureDepassee(tache, ajd, heure);
    }).sort(function(a, b) {
        return calcul.minutesDeHeure(a.echeanceHeure) - calcul.minutesDeHeure(b.echeanceHeure);
    });

    var demain = calcul.avecHeureLeJour(taches, calcul.ajouterJours(ajd, 1))
        .filter(function(tache) { return !tache.faite; })
        .sort(function(a, b) {
            return calcul.minutesDeHeure(a.echeanceHeure) - calcul.minutesDeHeure(b.echeanceHeure);
        });

    // Le filet du gîte : « le message est-il parti ? ». Voir lignesSejour
    // pour la raison — c'est la seule répétition assumée de la journée.
    var gite = sectionSejours(sejours, ajd, etat, 'rappel');

    // ⚠ CONTRAIREMENT AU DIGEST DU MATIN, IL SE TAIT QUAND IL N'Y A RIEN.
    // Le matin porte déjà le battement de cœur qui prouve que le notifieur
    // vit et lève l'ambiguïté du silence ; deux par jour, c'en est un de
    // trop, et le second finirait par ne plus être lu.
    if (!basculent.length && !nonTenus.length && !demain.length && !gite.length) return null;

    return { cle: cleBilan(ajd), texte: texteBilan(ajd, basculent, nonTenus, demain, gite) };
}

function texteBilan(ajd, basculent, nonTenus, demain, gite) {
    var lignes = ['🌙 <b>' + echapper(jourEnLettres(ajd)) + '</b> — bilan'];

    // En tête comme au matin : c'est ce qui engage quelqu'un d'autre.
    lignes = lignes.concat(gite || []);

    if (basculent.length) {
        lignes.push('');
        lignes.push('⚠️ <b>Bascule en retard cette nuit (' + basculent.length + ')</b>');
        lignes.push('<i>Ce soir, c\'est encore rattrapable.</i>');
        basculent.forEach(function(tache) {
            lignes.push('• ' + titreDe(tache)
                + (tache.important ? ' <i>(important)</i>' : ''));
        });
    }

    if (nonTenus.length) {
        lignes.push('');
        lignes.push('↩️ <b>Heures passées, pas faites (' + nonTenus.length + ')</b>');
        nonTenus.forEach(function(tache) {
            lignes.push('• ' + echapper(tache.echeanceHeure) + ' — ' + titreDe(tache));
        });
    }

    if (demain.length) {
        lignes.push('');
        lignes.push('📋 <b>Demain</b>');
        demain.forEach(function(tache) {
            var bornes = calcul.bornesHeure(tache);
            lignes.push('• ' + calcul.heureDeMinutes(bornes.debut) + ' — ' + titreDe(tache)
                + ' <i>(' + libelleDuree(calcul.dureeEcheance(tache)) + ')</i>');
        });
    }

    return lignes.join('\n');
}

// ------------------------------------------------------------
// 7. Tout ce qui doit partir maintenant
// ------------------------------------------------------------
// Le digest d'abord : au réveil, on veut la vue d'ensemble avant le
// rappel de 8 h 00.
//
// La déduplication n'est PAS ici — elle demande de la mémoire, donc le
// KV du Worker. Cette fonction dit ce qui est DÛ ; le Worker retire ce
// qui est déjà PARTI. Séparer les deux est ce qui permet de tester la
// décision sans inventer un faux stockage.
// ⚠ `listeComplete` n'est PAS une commodité. Le Worker ne lit toutes les
// tâches ouvertes que lorsqu'un résumé est possible ; le reste du temps
// il n'a en main que les créneaux d'aujourd'hui et demain. Calculer un
// digest — ou un bilan — sur cette liste tronquée annoncerait « 0 en
// retard » avec aplomb, et manquerait les échéances qui basculent.
//
// La dédup du KV le rattraperait — le résumé du jour est déjà parti —
// mais se reposer dessus reviendrait à produire un message faux et à
// espérer que personne ne le lise. Le refus est donc explicite.
//
// Les deux résumés ne peuvent pas tomber le même tour : leurs fenêtres
// ne se recouvrent pas (07:30–11:30 et 20:00–23:00).
function messagesDus(taches, ajd, heure, listeComplete, sejours, etat) {
    var messages = [];
    if (listeComplete !== false) {
        var digest = digestDuMatin(taches, ajd, heure, sejours, etat);
        if (digest) messages.push(digest);
        var bilan = bilanDuSoir(taches, ajd, heure, sejours, etat);
        if (bilan) messages.push(bilan);
    }
    return messages.concat(rappelsCreneaux(taches, ajd, heure));
}

// Le Worker s'en sert AVANT de lire Firestore, pour savoir s'il lui faut
// la liste complète ou seulement les créneaux proches.
function dansUneFenetreDeResume(heure) {
    return dansLaFenetreDuDigest(heure) || dansLaFenetreDuBilan(heure);
}

module.exports = {
    MINUTES_AVANT_CRENEAU: MINUTES_AVANT_CRENEAU,
    HEURE_DIGEST: HEURE_DIGEST,
    HEURE_BILAN: HEURE_BILAN,
    FENETRE_BILAN_MINUTES: FENETRE_BILAN_MINUTES,
    FENETRE_DIGEST_MINUTES: FENETRE_DIGEST_MINUTES,
    DIGEST_MEME_SI_VIDE: DIGEST_MEME_SI_VIDE,
    minutesDepuisAujourdhui: minutesDepuisAujourdhui,
    debutHeure: debutHeure,
    echapper: echapper,
    cleRappel: cleRappel,
    cleDigest: cleDigest,
    cleBilan: cleBilan,
    dansLaFenetreDuDigest: dansLaFenetreDuDigest,
    dansLaFenetreDuBilan: dansLaFenetreDuBilan,
    dansUneFenetreDeResume: dansUneFenetreDeResume,
    bilanDuSoir: bilanDuSoir,
    rappelsCreneaux: rappelsCreneaux,
    digestDuMatin: digestDuMatin,
    sectionSejours: sectionSejours,
    periodeCourte: periodeCourte,
    messagesDus: messagesDus
};
