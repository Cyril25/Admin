// ============================================================
// exterieur-eml.js — Lire un mail Gmail sans rien ressaisir
// ============================================================
// Deux besoins contradictoires en apparence : ne rien ressaisir (donc
// un fichier) et pouvoir rechercher, relire et copier un mail (donc du
// texte). On fait les deux : le .eml est lu dans le navigateur au
// moment du dépôt, on en extrait expéditeur, destinataires, objet, date
// et corps, et le fichier original part sur Cloudinary.
//
// ⚠ RÈGLE ABSOLUE : aucune exception ne remonte. Un format exotique ne
// doit jamais faire perdre un mail. En cas d'échec, parseOk vaut false,
// le fichier est enregistré quand même et tous les champs restent
// saisissables à la main.
//
// Cadrage volontaire (sans quoi cette fonction s'étale sans fin) :
//   - en-têtes RFC 822, repliés ou non
//   - encodages quoted-printable et base64, charset UTF-8
//   - en-têtes encodées =?UTF-8?B?…?= et =?UTF-8?Q?…?=
//   - multipart : DEUX niveaux au plus (mixed > alternative, ce que
//     produit Gmail dès qu'il y a une pièce jointe), parseOk false
//     au-delà, pièces jointes ignorées
//
// Fonction pure : ni DOM, ni réseau, ni Firebase. C'est la plus facile
// à tester, et c'est là que porte l'essentiel de l'effort de test.
// ============================================================

// Gmail imbrique multipart/alternative dans multipart/mixed dès qu'il y
// a une pièce jointe. Deux niveaux couvrent donc le cas courant ;
// au-delà on abandonne proprement plutôt que de deviner.
var NIVEAUX_MULTIPART_MAX = 2;

// ------------------------------------------------------------
// 1. Décodage des octets
// ------------------------------------------------------------
// atob() rend du Latin-1 : chaque octet devient un caractère 0-255. Un
// corps base64 en charset UTF-8 — le cas normal d'un mail Gmail en
// français — ressort donc en « Ã©tÃ© ». Le piège est sournois : rien
// n'échoue, parseOk vaudrait true, et la dégradation prévue ne se
// déclencherait pas. D'où cette repasse explicite.
function decoderUtf8DepuisOctets(brut) {
    var texte = String(brut == null ? '' : brut);
    if (!texte) return '';

    if (typeof TextDecoder === 'function' && typeof Uint8Array === 'function') {
        try {
            var octets = new Uint8Array(texte.length);
            for (var i = 0; i < texte.length; i++) octets[i] = texte.charCodeAt(i) & 0xFF;
            return new TextDecoder('utf-8').decode(octets);
        } catch (erreur) { /* on tente le repli ci-dessous */ }
    }

    // Repli historique : escape() est déprécié mais universel, et il
    // reste la seule voie sans TextDecoder.
    if (typeof escape === 'function') {
        try { return decodeURIComponent(escape(texte)); } catch (erreur) { /* texte non UTF-8 */ }
    }
    return texte;
}

function decoderBase64(b64) {
    var propre = String(b64 == null ? '' : b64).replace(/\s+/g, '');
    if (!propre) return '';
    if (typeof atob !== 'function') throw new Error('base64 non décodable ici');
    return decoderUtf8DepuisOctets(atob(propre));
}

function decoderQuotedPrintable(texte) {
    var brut = String(texte == null ? '' : texte);
    // 1. Les sauts de ligne « souples » : un « = » en fin de ligne
    //    signale que la ligne suivante est la suite de celle-ci.
    var sansSoft = brut.replace(/=\r?\n/g, '');
    // 2. =XX devient l'octet correspondant. On obtient une suite
    //    d'octets, pas encore du texte : d'où le décodage UTF-8 ensuite.
    var octets = sansSoft.replace(/=([0-9A-Fa-f]{2})/g, function(tout, hex) {
        return String.fromCharCode(parseInt(hex, 16));
    });
    return decoderUtf8DepuisOctets(octets);
}

function decoderSelonEncodage(corps, encodage) {
    var enc = String(encodage || '').trim().toLowerCase();
    if (enc === 'base64') return decoderBase64(corps);
    if (enc === 'quoted-printable') return decoderQuotedPrintable(corps);
    // 7bit / 8bit / binary / absent : FileReader a déjà rendu du texte.
    return String(corps == null ? '' : corps);
}

