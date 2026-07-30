// ============================================================
// cueillette.js — Calendrier de cueillette du Haut-Doubs
// ============================================================
// Une seule question : QU'EST-CE QUE JE VAIS RÉCOLTER AUJOURD'HUI,
// entre 800 et 1200 m, sur le secteur Mouthe – Pontarlier – Levier ?
//
// DEUX SOURCES, ET C'EST LE CŒUR DE L'ARCHITECTURE.
//
//   1. Le RÉFÉRENTIEL (especes.js) — statique, versionné dans git.
//      Ce qui est vrai bon an mal an : la fenêtre théorique d'une
//      espèce à cette altitude, son biotope, ses sosies dangereuses.
//      Ça ne bouge que si l'on s'est trompé.
//
//   2. Les FORÇAGES (collection Firestore « cueillette ») — l'aléa de
//      l'année : gelées tardives dans le val de Mouthe, canicule qui
//      grille les myrtilles, arrêté préfectoral qui ferme un massif.
//      Ça bouge tout le temps, et ça se saisit depuis le téléphone.
//
// ⚠ POURQUOI UN FORÇAGE PORTE UNE ANNÉE.
// C'est la décision la plus importante de ce fichier. Un forçage vaut
// pour UNE saison et une seule : `annee` est obligatoire, et un forçage
// de 2026 est ignoré en 2027. Sans ce champ, on décalerait les morilles
// de douze jours pour cause de gelées tardives, on oublierait, et le
// calendrier mentirait toutes les années suivantes — un outil d'aide à
// la décision qui dérive en silence est pire que pas d'outil du tout.
// Corriger DURABLEMENT une fenêtre, c'est modifier especes.js.
//
// Lecture partagée, écriture personnelle — même modèle que le carnet
// d'idées : « les gelées ont tout décalé à Mouthe » n'a d'intérêt que
// partagé, mais chacun ne défait que ses propres forçages.
// ============================================================

// ------------------------------------------------------------
// 1. Référentiels de la page
// ------------------------------------------------------------
// Au-delà de ce délai, une espèce n'est plus « bientôt » mais « plus
// tard » : trois semaines, c'est l'horizon auquel on prépare une sortie.
var SEUIL_BIENTOT_JOURS = 21;

// Les trois statuts demandés — plus un quatrième, « Plus tard », sans
// lequel le classement mentirait : fin juillet, le cèpe qui démarre dans
// cinq semaines n'est ni en cours, ni bientôt, et surtout PAS terminé.
// Le ranger dans « Terminé » ferait passer la meilleure récolte de
// l'année pour une occasion manquée.
var STATUTS = [
    { valeur: 'en_cours',  label: 'En cours',  icone: 'fa-solid fa-circle-check',        couleur: '#2E7D32' },
    { valeur: 'suspendu',  label: 'Suspendu',  icone: 'fa-solid fa-ban',                 couleur: '#CC4444' },
    { valeur: 'bientot',   label: 'Bientôt',   icone: 'fa-solid fa-hourglass-half',      couleur: '#EF6C00' },
    { valeur: 'plus_tard', label: 'Plus tard', icone: 'fa-solid fa-calendar-days',       couleur: '#3D6485' },
    { valeur: 'termine',   label: 'Terminé',   icone: 'fa-solid fa-circle-minus',        couleur: '#7B8794' }
];

var MODES_FORCAGE = [
    { valeur: 'decalage',   label: 'Décaler la fenêtre',  aide: "La saison est en avance ou en retard d'un certain nombre de jours." },
    { valeur: 'fenetre',    label: 'Imposer des dates',   aide: "On sait exactement quand ça a commencé et quand ça s'arrête." },
    { valeur: 'suspension', label: 'Suspendre',           aide: "Rien à récolter, ou récolte interdite : arrêté préfectoral, sécheresse, massif fermé." }
];

var MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function getStatutDef(valeur) {
    for (var i = 0; i < STATUTS.length; i++) {
        if (STATUTS[i].valeur === valeur) return STATUTS[i];
    }
    return { valeur: valeur, label: valeur, icone: 'fa-solid fa-circle', couleur: '#7B8794' };
}

function getModeForcage(valeur) {
    for (var i = 0; i < MODES_FORCAGE.length; i++) {
        if (MODES_FORCAGE[i].valeur === valeur) return MODES_FORCAGE[i];
    }
    return { valeur: valeur, label: valeur, aide: '' };
}

// ------------------------------------------------------------
// 2. Arithmétique des dates
// ------------------------------------------------------------
// Les fenêtres sont stockées en mois/jour, sans année : elles se
// répètent. Pour les comparer à aujourd'hui, on les PROJETTE sur une
// année concrète — c'est tout le travail de cette section.

function dateDansAnnee(moisJour, annee) {
    return new Date(annee, moisJour.mois - 1, moisJour.jour);
}

function versMoisJour(date) {
    return { mois: date.getMonth() + 1, jour: date.getDate() };
}

function ajouterJours(date, jours) {
    var copie = new Date(date.getTime());
    copie.setDate(copie.getDate() + jours);
    return copie;
}

