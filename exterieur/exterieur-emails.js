// ============================================================
// exterieur-emails.js — La vue Emails
// ============================================================
// Le bouton « Copier le corps » est la raison d'être de cette vue.
// C'est lui qui répond au besoin d'origine : ne pas devoir réécrire une
// quatrième fois le même mail de demande de devis. Tout le reste — la
// liste, les filtres, l'ouverture — n'est là que pour retrouver le mail
// à copier.
//
// Un mail dont parseOk vaut false s'affiche avec un avertissement et
// ses champs éditables : le fichier n'est jamais perdu, seulement le
// confort du pré-remplissage.
// ============================================================

var filtreSens = 'tous';   // tous | envoye | recu
var emailDeplie = null;

function renderEmails() {
    var cible = document.getElementById('vue-emails');
    if (!cible) return;

    var mails = elementsDeType('email')
        .filter(function(m) { return filtreSens === 'tous' || (m.sens || 'recu') === filtreSens; })
        .sort(function(a, b) {
            var da = toDate(a.dateEvenement) || toDate(a.dateEnvoi) || toDate(a.creeLe);
            var db2 = toDate(b.dateEvenement) || toDate(b.dateEnvoi) || toDate(b.creeLe);
            return (db2 ? db2.getTime() : 0) - (da ? da.getTime() : 0);
        });

    cible.innerHTML = actionsEmails()
        + barreEmails()
        + (mails.length
            ? '<div class="fil">' + mails.map(carteEmail).join('') + '</div>'
            : '<p class="bloc-vide">' + escapeHtml(premierChargement
                ? 'Chargement…'
                : 'Aucun mail archivé. Sur ordinateur : ⋮ → Télécharger le message, puis déposez le .eml. '
                  + 'Depuis un téléphone, où Gmail ne sait pas le faire : copiez le mail et collez-le.')
              + '</p>');
}

// Le .eml demande un ordinateur — l'application Gmail mobile ne sait pas
// télécharger un message. Coller, elle sait : c'est souvent le seul
// geste possible sur le terrain, d'où les deux boutons côte à côte.
function actionsEmails() {
    return '<div class="images-actions">'
        + '<button type="button" class="btn-add" onclick="declencherDepot(\'email\')">'
        +   '<i class="fa-solid fa-file-arrow-up"></i> Déposer un .eml</button>'
        + '<button type="button" class="btn-export" onclick="ouvrirModaleCollage()">'
        +   '<i class="fa-solid fa-paste"></i> Coller un mail</button>'
        + '</div>';
}

function barreEmails() {
    var comptes = { tous: 0, envoye: 0, recu: 0 };
    elementsDeType('email').forEach(function(m) {
        comptes.tous++;
        comptes[(m.sens === 'envoye') ? 'envoye' : 'recu']++;
    });
    return '<div class="filter-row">'
        + boutonFiltreSens('tous', 'Tous', comptes.tous)
        + boutonFiltreSens('envoye', 'Envoyés', comptes.envoye)
        + boutonFiltreSens('recu', 'Reçus', comptes.recu)
        + '</div>';
}

function boutonFiltreSens(valeur, libelle, compte) {
    var actif = (filtreSens === valeur) ? ' active' : '';
    return '<button type="button" class="filter-btn' + actif + '"'
        + ' onclick="filtrerEmails(\'' + jsAttr(valeur) + '\')">'
        + escapeHtml(libelle) + ' (' + compte + ')</button>';
}

function filtrerEmails(valeur) {
    filtreSens = valeur;
    renderEmails();
}

