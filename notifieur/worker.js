// ============================================================
// worker.js — Le notifieur Telegram, réveillé par cron
// ============================================================
// Toutes les 5 minutes : se connecter, lire les tâches, décider,
// envoyer. Ce fichier ne prend AUCUNE décision — il tient les tuyaux.
// Tout ce qui relève du jugement (quoi envoyer, quand) est dans
// notifieur-messages.js, qui est pur et testé.
//
// POURQUOI IL EXISTE. Le hub est un site statique : rien, dans le dépôt,
// ne peut parler quand la page est fermée. Le compteur de retards sur la
// tuile d'accueil ne se voit que si l'on ouvre l'accueil. Une alerte qui
// suppose qu'on aille la chercher n'est pas une alerte.
//
// ------------------------------------------------------------
// CE QU'IL N'A PAS LE DROIT DE FAIRE, ET COMMENT C'EST TENU
// ------------------------------------------------------------
// Il se connecte à Firebase comme un utilisateur ordinaire, avec un
// compte email/mot de passe créé à la main pour lui seul, et il subit
// donc les règles Firestore. La fonction notifieur() de firestore.rules
// ne lui ouvre QUE la lecture de « taches » : aucune autre collection ne
// le nomme, et il n'apparaît dans aucun `allow write`.
//
// L'alternative écartée était une clé de compte de service Google. Elle
// aurait contourné les règles entièrement, et comme les permissions IAM
// de Firestore ne descendent pas au niveau de la collection, elle aurait
// lu « fournisseurs » — donc des mots de passe en clair — pour envoyer un
// message Telegram. Le jeu n'en valait pas la chandelle.
//
// ------------------------------------------------------------
// SECRETS ATTENDUS (wrangler secret put <NOM>)
// ------------------------------------------------------------
//   FIREBASE_API_KEY    la clé web du projet (publique, mais rangée ici)
//   FIREBASE_PROJECT_ID « ofildudoubs-hub »
//   NOTIFIEUR_EMAIL     l'adresse du compte robot (= NOTIFIEUR_EMAIL de config.js)
//   NOTIFIEUR_MDP       son mot de passe — le seul vrai secret du lot
//   TELEGRAM_TOKEN      le jeton du bot, donné par @BotFather
//   TELEGRAM_CHAT_ID    la conversation où écrire
// Et un binding KV : ENVOIS. Voir README.md du dossier.
// ============================================================

import messages from './notifieur-messages.js';
import sejoursGite from './notifieur-sejours.js';

// Le calendrier du gîte de Labergement. Deux endpoints publics du même
// Worker : `/ical` fusionne les calendriers Airbnb et Booking, `/` porte
// l'état du ménage — d'où viennent le nombre de personnes et la langue.
//
// C'est la seule source EXTERNE au hub que le notifieur consulte. Elle
// est donc traitée comme telle : son indisponibilité ne doit jamais
// faire tomber le reste.
const GITE_API = 'https://menage-state.cyril-samson41.workers.dev';

// Le fuseau du planning. Les tâches portent des heures locales
// (« 09:00 »), un Worker tourne en UTC : sans cette conversion, le
// digest du matin partirait une heure trop tôt l'été, et la date du
// jour serait fausse tous les soirs après 22 h.
const FUSEAU = 'Europe/Paris';

// La déduplication vit ici, et pas dans la logique pure : elle demande
// de la mémoire. Deux jours suffisent — passé ce délai, plus rien ne
// peut redéclencher un message dont la fenêtre est fermée depuis
// longtemps, et laisser traîner les clés ne servirait qu'à remplir le KV.
const RETENTION_SECONDES = 2 * 24 * 3600;

