// ============================================================
// auth.js — Le vigile du hub
// ============================================================
// Sur chaque page :
//   1. init Firebase
//   2. pas connecté           → redirection vers login
//   3. connecté               → lecture de sa fiche dans « membres »
//   4. pas membre / inactif   → déconnexion immédiate
//   5. membre                 → en-tête filtrée par ses droits, garde
//                               du projet, puis affichage
//
// ⚠ CE QUE CE FICHIER NE FAIT PAS : cacher des pages. Le site est
// statique et le dépôt public — n'importe qui peut télécharger
// « exterieur/index.html ». Ce code masque des liens et vide des
// écrans, ce qui est du confort d'interface. Ce qui protège vraiment,
// ce sont les règles Firestore : sans droit, la page s'affiche mais
// ne contient aucune donnée.
// ============================================================

var HUB_CONFIG_OK = (typeof FIREBASE_CONFIG !== 'undefined' && FIREBASE_CONFIG.apiKey.indexOf('A_REMPLACER') === -1);

// État global, rempli par le vigile puis lu par les pages.
window.HUB = {
    user: null,          // compte Firebase connecté
    membre: null,        // sa fiche réelle
    effectif: null,      // la fiche « vue » (= membre, sauf impersonation)
    impersonation: ''    // email impersonné, '' sinon
};

// ------------------------------------------------------------
// 1. Initialisation Firebase
// ------------------------------------------------------------
if (typeof firebase === 'undefined') {
    console.error('ERREUR : le SDK Firebase n\'est pas chargé avant auth.js.');
} else if (!HUB_CONFIG_OK) {
    console.warn('Firebase non configuré — voir config.js.');
} else if (!firebase.apps.length) {
    firebase.initializeApp(FIREBASE_CONFIG);
}

// ------------------------------------------------------------
// 2. Utilitaires
// ------------------------------------------------------------
function estPageLogin() {
    var page = window.location.pathname.split('/').pop();
    return (page === 'login.html' || page === 'login');
}

// Préfixe vers la racine du site : '' à la racine, '../' dans un
// dossier de projet (déclaré par data-racine sur le <body>).
function hubRacine() {
    return (document.body && document.body.getAttribute('data-racine')) || '';
}

function normaliserEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function escapeHtml(texte) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(texte == null ? '' : texte));
    return div.innerHTML;
}

function showToast(message, type) {
    var toast = document.createElement('div');
    toast.className = 'toast toast-' + (type || 'info');
    toast.textContent = message;
    document.body.appendChild(toast);
    if (type === 'error') {
        toast.onclick = function() { toast.remove(); };
    } else {
        setTimeout(function() { if (toast.parentNode) toast.remove(); }, 4000);
    }
}

// ------------------------------------------------------------
// 3. Droits
// ------------------------------------------------------------
// Rôle RÉEL : ce que Firestore autorisera effectivement. L'impersonation
// ne le change jamais — elle ne modifie que l'affichage.
function estSuperadminReel() {
    if (!HUB.user) return false;
    if (normaliserEmail(HUB.user.email) === normaliserEmail(SUPERADMIN_EMAIL)) return true;
    return !!(HUB.membre && HUB.membre.role === 'superadmin');
}

// Rôle VU à l'écran : c'est lui qui pilote le menu et les gardes, pour
// que l'impersonation montre vraiment ce que l'autre personne voit.
function estSuperadmin() {
    return !!(HUB.effectif && HUB.effectif.role === 'superadmin');
}

function aAcces(slug) {
    if (!HUB.effectif) return false;
    if (HUB.effectif.role === 'superadmin') return true;
    var liste = HUB.effectif.projets || [];
    return liste.indexOf(slug) !== -1;
}

function projetsVisibles() {
    return PROJETS.filter(function(p) { return aAcces(p.slug); });
}

// Les sites sont de simples liens externes : les masquer relève de la
// pertinence du menu, pas de la sécurité. D'où une liste séparée de
// celle des projets, et aucune règle Firestore associée.
function aAccesSite(slug) {
    if (!HUB.effectif) return false;
    if (HUB.effectif.role === 'superadmin') return true;
    var liste = HUB.effectif.sites || [];
    return liste.indexOf(slug) !== -1;
}

function sitesVisibles() {
    // sites.js n'est chargé que sur les pages qui en ont besoin.
    if (typeof SITES === 'undefined') return [];
    return SITES.filter(function(s) { return aAccesSite(s.slug); });
}

window.estSuperadminReel = estSuperadminReel;
window.estSuperadmin = estSuperadmin;
window.aAcces = aAcces;
window.projetsVisibles = projetsVisibles;
window.aAccesSite = aAccesSite;
window.sitesVisibles = sitesVisibles;

