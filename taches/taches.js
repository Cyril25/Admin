// ============================================================
// taches.js — La page « Mes tâches »
// ============================================================
// Collection Firestore « taches ». Un document = une tâche :
//   titre            string   obligatoire
//   detail           string   texte libre
//   projet           string   libellé, liste fermée (comme le carnet d'idées)
//   important        bool     la seule qualification saisie à la main
//   urgentForce      bool     « urgent tout de suite », pour l'urgence sans date
//   echeance         string   'AAAA-MM-JJ' — AVANT QUAND ça doit être fait
//   creneauJour      string   'AAAA-MM-JJ' — QUAND je m'y colle
//   creneauHeure     string   'HH:MM'
//   creneauDuree     int      minutes
//   faite            bool
//   faiteLe          string   'AAAA-MM-JJ'
//   nbReports        int      combien de fois l'échéance a été repoussée
//   echeanceInitiale string   la toute première date visée
//   creePar          string   email — titre de propriété ET de lecture
//   createdAt        timestamp serveur
//   updatedAt        timestamp serveur
//
// Le classement lui-même n'est pas ici : il vit dans taches-calcul.js,
// chargé juste avant, parce que la page d'accueil en a besoin aussi
// pour poser son compteur de retards sur la tuile.
//
// CHACUN CHEZ SOI, LECTURE COMPRISE. C'est le seul projet du hub dont
// les règles cloisonnent la lecture : personne ne voit les corvées de
// personne, superadmin inclus.
//
// ⚠ D'où le `where('creePar', '==', …)` de `ecouterTaches()` : une
// règle n'est pas un filtre. Sans cette clause, Firestore rejette la
// requête en bloc et l'écran est entièrement vide — pas « vide parce
// qu'il n'y a rien », vide parce que la requête a été refusée.
//
// Corollaire : toute tâche chargée est forcément la sienne. Il n'y a
// donc ni mode lecture seule ni garde `peutModifier`, contrairement au
// carnet d'idées où l'on croise les fiches des autres.
// ============================================================

// ------------------------------------------------------------
// 1. État de la page
// ------------------------------------------------------------
var db = null;
var taches = [];
var filtreEtat = 'a_faire';   // a_faire | faites | toutes
var vue = 'liste';            // liste | semaine
var lundiAffiche = '';        // lundi de la semaine montrée par la grille
var idEnEdition = null;
var creneauEnCours = null;    // { jour, heure } pendant le choix d'une tâche
var premierChargement = true;

// La hauteur d'une heure dans la grille, en pixels. De la présentation
// pure : le calcul, lui, ne connaît que des minutes.
var HAUTEUR_HEURE = 46;

// Le bloc des tâches réglées : de la présentation pure, d'où sa place
// ici et non dans BLOCS, dont l'ordre porte, lui, la priorité.
var BLOC_FAITES = {
    cle: 'faites',
    titre: 'Faites',
    icone: 'fa-solid fa-circle-check',
    aide: 'Les dernières réglées en tête.'
};

// ------------------------------------------------------------
// 2. Démarrage (appelé par auth.js une fois l'accès validé)
// ------------------------------------------------------------
function onHubReady() {
    db = firebase.firestore();
    lundiAffiche = lundiDeLaSemaine(aujourdhui());
    renderSelecteurVues();

    // Sous impersonation, il n'y a rien d'honnête à afficher. Les
    // requêtes partent avec le jeton du superadmin : interroger la
    // collection au nom de la personne impersonnée serait refusé par les
    // règles, et l'interroger en son propre nom montrerait SES tâches à
    // lui sous une étiquette qui annonce quelqu'un d'autre. On s'arrête
    // donc, et on l'écrit.
    if (HUB.impersonation) {
        var note = document.getElementById('note-impersonation');
        if (note) {
            note.innerHTML = '<i class="fa-solid fa-lock"></i>'
                + '<div><strong>Rien à voir ici, et c\'est voulu.</strong> '
                + 'Les tâches sont personnelles : elles ne s\'ouvrent qu\'à '
                + 'la personne qui les a écrites. L\'impersonation montre les '
                + 'écrans des autres, pas leurs listes de corvées.</div>';
            note.style.display = '';
        }
        renderFiltres();
        renderVue();
        return;
    }

    ecouterTaches();
}

// L'email de l'auteur d'une écriture : l'utilisateur RÉEL, toujours.
// Les règles comparent `creePar` au jeton de l'appelant.
function moiReel() {
    return normaliserEmail(HUB.user && HUB.user.email);
}

function ecouterTaches() {
    db.collection('taches')
        .where('creePar', '==', moiReel())
        .onSnapshot(function(snapshot) {
            taches = [];
            snapshot.forEach(function(doc) {
                var data = doc.data();
                data.id = doc.id;
                taches.push(data);
            });
            premierChargement = false;
            renderFiltres();
            renderVue();
        }, function(erreur) {
            console.error('Erreur Firestore :', erreur);
            var cible = document.getElementById('taches-blocs');
            if (cible) {
                cible.innerHTML = '<div class="error-block">'
                    + '<i class="fa-solid fa-circle-exclamation"></i>'
                    + '<strong>Impossible de lire les tâches.</strong><br>'
                    + '<span style="color:var(--color-text-muted)">' + escapeHtml(erreur.message) + '</span>'
                    + '</div>';
            }
        });
}

// ------------------------------------------------------------
// 3. Dates d'affichage
// ------------------------------------------------------------
// L'échéance est une chaîne 'AAAA-MM-JJ' (voir taches-calcul.js). La
// remettre dans une Date LOCALE avant de la formater, et non passer la
// chaîne à `toDate()`, qui la lirait comme minuit UTC : à l'ouest de
// Greenwich, une échéance au 20 s'afficherait le 19.
function formatEcheance(iso) {
    if (!isoValide(iso)) return '—';
    var bouts = iso.split('-');
    return formatDateFr(new Date(Number(bouts[0]), Number(bouts[1]) - 1, Number(bouts[2])));
}