// ------------------------------------------------------------
// 2. En-têtes
// ------------------------------------------------------------
// « =?UTF-8?B?w6l0w6k=?= » ou « =?UTF-8?Q?=C3=A9t=C3=A9?= » — c'est
// ainsi qu'un objet accentué voyage. Même piège UTF-8 que plus haut.
function decoderEnteteEncodee(valeur) {
    var texte = String(valeur == null ? '' : valeur);
    if (texte.indexOf('=?') === -1) return texte;

    // RFC 2047 : deux mots encodés séparés par un blanc se recollent
    // sans ce blanc. Sans ça, un objet long se retrouve troué d'espaces.
    texte = texte.replace(/\?=\s+=\?/g, '?==?');

    return texte.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, function(tout, charset, mode, contenu) {
        try {
            if (mode === 'B' || mode === 'b') return decoderBase64(contenu);
            // Mode Q : du quoted-printable, plus « _ » qui vaut espace.
            return decoderQuotedPrintable(contenu.replace(/_/g, ' '));
        } catch (erreur) {
            return tout;   // illisible : on rend la forme brute, jamais rien
        }
    });
}

// Découpe sur la première ligne vide : au-dessus les en-têtes, en
// dessous le corps. C'est la seule frontière que le format garantit.
function decouperEml(texte) {
    var normalise = String(texte == null ? '' : texte).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    var separation = normalise.indexOf('\n\n');
    if (separation === -1) return { entetes: normalise, corps: '' };
    return { entetes: normalise.slice(0, separation), corps: normalise.slice(separation + 2) };
}

function lireEntetes(bloc) {
    // Déplier d'abord : une ligne commençant par un espace ou une
    // tabulation est la suite de la précédente, pas un nouvel en-tête.
    var deplie = String(bloc == null ? '' : bloc).replace(/\n[ \t]+/g, ' ');
    var entetes = {};
    var lignes = deplie.split('\n');
    for (var i = 0; i < lignes.length; i++) {
        var coupe = lignes[i].indexOf(':');
        if (coupe === -1) continue;
        var nom = lignes[i].slice(0, coupe).trim().toLowerCase();
        if (!nom) continue;
        // Un en-tête répété (Received, souvent une dizaine de fois) :
        // on garde le premier, le plus proche de l'expéditeur.
        if (entetes[nom] === undefined) entetes[nom] = lignes[i].slice(coupe + 1).trim();
    }
    return entetes;
}

function lireContentType(valeur) {
    var brut = String(valeur || 'text/plain');
    var type = brut.split(';')[0].trim().toLowerCase();
    var frontiere = brut.match(/boundary\s*=\s*"([^"]*)"/i) || brut.match(/boundary\s*=\s*([^;\s]+)/i);
    return { type: type, boundary: frontiere ? frontiere[1] : '' };
}

// ------------------------------------------------------------
// 3. Corps
// ------------------------------------------------------------
function decouperParties(corps, boundary) {
    var morceaux = String(corps == null ? '' : corps).split('--' + boundary);
    var parties = [];
    // Le morceau 0 est le préambule (ignoré) ; un morceau commençant
    // par « -- » est le délimiteur de fin.
    for (var i = 1; i < morceaux.length; i++) {
        var m = morceaux[i];
        if (m.indexOf('--') === 0) break;
        if (m.charAt(0) === '\n') m = m.slice(1);
        var coupe = m.indexOf('\n\n');
        if (coupe === -1) parties.push({ entetes: m, corps: '' });
        else parties.push({ entetes: m.slice(0, coupe), corps: m.slice(coupe + 2) });
    }
    return parties;
}

