// ============================================================
// idees.js — Carnet d'idées / projets
// ============================================================
// Collection Firestore « idees ». Un document = une idée :
//   numero      int     numéro lisible (#7), attribué à la création
//   titre       string  obligatoire
//   detail      string  texte libre
//   projet      string  texte libre (datalist de suggestions)
//   importance  string  haute | normale | basse
//   complexite  string  '' | S | M | L
//   etat        string  voir ETATS ci-dessous
//   creePar     string  email de l'auteur — titre de propriété
//   createdAt   timestamp serveur
//   updatedAt   timestamp serveur
//
// Écoute temps réel (onSnapshot) : une idée saisie sur le
// téléphone apparaît sur le PC sans rechargement.
//
// CARNET COMMUN, ÉCRITURE PERSONNELLE. Tout le monde lit tout — c'est
// le but, et c'est le propriétaire qui lit les idées des autres pour les
// mettre en place. En écriture, chacun ne touche qu'aux siennes ; le
// superadmin corrige tout, puisque c'est lui qui trie et met en œuvre.
// La lecture n'étant pas cloisonnée, aucun `where` n'est nécessaire —
// contrairement à la page Comptes du site Collections.
//
// Le champ « projet » n'est plus du texte libre : c'est une liste fermée,
// construite depuis PROJETS et SITES et filtrée par les droits. On ne
// note une idée que sur ce à quoi on a accès.
// ============================================================

// ------------------------------------------------------------
// 1. Référentiels
// ------------------------------------------------------------
var ETATS = [
    { value: 'idee',       label: 'Idée',        color: '#1976D2' },
    { value: 'a_creuser',  label: 'À creuser',   color: '#EF6C00' },
    { value: 'a_faire',    label: 'À faire',     color: '#6A1B9A' },
    { value: 'en_cours',   label: 'En cours',    color: '#00838F' },
    { value: 'faite',      label: 'Faite',       color: '#2E7D32' },
    { value: 'abandonnee', label: 'Abandonnée',  color: '#757575' }
];
var ETATS_ACTIFS = ['idee', 'a_creuser', 'a_faire', 'en_cours'];
var ETATS_CLOS   = ['faite', 'abandonnee'];

var IMPORTANCE_LABELS = { haute: 'Haute', normale: 'Normale', basse: 'Basse' };
var IMPORTANCE_ORDER  = { haute: 0, normale: 1, basse: 2 };
var COMPLEXITE_ORDER  = { 'S': 0, 'M': 1, 'L': 2, '': 3 };

function getEtatDef(value) {
    for (var i = 0; i < ETATS.length; i++) {
        if (ETATS[i].value === value) return ETATS[i];
    }
    return { value: value, label: value, color: '#757575' };
}

function getEtatIndex(etat) {
    for (var i = 0; i < ETATS.length; i++) {
        if (ETATS[i].value === etat) return i;
    }
    return ETATS.length;
}

// ------------------------------------------------------------
// 2. État de la page
// ------------------------------------------------------------
var db = null;
var idees = [];
var filtreEtat = 'actives';
var filtreProjet = 'tous';
var filtreAuteur = 'toutes';
var tri = { cle: 'quickwin', sens: 1 };
var idEnEdition = null;
var premierChargement = true;
var ideesSansAuteur = [];

// ------------------------------------------------------------
// 3. Démarrage (appelé par auth.js une fois l'accès validé)
// ------------------------------------------------------------
function onHubReady() {
    db = firebase.firestore();
    remplirSelectEtat();
    ecouterIdees();
}

// ------------------------------------------------------------
// 3b. Qui peut quoi
// ------------------------------------------------------------
// Email de l'auteur d'une écriture : l'utilisateur RÉEL, toujours. La
// règle Firestore compare `creePar` au jeton de l'appelant : inscrire
// l'identité impersonnée ferait échouer la création, et surtout ferait
// mentir la trace.
function moiReel() {
    return normaliserEmail(HUB.user && HUB.user.email);
}

