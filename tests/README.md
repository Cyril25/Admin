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

**La planification** ajoute une trentaine d'assertions autour d'une seule idée : l'échéance
et le créneau sont deux choses. Deux d'entre elles la verrouillent directement — poser un
créneau ne doit changer ni le bloc de la tâche ni son nombre de jours de retard. Les trois
signaux qu'ouvre cette séparation sont testés deux fois : au calcul, puis **au rendu**, parce
que les calculer sans les afficher est le genre de fil qui casse en silence.

« Créneau manqué » n'est **pas** un retard, et une assertion l'affirme sur la même tâche :
son heure est passée, son échéance tient encore. Les confondre reviendrait à crier au loup
un jour trop tôt.

Le piège figé côté semaine est le **lundi d'un dimanche** : `getUTCDay()` rend 0 le
dimanche, et sans le décalage la semaine commencerait le lendemain — le bug classique de
tout calendrier maison. Côté grille, les voies parallèles se comptent par grappe de
chevauchements : une assertion vérifie qu'un doublon à 9 h ne rétrécit pas l'après-midi, qui
n'y est pour rien.

Côté saisie, c'est **le jour qui crée le créneau** : une heure choisie sans jour ne doit
écrire aucun des trois champs — ce serait une seconde échéance déguisée, exactement la
confusion que toute cette conception cherche à éviter. Le cas à ne pas perdre est la
**minute héritée** : une valeur du temps de l'`<input type="time">` (14:37) doit rester dans
la liste des quarts d'heure plutôt que d'être arrondie en silence à la simple ouverture de
la modale — même piège, et même remède, que le projet « hérité » du carnet d'idées.

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
