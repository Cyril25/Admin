# Hub O'Fil du Doubs — `admin.ofildudoubs.fr`

Point d'entrée privé de mes projets, organisé en **projets** dont l'accès se
donne membre par membre.

## Architecture

Même stack que [BilletsTouristiques](https://github.com/Cyril25/BilletsTouristiques) :
statique, sans build, hébergé sur GitHub Pages. Auth Google via Firebase, données
dans Firestore.

| Fichier | Rôle |
|---|---|
| `config.js` | Config Firebase + adresse du propriétaire |
| `projets.js` | **Registre des projets** — source unique du menu, des tuiles et des droits |
| `sites.js` | Registre des sites en ligne (raccourcis de l'accueil) |
| `auth.js` | Le vigile : garde des pages, droits, en-tête, impersonation |
| `hub-utils.js` | `toDate`, `formatDateFr`, `escapeAttr`, `jsAttr` — partagées par toutes les pages |
| `login.html` | Page de connexion Google |
| `index.html` / `accueil.js` | Accueil, construit d'après les droits de la personne |
| `membres.html` / `membres.js` | Annuaire des membres et attribution des accès (superadmin) |
| `idees/` | Projet « Idées / Projets » |
| `exterieur/` | Projet « Extérieur de la maison » |
| `taches/` | Projet « Mes tâches » — to-do priorisée. `taches-calcul.js` est **aussi chargé par l'accueil**, pour le compteur de retards |
| `cueillette/` | Projet « Calendrier de cueillette du Haut-Doubs » |
| — | [collections.ofildudoubs.fr](https://collections.ofildudoubs.fr) est un **site** à part : seul son droit d'accès se coche ici, dans la liste des sites |
| `style.css` | Feuille de styles unique |
| `firestore.rules` | Règles de sécurité à publier dans la console Firebase |
| `notifieur/` | **Worker Cloudflare** — rappels Telegram du projet `taches`. Déployé à part, pas servi par GitHub Pages |
| `tests/` | Tests hors navigateur — `node tests/run-tests.js` |
| `CNAME` | Domaine custom GitHub Pages |

### Rôles et accès

- **Superadmin** — voit tout, y compris les projets créés plus tard, et gère les
  membres. Le propriétaire (`SUPERADMIN_EMAIL`) l'est *par son adresse*, indépendamment
  de sa fiche : c'est le filet qui empêche de se verrouiller dehors en supprimant son
  propre document.
- **Membre** — ne voit que les projets cochés sur sa fiche. Menu, tuiles d'accueil
  et accès aux données sont filtrés ensemble.

**Projets et sites sont deux choses différentes.** Un *projet* est une page **du hub**
adossée à une collection Firestore : le droit se donne écran par écran. Un *site* est un
autre sous-domaine, autorisé **en un seul bloc** : une case, tout le site. D'où deux listes
séparées sur la fiche membre.

### ⚠ Un site n'est plus forcément décoratif

Historiquement, `membres.sites` ne servait qu'à choisir les raccourcis affichés sur
l'accueil : aucune règle Firestore ne le lisait, et masquer un site ne protégeait rien.

**Ce n'est plus vrai de `collections`.** Le site
[Collections](https://github.com/Cyril25/Collections) partage ce projet Firebase et possède
ses propres collections Firestore (`achats`, `fournisseurs`) : cocher sa case ouvre de
vraies données. Les règles interrogent bel et bien `membres.sites`, via une fonction
`aAccesSite()` ajoutée pour ça.

L'entrée porte `protege: true` dans `sites.js`, et la page Membres affiche un cadenas sur
la case — à l'endroit exact où on la coche. Le texte d'aide, qui disait « les masquer ne
protège rien », a été corrigé : un contresens y aurait été dangereux. `test-droits.js`
verrouille les deux, le marqueur et le texte.

**Pourquoi au niveau du site et pas par page :** parce que les deux collections de
Collections sont **cloisonnées par `proprietaire`** — chacun n'y voit que ses propres
données. Un découpage plus fin n'aurait rien protégé de plus, et aurait multiplié les cases
à cocher pour un même site.

Le site distant ne gère aucun droit : il lit `membres`, vérifie une fois qu'il a la case,
et obéit. Un membre du hub sans cette case est renvoyé à son écran de connexion avec
l'explication — pas devant une page vide qu'il prendrait pour une panne.

### Trois modèles de partage coexistent

| Donnée | Modèle | Pourquoi |
|---|---|---|
| `idees`, `cueillette` | Lecture partagée, écriture personnelle | Un carnet d'idées se lit à plusieurs ; c'est le propriétaire qui les met en œuvre |
| `achats`, `fournisseurs` | Cloisonnées par `proprietaire` | Des achats et des mots de passe ne se lisent pas à plusieurs |
| `taches` | Cloisonnée par `creePar`, **superadmin compris** | Une liste de corvées personnelles n'a pas de lecteur légitime autre que soi |

Le patron à copier pour une future collection cloisonnée : un champ de propriété immuable
sur chaque document, un `where` **obligatoire** côté client (sans lui la page est
*entièrement* vide, pas partielle), et quatre règles séparées par opération.

**`taches` est le seul lot sans passe-droit superadmin**, et c'est délibéré : partout
ailleurs la clause `superadmin() ||` existe pour que l'impersonation affiche quelque chose.
Ici elle n'aurait aucune justification, et la page dit franchement pourquoi elle est vide
sous impersonation plutôt que de laisser croire à une panne. `test-taches.js` échoue si la
clause réapparaît.

### ⚠ Ce que la garde JavaScript ne fait pas

Le site est **statique** et le dépôt **public**. N'importe qui peut télécharger
`exterieur/index.html` : cette page n'est pas secrète et ne le sera jamais.

Ce qui protège réellement, ce sont les **règles Firestore**. Sans droit sur la
collection, la page s'affiche — vide. Autrement dit :

- la **structure** (l'existence d'un projet, ses libellés, son code) est publique ;
- les **données** sont protégées côté serveur.

Tant que rien de confidentiel n'est écrit en dur dans le HTML, c'est sain. Le jour où
ce ne serait plus vrai, il faudrait passer le dépôt en privé (GitHub Pro) — ce qui ne
changerait d'ailleurs rien à la protection des données, seulement à celle du code.

### Ajouter un projet — trois gestes indissociables

1. une entrée dans `PROJETS` (`projets.js`) ;
2. un dossier à la racine avec un `index.html` dont le `<body>` porte
   `data-projet="<slug>"` et `data-racine="../"` ;
3. **un bloc `match` dans `firestore.rules`** pour sa collection.

Sauter le point 3 donne une page qui s'affiche et ne charge rien : c'est le catch-all
`allow read, write: if false` qui ferme toute collection non déclarée.

`PROJETS` ne contient que **les pages du hub lui-même**. Un site hébergé ailleurs n'y entre
pas, même s'il partage ce projet Firebase : son accès se donne dans `sites.js`, en un bloc
pour tout le site.

### Impersonation

Depuis la page Membres, l'icône masque affiche le hub tel que le voit la personne
choisie : menu, tuiles et gardes suivent ses droits. Un bandeau rayé le rappelle en
permanence, et ça meurt avec l'onglet (`sessionStorage`).

**C'est un aperçu d'interface, pas un bac à sable.** Les requêtes partent toujours avec
le jeton du superadmin : Firestore continue de tout autoriser. On voit ce que l'autre
verrait, on ne subit pas ses restrictions — donc ça ne sert pas à tester les règles.
Pour ça, utiliser le *Rules Playground* de la console Firebase.

### Modèle de données — collection `membres`

Identifiant du document = **email en minuscules** : les règles retrouvent la fiche de
l'appelant en une lecture, sans requête.

| Champ | Type | Détail |
|---|---|---|
| `nom` | string | Nom affiché |
| `role` | string | `membre` / `superadmin` |
| `projets` | array | Slugs de projets autorisés (vide pour un superadmin, qui a tout) |
| `sites` | array | Slugs de sites visibles sur son accueil (vide pour un superadmin) |
| `actif` | bool | `false` = refusé à la connexion, droits conservés |
| `createdAt`, `updatedAt` | timestamp | Horodatage serveur |

### Modèle de données — collection `idees`

| Champ | Type | Détail |
|---|---|---|
| `numero` | int | Numéro lisible (#7), attribué à la création (max + 1) |
| `titre` | string | Obligatoire |
| `detail` | string | Texte libre |
| `projet` | string | **Liste fermée** — libellé issu de `PROJETS` ou de `SITES`, filtré par les droits |
| `creePar` | string | Email de l'auteur — sert de titre de propriété |
| `importance` | string | `haute` / `normale` / `basse` |
| `complexite` | string | `''` / `S` / `M` / `L` |
| `etat` | string | `idee` / `a_creuser` / `a_faire` / `en_cours` / `faite` / `abandonnee` |
| `createdAt`, `updatedAt` | timestamp | Horodatage serveur |

Le tri par défaut est **quick wins d'abord** : importance décroissante, puis
complexité croissante. Une idée `haute` + `S` est signalée par un badge ⚡.

La page écoute Firestore en temps réel (`onSnapshot`) : une idée saisie sur le
téléphone apparaît sur le PC sans rechargement.

#### Carnet commun, écriture personnelle

**Tout le monde lit tout** — c'est le but d'un carnet d'idées, et c'est le propriétaire
qui lit celles des autres pour les mettre en place. La lecture n'étant pas cloisonnée,
aucun `where` n'est nécessaire côté client, contrairement à la page Comptes du site
Collections.

**En écriture, chacun ne touche qu'aux siennes.** `creePar` porte l'email de l'auteur et
sert de titre de propriété ; le superadmin, lui, corrige tout, puisque c'est lui qui trie
et met en œuvre.

À l'écran, ça donne : une colonne « Par », un sélecteur d'état grisé sur les idées des
autres, une icône œil au lieu du crayon, et une modale qui s'ouvre quand même — la lire
est utile — mais en lecture seule, sans bouton Enregistrer ni Supprimer. Un filtre
« Les miennes » apparaît dès qu'il y a plus d'un auteur.

`creePar` est écrit avec l'utilisateur **réel**, jamais l'impersonné : la règle Firestore
compare ce champ au jeton de l'appelant, une idée saisie sous impersonation serait donc
refusée à la création. Le *droit de modifier*, lui, suit le rôle vu à l'écran, comme le
menu et les gardes.

#### Le champ `projet` : une liste fermée, filtrée par les droits

Ce n'est plus du texte libre. Le menu déroulant réunit **les deux registres** — les
projets de `projets.js` et les sites de `sites.js` — chacun filtré par le tableau de droits
correspondant de la fiche membre. On ne note une idée que sur ce à quoi on a accès.

Effet de bord accepté : les droits « sites » se mettent à conditionner une saisie, en plus
de l'affichage — une raison de plus de ne pas les traiter comme de simples cases de
présentation (voir « Un site n'est plus forcément décoratif »).

C'est le **libellé** qui est stocké, pas le slug. Les idées d'avant portaient déjà
« O'Fil du Doubs » ou « Collections », qui sont exactement des noms de sites : stocker le
slug aurait orphelinné toutes ces valeurs d'un coup. Revers de la médaille — **renommer un
`nom` dans un registre orpheline les idées qui s'y rattachaient**. Elles réapparaissent
alors dans un groupe « Hérité » du menu déroulant, sélectionné par défaut, pour ne jamais
perdre la valeur en silence au premier enregistrement.

> **Les idées d'avant `creePar` n'ont pas d'auteur.** Elles restent visibles — la lecture
> n'est pas cloisonnée — mais seul le superadmin peut les modifier, et la colonne affiche
> « — ». Comme il était seul à écrire jusque-là, un bandeau lui propose de se les
> attribuer en un clic.

### Modèle de données — collection `exterieur`

**Un seul tiroir pour tout le chantier**, discriminé par un champ `type`. Les neuf
vues de la page ne sont que des filtres sur cette étiquette, et un unique
`onSnapshot` les alimente toutes.

Pourquoi pas une collection par type : le besoin central est un **fil unique**
mêlant devis, mails, photos et tâches, trié du plus récent au plus ancien. Avec
plusieurs collections, il faudrait interroger chacune puis fusionner et retrier à
chaque affichage — et la recherche ne verrait qu'un morceau des données. Ici,
chercher « paysagiste » ramène aussi bien un mail qu'une fiche contact.

Champs communs :

| Champ | Type | Détail |
|---|---|---|
| `type` | string | `tache` / `email` / `document` / `image` / `note` / `contact` / `lien` / `projet` |
| `titre` | string | Obligatoire pour `document`, `tache`, `lien` ; dérivé pour `email` et `image` |
| `creePar`, `modifiePar` | string | Email de l'utilisateur **réel** (voir plus bas) |
| `creeLe`, `modifieLe` | timestamp | `creeLe` = date d'**archivage** |
| `dateEvenement` | timestamp | Quand la chose s'est **produite** — c'est elle qui ordonne le fil |

**Deux dates, deux usages.** `dateEvenement` ordonne le fil, `creeLe` alimente le
bloc « Mouvement ». Sans cette distinction, archiver dix vieux mails d'un coup les
propulserait en tête du fil, et « 10 éléments cette semaine » laisserait croire à
une activité qui n'a pas eu lieu.

Champs des éléments **actionnables** (`tache`, `email`, `document`) :

| Champ | Type | Détail |
|---|---|---|
| `camp` | string | `a_nous` / `a_eux` / `clos` — absent = non actionnable |
| `campDepuis` | timestamp | Réécrit **automatiquement** à chaque changement de `camp` |
| `journal` | array | Les événements de l'élément — voir plus bas |
| `dateEcheance` | timestamp | Facultatif, tâches surtout |
| `assigneA` | string | Étiquette issue de `intervenants` |
| `contactId` | string | Id du document `contact` lié |
| `sujet` | string | Texte libre (« terrasse », « clôture ») — regroupe les devis à comparer |

Champs propres à chaque type :

| Type | Champs |
|---|---|
| `image` | `url`, `categorie` (`actuelle` / `projection`), `imageSourceId` |
| `document` | `url`, `nomFichier`, `titre` **obligatoire** |
| `email` | `url` (absent si collé), `de`, `a`, `objet`, `dateEnvoi`, `corps`, `corpsTronque`, `emlBrut`, `sens`, `parseOk` |
| `contact` | `nom`, `prenom`, `entreprise`, `telephone`, `email`, `commentaire`, `categorie` |
| `lien` | `url`, `titre`, `commentaire` |
| `projet` | Singleton d'id `_projet` : `budgetNotes`, `ceQuonVeut`, `ceQuonNeVeutPas`, `intervenants`, `nosAdresses` |

#### `camp` : la balle est dans quel camp ?

Un fil chronologique raconte ce qui s'est passé, pas où on en est. La vue par
défaut est donc **« Où on en est »**, et tout repose sur un seul champ :

| Valeur | Sens | Effet à l'écran |
|---|---|---|
| `a_nous` | On doit faire quelque chose | Colonne « À nous » |
| `a_eux` | On attend un tiers | Colonne « En attente », avec l'ancienneté |
| `clos` | Réglé | Sort du tableau de bord, reste dans le fil |

**Il n'est jamais demandé à la saisie**, il est déduit du contexte : un mail envoyé
donne `a_eux` (on attend une réponse), un mail reçu ou un devis donnent `a_nous`.
Trois boutons corrigent en un clic quand la déduction se trompe, et `campDepuis`
repart alors de zéro. C'est ce qui produit « à eux depuis 18 jours — à relancer »
sans qu'aucune date n'ait jamais été saisie. Le seuil est de 15 jours
(`SEUIL_RELANCE_JOURS`).

**Aucune barre de progression, et c'est délibéré.** Afficher « 40 % du projet »
supposerait de connaître le total des tâches, faux par nature dans un chantier qui
se découvre en avançant. On montre le mouvement réel, y compris son absence
(« rien n'a bougé depuis 9 jours »).

#### `journal` : une tâche est une suite d'événements

Le camp seul ne retient que le **dernier chapitre**. « Écrire à Untel » n'est pas un
état : on écrit, on attend, on apprend que la personne n'est pas disponible, on
renonce. Trois mois plus tard, `clos` ne dit pas *pourquoi*.

Chaque bascule de camp passe donc par une modale **« Que s'est-il passé ? »**, et le
commentaire rejoint un tableau `journal` sur le document :

| Champ de l'entrée | Type | Détail |
|---|---|---|
| `le` | `Date` | ⚠ Horloge du **navigateur** — voir ci-dessous |
| `par` | string | Email de l'utilisateur **réel**, comme `creePar` |
| `texte` | string | Facultatif, coupé à `MAX_EVENEMENT` (500) |
| `camp`, `campAvant` | string | Présents seulement si l'entrée accompagne une bascule |

**Le commentaire reste facultatif** (« Sans note » écrit quand même) : un outil
nourri à la main ne survit pas si chaque geste coûte une phrase obligatoire. On peut
aussi noter un événement **sans** rien basculer — « relancé par téléphone, sans
réponse ». La dernière entrée s'affiche sur la carte, l'histoire complète dans la
modale, et la recherche balaie les textes du journal : « pas disponible » n'est
souvent écrit nulle part ailleurs.

Trois décisions à ne pas défaire :

- **Un tableau, pas une sous-collection.** Toute la page vit sur un seul `onSnapshot`
  de `exterieur` ; une sous-collection y serait invisible et demanderait un écouteur
  par tâche. Un tableau arrive avec le document.
- **`arrayUnion`, jamais une réécriture du tableau.** À deux, deux événements ajoutés
  en même temps doivent survivre tous les deux. C'est aussi ce qui rend l'ajout sûr
  sur les documents déjà en base, qui n'ont pas le champ : `arrayUnion` le crée.
- **`serverTimestamp()` est INTERDIT par Firestore dans un élément de tableau.** D'où
  `new Date()` : la date peut mentir de quelques secondes, sans conséquence là où on
  lit des jours. « Corriger » ce point ferait rejeter l'écriture entière.

**Aucune migration.** La ligne « Création » en tête du journal n'est jamais stockée :
elle se déduit de `creeLe` / `creePar`. Les tâches saisies avant le journal ont donc
une histoire cohérente sans qu'une seule donnée ait été réécrite. Une entrée ne
s'efface pas non plus : un journal qu'on peut retoucher n'est plus une trace — une
erreur se corrige par une entrée de plus.

#### Photos et projections : le lien est porté par la projection

Une projection est faite **à partir d'**une photo du terrain, et on veut, en regardant
un coin du jardin, revoir tout ce qu'on a imaginé dessus. Le champ `imageSourceId`
vit sur l'image de catégorie `projection` et pointe vers l'image `actuelle`.

Ce sens-là et pas l'autre : une liste `projectionIds` sur la photo devrait être tenue
d'accord avec la réalité à chaque suppression, et laisserait des références mortes.
Un champ unique se rattache en **une écriture sur un seul document**, et la vue
« Aujourd'hui » lit le lien à l'envers, ce qui n'est qu'un filtre (`projectionsDe`).

**La relation n'est pas symétrique**, et l'interface le montre : une projection
découle d'**une** photo et d'une seule — c'est le sens du champ unique — alors qu'une
photo en porte autant qu'on veut. Une projection déjà rattachée n'apparaît donc pas
dans les rattachables d'une autre photo : un clic la volerait à la première sans rien
dire. Pour la déplacer, on la détache d'abord, depuis la photo qui la porte ou depuis
sa propre fiche. Quand il ne reste rien à proposer, une phrase le dit plutôt que de
laisser un menu absent.

« Déjà rattachée » se lit sur la source **vivante**, pas sur le champ : une projection
dont la photo d'origine a été supprimée n'est plus rattachée à rien et redevient
proposable.

Le rattachement se fait dans la visionneuse, dans les deux sens, et la vignette
annonce le nombre de projections sans qu'on ait à ouvrir. Détacher écrit une chaîne
vide plutôt que de supprimer le champ, et une photo d'origine disparue se **dit**
au lieu de faire disparaître le lien — même tolérance que pour un contact supprimé.

#### Deux listes qui se remplissent toutes seules

La fiche `_projet` porte `nosAdresses` et `intervenants`. À chaque ouverture,
l'adresse et le prénom de la personne connectée s'y ajoutent (`set(merge)` +
`arrayUnion`, jamais `update()` — le document n'existe pas au premier lancement).
Au bout d'une visite chacun, la déduction envoyé/reçu et l'assignation des tâches
fonctionnent sans qu'une seule saisie ait été demandée.

Ça évite au passage d'avoir à lire l'annuaire des membres, que les règles
n'autorisent de toute façon pas : un membre ne lit que sa propre fiche.

#### Traçabilité : l'utilisateur RÉEL

`creePar` / `modifiePar` reçoivent `HUB.user.email`, **jamais** `HUB.effectif.email`.
Sous impersonation, les écritures partent bel et bien avec le jeton du superadmin :
inscrire l'identité impersonnée ferait mentir la trace.

C'est de la traçabilité applicative, pas une piste d'audit : c'est le client qui
écrit ces champs. Suffisant pour dire « qui a fait quoi » entre deux personnes de
confiance.

### Fichiers : Cloudinary, et ses deux limites

Images, PDF et `.eml` partent sur **Cloudinary** (compte `dxoyqxben`, partagé avec
BilletsTouristiques). Firebase Storage imposerait le plan Blaze. Firestore ne
stocke que les URLs.

⚠ **Action manuelle, à faire une fois** — créer dans la console Cloudinary un
second preset non signé, sans toucher au preset `billets-touristiques` qui fait
tourner l'autre site :

| Réglage | Valeur | Pourquoi |
|---|---|---|
| Nom | `ofildudoubs-hub` | Ne pas mélanger les quotas des deux sites |
| Signing mode | **Unsigned** | Pas de clé secrète dans une page publique |
| Resource type | **Auto** | Sinon les `.eml` (type `raw`) sont refusés |
| Folder | `hub/exterieur` | |
| Use filename | **Off** | |
| Unique filename | **On** | Sinon l'URL d'un devis est **devinable** |

Les deux dernières lignes ne sont pas cosmétiques : ce qui part sur ce CDN public
et sans authentification, ce sont des devis chiffrés et des mails contenant des
coordonnées d'artisans.

> **⚠ Une suppression n'est pas un effacement.** Supprimer un élément supprime le
> document Firestore **uniquement** — le fichier reste chez Cloudinary. L'effacer
> exigerait la clé secrète du compte, qu'on ne peut pas mettre dans une page
> publique. Conséquences : le stockage grossit lentement sans jamais diminuer, et
> **il ne faut pas déposer ici ce qu'on pourrait vouloir faire disparaître pour de
> bon**. Ménage manuel possible depuis la console Cloudinary.

**Si le téléversement d'un `.eml` échoue là où un PDF passe :** certains comptes
bloquent les fichiers `raw` en mode non signé. Repli prévu — stocker le texte brut
dans un champ `emlBrut` du document Firestore. Le fichier est de toute façon lu et
analysé côté navigateur ; on ne perdrait que le fichier retéléchargeable.

### Déposer : la devinette ne décide que par défaut

Le type d'un fichier déposé est déduit de son extension — `.eml` → mail, image →
photo, tout le reste → document. C'est ce qui permet de déposer sans rien saisir, et
ça se trompe forcément un jour : **un plan scanné en PNG est un document, pas une
photo du terrain**, et aucune extension ne le dira jamais.

D'où trois chemins, du moins cher au plus explicite :

| Geste | Ce qui décide |
|---|---|
| Zone « Déposer un fichier », ou glisser-déposer | L'extension |
| « Un document » / « Une photo » / « Un mail » dans la modale Ajouter | **Vous** |
| « Déposer un document » depuis la vue Documents, « Déposer un .eml » depuis Emails | **Vous** — ranger *ici* range ici |

Quand l'intention est exprimée, le filtre du sélecteur de fichiers s'ouvre en
conséquence : « Un document » accepte **n'importe quel** fichier (`.dwg`, `.xlsx`…),
sinon la promesse ne serait pas tenue.

Et si la devinette est déjà passée à côté, un sélecteur **« Ranger comme »** dans la
fiche corrige document ↔ image sans retéléverser — supprimer puis redéposer
laisserait le fichier chez Cloudinary, qu'on ne sait pas effacer. Le couple s'arrête
là : un mail a une structure (`de`, `a`, `objet`, `corps`) qu'un devis n'a pas, une
tâche n'a pas de fichier du tout, et convertir perdrait quelque chose en silence.
Reclasser vers un type non actionnable **vide le `camp`** — sans quoi l'élément
resterait sur le tableau de bord sans plus aucun bouton pour l'en sortir.

### Archiver un mail : le fichier ou le presse-papier

Depuis Gmail **sur ordinateur** : ⋮ → *Télécharger le message*, puis déposer le
`.eml`. Expéditeur, destinataires, objet, date et corps sont extraits
automatiquement, et le sens (envoyé / reçu) est déduit de `nosAdresses`.

L'application Gmail **mobile** ne sait pas télécharger un `.eml`. D'où **« Coller un
mail »**, qui accepte deux formes sans rien demander :

- la **source complète** (⋮ → *Afficher l'original*) : de vraies en-têtes RFC, que
  l'analyseur `.eml` comprend entièrement — même pré-remplissage qu'un fichier ;
- le **message copié à la souris** : aucune en-tête exploitable, le texte entier
  devient le corps et l'expéditeur et l'objet restent à compléter. `parseOk` reste
  **vrai** — ce drapeau dit « le pré-remplissage est fiable », pas « tous les champs
  sont remplis ». Rien n'a échoué : il n'y avait pas d'en-tête à lire.

⚠ **Un mail collé n'a pas de fichier d'origine à relire.** Le corps est abrégé à
`MAX_CORPS` pour ne pas alourdir un snapshot qui retélécharge tout le tiroir ; le
texte intégral part donc dans `emlBrut`, ce champ retiré du snapshot et lu à la
demande. `corpsComplet()` se replie sur le brut lui-même quand l'analyseur `.eml`
n'en tire rien — sans quoi « Copier le corps » collerait une version tronquée dans
Gmail, en silence.

Si le format d'un `.eml` n'est pas compris, `parseOk` passe à `false` : le fichier est
conservé quand même, un avertissement s'affiche et tous les champs restent
saisissables à la main. **Un format exotique ne doit jamais faire perdre un mail.**

### Aucune règle Firestore à publier pour ce projet

Le bloc `match /exterieur/{document}` existe déjà et couvre tous les types du
tiroir — conséquence directe du choix d'une collection unique. C'est le seul lot du
hub dans ce cas, autant l'écrire noir sur blanc pour éviter qu'on le cherche.

### Projet `taches` — la to-do priorisée

Le problème n'était pas de lister des tâches, c'était que **rien ne signale un retard**.
Une échéance manquée dans Google Calendar disparaît simplement du champ de vision : elle
n'est pas en retard, elle n'est plus là. Toute la page tient à ça.

#### ⚠ Un seul axe est saisi à la main, et c'est la décision centrale

La matrice d'Eisenhower a deux axes, mais ils ne vieillissent pas de la même façon.
L'importance d'une tâche ne bouge pas toute seule ; **son urgence, si** — c'est la
définition du mot.

Un `urgent = oui` coché il y a trois semaines a donc exactement le défaut qu'on reproche au
calendrier : l'information se périme sans que rien ne bouge. Et un `urgent = non` sur une
tâche due demain est faux. D'où :

- **Important** — case à cocher, elle seule ;
- **Urgent** — *calculé* à chaque affichage : échéance dans les `JOURS_URGENCE` (7) jours.
  Une tâche traverse la frontière toute seule en vieillissant, sans entretien ;
- **`urgentForce`** — le seul rattrapage manuel, pour l'urgence qu'aucune date ne dit
  (« rappeler le plombier avant qu'il ne parte »).

Bénéfice secondaire, la saisie tombe à trois gestes : un titre, une case, une date.

#### ⚠ Une seule date — et pourquoi on est revenu en arrière

Le projet a d'abord séparé deux dates : `echeance` (avant quand ça doit être fait) et
`creneauJour` + `creneauHeure` (quand je m'y colle). L'argument était solide sur le papier —
les confondre est la maladie de Google Calendar, où une contrainte devient un rendez-vous et
passe sans rien dire.

**L'usage a tranché contre.** Sur 38 tâches réelles au 24 août 2026 :

| Cas | Nombre |
|---|---|
| Les deux champs, **même date** | **20** sur 26 |
| Les deux, dates différentes | 6 (dont 3 ouvertes) |
| Échéance seule | 3 |
| **Créneau seul** | **0** |

Le formulaire demandait deux dates, on répondait deux fois la même. La distinction était
juste en théorie et vide en pratique — pire, elle donnait l'impression d'un doublon à chaque
saisie, ce qu'elle était devenue.

Il reste **une date, avec une heure facultative**. Et le classement s'est réparé tout seul :
avant, une tâche qu'on faisait dans deux heures tombait dans « Le reste », parce que le
créneau ne pesait rien sur la priorité — seule l'échéance comptait. Maintenant sa date *est*
son échéance : elle est urgente, et elle remonte.

**Ce qu'on a perdu**, et qu'il faut assumer plutôt que redécouvrir :

- « dû vendredi, je le fais mardi » n'est plus exprimable ;
- les signaux *planifié après l'échéance* et *urgent sans créneau* ont été supprimés.

Il reste un seul signal de ce groupe : **l'heure passée**. La tâche est due aujourd'hui,
l'heure qu'on s'était fixée est derrière nous, mais la journée n'est pas finie — ce n'est
donc **pas** un retard, et les confondre reviendrait à crier au loup un jour trop tôt.

⚠ **Ne pas refaire la séparation** sans nouvelles données d'usage. Elle a été essayée,
mesurée, et retirée pour cette raison-là.

#### La vue Semaine

Second onglet de la même page — même donnée, deux regards : la liste dit *dans quel ordre*,
la grille dit *quand*. Construite à la main, sans librairie : sept colonnes, des blocs
positionnés au pixel depuis des minutes. FullCalendar passerait la CSP mais pèserait plus
lourd que tout le hub réuni.

Deux étages, et leur séparation **est** le sujet de la vue : les tâches **sans heure** en
bandeau au-dessus de la grille (les poser dans les heures leur en inventerait une), celles
**à heure fixe** en blocs dans les heures.

On pose une heure en **cliquant une case vide** — pas en glissant : le glisser-déposer tient
mal au doigt, or c'est sur le téléphone qu'on replanifie, et il serait intestable hors
navigateur. ⚠ Depuis la fusion, **poser une heure déplace la date** : il n'y en a plus
qu'une. Le compteur de reports s'en aperçoit si la date recule, comme partout ailleurs.

Deux tâches dont les heures se chevauchent se répartissent en **voies parallèles**, comptées
par grappe de chevauchements et non par journée : un doublon à 9 h ne doit pas rétrécir tout
le reste de la journée, qui n'y est pour rien. Et la plage horaire s'étend d'elle-même si
une heure tombe hors des bornes — une tâche à 6 h ne doit pas devenir invisible.

Sur téléphone, la grille **défile horizontalement** plutôt que de passer à une vue « un jour
à la fois » : du code en moins, et la semaine reste sous les yeux au moment précis où on
planifie.

Sous 34 px de haut — soit moins de 45 min — un bloc passe en **mode compact** : l'heure
s'efface au profit du titre. C'est l'inverse qui se produisait, et un créneau de 15 min
devenait une pastille muette ; or la position verticale du bloc dit déjà l'heure, et
l'infobulle la donne en toutes lettres.

#### Quatre blocs, dans cet ordre, et le retard passe devant

**En retard** → **Urgent** → **Important non urgent** → **Le reste**. L'ordre de la
constante `BLOCS` *est* la priorité ; les blocs vides ne s'affichent pas.

À l'intérieur d'un bloc, l'ordre est **important → date → heure → ancienneté**.

L'important passe devant y compris parmi les retards : c'est le cas du retour de vacances —
quarante retards d'un coup, triés par ancienneté, mettraient la même croûte en tête pour
toujours pendant que l'important pourrit trois écrans plus bas.

L'**heure ne départage qu'à date égale** : c'est la date qui commande. Deux tâches du même
jour, l'une à 12 h 45 et l'autre à 19 h, se lisent dans cet ordre-là. Une tâche sans heure
passe en dernier, pour la même raison qu'une tâche sans date : n'avoir décidé d'aucun moment
n'est pas un rang.

#### ⚠ Le compteur de reports — ce qui manque à tous les todos

« Le retard remonte en tête » marche pour trois tâches, pas pour quarante : au bout de
quelques semaines, le haut de la liste redevient le mur qu'on voulait éviter et le
mécanisme s'auto-annule. Il faut donc pouvoir **dégonfler le tas** — deux boutons de report
sur les seules tâches en retard — et surtout **compter les reports**.

Une tâche reportée `REPORTS_ENLISEMENT` (3) fois n'est plus en retard : elle est morte. Le
badge vire au rouge, un avertissement le dit en toutes lettres en haut de page. C'est le
seul endroit qui autorise enfin à abandonner.

**Le compteur ne vaut que s'il ne ment pas.** Dater une tâche qui n'avait pas de date, ou
corriger une saisie vers l'arrière, n'est *pas* un report — sinon il gonfle tout seul, on
cesse de le regarder, et le signal disparaît. La décision est centralisée dans
`champsDeReport()`, et six assertions la verrouillent.

#### Le compteur sur la tuile d'accueil, sans lequel rien ne signale rien

Le hub est **statique** : pas de serveur, donc ni mail ni notification. Un retard ne peut
se faire remarquer qu'à un seul endroit — l'accueil, la seule page qu'on ouvre sans y
penser. `index.html` charge donc `taches/taches-calcul.js` (fonctions pures, aucun DOM) et
`accueil.js` pose « N en retard » sur la tuile.

**La règle « en retard » n'est pas recopiée là-bas** : deux définitions auraient fini par
diverger, et la tuile annoncerait deux retards quand la page en montre trois. Si le
compteur échoue, il se tait — il ne doit jamais emporter l'accueil avec lui.

#### Modèle de données — collection `taches`

| Champ | Type | Détail |
|---|---|---|
| `titre` | string | Obligatoire |
| `detail` | string | Texte libre |
| `projet` | string | Libellé, liste fermée filtrée par les droits (comme `idees`) |
| `important` | bool | La seule qualification saisie à la main |
| `urgentForce` | bool | « Urgent tout de suite », pour l'urgence sans date |
| `echeance` | string | **`AAAA-MM-JJ`, pas un Timestamp** — quand c'est dû, ou quand je le fais |
| `echeanceHeure` | string | `HH:MM` ou `''` — **facultative**, chaîne locale sans fuseau |
| `echeanceDuree` | int | Minutes, liste fermée (15 → 480) |

**L'heure est facultative, et vide par défaut.** Elle se saisit en deux listes fermées — les
24 heures précédées d'une option vide, et les quatre quarts. Un `<input type="time">`
acceptait n'importe quelle minute et ouvrait, selon le navigateur, la liste des soixante :
imprenable au doigt, pour une précision qu'on n'a pas. Une minute héritée de ce temps-là
(14:37) est conservée dans la liste plutôt qu'arrondie en silence à la simple ouverture de
la modale. Une heure saisie sans date n'est pas écrite : elle ne voudrait rien dire.
| `faite` / `faiteLe` | bool / string | `faiteLe` est **vidé** à la réouverture, sinon le badge ment |
| `nbReports` | int | Combien de fois l'échéance a été repoussée |
| `echeanceInitiale` | string | La toute première date visée, écrite une seule fois |
| `creePar` | string | Email **réel** — titre de propriété *et* de lecture |
| `createdAt`, `updatedAt` | timestamp | Horodatage serveur |

**Pourquoi une chaîne et pas un Timestamp** : « en retard » est une question de *jour du
calendrier*, pas d'instant. Un Timestamp posé à minuit heure de Paris se relit la veille au
soir sous un autre fuseau, et la tâche bascule selon l'endroit d'où on regarde. Une chaîne
se compare telle quelle — l'ordre lexicographique de ce format est l'ordre chronologique —,
se pose dans un `<input type="date">` sans conversion, et rend les tests déterministes.
C'est le seul endroit du hub qui s'écarte du Timestamp : ailleurs on horodate un événement
qui a eu lieu, ici on vise un jour à venir.

Les écarts de jours passent par `Date.UTC`, jamais par une soustraction de dates locales :
deux fois par an, le changement d'heure rend 23 heures et ferait afficher « en retard de
0 j » à une tâche qui l'est d'un jour. Deux assertions le figent.

#### Les rappels Telegram — `notifieur/`

Le compteur sur la tuile ne parle que si l'on ouvre l'accueil ; une alerte qui suppose qu'on
aille la chercher n'est pas une alerte. Un **Worker Cloudflare** réveillé toutes les 5
minutes comble ce trou. Trois déclencheurs : **digest à 07:30** (créneaux du jour, retards,
urgences sans créneau), **rappel 15 minutes avant chaque créneau**, et **bilan à 20:00**.
Mise en place complète dans [`notifieur/README.md`](notifieur/README.md).

Le gîte de Labergement suit **un rythme à lui**, sur un **second canal Telegram** partagé
avec Alisson : six rappels répartis sur la veille et le jour même — demander l'heure
d'arrivée à midi, envoyer la procédure à 18 h, le code de la boîte le lendemain à midi, et
deux informations (« arrivée ce soir » à 17 h, « départ ce matin » à 11 h). Ce sont **six
gestes distincts, pas une même phrase répétée** : une répétition, on l'ignore ; une
séquence, on la suit. Chaque action nomme **qui écrit** — Airbnb va à Alisson, Booking et le
direct à Cyril — sans quoi on retombe sur « je pensais que tu t'en occupais ».

Les heures viennent de l'usage : 07:30 est trop tôt pour agir, 20:00 trop tard. Le bon
moment n'est pas celui où l'on peut *lire* mais celui où l'on peut *agir*. Les séjours sont
lus sur le calendrier iCal de `menage-state`, avec la plateforme, le nombre de personnes, la
langue, le prénom des voyageurs et le lien vers la réservation. C'est la seule partie du
notifieur qui ne parle pas de `taches`, et la seule qui dépende d'une source **externe** au
hub : sa panne coûte une section, jamais le message.

Le bilan du soir n'est pas le digest une seconde fois : il dit ce qui a glissé, et surtout
**ce qui bascule en retard cette nuit**. Une tâche bascule à minuit ; prévenu à 20 h, on
peut encore la finir ou repousser l'échéance délibérément. C'est pourquoi il n'existe pas
d'alerte « bascule en retard » séparée — elle serait arrivée trop tard, vers 00 h 05.

Il **réutilise `taches/taches-calcul.js`** plutôt que de recopier les règles — même argument
que pour le compteur d'accueil, avec un enjeu plus fort : une divergence de l'affichage
finit par se voir, une divergence du notifieur reste muette. Le fichier sert donc les deux
mondes, balise `<script>` et bundler, via un export gardé par `typeof module`.
`comparerDansBloc` et `rangerParBloc` en sont **volontairement exclus** : ils dépendent de
`toDate()`, absent du Worker.

**⚠ Pourquoi un compte robot et pas une clé de compte de service.** Le Worker se connecte
comme un utilisateur ordinaire, avec un compte email/mot de passe créé pour lui seul, et
subit donc les règles : `notifieur()` ne lui ouvre que la **lecture** de `taches`. Une clé
de compte de service aurait été plus courte à écrire — et les permissions IAM de Firestore
ne descendant pas au niveau de la collection, elle aurait lu `fournisseurs`, donc des mots
de passe en clair, pour envoyer un message Telegram.

L'adresse du robot vit dans `config.js` (`NOTIFIEUR_EMAIL`) **et** dans `firestore.rules`.
Un test échoue si les deux divergent : Firestore refuserait le robot, qui se tairait — ce
qui ressemble exactement à « rien à signaler ».

Le digest part **même les jours vides**, une ligne suffit. Sans ça, le silence voudrait dire
à la fois « rien à faire » et « le notifieur est cassé », et c'est précisément l'ambiguïté
que ce projet combat.

#### Ce qui n'y est pas, et pourquoi

**Les tâches récurrentes** (impôts, révision, ramonage) sont hors périmètre v1 : la
génération d'occurrences et le rattrapage des échéances manquées doublent la complexité, et
se conçoivent mieux une fois la liste vivante. Rien dans le modèle ne les empêche.

**Aucun pont avec le carnet d'idées.** La tentation existe — une idée passée « à faire »
ferait une jolie tâche — mais on ne saurait plus où est la vérité. Les deux collections
n'ont d'ailleurs pas le même modèle de partage : `idees` se lit à plusieurs, `taches` non.

**Aucun pont avec Google Calendar non plus.** Deux outils qui se recopient finissent
toujours par diverger, et c'est l'un des deux qu'on cesse de tenir à jour. Le hub est la
source de vérité de la planif — et depuis les rappels Telegram, la raison d'y retourner a
disparu. Si le besoin revenait : un export `.ics` est faisable côté client (mais c'est un
instantané, pas un abonnement), et une écriture via l'API Google l'est aussi, au prix d'un
scope supplémentaire et de la gestion des doublons et des suppressions.

**Pas de notification par membre.** Le notifieur écrit dans une seule conversation. Passer
au multi-membre demanderait un champ sur la fiche membre et un flux d'appairage, pour des
personnes qui n'ont pas encore le projet coché.

#### La bascule vers la date unique

Une bannière temporaire propose de basculer les tâches d'avant la fusion, sur le modèle de
« Me les attribuer » du carnet d'idées : un rattrapage de données se fait en **un geste
explicite**, jamais en silence au fil des enregistrements — sinon on ne sait jamais s'il est
terminé. Quand les deux dates diffèrent, **c'est le créneau qui devient la date** : c'est
celle qu'on avait décidée, elle porte l'heure, et c'est toujours la plus proche. À retirer
une fois qu'aucune tâche ne porte plus d'ancien `creneauJour`.

**Pas de vue Mois.** Les horaires n'y tiennent pas : on y verrait des pastilles, pas des
créneaux. Elle s'ajoutera sans rien casser le jour où le volume la rendra utile — le calcul
ne connaît que des jours et des minutes, il ne présuppose aucune grille.

### Projet `cueillette` — le calendrier du Haut-Doubs

Une seule question : **qu'est-ce que je vais récolter aujourd'hui**, entre 800 et 1200 m,
sur le secteur Mouthe – Labergement – Vaux-et-Chantegrue – Pontarlier – Frasne – Levier ?
Le périmètre est affiché en tête de page, pas seulement commenté : une fenêtre calculée
pour cette tranche d'altitude serait fausse ailleurs, et les fenêtres du référentiel
**intègrent déjà** le décalage phénologique local (deux à trois semaines de retard sur la
plaine au printemps, saison d'automne coupée net par la première vraie gelée).

#### Deux sources, et c'est toute l'architecture

| Source | Où | Ce qu'elle porte |
|---|---|---|
| **Référentiel** | `cueillette/especes.js`, versionné dans git | Ce qui est vrai bon an mal an : fenêtre théorique, biotope, altitude, effort/rendement, sosies dangereuses |
| **Forçages** | Collection Firestore `cueillette` | L'aléa de l'année : gelées tardives, canicule, arrêté préfectoral |

Le référentiel est de la **structure**, au même titre que `projets.js` : public, non secret,
revu en pull request. Une erreur de fenêtre envoie quelqu'un ramasser au mauvais moment —
autant qu'elle passe par un diff. Le mettre en base ferait perdre cette revue sans rien
apporter, puisqu'il ne change presque jamais.

#### ⚠ Un forçage porte une année, et c'est la décision centrale

`annee` est **obligatoire** sur chaque forçage, et un forçage de 2026 est ignoré en 2027.

Sans ce champ, on décalerait les morilles de douze jours pour cause de gelées tardives, on
oublierait, et le calendrier mentirait toutes les années suivantes. C'est la panne
silencieuse type : un calendrier faux reste un calendrier *plausible*, personne ne s'en
aperçoit, et l'outil devient pire que pas d'outil du tout. Un forçage périmé reste affiché,
barré — il documente l'année écoulée sans plus agir.

**Corriger durablement une fenêtre, ce n'est donc pas un forçage : c'est modifier
`especes.js`.** La page le dit à l'endroit où l'on saisit.

| Mode | Effet | Exemple |
|---|---|---|
| `decalage` | Translate début et fin de N jours (négatif = en avance) | Gelées tardives dans le val de Mouthe |
| `fenetre` | Impose des dates à la place des théoriques | Canicule : une seule poussée, du 1er au 20 août |
| `suspension` | Rien à récolter, ou récolte interdite | Arrêté préfectoral, massif fermé |

En cas de forçages concurrents sur la même espèce et la même saison, l'ordre est explicite —
`suspension` > `fenetre` > `decalage` — pour que l'affichage ne dépende pas de l'ordre de
lecture de Firestore. **Une interdiction ne se laisse pas écraser par un ajustement de
dates.** Le motif est obligatoire : dans six mois, un décalage de douze jours sans raison
écrite est inexploitable.

Lecture partagée, écriture personnelle, comme le carnet d'idées : « les gelées ont tout
décalé à Mouthe » n'a aucune valeur si chacun le garde pour soi, mais chacun ne défait que
ses propres observations.

#### Quatre statuts, pas trois

Les trois demandés — **En cours**, **Bientôt**, **Terminé** — plus un quatrième, **Plus
tard**, sans lequel le classement mentirait : fin juillet, le cèpe qui ouvre le 25 août
n'est ni en cours, ni bientôt (le seuil est de 21 jours), et le ranger dans « Terminé »
ferait passer la meilleure récolte de l'année pour une occasion manquée.

« Terminé » veut dire *fini pour cette saison*, et la saison est l'année civile : si la
prochaine occurrence tombe l'an prochain, c'est fini ; si elle tombe encore cette année,
c'est que ça n'a pas commencé.

#### Modèle de données — collection `cueillette`

Un document = **un forçage**, jamais une espèce.

| Champ | Type | Détail |
|---|---|---|
| `espece` | string | `id` du référentiel — ne pas renommer un `id` sans migrer |
| `annee` | int | **La saison visée.** Un forçage ne déborde jamais dessus |
| `mode` | string | `decalage` / `fenetre` / `suspension` |
| `jours` | int | Mode `decalage` uniquement, négatif si la saison est en avance |
| `debut`, `fin` | map | Mode `fenetre` uniquement — `{ mois, jour }`, sans année |
| `motif` | string | Obligatoire |
| `creePar` | string | Email de l'auteur **réel** — titre de propriété |
| `createdAt`, `updatedAt` | timestamp | Horodatage serveur |

Les périodes sont stockées en **mois/jour**, jamais en date absolue : une fenêtre se répète
d'une année sur l'autre, et c'est le code qui la projette sur une année concrète au moment
de la comparer à aujourd'hui. Les `<input type="date">` de la saisie portent une année
factice, qui est jetée.

#### Sécurité : ce que la page ne fait pas

Elle dit **quand** chercher, jamais si ce qu'on a dans le panier est comestible. Chaque
champignon du référentiel porte donc un champ `confusion` — le test le vérifie et refuse un
champignon qui n'en aurait pas — et un rappel réglementaire permanent figure en pied de
page (accord du propriétaire, plafond de quantité, horaires).

#### Et le « flux public » : il n'y en a pas, vérification faite

Le doute méritait d'être levé plutôt que supposé. Ce qui existe et pourquoi ça ne convient
pas :

- **[TEMPO / Observatoire des saisons](https://tempo.pheno.fr/donnees/portail-de-donnees)** —
  de vraies données phénologiques françaises, mais sur des *plantes* (débourrement,
  floraison), pas sur les champignons ; portail de téléchargement pour la recherche, pas API
  temps réel ; et aucune résolution au micro-climat du Haut-Doubs.
- **[GBIF](https://techdocs.gbif.org/en/openapi/)** — des millions d'occurrences datées,
  d'où l'on *pourrait* dériver une courbe de fructification. Mais ces dates mesurent d'abord
  l'effort d'observation (les gens sortent le week-end et en octobre), l'altitude n'y est pas
  filtrable de façon fiable, et c'est un traitement par lots, pas un flux. **Piste réelle
  pour calibrer le référentiel un jour ; pas une dépendance d'exécution.**
- **Arrêtés préfectoraux** — publiés en PDF, sans API. C'est précisément à ça que sert le
  mode `suspension`.
- Les calendriers grand public — corrects pour la France, faux de plusieurs semaines à 1000 m.

**Conclusion : référentiel interne, comme prévu.** Aucune dépendance réseau au-delà de
Firebase, et si Firestore tombe, la page affiche quand même les fenêtres théoriques en le
disant.

## Mise en place

### 1. Projet Firebase

1. [console.firebase.google.com](https://console.firebase.google.com) → **Ajouter un projet**
   (suggestion de nom : `ofildudoubs-hub`). Google Analytics inutile.
2. **Build → Authentication → Get started → Google → Activer**, puis enregistrer.
3. **Build → Firestore Database → Créer une base** → mode **production** →
   région `eur3 (europe-west)`.
4. Onglet **Règles** : coller le contenu de `firestore.rules`, **Publier**.
   ⚠ À refaire à chaque modification du fichier — les règles ne se déploient pas
   avec le site.
5. **Authentication → Settings → Authorized domains → Add domain** :
   `admin.ofildudoubs.fr` (et `collections.ofildudoubs.fr` si ce site partage le
   même projet Firebase). `localhost` y est déjà pour les tests.
6. **Paramètres du projet → Vos applications → Web (`</>`)** → enregistrer l'app →
   copier l'objet `firebaseConfig` dans `config.js`.

### 2. Dépôt GitHub + Pages

```bash
# le dépôt local est déjà initialisé et committé
git remote add origin https://github.com/Cyril25/Admin.git
git push -u origin main
```

Dépôt **public** (GitHub Pages sur dépôt privé demande un compte Pro). Ce n'est pas
un problème : le dépôt ne contient aucun secret, seulement des clés publiques par
conception.

Puis **Settings → Pages** : source `Deploy from a branch`, branche `main`, dossier
`/ (root)`. Le fichier `CNAME` renseigne automatiquement le domaine custom ; cocher
**Enforce HTTPS** une fois le certificat émis (quelques minutes).

### 3. DNS (OVH)

Le domaine `ofildudoubs.fr` est géré chez **OVH** — pas chez Cloudflare, qui n'héberge
que les Workers. Manager OVH → *Noms de domaine* → `ofildudoubs.fr` → onglet **Zone DNS**
→ **Ajouter une entrée** :

| Type | Sous-domaine | Cible |
|---|---|---|
| CNAME | `admin` | `cyril25.github.io.` |

Le point final de la cible est attendu par OVH (nom de domaine pleinement qualifié) ;
l'interface l'ajoute généralement toute seule, vérifier après validation.

Un CNAME ne peut pas coexister avec un autre enregistrement sur le même sous-domaine :
si OVH refuse, c'est qu'une entrée `admin` existe déjà, il faut la supprimer d'abord.

## Tests

```bash
node tests/run-tests.js
```

Aucune installation nécessaire. Voir `tests/README.md` pour ce qui est couvert — et
surtout pour ce qui ne l'est pas (les règles Firestore ne s'exécutent que chez Google).

## Développement local

Ouvrir les fichiers via un petit serveur (le `file://` casse l'auth Google) :

```bash
python -m http.server 8080
# puis http://localhost:8080/login.html
```

`localhost` est déjà dans les domaines autorisés de Firebase.
