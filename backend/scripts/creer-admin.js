'use strict';

/**
 * Crée (ou promeut) un compte administrateur, pour une base de production
 * sans données de démonstration :
 *   node scripts/creer-admin.js 90112233 "MotDePasseSolide" "Prénom Nom"
 */

const bcrypt = require('bcryptjs');
const { chargerConfig, chargerFichierEnv } = require('../src/config');
const { ouvrirBase } = require('../src/db/database');

chargerFichierEnv();
const [telephone, motDePasse, nom = 'Administrateur'] = process.argv.slice(2);
if (!telephone || !motDePasse || motDePasse.length < 8) {
  console.error('Usage : node scripts/creer-admin.js <telephone> <motDePasse (8 caractères min.)> "<nom>"');
  process.exit(1);
}

const db = ouvrirBase(chargerConfig().cheminBase);
const t = new Date().toISOString();
const hash = bcrypt.hashSync(motDePasse, 10);
const existant = db.get('SELECT id FROM utilisateurs WHERE telephone = ?', telephone);
if (existant) {
  db.run("UPDATE utilisateurs SET role = 'admin', actif = 1, mot_de_passe_hash = ?, maj_le = ? WHERE id = ?", hash, t, existant.id);
  console.log(`Compte ${telephone} promu administrateur (mot de passe mis à jour).`);
} else {
  db.run(
    "INSERT INTO utilisateurs (telephone, nom, mot_de_passe_hash, role, cree_le, maj_le) VALUES (?, ?, ?, 'admin', ?, ?)",
    telephone, nom, hash, t, t,
  );
  console.log(`Administrateur ${nom} (${telephone}) créé.`);
}
db.fermer();
