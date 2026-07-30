// ============================================================
// projets.js — Registre des projets du hub
// ============================================================
// Source unique : le menu, les tuiles de l'accueil et les cases a
// cocher de la page Membres sont tous construits a partir d'ici.
//
// AJOUTER UN PROJET — trois gestes, aucun n'est optionnel :
//   1. une entree dans PROJETS ci-dessous ;
//   2. un dossier a la racine (ex. « exterieur/ ») avec au moins un
//      index.html, dont le <body> porte data-projet="<slug>" et
//      data-racine="../" ;
//   3. un bloc match dans firestore.rules pour sa collection.
// Sans le point 3, la page s'affiche et ne charge rien : c'est le
// catch-all « allow read, write: if false » qui ferme la collection.
//
// Le slug sert de cle partout : nom de la collection Firestore, valeur
// stockee dans membres.projets, et identifiant du droit d'acces. Ne
// jamais le renommer sans migrer les fiches membres.
//
// PROJETS HEBERGES AILLEURS (externe: true)
// Un projet peut vivre sur un autre sous-domaine tout en partageant ce
// projet Firebase et cet annuaire — c'est le cas de Collections. Son
// droit se donne ICI, puisque la page Membres est le seul endroit qui
// ecrit dans membres.projets, mais :
//   - il n'entre PAS dans le menu du hub : un lien de navigation qui
//     quitte le site n'est pas un lien de navigation ;
//   - il apparait dans les tuiles de l'accueil, avec son URL complete.
// ============================================================

var PROJETS = [
    {
        slug: 'idees',
        nom: 'Idees / Projets',
        icone: 'fa-solid fa-lightbulb',
        url: 'idees/',
        description: "Le carnet d'idees : importance, complexite, etat d'avancement, tous projets confondus."
    },
    {
        slug: 'exterieur',
        nom: 'Exterieur de la maison',
        icone: 'fa-solid fa-seedling',
        url: 'exterieur/',
        description: "Le chantier au meme endroit : devis, mails archives, photos, taches, contacts. La vue d'accueil repond a une seule question — la balle est dans quel camp ?"
    },
    {
        slug: 'achats',
        nom: 'Achats de collection',
        icone: 'fa-solid fa-cart-shopping',
        url: 'https://collections.ofildudoubs.fr/index.html',
        externe: true,
        description: "Commandes passees, colis attendus, montant depense, exemplaires en trop. Chacun ne voit QUE ses propres lignes : cocher cette case ouvre la page, pas les achats des autres."
    },
    {
        slug: 'fournisseurs',
        nom: 'Comptes fournisseurs',
        icone: 'fa-solid fa-key',
        url: 'https://collections.ofildudoubs.fr/comptes.html',
        externe: true,
        // Ecrit ici parce que c'est ici qu'on coche la case : le droit et
        // sa portee doivent se lire au meme endroit.
        description: "Carnet de fournisseurs et d'identifiants du site Collections. Chacun ne voit QUE ses propres fiches : cocher cette case ouvre la page, pas les comptes des autres."
    }
];

function getProjet(slug) {
    for (var i = 0; i < PROJETS.length; i++) {
        if (PROJETS[i].slug === slug) return PROJETS[i];
    }
    return null;
}