// « demain », « dans 3 j », « le 4 sept. » : à court terme la distance
// parle mieux que la date, et c'est à court terme que ça compte.
function libelleEcheance(iso, ajd) {
    var jours = joursEntre(ajd, iso);
    if (jours === null) return '—';
    // Une échéance passée arrive ici quand la tâche est FAITE : le badge
    // de retard ne s'affiche plus, mais la date, elle, reste dans le
    // passé. Sans ce garde-fou on lirait « dans -8 j ».
    if (jours < 0) return formatEcheance(iso);
    if (jours === 0) return 'aujourd\'hui';
    if (jours === 1) return 'demain';
    if (jours <= JOURS_URGENCE) return 'dans ' + jours + ' j';
    return formatEcheance(iso);
}

// Le jour de la semaine, en toutes lettres. Reconstruit en Date LOCALE
// pour la même raison que `formatEcheance`.
function dateLocale(iso) {
    if (!isoValide(iso)) return null;
    var bouts = iso.split('-');
    return new Date(Number(bouts[0]), Number(bouts[1]) - 1, Number(bouts[2]));
}

function libelleJourCourt(iso) {
    var date = dateLocale(iso);
    if (!date) return '';
    return date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
}

// ------------------------------------------------------------
// 4. Les deux vues
// ------------------------------------------------------------
// Même donnée, deux regards : la liste dit « dans quel ordre », la
// grille dit « quand ». Une page et non deux, comme le chantier fait
// déjà avec ses vues — ce sont les mêmes tâches, pas deux outils.
var VUES = [
    { cle: 'liste',   titre: 'Liste',   icone: 'fa-solid fa-list-check' },
    { cle: 'semaine', titre: 'Semaine', icone: 'fa-solid fa-calendar-week' }
];

function renderSelecteurVues() {
    var cible = document.getElementById('selecteur-vues');
    if (!cible) return;
    cible.innerHTML = VUES.map(function(v) {
        return '<button type="button" class="vue-btn' + (vue === v.cle ? ' active' : '') + '"'
            + ' onclick="changerVue(\'' + jsAttr(v.cle) + '\')">'
            + '<i class="' + escapeAttr(v.icone) + '"></i> ' + escapeHtml(v.titre) + '</button>';
    }).join('');
}

function changerVue(cle) {
    vue = cle;
    renderSelecteurVues();
    renderVue();
}

function renderVue() {
    var liste = document.getElementById('vue-liste');
    var semaine = document.getElementById('vue-semaine');
    // La barre de recherche et les filtres n'ont de sens que sur la
    // liste : filtrer une grille en masquerait des cases sans le dire.
    var outils = document.getElementById('outils-liste');

    if (liste) liste.style.display = (vue === 'liste') ? '' : 'none';
    if (semaine) semaine.style.display = (vue === 'semaine') ? '' : 'none';
    if (outils) outils.style.display = (vue === 'liste') ? '' : 'none';

    signalerEnlisement();
    signalerSansCreneau();

    if (vue === 'semaine') renderSemaine();
    else renderTaches();
}

// ------------------------------------------------------------
// 5. Filtres
// ------------------------------------------------------------
function renderFiltres() {
    var cible = document.getElementById('etat-filter');
    if (!cible) return;

    var nbFaites = taches.filter(function(t) { return t.faite; }).length;
    cible.innerHTML = boutonFiltre('a_faire', 'À faire', taches.length - nbFaites)
        + boutonFiltre('faites', 'Faites', nbFaites)
        + boutonFiltre('toutes', 'Toutes', taches.length);
}

function boutonFiltre(valeur, libelle, compte) {
    var actif = (filtreEtat === valeur) ? ' active' : '';
    return '<button type="button" class="filter-btn' + actif + '"'
        + ' onclick="filtrerParEtat(\'' + jsAttr(valeur) + '\')">'
        + escapeHtml(libelle) + ' (' + compte + ')</button>';
}

function filtrerParEtat(valeur) {
    filtreEtat = valeur;
    renderFiltres();
    renderTaches();
}

function clearSearch() {
    var input = document.getElementById('search-input');
    if (input) input.value = '';
    renderTaches();
}

function tachesFiltrees() {
    var input = document.getElementById('search-input');
    var terme = input ? input.value.trim().toLowerCase() : '';
    var boutonClear = document.getElementById('search-clear');
    if (boutonClear) boutonClear.style.display = terme ? '' : 'none';

    return taches.filter(function(t) {
        if (filtreEtat === 'a_faire' && t.faite) return false;
        if (filtreEtat === 'faites' && !t.faite) return false;
        if (!terme) return true;
        var texte = ((t.titre || '') + ' ' + (t.detail || '') + ' ' + (t.projet || '')).toLowerCase();
        return texte.indexOf(terme) !== -1;
    });
}

// ------------------------------------------------------------
// 6. Rendu de la liste
// ------------------------------------------------------------
function renderTaches() {
    var cible = document.getElementById('taches-blocs');
    var vide = document.getElementById('empty-state');
    var compteur = document.getElementById('result-count');
    if (!cible) return;

    var lignes = tachesFiltrees();
    var ajd = aujourdhui();
    var rangement = rangerParBloc(lignes, ajd);

    if (compteur) {
        compteur.textContent = lignes.length + ' tâche' + (lignes.length > 1 ? 's' : '');
    }

    var html = '';
    BLOCS.concat([BLOC_FAITES]).forEach(function(bloc) {
        // Un bloc vide ne s'affiche pas : un titre posé sur du vide fait
        // croire qu'on attend quelque chose à cet endroit.
        var contenu = rangement[bloc.cle];
        if (!contenu.length) return;
        html += sectionBloc(bloc, contenu, ajd);
    });

    cible.innerHTML = html;
    if (vide) {
        vide.style.display = (!html && !premierChargement) ? 'block' : 'none';
    }
}