// Le droit de modifier suit en revanche le rôle VU à l'écran, comme le
// menu et les gardes : sous impersonation on montre ce que l'autre
// pourrait faire. Les écritures partent quand même avec le jeton du
// superadmin — c'est le compromis déjà assumé de l'impersonation, qui est
// un aperçu d'interface et pas un bac à sable.
function peutModifier(idee) {
    if (estSuperadmin()) return true;
    var moi = normaliserEmail(HUB.effectif && HUB.effectif.email);
    return !!moi && normaliserEmail(idee.creePar) === moi;
}

// Ce qu'on affiche dans la colonne « Par ». On n'a que l'email : lire le
// nom demanderait l'annuaire des membres, que les règles n'ouvrent qu'au
// superadmin. La partie avant l'arobase suffit à reconnaître quelqu'un,
// et l'adresse complète reste en infobulle.
function auteurCourt(email) {
    var normalise = normaliserEmail(email);
    if (!normalise) return '—';
    return normalise.split('@')[0];
}

// Les sujets proposables : les projets du hub ET les sites, chacun filtré
// par le tableau de droits correspondant. Deux registres parce que le
// vocabulaire des idées puise dans les deux — on note une idée sur
// « Extérieur de la maison » comme sur « Le Fuverat ».
//
// C'est le LIBELLÉ qui est stocké dans `projet`, pas le slug : les idées
// saisies du temps du champ libre portent déjà « O'Fil du Doubs » ou
// « Collections », qui sont exactement les noms des sites. Stocker le slug
// aurait orphelinné toutes ces valeurs d'un coup. Revers de la médaille :
// renommer un `nom` dans un registre orpheline les idées qui s'y
// rattachaient, elles réapparaîtront comme « héritées ».
function sujetsAutorises() {
    var sujets = [];
    PROJETS.forEach(function(p) {
        if (aAcces(p.slug)) sujets.push({ groupe: 'Projets du hub', valeur: p.nom });
    });
    // sites.js n'est pas chargé partout : on ne suppose pas sa présence.
    if (typeof SITES !== 'undefined') {
        SITES.forEach(function(s) {
            if (aAccesSite(s.slug)) sujets.push({ groupe: 'Sites', valeur: s.nom });
        });
    }
    return sujets;
}

function remplirSelectEtat() {
    var select = document.getElementById('f-etat');
    if (!select) return;
    select.innerHTML = ETATS.map(function(e) {
        return '<option value="' + e.value + '">' + escapeHtml(e.label) + '</option>';
    }).join('');
}

function ecouterIdees() {
    db.collection('idees').onSnapshot(function(snapshot) {
        idees = [];
        snapshot.forEach(function(doc) {
            var data = doc.data();
            data.id = doc.id;
            idees.push(data);
        });
        premierChargement = false;
        signalerIdeesSansAuteur();
        renderFiltres();
        renderIdees();
    }, function(erreur) {
        console.error('Erreur Firestore :', erreur);
        var liste = document.getElementById('idees-list');
        if (liste) {
            liste.innerHTML = '<div class="error-block">' +
                '<i class="fa-solid fa-circle-exclamation"></i>' +
                '<strong>Impossible de lire les idées.</strong><br>' +
                '<span style="color:var(--color-text-muted)">' + escapeHtml(erreur.message) + '</span>' +
                '</div>';
        }
    });
}

// ------------------------------------------------------------
// 4. Utilitaires
// ------------------------------------------------------------
// escapeAttr, jsAttr, toDate et formatDateFr vivent maintenant dans
// ../hub-utils.js, chargé juste avant ce fichier. Elles en étaient à
// leur troisième copie : celle-ci a été supprimée, pas déplacée.
// escapeHtml et showToast viennent, elles, de auth.js.

