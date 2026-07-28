---
title: 'Revue technique — tech-spec Extérieur (pilotage du chantier)'
slug: 'revue-technique-exterieur'
created: '2026-07-28'
status: 'a-arbitrer'
cible: 'tech-spec-exterieur-pilotage-chantier.md'
---

# Revue technique — tech-spec « Extérieur de la maison »

**Date :** 2026-07-28
**Portée :** revue de la spec *après* la revue adversariale (F1–F14 / R1–R8), croisée
avec le code réel des dépôts `Admin` et `BilletsTouristiques`.
**Numérotation :** reprise à **F15** — F1 à F14 sont déjà consommés par la revue
précédente (AC2 cite F14, AC26 cite F10).

Chaque point est marqué **vérifié** (lu dans le code) ou **supposé** (raisonnement non
confronté à une exécution) — convention du repo notes.

---

## Ce qui a été vérifié et se confirme exact

Toutes les affirmations de la spec qui portent sur le code existant sont justes. C'est
inhabituel, autant l'écrire :

| Affirmation de la spec | Vérification |
|---|---|
| D8 — `match /exterieur/{document}` déjà publié | ✅ `firestore.rules:84-86` |
| `onHubReady`, `HUB.user`, `HUB.effectif`, `aAcces`, `escapeHtml`, `showToast` dans `auth.js` | ✅ `auth.js:23-27, 59, 65, 94, 321` |
| `jsAttr` / `escapeAttr` à recopier depuis `idees/idees.js` | ✅ `idees/idees.js:106, 117` — bien absents de `auth.js` |
| Upload Cloudinary transposable | ✅ `BilletsTouristiques/admin.js:291-345`, cloud `dxoyqxben`, preset `billets-touristiques` (l.98-99) |
| AC2 — redirection vers l'accueil sans le droit | ✅ `auth.js:306-308` (garde `data-projet`) |
| AC1 — menu filtré par droits | ✅ `auth.js:175` (`projetsVisibles()`) + `l.180` (Membres réservé au superadmin) |
| `run-tests.js` ramasse `test-*.js` automatiquement | ✅ `tests/run-tests.js:20-22` |
| CSP actuelle sans Cloudinary (D7) | ✅ `exterieur/index.html:5` — ni `api.` en `connect-src`, ni `res.` en `img-src` |
| Classes `.tile` / `.badge` / `.filter-btn` / `.idees-table` réutilisables | ✅ `style.css:299, 412, 442, 531` |

---

## 🔴 F15 — Bloquant : la collection `exterieur` n'est pas vierge

**Vérifié.** D14 affirme « l'outil démarre vide ». C'est faux : `exterieur/exterieur.js`
(l.255-267) écrit déjà dans cette collection des documents de forme
`{ titre, periode, etat, notes, createdAt, updatedAt }` — **sans `type`, sans `creeLe`,
sans `dateEvenement`, sans `creePar`**.

Au premier chargement de la nouvelle page, ces documents entrent dans le `onSnapshot`,
leur `type` vaut `undefined`, donc :

- ils sont invisibles dans **toutes** les vues (qui filtrent sur `type`) ;
- le tri du fil sur `dateEvenement` absent est indéfini ;
- ils restent en base, facturés en lecture, sans jamais s'afficher.

C'est le pire cas : les tâches jardin existantes ne sont ni migrées ni supprimées, elles
disparaissent de l'écran en silence.

**Arbitrage nécessaire de Cyril** — deux options :

- **Migration** : script ponctuel qui pose `type: 'tache'`, `dateEvenement ← createdAt`,
  `creeLe ← createdAt`, `camp: 'a_nous'` (ou `'clos'` si `etat` = terminé). Reste à
  décider du sort de `periode` (Printemps/Été/Automne/Hiver) : le nouveau modèle ne
  prévoit rien pour un rythme saisonnier — soit vers `sujet`, soit abandonné.
