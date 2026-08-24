# Notifieur Telegram — projet `taches`

Un Worker Cloudflare réveillé toutes les 5 minutes. Il lit tes tâches, décide ce qui doit
partir, et l'envoie sur Telegram.

**Pourquoi il existe :** le hub est un site statique. Rien, dans le dépôt, ne peut parler
quand la page est fermée — le compteur de retards sur la tuile d'accueil ne se voit que si
l'on ouvre l'accueil. Une alerte qui suppose qu'on aille la chercher n'est pas une alerte.

| Fichier | Rôle |
|---|---|
| `notifieur-messages.js` | **Quoi envoyer, et quand.** Fonctions pures, sans réseau ni horloge — donc testables |
| `worker.js` | La glu : se connecter, lire Firestore, appeler Telegram. Aucune décision |
| `wrangler.toml` | Cron, binding KV, variables publiques. **Aucun secret** |

Le calcul de « en retard » et « ça commence bientôt » n'est pas ici : il vient de
`../taches/taches-calcul.js`, le même fichier que la page. Recopier ces règles les aurait
fait diverger, et cette divergence-là serait **muette** — un message qui ne part pas ne se
remarque pas.

## Deux déclencheurs

- **Le digest du matin**, à 07:30 (heure de Paris). Les créneaux du jour, les retards, ce
  qui arrive sans créneau posé. C'est celui qui répond au problème d'origine :
  l'accumulation qu'on ne voit plus.
- **Un rappel 15 minutes avant chaque créneau.**

Le digest part **même quand il n'y a rien**. Une ligne de plus par jour contre une
ambiguïté en moins : sinon le silence voudrait dire à la fois « rien à faire » et « le
notifieur est cassé ». `DIGEST_MEME_SI_VIDE = false` en haut de `notifieur-messages.js` si
la ligne quotidienne agace.

## Ce qu'il lit, et ce qu'il ne lit pas

Le plan Spark de Firestore offre **50 000 lectures par jour**. Lire la base entière à
chacun des 288 réveils ferait dépendre le plafond du nombre *total* de tâches — or les
tâches faites s'accumulent indéfiniment. Le notifieur se serait tu un après-midi, deux ans
plus tard, sans que rien ne l'annonce.

Deux requêtes, donc, choisies selon le tour :

| Quand | Ce qui est lu |
|---|---|
| Presque tous les tours | Les créneaux d'**aujourd'hui et demain** seulement. Le rappel n'anticipe que de 15 min : au plus loin, ce soir à 23:50 pour un créneau demain à 00:05 |
| Fenêtre du digest, digest pas encore parti | Toutes les tâches **ouvertes**. Une fois par jour |

Le KV est interrogé **avant** Firestore : si le digest du jour est déjà parti, la lecture
complète n'a pas lieu du tout.

Ordre de grandeur pour 40 tâches : environ **3 000 lectures/jour** au lieu de 11 500. Et le
plafond ne dépend plus du nombre total de tâches, mais du nombre de créneaux posés sur deux
jours.

**⚠ Chaque requête ne porte que sur un seul champ.** Dès qu'on mélange une égalité et une
plage sur deux champs différents, Firestore réclame un **index composite** — donc une étape
manuelle de plus dans la console, et une panne le jour où on l'oublie. C'est pourquoi
`faite` se filtre côté Worker dans la requête des créneaux : l'y ajouter coûterait cet
index pour écarter une poignée de documents. Un test échoue si les deux champs se
retrouvent dans la même requête.

## ⚠ Le compte robot, et pourquoi pas une clé de service

Le Worker se connecte à Firebase **comme un utilisateur ordinaire**, avec un compte
email/mot de passe créé pour lui seul. Il subit donc les règles Firestore, et la fonction
`notifieur()` ne lui ouvre **que la lecture de `taches`** : aucune autre collection ne le
nomme, et il n'apparaît dans aucun `allow write`.

L'alternative — une clé de compte de service Google — aurait été plus courte à écrire, et
c'est un piège : elle contourne les règles entièrement, et les permissions IAM de Firestore
ne descendent pas au niveau de la collection. Cette clé aurait lu `fournisseurs`, donc des
**mots de passe en clair**, pour envoyer un message Telegram.

## Mise en place

### 1. Activer les comptes email/mot de passe dans Firebase

