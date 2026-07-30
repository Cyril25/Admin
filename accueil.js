// ============================================================
// accueil.js — Tuiles de la page d'accueil
// ============================================================
// L'accueil n'est pas le même pour tout le monde :
//   - Projets  : ceux qui sont attribués à la personne
//   - Sites    : ceux qui lui sont cochés (simples liens externes)
//   - Consoles : superadmin uniquement
//
// Sous impersonation, c'est bien la vue de l'autre personne qui est
// rendue — c'est tout l'intérêt.
// ============================================================

function onHubReady() {
    rendreProjets();
    rendreSites();

    var blocAdmin = document.getElementById('bloc-superadmin');
    if (blocAdmin) blocAdmin.style.display = estSuperadmin() ? 'block' : 'none';

    // « Le centre de mes projets » n'a de sens que pour le propriétaire ;
    // pour les autres, on salue simplement.
    var titre = document.getElementById('accueil-titre');
    if (titre && !estSuperadmin()) {
        var nom = (HUB.effectif && HUB.effectif.nom) ? HUB.effectif.nom : '';
        titre.innerHTML = '<i class="fa-solid fa-house"></i> Bonjour' + (nom ? ' ' + escapeHtml(nom) : '');
    }
}

function rendreProjets() {
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
}

function rendreSites() {
    var visibles = sitesVisibles();
    var bloc = document.getElementById('bloc-sites');
    var conteneur = document.getElementById('tuiles-sites');

    // Aucun site autorisé : on masque la section entière plutôt que
    // d'afficher un titre sur du vide.
    if (bloc) bloc.style.display = visibles.length ? 'block' : 'none';
    if (!conteneur) return;

    conteneur.innerHTML = visibles.map(function(s) {
        return '<a class="tile" href="' + s.url + '" target="_blank" rel="noopener">'
            + '<div class="tile-icon"><i class="' + s.icone + '"></i></div>'
            + '<h2>' + escapeHtml(s.nom)
            +   (s.badge ? ' <span class="badge">' + escapeHtml(s.badge) + '</span>' : '')
            + '</h2>'
            + '<p>' + escapeHtml(s.description) + '</p>'
            + (s.libelleUrl ? '<span class="tile-url">' + escapeHtml(s.libelleUrl) + '</span>' : '')
            + '</a>';
    }).join('');
}
