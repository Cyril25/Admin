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
// ⚠ CE REGISTRE NE CONTIENT QUE LES PAGES DU HUB LUI-MEME.
// Un site heberge ailleurs — collections.ofildudoubs.fr — n'entre PAS
// ici, meme s'il partage ce projet Firebase et cet annuaire : son acces
// se donne au niveau du SITE, dans sites.js et membres.sites. Ses pages
// ne sont pas des projets du hub, et son autorisation est unique pour
// tout le site plutot que decoupee par ecran.
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
        slug: 'taches',
        nom: 'Mes taches',
        icone: 'fa-solid fa-list-check',
        url: 'taches/',
        description: "La to-do priorisee. L'importance se declare, l'urgence se deduit de l'echeance : une tache devient urgente toute seule en vieillissant. Ce qui est en retard remonte en tete et compte ses reports."
    },
    {
        slug: 'cueillette',
        nom: 'Calendrier de cueillette',
        icone: 'fa-solid fa-basket-shopping',
        url: 'cueillette/',
        description: "Quoi recolter aujourd'hui dans le Haut-Doubs, entre 800 et 1200 m : champignons, baies, fruits a coque, ail des ours. Le decalage d'altitude est integre aux fenetres, et les aleas de l'annee se forcent a la main."
    }
];

function getProjet(slug) {
    for (var i = 0; i < PROJETS.length; i++) {
        if (PROJETS[i].slug === slug) return PROJETS[i];
    }
    return null;
}
