// ============================================================
// exterieur.js — Le routeur, la recherche, la modale partagée
// ============================================================
// Une seule page HTML, plusieurs vues commutées par un sélecteur. Un
// seul onSnapshot les alimente toutes : découper en sept pages
// imposerait sept chargements Firestore, sept fois l'attente de
// l'authentification, et une recherche qui ne verrait qu'un morceau des
// données. Ici, changer de vue est instantané et la recherche balaie
// l'ensemble — ce qui est précisément le besoin.
//
// La vue courante est reflétée dans le fragment d'URL (#emails,
// #images-projection) : un rechargement ou un favori retombe au bon
// endroit.
//
// Ce fichier est chargé en DERNIER : il référence les fonctions de
// rendu définies dans les huit fichiers de vues.
// ============================================================

var VUES = [
    { nom: 'etat',             libelle: 'Où on en est', icone: 'fa-solid fa-compass',       render: renderEtat },
    { nom: 'fil',              libelle: 'Fil',          icone: 'fa-solid fa-stream',        render: renderFil },
    { nom: 'taches',           libelle: 'Tâches',       icone: 'fa-solid fa-list-check',    render: renderTaches },
    { nom: 'documents',        libelle: 'Documents',    icone: 'fa-solid fa-file-pdf',      render: renderDocuments },
    { nom: 'images-actuelle',  libelle: 'Aujourd’hui',  icone: 'fa-solid fa-camera',        render: function() { renderImages('actuelle'); } },
    { nom: 'images-projection', libelle: 'Projections', icone: 'fa-solid fa-wand-magic-sparkles', render: function() { renderImages('projection'); } },
    { nom: 'emails',           libelle: 'Emails',       icone: 'fa-solid fa-envelope',      render: renderEmails },
    { nom: 'carnet',           libelle: 'Carnet',       icone: 'fa-solid fa-address-book',  render: renderCarnet },
    { nom: 'projet',           libelle: 'Le projet',    icone: 'fa-solid fa-clipboard-list', render: renderProjet }
];

// La dixième vue n'est pas dans le sélecteur : on n'y va qu'en tapant
// dans la recherche, et on en sort en l'effaçant.
var VUE_RESULTATS = 'resultats';
var VUE_DEFAUT = 'etat';

var vueCourante = VUE_DEFAUT;
var vueAvantRecherche = VUE_DEFAUT;
var elementEnEdition = null;
var idASupprimer = null;

// ------------------------------------------------------------
// 1. Démarrage — appelé par auth.js une fois l'accès validé
// ------------------------------------------------------------
function onHubReady() {
    db = firebase.firestore();

    renderSelecteur();
    initAjout();
    initImages();
    initRoutage();

    // Amorçage avant l'écoute : l'adresse et le prénom de la personne
    // connectée rejoignent la fiche projet, ce qui fait fonctionner la
    // déduction envoyé/reçu et l'assignation dès la première visite.
    amorcerProjet();
    ecouterElements();
}

// ------------------------------------------------------------
// 2. Routage
// ------------------------------------------------------------
function trouverVue(nom) {
    for (var i = 0; i < VUES.length; i++) {
        if (VUES[i].nom === nom) return VUES[i];
    }
    return null;
}

