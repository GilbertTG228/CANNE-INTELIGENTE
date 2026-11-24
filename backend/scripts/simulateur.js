'use strict';

/**
 * Simulateur de canne GPS en ligne de commande (DÉMONSTRATION).
 * Il joue le rôle du boîtier : envoie des positions à l'API /api/dispositif
 * avec la clé secrète de la canne.
 *
 *   npm run simulateur                         # canne de démo d'Ama, promenade en boucle
 *   npm run simulateur -- --cle <clé> --intervalle 3
 *   npm run simulateur -- --sos                # envoie un SOS puis s'arrête
 *   npm run simulateur -- --chute
 *
 * Options : --url http://localhost:3000  --cle demo-cle-CANNE-0001
 *           --intervalle <secondes, défaut 5>  --sos  --chute
 */

const { TRAJETS, echantillonner } = require('../src/db/demo');

function option(nom, defaut) {
  const i = process.argv.indexOf(`--${nom}`);
  if (i === -1) return defaut;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const URL_SERVEUR = String(option('url', process.env.URL_SERVEUR || `http://localhost:${process.env.PORT || 3000}`)).replace(/\/+$/, '');
const CLE = String(option('cle', 'demo-cle-CANNE-0001'));
const INTERVALLE_S = Number(option('intervalle', 5));

async function appeler(chemin, corps) {
  const r = await fetch(`${URL_SERVEUR}/api/dispositif/${chemin}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Cle-Dispositif': CLE },
    body: JSON.stringify(corps),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.message || `HTTP ${r.status}`);
  return json;
}

const heure = () => new Date().toLocaleTimeString('fr-FR');

async function principal() {
  console.log(`Simulateur de canne → ${URL_SERVEUR} (clé ${CLE.slice(0, 12)}…)`);

  if (option('sos', false) || option('chute', false)) {
    const type = option('sos', false) ? 'sos' : 'chute';
    const r = await appeler('alertes', { type });
    console.log(`${heure()}  Alerte ${type.toUpperCase()} envoyée (id ${r.alerte.id}).`);
    return;
  }

  // Promenade : aller-retour du domicile d'Ama jusqu'au carrefour Déckon (zone à éviter).
  const aller = echantillonner([...TRAJETS.cn_demo_ama[0], [6.1345, 1.2228], [6.1318, 1.2232], [6.1302, 1.2236]], 12);
  const boucle = [...aller, ...[...aller].reverse().slice(1)];
  let i = 0;
  let batterie = 90;
  console.log(`Promenade en boucle de ${boucle.length} points, un toutes les ${INTERVALLE_S} s. Ctrl+C pour arrêter.`);

  const pas = async () => {
    const [lat, lon] = boucle[i % boucle.length];
    i++;
    if (i % 20 === 0) batterie = Math.max(5, batterie - 1);
    try {
      const r = await appeler('positions', { latitude: lat, longitude: lon, precision: 6, batterie });
      const alertes = r.alertes.map((a) => `⚠ ${a.type}${a.zoneNom ? ` (${a.zoneNom})` : ''}`).join(' ');
      console.log(`${heure()}  ${lat.toFixed(5)}, ${lon.toFixed(5)}  batterie ${batterie} %  ${alertes}`);
    } catch (e) {
      console.error(`${heure()}  échec : ${e.message}`);
    }
  };
  await pas();
  setInterval(pas, INTERVALLE_S * 1000);
}

principal().catch((e) => {
  console.error(`Erreur : ${e.message}`);
  process.exit(1);
});
