// ============================================================
// exterieur.js — Sous-projet « Extérieur de la maison »
// ============================================================
// Collection Firestore « exterieur », une tâche par document :
//   titre    string  obligatoire
//   etat     string  a_faire | en_cours | fait
//   periode  string  texte libre (saison, « dès que possible »…)
//   notes    string  texte libre
//   createdAt, updatedAt
//
// Volontairement minimal : cette page existe surtout pour éprouver le
// système de droits de bout en bout. À remplacer par ce que ce
// sous-projet doit vraiment faire.
// ============================================================

var ETATS = [
    { value: 'a_faire',  label: 'À faire',  color: '#EF6C00' },
    { value: 'en_cours', label: 'En cours', color: '#00838F' },
    { value: 'fait',     label: 'Fait',     color: '#2E7D32' }
];

var db = null;
var taches = [];
var filtreEtat = 'ouvertes';
var idEnEdition = null;
var premierChargement = true;

// ------------------------------------------------------------
// 1. Démarrage
// ------------------------------------------------------------
function onHubReady() {
    db = firebase.firestore();
    remplirSelectEtat();
    ecouterTaches();
}

function remplirSelectEtat() {
    var select = document.getElementById('f-etat');
    if (!select) return;
    select.innerHTML = ETATS.map(function(e) {
        return '<option value="' + e.value + '">' + escapeHtml(e.label) + '</option>';
    }).join('');
}

function ecouterTaches() {
    db.collection('exterieur').onSnapshot(function(snapshot) {
        taches = [];
        snapshot.forEach(function(doc) {
            var data = doc.data();
            data.id = doc.id;
            taches.push(data);
        });
        premierChargement = false;
        renderFiltres();
        render();
    }, function(erreur) {
        console.error('Erreur Firestore :', erreur);
        var liste = document.getElementById('taches-list');
        if (liste) {
            liste.innerHTML = '<div class="error-block">'
                + '<i class="fa-solid fa-circle-exclamation"></i>'
                + '<strong>Impossible de lire les tâches.</strong><br>'
                + '<span style="color:var(--color-text-muted)">' + escapeHtml(erreur.message) + '</span>'
                + '</div>';
        }
    });
}

