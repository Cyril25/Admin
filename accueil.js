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
    compterTachesEnRetard();

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
            // L'identifiant sert au compteur de retards, qui vient se
            // greffer après coup sur la tuile des tâches.
            return '<a class="tile" id="tuile-' + escapeAttr(p.slug) + '" href="' + p.url + '">'
                + '<div class="tile-icon"><i class="' + p.icone + '"></i></div>'
                + '<h2>' + escapeHtml(p.nom) + '</h2>'
                + '<p>' + escapeHtml(p.description) + '</p>'
                + '</a>';
        }).join('');
    }
    if (vide) vide.style.display = visibles.length ? 'none' : 'block';
}

// ------------------------------------------------------------
// Le compteur de retards
// ------------------------------------------------------------
// SANS LUI, LE PROJET « TÂCHES » NE SIGNALE RIEN. Le hub est statique :
// pas de serveur, donc ni mail ni notification. Un retard ne peut se
// faire remarquer qu'à un seul endroit — la page d'accueil, la seule
// qu'on ouvre sans y penser. Le reste du mécanisme suppose qu'on aille
// voir, ce qui est exactement le défaut qu'on reprochait au calendrier.
//
// La règle « en retard » n'est pas recopiée ici : elle vient de
// taches/taches-calcul.js, chargé par index.html. Deux définitions
// auraient fini par diverger, et la tuile annoncerait deux retards
// quand la page en montre trois.
function compterTachesEnRetard() {
    var tuile = document.getElementById('tuile-taches');
    if (!tuile || typeof compterEnRetard !== 'function') return;

    // Les tâches sont cloisonnées : sous impersonation, on ne peut lire
    // que les siennes, et les afficher sur la tuile d'une autre personne
    // serait un contresens. La page Tâches le dit, l'accueil se tait.
    if (HUB.impersonation) return;

    var moi = normaliserEmail(HUB.user && HUB.user.email);
    if (!moi) return;

    // ⚠ Le `where` est obligatoire, pas optimisateur : la règle de
    // lecture exige `creePar == idAppelant()`, et Firestore rejette en
    // bloc toute requête qui ne le garantit pas.
    firebase.firestore().collection('taches')
        .where('creePar', '==', moi)
        .get()
        .then(function(snapshot) {
            var lignes = [];
            snapshot.forEach(function(doc) { lignes.push(doc.data()); });

            var retards = compterEnRetard(lignes, aujourdhui());
            if (!retards) return;

            var titre = tuile.querySelector('h2');
            if (!titre) return;
            titre.innerHTML += ' <span class="badge badge-retard">' + retards
                + ' en retard</span>';
        })
        .catch(function(erreur) {
            // Un compteur qui ne se calcule pas ne doit pas emporter
            // l'accueil avec lui : on se tait, la tuile reste normale.
            console.warn('Compteur de retards indisponible :', erreur.message);
        });
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
