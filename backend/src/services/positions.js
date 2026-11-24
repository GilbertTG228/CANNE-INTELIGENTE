'use strict';

const { dansZone } = require('../utils/geo');
const { maintenant } = require('../utils/outils');
const { creerAlerte, notifier } = require('./alertes');
const { publier } = require('./evenements');

/**
 * Traitement des positions reçues d'une canne :
 *  1. enregistrement en base ;
 *  2. mise à jour de l'état de la canne (batterie, dernière communication) ;
 *  3. détection des ENTRÉES dans les zones à éviter actives (une alerte par
 *     entrée, pas une par position tant que la canne reste dans la zone) ;
 *  4. détection de la batterie faible (une alerte, réarmée après recharge).
 *
 * Retourne { enregistrees, alertes }.
 */
function enregistrerPositions(ctx, canne, positions) {
  const { db, config } = ctx;
  const triees = [...positions].sort((a, b) => a.horodatage.localeCompare(b.horodatage));

  const alertes = db.transaction(() => {
    const creees = [];
    const zones = db.all('SELECT * FROM zones WHERE canne_id = ? AND actif = 1', canne.id);
    const etats = new Map(
      db.all('SELECT zone_id, a_l_interieur FROM etats_zone WHERE canne_id = ?', canne.id)
        .map((e) => [e.zone_id, !!e.a_l_interieur]),
    );
    let batterieSignalee = !!canne.batterie_signalee;
    let derniereBatterie = canne.batterie;

    for (const p of triees) {
      db.run(
        'INSERT INTO positions (canne_id, latitude, longitude, precision, batterie, horodatage) VALUES (?, ?, ?, ?, ?, ?)',
        canne.id, p.latitude, p.longitude, p.precision ?? null, p.batterie ?? null, p.horodatage,
      );

      // Une position trop imprécise (GPS d'un téléphone à l'intérieur d'un bâtiment,
      // par exemple) ne change pas l'état dedans/dehors : évite les fausses alertes.
      const fiable = p.precision == null || p.precision <= config.precisionMaxZoneM;
      for (const zone of fiable ? zones : []) {
        const dedans = dansZone(p, zone);
        const avant = etats.get(zone.id) ?? false;
        if (dedans && !avant) {
          creees.push(creerAlerte(db, canne, {
            type: 'entree_zone', zone, latitude: p.latitude, longitude: p.longitude, horodatage: p.horodatage,
          }));
        }
        etats.set(zone.id, dedans);
      }

      if (p.batterie != null) {
        derniereBatterie = p.batterie;
        if (p.batterie <= config.seuilBatterieFaible && !batterieSignalee) {
          creees.push(creerAlerte(db, canne, {
            type: 'batterie_faible', batterie: p.batterie, latitude: p.latitude, longitude: p.longitude,
            horodatage: p.horodatage,
          }));
          batterieSignalee = true;
        } else if (p.batterie >= config.seuilBatterieFaible + 10) {
          batterieSignalee = false;
        }
      }
    }

    for (const [zoneId, dedans] of etats) {
      db.run(
        `INSERT INTO etats_zone (canne_id, zone_id, a_l_interieur) VALUES (?, ?, ?)
         ON CONFLICT (canne_id, zone_id) DO UPDATE SET a_l_interieur = excluded.a_l_interieur`,
        canne.id, zoneId, dedans,
      );
    }

    db.run(
      `UPDATE cannes SET batterie = ?, derniere_communication = ?, inactivite_signalee = 0,
              batterie_signalee = ?, maj_le = ? WHERE id = ?`,
      derniereBatterie, maintenant(), batterieSignalee, maintenant(), canne.id,
    );
    return creees;
  });

  for (const a of alertes) notifier(ctx, canne, a);
  const derniere = triees[triees.length - 1];
  if (derniere) {
    publier(ctx, 'position', {
      canneId: canne.id,
      typeDispositif: canne.type_dispositif,
      batterie: derniere.batterie ?? canne.batterie ?? null,
      position: {
        latitude: derniere.latitude,
        longitude: derniere.longitude,
        precision: derniere.precision ?? null,
        batterie: derniere.batterie ?? null,
        horodatage: derniere.horodatage,
      },
    });
  }
  return { enregistrees: triees.length, alertes };
}

/**
 * Initialise l'état dedans/dehors d'une zone à partir de la dernière position
 * connue, sans créer d'alerte : évite une fausse « entrée » juste après la
 * création ou le déplacement d'une zone.
 */
function initialiserEtatZone(db, zone) {
  const derniere = db.get(
    'SELECT latitude, longitude FROM positions WHERE canne_id = ? ORDER BY horodatage DESC LIMIT 1',
    zone.canne_id,
  );
  const dedans = derniere ? dansZone(derniere, zone) : false;
  db.run(
    `INSERT INTO etats_zone (canne_id, zone_id, a_l_interieur) VALUES (?, ?, ?)
     ON CONFLICT (canne_id, zone_id) DO UPDATE SET a_l_interieur = excluded.a_l_interieur`,
    zone.canne_id, zone.id, dedans,
  );
}

module.exports = { enregistrerPositions, initialiserEtatZone };
