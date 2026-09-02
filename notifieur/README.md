# Notifieur Telegram — projet `taches`

Un Worker Cloudflare réveillé toutes les 5 minutes. Il lit tes tâches, décide ce qui doit
partir, et l'envoie sur Telegram.

**Pourquoi il existe :** le hub est un site statique. Rien, dans le dépôt, ne peut parler
quand la page est fermée — le compteur de retards sur la tuile d'accueil ne se voit que si
l'on ouvre l'accueil. Une alerte qui suppose qu'on aille la chercher n'est pas une alerte.

| Fichier | Rôle |
|---|---|
| `notifieur-messages.js` | **Quoi envoyer, et quand.** Fonctions pures, sans réseau ni horloge — donc testables |
| `notifieur-sejours.js` | Lit le calendrier iCal du gîte, et porte la table des six rappels |
| `worker.js` | La glu : se connecter, lire Firestore, appeler Telegram. Aucune décision |
| `wrangler.toml` | Cron, binding KV, variables publiques. **Aucun secret** |

Le calcul de « en retard » et « ça commence bientôt » n'est pas ici : il vient de
`../taches/taches-calcul.js`, le même fichier que la page. Recopier ces règles les aurait
fait diverger, et cette divergence-là serait **muette** — un message qui ne part pas ne se
remarque pas.

## Deux canaux, deux publics

| Canal | Bot | Contenu | Secrets |
|---|---|---|---|
| **`gite`** | O'Fil du Doubs — **partagé** | Les rappels du logement, et rien d'autre | `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID` |
| **`taches`** | Personnel | Digest, rappels d'heure, bilan du soir, pannes techniques | `TELEGRAM_TOKEN_TACHES`, `TELEGRAM_CHAT_ID_TACHES` |

**C'est le partage qui a imposé la séparation.** Tant que tout arrivait au même endroit, une
section du digest suffisait — et j'avais argumenté contre deux messages simultanés. Mais on
ne peut pas donner à quelqu'un l'accès aux arrivées du gîte sans lui donner au passage la
liste des corvées personnelles.

**Chaque `CHAT_ID` accepte plusieurs destinataires**, séparés par des virgules. Un bot
Telegram n'écrit jamais « à plusieurs » : il écrit dans une conversation. Deux personnes en
privé font donc deux identifiants ; un groupe où le bot est invité n'en fait qu'un.

Si `TELEGRAM_TOKEN_TACHES` manque, tout repart sur le bot du gîte. Ce n'est pas une
commodité : sans ce repli, un secret oublié ferait disparaître tous les rappels de tâches en
silence. Mieux vaut un message au mauvais endroit qu'aucun message.

Les **pannes techniques** vont sur le canal personnel : elles regardent qui maintient le
notifieur, pas les gens invités pour le gîte. Le « ⚠️ Calendrier du gîte injoignable », lui,
part sur le canal du gîte — c'est là qu'il manque.

## Trois déclencheurs

| Quand | Quoi | Question posée |
|---|---|---|
| **07:30** | Digest du matin — tâches à heure fixe, retards, tâches du jour sans heure | Qu'est-ce qui m'attend ? |
| **15 min avant chaque heure fixée** | Un rappel, une seule fois. Une tâche sans heure n'en reçoit pas : il n'y a pas de moment à anticiper | — |
| **20:00** | Bilan du soir — échéances qui basculent cette nuit, heures passées sans être faites, programme de demain | Qu'est-ce qui a glissé, et que fais-je de demain ? |

Le gîte a **ses propres fenêtres** — 11 h, 12 h, 17 h, 18 h — et son propre message, sur le
canal partagé. Il ne suit plus celles des tâches : deux publics, deux rythmes. Voir plus bas.

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

## Le gîte — la séquence des six rappels

La seule partie du notifieur qui ne parle pas de `taches`. Elle lit le calendrier du gîte
servi par le Worker `menage-state` : `/ical` pour les séjours, `/` pour l'état du ménage.

### ⚠ Par la liaison de service, jamais par l'URL publique

Les deux Workers vivent sur le même sous-domaine `cyril-samson41.workers.dev`. Un `fetch()`
vers l'URL publique du voisin **ne sort pas sur Internet** : il reste dans le réseau interne
de Cloudflare, où ce nom ne se résout pas, et rend **404**.

C'est ce qui a fait échouer **toutes** les notifications du gîte du 24 août au 1er septembre
2026 — huit jours sans qu'aucune ne parte. Et aucun test local ne pouvait le voir : depuis
un poste, la même URL répond parfaitement. Seul un `wrangler tail` sur le cron l'a montré,
et encore, une fois la panne rendue bruyante.

