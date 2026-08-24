# Notifieur Telegram — projet `taches`

Un Worker Cloudflare réveillé toutes les 5 minutes. Il lit tes tâches, décide ce qui doit
partir, et l'envoie sur Telegram.

**Pourquoi il existe :** le hub est un site statique. Rien, dans le dépôt, ne peut parler
quand la page est fermée — le compteur de retards sur la tuile d'accueil ne se voit que si
l'on ouvre l'accueil. Une alerte qui suppose qu'on aille la chercher n'est pas une alerte.

| Fichier | Rôle |
|---|---|
| `notifieur-messages.js` | **Quoi envoyer, et quand.** Fonctions pures, sans réseau ni horloge — donc testables |
| `notifieur-sejours.js` | Lit le calendrier iCal du gîte : arrivées, départs, plateforme |
| `worker.js` | La glu : se connecter, lire Firestore, appeler Telegram. Aucune décision |
| `wrangler.toml` | Cron, binding KV, variables publiques. **Aucun secret** |

Le calcul de « en retard » et « ça commence bientôt » n'est pas ici : il vient de
`../taches/taches-calcul.js`, le même fichier que la page. Recopier ces règles les aurait
fait diverger, et cette divergence-là serait **muette** — un message qui ne part pas ne se
remarque pas.

## Trois déclencheurs

| Quand | Quoi | Question posée |
|---|---|---|
| **07:30** | Digest du matin — tâches à heure fixe, retards, tâches du jour sans heure | Qu'est-ce qui m'attend ? |
| **15 min avant chaque heure fixée** | Un rappel, une seule fois. Une tâche sans heure n'en reçoit pas : il n'y a pas de moment à anticiper | — |
| **20:00** | Bilan du soir — échéances qui basculent cette nuit, heures passées sans être faites, programme de demain | Qu'est-ce qui a glissé, et que fais-je de demain ? |

