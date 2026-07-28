// ============================================================
// exterieur-projet.js — La fiche « Le projet »
// ============================================================
// À l'inverse de tout le reste, ce n'est pas une liste : c'est UN seul
// document, d'identifiant fixe « _projet ». Identifiant fixe = pas de
// doublon possible ; deux personnes qui l'éditent en même temps
// écrivent dans le même document, la dernière écriture gagne. Acceptable
// à deux — on affiche « modifié par X le Y », ce qui rend le risque
// visible sans le supprimer, plutôt que d'ajouter un verrou.
//
// Objectif de la page : répondre la même chose aux trois entreprises
// consultées. Un artisan demande « vous voulez quoi exactement ? », on
// ouvre la page et on lit. C'est aussi ce qui rend deux devis comparables.
//
// ⚠ Les notes de budget sont du TEXTE LIBRE. Aucun calcul, aucun total,
// aucun reste-à-engager : on écrit « enveloppe 15–20 k€, terrasse
// prioritaire », on ne calcule rien. Le suivi budgétaire chiffré est
// explicitement hors périmètre.
// ============================================================

function renderProjet() {
    var cible = document.getElementById('vue-projet');
    if (!cible) return;

    // Rendu une seule fois : re-render à chaque snapshot écraserait ce
    // qu'on est en train de taper. Les listes, elles, se rafraîchissent.
    if (!cible.getAttribute('data-monte')) {
        cible.innerHTML = gabaritProjet();
        cible.setAttribute('data-monte', '1');
        remplirChampsProjet();
    } else if (!projetEnCoursDeSaisie()) {
        remplirChampsProjet();
    }
    renderListesProjet();
    renderMetaProjet();
}

function gabaritProjet() {
    return '<div class="fiche-projet">'
        + '<p class="page-subtitle">La réponse unique aux trois entreprises consultées. '
        +   'Ce qu\'on veut, ce qu\'on ne veut pas, et l\'enveloppe — en toutes lettres.</p>'

        + '<div class="field field--full">'
        +   '<label for="p-budget">Notes de budget <span class="field-hint">(texte libre — aucun calcul)</span></label>'
        +   '<textarea id="p-budget" rows="5" placeholder="Enveloppe 15–20 k€. Terrasse prioritaire. Clôture peut attendre le printemps."></textarea>'
        + '</div>'

        + '<div class="field field--full">'
        +   '<label for="p-veut">Ce qu\'on veut</label>'
        +   '<textarea id="p-veut" rows="6" placeholder="Environ 50 m² de terrasse sur plots. 50 ml de clôture. Stabiliser le talus par le végétal."></textarea>'
        + '</div>'

        + '<div class="field field--full">'
        +   '<label for="p-veut-pas">Ce qu\'on ne veut pas</label>'
        +   '<textarea id="p-veut-pas" rows="6" placeholder="Pas de mur en béton. Pas de gazon à tondre sur le talus."></textarea>'
        + '</div>'

        + '<div class="modal-actions fiche-actions">'
        +   '<span class="modal-meta" id="p-meta"></span>'
        +   '<button type="button" class="btn-add" onclick="sauverProjet()">'
        +     '<i class="fa-solid fa-floppy-disk"></i> Enregistrer</button>'
        + '</div>'

        + '<hr class="fiche-separateur">'

        + '<div class="fiche-listes">'
        +   '<section>'
        +     '<h3 class="bloc-titre"><i class="fa-solid fa-users"></i> Qui intervient</h3>'
        +     '<p class="field-hint">Sert à proposer « assigner à … » sur les tâches. '
        +       'Se remplit toute seule : chaque personne s\'y ajoute en ouvrant le projet.</p>'
        +     '<div id="p-intervenants" class="liste-etiquettes"></div>'
        +     '<div class="ligne-ajout">'
        +       '<input type="text" id="p-nouvel-intervenant" placeholder="Ajouter un prénom">'
        +       '<button type="button" class="btn-export" onclick="ajouterIntervenant()">Ajouter</button>'
        +     '</div>'
        +   '</section>'

        +   '<section>'
        +     '<h3 class="bloc-titre"><i class="fa-solid fa-at"></i> Nos adresses</h3>'
        +     '<p class="field-hint">Sert à deviner si un mail archivé est envoyé ou reçu. '
        +       'Se remplit toute seule, elle aussi.</p>'
        +     '<div id="p-adresses" class="liste-etiquettes"></div>'
        +     '<div class="ligne-ajout">'
        +       '<input type="email" id="p-nouvelle-adresse" placeholder="Ajouter une adresse">'
        +       '<button type="button" class="btn-export" onclick="ajouterAdresse()">Ajouter</button>'
        +     '</div>'
        +   '</section>'
        + '</div>'
        + '</div>';
}