function sectionBloc(bloc, lignes, ajd) {
    return '<section class="bloc-taches bloc-taches--' + escapeAttr(bloc.cle) + '">'
        + '<h2 class="bloc-taches-titre">'
        +   '<i class="' + escapeAttr(bloc.icone) + '"></i> ' + escapeHtml(bloc.titre)
        +   '<span class="bloc-taches-compte">' + lignes.length + '</span>'
        + '</h2>'
        + '<p class="bloc-taches-aide">' + escapeHtml(bloc.aide) + '</p>'
        + '<div class="fil">' + lignes.map(function(t) { return carteTache(t, ajd); }).join('') + '</div>'
        + '</section>';
}

function carteTache(tache, ajd) {
    var id = jsAttr(tache.id);
    var retard = joursDeRetard(tache, ajd);
    var bouts = [];

    if (retard > 0) {
        bouts.push('<span class="badge badge-retard"><i class="fa-solid fa-triangle-exclamation"></i>'
            + 'en retard de ' + retard + ' j</span>');
    } else if (isoValide(tache.echeance)) {
        bouts.push('<span class="badge"><i class="fa-solid fa-calendar-day"></i>'
            + escapeHtml(libelleEcheance(tache.echeance, ajd)) + '</span>');
    } else {
        bouts.push('<span class="badge badge-sans-date"><i class="fa-solid fa-calendar-xmark"></i>sans date</span>');
    }

    if (tache.important) {
        bouts.push('<span class="badge badge-important"><i class="fa-solid fa-star"></i>important</span>');
    }
    if (tache.urgentForce && !tache.faite) {
        bouts.push('<span class="badge badge-urgent-force"><i class="fa-solid fa-bolt"></i>urgent forcé</span>');
    }
    if (tache.projet) {
        bouts.push('<span class="badge badge-projet"><i class="fa-solid fa-folder"></i>'
            + escapeHtml(tache.projet) + '</span>');
    }
    if (tache.nbReports) {
        var classe = estEnlisee(tache) ? ' badge-enlisee' : '';
        bouts.push('<span class="badge badge-reports' + classe + '"'
            + ' title="' + escapeAttr(titreReports(tache)) + '">'
            + '<i class="fa-solid fa-rotate-right"></i>reportée ' + tache.nbReports + ' fois</span>');
    }
    if (tache.faite && isoValide(tache.faiteLe)) {
        bouts.push('<span class="badge badge-faite"><i class="fa-solid fa-check"></i>'
            + escapeHtml(formatEcheance(tache.faiteLe)) + '</span>');
    }

    // Les trois signaux que la séparation échéance / créneau rend
    // possibles. Ils ne changent pas le bloc de la tâche — ce sont des
    // alertes, pas une cinquième priorité.
    if (aUnCreneau(tache) && !tache.faite) {
        var manque = creneauManque(tache, ajd, heureCourante());
        bouts.push('<span class="badge ' + (manque ? 'badge-creneau-manque' : 'badge-creneau') + '">'
            + '<i class="fa-solid fa-' + (manque ? 'clock-rotate-left' : 'calendar-check') + '"></i>'
            + escapeHtml(libelleCreneau(tache, ajd)) + (manque ? ' — manqué' : '') + '</span>');
    }
    if (planifieApresEcheance(tache)) {
        bouts.push('<span class="badge badge-debordee"'
            + ' title="' + escapeAttr('Le créneau est le ' + formatEcheance(tache.creneauJour)
                + ', l\'échéance était le ' + formatEcheance(tache.echeance) + '.') + '">'
            + '<i class="fa-solid fa-arrow-right-long"></i>planifié après l\'échéance</span>');
    }
    if (sansCreneauAlorsQueProche(tache, ajd)) {
        bouts.push('<span class="badge badge-sans-creneau"'
            + ' title="Ça brûle, et aucun moment n\'est encore décidé.">'
            + '<i class="fa-solid fa-calendar-plus"></i>sans créneau</span>');
    }

    return '<article class="carte-fil carte-tache' + (tache.faite ? ' carte-fil--close' : '') + '">'
        + '<div class="carte-fil-corps">'
        +   '<button type="button" class="carte-titre carte-titre--bouton" onclick="ouvrirModale(\'' + id + '\')">'
        +     escapeHtml(tache.titre || '(sans titre)') + '</button>'
        +   (tache.detail ? '<p class="carte-apercu">' + escapeHtml(tache.detail) + '</p>' : '')
        +   '<div class="carte-meta">' + bouts.join(' ') + '</div>'
        +   actionsTache(tache, retard)
        + '</div>'
        + '</article>';
}

// « aujourd'hui 14:00 », « mar. 3 à 09:30 » : le jour se dit en clair
// quand il n'est pas aujourd'hui, sinon l'heure suffit.
function libelleCreneau(tache, ajd) {
    var heure = tache.creneauHeure;
    if (tache.creneauJour === ajd) return 'aujourd\'hui ' + heure;
    if (tache.creneauJour === ajouterJours(ajd, 1)) return 'demain ' + heure;
    return libelleJourCourt(tache.creneauJour) + ' à ' + heure;
}

function titreReports(tache) {
    if (!tache.echeanceInitiale) return 'Échéance repoussée ' + tache.nbReports + ' fois.';
    return 'Visée d\'abord le ' + formatEcheance(tache.echeanceInitiale)
        + ', repoussée ' + tache.nbReports + ' fois.';
}

