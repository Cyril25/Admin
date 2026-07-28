// ============================================================
// exterieur-donnees.js — Le tiroir unique du chantier
// ============================================================
// Une seule collection Firestore « exterieur ». Chaque document porte
// un champ « type » ; les pages ne sont que des filtres sur cette
// étiquette. Un seul onSnapshot alimente les neuf vues.
//
// Deux natures d'éléments cohabitent :
//   le fil     — des événements datés (tache, email, document, image, note)
//   le carnet  — des références intemporelles (contact, lien)
// Plus un singleton « _projet » (type projet), la fiche du chantier.
//
// Pourquoi une seule collection : le besoin central est un fil unique
// mêlant tous les types. Avec une collection par type, il faudrait
// interroger chacune puis fusionner et retrier à chaque affichage — et
// la recherche ne verrait qu'un morceau des données.
//
// escapeHtml / showToast viennent de auth.js.
// toDate / formatDateFr / escapeAttr / jsAttr viennent de hub-utils.js.
// Ne pas les redéfinir ici.
// ============================================================

// ------------------------------------------------------------
// 1. Référentiels
// ------------------------------------------------------------
var COLLECTION = 'exterieur';
var ID_PROJET = '_projet';

var TYPES = [
    { value: 'tache',    label: 'Tâche',    icone: 'fa-solid fa-list-check' },
    { value: 'email',    label: 'Email',    icone: 'fa-solid fa-envelope' },
    { value: 'document', label: 'Document', icone: 'fa-solid fa-file-pdf' },
    { value: 'image',    label: 'Image',    icone: 'fa-solid fa-image' },
    { value: 'note',     label: 'Note',     icone: 'fa-solid fa-note-sticky' },
    { value: 'contact',  label: 'Contact',  icone: 'fa-solid fa-address-card' },
    { value: 'lien',     label: 'Lien',     icone: 'fa-solid fa-link' },
    { value: 'projet',   label: 'Projet',   icone: 'fa-solid fa-clipboard-list' }
];

// Les types qui racontent une histoire datée. Le fil ne montre qu'eux :
// un contact ou un lien n'a pas de place dans une chronologie.
var TYPES_FIL = ['tache', 'email', 'document', 'image', 'note'];

// Les types qui peuvent attendre quelque chose de quelqu'un — donc les
// seuls à porter un « camp ».
var TYPES_ACTIONNABLES = ['tache', 'email', 'document'];

// Le champ qui structure tout le tableau de bord : la balle est dans
// quel camp ?
var CAMPS = [
    { value: 'a_nous', label: 'À nous',    court: "c'est à nous", icone: 'fa-solid fa-hand-point-left' },
    { value: 'a_eux',  label: 'En attente', court: "c'est à eux",  icone: 'fa-solid fa-hourglass-half' },
    { value: 'clos',   label: 'Réglé',     court: 'réglé',        icone: 'fa-solid fa-check' }
];

var CATEGORIES_IMAGE = [
    { value: 'actuelle',   label: 'Aujourd’hui' },
    { value: 'projection', label: 'Projection' }
];

var CATEGORIES_CONTACT = [
    { value: 'btp',              label: 'BTP' },
    { value: 'paysagiste',       label: 'Paysagiste' },
    { value: 'archi-paysagiste', label: 'Archi-paysagiste' },
    { value: 'autre',            label: 'Autre' }
];

// Au-delà, un élément « en attente d'eux » se signale tout seul. C'est
// toute la mécanique de relance : rien à saisir, rien à programmer.
var SEUIL_RELANCE_JOURS = 15;

// Un fil sans mouvement depuis ce nombre de jours mérite d'être dit.
var SEUIL_IMMOBILITE_JOURS = 7;

// Le corps d'un mail est tronqué à l'écriture : onSnapshot retélécharge
// TOUT le tiroir à chaque ouverture, et un email brut pèse 20 à 100 Ko.
// Le raisonnement « quelques centaines de documents » portait sur le
// nombre, pas sur le poids. L'original complet reste sur Cloudinary.
var MAX_CORPS = 4000;

function getTypeDef(value) {
    for (var i = 0; i < TYPES.length; i++) {
        if (TYPES[i].value === value) return TYPES[i];
    }
    return { value: value, label: value || '?', icone: 'fa-solid fa-circle-question' };
}

function getCampDef(value) {
    for (var i = 0; i < CAMPS.length; i++) {
        if (CAMPS[i].value === value) return CAMPS[i];
    }
    return null;
}

function libelleCategorieContact(value) {
    for (var i = 0; i < CATEGORIES_CONTACT.length; i++) {
        if (CATEGORIES_CONTACT[i].value === value) return CATEGORIES_CONTACT[i].label;
    }
    return 'Autre';
}

// ------------------------------------------------------------
// 2. État en mémoire
// ------------------------------------------------------------
var db = null;
var elements = [];        // tout sauf le singleton
var ficheProjet = null;   // le document _projet, ou null tant qu'il n'existe pas
var premierChargement = true;

