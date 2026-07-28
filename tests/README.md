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
| `test-idees.js` | La page Idées : tri, filtres, échappement, export JSON |
| `test-exterieur.js` | Le pilotage du chantier : analyseur `.eml`, camp et relances, regroupement des devis, recherche, écritures |

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
