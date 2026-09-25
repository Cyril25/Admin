// ============================================================
// sw.js — Service worker du hub
// ============================================================
// Il n'est là que pour rendre le site installable sur l'écran
// d'accueil d'un téléphone (avec manifest.json).
//
// ⚠ AUCUN CACHE, volontairement. Celui de BilletsTouristiques garde
// une copie des pages, et oblige à changer son numéro de version à
// chaque modification du site, faute de quoi le téléphone continue
// d'afficher l'ancienne. Ici, sans Firestore, une page ne montre de
// toute façon rien : garder une copie hors ligne n'apporterait rien,
// et on n'a rien à penser à changer.
//
// Seul ajout : sans réseau, un message clair à la place de l'écran
// d'erreur du navigateur.
// ============================================================

var PAGE_HORS_LIGNE =
    '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
    + '<title>Hors connexion — Hub O\'Fil du Doubs</title>'
    + '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;'
    + 'font-family:Roboto,Arial,sans-serif;background:#F8FAFC;color:#1F2933;text-align:center;padding:16px;box-sizing:border-box}'
    + 'button{margin-top:16px;padding:10px 20px;border:0;border-radius:6px;background:#2C4A63;color:#fff;font-size:1rem}</style>'
    + '</head><body><div><h1>Pas de connexion</h1>'
    + '<p>Le hub a besoin d\'internet pour afficher vos données.</p>'
    + '<button type="button" onclick="location.reload()">Réessayer</button></div></body></html>';

self.addEventListener('install', function() {
    self.skipWaiting();
});

self.addEventListener('activate', function(event) {
    // Le préchargement lance la requête pendant que le worker démarre :
    // sans lui, chaque changement de page attendrait ce démarrage.
    var preparation = self.registration.navigationPreload
        ? self.registration.navigationPreload.enable()
        : Promise.resolve();
    event.waitUntil(preparation.then(function() { return self.clients.claim(); }));
});

self.addEventListener('fetch', function(event) {
    // Tout le reste (scripts, styles, Firestore…) passe sans détour.
    if (event.request.mode !== 'navigate') return;

    event.respondWith(
        Promise.resolve(event.preloadResponse)
            .then(function(prechargee) { return prechargee || fetch(event.request); })
            .catch(function() {
                return new Response(PAGE_HORS_LIGNE, {
                    headers: { 'Content-Type': 'text/html; charset=utf-8' }
                });
            })
    );
});
