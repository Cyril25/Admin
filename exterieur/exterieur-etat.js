// ============================================================
// exterieur-etat.js — « Où on en est » (la vue par défaut)
// ============================================================
// Le symptôme d'origine est « le projet traîne, on oublie où on en
// est ». Un fil chronologique n'y répond pas : à 150 éléments, il
// raconte ce qui s'est passé, pas où on en est. Cette vue répond à une
// seule question : la balle est dans quel camp ?
//
// Quatre blocs :
//   À nous          — ce qui attend une action de Cyril ou d'Alisson
//   En attente d'eux— avec l'ancienneté, et « à relancer » au-delà du seuil
//   Choix à faire   — les devis d'un même sujet, prêts à être comparés
//   Mouvement       — ce qui a bougé cette semaine, ou le fait que rien n'a bougé
//
// ❌ Aucune barre de progression, aucun pourcentage, et c'est délibéré.
// Afficher « 40 % du projet » supposerait de connaître le total des
// tâches — faux par nature dans un chantier qui se découvre en
// avançant. Un pourcentage inventé démotive dès qu'on comprend qu'il ne
// veut rien dire. On montre le mouvement réel, y compris son absence.
// ============================================================

function renderEtat() {
    var cible = document.getElementById('vue-etat');
    if (!cible) return;

    // Tant que le premier snapshot n'est pas revenu, « rien ne vous
    // attend » serait un mensonge rassurant — le pire des deux.
    if (premierChargement) {
        cible.innerHTML = '<p class="bloc-vide">Chargement…</p>';
        return;
    }

    cible.innerHTML =
          blocANous()
        + blocEnAttente()
        + blocChoix()
        + blocMouvement();
}

// ------------------------------------------------------------
// 1. À nous
// ------------------------------------------------------------
function elementsANous() {
    return elements.filter(function(e) { return e.camp === 'a_nous'; }).sort(function(a, b) {
        // Les échéances dépassées d'abord, puis les échéances à venir,
        // puis ce qui n'en a pas. Un retard doit sauter aux yeux.
        return rangEcheance(a) - rangEcheance(b);
    });
}

// Rang trié : plus le nombre est petit, plus c'est urgent.
function rangEcheance(element) {
    var echeance = toDate(element.dateEcheance);
    if (!echeance) return 1e15;                    // sans échéance : à la fin
    return echeance.getTime();                     // la plus ancienne d'abord
}

function blocANous() {
    var lignes = elementsANous();
    var corps = lignes.length
        ? lignes.map(carteEtat).join('')
        : phraseVide('Rien ne vous attend. Profitez-en.');

    return blocTableau('a-nous', 'fa-solid fa-hand-point-left', 'À nous', lignes.length, corps);
}

// ------------------------------------------------------------
// 2. En attente d'eux
// ------------------------------------------------------------
function elementsEnAttente() {
    return elements.filter(function(e) { return e.camp === 'a_eux'; }).sort(function(a, b) {
        // Le plus vieux d'abord : c'est celui qu'il faut relancer.
        var ja = joursDepuis(a.campDepuis);
        var jb = joursDepuis(b.campDepuis);
        return (jb == null ? -1 : jb) - (ja == null ? -1 : ja);
    });
}

function blocEnAttente() {
    var lignes = elementsEnAttente();
    var corps = lignes.length
        ? lignes.map(carteEtat).join('')
        : phraseVide('Vous n\'attendez personne.');

    return blocTableau('en-attente', 'fa-solid fa-hourglass-half', 'En attente d\'eux', lignes.length, corps);
}

// ------------------------------------------------------------
// 3. Choix à faire
// ------------------------------------------------------------
// Regroupement automatique des devis partageant le même sujet. Deux
// devis ou plus sur un même sujet, c'est un choix qui attend.
// « sujet » est un tag en texte libre, pas une structure : ça ne
// réintroduit pas le découpage par pôles techniques écarté au cadrage.
function groupesDeSujet() {
    var parSujet = {};
    elementsDeType('document').forEach(function(doc) {
        var cle = cleSujet(doc.sujet);
        if (!cle) return;
        if (!parSujet[cle]) parSujet[cle] = { libelle: String(doc.sujet).trim(), devis: [] };
        parSujet[cle].devis.push(doc);
    });

    var groupes = [];
    for (var cle in parSujet) {
        if (!Object.prototype.hasOwnProperty.call(parSujet, cle)) continue;
        // Un seul devis n'est pas un choix : le sujet n'apparaît pas.
        if (parSujet[cle].devis.length >= 2) groupes.push(parSujet[cle]);
    }
    return groupes.sort(function(a, b) { return b.devis.length - a.devis.length; });
}

