// ============================================================
// auth.js — Le vigile du hub
// ============================================================
// Même principe que global.js de BilletsTouristiques :
//   1. init Firebase
//   2. onAuthStateChanged → pas connecté = redirection vers login
//   3. email hors liste = déconnexion immédiate
//   4. email autorisé = injection de l'en-tête + affichage du contenu
//
// Le contenu de chaque page protégée vit dans #app-content, masqué
// en CSS inline : rien ne s'affiche tant que le vigile n'a pas
// validé. Ce filtrage côté client est du confort — la vraie
// barrière est dans firestore.rules.
// ============================================================

var HUB_CONFIG_OK = (typeof FIREBASE_CONFIG !== 'undefined' && FIREBASE_CONFIG.apiKey.indexOf('A_REMPLACER') === -1);

// ------------------------------------------------------------
// 1. Initialisation Firebase
// ------------------------------------------------------------
if (typeof firebase === 'undefined') {
    console.error('ERREUR : le SDK Firebase n\'est pas chargé avant auth.js.');
} else if (!HUB_CONFIG_OK) {
    console.warn('Firebase non configuré — voir config.js (valeurs A_REMPLACER).');
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

function emailAutorise(email) {
    if (!email) return false;
    var normalise = String(email).trim().toLowerCase();
    for (var i = 0; i < ALLOWED_EMAILS.length; i++) {
        if (ALLOWED_EMAILS[i].toLowerCase() === normalise) return true;
    }
    return false;
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
// 3. En-tête (injectée sur les pages protégées)
// ------------------------------------------------------------
function injecterHeader(user) {
    var cible = document.getElementById('header-placeholder');
    if (!cible) return;

    var pageCourante = window.location.pathname.split('/').pop() || 'index.html';

    var liens = NAV_LINKS.map(function(lien) {
        var actif = (lien.href === pageCourante) ? ' class="active"' : '';
        return '<a href="' + lien.href + '"' + actif + '><i class="' + lien.icon + '"></i> ' + escapeHtml(lien.label) + '</a>';
    }).join('');

    cible.innerHTML =
        '<header class="hub-header">' +
            '<a class="hub-brand" href="index.html"><i class="' + SITE_ICON + '"></i> <span>' + escapeHtml(SITE_TITLE) + '</span></a>' +
            '<nav class="hub-nav">' + liens + '</nav>' +
            '<div class="hub-user">' +
                '<span class="hub-user-email">' + escapeHtml(user.email) + '</span>' +
                '<button type="button" class="hub-logout" onclick="logout()"><i class="fa-solid fa-power-off"></i> Déconnexion</button>' +
            '</div>' +
        '</header>';
}

// ------------------------------------------------------------
// 4. Le vigile
// ------------------------------------------------------------
document.addEventListener('DOMContentLoaded', function() {
    if (typeof firebase === 'undefined') return;

    // Configuration absente : sur la page de login on l'explique,
    // ailleurs on renvoie vers le login pour ne pas afficher une page vide.
    if (!HUB_CONFIG_OK) {
        if (estPageLogin()) {
            var avertissement = document.getElementById('config-warning');
            if (avertissement) avertissement.style.display = 'block';
            var bouton = document.getElementById('btn-google-login');
            if (bouton) bouton.disabled = true;
        } else {
            window.location.href = 'login.html';
        }
        return;
    }

    firebase.auth().onAuthStateChanged(function(user) {
        var surLogin = estPageLogin();

        // --- Non connecté ---
        if (!user) {
            if (!surLogin) {
                window.location.href = 'login.html';
                return;
            }
            afficherErreurLogin();
            return;
        }

        // --- Connecté mais pas sur la liste ---
        if (!emailAutorise(user.email)) {
            console.warn('Accès refusé pour : ' + user.email);
            firebase.auth().signOut().then(function() {
                window.location.href = 'login.html?error=unauthorized';
            });
            return;
        }

        // --- Autorisé ---
        if (surLogin) {
            window.location.href = 'index.html';
            return;
        }
        injecterHeader(user);
        var contenu = document.getElementById('app-content');
        if (contenu) contenu.style.display = 'block';
        if (typeof onHubReady === 'function') onHubReady(user);
    });
});

function afficherErreurLogin() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('error') !== 'unauthorized') return;
    var bloc = document.getElementById('login-error');
    if (!bloc) return;
    bloc.textContent = 'Ce compte Google n\'a pas accès à ce site.';
    bloc.style.display = 'block';
}

// ------------------------------------------------------------
// 5. Connexion / déconnexion
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
    firebase.auth().signOut().then(function() {
        window.location.href = 'login.html';
    });
}
