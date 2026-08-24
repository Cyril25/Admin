# Tests du hub

```bash
node tests/run-tests.js
```

Sortie `0` si tout passe. Aucune installation : ni npm, ni framework, ni configuration —
juste Node. C'est délibéré, et c'est la même contrainte que le site lui-même, qui n'a pas
d'étape de build.

| Fichier | Ce qu'il protège |
|---|---|
| `test-droits.js` | Le système d'accès : qui voit quels projets et quels sites, et ce que fait l'impersonation |
| `test-idees.js` | La page Idées : tri, filtres, échappement, export JSON, **droits par auteur et liste fermée des projets** |
| `test-exterieur.js` | Le pilotage du chantier : analyseur `.eml`, camp et relances, regroupement des devis, recherche, écritures |
| `test-cueillette.js` | Le calendrier de cueillette : calcul des statuts, **isolation des forçages par saison**, cohérence du référentiel |
| `test-taches.js` | La to-do priorisée : calendrier, urgence déduite, ordre des blocs, **compteur de reports**, créneaux et grille de semaine, cloisonnement en lecture |
| `test-notifieur.js` | Le notifieur Telegram : fenêtres d'envoi, **déduplication**, échappement HTML, bilan du soir, cohérence config / règles / Worker |

### `test-notifieur.js` — ce qui ne part pas

Un notifieur se juge sur ce qu'il envoie **et** sur ce qu'il n'envoie pas, et le second cas
est invisible : personne ne se dit « tiens, je n'ai rien reçu à 8 h 45 ». C'est la panne
silencieuse par excellence, celle contre laquelle tout ce projet a été écrit — il serait
absurde que son notifieur en soit atteint.

Le cas à ne jamais casser est la **clé de déduplication**. Le cron tourne toutes les 5
minutes : sans mémoire, le rappel de 9 h repartirait à 8 h 45, 8 h 50 et 8 h 55. Mais si
cette clé ne portait que l'identifiant de la tâche, une tâche **replanifiée** de mardi à
jeudi resterait marquée « déjà prévenu » et passerait sous silence. Deux assertions figent
le fait que changer l'heure — ou le jour — change la clé.

Les fenêtres sont vérifiées à leurs bords : le rappel part pile à 15 minutes, plus rien une
fois l'heure passée (« dans -3 min » ne veut rien dire), et le digest se tait passé la
fenêtre du matin, sans quoi un Worker déployé à 23 h enverrait aussitôt celui du jour. Le
cas qui tombe **entre deux jours** est figé aussi : un créneau à 00:05 doit être rappelé à
23:50 la veille, soit à une minute négative dans le repère de la journée.

L'échappement HTML n'est pas cosmétique — un titre contenant `<` ou `&` ferait *rejeter*
l'envoi par l'API Telegram, donc un rappel perdu en silence sur la tâche la plus mal
nommée. Les balises du gabarit, elles, doivent survivre.

**Le bilan du soir** ajoute une quinzaine d'assertions autour d'une idée : il ne répète pas
le digest. Deux cas y sont figés. D'abord l'**asymétrie assumée** — le digest part même à
vide, le bilan se tait, et une assertion vérifie les deux dans la même ligne : deux
battements de cœur par jour, c'en est un de trop. Ensuite le **harcèlement** : un créneau
non tenu d'un jour *précédent* ne doit pas être répété tous les soirs jusqu'à ce qu'on
cède, seuls ceux du jour figurent au bilan.

Une assertion vérifie aussi que les deux fenêtres (07:30–11:30 et 20:00–23:00) **ne se
recouvrent jamais** : les deux résumés annonceraient sinon la même journée deux fois, sous
deux angles, à la suite. Et que la fenêtre du soir ne franchit pas minuit — au-delà, le
« demain » du message ne serait plus demain.

**Le gîte** ajoute une vingtaine d'assertions sur la lecture du flux iCal. Le piège figé est
le **repliage de lignes** : une ligne iCal se coupe au-delà de 75 octets, et la `DESCRIPTION`
d'Airbnb — qui porte l'URL de la réservation — est toujours repliée. Sans dépliage, le lien
part tronqué dans le message, et rien ne le signale avant qu'on tape dessus. Le gabarit du
test reprend exactement la coupure du vrai flux.

