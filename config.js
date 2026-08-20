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

// --- 2 bis. Le notifieur -------------------------------------
// L'identite MACHINE du notifieur Telegram (dossier notifieur/). Ce
// n'est pas une personne : c'est un compte email/mot de passe cree a la
// main dans Firebase Auth, dont le mot de passe vit dans un secret
// Cloudflare et nulle part ailleurs.
//
// Il n'a AUCUNE fiche dans la collection membres, et n'en a pas besoin :
// son seul droit vient de la fonction notifieur() de firestore.rules,
// qui le reconnait a cette adresse et ne lui ouvre que la LECTURE de
// « taches ». Toutes les autres collections l'ignorent, et il ne peut
// rien ecrire nulle part.
//
// DOIT etre identique a notifieur() dans firestore.rules. Un test le
// verifie, comme il le fait deja pour SUPERADMIN_EMAIL : les deux
// fichiers se contrediraient en silence, et le notifieur se tairait
// sans que personne le remarque.
var NOTIFIEUR_EMAIL = 'notifieur@ofildudoubs.fr';

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
