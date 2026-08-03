// ============================================================
// exterieur-upload.js — Un geste, un fichier, c'est rangé
// ============================================================
// Le vrai risque de ce projet n'est pas technique : si archiver un mail
// coûte cinq gestes, ce sera fait trois fois puis jamais. D'où le
// parti pris de tout ce fichier : un bouton, un fichier déposé, le type
// deviné de l'extension, le titre déduit du nom, et un formulaire déjà
// rempli qu'il suffit de valider.
//
// Trois entrées derrière le bouton Ajouter :
//   Déposer un fichier — le chemin principal, le type est deviné
//   Ranger dans…      — on dit où, l'extension ne décide plus
//   Écrire            — une tâche, une note, ou un mail collé
// Les contacts et les liens ne passent pas par là : on les crée depuis
// la vue Carnet, là où on les cherche.
//
// ⚠ LA DEVINETTE NE DÉCIDE QUE PAR DÉFAUT. Un plan scanné en PNG est un
// document, pas une photo du terrain : quand on a dit où l'on range,
// l'extension n'a plus voix au chapitre. C'est le sens de « intention »
// dans tout ce fichier.
//
// ⚠ Aucun document Firestore n'est créé avant que l'upload ait réussi.
// Un échec réseau laisse la base propre, sans élément orphelin pointant
// vers un fichier inexistant.
// ============================================================

var EXTENSIONS_IMAGE = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif'];

// Ce que le sélecteur de fichiers propose selon l'intention. Chaîne vide
// = tout accepter : « ranger dans les documents » doit marcher pour un
// .dwg comme pour un .xlsx, sinon la promesse n'est pas tenue.
var ACCEPT_PAR_TYPE = {
    document: '',
    image: 'image/*',
    email: '.eml'
};

// Le dépôt par défaut, quand on n'a rien précisé.
var ACCEPT_DEVINETTE = '.eml,.pdf,.doc,.docx,image/*';

// ------------------------------------------------------------
// 1. Déductions à partir du fichier
// ------------------------------------------------------------
// Accepte un File du navigateur ou un simple nom : la version chaîne
// n'existe que pour rendre la fonction testable sans DOM.
function nomDeFichier(fichier) {
    if (typeof fichier === 'string') return fichier;
    return String((fichier && fichier.name) || '');
}

function typeDepuisFichier(fichier) {
    var nom = nomDeFichier(fichier);
    var point = nom.lastIndexOf('.');
    var extension = (point === -1) ? '' : nom.slice(point + 1).toLowerCase();

    if (extension === 'eml') return 'email';
    if (EXTENSIONS_IMAGE.indexOf(extension) !== -1) return 'image';
    // pdf, doc, docx — et tout le reste. Un devis mal nommé reste un
    // document : mieux vaut le ranger approximativement que le refuser.
    return 'document';
}

// « devis-terrasse-dupont.pdf » devient « Devis terrasse dupont ».
// Le titre d'un document est obligatoire — le contenu d'un PDF n'est
// pas indexable, un devis sans titre serait introuvable et la recherche
// mentirait. Le pré-remplir est ce qui rend cette exigence indolore :
// le champ reste modifiable, et n'est refusé que s'il finit vraiment vide.
function titreDepuisNomFichier(nom) {
    var base = nomDeFichier(nom).replace(/\.[^.]+$/, '');
    var texte = base.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!texte) return '';
    return texte.charAt(0).toUpperCase() + texte.slice(1);
}

// ------------------------------------------------------------
// 2. Cloudinary
// ------------------------------------------------------------
// Endpoint « auto » et non « image » : /image/upload accepte les PDF
// (Cloudinary les traite comme des images) mais refuse les .eml, qui
// relèvent du type « raw ». /auto/upload aiguille selon le type réel et
// couvre les deux.
function urlUpload() {
    return 'https://api.cloudinary.com/v1_1/' + CLOUDINARY_CLOUD_NAME + '/auto/upload';
}