L'autre cas verrouillé est la **provenance** : la plateforme se lit dans le domaine de
l'`UID`, jamais dans le libellé. Et un `Airbnb (Not available)` compte comme une arrivée
**en direct**, pas comme un trou — c'est la lecture que l'hôte fait de ses propres blocages,
et ce sont justement les clients à qui aucune plateforme ne pensera à sa place.

Deux assertions relisent enfin `worker.js` pour que le gîte **ne puisse pas faire tomber le
digest** : c'est une source externe au hub, sa panne doit coûter une section, pas un message.

Enfin, une quinzaine d'assertions relisent `config.js`, `firestore.rules`, `worker.js` et
`wrangler.toml` ensemble : que l'adresse du robot soit **la même** des deux côtés (sinon
Firestore le refuse et il se tait, ce qui ressemble à « rien à signaler »), qu'il ne puisse
**rien écrire**, que `notifieur()` ne soit nommé nulle part ailleurs, que le Worker calcule
l'heure de Paris et non celle du Worker, qu'il marque un envoi **après** coup et jamais
avant — et que `wrangler.toml`, versionné dans un dépôt public, ne contienne aucun secret.

### `test-taches.js` — un compteur qui ne doit pas mentir

Même faiblesse que le calendrier de cueillette : l'erreur y est **silencieuse**. Une liste
mal priorisée reste une liste plausible, on la suit sans se douter de rien. Le test pilote
donc la date du jour à la main et vérifie les verdicts, frontières comprises — J+7 est
urgent, J+8 ne l'est pas encore, et le jour même n'est *pas* un retard.

Le cas à ne jamais casser est le **compteur de reports** : c'est la seule chose qui sépare
une tâche en retard d'une tâche morte. Six assertions vérifient qu'il ne compte que ce qui
en est un — repousser une date qui existait déjà. Dater une tâche qui n'en avait pas, ou
corriger une saisie vers l'arrière, ne doit rien incrémenter, sinon il gonfle tout seul, on
cesse de le regarder, et le signal disparaît. Une septième vérifie que la première date
visée ne se réécrit jamais.

Deux assertions figent le **changement d'heure**. Le dernier dimanche de mars, une
soustraction de dates locales rend 23 heures et l'arrondi mange un jour : « en retard de
1 j » s'afficherait « 0 j » et la tâche changerait de bloc, deux fois par an, sans que rien
n'échoue.

Le reste couvre ce qu'un clic ne rattrape pas : le `where('creePar', …)` **obligatoire**
sans lequel Firestore rejette la requête en bloc et laisse un écran vide qu'on prendrait
pour une panne ; le fait que la page ne demande **rien du tout** sous impersonation ; que
`creePar` porte l'utilisateur *réel* et ne reparte jamais à la modification ; et que
l'accueil **réutilise** `compterEnRetard()` au lieu de recopier la règle — deux définitions
de « en retard » finiraient par diverger, la tuile en annoncerait deux quand la page en
montre trois.

Cinq assertions relisent enfin `firestore.rules`, dont une qui échoue si une clause
`superadmin()` réapparaît dans le bloc `taches` : c'est le seul lot du hub sans passe-droit,
et l'exception doit rester volontaire.

**La fusion des deux dates** (24 août 2026) a remplacé la trentaine d'assertions qui
verrouillaient la séparation échéance / créneau. Ce qui reste figé est le défaut qu'elle a
corrigé : une tâche à faire **cet après-midi** doit être *urgente*, pas rangée dans « Le
reste » — c'était le cas avant, parce que le créneau ne pesait rien sur la priorité.

Deux assertions vérifient que `planifieApresEcheance` et `sansCreneauAlorsQueProche` ont
bien **disparu** de la surface exportée : elles n'ont plus d'objet, une date ne pouvant pas
être en retard sur elle-même.

« Heure passée » n'est **pas** un retard, et une assertion l'affirme sur la même tâche : son
heure est derrière nous, la journée n'est pas finie. Les confondre reviendrait à crier au
loup un jour trop tôt. Le signal est testé deux fois — au calcul, puis **au rendu**, parce
que le calculer sans l'afficher est le genre de fil qui casse en silence.

