'use strict';

/**
 * Envoi de SMS (code « mot de passe oublié », information de la personne
 * malvoyante quand un proche s'associe à sa canne).
 *
 * - Sans configuration : mode « simulé », le SMS est écrit dans la console du
 *   serveur et gardé en mémoire (visible dans la console d'administration).
 * - Avec SMS_PASSERELLE_URL : envoi réel par une requête POST JSON
 *   {to, message, from} vers la passerelle de votre fournisseur
 *   (adapter _envoyerReel au format exact de l'opérateur choisi).
 */
class ServiceSms {
  constructor({ config, journal = console }) {
    this.config = config;
    this.journal = journal;
    this.envoyes = []; // historique en mémoire (tests et console de démo)
  }

  get modeReel() {
    return !!this.config.smsPasserelleUrl;
  }

  async _envoyerReel(telephone, message) {
    const reponse = await fetch(this.config.smsPasserelleUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.smsPasserelleCle ? { Authorization: `Bearer ${this.config.smsPasserelleCle}` } : {}),
      },
      body: JSON.stringify({ to: telephone, message, from: this.config.smsExpediteur }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!reponse.ok) throw new Error(`passerelle SMS : HTTP ${reponse.status}`);
  }

  /**
   * Envoie un SMS. Ne lève jamais d'erreur : un SMS non remis ne doit pas faire
   * échouer l'action principale (association, demande de code…).
   * @returns {Promise<boolean>} true si le SMS a été remis (ou simulé).
   */
  async envoyer(telephone, message, { motif = 'information' } = {}) {
    if (!telephone) return false;
    const trace = { telephone, message, motif, le: new Date().toISOString(), simule: !this.modeReel };
    this.envoyes.push(trace);
    if (this.envoyes.length > 100) this.envoyes.shift();

    if (!this.modeReel) {
      this.journal.log(`[SMS simulé] À ${telephone} : ${message}`);
      return true;
    }
    try {
      await this._envoyerReel(telephone, message);
      return true;
    } catch (e) {
      trace.erreur = e.message;
      this.journal.warn(`[SMS] échec vers ${telephone} : ${e.message}`);
      return false;
    }
  }
}

/** Masque un numéro pour l'affichage : +228 90 •• •• 33. */
function masquerTelephone(telephone) {
  if (!telephone) return null;
  const s = String(telephone);
  if (s.length <= 4) return s;
  return s.slice(0, Math.min(6, s.length - 2)).padEnd(s.length - 2, '•') + s.slice(-2);
}

module.exports = { ServiceSms, masquerTelephone };