function estQuickWin(idee) {
    return idee.importance === 'haute' && idee.complexite === 'S';
}

// Les idées d'avant l'arrivée de « creePar » n'ont pas d'auteur : la
// colonne affiche « — » et, surtout, leurs règles refusent la
// modification à tout le monde sauf au superadmin. Comme il était seul à
// écrire jusqu'ici, elles sont toutes à lui : un bouton suffit.
//
// Contrairement aux fiches fournisseurs, ces idées restent VISIBLES
// (la lecture n'est pas cloisonnée) — le rattrapage sert à rendre la
// colonne honnête et à débloquer leur modification, pas à les retrouver.
function signalerIdeesSansAuteur() {
    var bloc = document.getElementById('sans-auteur');
    if (!bloc) return;

    ideesSansAuteur = idees.filter(function(idee) { return !idee.creePar; })
        .map(function(idee) { return idee.id; });

    if (!ideesSansAuteur.length || !estSuperadminReel()) {
        bloc.style.display = 'none';
        return;
    }
    var nb = ideesSansAuteur.length;
    bloc.innerHTML = '<i class="fa-solid fa-user-pen"></i>'
        + '<div><strong>' + nb + ' idée' + (nb > 1 ? 's' : '') + ' sans auteur.</strong> '
        + 'Saisie' + (nb > 1 ? 's' : '') + ' avant le suivi des auteurs, '
        + (nb > 1 ? 'elles ne sont modifiables' : 'elle n\'est modifiable')
        + ' que par vous.'
        + '<button type="button" class="btn-ajout-auteur" onclick="adopterIdeesSansAuteur()">'
        + 'Me ' + (nb > 1 ? 'les' : 'l\'') + ' attribuer</button></div>';
    bloc.style.display = '';
}

function adopterIdeesSansAuteur() {
    if (!ideesSansAuteur.length) return;
    var lot = db.batch();
    ideesSansAuteur.forEach(function(id) {
        lot.update(db.collection('idees').doc(id), { creePar: moiReel() });
    });
    lot.commit().then(function() {
        showToast(ideesSansAuteur.length + ' idée(s) reprise(s).', 'success');
    }).catch(function(erreur) {
        console.error(erreur);
        showToast('Reprise impossible : ' + erreur.message, 'error');
    });
}

// ------------------------------------------------------------
// 5. Filtres
// ------------------------------------------------------------
function renderFiltres() {
    var wrapAuteur = document.getElementById('auteur-filter');
    if (wrapAuteur) {
        var nbMiennes = idees.filter(peutModifier).length;
        // Un carnet à une seule personne n'a pas besoin de ce filtre.
        if (nbMiennes === idees.length) {
            wrapAuteur.innerHTML = '';
            filtreAuteur = 'toutes';
        } else {
            wrapAuteur.innerHTML = boutonFiltre('auteur', 'toutes', 'Toutes les idées', idees.length)
                + boutonFiltre('auteur', 'miennes', 'Les miennes', nbMiennes);
        }
    }

    var wrapEtat = document.getElementById('etat-filter');
    if (wrapEtat) {
        var comptes = {};
        var nbActives = 0;
        idees.forEach(function(i) {
            comptes[i.etat] = (comptes[i.etat] || 0) + 1;
            if (ETATS_ACTIFS.indexOf(i.etat) !== -1) nbActives++;
        });
        var html = boutonFiltre('etat', 'actives', 'Actives', nbActives);
        ETATS.forEach(function(e) {
            html += boutonFiltre('etat', e.value, e.label, comptes[e.value] || 0);
        });
        html += boutonFiltre('etat', 'toutes', 'Toutes', idees.length);
        wrapEtat.innerHTML = html;
    }

    var wrapProjet = document.getElementById('projet-filter');
    if (wrapProjet) {
        var parProjet = {};
        idees.forEach(function(i) {
            var p = i.projet || 'Sans projet';
            parProjet[p] = (parProjet[p] || 0) + 1;
        });
        var projets = Object.keys(parProjet).sort();
        if (projets.length < 2) {
            wrapProjet.innerHTML = '';
            filtreProjet = 'tous';
            return;
        }
        var htmlP = boutonFiltre('projet', 'tous', 'Tous les projets', idees.length);
        projets.forEach(function(p) {
            htmlP += boutonFiltre('projet', p, p, parProjet[p]);
        });
        wrapProjet.innerHTML = htmlP;
    }
}

