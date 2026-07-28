// ============================================================
// accueil.js — Tuiles de la page d'accueil
// ============================================================
// L'accueil n'est pas le même pour tout le monde : chacun ne voit que
// les sous-projets qui lui sont attribués, et les blocs « Sites en
// ligne » / « Consoles » sont réservés au superadmin.
//
// Sous impersonation, c'est bien la vue de l'autre personne qui est
// rendue — c'est tout l'intérêt.
// ============================================================

function onHubReady() {
    var visibles = projetsVisibles();

    var conteneur = document.getElementById('tuiles-projets');
    var vide = document.getElementById('aucun-projet');

    if (conteneur) {
        conteneur.innerHTML = visibles.map(function(p) {
            return '<a class="tile" href="' + p.url + '">'
                + '<div class="tile-icon"><i class="' + p.icone + '"></i></div>'
                + '<h2>' + escapeHtml(p.nom) + '</h2>'
                + '<p>' + escapeHtml(p.description) + '</p>'
                + '</a>';
        }).join('');
    }
    if (vide) vide.style.display = visibles.length ? 'none' : 'block';

    var blocAdmin = document.getElementById('bloc-superadmin');
    if (blocAdmin) blocAdmin.style.display = estSuperadmin() ? 'block' : 'none';

    // Un titre « Le centre de mes projets » n'a de sens que pour le
    // propriétaire ; pour les autres, on salue simplement.
    var titre = document.getElementById('accueil-titre');
    if (titre && !estSuperadmin()) {
        var nom = (HUB.effectif && HUB.effectif.nom) ? HUB.effectif.nom : '';
        titre.innerHTML = '<i class="fa-solid fa-house"></i> Bonjour' + (nom ? ' ' + escapeHtml(nom) : '');
    }
}