export default {
    async scheduled(evenement, env, contexte) {
        contexte.waitUntil(tourDeGarde(env));
    },

    // Même travail, déclenché à la main. Sert à vérifier un déploiement
    // sans attendre le prochain cron, et à diagnostiquer : la réponse dit
    // ce qui a été trouvé, décidé et envoyé.
    //
    // ⚠ Protégé par le jeton Telegram, qui n'est connu que de toi et de
    // Cloudflare. L'URL d'un Worker est devinable ; sans ce garde-fou,
    // n'importe qui pourrait déclencher tes notifications en boucle.
    async fetch(requete, env) {
        const url = new URL(requete.url);
        if (url.searchParams.get('cle') !== env.TELEGRAM_TOKEN) {
            return new Response('Non.', { status: 403 });
        }
        const bilan = await tourDeGarde(env, url.searchParams.get('blanc') === '1');
        return new Response(JSON.stringify(bilan, null, 2), {
            headers: { 'content-type': 'application/json; charset=utf-8' }
        });
    }
};

// ------------------------------------------------------------
// 1. Le tour de garde
// ------------------------------------------------------------
// `aBlanc` calcule et rend le bilan SANS rien envoyer ni marquer comme
// envoyé. C'est ce qui permet d'essayer un réglage à 15 h sans polluer la
// conversation, et sans consommer les clés de déduplication du jour.
async function tourDeGarde(env, aBlanc = false) {
    const bilan = { instant: new Date().toISOString(), aBlanc, erreur: null };

    try {
        const maintenant = instantParisien();
        bilan.jour = maintenant.jour;
        bilan.heure = maintenant.heure;

        // ⚠ ON NE LIT PAS TOUT, ET SURTOUT PAS TOUT LE TEMPS.
        //
        // Le plan Spark offre 50 000 lectures Firestore par jour. Lire la
        // base entière à chacun des 288 réveils ferait dépendre le plafond
        // du nombre TOTAL de tâches — et les tâches faites s'accumulent
        // pour toujours. Le notifieur se serait taire un après-midi, deux
        // ans plus tard, sans que rien ne l'annonce.
        //
        // Presque tous les tours n'ont qu'un travail : trouver les
        // créneaux qui commencent dans le quart d'heure. Aujourd'hui et
        // demain suffisent. Seuls les deux RÉSUMÉS — le digest du matin et
        // le bilan du soir — ont besoin de la liste complète, deux fois
        // par jour. D'où la question posée au KV AVANT d'interroger
        // Firestore : si le résumé du moment est déjà parti, la lecture
        // complète n'a pas lieu du tout.
        //
        // Le bilan du soir en a besoin autant que le digest : les
        // échéances qui basculent cette nuit n'ont pas de créneau, elles
        // seraient invisibles dans la lecture courte.
        const resumeDu = messages.dansLaFenetreDuDigest(maintenant.heure)
            ? messages.cleDigest(maintenant.jour)
            : (messages.dansLaFenetreDuBilan(maintenant.heure)
                ? messages.cleBilan(maintenant.jour)
                : null);
        const listeComplete = resumeDu !== null && !(await dejaEnvoye(env, resumeDu));
        bilan.lecture = listeComplete ? 'complete' : 'creneaux';

        const jeton = await connexionFirebase(env);
        const taches = listeComplete
            ? await lireTachesOuvertes(env, jeton)
            : await lireCreneauxProches(env, jeton, maintenant.jour);
        bilan.tachesLues = taches.length;

        // Le gîte entre dans LES DEUX résumés : annoncé le matin,
        // re-demandé le soir (« le message est-il parti ? »). C'est la
        // seule répétition assumée du notifieur — voir lignesSejour dans
        // notifieur-messages.js pour la raison.
        let sejours = [];
        let etatGite = null;
        if (listeComplete) {
            try {
                const gite = await lireGite();
                sejours = gite.sejours;
                etatGite = gite.etat;
                bilan.sejoursLus = sejours.length;
            } catch (erreur) {
                // ⚠ NE JAMAIS FAIRE TOMBER LE DIGEST POUR ÇA. Le calendrier
                // du gîte est une source externe : si elle est en panne, les
                // tâches n'ont pas à en souffrir. La section disparaît, le
                // reste du digest part quand même, et le bilan le dit.
                bilan.giteIndisponible = String((erreur && erreur.message) || erreur);
                console.warn('Calendrier du gîte indisponible :', bilan.giteIndisponible);
            }
        }

        // Les résumés sont refusés explicitement quand la liste est
        // tronquée : les calculer sur les seuls créneaux du jour
        // annoncerait « 0 en retard » avec aplomb.
        const dus = messages.messagesDus(
            taches, maintenant.jour, maintenant.heure, listeComplete, sejours, etatGite);
        bilan.dus = dus.map((m) => m.cle);

        const aEnvoyer = [];
        for (const message of dus) {
            if (await dejaEnvoye(env, message.cle)) continue;
            aEnvoyer.push(message);
        }
        bilan.aEnvoyer = aEnvoyer.map((m) => m.cle);

        if (aBlanc) {
            bilan.apercu = aEnvoyer.map((m) => m.texte);
            return bilan;
        }

        bilan.envoyes = [];
        for (const message of aEnvoyer) {
            await envoyerTelegram(env, message.texte);
            // Marqué APRÈS l'envoi, jamais avant : si Telegram échoue, le
            // prochain tour réessaiera. Une clé posée d'avance ferait
            // disparaître le message pour de bon, sans un mot.
            await marquerEnvoye(env, message.cle);
            bilan.envoyes.push(message.cle);
        }
    } catch (erreur) {
        bilan.erreur = String((erreur && erreur.message) || erreur);
        console.error('Tour de garde interrompu :', bilan.erreur);
        // Une panne muette serait le pire résultat possible pour un
        // notifieur. On tente de la dire dans la conversation elle-même ;
        // si même ça échoue, il reste les logs Cloudflare.
        if (!aBlanc) await signalerPanne(env, bilan.erreur, maintenantParisien());
    }

    return bilan;
}

