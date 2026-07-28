// ============================================================
// exterieur-taches.js — La vue Tâches
// ============================================================
// Pourquoi une vue à part et pas un simple filtre du fil : un fil
// chronologique ne permet ni le tri par échéance, ni le regroupement
// par personne. Or c'est exactement ce qu'on demande à une liste de
// tâches quand on est deux à piloter un chantier.
// ============================================================

var triTaches = 'echeance';       // echeance | assigne | creation
var filtreCampTaches = 'ouvertes'; // ouvertes | a_nous | a_eux | clos | toutes

function renderTaches() {
    var cible = document.getElementById('vue-taches');
    if (!cible) return;

    var lignes = tachesFiltrees();

    cible.innerHTML = barreTaches()
        + (lignes.length
            ? '<div class="fil">' + lignes.map(carteTache).join('') + '</div>'
            : '<p class="bloc-vide">' + escapeHtml(premierChargement ? 'Chargement…' : 'Aucune tâche dans ce filtre.') + '</p>');
}

function tachesFiltrees() {
    var lignes = elementsDeType('tache').filter(function(t) {
        if (filtreCampTaches === 'toutes') return true;
        if (filtreCampTaches === 'ouvertes') return t.camp !== 'clos';
        return t.camp === filtreCampTaches;
    });

    return lignes.sort(function(a, b) {
        if (triTaches === 'assigne') {
            // Les tâches sans nom en dernier : ce sont celles dont
            // chacun pense que l'autre s'occupe, elles doivent se voir.
            var na = (a.assigneA || '\uffff').toLowerCase();
            var nb = (b.assigneA || '\uffff').toLowerCase();
            if (na !== nb) return na < nb ? -1 : 1;
        }
        if (triTaches === 'creation') {
            var ca = toDate(a.creeLe), cb = toDate(b.creeLe);
            return (cb ? cb.getTime() : 0) - (ca ? ca.getTime() : 0);
        }
        // Par défaut : l'échéance la plus proche (ou la plus dépassée)
        // en tête, les tâches sans échéance à la fin.
        return rangEcheance(a) - rangEcheance(b);
    });
}

function barreTaches() {
    var comptes = { ouvertes: 0, a_nous: 0, a_eux: 0, clos: 0, toutes: 0 };
    elementsDeType('tache').forEach(function(t) {
        comptes.toutes++;
        if (t.camp !== 'clos') comptes.ouvertes++;
        if (comptes[t.camp] !== undefined) comptes[t.camp]++;
    });

    var filtres = boutonFiltreTache('ouvertes', 'À traiter', comptes.ouvertes)
        + boutonFiltreTache('a_nous', 'À nous', comptes.a_nous)
        + boutonFiltreTache('a_eux', 'En attente', comptes.a_eux)
        + boutonFiltreTache('clos', 'Réglées', comptes.clos)
        + boutonFiltreTache('toutes', 'Toutes', comptes.toutes);

    var tris = boutonTriTache('echeance', 'Échéance')
        + boutonTriTache('assigne', 'Qui')
        + boutonTriTache('creation', 'Ajout');

    return '<div class="filter-row">' + filtres + '</div>'
        + '<div class="filter-row filter-row--tri"><span class="filter-label">Trier :</span>' + tris + '</div>';
}

function boutonFiltreTache(valeur, libelle, compte) {
    var actif = (filtreCampTaches === valeur) ? ' active' : '';
    return '<button type="button" class="filter-btn' + actif + '"'
        + ' onclick="filtrerTaches(\'' + jsAttr(valeur) + '\')">'
        + escapeHtml(libelle) + ' (' + compte + ')</button>';
}

function boutonTriTache(valeur, libelle) {
    var actif = (triTaches === valeur) ? ' active' : '';
    return '<button type="button" class="filter-btn' + actif + '"'
        + ' onclick="trierTaches(\'' + jsAttr(valeur) + '\')">' + escapeHtml(libelle) + '</button>';
}

function filtrerTaches(valeur) {
    filtreCampTaches = valeur;
    renderTaches();
}

function trierTaches(valeur) {
    triTaches = valeur;
    renderTaches();
}

function carteTache(tache) {
    var id = jsAttr(tache.id);
    var retard = toDate(tache.dateEcheance) ? joursDepuis(tache.dateEcheance) : null;
    var enRetard = (retard !== null && retard > 0 && tache.camp !== 'clos');

    var bouts = [];
    if (tache.dateEcheance) {
        bouts.push(enRetard
            ? '<span class="badge badge-retard"><i class="fa-solid fa-triangle-exclamation"></i>en retard de ' + retard + ' j</span>'
            : '<span class="badge"><i class="fa-solid fa-calendar-day"></i>' + escapeHtml(formatDateFr(tache.dateEcheance)) + '</span>');
    }
    bouts.push(tache.assigneA
        ? '<span class="badge badge-assigne"><i class="fa-solid fa-user"></i>' + escapeHtml(tache.assigneA) + '</span>'
        : '<span class="badge badge-personne"><i class="fa-solid fa-user-slash"></i>personne</span>');
    if (tache.sujet) bouts.push('<span class="badge badge-sujet">' + escapeHtml(tache.sujet) + '</span>');
    if (tache.contactId) {
        bouts.push('<span class="badge badge-contact"><i class="fa-solid fa-address-card"></i>' + escapeHtml(nomContact(tache.contactId)) + '</span>');
    }

    return '<article class="carte-fil carte-tache' + (tache.camp === 'clos' ? ' carte-fil--close' : '') + '">'
        + '<div class="carte-fil-corps">'
        +   '<button type="button" class="carte-titre carte-titre--bouton" onclick="ouvrirModaleElement(\'' + id + '\')">'
        +     escapeHtml(titreAffiche(tache)) + '</button>'
        +   (tache.notes ? '<p class="carte-apercu">' + escapeHtml(tache.notes) + '</p>' : '')
        +   '<div class="carte-meta">' + bouts.join(' ') + '</div>'
        +   boutonsCamp(tache)
        + '</div>'
        + '</article>';
}