function uploadFichier(file, surProgression) {
    return new Promise(function(resoudre, rejeter) {
        if (typeof CLOUDINARY_CLOUD_NAME === 'undefined' || !CLOUDINARY_UPLOAD_PRESET) {
            rejeter(new Error('Cloudinary n\'est pas configuré — voir config.js.'));
            return;
        }

        var donnees = new FormData();
        donnees.append('file', file);
        donnees.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

        // XMLHttpRequest et pas fetch : fetch ne rend aucune progression
        // d'upload. La barre de BilletsTouristiques passe à 30 % puis à
        // 100 % sans rien mesurer — sur un PDF de 10 Mo depuis un
        // téléphone, ça ressemble à un plantage.
        var requete = new XMLHttpRequest();
        requete.open('POST', urlUpload());

        requete.upload.onprogress = function(evenement) {
            if (!surProgression) return;
            if (evenement.lengthComputable) {
                surProgression(Math.round((evenement.loaded / evenement.total) * 100));
            }
        };

        requete.onload = function() {
            var reponse = null;
            try { reponse = JSON.parse(requete.responseText); } catch (erreur) { /* traité juste après */ }
            if (requete.status >= 200 && requete.status < 300 && reponse && reponse.secure_url) {
                resoudre(reponse.secure_url);
                return;
            }
            var message = (reponse && reponse.error && reponse.error.message)
                ? reponse.error.message
                : ('Cloudinary a répondu ' + requete.status + '.');
            // Le cas à reconnaître : certains comptes bloquent le
            // téléversement de fichiers « raw » en mode non signé. Si un
            // .eml échoue là où un PDF passe, c'est ça — voir le repli
            // emlBrut décrit dans le README.
            rejeter(new Error(message));
        };

        requete.onerror = function() {
            rejeter(new Error('Connexion à Cloudinary impossible.'));
        };
        requete.onabort = function() {
            rejeter(new Error('Envoi interrompu.'));
        };

        requete.send(donnees);
    });
}

// Vignette : on ne télécharge pas les originaux dans une grille.
function urlVignette(url, largeur) {
    var texte = String(url == null ? '' : url);
    var marqueur = '/upload/';
    var coupe = texte.indexOf(marqueur);
    if (coupe === -1) return texte;
    return texte.slice(0, coupe + marqueur.length)
        + 'w_' + (largeur || 400) + ',c_limit,f_auto,q_auto/'
        + texte.slice(coupe + marqueur.length);
}

// ------------------------------------------------------------
// 3. Lecture d'un .eml avant envoi
// ------------------------------------------------------------
// Le fichier est lu dans le navigateur, pas sur un serveur. L'analyse
// ne bloque jamais le dépôt : si elle échoue, on part avec parseOk
// false et des champs vides mais saisissables.
function lireEmlSiBesoin(file, type) {
    if (type !== 'email' || typeof FileReader === 'undefined') {
        return Promise.resolve(null);
    }
    return new Promise(function(resoudre) {
        var lecteur = new FileReader();
        lecteur.onload = function() {
            var texte = String(lecteur.result || '');
            var analyse = analyserEml(texte);
            analyse.texteBrut = texte;
            resoudre(analyse);
        };
        lecteur.onerror = function() {
            resoudre({ de: '', a: '', objet: '', dateEnvoi: null, corps: '', parseOk: false, texteBrut: '' });
        };
        lecteur.readAsText(file, 'UTF-8');
    });
}

// ------------------------------------------------------------
// 4. Le dépôt de bout en bout
// ------------------------------------------------------------
function afficherProgression(nom) {
    var zone = document.getElementById('upload-progress');
    var libelle = document.getElementById('upload-progress-nom');
    var barre = document.getElementById('upload-progress-bar');
    if (libelle) libelle.textContent = nom;
    if (barre) barre.style.width = '0%';
    if (zone) zone.style.display = 'block';
}

function majProgression(pourcent) {
    var barre = document.getElementById('upload-progress-bar');
    if (barre) barre.style.width = pourcent + '%';
}

function masquerProgression() {
    var zone = document.getElementById('upload-progress');
    if (zone) zone.style.display = 'none';
}

// intention : { type, categorie } — ce qu'on a demandé en cliquant.
// Absente, on devine ; présente, elle gagne. « Ranger dans les
// documents » doit ranger dans les documents, même si le fichier est un
// PNG : un plan scanné n'est pas une photo du terrain.
function deposerFichier(file, intention) {
    if (!file) return Promise.resolve();

    var choix = intention || {};
    var type = choix.type || typeDepuisFichier(file);
    var nom = nomDeFichier(file);
    afficherProgression(nom);

    return lireEmlSiBesoin(file, type)
        .then(function(analyse) {
            return uploadFichier(file, majProgression).then(function(url) {
                return { url: url, analyse: analyse };
            });
        })
        .then(function(resultat) {
            masquerProgression();
            fermerModaleAjout();
            ouvrirFormulaireDepot(nom, type, resultat.url, resultat.analyse, choix.categorie);
        })
        .catch(function(erreur) {
            masquerProgression();
            console.error('Dépôt impossible :', erreur);
            // Rien n'a été écrit dans Firestore : la création n'a lieu
            // qu'à la validation du formulaire, donc après l'upload.
            showToast('Envoi impossible : ' + erreur.message + ' Rien n\'a été enregistré.', 'error');
        });
}

