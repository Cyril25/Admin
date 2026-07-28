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
        description: "Jardin, terrasse, exterieurs : ce qu'il y a a faire et ce qui a ete fait."
    }
];

function getProjet(slug) {
    for (var i = 0; i < PROJETS.length; i++) {
        if (PROJETS[i].slug === slug) return PROJETS[i];
    }
    return null;
}