La liaison `[[services]]` de `wrangler.toml` transforme l'appel en RPC interne, sans DNS ni
réseau. Le bilan porte `giteVia` pour dire quelle voie a servi : un binding oublié ne doit
pas redevenir une panne muette. Deux assertions l'exigent.

### Six rappels, chacun son geste

⚠ **Une séquence, pas une répétition.** La première version disait trois fois la même
chose — « envoyer le message d'arrivée » — sans jamais préciser lequel. Une répétition, on
finit par l'ignorer ; une suite d'actions distinctes, on la suit.

| Quand | Quoi | Nature |
|---|---|---|
| **Veille de l'arrivée, 12 h** | Demander à quelle heure ils pensent arriver | action |
| **Veille de l'arrivée, 18 h** | Envoyer la procédure d'arrivée | action |
| **Jour de l'arrivée, 12 h** | Envoyer le code de la boîte à clés, si besoin | action |
| **Jour de l'arrivée, 17 h** | « Arrivée ce soir » | information |
| **Veille du départ, 18 h** | Envoyer la procédure de départ | action |
| **Jour du départ, 11 h** | « Départ ce matin — le logement est libre » | information |

**Les heures viennent de l'usage, pas d'une symétrie.** 07:30 et 20:00 avaient été repris du
rythme des tâches personnelles ; à l'essai, c'était trop tôt pour agir le matin et trop tard
le soir. Midi et 18 h sont des moments où l'on a son téléphone et une main libre — et le bon
moment n'est pas celui où l'on peut *lire*, mais celui où l'on peut *agir*.

⚠ **Asymétrie arrivée / départ.** Les voyageurs arrivent en fin d'après-midi mais partent le
matin. Il n'y a donc **aucune action de départ le jour même** : elle arriverait après leur
voiture. Le 11 h n'est qu'une information — le ménage peut commencer. Une assertion l'exige,
pour que la symétrie ne se réintroduise pas d'elle-même.

Les séjours d'une nuit ne sont pas proposés à la location, et aucune réservation n'est
acceptée à moins de 24 h : la veille existe donc toujours, et la séquence ne se replie
jamais sur elle-même.

### ⚠ Action et information doivent se distinguer sans être lues

Deux icônes de même poids — ℹ️ et ➡️ — se confondaient à l'usage. L'asymétrie est donc dans
le **ton** : l'action crie, l'information chuchote. On voit lequel est lequel avant même de
lire.

```
🏠 jeudi 27 août

🔴 À FAIRE — Alisson (Airbnb)
Arrivée demain · Marie et Paul · 3 pers. · en allemand
du 28 au 30 août
→ demander à quelle heure ils pensent arriver
https://www.airbnb.com/hosting/reservations/details/HMY45JSW55
Livret en allemand en premier
```

```
🏠 vendredi 28 août

▫️ pour info
Arrivée ce soir · Marie et Paul · 3 pers. · en allemand · Airbnb
```

L'en-tête ne dit pas « Gîte » : la maison et la date suffisent, sur un canal qui ne parle que
de ça.

### ⚠ Qui écrit — le message le dit

Dans un groupe partagé, un rappel qui ne nomme personne n'est adressé à personne. Sans ça on
retombe sur « je pensais que tu t'en occupais », qui a déjà coûté un message d'accueil.

| Plateforme | Responsable |
|---|---|
| Airbnb | Alisson |
| Booking | Cyril |
| Direct (WhatsApp) | Cyril |
| Inconnue | « à voir » |

La répartition suit le canal de réservation, parce que c'est là que se trouve la
conversation. Une plateforme non identifiée ne se rabat sur personne : « à voir » est plus
honnête qu'un nom faux, qui ferait attendre l'autre.

### Ce qui vient de l'état ménage

Le nombre de personnes, la langue, le commentaire et le **prénom des voyageurs** viennent de
`info_<date d'arrivée>`. Le lien de réservation, lui, vient de la `DESCRIPTION` du flux
Airbnb : un lien à toucher plutôt qu'une réservation à retrouver à la main.

⚠ **`voyageurs` et `comment` ne s'adressent pas au même public.** Le commentaire est une
consigne pour les personnes qui font le ménage (« mettre le livret en allemand en premier »)
et s'affiche pour tout le monde sur la page ménage. `voyageurs` est le prénom des occupants,
saisi dans la **vue admin seulement**, et ne sert qu'aux notifications. Les mélanger ferait
passer un prénom dans les consignes de ménage, et une consigne de ménage dans un message
d'accueil.

*(La page ménage sert son état par un endpoint public non authentifié : le champ est caché
dans l'interface, il n'est pas secret sur le réseau. À traiter le jour où l'endpoint le
sera.)*

### La fenêtre, et pourquoi la clé ne porte pas le séjour