Le hub n'utilisait que Google jusqu'ici, et ce fournisseur-là est désactivé par défaut.

Console Firebase → **Authentication** → *Sign-in method* → **E-mail/Mot de passe** →
Activer. Laisser « Lien de connexion » désactivé.

### 2. Créer le compte robot

Authentication → *Users* → **Add user** :

- adresse : celle de `NOTIFIEUR_EMAIL` dans `config.js` — actuellement
  `notifieur@ofildudoubs.fr` ;
- mot de passe : long et aléatoire, il ne sera jamais tapé à la main.

La boîte aux lettres n'a pas besoin d'exister. Ne **pas** lui créer de fiche dans
`membres` : son droit vient des règles, pas de l'annuaire.

> **⚠ Note le mot de passe tout de suite, il ne se retrouve pas.** Firebase n'en garde
> qu'une empreinte, et la console **ne sait pas le changer** : le menu ⋮ d'un utilisateur
> n'offre que « réinitialiser par e-mail » — inutile ici, la boîte n'existe pas —,
> « désactiver » et « supprimer ». Pour en reposer un, il faut **supprimer le compte et le
> recréer**. C'est sans risque : `notifieur()` reconnaît l'adresse, pas l'identifiant
> interne, donc le nouveau compte est le même aux yeux des règles.

> Si tu choisis une autre adresse, il faut la changer **aux deux endroits** — `config.js` et
> `firestore.rules`. Un test échoue si les deux divergent, parce que le notifieur se ferait
> refuser en silence, ce qui ressemble exactement à « rien à signaler ».

### 3. Publier les règles

Console Firebase → Firestore Database → **Règles** → coller `firestore.rules` → *Publier*.
Sans ça, le robot lit `taches` et ne reçoit rien.

### 4. Créer le bot Telegram

Dans Telegram, parler à **@BotFather** → `/newbot` → suivre. Il rend un jeton de la forme
`123456789:AAE...`. **C'est le secret le plus sensible du lot** : il permet d'écrire sous
l'identité du bot.

Puis récupérer l'identifiant de la conversation : **envoyer un message au bot** (n'importe
lequel, « bonjour » suffit), puis ouvrir dans un navigateur

```
https://api.telegram.org/bot<TON_JETON>/getUpdates
```

et lire `message.chat.id` dans la réponse. C'est le `TELEGRAM_CHAT_ID` — attention aux
autres `id` de la réponse, c'est bien celui du bloc `chat`.

> Si `result` est vide : soit on a parlé à @BotFather et non au bot lui-même (ce sont deux
> conversations différentes), soit le message a plus de **24 h** — Telegram ne garde pas
> les updates non lues au-delà. Dans les deux cas, renvoyer un message et recharger.
>
> Le jeton se retrouve chez @BotFather (`/mybots` → le bot → *API Token*). Le mot de passe
> du robot, lui, ne se retrouve pas : voir l'étape 2.

### 5. Créer le stockage de déduplication

```bash
cd notifieur
npx wrangler kv namespace create ENVOIS
```

Recopier l'identifiant rendu dans `wrangler.toml`, à la place de
`A_REMPLACER_PAR_L_ID_RENDU_PAR_WRANGLER`.

> Sur les versions de wrangler antérieures à la v4, la commande s'écrit
> `wrangler kv:namespace create ENVOIS`, avec deux-points.

Sans ce stockage, le rappel de 9 h 00 repartirait à 8 h 45, 8 h 50 **et** 8 h 55.

### 6. Déployer une première fois

⚠ **Avant les secrets, et pas après.** `wrangler secret put` ne crée pas le Worker : il
refuse en disant qu'il n'existe pas. Il faut donc lui donner un corps d'abord.

```bash
npx wrangler deploy
```

Le cron démarre aussitôt et **échouera toutes les 5 minutes** jusqu'à l'étape suivante,
faute de secrets. Sans conséquence : les erreurs sont attrapées, et le Worker ne peut même
pas envoyer son message de panne puisqu'il n'a pas encore le jeton.

### 7. Poser les secrets

```bash
npx wrangler secret put FIREBASE_API_KEY     # celle de config.js
npx wrangler secret put NOTIFIEUR_EMAIL      # l'adresse du compte robot
npx wrangler secret put NOTIFIEUR_MDP        # son mot de passe
npx wrangler secret put TELEGRAM_TOKEN       # le jeton de @BotFather, SANS le « bot » devant
npx wrangler secret put TELEGRAM_CHAT_ID     # le nombre lu dans "chat":{"id":…}
```