// Parcourt l'arbre MIME et retient la première partie text/plain, à
// défaut la première text/html. Remplit « resultat » plutôt que de
// rendre une valeur : la récursion en devient triviale à lire.
function collecterTexte(corps, ct, encodage, entetes, profondeur, resultat) {
    if (ct.type.indexOf('multipart/') === 0) {
        if (profondeur >= NIVEAUX_MULTIPART_MAX || !ct.boundary) {
            resultat.tropImbrique = true;
            return;
        }
        var parties = decouperParties(corps, ct.boundary);
        for (var i = 0; i < parties.length; i++) {
            var entetesPartie = lireEntetes(parties[i].entetes);
            collecterTexte(
                parties[i].corps,
                lireContentType(entetesPartie['content-type']),
                entetesPartie['content-transfer-encoding'],
                entetesPartie,
                profondeur + 1,
                resultat
            );
        }
        return;
    }

    // Pièce jointe : ignorée. Un PDF ou une image inline n'a rien à
    // faire dans le texte qu'on relira pour le copier-coller — et le
    // fichier .eml d'origine reste disponible de toute façon.
    var disposition = String(entetes['content-disposition'] || '').toLowerCase();
    if (disposition.indexOf('attachment') === 0) return;

    if (ct.type === 'text/plain' && !resultat.plain) {
        resultat.plain = decoderSelonEncodage(corps, encodage);
    } else if (ct.type === 'text/html' && !resultat.html) {
        resultat.html = decoderSelonEncodage(corps, encodage);
    }
}

// Un corps HTML rendu lisible. Pas d'ambition de fidélité : le but est
// qu'on puisse relire et copier, pas rejouer la mise en page.
function detagger(html) {
    return String(html == null ? '' : html)
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/gi, '&')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function nettoyerCorps(texte) {
    return String(texte == null ? '' : texte)
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function parserDateEml(valeur) {
    if (!valeur) return null;
    var date = new Date(String(valeur).trim());
    return isNaN(date.getTime()) ? null : date;
}

// ------------------------------------------------------------
// 4. L'entrée publique
// ------------------------------------------------------------
function analyserEml(texte) {
    var resultat = { de: '', a: '', objet: '', dateEnvoi: null, corps: '', parseOk: false };

    try {
        var brut = String(texte == null ? '' : texte);
        if (!brut.trim()) return resultat;

        var decoupe = decouperEml(brut);
        var entetes = lireEntetes(decoupe.entetes);

        // Ni expéditeur, ni objet, ni date : ce n'est pas un mail. On
        // s'arrête là plutôt que de rendre des champs inventés.
        if (!entetes.from && !entetes.subject && !entetes.date) return resultat;

        resultat.de = decoderEnteteEncodee(entetes.from || '');
        resultat.a = decoderEnteteEncodee(entetes.to || '');
        if (entetes.cc) resultat.a += (resultat.a ? ', ' : '') + decoderEnteteEncodee(entetes.cc);
        resultat.objet = decoderEnteteEncodee(entetes.subject || '');
        resultat.dateEnvoi = parserDateEml(entetes.date);

        var collecte = { plain: '', html: '', tropImbrique: false };
        collecterTexte(
            decoupe.corps,
            lireContentType(entetes['content-type']),
            entetes['content-transfer-encoding'],
            entetes,
            0,
            collecte
        );

        resultat.corps = nettoyerCorps(collecte.plain || detagger(collecte.html));

        // parseOk ne dit pas « tout est parfait », il dit « le
        // pré-remplissage est fiable ». Un corps vide ou une imbrication
        // trop profonde suffisent à le retirer : mieux vaut ouvrir le
        // formulaire avec un avertissement que mentir.
        resultat.parseOk = !collecte.tropImbrique
            && !!resultat.corps
            && !!(resultat.de || resultat.objet);
    } catch (erreur) {
        console.warn('Analyse du .eml impossible :', erreur);
        resultat.parseOk = false;
    }

    return resultat;
}

// ------------------------------------------------------------
// 5. Envoyé ou reçu ?
// ------------------------------------------------------------
// La liste nosAdresses de la fiche projet s'auto-alimente : à chaque
// ouverture, l'adresse réelle de la personne connectée s'y ajoute. Au
// bout d'une visite chacun, la déduction marche sans aucune saisie.
// Un bouton bascule le sens en un clic quand elle se trompe.
function extraireAdresse(valeur) {
    var texte = String(valeur == null ? '' : valeur);
    var chevrons = texte.match(/<([^>]*)>/);
    var adresse = (chevrons ? chevrons[1] : texte).trim().toLowerCase();
    return adresse.indexOf('@') !== -1 ? adresse : '';
}

function sensDepuisDe(de, adresses) {
    var expediteur = extraireAdresse(de);
    if (!expediteur) return 'recu';
    var liste = adresses || [];
    for (var i = 0; i < liste.length; i++) {
        if (String(liste[i]).trim().toLowerCase() === expediteur) return 'envoye';
    }
    return 'recu';
}