function boutonFiltre(type, valeur, libelle, compte) {
    var courant = filtreEtat;
    var fn = 'filtrerParEtat';
    if (type === 'projet') { courant = filtreProjet; fn = 'filtrerParProjet'; }
    else if (type === 'auteur') { courant = filtreAuteur; fn = 'filtrerParAuteur'; }
    var actif = (courant === valeur) ? ' active' : '';
    return '<button type="button" class="filter-btn' + actif + '" onclick="' + fn + '(\'' + jsAttr(valeur) + '\')">'
        + escapeHtml(libelle) + ' (' + compte + ')</button>';
}

function filtrerParEtat(valeur) {
    filtreEtat = valeur;
    renderFiltres();
    renderIdees();
}

function filtrerParProjet(valeur) {
    filtreProjet = valeur;
    renderFiltres();
    renderIdees();
}

function filtrerParAuteur(valeur) {
    filtreAuteur = valeur;
    renderFiltres();
    renderIdees();
}

function clearSearch() {
    var input = document.getElementById('search-input');
    if (input) input.value = '';
    renderIdees();
}

function getIdeesFiltrees() {
    var input = document.getElementById('search-input');
    var terme = input ? input.value.trim().toLowerCase() : '';
    var boutonClear = document.getElementById('search-clear');
    if (boutonClear) boutonClear.style.display = terme ? '' : 'none';

    return idees.filter(function(i) {
        if (filtreAuteur === 'miennes' && !peutModifier(i)) return false;
        if (filtreEtat === 'actives') {
            if (ETATS_ACTIFS.indexOf(i.etat) === -1) return false;
        } else if (filtreEtat !== 'toutes') {
            if (i.etat !== filtreEtat) return false;
        }
        if (filtreProjet !== 'tous') {
            if ((i.projet || 'Sans projet') !== filtreProjet) return false;
        }
        if (!terme) return true;
        var texte = ((i.titre || '') + ' ' + (i.detail || '') + ' ' + (i.projet || '')
                   + ' ' + (i.creePar || '')).toLowerCase();
        return texte.indexOf(terme) !== -1;
    });
}

// ------------------------------------------------------------
// 6. Tri
// ------------------------------------------------------------
function valeurDeTri(idee, cle) {
    var rangImportance = IMPORTANCE_ORDER[idee.importance] !== undefined ? IMPORTANCE_ORDER[idee.importance] : 1;
    var rangComplexite = COMPLEXITE_ORDER[idee.complexite] !== undefined ? COMPLEXITE_ORDER[idee.complexite] : 3;
    switch (cle) {
        // « Quick wins » : le plus important d'abord, et à importance égale
        // le moins coûteux d'abord. C'est l'ordre par défaut.
        case 'quickwin':   return rangImportance * 4 + rangComplexite;
        case 'importance': return rangImportance;
        case 'complexite': return rangComplexite;
        case 'etat':       return getEtatIndex(idee.etat);
        case 'projet':     return (idee.projet || '').toLowerCase();
        case 'auteur':     return auteurCourt(idee.creePar).toLowerCase();
        case 'numero':     return idee.numero || 0;
        case 'date':       var d = toDate(idee.createdAt); return d ? d.getTime() : 0;
        default:           return 0;
    }
}