// ------------------------------------------------------------
// 3. Écoute temps réel
// ------------------------------------------------------------
function ecouterElements() {
    db.collection(COLLECTION).onSnapshot(function(snapshot) {
        elements = [];
        ficheProjet = null;
        snapshot.forEach(function(doc) {
            var data = doc.data();
            data.id = doc.id;

            // Le repli « emlBrut » (si Cloudinary refusait les fichiers
            // raw) stocke le mail entier dans le document. On le retire
            // de la mémoire de la page : il n'est lu qu'à la demande,
            // sur le seul mail ouvert. Voir lireEmlBrut().
            if (data.emlBrut) {
                data.aEmlBrut = true;
                delete data.emlBrut;
            }

            if (doc.id === ID_PROJET || data.type === 'projet') {
                ficheProjet = data;
                return;
            }
            elements.push(data);
        });
        premierChargement = false;
        if (typeof rafraichirVues === 'function') rafraichirVues();
    }, function(erreur) {
        console.error('Erreur Firestore :', erreur);
        afficherErreurDonnees(erreur);
    });
}

function afficherErreurDonnees(erreur) {
    var cible = document.getElementById('vues');
    if (!cible) return;
    cible.innerHTML = '<div class="error-block">'
        + '<i class="fa-solid fa-circle-exclamation"></i>'
        + '<strong>Impossible de lire les données du chantier.</strong><br>'
        + '<span style="color:var(--color-text-muted)">' + escapeHtml(erreur && erreur.message) + '</span>'
        + '</div>';
}

// ------------------------------------------------------------
// 4. Utilitaires
// ------------------------------------------------------------
// Nombre de jours entiers écoulés depuis un horodatage. null si la date
// est inconnue — un serverTimestamp() tout juste écrit vaut null le
// temps que le serveur réponde.
function joursDepuis(valeur) {
    var date = toDate(valeur);
    if (!date) return null;
    return Math.floor((Date.now() - date.getTime()) / 86400000);
}

// Minuscules, accents pliés, espaces normalisés. Sert à deux choses :
// regrouper les devis par sujet (« Terrasse » et « terrasse » sont le
// même sujet) et rendre la recherche insensible aux accents.
// String.prototype.normalize est de l'ES6, explicitement autorisé ici :
// réécrire une table de translittération à la main coûterait plus cher
// qu'il ne rapporte.
function normaliserTexte(valeur) {
    var texte = String(valeur == null ? '' : valeur).trim().toLowerCase();
    if (!texte) return '';
    if (typeof texte.normalize === 'function') {
        texte = texte.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }
    return texte.replace(/\s+/g, ' ');
}

function cleSujet(sujet) {
    return normaliserTexte(sujet);
}

function trouverElement(id) {
    for (var i = 0; i < elements.length; i++) {
        if (elements[i].id === id) return elements[i];
    }
    return null;
}

function elementsDeType(type) {
    return elements.filter(function(e) { return e.type === type; });
}

// Un contact peut avoir été supprimé alors que des éléments le
// référencent encore. On tolère la référence morte à l'affichage
// plutôt que de casser la page — ou de refuser la suppression.
function nomContact(contactId) {
    if (!contactId) return '';
    var contact = trouverElement(contactId);
    if (!contact || contact.type !== 'contact') return 'contact supprimé';
    var nom = ((contact.prenom || '') + ' ' + (contact.nom || '')).trim();
    return nom || contact.entreprise || 'contact sans nom';
}

function contactExiste(contactId) {
    var contact = trouverElement(contactId);
    return !!(contact && contact.type === 'contact');
}

// ------------------------------------------------------------
// 5. Identité — la trace dit qui a VRAIMENT écrit
// ------------------------------------------------------------
// Sous impersonation, les écritures partent avec le jeton du
// superadmin : Firestore ne voit que lui. Inscrire l'identité
// impersonnée ferait donc mentir la trace. D'où HUB.user partout dans
// cette section, jamais HUB.effectif.
function utilisateurReel() {
    return (window.HUB && HUB.user && HUB.user.email) ? String(HUB.user.email).toLowerCase() : '';
}

function prenomUtilisateurReel() {
    var user = (window.HUB && HUB.user) ? HUB.user : null;
    if (!user) return '';
    var brut = String(user.displayName || '').trim();
    if (!brut) brut = String(user.email || '').split('@')[0].split(/[._\-+]/)[0];
    var prenom = brut.split(/\s+/)[0];
    if (!prenom) return '';
    return prenom.charAt(0).toUpperCase() + prenom.slice(1);
}

// ------------------------------------------------------------
// 6. Écriture
// ------------------------------------------------------------
function horodatage() {
    return firebase.firestore.FieldValue.serverTimestamp();
}

