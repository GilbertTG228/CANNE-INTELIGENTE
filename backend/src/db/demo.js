'use strict';

/**
 * DONNÉES DE DÉMONSTRATION — clairement identifiées (colonne `demo` = 1,
 * noms suffixés, clés « demo-… »). Elles servent à présenter l'application
 * sans matériel réel. Ne jamais activer en production (DONNEES_DEMO=false).
 *
 * Scénario : Kossi Mensah suit la canne de sa mère Ama (quartier Tokoin, Lomé)
 * et celle de son père Yao (quartier Bè). Sa sœur Afi suit aussi la canne d'Ama.
 * Une troisième canne, non attribuée, sert à démontrer l'association par code.
 */

const bcrypt = require('bcryptjs');
const { distanceM } = require('../utils/geo');
const { nouvelId } = require('../utils/outils');

const COMPTES = [
  { telephone: '90000000', nom: 'Administrateur (démo)', motDePasse: 'Admin@2026', role: 'admin' },
  { telephone: '0123456789', nom: 'Kossi Mensah (démo)', motDePasse: 'password123', role: 'proche' },
  { telephone: '91234567', nom: 'Afi Mensah (démo)', motDePasse: 'Demo@2026', role: 'proche' },
];

const CANNES = [
  {
    id: 'cn_demo_ama', identifiant: 'CANNE-0001', nom: 'Ama Mensah', telephone: '+22890112233',
    cle: 'demo-cle-CANNE-0001', code: '482913', domicile: [6.1450, 1.2190],
  },
  {
    id: 'cn_demo_yao', identifiant: 'CANNE-0002', nom: 'Yao Mensah', telephone: '+22899887766',
    cle: 'demo-cle-CANNE-0002', code: '275604', domicile: [6.1352, 1.2418],
  },
  // Partage non autorisé : un autre compte qui saisit ce code reçoit « déjà associée ».
  {
    id: 'cn_demo_stock', identifiant: 'CANNE-0003', nom: 'Nouvelle canne', telephone: null,
    cle: 'demo-cle-CANNE-0003', code: '135790', domicile: null,
  },
  // Canne désactivée (déclarée perdue) : montre le message « canne désactivée ».
  {
    id: 'cn_demo_hs', identifiant: 'CANNE-0004', nom: 'Canne hors service', telephone: null,
    cle: 'demo-cle-CANNE-0004', code: '246810', domicile: null, active: 0,
  },
];

// Trajets habituels (aller ; le retour suit le même chemin à l'envers).
const TRAJETS = {
  cn_demo_ama: [
    // Vers le marché de quartier
    [[6.1450, 1.2190], [6.1436, 1.2196], [6.1421, 1.2201], [6.1404, 1.2208], [6.1388, 1.2214], [6.1372, 1.2221]],
    // Vers le centre de santé
    [[6.1450, 1.2190], [6.1462, 1.2176], [6.1474, 1.2160], [6.1486, 1.2146], [6.1497, 1.2131]],
  ],
  cn_demo_yao: [
    [[6.1352, 1.2418], [6.1340, 1.2402], [6.1328, 1.2386], [6.1318, 1.2370]],
  ],
};

const ZONES = [
  { canne: 'cn_demo_ama', nom: 'Carrefour Déckon (circulation dense)', lat: 6.1318, lon: 1.2232, rayon: 120, actif: 1 },
  { canne: 'cn_demo_ama', nom: 'Grand marché d\'Adawlato', lat: 6.1268, lon: 1.2235, rayon: 200, actif: 1 },
  { canne: 'cn_demo_ama', nom: 'Chantier rue de la gare', lat: 6.1405, lon: 1.2148, rayon: 60, actif: 0 },
  { canne: 'cn_demo_yao', nom: 'Berges de la lagune de Bè', lat: 6.1392, lon: 1.2455, rayon: 150, actif: 1 },
];

/** Interpole des points tous les `pasM` mètres le long d'une polyligne. */
function echantillonner(points, pasM) {
  const sortie = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [la1, lo1] = points[i - 1];
    const [la2, lo2] = points[i];
    const n = Math.max(1, Math.round(distanceM(la1, lo1, la2, lo2) / pasM));
    for (let k = 1; k <= n; k++) sortie.push([la1 + ((la2 - la1) * k) / n, lo1 + ((lo2 - lo1) * k) / n]);
  }
  return sortie;
}

