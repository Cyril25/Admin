// ============================================================
// exterieur-images.js — Les deux vues d'images
// ============================================================
//   actuelle    — l'état du terrain aujourd'hui
//   projection  — rendus IA, inspirations, croquis d'archi
// Deux vues distinctes parce que ce sont deux usages : on montre les
// premières à un artisan, on rêve sur les secondes.
//
// Les deux se répondent : une projection est faite À PARTIR d'une photo
// du terrain, et on veut, en regardant un coin du jardin, revoir tout
// ce qu'on a imaginé dessus. D'où le rattachement — un champ
// imageSourceId sur la projection, lu dans les deux sens (voir
// projectionsDe / imageSourceDe dans exterieur-donnees.js).
//
// C'est la seule partie du projet vraiment pensée pour le mobile : les
// photos du terrain se prennent au téléphone. L'archivage des mails,
// lui, restera une opération de bureau — l'application Gmail mobile ne
// permet pas de télécharger un .eml.
// ============================================================

function renderImages(categorie) {
    var cible = document.getElementById('vue-images-' + categorie);
    if (!cible) return;

    var photos = elementsDeType('image')
        .filter(function(i) { return (i.categorie || 'actuelle') === categorie; })
        .sort(parDateDecroissante);

    cible.innerHTML = barreImages(categorie)
        + (photos.length
            ? '<div class="grille-images">' + photos.map(vignetteImage).join('') + '</div>'
            : '<p class="bloc-vide">' + escapeHtml(premierChargement
                ? 'Chargement…'
                : (categorie === 'actuelle'
                    ? 'Aucune photo du terrain. Prenez-en une, c\'est le geste le moins cher du projet.'
                    : 'Aucune projection. Déposez un rendu, une inspiration, un croquis.'))
              + '</p>');
}

// Deux entrées distinctes, et ce n'est pas un détail : accept="image/*"
// seul n'ouvre PAS l'appareil photo, ni sur iOS ni sur Android — il
// ouvre un sélecteur. Forcer la caméra demande capture="environment",
// mais on perd alors l'accès à la galerie. Il faut donc les deux.
function barreImages(categorie) {
    return '<div class="images-actions">'
        + '<button type="button" class="btn-add" onclick="declencherPhoto(\'camera\', \'' + jsAttr(categorie) + '\')">'
        +   '<i class="fa-solid fa-camera"></i> Prendre une photo</button>'
        + '<button type="button" class="btn-export" onclick="declencherPhoto(\'galerie\', \'' + jsAttr(categorie) + '\')">'
        +   '<i class="fa-solid fa-folder-open"></i> Choisir un fichier</button>'
        + '</div>';
}

// Deux champs de fichier propres à cette vue, mais la même intention
// que partout ailleurs : « Prendre une photo » depuis les Projections y
// range bien la photo. Voir intentionDepot dans exterieur-upload.js.
function declencherPhoto(source, categorie) {
    intentionDepot = { type: 'image', categorie: categorie || 'actuelle' };
    var champ = document.getElementById(source === 'camera' ? 'photo-camera' : 'photo-galerie');
    if (champ) champ.click();
}

function initImages() {
    ['photo-camera', 'photo-galerie'].forEach(function(id) {
        var champ = document.getElementById(id);
        if (!champ) return;
        champ.addEventListener('change', function() {
            var intention = intentionDepot || { type: 'image', categorie: 'actuelle' };
            intentionDepot = null;
            if (champ.files && champ.files.length) deposerFichier(champ.files[0], intention);
            champ.value = '';
        });
    });
}

function vignetteImage(image) {
    var id = jsAttr(image.id);
    return '<figure class="vignette">'
        + '<button type="button" class="vignette-bouton" onclick="ouvrirVisionneuse(\'' + id + '\')">'
        +   '<img loading="lazy" alt="' + escapeAttr(titreAffiche(image)) + '" src="'
        +     escapeAttr(urlVignette(image.url, 400)) + '">'
        +   pastilleLiens(image)
        + '</button>'
        + '<figcaption>'
        +   '<span class="vignette-date">' + escapeHtml(formatDateFr(image.dateEvenement || image.creeLe)) + '</span>'
        +   '<button type="button" class="icon-btn" title="Modifier" onclick="ouvrirModaleElement(\'' + id + '\')">'
        +     '<i class="fa-solid fa-pen"></i></button>'
        + '</figcaption>'
        + '</figure>';
}