**Les deux résumés** portent en plus, en tête, les arrivées et départs du gîte de
Labergement prévus le lendemain : le matin les annonce (« envoyer le message d'arrivée »),
le soir les redemande (« message d'arrivée envoyé ? »). Voir plus bas.

Le notifieur est **silencieux le reste du temps**. Il se réveille 288 fois par jour et ne
dit rien la quasi-totalité de ces fois : une alerte qu'on reçoit sans cesse est une alerte
qu'on apprend à ignorer, et le jour où elle compte, on ne la voit plus.

### ⚠ Le bilan du soir n'est pas le digest une seconde fois

Il répond à une autre question, et il règle surtout un problème que rien d'autre ne peut
régler : **une tâche bascule en retard à minuit**. Une alerte à cet instant tomberait vers
00 h 05, à l'heure la plus inutile qui soit pour apprendre qu'on a oublié quelque chose.

Prévenu à 20 h, on a encore le choix — la finir, ou repousser l'échéance délibérément, ce
qui incrémente le compteur de reports et reste honnête. C'est pourquoi il n'existe pas de
déclencheur « bascule en retard » séparé : il serait arrivé trop tard.

Le bilan absorbe de la même façon le **créneau manqué**, dont un signalement à chaque
glissement aurait été bavard. Groupé une fois le soir, il devient une invitation à
replanifier plutôt qu'un reproche répété. Et il ne reprend que les créneaux **du jour** :
répéter ceux des jours précédents chaque soir jusqu'à ce qu'on cède ne serait plus un
rappel.

### Une asymétrie assumée entre les deux

Le digest du matin part **même quand il n'y a rien** — une ligne suffit. C'est le battement
de cœur qui prouve que le notifieur vit : sans lui, le silence voudrait dire à la fois
« rien à faire » et « c'est cassé », et on ne saurait jamais lequel.

Le bilan du soir, **non** : s'il n'y a rien qui bascule, rien qui a glissé et rien demain,
il se tait. Deux battements par jour, c'en est un de trop.

`DIGEST_MEME_SI_VIDE = false` en haut de `notifieur-messages.js` si la ligne quotidienne
agace ; `HEURE_DIGEST` et `HEURE_BILAN` juste à côté pour déplacer les deux rendez-vous.

## Ce qu'il lit, et ce qu'il ne lit pas

Le plan Spark de Firestore offre **50 000 lectures par jour**. Lire la base entière à
chacun des 288 réveils ferait dépendre le plafond du nombre *total* de tâches — or les
tâches faites s'accumulent indéfiniment. Le notifieur se serait tu un après-midi, deux ans
plus tard, sans que rien ne l'annonce.

Deux requêtes, donc, choisies selon le tour :

| Quand | Ce qui est lu |
|---|---|
| Presque tous les tours | Les tâches à heure fixe d'**aujourd'hui et demain** seulement. Le rappel n'anticipe que de 15 min : au plus loin, ce soir à 23:50 pour une tâche demain à 00:05 |
| Fenêtre d'un résumé, résumé pas encore parti | Toutes les tâches **ouvertes**. Deux fois par jour au plus |

Le bilan du soir a besoin de la liste complète autant que le digest : les échéances qui
basculent cette nuit n'ont pas forcément d'heure, elles seraient invisibles dans la lecture
courte.

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

## Le gîte — arrivées et départs

La seule partie du notifieur qui ne parle pas de `taches`. Elle lit le calendrier du gîte
sur `menage-state.cyril-samson41.workers.dev` : `/ical` pour les séjours, `/` pour l'état du
ménage. Deux endpoints publics, aucune authentification, et le CORS restreint à
`ofildudoubs.fr` ne gêne pas — il ne contraint que les navigateurs.

**La veille d'une arrivée**, le digest rappelle d'envoyer le message d'accueil ; **la veille
d'un départ**, celui de sortie. Un jour d'avance des deux côtés : prévenir le jour même ne
sert plus à rien, les gens sont déjà en route. Aucune plateforme ne fait ce rappel à la
place de l'hôte, et c'est typiquement ce qu'on oublie.

```
🏠 Arrivée demain — Airbnb
3 personnes · en allemand · du 28 au 30 août
→ envoyer le message d'arrivée
https://www.airbnb.com/hosting/reservations/details/HMY45JSW55
Livret en allemand en premier
```

Le nombre de personnes, la langue et le commentaire viennent de `info_<date d'arrivée>` dans
l'état ménage. Le lien de réservation vient de la `DESCRIPTION` du flux Airbnb : un lien à
toucher plutôt qu'une réservation à retrouver à la main.

### ⚠ Trois sortes d'événements, et il a fallu les données pour le voir

| `SUMMARY` | Domaine de l'`UID` | Lecture |
|---|---|---|
| `Reserved` | `airbnb.com` | Réservation Airbnb, avec l'URL de la réservation |
| `Airbnb (Not available)` | `airbnb.com` | Dates bloquées. L'hôte bloque **en général pour des clients en direct** — ce sont donc de vraies arrivées, et même celles à ne pas manquer : aucune plateforme ne relance à sa place |
| `CLOSED - Not available` | `booking.com` | **Indiscernable.** Booking n'exporte rien qui distingue un séjour d'un inventaire fermé |

**La plateforme ne se lit pas dans le libellé mais dans le domaine de l'`UID`** : c'est le
seul champ que les deux plateformes remplissent de façon fiable.

Les événements Booking sont traités comme des séjours, faute de mieux. Au moment de
l'écriture, les 14 présents dans le flux étaient visiblement de l'inventaire fermé — treize
nuits isolées à l'été 2027 et un blocage de six mois — et rien avant juin 2027. Si ce motif
persiste, ils produiront des rappels sans objet ; c'est un choix assumé plutôt qu'une
heuristique sur la durée, qui se serait trompée en silence.

### ⚠ Deux pièges du format iCal

**Le repliage de lignes.** Une ligne iCal se coupe au-delà de 75 octets et la suite commence
par une espace. La `DESCRIPTION` d'Airbnb est toujours repliée : sans dépliage, l'URL de
réservation arrive tronquée — un lien mort dans le message, et personne pour s'en apercevoir
avant d'avoir tapé dessus. Une assertion vérifie que le lien ressort entier.

**`DTEND` se prend tel quel.** La norme iCal le veut exclusif pour une date pleine ; Airbnb y
met la date de départ réelle. `DTSTART 20260828` / `DTEND 20260830` se lit « du 28 au 30 »,
ce que confirment l'affichage du site ménage et la liste `_futureCheckouts` de l'état.

### Ce qui se passe si le gîte est injoignable

**Rien de grave, et surtout pas la perte du digest.** C'est une source externe au hub : son
indisponibilité ne doit pas priver des tâches. La section disparaît, le reste du message
part, et le bilan du mode à blanc porte `giteIndisponible` avec la raison. L'état ménage est
un confort supplémentaire : sans lui, le rappel part quand même, sans le nombre de personnes
ni la langue.

Le calendrier n'est lu **que dans les fenêtres de résumé**, deux fois par jour — pas à
chacun des 288 réveils.

### ⚠ La seule répétition assumée du notifieur

Le gîte apparaît **deux fois dans la journée**, ce qui contredit la parcimonie appliquée
partout ailleurs. La raison tient en deux points.

**Une tâche se coche** : le notifieur sait qu'elle est faite et se tait. Le gîte n'a pas de
« fait » — rien ne lui dira jamais que le message est parti. Le choix est donc binaire :
une seule chance, ou deux.

**Et l'oubli ne coûte pas à celui qui oublie.** Une corvée repoussée n'ennuie que soi ; des
clients qui arrivent sans code d'entrée, non.

Le soir n'est donc pas une copie mais un filet, et la ligne d'action le dit — « envoyer » le
matin, « envoyé ? » le soir. Le reste du bloc est identique à dessein : si le message n'est
pas parti le matin, on veut pouvoir l'écrire là, sans rien rouvrir.

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
