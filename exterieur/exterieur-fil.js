// ============================================================
// exterieur-fil.js — Le fil chronologique
// ============================================================
// Tous les événements datés mêlés, du plus récent au plus ancien. Les
// contacts, les liens et la fiche projet en sont exclus : ce ne sont
// pas des événements, ils n'ont pas de place dans une chronologie.
//
// Le tri se fait sur dateEvenement — quand la chose s'est produite — et
// non sur creeLe — quand on l'a archivée. Sans cette distinction,
// archiver dix vieux mails d'un coup les propulserait en tête du fil.
//
// carteElement() vit ici parce que c'est la carte canonique : la vue
// Résultats de recherche la réutilise telle quelle.
// ============================================================

var filtreTypeFil = 'tous';

function renderFil() {
    var cible = document.getElementById('vue-fil');
    if (!cible) return;

    var lignes = elementsDuFil().filter(function(e) {
        return filtreTypeFil === 'tous' || e.type === filtreTypeFil;
    });

    cible.innerHTML = filtresDuFil()
        + '<div class="fil">'
        + (lignes.length
            ? lignes.map(carteElement).join('')
            : '<p class="bloc-vide">' + escapeHtml(premierChargement ? 'Chargement…' : 'Rien à afficher dans ce filtre.') + '</p>')
        + '</div>';
}

function elementsDuFil() {
    return elements
        .filter(function(e) { return TYPES_FIL.indexOf(e.type) !== -1; })
        .sort(parDateDecroissante);
}

function filtresDuFil() {
    var comptes = {};
    var total = 0;
    elements.forEach(function(e) {
        if (TYPES_FIL.indexOf(e.type) === -1) return;
        comptes[e.type] = (comptes[e.type] || 0) + 1;
        total++;
    });

    var html = boutonFiltreFil('tous', 'Tout', total);
    TYPES.forEach(function(def) {
        if (TYPES_FIL.indexOf(def.value) === -1) return;
        html += boutonFiltreFil(def.value, def.label, comptes[def.value] || 0);
    });
    return '<div class="filter-row">' + html + '</div>';
}

function boutonFiltreFil(valeur, libelle, compte) {
    var actif = (filtreTypeFil === valeur) ? ' active' : '';
    return '<button type="button" class="filter-btn' + actif + '"'
        + ' onclick="filtrerFil(\'' + jsAttr(valeur) + '\')">'
        + escapeHtml(libelle) + ' (' + compte + ')</button>';
}

function filtrerFil(valeur) {
    filtreTypeFil = valeur;
    renderFil();
}

// ------------------------------------------------------------
// La carte canonique
// ------------------------------------------------------------
function carteElement(element) {
    var id = jsAttr(element.id);
    var def = getTypeDef(element.type);
    var date = element.dateEvenement || element.creeLe;

    return '<article class="carte-fil carte-fil--' + escapeAttr(element.type) + '">'
        + '<div class="carte-fil-date">'
        +   '<i class="' + escapeAttr(def.icone) + '" title="' + escapeAttr(def.label) + '"></i>'
        +   '<span>' + escapeHtml(formatDateFr(date)) + '</span>'
        + '</div>'
        + '<div class="carte-fil-corps">'
        +   '<button type="button" class="carte-titre carte-titre--bouton" onclick="ouvrirModaleElement(\'' + id + '\')">'
        +     escapeHtml(titreAffiche(element)) + '</button>'
        +   apercuElement(element)
        +   '<div class="carte-meta">' + metaFil(element) + '</div>'
        + '</div>'
        + '</article>';
}

// Ce qu'on voit sans ouvrir : deux lignes de contenu, ou la vignette.
function apercuElement(element) {
    if (element.type === 'image' && element.url) {
        return '<img class="carte-vignette" loading="lazy" alt="" src="'
            + escapeAttr(urlVignette(element.url, 400)) + '">';
    }
    var texte = element.corps || element.notes || element.commentaire || '';
    if (!texte) return '';
    return '<p class="carte-apercu">' + escapeHtml(texte) + '</p>';
}

function metaFil(element) {
    var bouts = [];

    if (element.type === 'email') {
        bouts.push(element.sens === 'envoye'
            ? '<span class="badge badge-envoye"><i class="fa-solid fa-paper-plane"></i>envoyé</span>'
            : '<span class="badge badge-recu"><i class="fa-solid fa-inbox"></i>reçu</span>');
        if (element.parseOk === false) {
            bouts.push('<span class="badge badge-alerte" title="Le fichier a été conservé, mais mal compris : les champs sont à vérifier">'
                + '<i class="fa-solid fa-triangle-exclamation"></i>mal compris</span>');
        }
    }

    var camp = getCampDef(element.camp);
    if (camp) {
        var classe = 'badge-camp badge-camp--' + escapeAttr(element.camp);
        var libelle = camp.label;
        if (element.camp === 'a_eux') {
            var jours = joursDepuis(element.campDepuis);
            if (jours !== null) libelle += ' · ' + jours + ' j';
            if (jours !== null && jours >= SEUIL_RELANCE_JOURS) libelle += ' · à relancer';
        }
        bouts.push('<span class="badge ' + classe + '"><i class="' + escapeAttr(camp.icone) + '"></i>' + escapeHtml(libelle) + '</span>');
    }

    if (element.assigneA) {
        bouts.push('<span class="badge badge-assigne"><i class="fa-solid fa-user"></i>' + escapeHtml(element.assigneA) + '</span>');
    }
    if (element.sujet) {
        bouts.push('<span class="badge badge-sujet">' + escapeHtml(element.sujet) + '</span>');
    }
    if (element.contactId) {
        bouts.push('<span class="badge badge-contact"><i class="fa-solid fa-address-card"></i>' + escapeHtml(nomContact(element.contactId)) + '</span>');
    }
    if (element.url && element.type === 'document') {
        bouts.push('<a class="badge badge-lien" target="_blank" rel="noopener" href="' + escapeAttr(element.url) + '">'
            + '<i class="fa-solid fa-arrow-up-right-from-square"></i>ouvrir</a>');
    }

    return bouts.join(' ');
}