- **Purge assumée** : la coquille n'a servi qu'à éprouver les droits de bout en bout
  (c'est ce que dit la fiche notes), donc on efface et on repart de zéro.

Dans les deux cas : **une Task 0, avant toute autre.** Et corriger D14, qui est faux en
l'état.

---

## 🟠 F16 — La vue « Tâches » est annoncée partout, implémentée nulle part

**Vérifié (lecture croisée de la spec).** D9 liste sept vues dont **Tâches**, Task 6 parle
de « la barre de sélection des sept vues », mais les Tasks 8 à 13 couvrent : état, fil,
images ×2, emails, carnet, projet. Aucun `exterieur-taches.js` dans `files_to_modify`,
aucune Task propriétaire.

Le compte ne tombe d'ailleurs pas juste : D9 (7 vues) + « Où on en est » = **8**
conteneurs, plus la vue « Résultats » introduite par Task 7 = **9**.

Même trou pour les **Documents** : le scope les cite (« devis PDF : upload et
consultation »), aucune vue ne les liste — or comparer des devis est le cœur du besoin
exprimé.

**Arbitrage** : soit deux Tasks de plus, soit acter que tâches et documents se lisent via
le filtre par type du Fil (défendable) — et alors les retirer du sélecteur et de D9.

---

## 🟠 F17 — Confidentialité Cloudinary sous-estimée

**Vérifié pour le mécanisme, supposé pour la devinabilité exacte des URLs.**

R4 conclut : « accessible seulement à qui connaît son URL exacte ». Avec un dossier fixe
`hub/exterieur` et un `public_id` dérivé du nom de fichier, `devis-terrasse-dupont.pdf`
produit une URL **devinable**.

Ce qui part sur ce CDN public, sans aucune authentification : des devis chiffrés, et
surtout des `.eml` — corps de mails, adresses personnelles, coordonnées d'artisans,
potentiellement l'adresse du domicile. Et R4 garantit qu'on ne pourra **jamais** les
effacer.

**Correctif à ajouter à Task 1**, gratuit : sur le preset `ofildudoubs-hub`, régler
**Use filename : Off** et **Unique filename : On** — le `public_id` devient aléatoire,
l'URL n'est plus devinable. Documenter dans le README que le stockage est public par URL,
en plus de la limite de suppression déjà prévue.

---

## 🟠 F18 — Décodage base64 UTF-8 dans l'analyseur `.eml` (Task 5)

**Vérifié (comportement standard de `atob`).** `atob()` rend du Latin-1. Un corps
`base64` avec `charset=UTF-8` — le cas normal d'un mail Gmail en français — ressortira en
`Ã©tÃ©` sans une passe explicite (`decodeURIComponent(escape(atob(s)))` ou `TextDecoder`).
Même piège sur les en-têtes `=?UTF-8?B?...?=`.

À écrire dans la Task : c'est garanti au premier test réel, et sournois, parce que
`parseOk` vaudra `true` — la dégradation prévue en D2 ne se déclenchera pas.

---

## 🟠 F19 — `multipart` imbriqué (Task 5)

**Supposé.** Gmail imbrique `multipart/alternative` dans `multipart/mixed` dès qu'il y a
une pièce jointe. « Retenir la partie `text/plain` » demande donc un parcours récursif
des boundaries, pas un simple découpage.

Cadrer explicitement : un seul niveau d'imbrication géré, `parseOk: false` au-delà, pièces
jointes ignorées. Sinon la Task 5 s'étale — c'est déjà le plus gros risque du lot.

---

## 🟠 F20 — `dateDemande` est supprimé mais AC6 et D16 l'utilisent encore

**Vérifié.** R7 remplace `dateDemande` par `campDepuis`, et le modèle de données ne le
contient effectivement plus. Mais :

- **AC6** : « un élément `camp = a_eux` dont **`dateDemande`** remonte à 18 jours » ;
- **D16** : « un élément `camp: 'a_eux'` portant un `contactId` et une **`dateDemande`** ».

Un agent dev qui implémente les AC recréera le champ supprimé. Purement rédactionnel,
mais à corriger avant de lancer le développement.

---

## 🟠 F21 — AC15 et D15 sont techniquement faux

**Vérifié (comportement navigateur).** `accept="image/*"` **n'ouvre pas l'appareil
photo** : iOS comme Android affichent un sélecteur (Photothèque / Prendre une photo /
Parcourir). Forcer la caméra demande `capture="environment"` — mais on perd alors l'accès
à la galerie.

La bonne réponse est **deux entrées** dans la vue Images : « Prendre une photo » (avec
`capture`) et « Choisir un fichier » (sans). Corriger AC15, qui promet un comportement
que le code ne pourra pas tenir.

---

## 🟠 F22 — `amorcerProjet()` : `set(merge)` + `arrayUnion`, pas `update()`

**Vérifié (API Firestore).** Le document `_projet` n'existe pas au premier lancement :

- un `update()` lèvera `not-found` — l'amorçage R3/R6 échouerait silencieusement pile
  dans le cas qu'il est censé couvrir ;
- un `set()` complet écraserait les notes de budget saisies par l'autre.

Écrire dans Task 3 :
`set({ nosAdresses: FieldValue.arrayUnion(email) }, { merge: true })`. Idempotent, sûr en
concurrence, et **cela neutralise au passage le risque « dernière écriture gagnante » de
D10** sur ces deux tableaux.

---

## 🟠 F23 — R6 utilise `HUB.effectif.nom`, ce qui contredit D18

**Vérifié.** `auth.js:185` confirme que `HUB.effectif` est bien la fiche *vue*, pas la
fiche réelle. Sous impersonation (Cyril affiché comme Alisson), l'amorçage inscrirait
Alisson dans `intervenants` et son adresse dans `nosAdresses` alors qu'elle ne s'est
jamais connectée.

Cela casse exactement la garantie que R3/R6 vendent — « au bout d'une visite chacun, la
liste est complète » — et peut fausser la déduction `envoye` / `recu` de R3.

Utiliser **`HUB.user`** pour les deux, comme D18. R3 dit d'ailleurs « la personne
connectée », ambigu : préciser.

---

## 🟡 Points mineurs (F24–F31)

- **F24 — `sujet` en texte libre ne groupera rien.** *Vérifié par lecture.* « terrasse » /
  « Terrasse » / « Terasse » font trois blocs, alors qu'AC8 suppose le regroupement
  acquis. Normaliser (minuscules + accents pliés) ou proposer un `<datalist>` des sujets
  déjà saisis.
- **F25 — la barre de progression de `admin.js` est un placebo.** *Vérifié*
  (`admin.js:385-387`) : `fetch` ne donne pas la progression d'upload, le code passe à
  30 % puis à 100 %. Sur un PDF de 10 Mo depuis un téléphone, c'est trompeur. Un vrai
  suivi demande `XMLHttpRequest.upload.onprogress` (~10 lignes). Task 4 dit « barre de
  progression déjà écrite : à transposer » — vrai, mais elle ne mesure rien.
- **F26 — le poids du snapshot, pas seulement le nombre de documents.** *Supposé.* D5
  justifie « quelques centaines de documents, aucun enjeu de performance ». Le
  raisonnement porte sur le *nombre*, pas sur la *taille* : avec le repli `emlBrut` de D6,
  chaque email pèse 20 à 100 Ko et **tout** est retéléchargé à chaque ouverture de page.
  Prévoir une troncature du `corps` stocké, ou l'exclure du chargement initial.
- **F27 — D5 oublie `projet`** dans la liste des valeurs de `type` (ajouté par D10,
  présent dans le tableau du modèle). La constante `TYPES` de Task 3 sera construite
  depuis D5.
- **F28 — AC3 est resté pré-R8** : « le titre est demandé et refusé s'il est vide » se lit
  comme l'ancien comportement, alors qu'AC24 dit l'inverse. Reformuler : « pré-rempli
  depuis le nom de fichier, refusé seulement s'il est vidé ».
- **F29 — la recherche insensible aux accents** (Task 7) suppose
  `String.prototype.normalize`, qui est ES6. Sans conséquence pratique, mais la spec pose
  « ES5 vanilla » comme contrainte dure : autant l'autoriser explicitement plutôt que de
  laisser quelqu'un réécrire une table de translittération à la main.
- **F30 — `toDate` / `formatDateFr` seront la 3ᵉ copie** (`idees.js`, `exterieur.js`,
  puis `exterieur-donnees.js`). Acceptable sur une stack sans build, mais c'est
  exactement la duplication que la fiche notes signale déjà pour `auth.js` et
  `style.css`. Un `hub-utils.js` partagé coûterait un `<script>`.
- **F31 — aucun AC ne couvre `assigneA`** (D13), alors que c'est la seule fonctionnalité
  vraiment « à deux » du lot.

---

## Ce qui tient et mérite d'être conservé tel quel

- **D11** (« la balle est dans quel camp ») répond au symptôme d'origine ; un fil
  chronologique n'y répondait pas. Le refus argumenté de la barre de progression est
  juste.
- **R1** (`camp` déduit, jamais demandé), **R5** (`dateEvenement` vs `creeLe`) et **R7**
  (`campDepuis`) sont des corrections de fond, pas des retouches.
- **D6** : le repli `emlBrut` et la dégradation obligatoire `parseOk: false` couvrent
  proprement le vrai risque technique du lot.
- **D5** : une seule collection, validée par le fait que le bloc de règles est déjà
  publié — seul lot du hub à ne demander aucune manipulation en console.

---

## Suite

1. Arbitrer **F15** (migration ou purge) et **F16** (vues Tâches / Documents) — ce sont
   des décisions produit, pas techniques.
2. Fondre F17 à F23 dans la spec, comme R1–R8 l'ont été (`542ede7`).
3. F24–F31 : à traiter au fil du développement, aucun ne justifie de retarder le départ.