// ------------------------------------------------------------
// 4. Impersonation
// ------------------------------------------------------------
// Volontairement en sessionStorage : ça meurt avec l'onglet, on ne
// risque pas de « rester » quelqu'un d'autre pendant des jours.
//
// ⚠ C'est un aperçu d'interface, PAS un bac à sable. Les requêtes
// partent toujours avec le jeton du superadmin : Firestore continue de
// tout autoriser. On voit ce que l'autre verrait, on ne subit pas ses
// restrictions.
function demarrerImpersonation(email) {
    if (!estSuperadminReel()) return;
    sessionStorage.setItem('hubImpersonation', normaliserEmail(email));
    window.location.href = hubRacine() + 'index.html';
}

function arreterImpersonation() {
    sessionStorage.removeItem('hubImpersonation');
    window.location.reload();
}

window.demarrerImpersonation = demarrerImpersonation;
window.arreterImpersonation = arreterImpersonation;

function injecterBandeauImpersonation() {
    if (!HUB.impersonation) return;
    var barre = document.createElement('div');
    barre.className = 'impersonation-bar';
    barre.innerHTML =
        '<span><i class="fa-solid fa-mask"></i> Vue de <strong>' + escapeHtml(HUB.impersonation) + '</strong>'
        + ' — affichage seulement, vos droits réels restent inchangés</span>'
        + '<button type="button" onclick="arreterImpersonation()">Revenir à moi</button>';
    document.body.insertBefore(barre, document.body.firstChild);
    document.body.classList.add('a-bandeau');
}

// ------------------------------------------------------------
// 5. En-tête
// ------------------------------------------------------------
function injecterHeader() {
    var cible = document.getElementById('header-placeholder');
    if (!cible) return;

    var racine = hubRacine();
    var projetCourant = (document.body && document.body.getAttribute('data-projet')) || '';
    var pageCourante = window.location.pathname.split('/').pop() || 'index.html';

    var liens = projetsVisibles().map(function(p) {
        var actif = (p.slug === projetCourant) ? ' class="active"' : '';
        return '<a href="' + racine + p.url + '"' + actif + '><i class="' + p.icone + '"></i> ' + escapeHtml(p.nom) + '</a>';
    }).join('');

    if (estSuperadmin()) {
        var actifMembres = (pageCourante === 'membres.html') ? ' class="active"' : '';
        liens += '<a href="' + racine + 'membres.html"' + actifMembres + '><i class="fa-solid fa-users-gear"></i> Membres</a>';
    }

    var nom = (HUB.effectif && HUB.effectif.nom) ? HUB.effectif.nom : (HUB.user ? HUB.user.email : '');

    cible.innerHTML =
        '<header class="hub-header">' +
            '<a class="hub-brand" href="' + racine + 'index.html"><i class="' + SITE_ICON + '"></i> <span>' + escapeHtml(SITE_TITLE) + '</span></a>' +
            '<nav class="hub-nav">' + liens + '</nav>' +
            '<div class="hub-user">' +
                '<span class="hub-user-email">' + escapeHtml(nom) + '</span>' +
                '<button type="button" class="hub-logout" onclick="logout()"><i class="fa-solid fa-power-off"></i> Déconnexion</button>' +
            '</div>' +
        '</header>';
}

// ------------------------------------------------------------
// 6. Lecture de la fiche membre
// ------------------------------------------------------------
function lireMembre(email) {
    return firebase.firestore().collection('membres').doc(normaliserEmail(email)).get()
        .then(function(doc) {
            if (!doc.exists) return null;
            var data = doc.data();
            data.email = doc.id;
            return data;
        });
}

// Le propriétaire doit pouvoir entrer même si sa fiche n'existe pas
// encore (première visite, ou fiche supprimée par erreur). On lui en
// fabrique une en mémoire ; la page Membres proposera de la créer.
function ficheDeSecours(email) {
    return { email: normaliserEmail(email), nom: 'Propriétaire', role: 'superadmin', projets: [], actif: true, _virtuelle: true };
}

