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
