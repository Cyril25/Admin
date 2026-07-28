# Hub O'Fil du Doubs — `admin.ofildudoubs.fr`

Point d'entrée privé de mes projets : liens vers les sites et les consoles, et un
carnet d'idées trié par importance et complexité.

Accès réservé à **cyril.samson41@gmail.com**.

## Architecture

Même stack que [BilletsTouristiques](https://github.com/Cyril25/BilletsTouristiques) :
statique, sans build, hébergé sur GitHub Pages. Auth Google via Firebase, données
dans Firestore.

| Fichier | Rôle |
|---|---|
| `config.js` | **Le seul fichier à personnaliser** : config Firebase, emails autorisés, navigation |
| `auth.js` | Le vigile : init Firebase, garde des pages, en-tête, connexion/déconnexion |
| `login.html` | Page de connexion Google |
| `index.html` | Accueil : tuiles vers les sites et les consoles |
| `idees.html` / `idees.js` | Carnet d'idées (CRUD Firestore, filtres, tri) |
| `style.css` | Feuille de styles unique |
| `firestore.rules` | Règles de sécurité à publier dans la console Firebase |
| `CNAME` | Domaine custom GitHub Pages |

### Comment l'accès est protégé

Deux niveaux, et un seul compte vraiment :

1. **`config.js` / `auth.js`** — filtre côté client. Confort d'interface : un compte
   non autorisé est déconnecté avec un message clair. Ce n'est *pas* de la sécurité :
   le dépôt est public, ce code est lisible par tout le monde.
2. **`firestore.rules`** — la vraie barrière. Google refuse toute lecture ou écriture
   dont le jeton ne porte pas l'email autorisé. Même en trafiquant le JavaScript, on
   n'obtient rien.

Conséquence : **les deux listes doivent rester identiques.** Ajouter une adresse dans
`config.js` sans l'ajouter dans les règles donne une page qui s'affiche et ne charge
rien.

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

## Mise en place

### 1. Projet Firebase

1. [console.firebase.google.com](https://console.firebase.google.com) → **Ajouter un projet**
   (suggestion de nom : `ofildudoubs-hub`). Google Analytics inutile.
2. **Build → Authentication → Get started → Google → Activer**, puis enregistrer.
3. **Build → Firestore Database → Créer une base** → mode **production** →
   région `eur3 (europe-west)`.
4. Onglet **Règles** : coller le contenu de `firestore.rules`, **Publier**.
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

### 3. DNS (Cloudflare)

Un enregistrement à créer dans la zone `ofildudoubs.fr` :

| Type | Nom | Cible | Proxy |
|---|---|---|---|
| CNAME | `admin` | `cyril25.github.io` | **DNS only** (nuage gris) |

Le proxy Cloudflare (nuage orange) doit rester **désactivé** : il casse l'émission du
certificat Let's Encrypt de GitHub Pages.

## Développement local

Ouvrir les fichiers via un petit serveur (le `file://` casse l'auth Google) :

```bash
python -m http.server 8080
# puis http://localhost:8080/login.html
```

`localhost` est déjà dans les domaines autorisés de Firebase.