function initRoutage() {
    window.addEventListener('hashchange', function() {
        var demandee = String(window.location.hash || '').replace(/^#/, '');
        if (demandee && demandee !== vueCourante) afficherVue(demandee);
    });

    var initiale = String(window.location.hash || '').replace(/^#/, '');
    afficherVue(trouverVue(initiale) ? initiale : VUE_DEFAUT);
}

function afficherVue(nom) {
    var cible = (nom === VUE_RESULTATS || trouverVue(nom)) ? nom : VUE_DEFAUT;
    vueCourante = cible;

    VUES.forEach(function(vue) {
        var conteneur = document.getElementById('vue-' + vue.nom);
        if (conteneur) conteneur.style.display = (vue.nom === cible) ? 'block' : 'none';
    });
    var resultats = document.getElementById('vue-' + VUE_RESULTATS);
    if (resultats) resultats.style.display = (cible === VUE_RESULTATS) ? 'block' : 'none';

    // La vue Résultats ne va pas dans l'URL : un favori sur une
    // recherche volatile n'aurait pas de sens.
    if (cible !== VUE_RESULTATS && window.location.hash.replace(/^#/, '') !== cible) {
        window.location.hash = cible;
    }

    majSelecteur();
    rendreVueCourante();
}

function rendreVueCourante() {
    if (vueCourante === VUE_RESULTATS) {
        renderResultats();
        return;
    }
    var vue = trouverVue(vueCourante);
    if (vue) vue.render();
}

// Appelé par ecouterElements() à chaque snapshot : seule la vue
// visible est redessinée, les autres le seront en y arrivant.
//
// Les deux couches ouvertes par-dessus se rafraîchissent aussi, mais
// elles seules : rattacher une projection ou noter un événement doit se
// voir sans refermer. On ne touche PAS aux champs de saisie de la
// modale élément — rejouer le formulaire effacerait ce qui est en train
// d'être tapé.
function rafraichirVues() {
    rendreVueCourante();
    rafraichirVisionneuse();

    var journal = document.getElementById('e-journal');
    if (journal && elementEnEdition) {
        var element = trouverElement(elementEnEdition);
        if (element) journal.innerHTML = htmlJournal(element);
    }
}

function renderSelecteur() {
    var barre = document.getElementById('selecteur-vues');
    if (!barre) return;
    barre.innerHTML = VUES.map(function(vue) {
        return '<button type="button" class="vue-btn" data-vue="' + escapeAttr(vue.nom) + '"'
            + ' onclick="afficherVue(\'' + jsAttr(vue.nom) + '\')">'
            + '<i class="' + escapeAttr(vue.icone) + '"></i> ' + escapeHtml(vue.libelle) + '</button>';
    }).join('');
    majSelecteur();
}

function majSelecteur() {
    var barre = document.getElementById('selecteur-vues');
    if (!barre) return;
    var boutons = barre.getElementsByTagName('button');
    for (var i = 0; i < boutons.length; i++) {
        var actif = (boutons[i].getAttribute('data-vue') === vueCourante);
        boutons[i].className = actif ? 'vue-btn active' : 'vue-btn';
    }
}

// ------------------------------------------------------------
// 3. Recherche globale
// ------------------------------------------------------------
// Firestore n'a pas de recherche plein texte : tout est en mémoire,
// donc tout se filtre en JavaScript. Valable tant que le volume reste
// de l'ordre de quelques centaines de documents — ce qui est le cas ici.
//
// Insensible à la casse ET aux accents : chercher « clôture » doit
// trouver « cloture », et l'inverse.
var CHAMPS_RECHERCHE = ['titre', 'corps', 'notes', 'objet', 'commentaire',
                        'nom', 'prenom', 'entreprise', 'sujet', 'de', 'a', 'url'];

function texteRecherchable(element) {
    var morceaux = [];
    for (var i = 0; i < CHAMPS_RECHERCHE.length; i++) {
        var valeur = element[CHAMPS_RECHERCHE[i]];
        if (valeur) morceaux.push(String(valeur));
    }
    // Le journal aussi : « pas disponible cette année » n'est écrit
    // nulle part ailleurs, et c'est exactement ce qu'on cherchera.
    journalDe(element).forEach(function(entree) {
        if (entree.texte) morceaux.push(entree.texte);
    });
    return normaliserTexte(morceaux.join(' '));
}

function chercher(terme) {
    var recherche = normaliserTexte(terme);
    if (!recherche) return [];
    return elements.filter(function(e) {
        return texteRecherchable(e).indexOf(recherche) !== -1;
    });
}

function surRecherche() {
    var champ = document.getElementById('search-input');
    var croix = document.getElementById('search-clear');
    var terme = champ ? champ.value.trim() : '';
    if (croix) croix.style.display = terme ? '' : 'none';

    if (!terme) {
        afficherVue(vueAvantRecherche);
        return;
    }
    // On mémorise d'où on vient pour y revenir quand la recherche se vide.
    if (vueCourante !== VUE_RESULTATS) vueAvantRecherche = vueCourante;
    afficherVue(VUE_RESULTATS);
}

function effacerRecherche() {
    var champ = document.getElementById('search-input');
    if (champ) champ.value = '';
    surRecherche();
}

function renderResultats() {
    var cible = document.getElementById('vue-resultats');
    if (!cible) return;

    var champ = document.getElementById('search-input');
    var terme = champ ? champ.value.trim() : '';
    var trouves = chercher(terme);

    if (!trouves.length) {
        cible.innerHTML = '<p class="bloc-vide">Rien ne correspond à « ' + escapeHtml(terme) + ' ».</p>';
        return;
    }

    // Les résultats mêlent tous les types — c'est tout l'intérêt du
    // tiroir unique : chercher « paysagiste » ramène aussi bien un mail
    // qu'une fiche contact.
    var evenements = trouves.filter(function(e) { return TYPES_FIL.indexOf(e.type) !== -1; });
    var references = trouves.filter(function(e) { return TYPES_FIL.indexOf(e.type) === -1; });

    var html = '<p class="result-count">' + trouves.length + ' résultat'
        + (trouves.length > 1 ? 's' : '') + ' pour « ' + escapeHtml(terme) + ' »</p>';

    if (references.length) {
        html += '<h2 class="bloc-titre"><i class="fa-solid fa-address-book"></i> Carnet</h2>'
            + '<div class="grille-contacts">'
            + references.map(function(e) { return (e.type === 'lien') ? carteLien(e) : carteContact(e); }).join('')
            + '</div>';
    }
    if (evenements.length) {
        html += '<h2 class="bloc-titre"><i class="fa-solid fa-stream"></i> Fil</h2>'
            + '<div class="fil">' + evenements.map(carteElement).join('') + '</div>';
    }
    cible.innerHTML = html;
}

// ------------------------------------------------------------
// 4. La modale élément (partagée par toutes les vues)
// ------------------------------------------------------------
function versInputDate(valeur) {
    var date = toDate(valeur);
    if (!date) return '';
    var mois = String(date.getMonth() + 1);
    var jour = String(date.getDate());
    if (mois.length < 2) mois = '0' + mois;
    if (jour.length < 2) jour = '0' + jour;
    return date.getFullYear() + '-' + mois + '-' + jour;
}

function depuisInputDate(texte) {
    if (!texte) return null;
    var bouts = String(texte).split('-');
    if (bouts.length !== 3) return null;
    var date = new Date(Number(bouts[0]), Number(bouts[1]) - 1, Number(bouts[2]));
    return isNaN(date.getTime()) ? null : date;
}

function afficherLigne(id, visible) {
    var ligne = document.getElementById(id);
    if (ligne) ligne.style.display = visible ? '' : 'none';
}

// prerempli : ce que le dépôt d'un fichier a pu deviner. Tout ce qui
// peut l'être l'est déjà quand cette modale s'ouvre.
function ouvrirModaleElement(id, prerempli) {
    var element = id ? trouverElement(id) : (prerempli || {});
    if (!element) return;

    elementEnEdition = id || null;
    var type = element.type || 'note';

    document.getElementById('e-type').value = type;
    remplirSelectType(type);

    document.getElementById('e-titre').value = element.titre || element.objet || '';
    document.getElementById('e-notes').value = element.notes || '';
    document.getElementById('e-sujet').value = element.sujet || '';
    document.getElementById('e-echeance').value = versInputDate(element.dateEcheance);

    remplirSelectCamp(element.camp || '');
    remplirSelectAssigne(element.assigneA || '');
    remplirSelectContact(element.contactId || '');
    remplirDatalistSujets();
    remplirSelectCategorie(element.categorie || 'actuelle');
    remplirSelectImageSource(element.imageSourceId || '', id);

    // Champs propres aux emails
    document.getElementById('e-de').value = element.de || '';
    document.getElementById('e-a').value = element.a || '';
    document.getElementById('e-objet').value = element.objet || '';
    document.getElementById('e-corps').value = element.corps || '';
    document.getElementById('e-sens').value = element.sens || 'recu';

    appliquerTypeModale(type, element);

    // Le fichier n'est jamais remplacé depuis cette modale : le lien
    // est là pour vérifier, pas pour rééditer.
    var lien = document.getElementById('e-fichier');
    if (lien) {
        if (element.url) {
            lien.style.display = '';
            lien.href = element.url;
            lien.textContent = element.nomFichier || 'Ouvrir le fichier';
        } else {
            lien.style.display = 'none';
        }
    }

    var alerte = document.getElementById('e-alerte-parse');
    if (alerte) {
        alerte.style.display = (type === 'email' && element.parseOk === false) ? '' : 'none';
    }

    var meta = document.getElementById('e-meta');
    if (meta) {
        meta.textContent = id
            ? ('Ajouté par ' + (element.creePar || '?') + ' le ' + formatDateFr(element.creeLe)
               + ' — modifié par ' + (element.modifiePar || '?') + ' le ' + formatDateFr(element.modifieLe))
            : '';
    }

    document.getElementById('e-btn-supprimer').style.display = id ? '' : 'none';
    document.getElementById('element-overlay').style.display = 'flex';

    // On garde en mémoire ce que le dépôt a produit : url, sens,
    // parseOk, dates… autant de champs qui n'ont pas de champ de
    // saisie mais qui doivent bien être écrits.
    elementModaleContexte = element;

    document.getElementById('e-titre').focus();
}

var elementModaleContexte = {};

function fermerModaleElement() {
    document.getElementById('element-overlay').style.display = 'none';
    elementEnEdition = null;
    elementModaleContexte = {};
}

// Les deux types entre lesquels on peut se tromper, et le seul couple
// qu'il soit honnête de laisser rebasculer : un fichier avec un titre.
// Un mail a une structure (de, à, objet, corps) qu'un devis n'a pas ;
// une tâche n'a pas de fichier du tout. Les convertir perdrait quelque
// chose, et le silence sur cette perte serait pire que l'absence du
// bouton.
var TYPES_RECLASSABLES = ['document', 'image'];

// Toute la modale suit le type, y compris quand il change en cours de
// route. Extrait de ouvrirModaleElement pour être rejoué à la volée :
// c'est ce qui permet de corriger « c'est un plan, pas une photo » sans
// refermer, ni retéléverser.
function appliquerTypeModale(type, element) {
    var def = getTypeDef(type);
    document.getElementById('element-modal-titre').innerHTML =
        '<i class="' + escapeAttr(def.icone) + '"></i> '
        + escapeHtml((elementEnEdition ? 'Modifier ' : 'Nouvel élément — ') + def.label.toLowerCase());

    var actionnable = (TYPES_ACTIONNABLES.indexOf(type) !== -1);
    afficherLigne('ligne-type', TYPES_RECLASSABLES.indexOf(type) !== -1);
    afficherLigne('ligne-camp', actionnable);
    afficherLigne('ligne-echeance', type === 'tache');
    afficherLigne('ligne-assigne', type === 'tache');
    afficherLigne('ligne-sujet', type === 'document' || type === 'tache' || type === 'email');
    afficherLigne('ligne-contact', type !== 'contact' && type !== 'lien');
    afficherLigne('ligne-categorie', type === 'image');
    afficherLigne('ligne-notes', type !== 'email');
    afficherLigne('bloc-email', type === 'email');
    surChangementCategorieImage();

    // Le journal n'existe qu'une fois l'élément créé : il s'écrit tout
    // de suite, il lui faut donc un document où atterrir.
    afficherLigne('bloc-journal', !!elementEnEdition && actionnable);
    var journal = document.getElementById('e-journal');
    if (journal) journal.innerHTML = elementEnEdition ? htmlJournal(element || {}) : '';
}

function remplirSelectType(type) {
    var select = document.getElementById('e-type-choix');
    if (!select) return;
    select.innerHTML = TYPES_RECLASSABLES.map(function(valeur) {
        return '<option value="' + escapeAttr(valeur) + '">'
            + escapeHtml(getTypeDef(valeur).label) + '</option>';
    }).join('');
    // Un mail ou une tâche n'est pas dans la liste : la ligne est de
    // toute façon masquée, on ne force pas une valeur qui n'existe pas.
    if (TYPES_RECLASSABLES.indexOf(type) !== -1) select.value = type;
}

// Le champ caché e-type reste la source de vérité — sauverElement et la
// moitié de la modale le lisent. Le sélecteur ne fait que l'écrire.
function surChangementTypeElement() {
    var select = document.getElementById('e-type-choix');
    if (!select || !select.value) return;
    document.getElementById('e-type').value = select.value;
    appliquerTypeModale(select.value, elementEnEdition ? trouverElement(elementEnEdition) : null);
}

function remplirSelectCamp(valeur) {
    var select = document.getElementById('e-camp');
    if (!select) return;
    select.innerHTML = CAMPS.map(function(camp) {
        return '<option value="' + escapeAttr(camp.value) + '">' + escapeHtml(camp.label) + '</option>';
    }).join('');
    select.value = valeur || 'a_nous';
}

// La liste vient de la fiche projet, pas de l'annuaire des membres :
// les règles Firestore n'autorisent un membre à lire que sa propre
// fiche. Alisson ne peut donc pas lister les membres, et l'interface ne
// peut pas lui proposer « assigner à Cyril » par ce chemin.
function remplirSelectAssigne(valeur) {
    var select = document.getElementById('e-assigne');
    if (!select) return;
    var options = '<option value="">Personne</option>';
    intervenants().forEach(function(nom) {
        options += '<option value="' + escapeAttr(nom) + '">' + escapeHtml(nom) + '</option>';
    });
    // Une valeur héritée mais absente de la liste ne doit pas
    // disparaître silencieusement à la première modification.
    if (valeur && intervenants().indexOf(valeur) === -1) {
        options += '<option value="' + escapeAttr(valeur) + '">' + escapeHtml(valeur) + '</option>';
    }
    select.innerHTML = options;
    select.value = valeur || '';
}

function remplirSelectContact(valeur) {
    var select = document.getElementById('e-contact');
    if (!select) return;
    var options = '<option value="">Aucun</option>';
    elementsDeType('contact')
        .sort(function(a, b) {
            var na = normaliserTexte(titreAffiche(a)), nb = normaliserTexte(titreAffiche(b));
            return na < nb ? -1 : (na > nb ? 1 : 0);
        })
        .forEach(function(contact) {
            options += '<option value="' + escapeAttr(contact.id) + '">' + escapeHtml(titreAffiche(contact)) + '</option>';
        });
    if (valeur && !contactExiste(valeur)) {
        options += '<option value="' + escapeAttr(valeur) + '">contact supprimé</option>';
    }
    select.innerHTML = options;
    select.value = valeur || '';
}

// Les sujets déjà saisis, proposés à la frappe : la normalisation
// rattrape « Terrasse » contre « terrasse », elle ne rattrape pas
// « Terasse ». Le datalist évite la variante à la source.
function remplirDatalistSujets() {
    var liste = document.getElementById('e-sujets');
    if (!liste) return;
    var vus = {};
    var sujets = [];
    elements.forEach(function(e) {
        if (!e.sujet) return;
        var cle = cleSujet(e.sujet);
        if (vus[cle]) return;
        vus[cle] = true;
        sujets.push(String(e.sujet).trim());
    });
    sujets.sort();
    liste.innerHTML = sujets.map(function(s) {
        return '<option value="' + escapeAttr(s) + '"></option>';
    }).join('');
}

function remplirSelectCategorie(valeur) {
    var select = document.getElementById('e-categorie');
    if (!select) return;
    select.innerHTML = CATEGORIES_IMAGE.map(function(cat) {
        return '<option value="' + escapeAttr(cat.value) + '">' + escapeHtml(cat.label) + '</option>';
    }).join('');
    select.value = valeur || 'actuelle';
}

// La photo du terrain dont une projection découle. Toujours remplie,
// même quand la ligne est masquée : sauverElement() relit ce select, et
// un select vidé effacerait le lien sans rien demander à personne.
function remplirSelectImageSource(valeur, idCourant) {
    var select = document.getElementById('e-image-source');
    if (!select) return;

    var options = '<option value="">Aucune</option>';
    var connue = !valeur;
    imagesActuelles().forEach(function(image) {
        // Une image ne découle pas d'elle-même.
        if (image.id === idCourant) return;
        if (image.id === valeur) connue = true;
        options += '<option value="' + escapeAttr(image.id) + '">'
            + escapeHtml(titreAffiche(image) + ' — ' + formatDateFr(image.dateEvenement || image.creeLe))
            + '</option>';
    });

    // Photo d'origine supprimée, ou reclassée en projection : la valeur
    // n'a plus d'option. On lui en fabrique une plutôt que de laisser le
    // select retomber sur « Aucune » — le lien survivrait mal à un
    // simple passage dans le formulaire.
    if (!connue) {
        var source = trouverElement(valeur);
        options += '<option value="' + escapeAttr(valeur) + '">'
            + escapeHtml(source ? titreAffiche(source) : 'photo supprimée') + '</option>';
    }

    select.innerHTML = options;
    select.value = valeur || '';
}

// Une photo du terrain ne découle de rien : la ligne ne s'affiche que
// pour les projections, et suit le sélecteur de catégorie en direct.
function surChangementCategorieImage() {
    var type = document.getElementById('e-type');
    var categorie = document.getElementById('e-categorie');
    afficherLigne('ligne-image-source',
        !!type && type.value === 'image' && !!categorie && categorie.value === 'projection');
}

// ------------------------------------------------------------
// 4 bis. Le journal, en lecture
// ------------------------------------------------------------
// Du plus ancien au plus récent, création comprise. On lit une
// histoire : commencer par la fin la rendrait illisible.
function htmlJournal(element) {
    return journalAffiche(element).map(function(entree) {
        var etiquette;
        if (entree.creation) {
            etiquette = '<span class="badge badge-creation">Création</span>';
        } else {
            var def = getCampDef(entree.camp);
            etiquette = def
                ? '<span class="badge badge-camp badge-camp--' + escapeAttr(entree.camp) + '">'
                    + '<i class="' + escapeAttr(def.icone) + '"></i>' + escapeHtml(def.label) + '</span>'
                : '';
        }

        return '<li class="journal-entree">'
            + '<div class="journal-ligne-meta">'
            +   '<span class="journal-quand">' + escapeHtml(formatDateFr(entree.le)) + '</span>'
            +   (entree.par ? '<span class="journal-qui">' + escapeHtml(entree.par) + '</span>' : '')
            +   etiquette
            + '</div>'
            + (entree.texte ? '<p class="journal-texte">' + escapeHtml(entree.texte) + '</p>' : '')
            + '</li>';
    }).join('');
}

function sauverElement() {
    var type = document.getElementById('e-type').value;
    var contexte = elementModaleContexte || {};
    var titre = document.getElementById('e-titre').value.trim();
    var objet = document.getElementById('e-objet').value.trim();

    // Le titre d'un document est obligatoire : le contenu d'un PDF
    // n'est pas indexable, un devis sans titre serait introuvable et la
    // recherche mentirait. Il est pré-rempli depuis le nom du fichier —
    // il n'est donc refusé que si on l'a vraiment vidé.
    if (!titre && type !== 'email') {
        showToast('Le titre est obligatoire.', 'error');
        document.getElementById('e-titre').focus();
        return;
    }

    var donnees = { type: type, titre: titre || objet };

    if (type !== 'email') {
        donnees.notes = document.getElementById('e-notes').value.trim();
    }
    if (TYPES_ACTIONNABLES.indexOf(type) !== -1) {
        donnees.camp = document.getElementById('e-camp').value;
    } else if (elementEnEdition) {
        // Reclassé en type non actionnable — un devis devenu photo. Le
        // camp doit partir, sinon l'élément resterait sur le tableau de
        // bord sans plus aucun bouton pour l'en sortir. Vidé et non
        // supprimé : le journal, lui, garde toute l'histoire.
        var precedent = trouverElement(elementEnEdition);
        if (precedent && precedent.camp) donnees.camp = '';
    }
    if (type === 'tache') {
        var echeance = depuisInputDate(document.getElementById('e-echeance').value);
        donnees.dateEcheance = echeance;
        donnees.assigneA = document.getElementById('e-assigne').value;
    }
    if (type === 'document' || type === 'tache' || type === 'email') {
        donnees.sujet = document.getElementById('e-sujet').value.trim();
    }
    if (type !== 'contact' && type !== 'lien') {
        donnees.contactId = document.getElementById('e-contact').value;
    }
    if (type === 'image') {
        donnees.categorie = document.getElementById('e-categorie').value;
        donnees.imageSourceId = document.getElementById('e-image-source').value;
    }
    if (type === 'email') {
        donnees.de = document.getElementById('e-de').value.trim();
        donnees.a = document.getElementById('e-a').value.trim();
        donnees.objet = objet;
        donnees.sens = document.getElementById('e-sens').value;

        var corpsSaisi = document.getElementById('e-corps').value;
        var corps = tronquerCorps(corpsSaisi);
        donnees.corps = corps.corps;
        // Si le corps stocké était déjà abrégé et qu'on n'y a pas
        // touché, il l'est toujours. Perdre ce drapeau ferait croire à
        // « Copier le corps » qu'il rend le mail entier, alors qu'il
        // collerait la version courte dans Gmail sans le dire.
        donnees.corpsTronque = corps.corpsTronque
            || (!!contexte.corpsTronque && corpsSaisi === (contexte.corps || ''));
        donnees.parseOk = (contexte.parseOk === undefined) ? true : !!contexte.parseOk;
        if (contexte.dateEnvoi) donnees.dateEnvoi = contexte.dateEnvoi;
    }

    // Champs issus du dépôt, sans champ de saisie propre.
    if (contexte.url && !elementEnEdition) {
        donnees.url = contexte.url;
        if (contexte.nomFichier) donnees.nomFichier = contexte.nomFichier;
    }
    if (contexte.dateEvenement && !elementEnEdition) {
        donnees.dateEvenement = contexte.dateEvenement;
    }
    // Le texte intégral d'un mail collé trop long pour tenir dans
    // « corps ». Il n'y a pas de fichier d'origine à relire pour un mail
    // collé : sans cette ligne, la fin serait perdue à l'enregistrement.
    // Jamais en modification — le snapshot ne renvoie pas emlBrut, on
    // écrirait donc une version vide par-dessus l'originale.
    if (contexte.emlBrut && !elementEnEdition) {
        donnees.emlBrut = contexte.emlBrut;
    }

    var operation;
    if (elementEnEdition) {
        var avant = trouverElement(elementEnEdition);
        // Le camp a changé : campDepuis repart de maintenant, sinon
        // l'ancienneté affichée compterait depuis la mauvaise bascule.
        // Et la bascule entre au journal, comme depuis les boutons de
        // camp — sinon l'histoire aurait des trous selon le chemin pris.
        if (donnees.camp && avant && avant.camp !== donnees.camp) {
            donnees.campDepuis = horodatage();
            donnees.journal = firebase.firestore.FieldValue.arrayUnion(
                entreeJournal('', avant.camp, donnees.camp));
        }
        operation = modifierElement(elementEnEdition, donnees);
    } else {
        operation = creerElement(donnees);
    }

    operation
        .then(function() {
            showToast(elementEnEdition ? 'Élément mis à jour.' : 'Élément ajouté.', 'success');
            fermerModaleElement();
        })
        .catch(function(erreur) {
            console.error(erreur);
            showToast('Enregistrement impossible : ' + erreur.message, 'error');
        });
}

// ------------------------------------------------------------
// 4 ter. Le journal, en écriture
// ------------------------------------------------------------
// Deux portes d'entrée, une seule modale :
//   un bouton de camp   — on bascule ET on dit pourquoi
//   « Noter ce qui s'est passé » — on raconte sans rien basculer
//
// L'écriture part dès la validation, sans passer par « Enregistrer » de
// la modale élément : un événement est un fait daté, pas un brouillon.
var journalCible = null;
var journalCampVise = '';

function ouvrirModaleJournal(id, camp) {
    var element = id ? trouverElement(id) : null;
    if (!element) return;

    journalCible = id;
    // Recliquer sur le camp où l'on est déjà n'est pas une bascule :
    // « À nous → À nous » ne raconterait rien. On garde la porte
    // ouverte, mais comme simple note.
    journalCampVise = (camp && camp !== element.camp) ? camp : '';

    var def = getCampDef(journalCampVise);
    document.getElementById('journal-modal-titre').textContent =
        def ? 'Que s’est-il passé ?' : 'Noter ce qui s’est passé';

    var contexte = document.getElementById('journal-contexte');
    if (contexte) {
        var depart = getCampDef(element.camp);
        contexte.innerHTML = '<strong>' + escapeHtml(titreAffiche(element)) + '</strong>'
            + (def
                ? '<br>' + escapeHtml((depart ? depart.label : 'Sans camp') + ' → ' + def.label)
                : '');
    }

    // Le bouton « Sans note » n'a de sens qu'avec une bascule à écrire :
    // une note vide sans changement de camp ne raconterait rien.
    var sansNote = document.getElementById('j-btn-sans-note');
    if (sansNote) sansNote.style.display = def ? '' : 'none';

    var texte = document.getElementById('j-texte');
    if (texte) {
        texte.value = '';
        texte.placeholder = def
            ? placeholderSelonCamp(journalCampVise)
            : 'Ex : relancé par téléphone, sans réponse.';
    }

    document.getElementById('journal-overlay').style.display = 'flex';
    if (texte) texte.focus();
}

// Le meilleur moyen de faire écrire quelqu'un est de lui montrer la
// phrase qu'il aurait écrite.
function placeholderSelonCamp(camp) {
    if (camp === 'a_eux') return 'Ex : mail envoyé à Jean Dupont, il répond sous huit jours.';
    if (camp === 'clos')  return 'Ex : pas disponible avant l’an prochain, on ne travaillera pas avec eux.';
    return 'Ex : leur réponse est arrivée, à nous de trancher.';
}

function fermerModaleJournal() {
    document.getElementById('journal-overlay').style.display = 'none';
    journalCible = null;
    journalCampVise = '';
}

function validerJournal(sansNote) {
    if (!journalCible) return;
    var champ = document.getElementById('j-texte');
    var texte = sansNote ? '' : (champ ? champ.value.trim() : '');

    if (!texte && !journalCampVise) {
        showToast('Écrivez ce qui s’est passé, ou annulez.', 'error');
        if (champ) champ.focus();
        return;
    }

    var id = journalCible;
    var camp = journalCampVise;
    var operation = camp ? changerCamp(id, camp, texte) : ajouterEvenement(id, texte, '');

    operation
        .then(function() {
            if (!camp) showToast('Noté au journal.', 'success');
            fermerModaleJournal();
        })
        .catch(function(erreur) {
            console.error(erreur);
            showToast('Impossible de noter : ' + erreur.message, 'error');
        });
}

// Ctrl+Entrée valide : la souris n'a rien à faire au bout d'un texte
// qu'on vient de taper ou de coller. Les deux seules modales où l'on
// écrit d'abord et où l'on valide ensuite.
var VALIDATION_CLAVIER = [
    { overlay: 'journal-overlay', valider: function() { validerJournal(false); } },
    { overlay: 'coller-overlay',  valider: function() { validerCollage(); } }
];

document.addEventListener('keydown', function(evenement) {
    if (evenement.key !== 'Enter' || !(evenement.ctrlKey || evenement.metaKey)) return;
    for (var i = 0; i < VALIDATION_CLAVIER.length; i++) {
        var overlay = document.getElementById(VALIDATION_CLAVIER[i].overlay);
        if (overlay && overlay.style.display === 'flex') {
            evenement.preventDefault();
            VALIDATION_CLAVIER[i].valider();
            return;
        }
    }
});

// ------------------------------------------------------------
// 5. Suppression
// ------------------------------------------------------------
// ⚠ Supprimer un élément n'efface PAS son fichier chez Cloudinary : ça
// demanderait la clé secrète du compte. Le message le dit, parce qu'une
// suppression qui n'efface pas est un piège si on l'ignore.
function demanderSuppression(id, avertissement) {
    idASupprimer = id;
    var element = trouverElement(id);
    var zone = document.getElementById('suppression-detail');
    if (zone) {
        var messages = [];
        if (avertissement) messages.push(avertissement);
        if (element && element.url) {
            messages.push('Le fichier restera stocké chez Cloudinary : une suppression ici n\'est pas un effacement.');
        }
        zone.innerHTML = messages.map(function(m) { return escapeHtml(m); }).join('<br>');
    }
    document.getElementById('suppression-overlay').style.display = 'flex';
}

function fermerModaleSuppression() {
    document.getElementById('suppression-overlay').style.display = 'none';
    idASupprimer = null;
}

function confirmerSuppression() {
    if (!idASupprimer) return;
    supprimerElement(idASupprimer)
        .then(function() {
            showToast('Élément supprimé.', 'success');
            fermerModaleSuppression();
            fermerModaleJournal();
            fermerModaleElement();
            fermerModaleContact();
            fermerModaleLien();
        })
        .catch(function(erreur) {
            console.error(erreur);
            showToast('Suppression impossible : ' + erreur.message, 'error');
        });
}

// ------------------------------------------------------------
// 6. Échap ferme la modale la plus haute
// ------------------------------------------------------------
// Dans l'ordre d'empilement : la modale journal se ferme avant la
// modale élément, qui peut être ouverte dessous.
var OVERLAYS = ['suppression-overlay', 'journal-overlay', 'coller-overlay',
                'visionneuse-overlay', 'contact-overlay', 'lien-overlay',
                'element-overlay', 'ajout-overlay'];

document.addEventListener('keydown', function(evenement) {
    if (evenement.key !== 'Escape') return;
    for (var i = 0; i < OVERLAYS.length; i++) {
        var overlay = document.getElementById(OVERLAYS[i]);
        if (overlay && overlay.style.display === 'flex') {
            overlay.style.display = 'none';
            if (OVERLAYS[i] === 'element-overlay') elementEnEdition = null;
            if (OVERLAYS[i] === 'journal-overlay') { journalCible = null; journalCampVise = ''; }
            return;
        }
    }
});
