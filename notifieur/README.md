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

et lire `message.chat.id` dans la réponse. C'est le `TELEGRAM_CHAT_ID`.

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

### 6. Poser les secrets

```bash
npx wrangler secret put FIREBASE_API_KEY     # celle de config.js
npx wrangler secret put NOTIFIEUR_EMAIL      # l'adresse du compte robot
npx wrangler secret put NOTIFIEUR_MDP        # son mot de passe
npx wrangler secret put TELEGRAM_TOKEN       # le jeton de @BotFather
npx wrangler secret put TELEGRAM_CHAT_ID     # l'identifiant de conversation
```

**Aucun de ces cinq ne va dans git.** Le dépôt est public : un secret déposé ici serait
lisible par tout le monde, pour toujours — même retiré au commit suivant.

### 7. Déployer

```bash
npx wrangler deploy
```

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
