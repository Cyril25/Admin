// ============================================================
// sites.js — Registre des sites en ligne
// ============================================================
// Les tuiles « Sites » de l'accueil et les cases a cocher de la page
// Membres sortent d'ici. Un membre ne voit que les sites coches sur sa
// fiche ; un superadmin les voit tous, y compris ceux ajoutes plus tard.
//
// ⚠ CE REGISTRE N'EST PLUS PUREMENT DECORATIF.
// A l'origine, ce n'etaient que des LIENS externes : les masquer relevait
// du confort d'affichage, aucune regle Firestore ne lisait membres.sites.
//
// Ce n'est plus vrai de « collections ». Ce site partage ce projet
// Firebase et possede ses propres collections Firestore, dont l'acces se
// donne AU NIVEAU DU SITE : cocher cette case ouvre de vraies donnees, et
// les blocs match /achats et match /fournisseurs de firestore.rules
// interrogent bel et bien ce tableau.
//
// Les autres entrees restent de simples raccourcis. Le champ `protege`
// ci-dessous marque la difference, pour que l'interface puisse la dire au
// lieu de laisser croire que toutes les cases se valent.
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
        // Le seul site dont la case a cocher ouvre de vraies donnees.
        protege: true,
        description: 'Suivi des achats et carnet de comptes fournisseurs. Chacun n\'y voit que ses propres donnees.'
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