// Les boutons de report ne s'affichent QUE sur les tâches en retard :
// c'est là qu'on en a besoin, et les mettre partout inviterait à
// repousser ce qui n'est pas encore en peine.
function actionsTache(tache, retard) {
    var id = jsAttr(tache.id);
    var boutons = '';

    if (tache.faite) {
        boutons += '<button type="button" class="tache-btn" onclick="rouvrirTache(\'' + id + '\')">'
            + '<i class="fa-solid fa-rotate-left"></i> Rouvrir</button>';
    } else {
        boutons += '<button type="button" class="tache-btn tache-btn--fait" onclick="cloturerTache(\'' + id + '\')">'
            + '<i class="fa-solid fa-check"></i> Fait</button>';
        if (retard > 0) {
            boutons += '<button type="button" class="tache-btn" onclick="reporterA(\'' + id + '\', 0)">'
                + '<i class="fa-solid fa-arrow-right"></i> Aujourd\'hui</button>';
            boutons += '<button type="button" class="tache-btn" onclick="reporterA(\'' + id + '\', 7)">'
                + '<i class="fa-solid fa-forward"></i> +1 semaine</button>';
        }
    }

    if (aUnCreneau(tache) && !tache.faite) {
        boutons += '<button type="button" class="tache-btn" onclick="deplanifierTache(\'' + id + '\')"'
            + ' title="Retirer le créneau — la tâche reste, seule la décision du moment s\'efface">'
            + '<i class="fa-solid fa-calendar-xmark"></i> Déplanifier</button>';
    }

    boutons += '<button type="button" class="tache-btn" onclick="ouvrirModale(\'' + id + '\')">'
        + '<i class="fa-solid fa-pen"></i> Modifier</button>';

    return '<div class="tache-actions">' + boutons + '</div>';
}

// Le trou de la planification : ça brûle et rien n'est décidé. C'est le
// signal qu'un calendrier seul ne peut pas donner — il ne connaît que ce
// qu'on y a déjà posé — et qu'une liste seule ne peut pas donner non
// plus, faute de savoir ce qui est planifié.
function signalerSansCreneau() {
    var bloc = document.getElementById('note-sans-creneau');
    if (!bloc) return;

    var ajd = aujourdhui();
    var orphelines = taches.filter(function(tache) {
        return sansCreneauAlorsQueProche(tache, ajd);
    });

    if (!orphelines.length) {
        bloc.style.display = 'none';
        return;
    }

    var nb = orphelines.length;
    bloc.innerHTML = '<i class="fa-solid fa-calendar-plus"></i>'
        + '<div><strong>' + nb + ' tâche' + (nb > 1 ? 's' : '') + ' sans créneau</strong> '
        + 'alors qu\'' + (nb > 1 ? 'elles arrivent' : 'elle arrive') + ' à échéance. '
        + 'Savoir que c\'est urgent ne suffit pas : tant qu\'aucun moment n\'est posé, '
        + 'rien ne se fera.'
        + '<button type="button" class="btn-ajout-auteur" onclick="changerVue(\'semaine\')">'
        + 'Ouvrir la semaine</button></div>';
    bloc.style.display = '';
}

// L'avertissement qui dit tout haut ce qu'un compteur de reports ne
// suffit pas à faire admettre : ces tâches-là ne sont plus en retard.
function signalerEnlisement() {
    var bloc = document.getElementById('note-enlisement');
    if (!bloc) return;

    var enlisees = taches.filter(estEnlisee);
    if (!enlisees.length) {
        bloc.style.display = 'none';
        return;
    }

    var nb = enlisees.length;
    bloc.innerHTML = '<i class="fa-solid fa-hourglass-end"></i>'
        + '<div><strong>' + nb + ' tâche' + (nb > 1 ? 's' : '')
        + ' reportée' + (nb > 1 ? 's' : '') + ' ' + REPORTS_ENLISEMENT + ' fois ou plus.</strong> '
        + (nb > 1 ? 'Ce ne sont plus des retards' : 'Ce n\'est plus un retard')
        + ' : à ce stade, la question n\'est plus quand, mais si. '
        + 'Les supprimer est une réponse valable.</div>';
    bloc.style.display = '';
}

// ------------------------------------------------------------
// 7. La grille de semaine
// ------------------------------------------------------------
// Construite à la main : sept colonnes, des blocs positionnés au pixel
// depuis des minutes. Une librairie de calendrier passerait la CSP mais
// pèserait plus lourd que tout le hub réuni, pour un rendu qu'on ne
// maîtriserait plus.
//
// Deux étages, et la distinction est le sujet même de cette vue :
//   - EN HAUT, hors grille : les échéances. Une contrainte n'a pas
//     d'horaire, la poser dans les heures serait lui en inventer un.
//   - DANS LA GRILLE : les créneaux. Eux seuls ont une heure.
function renderSemaine() {
    var cible = document.getElementById('vue-semaine');
    if (!cible) return;

    var ajd = aujourdhui();
    var jours = joursDeLaSemaine(lundiAffiche);
    // La plage se calcule sur la semaine affichée seulement : une tâche
    // planifiée à 5 h en mars ne doit pas allonger toutes les grilles de
    // l'année.
    var deLaSemaine = taches.filter(function(t) {
        return aUnCreneau(t) && jours.indexOf(t.creneauJour) !== -1;
    });
    var plage = plageHoraire(deLaSemaine);

    cible.innerHTML = barreSemaine(jours, ajd)
        + '<div class="semaine-defilement">'
        +   '<div class="semaine-grille">'
        +     colonneHeures(plage)
        +     jours.map(function(iso) { return colonneJour(iso, ajd, plage); }).join('')
        +   '</div>'
        + '</div>'
        + legendeSemaine();
}

function barreSemaine(jours, ajd) {
    var debut = dateLocale(jours[0]);
    var fin = dateLocale(jours[6]);
    var titre = debut && fin
        ? debut.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
            + ' — ' + fin.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
        : '';

    var nbPlanifiees = jours.reduce(function(total, iso) {
        return total + creneauxDuJour(taches, iso).length;
    }, 0);

    return '<div class="semaine-barre">'
        + '<div class="semaine-nav">'
        +   '<button type="button" class="tache-btn" onclick="semaineDecalee(-7)" title="Semaine précédente">'
        +     '<i class="fa-solid fa-chevron-left"></i></button>'
        +   '<button type="button" class="tache-btn" onclick="semaineAujourdhui()">Cette semaine</button>'
        +   '<button type="button" class="tache-btn" onclick="semaineDecalee(7)" title="Semaine suivante">'
        +     '<i class="fa-solid fa-chevron-right"></i></button>'
        + '</div>'
        + '<div class="semaine-titre">' + escapeHtml(titre)
        +   '<span class="semaine-compte">' + nbPlanifiees + ' créneau' + (nbPlanifiees > 1 ? 'x' : '') + '</span>'
        + '</div>'
        + '</div>';
}