function blocChoix() {
    var groupes = groupesDeSujet();
    var corps = groupes.length
        ? groupes.map(carteChoix).join('')
        : phraseVide('Aucun sujet n\'a encore deux devis à comparer.');

    return blocTableau('choix', 'fa-solid fa-scale-balanced', 'Choix à faire', groupes.length, corps);
}

function carteChoix(groupe) {
    var titre = groupe.libelle.charAt(0).toUpperCase() + groupe.libelle.slice(1);
    // Un <button> et pas un <a href="#"> : le routeur écoute
    // hashchange, un « # » qui atterrit dans l'URL ferait sauter la vue
    // au moindre pépin de JavaScript.
    var liens = groupe.devis.map(function(doc) {
        return '<li><button type="button" class="lien-bouton" onclick="ouvrirModaleElement(\'' + jsAttr(doc.id) + '\')">'
            + escapeHtml(doc.titre || 'Devis sans titre') + '</button>'
            + (doc.contactId ? ' <span class="carte-meta">— ' + escapeHtml(nomContact(doc.contactId)) + '</span>' : '')
            + '</li>';
    }).join('');

    return '<div class="carte-etat carte-choix">'
        + '<div class="carte-titre">' + escapeHtml(titre)
        +   ' <span class="badge badge-comparer">' + groupe.devis.length + ' devis, à comparer</span></div>'
        + '<ul class="carte-liste">' + liens + '</ul>'
        + '<button type="button" class="lien-bouton" onclick="afficherVue(\'documents\')">'
        +   'Voir la comparaison</button>'
        + '</div>';
}

// ------------------------------------------------------------
// 4. Mouvement
// ------------------------------------------------------------
// « cette semaine : 2 devis reçus, 1 relance faite » — et surtout son
// contraire, « rien n'a bougé depuis N jours », qui est l'information
// la plus utile de la vue quand le projet s'endort.
function blocMouvement() {
    var recents = elements.filter(function(e) {
        var jours = joursDepuis(e.creeLe);
        return jours !== null && jours < SEUIL_IMMOBILITE_JOURS;
    });

    var immobile = joursDepuisDernierMouvement();
    var corps;

    if (recents.length) {
        var parType = {};
        recents.forEach(function(e) { parType[e.type] = (parType[e.type] || 0) + 1; });
        var morceaux = [];
        TYPES.forEach(function(def) {
            if (!parType[def.value]) return;
            var n = parType[def.value];
            morceaux.push(n + ' ' + def.label.toLowerCase() + (n > 1 ? 's' : ''));
        });
        corps = '<p class="mouvement-phrase"><i class="fa-solid fa-arrow-trend-up"></i> '
            + 'Cette semaine : ' + escapeHtml(morceaux.join(', ')) + '.</p>';
    } else if (immobile === null) {
        corps = '<p class="mouvement-phrase mouvement-phrase--calme">'
            + 'Le chantier démarre : rien n\'est encore archivé.</p>';
    } else {
        corps = '<p class="mouvement-phrase mouvement-phrase--fige">'
            + '<i class="fa-solid fa-hourglass-end"></i> '
            + 'Rien n\'a bougé depuis ' + immobile + ' jour' + (immobile > 1 ? 's' : '') + '.</p>';
    }

    return blocTableau('mouvement', 'fa-solid fa-wave-square', 'Mouvement', null, corps);
}

// Nombre de jours depuis le dernier archivage, tous types confondus.
// null si la base est vide — « rien n'a bougé depuis 0 jour » sur un
// chantier qui n'a pas commencé serait absurde.
function joursDepuisDernierMouvement() {
    var mini = null;
    elements.forEach(function(e) {
        var jours = joursDepuis(e.creeLe);
        if (jours === null) return;
        if (mini === null || jours < mini) mini = jours;
    });
    return mini;
}

// ------------------------------------------------------------
// 5. Briques d'affichage
// ------------------------------------------------------------
function blocTableau(id, icone, titre, compte, corps) {
    return '<section class="bloc-etat" id="bloc-' + escapeAttr(id) + '">'
        + '<h2 class="bloc-titre"><i class="' + escapeAttr(icone) + '"></i> ' + escapeHtml(titre)
        +   (compte === null ? '' : ' <span class="bloc-compte">' + compte + '</span>')
        + '</h2>'
        + '<div class="bloc-corps">' + corps + '</div>'
        + '</section>';
}

