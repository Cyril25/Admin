// ============================================================
// config.js — Hub admin O'Fil du Doubs
// ============================================================
// SEUL fichier a modifier apres la creation du projet Firebase.
// Les valeurs ci-dessous sont publiques par nature (elles partent
// dans le navigateur) : la securite reelle vient des regles
// Firestore (firestore.rules), pas de ces cles.
// ============================================================

// --- 1. Configuration Firebase -------------------------------
// Console Firebase > Parametres du projet > Vos applications >
// Application Web > Configuration du SDK. Copier-coller ici.
var FIREBASE_CONFIG = {
    apiKey:            "A_REMPLACER",
    authDomain:        "A_REMPLACER.firebaseapp.com",
    projectId:         "A_REMPLACER",
    storageBucket:     "A_REMPLACER.appspot.com",
    messagingSenderId: "A_REMPLACER",
    appId:             "A_REMPLACER"
};

// --- 2. Qui a le droit d'entrer ------------------------------
// Filtre cote client (confort : message clair + deconnexion).
// La vraie barriere est dans firestore.rules, qui doit contenir
// exactement les memes adresses.
var ALLOWED_EMAILS = ['cyril.samson41@gmail.com'];

// --- 3. Identite du site -------------------------------------
var SITE_TITLE = "Hub O'Fil du Doubs";
var SITE_ICON  = 'fa-solid fa-compass-drafting';

// --- 4. Navigation -------------------------------------------
var NAV_LINKS = [
    { href: 'index.html', icon: 'fa-solid fa-house',         label: 'Accueil' },
    { href: 'idees.html', icon: 'fa-solid fa-lightbulb',     label: 'Idees / Projets' }
];