// L'heure au moment de la panne. Recalculee plutot que reprise du `try` :
// si c'est le tout debut du tour qui a echoue, la variable n'existe pas.
function maintenantParisien() {
    try {
        const instant = instantParisien();
        return instant.jour + 'T' + instant.heure.slice(0, 2);
    } catch (ignore) {
        return 'inconnu';
    }
}

// ------------------------------------------------------------
// 2. L'heure de Paris
// ------------------------------------------------------------
// `Intl` connaît les changements d'heure, une soustraction fixe non.
// Le format « en-CA » rend directement AAAA-MM-JJ, ce qui évite de
// recoller des morceaux à la main.
function instantParisien(date = new Date()) {
    const jour = new Intl.DateTimeFormat('en-CA', {
        timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(date);

    const heure = new Intl.DateTimeFormat('en-GB', {
        timeZone: FUSEAU, hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date);

    return { jour, heure };
}

// ------------------------------------------------------------
// 3. Firebase : se connecter comme un utilisateur
// ------------------------------------------------------------
// Pas de clé de service, pas de JWT à signer : le même point d'entrée
// que le bouton « se connecter » d'un navigateur. Le jeton rendu vaut
// une heure — largement plus que la durée d'un tour de garde, donc rien
// à mettre en cache.
async function connexionFirebase(env) {
    const reponse = await fetch(
        'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='
            + encodeURIComponent(env.FIREBASE_API_KEY),
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                email: env.NOTIFIEUR_EMAIL,
                password: env.NOTIFIEUR_MDP,
                returnSecureToken: true
            })
        }
    );

    const corps = await reponse.json();
    if (!reponse.ok || !corps.idToken) {
        throw new Error('Connexion Firebase refusée : '
            + ((corps.error && corps.error.message) || reponse.status));
    }
    return corps.idToken;
}

// ------------------------------------------------------------
// 4. Firestore : lire les tâches
// ------------------------------------------------------------
// Le `where` du notifieur ne sert PAS à la sécurité, contrairement à
// celui de la page. La règle de la page exige `creePar == idAppelant()`,
// ce qui force le client à filtrer ou à se voir tout refuser ; la clause
// du notifieur ne regarde pas le document, donc n'importe quelle forme
// de requête passe. Ici, filtrer sert à ne pas gaspiller le quota.
//
// ⚠ CHAQUE REQUÊTE NE PORTE QUE SUR UN SEUL CHAMP. C'est délibéré :
// dès qu'on mélange une égalité et une plage sur deux champs
// différents, Firestore réclame un index composite — donc une étape
// manuelle de plus dans la console, et une panne le jour où on l'oublie.