function carteEmail(mail) {
    var id = jsAttr(mail.id);
    var deplie = (emailDeplie === mail.id);

    var alerte = (mail.parseOk === false)
        ? '<p class="alerte-parse"><i class="fa-solid fa-triangle-exclamation"></i> '
            + 'Ce mail a été conservé mais mal compris. Les champs sont à vérifier — '
            + '<button type="button" class="lien-bouton" onclick="ouvrirModaleElement(\'' + id + '\')">les corriger</button>.'
          + '</p>'
        : '';

    var entete = '<div class="mail-entete">'
        + '<span class="badge ' + (mail.sens === 'envoye' ? 'badge-envoye' : 'badge-recu') + '">'
        +   '<i class="fa-solid ' + (mail.sens === 'envoye' ? 'fa-paper-plane' : 'fa-inbox') + '"></i>'
        +   (mail.sens === 'envoye' ? 'envoyé' : 'reçu') + '</span>'
        + '<span class="mail-date">' + escapeHtml(formatDateFr(mail.dateEvenement || mail.dateEnvoi || mail.creeLe)) + '</span>'
        + '</div>';

    var champs = '<dl class="mail-champs">'
        + '<dt>De</dt><dd>' + escapeHtml(mail.de || '—') + '</dd>'
        + '<dt>À</dt><dd>' + escapeHtml(mail.a || '—') + '</dd>'
        + '</dl>';

    var corps = deplie
        ? '<pre class="mail-corps">' + escapeHtml(mail.corps || '(corps vide)') + '</pre>'
          + (mail.corpsTronque
              ? '<p class="mail-note">Corps abrégé pour l\'affichage. Le bouton Copier récupère le mail entier.</p>'
              : '')
        : '<p class="carte-apercu">' + escapeHtml(mail.corps || '') + '</p>';

    var actions = '<div class="mail-actions">'
        + '<button type="button" class="btn-export" onclick="basculerEmail(\'' + id + '\')">'
        +   '<i class="fa-solid fa-' + (deplie ? 'chevron-up' : 'chevron-down') + '"></i> '
        +   (deplie ? 'Replier' : 'Lire') + '</button>'
        + '<button type="button" class="btn-add" onclick="copierCorps(\'' + id + '\')">'
        +   '<i class="fa-solid fa-copy"></i> Copier le corps</button>'
        + (mail.url
            ? '<a class="btn-export" target="_blank" rel="noopener" href="' + escapeAttr(mail.url) + '">'
                + '<i class="fa-solid fa-file-arrow-down"></i> Le .eml</a>'
            : '')
        + '<button type="button" class="btn-export" onclick="ouvrirModaleElement(\'' + id + '\')">'
        +   '<i class="fa-solid fa-pen"></i> Modifier</button>'
        + '</div>';

    return '<article class="carte-mail">'
        + entete
        + '<button type="button" class="carte-titre carte-titre--bouton" onclick="basculerEmail(\'' + id + '\')">'
        +   escapeHtml(mail.objet || mail.titre || '(mail sans objet)') + '</button>'
        + alerte
        + champs
        + corps
        + actions
        + '</article>';
}

function basculerEmail(id) {
    emailDeplie = (emailDeplie === id) ? null : id;
    renderEmails();
}

// ------------------------------------------------------------
// Copier — la fonction qui justifie la vue
// ------------------------------------------------------------
// Si le corps stocké a été abrégé (le tiroir entier se retéléchargeant
// à chaque ouverture, on ne garde pas 100 Ko de mail dans Firestore),
// on relit le .eml d'origine et on le ré-analyse avant de copier. Sinon
// on collerait un mail tronqué dans Gmail sans s'en apercevoir.
function copierCorps(id) {
    var mail = trouverElement(id);
    if (!mail) return;

    corpsComplet(mail)
        .then(function(texte) {
            if (!texte) {
                showToast('Ce mail n\'a pas de corps à copier.', 'error');
                return;
            }
            return ecrireDansPressePapier(texte).then(function() {
                showToast('Corps du mail copié — prêt à coller dans Gmail.', 'success');
            });
        })
        .catch(function(erreur) {
            console.error(erreur);
            showToast('Copie impossible : ' + erreur.message, 'error');
        });
}

function corpsComplet(mail) {
    if (!mail.corpsTronque) return Promise.resolve(mail.corps || '');

    // Repli emlBrut : le mail entier est dans le document Firestore,
    // volontairement retiré du snapshot. Une lecture ciblée suffit.
    //
    // Deux natures d'original y cohabitent : la source d'un .eml, que
    // l'analyseur sait relire, et le TEXTE d'un mail collé à la main,
    // dont il ne tirera rien — il n'y a pas d'en-tête. D'où le repli sur
    // le brut lui-même : sans lui, coller un long fil de discussion puis
    // le copier en rendrait la version abrégée, en silence.
    if (mail.aEmlBrut) {
        return lireEmlBrut(mail.id).then(function(brut) {
            var analyse = analyserEml(brut);
            return analyse.corps || nettoyerCorps(brut) || mail.corps || '';
        });
    }

    if (!mail.url) return Promise.resolve(mail.corps || '');

    return fetch(mail.url)
        .then(function(reponse) {
            if (!reponse.ok) throw new Error('le fichier .eml est introuvable');
            return reponse.text();
        })
        .then(function(brut) {
            var analyse = analyserEml(brut);
            return analyse.corps || mail.corps || '';
        })
        .catch(function(erreur) {
            // Mieux vaut copier la version abrégée que rien du tout —
            // en le disant.
            console.warn('Relecture du .eml impossible :', erreur);
            showToast('Version abrégée copiée : le fichier d\'origine n\'a pas pu être relu.', 'info');
            return mail.corps || '';
        });
}

function ecrireDansPressePapier(texte) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(texte);
    }
    // Repli pour les contextes où l'API n'est pas disponible.
    return new Promise(function(resoudre, rejeter) {
        var zone = document.createElement('textarea');
        zone.value = texte;
        zone.setAttribute('readonly', '');
        zone.style.position = 'fixed';
        zone.style.left = '-9999px';
        document.body.appendChild(zone);
        zone.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (erreur) { ok = false; }
        document.body.removeChild(zone);
        ok ? resoudre() : rejeter(new Error('le navigateur a refusé la copie'));
    });
}
