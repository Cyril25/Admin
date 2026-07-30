// ============================================================
// especes.js — Référentiel de cueillette du Haut-Doubs
// ============================================================
// PÉRIMÈTRE STRICT, et c'est ce qui fait la valeur de ce fichier :
// secteur Mouthe / Labergement / Vaux-et-Chantegrue / Pontarlier /
// Frasne / Levier, tranche d'altitude 800–1200 m.
//
// Les fenêtres ci-dessous ne sont PAS des périodes « France entière »
// recopiées d'un almanach : elles intègrent déjà le décalage
// phénologique de la tranche (2 à 3 semaines de retard sur la plaine au
// printemps, saison d'automne coupée net par la première vraie gelée).
// Les transposer ailleurs les rendrait fausses.
//
// ⚠ POURQUOI CE FICHIER ET PAS UNE API.
// Aucun flux public ne donne « quoi récolter à 1000 m dans le Haut-Doubs
// aujourd'hui » (voir la section correspondante du README). Ce référentiel
// est donc tenu à la main, versionné dans git au même titre que
// projets.js : c'est de la STRUCTURE, publique et non secrète. Ce qui
// varie d'une année sur l'autre — canicule, gelées tardives, arrêtés —
// ne s'écrit pas ici mais dans les FORÇAGES, stockés en base (voir
// cueillette.js). Ne jamais corriger une date ici pour cause de mauvaise
// année : ce serait déplacer durablement une fenêtre pour un aléa
// ponctuel.
//
// Champs :
//   id           slug stable — c'est la clé qu'un forçage vise. Ne pas
//                le renommer sans migrer les documents « cueillette ».
//   nom, latin   le latin lève les ambiguïtés des noms locaux
//   categorie    champignon | baie | noix | plante
//   debut, fin   { mois: 1-12, jour } — récurrence annuelle, pas de date
//                absolue : une fenêtre vaut pour toutes les années
//   pic          facultatif — le cœur de la fenêtre, quand ça vaut
//                vraiment le déplacement
//   biotope      où chercher, formulé pour être lu sur le terrain
//   altitude     ce que la tranche 800–1200 m change pour CETTE espèce
//   effort       1 ça se ramasse | 2 il faut chercher | 3 il faut savoir
//   rendement    1 quelques poignées | 2 un panier | 3 de quoi conserver
//   confusion    facultatif — la sosie dangereuse et comment trancher
//   reglementation facultatif — ce qui est limité ou interdit ici
//   note         le détail de terrain qui change une sortie
// ============================================================

