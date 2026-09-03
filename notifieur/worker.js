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
//   TELEGRAM_TOKEN      le bot O'Fil du Doubs — canal GÎTE, partagé
//   TELEGRAM_CHAT_ID    ses destinataires, séparés par des virgules
//   TELEGRAM_TOKEN_TACHES   le bot personnel — canal TÂCHES
//   TELEGRAM_CHAT_ID_TACHES ses destinataires, séparés par des virgules
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
        // ⚠ SIMULATION D'UNE AUTRE DATE. `?jour=2026-09-02&heure=07:30`
        // rejoue le tour de garde comme si on y était. Les messages
        // partent POUR DE VRAI — c'est tout l'intérêt, on veut les voir
        // arriver — mais la mémoire des envois n'est ni consultée ni
        // écrite : le vrai message du jour simulé partira quand même à
        // son heure. Sans cette précaution, tester le 2 septembre
        // supprimerait le rappel du 2 septembre.
        const jourSimule = url.searchParams.get('jour');
        const simule = jourSimule
            ? { jour: jourSimule, heure: url.searchParams.get('heure') || '07:30' }
            : null;

        const bilan = await tourDeGarde(env, url.searchParams.get('blanc') === '1', simule);
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
async function tourDeGarde(env, aBlanc = false, simule = null) {
    const bilan = {
        instant: new Date().toISOString(),
        aBlanc,
        simule: simule ? simule.jour + ' ' + simule.heure : null,
        erreur: null
    };

    try {
        const maintenant = simule || instantParisien();

        // En simulation, la mémoire est ignorée dans les deux sens : on
        // ne saute rien parce que « c'est déjà parti », et on ne marque
        // rien comme parti. Le vrai rappel du jour simulé tombera donc
        // quand même à son heure.
        const restantsPour = (cle, destinataires) => simule
            ? Promise.resolve(destinataires)
            : resteAServir(env, cle, destinataires);
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
        const listeComplete = resumeDu !== null
            && (await resteAServir(env, resumeDu, destinatairesDu(env, 'taches'))).length > 0;
        bilan.lecture = listeComplete ? 'complete' : 'creneaux';

        const jeton = await connexionFirebase(env);
        const taches = listeComplete
            ? await lireTachesOuvertes(env, jeton)
            : await lireCreneauxProches(env, jeton, maintenant.jour);
        bilan.tachesLues = taches.length;

        // ⚠ LE GÎTE A SES PROPRES FENÊTRES — 11 h, 12 h, 17 h, 18 h — et
        // ne suit plus celles des résumés personnels. Deux publics, deux
        // rythmes : 07:30 est trop tôt pour agir, 20:00 trop tard.
        //
        // La clé de déduplication porte la fenêtre et le jour, pas le
        // séjour : elle est donc calculable SANS avoir lu le calendrier.
        // C'est ce qui permet d'interroger la mémoire d'abord, et de
        // n'aller chercher le calendrier que s'il reste quelque chose à
        // dire — la plupart des 288 tours n'ont rien à voir avec le gîte.
        const fenetreGite = sejoursGite.fenetreGite(maintenant.heure);
        const giteADire = !!fenetreGite && (await restantsPour(
            sejoursGite.cleGite(maintenant.jour, fenetreGite),
            destinatairesDu(env, 'gite'))).length > 0;
        bilan.fenetreGite = fenetreGite || null;

        // ⚠ `null` ET `[]` NE VEULENT PAS DIRE LA MÊME CHOSE. Un tableau
        // vide dit « rien à annoncer » ; `null` dit « je n'ai pas pu
        // lire ». Les confondre a coûté un message d'accueil le 31 août
        // 2026 : la section disparaissait en silence.
        let sejours = giteADire ? null : [];
        let etatGite = null;
        if (giteADire) {
            try {
                const gite = await lireGite(env);
                bilan.giteVia = env.GITE ? 'liaison de service' : 'URL publique';
                sejours = gite.sejours;
                etatGite = gite.etat;
                bilan.sejoursLus = sejours.length;
            } catch (erreur) {
                // Le digest part quand même — le gîte est une source
                // externe, sa panne ne doit pas priver des tâches. Mais
                // il part en le DISANT : `sejours` reste à null, et la
                // section devient un avertissement.
                bilan.giteIndisponible = String((erreur && erreur.message) || erreur);
                console.warn('Calendrier du gîte indisponible :', bilan.giteIndisponible);
            }
        }

        // Les résumés sont refusés explicitement quand la liste est
        // tronquée : les calculer sur les seuls créneaux du jour
        // annoncerait « 0 en retard » avec aplomb.
        const dus = messages.messagesDus(
            taches, maintenant.jour, maintenant.heure, listeComplete, sejours, etatGite);
        bilan.dus = dus.map((m) => m.canal + ' → ' + m.cle);

        // ⚠ LA MÉMOIRE EST PAR DESTINATAIRE, PAS PAR MESSAGE.
        //
        // Un chat en panne ne doit pas faire renvoyer le message à ceux
        // qui l'ont déjà reçu. C'est le doublon du 3 septembre 2026 : un
        // 504 de Telegram sur le groupe du gîte a fait repartir le rappel
        // de 11 h à 11 h 05, à tout le monde.
        const aEnvoyer = [];
        for (const message of dus) {
            const tous = destinatairesDu(env, message.canal);
            // Un canal sans destinataire est une panne de configuration,
            // pas un message « déjà parti » : le dire, ne pas l'avaler.
            if (!tous.length) throw new Error('aucun destinataire pour le canal ' + message.canal);

            const restants = await restantsPour(message.cle, tous);
            if (!restants.length) continue;
            aEnvoyer.push({ ...message, tous, restants });
        }
        bilan.aEnvoyer = aEnvoyer.map((m) => m.canal + ' → ' + m.cle
            + ' (' + m.restants.length + '/' + m.tous.length + ')');

        if (aBlanc) {
            bilan.apercu = aEnvoyer.map((m) => m.texte);
            return bilan;
        }

        bilan.envoyes = [];
        bilan.incertains = [];
        bilan.refuses = [];
        for (const message of aEnvoyer) {
            // Un message simulé se signale comme tel. Sans ça, un test du
            // 2 septembre lancé le 1er ressemblerait au vrai rappel, et
            // quelqu'un finirait par agir dessus — ou pire, par ignorer
            // le vrai le lendemain en croyant l'avoir déjà lu.
            const texte = simule
                ? '🧪 <i>Simulation du ' + simule.jour + ' à ' + simule.heure + '</i>\n\n' + message.texte
                : message.texte;

            const envoi = await envoyerTelegram(env, texte, message.canal, message.restants);

            // Marqué APRÈS l'envoi, jamais avant, et seulement pour ceux
            // qui l'ont reçu : un refus franc garde sa chance au tour
            // suivant, sans priver les autres ni les servir deux fois.
            const servis = message.tous.filter((d) =>
                message.restants.indexOf(d) === -1 || envoi.servis.indexOf(d) !== -1);
            if (!simule && servis.length) await marquerEnvoye(env, message.cle, servis);

            if (envoi.servis.length) bilan.envoyes.push(message.canal + ' → ' + message.cle);
            for (const detail of envoi.incertains) bilan.incertains.push(message.cle + ' · ' + detail);
            for (const detail of envoi.refuses) bilan.refuses.push(message.cle + ' · ' + detail);

            // ⚠ LES JOURNAUX D'ABORD, TELEGRAM ENSUITE. L'alerte qui suit
            // passe par le meme service que celui qui vient de trembler :
            // elle peut se perdre, et c'est exactement ce qui est arrive
            // le 3 septembre 2026. Une ligne de journal, elle, reste.
            if (envoi.incertains.length) console.warn('Envoi incertain', message.cle, envoi.incertains);
            if (envoi.refuses.length) console.error('Envoi refuse', message.cle, envoi.refuses);

            // ⚠ LA PERTE ANNONCÉE. Un 5xx dit que la passerelle a lâché
            // sur la RÉPONSE, presque jamais que le message n'est pas
            // parti. On le compte donc comme reçu — sinon le tour suivant
            // le renvoie à coup sûr — mais jamais en silence : le doute
            // se lit et se vérifie, un doublon n'apprend rien à personne.
            if (!simule && envoi.incertains.length) {
                await alerterTechnique(env,
                    'Envoi incertain (' + message.cle + '). Compté comme reçu, à vérifier :\n'
                        + envoi.incertains.join('\n'),
                    'incertain:' + message.cle, RETENTION_SECONDES);
            }

            // Un refus franc, lui, est une panne de configuration —
            // mauvais chat_id, bot bloqué, HTML mal formé. Il se répétera
            // à chaque tour de la fenêtre puis disparaîtra avec elle : le
            // dire est la seule façon qu'il ne passe pas inaperçu.
            if (!simule && envoi.refuses.length) {
                await alerterTechnique(env,
                    'Telegram a refusé (' + message.cle + ') :\n' + envoi.refuses.join('\n'),
                    'refus:' + maintenantParisien(), 3600);
            }
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
//
// ⚠ ON PASSE PAR LA LIAISON DE SERVICE, PAS PAR L'URL PUBLIQUE.
//
// Les deux Workers vivent sur le même sous-domaine workers.dev. Un
// `fetch()` vers l'URL publique du voisin ne sort pas sur Internet : il
// reste dans le réseau interne de Cloudflare, où ce nom ne se résout
// pas, et rend **404**.
//
// C'est ce qui a fait échouer TOUTES les notifications du gîte pendant
// huit jours, du 24 août au 1er septembre 2026. Aucun test local ne
// pouvait le voir : depuis un poste, la même URL répond parfaitement.
// Seul un `wrangler tail` sur le cron l'a montré — et encore, une fois
// la panne rendue bruyante.
//
// `env.GITE` est déclaré dans wrangler.toml. Le repli sur `fetch` sert
// au cas où la liaison manquerait ; le bilan dit alors laquelle a servi,
// pour qu'un binding oublié ne redevienne pas une panne muette.
async function lireGite(env) {
    const appeler = (chemin) => (env && env.GITE)
        ? env.GITE.fetch('https://gite' + chemin)
        : fetch(GITE_API + chemin);

    const [fluxIcal, etatBrut] = await Promise.all([
        appeler('/ical'),
        appeler('/')
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
// ⚠ LA VALEUR PORTE LA LISTE DES DESTINATAIRES SERVIS, pas un simple
// horodatage.
//
// Une clé par message ET par destinataire aurait multiplié les lectures
// du KV à chacun des 288 tours. Une seule clé, dont la valeur dit QUI a
// reçu, garde le coût d'origine — une lecture par message — tout en
// permettant qu'un chat en panne n'entraîne pas les autres dans sa chute.
//
// Les valeurs d'avant sont des horodatages ISO nus. Elles ne se parsent
// pas en JSON, et ce refus vaut réponse : « parti, pour tout le monde ».
// C'est ce qui permet de déployer sans vider le KV.
async function resteAServir(env, cle, destinataires) {
    const brut = await env.ENVOIS.get(cle);
    if (brut === null) return destinataires.slice();

    let faits = destinataires;
    try {
        const memoire = JSON.parse(brut);
        if (memoire && Array.isArray(memoire.faits)) faits = memoire.faits;
    } catch (ignore) {
        // Ancienne valeur : tout est déjà parti, on n'y revient pas.
    }
    return destinataires.filter((d) => faits.indexOf(d) === -1);
}

async function marquerEnvoye(env, cle, servis) {
    await env.ENVOIS.put(cle, JSON.stringify({
        le: new Date().toISOString(),
        faits: servis
    }), { expirationTtl: RETENTION_SECONDES });
}

// ------------------------------------------------------------
// 6. Telegram — deux bots, deux publics
// ------------------------------------------------------------
// Le canal `gite` part sur le bot O'Fil du Doubs, PARTAGÉ : on peut y
// inviter quelqu'un sans lui donner au passage la liste des corvées
// personnelles. Le canal `taches` part sur le bot personnel.
//
// Le repli sur le bot du gîte n'est pas une commodité : sans lui, un
// secret oublié ferait disparaître tous les rappels de tâches en
// silence. Mieux vaut un message au mauvais endroit qu'aucun message.
function canalDe(env, canal) {
    if (canal === 'taches' && env.TELEGRAM_TOKEN_TACHES) {
        return { jeton: env.TELEGRAM_TOKEN_TACHES,
                 destinataires: env.TELEGRAM_CHAT_ID_TACHES || env.TELEGRAM_CHAT_ID };
    }
    return { jeton: env.TELEGRAM_TOKEN, destinataires: env.TELEGRAM_CHAT_ID };
}

// Une conversation Telegram par destinataire : un bot n'écrit jamais
// « à plusieurs », il écrit dans un chat. Deux personnes en privé font
// donc deux identifiants — un groupe, un seul.
function listeDestinataires(valeur) {
    return String(valeur || '').split(',')
        .map(function(x) { return x.trim(); })
        .filter(Boolean);
}

// Qui écoute ce canal. Le tour de garde en a besoin AVANT d'envoyer :
// c'est la liste qu'il compare à la mémoire pour savoir s'il reste
// quelqu'un à servir.
function destinatairesDu(env, canal) {
    return listeDestinataires(canalDe(env, canal).destinataires);
}

// ⚠ NE JETTE PLUS SUR UN REFUS.
//
// Une exception ici sautait la pose de la clé de déduplication, et le
// tour suivant renvoyait le message à TOUT LE MONDE — y compris à ceux
// qui l'avaient déjà reçu. Chaque destinataire a maintenant son sort
// propre, et l'appelant décide quoi en faire.
//
// Trois issues, et la nuance est tout l'intérêt :
//   servis     — parti, ou réputé tel. Ne pas renvoyer.
//   incertains — sous-ensemble des servis : la passerelle a lâché sur la
//                RÉPONSE. Comptés comme reçus, mais annoncés.
//   refuses    — le message n'est PAS parti. À réessayer au prochain tour.
//
// Le 504 du 3 septembre 2026 est le cas d'école : Telegram avait bien
// livré le rappel du gîte et n'a échoué qu'à le DIRE. Le recompter comme
// « à renvoyer » garantissait le doublon ; le compter comme reçu risque
// au pire une perte — qui, elle, se dit.
async function envoyerTelegram(env, texte, canal, destinataires) {
    const voie = canalDe(env, canal);
    const cibles = destinataires || listeDestinataires(voie.destinataires);
    if (!cibles.length) throw new Error('aucun destinataire pour le canal ' + canal);

    const resultat = { servis: [], incertains: [], refuses: [] };

    for (const destinataire of cibles) {
        let reponse;
        try {
            reponse = await fetch(
                'https://api.telegram.org/bot' + voie.jeton + '/sendMessage',
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: destinataire,
                        text: texte,
                        parse_mode: 'HTML',
                        disable_web_page_preview: true
                    })
                }
            );
        } catch (erreur) {
            // Pas de réponse du tout : la requête n'a pas abouti, donc
            // rien n'est parti. Contrairement au 5xx, ce cas-là se
            // réessaie sans risque de doublon.
            resultat.refuses.push(destinataire + ' : '
                + String((erreur && erreur.message) || erreur).slice(0, 200));
            continue;
        }

        if (reponse.ok) {
            resultat.servis.push(destinataire);
            continue;
        }

        const detail = destinataire + ' : ' + reponse.status + ' '
            + (await reponse.text().catch(() => '')).slice(0, 200);

        // ⚠ 429 = refusé POUR CAUSE DE CADENCE, et jamais livré : celui-là
        // se réessaie. Les 5xx, eux, ne disent rien de la livraison.
        if (reponse.status >= 500) {
            resultat.servis.push(destinataire);
            resultat.incertains.push(detail);
        } else {
            resultat.refuses.push(detail);
        }
    }

    return resultat;
}

// ------------------------------------------------------------
// 7. Ce qui se dit au mainteneur, et à lui seul
// ------------------------------------------------------------
// Sur le canal PERSONNEL : une panne technique regarde celui qui
// maintient le notifieur, pas les gens invités pour le gîte.
//
// Volontairement en texte brut, sans parse_mode : si l'erreur vient
// justement d'un HTML mal formé, l'annoncer en HTML échouerait à son
// tour et la panne resterait muette.
//
// ⚠ LA CLÉ N'EST POSÉE QUE SI L'ALERTE EST RÉELLEMENT PARTIE.
//
// L'ancienne version ne regardait pas la réponse de Telegram et marquait
// dans tous les cas. Le 3 septembre 2026, le hoquet Telegram qui a causé
// la panne a aussi avalé son alerte, et le blocage horaire a été
// consommé pour rien : il n'est resté qu'une clé muette dans le KV. Une
// alerte perdue au moment précis où elle compte est pire que pas
// d'alerte, parce qu'on prend le silence pour une bonne nouvelle.
//
// La valeur stockée reste le TEXTE de l'alerte, jamais un horodatage :
// quand le message n'arrive pas, c'est la dernière trace lisible de ce
// qui s'est passé — et c'est elle qui a permis de comprendre ce doublon.
async function alerterTechnique(env, texte, cle, secondes) {
    try {
        if (env.ENVOIS && (await env.ENVOIS.get(cle)) !== null) return;
    } catch (ignore) {
        // KV injoignable : on préfère un message de trop à aucun.
    }

    let partie = false;
    try {
        const voie = canalDe(env, 'taches');
        for (const destinataire of listeDestinataires(voie.destinataires)) {
            const reponse = await fetch(
                'https://api.telegram.org/bot' + voie.jeton + '/sendMessage',
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ chat_id: destinataire, text: '⚠️ ' + texte })
                }
            );
            if (reponse.ok) partie = true;
        }
    } catch (ignore) {
        // Rien de plus à tenter : il reste les logs Cloudflare.
    }

    // Rien n'est arrivé : pas de clé, donc le prochain tour réessaiera.
    // Le blocage anti-répétition ne doit compter que les alertes REÇUES.
    if (!partie) console.error('Alerte technique non delivree :', texte);
    if (!partie || !env.ENVOIS) return;
    try {
        await env.ENVOIS.put(cle, texte.slice(0, 200), { expirationTtl: secondes });
    } catch (ignore) {
        // Au pire, l'alerte se répétera. C'est le bon sens de l'erreur.
    }
}

// ⚠ UNE FOIS PAR HEURE AU PLUS. Le cron se réveille toutes les 5 minutes :
// une panne durable — Firebase injoignable, mot de passe changé — enverrait
// 288 messages par jour. On se ferait taire le bot, et le prochain vrai
// rappel se perdrait dans le tas. Une alerte qu'on apprend à ignorer ne
// vaut pas mieux que pas d'alerte.
function signalerPanne(env, texte, heure) {
    return alerterTechnique(env, 'Notifieur en panne : ' + texte, 'panne:' + heure, 3600);
}