// ------------------------------------------------------------
// 7. Le vigile
// ------------------------------------------------------------
document.addEventListener('DOMContentLoaded', function() {
    if (typeof firebase === 'undefined') return;

    if (!HUB_CONFIG_OK) {
        if (estPageLogin()) {
            var avertissement = document.getElementById('config-warning');
            if (avertissement) avertissement.style.display = 'block';
            var bouton = document.getElementById('btn-google-login');
            if (bouton) bouton.disabled = true;
        } else {
            window.location.href = hubRacine() + 'login.html';
        }
        return;
    }

    firebase.auth().onAuthStateChanged(function(user) {
        var surLogin = estPageLogin();

        if (!user) {
            if (!surLogin) {
                window.location.href = hubRacine() + 'login.html';
                return;
            }
            afficherErreurLogin();
            return;
        }

        HUB.user = user;
        var estProprietaire = (normaliserEmail(user.email) === normaliserEmail(SUPERADMIN_EMAIL));

        lireMembre(user.email)
            .then(function(fiche) {
                if (!fiche && estProprietaire) fiche = ficheDeSecours(user.email);

                // Ni fiche, ni propriétaire → dehors.
                if (!fiche) {
                    console.warn('Accès refusé : ' + user.email + ' n\'est pas membre.');
                    return refuser('unauthorized');
                }
                if (fiche.actif === false && !estProprietaire) {
                    console.warn('Accès refusé : compte désactivé (' + user.email + ').');
                    return refuser('disabled');
                }

                HUB.membre = fiche;

                // Impersonation : réservée au superadmin réel.
                var impersonne = sessionStorage.getItem('hubImpersonation') || '';
                if (impersonne && estSuperadminReel() && impersonne !== normaliserEmail(user.email)) {
                    return lireMembre(impersonne).then(function(autre) {
                        if (autre) {
                            HUB.impersonation = impersonne;
                            HUB.effectif = autre;
                        } else {
                            sessionStorage.removeItem('hubImpersonation');
                            HUB.effectif = fiche;
                        }
                        demarrerPage(surLogin);
                    });
                }
                sessionStorage.removeItem('hubImpersonation');
                HUB.effectif = fiche;
                demarrerPage(surLogin);
            })
            .catch(function(erreur) {
                console.error('Lecture de la fiche membre impossible :', erreur);
                afficherErreurTechnique(erreur);
            });
    });
});

function refuser(motif) {
    return firebase.auth().signOut().then(function() {
        window.location.href = hubRacine() + 'login.html?error=' + motif;
    });
}

function demarrerPage(surLogin) {
    if (surLogin) {
        window.location.href = 'index.html';
        return;
    }

    // Garde du projet : une page qui déclare data-projet n'est
    // affichée qu'à ceux qui y ont droit.
    var projet = (document.body && document.body.getAttribute('data-projet')) || '';
    if (projet && !aAcces(projet)) {
        window.location.href = hubRacine() + 'index.html';
        return;
    }
    // Pages réservées au superadmin (annuaire des membres).
    if (document.body && document.body.getAttribute('data-superadmin') === 'true' && !estSuperadmin()) {
        window.location.href = hubRacine() + 'index.html';
        return;
    }

    injecterBandeauImpersonation();
    injecterHeader();
    var contenu = document.getElementById('app-content');
    if (contenu) contenu.style.display = 'block';
    if (typeof onHubReady === 'function') onHubReady(HUB);
}

function afficherErreurTechnique(erreur) {
    var contenu = document.getElementById('app-content');
    if (!contenu) return;
    contenu.style.display = 'block';
    contenu.innerHTML = '<div class="error-block">'
        + '<i class="fa-solid fa-circle-exclamation"></i>'
        + '<strong>Connexion au serveur impossible.</strong><br>'
        + '<span style="color:var(--color-text-muted)">' + escapeHtml(erreur && erreur.message) + '</span>'
        + '</div>';
}

function afficherErreurLogin() {
    var params = new URLSearchParams(window.location.search);
    var motif = params.get('error');
    if (!motif) return;
    var bloc = document.getElementById('login-error');
    if (!bloc) return;
    bloc.textContent = (motif === 'disabled')
        ? 'Ce compte a été désactivé.'
        : 'Ce compte Google n\'a pas accès à ce site.';
    bloc.style.display = 'block';
}

// ------------------------------------------------------------
// 8. Connexion / déconnexion
// ------------------------------------------------------------
function loginWithGoogle() {
    if (typeof firebase === 'undefined' || !HUB_CONFIG_OK) return;
    var provider = new firebase.auth.GoogleAuthProvider();
    firebase.auth().signInWithPopup(provider).catch(function(erreur) {
        console.error(erreur);
        var bloc = document.getElementById('login-error');
        if (bloc) {
            bloc.textContent = 'Erreur de connexion : ' + erreur.message;
            bloc.style.display = 'block';
        }
    });
}

function logout() {
    if (typeof firebase === 'undefined') return;
    sessionStorage.removeItem('hubImpersonation');
    firebase.auth().signOut().then(function() {
        window.location.href = hubRacine() + 'login.html';
    });
}