function legendeSemaine() {
    return '<p class="semaine-legende">'
        + '<i class="fa-solid fa-hand-pointer"></i> '
        + 'Cliquez une case vide pour y poser une tâche. '
        + 'Les <strong>échéances</strong> sont en haut de colonne, hors des heures : '
        + 'ce sont des contraintes, pas des rendez-vous.'
        + '</p>';
}

function semaineDecalee(jours) {
    lundiAffiche = ajouterJours(lundiAffiche, jours);
    renderSemaine();
}

function semaineAujourdhui() {
    lundiAffiche = lundiDeLaSemaine(aujourdhui());
    renderSemaine();
}

function colonneHeures(plage) {
    var lignes = '';
    for (var minutes = plage.debut; minutes < plage.fin; minutes += 60) {
        lignes += '<div class="semaine-heure" style="height:' + HAUTEUR_HEURE + 'px">'
            + '<span>' + escapeHtml(heureDeMinutes(minutes)) + '</span></div>';
    }
    return '<div class="semaine-colonne semaine-colonne--heures">'
        + '<div class="semaine-entete"></div>'
        + '<div class="semaine-bandeau"></div>'
        + '<div class="semaine-heures">' + lignes + '</div>'
        + '</div>';
}

function colonneJour(iso, ajd, plage) {
    var estAujourdhui = (iso === ajd);
    var hauteur = ((plage.fin - plage.debut) / 60) * HAUTEUR_HEURE;

    // Les cases cliquables sous les blocs : une par heure. Une case par
    // demi-heure doublerait le nombre de boutons pour un gain nul, la
    // modale de pose laissant de toute façon choisir l'heure exacte.
    var cases = '';
    for (var minutes = plage.debut; minutes < plage.fin; minutes += 60) {
        cases += '<button type="button" class="semaine-case"'
            + ' style="height:' + HAUTEUR_HEURE + 'px"'
            + ' onclick="ouvrirChoixTache(\'' + jsAttr(iso) + '\', \'' + jsAttr(heureDeMinutes(minutes)) + '\')"'
            + ' title="' + escapeAttr('Poser une tâche le ' + libelleJourCourt(iso)
                + ' à ' + heureDeMinutes(minutes)) + '"></button>';
    }

    var blocs = repartirEnVoies(creneauxDuJour(taches, iso))
        .map(function(element) { return blocCreneau(element, plage); })
        .join('');

    return '<div class="semaine-colonne' + (estAujourdhui ? ' semaine-colonne--aujourdhui' : '') + '">'
        + '<div class="semaine-entete">' + escapeHtml(libelleJourCourt(iso)) + '</div>'
        + '<div class="semaine-bandeau">' + bandeauEcheances(iso) + '</div>'
        + '<div class="semaine-heures" style="height:' + hauteur + 'px">'
        +   cases
        +   blocs
        + '</div>'
        + '</div>';
}

// Les échéances du jour, en pastilles au-dessus de la grille. Une tâche
// dont l'échéance tombe ici mais dont le créneau est ailleurs apparaît
// donc aux deux endroits : c'est justement ce qu'on veut voir.
function bandeauEcheances(iso) {
    var lignes = echeancesDuJour(taches, iso);
    if (!lignes.length) return '';

    return lignes.map(function(tache) {
        var classe = 'semaine-echeance';
        if (tache.important) classe += ' semaine-echeance--important';
        if (planifieApresEcheance(tache)) classe += ' semaine-echeance--debordee';
        return '<button type="button" class="' + classe + '"'
            + ' onclick="ouvrirModale(\'' + jsAttr(tache.id) + '\')"'
            + ' title="' + escapeAttr(infobulleEcheance(tache)) + '">'
            + '<i class="fa-solid fa-flag-checkered"></i> ' + escapeHtml(tache.titre || '(sans titre)')
            + '</button>';
    }).join('');
}

function infobulleEcheance(tache) {
    var texte = 'Échéance : ' + formatEcheance(tache.echeance);
    if (!aUnCreneau(tache)) return texte + ' — aucun créneau posé.';
    if (planifieApresEcheance(tache)) {
        return texte + ' — mais le créneau est le ' + formatEcheance(tache.creneauJour) + ', après.';
    }
    return texte + ' — créneau le ' + formatEcheance(tache.creneauJour) + ' à ' + tache.creneauHeure + '.';
}

function blocCreneau(element, plage) {
    var tache = element.tache;
    var haut = ((element.debut - plage.debut) / 60) * HAUTEUR_HEURE;
    var hauteur = Math.max(18, ((element.fin - element.debut) / 60) * HAUTEUR_HEURE);
    var largeur = 100 / element.nbVoies;

    var classe = 'semaine-bloc';
    if (tache.faite) classe += ' semaine-bloc--faite';
    else if (creneauManque(tache, aujourdhui(), heureCourante())) classe += ' semaine-bloc--manque';
    else if (tache.important) classe += ' semaine-bloc--important';
    if (planifieApresEcheance(tache)) classe += ' semaine-bloc--debordee';

    return '<button type="button" class="' + classe + '"'
        + ' style="top:' + haut + 'px;height:' + hauteur + 'px;'
        +   'left:' + (element.voie * largeur) + '%;width:' + largeur + '%"'
        + ' onclick="ouvrirModale(\'' + jsAttr(tache.id) + '\')"'
        + ' title="' + escapeAttr(infobulleCreneau(tache, element)) + '">'
        + '<span class="semaine-bloc-heure">' + escapeHtml(heureDeMinutes(element.debut)) + '</span>'
        + '<span class="semaine-bloc-titre">' + escapeHtml(tache.titre || '(sans titre)') + '</span>'
        + '</button>';
}

function infobulleCreneau(tache, element) {
    var texte = heureDeMinutes(element.debut) + ' – ' + heureDeMinutes(element.fin)
        + ' · ' + (tache.titre || '(sans titre)');
    if (isoValide(tache.echeance)) {
        texte += '\nÉchéance : ' + formatEcheance(tache.echeance);
        if (planifieApresEcheance(tache)) texte += ' — le créneau est APRÈS.';
    }
    return texte;
}