// Ne pas écraser une saisie en cours : si l'un des trois champs a le
// focus, le snapshot déclenché par l'écriture de l'autre ne doit pas
// remplacer ce qu'on est en train de taper.
function projetEnCoursDeSaisie() {
    var actif = document.activeElement;
    if (!actif || !actif.id) return false;
    return ['p-budget', 'p-veut', 'p-veut-pas'].indexOf(actif.id) !== -1;
}

function remplirChampsProjet() {
    var fiche = ficheProjet || {};
    var budget = document.getElementById('p-budget');
    var veut = document.getElementById('p-veut');
    var veutPas = document.getElementById('p-veut-pas');
    if (budget)  budget.value  = fiche.budgetNotes || '';
    if (veut)    veut.value    = fiche.ceQuonVeut || '';
    if (veutPas) veutPas.value = fiche.ceQuonNeVeutPas || '';
}

function renderMetaProjet() {
    var meta = document.getElementById('p-meta');
    if (!meta) return;
    var fiche = ficheProjet;
    if (!fiche || !fiche.modifiePar) {
        meta.textContent = 'Jamais modifiée.';
        return;
    }
    meta.textContent = 'Modifiée par ' + fiche.modifiePar + ' le ' + formatDateFr(fiche.modifieLe) + '.';
}

function renderListesProjet() {
    var zoneIntervenants = document.getElementById('p-intervenants');
    if (zoneIntervenants) {
        var noms = intervenants();
        zoneIntervenants.innerHTML = noms.length
            ? noms.map(function(nom) { return etiquetteRetirable(nom, 'retirerIntervenant'); }).join('')
            : '<span class="bloc-vide">Personne pour l\'instant.</span>';
    }

    var zoneAdresses = document.getElementById('p-adresses');
    if (zoneAdresses) {
        var adresses = nosAdresses();
        zoneAdresses.innerHTML = adresses.length
            ? adresses.map(function(a) { return etiquetteRetirable(a, 'retirerAdresse'); }).join('')
            : '<span class="bloc-vide">Aucune adresse.</span>';
    }
}

function etiquetteRetirable(valeur, fonction) {
    return '<span class="etiquette">' + escapeHtml(valeur)
        + '<button type="button" class="etiquette-x" title="Retirer"'
        + ' onclick="' + escapeAttr(fonction) + '(\'' + jsAttr(valeur) + '\')">'
        + '<i class="fa-solid fa-xmark"></i></button></span>';
}

// ------------------------------------------------------------
// Écriture
// ------------------------------------------------------------
// set(merge) et jamais update() : au premier lancement le document
// n'existe pas, un update() lèverait « not-found ». Le merge préserve
// aussi intervenants et nosAdresses, qu'on ne touche pas ici.
function ecrireFicheProjet(champs) {
    var doc = {};
    for (var cle in champs) {
        if (Object.prototype.hasOwnProperty.call(champs, cle)) doc[cle] = champs[cle];
    }
    doc.type = 'projet';
    doc.modifiePar = utilisateurReel();
    doc.modifieLe = horodatage();
    return db.collection(COLLECTION).doc(ID_PROJET).set(doc, { merge: true });
}

function sauverProjet() {
    ecrireFicheProjet({
        budgetNotes:     document.getElementById('p-budget').value,
        ceQuonVeut:      document.getElementById('p-veut').value,
        ceQuonNeVeutPas: document.getElementById('p-veut-pas').value
    })
        .then(function() { showToast('Fiche projet enregistrée.', 'success'); })
        .catch(function(erreur) {
            console.error(erreur);
            showToast('Enregistrement impossible : ' + erreur.message, 'error');
        });
}

// arrayUnion / arrayRemove plutôt qu'un tableau réécrit : deux
// personnes peuvent modifier ces listes en même temps sans s'écraser.
function ajouterIntervenant() {
    var champ = document.getElementById('p-nouvel-intervenant');
    var valeur = champ.value.trim();
    if (!valeur) return;
    ecrireFicheProjet({ intervenants: firebase.firestore.FieldValue.arrayUnion(valeur) })
        .then(function() { champ.value = ''; })
        .catch(function(erreur) { showToast('Ajout impossible : ' + erreur.message, 'error'); });
}

function retirerIntervenant(valeur) {
    ecrireFicheProjet({ intervenants: firebase.firestore.FieldValue.arrayRemove(valeur) })
        .catch(function(erreur) { showToast('Retrait impossible : ' + erreur.message, 'error'); });
}

function ajouterAdresse() {
    var champ = document.getElementById('p-nouvelle-adresse');
    var valeur = champ.value.trim().toLowerCase();
    if (!valeur) return;
    ecrireFicheProjet({ nosAdresses: firebase.firestore.FieldValue.arrayUnion(valeur) })
        .then(function() { champ.value = ''; })
        .catch(function(erreur) { showToast('Ajout impossible : ' + erreur.message, 'error'); });
}

function retirerAdresse(valeur) {
    ecrireFicheProjet({ nosAdresses: firebase.firestore.FieldValue.arrayRemove(valeur) })
        .catch(function(erreur) { showToast('Retrait impossible : ' + erreur.message, 'error'); });
}
