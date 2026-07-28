---
title: 'Extérieur de la maison — pilotage du chantier'
slug: 'exterieur-pilotage-chantier'
created: '2026-07-28'
status: 'in-progress'
stepsCompleted: [1, 2]
tech_stack: ['HTML5', 'CSS3', 'JavaScript ES5 (vanilla, sans build)', 'Firebase v8.10.1 compat (Auth + Firestore)', 'Cloudinary (upload non signe)', 'GitHub Pages']
files_to_modify: ['exterieur/index.html', 'exterieur/exterieur.js', 'style.css', 'projets.js', 'config.js', 'tests/']
code_patterns: ['un fichier JS par page, scope global', 'onHubReady() comme point d entree', 'onSnapshot temps reel + filtrage client', 'escapeHtml/escapeAttr/jsAttr pour tout rendu', 'innerHTML construit par concatenation', 'modale overlay + Echap', 'SRI obligatoire sur les CDN']
test_patterns: ['harnais Node + module vm avec DOM minimal', 'assertions maison via verifie()', 'aucun framework, aucun npm']
---

# Tech-Spec: Extérieur de la maison — pilotage du chantier

**Created:** 2026-07-28

## Overview

### Problem Statement

Cyril et Alisson pilotent à deux l'aménagement extérieur de leur maison (terrain en
talus de 0,50 m à 3 m, enveloppe 15–20 k€, environ 50 m² de terrasses sur plots, 50 ml
de clôture, stabilisation végétale du talus). Les informations du chantier sont
aujourd'hui **éparpillées** : devis dans les mails, photos dans les téléphones,
coordonnées d'artisans dans les carnets, relances oubliées.

Trois conséquences concrètes :

1. **On cherche.** Retrouver le numéro d'un paysagiste ou une photo du talus demande de
   fouiller plusieurs outils.
2. **On réécrit.** Chaque nouveau paysagiste contacté impose de reformuler le même mail
   de demande de devis, alors qu'il a déjà été écrit trois fois.
3. **On oublie.** Un devis demandé il y a trois semaines sans réponse ne remonte nulle
   part tant que personne n'y repense.

### Solution

Une page du hub, accessible aux deux, qui rassemble **tout le chantier au même endroit** :
un **fil chronologique** (du plus récent au plus ancien) où atterrissent tâches, mails
archivés, devis PDF et photos, doublé d'un **carnet de contacts**. Une recherche unique
balaie le fil. Les tâches et relances dont la date est dépassée remontent visuellement à
l'ouverture de la page — rappel passif, sans notification.

### Scope

**In Scope:**

- **Fil chronologique unique**, du plus récent au plus ancien, mêlant tous les types
  d'éléments, avec recherche plein texte et filtres (type, date, contact lié).
- **Carnet** — les références intemporelles, sur une même page en deux sections :
  - **Contacts** : nom, prénom, entreprise, téléphone, email, commentaire. Un contact
    peut être rattaché à n'importe quel élément du fil.
  - **Liens** : URL, titre, commentaire (sites de génération d'images par IA,
    fournisseurs, inspirations, documentation technique…).
- **Emails archivés par dépôt du fichier `.eml`**, dont expéditeur, destinataires, objet,
  date et corps sont extraits automatiquement à l'upload. Objectif : relire, rechercher
  et **copier-coller un mail déjà écrit** vers un nouvel artisan, sans jamais rien
  ressaisir. C'est la réponse directe au besoin « ne pas devoir tout réécrire ».
- **Documents** (devis PDF principalement) : upload et consultation.
- **Une seule collection Firestore `exterieur`**, chaque fiche étiquetée par un champ
  `type` ; les pages sont des filtres sur cette étiquette.
- **Images** : upload, vignettes, consultation en grand.
- **Tâches** avec date d'échéance et état.
- **Relances** : date de relance saisie sur un élément ; à l'ouverture de la page, tout
  ce qui est échu ou proche remonte en tête.
- **Traçabilité** : chaque élément porte qui l'a créé et quand, qui l'a modifié en
  dernier et quand.
- Droits inchangés : Cyril (superadmin) et Alisson (membre avec le projet `exterieur`),
  tous deux en lecture **et** écriture.

**Out of Scope:**

- **Suivi budgétaire** — écarté explicitement. Les devis sont archivés en tant que
  documents, mais aucun total, aucune enveloppe, aucun reste-à-engager.
- **Envoi d'emails** — l'envoi se fait dans Gmail. L'application ne fait qu'archiver.
- **Notifications** (mail, push, cron) — rappel passif à l'ouverture uniquement. Pas de
  Worker Cloudflare ni de planificateur.
- **Découpage par pôles techniques** (sols / talus / clôtures) — écarté par Cyril : le
  chantier se pilote globalement.
- **Rôle lecteur seule** — les deux utilisateurs ont les mêmes droits.
- Reprise de la coquille actuelle de `exterieur/` : elle est **remplacée**, pas étendue.

## Context for Development

### Codebase Patterns

