// ============================================================
// sites.js — Registre des sites en ligne
// ============================================================
// Les tuiles « Sites » de l'accueil et les cases a cocher de la page
// Membres sortent d'ici. Un membre ne voit que les sites coches sur sa
// fiche ; un superadmin les voit tous, y compris ceux ajoutes plus tard.
//
// DIFFERENCE IMPORTANTE AVEC projets.js : ce ne sont que des LIENS
// externes. Les masquer releve du confort d'affichage, pas de la
// securite — il n'y a aucune donnee derriere, et ces sites ont leur
// propre protection (ou sont publics). Aucune regle Firestore n'est
// donc necessaire pour un site, contrairement a un projet.
//
// Le slug est stocke dans membres.sites : ne pas le renommer sans
// migrer les fiches.
// ============================================================

var SITES = [
    {
        slug: 'ofildudoubs',
        nom: "O'Fil du Doubs",
        icone: 'fa-solid fa-house-chimney',
        url: 'https://ofildudoubs.fr',
        libelleUrl: 'ofildudoubs.fr',
        description: 'Site vitrine du gite de Labergement-Sainte-Marie.'
    },
    {
        slug: 'lefuverat',
        nom: 'Le Fuverat',
        icone: 'fa-solid fa-tree',
        url: 'https://lefuverat.ofildudoubs.fr',
        libelleUrl: 'lefuverat.ofildudoubs.fr',
        description: 'Site vitrine du second hebergement.'
    },
    {
        slug: 'billets',
        nom: 'Billets Touristiques',
        icone: 'fa-solid fa-ticket',
        url: 'https://cyril25.github.io/BilletsTouristiques/',
        libelleUrl: 'cyril25.github.io/BilletsTouristiques',
        description: 'Gestion de collection du groupe — le seul projet en equipe.'
    },
    {
        slug: 'collections',
        nom: 'Collections',
        icone: 'fa-solid fa-boxes-stacked',
        url: 'https://collections.ofildudoubs.fr',
        libelleUrl: 'collections.ofildudoubs.fr',
        description: 'Suivi des achats de collection : commandes, receptions, doublons.'
    },
    {
        slug: 'lephare',
        nom: 'Le Phare',
        icone: 'fa-solid fa-martini-glass',
        url: 'https://lephare.ofildudoubs.fr',
        libelleUrl: 'lephare.ofildudoubs.fr',
        badge: 'standby',
        description: 'POC de site vitrine, en attente de debranchement.'
    }
];

function getSite(slug) {
    for (var i = 0; i < SITES.length; i++) {
        if (SITES[i].slug === slug) return SITES[i];
    }
    return null;
}