// Un bloc vide affiche une phrase rassurante plutôt que de disparaître :
// « rien ne vous attend » est une information, pas un vide.
function phraseVide(texte) {
    return '<p class="bloc-vide">' + escapeHtml(texte) + '</p>';
}

// La carte du tableau de bord : ce qu'il faut savoir, et les trois
// boutons qui corrigent le camp en un clic quand la déduction se trompe.
function carteEtat(element) {
    var id = jsAttr(element.id);
    var def = getTypeDef(element.type);

    return '<div class="carte-etat">'
        + '<div class="carte-entete">'
        +   '<span class="carte-type" title="' + escapeAttr(def.label) + '"><i class="' + escapeAttr(def.icone) + '"></i></span>'
        +   '<button type="button" class="carte-titre carte-titre--bouton" onclick="ouvrirModaleElement(\'' + id + '\')">'
        +     escapeHtml(titreAffiche(element)) + '</button>'
        + '</div>'
        + '<div class="carte-meta">' + metaCarte(element) + '</div>'
        + boutonsCamp(element)
        + '</div>';
}

function metaCarte(element) {
    var bouts = [];

    if (element.camp === 'a_eux') {
        var jours = joursDepuis(element.campDepuis);
        if (jours !== null) {
            var texte = 'à eux depuis ' + jours + ' jour' + (jours > 1 ? 's' : '');
            bouts.push(jours >= SEUIL_RELANCE_JOURS
                ? '<span class="badge badge-relance"><i class="fa-solid fa-bell"></i>' + escapeHtml(texte) + ' — à relancer</span>'
                : '<span class="badge badge-attente">' + escapeHtml(texte) + '</span>');
        }
    }

    var echeance = toDate(element.dateEcheance);
    if (echeance) {
        var retard = joursDepuis(element.dateEcheance);
        bouts.push(retard !== null && retard > 0
            ? '<span class="badge badge-retard"><i class="fa-solid fa-triangle-exclamation"></i>en retard de ' + retard + ' j</span>'
            : '<span class="badge">échéance ' + escapeHtml(formatDateFr(element.dateEcheance)) + '</span>');
    }

    // L'assignation : à deux, une tâche sans nom est une tâche dont
    // chacun pense que l'autre s'occupe.
    if (element.assigneA) {
        bouts.push('<span class="badge badge-assigne"><i class="fa-solid fa-user"></i>' + escapeHtml(element.assigneA) + '</span>');
    }
    if (element.sujet) {
        bouts.push('<span class="badge badge-sujet">' + escapeHtml(element.sujet) + '</span>');
    }
    if (element.contactId) {
        bouts.push('<span class="badge badge-contact"><i class="fa-solid fa-address-card"></i>' + escapeHtml(nomContact(element.contactId)) + '</span>');
    }

    return bouts.join(' ');
}

// Trois boutons, un clic, aucune saisie. C'est ce qui rend la déduction
// automatique du camp acceptable : quand elle se trompe, la correction
// coûte moins cher que la question qu'on aurait posée à la création.
function boutonsCamp(element) {
    var id = jsAttr(element.id);
    var boutons = CAMPS.map(function(camp) {
        var actif = (element.camp === camp.value) ? ' active' : '';
        return '<button type="button" class="camp-btn' + actif + '"'
            + ' onclick="changerCamp(\'' + id + '\', \'' + jsAttr(camp.value) + '\')">'
            + '<i class="' + escapeAttr(camp.icone) + '"></i> ' + escapeHtml(camp.court) + '</button>';
    }).join('');
    return '<div class="camp-actions">' + boutons + '</div>';
}

// Le titre lisible d'un élément, quel que soit son type. Un email n'a
// pas de titre saisi : c'est son objet qui en tient lieu.
function titreAffiche(element) {
    if (element.titre) return element.titre;
    if (element.type === 'email') return element.objet || '(mail sans objet)';
    if (element.type === 'contact') return ((element.prenom || '') + ' ' + (element.nom || '')).trim() || element.entreprise || '(contact sans nom)';
    if (element.type === 'image') return 'Photo du ' + formatDateFr(element.dateEvenement);
    return '(sans titre)';
}
