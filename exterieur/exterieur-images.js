// ============================================================
// exterieur-images.js — Les deux vues d'images
// ============================================================
//   actuelle    — l'état du terrain aujourd'hui
//   projection  — rendus IA, inspirations, croquis d'archi
// Deux vues distinctes parce que ce sont deux usages : on montre les
// premières à un artisan, on rêve sur les secondes.
//
// C'est la seule partie du projet vraiment pensée pour le mobile : les
// photos du terrain se prennent au téléphone. L'archivage des mails,
// lui, restera une opération de bureau — l'application Gmail mobile ne
// permet pas de télécharger un .eml.
// ============================================================

// Retenue le temps du dépôt : « Prendre une photo » depuis la vue
// Projections doit ranger la photo dans les projections.
var categorieDepot = 'actuelle';

function renderImages(categorie) {
    var cible = document.getElementById('vue-images-' + categorie);
    if (!cible) return;

    var photos = elementsDeType('image')
        .filter(function(i) { return (i.categorie || 'actuelle') === categorie; })
        .sort(function(a, b) {
            var da = toDate(a.dateEvenement) || toDate(a.creeLe);
            var db2 = toDate(b.dateEvenement) || toDate(b.creeLe);
            return (db2 ? db2.getTime() : 0) - (da ? da.getTime() : 0);
        });

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

function declencherPhoto(source, categorie) {
    categorieDepot = categorie || 'actuelle';
    var champ = document.getElementById(source === 'camera' ? 'photo-camera' : 'photo-galerie');
    if (champ) champ.click();
}

function initImages() {
    ['photo-camera', 'photo-galerie'].forEach(function(id) {
        var champ = document.getElementById(id);
        if (!champ) return;
        champ.addEventListener('change', function() {
            if (champ.files && champ.files.length) deposerFichier(champ.files[0], categorieDepot);
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
        + '</button>'
        + '<figcaption>'
        +   '<span class="vignette-date">' + escapeHtml(formatDateFr(image.dateEvenement || image.creeLe)) + '</span>'
        +   '<button type="button" class="icon-btn" title="Modifier" onclick="ouvrirModaleElement(\'' + id + '\')">'
        +     '<i class="fa-solid fa-pen"></i></button>'
        + '</figcaption>'
        + '</figure>';
}

// ------------------------------------------------------------
// Visionneuse
// ------------------------------------------------------------
var imageOuverte = null;

function ouvrirVisionneuse(id) {
    var image = trouverElement(id);
    if (!image) return;
    imageOuverte = id;

    var grande = document.getElementById('visionneuse-image');
    var legende = document.getElementById('visionneuse-legende');
    var bascule = document.getElementById('visionneuse-bascule');

    if (grande) {
        grande.src = urlVignette(image.url, 1600);
        grande.alt = titreAffiche(image);
    }
    if (legende) {
        legende.textContent = titreAffiche(image) + ' — ' + formatDateFr(image.dateEvenement || image.creeLe);
    }
    if (bascule) {
        var actuelle = (image.categorie || 'actuelle');
        var cible = (actuelle === 'actuelle') ? 'projection' : 'actuelle';
        bascule.textContent = (cible === 'projection') ? 'Classer en projection' : 'Classer en photo actuelle';
        bascule.onclick = function() { basculerCategorie(id, cible); };
    }

    var overlay = document.getElementById('visionneuse-overlay');
    if (overlay) overlay.style.display = 'flex';
}

function fermerVisionneuse() {
    var overlay = document.getElementById('visionneuse-overlay');
    if (overlay) overlay.style.display = 'none';
    imageOuverte = null;
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