// L'heure courante, pour savoir si un créneau est passé. Isolée dans sa
// propre fonction pour que les tests puissent la piloter, comme
// `aujourdhui()`.
function heureCourante() {
    var maintenant = new Date();
    var h = String(maintenant.getHours());
    var m = String(maintenant.getMinutes());
    if (h.length < 2) h = '0' + h;
    if (m.length < 2) m = '0' + m;
    return h + ':' + m;
}

// ------------------------------------------------------------
// 8. Poser une tâche sur un créneau
// ------------------------------------------------------------
// Clic pour placer, et non glisser-déposer : le glisser tient mal au
// doigt — or c'est sur le téléphone qu'on replanifie —, et il serait
// intestable hors navigateur.
function ouvrirChoixTache(jour, heure) {
    creneauEnCours = { jour: jour, heure: heure };

    var candidates = taches.filter(function(t) { return !t.faite && !aUnCreneau(t); });
    var ajd = aujourdhui();
    // Le même ordre que la liste : ce qui brûle en premier, sinon on
    // planifierait au hasard de l'ordre de Firestore.
    var rangement = rangerParBloc(candidates, ajd);
    var ordonnees = rangement.retard.concat(rangement.urgent, rangement.important, rangement.reste);

    document.getElementById('choix-creneau').textContent =
        libelleJourCourt(jour) + ' à ' + heure;

    var liste = document.getElementById('choix-liste');
    liste.innerHTML = ordonnees.length
        ? ordonnees.map(function(tache) {
            var bouts = [];
            if (isoValide(tache.echeance)) {
                bouts.push(estEnRetard(tache, ajd)
                    ? '<span class="badge badge-retard">en retard</span>'
                    : '<span class="badge">' + escapeHtml(libelleEcheance(tache.echeance, ajd)) + '</span>');
            }
            if (tache.important) bouts.push('<span class="badge badge-important">important</span>');
            return '<button type="button" class="choix-item"'
                + ' onclick="planifierTache(\'' + jsAttr(tache.id) + '\')">'
                + '<span class="choix-item-titre">' + escapeHtml(tache.titre || '(sans titre)') + '</span>'
                + '<span class="choix-item-meta">' + bouts.join(' ') + '</span>'
                + '</button>';
        }).join('')
        : '<p class="bloc-vide">Aucune tâche à placer : tout ce qui reste ouvert a déjà son créneau.</p>';

    document.getElementById('choix-overlay').style.display = 'flex';
}

function fermerChoixTache() {
    document.getElementById('choix-overlay').style.display = 'none';
    creneauEnCours = null;
}

function planifierTache(id) {
    if (!creneauEnCours) return;
    var jour = creneauEnCours.jour;
    var heure = creneauEnCours.heure;
    fermerChoixTache();

    ecrire(id, {
        creneauJour: jour,
        creneauHeure: heure,
        creneauDuree: DUREE_DEFAUT
    }, 'Placée ' + libelleJourCourt(jour) + ' à ' + heure + '.');
}

// Déplanifier n'est PAS reporter : on retire une décision, on ne
// repousse pas une contrainte. Le compteur de reports ne bouge donc pas.
function deplanifierTache(id) {
    ecrire(id, { creneauJour: '', creneauHeure: '', creneauDuree: 0 }, 'Créneau retiré.');
}

// ------------------------------------------------------------
// 9. Clôture et report
// ------------------------------------------------------------
function trouverTache(id) {
    for (var i = 0; i < taches.length; i++) {
        if (taches[i].id === id) return taches[i];
    }
    return null;
}

function cloturerTache(id) {
    ecrire(id, {
        faite: true,
        faiteLe: aujourdhui()
    }, 'Tâche réglée.');
}

function rouvrirTache(id) {
    // `faiteLe` est vidé plutôt que gardé : une tâche rouverte n'a pas
    // de date de clôture, et laisser l'ancienne ferait dire au badge
    // qu'elle est faite alors qu'elle est de retour dans la liste.
    ecrire(id, { faite: false, faiteLe: '' }, 'Tâche rouverte.');
}

// Repousse à aujourd'hui + `jours`. Passe par `champsDeReport()`, qui
// décide seul si le compteur s'incrémente.
function reporterA(id, jours) {
    var tache = trouverTache(id);
    if (!tache) return;
    var champs = champsDeReport(tache, ajouterJours(aujourdhui(), jours));
    ecrire(id, champs, champs.nbReports > (tache.nbReports || 0)
        ? 'Reportée — ' + champs.nbReports + 'e report.'
        : 'Échéance mise à jour.');
}

function ecrire(id, donnees, message) {
    donnees.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    db.collection('taches').doc(id).update(donnees)
        .then(function() {
            if (message) showToast(message, 'success');
        })
        .catch(function(erreur) {
            console.error(erreur);
            showToast('Enregistrement impossible : ' + erreur.message, 'error');
        });
}

// ------------------------------------------------------------
// 10. Modale
// ------------------------------------------------------------
// Les sujets proposables : les projets du hub ET les sites, filtrés par
// les droits. Même mécanique qu'au carnet d'idées, et pour la même
// raison — on ne range une tâche que sous ce à quoi on a accès. C'est le
// LIBELLÉ qui est stocké, pas le slug, pour rester lisible dans l'export.
function sujetsAutorises() {
    var sujets = [];
    PROJETS.forEach(function(p) {
        if (aAcces(p.slug)) sujets.push({ groupe: 'Projets du hub', valeur: p.nom });
    });
    if (typeof SITES !== 'undefined') {
        SITES.forEach(function(s) {
            if (aAccesSite(s.slug)) sujets.push({ groupe: 'Sites', valeur: s.nom });
        });
    }
    return sujets;
}