**Pile et contraintes** — statique sans build : ES5 vanilla, aucun `import`/`export`,
tout en portée globale via des `<script>` en bas du `<body>`. Firebase **v8.10.1 compat
uniquement** (jamais la v9 modulaire). Attribut `integrity` SRI obligatoire sur chaque
ressource CDN. Ces règles viennent de `_bmad-output/project-context.md` de
BilletsTouristiques et s'appliquent à l'identique au hub.

**Structure d'une page projet du hub** (établie le 28/07, à suivre exactement) :
- `<body data-projet="<slug>" data-racine="../">` — le vigile s'en sert pour la garde
  d'accès et pour résoudre les chemins vers la racine ;
- contenu dans `#app-content`, masqué en inline jusqu'à validation par `auth.js` ;
- `#header-placeholder` en premier enfant du `<body>` ;
- ordre des scripts : Firebase app → auth → firestore → `../config.js` →
  `../projets.js` → `../auth.js` → le JS de la page ;
- **`onHubReady()`** est le point d'entrée : `auth.js` l'appelle une fois l'accès validé.
  C'est là qu'on instancie `firebase.firestore()` et qu'on branche `onSnapshot`.

**Rendu** — pas de framework : `innerHTML` construit par concaténation de chaînes.
Trois fonctions d'échappement, à ne jamais confondre : `escapeHtml` (texte),
`escapeAttr` (attribut), `jsAttr` (littéral JS **dans** un attribut, seul cas où
l'apostrophe ne doit pas devenir `&#39;`). Un bug réel a déjà été causé par cette
confusion.

**Données** — `onSnapshot` charge tout en mémoire, puis filtres, tri et recherche se
font en JavaScript. Firestore **n'a pas de recherche plein texte** : c'est le modèle
retenu, valable tant que le volume reste de l'ordre de quelques centaines de documents.

**Upload Cloudinary** (`admin.js:291-345` de BilletsTouristiques) — `FormData` avec
`file` + `upload_preset`, POST vers `api.cloudinary.com/v1_1/<cloud>/image/upload`,
lecture de `secure_url`. Zone de dépôt avec `dragover` / `drop` et barre de progression
déjà écrites : à transposer.

**Carnet de contacts** (`mes-contacts.js`) — modèle directement réutilisable : données
en mémoire, `searchFilter`, `renderContacts()` / `filtrerContacts()`, modale
création/édition, export CSV.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `Admin/auth.js` | Le vigile : `onHubReady`, `HUB.effectif`, `aAcces`, `escapeHtml`, `showToast`, impersonation |
| `Admin/projets.js` | Registre des projets — l'entrée `exterieur` y est déjà |
| `Admin/idees/idees.js` | Page projet la plus aboutie : filtres, tri, modale, export JSON, échappement |
| `Admin/firestore.rules` | Le bloc `match /exterieur/{document}` existe déjà — rien à republier |
| `Admin/style.css` | Styles partagés : `.tile`, `.badge`, `.modal`, `.filter-btn`, `.idees-table` |
| `BilletsTouristiques/admin.js:98-99,291-345` | Upload Cloudinary + zone drag & drop à transposer |
| `BilletsTouristiques/mes-contacts.js` | Patron du carnet de contacts (recherche, modale, cartes) |
| `BilletsTouristiques/_bmad-output/project-context.md` | 42 règles de conventions applicables au hub |

### Technical Decisions

**D1 — Images ET documents sur Cloudinary, pas Firebase Storage.**
Firebase Storage impose le plan Blaze (carte bancaire). Un compte Cloudinary existe déjà
et sert BilletsTouristiques (cloud `dxoyqxben`, upload non signé depuis le navigateur,
`admin.js:297`). Firestore ne stocke que les URLs. Cloudinary accepte aussi les PDF, donc
les devis suivent le même chemin que les photos. *Validé par Cyril.*

**D2 — Dépôt du `.eml` + extraction des champs à l'upload.**
Deux besoins contradictoires en apparence : ne rien ressaisir (donc un fichier) et
pouvoir rechercher / relire / copier un mail (donc du texte). On fait les deux : le
`.eml` est lu dans le navigateur au moment du dépôt (`FileReader`), on en extrait
expéditeur, destinataires, objet, date et corps, ces champs partent dans Firestore, et
le fichier original est conservé sur Cloudinary.

Parsing : en ES5, sans bibliothèque externe, en visant les cas produits par Gmail —
en-têtes RFC 822, corps `text/plain` et `text/html`, encodages `quoted-printable` et
`base64`, charset UTF-8. **Dégradation obligatoire** : si l'analyse échoue, le fichier
est quand même enregistré et tous les champs restent saisissables à la main. Un format
exotique ne doit jamais faire perdre un mail.

*Limite connue : l'application Gmail mobile ne permet pas de télécharger un `.eml`.
L'archivage se fait depuis un ordinateur (Gmail web → ⋮ → Télécharger le message).*
*Correction de cadrage : la version « copier-coller le texte » proposée initialement a
été écartée par Cyril — elle imposait de ressaisir destinataires, expéditeur et objet.*

**D3 — Rappel passif uniquement.**
Un site statique n'a pas de planificateur. Une échéance dépassée ne peut que **remonter à
l'écran quand on ouvre la page**. Aucune notification n'est possible sans Worker + cron,
explicitement hors périmètre pour l'instant. *Validé par Cyril.*

**D4 — Traçabilité applicative, pas d'audit de sécurité.**
Chaque document porte `creePar` / `creeLe` / `modifiePar` / `modifieLe`, alimentés à
l'écriture par le client. Ces champs disent « qui a fait quoi » entre deux personnes de
confiance ; ils ne constituent pas une piste d'audit inviolable, puisque c'est le client
qui les écrit. Suffisant pour l'usage.

**D5 — Une seule collection `exterieur`, discriminée par un champ `type`.**
Valeurs : `tache` / `email` / `document` / `image` / `note` / `contact` / `lien`. Les
pages ne sont que des filtres sur cette étiquette.

Deux natures d'éléments se dégagent, et elles structurent les pages :
- **le fil** — des événements datés (`tache`, `email`, `document`, `image`, `note`),
  lus du plus récent au plus ancien ;
- **le carnet** — des références intemporelles (`contact`, `lien`), pour lesquelles
  l'ordre chronologique n'a pas de sens.

Elles partagent le même tiroir et donc la même recherche : chercher « paysagiste » doit
ramener aussi bien un mail qu'une fiche contact.

Pourquoi pas une collection par type : le besoin central est un **fil unique** mêlant
tous les types, trié du plus récent au plus ancien. Avec plusieurs collections, il
faudrait interroger chacune puis fusionner et retrier côté JavaScript à chaque
affichage. Avec une seule, c'est une lecture unique déjà ordonnée, et la recherche
balaie tout d'un coup, contacts compris.

Deux bénéfices secondaires : le bloc `match /exterieur/{document}` est **déjà publié**
(aucune règle à retoucher, donc aucune manipulation console), et un seul écouteur
`onSnapshot` alimente toutes les pages.

Coût accepté : les documents n'ont pas tous les mêmes champs (Firestore est sans schéma,
ça ne pose pas de problème technique) et chaque requête filtre sur `type`. Volume
attendu : quelques centaines de documents — aucun enjeu de performance.
*Validé par Cyril après explication.*