La **bascule** a sa propre section : que seules les tâches portant un ancien `creneauJour`
soient reprises, que le créneau l'emporte quand les deux dates diffèrent, et surtout que les
trois anciens champs soient **supprimés** du document — laissés à traîner, la bannière ne
s'éteindrait jamais.

Le piège figé côté semaine est le **lundi d'un dimanche** : `getUTCDay()` rend 0 le
dimanche, et sans le décalage la semaine commencerait le lendemain — le bug classique de
tout calendrier maison. Côté grille, les voies parallèles se comptent par grappe de
chevauchements : une assertion vérifie qu'un doublon à 9 h ne rétrécit pas l'après-midi, qui
n'y est pour rien.

Côté saisie, l'heure est **facultative et vide par défaut** : une nouvelle tâche ne doit pas
s'ouvrir sur une heure inventée, et une heure choisie sans date ne doit pas être écrite. Le
cas à ne pas perdre est la **minute héritée** : une valeur du temps de l'`<input
type="time">` (14:37) doit rester dans la liste des quarts d'heure plutôt que d'être
arrondie en silence à la simple ouverture de la modale — même piège, et même remède, que le
projet « hérité » du carnet d'idées.

### `test-cueillette.js` — une machine à dates

Tout l'intérêt de la page tient dans « quel statut, aujourd'hui ? », et une erreur y est
**silencieuse** : un calendrier faux reste un calendrier plausible. Le test pilote donc la
date du jour à la main et vérifie les verdicts, jour d'ouverture et jour de fermeture inclus.

Le cas à ne jamais casser est l'**isolation par saison** : un forçage saisi pour 2026 ne doit
rien changer en 2027. Sans ce garde-fou, le référentiel dérive d'année en année sans que rien
ne le signale. Trois assertions le verrouillent, une par mode de forçage.

Deux autres pièges y sont figés. D'abord la distinction **« plus tard » ≠ « terminé »** : le
30 juillet, le cèpe qui ouvre le 25 août n'est pas une occasion manquée. Ensuite la
**priorité entre forçages concurrents**, vérifiée dans les deux sens de lecture — l'affichage
ne doit pas dépendre de l'ordre dans lequel Firestore renvoie les documents.

Le référentiel lui-même est audité : identifiants uniques, dates valides, pics à l'intérieur
de leur fenêtre, et surtout **aucun champignon sans champ `confusion`** — c'est là que
l'erreur se paie le plus cher. Ce test a déjà attrapé trois espèces qui en manquaient.

### `test-idees.js` — les droits par auteur

Le carnet est **lu par tous et écrit par chacun** : la moitié des assertions porte sur cette
asymétrie, parce qu'elle se casse en silence. Un sélecteur d'état qu'on oublie de griser
propose une action que Firestore refusera ; un `creePar` réécrit à la modification change
l'auteur d'une idée sans que personne le voie.

Un faux Firestore capture les écritures : on vérifie que la création pose bien l'auteur,
que la modification n'y touche pas, et qu'écrire sur l'idée d'un autre **n'envoie rien** —
le refus doit tomber avant l'aller-retour réseau, un message clair valant mieux qu'une
erreur de permissions.

Les registres `projets.js` et `sites.js` sont chargés pour de vrai : si un libellé change,
le test le voit. Le cas à ne pas casser est la valeur **héritée** — une idée d'avant la
liste fermée porte un `projet` qui n'y figure plus (« stock-watch »), et l'enregistrer ne
doit pas l'effacer.

Cinq assertions relisent enfin `firestore.rules` pour s'assurer que les règles disent la
même chose que le client suppose.

### `test-exterieur.js` — où porte l'effort

L'essentiel vise l'**analyseur `.eml`** : une fonction pure, sans DOM ni réseau, donc la
plus testable — et celle où une régression serait la plus silencieuse. Le cas à ne jamais
casser est un corps `base64` en `charset=UTF-8` : `atob()` rend du Latin-1, et sans repasse
« été » ressort en « Ã©tÃ© » **avec `parseOk` à `true`**, donc sans que la dégradation
prévue se déclenche. Rien n'échoue, tout est faux.

Le reste couvre ce qu'un clic ne rattrape pas : le calcul d'ancienneté et le seuil de
relance, le regroupement des devis par sujet malgré les variantes de casse et d'accents,
la recherche, la traçabilité sous impersonation (`creePar` doit nommer l'utilisateur
*réel*), et la validité JavaScript de chaque `onclick` généré.

Un faux Firestore capture les écritures : on vérifie ce qui **part réellement** en base,
pas seulement ce que l'écran affiche.

Le **journal** des tâches y ajoute deux garanties qu'aucun clic ne rattraperait. D'abord
qu'un événement s'**ajoute** (`arrayUnion`) au lieu de réécrire le tableau : le stub
enveloppe la valeur, si bien qu'un jour où quelqu'un passerait un tableau complet,
l'assertion tombe. Sans ça, deux notes prises en même temps s'effaceraient l'une l'autre,
en silence. Ensuite que la date d'une entrée est une vraie `Date` et **pas** un
`serverTimestamp()` — Firestore l'interdit dans un élément de tableau et rejetterait
l'écriture entière.

Le cas « on ne perd rien » est figé lui aussi : une tâche **sans** champ `journal` se lit,
affiche quand même sa création (déduite de `creeLe`), et un aller-retour dans le
formulaire d'une projection ne doit pas effacer son `imageSourceId` — même quand la photo
d'origine a disparu, le piège classique du `<select>` qui retombe sur « Aucune ».

Le **mail collé** ajoute le seul endroit du projet où un texte pourrait disparaître pour
de bon. Un `.eml` déposé se relit depuis Cloudinary ; un mail collé n'a pas de fichier, et
son corps est pourtant abrégé à `MAX_CORPS` pour l'affichage. Deux assertions verrouillent
l'aller-retour : le texte intégral part bien dans `emlBrut` à l'enregistrement, et
`corpsComplet()` le rend **entier** à la copie — l'analyseur `.eml` n'en tire rien
puisqu'il n'y a pas d'en-tête, d'où le repli sur le brut lui-même. Une troisième vérifie
qu'une simple modification n'écrase pas ce texte : le snapshot ne renvoie pas `emlBrut`,
le réécrire mettrait du vide à la place.

Le **rangement** est vérifié là où il se décide : l'intention (« déposer un document »)
doit battre l'extension, y compris pour un `.png` — c'est le bug signalé. Et une assertion
relit `index.html` pour que la liste `accept` du champ de dépôt ne diverge pas de la
constante JavaScript qui la réécrit, faute de quoi le filtre du sélecteur dépendrait du
bouton cliqué juste avant.

## Comment ça marche

Il n'y a pas de navigateur. Chaque test charge les vrais fichiers du site dans un contexte
`vm` de Node, avec un DOM minimal simulé (juste `getElementById`, `createElement`…), puis
appelle les fonctions et vérifie le résultat. Les assertions passent par une fonction
maison `verifie(nom, condition, detail)`.

C'est rustique, mais ça teste le code réellement livré, sans le dupliquer.

## Ce que ces tests ne couvrent pas

**Les règles Firestore.** Elles ne s'exécutent que chez Google et ne peuvent pas être
rejouées ici. `test-droits.js` vérifie seulement leur *cohérence avec le registre* — que
chaque projet déclaré possède bien un bloc `match`, et que l'adresse du propriétaire est
la même dans `config.js` et dans les règles. Pour éprouver les règles elles-mêmes,
utiliser le **Rules Playground** de la console Firebase.

**L'affichage.** Rien ne vérifie qu'une page est jolie ou même lisible ; les tests
regardent le HTML produit, pas son rendu.

## Ajouter un test

Déposer un fichier `test-<sujet>.js` dans ce dossier : `run-tests.js` le ramasse tout
seul. Copier la structure d'un test existant — le DOM simulé et la fonction `verifie()`
s'y trouvent en une vingtaine de lignes.

Terminer par :

```js
process.exit(echecs === 0 ? 0 : 1);
```
