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
