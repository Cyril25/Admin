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