function trierPar(cle) {
    if (tri.cle === cle) {
        tri.sens = -tri.sens;
    } else {
        tri.cle = cle;
        tri.sens = (cle === 'date' || cle === 'numero') ? -1 : 1;
    }
    renderIdees();
}

function celluleEntete(cle, libelleHtml, titre) {
    var fleche = '';
    if (tri.cle === cle) {
        fleche = ' <i class="fa-solid fa-caret-' + (tri.sens === 1 ? 'up' : 'down') + '"></i>';
    }
    return '<th class="th-sort" onclick="trierPar(\'' + cle + '\')" title="Trier par ' + escapeAttr(titre) + '">'
        + libelleHtml + fleche + '</th>';
}

// ------------------------------------------------------------
// 7. Rendu
// ------------------------------------------------------------
function renderIdees() {
    var liste = document.getElementById('idees-list');
    var vide = document.getElementById('empty-state');
    var compteur = document.getElementById('result-count');
    if (!liste) return;

    var lignes = getIdeesFiltrees();

    lignes.sort(function(a, b) {
        var va = valeurDeTri(a, tri.cle);
        var vb = valeurDeTri(b, tri.cle);
        if (va < vb) return -tri.sens;
        if (va > vb) return tri.sens;
        // Égalité : la plus récente d'abord
        var da = toDate(a.createdAt), dbb = toDate(b.createdAt);
        return (dbb ? dbb.getTime() : 0) - (da ? da.getTime() : 0);
    });

    if (compteur) {
        compteur.textContent = lignes.length + ' idée' + (lignes.length > 1 ? 's' : '');
    }

    if (lignes.length === 0) {
        liste.innerHTML = '';
        if (vide) vide.style.display = premierChargement ? 'none' : 'block';
        return;
    }
    if (vide) vide.style.display = 'none';

    liste.innerHTML = '<table class="idees-table"><thead><tr>'
        + celluleEntete('numero', 'N°', 'numéro')
        + celluleEntete('etat', 'État', 'état')
        + celluleEntete('quickwin', 'Prio', 'importance puis complexité (quick wins d\'abord)')
        + celluleEntete('complexite', 'Cplx', 'complexité')
        + celluleEntete('projet', 'Projet', 'projet')
        + '<th>Idée</th>'
        + celluleEntete('auteur', 'Par', 'auteur')
        + celluleEntete('date', '<i class="fa-solid fa-calendar-day"></i>', 'date de création')
        + '<th></th>'
        + '</tr></thead><tbody>'
        + lignes.map(renderLigne).join('')
        + '</tbody></table>';
}

