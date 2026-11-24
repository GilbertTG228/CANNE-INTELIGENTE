'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { demarrer } = require('./aide');
const { verifierInactivite } = require('../src/services/surveillance');

const KOSSI = ['0123456789', 'password123'];
const AFI = ['91234567', 'Demo@2026'];
const ADMIN = ['90000000', 'Admin@2026'];
const AMA = 'cn_demo_ama';
const YAO = 'cn_demo_yao';
const CLE_AMA = 'demo-cle-CANNE-0001';

describe('Serveur Canne Intelligente', () => {
  let s;
  let jKossi;
  let jAfi;
  let jAdmin;

  before(async () => {
    s = await demarrer();
    jKossi = await s.connexion(...KOSSI);
    jAfi = await s.connexion(...AFI);
    jAdmin = await s.connexion(...ADMIN);
  });
  after(() => s.fermer());

  // ---------------------------------------------------------------------------
  describe('Généralités', () => {
    test('santé', async () => {
      const r = await s.requete('GET', '/api/sante');
      assert.equal(r.statut, 200);
      assert.equal(r.json.statut, 'ok');
    });

    test('route inconnue → 404 JSON', async () => {
      const r = await s.requete('GET', '/api/nexistepas');
      assert.equal(r.statut, 404);
      assert.match(r.json.message, /Route inconnue/);
    });

    test('JSON malformé → 400', async () => {
      const r = await s.requete('POST', '/api/auth/connexion', { corps: '{mauvais' });
      assert.equal(r.statut, 400);
      assert.equal(r.json.code, 'JSON_INVALIDE');
    });

    test('en-têtes de sécurité et CORS', async () => {
      const r = await s.requete('GET', '/api/sante', { entetes: { Origin: 'http://localhost:5555' } });
      assert.equal(r.entetes.get('x-content-type-options'), 'nosniff');
      assert.equal(r.entetes.get('access-control-allow-origin'), 'http://localhost:5555');
      assert.equal(r.entetes.get('x-powered-by'), null);
    });

    test('fond de carte : OpenStreetMap sans clé, Google Maps avec clé', async () => {
      const sans = await s.requete('GET', '/api/public/config-carte');
      assert.equal(sans.statut, 200);
      assert.deepEqual(sans.json, { fournisseur: 'osm', cleGoogle: null });
      const s2 = await demarrer({ config: { googleMapsCle: 'cle-test' } });
      try {
        const avec = await s2.requete('GET', '/api/public/config-carte');
        assert.deepEqual(avec.json, { fournisseur: 'google', cleGoogle: 'cle-test' });
        // La page de carte de l'application peut être intégrée (iframe), pas la console.
        const page = await s2.requete('GET', '/carte-app/');
        assert.equal(page.statut, 200);
        assert.equal(page.entetes.get('x-frame-options'), null);
        const consoleAdmin = await s2.requete('GET', '/admin/');
        assert.equal(consoleAdmin.entetes.get('x-frame-options'), 'DENY');
      } finally {
        s2.fermer();
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe('Authentification', () => {
    test('connexion réussie : jeton + utilisateur', async () => {
      const r = await s.requete('POST', '/api/auth/connexion', { corps: { telephone: KOSSI[0], motDePasse: KOSSI[1] } });
      assert.equal(r.statut, 200);
      assert.ok(r.json.jeton.split('.').length === 3);
      assert.equal(r.json.utilisateur.role, 'proche');
      assert.equal(r.json.utilisateur.mot_de_passe_hash, undefined);
    });

    test('mauvais mot de passe → 401 avec message lisible', async () => {
      const r = await s.requete('POST', '/api/auth/connexion', { corps: { telephone: KOSSI[0], motDePasse: 'faux' } });
      assert.equal(r.statut, 401);
      assert.equal(r.json.message, 'Numéro ou mot de passe incorrect.');
    });

    test('validation : champs manquants → 422 avec détails', async () => {
      const r = await s.requete('POST', '/api/auth/inscription', { corps: { nom: 'A' } });
      assert.equal(r.statut, 422);
      assert.equal(r.json.code, 'VALIDATION');
      assert.ok(r.json.details.length >= 2);
    });

    test('inscription puis connexion ; doublon refusé', async () => {
      const corps = { nom: 'Essi Test', telephone: '+228 93 00 00 01', motDePasse: 'MotDePasse1' };
      const r = await s.requete('POST', '/api/auth/inscription', { corps });
      assert.equal(r.statut, 201);
      assert.equal(r.json.utilisateur.telephone, '+22893000001');
      assert.ok(r.json.jeton);
      const r2 = await s.requete('POST', '/api/auth/inscription', { corps });
      assert.equal(r2.statut, 409);
      const cannes = await s.requete('GET', '/api/cannes', { jeton: r.json.jeton });
      assert.deepEqual(cannes.json.cannes, []);
    });

    test('mot de passe trop court refusé', async () => {
      const r = await s.requete('POST', '/api/auth/inscription', {
        corps: { nom: 'Court', telephone: '93000002', motDePasse: '1234' },
      });
      assert.equal(r.statut, 422);
      assert.match(r.json.message, /8 caractères/);
    });

    test('sans jeton → 401 ; jeton invalide → 401', async () => {
      assert.equal((await s.requete('GET', '/api/cannes')).statut, 401);
      const r = await s.requete('GET', '/api/cannes', { jeton: 'abc.def.ghi' });
      assert.equal(r.statut, 401);
    });

    test('mot de passe oublié → code SMS → réinitialisation', async () => {
      const sms = s.ctx.sms.envoyes;
      sms.length = 0;
      let r = await s.requete('POST', '/api/auth/mot-de-passe-oublie', { corps: { telephone: '93000001' } });
      assert.equal(r.statut, 200);
      // Le compte « +22893000001 » n'est pas « 93000001 » : aucune fuite d'existence, même réponse.
      assert.equal(sms.length, 0);

      r = await s.requete('POST', '/api/auth/mot-de-passe-oublie', { corps: { telephone: '+22893000001' } });
      assert.equal(r.statut, 200);
      assert.equal(sms.length, 1);
      const code = /code Canne Proche est (\d{6})/.exec(sms[0].message)[1];

      const faux = await s.requete('POST', '/api/auth/reinitialiser-mot-de-passe', {
        corps: { telephone: '+22893000001', code: code === '000000' ? '111111' : '000000', nouveauMotDePasse: 'Nouveau123' },
      });
      assert.equal(faux.statut, 400);

      const ok = await s.requete('POST', '/api/auth/reinitialiser-mot-de-passe', {
        corps: { telephone: '+22893000001', code, nouveauMotDePasse: 'Nouveau123' },
      });
      assert.equal(ok.statut, 200);
      await s.connexion('+22893000001', 'Nouveau123');
      // Un code ne sert qu'une fois.
      const reutilise = await s.requete('POST', '/api/auth/reinitialiser-mot-de-passe', {
        corps: { telephone: '+22893000001', code, nouveauMotDePasse: 'Encore1234' },
      });
      assert.equal(reutilise.statut, 400);
    });

    test('limitation des tentatives de connexion → 429', async () => {
      const local = await demarrer({ demo: false });
      try {
        let dernier;
        for (let i = 0; i < 11; i++) {
          dernier = await local.requete('POST', '/api/auth/connexion', { corps: { telephone: '99999999', motDePasse: 'x' } });
        }
        assert.equal(dernier.statut, 429);
        assert.ok(dernier.entetes.get('retry-after'));
      } finally {
        await local.fermer();
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe('Cannes et contrôle d\'accès', () => {
    test('liste des cannes au format attendu par l\'application', async () => {
      const r = await s.requete('GET', '/api/cannes', { jeton: jKossi });
      assert.equal(r.statut, 200);
      assert.equal(r.json.cannes.length, 2);
      const ama = r.json.cannes.find((c) => c.id === AMA);
      for (const champ of ['id', 'identifiant', 'nom', 'enLigne', 'batterie', 'dernierePosition', 'telephonePersonne', 'consentement']) {
        assert.ok(champ in ama, `champ ${champ} manquant`);
      }
      assert.equal(ama.enLigne, true);
      assert.equal(ama.consentement, true);
      assert.equal(typeof ama.dernierePosition.latitude, 'number');
      assert.equal(ama.cle_dispositif, undefined, 'la clé du boîtier ne doit pas fuiter');
      assert.equal(r.json.cannes.find((c) => c.id === YAO).consentement, false);
    });

    test('un proche ne voit pas une canne qu\'il ne suit pas → 403', async () => {
      const r = await s.requete('GET', `/api/cannes/${YAO}/position`, { jeton: jAfi });
      assert.equal(r.statut, 403);
      const z = await s.requete('GET', `/api/cannes/${YAO}/zones`, { jeton: jAfi });
      assert.equal(z.statut, 403);
    });

    test('canne inexistante → 404', async () => {
      const r = await s.requete('GET', '/api/cannes/cn_rien/position', { jeton: jKossi });
      assert.equal(r.statut, 404);
    });

    test('dernière position', async () => {
      const r = await s.requete('GET', `/api/cannes/${AMA}/position`, { jeton: jKossi });
      assert.equal(r.statut, 200);
      assert.ok(Math.abs(r.json.position.latitude - 6.145) < 0.001);
      assert.ok(r.json.position.horodatage);
    });

    test('historique par période, trié, bornes validées', async () => {
      const auj = new Date();
      const f = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const debutMois = new Date(auj.getFullYear(), auj.getMonth() - 1, auj.getDate());
      const r = await s.requete('GET', `/api/cannes/${AMA}/historique?du=${f(debutMois)}&au=${f(auj)}`, { jeton: jKossi });
      assert.equal(r.statut, 200);
      assert.ok(r.json.positions.length > 500);
      const dates = r.json.positions.map((p) => p.horodatage);
      assert.deepEqual(dates, [...dates].sort());
      const invalide = await s.requete('GET', `/api/cannes/${AMA}/historique?du=2026-13-01&au=2026-01-01`, { jeton: jKossi });
      assert.equal(invalide.statut, 422);
      const inverse = await s.requete('GET', `/api/cannes/${AMA}/historique?du=2026-02-01&au=2026-01-01`, { jeton: jKossi });
      assert.equal(inverse.statut, 422);
    });

    test('consentement enregistré', async () => {
      const r = await s.requete('POST', '/api/consentements', { jeton: jKossi, corps: { cannesId: YAO } });
      assert.equal(r.statut, 201);
      const liste = await s.requete('GET', '/api/cannes', { jeton: jKossi });
      assert.equal(liste.json.cannes.find((c) => c.id === YAO).consentement, true);
    });

    test('modification de la canne réservée au proche principal', async () => {
      const refus = await s.requete('PUT', `/api/cannes/${AMA}`, { jeton: jAfi, corps: { nom: 'Maman' } });
      assert.equal(refus.statut, 403);
      const ok = await s.requete('PUT', `/api/cannes/${AMA}`, { jeton: jKossi, corps: { nom: 'Ama Mensah' } });
      assert.equal(ok.statut, 200);
    });

    test('association d\'une canne par identifiant + code, puis dissociation', async () => {
      const mauvais = await s.requete('POST', '/api/cannes/associer', {
        jeton: jAfi, corps: { identifiant: 'CANNE-0003', codeAppairage: '000000' },
      });
      assert.equal(mauvais.statut, 400);
      assert.equal(mauvais.json.code, 'APPAIRAGE_INVALIDE');
      // Identifiant inexistant : même réponse (on ne révèle pas quelles cannes existent).
      const inconnu = await s.requete('POST', '/api/cannes/verifier', {
        jeton: jAfi, corps: { identifiant: 'CANNE-9999', codeAppairage: '135790' },
      });
      assert.equal(inconnu.statut, 400);
      assert.equal(inconnu.json.code, 'APPAIRAGE_INVALIDE');

      const verif = await s.requete('POST', '/api/cannes/verifier', {
        jeton: jAfi, corps: { identifiant: 'canne-0003', codeAppairage: '135790' },
      });
      assert.equal(verif.statut, 200);
      assert.equal(verif.json.canne.identifiant, 'CANNE-0003');
      assert.equal(verif.json.canne.seraPrincipal, true);
      // La vérification n'associe pas.
      assert.equal((await s.requete('GET', '/api/cannes/cn_demo_stock', { jeton: jAfi })).statut, 403);

      s.ctx.sms.envoyes.length = 0;
      const ok = await s.requete('POST', '/api/cannes/associer', {
        jeton: jAfi,
        corps: { identifiant: 'canne-0003', codeAppairage: '135790', nomPersonne: 'Essi Mensah', telephonePersonne: '+228 90 55 44 33' },
      });
      assert.equal(ok.statut, 201);
      assert.equal(ok.json.canne.principal, true);
      assert.equal(ok.json.canne.nom, 'Essi Mensah');
      assert.equal(ok.json.canne.telephonePersonne, '+22890554433');
      assert.equal(ok.json.smsEnvoye, true);
      assert.equal(s.ctx.sms.envoyes[0].telephone, '+22890554433');

      const doublon = await s.requete('POST', '/api/cannes/associer', {
        jeton: jAfi, corps: { identifiant: 'CANNE-0003', codeAppairage: '135790' },
      });
      assert.equal(doublon.statut, 409);
      assert.equal(doublon.json.code, 'DEJA_SUIVIE');
      const quitter = await s.requete('DELETE', '/api/cannes/cn_demo_stock/association', { jeton: jAfi });
      assert.equal(quitter.statut, 200);
      const apres = await s.requete('GET', '/api/cannes/cn_demo_stock', { jeton: jAfi });
      assert.equal(apres.statut, 403);
    });

    test('canne déjà associée (partage non autorisé) et canne désactivée', async () => {
      // CANNE-0002 est suivie par Kossi, partage non autorisé.
      const deja = await s.requete('POST', '/api/cannes/verifier', {
        jeton: jAfi, corps: { identifiant: 'CANNE-0002', codeAppairage: '275604' },
      });
      assert.equal(deja.statut, 409);
      assert.equal(deja.json.code, 'CANNE_DEJA_ASSOCIEE');
      // Le proche principal autorise le partage : l'association devient possible, sans écraser le nom.
      const autorise = await s.requete('PUT', '/api/cannes/cn_demo_yao', { jeton: jKossi, corps: { partageAutorise: true } });
      assert.equal(autorise.statut, 200);
      assert.equal(autorise.json.canne.partageAutorise, true);
      const ok = await s.requete('POST', '/api/cannes/associer', {
        jeton: jAfi, corps: { identifiant: 'CANNE-0002', codeAppairage: '275604', nomPersonne: 'Autre nom' },
      });
      assert.equal(ok.statut, 201);
      assert.equal(ok.json.canne.principal, false);
      assert.equal(ok.json.canne.nom, 'Yao Mensah');
      await s.requete('DELETE', '/api/cannes/cn_demo_yao/association', { jeton: jAfi });
      await s.requete('PUT', '/api/cannes/cn_demo_yao', { jeton: jKossi, corps: { partageAutorise: false } });

      const hs = await s.requete('POST', '/api/cannes/verifier', {
        jeton: jAfi, corps: { identifiant: 'CANNE-0004', codeAppairage: '246810' },
      });
      assert.equal(hs.statut, 403);
      assert.equal(hs.json.code, 'CANNE_DESACTIVEE');
      // Une canne désactivée ne peut plus émettre.
      const pos = await s.requete('POST', '/api/dispositif/positions', {
        corps: { latitude: 6.13, longitude: 1.22 }, entetes: { 'X-Cle-Dispositif': 'demo-cle-CANNE-0004' },
      });
      assert.equal(pos.statut, 403);
    });

    test('liste des proches d\'une canne', async () => {
      const r = await s.requete('GET', `/api/cannes/${AMA}/proches`, { jeton: jAfi });
      assert.equal(r.statut, 200);
      assert.equal(r.json.proches.length, 2);
      assert.equal(r.json.proches[0].principal, true);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Zones à éviter', () => {
    let zoneId;

    test('liste au format attendu', async () => {
      const r = await s.requete('GET', `/api/cannes/${AMA}/zones`, { jeton: jKossi });
      assert.equal(r.statut, 200);
      assert.equal(r.json.zones.length, 3);
      const z = r.json.zones[0];
      for (const champ of ['id', 'nom', 'latitude', 'longitude', 'rayon', 'actif']) assert.ok(champ in z);
    });

    test('création, validation, modification, désactivation, suppression', async () => {
      const invalide = await s.requete('POST', `/api/cannes/${AMA}/zones`, {
        jeton: jKossi, corps: { nom: '', latitude: 120, longitude: 1.2, rayon: 2 },
      });
      assert.equal(invalide.statut, 422);
      assert.equal(invalide.json.details.length, 3);

      const cree = await s.requete('POST', `/api/cannes/${AMA}/zones`, {
        jeton: jKossi, corps: { nom: 'Rond-point test', latitude: 6.1400, longitude: 1.2300, rayon: 80, actif: true },
      });
      assert.equal(cree.statut, 201);
      zoneId = cree.json.zone.id;

      const modif = await s.requete('PUT', `/api/cannes/${AMA}/zones/${zoneId}`, {
        jeton: jAfi, corps: { nom: 'Rond-point modifié', latitude: 6.1400, longitude: 1.2300, rayon: 100, actif: true },
      });
      assert.equal(modif.statut, 200);
      assert.equal(modif.json.zone.rayon, 100);

      const off = await s.requete('PUT', `/api/cannes/${AMA}/zones/${zoneId}`, { jeton: jKossi, corps: { actif: false } });
      assert.equal(off.json.zone.actif, false);
      assert.equal(off.json.zone.nom, 'Rond-point modifié');

      const autreCanne = await s.requete('PUT', `/api/cannes/${YAO}/zones/${zoneId}`, { jeton: jKossi, corps: { actif: true } });
      assert.equal(autreCanne.statut, 404, 'une zone ne peut être modifiée via une autre canne');

      const sup = await s.requete('DELETE', `/api/cannes/${AMA}/zones/${zoneId}`, { jeton: jKossi });
      assert.equal(sup.statut, 200);
      const encore = await s.requete('DELETE', `/api/cannes/${AMA}/zones/${zoneId}`, { jeton: jKossi });
      assert.equal(encore.statut, 404);
    });
  });

  // ---------------------------------------------------------------------------
  describe('API de la canne (dispositif) et détection d\'alertes', () => {
    const envoyer = (corps, cle = CLE_AMA) =>
      s.requete('POST', '/api/dispositif/positions', { corps, entetes: { 'X-Cle-Dispositif': cle } });

    test('clé absente ou invalide → 401', async () => {
      assert.equal((await s.requete('POST', '/api/dispositif/positions', { corps: { latitude: 6, longitude: 1 } })).statut, 401);
      assert.equal((await envoyer({ latitude: 6, longitude: 1 }, 'mauvaise')).statut, 401);
    });

    test('position validée et enregistrée, visible par l\'application', async () => {
      const r = await envoyer({ latitude: 6.1440, longitude: 1.2195, precision: 8, batterie: 74 });
      assert.equal(r.statut, 201);
      assert.equal(r.json.enregistrees, 1);
      const p = await s.requete('GET', `/api/cannes/${AMA}/position`, { jeton: jKossi });
      assert.equal(p.json.position.latitude, 6.144);
      assert.equal(p.json.position.batterie, 74);
      assert.equal((await envoyer({ latitude: 95, longitude: 1 })).statut, 422);
    });

    test('entrée en zone : une seule alerte par entrée, réarmée après sortie', async () => {
      const notifAvant = s.ctx.notifications.envoyees.length;
      // Carrefour Déckon : centre 6.1318, 1.2232, rayon 120 m
      const entree = await envoyer({ positions: [
        { latitude: 6.1340, longitude: 1.2229 },
        { latitude: 6.1320, longitude: 1.2232 },
      ] });
      assert.equal(entree.json.alertes.length, 1);
      assert.equal(entree.json.alertes[0].type, 'entree_zone');
      assert.equal(entree.json.alertes[0].zoneNom, 'Carrefour Déckon (circulation dense)');

      const resteDedans = await envoyer({ latitude: 6.1319, longitude: 1.2233 });
      assert.equal(resteDedans.json.alertes.length, 0);

      await envoyer({ latitude: 6.1360, longitude: 1.2225 }); // sortie
      const retour = await envoyer({ latitude: 6.1318, longitude: 1.2232 });
      assert.equal(retour.json.alertes.length, 1);

      // Les proches sont notifiés (mode simulé) avec la charge utile attendue par l'application.
      const notif = s.ctx.notifications.envoyees.at(-1);
      assert.ok(s.ctx.notifications.envoyees.length > notifAvant);
      assert.equal(notif.data.type, 'entree_zone');
      assert.equal(notif.data.canneId, AMA);
      assert.ok(notif.data.alerteId);
      assert.equal(notif.destinataires.length, 2);
      await envoyer({ latitude: 6.1450, longitude: 1.2190 }); // retour au domicile
    });

    test('zone désactivée : pas d\'alerte', async () => {
      // « Chantier rue de la gare » est inactive dans les données de démo.
      const r = await envoyer({ latitude: 6.1405, longitude: 1.2148 });
      assert.equal(r.json.alertes.length, 0);
    });

    test('batterie faible : une alerte, réarmée après recharge', async () => {
      const a = await envoyer({ latitude: 6.1450, longitude: 1.2190, batterie: 19 });
      assert.deepEqual(a.json.alertes.map((x) => x.type), ['batterie_faible']);
      const b = await envoyer({ latitude: 6.1450, longitude: 1.2190, batterie: 17 });
      assert.equal(b.json.alertes.length, 0);
      await envoyer({ latitude: 6.1450, longitude: 1.2190, batterie: 95 });
      const c = await envoyer({ latitude: 6.1450, longitude: 1.2190, batterie: 15 });
      assert.equal(c.json.alertes.length, 1);
      await envoyer({ latitude: 6.1450, longitude: 1.2190, batterie: 80 });
    });

    test('SOS et chute envoyés par la canne', async () => {
      const sos = await s.requete('POST', '/api/dispositif/alertes', {
        corps: { type: 'sos', latitude: 6.1449, longitude: 1.2191 }, entetes: { 'X-Cle-Dispositif': CLE_AMA },
      });
      assert.equal(sos.statut, 201);
      assert.equal(sos.json.alerte.type, 'sos');
      assert.equal(sos.json.alerte.latitude, 6.1449);
      const inconnu = await s.requete('POST', '/api/dispositif/alertes', {
        corps: { type: 'incendie' }, entetes: { 'X-Cle-Dispositif': CLE_AMA },
      });
      assert.equal(inconnu.statut, 422);
    });

    test('canne inactive détectée par la surveillance (une seule fois)', async () => {
      s.db.run("UPDATE cannes SET derniere_communication = '2020-01-01T00:00:00.000Z' WHERE id = ?", YAO);
      const premieres = verifierInactivite(s.ctx);
      assert.deepEqual(premieres.map((a) => a.type), ['canne_inactive']);
      assert.equal(verifierInactivite(s.ctx).length, 0);
      const liste = await s.requete('GET', `/api/cannes/${YAO}`, { jeton: jKossi });
      assert.equal(liste.json.canne.enLigne, false);
      // Une nouvelle position réarme la détection.
      await envoyer({ latitude: 6.1352, longitude: 1.2418 }, 'demo-cle-CANNE-0002');
      assert.equal((await s.requete('GET', `/api/cannes/${YAO}`, { jeton: jKossi })).json.canne.enLigne, true);
    });

    test('lot trop volumineux refusé', async () => {
      const positions = Array.from({ length: 501 }, () => ({ latitude: 6.1, longitude: 1.2 }));
      assert.equal((await envoyer({ positions })).statut, 400);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Alertes', () => {
    test('journal trié du plus récent au plus ancien, format attendu', async () => {
      const r = await s.requete('GET', `/api/cannes/${AMA}/alertes`, { jeton: jKossi });
      assert.equal(r.statut, 200);
      const a = r.json.alertes;
      assert.ok(a.length >= 4);
      assert.deepEqual(a.map((x) => x.horodatage), [...a.map((x) => x.horodatage)].sort().reverse());
      for (const champ of ['id', 'type', 'horodatage', 'traitee', 'zoneNom', 'latitude', 'longitude', 'cannesId']) {
        assert.ok(champ in a[0], `champ ${champ} manquant`);
      }
    });

    test('marquer traitée (par un proche qui suit la canne uniquement)', async () => {
      const liste = await s.requete('GET', `/api/cannes/${YAO}/alertes?nonTraitees=true`, { jeton: jKossi });
      const id = liste.json.alertes[0].id;
      const refus = await s.requete('PUT', `/api/alertes/${id}/traitee`, { jeton: jAfi });
      assert.equal(refus.statut, 403);
      const ok = await s.requete('PUT', `/api/alertes/${id}/traitee`, { jeton: jKossi });
      assert.equal(ok.statut, 200);
      assert.equal(ok.json.alerte.traitee, true);
      assert.equal(ok.json.alerte.traiteePar, 'Kossi Mensah (démo)');
      assert.equal((await s.requete('PUT', '/api/alertes/al_inexistante/traitee', { jeton: jKossi })).statut, 404);
    });

    test('SOS de test depuis l\'application', async () => {
      const r = await s.requete('POST', `/api/cannes/${AMA}/sos`, { jeton: jKossi });
      assert.equal(r.statut, 201);
      assert.match(r.json.alerte.message, /SOS de test/);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Partage temporaire et page publique', () => {
    test('créer, lister, consulter publiquement, révoquer', async () => {
      const cree = await s.requete('POST', '/api/liens-partage', { jeton: jKossi, corps: { cannesId: AMA, dureeHeures: 4 } });
      assert.equal(cree.statut, 201);
      assert.match(cree.json.lien, /^http:\/\/test\.local\/suivi\/[\w-]+$/);
      const jeton = cree.json.lien.split('/').pop();

      const liste = await s.requete('GET', '/api/liens-partage', { jeton: jKossi });
      assert.ok(liste.json.liens.some((l) => l.id === cree.json.id));
      // Afi ne voit pas les liens de Kossi.
      assert.equal((await s.requete('GET', '/api/liens-partage', { jeton: jAfi })).json.liens.length, 0);

      const pub = await s.requete('GET', `/api/public/suivi/${jeton}`);
      assert.equal(pub.statut, 200);
      assert.equal(pub.json.canne.nom, 'Ama Mensah');
      assert.ok(pub.json.position.latitude);
      assert.equal(pub.json.canne.telephone_personne, undefined);

      const page = await s.requete('GET', `/suivi/${jeton}`);
      assert.equal(page.statut, 200);
      assert.match(page.texte, /<html/i);

      assert.equal((await s.requete('DELETE', `/api/liens-partage/${cree.json.id}`, { jeton: jAfi })).statut, 404);
      assert.equal((await s.requete('DELETE', `/api/liens-partage/${cree.json.id}`, { jeton: jKossi })).statut, 200);
      assert.equal((await s.requete('GET', `/api/public/suivi/${jeton}`)).statut, 410);
    });

    test('lien expiré → 410 ; durée hors limites → 422 ; canne non suivie → 403', async () => {
      const cree = await s.requete('POST', '/api/liens-partage', { jeton: jKossi, corps: { cannesId: AMA, dureeHeures: 1 } });
      s.db.run("UPDATE liens_partage SET expire_le = '2020-01-01T00:00:00.000Z' WHERE id = ?", cree.json.id);
      const jeton = cree.json.lien.split('/').pop();
      assert.equal((await s.requete('GET', `/api/public/suivi/${jeton}`)).statut, 410);
      assert.equal((await s.requete('GET', '/api/public/suivi/inexistant')).statut, 404);
      assert.equal((await s.requete('POST', '/api/liens-partage', { jeton: jKossi, corps: { cannesId: AMA, dureeHeures: 500 } })).statut, 422);
      assert.equal((await s.requete('POST', '/api/liens-partage', { jeton: jAfi, corps: { cannesId: YAO, dureeHeures: 1 } })).statut, 403);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Compte utilisateur', () => {
    test('profil : lecture et modification du nom', async () => {
      const r = await s.requete('PUT', '/api/utilisateur/profil', { jeton: jAfi, corps: { nom: 'Afi M. (démo)' } });
      assert.equal(r.statut, 200);
      assert.equal((await s.requete('GET', '/api/utilisateur/profil', { jeton: jAfi })).json.utilisateur.nom, 'Afi M. (démo)');
    });

    test('paramètres (corps envoyé par l\'application)', async () => {
      const r = await s.requete('PUT', '/api/utilisateur/parametres', {
        jeton: jAfi, corps: { delaiInactiviteMinutes: 30, notificationsActives: false, fcmToken: 'jeton-fcm-de-test-123' },
      });
      assert.equal(r.statut, 200);
      assert.equal(r.json.utilisateur.delaiInactiviteMinutes, 30);
      assert.equal(r.json.utilisateur.notificationsActives, false);
      const bad = await s.requete('PUT', '/api/utilisateur/parametres', { jeton: jAfi, corps: { delaiInactiviteMinutes: -3 } });
      assert.equal(bad.statut, 422);
      // Notifications désactivées : Afi ne fait plus partie des destinataires.
      await s.requete('POST', '/api/dispositif/alertes', { corps: { type: 'chute' }, entetes: { 'X-Cle-Dispositif': CLE_AMA } });
      assert.equal(s.ctx.notifications.envoyees.at(-1).destinataires.length, 1);
      await s.requete('PUT', '/api/utilisateur/parametres', { jeton: jAfi, corps: { notificationsActives: true } });
    });

    test('changement de mot de passe', async () => {
      const faux = await s.requete('PUT', '/api/utilisateur/mot-de-passe', {
        jeton: jAfi, corps: { ancienMotDePasse: 'mauvais', nouveauMotDePasse: 'Nouveau2026' },
      });
      assert.equal(faux.statut, 400);
      const ok = await s.requete('PUT', '/api/utilisateur/mot-de-passe', {
        jeton: jAfi, corps: { ancienMotDePasse: AFI[1], nouveauMotDePasse: 'Nouveau2026' },
      });
      assert.equal(ok.statut, 200);
      await s.connexion(AFI[0], 'Nouveau2026');
      await s.requete('PUT', '/api/utilisateur/mot-de-passe', {
        jeton: jAfi, corps: { ancienMotDePasse: 'Nouveau2026', nouveauMotDePasse: AFI[1] },
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('Administration et rôles', () => {
    test('un proche n\'a pas accès à l\'administration → 403', async () => {
      const r = await s.requete('GET', '/api/admin/utilisateurs', { jeton: jKossi });
      assert.equal(r.statut, 403);
    });

    test('statistiques et listes', async () => {
      const st = await s.requete('GET', '/api/admin/statistiques', { jeton: jAdmin });
      assert.equal(st.statut, 200);
      assert.ok(st.json.cannes >= 3);
      const cannes = await s.requete('GET', '/api/admin/cannes', { jeton: jAdmin });
      assert.ok(cannes.json.cannes[0].cleDispositif, 'l\'admin voit la clé du boîtier');
      assert.ok((await s.requete('GET', '/api/admin/journal', { jeton: jAdmin })).json.journal.length > 0);
      assert.ok((await s.requete('GET', '/api/admin/alertes', { jeton: jAdmin })).json.alertes.length > 0);
      assert.equal(st.json.cannesDesactivees, 1);
      assert.equal(st.json.cannesNonAttribuees >= 1, true);
      const pos = await s.requete('GET', '/api/admin/positions', { jeton: jAdmin });
      assert.equal(pos.statut, 200);
      assert.ok(pos.json.positions.some((p) => p.canneId === 'cn_demo_ama' && typeof p.latitude === 'number'));
      assert.equal((await s.requete('GET', '/api/admin/sms', { jeton: jAdmin })).statut, 200);
      assert.equal((await s.requete('GET', '/api/admin/positions', { jeton: jKossi })).statut, 403);
    });

    test('cycle complet : créer un proche et une canne, attribuer, désactiver', async () => {
      const u = await s.requete('POST', '/api/admin/utilisateurs', {
        jeton: jAdmin, corps: { nom: 'Proche Créé', telephone: '96000000', motDePasse: 'Secret2026' },
      });
      assert.equal(u.statut, 201);
      const c = await s.requete('POST', '/api/admin/cannes', {
        jeton: jAdmin, corps: { identifiant: 'canne-0100', nom: 'Grand-mère Essi' },
      });
      assert.equal(c.statut, 201);
      assert.equal(c.json.canne.identifiant, 'CANNE-0100');
      assert.match(c.json.canne.codeAppairage, /^\d{6}$/);
      const dbl = await s.requete('POST', '/api/admin/cannes', { jeton: jAdmin, corps: { identifiant: 'CANNE-0100', nom: 'Xavier' } });
      assert.equal(dbl.statut, 409);

      const att = await s.requete('POST', `/api/admin/cannes/${c.json.canne.id}/proches`, {
        jeton: jAdmin, corps: { utilisateurId: u.json.utilisateur.id },
      });
      assert.equal(att.statut, 201);
      const jNouveau = await s.connexion('96000000', 'Secret2026');
      assert.equal((await s.requete('GET', '/api/cannes', { jeton: jNouveau })).json.cannes.length, 1);

      // La nouvelle canne peut émettre avec sa clé.
      const pos = await s.requete('POST', '/api/dispositif/positions', {
        corps: { latitude: 6.13, longitude: 1.22 }, entetes: { 'X-Cle-Dispositif': c.json.canne.cleDispositif },
      });
      assert.equal(pos.statut, 201);

      // Régénérer la clé invalide l'ancienne.
      const regen = await s.requete('POST', `/api/admin/cannes/${c.json.canne.id}/regenerer`, { jeton: jAdmin, corps: { cle: true } });
      assert.notEqual(regen.json.canne.cleDispositif, c.json.canne.cleDispositif);
      const ancienne = await s.requete('POST', '/api/dispositif/positions', {
        corps: { latitude: 6.13, longitude: 1.22 }, entetes: { 'X-Cle-Dispositif': c.json.canne.cleDispositif },
      });
      assert.equal(ancienne.statut, 401);

      // Désactiver le compte coupe l'accès immédiatement, même avec un jeton valide.
      await s.requete('PUT', `/api/admin/utilisateurs/${u.json.utilisateur.id}`, { jeton: jAdmin, corps: { actif: false } });
      assert.equal((await s.requete('GET', '/api/cannes', { jeton: jNouveau })).statut, 401);
      const refus = await s.requete('POST', '/api/auth/connexion', { corps: { telephone: '96000000', motDePasse: 'Secret2026' } });
      assert.equal(refus.statut, 403);

      // Promotion en admin : le changement de rôle s'applique sans reconnexion.
      await s.requete('PUT', `/api/admin/utilisateurs/${u.json.utilisateur.id}`, { jeton: jAdmin, corps: { actif: true, role: 'admin' } });
      assert.equal((await s.requete('GET', '/api/admin/statistiques', { jeton: jNouveau })).statut, 200);

      // Désactiver la canne : l'état est visible et le boîtier est refusé.
      const off = await s.requete('PUT', `/api/admin/cannes/${c.json.canne.id}`, { jeton: jAdmin, corps: { active: false, partageAutorise: true } });
      assert.equal(off.json.canne.active, false);
      assert.equal(off.json.canne.partageAutorise, true);
      const refusee = await s.requete('POST', '/api/dispositif/positions', {
        corps: { latitude: 6.13, longitude: 1.22 }, entetes: { 'X-Cle-Dispositif': regen.json.canne.cleDispositif },
      });
      assert.equal(refusee.statut, 403);

      assert.equal((await s.requete('DELETE', `/api/admin/cannes/${c.json.canne.id}`, { jeton: jAdmin })).statut, 200);
      assert.equal((await s.requete('DELETE', `/api/admin/utilisateurs/${u.json.utilisateur.id}`, { jeton: jAdmin })).statut, 200);
    });

    test('protection du dernier administrateur', async () => {
      const moi = (await s.requete('GET', '/api/auth/moi', { jeton: jAdmin })).json.utilisateur;
      const r = await s.requete('PUT', `/api/admin/utilisateurs/${moi.id}`, { jeton: jAdmin, corps: { role: 'proche' } });
      assert.equal(r.statut, 409);
      const sup = await s.requete('DELETE', `/api/admin/utilisateurs/${moi.id}`, { jeton: jAdmin });
      assert.equal(sup.statut, 409);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Téléphone de test à la place de la canne', () => {
    let cle;
    let canneId;

    test('l\'administrateur crée une canne : code d\'activation fourni', async () => {
      const c = await s.requete('POST', '/api/admin/cannes', {
        jeton: jAdmin, corps: { identifiant: 'CANNE-0200', nom: 'Test terrain' },
      });
      assert.equal(c.statut, 201);
      assert.match(c.json.canne.codeActivation, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      assert.equal(c.json.canne.typeDispositif, 'canne');
      canneId = c.json.canne.id;

      const faux = await s.requete('POST', '/api/dispositif/activer', {
        corps: { identifiant: 'CANNE-0200', codeActivation: 'AAAA-AAAA' },
      });
      assert.equal(faux.statut, 400);
      assert.equal(faux.json.code, 'ACTIVATION_INVALIDE');

      // Saisie tolérante : minuscules, sans tiret.
      const code = c.json.canne.codeActivation.toLowerCase().replace('-', '');
      const ok = await s.requete('POST', '/api/dispositif/activer', {
        corps: { identifiant: 'canne-0200', codeActivation: code, appareil: 'Android test' },
      });
      assert.equal(ok.statut, 200);
      assert.equal(ok.json.cle, c.json.canne.cleDispositif);
      assert.equal(ok.json.canne.identifiant, 'CANNE-0200');
      assert.equal(ok.json.reglages.intervallePositionS, 5);
      cle = ok.json.cle;

      const vue = (await s.requete('GET', '/api/admin/cannes', { jeton: jAdmin })).json.cannes.find((x) => x.id === canneId);
      assert.equal(vue.typeDispositif, 'telephone');
      assert.ok(vue.dispositifActiveLe);
    });

    test('le téléphone envoie de vraies positions, visibles par le proche associé', async () => {
      const pos = await s.requete('POST', '/api/dispositif/positions', {
        corps: { latitude: 6.1725, longitude: 1.2314, precision: 7, batterie: 64 },
        entetes: { 'X-Cle-Dispositif': cle, 'X-Source-Dispositif': 'telephone' },
      });
      assert.equal(pos.statut, 201);
      const admin = (await s.requete('GET', '/api/admin/cannes', { jeton: jAdmin })).json.cannes.find((x) => x.id === canneId);
      const code = admin.codeAppairage;
      const nouveau = await s.requete('POST', '/api/auth/inscription', {
        corps: { nom: 'Testeur Terrain', telephone: '97000000', motDePasse: 'Terrain2026' },
      });
      const jTesteur = nouveau.json.jeton;
      const assoc = await s.requete('POST', '/api/cannes/associer', {
        jeton: jTesteur, corps: { identifiant: 'CANNE-0200', codeAppairage: code, nomPersonne: 'Mawuli', telephonePersonne: '90112244' },
      });
      assert.equal(assoc.statut, 201);
      const liste = await s.requete('GET', '/api/cannes', { jeton: jTesteur });
      const vue = liste.json.cannes[0];
      assert.equal(vue.enLigne, true);
      assert.equal(vue.typeDispositif, 'telephone');
      assert.equal(vue.dernierePosition.latitude, 6.1725);
      assert.equal(vue.batterie, 64);
    });

    test('une position trop imprécise ne déclenche pas d\'alerte de zone', async () => {
      const z = await s.requete('POST', `/api/cannes/${canneId}/zones`, {
        jeton: jAdmin, corps: { nom: 'Carrefour test', latitude: 6.18, longitude: 1.24, rayon: 50 },
      });
      assert.equal(z.statut, 201);
      const flou = await s.requete('POST', '/api/dispositif/positions', {
        corps: { latitude: 6.18, longitude: 1.24, precision: 150 }, entetes: { 'X-Cle-Dispositif': cle },
      });
      assert.equal(flou.json.alertes.length, 0);
      const net = await s.requete('POST', '/api/dispositif/positions', {
        corps: { latitude: 6.18, longitude: 1.24, precision: 8 }, entetes: { 'X-Cle-Dispositif': cle },
      });
      assert.equal(net.json.alertes.length, 1);
      assert.equal(net.json.alertes[0].type, 'entree_zone');
    });

    test('compatible Traccar Client (format OsmAnd et JSON)', async () => {
      // Heure en secondes Unix (format OsmAnd) ; une heure future est ramenée à maintenant.
      const t = Math.floor(Date.now() / 1000) + 60;
      const osm = await s.requete('POST', `/api/dispositif/osmand?id=${encodeURIComponent(cle)}&lat=6.1701&lon=1.2299&timestamp=${t}&accuracy=9&batt=58`);
      assert.equal(osm.statut, 200);
      let p = (await s.requete('GET', `/api/cannes/${canneId}/position`, { jeton: jAdmin })).json;
      p = p.position || p;
      assert.equal(p.latitude, 6.1701);
      assert.equal(p.batterie, 58);

      const json = await s.requete('POST', '/api/dispositif/osmand', {
        corps: {
          device_id: cle,
          location: { timestamp: new Date().toISOString(), coords: { latitude: 6.1702, longitude: 1.23, accuracy: 6 }, battery: { level: 0.57 } },
        },
      });
      assert.equal(json.statut, 200);
      const vue = (await s.requete('GET', '/api/admin/cannes', { jeton: jAdmin })).json.cannes.find((x) => x.id === canneId);
      assert.equal(vue.typeDispositif, 'traccar');
      assert.equal(vue.batterie, 57);

      const inconnu = await s.requete('GET', '/api/dispositif/osmand?id=inconnu&lat=6&lon=1');
      assert.equal(inconnu.statut, 401);
    });

    test('flux temps réel de la console (Server-Sent Events)', async () => {
      assert.equal((await fetch(`${s.url}/api/admin/flux?jeton=faux`)).status, 401);
      assert.equal((await fetch(`${s.url}/api/admin/flux?jeton=${jKossi}`)).status, 403);

      const controleur = new AbortController();
      const r = await fetch(`${s.url}/api/admin/flux?jeton=${jAdmin}`, { signal: controleur.signal });
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /text\/event-stream/);
      const lecteur = r.body.getReader();
      const recu = (async () => {
        let texte = '';
        while (!texte.includes('event: position')) {
          const { value, done } = await lecteur.read();
          if (done) break;
          texte += new TextDecoder().decode(value);
        }
        return texte;
      })();
      await new Promise((ok) => setTimeout(ok, 50));
      await s.requete('POST', '/api/dispositif/positions', {
        corps: { latitude: 6.1703, longitude: 1.2301, precision: 5 }, entetes: { 'X-Cle-Dispositif': cle },
      });
      const texte = await recu;
      controleur.abort();
      const ligne = texte.split('\n').find((l) => l.startsWith('data: ') && l.includes('"position"'));
      const evenement = JSON.parse(ligne.slice(6));
      assert.equal(evenement.canneId, canneId);
      assert.equal(evenement.position.latitude, 6.1703);
    });

    test('canne désactivée : activation refusée ; code d\'activation régénérable', async () => {
      const regen = await s.requete('POST', `/api/admin/cannes/${canneId}/regenerer`, { jeton: jAdmin, corps: { activation: true, code: false } });
      assert.match(regen.json.canne.codeActivation, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      await s.requete('PUT', `/api/admin/cannes/${canneId}`, { jeton: jAdmin, corps: { active: false } });
      const refus = await s.requete('POST', '/api/dispositif/activer', {
        corps: { identifiant: 'CANNE-0200', codeActivation: regen.json.canne.codeActivation },
      });
      assert.equal(refus.statut, 403);
      assert.equal(refus.json.code, 'CANNE_DESACTIVEE');
    });
  });
});
