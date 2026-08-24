// ============================================================
// notifieur-sejours.js — Lire le calendrier du gîte
// ============================================================
// Le flux iCal de `menage-state.cyril-samson41.workers.dev/ical`
// fusionne les calendriers Airbnb et Booking du gîte de Labergement.
// Ce fichier le lit et en tire les séjours ; il ne décide de rien
// d'autre, et ne touche ni au réseau ni à l'horloge.
//
// À QUOI ÇA SERT : prévenir la veille d'une arrivée qu'il faut écrire le
// message d'accueil, et la veille d'un départ qu'il faut écrire le
// message de sortie. Aucune plateforme ne le fait à la place de
// l'hôte, et c'est typiquement ce qu'on oublie.
//
// ------------------------------------------------------------
// TROIS SORTES D'ÉVÉNEMENTS, ET IL A FALLU LES DONNÉES POUR LE VOIR
// ------------------------------------------------------------
//   SUMMARY:Reserved              @airbnb.com   → réservation Airbnb,
//       avec l'URL de la réservation en DESCRIPTION ;
//   SUMMARY:Airbnb (Not available) @airbnb.com  → dates bloquées sur
//       Airbnb. Le flux ne dit pas pourquoi — mais l'hôte bloque en
//       général pour des clients qui viennent EN DIRECT. Ce sont donc
//       de vraies arrivées, et ce sont même celles qu'il ne faut
//       surtout pas manquer : aucune plateforme ne relancera pour lui ;
//   SUMMARY:CLOSED - Not available @booking.com → indiscernable. Booking
//       n'exporte rien qui distingue un séjour d'un inventaire fermé.
//
// ⚠ LES DEUX CALENDRIERS SONT INDÉPENDANTS. Vérifié sur les données :
// aucune date réservée côté Booking n'apparaît en blocage côté Airbnb.
// Il n'y a donc pas de doublon à dédupliquer — mais si un jour le
// cross-blocking était activé entre les deux plateformes, chaque séjour
// apparaîtrait DEUX fois et il faudrait fusionner les chevauchements.
//
// ------------------------------------------------------------
// LES DATES SONT DÉJÀ CELLES QU'ON VEUT
// ------------------------------------------------------------
// En iCal, un DTEND en VALUE=DATE est théoriquement exclusif. Airbnb,
// lui, y met la date de départ réelle : DTSTART 20260828 / DTEND
// 20260830 se lit « du 28 au 30 », et c'est bien ce que l'hôte voit.
// Deux sources le confirment — l'affichage du site ménage, et la liste
// `_futureCheckouts` de l'état, qui contient le 30. On prend donc les
// dates telles quelles, sans décalage.
// ============================================================

var calcul = require('../taches/taches-calcul.js');

// ------------------------------------------------------------
// 1. Lire le format iCal
// ------------------------------------------------------------
// Une ligne iCal se replie au-delà de 75 octets : la suite commence par
// une espace ou une tabulation. Sans dépliage, l'URL de réservation
// arriverait coupée en deux et le lien serait mort — c'est justement le
// cas dans ce flux, où DESCRIPTION est toujours repliée.
function deplier(texte) {
    return String(texte || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n[ \t]/g, '');
}

// Les valeurs iCal échappent virgules, points-virgules et sauts de ligne.
function desechapper(valeur) {
    return String(valeur || '')
        .replace(/\\n/gi, '\n')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(/\\\\/g, '\\');
}

// 'DTSTART;VALUE=DATE:20260828' → '2026-08-28'. Rend '' si la ligne ne
// porte pas une date pleine : un séjour sans date n'est pas un séjour,
// et vaut mieux ignoré qu'inventé.
function dateIcal(valeur) {
    var brute = String(valeur || '').trim();
    var jour = /^(\d{4})(\d{2})(\d{2})/.exec(brute);
    if (!jour) return '';
    var iso = jour[1] + '-' + jour[2] + '-' + jour[3];
    return calcul.isoValide(iso) ? iso : '';
}

// ------------------------------------------------------------
// 2. D'où vient le séjour
// ------------------------------------------------------------
// La plateforme ne se lit PAS dans un libellé : elle se lit dans le
// domaine de l'UID. C'est le seul champ que les deux plateformes
// remplissent de façon fiable.
function plateformeDe(uid, resume) {
    var domaine = String(uid || '').split('@')[1] || '';
    if (domaine.indexOf('booking') !== -1) return 'booking';
    if (domaine.indexOf('airbnb') !== -1) {
        // Sur Airbnb, seul « Reserved » est une réservation de la
        // plateforme. Tout autre libellé est un blocage — et un blocage,
        // chez cet hôte, veut généralement dire des clients en direct.
        return String(resume || '').trim() === 'Reserved' ? 'airbnb' : 'direct';
    }
    return 'inconnu';
}

