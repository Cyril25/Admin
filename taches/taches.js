// ============================================================
// taches.js — La page « Mes tâches »
// ============================================================
// Collection Firestore « taches ». Un document = une tâche :
//   titre            string   obligatoire
//   detail           string   texte libre
//   projet           string   libellé, liste fermée (comme le carnet d'idées)
//   important        bool     la seule qualification saisie à la main
//   urgentForce      bool     « urgent tout de suite », pour l'urgence sans date
//   echeance         string   'AAAA-MM-JJ', ou '' si la tâche n'est pas datée
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
var idEnEdition = null;
var premierChargement = true;

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
        renderTaches();
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
            renderTaches();
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

// ------------------------------------------------------------
// 4. Filtres
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
// 5. Rendu
// ------------------------------------------------------------
function renderTaches() {
    var cible = document.getElementById('taches-blocs');
    var vide = document.getElementById('empty-state');
    var compteur = document.getElementById('result-count');
    if (!cible) return;

    var lignes = tachesFiltrees();
    var ajd = aujourdhui();
    var rangement = rangerParBloc(lignes, ajd);

    signalerEnlisement();

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

    boutons += '<button type="button" class="tache-btn" onclick="ouvrirModale(\'' + id + '\')">'
        + '<i class="fa-solid fa-pen"></i> Modifier</button>';

    return '<div class="tache-actions">' + boutons + '</div>';
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
// 6. Clôture et report
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
// 7. Modale
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

function ouvrirModale(id) {
    idEnEdition = id || null;
    var tache = id ? trouverTache(id) : null;

    document.getElementById('modal-title').textContent = tache ? 'Modifier la tâche' : 'Nouvelle tâche';
    document.getElementById('f-titre').value        = tache ? (tache.titre || '') : '';
    document.getElementById('f-detail').value       = tache ? (tache.detail || '') : '';
    document.getElementById('f-important').value    = (tache && tache.important) ? 'oui' : 'non';
    document.getElementById('f-echeance').value     = (tache && isoValide(tache.echeance)) ? tache.echeance : '';
    document.getElementById('f-urgent-force').checked = !!(tache && tache.urgentForce);
    remplirSelectProjet(tache ? (tache.projet || '') : '');

    var meta = document.getElementById('f-meta');
    if (tache) {
        var texte = 'Créée le ' + formatDateFr(tache.createdAt);
        if (tache.nbReports) texte += ' — ' + titreReports(tache).toLowerCase();
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
    var donnees = {
        titre:       titre,
        detail:      document.getElementById('f-detail').value.trim(),
        projet:      document.getElementById('f-projet').value.trim(),
        important:   document.getElementById('f-important').value === 'oui',
        urgentForce: document.getElementById('f-urgent-force').checked,
        updatedAt:   firebase.firestore.FieldValue.serverTimestamp()
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
// 8. Suppression
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
// 9. Export JSON (le filet de sauvegarde)
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
// 10. Raccourcis clavier
// ------------------------------------------------------------
document.addEventListener('keydown', function(evenement) {
    if (evenement.key !== 'Escape') return;
    if (document.getElementById('delete-overlay').style.display === 'flex') {
        fermerModaleSuppression();
    } else if (document.getElementById('modal-overlay').style.display === 'flex') {
        fermerModale();
    }
});