// Prépare le formulaire déjà rempli. Tout ce qui peut être deviné l'est
// ici ; le reste se complète plus tard, ou jamais.
function ouvrirFormulaireDepot(nom, type, url, analyse, categorieImage) {
    var prerempli = { type: type, url: url, titre: titreDepuisNomFichier(nom) };

    if (type === 'document') {
        prerempli.nomFichier = nom;
        prerempli.camp = campParDefaut('document');
    } else if (type === 'image') {
        prerempli.categorie = categorieImage || 'actuelle';
    } else if (type === 'email') {
        var lu = analyse || { parseOk: false };
        var sens = sensDepuisDe(lu.de || '', nosAdresses());
        var corps = tronquerCorps(lu.corps || '');

        prerempli.de = lu.de || '';
        prerempli.a = lu.a || '';
        prerempli.objet = lu.objet || '';
        prerempli.corps = corps.corps;
        prerempli.corpsTronque = corps.corpsTronque;
        prerempli.sens = sens;
        prerempli.parseOk = !!lu.parseOk;
        prerempli.camp = campParDefaut('email', sens);
        prerempli.titre = lu.objet || titreDepuisNomFichier(nom);
        prerempli.nomFichier = nom;

        // R5 : la date d'envoi, pas la date d'archivage. Sans ça,
        // archiver dix vieux mails d'un coup les propulserait en tête
        // du fil comme s'ils venaient d'arriver.
        if (lu.dateEnvoi) {
            prerempli.dateEnvoi = lu.dateEnvoi;
            prerempli.dateEvenement = lu.dateEnvoi;
        }
        if (!lu.parseOk) {
            showToast('Mail archivé, mais mal compris : vérifiez les champs.', 'info');
        }
    }

    ouvrirModaleElement(null, prerempli);
}

// ------------------------------------------------------------
// 5. Le bouton Ajouter
// ------------------------------------------------------------
function ouvrirModaleAjout() {
    var overlay = document.getElementById('ajout-overlay');
    if (overlay) overlay.style.display = 'flex';
}

function fermerModaleAjout() {
    var overlay = document.getElementById('ajout-overlay');
    if (overlay) overlay.style.display = 'none';
    masquerProgression();
}

// « Écrire » : une tâche ou une note, sans fichier. Le bouton Ajouter
// reste unique, il ne prétend simplement plus que tout est un fichier.
function ajouterEnEcrivant(type) {
    fermerModaleAjout();
    ouvrirModaleElement(null, { type: type, camp: campParDefaut(type) });
}

// ------------------------------------------------------------
// 6. Dire où l'on range, plutôt que de laisser deviner
// ------------------------------------------------------------
// Retenue le temps du dépôt : un <input type="file"> ne transporte rien,
// et son événement « change » arrive bien après le clic qui l'a ouvert.
// Même mécanique que la catégorie d'image, dont elle prend la place.
var intentionDepot = null;

// Appelée depuis la modale Ajouter et depuis les vues Documents et
// Emails : « déposer ICI » range ici, quelle que soit l'extension.
function declencherDepot(type, categorie) {
    intentionDepot = type ? { type: type, categorie: categorie || '' } : null;

    var champ = document.getElementById('depot-fichier');
    if (!champ) return;
    var accept = type ? ACCEPT_PAR_TYPE[type] : ACCEPT_DEVINETTE;
    champ.accept = (accept === undefined) ? ACCEPT_DEVINETTE : accept;
    champ.click();
}

function initAjout() {
    var zone = document.getElementById('depot-zone');
    var champ = document.getElementById('depot-fichier');
    if (!zone || !champ) return;

    // La zone de dépôt, elle, ne dit rien : c'est le chemin où l'on
    // laisse deviner. On remet donc l'intention à zéro en l'ouvrant.
    zone.addEventListener('click', function() { declencherDepot(''); });

    zone.addEventListener('dragover', function(evenement) {
        evenement.preventDefault();
        zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', function() {
        zone.classList.remove('dragover');
    });
    zone.addEventListener('drop', function(evenement) {
        evenement.preventDefault();
        zone.classList.remove('dragover');
        var fichiers = evenement.dataTransfer && evenement.dataTransfer.files;
        if (fichiers && fichiers.length) deposerFichier(fichiers[0], null);
    });

    champ.addEventListener('change', function() {
        var intention = intentionDepot;
        intentionDepot = null;
        if (champ.files && champ.files.length) deposerFichier(champ.files[0], intention);
        champ.value = '';   // sinon redéposer le même fichier ne déclenche rien
    });
}