// Pour le digest : tout ce qui est encore ouvert. Les tâches faites
// n'ont plus rien à raconter, et elles seront un jour la majorité.
async function lireTachesOuvertes(env, jeton) {
    return interroger(env, jeton, {
        where: {
            fieldFilter: {
                field: { fieldPath: 'faite' },
                op: 'EQUAL',
                value: { booleanValue: false }
            }
        }
    });
}

// Pour les rappels : les créneaux d'aujourd'hui et de demain, rien de
// plus. Le rappel n'anticipe que de 15 minutes — au plus loin, ce soir à
// 23:50 pour un créneau demain à 00:05. Jamais au-delà.
//
// Deux bornes sur le MÊME champ : c'est une plage simple, pas un index
// composite. Les tâches sans créneau portent une chaîne vide, qui tombe
// sous la borne basse et sort d'elle-même.
//
// `faite` n'entre pas dans la requête et se filtre ici : l'y ajouter
// réclamerait justement l'index qu'on évite, pour écarter une poignée de
// documents.
async function lireCreneauxProches(env, jeton, ajd) {
    const demain = jourSuivant(ajd);
    const lignes = await interroger(env, jeton, {
        where: {
            compositeFilter: {
                op: 'AND',
                filters: [
                    { fieldFilter: { field: { fieldPath: 'creneauJour' },
                        op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: ajd } } },
                    { fieldFilter: { field: { fieldPath: 'creneauJour' },
                        op: 'LESS_THAN_OR_EQUAL', value: { stringValue: demain } } }
                ]
            }
        },
        orderBy: [{ field: { fieldPath: 'creneauJour' }, direction: 'ASCENDING' }]
    });
    return lignes.filter((tache) => !tache.faite);
}

// Arithmétique de dates en UTC, comme partout ailleurs dans ce projet :
// une soustraction locale rend 23 ou 25 heures deux fois par an.
function jourSuivant(iso) {
    const bouts = String(iso).split('-');
    const lendemain = new Date(Date.UTC(
        Number(bouts[0]), Number(bouts[1]) - 1, Number(bouts[2]) + 1));
    return lendemain.toISOString().slice(0, 10);
}

async function interroger(env, jeton, complements) {
    const url = 'https://firestore.googleapis.com/v1/projects/'
        + encodeURIComponent(env.FIREBASE_PROJECT_ID)
        + '/databases/(default)/documents:runQuery';

    const reponse = await fetch(url, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: 'Bearer ' + jeton
        },
        body: JSON.stringify({
            structuredQuery: Object.assign(
                { from: [{ collectionId: 'taches' }] },
                complements
            )
        })
    });

    if (!reponse.ok) {
        throw new Error('Lecture Firestore refusée (' + reponse.status + ') : '
            + (await reponse.text()).slice(0, 300));
    }

    const lignes = await reponse.json();
    return (lignes || [])
        .filter((ligne) => ligne && ligne.document)
        .map((ligne) => decoderDocument(ligne.document));
}

// L'API REST rend des valeurs typées — { stringValue: "..." } — là où le
// SDK du navigateur rend des valeurs nues. Sans cette traduction, chaque
// `tache.titre` serait un objet et tous les tests de la logique pure
// passeraient pendant que le Worker enverrait des messages vides.
function decoderDocument(document) {
    const tache = { id: (document.name || '').split('/').pop() };
    const champs = document.fields || {};

    for (const cle of Object.keys(champs)) {
        tache[cle] = decoderValeur(champs[cle]);
    }
    return tache;
}