// Posée sur la vignette : « ce coin du jardin a trois projections », ou
// « cette projection sait d'où elle vient ». Sans elle, il faudrait
// ouvrir chaque image pour savoir laquelle en a.
function pastilleLiens(image) {
    if ((image.categorie || 'actuelle') === 'projection') {
        if (!image.imageSourceId) return '';
        return '<span class="vignette-pastille" title="Faite à partir d\'une photo du terrain">'
            + '<i class="fa-solid fa-camera-retro"></i></span>';
    }
    var liees = projectionsDe(image.id);
    if (!liees.length) return '';
    return '<span class="vignette-pastille" title="Projections établies avec cette photo">'
        + '<i class="fa-solid fa-wand-magic-sparkles"></i> ' + liees.length + '</span>';
}

// ------------------------------------------------------------
// Visionneuse
// ------------------------------------------------------------
var imageOuverte = null;

function ouvrirVisionneuse(id) {
    if (!trouverElement(id)) return;
    imageOuverte = id;

    var overlay = document.getElementById('visionneuse-overlay');
    if (overlay) overlay.style.display = 'flex';
    rafraichirVisionneuse();
}

// Séparé de l'ouverture pour être rejoué après chaque snapshot :
// rattacher une projection doit se voir tout de suite, sans refermer.
// Si l'image a disparu entre-temps, on ferme plutôt que d'afficher une
// photo qui n'existe plus.
function rafraichirVisionneuse() {
    if (!imageOuverte) return;
    var image = trouverElement(imageOuverte);
    if (!image) { fermerVisionneuse(); return; }

    var grande = document.getElementById('visionneuse-image');
    var legende = document.getElementById('visionneuse-legende');
    var bascule = document.getElementById('visionneuse-bascule');
    var liens = document.getElementById('visionneuse-liens');

    if (grande) {
        grande.src = urlVignette(image.url, 1600);
        grande.alt = titreAffiche(image);
    }
    if (legende) {
        legende.textContent = titreAffiche(image) + ' — ' + formatDateFr(image.dateEvenement || image.creeLe);
    }
    if (bascule) {
        var cible = ((image.categorie || 'actuelle') === 'actuelle') ? 'projection' : 'actuelle';
        bascule.textContent = (cible === 'projection') ? 'Classer en projection' : 'Classer en photo actuelle';
        bascule.onclick = function() { basculerCategorie(image.id, cible); };
    }
    if (liens) {
        liens.innerHTML = ((image.categorie || 'actuelle') === 'projection')
            ? liensDepuisProjection(image)
            : liensDepuisPhoto(image);
    }
}

function fermerVisionneuse() {
    var overlay = document.getElementById('visionneuse-overlay');
    if (overlay) overlay.style.display = 'none';
    imageOuverte = null;
}

// ------------------------------------------------------------
// Rattachement photo ↔ projections
// ------------------------------------------------------------
// Vu depuis une photo du terrain : tout ce qu'on a imaginé dessus.
//
// La relation n'est pas symétrique, et c'est ce qui gouverne la liste
// proposée ci-dessous : une projection découle d'UNE photo et d'une
// seule — c'est le sens du champ unique imageSourceId — alors qu'une
// photo en porte autant qu'on veut.
function liensDepuisPhoto(image) {
    var liees = projectionsDe(image.id);
    var vignettes = liees.map(function(projection) {
        return miniatureLiee(projection, 'Détacher cette projection',
            'rattacherProjection(\'' + jsAttr(projection.id) + '\', \'\')');
    }).join('');

    return '<h3 class="visionneuse-liens-titre">'
        +   '<i class="fa-solid fa-wand-magic-sparkles"></i> '
        +   escapeHtml(liees.length
                ? ('Projections établies avec cette photo (' + liees.length + ')')
                : 'Aucune projection rattachée à cette photo')
        + '</h3>'
        + (vignettes ? '<div class="visionneuse-miniatures">' + vignettes + '</div>' : '')
        + choixDeRattachement(image);
}

// Ne sont proposées que les projections encore libres. Une projection
// déjà rattachée ailleurs ne doit pas apparaître ici : un clic la
// volerait à l'autre photo sans rien dire, et elle n'a qu'une origine à
// donner. Pour la déplacer, on la détache d'abord — le geste est
// explicite, et il se fait depuis la photo qui la porte.
//
// « Libre » se lit sur la source VIVANTE, pas sur le champ : une
// projection dont la photo d'origine a été supprimée n'est plus
// rattachée à rien, elle redevient proposable.
function choixDeRattachement(image) {
    var projections = elementsDeType('image').filter(function(i) {
        return (i.categorie || 'actuelle') === 'projection';
    });
    var libres = projections.filter(function(i) { return !imageSourceDe(i); })
        .sort(parDateDecroissante);

    if (libres.length) {
        return selectRattachement(libres, 'Rattacher une projection…',
            'rattacherProjection(this.value, \'' + jsAttr(image.id) + '\')');
    }

    // Rien à proposer n'est pas la même chose qu'un bouton absent :
    // sans un mot, on chercherait ce qui ne s'affiche pas.
    var autres = projections.filter(function(i) { return i.imageSourceId !== image.id; });
    return '<p class="visionneuse-note">' + escapeHtml(autres.length
        ? 'Les autres projections sont déjà rattachées à une photo. Détachez-en une pour la déplacer ici.'
        : 'Aucune autre projection pour l’instant.') + '</p>';
}