Chaque `secret put` redéploie le Worker : c'est attendu.

**Aucun de ces cinq ne va dans git.** Le dépôt est public : un secret déposé ici serait
lisible par tout le monde, pour toujours — même retiré au commit suivant. Et une fois posé
chez Cloudflare, **un secret n'est plus relisible** : `secret list` n'affiche que les noms.
Le gestionnaire de mots de passe est le seul endroit où ces valeurs restent consultables.

### ⚠ Toutes ces commandes se lancent depuis `notifieur/`

Ailleurs, wrangler ne trouve ni le nom du Worker ni même l'authentification, et rend un
« Required Worker name missing » qui n'a rien à voir avec la vraie cause. `--name` ne suffit
pas. En PowerShell, coller le déplacement devant chaque commande évite la question :

```powershell
cd c:\Users\csamson\Documents\Perso\GitHub\Admin\notifieur; npx wrangler secret put NOTIFIEUR_MDP
```

### Si l'authentification Cloudflare lâche

La session `wrangler login` expire, et son jeton de rafraîchissement ne survit pas toujours
(« auth token has expired and could not be refreshed »). Deux issues :

```bash
npx wrangler login --browser=false   # affiche une URL à ouvrir à la main
```

ou un jeton d'API durable — dashboard → *My Profile* → *API Tokens* → modèle **Edit
Cloudflare Workers** — posé en variable de session :

```powershell
$env:CLOUDFLARE_API_TOKEN = "..."
```

Jamais dans un fichier du dépôt : `.gitignore` couvre `.wrangler/`, pas `.env`.

## Vérifier sans attendre le cron

Le Worker répond aussi à une requête HTTP, protégée par le jeton Telegram — l'URL d'un
Worker est devinable, et sans ce garde-fou n'importe qui pourrait déclencher tes
notifications en boucle.

```bash
# À blanc : calcule et montre ce qui PARTIRAIT, sans rien envoyer
# ni consommer les clés de déduplication du jour.
curl "https://ofildudoubs-notifieur.<ton-sous-domaine>.workers.dev/?cle=<TELEGRAM_TOKEN>&blanc=1"

# Pour de vrai
curl "https://ofildudoubs-notifieur.<ton-sous-domaine>.workers.dev/?cle=<TELEGRAM_TOKEN>"
```

La réponse dit le jour et l'heure retenus, le nombre de tâches lues, ce qui est dû, ce qui
reste à envoyer une fois la déduplication passée, et l'erreur éventuelle.

## Quand ça ne marche pas

| Symptôme | Cause la plus probable |
|---|---|
| `Connexion Firebase refusée : OPERATION_NOT_ALLOWED` | Le fournisseur e-mail/mot de passe n'est pas activé (étape 1) |
| `Connexion Firebase refusée : INVALID_LOGIN_CREDENTIALS` | Adresse ou mot de passe du robot erronés dans les secrets |
| `Lecture Firestore refusée (403)` | Règles pas republiées, ou adresse différente entre `config.js` et `firestore.rules` |
| `tachesLues: 0` alors qu'il y a des tâches | Les règles autorisent la lecture mais le projet Firebase visé n'est pas le bon |
| Rien ne part, aucune erreur | Regarder `dus` et `aEnvoyer` dans le bilan : la déduplication a probablement déjà tout marqué |
| Telegram refuse en 400 | Un titre de tâche mal échappé — mais l'échappement est testé, donc vérifier plutôt le `chat_id` |

Le Worker essaie de **dire ses propres pannes** dans la conversation Telegram, en texte
brut. Si même ça échoue, il reste les logs : `npx wrangler tail`.

## Tests

```bash
node tests/test-notifieur.js
```

Ils ne touchent ni le réseau ni Cloudflare : ils exercent la logique pure et relisent
`config.js`, `firestore.rules` et `wrangler.toml` pour vérifier qu'ils ne se contredisent
pas. Ce qu'ils ne couvrent pas : l'authentification réelle, la forme exacte des réponses
Firestore, et l'envoi Telegram. Pour ceux-là, le mode à blanc ci-dessus est le seul juge.