var LIBELLES_PLATEFORME = {
    airbnb: 'Airbnb',
    booking: 'Booking',
    direct: 'en direct',
    inconnu: 'origine inconnue'
};

function libellePlateforme(plateforme) {
    return LIBELLES_PLATEFORME[plateforme] || LIBELLES_PLATEFORME.inconnu;
}

// L'URL de la réservation, quand la plateforme la donne — Airbnb la met
// dans DESCRIPTION. Elle vaut de l'or dans un message : un lien à
// toucher plutôt qu'une réservation à retrouver à la main.
function lienDeReservation(description) {
    var trouve = /(https?:\/\/\S+)/.exec(String(description || ''));
    return trouve ? trouve[1] : '';
}

// ------------------------------------------------------------
// 3. L'analyseur
// ------------------------------------------------------------
// Rend [{ debut, fin, plateforme, lien, resume }], les séjours sans
// dates exploitables écartés.
function analyserIcal(texte) {
    var lignes = deplier(texte).split('\n');
    var sejours = [];
    var courant = null;

    lignes.forEach(function(ligne) {
        if (ligne.indexOf('BEGIN:VEVENT') === 0) {
            courant = { debut: '', fin: '', uid: '', resume: '', description: '' };
            return;
        }
        if (ligne.indexOf('END:VEVENT') === 0) {
            if (courant && courant.debut && courant.fin) {
                sejours.push({
                    debut: courant.debut,
                    fin: courant.fin,
                    resume: courant.resume,
                    plateforme: plateformeDe(courant.uid, courant.resume),
                    lien: lienDeReservation(courant.description)
                });
            }
            courant = null;
            return;
        }
        if (!courant) return;

        // Le nom d'une propriété peut porter des paramètres après un
        // point-virgule : DTSTART;VALUE=DATE:20260828.
        var separateur = ligne.indexOf(':');
        if (separateur === -1) return;
        var nom = ligne.slice(0, separateur).split(';')[0].toUpperCase();
        var valeur = ligne.slice(separateur + 1);

        if (nom === 'DTSTART') courant.debut = dateIcal(valeur);
        else if (nom === 'DTEND') courant.fin = dateIcal(valeur);
        else if (nom === 'UID') courant.uid = valeur.trim();
        else if (nom === 'SUMMARY') courant.resume = desechapper(valeur).trim();
        else if (nom === 'DESCRIPTION') courant.description = desechapper(valeur);
    });

    return sejours;
}

// ------------------------------------------------------------
// 4. Ce qu'il faut annoncer demain
// ------------------------------------------------------------
// Un seul jour d'avance, et le même des deux côtés : on prévient la
// veille de l'arrivée pour le message d'accueil, la veille du départ
// pour le message de sortie. Prévenir le jour même serait trop tard —
// les gens sont déjà en route.
function sejoursAAnnoncer(sejours, ajd) {
    var demain = calcul.ajouterJours(ajd, 1);
    var parDate = function(a, b) { return a.debut < b.debut ? -1 : 1; };

    return {
        arrivees: (sejours || []).filter(function(s) { return s.debut === demain; }).sort(parDate),
        departs: (sejours || []).filter(function(s) { return s.fin === demain; }).sort(parDate)
    };
}

// ------------------------------------------------------------
// 5. Les détails de l'état ménage
// ------------------------------------------------------------
// L'endpoint d'état porte, sous `info_<date d'arrivée>`, le nombre de
// personnes et la LANGUE. Les deux comptent pour écrire le message :
// on n'accueille pas trois Allemands comme un couple de Français.
//
// Absent : on n'invente rien, la ligne de détail disparaît simplement.
function detailsArrivee(etat, dateArrivee) {
    var info = etat && etat['info_' + dateArrivee];
    if (!info) return null;
    return {
        personnes: Number(info.nbPersons) || 0,
        langue: String(info.lang || '').toLowerCase(),
        commentaire: String(info.comment || '').trim()
    };
}

var LANGUES = { fr: 'en français', de: 'en allemand', en: 'en anglais',
                es: 'en espagnol', it: 'en italien', nl: 'en néerlandais',
                pt: 'en portugais' };

function libelleLangue(code) {
    return LANGUES[code] || '';
}

module.exports = {
    deplier: deplier,
    desechapper: desechapper,
    dateIcal: dateIcal,
    plateformeDe: plateformeDe,
    libellePlateforme: libellePlateforme,
    lienDeReservation: lienDeReservation,
    analyserIcal: analyserIcal,
    sejoursAAnnoncer: sejoursAAnnoncer,
    detailsArrivee: detailsArrivee,
    libelleLangue: libelleLangue
};