/** Générateur pseudo-aléatoire déterministe (mêmes données à chaque création). */
function aleatoire(graine) {
  let s = graine >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function baseVide(db) {
  return db.get('SELECT COUNT(*) AS n FROM utilisateurs').n === 0;
}

function peuplerDemo(db, { maintenant = new Date() } = {}) {
  const hasard = aleatoire(20261106);
  const iso = (d) => d.toISOString();
  const tNow = iso(maintenant);
  let nbPositions = 0;
  let nbAlertes = 0;

  db.transaction(() => {
    // --- Comptes
    const ids = {};
    for (const c of COMPTES) {
      const { lastInsertRowid } = db.run(
        `INSERT INTO utilisateurs (telephone, nom, mot_de_passe_hash, role, demo, cree_le, maj_le)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
        c.telephone, c.nom, bcrypt.hashSync(c.motDePasse, 10), c.role, tNow, tNow,
      );
      ids[c.telephone] = lastInsertRowid;
    }
    const kossi = ids['0123456789'];
    const afi = ids['91234567'];

    // --- Cannes
    for (const c of CANNES) {
      db.run(
        `INSERT INTO cannes (id, identifiant, nom, telephone_personne, cle_dispositif, code_appairage, code_activation,
                             active, partage_autorise, demo, cree_le, maj_le)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        c.id, c.identifiant, c.nom, c.telephone, c.cle, c.code,
        `ACTI-${c.identifiant.slice(-4)}`, // code d'activation d'un téléphone de test : ACTI-0001…
        c.active ?? 1,
        c.id === 'cn_demo_ama' ? 1 : 0, // Ama est suivie par Kossi et Afi : partage autorisé
        tNow, tNow,
      );
    }
    const suivre = (u, canne, principal, consentement) =>
      db.run(
        'INSERT INTO suivis (utilisateur_id, canne_id, principal, consentement, consentement_le, cree_le) VALUES (?, ?, ?, ?, ?, ?)',
        u, canne, principal, consentement, consentement ? tNow : null, tNow,
      );
    suivre(kossi, 'cn_demo_ama', 1, 1);
    suivre(kossi, 'cn_demo_yao', 1, 0); // consentement à donner : montre l'écran de consentement
    suivre(afi, 'cn_demo_ama', 0, 1);

    // --- Zones
    const zonesParNom = {};
    for (const z of ZONES) {
      const id = nouvelId('zn');
      zonesParNom[z.nom] = { id, ...z };
      db.run(
        `INSERT INTO zones (id, canne_id, nom, latitude, longitude, rayon, actif, cree_par, cree_le, maj_le)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, z.canne, z.nom, z.lat, z.lon, z.rayon, z.actif, kossi, tNow, tNow,
      );
      db.run('INSERT INTO etats_zone (canne_id, zone_id, a_l_interieur) VALUES (?, ?, 0)', z.canne, id);
    }

    // --- Historique de positions : 30 derniers jours, 1 à 2 sorties par jour
    const inserer = (canneId, lat, lon, date, batterie) => {
      db.run(
        'INSERT INTO positions (canne_id, latitude, longitude, precision, batterie, horodatage) VALUES (?, ?, ?, ?, ?, ?)',
        canneId, lat, lon, Math.round(5 + hasard() * 10), batterie, iso(date),
      );
      nbPositions++;
    };

    // Les promenades s'arrêtent 2 min avant « maintenant » : la position actuelle
    // (au domicile, il y a 1 min) reste toujours la plus récente.
    const limite = new Date(maintenant.getTime() - 120_000);
    for (const canne of CANNES.filter((c) => TRAJETS[c.id])) {
      const trajets = TRAJETS[canne.id];
      for (let jour = 30; jour >= 0; jour--) {
        const base = new Date(maintenant);
        base.setHours(0, 0, 0, 0);
        base.setDate(base.getDate() - jour);
        let batterie = 100;
        const sorties = jour % 3 === 0 ? [9, 16] : [jour % 2 ? 10 : 15];
        for (const heure of sorties) {
          const trajet = trajets[(jour + heure) % trajets.length];
          const aller = echantillonner(trajet, 22); // ~ 0,75 m/s, un point toutes les 30 s
          const parcours = [...aller, ...[...aller].reverse().slice(1)];
          let t = new Date(base);
          t.setHours(heure, Math.floor(hasard() * 40), 0, 0);
          if (t > limite) continue;
          for (const [lat, lon] of parcours) {
            if (t > limite) break;
            const bruit = () => (hasard() - 0.5) * 0.00008; // ± 4 m
            inserer(canne.id, lat + bruit(), lon + bruit(), t, Math.round(batterie));
            batterie -= 0.12;
            t = new Date(t.getTime() + 30_000);
          }
        }
      }
      // Position actuelle : la canne est au domicile et vient de transmettre.
      const [lat, lon] = canne.domicile;
      inserer(canne.id, lat, lon, new Date(maintenant.getTime() - 60_000), canne.id === 'cn_demo_ama' ? 76 : 54);
      db.run('UPDATE cannes SET batterie = ?, derniere_communication = ? WHERE id = ?',
        canne.id === 'cn_demo_ama' ? 76 : 54, iso(new Date(maintenant.getTime() - 60_000)), canne.id);
    }

    // --- Journal d'alertes (cohérent avec le scénario)
    const alerte = (canneId, type, ilYaH, { zone, message, lat, lon, traiteePar } = {}) => {
      const h = new Date(maintenant.getTime() - ilYaH * 3_600_000);
      const z = zone ? zonesParNom[zone] : null;
      db.run(
        `INSERT INTO alertes (id, canne_id, type, message, zone_id, zone_nom, latitude, longitude, horodatage, traitee, traitee_par, traitee_le)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        nouvelId('al'), canneId, type, message, z?.id ?? null, z?.nom ?? null,
        lat ?? z?.lat ?? null, lon ?? z?.lon ?? null, iso(h),
        traiteePar ? 1 : 0, traiteePar ?? null, traiteePar ? iso(new Date(h.getTime() + 6 * 60_000)) : null,
      );
      nbAlertes++;
    };
    alerte('cn_demo_ama', 'sos', 24 * 10 + 3, {
      message: 'Ama Mensah a appuyé sur le bouton SOS de sa canne.', lat: 6.1404, lon: 1.2208, traiteePar: kossi,
    });
    alerte('cn_demo_ama', 'entree_zone', 24 * 3 + 5, {
      zone: 'Carrefour Déckon (circulation dense)',
      message: 'La canne est entrée dans la zone « Carrefour Déckon (circulation dense) ».', traiteePar: afi,
    });
    alerte('cn_demo_ama', 'batterie_faible', 24 + 4, {
      message: 'Batterie à 18 %. Pensez à recharger la canne.', lat: 6.1450, lon: 1.2190, traiteePar: kossi,
    });
    alerte('cn_demo_ama', 'canne_inactive', 14, {
      message: 'Aucune position reçue récemment. Vérifiez la batterie ou la couverture réseau.', lat: 6.1450, lon: 1.2190,
    });
    alerte('cn_demo_yao', 'chute', 24 * 2 + 2, {
      message: 'La canne de Yao Mensah a détecté une chute.', lat: 6.1328, lon: 1.2386, traiteePar: kossi,
    });
    alerte('cn_demo_yao', 'batterie_faible', 3, {
      message: 'Batterie à 19 %. Pensez à recharger la canne.', lat: 6.1352, lon: 1.2418,
    });

    db.run('INSERT INTO journal (utilisateur_id, action, details, cree_le) VALUES (NULL, ?, ?, ?)',
      'donnees_demo', 'Création des données de démonstration', tNow);
  });

  return { positions: nbPositions, alertes: nbAlertes, comptes: COMPTES.length, cannes: CANNES.length };
}

module.exports = { baseVide, peuplerDemo, COMPTES, CANNES, TRAJETS, ZONES, echantillonner };
