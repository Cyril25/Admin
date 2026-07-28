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
//   createdAt   timestamp serveur
//   updatedAt   timestamp serveur
//
// Écoute temps réel (onSnapshot) : une idée saisie sur le
// téléphone apparaît sur le PC sans rechargement.
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
var tri = { cle: 'quickwin', sens: 1 };
var idEnEdition = null;
var premierChargement = true;

// ------------------------------------------------------------
// 3. Démarrage (appelé par auth.js une fois l'accès validé)
// ------------------------------------------------------------
function onHubReady() {
    db = firebase.firestore();
    remplirSelectEtat();
    ecouterIdees();
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
function escapeAttr(texte) {
    return String(texte == null ? '' : texte)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Chaîne JS littérale placée DANS un attribut HTML (onclick="f('...')").
// Deux couches : d'abord l'échappement JavaScript, ensuite le HTML — et
// surtout PAS l'apostrophe en &#39;, que le navigateur redécode avant de
// parser le JS, ce qui casserait le littéral. Sans ça, un projet nommé
// « O'Fil du Doubs » rend le bouton de filtre inopérant.
function jsAttr(texte) {
    return String(texte == null ? '' : texte)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r?\n/g, '\\n')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Firestore renvoie un Timestamp ; null tant que le serveur n'a pas répondu.
function toDate(valeur) {
    if (!valeur) return null;
    if (typeof valeur.toDate === 'function') return valeur.toDate();
    return new Date(valeur);
}

function formatDateFr(valeur) {
    var date = toDate(valeur);
    if (!date) return '—';
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function estQuickWin(idee) {
    return idee.importance === 'haute' && idee.complexite === 'S';
}

// ------------------------------------------------------------
// 5. Filtres
// ------------------------------------------------------------
function renderFiltres() {
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
    var courant = (type === 'etat') ? filtreEtat : filtreProjet;
    var actif = (courant === valeur) ? ' active' : '';
    var fn = (type === 'etat') ? 'filtrerParEtat' : 'filtrerParProjet';
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
        if (filtreEtat === 'actives') {
            if (ETATS_ACTIFS.indexOf(i.etat) === -1) return false;
        } else if (filtreEtat !== 'toutes') {
            if (i.etat !== filtreEtat) return false;
        }
        if (filtreProjet !== 'tous') {
            if ((i.projet || 'Sans projet') !== filtreProjet) return false;
        }
        if (!terme) return true;
        var texte = ((i.titre || '') + ' ' + (i.detail || '') + ' ' + (i.projet || '')).toLowerCase();
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

    return '<tr class="idee-row' + (estClose ? ' idee-row--close' : '') + '" onclick="ouvrirModale(\'' + idAttr + '\')">'
        + '<td class="idee-num-cell" title="Idée n°' + (idee.numero || '?') + '">#' + (idee.numero || '?') + '</td>'
        + '<td class="idee-etat-cell">'
        +   '<select class="idee-etat-select" style="border-color:' + etatDef.color + ';color:' + etatDef.color + '" '
        +   'onclick="event.stopPropagation()" onchange="changerEtat(\'' + idAttr + '\', this.value)" title="Changer l\'état">'
        +   optionsEtat + '</select>'
        + '</td>'
        + '<td>' + badgeImportance + '</td>'
        + '<td>' + (idee.complexite ? '<span class="badge badge-complexite" title="Complexité estimée">' + escapeHtml(idee.complexite) + '</span>' : '') + '</td>'
        + '<td>' + (idee.projet ? '<span class="badge badge-projet"><i class="fa-solid fa-folder"></i>' + escapeHtml(idee.projet) + '</span>' : '') + '</td>'
        + '<td class="idee-titre-cell">'
        +   '<div class="idee-titre">' + escapeHtml(idee.titre || '(sans titre)') + '</div>'
        +   (idee.detail ? '<div class="idee-detail">' + escapeHtml(idee.detail) + '</div>' : '')
        + '</td>'
        + '<td class="idee-date-cell" title="' + escapeAttr(infoDate) + '">' + formatDateFr(idee.createdAt) + '</td>'
        + '<td class="row-actions-cell">'
        +   '<button type="button" class="icon-btn" title="Modifier" onclick="event.stopPropagation();ouvrirModale(\'' + idAttr + '\')">'
        +   '<i class="fa-solid fa-pen"></i></button>'
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

function ouvrirModale(id) {
    idEnEdition = id || null;
    var idee = id ? trouverIdee(id) : null;

    document.getElementById('modal-title').textContent = idee ? ('Idée n°' + (idee.numero || '?')) : 'Nouvelle idée';
    document.getElementById('f-titre').value      = idee ? (idee.titre || '') : '';
    document.getElementById('f-detail').value     = idee ? (idee.detail || '') : '';
    document.getElementById('f-projet').value     = idee ? (idee.projet || '') : '';
    document.getElementById('f-importance').value = idee ? (idee.importance || 'normale') : 'normale';
    document.getElementById('f-complexite').value = idee ? (idee.complexite || '') : '';
    document.getElementById('f-etat').value       = idee ? (idee.etat || 'idee') : 'idee';

    var meta = document.getElementById('f-meta');
    if (idee) {
        meta.textContent = 'Créée le ' + formatDateFr(idee.createdAt)
            + (idee.updatedAt ? ' — dernière modification le ' + formatDateFr(idee.updatedAt) : '');
        meta.style.display = 'block';
    } else {
        meta.style.display = 'none';
    }

    document.getElementById('btn-delete').style.display = idee ? '' : 'none';
    document.getElementById('modal-overlay').style.display = 'flex';
    document.getElementById('f-titre').focus();
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
        operation = db.collection('idees').doc(idEnEdition).update(donnees);
    } else {
        donnees.numero = prochainNumero();
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
