// ============================================================
// membres.js — Annuaire des membres et de leurs accès
// ============================================================
// Collection Firestore « membres ». L'identifiant du document est
// l'email en minuscules : les règles Firestore s'en servent pour
// retrouver la fiche de l'appelant en une seule lecture, sans requête.
//
//   nom       string   nom affiché
//   role      string   'membre' | 'superadmin'
//   projets   array    slugs autorisés (voir projets.js)
//   actif     bool     false = refusé à la connexion
//   createdAt, updatedAt
//
// Page réservée au superadmin (data-superadmin sur le <body>, et
// écriture bloquée côté règles pour tous les autres).
// ============================================================

var db = null;
var membres = [];
var emailEnEdition = null;   // null = création
var premierChargement = true;

// ------------------------------------------------------------
// 1. Démarrage
// ------------------------------------------------------------
function onHubReady() {
    db = firebase.firestore();
    construireCasesProjets();
    ecouterMembres();

    // Le propriétaire entre par le filet même sans fiche : on le lui dit.
    if (HUB.membre && HUB.membre._virtuelle) {
        var bloc = document.getElementById('fiche-manquante');
        if (bloc) bloc.style.display = 'block';
    }
}

function ecouterMembres() {
    db.collection('membres').onSnapshot(function(snapshot) {
        membres = [];
        snapshot.forEach(function(doc) {
            var data = doc.data();
            data.email = doc.id;
            membres.push(data);
        });
        premierChargement = false;
        render();
    }, function(erreur) {
        console.error('Erreur Firestore :', erreur);
        var liste = document.getElementById('membres-list');
        if (liste) {
            liste.innerHTML = '<div class="error-block">'
                + '<i class="fa-solid fa-circle-exclamation"></i>'
                + '<strong>Impossible de lire l\'annuaire.</strong><br>'
                + '<span style="color:var(--color-text-muted)">' + escapeHtml(erreur.message) + '</span>'
                + '</div>';
        }
    });
}