function renderLigne(idee) {
    var etatDef = getEtatDef(idee.etat);
    var estClose = (ETATS_CLOS.indexOf(idee.etat) !== -1);
    var idAttr = jsAttr(idee.id);
    var modifiable = peutModifier(idee);

    var optionsEtat = ETATS.map(function(e) {
        return '<option value="' + e.value + '"' + (e.value === idee.etat ? ' selected' : '') + '>'
            + escapeHtml(e.label) + '</option>';
    }).join('');

    var infoDate = 'Créée le ' + formatDateFr(idee.createdAt);
    var dCreate = toDate(idee.createdAt), dUpdate = toDate(idee.updatedAt);
    if (dCreate && dUpdate && dUpdate.toDateString() !== dCreate.toDateString()) {
        infoDate += ' — modifiée le ' + formatDateFr(idee.updatedAt);
    }

    var badgeImportance = estQuickWin(idee)
        ? '<span class="badge badge-quickwin" title="Fort impact, petit effort"><i class="fa-solid fa-bolt"></i>Quick win</span>'
        : '<span class="badge badge-importance--' + escapeAttr(idee.importance || 'normale') + '">'
            + escapeHtml(IMPORTANCE_LABELS[idee.importance] || 'Normale') + '</span>';

    // L'état se change directement dans le tableau — mais seulement sur
    // ses propres idées. Un select grisé dit « pas à vous » sans avoir à
    // l'écrire, et sans laisser cliquer pour rien.
    var selectEtat = '<select class="idee-etat-select" '
        + 'style="border-color:' + etatDef.color + ';color:' + etatDef.color + '" '
        + (modifiable ? '' : 'disabled ')
        + 'onclick="event.stopPropagation()" onchange="changerEtat(\'' + idAttr + '\', this.value)" '
        + 'title="' + (modifiable ? 'Changer l\'état' : 'Idée de quelqu\'un d\'autre') + '">'
        + optionsEtat + '</select>';

    return '<tr class="idee-row' + (estClose ? ' idee-row--close' : '') + '" onclick="ouvrirModale(\'' + idAttr + '\')">'
        + '<td class="idee-num-cell" title="Idée n°' + (idee.numero || '?') + '">#' + (idee.numero || '?') + '</td>'
        + '<td class="idee-etat-cell">' + selectEtat + '</td>'
        + '<td>' + badgeImportance + '</td>'
        + '<td>' + (idee.complexite ? '<span class="badge badge-complexite" title="Complexité estimée">' + escapeHtml(idee.complexite) + '</span>' : '') + '</td>'
        + '<td>' + (idee.projet ? '<span class="badge badge-projet"><i class="fa-solid fa-folder"></i>' + escapeHtml(idee.projet) + '</span>' : '') + '</td>'
        + '<td class="idee-titre-cell">'
        +   '<div class="idee-titre">' + escapeHtml(idee.titre || '(sans titre)') + '</div>'
        +   (idee.detail ? '<div class="idee-detail">' + escapeHtml(idee.detail) + '</div>' : '')
        + '</td>'
        + '<td class="idee-auteur-cell" title="' + escapeAttr(idee.creePar || 'Auteur inconnu') + '">'
        +   escapeHtml(auteurCourt(idee.creePar))
        +   (modifiable && idee.creePar ? ' <i class="fa-solid fa-user-check idee-moi" title="Votre idée"></i>' : '')
        + '</td>'
        + '<td class="idee-date-cell" title="' + escapeAttr(infoDate) + '">' + formatDateFr(idee.createdAt) + '</td>'
        + '<td class="row-actions-cell">'
        +   '<button type="button" class="icon-btn" '
        +   'title="' + (modifiable ? 'Modifier' : 'Consulter — idée de quelqu\'un d\'autre') + '" '
        +   'onclick="event.stopPropagation();ouvrirModale(\'' + idAttr + '\')">'
        +   '<i class="fa-solid fa-' + (modifiable ? 'pen' : 'eye') + '"></i></button>'
        + '</td>'
        + '</tr>';
}

// ------------------------------------------------------------
// 8. Modale
// ------------------------------------------------------------
function trouverIdee(id) {
    for (var i = 0; i < idees.length; i++) {
        if (idees[i].id === id) return idees[i];
    }
    return null;
}

// Remplit la liste fermée des projets. La valeur courante est passée à
// part : une idée d'avant la liste fermée peut porter un libellé qui n'y
// est plus (« stock-watch », « Transverse »…). La perdre en silence au
// premier enregistrement serait pire que de l'afficher comme héritée.
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

    var connue = sujets.some(function(sujet) { return sujet.valeur === valeurCourante; });
    if (valeurCourante && !connue) {
        html += '<optgroup label="Hérité"><option value="' + escapeAttr(valeurCourante) + '">'
             + escapeHtml(valeurCourante) + '</option></optgroup>';
    }

    select.innerHTML = html;
    select.value = valeurCourante || '';
}

