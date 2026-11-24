'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.resolve(__dirname, '..');

/**
 * Charge le fichier .env s'il existe (fonction native de Node >= 20.12,
 * aucune dépendance « dotenv » nécessaire). Les variables déjà définies dans
 * l'environnement sont prioritaires.
 */
function chargerFichierEnv() {
  const fichier = path.join(RACINE, '.env');
  if (fs.existsSync(fichier) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(fichier);
  }
}

function entier(valeur, defaut) {
  const n = Number.parseInt(valeur, 10);
  return Number.isFinite(n) ? n : defaut;
}

function booleen(valeur, defaut) {
  if (valeur === undefined || valeur === '') return defaut;
  return ['1', 'true', 'oui', 'yes', 'on'].includes(String(valeur).toLowerCase());
}

/**
 * Construit la configuration à partir des variables d'environnement.
 * `surcharges` sert aux tests (base en mémoire, port 0…).
 */
function chargerConfig(surcharges = {}) {
  const env = process.env;
  const production = env.NODE_ENV === 'production';
  const port = entier(env.PORT, 3000);

  let secretJwt = env.JWT_SECRET;
  let secretGenere = false;
  if (!secretJwt) {
    if (production) {
      throw new Error('JWT_SECRET doit être défini en production (voir .env.example).');
    }
    secretJwt = crypto.randomBytes(32).toString('hex');
    secretGenere = true;
  }

  const config = {
    racine: RACINE,
    production,
    port,
    hote: env.HOST || '0.0.0.0',
    // Adresse publique du serveur : sert à fabriquer les liens de partage.
    urlPublique: (env.URL_PUBLIQUE || `http://localhost:${port}`).replace(/\/+$/, ''),
    cheminBase: env.DB_PATH ? path.resolve(RACINE, env.DB_PATH) : path.join(RACINE, 'data', 'canne.db'),
    secretJwt,
    secretGenere,
    dureeJeton: env.JWT_DUREE || '7d',
    originesCors: (env.CORS_ORIGINES || '*').split(',').map((o) => o.trim()).filter(Boolean),
    donneesDemo: booleen(env.DONNEES_DEMO, !production),
    // Une canne est « en ligne » si elle a communiqué depuis moins de N minutes.
    seuilEnLigneMin: entier(env.SEUIL_EN_LIGNE_MIN, 5),
    // Alerte « canne inactive » créée côté serveur après N minutes sans position.
    seuilInactiviteMin: entier(env.SEUIL_INACTIVITE_MIN, 15),
    intervalleSurveillanceS: entier(env.INTERVALLE_SURVEILLANCE_S, 60),
    seuilBatterieFaible: entier(env.SEUIL_BATTERIE_FAIBLE, 20),
    dureeMaxPartageH: entier(env.DUREE_MAX_PARTAGE_H, 72),
    // Au-delà de cette imprécision GPS (mètres), une position n'est pas utilisée
    // pour détecter l'entrée dans une zone (elle reste enregistrée et affichée).
    precisionMaxZoneM: entier(env.PRECISION_MAX_ZONE_M, 80),
    // Fond de carte : clé Google Maps (Maps JavaScript API). Sans clé, la console,
    // la page de suivi et l'application utilisent OpenStreetMap.
    googleMapsCle: (env.GOOGLE_MAPS_CLE || '').trim() || null,
    // Premier administrateur créé au démarrage si la base n'en contient aucun.
    adminTelephone: env.ADMIN_TELEPHONE || null,
    adminMotDePasse: env.ADMIN_MOT_DE_PASSE || null,
    adminNom: env.ADMIN_NOM || 'Administrateur',
    // Notifications push Firebase (facultatif) : chemin du compte de service.
    fcmCompteService: env.FCM_COMPTE_SERVICE ? path.resolve(RACINE, env.FCM_COMPTE_SERVICE) : null,
    journalRequetes: booleen(env.JOURNAL_REQUETES, !production),
    // Passerelle SMS (facultatif) : sans URL, les SMS sont simulés dans la console.
    smsPasserelleUrl: env.SMS_PASSERELLE_URL || null,
    smsPasserelleCle: env.SMS_PASSERELLE_CLE || null,
    smsExpediteur: env.SMS_EXPEDITEUR || 'CanneProche',
    ...surcharges,
  };
  return config;
}

module.exports = { chargerConfig, chargerFichierEnv, RACINE };
