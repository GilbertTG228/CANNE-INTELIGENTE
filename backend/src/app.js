'use strict';

const path = require('node:path');
const express = require('express');
const cors = require('cors');

const { authentifier, exigerRole } = require('./middlewares/auth');
const { entetesSecurite } = require('./middlewares/securite');
const { routeInconnue, gestionnaireErreurs } = require('./middlewares/erreurs');
const { ServiceNotifications } = require('./services/notifications');
const { ServiceSms } = require('./services/sms');
const { creerBusEvenements } = require('./services/evenements');
const routesFlux = require('./routes/flux');

const routesAuth = require('./routes/auth');
const routesUtilisateur = require('./routes/utilisateur');
const routesCannes = require('./routes/cannes');
const routesDispositif = require('./routes/dispositif');
const routesAdmin = require('./routes/admin');
const { routesConsentements, routesAlertes, routesPartage, routesPublic } = require('./routes/divers');

/**
 * Construit l'application Express. Aucune écoute réseau ici : server.js
 * s'en charge, et les tests peuvent créer autant d'instances que nécessaire.
 */
function creerApplication({ db, config, notifications, sms, journal = console }) {
  const ctx = {
    db,
    config,
    notifications: notifications || new ServiceNotifications({ config, journal }),
    sms: sms || new ServiceSms({ config, journal }),
    evenements: creerBusEvenements(),
    limiteurs: [],
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.locals.ctx = ctx;

  app.use(entetesSecurite);
  app.use(
    cors({
      origin: config.originesCors.includes('*') ? true : config.originesCors,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Cle-Dispositif', 'X-Source-Dispositif'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '256kb' }));

  if (config.journalRequetes) {
    app.use((req, res, next) => {
      const debut = process.hrtime.bigint();
      res.on('finish', () => {
        if (req.path.startsWith('/api/')) {
          const ms = Number(process.hrtime.bigint() - debut) / 1e6;
          journal.log(`${req.method} ${req.originalUrl} → ${res.statusCode} (${ms.toFixed(1)} ms)`);
        }
      });
      next();
    });
  }

  // --- API -------------------------------------------------------------------
  const auth = authentifier(ctx);

  app.get('/api/sante', (_req, res) => {
    db.get('SELECT 1 AS ok');
    res.json({ statut: 'ok', version: '2.0.0', heure: new Date().toISOString() });
  });

  app.use('/api/auth', routesAuth(ctx));
  app.use('/api/public', routesPublic(ctx));
  app.use('/api/dispositif', routesDispositif(ctx));

  app.use('/api/utilisateur', auth, routesUtilisateur(ctx));
  app.use('/api/cannes', auth, routesCannes(ctx));
  app.use('/api/alertes', auth, routesAlertes(ctx));
  app.use('/api/consentements', auth, routesConsentements(ctx));
  app.use('/api/liens-partage', auth, routesPartage(ctx));
  // Flux temps réel (Server-Sent Events) : authentifié par ?jeton= car EventSource n'envoie pas d'en-tête.
  app.get('/api/admin/flux', routesFlux.fluxAdmin(ctx));
  app.use('/api/admin', auth, exigerRole('admin'), routesAdmin(ctx));

  app.use('/api', routeInconnue);

  // --- Pages web ---------------------------------------------------------------
  const dossierPublic = path.join(config.racine, 'public');
  // Page publique ouverte par les liens de partage : /suivi/<jeton>
  app.get('/suivi/:jeton', (_req, res) => res.sendFile(path.join(dossierPublic, 'suivi', 'index.html')));
  // Canne virtuelle : un téléphone remplace la canne pendant les tests (/canne)
  app.use('/canne', express.static(path.join(dossierPublic, 'canne'), { index: 'index.html' }));
  // Console d'administration et de démonstration : /admin
  app.use('/admin', express.static(path.join(dossierPublic, 'admin'), { index: 'index.html' }));
  // Carte Google Maps affichée par l'application mobile (vue web intégrée)
  app.use('/carte-app', express.static(path.join(dossierPublic, 'carte-app'), { index: 'index.html' }));
  // Scripts partagés par les pages web (adaptateur Google Maps de la console)
  app.use('/commun', express.static(path.join(dossierPublic, 'commun')));
  app.get('/', (_req, res) => res.redirect('/admin/'));

  app.use(routeInconnue);
  app.use(gestionnaireErreurs(journal));

  return app;
}

module.exports = { creerApplication };
