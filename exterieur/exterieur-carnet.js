// ============================================================
// exterieur-carnet.js — Contacts et liens
// ============================================================
// Les références intemporelles du chantier, dans le même tiroir que le
// reste : chercher « paysagiste » doit ramener aussi bien un mail
// qu'une fiche contact. C'est tout l'intérêt de la collection unique.
//
// Deux sections sur une même page :
//   Contacts — nom, entreprise, téléphone, email, catégorie
//   Liens    — générateurs d'images, fournisseurs, inspirations, docs
//
// Contacts et liens ne passent pas par le bouton Ajouter : on les crée
// ici, là où on les cherche.
// ============================================================

var filtreCategorieContact = 'toutes';
var contactEnEdition = null;
var lienEnEdition = null;

function renderCarnet() {
    var cible = document.getElementById('vue-carnet');
    if (!cible) return;

    cible.innerHTML = sectionContacts() + sectionLiens();
}

// ------------------------------------------------------------
// 1. Contacts
// ------------------------------------------------------------
function sectionContacts() {
    var tous = elementsDeType('contact');
    var visibles = tous.filter(function(c) {
        return filtreCategorieContact === 'toutes' || (c.categorie || 'autre') === filtreCategorieContact;
    }).sort(function(a, b) {
        var na = normaliserTexte((a.nom || '') + ' ' + (a.entreprise || ''));
        var nb = normaliserTexte((b.nom || '') + ' ' + (b.entreprise || ''));
        return na < nb ? -1 : (na > nb ? 1 : 0);
    });

    var comptes = { toutes: tous.length };
    CATEGORIES_CONTACT.forEach(function(cat) { comptes[cat.value] = 0; });
    tous.forEach(function(c) {
        var cat = c.categorie || 'autre';
        if (comptes[cat] !== undefined) comptes[cat]++;
    });

    var filtres = boutonFiltreContact('toutes', 'Tous', comptes.toutes);
    CATEGORIES_CONTACT.forEach(function(cat) {
        filtres += boutonFiltreContact(cat.value, cat.label, comptes[cat.value] || 0);
    });

    return '<section class="carnet-section">'
        + '<div class="carnet-entete">'
        +   '<h2 class="bloc-titre"><i class="fa-solid fa-address-book"></i> Contacts</h2>'
        +   '<button type="button" class="btn-add" onclick="ouvrirModaleContact(null)">'
        +     '<i class="fa-solid fa-plus"></i> Nouveau contact</button>'
        + '</div>'
        + '<div class="filter-row">' + filtres + '</div>'
        + (visibles.length
            ? '<div class="grille-contacts">' + visibles.map(carteContact).join('') + '</div>'
            : '<p class="bloc-vide">' + escapeHtml(premierChargement ? 'Chargement…' : 'Aucun contact dans ce filtre.') + '</p>')
        + '</section>';
}

function boutonFiltreContact(valeur, libelle, compte) {
    var actif = (filtreCategorieContact === valeur) ? ' active' : '';
    return '<button type="button" class="filter-btn' + actif + '"'
        + ' onclick="filtrerContacts(\'' + jsAttr(valeur) + '\')">'
        + escapeHtml(libelle) + ' (' + compte + ')</button>';
}

function filtrerContacts(valeur) {
    filtreCategorieContact = valeur;
    renderCarnet();
}

// Combien d'éléments pointent vers ce contact. Sert à deux choses :
// mesurer d'un coup d'œil qui compte dans le chantier, et prévenir
// avant une suppression qui laisserait des références orphelines.
function nbElementsLies(contactId) {
    var n = 0;
    elements.forEach(function(e) { if (e.contactId === contactId) n++; });
    return n;
}

