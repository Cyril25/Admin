---
title: 'Extérieur de la maison — pilotage du chantier'
slug: 'exterieur-pilotage-chantier'
created: '2026-07-28'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['HTML5', 'CSS3', 'JavaScript ES5 (vanilla, sans build)', 'Firebase v8.10.1 compat (Auth + Firestore)', 'Cloudinary (upload non signe)', 'GitHub Pages']
files_to_modify: ['config.js', 'projets.js', 'style.css', 'README.md', 'exterieur/index.html', 'exterieur/exterieur.js', 'exterieur/exterieur-donnees.js', 'exterieur/exterieur-upload.js', 'exterieur/exterieur-eml.js', 'exterieur/exterieur-etat.js', 'exterieur/exterieur-fil.js', 'exterieur/exterieur-images.js', 'exterieur/exterieur-emails.js', 'exterieur/exterieur-carnet.js', 'exterieur/exterieur-projet.js', 'tests/test-exterieur.js']
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

Une page du hub, accessible aux deux, qui rassemble **tout le chantier au même endroit**.

Elle s'ouvre sur **« Où on en est »** — pas sur un journal. Une seule question structure
l'écran : *la balle est dans quel camp ?* Ce qui attend une action de notre côté, ce
qu'on attend d'un tiers et depuis combien de temps, les devis prêts à être comparés, et
le mouvement réel des derniers jours (y compris son absence).

Derrière cette vue, le même tiroir se regarde sous plusieurs angles : le fil
chronologique, les tâches, les images actuelles et les projections, les emails archivés,
le carnet de contacts et de liens, la fiche projet. Une recherche unique balaie
l'ensemble.

### Scope

**In Scope:**

- **Fil chronologique unique**, du plus récent au plus ancien, mêlant tous les types
  d'éléments, avec recherche plein texte et filtres (type, date, contact lié).
- **Carnet** — les références intemporelles, sur une même page en deux sections :
  - **Contacts** : nom, prénom, entreprise, téléphone, email, commentaire. Un contact
    peut être rattaché à n'importe quel élément du fil.
  - **Liens** : URL, titre, commentaire (sites de génération d'images par IA,
    fournisseurs, inspirations, documentation technique…).

  Les contacts portent une **catégorie** : `btp` / `paysagiste` / `archi-paysagiste` /
  `autre`, pour filtrer par type d'interlocuteur.

- **Page « Le projet »** — une fiche **unique et stable**, à l'inverse de tout le reste
  qui est une liste d'événements datés :
  - **notes de budget en texte libre** (l'enveloppe, les ordres de grandeur, les postes
    à arbitrer) — du texte que l'on relit, *aucun calcul, aucun total* ;
  - **ce qu'on veut** / **ce qu'on ne veut pas**.

  Objectif : répondre la même chose aux trois entreprises consultées. Un artisan demande
  « vous voulez quoi exactement ? », on ouvre la page et on lit. C'est aussi ce qui rend
  deux devis comparables.

- **Vues multiples sur le même tiroir**, chacune n'étant qu'un filtre : le fil complet,
  les tâches, les images actuelles, les images projections, les emails (envoyés et
  reçus), le carnet, la fiche projet.
- **Emails archivés par dépôt du fichier `.eml`**, dont expéditeur, destinataires, objet,
  date et corps sont extraits automatiquement à l'upload. Objectif : relire, rechercher
  et **copier-coller un mail déjà écrit** vers un nouvel artisan, sans jamais rien
  ressaisir. C'est la réponse directe au besoin « ne pas devoir tout réécrire ».
- **Documents** (devis PDF principalement) : upload et consultation.
- **Une seule collection Firestore `exterieur`**, chaque fiche étiquetée par un champ
  `type` ; les pages sont des filtres sur cette étiquette.