// Une idée qui n'est pas la sienne s'ouvre quand même : la lire est utile,
// c'est un carnet commun. Elle s'ouvre juste en lecture.
function appliquerLectureSeule(verrouille) {
    ['f-titre', 'f-detail', 'f-projet', 'f-importance', 'f-complexite', 'f-etat']
        .forEach(function(id) {
            var champ = document.getElementById(id);
            if (champ) champ.disabled = verrouille;
        });

    var enregistrer = document.getElementById('btn-enregistrer');
    if (enregistrer) enregistrer.style.display = verrouille ? 'none' : '';

    var note = document.getElementById('f-lecture-seule');
    if (note) {
        note.textContent = verrouille
            ? 'Lecture seule : cette idée est celle de quelqu\'un d\'autre.'
            : '';
        note.style.display = verrouille ? 'block' : 'none';
    }
}

function ouvrirModale(id) {
    idEnEdition = id || null;
    var idee = id ? trouverIdee(id) : null;
    var modifiable = idee ? peutModifier(idee) : true;

    document.getElementById('modal-title').textContent = idee ? ('Idée n°' + (idee.numero || '?')) : 'Nouvelle idée';
    document.getElementById('f-titre').value      = idee ? (idee.titre || '') : '';
    document.getElementById('f-detail').value     = idee ? (idee.detail || '') : '';
    document.getElementById('f-importance').value = idee ? (idee.importance || 'normale') : 'normale';
    document.getElementById('f-complexite').value = idee ? (idee.complexite || '') : '';
    document.getElementById('f-etat').value       = idee ? (idee.etat || 'idee') : 'idee';
    remplirSelectProjet(idee ? (idee.projet || '') : '');

    var meta = document.getElementById('f-meta');
    if (idee) {
        meta.textContent = 'Créée le ' + formatDateFr(idee.createdAt)
            + (idee.creePar ? ' par ' + idee.creePar : '')
            + (idee.updatedAt ? ' — dernière modification le ' + formatDateFr(idee.updatedAt) : '');
        meta.style.display = 'block';
    } else {
        meta.style.display = 'none';
    }

    appliquerLectureSeule(!modifiable);
    document.getElementById('btn-delete').style.display = (idee && modifiable) ? '' : 'none';
    document.getElementById('modal-overlay').style.display = 'flex';
    if (modifiable) document.getElementById('f-titre').focus();
}

function fermerModale() {
    document.getElementById('modal-overlay').style.display = 'none';
    idEnEdition = null;
}

function prochainNumero() {
    var max = 0;
    idees.forEach(function(i) {
        if (i.numero && i.numero > max) max = i.numero;
    });
    return max + 1;
}

function sauverIdee() {
    // Garde-fou : la modale s'ouvre en lecture seule sur les idées des
    // autres, mais rien n'empêche d'appeler cette fonction autrement. Les
    // règles Firestore refuseraient de toute façon — autant un message
    // clair qu'une erreur de permissions.
    if (idEnEdition) {
        var existante = trouverIdee(idEnEdition);
        if (existante && !peutModifier(existante)) {
            showToast('Cette idée est celle de quelqu\'un d\'autre.', 'error');
            return;
        }
    }

    var titre = document.getElementById('f-titre').value.trim();
    if (!titre) {
        showToast('Le titre est obligatoire.', 'error');
        document.getElementById('f-titre').focus();
        return;
    }

    var donnees = {
        titre:      titre,
        detail:     document.getElementById('f-detail').value.trim(),
        projet:     document.getElementById('f-projet').value.trim(),
        importance: document.getElementById('f-importance').value,
        complexite: document.getElementById('f-complexite').value,
        etat:       document.getElementById('f-etat').value,
        updatedAt:  firebase.firestore.FieldValue.serverTimestamp()
    };

    var operation;
    if (idEnEdition) {
        // `creePar` n'est jamais réécrit : les règles l'interdisent aux
        // membres, et une idée qui change d'auteur en silence serait pire
        // qu'une idée mal rangée.
        operation = db.collection('idees').doc(idEnEdition).update(donnees);
    } else {
        donnees.numero = prochainNumero();
        donnees.creePar = moiReel();
        donnees.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        operation = db.collection('idees').add(donnees);
    }

    operation
        .then(function() {
            showToast(idEnEdition ? 'Idée mise à jour.' : 'Idée ajoutée.', 'success');
            fermerModale();
        })
        .catch(function(erreur) {
            console.error(erreur);
            showToast('Enregistrement impossible : ' + erreur.message, 'error');
        });
}

