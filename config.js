// ============================================================
// config.js — Hub admin O'Fil du Doubs
// ============================================================
// Les valeurs ci-dessous sont publiques par nature (elles partent
// dans le navigateur, et le depot est public) : la securite reelle
// vient des regles Firestore, pas de ces cles.
// ============================================================

// --- 1. Configuration Firebase -------------------------------
var FIREBASE_CONFIG = {
    apiKey:            "AIzaSyAmzfqfxzqRPwjYtqcMIpx7YoA7WFcztAM",
    authDomain:        "ofildudoubs-hub.firebaseapp.com",
    projectId:         "ofildudoubs-hub",
    storageBucket:     "ofildudoubs-hub.firebasestorage.app",
    messagingSenderId: "974628508687",
    appId:             "1:974628508687:web:87dfcb92aa5e0eaec97f7a"
    // measurementId omis : Analytics n'est pas charge sur ce site.
};

// --- 2. Le proprietaire --------------------------------------
// Superadmin par son adresse, quoi qu'il arrive a la collection
// membres. C'est le filet anti-verrouillage : sans lui, supprimer sa
// propre fiche membre par erreur fermerait la base definitivement.
// DOIT etre identique a proprietaire() dans firestore.rules.
var SUPERADMIN_EMAIL = 'cyril.samson41@gmail.com';

// Les autres acces ne sont plus ici : ils vivent dans la collection
// Firestore « membres », geree depuis la page Membres.

// --- 3. Identite du site -------------------------------------
var SITE_TITLE = "Hub O'Fil du Doubs";
var SITE_ICON  = 'fa-solid fa-compass-drafting';

// --- 4. Cloudinary (fichiers des projets) --------------------
// Meme compte que BilletsTouristiques, mais un preset a part : sans ca
// les photos du chantier se melangeraient aux images de l'association,
// dans le meme dossier et les memes quotas.
//
// Le preset « ofildudoubs-hub » doit etre cree a la main dans la
// console (Settings -> Upload -> Add upload preset) avec :
//   Signing mode  : Unsigned     (pas de cle secrete cote navigateur)
//   Resource type : Auto         (sinon les .eml, de type « raw », sont refuses)
//   Folder        : hub/exterieur
//   Use filename  : Off   +  Unique filename : On
// Les deux dernieres options ne sont pas cosmetiques : avec un
// public_id derive du nom de fichier, l'URL d'un devis devient
// devinable — et Cloudinary ne permet pas de l'effacer sans cle secrete.
//
// Valeurs publiques par nature, comme le reste de ce fichier. Un preset
// non signe permet a quiconque connait son nom de televerser dans le
// compte : c'est deja le cas pour BilletsTouristiques, meme risque assume.
var CLOUDINARY_CLOUD_NAME    = 'dxoyqxben';
var CLOUDINARY_UPLOAD_PRESET = 'ofildudoubs-hub';