function carteContact(contact) {
    var id = jsAttr(contact.id);
    var nomComplet = ((contact.prenom || '') + ' ' + (contact.nom || '')).trim();
    var lies = nbElementsLies(contact.id);

    var lignes = '';
    if (contact.entreprise) {
        lignes += '<div class="contact-ligne"><i class="fa-solid fa-building"></i> ' + escapeHtml(contact.entreprise) + '</div>';
    }
    if (contact.telephone) {
        lignes += '<div class="contact-ligne"><i class="fa-solid fa-phone"></i> '
            + '<a href="tel:' + escapeAttr(String(contact.telephone).replace(/\s+/g, '')) + '">'
            + escapeHtml(contact.telephone) + '</a></div>';
    }
    if (contact.email) {
        lignes += '<div class="contact-ligne"><i class="fa-solid fa-envelope"></i> '
            + '<a href="mailto:' + escapeAttr(contact.email) + '">' + escapeHtml(contact.email) + '</a></div>';
    }
    if (contact.commentaire) {
        lignes += '<p class="contact-commentaire">' + escapeHtml(contact.commentaire) + '</p>';
    }

    return '<article class="carte-contact">'
        + '<div class="carte-contact-entete">'
        +   '<h3 class="contact-nom">' + escapeHtml(nomComplet || contact.entreprise || '(sans nom)') + '</h3>'
        +   '<button type="button" class="icon-btn" title="Modifier" onclick="ouvrirModaleContact(\'' + id + '\')">'
        +     '<i class="fa-solid fa-pen"></i></button>'
        + '</div>'
        + '<span class="badge badge-categorie">' + escapeHtml(libelleCategorieContact(contact.categorie)) + '</span>'
        + (lies ? ' <span class="badge badge-lies">' + lies + ' élément' + (lies > 1 ? 's' : '') + ' lié' + (lies > 1 ? 's' : '') + '</span>' : '')
        + lignes
        + '</article>';
}

// ------------------------------------------------------------
// 2. Liens
// ------------------------------------------------------------
function sectionLiens() {
    var liens = elementsDeType('lien').sort(function(a, b) {
        var na = normaliserTexte(a.titre);
        var nb = normaliserTexte(b.titre);
        return na < nb ? -1 : (na > nb ? 1 : 0);
    });

    return '<section class="carnet-section">'
        + '<div class="carnet-entete">'
        +   '<h2 class="bloc-titre"><i class="fa-solid fa-link"></i> Liens</h2>'
        +   '<button type="button" class="btn-add" onclick="ouvrirModaleLien(null)">'
        +     '<i class="fa-solid fa-plus"></i> Nouveau lien</button>'
        + '</div>'
        + (liens.length
            ? '<div class="grille-contacts">' + liens.map(carteLien).join('') + '</div>'
            : '<p class="bloc-vide">' + escapeHtml(premierChargement ? 'Chargement…' : 'Aucun lien enregistré.') + '</p>')
        + '</section>';
}

function carteLien(lien) {
    var id = jsAttr(lien.id);
    return '<article class="carte-contact">'
        + '<div class="carte-contact-entete">'
        +   '<h3 class="contact-nom">'
        +     (lien.url
                ? '<a target="_blank" rel="noopener" href="' + escapeAttr(lien.url) + '">' + escapeHtml(lien.titre || lien.url) + '</a>'
                : escapeHtml(lien.titre || '(sans titre)'))
        +   '</h3>'
        +   '<button type="button" class="icon-btn" title="Modifier" onclick="ouvrirModaleLien(\'' + id + '\')">'
        +     '<i class="fa-solid fa-pen"></i></button>'
        + '</div>'
        + (lien.url ? '<div class="contact-ligne contact-url">' + escapeHtml(lien.url) + '</div>' : '')
        + (lien.commentaire ? '<p class="contact-commentaire">' + escapeHtml(lien.commentaire) + '</p>' : '')
        + '</article>';
}

// ------------------------------------------------------------
// 3. Modale contact
// ------------------------------------------------------------
function ouvrirModaleContact(id) {
    contactEnEdition = id || null;
    var contact = id ? trouverElement(id) : null;

    document.getElementById('contact-modal-titre').textContent = contact ? 'Modifier le contact' : 'Nouveau contact';
    document.getElementById('c-prenom').value      = contact ? (contact.prenom || '') : '';
    document.getElementById('c-nom').value         = contact ? (contact.nom || '') : '';
    document.getElementById('c-entreprise').value  = contact ? (contact.entreprise || '') : '';
    document.getElementById('c-telephone').value   = contact ? (contact.telephone || '') : '';
    document.getElementById('c-email').value       = contact ? (contact.email || '') : '';
    document.getElementById('c-commentaire').value = contact ? (contact.commentaire || '') : '';

    var select = document.getElementById('c-categorie');
    select.innerHTML = CATEGORIES_CONTACT.map(function(cat) {
        return '<option value="' + escapeAttr(cat.value) + '">' + escapeHtml(cat.label) + '</option>';
    }).join('');
    select.value = contact ? (contact.categorie || 'autre') : 'autre';

    var suppr = document.getElementById('c-btn-supprimer');
    if (contact) {
        var lies = nbElementsLies(contact.id);
        suppr.style.display = '';
        // On prévient sans interdire : la référence morte est tolérée à
        // l'affichage (« contact supprimé »), on ne casse rien en base.
        suppr.onclick = function() {
            demanderSuppression(contact.id, lies
                ? ('Ce contact est lié à ' + lies + ' élément' + (lies > 1 ? 's' : '') + '. Ils resteront, en affichant « contact supprimé ».')
                : '');
        };
    } else {
        suppr.style.display = 'none';
    }

    document.getElementById('contact-overlay').style.display = 'flex';
    document.getElementById('c-prenom').focus();
}