function remplirSelectProjet(valeurCourante) {
    var select = document.getElementById('f-projet');
    if (!select) return;

    var sujets = sujetsAutorises();
    var groupes = [];
    var parGroupe = {};
    sujets.forEach(function(sujet) {
        if (!parGroupe[sujet.groupe]) { parGroupe[sujet.groupe] = []; groupes.push(sujet.groupe); }
        parGroupe[sujet.groupe].push(sujet.valeur);
    });

    var html = '<option value="">— aucun —</option>';
    groupes.forEach(function(groupe) {
        html += '<optgroup label="' + escapeAttr(groupe) + '">';
        parGroupe[groupe].forEach(function(valeur) {
            html += '<option value="' + escapeAttr(valeur) + '">' + escapeHtml(valeur) + '</option>';
        });
        html += '</optgroup>';
    });

    // Un projet retiré du registre, ou un droit perdu, ne doit pas
    // effacer en silence le rangement d'une tâche existante.
    var connue = sujets.some(function(sujet) { return sujet.valeur === valeurCourante; });
    if (valeurCourante && !connue) {
        html += '<optgroup label="Hérité"><option value="' + escapeAttr(valeurCourante) + '">'
             + escapeHtml(valeurCourante) + '</option></optgroup>';
    }

    select.innerHTML = html;
    select.value = valeurCourante || '';
}

// L'heure se saisit en DEUX listes fermées : les 24 heures d'un côté,
// les quatre quarts de l'autre. Un `<input type="time">` acceptait
// n'importe quelle minute et ouvrait, selon le navigateur, la liste des
// soixante — imprenable au doigt, pour une précision qu'on n'a pas.
function remplirSelectsHeure(valeurCourante) {
    var selectH = document.getElementById('f-creneau-h');
    var selectM = document.getElementById('f-creneau-m');
    if (!selectH || !selectM) return;

    // Nouvelle tâche : l'heure pleine suivante. Le jour, lui, reste
    // vide — c'est le jour qui crée le créneau, pas l'heure.
    var heure = heureValide(valeurCourante) ? valeurCourante : heurePleineSuivante(heureCourante());
    var bouts = heure.split(':');

    var htmlH = '';
    for (var h = 0; h < 24; h++) {
        var hh = (h < 10 ? '0' : '') + h;
        htmlH += '<option value="' + hh + '">' + hh + '</option>';
    }
    selectH.innerHTML = htmlH;
    selectH.value = bouts[0];

    // Une minute héritée — saisie du temps de l'`<input type="time">`,
    // ou venue d'un import — ne doit pas se faire arrondir en silence à
    // la simple ouverture de la modale. On l'ajoute plutôt que de la
    // perdre, comme la liste des projets le fait déjà.
    var htmlM = MINUTES_CRENEAU.map(function(mm) {
        return '<option value="' + mm + '">' + mm + '</option>';
    }).join('');
    if (MINUTES_CRENEAU.indexOf(bouts[1]) === -1) {
        htmlM += '<option value="' + escapeAttr(bouts[1]) + '">' + escapeHtml(bouts[1]) + '</option>';
    }
    selectM.innerHTML = htmlM;
    selectM.value = bouts[1];
}

function heureSaisie() {
    var selectH = document.getElementById('f-creneau-h');
    var selectM = document.getElementById('f-creneau-m');
    if (!selectH || !selectM) return '';
    return selectH.value + ':' + selectM.value;
}

// Durées en liste fermée : personne ne planifie 37 minutes, et un champ
// libre inviterait à une précision qu'on n'a pas.
function remplirSelectDuree(valeurCourante) {
    var select = document.getElementById('f-creneau-duree');
    if (!select) return;
    select.innerHTML = DUREES.map(function(minutes) {
        return '<option value="' + minutes + '">' + escapeHtml(libelleDuree(minutes)) + '</option>';
    }).join('');
    select.value = String(valeurCourante || DUREE_DEFAUT);
}

function libelleDuree(minutes) {
    if (minutes < 60) return minutes + ' min';
    var heures = Math.floor(minutes / 60);
    var reste = minutes % 60;
    return heures + ' h' + (reste ? String(reste) : '');
}

function ouvrirModale(id) {
    idEnEdition = id || null;
    var tache = id ? trouverTache(id) : null;

    document.getElementById('modal-title').textContent = tache ? 'Modifier la tâche' : 'Nouvelle tâche';
    document.getElementById('f-titre').value        = tache ? (tache.titre || '') : '';
    document.getElementById('f-detail').value       = tache ? (tache.detail || '') : '';
    document.getElementById('f-important').value    = (tache && tache.important) ? 'oui' : 'non';
    document.getElementById('f-echeance').value     = (tache && isoValide(tache.echeance)) ? tache.echeance : '';
    document.getElementById('f-urgent-force').checked = !!(tache && tache.urgentForce);
    document.getElementById('f-creneau-jour').value = (tache && isoValide(tache.creneauJour)) ? tache.creneauJour : '';
    remplirSelectsHeure(tache ? tache.creneauHeure : '');
    remplirSelectDuree(tache ? dureeCreneau(tache) : DUREE_DEFAUT);
    remplirSelectProjet(tache ? (tache.projet || '') : '');

    var meta = document.getElementById('f-meta');
    if (tache) {
        var texte = 'Créée le ' + formatDateFr(tache.createdAt);
        if (tache.nbReports) texte += ' — ' + titreReports(tache).toLowerCase();
        if (planifieApresEcheance(tache)) {
            texte += ' — ⚠ le créneau est posé APRÈS l\'échéance.';
        }
        meta.textContent = texte;
        meta.style.display = 'block';
    } else {
        meta.style.display = 'none';
    }

    document.getElementById('btn-delete').style.display = tache ? '' : 'none';
    document.getElementById('modal-overlay').style.display = 'flex';
    document.getElementById('f-titre').focus();
}

function fermerModale() {
    document.getElementById('modal-overlay').style.display = 'none';
    idEnEdition = null;
}

