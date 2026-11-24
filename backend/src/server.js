'use strict';

// Vérification de la version de Node avant tout : node:sqlite est requis.
const [majeur, mineur] = process.versions.node.split('.').map(Number);
if (majeur < 22 || (majeur === 22 && mineur < 13)) {
  console.error(`Node.js ${process.versions.node} détecté : la version 22.13 ou supérieure est requise (module node:sqlite).`);
  console.error('Téléchargez la version LTS sur https://nodejs.org puis relancez.');
  process.exit(1);
}

const { chargerConfig, chargerFichierEnv } = require('./config');
const { ouvrirBase } = require('./db/database');
const { creerApplication } = require('./app');
const { demarrerSurveillance } = require('./services/surveillance');
const { baseVide, peuplerDemo } = require('./db/demo');

chargerFichierEnv();
const config = chargerConfig();
const db = ouvrirBase(config.cheminBase);

if (config.donneesDemo && baseVide(db)) {
  const resume = peuplerDemo(db);
  console.log(`🧪 Base vide : données de DÉMONSTRATION créées (${resume.positions} positions, ${resume.alertes} alertes).`);
}

// Premier administrateur fourni par l'environnement (déploiement sans données de démo).
if (config.adminTelephone && config.adminMotDePasse
    && !db.get("SELECT 1 FROM utilisateurs WHERE role = 'admin'")) {
  const bcrypt = require('bcryptjs');
  const t = new Date().toISOString();
  db.run(
    "INSERT INTO utilisateurs (telephone, nom, mot_de_passe_hash, role, cree_le, maj_le) VALUES (?, ?, ?, 'admin', ?, ?)",
    config.adminTelephone, config.adminNom, bcrypt.hashSync(config.adminMotDePasse, 10), t, t,
  );
  console.log(`👤 Administrateur créé : ${config.adminTelephone} (variables ADMIN_TELEPHONE / ADMIN_MOT_DE_PASSE).`);
}


const app = creerApplication({ db, config });
const arreterSurveillance = demarrerSurveillance(app.locals.ctx);

const serveur = app.listen(config.port, config.hote, () => {
  console.log('────────────────────────────────────────────────────────────');
  console.log(`🚀 Serveur Canne Intelligente : http://localhost:${config.port}`);
  console.log(`   API                 : http://localhost:${config.port}/api/sante`);
  console.log(`   Console admin/démo  : http://localhost:${config.port}/admin/`);
  console.log(`   Canne virtuelle     : ${config.urlPublique}/canne/  (téléphone de test, HTTPS requis hors de ce PC)`);
  console.log(`   Base de données     : ${config.cheminBase}`);
  if (config.donneesDemo) {
    console.log('   Comptes de démo     : proche 0123456789 / password123 · admin 90000000 / Admin@2026');
  }
  if (config.secretGenere) {
    console.log('⚠️  JWT_SECRET absent : secret temporaire généré (sessions perdues au redémarrage).');
    console.log('   Copiez .env.example en .env pour le fixer.');
  }
  console.log('────────────────────────────────────────────────────────────');
});

function arreter() {
  console.log('\nArrêt du serveur…');
  arreterSurveillance();
  serveur.close(() => {
    db.fermer();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', arreter);
process.on('SIGTERM', arreter);
