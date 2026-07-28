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
| `style.css` | Feuille de styles unique |
| `firestore.rules` | Règles de sécurité à publier dans la console Firebase |
| `tests/` | Tests hors navigateur — `node tests/run-tests.js` |
| `CNAME` | Domaine custom GitHub Pages |

### Rôles et accès

- **Superadmin** — voit tout, y compris les projets créés plus tard, et gère les
  membres. Le propriétaire (`SUPERADMIN_EMAIL`) l'est *par son adresse*, indépendamment
  de sa fiche : c'est le filet qui empêche de se verrouiller dehors en supprimant son
  propre document.
- **Membre** — ne voit que les projets cochés sur sa fiche. Menu, tuiles d'accueil
  et accès aux données sont filtrés ensemble.

**Projets et sites sont deux choses différentes.** Un *projet* est une page du hub
adossée à une collection Firestore : le droit y protège de vraies données. Un *site*
n'est qu'un lien externe posé sur l'accueil : le cocher ou non ne relève que du confort
d'affichage, ces sites ayant leur propre protection. D'où deux listes séparées sur la
fiche membre — et aucune règle Firestore à écrire pour un site.

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
| `projet` | string | Texte libre, suggestions via datalist |
| `importance` | string | `haute` / `normale` / `basse` |
| `complexite` | string | `''` / `S` / `M` / `L` |
| `etat` | string | `idee` / `a_creuser` / `a_faire` / `en_cours` / `faite` / `abandonnee` |
| `createdAt`, `updatedAt` | timestamp | Horodatage serveur |

Le tri par défaut est **quick wins d'abord** : importance décroissante, puis
complexité croissante. Une idée `haute` + `S` est signalée par un badge ⚡.

La page écoute Firestore en temps réel (`onSnapshot`) : une idée saisie sur le
téléphone apparaît sur le PC sans rechargement.

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
| `dateEcheance` | timestamp | Facultatif, tâches surtout |
| `assigneA` | string | Étiquette issue de `intervenants` |
| `contactId` | string | Id du document `contact` lié |
| `sujet` | string | Texte libre (« terrasse », « clôture ») — regroupe les devis à comparer |

Champs propres à chaque type :

| Type | Champs |
|---|---|
| `image` | `url`, `categorie` (`actuelle` / `projection`) |
| `document` | `url`, `nomFichier`, `titre` **obligatoire** |
| `email` | `url`, `de`, `a`, `objet`, `dateEnvoi`, `corps`, `corpsTronque`, `sens`, `parseOk` |
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

### Archiver un mail

Depuis Gmail **sur ordinateur** : ⋮ → *Télécharger le message*, puis déposer le
`.eml` sur la zone Ajouter. Expéditeur, destinataires, objet, date et corps sont
extraits automatiquement, et le sens (envoyé / reçu) est déduit de `nosAdresses`.

L'application Gmail **mobile** ne permet pas de télécharger un `.eml` : c'est une
opération de bureau. Le mobile sert aux photos.

Si le format n'est pas compris, `parseOk` passe à `false` : le fichier est conservé
quand même, un avertissement s'affiche et tous les champs restent saisissables à la
main. **Un format exotique ne doit jamais faire perdre un mail.**

### Aucune règle Firestore à publier pour ce projet

Le bloc `match /exterieur/{document}` existe déjà et couvre tous les types du
tiroir — conséquence directe du choix d'une collection unique. C'est le seul lot du
hub dans ce cas, autant l'écrire noir sur blanc pour éviter qu'on le cherche.

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
