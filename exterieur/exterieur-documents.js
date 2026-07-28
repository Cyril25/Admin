// ============================================================
// exterieur-documents.js — La vue Documents
// ============================================================
// C'est la vue qui répond à « on est sur le point de choisir une
// presta ». Les devis y sont groupés par sujet et alignés côte à côte :
// les disperser dans l'ordre chronologique rendrait la comparaison
// impraticable, ce qui est précisément le moment où on a besoin d'eux.
//
// La clé de regroupement est normalisée (minuscules, accents pliés) :
// « terrasse », « Terrasse » et « TERRASSE » forment un seul groupe.
// Le datalist des sujets déjà saisis, dans la modale, évite les
// variantes à la source — la normalisation ne rattrape pas une faute
// de frappe.
// ============================================================

function renderDocuments() {
    var cible = document.getElementById('vue-documents');
    if (!cible) return;

    var docs = elementsDeType('document');
    if (!docs.length) {
        cible.innerHTML = '<p class="bloc-vide">'
            + escapeHtml(premierChargement ? 'Chargement…' : 'Aucun document. Déposez un devis avec le bouton Ajouter.')
            + '</p>';
        return;
    }

    var groupes = grouperDocumentsParSujet(docs);
    cible.innerHTML = groupes.map(groupeDocuments).join('');
}

// Rend les groupes triés : les sujets à comparer d'abord (ceux qui ont
// plusieurs devis), puis les sujets isolés, puis les documents sans
// sujet — qui ne sont pas un choix, juste des pièces au dossier.
function grouperDocumentsParSujet(docs) {
    var parSujet = {};
    var sansSujet = [];

    docs.forEach(function(doc) {
        var cle = cleSujet(doc.sujet);
        if (!cle) { sansSujet.push(doc); return; }
        if (!parSujet[cle]) parSujet[cle] = { cle: cle, libelle: String(doc.sujet).trim(), devis: [] };
        parSujet[cle].devis.push(doc);
    });

    var groupes = [];
    for (var cle in parSujet) {
        if (Object.prototype.hasOwnProperty.call(parSujet, cle)) groupes.push(parSujet[cle]);
    }

    groupes.sort(function(a, b) {
        if (a.devis.length !== b.devis.length) return b.devis.length - a.devis.length;
        return a.cle < b.cle ? -1 : (a.cle > b.cle ? 1 : 0);
    });

    groupes.forEach(function(groupe) {
        groupe.devis.sort(function(a, b) {
            var da = toDate(a.dateEvenement) || toDate(a.creeLe);
            var db2 = toDate(b.dateEvenement) || toDate(b.creeLe);
            return (db2 ? db2.getTime() : 0) - (da ? da.getTime() : 0);
        });
    });

    if (sansSujet.length) {
        groupes.push({ cle: '', libelle: 'Sans sujet', devis: sansSujet, orphelins: true });
    }
    return groupes;
}

function groupeDocuments(groupe) {
    var titre = groupe.orphelins
        ? groupe.libelle
        : groupe.libelle.charAt(0).toUpperCase() + groupe.libelle.slice(1);

    var badge = '';
    if (!groupe.orphelins && groupe.devis.length >= 2) {
        badge = ' <span class="badge badge-comparer">' + groupe.devis.length + ' devis, à comparer</span>';
    } else if (groupe.orphelins) {
        badge = ' <span class="badge" title="Un sujet les rendrait comparables">'
            + groupe.devis.length + '</span>';
    }

    return '<section class="groupe-docs">'
        + '<h2 class="bloc-titre"><i class="fa-solid fa-folder-open"></i> ' + escapeHtml(titre) + badge + '</h2>'
        + '<div class="grille-docs">' + groupe.devis.map(carteDocument).join('') + '</div>'
        + '</section>';
}

function carteDocument(doc) {
    var id = jsAttr(doc.id);
    var camp = getCampDef(doc.camp);

    var lignes = '';
    lignes += '<div class="doc-ligne"><i class="fa-solid fa-calendar-day"></i> '
        + escapeHtml(formatDateFr(doc.dateEvenement || doc.creeLe)) + '</div>';

    if (doc.contactId) {
        lignes += '<div class="doc-ligne"><i class="fa-solid fa-address-card"></i> '
            + escapeHtml(nomContact(doc.contactId)) + '</div>';
    }
    if (camp) {
        lignes += '<div class="doc-ligne"><span class="badge badge-camp badge-camp--' + escapeAttr(doc.camp) + '">'
            + '<i class="' + escapeAttr(camp.icone) + '"></i>' + escapeHtml(camp.label) + '</span></div>';
    }

    // Le PDF s'ouvre dans un onglet, jamais en <iframe> : ça évite
    // d'avoir à ouvrir frame-src dans la CSP de la page.
    var ouvrir = doc.url
        ? '<a class="doc-ouvrir" target="_blank" rel="noopener" href="' + escapeAttr(doc.url) + '">'
            + '<i class="fa-solid fa-arrow-up-right-from-square"></i> Ouvrir</a>'
        : '';

    return '<article class="carte-doc">'
        + '<button type="button" class="carte-titre carte-titre--bouton" onclick="ouvrirModaleElement(\'' + id + '\')">'
        +   escapeHtml(doc.titre || 'Document sans titre') + '</button>'
        + lignes
        + ouvrir
        + '</article>';
}