- **Images** : upload, vignettes, consultation en grand, classées en **`actuelle`**
  (l'état du terrain aujourd'hui) ou **`projection`** (rendus IA, inspirations, croquis
  d'archi) — deux vues distinctes.
- **Vue « Où on en est »** en page d'accueil du projet : à nous / en attente d'eux avec
  ancienneté / choix à faire / mouvement récent. Voir D11.
- **Tâches** avec date d'échéance, état, et **assignation** à Cyril ou Alisson.
- **Relances** déduites, non saisies : un élément « en attente d'eux » depuis plus de
  N jours se signale tout seul. Voir D16.
- **Saisie en un geste** : un bouton Ajouter, un fichier déposé, le type est déduit de
  l'extension. Voir D12.
- **Traçabilité** : chaque élément porte qui l'a créé et quand, qui l'a modifié en
  dernier et quand.
- Droits inchangés : Cyril (superadmin) et Alisson (membre avec le projet `exterieur`),
  tous deux en lecture **et** écriture.

**Out of Scope:**

- **Suivi budgétaire calculé** — pas de montants structurés, pas de somme, pas de
  reste-à-engager, pas de rapprochement devis / dépenses. ⚠ À ne pas confondre avec les
  **notes de budget en texte libre** de la page « Le projet », qui sont **dans** le
  périmètre : on écrit « enveloppe 15–20 k€, terrasse prioritaire », on ne calcule rien.
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

⚠ *Correction du 28/07 : une première version de cette décision affirmait que
`/image/upload` refuse les PDF. C'est faux — Cloudinary traite les PDF comme des images
et sait même en produire des vignettes de page. La conclusion tient, la justification
était erronée.*

Deux obstacles réels :
1. L'endpoint utilisé par BilletsTouristiques est `/image/upload`. Il accepte les PDF,
   mais **pas les `.eml`**, qui relèvent du type `raw`. `/auto/upload` aiguille selon le
   type réel du fichier et couvre les deux.
2. Le preset non signé s'appelle `billets-touristiques` : le réutiliser mélangerait les
   pièces du chantier avec les images de l'association, dans le même compte et les mêmes
   quotas.

*Action manuelle requise de Cyril* : créer dans la console Cloudinary un second preset
non signé — `ofildudoubs-hub` — avec **Resource type: Auto** et un dossier dédié
(`hub/exterieur`), sur le **même compte** `dxoyqxben`. Le nom du preset ira dans
`config.js` du hub. Ne pas modifier le preset `billets-touristiques`.

**Incertitude à lever au développement :** le téléversement de fichiers `raw` en mode
*unsigned* est bloqué par défaut sur certains comptes Cloudinary. À vérifier avec un vrai
`.eml` dès la Task 4.

**Repli si c'est bloqué** — stocker le texte brut du `.eml` directement dans le document
Firestore, dans un champ `emlBrut`. Le fichier est de toute façon lu et analysé côté
navigateur : on perdrait seulement le fichier retéléchargeable, pas le contenu. Un email
pèse quelques kilo-octets, très loin de la limite d'un mégaoctet par document Firestore.
Aucune infrastructure supplémentaire, contrairement à un upload signé qui exigerait un
Worker.

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

**D9 — Une seule page HTML, plusieurs vues.**
`exterieur/index.html` porte toutes les vues (Fil · Tâches · Images actuelles · Images
projections · Emails · Carnet · Le projet), commutées par un sélecteur. Pas un fichier
HTML par vue.

Raison : un seul `onSnapshot` alimente tout. Découper en sept pages imposerait sept
chargements Firestore, sept fois l'attente de l'authentification, et une recherche qui
ne verrait qu'un morceau des données. Ici, changer de vue est instantané et la recherche
balaie l'ensemble — ce qui est précisément le besoin (« tout au même endroit »).

La vue courante est reflétée dans le fragment d'URL (`#emails`, `#images-projections`)
afin qu'un rechargement ou un favori retombe au bon endroit.

Le JavaScript est en revanche **découpé en plusieurs fichiers** chargés côte à côte
(`exterieur-donnees.js`, `exterieur-fil.js`, `exterieur-images.js`, `exterieur-emails.js`,
`exterieur-carnet.js`, `exterieur-projet.js`). Sans build, plusieurs `<script>` ne
coûtent rien et évitent le fichier de 1 200 lignes.

**D10 — La fiche projet est un document singleton.**
Contrairement à tout le reste, « Le projet » n'est pas une liste : c'est **un seul
document**, d'identifiant fixe `_projet`, dans la même collection (`type: 'projet'`).
Champs : `budgetNotes`, `ceQuonVeut`, `ceQuonNeVeutPas`, en texte libre multi-lignes.

Il est exclu du fil (qui filtre sur les types événementiels) mais reste couvert par la
même règle Firestore. Identifiant fixe = pas de doublon possible : deux personnes qui
l'éditent en même temps écrivent dans le même document, la dernière écriture gagne.
Acceptable à deux ; on ne met pas de verrou.

**D11 — La vue d'accueil est un état, pas le fil. Concept central : « la balle est dans
quel camp ? »**

Le symptôme d'origine est « le projet traîne, on oublie où on en est ». Un fil
chronologique n'y répond pas : à 150 éléments, il raconte ce qui s'est passé, pas où on
en est. La vue par défaut est donc **« Où on en est »**, et le fil devient une vue parmi
d'autres.

Tout repose sur **un seul champ**, `camp`, porté par les éléments actionnables :

| Valeur | Sens | Effet à l'écran |
|---|---|---|
| `a_nous` | On doit faire quelque chose | Colonne « À faire » |
| `a_eux` | On attend un tiers | Colonne « En attente », avec l'ancienneté |
| `clos` | Réglé | Sort du tableau de bord, reste dans le fil |

Ce champ unique alimente les trois besoins exprimés : savoir s'il faut réagir ou
attendre, repérer les relances (« à eux depuis 18 jours »), et mesurer l'avancement
(ce qui bascule en `clos`).

**Les quatre blocs de la vue :**

1. **À nous** — ce qui attend une action de Cyril ou d'Alisson, échéances dépassées en
   tête.
2. **En attente d'eux** — avec le nombre de jours écoulés. Au-delà d'un seuil (15 jours
   par défaut), l'élément se signale comme « à relancer ».
3. **Choix à faire** — regroupement automatique des devis partageant le même `sujet`
   (texte libre : « terrasse », « clôture »…). Deux devis ou plus sur un même sujet
   déclenchent « à comparer ». *C'est un tag, pas une structure : ça ne réintroduit pas
   le découpage par pôles écarté plus haut.*
4. **Mouvement** — « cette semaine : 2 devis reçus, 1 relance faite », et surtout son
   contraire : **« rien n'a bougé depuis N jours »**.

**❌ Pas de barre de progression, et c'est délibéré.** Afficher « 40 % du projet »
supposerait de connaître le total des tâches, ce qui est faux par nature dans un projet
qui se découvre en avançant. Un pourcentage inventé démotive dès qu'on comprend qu'il ne
veut rien dire. On montre le **mouvement réel**, y compris son absence.

**D12 — Réduire la saisie à un seul geste.**
Un outil nourri à la main ne survit qu'en dessous d'un certain coût par saisie. Donc :
un unique bouton **Ajouter** acceptant un dépôt de fichier, avec **détection du type par
l'extension** — `.eml` → email, `.pdf` → document, `.jpg`/`.png`/`.heic` → image. Aucun
choix préalable, aucun formulaire imposé : on extrait tout ce qu'on peut automatiquement,
le reste se complète plus tard ou jamais.

Exception assumée : **le titre d'un document est obligatoire**. Le contenu d'un PDF n'est
pas indexable (pas d'OCR), donc un devis sans titre saisi à la main sera introuvable —
la recherche mentirait.

**D13 — Assignation des tâches.**
Champ `assigneA` : Cyril, Alisson, ou personne. À deux, une tâche sans nom est une tâche
dont chacun pense que l'autre s'occupe.

**D14 — Aucune reprise d'historique.**
L'outil démarre vide et se remplit au fil de l'eau. Seuls les contacts et la fiche projet
justifient une saisie initiale. Exiger de ressaisir six mois d'emails garantirait que
l'outil ne démarre jamais.

**D15 — Le mobile, pour les photos seulement.**
Les photos du terrain se prennent au téléphone : la vue images et le dépôt d'image
doivent être confortables sur mobile (`<input type="file" accept="image/*">` ouvre
directement l'appareil photo). En revanche, l'archivage d'emails restera une opération
de bureau — l'application Gmail mobile ne permet pas de télécharger un `.eml`.

**D16 — La relance vit sur le couple contact + demande.**
Une relance n'est pas un champ flottant : c'est « j'ai demandé un devis à Dupont le 3,
sans réponse le 17 je le rappelle ». Elle se matérialise donc par un élément
`camp: 'a_eux'` portant un `contactId` et une `dateDemande`. L'ancienneté se calcule, le
seuil déclenche l'alerte. Pas de champ « date de relance » saisi séparément.

**D17 — L'assignation ne peut pas utiliser l'annuaire des membres.**
Les règles autorisent un membre à lire **uniquement sa propre fiche**
(`allow read: if superadmin() || email == idAppelant()`). Alisson ne peut donc pas
lister les membres, et l'interface ne peut pas lui proposer « assigner à Cyril ».

Solution retenue : la fiche projet porte une liste `intervenants` (`['Cyril',
'Alisson']`), et `assigneA` stocke une de ces étiquettes. Aucune règle à assouplir,
aucune fuite d'annuaire, et ça reste modifiable sans toucher au code.

**D18 — La traçabilité enregistre l'utilisateur RÉEL, pas l'impersonné.**
`creePar` / `modifiePar` reçoivent `HUB.user.email`, jamais `HUB.effectif.email`. Sous
impersonation, les écritures partent bel et bien avec le jeton du superadmin : inscrire
l'identité impersonnée ferait mentir la trace.


## Révisions après revue adversariale (2026-07-28)

La revue a mis au jour un déséquilibre : les vues étaient sur-spécifiées, la **saisie**
sous-spécifiée. Les huit corrections ci-dessous portent toutes sur ce point. Elles
priment sur les décisions D1–D18 en cas de contradiction.

**R1 (corrige F1) — `camp` est déduit à la création, jamais demandé.**

| Contexte de création | `camp` initial |
|---|---|
| Email dont le sens est `envoye` | `a_eux` — on attend une réponse |
| Email dont le sens est `recu` | `a_nous` — on doit traiter |
| Document (devis reçu) | `a_nous` — à lire et comparer |
| Tâche | `a_nous` |
| Image, note, contact, lien | *aucun* — non actionnable |

Sur chaque carte du tableau de bord, trois boutons permettent de corriger en **un clic** :
« c'est à eux » / « c'est à nous » / « réglé ». Aucune saisie obligatoire à la création,
correction immédiate quand la déduction se trompe. C'est ce qui rend le pivot du produit
compatible avec D12.

**R2 (corrige F2) — le bouton Ajouter ouvre un choix court, pas seulement une zone de
dépôt.**

Deux entrées : **Déposer un fichier** (zone glisser-déposer, chemin principal) et
**Écrire** → tâche ou note. Les contacts et les liens ne passent pas par ce bouton : ils
se créent depuis la vue Carnet, là où on les cherche. Le bouton reste unique, il ne
prétend simplement plus que tout est un fichier.

**R3 (corrige F3) — le sens d'un email se déduit d'une liste `nosAdresses`
auto-alimentée.**

La fiche projet porte `nosAdresses`, un tableau d'adresses email. À chaque ouverture du
projet, l'adresse de la personne connectée y est ajoutée si elle en est absente : au bout
d'une visite chacun, la liste est complète **sans aucune saisie**. L'analyseur compare
l'en-tête `De` à cette liste — correspondance = `envoye`, sinon `recu`. Un bouton bascule
le sens en un clic si la déduction se trompe.

Ce mécanisme d'auto-amorçage lève au passage l'objection de D17 : le code n'a jamais
besoin de lire l'annuaire des membres, chaque personne renseigne la sienne en se
connectant.

**R4 (corrige F4) — les fichiers Cloudinary ne sont PAS supprimés, et c'est une limite
technique assumée.**

Supprimer un fichier chez Cloudinary exige la clé secrète du compte. La mettre dans une
page publique reviendrait à la publier ; un Worker dédié serait de l'infrastructure en
plus, hors périmètre. Donc : supprimer un élément supprime **le document Firestore
uniquement**. Le fichier demeure sur Cloudinary, sans lien nulle part, accessible
seulement à qui connaît son URL exacte.

Conséquences à documenter dans le README : le stockage grossit lentement sans jamais
diminuer, et **une suppression n'est pas un effacement** — ne pas téléverser ici ce
qu'on pourrait vouloir effacer réellement. Ménage manuel possible depuis la console
Cloudinary.

**R5 (corrige F5) — deux dates distinctes, et chacune son usage.**

- `dateEvenement` — **quand la chose s'est produite** : date d'envoi extraite du `.eml`,
  date saisie sur un devis, à défaut la date d'archivage. **C'est elle qui ordonne le
  fil.**
- `creeLe` — **quand on l'a archivé**. C'est elle qui alimente le bloc « Mouvement » du
  tableau de bord.

Sans cette distinction, archiver dix vieux mails d'un coup les propulserait en tête du
fil, et « 10 éléments cette semaine » laisserait croire à une activité qui n'a pas eu
lieu. Les deux lectures sont légitimes, elles ne doivent simplement pas être confondues.

*Les photos gardent `creeLe` comme `dateEvenement` : lire une date EXIF sans
bibliothèque n'en vaut pas le coût.*

**R6 (corrige F6) — `intervenants` s'auto-alimente, comme `nosAdresses`.**

Même mécanisme que R3 : à l'ouverture, le nom de la personne connectée
(`HUB.effectif.nom`, à défaut la partie gauche de son email) est ajouté à `intervenants`
s'il en est absent. L'assignation fonctionne donc dès la première visite, sans fiche
projet préalable. La liste reste modifiable à la main.

**R7 (corrige F7) — `dateDemande` est supprimée, remplacée par `campDepuis`.**

`campDepuis` est un horodatage réécrit automatiquement **à chaque changement de `camp`**.
L'ancienneté affichée devient « à eux depuis 18 jours », comptés depuis la bascule
elle-même. Exact, gratuit, et aucun champ à remplir. Un champ de saisie de moins.

**R8 (corrige F8) — le titre est pré-rempli à partir du nom de fichier.**

`devis-terrasse-dupont.pdf` devient « Devis terrasse dupont » : extension retirée, tirets
et soulignés changés en espaces, première lettre en capitale. Le champ reste modifiable,
et n'est refusé que s'il finit réellement vide. Le cas courant redevient un seul geste,
ce qui réconcilie D6 et D12.

## Implementation Plan

### Modèle de données — collection `exterieur`

Un seul tiroir, discriminé par `type`. Champs communs à tous les documents :

| Champ | Type | Détail |
|---|---|---|
| `type` | string | `tache` / `email` / `document` / `image` / `note` / `contact` / `lien` / `projet` |
| `titre` | string | Obligatoire pour `document`, `tache`, `lien` ; dérivé pour `email` et `image` |
| `creePar`, `modifiePar` | string | Email de l'utilisateur **réel** (voir D18) |
| `creeLe`, `modifieLe` | timestamp | Horodatage serveur — `creeLe` = date d'**archivage** |
| `dateEvenement` | timestamp | Quand la chose s'est **produite** ; ordonne le fil (R5) |

Champs des éléments **actionnables** (`tache`, `document`, `email`) :

| Champ | Type | Détail |
|---|---|---|
| `camp` | string | `a_nous` / `a_eux` / `clos` — absent = non actionnable |
| `campDepuis` | timestamp | Réécrit **automatiquement** à chaque changement de `camp` ; base du calcul d'ancienneté (R7) |
| `dateEcheance` | timestamp | Facultatif, tâches surtout |
| `assigneA` | string | Étiquette issue de `intervenants` (voir D17), ou `''` |
| `contactId` | string | Id du document `contact` lié, ou `''` |
| `sujet` | string | Texte libre (« terrasse », « clôture ») — regroupe les devis à comparer |

Champs propres à chaque type :

| Type | Champs |
|---|---|
| `image` | `url`, `categorie` (`actuelle` / `projection`) |
| `document` | `url`, `nomFichier`, `titre` **obligatoire** |
| `email` | `url` (le `.eml` d'origine), `de`, `a`, `objet`, `dateEnvoi`, `corps`, `sens` (`envoye` / `recu`), `parseOk` (bool) |
| `contact` | `nom`, `prenom`, `entreprise`, `telephone`, `email`, `commentaire`, `categorie` (`btp` / `paysagiste` / `archi-paysagiste` / `autre`) |
| `lien` | `url`, `titre`, `commentaire` |
| `projet` | Singleton d'id `_projet` : `budgetNotes`, `ceQuonVeut`, `ceQuonNeVeutPas`, `intervenants` (array, auto-alimenté R6), `nosAdresses` (array, auto-alimenté R3) |

### Tasks

- [ ] **Task 1 : Créer le preset Cloudinary** — *action manuelle de Cyril, bloquante*
  - File : aucun (console Cloudinary)
  - Action : Settings → Upload → Add upload preset. Nom `ofildudoubs-hub`,
    **Signing mode : Unsigned**, **Resource type : Auto**, dossier `hub/exterieur`.
  - Notes : même compte `dxoyqxben`, second preset — pas un nouveau compte. Ne pas
    toucher au preset `billets-touristiques`, qui fait tourner l'autre site. Facultatif
    mais conseillé : *Max file size* à 10 Mo et liste de formats autorisés, pour limiter
    les dégâts si le nom du preset était deviné. Rien ne se teste de bout en bout tant
    que ce preset n'existe pas.

- [ ] **Task 2 : Déclarer Cloudinary dans la configuration du hub**
  - File : `config.js`
  - Action : ajouter `var CLOUDINARY_CLOUD_NAME = 'dxoyqxben';` et
    `var CLOUDINARY_UPLOAD_PRESET = 'ofildudoubs-hub';`
  - Notes : valeurs publiques par nature, comme le reste de ce fichier. Un preset non
    signé permet à quiconque de téléverser dans le compte — c'est déjà le cas pour
    BilletsTouristiques, on assume le même niveau de risque.

- [ ] **Task 3 : Socle de données**
  - File : `exterieur/exterieur-donnees.js` *(nouveau)*
  - Action : constantes (`TYPES`, `CAMPS`, `CATEGORIES_IMAGE`, `CATEGORIES_CONTACT`,
    `SEUIL_RELANCE_JOURS = 15`) ; `onSnapshot` sur la collection `exterieur` alimentant
    un tableau `elements` en mémoire ; helpers `toDate`, `formatDateFr`, `joursDepuis`,
    `escapeAttr`, `jsAttr` ; CRUD générique `creerElement` / `modifierElement` /
    `supprimerElement` remplissant seuls la traçabilité (D18) ; `campParDefaut(type, sens)`
    (R1) ; `changerCamp(id, camp)` qui réécrit `campDepuis` (R7) ; `amorcerProjet()` qui
    ajoute l'adresse et le nom de la personne connectée à `nosAdresses` et `intervenants`
    s'ils manquent (R3, R6), appelé une fois au démarrage.
  - Notes : `escapeHtml` et `showToast` viennent déjà de `auth.js`, ne pas les
    redéfinir. `jsAttr` est à recopier depuis `idees/idees.js` — c'est la fonction qui
    évite le bug des apostrophes dans les `onclick`.

- [ ] **Task 4 : Upload Cloudinary et détection du type**
  - File : `exterieur/exterieur-upload.js` *(nouveau)*
  - Action : `uploadFichier(file)` → POST `FormData` (`file`, `upload_preset`) vers
    `https://api.cloudinary.com/v1_1/<cloud>/auto/upload`, retourne `secure_url` ;
    `typeDepuisFichier(file)` → `.eml` = `email`, `.pdf`/`.doc`/`.docx` = `document`,
    `.jpg`/`.jpeg`/`.png`/`.heic`/`.webp` = `image`, sinon `document` ; zone de dépôt
    `dragover` / `drop` + barre de progression ; `titreDepuisNomFichier(nom)` — extension
    retirée, tirets et soulignés en espaces, capitale initiale (R8) ; le bouton Ajouter
    ouvre un choix court « Déposer un fichier » / « Écrire » (R2).
  - Notes : transposer `admin.js:291-345` de BilletsTouristiques en changeant
    `/image/upload` en `/auto/upload`. En cas d'échec réseau, afficher l'erreur et **ne
    pas** créer de document Firestore orphelin. **Premier test à faire : un vrai `.eml`**
    — si Cloudinary refuse le `raw` en unsigned, basculer sur le repli `emlBrut` décrit
    en D6 sans attendre.

- [ ] **Task 5 : Analyseur de fichiers `.eml`**
  - File : `exterieur/exterieur-eml.js` *(nouveau)*
  - Action : `analyserEml(texte)` → `{ de, a, objet, dateEnvoi, corps, parseOk }` ;
    `sensDepuisDe(de, nosAdresses)` → `envoye` si l'expéditeur figure dans la liste,
    `recu` sinon (R3). `dateEnvoi` alimente `dateEvenement` (R5).
    Découper en-têtes / corps sur la première ligne vide ; déplier les en-têtes
    repliés (lignes commençant par espace ou tabulation) ; décoder les en-têtes encodés
    `=?UTF-8?B?...?=` et `=?UTF-8?Q?...?=` ; pour un corps `multipart`, retenir la partie
    `text/plain`, à défaut `text/html` détaggé ; décoder `quoted-printable` et `base64`.
  - Notes : **`parseOk: false` en cas d'échec, jamais d'exception remontée.** Le fichier
    reste enregistré et tous les champs demeurent saisissables à la main (D2). Fonction
    pure, sans DOM ni réseau : c'est la plus facile à tester.

- [ ] **Task 6 : Coquille HTML et navigation par vues**
  - File : `exterieur/index.html` *(remplacement intégral)*
  - Action : `<body data-projet="exterieur" data-racine="../">` ; barre de sélection des
    sept vues ; un conteneur `<div id="vue-*">` par vue ; champ de recherche global ;
    bouton **Ajouter** unique ; modales (élément, contact, lien, visionneuse d'image,
    suppression). CSP élargie : `https://api.cloudinary.com` en `connect-src`,
    `https://res.cloudinary.com` en `img-src` (D7). Scripts dans l'ordre : Firebase
    app/auth/firestore → `../config.js` → `../projets.js` → `../auth.js` →
    `exterieur-donnees.js` → `exterieur-upload.js` → `exterieur-eml.js` → les six vues
    → `exterieur.js`.
  - Notes : les PDF s'ouvrent dans un onglet (`target="_blank"`), jamais en `<iframe>` —
    ça évite de toucher `frame-src`.

- [ ] **Task 7 : Routeur de vues et recherche globale**
  - File : `exterieur/exterieur.js` *(remplacement intégral)*
  - Action : `onHubReady()` instancie Firestore et branche l'écoute ; `afficherVue(nom)`
    masque/affiche les conteneurs et met à jour `location.hash` ; lecture du hash au
    chargement, `etat` par défaut ; `hashchange` géré ; la recherche filtre l'ensemble
    des éléments et bascule sur une vue « Résultats » quand elle est non vide.
  - Notes : la recherche balaie `titre`, `corps`, `objet`, `commentaire`, `nom`,
    `prenom`, `entreprise`, `sujet`, `de`, `a`. Insensible à la casse et aux accents.

- [ ] **Task 8 : Vue « Où on en est » (vue par défaut)**
  - File : `exterieur/exterieur-etat.js` *(nouveau)*
  - Action : quatre blocs — **À nous** (`camp = a_nous`, échéances dépassées en tête,
    avec l'assignation) ; **En attente d'eux** (`camp = a_eux`, tri par ancienneté
    décroissante calculée sur `campDepuis`, badge « à relancer » au-delà de
    `SEUIL_RELANCE_JOURS`) ; trois boutons de bascule à un clic sur chaque carte —
    « c'est à eux » / « c'est à nous » / « réglé » (R1) ; **Choix à
    faire** (documents groupés par `sujet` non vide, affichés dès 2 devis) ;
    **Mouvement** (compte des éléments créés sur 7 jours, et « rien n'a bougé depuis N
    jours » si `N >= 7`).
  - Notes : **aucune barre de progression ni pourcentage** (D11). Chaque bloc vide
    affiche une phrase rassurante plutôt que de disparaître — « rien ne vous attend »
    est une information.

- [ ] **Task 9 : Vue Fil**
  - File : `exterieur/exterieur-fil.js` *(nouveau)*
  - Action : tous les types événementiels (`tache`, `email`, `document`, `image`,
    `note`) triés sur **`dateEvenement`** décroissant (R5), filtres par type, carte
    adaptée à chaque type.
  - Notes : exclure `contact`, `lien` et `projet` — ce ne sont pas des événements (D5).

- [ ] **Task 10 : Vues Images**
  - File : `exterieur/exterieur-images.js` *(nouveau)*
  - Action : deux vues (`actuelle`, `projection`) en grille de vignettes, visionneuse
    plein écran au clic, bascule de catégorie sans réuploader, dépôt avec
    `<input type="file" accept="image/*">`.
  - Notes : `accept="image/*"` ouvre directement l'appareil photo sur mobile (D15).
    Vignettes via les transformations Cloudinary (`w_400,f_auto,q_auto`) pour ne pas
    télécharger les originaux dans la grille.

- [ ] **Task 11 : Vue Emails**
  - File : `exterieur/exterieur-emails.js` *(nouveau)*
  - Action : liste des `type = email` du plus récent au plus ancien, filtre
    envoyés / reçus, ouverture du corps complet, **bouton « Copier le corps »**, lien
    vers le `.eml` d'origine.
  - Notes : le bouton copier est la raison d'être de la vue — c'est lui qui répond à
    « ne pas devoir tout réécrire ». Un email dont `parseOk = false` s'affiche avec un
    avertissement et ses champs éditables.

- [ ] **Task 12 : Vue Carnet**
  - File : `exterieur/exterieur-carnet.js` *(nouveau)*
  - Action : deux sections — contacts (cartes, filtre par catégorie, `tel:` et `mailto:`
    cliquables) et liens (titre, commentaire, ouverture en nouvel onglet). Modales de
    création et d'édition pour les deux.
  - Notes : transposer `mes-contacts.js` de BilletsTouristiques. Un contact affiche le
    nombre d'éléments qui lui sont rattachés, et la suppression le rappelle. Les éléments
    dont le `contactId` ne résout plus affichent « contact supprimé » plutôt que de
    planter (F10) — on ne casse pas la référence en base, on la tolère à l'affichage.

- [ ] **Task 13 : Vue « Le projet »**
  - File : `exterieur/exterieur-projet.js` *(nouveau)*
  - Action : lecture/écriture du document singleton `_projet` — trois zones de texte
    (notes de budget, ce qu'on veut, ce qu'on ne veut pas) plus les listes `intervenants`
    et `nosAdresses`, toutes deux auto-alimentées mais modifiables (R3, R6).
    Sauvegarde explicite par bouton, avec la date et l'auteur de la dernière
    modification.
  - Notes : dernière écriture gagnante, sans verrou (D10). Afficher « modifié par X le
    Y » rend le risque visible sans le supprimer.

- [ ] **Task 14 : Styles**
  - File : `style.css`
  - Action : sélecteur de vues, cartes du tableau de bord, badges `camp`, grille
    d'images, visionneuse, cartes email, zone de dépôt.
  - Notes : réutiliser les variables et classes existantes (`.tile`, `.badge`, `.modal`,
    `.filter-btn`). Ne pas introduire de nouvelle palette.

- [ ] **Task 15 : Tests**
  - File : `tests/test-exterieur.js` *(nouveau)*
  - Action : analyseur `.eml` (cas nominal, en-têtes encodés, multipart, base64,
    quoted-printable, fichier illisible) ; `typeDepuisFichier` ; calcul d'ancienneté et
    seuil de relance ; regroupement des devis par sujet ; filtrage du fil ; recherche ;
    échappement des `onclick`.
  - Notes : `run-tests.js` ramasse le fichier automatiquement. L'analyseur `.eml` étant
    une fonction pure, il se teste sans DOM ni réseau — c'est là que doit porter
    l'essentiel de l'effort.

- [ ] **Task 16 : Documentation et registre**
  - File : `projets.js`, `README.md`
  - Action : mettre à jour la description du projet `exterieur` dans le registre ;
    documenter dans le README le modèle de données, le concept de `camp`, l'action
    manuelle Cloudinary, et **la limite de suppression (R4) : supprimer un élément
    n'efface pas son fichier**.
  - Notes : aucun bloc à ajouter dans `firestore.rules` (D8) — le seul lot du hub dans
    ce cas, autant l'écrire noir sur blanc pour éviter qu'on le cherche.

### Acceptance Criteria

- [ ] **AC1** — Étant donné Alisson connectée avec le seul projet `exterieur`, quand elle
  ouvre `admin.ofildudoubs.fr/exterieur/`, alors la vue « Où on en est » s'affiche et le
  menu ne contient ni « Idées » ni « Membres ».
- [ ] **AC2** — Étant donné un membre sans le projet `exterieur`, quand il tente d'ouvrir
  l'URL directement, alors il est redirigé vers l'accueil. *Vérification côté serveur à
  faire séparément dans le Rules Playground de la console Firebase — non couvrable par
  les tests automatisés (F14).*
- [ ] **AC3** — Étant donné un fichier `devis-terrasse.pdf` déposé sur la zone Ajouter,
  quand le dépôt se termine, alors un élément de type `document` est créé, le titre est
  demandé et refusé s'il est vide, et le PDF s'ouvre dans un nouvel onglet.
- [ ] **AC4** — Étant donné un `.eml` exporté de Gmail, quand il est déposé, alors
  expéditeur, destinataires, objet, date et corps sont pré-remplis sans aucune saisie, et
  `parseOk` vaut `true`.
- [ ] **AC5** — Étant donné un `.eml` d'un format non géré, quand il est déposé, alors
  aucune erreur n'est levée, le fichier est conservé, `parseOk` vaut `false`, et
  l'élément apparaît avec un avertissement et des champs éditables.
- [ ] **AC6** — Étant donné un élément `camp = a_eux` dont `dateDemande` remonte à
  18 jours, quand on ouvre la vue « Où on en est », alors il apparaît dans « En attente
  d'eux » avec « 18 jours » et un badge « à relancer ».
- [ ] **AC7** — Étant donné le même élément passé à `camp = a_nous`, quand la vue se
  rafraîchit, alors il quitte « En attente d'eux » et rejoint « À nous » — sans
  rechargement de page, `onSnapshot` suffisant.
- [ ] **AC8** — Étant donné deux documents portant le sujet « terrasse », quand on ouvre
  la vue d'état, alors le bloc « Choix à faire » affiche « Terrasse — 2 devis, à
  comparer ». Avec un seul devis, le sujet n'apparaît pas.
- [ ] **AC9** — Étant donné aucun élément créé depuis 9 jours, quand on ouvre la vue
  d'état, alors le bloc Mouvement affiche « rien n'a bougé depuis 9 jours », et **aucun
  pourcentage d'avancement n'est affiché nulle part**.
- [ ] **AC10** — Étant donné une recherche « paysagiste », quand on la saisit, alors les
  résultats mêlent contacts, emails et documents correspondants, quelle que soit la vue
  active au moment de la saisie.
- [ ] **AC11** — Étant donné une image téléversée en `projection`, quand on la bascule en
  `actuelle`, alors elle quitte la vue Projections pour la vue Actuelles sans être
  téléversée à nouveau.
- [ ] **AC12** — Étant donné la vue Emails, quand on clique « Copier le corps », alors le
  texte intégral est dans le presse-papier, prêt à être collé dans Gmail.
- [ ] **AC13** — Étant donné la fiche projet éditée par Cyril, quand Alisson l'ouvre,
  alors elle voit le texte à jour ainsi que « modifié par cyril… le … ».
- [ ] **AC14** — Étant donné Cyril en impersonation d'Alisson, quand il crée un élément,
  alors `creePar` contient **l'adresse de Cyril**, pas celle d'Alisson (D18).
- [ ] **AC15** — Étant donné un mobile, quand on appuie sur Ajouter dans la vue Images,
  alors l'appareil photo s'ouvre directement et la photo prise est téléversée.
- [ ] **AC16** — Étant donné un échec réseau pendant le téléversement, quand l'erreur
  survient, alors un message l'indique et **aucun document Firestore orphelin** n'est
  créé.
- [ ] **AC17** — Étant donné la vue Emails ouverte, quand on recharge la page, alors on
  revient sur la vue Emails (`#emails` dans l'URL).
- [ ] **AC18** — Étant donné `node tests/run-tests.js`, quand on le lance, alors tous les
  tests passent, y compris ceux du nouveau `test-exterieur.js`.

- [ ] **AC19** — Étant donné un `.eml` envoyé par Cyril, quand il est archivé, alors
  `sens` vaut `envoye` et `camp` vaut `a_eux` **sans aucune saisie**. Un `.eml` reçu donne
  `recu` et `a_nous`. (R1, R3)
- [ ] **AC20** — Étant donné une déduction de `camp` erronée, quand on clique « c'est à
  nous » sur la carte, alors l'élément change de colonne immédiatement et `campDepuis` est
  réinitialisé à maintenant. (R1, R7)
- [ ] **AC21** — Étant donné une base vierge et Alisson qui ouvre le projet pour la
  première fois, quand la page se charge, alors son adresse rejoint `nosAdresses` et son
  nom `intervenants` — sans passer par la fiche projet. (R3, R6)
- [ ] **AC22** — Étant donné un `.eml` daté du 3 juillet archivé le 28 juillet, quand on
  ouvre le fil, alors il se place au 3 juillet ; et le bloc « Mouvement » le compte bien
  dans l'activité de la semaine du 28. (R5)
- [ ] **AC23** — Étant donné le bouton Ajouter, quand on le clique, alors on peut créer
  une tâche ou une note sans déposer de fichier. (R2)
- [ ] **AC24** — Étant donné `devis-terrasse-dupont.pdf` déposé, quand le formulaire
  s'ouvre, alors le titre est déjà « Devis terrasse dupont » et l'enregistrement passe
  sans rien saisir. (R8)
- [ ] **AC25** — Étant donné un élément supprimé, quand on recharge, alors il a disparu de
  toutes les vues — **et son fichier Cloudinary existe toujours**, conformément à la
  limite assumée. (R4)
- [ ] **AC26** — Étant donné un contact supprimé alors que des éléments le référencent,
  quand on ouvre le fil, alors ces éléments s'affichent sans planter, avec la mention
  « contact supprimé ». (F10)

## Additional Context

### Dependencies

- **Bloquant :** preset Cloudinary non signé `ofildudoubs-hub` en *Resource type: Auto*
  (Task 1). Rien ne se teste de bout en bout sans lui.
- Projet Firebase `ofildudoubs-hub` — collection `exterieur` déjà autorisée, **aucune
  republication de règles nécessaire**.
- Aucune bibliothèque externe. L'analyseur `.eml` est écrit à la main : ajouter une
  dépendance imposerait soit un bundler, soit un CDN de plus, contre la contrainte de
  stack.

### Testing Strategy

**Automatisé** (`node tests/run-tests.js`) — analyseur `.eml` sur des fixtures inlinées,
détection de type par extension, calcul d'ancienneté et seuil, regroupement par sujet,
filtres et recherche, échappement des `onclick`. Le harnais `vm` + DOM minimal existant
sert de modèle.

**Manuel** — ce que les tests ne peuvent pas couvrir : téléverser un vrai `.eml` de
Gmail, un vrai PDF, une photo depuis un téléphone ; vérifier la vue d'Alisson avec le
bouton d'impersonation ; éprouver les règles Firestore dans le *Rules Playground* de la
console.

### Notes

**Risques identifiés**

1. **L'outil n'est pas alimenté.** Le vrai risque du projet n'est pas technique : si
   archiver un mail coûte cinq gestes, ce sera fait trois fois puis jamais. D'où D12
   (un bouton, un fichier, le type deviné). À réévaluer après deux semaines d'usage
   réel : si le fil est vide, le problème est l'ergonomie de saisie, pas la motivation.
2. **La recherche ne voit pas l'intérieur des PDF.** Pas d'OCR. Un devis mal titré est
   perdu. Le titre obligatoire est la seule parade.
3. **L'analyseur `.eml` sur des cas exotiques.** Mitigé par la dégradation obligatoire :
   on ne perd jamais le fichier, seulement le confort du pré-remplissage.
4. **Écriture concurrente sur la fiche projet.** Dernière écriture gagnante. Visible,
   assumé, non corrigé (D10).
5. **Aucune sauvegarde Firestore sur le plan gratuit.** Même limite que la page Idées.
   Un export JSON équivalent devra être prévu ici aussi — noté comme suite.

**Limites connues**

- Archivage d'emails impossible depuis l'application Gmail mobile (pas de téléchargement
  `.eml`). Opération de bureau.
- Aucune notification : le rappel n'existe qu'à l'ouverture de la page (D3).
- Un preset Cloudinary non signé permet à quiconque connaît son nom de téléverser dans
  le compte. Risque déjà accepté sur BilletsTouristiques.

**Suites possibles, hors périmètre**

- Bouton d'export JSON, sur le modèle de la page Idées.
- Rôle lecteur seule, si un tiers doit consulter sans modifier.
- Worker Cloudflare + cron pour de vraies relances par email.
- Liste des lots à réaliser, seule base honnête d'un indicateur d'avancement chiffré.
