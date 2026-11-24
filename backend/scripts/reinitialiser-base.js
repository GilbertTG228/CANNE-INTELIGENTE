'use strict';

/**
 * Recrée la base de données à neuf avec les données de démonstration.
 * À lancer serveur ARRÊTÉ, par exemple juste avant la soutenance :
 *   npm run demo:reset
 * Option --vide : recrée une base vide (sans données de démonstration), pour les
 * tests réels avec un téléphone. Avec --admin <telephone> <motDePasse> "<nom>",
 * le premier administrateur est créé dans la foulée :
 *   npm run base:vierge -- --admin 90000000 MonMotDePasse "Administrateur"
 */

const fs = require('node:fs');
const { chargerConfig, chargerFichierEnv } = require('../src/config');
const { ouvrirBase } = require('../src/db/database');
const { peuplerDemo } = require('../src/db/demo');

chargerFichierEnv();
const config = chargerConfig();
const vide = process.argv.includes('--vide');

for (const suffixe of ['', '-wal', '-shm']) {
  const f = config.cheminBase + suffixe;
  if (fs.existsSync(f)) fs.rmSync(f);
}

const db = ouvrirBase(config.cheminBase);
if (vide) {
  console.log(`Base vide recréée : ${config.cheminBase}`);
  const i = process.argv.indexOf('--admin');
  if (i > 0 && process.argv[i + 2]) {
    const bcrypt = require('bcryptjs');
    const [telephone, motDePasse, nom = 'Administrateur'] = process.argv.slice(i + 1);
    if (motDePasse.length < 8) {
      console.error('Le mot de passe doit comporter au moins 8 caractères.');
      process.exit(1);
    }
    const t = new Date().toISOString();
    db.run(
      "INSERT INTO utilisateurs (telephone, nom, mot_de_passe_hash, role, cree_le, maj_le) VALUES (?, ?, ?, 'admin', ?, ?)",
      telephone.replace(/[\s.\-()]/g, ''), nom, bcrypt.hashSync(motDePasse, 10), t, t,
    );
    console.log(`Administrateur créé : ${telephone}`);
  } else {
    console.log('Créez un administrateur avec : node scripts/creer-admin.js <telephone> <motDePasse> "<nom>"');
  }
  console.log('Pensez à mettre DONNEES_DEMO=false dans .env pour que la démo ne soit pas recréée.');
} else {
  const r = peuplerDemo(db);
  console.log(`Base recréée : ${config.cheminBase}`);
  console.log(`Données de DÉMONSTRATION : ${r.comptes} comptes, ${r.cannes} cannes, ${r.positions} positions, ${r.alertes} alertes.`);
  console.log('  Proche : 0123456789 / password123');
  console.log('  Proche : 91234567 / Demo@2026');
  console.log('  Admin  : 90000000 / Admin@2026');
  console.log('  Canne libre à associer : CANNE-0003, code 135790');
}
db.fermer();
