'use strict';

const fs = require('node:fs');
const jwt = require('jsonwebtoken');

/**
 * Envoi des notifications push aux proches.
 *
 * - Sans configuration : mode « simulé », la notification est affichée dans la
 *   console du serveur (suffisant pour la démonstration ; l'application, elle,
 *   découvre les nouvelles alertes par interrogation toutes les 30 s).
 * - Avec FCM_COMPTE_SERVICE (fichier JSON du compte de service Firebase) :
 *   envoi réel via l'API HTTP v1 de Firebase Cloud Messaging.
 */
class ServiceNotifications {
  constructor({ config, journal = console }) {
    this.journal = journal;
    this.compte = null;
    this.jetonAcces = null;
    this.expirationAcces = 0;
    this.envoyees = []; // historique en mémoire (utile aux tests et à la console de démo)
    if (config.fcmCompteService) {
      try {
        this.compte = JSON.parse(fs.readFileSync(config.fcmCompteService, 'utf8'));
        this.journal.log(`[push] Firebase activé (projet ${this.compte.project_id}).`);
      } catch (e) {
        this.journal.warn(`[push] Compte de service illisible (${e.message}) : mode simulé.`);
      }
    }
  }

  get modeReel() {
    return !!this.compte;
  }

  /** Jeton OAuth2 Google (valable 1 h), obtenu en signant un JWT RS256. */
  async _jetonGoogle() {
    if (this.jetonAcces && Date.now() < this.expirationAcces - 60_000) return this.jetonAcces;
    const maintenant = Math.floor(Date.now() / 1000);
    const assertion = jwt.sign(
      {
        iss: this.compte.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: maintenant,
        exp: maintenant + 3600,
      },
      this.compte.private_key,
      { algorithm: 'RS256' },
    );
    const reponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    if (!reponse.ok) throw new Error(`OAuth Google : HTTP ${reponse.status}`);
    const json = await reponse.json();
    this.jetonAcces = json.access_token;
    this.expirationAcces = Date.now() + json.expires_in * 1000;
    return this.jetonAcces;
  }

  async _envoyerFcm(jetonAppareil, titre, corps, data) {
    const acces = await this._jetonGoogle();
    const url = `https://fcm.googleapis.com/v1/projects/${this.compte.project_id}/messages:send`;
    const reponse = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${acces}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: jetonAppareil,
          notification: { title: titre, body: corps },
          data,
          android: { priority: 'high' },
          apns: { payload: { aps: { sound: 'default' } } },
        },
      }),
    });
    if (!reponse.ok) throw new Error(`FCM : HTTP ${reponse.status} ${await reponse.text()}`);
  }

  /**
   * Envoie une notification à chaque destinataire.
   * destinataires : [{ id, nom, fcm_token }]
   * data : objet dont toutes les valeurs sont converties en chaînes (exigence FCM).
   */
  async envoyer(destinataires, titre, corps, data = {}) {
    const dataTexte = {};
    for (const [k, val] of Object.entries(data)) if (val !== null && val !== undefined) dataTexte[k] = String(val);

    const trace = { titre, corps, data: dataTexte, destinataires: destinataires.map((d) => d.id), le: new Date().toISOString() };
    this.envoyees.push(trace);
    if (this.envoyees.length > 100) this.envoyees.shift();

    if (!this.modeReel) {
      const noms = destinataires.map((d) => d.nom).join(', ') || 'aucun destinataire';
      this.journal.log(`[push simulé] « ${titre} » → ${noms}`);
      return;
    }
    await Promise.all(
      destinataires
        .filter((d) => d.fcm_token)
        .map((d) =>
          this._envoyerFcm(d.fcm_token, titre, corps, dataTexte).catch((e) =>
            this.journal.warn(`[push] échec pour l'utilisateur ${d.id} : ${e.message}`),
          ),
        ),
    );
  }
}

module.exports = { ServiceNotifications };