function creerElement(donnees) {
    var maintenant = horodatage();
    var moi = utilisateurReel();
    var doc = {};
    for (var cle in donnees) {
        if (Object.prototype.hasOwnProperty.call(donnees, cle)) doc[cle] = donnees[cle];
    }
    doc.creePar = moi;
    doc.modifiePar = moi;
    doc.creeLe = maintenant;
    doc.modifieLe = maintenant;

    // Deux dates, deux usages. dateEvenement = quand la chose s'est
    // produite (elle ordonne le fil) ; creeLe = quand on l'a archivée
    // (elle alimente « Mouvement »). Sans cette distinction, archiver
    // dix vieux mails d'un coup les propulserait en tête du fil.
    if (!doc.dateEvenement) doc.dateEvenement = maintenant;

    // campDepuis se pose tout seul : c'est lui qui donnera « à eux
    // depuis 18 jours », sans qu'aucune date ne soit jamais saisie.
    if (doc.camp && !doc.campDepuis) doc.campDepuis = maintenant;

    return db.collection(COLLECTION).add(doc);
}

function modifierElement(id, donnees) {
    var doc = {};
    for (var cle in donnees) {
        if (Object.prototype.hasOwnProperty.call(donnees, cle)) doc[cle] = donnees[cle];
    }
    doc.modifiePar = utilisateurReel();
    doc.modifieLe = horodatage();
    return db.collection(COLLECTION).doc(id).update(doc);
}

// ⚠ Supprime le document Firestore, PAS le fichier Cloudinary.
// Effacer chez Cloudinary demande la clé secrète du compte : la mettre
// dans une page publique reviendrait à la publier. Le fichier reste
// donc en ligne, sans lien nulle part. Ne pas déposer ici ce qu'on
// pourrait vouloir faire disparaître pour de bon.
function supprimerElement(id) {
    return db.collection(COLLECTION).doc(id).delete();
}

// ------------------------------------------------------------
// 7. Le camp — déduit, jamais demandé
// ------------------------------------------------------------
// Un outil nourri à la main ne survit qu'en dessous d'un certain coût
// par saisie. Le camp se devine donc du contexte de création, et trois
// boutons le corrigent en un clic quand la déduction se trompe.
function campParDefaut(type, sens) {
    if (type === 'email')    return (sens === 'envoye') ? 'a_eux' : 'a_nous';
    if (type === 'document') return 'a_nous';   // un devis reçu : à lire, à comparer
    if (type === 'tache')    return 'a_nous';
    return '';                                   // image, note, contact, lien : non actionnables
}

// Réécrit campDepuis à chaque bascule : l'ancienneté affichée compte
// depuis le changement lui-même, pas depuis la création.
function changerCamp(id, camp) {
    return modifierElement(id, { camp: camp, campDepuis: horodatage() })
        .then(function() {
            var def = getCampDef(camp);
            showToast(def ? ('Passé en « ' + def.label + ' ».') : 'Camp modifié.', 'success');
        })
        .catch(function(erreur) {
            console.error(erreur);
            showToast('Changement impossible : ' + erreur.message, 'error');
        });
}

// ------------------------------------------------------------
// 8. Amorçage de la fiche projet
// ------------------------------------------------------------
// Deux listes se remplissent toutes seules, à chaque ouverture :
//   nosAdresses  — sert à deviner si un mail est envoyé ou reçu
//   intervenants — sert à proposer « assigner à … »
// Au bout d'une visite chacun, elles sont complètes sans qu'une seule
// saisie ait été demandée.
//
// set(merge) + arrayUnion, et surtout PAS update() : le document
// n'existe pas au premier lancement, un update() lèverait « not-found »
// précisément dans le cas que cet amorçage est censé couvrir. Un set()
// complet, lui, écraserait les notes de budget de l'autre.
// Effet de bord heureux : arrayUnion neutralise le risque de « dernière
// écriture gagnante » sur ces deux tableaux.
function amorcerProjet() {
    var email = utilisateurReel();
    if (!email) return Promise.resolve();

    var champs = { type: 'projet' };
    champs.nosAdresses = firebase.firestore.FieldValue.arrayUnion(email);

    var prenom = prenomUtilisateurReel();
    if (prenom) champs.intervenants = firebase.firestore.FieldValue.arrayUnion(prenom);

    return db.collection(COLLECTION).doc(ID_PROJET).set(champs, { merge: true })
        .catch(function(erreur) {
            // Non bloquant : sans amorçage la page marche, on saisit
            // simplement les deux listes à la main dans « Le projet ».
            console.warn('Amorçage de la fiche projet impossible :', erreur);
        });
}

function nosAdresses() {
    return (ficheProjet && ficheProjet.nosAdresses) ? ficheProjet.nosAdresses : [];
}

function intervenants() {
    return (ficheProjet && ficheProjet.intervenants) ? ficheProjet.intervenants : [];
}

// ------------------------------------------------------------
// 9. Corps des mails
// ------------------------------------------------------------
function tronquerCorps(corps) {
    var texte = String(corps == null ? '' : corps);
    if (texte.length <= MAX_CORPS) return { corps: texte, corpsTronque: false };
    return { corps: texte.slice(0, MAX_CORPS), corpsTronque: true };
}

// Lecture à la demande du seul document ouvert : le repli emlBrut est
// retiré du snapshot (voir ecouterElements), il faut donc relire le
// document pour l'obtenir.
function lireEmlBrut(id) {
    return db.collection(COLLECTION).doc(id).get().then(function(doc) {
        return doc.exists ? (doc.data().emlBrut || '') : '';
    });
}