function sauverTache() {
    var titre = document.getElementById('f-titre').value.trim();
    if (!titre) {
        showToast('Le titre est obligatoire.', 'error');
        document.getElementById('f-titre').focus();
        return;
    }

    var echeance = document.getElementById('f-echeance').value;

    // C'EST LE JOUR QUI CRÉE LE CRÉNEAU. Les deux listes d'heure ont
    // toujours une valeur — il n'existe donc plus de « jour sans heure »
    // à refuser. Sans jour, en revanche, l'heure ne veut rien dire et
    // n'est pas écrite : un jour sans heure serait une seconde échéance
    // déguisée, exactement la confusion qu'on évite.
    var creneauJour = document.getElementById('f-creneau-jour').value;
    var creneauHeure = heureSaisie();
    var creneauComplet = isoValide(creneauJour) && heureValide(creneauHeure);
    if (creneauJour && !creneauComplet) {
        showToast('Ce créneau n\'est pas lisible : vérifiez le jour et l\'heure.', 'error');
        return;
    }

    var donnees = {
        titre:        titre,
        detail:       document.getElementById('f-detail').value.trim(),
        projet:       document.getElementById('f-projet').value.trim(),
        important:    document.getElementById('f-important').value === 'oui',
        urgentForce:  document.getElementById('f-urgent-force').checked,
        creneauJour:  creneauComplet ? creneauJour : '',
        creneauHeure: creneauComplet ? creneauHeure : '',
        creneauDuree: creneauComplet ? Number(document.getElementById('f-creneau-duree').value) || DUREE_DEFAUT : 0,
        updatedAt:    firebase.firestore.FieldValue.serverTimestamp()
    };

    var operation;
    if (idEnEdition) {
        // Déplacer la date à la main est un report comme un autre : sans
        // ça, il suffirait de passer par la modale pour repousser sans
        // que le compteur ne s'en aperçoive.
        var existante = trouverTache(idEnEdition);
        var champs = champsDeReport(existante, echeance);
        donnees.echeance = champs.echeance;
        donnees.nbReports = champs.nbReports;
        if (champs.echeanceInitiale) donnees.echeanceInitiale = champs.echeanceInitiale;
        operation = db.collection('taches').doc(idEnEdition).update(donnees);
    } else {
        donnees.echeance = isoValide(echeance) ? echeance : '';
        donnees.faite = false;
        donnees.faiteLe = '';
        donnees.nbReports = 0;
        donnees.creePar = moiReel();
        donnees.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        operation = db.collection('taches').add(donnees);
    }

    operation
        .then(function() {
            showToast(idEnEdition ? 'Tâche mise à jour.' : 'Tâche ajoutée.', 'success');
            fermerModale();
        })
        .catch(function(erreur) {
            console.error(erreur);
            showToast('Enregistrement impossible : ' + erreur.message, 'error');
        });
}

// ------------------------------------------------------------
// 11. Suppression
// ------------------------------------------------------------
function ouvrirModaleSuppression() {
    document.getElementById('delete-overlay').style.display = 'flex';
}

function fermerModaleSuppression() {
    document.getElementById('delete-overlay').style.display = 'none';
}

function confirmerSuppression() {
    if (!idEnEdition) return;
    db.collection('taches').doc(idEnEdition).delete()
        .then(function() {
            showToast('Tâche supprimée.', 'success');
            fermerModaleSuppression();
            fermerModale();
        })
        .catch(function(erreur) {
            console.error(erreur);
            showToast('Suppression impossible : ' + erreur.message, 'error');
        });
}

// ------------------------------------------------------------
// 12. Export JSON (le filet de sauvegarde)
// ------------------------------------------------------------
// Firestore sur le plan gratuit n'offre ni sauvegarde automatique ni
// restauration à un instant T. Ce bouton est la seule protection contre
// une suppression malencontreuse : il exporte TOUT, filtres ignorés,
// une sauvegarde partielle étant un faux filet.
function exporterJson() {
    if (!taches.length) {
        showToast('Aucune tâche à exporter.', 'error');
        return;
    }

    var ajd = aujourdhui();
    var triees = taches.slice().sort(comparerDansBloc);

    var contenu = {
        exporte_le: new Date().toISOString(),
        source: window.location.hostname + ' — collection Firestore « taches »',
        nombre: triees.length,
        taches: triees.map(function(t) {
            var c = toDate(t.createdAt), u = toDate(t.updatedAt);
            return {
                id:               t.id,
                titre:            t.titre || '',
                detail:           t.detail || '',
                projet:           t.projet || '',
                important:        !!t.important,
                urgentForce:      !!t.urgentForce,
                echeance:         t.echeance || '',
                echeanceInitiale: t.echeanceInitiale || '',
                creneauJour:      t.creneauJour || '',
                creneauHeure:     t.creneauHeure || '',
                creneauDuree:     t.creneauDuree || 0,
                nbReports:        t.nbReports || 0,
                faite:            !!t.faite,
                faiteLe:          t.faiteLe || '',
                // Le bloc calculé part aussi : relire un export un an
                // plus tard sans lui demanderait de rejouer le calcul de
                // tête, avec la mauvaise date du jour.
                bloc:             blocDe(t, ajd),
                creePar:          t.creePar || '',
                createdAt:        c ? c.toISOString() : null,
                updatedAt:        u ? u.toISOString() : null
            };
        })
    };

    var blob = new Blob([JSON.stringify(contenu, null, 2)], { type: 'application/json;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'taches-ofildudoubs-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);

    showToast(triees.length + ' tâche' + (triees.length > 1 ? 's' : '') + ' exportée'
        + (triees.length > 1 ? 's' : '') + '.', 'success');
}

// ------------------------------------------------------------
// 13. Raccourcis clavier
// ------------------------------------------------------------
document.addEventListener('keydown', function(evenement) {
    if (evenement.key !== 'Escape') return;
    // Du plus profond au plus superficiel : Échap ne doit fermer qu'une
    // couche à la fois.
    if (document.getElementById('delete-overlay').style.display === 'flex') {
        fermerModaleSuppression();
    } else if (document.getElementById('modal-overlay').style.display === 'flex') {
        fermerModale();
    } else if (document.getElementById('choix-overlay').style.display === 'flex') {
        fermerChoixTache();
    }
});