var ESPECES = [

    // ---------- Champignons ----------
    {
        id: 'morille',
        nom: 'Morille',
        latin: 'Morchella esculenta / conica',
        categorie: 'champignon',
        debut: { mois: 4, jour: 15 },
        fin: { mois: 5, jour: 31 },
        pic: { debut: { mois: 4, jour: 25 }, fin: { mois: 5, jour: 20 } },
        biotope: "Fonds frais et frênaies, lisières, vieux vergers, sols remués et bois de coupe. Sur calcaire, exposition sud-est.",
        altitude: "Surtout 800–1000 m. Monte peu au-dessus : au-delà, le sol est encore trop froid quand la fenêtre passe.",
        effort: 3,
        rendement: 1,
        confusion: "Gyromitre (Gyromitra esculenta), toxique et parfois mortelle : chapeau en cervelle, pied PLEIN. La morille est creuse d'un bout à l'autre — couper en deux dans la longueur, systématiquement.",
        note: "Jamais crue ni juste tiédie, même vraie : elle reste toxique sous 15 minutes de cuisson franche."
    },
    {
        id: 'mousseron',
        nom: 'Mousseron de la Saint-Georges',
        latin: 'Calocybe gambosa',
        categorie: 'champignon',
        debut: { mois: 5, jour: 10 },
        fin: { mois: 6, jour: 20 },
        biotope: "Prairies pâturées, lisières et haies, en ronds de sorcière. Franchement calcicole.",
        altitude: "La Saint-Georges (23 avril) qui lui donne son nom vaut pour la plaine : ici, compter deux à trois semaines de plus.",
        effort: 2,
        rendement: 2,
        confusion: "Entolome livide (Entoloma sinuatum), même habitat, toxicité sévère : ses lames virent au ROSE saumon à maturité, celles du mousseron restent blanc-crème. Odeur de farine fraîche des deux côtés — l'odeur ne tranche pas.",
        note: "Le même rond redonne au même endroit chaque année : ça se note une fois pour toutes."
    },
    {
        id: 'cepe-ete',
        nom: "Cèpe d'été",
        latin: 'Boletus aestivalis',
        categorie: 'champignon',
        debut: { mois: 6, jour: 20 },
        fin: { mois: 8, jour: 31 },
        biotope: "Hêtraies claires et lisières chaudes, plutôt en bas de versant.",
        altitude: "Le seul cèpe vraiment estival de la tranche ; il précède le Bordeaux d'un bon mois et occupe des stations plus basses.",
        effort: 2,
        rendement: 2,
        confusion: "Bolet amer (Tylopilus felleus), sans danger mais qui gâche un plat entier à lui seul : réseau SOMBRE en relief sur le pied, tubes virant au rosé. Chez le cèpe, le réseau est blanc et fin. Dans le doute, lécher une miette du chapeau — l'amertume est immédiate.",
        note: "Chapeau mat et craquelé par la sécheresse : c'est normal, ça ne dit rien de sa fraîcheur. Regarder les tubes et le pied."
    },
    {
        id: 'girolle',
        nom: 'Girolle',
        latin: 'Cantharellus cibarius',
        categorie: 'champignon',
        debut: { mois: 6, jour: 25 },
        fin: { mois: 10, jour: 31 },
        pic: { debut: { mois: 8, jour: 15 }, fin: { mois: 9, jour: 30 } },
        biotope: "Sous-bois acide et moussu, pessières et sapinières, souvent au pied des myrtilliers. En troupes serrées.",
        altitude: "La longue fenêtre est réelle ici : à 1000 m elle sort par vagues successives après chaque pluie, de juillet aux premières gelées.",
        effort: 2,
        rendement: 2,
        confusion: "Fausse girolle (Hygrophoropsis aurantiaca), sans gravité mais sans intérêt : elle a de vraies LAMES fines et serrées. La girolle n'a que des plis épais et fourchus, descendant sur le pied, et sent l'abricot.",
        note: "Une station qui produit produira encore : couper au couteau sans retourner la mousse."
    },
    {
        id: 'cepe',
        nom: 'Cèpe de Bordeaux',
        latin: 'Boletus edulis',
        categorie: 'champignon',
        debut: { mois: 8, jour: 25 },
        fin: { mois: 11, jour: 5 },
        pic: { debut: { mois: 9, jour: 5 }, fin: { mois: 10, jour: 15 } },
        biotope: "Pessières et hêtraies-sapinières, sur tapis de mousse, souvent en bordure de layon ou de clairière.",
        altitude: "C'est l'espèce reine de la tranche 900–1200 m ; sous 800 m la poussée est plus courte et plus précoce.",
        effort: 2,
        rendement: 3,
        confusion: "Bolet amer (Tylopilus felleus) : même silhouette, réseau sombre sur le pied, immangeable d'amertume. Le bolet de Satan, lui, est rare ici et se reconnaît à ses PORES ROUGES — aucun bolet à pores rouges ne se ramasse. Chez le cèpe, les tubes vont du blanc au jaune-olive et la chair reste blanche à la coupe.",
        note: "Sort 10 à 15 jours après une pluie franche suivie de nuits encore douces. Dans ce secteur, c'est la première vraie gelée qui coupe la saison net, pas le calendrier."
    },
    {
        id: 'trompette',
        nom: 'Trompette des morts',
        latin: 'Craterellus cornucopioides',
        categorie: 'champignon',
        debut: { mois: 9, jour: 1 },
        fin: { mois: 11, jour: 15 },
        biotope: "Hêtraies sur calcaire, dans la litière de feuilles, en larges colonies.",
        altitude: "Peu sensible à l'altitude dans la tranche, très sensible à l'humidité du sol : les combes fraîches d'abord.",
        effort: 3,
        rendement: 2,
        confusion: "Aucune dangereuse — c'est sa grande qualité. Le noir sur brun des feuilles mortes rend l'espèce difficile à VOIR, pas à reconnaître.",
        note: "S'accroupir et attendre que l'œil s'accommode : on en trouve une, puis cinquante. Se sèche parfaitement et se réduit en poudre."
    },
    {
        id: 'chanterelle-tube',
        nom: 'Chanterelle en tube',
        latin: 'Craterellus tubaeformis',
        categorie: 'champignon',
        debut: { mois: 10, jour: 1 },
        fin: { mois: 11, jour: 30 },
        biotope: "Sous-bois acide, mousses et bois pourrissant, sous épicéas.",
        altitude: "La dernière de la saison : elle tient tant que le sol n'est pas gelé, souvent bien après les cèpes.",
        effort: 2,
        rendement: 2,
        confusion: "Aucune dangereuse : pied jaune creux, plis espacés et gris sous le chapeau. Le seul risque est de passer à côté en la prenant pour une petite girolle fanée.",
        note: "Résiste à une gelée blanche légère, pas à une gelée durable. C'est souvent la sortie de rattrapage d'une mauvaise année."
    },
    {
        id: 'pied-de-mouton',
        nom: 'Pied-de-mouton',
        latin: 'Hydnum repandum',
        categorie: 'champignon',
        debut: { mois: 9, jour: 1 },
        fin: { mois: 11, jour: 15 },
        biotope: "Sous-bois de feuillus comme de résineux, en lignes ou en ronds.",
        altitude: "Présent dans toute la tranche, souvent quand il n'y a plus rien d'autre.",
        effort: 1,
        rendement: 2,
        confusion: "Sous le chapeau, ni lames ni tubes mais des AIGUILLONS qui se détachent au doigt : rien de dangereux ne ressemble à ça. C'est le champignon par lequel commencer.",
        note: "Amer en vieillissant : ôter les aiguillons et blanchir les gros sujets."
    },
    {
        id: 'coulemelle',
        nom: 'Coulemelle',
        latin: 'Macrolepiota procera',
        categorie: 'champignon',
        debut: { mois: 8, jour: 1 },
        fin: { mois: 10, jour: 15 },
        biotope: "Prairies, pâtures, lisières et talus — en plein découvert, pas en forêt.",
        effort: 1,
        rendement: 2,
        confusion: "⚠ Les petites lépiotes (chapeau sous 10 cm) sont toxiques, certaines mortelles. Ne ramasser que les grands sujets : pied chiné comme une peau de serpent, anneau COULISSANT qu'on fait glisser au doigt.",
        note: "Le pied est fibreux et immangeable : on ne garde que le chapeau."
    },
    {
        id: 'lactaire-delicieux',
        nom: 'Lactaire délicieux',
        latin: 'Lactarius deliciosus',
        categorie: 'champignon',
        debut: { mois: 9, jour: 1 },
        fin: { mois: 10, jour: 31 },
        biotope: "Sous épicéas et pins, sur sol pauvre, souvent en lisière de plantation.",
        effort: 1,
        rendement: 2,
        confusion: "Le lait est ORANGE carotte et verdit à l'air. Un lactaire à lait BLANC sous résineux n'est pas celui-là et n'est pas bon.",
        note: "Verdit en vieillissant et à la cuisson : c'est le signe de l'espèce, pas de l'avarie."
    },

    // ---------- Baies ----------
    {
        id: 'fraise-des-bois',
        nom: 'Fraise des bois',
        latin: 'Fragaria vesca',
        categorie: 'baie',
        debut: { mois: 6, jour: 10 },
        fin: { mois: 8, jour: 20 },
        biotope: "Talus, bords de chemins forestiers, coupes récentes et lisières ensoleillées.",
        altitude: "L'étalement est plus large ici qu'en plaine : les stations d'ombre à 1100 m donnent encore en août.",
        effort: 2,
        rendement: 1,
        note: "Se ramasse pour le plaisir, pas pour le volume : une heure fait un bol."
    },
    {
        id: 'framboise-sauvage',
        nom: 'Framboise sauvage',
        latin: 'Rubus idaeus',
        categorie: 'baie',
        debut: { mois: 7, jour: 5 },
        fin: { mois: 9, jour: 10 },
        biotope: "Coupes forestières et clairières récentes, éboulis, bords de pistes — partout où la forêt a été ouverte.",
        altitude: "Espèce d'altitude par excellence : elle est ici plus abondante et plus parfumée qu'en plaine.",
        effort: 1,
        rendement: 3,
        note: "Une coupe de trois à six ans est une mine ; passé dix ans, les épicéas ont repris la place."
    },
    {
        id: 'myrtille',
        nom: 'Myrtille sauvage',
        latin: 'Vaccinium myrtillus',
        categorie: 'baie',
        debut: { mois: 7, jour: 15 },
        fin: { mois: 9, jour: 10 },
        pic: { debut: { mois: 7, jour: 25 }, fin: { mois: 8, jour: 20 } },
        biotope: "Sous-bois acide, pessières claires et landes à myrtilliers, bordures de tourbières.",
        altitude: "Le décalage d'altitude est ici un atout : au-dessus de 1000 m la fenêtre s'ouvre deux à trois semaines après celle des versants bas, ce qui allonge d'autant la saison si l'on monte au fil de l'été.",
        effort: 2,
        rendement: 3,
        reglementation: "Le peigne à myrtilles est interdit en forêt : il arrache les pousses et stérilise la station pour des années. Cueillette à la main.",
        note: "Les stations d'ombre mûrissent après celles de plein soleil : quand c'est fini en lisière, ça commence sous couvert."
    },
    {
        id: 'airelle-rouge',
        nom: 'Airelle rouge',
        latin: 'Vaccinium vitis-idaea',
        categorie: 'baie',
        debut: { mois: 8, jour: 20 },
        fin: { mois: 9, jour: 30 },
        biotope: "Pessières claires et bordures de tourbières — secteur de Frasne, Vaux-et-Chantegrue.",
        altitude: "Plus stricte que la myrtille sur l'altitude : à chercher au-dessus de 900 m, sur les sols les plus pauvres.",
        effort: 3,
        rendement: 1,
        note: "Acide crue, excellente cuite en accompagnement. Feuillage persistant et vernissé : la station se repère en hiver pour l'été suivant."
    },
    {
        id: 'mure',
        nom: 'Mûre sauvage',
        latin: 'Rubus fruticosus',
        categorie: 'baie',
        debut: { mois: 8, jour: 20 },
        fin: { mois: 10, jour: 15 },
        biotope: "Haies, lisières et bords de chemins, en plein soleil.",
        altitude: "C'est l'espèce que l'altitude pénalise le plus : au-dessus de 1000 m beaucoup de mûres ne mûrissent jamais. Chercher les bas de versant et les expositions sud.",
        effort: 1,
        rendement: 2,
        note: "Une gelée précoce fin septembre arrête tout d'un coup : ne pas remettre au week-end suivant."
    },
    {
        id: 'sureau-fleurs',
        nom: 'Sureau noir — fleurs',
        latin: 'Sambucus nigra',
        categorie: 'baie',
        debut: { mois: 5, jour: 25 },
        fin: { mois: 6, jour: 30 },
        biotope: "Haies, friches, abords de fermes et de vieux murs.",
        altitude: "Deux à trois semaines après la plaine ; les sujets d'ombre prolongent la fenêtre.",
        effort: 1,
        rendement: 2,
        note: "Cueillir en ombelles entières, par temps sec et en milieu de journée, quand le parfum est au plus fort. Ne pas laver : on perdrait le pollen, qui fait tout le goût du sirop.",
        confusion: "Sureau yèble (Sambucus ebulus), toxique : c'est une HERBE d'un mètre à un mètre cinquante, qui meurt l'hiver, et ses ombelles sont dressées. Le sureau noir est un arbuste à tronc ligneux."
    },
    {
        id: 'sureau-baies',
        nom: 'Sureau noir — baies',
        latin: 'Sambucus nigra',
        categorie: 'baie',
        debut: { mois: 8, jour: 25 },
        fin: { mois: 9, jour: 30 },
        biotope: "Mêmes pieds que les fleurs — d'où l'intérêt de noter les stations au printemps.",
        effort: 1,
        rendement: 2,
        note: "TOUJOURS cuites : crues, elles sont vomitives. Ne récolter que les ombelles retombantes et entièrement noires ; une seule baie rouge dans le lot, c'est trop tôt.",
        confusion: "Sureau yèble, toxique, dont les ombelles restent DRESSÉES à maturité et dont la tige est herbacée."
    },
    {
        id: 'cynorrhodon',
        nom: 'Cynorrhodon',
        latin: 'Rosa canina',
        categorie: 'baie',
        debut: { mois: 10, jour: 1 },
        fin: { mois: 12, jour: 20 },
        biotope: "Haies, lisières et pâtures embuissonnées — les églantiers en plein vent.",
        altitude: "La fenêtre tardive joue en faveur du secteur : les gelées d'octobre arrivent tôt ici, et ce sont elles qu'on attend.",
        effort: 2,
        rendement: 2,
        note: "Meilleur APRÈS les premières fortes gelées, qui blettissent la baie et la rendent sucrée. Cueillir avant est une erreur classique : dur, acide, et pénible à passer."
    },
    {
        id: 'prunelle',
        nom: 'Prunelle',
        latin: 'Prunus spinosa',
        categorie: 'baie',
        debut: { mois: 10, jour: 5 },
        fin: { mois: 11, jour: 30 },
        biotope: "Haies épineuses, friches et bords de pâtures.",
        effort: 2,
        rendement: 2,
        note: "Comme le cynorrhodon : attendre la gelée, sinon c'est immangeable d'astringence. À défaut, un passage au congélateur fait le même travail."
    },

    // ---------- Noix ----------
    {
        id: 'noisette',
        nom: 'Noisette',
        latin: 'Corylus avellana',
        categorie: 'noix',
        debut: { mois: 8, jour: 20 },
        fin: { mois: 9, jour: 25 },
        biotope: "Haies, lisières et bosquets, souvent en bord de chemin.",
        effort: 1,
        rendement: 2,
        note: "Course de vitesse avec les écureuils et les mulots : passer tôt dans la fenêtre. Une noisette qui se détache seule de sa cupule est mûre."
    },
    {
        id: 'noix',
        nom: 'Noix',
        latin: 'Juglans regia',
        categorie: 'noix',
        debut: { mois: 9, jour: 20 },
        fin: { mois: 10, jour: 25 },
        biotope: "Arbres isolés, vieux vergers, abords de fermes.",
        altitude: "C'est la limite haute de l'espèce : sous 900 m surtout. Au-dessus, l'arbre existe mais les fruits remplissent mal une année sur deux.",
        effort: 1,
        rendement: 2,
        note: "Ramasser au sol après la chute naturelle, et faire sécher sans attendre : une noix laissée dans son brou noircit et moisit en quelques jours."
    },
    {
        id: 'faine',
        nom: 'Faîne',
        latin: 'Fagus sylvatica',
        categorie: 'noix',
        debut: { mois: 9, jour: 25 },
        fin: { mois: 10, jour: 31 },
        biotope: "Hêtraies, au sol, après les premiers coups de vent.",
        effort: 3,
        rendement: 1,
        note: "Bonne récolte tous les trois à cinq ans seulement (les « fainées ») : les autres années, les cupules sont vides. Ne pas en manger de grandes quantités crues."
    },

    // ---------- Plantes ----------
    {
        id: 'ail-des-ours',
        nom: 'Ail des ours',
        latin: 'Allium ursinum',
        categorie: 'plante',
        debut: { mois: 4, jour: 10 },
        fin: { mois: 5, jour: 25 },
        pic: { debut: { mois: 4, jour: 15 }, fin: { mois: 5, jour: 10 } },
        biotope: "Fonds de vallons frais, frênaies humides, gorges et bords de ruisseaux. En tapis denses, jamais isolé.",
        altitude: "⚠ L'espèce est surtout une affaire de 400–900 m : sur le plateau au-dessus de 1000 m elle est rare. À chercher dans les combes et les vallées encaissées plutôt qu'en altitude — c'est la seule du référentiel qui invite à DESCENDRE.",
        effort: 1,
        rendement: 3,
        confusion: "⚠ MORTEL. Colchique d'automne et muguet poussent au milieu des tapis d'ail des ours. Froisser UNE feuille à la fois : l'ail des ours sent l'ail, et il faut se laver les doigts entre deux vérifications, sinon tout sent l'ail. Sa feuille a un pétiole individuel et un dessous mat ; celle du muguet est brillante et enroule deux feuilles sur une même tige.",
        note: "Les feuilles perdent leur intérêt dès la floraison : c'est une fenêtre courte, il faut y aller."
    },
    {
        id: 'pissenlit',
        nom: 'Pissenlit',
        latin: 'Taraxacum officinale',
        categorie: 'plante',
        debut: { mois: 3, jour: 15 },
        fin: { mois: 5, jour: 10 },
        biotope: "Prés, talus, jardins — partout, et c'est bien l'intérêt.",
        altitude: "Suit la fonte : sur les prés de Mouthe la fenêtre s'ouvre nettement après celle de Pontarlier.",
        effort: 1,
        rendement: 2,
        note: "Avant la floraison, sinon amer. Le cœur blanc du pied, coupé sous le collet, est la seule partie qui vaille en salade."
    },
    {
        id: 'gentiane-jaune',
        nom: 'Gentiane jaune (racine)',
        latin: 'Gentiana lutea',
        categorie: 'plante',
        debut: { mois: 9, jour: 1 },
        fin: { mois: 10, jour: 31 },
        biotope: "Pâturages d'altitude et pré-bois, sur les versants ouverts.",
        altitude: "Emblématique de la tranche : elle ne pousse pas en plaine, et le secteur est l'un de ses bastions.",
        effort: 3,
        rendement: 2,
        reglementation: "⚠ Récolte réglementée. Accord du propriétaire indispensable, et interdite ou contingentée sur plusieurs communes. Ne rien arracher sans avoir vérifié le statut de la parcelle.",
        confusion: "⚠ MORTEL. Le vératre blanc (Veratrum album) partage exactement la même station et sa racine ressemble à s'y méprendre. Gentiane : feuilles OPPOSÉES, nervures parallèles, fleurs jaunes. Vératre : feuilles ALTERNES et plissées, fleurs verdâtres. Ne jamais récolter un pied qu'on n'a pas repéré en fleur pendant l'été.",
        note: "L'espèce met dix ans à faire une racine : repérer les pieds en juillet, récolter en automne, et laisser les jeunes."
    },
    {
        id: 'bourgeons-sapin',
        nom: "Pousses d'épicéa et de sapin",
        latin: 'Picea abies / Abies alba',
        categorie: 'plante',
        debut: { mois: 5, jour: 5 },
        fin: { mois: 6, jour: 20 },
        biotope: "Jeunes sujets en lisière et en bord de piste, à hauteur de main.",
        altitude: "Le débourrement monte avec la saison : à 1200 m la fenêtre s'ouvre dix jours après celle de Levier, ce qui permet de la suivre en prenant de l'altitude.",
        effort: 1,
        rendement: 2,
        reglementation: "Sur pied et en forêt d'autrui, c'est un prélèvement sur l'arbre, pas un ramassage au sol : demander l'accord.",
        note: "Les pousses tendres, vert clair, avant qu'elles ne durcissent — quelques-unes par arbre et JAMAIS la flèche terminale, qu'on tuerait. De quoi faire un sirop."
    }
];