Chaque rappel ouvre une fenêtre d'une heure, **borne haute exclue** — sans quoi 17 h et 18 h
se recouvriraient et deux messages porteraient la même clé. Le cron passant toutes les
5 minutes, ça laisse douze occasions de rattraper un échec réseau.

La clé de déduplication est `gite:<fenêtre>:<jour>` — elle ne porte **pas** le séjour. C'est
délibéré : elle doit être calculable *sans avoir lu le calendrier*, pour que le Worker
interroge sa mémoire d'abord et n'aille chercher le flux iCal que s'il reste quelque chose à
dire. La plupart des 288 réveils quotidiens n'ont rien à faire du gîte.

Plusieurs rappels peuvent tomber dans la même fenêtre — typiquement à 18 h, la procédure de
départ d'un séjour et celle d'arrivée du suivant quand les deux s'enchaînent. Ils partent
alors dans un seul message, un bloc chacun, les actions avant les informations.

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

**Le digest le dit, et ne se tait pas.** C'est une source externe au hub : son indisponibilité ne doit pas priver des tâches. Mais
le message porte alors **« ⚠️ Calendrier du gîte injoignable — à vérifier à la main »**, et
le bilan du mode à blanc donne la raison dans `giteIndisponible`.

⚠ Ce n'était pas le cas jusqu'au 1er septembre 2026 : la section disparaissait en silence,
et rien ne distinguait « aucune arrivée demain » de « je n'ai rien pu lire ». C'est ce
silence qui a laissé la panne des huit jours passer inaperçue. L'état ménage est
un confort supplémentaire : sans lui, le rappel part quand même, sans le nombre de personnes
ni la langue.

Le calendrier n'est lu **que dans les fenêtres du gîte**, et seulement si la mémoire dit que
le rappel n'est pas déjà parti — pas à chacun des 288 réveils.

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
npx wrangler secret put FIREBASE_API_KEY          # celle de config.js
npx wrangler secret put NOTIFIEUR_EMAIL           # l'adresse du compte robot
npx wrangler secret put NOTIFIEUR_MDP             # son mot de passe
npx wrangler secret put TELEGRAM_TOKEN            # bot du GÎTE, sans le « bot » devant
npx wrangler secret put TELEGRAM_CHAT_ID          # ses destinataires, virgules acceptées
npx wrangler secret put TELEGRAM_TOKEN_TACHES     # bot PERSONNEL
npx wrangler secret put TELEGRAM_CHAT_ID_TACHES   # ses destinataires
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

### ⚠ Déployer quand le VPN bloque wrangler

Sur le poste du travail, l'interception TLS de l'employeur casse Node et wrangler
(`SELF_SIGNED_CERT_IN_CHAIN`) : `wrangler deploy` ne peut pas joindre Cloudflare. Le
navigateur, lui, passe — git fonctionne, le dashboard aussi. **Le déploiement à la main est
donc parfaitement possible**, en deux temps.

**1. Fabriquer le paquet, hors ligne.** esbuild tourne en local, il n'a besoin de personne :

```powershell
cd c:\Users\csamson\Documents\Perso\GitHub\Admin\notifieur; npx wrangler deploy --dry-run --outdir .wrangler\dist
```

Ça produit `.wrangler/dist/worker.js` : **un seul fichier**, tous les modules aplatis dedans.
C'est indispensable — le Worker est un bundle de quatre fichiers, dont
`../taches/taches-calcul.js` en CommonJS, et l'éditeur du dashboard ne sait ni suivre un
chemin qui remonte d'un dossier ni interpréter `require()`.

Supprimer la dernière ligne `//# sourceMappingURL=…` : la carte n'ira pas avec.

**2. Coller dans le dashboard.** *Workers & Pages* → `ofildudoubs-notifieur` → *Edit code* →
tout remplacer par le contenu du fichier → *Deploy*.

**Les bindings ne bougent pas.** KV, liaison de service, variables, secrets et cron vivent
dans la configuration du Worker, pas dans son code : un déploiement par le dashboard les
laisse intacts. Seul le code est remplacé.

⚠ Le `wrangler.toml` n'est **pas** appliqué par cette voie. Si un déploiement change un
binding ou une expression cron, la modification doit être refaite à la main dans *Settings* —
sinon le code neuf tourne avec l'ancienne configuration, ce qui est exactement le genre de
panne qui ne se voit pas.

Un `npx wrangler deploy` ultérieur, depuis une connexion libre, écrase sans dommage ce qui a
été posé par le dashboard.

**Deux autres issues**, selon ce qui est le plus simple sur le moment : le partage de
connexion du téléphone, qui contourne le VPN d'un coup ; ou une action GitHub avec
`cloudflare/wrangler-action` et un jeton d'API en secret de dépôt, qui déploie depuis les
machines de GitHub et supprime le problème pour de bon.

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