**D6 — Un nouveau preset Cloudinary, et l'endpoint `auto` au lieu de `image`.**
Deux obstacles trouvés dans le code existant :
1. L'endpoint utilisé par BilletsTouristiques est `/image/upload`, qui **refuse les PDF
   et les `.eml`**. Il faut `/auto/upload`, qui route selon le type réel du fichier.
2. Le preset non signé s'appelle `billets-touristiques` : le réutiliser mélangerait les
   pièces du chantier avec les images de l'association, dans le même compte et les mêmes
   quotas.

*Action manuelle requise de Cyril* : créer dans la console Cloudinary un second preset
non signé — proposition `ofildudoubs-hub` — avec **Resource type: Auto** et un dossier
dédié (`hub/exterieur`). Le nom du preset ira dans `config.js` du hub.

**D7 — Élargir la CSP de la page.**
La CSP actuelle de `exterieur/index.html` n'autorise ni l'envoi vers Cloudinary ni
l'affichage de ses images. À ajouter : `https://api.cloudinary.com` en `connect-src`
(upload) et `https://res.cloudinary.com` en `img-src` (vignettes). Les PDF s'ouvriront
dans un nouvel onglet plutôt qu'en `<iframe>`, ce qui évite d'avoir à toucher
`frame-src`.

**D8 — Aucune règle Firestore à republier.**
Vérifié : le bloc `match /exterieur/{document} { allow read, write: if aAcces('exterieur') }`
est déjà en place et couvre tous les types du tiroir. Conséquence directe de D5 — c'est
le seul lot de ce projet qui ne demandera aucune manipulation dans la console Firebase.

## Implementation Plan

### Tasks

À produire en étape 3.

### Acceptance Criteria

À produire en étape 3.

## Additional Context

### Dependencies

- Compte Cloudinary existant (`dxoyqxben`) — vérifier qu'un preset d'upload non signé
  autorise le type `raw` / `auto` pour les PDF.
- Projet Firebase `ofildudoubs-hub`, collection `exterieur` déjà déclarée dans
  `firestore.rules`.

### Testing Strategy

Harnais Node sans dépendance : module `vm`, DOM minimal simulé, assertions maison via
une fonction `verifie(nom, condition, detail)`. Aucun framework, aucun npm — cohérent
avec la stack.

⚠ **Constat de l'investigation : aucun test n'est versionné dans le dépôt.** Les deux
harnais écrits le 28/07 (`droits.js` — 35 vérifications sur le modèle de droits ;
`smoke.js` — la page Idées) vivent dans un dossier temporaire de session et vont
disparaître. **À corriger dans ce lot** : créer `Admin/tests/` et les y déplacer avant
d'en ajouter de nouveaux.

### Notes

Le contenu actuel de `exterieur/` (326 lignes de JS, 98 de HTML) a été écrit uniquement
pour éprouver le système de droits de bout en bout. Il est **jetable** et sera remplacé.