function changerEtat(id, nouvelEtat) {
    var idee = trouverIdee(id);
    if (idee && !peutModifier(idee)) {
        showToast('Cette idée est celle de quelqu\'un d\'autre.', 'error');
        renderIdees();
        return;
    }
    db.collection('idees').doc(id).update({
        etat: nouvelEtat,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(function(erreur) {
        console.error(erreur);
        showToast('Changement d\'état impossible : ' + erreur.message, 'error');
    });
}

// ------------------------------------------------------------
// 9. Suppression
// ------------------------------------------------------------
function ouvrirModaleSuppression() {
    document.getElementById('delete-overlay').style.display = 'flex';
}

function fermerModaleSuppression() {
    document.getElementById('delete-overlay').style.display = 'none';
}

function confirmerSuppression() {
    if (!idEnEdition) return;
    db.collection('idees').doc(idEnEdition).delete()
        .then(function() {
            showToast('Idée supprimée.', 'success');
            fermerModaleSuppression();
            fermerModale();
        })
        .catch(function(erreur) {
            console.error(erreur);
            showToast('Suppression impossible : ' + erreur.message, 'error');
        });
}

// ------------------------------------------------------------
// 10. Export JSON (le filet de sauvegarde)
// ------------------------------------------------------------
// Firestore sur le plan gratuit n'offre ni sauvegarde automatique, ni
// restauration a un instant T, ni export manage (ca demande Blaze).
// Ce bouton est donc la seule protection contre une suppression
// malencontreuse. Il exporte TOUT, sans tenir compte des filtres
// affiches : une sauvegarde partielle serait un faux filet.
// Meme pattern Blob que l'export CSV de BilletsTouristiques, qui
// fonctionne sous une CSP identique.
function exporterJson() {
    if (!idees.length) {
        showToast('Aucune idée à exporter.', 'error');
        return;
    }

    var triees = idees.slice().sort(function(a, b) {
        return (a.numero || 0) - (b.numero || 0);
    });

    var contenu = {
        exporte_le: new Date().toISOString(),
        source: window.location.hostname + ' — collection Firestore « idees »',
        nombre: triees.length,
        idees: triees.map(function(i) {
            var d = toDate(i.createdAt), u = toDate(i.updatedAt);
            return {
                id:         i.id,
                numero:     i.numero || null,
                titre:      i.titre || '',
                detail:     i.detail || '',
                projet:     i.projet || '',
                importance: i.importance || '',
                complexite: i.complexite || '',
                etat:       i.etat || '',
                creePar:    i.creePar || '',
                // Horodatages en ISO : un Timestamp Firestore brut ne
                // survit pas a JSON.stringify de facon lisible.
                createdAt:  d ? d.toISOString() : null,
                updatedAt:  u ? u.toISOString() : null
            };
        })
    };

    var blob = new Blob([JSON.stringify(contenu, null, 2)], { type: 'application/json;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'idees-ofildudoubs-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);

    showToast(triees.length + ' idée' + (triees.length > 1 ? 's' : '') + ' exportée' + (triees.length > 1 ? 's' : '') + '.', 'success');
}

// ------------------------------------------------------------
// 11. Raccourcis clavier
// ------------------------------------------------------------
document.addEventListener('keydown', function(evenement) {
    if (evenement.key !== 'Escape') return;
    if (document.getElementById('delete-overlay').style.display === 'flex') {
        fermerModaleSuppression();
    } else if (document.getElementById('modal-overlay').style.display === 'flex') {
        fermerModale();
    }
});