// Écart en jours PLEINS, l'heure mise de côté. Math.round et pas
// Math.floor : les changements d'heure font des journées de 23 h et
// de 25 h, qui décaleraient le compte d'un jour deux fois par an.
function ecartJours(depuis, vers) {
    var a = new Date(depuis.getFullYear(), depuis.getMonth(), depuis.getDate());
    var b = new Date(vers.getFullYear(), vers.getMonth(), vers.getDate());
    return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// Une fenêtre qui finit « avant » son début enjambe le 31 décembre —
// le cynorrhodon d'octobre à décembre n'est pas concerné, mais rien
// n'interdit d'en saisir une, et une fenêtre à cheval traitée comme
// les autres donnerait une durée négative.
function chevaucheAnnee(debut, fin) {
    if (debut.mois !== fin.mois) return fin.mois < debut.mois;
    return fin.jour < debut.jour;
}

function memeMoisJour(a, b) {
    return !!a && !!b && a.mois === b.mois && a.jour === b.jour;
}

function formatMoisJour(moisJour) {
    if (!moisJour) return '—';
    return moisJour.jour + ' ' + MOIS_COURTS[moisJour.mois - 1];
}

function formatFenetre(debut, fin) {
    return formatMoisJour(debut) + ' → ' + formatMoisJour(fin);
}

// ------------------------------------------------------------
// 3. Forçages
// ------------------------------------------------------------
// Retrouve LE forçage qui s'applique à une espèce pour une saison
// donnée. Il peut y en avoir plusieurs — deux personnes constatent la
// même sécheresse — d'où un ordre de priorité explicite plutôt qu'un
// « le dernier écrit gagne » qui rendrait l'affichage instable :
//   suspension  > fenêtre imposée > décalage
// Une interdiction ne se laisse pas écraser par un ajustement de dates.
function trouverForcage(forcages, especeId, annee) {
    var candidats = (forcages || []).filter(function(f) {
        return f.espece === especeId && Number(f.annee) === Number(annee);
    });
    if (!candidats.length) return null;

    var poids = { suspension: 0, fenetre: 1, decalage: 2 };
    candidats.sort(function(a, b) {
        var pa = poids[a.mode] === undefined ? 9 : poids[a.mode];
        var pb = poids[b.mode] === undefined ? 9 : poids[b.mode];
        if (pa !== pb) return pa - pb;
        // À priorité égale, le plus récemment modifié fait foi.
        var da = toDate(b.updatedAt) || toDate(b.createdAt);
        var db_ = toDate(a.updatedAt) || toDate(a.createdAt);
        return (da ? da.getTime() : 0) - (db_ ? db_.getTime() : 0);
    });
    return candidats[0];
}

// ------------------------------------------------------------
// 4. Occurrences
// ------------------------------------------------------------
// La fenêtre d'une espèce projetée sur une saison précise, forçage de
// CETTE saison appliqué. C'est ici, et nulle part ailleurs, qu'un
// forçage modifie des dates.
function occurrenceAnnee(espece, forcages, annee) {
    var forcage = trouverForcage(forcages, espece.id, annee);

    var debutMd = espece.debut;
    var finMd = espece.fin;

    if (forcage && forcage.mode === 'fenetre' && forcage.debut && forcage.fin) {
        debutMd = forcage.debut;
        finMd = forcage.fin;
    }

    var debut = dateDansAnnee(debutMd, annee);
    var fin = dateDansAnnee(finMd, chevaucheAnnee(debutMd, finMd) ? annee + 1 : annee);

    if (forcage && forcage.mode === 'decalage' && forcage.jours) {
        var jours = Number(forcage.jours) || 0;
        debut = ajouterJours(debut, jours);
        fin = ajouterJours(fin, jours);
    }

    return {
        annee: annee,
        debut: debut,
        fin: fin,
        forcage: forcage,
        suspendu: !!(forcage && forcage.mode === 'suspension'),
        // Les dates du référentiel, pour pouvoir dire à l'écran ce que
        // le forçage a changé : afficher la fenêtre corrigée sans
        // montrer l'originale rendrait la correction invisible.
        theorique: { debut: espece.debut, fin: espece.fin }
    };
}

// Trois saisons suffisent : celle d'avant (une fenêtre à cheval sur le
// nouvel an peut être encore ouverte), celle en cours, et la suivante
// (fin décembre, la prochaine occurrence est déjà l'an prochain).
function occurrencesAutour(espece, forcages, aujourdhui) {
    var annee = aujourdhui.getFullYear();
    return [
        occurrenceAnnee(espece, forcages, annee - 1),
        occurrenceAnnee(espece, forcages, annee),
        occurrenceAnnee(espece, forcages, annee + 1)
    ];
}

// ------------------------------------------------------------
// 5. Le calcul central : quel statut, aujourd'hui ?
// ------------------------------------------------------------
// « Terminé » veut dire fini POUR CETTE SAISON, et la saison est
// l'année civile : si la prochaine occurrence tombe l'an prochain,
// c'est fini pour cette année ; si elle tombe encore cette année, c'est
// que ça n'a pas commencé — donc « plus tard ».
function statutEspece(espece, forcages, aujourdhui) {
    var occurrences = occurrencesAutour(espece, forcages, aujourdhui);
    var i, occ;

    // 1. Une occurrence englobe-t-elle aujourd'hui ?
    for (i = 0; i < occurrences.length; i++) {
        occ = occurrences[i];
        if (ecartJours(occ.debut, aujourdhui) >= 0 && ecartJours(aujourdhui, occ.fin) >= 0) {
            return {
                statut: occ.suspendu ? 'suspendu' : 'en_cours',
                occurrence: occ,
                joursRestants: ecartJours(aujourdhui, occ.fin),
                joursAvant: 0,
                dansLePic: estDansLePic(espece, occ, aujourdhui)
            };
        }
    }

    // 2. Sinon, la prochaine à s'ouvrir.
    var prochaine = null;
    for (i = 0; i < occurrences.length; i++) {
        if (ecartJours(aujourdhui, occurrences[i].debut) > 0) {
            prochaine = occurrences[i];
            break;
        }
    }
    if (!prochaine) {
        // Ne devrait pas arriver — l'occurrence de l'an prochain est
        // toujours devant. Filet plutôt qu'une exception en pleine forêt.
        return { statut: 'termine', occurrence: occurrences[occurrences.length - 1], joursAvant: null, joursRestants: null, dansLePic: false };
    }

    var joursAvant = ecartJours(aujourdhui, prochaine.debut);

    if (joursAvant <= SEUIL_BIENTOT_JOURS) {
        return {
            statut: prochaine.suspendu ? 'suspendu' : 'bientot',
            occurrence: prochaine,
            joursAvant: joursAvant,
            joursRestants: null,
            dansLePic: false
        };
    }

    return {
        statut: prochaine.debut.getFullYear() > aujourdhui.getFullYear() ? 'termine' : 'plus_tard',
        occurrence: prochaine,
        joursAvant: joursAvant,
        joursRestants: null,
        dansLePic: false
    };
}

// Le pic n'est jamais forcé : c'est une nuance du référentiel, pas une
// date de décision. On le décale du même nombre de jours que la fenêtre
// pour ne pas annoncer « pleine saison » à contretemps.
function estDansLePic(espece, occurrence, aujourdhui) {
    if (!espece.pic) return false;
    var decalage = 0;
    if (occurrence.forcage && occurrence.forcage.mode === 'decalage') {
        decalage = Number(occurrence.forcage.jours) || 0;
    }
    if (occurrence.forcage && occurrence.forcage.mode === 'fenetre') return false;

    var annee = occurrence.debut.getFullYear();
    var debutPic = ajouterJours(dateDansAnnee(espece.pic.debut, annee), decalage);
    var finPic = ajouterJours(
        dateDansAnnee(espece.pic.fin, chevaucheAnnee(espece.pic.debut, espece.pic.fin) ? annee + 1 : annee),
        decalage
    );
    return ecartJours(debutPic, aujourdhui) >= 0 && ecartJours(aujourdhui, finPic) >= 0;
}

// La liste complète, évaluée et triée : ce que la page affiche.
// Fonction pure — c'est elle que les tests interrogent.
function evaluerCalendrier(especes, forcages, aujourdhui) {
    var ordre = {};
    STATUTS.forEach(function(s, i) { ordre[s.valeur] = i; });

    return especes.map(function(espece) {
        var etat = statutEspece(espece, forcages, aujourdhui);
        etat.espece = espece;
        return etat;
    }).sort(function(a, b) {
        if (ordre[a.statut] !== ordre[b.statut]) return ordre[a.statut] - ordre[b.statut];
        // Dans « en cours », ce qui se termine le plus tôt d'abord :
        // c'est ce qui est urgent. Ailleurs, ce qui ouvre le plus tôt.
        if (a.statut === 'en_cours' || a.statut === 'suspendu') {
            return (a.joursRestants === null ? 9999 : a.joursRestants) - (b.joursRestants === null ? 9999 : b.joursRestants);
        }
        return (a.joursAvant === null ? 9999 : a.joursAvant) - (b.joursAvant === null ? 9999 : b.joursAvant);
    });
}

// ------------------------------------------------------------
// 6. État de la page
// ------------------------------------------------------------
var db = null;
var forcages = [];
var vue = 'aujourdhui';
var filtreCategorie = 'toutes';
var idEnEdition = null;
var chargementFait = false;

// Une seule lecture de « maintenant » par rendu : sans ça, une page
// ouverte à 23 h 59 pourrait calculer ses blocs sur deux jours
// différents. Surchargeable pour les tests et pour la prévisualisation.
function aujourdhui() {
    return new Date();
}

// ------------------------------------------------------------
// 7. Démarrage
// ------------------------------------------------------------
function onHubReady() {
    db = firebase.firestore();
    remplirFormulaire();
    ecouterForcages();
}

function ecouterForcages() {
    db.collection('cueillette').onSnapshot(function(snapshot) {
        forcages = [];
        snapshot.forEach(function(doc) {
            var data = doc.data();
            data.id = doc.id;
            forcages.push(data);
        });
        chargementFait = true;
        render();
    }, function(erreur) {
        console.error('Erreur Firestore :', erreur);
        // Le référentiel, lui, est local : une panne de base ne doit pas
        // priver d'un calendrier qui n'en dépend pas. On affiche les
        // fenêtres théoriques en le disant clairement.
        chargementFait = true;
        forcages = [];
        render();
        var bandeau = document.getElementById('forcages-hs');
        if (bandeau) {
            bandeau.style.display = 'block';
            bandeau.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> '
                + '<strong>Forçages indisponibles.</strong> Le calendrier ci-dessous est celui du référentiel '
                + 'théorique, sans les corrections de l\'année. <span style="color:var(--color-text-muted)">'
                + escapeHtml(erreur.message) + '</span>';
        }
    });
}

// ------------------------------------------------------------
// 8. Qui peut quoi
// ------------------------------------------------------------
// L'utilisateur RÉEL pour la trace : sous impersonation, l'écriture
// part avec le jeton du superadmin, et la règle Firestore compare
// `creePar` à ce jeton.
function moiReel() {
    return normaliserEmail(HUB.user && HUB.user.email);
}

function peutModifier(forcage) {
    if (estSuperadmin()) return true;
    var moi = normaliserEmail(HUB.effectif && HUB.effectif.email);
    return !!moi && normaliserEmail(forcage.creePar) === moi;
}

function auteurCourt(email) {
    var normalise = normaliserEmail(email);
    if (!normalise) return '—';
    return normalise.split('@')[0];
}

// ------------------------------------------------------------
// 9. Rendu
// ------------------------------------------------------------
function changerVue(nouvelle) {
    vue = nouvelle;
    render();
}

function changerCategorie(categorie) {
    filtreCategorie = categorie;
    render();
}

function render() {
    var boutons = document.querySelectorAll('.vue-btn[data-vue]');
    for (var i = 0; i < boutons.length; i++) {
        boutons[i].className = 'vue-btn' + (boutons[i].getAttribute('data-vue') === vue ? ' active' : '');
    }

    ['aujourdhui', 'annee', 'forcages'].forEach(function(nom) {
        var bloc = document.getElementById('vue-' + nom);
        if (bloc) bloc.style.display = (nom === vue) ? 'block' : 'none';
    });

    var barreCat = document.getElementById('categorie-filter');
    if (barreCat) barreCat.style.display = (vue === 'forcages') ? 'none' : 'flex';

    renderFiltreCategorie();
    if (vue === 'aujourdhui') renderAujourdhui();
    else if (vue === 'annee') renderAnnee();
    else renderForcages();
}

function especesFiltrees() {
    if (filtreCategorie === 'toutes') return ESPECES;
    return ESPECES.filter(function(e) { return e.categorie === filtreCategorie; });
}

function renderFiltreCategorie() {
    var barre = document.getElementById('categorie-filter');
    if (!barre) return;

    var html = '<button type="button" class="filter-btn' + (filtreCategorie === 'toutes' ? ' active' : '') + '"'
        + ' onclick="changerCategorie(\'toutes\')">Tout (' + ESPECES.length + ')</button>';

    CATEGORIES.forEach(function(cat) {
        var nombre = ESPECES.filter(function(e) { return e.categorie === cat.valeur; }).length;
        if (!nombre) return;
        html += '<button type="button" class="filter-btn' + (filtreCategorie === cat.valeur ? ' active' : '') + '"'
            + ' onclick="changerCategorie(\'' + jsAttr(cat.valeur) + '\')">'
            + '<i class="' + cat.icone + '"></i> ' + escapeHtml(cat.label) + ' (' + nombre + ')</button>';
    });

    barre.innerHTML = html;
}

function renderAujourdhui() {
    var jour = aujourdhui();
    var evaluation = evaluerCalendrier(especesFiltrees(), forcages, jour);

    var entete = document.getElementById('date-du-jour');
    if (entete) {
        entete.textContent = jour.toLocaleDateString('fr-FR',
            { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }

    var resume = document.getElementById('resume-jour');
    if (resume) {
        var enCours = evaluation.filter(function(e) { return e.statut === 'en_cours'; });
        var suspendus = evaluation.filter(function(e) { return e.statut === 'suspendu'; });
        if (!enCours.length) {
            resume.className = 'mouvement-phrase mouvement-phrase--calme';
            resume.textContent = suspendus.length
                ? 'Rien d\'ouvert aujourd\'hui, et ' + suspendus.length + ' espèce(s) suspendue(s).'
                : 'Rien à récolter aujourd\'hui dans ce filtre — voir « Bientôt ».';
        } else {
            var pics = enCours.filter(function(e) { return e.dansLePic; });
            resume.className = 'mouvement-phrase';
            resume.textContent = enCours.length + ' espèce(s) à récolter aujourd\'hui'
                + (pics.length ? ', dont ' + pics.length + ' en pleine saison' : '')
                + '.';
        }
    }

    var html = '';
    STATUTS.forEach(function(statut) {
        var lot = evaluation.filter(function(e) { return e.statut === statut.valeur; });
        // Un bloc vide n'apporte rien ici, sauf « En cours » : « rien
        // aujourd'hui » est précisément la réponse qu'on venait chercher.
        if (!lot.length && statut.valeur !== 'en_cours') return;

        html += '<section class="bloc-etat">'
            + '<h2 class="bloc-titre"><i class="' + statut.icone + '" style="color:' + statut.couleur + '"></i> '
            + escapeHtml(statut.label)
            + ' <span class="bloc-compte">' + lot.length + '</span></h2>';

        if (!lot.length) {
            html += '<p class="bloc-vide">Rien d\'ouvert aujourd\'hui dans ce filtre.</p>';
        } else {
            html += '<div class="grille-especes">'
                + lot.map(carteEspece).join('')
                + '</div>';
        }
        html += '</section>';
    });

    var conteneur = document.getElementById('blocs-statuts');
    if (conteneur) conteneur.innerHTML = html;
}

function carteEspece(etat) {
    var espece = etat.espece;
    var statut = getStatutDef(etat.statut);
    var occ = etat.occurrence;
    var categorie = getCategorie(espece.categorie);

    var badges = '';
    if (etat.dansLePic) badges += '<span class="badge badge-pic">Pleine saison</span>';
    if (etat.statut === 'en_cours' && etat.joursRestants !== null) {
        badges += '<span class="badge badge-restant">'
            + (etat.joursRestants === 0 ? 'dernier jour' : 'encore ' + etat.joursRestants + ' j')
            + '</span>';
    }
    if (etat.statut === 'bientot') {
        badges += '<span class="badge badge-bientot">dans ' + etat.joursAvant + ' j</span>';
    }
    if (etat.statut === 'plus_tard' && etat.joursAvant !== null) {
        badges += '<span class="badge badge-plustard">dans ' + etat.joursAvant + ' j</span>';
    }
    badges += '<span class="badge badge-effort">' + escapeHtml(EFFORT_LABELS[espece.effort] || '—') + '</span>';
    badges += '<span class="badge badge-rendement">' + escapeHtml(RENDEMENT_LABELS[espece.rendement] || '—') + '</span>';

    var fenetreAffichee = formatFenetre(versMoisJour(occ.debut), versMoisJour(occ.fin));
    var ligneFenetre = '<div class="espece-fenetre"><i class="fa-solid fa-calendar-day"></i> ' + escapeHtml(fenetreAffichee);

    // Si un forçage a bougé les dates, on montre les deux : une
    // correction invisible est une correction qu'on ne saura pas défaire.
    var deplacee = !memeMoisJour(versMoisJour(occ.debut), occ.theorique.debut)
                || !memeMoisJour(versMoisJour(occ.fin), occ.theorique.fin);
    if (deplacee) {
        ligneFenetre += ' <span class="espece-theorique">(théorique : '
            + escapeHtml(formatFenetre(occ.theorique.debut, occ.theorique.fin)) + ')</span>';
    }
    ligneFenetre += '</div>';

    var forcage = '';
    if (occ.forcage) {
        var mode = getModeForcage(occ.forcage.mode);
        forcage = '<div class="espece-forcage">'
            + '<i class="fa-solid fa-wand-magic-sparkles"></i> '
            + '<strong>' + escapeHtml(mode.label) + '</strong>'
            + (occ.forcage.mode === 'decalage' && occ.forcage.jours
                ? ' de ' + (Number(occ.forcage.jours) > 0 ? '+' : '') + escapeHtml(String(occ.forcage.jours)) + ' j'
                : '')
            + (occ.forcage.motif ? ' — ' + escapeHtml(occ.forcage.motif) : '')
            + ' <span class="espece-forcage-meta">saison ' + escapeHtml(String(occ.forcage.annee))
            + ', ' + escapeHtml(auteurCourt(occ.forcage.creePar)) + '</span>'
            + '</div>';
    }

    return '<article class="carte-espece carte-espece--' + escapeAttr(etat.statut) + '">'
        + '<header class="espece-entete">'
            + '<i class="' + categorie.icone + ' espece-icone"></i>'
            + '<div class="espece-titres">'
                + '<h3 class="espece-nom">' + escapeHtml(espece.nom) + '</h3>'
                + '<span class="espece-latin">' + escapeHtml(espece.latin) + '</span>'
            + '</div>'
        + '</header>'
        + ligneFenetre
        + '<div class="espece-badges">' + badges + '</div>'
        + forcage
        + '<p class="espece-biotope"><i class="fa-solid fa-location-dot"></i> ' + escapeHtml(espece.biotope) + '</p>'
        + (espece.altitude ? '<p class="espece-altitude"><i class="fa-solid fa-mountain"></i> ' + escapeHtml(espece.altitude) + '</p>' : '')
        + (espece.confusion ? '<p class="espece-confusion"><i class="fa-solid fa-triangle-exclamation"></i> ' + escapeHtml(espece.confusion) + '</p>' : '')
        + (espece.reglementation ? '<p class="espece-reglementation"><i class="fa-solid fa-scale-balanced"></i> ' + escapeHtml(espece.reglementation) + '</p>' : '')
        + (espece.note ? '<p class="espece-note">' + escapeHtml(espece.note) + '</p>' : '')
        + '<div class="espece-actions">'
            + '<button type="button" class="lien-bouton" onclick="ouvrirModale(null, \'' + jsAttr(espece.id) + '\')">'
            + '<i class="fa-solid fa-wand-magic-sparkles"></i> Forcer cette espèce</button>'
        + '</div>'
        + '</article>';
}

// Vue « toute l'année » : le référentiel à plat, dans l'ordre du
// calendrier. Sert à préparer une saison, pas à décider un dimanche.
function renderAnnee() {
    var jour = aujourdhui();
    var lignes = evaluerCalendrier(especesFiltrees(), forcages, jour)
        .slice()
        .sort(function(a, b) {
            var da = a.espece.debut, db2 = b.espece.debut;
            if (da.mois !== db2.mois) return da.mois - db2.mois;
            return da.jour - db2.jour;
        });

    var corps = lignes.map(function(etat) {
        var statut = getStatutDef(etat.statut);
        var espece = etat.espece;
        return '<tr>'
            + '<td><strong>' + escapeHtml(espece.nom) + '</strong>'
                + '<div class="espece-latin">' + escapeHtml(espece.latin) + '</div></td>'
            + '<td>' + escapeHtml(getCategorie(espece.categorie).label) + '</td>'
            + '<td>' + escapeHtml(formatFenetre(espece.debut, espece.fin)) + '</td>'
            + '<td>' + (espece.pic ? escapeHtml(formatFenetre(espece.pic.debut, espece.pic.fin)) : '—') + '</td>'
            + '<td><span class="badge" style="background:' + escapeAttr(statut.couleur) + '18;color:'
                + escapeAttr(statut.couleur) + '">' + escapeHtml(statut.label) + '</span></td>'
            + '<td>' + escapeHtml(EFFORT_LABELS[espece.effort] || '—') + '</td>'
            + '<td>' + escapeHtml(RENDEMENT_LABELS[espece.rendement] || '—') + '</td>'
            + '</tr>';
    }).join('');

    var conteneur = document.getElementById('table-annee');
    if (conteneur) {
        conteneur.innerHTML = '<table class="idees-table">'
            + '<thead><tr><th>Espèce</th><th>Catégorie</th><th>Fenêtre théorique</th><th>Pic</th>'
            + '<th>Aujourd\'hui</th><th>Effort</th><th>Rendement</th></tr></thead>'
            + '<tbody>' + corps + '</tbody></table>';
    }
}

function renderForcages() {
    var conteneur = document.getElementById('liste-forcages');
    if (!conteneur) return;

    if (!forcages.length) {
        conteneur.innerHTML = '<p class="bloc-vide">Aucun forçage. Le calendrier suit le référentiel théorique.</p>';
        return;
    }

    var anneeCourante = aujourdhui().getFullYear();
    var tries = forcages.slice().sort(function(a, b) {
        if (Number(b.annee) !== Number(a.annee)) return Number(b.annee) - Number(a.annee);
        return String(a.espece).localeCompare(String(b.espece));
    });

    conteneur.innerHTML = tries.map(function(forcage) {
        var espece = getEspece(forcage.espece);
        var mode = getModeForcage(forcage.mode);
        var perime = Number(forcage.annee) !== anneeCourante;
        var modifiable = peutModifier(forcage);

        var detail = '';
        if (forcage.mode === 'decalage') {
            detail = (Number(forcage.jours) > 0 ? '+' : '') + forcage.jours + ' jours';
        } else if (forcage.mode === 'fenetre') {
            detail = formatFenetre(forcage.debut, forcage.fin);
        } else {
            detail = 'récolte suspendue';
        }

        return '<article class="carte-etat' + (perime ? ' carte-forcage--perime' : '') + '">'
            + '<div class="carte-entete">'
                + '<div style="flex:1;min-width:0">'
                    + '<div class="carte-titre">' + escapeHtml(espece ? espece.nom : forcage.espece)
                        + (espece ? '' : ' <span class="badge badge-vide">espèce inconnue</span>')
                    + '</div>'
                    + '<div class="carte-meta">'
                        + '<span class="badge badge-mode--' + escapeAttr(forcage.mode) + '">' + escapeHtml(mode.label) + '</span>'
                        + '<span class="badge">' + escapeHtml(detail) + '</span>'
                        + '<span class="badge' + (perime ? ' badge-inactif' : ' badge-saison') + '">saison ' + escapeHtml(String(forcage.annee))
                            + (perime ? ' — sans effet' : '') + '</span>'
                        + '<span class="badge badge-personne">' + escapeHtml(auteurCourt(forcage.creePar)) + '</span>'
                    + '</div>'
                    + (forcage.motif ? '<p class="carte-apercu">' + escapeHtml(forcage.motif) + '</p>' : '')
                + '</div>'
                + '<div class="row-actions-cell">'
                    + (modifiable
                        ? '<button type="button" class="icon-btn" title="Modifier" onclick="ouvrirModale(\'' + jsAttr(forcage.id) + '\')"><i class="fa-solid fa-pen"></i></button>'
                        : '<span class="icon-btn" title="Forçage de quelqu\'un d\'autre"><i class="fa-solid fa-eye"></i></span>')
                + '</div>'
            + '</div>'
            + '</article>';
    }).join('');
}

// ------------------------------------------------------------
// 10. Saisie d'un forçage
// ------------------------------------------------------------
function remplirFormulaire() {
    var selectEspece = document.getElementById('f-espece');
    if (selectEspece) {
        var html = '';
        CATEGORIES.forEach(function(cat) {
            var lot = ESPECES.filter(function(e) { return e.categorie === cat.valeur; });
            if (!lot.length) return;
            html += '<optgroup label="' + escapeAttr(cat.label) + '">'
                + lot.map(function(e) {
                    return '<option value="' + escapeAttr(e.id) + '">' + escapeHtml(e.nom) + '</option>';
                }).join('')
                + '</optgroup>';
        });
        selectEspece.innerHTML = html;
    }

    var selectMode = document.getElementById('f-mode');
    if (selectMode) {
        selectMode.innerHTML = MODES_FORCAGE.map(function(m) {
            return '<option value="' + escapeAttr(m.valeur) + '">' + escapeHtml(m.label) + '</option>';
        }).join('');
    }

    var selectAnnee = document.getElementById('f-annee');
    if (selectAnnee) {
        var courante = aujourdhui().getFullYear();
        var options = '';
        for (var a = courante - 1; a <= courante + 1; a++) {
            options += '<option value="' + a + '"' + (a === courante ? ' selected' : '') + '>' + a + '</option>';
        }
        selectAnnee.innerHTML = options;
    }
}

function majChampsMode() {
    var mode = document.getElementById('f-mode');
    if (!mode) return;
    var valeur = mode.value;

    var bloc = { decalage: 'bloc-decalage', fenetre: 'bloc-fenetre', suspension: null };
    ['bloc-decalage', 'bloc-fenetre'].forEach(function(id) {
        var element = document.getElementById(id);
        if (element) element.style.display = (bloc[valeur] === id) ? 'grid' : 'none';
    });

    var aide = document.getElementById('f-mode-aide');
    if (aide) aide.textContent = getModeForcage(valeur).aide;
}

function ouvrirModale(id, especePreselectionnee) {
    idEnEdition = id || null;
    var forcage = id ? forcages.filter(function(f) { return f.id === id; })[0] : null;

    if (forcage && !peutModifier(forcage)) {
        showToast('Ce forçage a été saisi par ' + auteurCourt(forcage.creePar) + ' : lecture seule.', 'info');
        return;
    }

    document.getElementById('modal-title').textContent = forcage ? 'Modifier le forçage' : 'Forcer une fenêtre';
    document.getElementById('f-espece').value = forcage ? forcage.espece : (especePreselectionnee || ESPECES[0].id);
    document.getElementById('f-annee').value = forcage ? String(forcage.annee) : String(aujourdhui().getFullYear());
    document.getElementById('f-mode').value = forcage ? forcage.mode : 'decalage';
    document.getElementById('f-jours').value = (forcage && forcage.jours != null) ? String(forcage.jours) : '';
    document.getElementById('f-debut').value = (forcage && forcage.debut) ? versInputDate(forcage.debut) : '';
    document.getElementById('f-fin').value = (forcage && forcage.fin) ? versInputDate(forcage.fin) : '';
    document.getElementById('f-motif').value = forcage ? (forcage.motif || '') : '';

    document.getElementById('btn-delete').style.display = forcage ? 'inline-block' : 'none';
    majChampsMode();
    document.getElementById('modal-overlay').style.display = 'flex';
}

function fermerModale() {
    document.getElementById('modal-overlay').style.display = 'none';
    idEnEdition = null;
}

// Les champs de saisie sont des <input type="date"> : pratiques au
// doigt, mais ils portent une année dont on ne veut pas — la récurrence
// est mois/jour. On ne garde que les deux composantes utiles.
function versInputDate(moisJour) {
    var mois = String(moisJour.mois);
    var jour = String(moisJour.jour);
    return '2000-' + (mois.length < 2 ? '0' + mois : mois) + '-' + (jour.length < 2 ? '0' + jour : jour);
}

function depuisInputDate(valeur) {
    if (!valeur) return null;
    var morceaux = String(valeur).split('-');
    if (morceaux.length !== 3) return null;
    var mois = parseInt(morceaux[1], 10);
    var jour = parseInt(morceaux[2], 10);
    if (!(mois >= 1 && mois <= 12) || !(jour >= 1 && jour <= 31)) return null;
    return { mois: mois, jour: jour };
}

// Construit le document à écrire, ou renvoie une erreur lisible. Pure :
// c'est elle que les tests interrogent, sans DOM ni réseau.
function construireForcage(saisie) {
    var espece = getEspece(saisie.espece);
    if (!espece) return { erreur: 'Espèce inconnue.' };

    var annee = parseInt(saisie.annee, 10);
    if (!annee) return { erreur: 'Saison manquante.' };

    var doc = {
        espece: espece.id,
        annee: annee,
        mode: saisie.mode,
        motif: String(saisie.motif || '').trim()
    };

    // Le motif n'est pas décoratif : dans six mois, un décalage de
    // douze jours sans raison écrite est indéfendable — on ne saura
    // plus s'il faut le reconduire ou l'effacer.
    if (!doc.motif) return { erreur: 'Indiquez le motif : dans six mois, un forçage sans raison est inexploitable.' };

    if (saisie.mode === 'decalage') {
        var jours = parseInt(saisie.jours, 10);
        if (isNaN(jours) || jours === 0) return { erreur: 'Indiquez un décalage en jours (négatif si la saison est en avance).' };
        if (Math.abs(jours) > 120) return { erreur: 'Un décalage de plus de 120 jours n\'en est plus un : utilisez « Imposer des dates ».' };
        doc.jours = jours;
    } else if (saisie.mode === 'fenetre') {
        var debut = depuisInputDate(saisie.debut);
        var fin = depuisInputDate(saisie.fin);
        if (!debut || !fin) return { erreur: 'Indiquez les deux dates de la fenêtre imposée.' };
        doc.debut = debut;
        doc.fin = fin;
    } else if (saisie.mode !== 'suspension') {
        return { erreur: 'Mode de forçage inconnu.' };
    }

    return { doc: doc };
}

function sauverForcage() {
    var resultat = construireForcage({
        espece: document.getElementById('f-espece').value,
        annee: document.getElementById('f-annee').value,
        mode: document.getElementById('f-mode').value,
        jours: document.getElementById('f-jours').value,
        debut: document.getElementById('f-debut').value,
        fin: document.getElementById('f-fin').value,
        motif: document.getElementById('f-motif').value
    });

    if (resultat.erreur) {
        showToast(resultat.erreur, 'error');
        return;
    }

    var doc = resultat.doc;
    doc.updatedAt = firebase.firestore.FieldValue.serverTimestamp();

    if (idEnEdition) {
        var existant = forcages.filter(function(f) { return f.id === idEnEdition; })[0];
        if (existant && !peutModifier(existant)) {
            showToast('Ce forçage ne vous appartient pas.', 'error');
            return;
        }
        // `creePar` n'est jamais réécrit : la règle Firestore le compare
        // à l'ancienne valeur, et le changer reviendrait à s'attribuer
        // l'observation de quelqu'un d'autre.
        db.collection('cueillette').doc(idEnEdition).update(doc)
            .then(function() { showToast('Forçage enregistré.', 'success'); fermerModale(); })
            .catch(function(erreur) { showToast('Enregistrement impossible : ' + erreur.message, 'error'); });
    } else {
        doc.creePar = moiReel();
        doc.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        db.collection('cueillette').add(doc)
            .then(function() { showToast('Forçage enregistré.', 'success'); fermerModale(); })
            .catch(function(erreur) { showToast('Enregistrement impossible : ' + erreur.message, 'error'); });
    }
}

function ouvrirModaleSuppression() {
    document.getElementById('delete-overlay').style.display = 'flex';
}

function fermerModaleSuppression() {
    document.getElementById('delete-overlay').style.display = 'none';
}

function confirmerSuppression() {
    if (!idEnEdition) return;
    db.collection('cueillette').doc(idEnEdition).delete()
        .then(function() {
            showToast('Forçage supprimé.', 'success');
            fermerModaleSuppression();
            fermerModale();
        })
        .catch(function(erreur) { showToast('Suppression impossible : ' + erreur.message, 'error'); });
}

// ------------------------------------------------------------
// 11. Export
// ------------------------------------------------------------
// Référentiel ET forçages dans le même fichier : séparés, ils ne
// veulent rien dire — c'est leur combinaison qui produit le calendrier.
function exporterJson() {
    var jour = aujourdhui();
    var contenu = {
        exporteLe: jour.toISOString(),
        perimetre: {
            secteurs: SECTEURS,
            altitudeMin: ALTITUDE_MIN,
            altitudeMax: ALTITUDE_MAX
        },
        especes: ESPECES,
        forcages: forcages.map(function(f) {
            var copie = {};
            for (var cle in f) {
                if (!Object.prototype.hasOwnProperty.call(f, cle)) continue;
                copie[cle] = (cle === 'createdAt' || cle === 'updatedAt')
                    ? (toDate(f[cle]) ? toDate(f[cle]).toISOString() : null)
                    : f[cle];
            }
            return copie;
        }),
        evaluation: evaluerCalendrier(ESPECES, forcages, jour).map(function(e) {
            return {
                espece: e.espece.id,
                statut: e.statut,
                debut: e.occurrence.debut.toISOString().slice(0, 10),
                fin: e.occurrence.fin.toISOString().slice(0, 10),
                joursAvant: e.joursAvant,
                joursRestants: e.joursRestants
            };
        })
    };

    var blob = new Blob([JSON.stringify(contenu, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var lien = document.createElement('a');
    lien.href = url;
    lien.download = 'cueillette-haut-doubs-' + jour.toISOString().slice(0, 10) + '.json';
    document.body.appendChild(lien);
    lien.click();
    document.body.removeChild(lien);
    URL.revokeObjectURL(url);
}