function fermerModaleContact() {
    document.getElementById('contact-overlay').style.display = 'none';
    contactEnEdition = null;
}

function sauverContact() {
    var donnees = {
        type:        'contact',
        prenom:      document.getElementById('c-prenom').value.trim(),
        nom:         document.getElementById('c-nom').value.trim(),
        entreprise:  document.getElementById('c-entreprise').value.trim(),
        telephone:   document.getElementById('c-telephone').value.trim(),
        email:       document.getElementById('c-email').value.trim(),
        commentaire: document.getElementById('c-commentaire').value.trim(),
        categorie:   document.getElementById('c-categorie').value
    };
    donnees.titre = ((donnees.prenom + ' ' + donnees.nom).trim() || donnees.entreprise);

    if (!donnees.titre) {
        showToast('Il faut au moins un nom ou une entreprise.', 'error');
        document.getElementById('c-nom').focus();
        return;
    }

    var operation = contactEnEdition
        ? modifierElement(contactEnEdition, donnees)
        : creerElement(donnees);

    operation
        .then(function() {
            showToast(contactEnEdition ? 'Contact mis à jour.' : 'Contact ajouté.', 'success');
            fermerModaleContact();
        })
        .catch(function(erreur) {
            console.error(erreur);
            showToast('Enregistrement impossible : ' + erreur.message, 'error');
        });
}

// ------------------------------------------------------------
// 4. Modale lien
// ------------------------------------------------------------
function ouvrirModaleLien(id) {
    lienEnEdition = id || null;
    var lien = id ? trouverElement(id) : null;

    document.getElementById('lien-modal-titre').textContent = lien ? 'Modifier le lien' : 'Nouveau lien';
    document.getElementById('l-titre').value       = lien ? (lien.titre || '') : '';
    document.getElementById('l-url').value         = lien ? (lien.url || '') : '';
    document.getElementById('l-commentaire').value = lien ? (lien.commentaire || '') : '';

    var suppr = document.getElementById('l-btn-supprimer');
    if (lien) {
        suppr.style.display = '';
        suppr.onclick = function() { demanderSuppression(lien.id, ''); };
    } else {
        suppr.style.display = 'none';
    }

    document.getElementById('lien-overlay').style.display = 'flex';
    document.getElementById('l-titre').focus();
}

function fermerModaleLien() {
    document.getElementById('lien-overlay').style.display = 'none';
    lienEnEdition = null;
}

function sauverLien() {
    var titre = document.getElementById('l-titre').value.trim();
    var url = document.getElementById('l-url').value.trim();

    if (!titre) {
        showToast('Le titre est obligatoire.', 'error');
        document.getElementById('l-titre').focus();
        return;
    }
    if (!url) {
        showToast('L\'adresse est obligatoire.', 'error');
        document.getElementById('l-url').focus();
        return;
    }

    var donnees = {
        type:        'lien',
        titre:       titre,
        url:         url,
        commentaire: document.getElementById('l-commentaire').value.trim()
    };

    var operation = lienEnEdition ? modifierElement(lienEnEdition, donnees) : creerElement(donnees);

    operation
        .then(function() {
            showToast(lienEnEdition ? 'Lien mis à jour.' : 'Lien ajouté.', 'success');
            fermerModaleLien();
        })
        .catch(function(erreur) {
            console.error(erreur);
            showToast('Enregistrement impossible : ' + erreur.message, 'error');
        });
}
