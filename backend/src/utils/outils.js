'use strict';

const crypto = require('node:crypto');

/** Identifiant court et lisible : « zn_3f9a1c2b7d4e ». */
function nouvelId(prefixe) {
  return `${prefixe}_${crypto.randomBytes(6).toString('hex')}`;
}

/** Jeton aléatoire URL-safe (liens de partage, clés de dispositif). */
function jetonAleatoire(octets = 24) {
  return crypto.randomBytes(octets).toString('base64url');
}

/** Code numérique à N chiffres (appairage, réinitialisation). */
function codeNumerique(chiffres = 6) {
  const max = 10 ** chiffres;
  return String(crypto.randomInt(0, max)).padStart(chiffres, '0');
}

/**
 * Code d'activation d'un appareil, lisible et sans caractères ambigus
 * (pas de 0/O ni de 1/I/L) : « K7QM-9XDF ».
 */
const ALPHABET_ACTIVATION = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function codeActivation() {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET_ACTIVATION[crypto.randomInt(0, ALPHABET_ACTIVATION.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** « k7qm 9xdf » → « K7QM9XDF » (comparaison tolérante aux tirets et espaces). */
function normaliserCode(code) {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function sha256(texte) {
  return crypto.createHash('sha256').update(String(texte)).digest('hex');
}

/** Comparaison en temps constant (évite les attaques temporelles). */
function egalSecurise(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

const maintenant = () => new Date().toISOString();

function dansMinutes(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function ilYaMinutes(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

module.exports = {
  nouvelId,
  jetonAleatoire,
  codeNumerique,
  sha256,
  egalSecurise,
  maintenant,
  dansMinutes,
  ilYaMinutes,
  codeActivation,
  normaliserCode,
};