// ------------------------------------------------------------
// 7. Coller un mail
// ------------------------------------------------------------
// Le .eml demande un ordinateur : l'application Gmail mobile ne sait pas
// télécharger un message. Coller du texte, elle sait — et c'est souvent
// le seul geste possible sur le terrain.
//
// Deux formes arrivent par ce chemin, et il faut les traiter
// différemment sans rien demander :
//   la source complète (« Afficher l'original » de Gmail) — de vraies
//     en-têtes RFC, l'analyseur .eml la comprend entièrement ;
//   le message tel qu'on le lit, copié à la souris — aucune en-tête
//     exploitable, mais le TEXTE ne doit surtout pas être perdu.
function analyserMailColle(texte) {
    var brut = String(texte == null ? '' : texte);
    var analyse = analyserEml(brut);

    // L'analyseur a reconnu un mail : on garde tout ce qu'il a compris.
    if (analyse.parseOk || analyse.de || analyse.objet || analyse.dateEnvoi) return analyse;

    // Sinon, ce sont des lignes copiées à la main. Rendre des champs
    // vides ET un corps vide reviendrait à jeter ce qu'on vient de
    // coller : le texte entier devient le corps, à charge de compléter
    // l'expéditeur et l'objet — ou pas.
    //
    // parseOk reste VRAI, et ce n'est pas une négligence : ce drapeau dit
    // « le pré-remplissage est fiable », pas « tous les champs sont
    // remplis ». Rien n'a échoué ici — il n'y avait pas d'en-tête à lire,
    // et le corps est exactement ce qu'on a collé. Le passer à faux
    // collerait un bandeau « mal compris » sur un mail parfaitement
    // volontaire, dans la vue Emails comme dans le fil.
    return {
        de: '', a: '', objet: '', dateEnvoi: null,
        corps: nettoyerCorps(brut),
        parseOk: true,
        sansEntetes: true
    };
}

function ouvrirModaleCollage() {
    fermerModaleAjout();
    var champ = document.getElementById('coller-texte');
    if (champ) champ.value = '';
    var overlay = document.getElementById('coller-overlay');
    if (overlay) overlay.style.display = 'flex';
    if (champ) champ.focus();
}

function fermerModaleCollage() {
    var overlay = document.getElementById('coller-overlay');
    if (overlay) overlay.style.display = 'none';
}

// Aucun fichier ne part sur Cloudinary : un mail collé n'a pas
// d'original. Le formulaire s'ouvre pré-rempli comme après un dépôt, et
// c'est sa validation — pas celle-ci — qui écrit en base.
function validerCollage() {
    var champ = document.getElementById('coller-texte');
    var texte = champ ? String(champ.value) : '';
    if (!texte.trim()) {
        showToast('Collez le mail, ou annulez.', 'error');
        if (champ) champ.focus();
        return;
    }

    var lu = analyserMailColle(texte);
    var sens = sensDepuisDe(lu.de || '', nosAdresses());
    var corps = tronquerCorps(lu.corps || '');

    var prerempli = {
        type: 'email',
        de: lu.de || '',
        a: lu.a || '',
        objet: lu.objet || '',
        corps: corps.corps,
        corpsTronque: corps.corpsTronque,
        sens: sens,
        parseOk: !!lu.parseOk,
        camp: campParDefaut('email', sens),
        titre: lu.objet || ''
    };

    // R5 : la date d'envoi si on a su la lire, sinon celle du jour —
    // sans quoi un vieux mail collé remonterait en tête du fil.
    if (lu.dateEnvoi) {
        prerempli.dateEnvoi = lu.dateEnvoi;
        prerempli.dateEvenement = lu.dateEnvoi;
    }

    // ⚠ RIEN NE DOIT SE PERDRE. Le corps est abrégé à MAX_CORPS pour ne
    // pas alourdir un snapshot qui retélécharge tout le tiroir — mais
    // ici, contrairement à un .eml déposé, il n'existe AUCUN fichier
    // d'origine à relire. Le texte entier va donc dans emlBrut, ce champ
    // volontairement retiré du snapshot et lu à la demande. Sans cette
    // ligne, coller un long fil de discussion en perdrait la fin.
    if (corps.corpsTronque) prerempli.emlBrut = texte;

    fermerModaleCollage();
    ouvrirModaleElement(null, prerempli);

    if (lu.sansEntetes) {
        showToast('Texte collé dans le corps. Complétez l\'expéditeur et l\'objet si besoin.', 'info');
    }
}
