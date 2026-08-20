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

        const jeton = await connexionFirebase(env);
        const taches = await lireTaches(env, jeton);
        bilan.tachesLues = taches.length;

        const dus = messages.messagesDus(taches, maintenant.jour, maintenant.heure);
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
// AUCUN `where` ici, contrairement à la page — et ce n'est pas un oubli.
// La règle de la page exige `creePar == idAppelant()`, ce qui force le
// client à filtrer ; la clause du notifieur, elle, ne regarde pas le
// document, donc la requête complète passe. C'est la seule identité du
// hub dans ce cas, et c'est justement parce qu'elle n'est personne.
async function lireTaches(env, jeton) {
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
            structuredQuery: { from: [{ collectionId: 'taches' }] }
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