// ------------------------------------------------------------
// 2. Utilitaires
// ------------------------------------------------------------
function escapeAttr(texte) {
    return String(texte == null ? '' : texte)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Chaîne JS littérale dans un attribut HTML : échappement JS d'abord,
// HTML ensuite, et surtout pas l'apostrophe en &#39; (le navigateur la
// redécode avant de parser le JS et casserait le littéral).
function jsAttr(texte) {
    return String(texte == null ? '' : texte)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r?\n/g, '\\n')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function emailValide(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function trouverMembre(email) {
    for (var i = 0; i < membres.length; i++) {
        if (membres[i].email === email) return membres[i];
    }
    return null;
}

function estMoi(email) {
    return HUB.user && normaliserEmail(HUB.user.email) === email;
}

// ------------------------------------------------------------
// 3. Cases à cocher des projets
// ------------------------------------------------------------
function construireCasesProjets() {
    var wrap = document.getElementById('f-projets');
    if (!wrap) return;
    wrap.innerHTML = PROJETS.map(function(p) {
        return '<label class="checkbox-inline">'
            + '<input type="checkbox" class="cb-projet" value="' + escapeAttr(p.slug) + '"> '
            + '<i class="' + p.icone + '"></i> ' + escapeHtml(p.nom)
            + '</label>';
    }).join('');
}

function lireCasesProjets() {
    var coches = [];
    var cases = document.querySelectorAll('.cb-projet');
    for (var i = 0; i < cases.length; i++) {
        if (cases[i].checked) coches.push(cases[i].value);
    }
    return coches;
}

function ecrireCasesProjets(slugs) {
    var liste = slugs || [];
    var cases = document.querySelectorAll('.cb-projet');
    for (var i = 0; i < cases.length; i++) {
        cases[i].checked = (liste.indexOf(cases[i].value) !== -1);
    }
}

// Un superadmin a tout, cocher des cases n'a plus de sens : on le dit
// au lieu de laisser croire que les cases limitent quelque chose.
function majApercuRole() {
    var estSuper = document.getElementById('f-role').value === 'superadmin';
    var wrap = document.getElementById('f-projets');
    var aide = document.getElementById('f-projets-hint');
    var cases = document.querySelectorAll('.cb-projet');
    for (var i = 0; i < cases.length; i++) cases[i].disabled = estSuper;
    if (wrap) wrap.classList.toggle('projets-checkboxes--inactif', estSuper);
    if (aide) {
        aide.textContent = estSuper
            ? 'Un superadmin accède à tous les projets, présents et futurs — ces cases ne s\'appliquent pas.'
            : 'La personne ne verra que ce qui est coché : ni menu, ni tuile, ni données pour le reste.';
    }
}

// ------------------------------------------------------------
// 4. Rendu
// ------------------------------------------------------------
function render() {
    var liste = document.getElementById('membres-list');
    var vide = document.getElementById('empty-state');
    if (!liste) return;

    if (!membres.length) {
        liste.innerHTML = '';
        if (vide) vide.style.display = premierChargement ? 'none' : 'block';
        return;
    }
    if (vide) vide.style.display = 'none';

    var tries = membres.slice().sort(function(a, b) {
        // Superadmins en tête, puis alphabétique.
        var ra = (a.role === 'superadmin') ? 0 : 1;
        var rb = (b.role === 'superadmin') ? 0 : 1;
        if (ra !== rb) return ra - rb;
        return (a.nom || a.email).localeCompare(b.nom || b.email);
    });

    liste.innerHTML = tries.map(renderCarte).join('');
}

function renderCarte(m) {
    var id = jsAttr(m.email);
    var estSuper = (m.role === 'superadmin');
    var moi = estMoi(m.email);

    var badgesProjets = estSuper
        ? '<span class="badge badge-projet"><i class="fa-solid fa-key"></i>Tous les projets</span>'
        : (m.projets && m.projets.length
            ? m.projets.map(function(slug) {
                var p = getProjet(slug);
                return '<span class="badge badge-projet">'
                    + (p ? '<i class="' + p.icone + '"></i>' + escapeHtml(p.nom)
                         : '<i class="fa-solid fa-triangle-exclamation"></i>' + escapeHtml(slug) + ' (inconnu)')
                    + '</span>';
              }).join('')
            : '<span class="badge badge-vide">Aucun accès</span>');

    var boutonImpersonation = (!moi && m.actif !== false)
        ? '<button type="button" class="icon-btn" title="Voir le hub comme cette personne"'
          + ' onclick="demarrerImpersonation(\'' + id + '\')"><i class="fa-solid fa-mask"></i></button>'
        : '';

    return '<div class="membre-carte' + (m.actif === false ? ' membre-carte--inactif' : '') + '">'
        + '<div class="membre-entete">'
        +   '<div>'
        +     '<h2 class="membre-nom">' + escapeHtml(m.nom || m.email.split('@')[0])
        +       (moi ? ' <span class="badge badge-moi">moi</span>' : '')
        +       (estSuper ? ' <span class="badge badge-superadmin"><i class="fa-solid fa-shield-halved"></i>Superadmin</span>' : '')
        +       (m.actif === false ? ' <span class="badge badge-inactif">Désactivé</span>' : '')
        +     '</h2>'
        +     '<p class="membre-email">' + escapeHtml(m.email) + '</p>'
        +   '</div>'
        +   '<div class="membre-actions">'
        +     boutonImpersonation
        +     '<button type="button" class="icon-btn" title="Modifier" onclick="ouvrirModale(\'' + id + '\')">'
        +     '<i class="fa-solid fa-pen"></i></button>'
        +   '</div>'
        + '</div>'
        + '<div class="membre-projets">' + badgesProjets + '</div>'
        + '</div>';
}

// ------------------------------------------------------------
// 5. Modale
// ------------------------------------------------------------
function ouvrirModale(email) {
    emailEnEdition = email || null;
    var m = email ? trouverMembre(email) : null;

    document.getElementById('modal-title').textContent = m ? ('Modifier ' + (m.nom || m.email)) : 'Nouveau membre';

    var champEmail = document.getElementById('f-email');
    champEmail.value = m ? m.email : '';
    // L'email est l'identifiant du document : le changer reviendrait à
    // créer une autre fiche. On le verrouille en édition.
    champEmail.disabled = !!m;
    document.getElementById('f-email-hint').textContent = m
        ? 'L\'adresse identifie la fiche : pour la corriger, supprimez et recréez le membre.'
        : 'Doit être l\'adresse exacte du compte Google avec lequel la personne se connectera.';

    document.getElementById('f-nom').value = m ? (m.nom || '') : '';
    document.getElementById('f-role').value = m ? (m.role || 'membre') : 'membre';
    document.getElementById('f-actif').checked = m ? (m.actif !== false) : true;
    ecrireCasesProjets(m ? m.projets : []);
    majApercuRole();

    document.getElementById('btn-delete').style.display = (m && !estMoi(m.email)) ? '' : 'none';
    document.getElementById('f-meta').style.display = 'none';

    document.getElementById('modal-overlay').style.display = 'flex';
    (m ? document.getElementById('f-nom') : champEmail).focus();
}

function fermerModale() {
    document.getElementById('modal-overlay').style.display = 'none';
    emailEnEdition = null;
}

function sauverMembre() {
    var email = emailEnEdition || normaliserEmail(document.getElementById('f-email').value);
    if (!emailValide(email)) {
        showToast('Adresse email invalide.', 'error');
        document.getElementById('f-email').focus();
        return;
    }
    if (!emailEnEdition && trouverMembre(email)) {
        showToast('Ce membre existe déjà.', 'error');
        return;
    }

    var role = document.getElementById('f-role').value;
    var donnees = {
        nom:       document.getElementById('f-nom').value.trim(),
        role:      role,
        // Un superadmin a tout : on stocke une liste vide plutôt qu'une
        // liste figée qui deviendrait fausse au prochain projet.
        projets:   (role === 'superadmin') ? [] : lireCasesProjets(),
        actif:     document.getElementById('f-actif').checked,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (!emailEnEdition) {
        donnees.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    }

    db.collection('membres').doc(email).set(donnees, { merge: true })
        .then(function() {
            showToast(emailEnEdition ? 'Membre mis à jour.' : 'Membre ajouté.', 'success');
            fermerModale();
        })
        .catch(function(erreur) {
            console.error(erreur);
            showToast('Enregistrement impossible : ' + erreur.message, 'error');
        });
}

// ------------------------------------------------------------
// 6. Fiche du propriétaire
// ------------------------------------------------------------
function creerFicheProprietaire() {
    var email = normaliserEmail(HUB.user.email);
    db.collection('membres').doc(email).set({
        nom:       'Cyril',
        role:      'superadmin',
        projets:   [],
        actif:     true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    })
        .then(function() {
            document.getElementById('fiche-manquante').style.display = 'none';
            showToast('Votre fiche a été créée.', 'success');
        })
        .catch(function(erreur) {
            console.error(erreur);
            showToast('Création impossible : ' + erreur.message, 'error');
        });
}

// ------------------------------------------------------------
// 7. Suppression
// ------------------------------------------------------------
function ouvrirModaleSuppression() {
    document.getElementById('delete-overlay').style.display = 'flex';
}

function fermerModaleSuppression() {
    document.getElementById('delete-overlay').style.display = 'none';
}

function confirmerSuppression() {
    if (!emailEnEdition) return;
    // Garde-fou : se supprimer soi-même n'a aucun intérêt et fait perdre
    // l'annuaire de vue. Le bouton est déjà masqué, ceci est la ceinture.
    if (estMoi(emailEnEdition)) {
        showToast('Vous ne pouvez pas supprimer votre propre fiche.', 'error');
        return;
    }
    db.collection('membres').doc(emailEnEdition).delete()
        .then(function() {
            showToast('Membre supprimé.', 'success');
            fermerModaleSuppression();
            fermerModale();
        })
        .catch(function(erreur) {
            console.error(erreur);
            showToast('Suppression impossible : ' + erreur.message, 'error');
        });
}

// ------------------------------------------------------------
// 8. Raccourcis clavier
// ------------------------------------------------------------
document.addEventListener('keydown', function(evenement) {
    if (evenement.key !== 'Escape') return;
    if (document.getElementById('delete-overlay').style.display === 'flex') {
        fermerModaleSuppression();
    } else if (document.getElementById('modal-overlay').style.display === 'flex') {
        fermerModale();
    }
});