function decoderValeur(valeur) {
    if (!valeur || typeof valeur !== 'object') return null;
    if ('stringValue' in valeur) return valeur.stringValue;
    if ('booleanValue' in valeur) return valeur.booleanValue;
    // Firestore rend les entiers en CHAÎNE pour ne pas perdre de
    // précision au-delà de 2^53. `creneauDuree` arriverait donc en "60",
    // et « 60 min » deviendrait de l'arithmétique de texte.
    if ('integerValue' in valeur) return Number(valeur.integerValue);
    if ('doubleValue' in valeur) return valeur.doubleValue;
    if ('timestampValue' in valeur) return valeur.timestampValue;
    if ('nullValue' in valeur) return null;
    if ('arrayValue' in valeur) {
        return ((valeur.arrayValue && valeur.arrayValue.values) || []).map(decoderValeur);
    }
    if ('mapValue' in valeur) {
        const objet = {};
        const champs = (valeur.mapValue && valeur.mapValue.fields) || {};
        for (const cle of Object.keys(champs)) objet[cle] = decoderValeur(champs[cle]);
        return objet;
    }
    return null;
}

// ------------------------------------------------------------
// 4 bis. Le calendrier du gîte
// ------------------------------------------------------------
// Aucune authentification : les deux endpoints sont publics. Le CORS du
// Worker ménage est restreint à ofildudoubs.fr, ce qui ne gêne pas un
// appel serveur — CORS ne contraint que les navigateurs.
async function lireGite() {
    const [fluxIcal, etatBrut] = await Promise.all([
        fetch(GITE_API + '/ical'),
        fetch(GITE_API + '/')
    ]);

    // Le flux iCal est indispensable : sans lui, pas de séjours du tout.
    if (!fluxIcal.ok) {
        throw new Error('flux iCal du gîte indisponible (' + fluxIcal.status + ')');
    }
    const sejours = sejoursGite.analyserIcal(await fluxIcal.text());

    // L'état, lui, ne porte que des précisions de confort — le nombre de
    // personnes et la langue. Son absence ne doit pas priver du rappel
    // lui-même : on rend null et les lignes de détail disparaissent.
    let etat = null;
    if (etatBrut.ok) {
        try {
            etat = await etatBrut.json();
        } catch (ignore) {
            etat = null;
        }
    }

    return { sejours, etat };
}

// ------------------------------------------------------------
// 5. Mémoire des envois
// ------------------------------------------------------------
async function dejaEnvoye(env, cle) {
    return (await env.ENVOIS.get(cle)) !== null;
}

async function marquerEnvoye(env, cle) {
    await env.ENVOIS.put(cle, new Date().toISOString(), {
        expirationTtl: RETENTION_SECONDES
    });
}

// ------------------------------------------------------------
// 6. Telegram
// ------------------------------------------------------------
async function envoyerTelegram(env, texte) {
    const reponse = await fetch(
        'https://api.telegram.org/bot' + env.TELEGRAM_TOKEN + '/sendMessage',
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                chat_id: env.TELEGRAM_CHAT_ID,
                text: texte,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            })
        }
    );

    if (!reponse.ok) {
        throw new Error('Telegram a refusé (' + reponse.status + ') : '
            + (await reponse.text()).slice(0, 300));
    }
}

// Message de panne : volontairement en texte brut, sans parse_mode. Si
// l'erreur vient justement d'un HTML mal formé, l'annoncer en HTML
// échouerait à son tour et la panne resterait muette.
//
// ⚠ UNE FOIS PAR HEURE AU PLUS. Le cron se réveille toutes les 5 minutes :
// une panne durable — Firebase injoignable, mot de passe changé — enverrait
// 288 messages par jour. On se ferait taire le bot, et le prochain vrai
// rappel se perdrait dans le tas. Une alerte qu'on apprend à ignorer ne
// vaut pas mieux que pas d'alerte.
async function signalerPanne(env, texte, heure) {
    const cle = 'panne:' + heure;
    try {
        if (env.ENVOIS && (await env.ENVOIS.get(cle)) !== null) return;
    } catch (ignore) {
        // KV injoignable : on préfère un message de trop à aucun.
    }

    try {
        await fetch('https://api.telegram.org/bot' + env.TELEGRAM_TOKEN + '/sendMessage', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                chat_id: env.TELEGRAM_CHAT_ID,
                text: '⚠️ Notifieur en panne : ' + texte
            })
        });
        if (env.ENVOIS) {
            await env.ENVOIS.put(cle, texte.slice(0, 200), { expirationTtl: 3600 });
        }
    } catch (ignore) {
        // Rien de plus à tenter : il reste les logs Cloudflare.
    }
}