function getEspece(id) {
    for (var i = 0; i < ESPECES.length; i++) {
        if (ESPECES[i].id === id) return ESPECES[i];
    }
    return null;
}

// Libellés d'affichage. Les icônes viennent de Font Awesome 6, déjà
// chargé par la page.
var CATEGORIES = [
    { valeur: 'champignon', label: 'Champignons', icone: 'fa-solid fa-seedling' },
    { valeur: 'baie',       label: 'Baies',       icone: 'fa-solid fa-apple-whole' },
    { valeur: 'noix',       label: 'Fruits à coque', icone: 'fa-solid fa-tree' },
    { valeur: 'plante',     label: 'Plantes',     icone: 'fa-solid fa-leaf' }
];

function getCategorie(valeur) {
    for (var i = 0; i < CATEGORIES.length; i++) {
        if (CATEGORIES[i].valeur === valeur) return CATEGORIES[i];
    }
    return { valeur: valeur, label: valeur, icone: 'fa-solid fa-circle' };
}

var EFFORT_LABELS = {
    1: 'Ça se ramasse',
    2: 'Il faut chercher',
    3: 'Il faut savoir où'
};

var RENDEMENT_LABELS = {
    1: 'Quelques poignées',
    2: 'Un panier',
    3: 'De quoi conserver'
};

// Les secteurs couverts. Sert au sous-titre de la page : le périmètre
// doit être lisible à l'écran, pas seulement dans ce commentaire — une
// fenêtre juste pour Mouthe serait fausse ailleurs.
var SECTEURS = ['Mouthe', 'Labergement-Sainte-Marie', 'Vaux-et-Chantegrue', 'Pontarlier', 'Frasne', 'Levier'];
var ALTITUDE_MIN = 800;
var ALTITUDE_MAX = 1200;