// Vu depuis une projection : d'où elle vient.
function liensDepuisProjection(image) {
    var source = imageSourceDe(image);
    var appel = 'rattacherProjection(\'' + jsAttr(image.id) + '\', this.value)';

    if (image.imageSourceId && !source) {
        return '<h3 class="visionneuse-liens-titre">'
            + '<i class="fa-solid fa-camera-retro"></i> Photo d’origine supprimée</h3>'
            + selectRattachement(imagesActuelles(), 'Rattacher à une autre photo…', appel);
    }

    if (source) {
        return '<h3 class="visionneuse-liens-titre">'
            +   '<i class="fa-solid fa-camera-retro"></i> Établie à partir de cette photo</h3>'
            + '<div class="visionneuse-miniatures">'
            +   miniatureLiee(source, 'Détacher',
                    'rattacherProjection(\'' + jsAttr(image.id) + '\', \'\')')
            + '</div>';
    }

    var actuelles = imagesActuelles();
    return '<h3 class="visionneuse-liens-titre">'
        +   '<i class="fa-solid fa-camera-retro"></i> '
        +   (actuelles.length
                ? 'Aucune photo d’origine'
                : 'Aucune photo du terrain à laquelle la rattacher')
        + '</h3>'
        + selectRattachement(actuelles, 'Rattacher à une photo d’aujourd’hui…', appel);
}

// Un <select> plutôt qu'une modale de choix : la visionneuse est déjà
// une couche au-dessus de la page, en empiler une seconde rendrait
// Échap ambigu. Le select n'a pas d'état à garder — le prochain
// snapshot reconstruit le bloc, donc il se remet sur son invite seul.
function selectRattachement(candidates, invite, appel) {
    if (!candidates.length) return '';
    var options = candidates.map(function(candidate) {
        return '<option value="' + escapeAttr(candidate.id) + '">'
            + escapeHtml(titreAffiche(candidate) + ' — ' + formatDateFr(candidate.dateEvenement || candidate.creeLe))
            + '</option>';
    }).join('');

    // appel est déjà passé par jsAttr côté appelant : le repasser dans
    // escapeAttr doublerait l'échappement (&amp; deviendrait &amp;amp;).
    return '<select class="visionneuse-select" onchange="' + appel + '">'
        + '<option value="">' + escapeHtml(invite) + '</option>' + options + '</select>';
}

function miniatureLiee(image, titreDetacher, appelDetacher) {
    var id = jsAttr(image.id);
    return '<figure class="miniature-liee">'
        + '<button type="button" class="miniature-liee-bouton" onclick="ouvrirVisionneuse(\'' + id + '\')">'
        +   '<img loading="lazy" alt="' + escapeAttr(titreAffiche(image)) + '" src="'
        +     escapeAttr(urlVignette(image.url, 240)) + '">'
        + '</button>'
        + '<figcaption>'
        +   '<span>' + escapeHtml(formatDateFr(image.dateEvenement || image.creeLe)) + '</span>'
        +   '<button type="button" class="icon-btn" title="' + escapeAttr(titreDetacher) + '"'
        +     ' onclick="' + appelDetacher + '"><i class="fa-solid fa-link-slash"></i></button>'
        + '</figcaption>'
        + '</figure>';
}

// Une seule écriture, sur la projection : c'est elle qui porte le lien.
// Une chaîne vide détache — le champ reste, vide, plutôt que d'être
// supprimé : rien ne se perd, et un rattachement se refait d'un clic.
function rattacherProjection(projectionId, imageSourceId) {
    return modifierElement(projectionId, { imageSourceId: imageSourceId || '' })
        .then(function() {
            showToast(imageSourceId ? 'Projection rattachée.' : 'Projection détachée.', 'success');
        })
        .catch(function(erreur) {
            console.error(erreur);
            showToast('Rattachement impossible : ' + erreur.message, 'error');
        });
}

// Change la vue où la photo apparaît sans la retéléverser : seul le
// champ « categorie » bouge, l'URL Cloudinary ne change pas.
function basculerCategorie(id, categorie) {
    modifierElement(id, { categorie: categorie })
        .then(function() {
            showToast(categorie === 'actuelle' ? 'Classée dans les photos actuelles.' : 'Classée dans les projections.', 'success');
            fermerVisionneuse();
            afficherVue('images-' + categorie);
        })
        .catch(function(erreur) {
            console.error(erreur);
            showToast('Changement impossible : ' + erreur.message, 'error');
        });
}