// ------------------------------------------------------------
// 2. Utilitaires
// ------------------------------------------------------------
function escapeAttr(texte) {
    return String(texte == null ? '' : texte)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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

function getEtatDef(value) {
    for (var i = 0; i < ETATS.length; i++) {
        if (ETATS[i].value === value) return ETATS[i];
    }
    return { value: value, label: value, color: '#757575' };
}

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

function trouverTache(id) {
    for (var i = 0; i < taches.length; i++) {
        if (taches[i].id === id) return taches[i];
    }
    return null;
}

// ------------------------------------------------------------
// 3. Filtres
// ------------------------------------------------------------
function renderFiltres() {
    var wrap = document.getElementById('etat-filter');
    if (!wrap) return;
    var comptes = {};
    var ouvertes = 0;
    taches.forEach(function(t) {
        comptes[t.etat] = (comptes[t.etat] || 0) + 1;
        if (t.etat !== 'fait') ouvertes++;
    });
    var html = boutonFiltre('ouvertes', 'À traiter', ouvertes);
    ETATS.forEach(function(e) {
        html += boutonFiltre(e.value, e.label, comptes[e.value] || 0);
    });
    html += boutonFiltre('toutes', 'Toutes', taches.length);
    wrap.innerHTML = html;
}

function boutonFiltre(valeur, libelle, compte) {
    var actif = (filtreEtat === valeur) ? ' active' : '';
    return '<button type="button" class="filter-btn' + actif + '" onclick="filtrer(\'' + jsAttr(valeur) + '\')">'
        + escapeHtml(libelle) + ' (' + compte + ')</button>';
}

function filtrer(valeur) {
    filtreEtat = valeur;
    renderFiltres();
    render();
}

function getTachesFiltrees() {
    return taches.filter(function(t) {
        if (filtreEtat === 'ouvertes') return t.etat !== 'fait';
        if (filtreEtat === 'toutes') return true;
        return t.etat === filtreEtat;
    });
}

// ------------------------------------------------------------
// 4. Rendu
// ------------------------------------------------------------
function render() {
    var liste = document.getElementById('taches-list');
    var vide = document.getElementById('empty-state');
    var compteur = document.getElementById('result-count');
    if (!liste) return;

    var lignes = getTachesFiltrees().sort(function(a, b) {
        var da = toDate(a.createdAt), dbb = toDate(b.createdAt);
        return (dbb ? dbb.getTime() : 0) - (da ? da.getTime() : 0);
    });

    if (compteur) {
        compteur.textContent = lignes.length + ' tâche' + (lignes.length > 1 ? 's' : '');
    }

    if (!lignes.length) {
        liste.innerHTML = '';
        if (vide) vide.style.display = premierChargement ? 'none' : 'block';
        return;
    }
    if (vide) vide.style.display = 'none';

    liste.innerHTML = '<table class="idees-table"><thead><tr>'
        + '<th>État</th><th>Période</th><th>Tâche</th>'
        + '<th><i class="fa-solid fa-calendar-day"></i></th><th></th>'
        + '</tr></thead><tbody>'
        + lignes.map(renderLigne).join('')
        + '</tbody></table>';
}

function renderLigne(t) {
    var etatDef = getEtatDef(t.etat);
    var id = jsAttr(t.id);

    var options = ETATS.map(function(e) {
        return '<option value="' + e.value + '"' + (e.value === t.etat ? ' selected' : '') + '>'
            + escapeHtml(e.label) + '</option>';
    }).join('');

    return '<tr class="idee-row' + (t.etat === 'fait' ? ' idee-row--close' : '') + '" onclick="ouvrirModale(\'' + id + '\')">'
        + '<td class="idee-etat-cell">'
        +   '<select class="idee-etat-select" style="border-color:' + etatDef.color + ';color:' + etatDef.color + '" '
        +   'onclick="event.stopPropagation()" onchange="changerEtat(\'' + id + '\', this.value)">' + options + '</select>'
        + '</td>'
        + '<td>' + (t.periode ? '<span class="badge badge-projet">' + escapeHtml(t.periode) + '</span>' : '') + '</td>'
        + '<td class="idee-titre-cell">'
        +   '<div class="idee-titre">' + escapeHtml(t.titre || '(sans titre)') + '</div>'
        +   (t.notes ? '<div class="idee-detail">' + escapeHtml(t.notes) + '</div>' : '')
        + '</td>'
        + '<td class="idee-date-cell">' + formatDateFr(t.createdAt) + '</td>'
        + '<td class="row-actions-cell">'
        +   '<button type="button" class="icon-btn" title="Modifier" onclick="event.stopPropagation();ouvrirModale(\'' + id + '\')">'
        +   '<i class="fa-solid fa-pen"></i></button>'
        + '</td>'
        + '</tr>';
}

// ------------------------------------------------------------
// 5. Modale
// ------------------------------------------------------------
function ouvrirModale(id) {
    idEnEdition = id || null;
    var t = id ? trouverTache(id) : null;

    document.getElementById('modal-title').textContent = t ? 'Modifier la tâche' : 'Nouvelle tâche';
    document.getElementById('f-titre').value   = t ? (t.titre || '') : '';
    document.getElementById('f-notes').value   = t ? (t.notes || '') : '';
    document.getElementById('f-periode').value = t ? (t.periode || '') : '';
    document.getElementById('f-etat').value    = t ? (t.etat || 'a_faire') : 'a_faire';

    var meta = document.getElementById('f-meta');
    if (t) {
        meta.textContent = 'Créée le ' + formatDateFr(t.createdAt);
        meta.style.display = 'block';
    } else {
        meta.style.display = 'none';
    }

    document.getElementById('btn-delete').style.display = t ? '' : 'none';
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

    var donnees = {
        titre:     titre,
        notes:     document.getElementById('f-notes').value.trim(),
        periode:   document.getElementById('f-periode').value.trim(),
        etat:      document.getElementById('f-etat').value,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    var operation;
    if (idEnEdition) {
        operation = db.collection('exterieur').doc(idEnEdition).update(donnees);
    } else {
        donnees.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        operation = db.collection('exterieur').add(donnees);
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

function changerEtat(id, nouvelEtat) {
    db.collection('exterieur').doc(id).update({
        etat: nouvelEtat,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(function(erreur) {
        console.error(erreur);
        showToast('Changement d\'état impossible : ' + erreur.message, 'error');
    });
}

// ------------------------------------------------------------
// 6. Suppression
// ------------------------------------------------------------
function ouvrirModaleSuppression() {
    document.getElementById('delete-overlay').style.display = 'flex';
}

function fermerModaleSuppression() {
    document.getElementById('delete-overlay').style.display = 'none';
}

function confirmerSuppression() {
    if (!idEnEdition) return;
    db.collection('exterieur').doc(idEnEdition).delete()
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
// 7. Raccourcis clavier
// ------------------------------------------------------------
document.addEventListener('keydown', function(evenement) {
    if (evenement.key !== 'Escape') return;
    if (document.getElementById('delete-overlay').style.display === 'flex') {
        fermerModaleSuppression();
    } else if (document.getElementById('modal-overlay').style.display === 'flex') {
        fermerModale();
    }
});
