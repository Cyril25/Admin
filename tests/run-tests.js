// ============================================================
// run-tests.js — Lance tous les tests du hub
// ============================================================
//   node tests/run-tests.js
//
// Sortie 0 si tout passe, 1 sinon. Aucune dependance : ni npm, ni
// framework, ni fichier de configuration — meme philosophie que le
// site lui-meme, qui n'a pas d'etape de build.
//
// Ajouter un test = deposer un fichier « test-*.js » dans ce dossier.
// Il sera ramasse automatiquement.
// ============================================================

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dossier = __dirname;
const fichiers = fs.readdirSync(dossier)
  .filter((f) => /^test-.*\.js$/.test(f))
  .sort();

if (!fichiers.length) {
  console.log('Aucun fichier test-*.js trouve dans ' + dossier);
  process.exit(1);
}

let echecs = 0;

for (const fichier of fichiers) {
  console.log('\n' + '='.repeat(60));
  console.log('  ' + fichier);
  console.log('='.repeat(60));

  const resultat = spawnSync(process.execPath, [path.join(dossier, fichier)], {
    stdio: 'inherit',
  });

  if (resultat.status !== 0) echecs++;
}

console.log('\n' + '='.repeat(60));
if (echecs === 0) {
  console.log('  ' + fichiers.length + ' fichier(s) de test : tout passe.');
} else {
  console.log('  ' + echecs + ' fichier(s) de test en echec sur ' + fichiers.length + '.');
}
console.log('='.repeat(60));

process.exit(echecs === 0 ? 0 : 1);
