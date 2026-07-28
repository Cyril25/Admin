// ============================================================
// hub-utils.js — Les quatre fonctions que toutes les pages recopiaient
// ============================================================
// Chargé AVANT le JS de page, après auth.js. Portée globale, comme le
// reste du hub : pas de module, pas de build.
//
// Ce qui est ici et pourquoi :
//   toDate / formatDateFr   — lire un Timestamp Firestore sans planter
//   escapeAttr / jsAttr     — les deux échappements que tout le monde
//                             confond, et qui ont déjà causé un bug réel
//
// Ce qui n'est PAS ici : escapeHtml et showToast, qui vivent dans
// auth.js (chargé partout, y compris sur login.html). Ne pas les
// redéfinir ici, la dernière définition gagnerait silencieusement.
// ============================================================

// ------------------------------------------------------------
// Dates
// ------------------------------------------------------------
// Firestore renvoie un Timestamp ; null tant que le serveur n'a pas
// répondu (serverTimestamp() est en attente côté client juste après
// l'écriture). D'où le garde-fou : jamais d'exception, on rend null.
function toDate(valeur) {
    if (!valeur) return null;
    if (typeof valeur.toDate === 'function') return valeur.toDate();
    var date = new Date(valeur);
    return isNaN(date.getTime()) ? null : date;
}

function formatDateFr(valeur) {
    var date = toDate(valeur);
    if (!date) return '—';
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ------------------------------------------------------------
// Échappement
// ------------------------------------------------------------
// Texte destiné à un attribut HTML : value="…", title="…".
function escapeAttr(texte) {
    return String(texte == null ? '' : texte)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Chaîne JS littérale placée DANS un attribut HTML (onclick="f('...')").
// Deux couches : d'abord l'échappement JavaScript, ensuite le HTML — et
// surtout PAS l'apostrophe en &#39;, que le navigateur redécode avant de
// parser le JS, ce qui casserait le littéral. Sans ça, un projet nommé
// « O'Fil du Doubs » rend le bouton de filtre inopérant.
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
