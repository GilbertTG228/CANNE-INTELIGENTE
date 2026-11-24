/* Console d'administration Canne Proche — JavaScript sans dépendance (Leaflet chargé à la demande). */
(function () {
  'use strict';

  // ===========================================================================
  // Outils
  // ===========================================================================
  const $ = (sel, racine = document) => racine.querySelector(sel);
  const $$ = (sel, racine = document) => [...racine.querySelectorAll(sel)];

  const echapper = (t) =>
    String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icone = (nom) => `<svg class="ic" aria-hidden="true"><use href="#i-${nom}"/></svg>`;

  const dateHeure = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const heure = (iso) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—');
  const date = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—');

  function ilYa(iso) {
    if (!iso) return 'jamais';
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return `il y a ${Math.max(s, 1)} s`;
    const m = Math.round(s / 60);
    if (m < 60) return `il y a ${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `il y a ${h} h`;
    return `le ${dateHeure(iso)}`;
  }

  /** « Ama Mensah (démo) » → « AM ». */
  function initiales(nom) {
    const mots = String(nom || '').replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
    if (!mots.length) return '—';
    if (mots.length === 1) return mots[0].slice(0, 2).toUpperCase(); // « Administrateur » → « AD »
    return (mots[0][0] + mots[mots.length - 1][0]).toUpperCase();
  }

  /** Distance en mètres (formule de haversine). */
  function distanceM(a, b) {
    const R = 6371000;
    const rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(b.latitude - a.latitude);
    const dLon = rad(b.longitude - a.longitude);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const distanceLisible = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);
  function dureeLisible(ms) {
    const min = Math.round(ms / 60000);
    if (min < 60) return `${min} min`;
    return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
  }

  const TYPES_ALERTE = {
    sos: { libelle: 'SOS', classe: 'crit', court: 'SOS' },
    chute: { libelle: 'Chute', classe: 'crit', court: '!' },
    entree_zone: { libelle: 'Entrée en zone', classe: 'avert', icone: 'bouclier' },
    batterie_faible: { libelle: 'Batterie faible', classe: 'avert', icone: 'batterie' },
    canne_inactive: { libelle: 'Canne inactive', classe: 'neutre', icone: 'wifi-off' },
  };
  const typeAlerte = (t) => TYPES_ALERTE[t] || { libelle: t, classe: 'neutre', icone: 'cloche' };

  /** Appareil qui émet pour la canne : la vraie canne ou un substitut de test. */
  const TYPES_DISPOSITIF = {
    canne: ['Canne', 'ok'],
    telephone: ['Téléphone de test', 'avert'],
    traccar: ['Traccar Client', 'avert'],
    simulateur: ['Simulateur', 'neutre'],
  };
  const badgeDispositif = (c) => {
    const [libelle, classe] = TYPES_DISPOSITIF[c.typeDispositif] || TYPES_DISPOSITIF.canne;
    return `<span class="badge ${classe}" title="Appareil qui envoie les positions">${libelle}</span>`;
  };

  const stockage = {
    lire(cle) { try { return sessionStorage.getItem(cle); } catch { return null; } },
    ecrire(cle, val) { try { sessionStorage.setItem(cle, val); } catch { /* navigation privée */ } },
    effacer(cle) { try { sessionStorage.removeItem(cle); } catch { /* ignoré */ } },
  };

  function toast(message, erreur = false) {
    const el = document.createElement('div');
    el.className = 'toast' + (erreur ? ' erreur-toast' : '');
    el.setAttribute('role', erreur ? 'alert' : 'status');
    el.textContent = message;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), erreur ? 6000 : 3500);
  }

  // ===========================================================================
  // API
  // ===========================================================================
  let jeton = stockage.lire('jeton_admin');

  class ErreurApi extends Error {
    constructor(message, statut, code) { super(message); this.statut = statut; this.code = code; }
  }

  async function api(methode, chemin, corps, entetes = {}) {
    let reponse;
    const dispositif = !!entetes['X-Cle-Dispositif'];
    try {
      reponse = await fetch(chemin, {
        method: methode,
        headers: {
          Accept: 'application/json',
          ...(corps !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(jeton && !dispositif ? { Authorization: `Bearer ${jeton}` } : {}),
          ...entetes,
        },
        body: corps === undefined ? undefined : JSON.stringify(corps),
      });
    } catch {
      throw new ErreurApi('Serveur injoignable. Est-il démarré ?', 0);
    }
    const json = await reponse.json().catch(() => ({}));
    if (reponse.status === 401 && !dispositif && chemin !== '/api/auth/connexion') {
      deconnecter('Session expirée, reconnectez-vous.');
    }
    if (!reponse.ok) throw new ErreurApi(json.message || `Erreur ${reponse.status}`, reponse.status, json.code);
    return json;
  }

  /** Exécute une action en désactivant le bouton pendant l'appel. */
  async function action(bouton, fn, messageSucces) {
    if (bouton) bouton.disabled = true;
    try {
      const r = await fn();
      if (messageSucces) toast(messageSucces);
      return r;
    } catch (e) {
      toast(e.message, true);
      return undefined;
    } finally {
      if (bouton) bouton.disabled = false;
    }
  }

  // ===========================================================================
  // Données partagées
  // ===========================================================================
  const donnees = { cannes: [], utilisateurs: [], stats: null, moi: null };

  async function chargerCannes() {
    donnees.cannes = (await api('GET', '/api/admin/cannes')).cannes;
    return donnees.cannes;
  }
  async function chargerUtilisateurs() {
    donnees.utilisateurs = (await api('GET', '/api/admin/utilisateurs')).utilisateurs;
    return donnees.utilisateurs;
  }
  const canneParId = (id) => donnees.cannes.find((c) => c.id === id);

  /** État lisible d'une canne : [libellé, classe de pastille, classe de marqueur]. */
  function etatCanne(c) {
    if (!c.active) return ['Désactivée', 'neutre', 'desactivee'];
    if (!c.derniereCommunication) return ['Jamais connectée', 'neutre', 'hors-ligne'];
    if (c.enLigne) return ['En ligne', 'ok', ''];
    return ['Hors ligne', 'avert', 'hors-ligne'];
  }
  const pastilleEtat = (c) => {
    const [libelle, classe] = etatCanne(c);
    return `<span class="badge ${classe}"><span class="point"></span>${libelle}</span>`;
  };
  function batterieHtml(b) {
    if (b == null) return '<span class="meta">—</span>';
    const seuil = donnees.stats?.seuilBatterieFaible ?? 20;
    const classe = b < seuil ? 'faible' : b < 40 ? 'moyenne' : '';
    return `<span class="barre-batterie ${classe}"><span class="jauge"><span style="width:${Math.max(4, b)}%"></span></span>${b} %</span>`;
  }
  const principalDe = (c) => c.proches?.find((p) => p.principal);

  /** Pastille d'état du tableau de bord : « ● En ligne », « ○ Hors ligne », « En stock ». */
  function pastilleTableau(c) {
    if (!c.active) return '<span class="badge neutre">Désactivée</span>';
    if (!c.proches?.length && !c.derniereCommunication) return '<span class="badge neutre">En stock</span>';
    if (c.enLigne) return '<span class="badge ok">● En ligne</span>';
    return '<span class="badge avert">○ Hors ligne</span>';
  }

  // ===========================================================================
  // Cartes Google Maps ou Leaflet (chargées à la demande ; la console reste utilisable sans Internet)
  // ===========================================================================
  // Fond de carte : Google Maps si le serveur a une clé (GOOGLE_MAPS_CLE), sinon
  // OpenStreetMap avec Leaflet. Voir /commun/carte-google.js (même API « L » dans
  // les deux cas : le reste de la console ne change pas).
  function chargerLeaflet() {
    if (!window.ChargeurCarte) return Promise.resolve(!!window.L);
    return window.ChargeurCarte.charger().then((fournisseur) => !!fournisseur);
  }

  const LOME = [6.1319, 1.2228];
  const cartes = {};

  /** Crée (une seule fois) la carte de l'élément `id`. Renvoie null sans Leaflet. */
  async function carte(id, { surClic } = {}) {
    if (cartes[id]) {
      setTimeout(() => cartes[id].invalidateSize(), 30);
      return cartes[id];
    }
    const ok = await chargerLeaflet();
    const el = document.getElementById(id);
    if (!ok) {
      el.classList.add('carte-indisponible');
      el.textContent = 'Carte indisponible sans connexion Internet. Les autres fonctions restent utilisables.';
      return null;
    }
    const m = L.map(el, { zoomControl: false }).setView(LOME, 14);
    L.control.zoom({ position: 'topright' }).addTo(m);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(m);
    m.calque = L.layerGroup().addTo(m);
    if (surClic) m.on('click', (e) => surClic(e.latlng));
    cartes[id] = m;
    // Recalcule la carte quand son cadre change de taille (chargement de la liste,
    // fenêtre redimensionnée, passage en une colonne) : sinon elle reste tronquée.
    if (window.ResizeObserver) new ResizeObserver(() => m.invalidateSize()).observe(el);
    setTimeout(() => m.invalidateSize(), 30);
    return m;
  }

  function marqueurCanne(c, { grand = false } = {}) {
    const [, , classe] = etatCanne(c);
    const taille = grand ? 46 : 38;
    return L.marker([c.dernierePosition.latitude, c.dernierePosition.longitude], {
      icon: L.divIcon({
        className: '',
        html: `<div class="marqueur ${classe}" style="width:${taille}px;height:${taille}px">${echapper(initiales(c.nom))}</div>`,
        iconSize: [taille, taille],
        iconAnchor: [taille / 2, taille / 2],
      }),
      title: c.nom,
      keyboard: true,
    });
  }

  function cercleZone(z) {
    return L.circle([z.latitude, z.longitude], {
      radius: z.rayon, color: z.actif ? '#B91C1C' : '#64748B', weight: 2,
      fillOpacity: z.actif ? 0.14 : 0.05, dashArray: z.actif ? '7 6' : '3 5',
    }).bindTooltip(echapper(z.nom) + (z.actif ? '' : ' (désactivée)'));
  }

  // ===========================================================================
  // Boîte de dialogue (formulaires et confirmations)
  // ===========================================================================
  /**
   * champs : [{ nom, libelle, type: text|tel|password|number|select|checkbox, valeur, options: [[val, libellé]], aide, requis }]
   * surValider(valeurs) : async ; une erreur garde la fenêtre ouverte et s'affiche.
   */
  function dialogue({ titre, texte, champs = [], libelleValider = 'Valider', danger = false, sansAnnuler = false, surValider }) {
    const d = $('#dialogue');
    $('#dialogue-titre').textContent = titre;
    const corps = $('#dialogue-corps');
    corps.innerHTML = (texte ? `<div class="texte-dialogue">${texte}</div>` : '') + champs.map((c) => {
      if (c.type === 'select') {
        return `<label>${echapper(c.libelle)}<select name="${c.nom}">${c.options.map(([v, l]) =>
          `<option value="${echapper(v)}" ${String(v) === String(c.valeur) ? 'selected' : ''}>${echapper(l)}</option>`).join('')}</select></label>`;
      }
      if (c.type === 'checkbox') {
        return `<label class="case"><input type="checkbox" name="${c.nom}" ${c.valeur ? 'checked' : ''}> ${echapper(c.libelle)}</label>`;
      }
      return `<label>${echapper(c.libelle)}<input name="${c.nom}" type="${c.type || 'text'}" value="${echapper(c.valeur ?? '')}"
        ${c.requis ? 'required' : ''} ${c.min !== undefined ? `min="${c.min}"` : ''} ${c.max !== undefined ? `max="${c.max}"` : ''} autocomplete="off">${c.aide ? `<span class="aide">${echapper(c.aide)}</span>` : ''}</label>`;
    }).join('');
    const bouton = $('#dialogue-valider');
    bouton.textContent = libelleValider;
    bouton.className = 'bouton ' + (danger ? 'danger' : 'primaire');
    $('#form-dialogue [value=annuler]').hidden = sansAnnuler;
    const err = $('#dialogue-erreur');
    err.hidden = true;

    const form = $('#form-dialogue');
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (e.submitter?.value === 'annuler') return d.close();
      const valeurs = {};
      for (const c of champs) {
        const el = form.elements[c.nom];
        valeurs[c.nom] = c.type === 'checkbox' ? el.checked : el.value.trim();
      }
      bouton.disabled = true;
      err.hidden = true;
      try {
        if (surValider) await surValider(valeurs);
        d.close();
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      } finally {
        bouton.disabled = false;
      }
    };
    d.showModal();
    $('input, select', corps)?.focus();
  }

  // ===========================================================================
  // Connexion
  // ===========================================================================
  function afficherConnexion(message) {
    $('#application').hidden = true;
    $('#ecran-connexion').hidden = false;
    const err = $('#erreur-connexion');
    err.hidden = !message;
    err.textContent = message || '';
  }

  function deconnecter(message) {
    jeton = null;
    stockage.effacer('jeton_admin');
    simulation.arreter();
    deconnecterFlux();
    afficherConnexion(message);
  }

  $('#form-connexion').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const bouton = $('button[type=submit]', form);
    const err = $('#erreur-connexion');
    err.hidden = true;
    bouton.disabled = true;
    try {
      const r = await api('POST', '/api/auth/connexion', {
        telephone: form.telephone.value.trim(),
        motDePasse: form.motDePasse.value,
      });
      if (r.utilisateur.role !== 'admin') {
        throw new ErreurApi('Cette console est réservée aux administrateurs. Les proches utilisent l\'application mobile.');
      }
      jeton = r.jeton;
      stockage.ecrire('jeton_admin', jeton);
      form.reset();
      demarrerApplication(r.utilisateur);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      bouton.disabled = false;
    }
  });

  $('#deconnexion').addEventListener('click', () => deconnecter());

  // Recherche globale : ouvre la liste des cannes filtrée.
  $('#form-recherche').addEventListener('submit', (e) => {
    e.preventDefault();
    rechercheCannes = $('#recherche-globale').value.trim();
    $('#recherche-cannes').value = rechercheCannes;
    ouvrirOnglet('cannes');
  });

  // ===========================================================================
  // Navigation
  // ===========================================================================
  let ongletActif = 'tableau';
  const chargeurs = {};

  function ouvrirOnglet(nom) {
    ongletActif = nom;
    // Cartographie en plein écran avec le menu réduit à un rail d'icônes (maquette 8).
    $('#application').classList.toggle('mode-carto', nom === 'cartographie');
    // Recherche et compte administrateur à droite de l'en-tête de la page (maquette 7).
    const entete = $(`[data-panneau="${nom}"] .entete`);
    if (entete && nom !== 'cartographie') entete.appendChild($('#barre-compte'));
    $$('.menu [data-onglet]').forEach((b) => {
      if (b.dataset.onglet === nom) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    $$('[data-panneau]').forEach((p) => { p.hidden = p.dataset.panneau !== nom; });
    chargeurs[nom]?.();
    window.scrollTo(0, 0);
  }
  $$('.menu [data-onglet]').forEach((b) => b.addEventListener('click', () => ouvrirOnglet(b.dataset.onglet)));
  document.addEventListener('click', (e) => {
    const aller = e.target.closest('[data-aller]');
    if (aller) ouvrirOnglet(aller.dataset.aller);
    const actualiser = e.target.closest('[data-actualiser]');
    if (actualiser) chargeurs[actualiser.dataset.actualiser]?.();
    if (e.target.closest('[data-nouvelle-canne]')) nouvelleCanne();
    const compte = e.target.closest('[data-nouveau-compte]');
    if (compte) nouveauCompte(compte.dataset.nouveauCompte);
  });

  /** Groupe de puces exclusives (filtres). */
  function puces(conteneur, surChoix) {
    conteneur.addEventListener('click', (e) => {
      const b = e.target.closest('.puce');
      if (!b) return;
      $$('.puce', conteneur).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      surChoix(b.dataset.filtre || b.dataset.vue);
    });
  }

  async function majCompteurAlertes() {
    try {
      donnees.stats = await api('GET', '/api/admin/statistiques');
      const n = donnees.stats.alertesNonTraitees;
      const el = $('#compteur-alertes');
      el.hidden = n === 0;
      el.textContent = n;
    } catch { /* silencieux */ }
  }

  // ===========================================================================
  // Tableau de bord
  // ===========================================================================
  function elementAlerte(a) {
    const t = typeAlerte(a.type);
    const pastille = t.court ? `<span class="icone">${t.court}</span>` : `<span class="icone">${icone(t.icone)}</span>`;
    return `<div class="element ${a.traitee ? '' : t.classe}">${pastille}
      <div class="corps">
        <div class="titre">${t.libelle} · ${echapper(a.canneNom || '')}</div>
        <div class="meta">${heure(a.horodatage)} · ${date(a.horodatage)}${a.zoneNom ? ' · ' + echapper(a.zoneNom) : ''} ·
          ${a.traitee ? `<span style="color:var(--ok-texte);font-weight:600">traitée${a.traiteePar ? ' par ' + echapper(a.traiteePar) : ''}</span>` : '<strong>à traiter</strong>'}</div>
      </div></div>`;
  }

  /** « Lundi 9 novembre · mis à jour il y a 5 s » (actualisé chaque seconde). */
  function majDateTableau() {
    const el = $('#maj-tableau');
    if (!el || !majDateTableau.le) return;
    const jour = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    el.textContent = `${jour.charAt(0).toUpperCase()}${jour.slice(1)} · mis à jour ${ilYa(new Date(majDateTableau.le).toISOString())}`;
  }
  setInterval(majDateTableau, 1000);

  chargeurs.tableau = async () => {
    try {
      const [st, , al] = await Promise.all([
        api('GET', '/api/admin/statistiques'),
        chargerCannes(),
        api('GET', '/api/admin/alertes?limite=3'),
      ]);
      donnees.stats = st;
      const actives = st.cannes - st.cannesDesactivees;
      const kpis = [
        { libelle: 'Cannes en ligne', valeur: `${st.cannesEnLigne} <small>/ ${actives}</small>`, classeDetail: 'ok',
          detail: st.cannesNonAttribuees ? `${st.cannesNonAttribuees} en attente d'attribution` : 'toutes attribuées' },
        { libelle: 'Alertes à traiter', valeur: st.alertesNonTraitees, classe: st.alertesNonTraitees ? 'crit' : '',
          classeDetail: st.sosNonTraites ? 'crit' : '',
          detail: st.sosNonTraites ? `dont ${st.sosNonTraites} SOS` : `${st.alertes24h} sur 24 h` },
        { libelle: 'Proches inscrits', valeur: st.proches, detail: `${st.administrateurs} administrateur(s)` },
        { libelle: 'Batterie faible', valeur: st.cannesBatterieFaible, classe: st.cannesBatterieFaible ? 'avert' : '',
          detail: `sous ${st.seuilBatterieFaible} %` },
      ];
      $('#kpis').innerHTML = kpis.map((k) => `<div class="carte kpi ${k.classe || ''}"><span class="libelle">${k.libelle}</span>
        <span class="valeur">${k.valeur}</span><span class="detail ${k.classeDetail || ''}">${k.detail}</span></div>`).join('');
      majDateTableau.le = Date.now();
      majDateTableau();

      $('#alertes-recentes').innerHTML = al.alertes.length ? al.alertes.map(elementAlerte).join('') : '<p class="vide">Aucune alerte.</p>';

      $('#table-etat').innerHTML = donnees.cannes.length ? donnees.cannes.map((c) => {
        const p = principalDe(c);
        return `<tr>
          <td style="font-weight:600">${echapper(c.identifiant)}</td>
          <td>${c.proches.length ? echapper(c.nom) : '<span class="meta">Non attribuée</span>'}</td>
          <td>${pastilleTableau(c)}</td>
          <td>${batterieHtml(c.batterie)}</td>
          <td>${ilYa(c.derniereCommunication)}</td>
          <td>${p ? echapper(p.nom) : '<button class="lien" data-attribuer="' + c.id + '">Attribuer</button>'}</td></tr>`;
      }).join('') : '<tr><td colspan="6" class="vide">Aucune canne enregistrée.</td></tr>';

      $('#compteur-alertes').hidden = st.alertesNonTraitees === 0;
      $('#compteur-alertes').textContent = st.alertesNonTraitees;

      const m = await carte('carte-ensemble');
      if (m) {
        m.calque.clearLayers();
        const points = [];
        for (const c of donnees.cannes.filter((x) => x.dernierePosition)) {
          marqueurCanne(c).bindTooltip(`${echapper(c.nom)} · ${etatCanne(c)[0]}`).addTo(m.calque);
          points.push([c.dernierePosition.latitude, c.dernierePosition.longitude]);
        }
        if (points.length) m.fitBounds(points, { padding: [40, 40], maxZoom: 15 });
      }
    } catch (e) {
      toast(e.message, true);
    }
  };
  $('#table-etat').addEventListener('click', (e) => {
    const b = e.target.closest('[data-attribuer]');
    if (b) attribuer(canneParId(b.dataset.attribuer));
  });

  // ===========================================================================
  // Cartographie (inspiration Traccar : liste à gauche, carte à droite, fiche)
  // ===========================================================================
  const carto = { filtre: 'toutes', recherche: '', selection: null };

  function cannesCartoFiltrees() {
    const q = carto.recherche.toLowerCase();
    return donnees.cannes.filter((c) => {
      if (q && !`${c.nom} ${c.identifiant}`.toLowerCase().includes(q)) return false;
      if (carto.filtre === 'en-ligne') return c.active && c.enLigne;
      if (carto.filtre === 'hors-ligne') return !(c.active && c.enLigne);
      return true;
    });
  }

  function dessinerListeCarto() {
    const liste = cannesCartoFiltrees();
    const enLigne = donnees.cannes.filter((c) => c.active && c.enLigne).length;
    const comptes = { toutes: donnees.cannes.length, 'en-ligne': enLigne, 'hors-ligne': donnees.cannes.length - enLigne };
    $$('#filtres-carto [data-compte]').forEach((el) => { el.textContent = comptes[el.dataset.compte]; });
    $('#liste-carto').innerHTML = liste.length ? liste.map((c) => {
      const [libelle, classe, marqueur] = etatCanne(c);
      const enStock = !c.proches.length && !c.derniereCommunication;
      const etiquette = enStock ? 'En stock' : classe === 'ok' ? '● En ligne' : classe === 'avert' ? '○ Hors ligne' : libelle;
      return `<button class="ligne-canne" data-id="${c.id}" aria-pressed="${c.id === carto.selection}">
        <span class="avatar grand ${marqueur ? 'gris' : ''} ${c.proches.length ? '' : 'inconnu'}" style="width:44px;height:44px;font-size:14px">${c.proches.length ? echapper(initiales(c.nom)) : '—'}</span>
        <span class="infos"><strong>${echapper(c.proches.length ? c.nom : 'Nouvelle canne')}</strong>
          <span class="meta">${echapper(c.identifiant)} · ${c.proches.length ? ilYa(c.derniereCommunication) : 'non attribuée'}</span></span>
        <span class="etat"><span class="${enStock ? 'neutre' : classe}">${etiquette}</span>${c.batterie != null && !enStock ? `<span style="color:${c.batterie < (donnees.stats?.seuilBatterieFaible ?? 20) ? 'var(--crit)' : 'var(--encre)'};font-weight:600">${c.batterie} %</span>` : ''}</span>
      </button>`;
    }).join('') : '<p class="vide">Aucune canne.</p>';
  }

  async function dessinerCarto({ recentrer = false } = {}) {
    dessinerListeCarto();
    const m = await carte('carte-principale');
    const c = carto.selection ? canneParId(carto.selection) : null;
    dessinerFiche(c);
    // Nombre de zones de la canne sélectionnée (bouton « Zones (3) » de la fiche).
    if (c && carto.nbZones == null) {
      api('GET', `/api/cannes/${c.id}/zones`).then(({ zones }) => {
        if (carto.selection === c.id) { carto.nbZones = zones.length; dessinerFiche(c); }
      }).catch(() => {});
    }
    if (!m) return;
    m.calque.clearLayers();
    const points = [];
    for (const x of cannesCartoFiltrees().filter((k) => k.dernierePosition)) {
      const mk = marqueurCanne(x, { grand: x.id === carto.selection });
      mk.on('click', () => selectionnerCarto(x.id));
      mk.addTo(m.calque);
      points.push([x.dernierePosition.latitude, x.dernierePosition.longitude]);
    }
    if (c) {
      try {
        const { zones } = await api('GET', `/api/cannes/${c.id}/zones`);
        zones.forEach((z) => cercleZone(z).addTo(m.calque));
        if (carto.nbZones !== zones.length) { carto.nbZones = zones.length; dessinerFiche(c); }
      } catch { /* zones indisponibles */ }
      if (recentrer && c.dernierePosition) m.setView([c.dernierePosition.latitude, c.dernierePosition.longitude], 16);
    } else if (recentrer && points.length) {
      m.fitBounds(points, { padding: [60, 60], maxZoom: 15 });
    }
  }

  function dessinerFiche(c) {
    const fiche = $('#fiche-canne');
    if (!c) { fiche.hidden = true; return; }
    const p = c.dernierePosition;
    const [libelle, classe, marqueur] = etatCanne(c);
    const direct = c.active && c.enLigne;
    fiche.hidden = false;
    fiche.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px">
        <span class="avatar grand ${marqueur ? 'gris' : ''}">${echapper(initiales(c.nom))}</span>
        <div style="flex:1;min-width:0"><h2 style="font-size:18px">${echapper(c.nom)}</h2>
          <div class="meta">${echapper(c.identifiant)} · suivie par ${c.proches.length} proche${c.proches.length > 1 ? 's' : ''}</div></div>
        <span class="badge ${classe}">${direct ? 'En direct' : libelle}</span>
      </div>
      ${p && !direct ? `<div class="avert-position">Dernière position connue (${ilYa(p.horodatage)}) : ce n'est pas une position en direct.</div>` : ''}
      <dl>
        <div><dt>Dernier signal</dt><dd>${c.derniereCommunication ? `${new Date(c.derniereCommunication).toLocaleTimeString('fr-FR')} (${ilYa(c.derniereCommunication)})` : 'jamais'}</dd></div>
        <div><dt>Batterie</dt><dd>${c.batterie == null ? '—' : c.batterie + ' %'}</dd></div>
        <div><dt>Coordonnées</dt><dd>${p ? `${p.latitude.toFixed(4).replace('.', ',')} · ${p.longitude.toFixed(4).replace('.', ',')}` : '—'}</dd></div>
        <div><dt>Précision</dt><dd>${p?.precision ? '± ' + Math.round(p.precision) + ' m' : '—'}</dd></div>
      </dl>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="bouton primaire petit" data-fiche="historique" style="min-height:40px">Historique</button>
        <button class="bouton petit" data-fiche="zones" style="min-height:40px">Zones${carto.nbZones != null ? ` (${carto.nbZones})` : ''}</button>
        <button class="bouton petit" data-fiche="proches" style="min-height:40px">Proches</button>
      </div>`;
  }

  function selectionnerCarto(id) {
    // Toucher de nouveau la canne sélectionnée ferme sa fiche.
    carto.selection = carto.selection === id ? null : id;
    carto.nbZones = null;
    dessinerCarto({ recentrer: true });
  }

  $('#liste-carto').addEventListener('click', (e) => {
    const b = e.target.closest('.ligne-canne');
    if (b) selectionnerCarto(b.dataset.id);
  });
  $('#fiche-canne').addEventListener('click', (e) => {
    const quoi = e.target.closest('[data-fiche]')?.dataset.fiche;
    const c = canneParId(carto.selection);
    if (!quoi || !c) return;
    if (quoi === 'historique') { $('#hist-canne').dataset.voulue = c.id; ouvrirOnglet('historique'); }
    if (quoi === 'zones') { $('#zones-canne').dataset.voulue = c.id; ouvrirOnglet('zones'); }
    if (quoi === 'proches') {
      dialogue({
        titre: `Proches de ${c.nom}`,
        texte: c.proches.length ? c.proches.map((p) => `<strong>${echapper(p.nom)}</strong> · ${echapper(p.telephone)}${p.principal ? ' · principal' : ''}${p.consentement ? '' : ' · consentement en attente'}`).join('<br>') : 'Aucun proche ne suit cette canne.',
        libelleValider: 'Fermer', sansAnnuler: true,
      });
    }
  });
  $('#recherche-carto').addEventListener('input', (e) => { carto.recherche = e.target.value; dessinerCarto(); });
  puces($('#filtres-carto'), (f) => { carto.filtre = f; dessinerCarto({ recentrer: true }); });

  chargeurs.cartographie = async () => {
    try {
      await chargerCannes();
      // Première ouverture : fiche de la première canne en ligne, comme sur la maquette.
      if (!carto.initialisee) {
        carto.initialisee = true;
        const premiere = donnees.cannes.find((c) => c.active && c.enLigne && c.dernierePosition);
        if (premiere) carto.selection = premiere.id;
      }
      await dessinerCarto({ recentrer: true });
    } catch (e) {
      toast(e.message, true);
    }
  };

  // ===========================================================================
  // Cannes
  // ===========================================================================
  let rechercheCannes = '';

  chargeurs.cannes = async () => {
    try {
      await chargerCannes();
    } catch (e) {
      return toast(e.message, true);
    }
    const q = rechercheCannes.toLowerCase();
    const liste = donnees.cannes.filter((c) => !q || `${c.nom} ${c.identifiant} ${c.telephonePersonne || ''}`.toLowerCase().includes(q));
    $('#table-cannes').innerHTML = liste.length ? liste.map((c) => `<tr data-id="${c.id}">
        <td style="white-space:nowrap"><strong>${echapper(c.identifiant)}</strong> ${c.demo ? '<span class="badge neutre">démo</span>' : ''}
          <div class="meta">${echapper(c.nom)}</div>${c.telephonePersonne ? `<div class="meta">${echapper(c.telephonePersonne)}</div>` : ''}
          <div style="margin-top:4px">${badgeDispositif(c)}</div></td>
        <td style="white-space:nowrap">${pastilleEtat(c)}<div class="meta">${ilYa(c.derniereCommunication)}</div>
          <div class="meta">${c.partageAutorise ? 'Partage autorisé' : 'Un seul compte'}</div></td>
        <td>${batterieHtml(c.batterie)}</td>
        <td><div class="proches">${c.proches.length ? c.proches.map((p) =>
          `<span class="badge ${p.principal ? '' : 'neutre'}" title="${p.consentement ? 'Consentement donné' : 'Consentement en attente'}">${echapper(p.nom)}${p.principal ? ' · principal' : ''}
            <button class="bouton discret petit lien-danger" style="min-height:20px;padding:0 4px" data-retirer="${p.id}" aria-label="Retirer ${echapper(p.nom)}">✕</button></span>`).join('')
          : '<span class="meta">Aucun</span>'}</div></td>
        <td><span class="secret">${echapper(c.codeAppairage)}</span></td>
        <td><div class="actions-ligne">
          <button class="bouton petit primaire" data-action="appareil" title="Brancher un téléphone de test ou la canne">Appareil</button>
          <button class="bouton petit" data-action="modifier">Modifier</button>
          <button class="bouton petit" data-action="attribuer" title="Attribuer à un proche">Attribuer</button>
          <button class="bouton petit" data-action="regenerer" title="Régénérer le code ou la clé">Codes</button>
          <button class="bouton petit lien-danger" data-action="supprimer" aria-label="Supprimer ${echapper(c.identifiant)}" title="Supprimer">✕</button>
        </div></td></tr>`).join('') : '<tr><td colspan="6" class="vide">Aucune canne.</td></tr>';
  };
  $('#recherche-cannes').addEventListener('input', (e) => { rechercheCannes = e.target.value; chargeurs.cannes(); });

  function rechargerVueCourante() {
    chargeurs[ongletActif]?.();
    majCompteurAlertes();
  }

  async function attribuer(canne) {
    await chargerUtilisateurs().catch((ex) => toast(ex.message, true));
    const libres = donnees.utilisateurs.filter((u) => u.actif && u.role === 'proche' && !canne.proches.some((p) => p.id === u.id));
    if (!libres.length) return toast('Aucun proche disponible : créez d\'abord un compte dans « Utilisateurs ».', true);
    dialogue({
      titre: `Attribuer ${canne.identifiant} à un proche`,
      texte: 'L\'attribution par l\'administrateur ne dépend pas du réglage de partage.',
      champs: [
        { nom: 'utilisateurId', libelle: 'Proche', type: 'select', options: libres.map((u) => [u.id, `${u.nom} (${u.telephone})`]) },
        { nom: 'principal', libelle: 'Proche principal (peut modifier la canne et autoriser le partage)', type: 'checkbox', valeur: !canne.proches.length },
      ],
      libelleValider: 'Attribuer',
      surValider: async (v) => {
        await api('POST', `/api/admin/cannes/${canne.id}/proches`, { utilisateurId: Number(v.utilisateurId), principal: v.principal });
        toast('Canne attribuée.');
        rechargerVueCourante();
      },
    });
  }

  $('#table-cannes').addEventListener('click', async (e) => {
    const ligne = e.target.closest('tr[data-id]');
    if (!ligne) return;
    const canne = canneParId(ligne.dataset.id);
    const retirer = e.target.closest('[data-retirer]');
    if (retirer) {
      const proche = canne.proches.find((p) => String(p.id) === retirer.dataset.retirer);
      return dialogue({
        titre: 'Retirer ce proche ?',
        texte: `${echapper(proche.nom)} ne pourra plus suivre la canne de ${echapper(canne.nom)}.`,
        libelleValider: 'Retirer', danger: true,
        surValider: async () => {
          await api('DELETE', `/api/admin/cannes/${canne.id}/proches/${proche.id}`);
          toast('Proche retiré.');
          chargeurs.cannes();
        },
      });
    }
    const quoi = e.target.closest('[data-action]')?.dataset.action;
    if (quoi === 'modifier') {
      dialogue({
        titre: `Modifier ${canne.identifiant}`,
        champs: [
          { nom: 'nom', libelle: 'Nom de la personne malvoyante', valeur: canne.nom, requis: true },
          { nom: 'telephonePersonne', libelle: 'Téléphone de la personne (reçoit le SMS d\'information)', type: 'tel', valeur: canne.telephonePersonne || '' },
          { nom: 'partageAutorise', libelle: 'Autoriser plusieurs proches à s\'associer avec le code', type: 'checkbox', valeur: canne.partageAutorise },
          { nom: 'active', libelle: 'Canne active (décocher si perdue ou hors service)', type: 'checkbox', valeur: canne.active },
        ],
        surValider: async (v) => {
          await api('PUT', `/api/admin/cannes/${canne.id}`, {
            nom: v.nom, partageAutorise: v.partageAutorise, active: v.active,
            ...(v.telephonePersonne ? { telephonePersonne: v.telephonePersonne } : {}),
          });
          toast('Canne modifiée.');
          chargeurs.cannes();
        },
      });
    } else if (quoi === 'attribuer') {
      attribuer(canne);
    } else if (quoi === 'appareil') {
      brancherAppareil(canne);
    } else if (quoi === 'regenerer') {
      dialogue({
        titre: 'Régénérer les secrets',
        texte: 'Le nouveau code d\'association remplace l\'ancien (à réimprimer sur l\'étiquette). Une nouvelle clé de boîtier déconnecte la canne jusqu\'à sa reprogrammation.',
        champs: [
          { nom: 'code', libelle: 'Nouveau code d\'association', type: 'checkbox', valeur: true },
          { nom: 'cle', libelle: 'Nouvelle clé de boîtier', type: 'checkbox', valeur: false },
        ],
        libelleValider: 'Régénérer',
        surValider: async (v) => {
          const r = await api('POST', `/api/admin/cannes/${canne.id}/regenerer`, v);
          toast(`Secrets régénérés. Code d'association : ${r.canne.codeAppairage}`);
          chargeurs.cannes();
        },
      });
    } else if (quoi === 'supprimer') {
      dialogue({
        titre: 'Supprimer cette canne ?',
        texte: `<strong>${echapper(canne.nom)}</strong> (${echapper(canne.identifiant)}) sera supprimée avec son historique, ses zones et ses alertes. Pour une canne perdue, préférez « Modifier » puis la désactiver.`,
        libelleValider: 'Supprimer définitivement', danger: true,
        surValider: async () => {
          await api('DELETE', `/api/admin/cannes/${canne.id}`);
          toast('Canne supprimée.');
          chargeurs.cannes();
        },
      });
    }
  });

  /** Lien d'activation à ouvrir sur le téléphone de test (pré-remplit le formulaire). */
  const lienActivation = (c) => `${location.origin}/canne/?id=${encodeURIComponent(c.identifiant)}&code=${encodeURIComponent(c.codeActivation)}`;
  const champCopie = (libelle, valeur, { grand = false } = {}) => `
    <div style="display:flex;flex-direction:column;gap:6px">
      <span style="font-weight:600;font-size:13px">${libelle}</span>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="secret" style="flex:1;word-break:break-all;padding:8px 10px;${grand ? 'font-size:20px;font-weight:700;letter-spacing:.08em' : ''}">${echapper(valeur)}</span>
        <button type="button" class="bouton petit" data-copier="${echapper(valeur)}">Copier</button>
      </div>
    </div>`;

  function brancherAppareil(c) {
    const actif = c.dispositifActiveLe ? `Dernière activation : ${dateHeure(c.dispositifActiveLe)}. ` : '';
    dialogue({
      titre: `Brancher un appareil sur ${c.identifiant}`,
      texte: `
        <span style="display:block;margin-bottom:12px">Appareil actuel : ${badgeDispositif(c)} · ${actif}Dernier signal : ${ilYa(c.derniereCommunication)}.</span>
        <div style="background:var(--primaire-doux);border-radius:12px;padding:10px 12px;margin-bottom:16px;color:var(--primaire-fonce)">
          <strong>Pour le proche (application mobile)</strong> : Cane ID <span class="secret">${echapper(c.identifiant)}</span>
          et code d'association <span class="secret">${echapper(c.codeAppairage)}</span>.
        </div>
        <strong style="color:var(--encre)">1. Téléphone de test (page « Canne virtuelle »)</strong><br>
        Ouvrez ce lien sur le téléphone qui jouera la canne (HTTPS obligatoire hors de ce PC), puis « Activer ».
        <div style="display:flex;flex-direction:column;gap:10px;margin:10px 0 18px">
          ${champCopie('Identifiant de la canne (Cane ID)', c.identifiant)}
          ${champCopie('Code d\'activation', c.codeActivation, { grand: true })}
          ${champCopie('Lien d\'activation direct', lienActivation(c))}
          <a class="bouton petit" href="${echapper(lienActivation(c))}" target="_blank" rel="noopener" style="align-self:flex-start;text-decoration:none">Ouvrir la canne virtuelle</a>
        </div>
        <strong style="color:var(--encre)">2. Émission écran éteint : Traccar Client (Android / iOS)</strong><br>
        Dans l'application gratuite Traccar Client, renseignez :
        <div style="display:flex;flex-direction:column;gap:10px;margin:10px 0 18px">
          ${champCopie('URL du serveur', `${location.origin}/api/dispositif/osmand`)}
          ${champCopie('Identifiant de l\'appareil (clé secrète)', c.cleDispositif)}
          <span class="aide">Fréquence 5 s, précision « haute ». Puis activez le service de suivi.</span>
        </div>
        <strong style="color:var(--encre)">3. Vraie canne (plus tard)</strong><br>
        Programmez la clé secrète ci-dessus dans le boîtier : il appelle <code>/api/dispositif/positions</code>
        avec l'en-tête <code>X-Cle-Dispositif</code>. Rien d'autre ne change.`,
      champs: [{ nom: 'regenerer', libelle: 'Générer un nouveau code d\'activation (l\'ancien ne fonctionnera plus)', type: 'checkbox', valeur: false }],
      libelleValider: 'Fermer',
      surValider: async (v) => {
        if (!v.regenerer) return;
        const r = await api('POST', `/api/admin/cannes/${c.id}/regenerer`, { activation: true, code: false });
        toast(`Nouveau code d'activation : ${r.canne.codeActivation}`);
        rechargerVueCourante();
      },
    });
  }

  $('#dialogue-corps').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copier]');
    if (!b) return;
    try {
      await navigator.clipboard.writeText(b.dataset.copier);
      b.textContent = 'Copié';
      setTimeout(() => { b.textContent = 'Copier'; }, 1500);
    } catch {
      toast('Copie impossible : sélectionnez le texte à la main.', true);
    }
  });

  function nouvelleCanne() {
    const numero = donnees.cannes.length + 1;
    dialogue({
      titre: 'Enregistrer une canne',
      texte: 'Une clé secrète de boîtier et un code d\'association à 6 chiffres sont générés. Imprimez l\'identifiant et le code sur l\'étiquette remise avec la canne.',
      champs: [
        { nom: 'identifiant', libelle: 'Identifiant (numéro de série)', valeur: `CANNE-${String(numero).padStart(4, '0')}`, requis: true },
        { nom: 'nom', libelle: 'Nom de la personne (modifiable à l\'association)', valeur: 'Nouvelle canne', requis: true },
        { nom: 'telephonePersonne', libelle: 'Téléphone de la personne (facultatif)', type: 'tel' },
        { nom: 'partageAutorise', libelle: 'Autoriser plusieurs proches', type: 'checkbox', valeur: false },
      ],
      libelleValider: 'Enregistrer',
      surValider: async (v) => {
        const r = await api('POST', '/api/admin/cannes', {
          identifiant: v.identifiant, nom: v.nom, partageAutorise: v.partageAutorise,
          ...(v.telephonePersonne ? { telephonePersonne: v.telephonePersonne } : {}),
        });
        rechargerVueCourante();
        await chargerCannes();
        setTimeout(() => {
          toast(`Canne ${r.canne.identifiant} enregistrée. Code d'association des proches : ${r.canne.codeAppairage}`);
          brancherAppareil(canneParId(r.canne.id) || r.canne);
        }, 50);
      },
    });
  }

  // ===========================================================================
  // Utilisateurs (proches) et administrateurs
  // ===========================================================================
  function ligneCompte(u, { avecCannes }) {
    const moi = u.id === donnees.moi?.id;
    return `<tr data-id="${u.id}">
      <td><div style="display:flex;align-items:center;gap:10px"><span class="avatar ${u.actif ? '' : 'gris'}">${echapper(initiales(u.nom))}</span>
        <div><strong>${echapper(u.nom)}</strong> ${u.demo ? '<span class="badge neutre">démo</span>' : ''}${moi ? ' <span class="badge">vous</span>' : ''}</div></div></td>
      <td>${echapper(u.telephone)}</td>
      ${avecCannes ? `<td>${u.nombreCannes}</td>` : ''}
      <td>${u.actif ? '<span class="badge ok">Actif</span>' : '<span class="badge crit">Désactivé</span>'}</td>
      <td>${date(u.creeLe)}</td>
      <td><div class="actions-ligne">
        <button class="bouton petit" data-action="modifier">Modifier</button>
        <button class="bouton petit" data-action="mdp">Mot de passe</button>
        <button class="bouton petit" data-action="etat" ${moi ? 'disabled' : ''}>${u.actif ? 'Désactiver' : 'Réactiver'}</button>
        <button class="bouton petit lien-danger" data-action="supprimer" ${moi ? 'disabled' : ''}>Supprimer</button>
      </div></td></tr>`;
  }

  chargeurs.utilisateurs = async () => {
    try { await chargerUtilisateurs(); } catch (e) { return toast(e.message, true); }
    const proches = donnees.utilisateurs.filter((u) => u.role === 'proche');
    $('#table-utilisateurs').innerHTML = proches.length ? proches.map((u) => ligneCompte(u, { avecCannes: true })).join('')
      : '<tr><td colspan="6" class="vide">Aucun proche inscrit.</td></tr>';
  };
  chargeurs.administrateurs = async () => {
    try { await chargerUtilisateurs(); } catch (e) { return toast(e.message, true); }
    const admins = donnees.utilisateurs.filter((u) => u.role === 'admin');
    $('#table-admins').innerHTML = admins.map((u) => ligneCompte(u, { avecCannes: false })).join('');
  };

  function surActionCompte(e) {
    const ligne = e.target.closest('tr[data-id]');
    const quoi = e.target.closest('[data-action]')?.dataset.action;
    if (!ligne || !quoi) return;
    const u = donnees.utilisateurs.find((x) => String(x.id) === ligne.dataset.id);
    const recharger = () => chargeurs[ongletActif]();
    if (quoi === 'modifier') {
      dialogue({
        titre: `Modifier ${u.nom}`,
        champs: [
          { nom: 'nom', libelle: 'Nom', valeur: u.nom, requis: true },
          { nom: 'role', libelle: 'Rôle', type: 'select', valeur: u.role, options: [['proche', 'Proche aidant'], ['admin', 'Administrateur']] },
        ],
        surValider: async (v) => { await api('PUT', `/api/admin/utilisateurs/${u.id}`, v); toast('Compte modifié.'); recharger(); },
      });
    } else if (quoi === 'mdp') {
      dialogue({
        titre: `Nouveau mot de passe pour ${u.nom}`,
        champs: [{ nom: 'motDePasse', libelle: 'Mot de passe (8 caractères minimum)', type: 'text', requis: true }],
        surValider: async (v) => { await api('PUT', `/api/admin/utilisateurs/${u.id}`, v); toast('Mot de passe modifié.'); },
      });
    } else if (quoi === 'etat') {
      dialogue({
        titre: u.actif ? 'Désactiver ce compte ?' : 'Réactiver ce compte ?',
        texte: u.actif ? `${echapper(u.nom)} sera déconnecté immédiatement et ne recevra plus d'alertes.` : `${echapper(u.nom)} pourra de nouveau se connecter.`,
        libelleValider: u.actif ? 'Désactiver' : 'Réactiver', danger: u.actif,
        surValider: async () => { await api('PUT', `/api/admin/utilisateurs/${u.id}`, { actif: !u.actif }); toast('État du compte modifié.'); recharger(); },
      });
    } else if (quoi === 'supprimer') {
      dialogue({
        titre: 'Supprimer ce compte ?',
        texte: `Le compte de <strong>${echapper(u.nom)}</strong> sera supprimé définitivement, ainsi que ses associations.`,
        libelleValider: 'Supprimer', danger: true,
        surValider: async () => { await api('DELETE', `/api/admin/utilisateurs/${u.id}`); toast('Compte supprimé.'); recharger(); },
      });
    }
  }
  $('#table-utilisateurs').addEventListener('click', surActionCompte);
  $('#table-admins').addEventListener('click', surActionCompte);

  function nouveauCompte(role) {
    dialogue({
      titre: role === 'admin' ? 'Ajouter un administrateur' : 'Créer un compte proche',
      champs: [
        { nom: 'nom', libelle: 'Nom', requis: true },
        { nom: 'telephone', libelle: 'Téléphone (identifiant de connexion)', type: 'tel', requis: true },
        { nom: 'motDePasse', libelle: 'Mot de passe provisoire (8 caractères min.)', type: 'text', requis: true },
      ],
      libelleValider: 'Créer',
      surValider: async (v) => {
        await api('POST', '/api/admin/utilisateurs', { ...v, role });
        toast('Compte créé.');
        chargeurs[ongletActif]?.();
      },
    });
  }

  // ===========================================================================
  // Sélecteur de canne réutilisable (zones, historique)
  // ===========================================================================
  async function remplirSelecteur(select) {
    if (!donnees.cannes.length) await chargerCannes();
    const avant = select.dataset.voulue || select.value;
    delete select.dataset.voulue;
    select.innerHTML = donnees.cannes.map((c) => `<option value="${c.id}">${echapper(c.nom)} · ${echapper(c.identifiant)}</option>`).join('');
    if (avant && donnees.cannes.some((c) => c.id === avant)) select.value = avant;
    return select.value;
  }

  // ===========================================================================
  // Zones dangereuses
  // ===========================================================================
  let zonesCourantes = [];

  chargeurs.zones = async () => {
    try {
      const id = await remplirSelecteur($('#zones-canne'));
      if (!id) {
        $('#liste-zones').innerHTML = '<p class="vide">Aucune canne enregistrée.</p>';
        return;
      }
      zonesCourantes = (await api('GET', `/api/cannes/${id}/zones`)).zones;
      const c = canneParId(id);
      const actives = zonesCourantes.filter((z) => z.actif).length;
      $('#zones-titre').textContent = `Zones de ${c.nom} · ${actives} active${actives > 1 ? 's' : ''} sur ${zonesCourantes.length}`;
      $('#liste-zones').innerHTML = zonesCourantes.length ? zonesCourantes.map((z) => `
        <div class="zone-ligne" data-zone="${z.id}">
          <span class="avatar" style="border-radius:12px;background:${z.actif ? 'var(--crit-fond)' : 'var(--neutre-fond)'};color:${z.actif ? 'var(--crit)' : 'var(--texte-2)'}">${icone('triangle')}</span>
          <div class="infos"><strong>${echapper(z.nom)}</strong><div class="meta">Rayon ${Math.round(z.rayon)} m${z.actif ? '' : ' · désactivée'}</div></div>
          <label class="interrupteur" title="Activer ou désactiver"><input type="checkbox" data-basculer ${z.actif ? 'checked' : ''} aria-label="Zone ${echapper(z.nom)} active"><span></span></label>
          <div class="actions-zone">
            <button class="bouton petit" data-modifier-zone>Modifier</button>
            <button class="bouton petit lien-danger" data-supprimer-zone>Supprimer</button>
          </div>
        </div>`).join('') : '<p class="vide">Aucune zone. Touchez la carte pour en créer une.</p>';

      const m = await carte('carte-zones', { surClic: creerZone });
      if (m) {
        m.calque.clearLayers();
        const points = [];
        zonesCourantes.forEach((z) => { cercleZone(z).addTo(m.calque); points.push([z.latitude, z.longitude]); });
        if (c.dernierePosition) {
          marqueurCanne(c).addTo(m.calque);
          points.push([c.dernierePosition.latitude, c.dernierePosition.longitude]);
        }
        // Cadre sur les cercles entiers (pas seulement leurs centres).
        const limites = L.latLngBounds(points);
        zonesCourantes.forEach((z) => limites.extend(L.latLng(z.latitude, z.longitude).toBounds(z.rayon * 2)));
        if (limites.isValid()) m.fitBounds(limites, { padding: [40, 40], maxZoom: 16 });
      }
    } catch (e) {
      toast(e.message, true);
    }
  };
  $('#zones-canne').addEventListener('change', () => chargeurs.zones());

  function creerZone(latlng) {
    const id = $('#zones-canne').value;
    if (!id) return;
    dialogue({
      titre: 'Nouvelle zone dangereuse',
      texte: `Centre : ${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`,
      champs: [
        { nom: 'nom', libelle: 'Nom de la zone', requis: true },
        { nom: 'rayon', libelle: 'Rayon en mètres (10 à 5000)', type: 'number', valeur: 100, min: 10, max: 5000, requis: true },
      ],
      libelleValider: 'Créer la zone',
      surValider: async (v) => {
        await api('POST', `/api/cannes/${id}/zones`, { nom: v.nom, rayon: Number(v.rayon), latitude: latlng.lat, longitude: latlng.lng, actif: true });
        toast('Zone créée.');
        chargeurs.zones();
      },
    });
  }

  $('#liste-zones').addEventListener('click', (e) => {
    const ligne = e.target.closest('[data-zone]');
    if (!ligne) return;
    const z = zonesCourantes.find((x) => x.id === ligne.dataset.zone);
    const id = $('#zones-canne').value;
    if (e.target.closest('[data-modifier-zone]')) {
      dialogue({
        titre: `Modifier « ${z.nom} »`,
        champs: [
          { nom: 'nom', libelle: 'Nom', valeur: z.nom, requis: true },
          { nom: 'rayon', libelle: 'Rayon en mètres', type: 'number', valeur: Math.round(z.rayon), min: 10, max: 5000, requis: true },
        ],
        surValider: async (v) => {
          await api('PUT', `/api/cannes/${id}/zones/${z.id}`, { nom: v.nom, rayon: Number(v.rayon) });
          toast('Zone modifiée.');
          chargeurs.zones();
        },
      });
    } else if (e.target.closest('[data-supprimer-zone]')) {
      dialogue({
        titre: 'Supprimer cette zone ?', texte: `« ${echapper(z.nom)} » ne déclenchera plus d'alerte.`,
        libelleValider: 'Supprimer', danger: true,
        surValider: async () => { await api('DELETE', `/api/cannes/${id}/zones/${z.id}`); toast('Zone supprimée.'); chargeurs.zones(); },
      });
    }
  });
  $('#liste-zones').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-basculer]');
    if (!cb) return;
    const z = zonesCourantes.find((x) => x.id === cb.closest('[data-zone]').dataset.zone);
    action(null, async () => {
      await api('PUT', `/api/cannes/${$('#zones-canne').value}/zones/${z.id}`, { actif: cb.checked });
      chargeurs.zones();
    }, cb.checked ? 'Zone activée.' : 'Zone désactivée.');
  });

  // ===========================================================================
  // Historique
  // ===========================================================================
  /** Découpe les positions en trajets (déplacement > 60 m) et arrêts ; coupure si > 10 min sans point. */
  function decouper(positions) {
    const segments = [];
    let courant = [];
    const fermer = () => {
      if (courant.length > 1) {
        let d = 0;
        for (let i = 1; i < courant.length; i++) d += distanceM(courant[i - 1], courant[i]);
        segments.push({ debut: courant[0].horodatage, fin: courant[courant.length - 1].horodatage, distance: d, points: courant, trajet: d > 60 });
      }
      courant = [];
    };
    for (const p of positions) {
      const prec = courant[courant.length - 1];
      if (prec && new Date(p.horodatage) - new Date(prec.horodatage) > 10 * 60000) fermer();
      courant.push(p);
    }
    fermer();
    return segments;
  }

  chargeurs.historique = async () => {
    const champJour = $('#hist-jour');
    try {
      const id = await remplirSelecteur($('#hist-canne'));
      if (!id) return;
      // Par défaut : le jour de la dernière position connue (AAAA-MM-JJ en heure locale).
      if (!champJour.value) {
        const derniere = canneParId(id)?.dernierePosition?.horodatage;
        champJour.value = (derniere ? new Date(derniere) : new Date()).toLocaleDateString('sv-SE');
      }
      const jour = champJour.value;
      const [{ positions }, { alertes }] = await Promise.all([
        api('GET', `/api/cannes/${id}/historique?du=${jour}&au=${jour}`),
        api('GET', `/api/cannes/${id}/alertes?limite=300`),
      ]);
      const alertesJour = alertes.filter((a) => new Date(a.horodatage).toLocaleDateString('sv-SE') === jour);
      const segments = decouper(positions);
      const trajets = segments.filter((s) => s.trajet);
      const distance = trajets.reduce((t, s) => t + s.distance, 0);
      const duree = trajets.reduce((t, s) => t + (new Date(s.fin) - new Date(s.debut)), 0);
      $('#hist-resume').innerHTML = `<div><span>Trajets</span><strong>${trajets.length}</strong></div>
        <div><span>Distance</span><strong>${distanceLisible(distance)}</strong></div>
        <div><span>En marche</span><strong>${dureeLisible(duree)}</strong></div>`;

      const evenements = [
        ...segments.map((s) => ({ t: s.debut, html: s.trajet
          ? `<li class="trajet">${icone('carte')}<div><strong>Marche · ${distanceLisible(s.distance)} · ${dureeLisible(new Date(s.fin) - new Date(s.debut))}</strong><div class="meta">${heure(s.debut)} → ${heure(s.fin)}</div></div></li>`
          : `<li>${icone('horloge')}<div><strong>Arrêt · ${dureeLisible(new Date(s.fin) - new Date(s.debut))}</strong><div class="meta">${heure(s.debut)} → ${heure(s.fin)}</div></div></li>` })),
        ...alertesJour.map((a) => ({ t: a.horodatage, html: `<li style="background:${typeAlerte(a.type).classe === 'crit' ? 'var(--crit-fond)' : 'var(--avert-fond)'}">${icone('cloche')}<div><strong>${typeAlerte(a.type).libelle}${a.zoneNom ? ' · ' + echapper(a.zoneNom) : ''}</strong><div class="meta">${heure(a.horodatage)}</div></div></li>` })),
      ].sort((a, b) => new Date(b.t) - new Date(a.t));
      $('#hist-chrono').innerHTML = evenements.length ? evenements.map((x) => x.html).join('') : '<p class="vide">Aucun déplacement ce jour-là.</p>';

      const m = await carte('carte-historique');
      if (m) {
        m.calque.clearLayers();
        const tous = positions.map((p) => [p.latitude, p.longitude]);
        segments.forEach((s) => {
          L.polyline(s.points.map((p) => [p.latitude, p.longitude]), { color: s.trajet ? '#4338CA' : '#94A3B8', weight: s.trajet ? 5 : 3 }).addTo(m.calque);
        });
        alertesJour.filter((a) => a.latitude != null).forEach((a) => {
          L.circleMarker([a.latitude, a.longitude], { radius: 8, color: '#fff', weight: 2, fillColor: '#B91C1C', fillOpacity: 1 })
            .bindTooltip(`${typeAlerte(a.type).libelle} · ${heure(a.horodatage)}`).addTo(m.calque);
        });
        if (tous.length) m.fitBounds(tous, { padding: [40, 40], maxZoom: 17 });
      }
    } catch (e) {
      toast(e.message, true);
    }
  };
  $('#hist-canne').addEventListener('change', () => chargeurs.historique());
  $('#hist-jour').addEventListener('change', () => chargeurs.historique());

  // ===========================================================================
  // Alertes
  // ===========================================================================
  let filtreAlertes = 'a-traiter';

  chargeurs.alertes = async () => {
    try {
      const { alertes } = await api('GET', '/api/admin/alertes?limite=300');
      const liste = alertes.filter((a) => {
        if (filtreAlertes === 'a-traiter') return !a.traitee;
        if (filtreAlertes === 'urgentes') return a.type === 'sos' || a.type === 'chute';
        return true;
      });
      $('#table-alertes').innerHTML = liste.length ? liste.map((a) => {
        const t = typeAlerte(a.type);
        return `<tr data-id="${a.id}">
          <td><span class="badge ${t.classe}">${t.libelle}</span></td>
          <td><strong>${echapper(a.canneNom || '')}</strong></td>
          <td class="meta">${echapper(a.zoneNom || a.message || '')}</td>
          <td>${dateHeure(a.horodatage)}</td>
          <td>${a.traitee ? `<span class="badge ok">Traitée${a.traiteePar ? ' · ' + echapper(a.traiteePar) : ''}</span>` : '<span class="badge crit">À traiter</span>'}</td>
          <td><div class="actions-ligne">${a.traitee ? '' : '<button class="bouton petit" data-traiter>' + icone('check') + 'Marquer traitée</button>'}</div></td></tr>`;
      }).join('') : '<tr><td colspan="6" class="vide">Aucune alerte dans cette vue.</td></tr>';
    } catch (e) {
      toast(e.message, true);
    }
  };
  puces($('#filtres-alertes'), (f) => { filtreAlertes = f; chargeurs.alertes(); });
  $('#table-alertes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-traiter]');
    if (!b) return;
    const id = b.closest('tr').dataset.id;
    action(b, async () => {
      await api('PUT', `/api/alertes/${id}/traitee`);
      rechargerVueCourante();
    }, 'Alerte marquée comme traitée.');
  });

  // ===========================================================================
  // Maintenance
  // ===========================================================================
  chargeurs.maintenance = async () => {
    try {
      await chargerCannes();
      if (!donnees.stats) donnees.stats = await api('GET', '/api/admin/statistiques');
    } catch (e) {
      return toast(e.message, true);
    }
    const seuil = donnees.stats.seuilBatterieFaible;
    $('#grille-maintenance').innerHTML = donnees.cannes.map((c) => {
      const b = c.batterie;
      const faible = b != null && b < seuil;
      const silencieuse = c.active && c.derniereCommunication && !c.enLigne;
      const conseils = [];
      if (!c.active) conseils.push('Canne désactivée : ses positions sont refusées.');
      if (faible) conseils.push('Batterie faible : prévenir le proche pour une recharge.');
      if (silencieuse) conseils.push('Aucun signal récent : vérifier le réseau ou la batterie.');
      if (c.active && !c.derniereCommunication) conseils.push('Jamais connectée : programmer la clé du boîtier.');
      return `<article class="carte carte-maintenance ${faible || silencieuse ? 'alerte' : ''}" data-id="${c.id}">
        <div class="haut"><span class="avatar ${etatCanne(c)[2] ? 'gris' : ''}">${echapper(initiales(c.nom))}</span>
          <div class="infos"><strong>${echapper(c.identifiant)}</strong><div class="meta">${echapper(c.nom)}</div></div>${pastilleEtat(c)}</div>
        <div><div style="display:flex;justify-content:space-between" class="meta"><span>Batterie</span><strong style="color:${faible ? 'var(--crit)' : 'var(--encre)'}">${b == null ? '—' : b + ' %'}</strong></div>
          <div class="jauge-grande"><span style="width:${b ?? 0}%;background:${faible ? 'var(--crit)' : b != null && b < 40 ? '#EA580C' : '#16A34A'}"></span></div></div>
        <div class="meta">Dernier signal : <strong style="color:var(--encre)">${ilYa(c.derniereCommunication)}</strong></div>
        ${conseils.length ? `<div class="meta" style="color:var(--avert-texte)">${conseils.join('<br>')}</div>` : '<div class="meta" style="color:var(--ok-texte)">Aucun problème détecté.</div>'}
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="bouton petit" data-maint="etat">${c.active ? 'Mettre hors service' : 'Remettre en service'}</button>
          <button class="bouton petit" data-maint="cle">Nouvelle clé de boîtier</button>
        </div></article>`;
    }).join('') || '<p class="vide">Aucune canne.</p>';
  };
  $('#grille-maintenance').addEventListener('click', (e) => {
    const quoi = e.target.closest('[data-maint]')?.dataset.maint;
    if (!quoi) return;
    const c = canneParId(e.target.closest('[data-id]').dataset.id);
    if (quoi === 'etat') {
      dialogue({
        titre: c.active ? 'Mettre la canne hors service ?' : 'Remettre la canne en service ?',
        texte: c.active ? 'La canne ne pourra plus envoyer de positions ni être associée. Les proches la voient comme désactivée.' : 'La canne pourra de nouveau émettre et être associée.',
        libelleValider: c.active ? 'Mettre hors service' : 'Remettre en service', danger: c.active,
        surValider: async () => { await api('PUT', `/api/admin/cannes/${c.id}`, { active: !c.active }); toast('État de service modifié.'); chargeurs.maintenance(); },
      });
    } else if (quoi === 'cle') {
      dialogue({
        titre: 'Générer une nouvelle clé de boîtier ?',
        texte: 'L\'ancienne clé est révoquée immédiatement : la canne devra être reprogrammée.',
        libelleValider: 'Générer', danger: true,
        surValider: async () => {
          const r = await api('POST', `/api/admin/cannes/${c.id}/regenerer`, { cle: true, code: false });
          toast('Nouvelle clé générée.');
          setTimeout(() => dialogue({ titre: 'Nouvelle clé', texte: `<span class="secret" style="word-break:break-all">${echapper(r.canne.cleDispositif)}</span>`, libelleValider: 'Terminé', sansAnnuler: true }), 50);
          chargeurs.maintenance();
        },
      });
    }
  });

  // ===========================================================================
  // Journal (audit, SMS, notifications)
  // ===========================================================================
  let vueJournal = 'audit';

  chargeurs.journal = async () => {
    const vue = $('#vue-journal');
    try {
      if (vueJournal === 'audit') {
        const { journal } = await api('GET', '/api/admin/journal?limite=200');
        vue.innerHTML = `<table><thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Détails</th></tr></thead><tbody>${
          journal.length ? journal.map((j) => `<tr><td>${dateHeure(j.le)}</td><td>${echapper(j.utilisateur || 'système')}</td>
            <td><code>${echapper(j.action)}</code></td><td class="meta">${echapper(j.details || '')}</td></tr>`).join('')
            : '<tr><td colspan="4" class="vide">Journal vide.</td></tr>'}</tbody></table>`;
      } else if (vueJournal === 'sms') {
        const r = await api('GET', '/api/admin/sms');
        $('#mode-sms').textContent = r.modeReel ? '· réel' : '· simulé';
        vue.innerHTML = `<table><thead><tr><th>Date</th><th>Destinataire</th><th>Motif</th><th>Message</th></tr></thead><tbody>${
          r.sms.length ? r.sms.map((s) => `<tr><td>${dateHeure(s.le)}</td><td>${echapper(s.telephone)}</td><td><span class="badge neutre">${echapper(s.motif)}</span></td>
            <td class="meta">${echapper(s.message)}${s.erreur ? ` <span class="badge crit">${echapper(s.erreur)}</span>` : ''}</td></tr>`).join('')
            : '<tr><td colspan="4" class="vide">Aucun SMS depuis le démarrage du serveur.</td></tr>'}</tbody></table>`;
      } else {
        const r = await api('GET', '/api/admin/notifications');
        $('#mode-push').textContent = r.modeReel ? '· Firebase' : '· simulé';
        vue.innerHTML = `<table><thead><tr><th>Date</th><th>Titre</th><th>Message</th><th>Destinataires</th></tr></thead><tbody>${
          r.notifications.length ? r.notifications.map((n) => `<tr><td>${dateHeure(n.le)}</td><td><strong>${echapper(n.titre)}</strong></td>
            <td class="meta">${echapper(n.corps)}</td><td>${n.destinataires.length}</td></tr>`).join('')
            : '<tr><td colspan="4" class="vide">Aucune notification depuis le démarrage du serveur.</td></tr>'}</tbody></table>`;
      }
    } catch (e) {
      toast(e.message, true);
    }
  };
  puces($('#onglets-journal'), (v) => { vueJournal = v; chargeurs.journal(); });

  // ===========================================================================
  // Simulateur de canne (appelle la vraie API « dispositif »)
  // ===========================================================================
  const simulation = {
    canne: null, position: null, depart: null, batterie: 100, zones: [], minuteur: null, carte: null, marqueur: null,

    journaliser(texte, alerte = false) {
      const el = document.createElement('div');
      if (alerte) el.className = 'alerte';
      el.textContent = `${new Date().toLocaleTimeString('fr-FR')}  ${texte}`;
      const j = $('#sim-journal');
      j.prepend(el);
      while (j.children.length > 150) j.lastChild.remove();
    },

    async appelDispositif(chemin, corps) {
      return api('POST', `/api/dispositif/${chemin}`, corps, {
        'X-Cle-Dispositif': this.canne.cleDispositif,
        'X-Source-Dispositif': 'simulateur',
      });
    },

    signalerAlertes(alertes) {
      for (const a of alertes || []) {
        const t = typeAlerte(a.type);
        this.journaliser(`ALERTE ${t.libelle}${a.zoneNom ? ' : ' + a.zoneNom : ''}`, true);
        toast(`Alerte générée : ${t.libelle}${a.zoneNom ? ' (' + a.zoneNom + ')' : ''}`);
      }
      if ((alertes || []).length) majCompteurAlertes();
    },

    async envoyerPosition(lat, lon) {
      const r = await this.appelDispositif('positions', {
        latitude: Number(lat.toFixed(6)), longitude: Number(lon.toFixed(6)), precision: 6, batterie: this.batterie,
      });
      this.position = [lat, lon];
      this.majCarte();
      this.journaliser(`position ${lat.toFixed(5)}, ${lon.toFixed(5)} · batterie ${this.batterie} %`);
      this.signalerAlertes(r.alertes);
    },

    async choisir(id) {
      this.arreter();
      this.canne = canneParId(id) || null;
      if (!this.canne) return;
      const p = this.canne.dernierePosition;
      this.position = p ? [p.latitude, p.longitude] : [...LOME];
      this.depart = [...this.position];
      this.batterie = this.canne.batterie ?? 100;
      try {
        this.zones = (await api('GET', `/api/cannes/${id}/zones`)).zones;
      } catch {
        this.zones = [];
      }
      this.majCarte(true);
      this.journaliser(`canne sélectionnée : ${this.canne.nom} (${this.zones.filter((z) => z.actif).length} zone(s) active(s))`);
      if (!this.canne.active) this.journaliser('attention : cette canne est désactivée, le serveur refusera ses positions', true);
    },

    /** Trajet de la position actuelle vers la zone active la plus proche, en la traversant. */
    trajetPromenade() {
      const [la, lo] = this.position;
      const actives = this.zones.filter((z) => z.actif);
      const distance = (z) => Math.hypot(z.latitude - la, (z.longitude - lo) * Math.cos(la * Math.PI / 180));
      let cible;
      if (actives.length) {
        const z = actives.sort((a, b) => distance(a) - distance(b))[0];
        const d = distance(z) || 1e-6;
        const depasse = (z.rayon * 1.6) / 111_320;
        cible = [z.latitude + ((z.latitude - la) / d) * depasse, z.longitude + ((z.longitude - lo) / d) * depasse / Math.cos(la * Math.PI / 180)];
        this.journaliser(`promenade vers « ${z.nom} »`);
      } else {
        cible = [la - 0.003, lo + 0.002];
        this.journaliser('promenade (aucune zone active pour cette canne)');
      }
      const metres = Math.hypot((cible[0] - la) * 111_320, (cible[1] - lo) * 111_320 * Math.cos(la * Math.PI / 180));
      const n = Math.max(2, Math.round(metres / 14));
      return Array.from({ length: n }, (_, i) => {
        const t = (i + 1) / n;
        const bruit = () => (Math.random() - 0.5) * 0.00004;
        return [la + (cible[0] - la) * t + bruit(), lo + (cible[1] - lo) * t + bruit()];
      });
    },

    demarrer() {
      if (!this.canne) return;
      this.arreter();
      const points = this.trajetPromenade();
      let i = 0;
      $('#sim-promenade').disabled = true;
      $('#sim-pause').disabled = false;
      const pas = async () => {
        if (i >= points.length) {
          this.journaliser('promenade terminée');
          return this.arreter();
        }
        if (i % 12 === 11) this.batterie = Math.max(1, this.batterie - 1);
        try {
          await this.envoyerPosition(...points[i++]);
        } catch (e) {
          this.journaliser(`échec : ${e.message}`, true);
          return this.arreter();
        }
        this.minuteur = setTimeout(pas, Number($('#sim-vitesse').value));
      };
      pas();
    },

    arreter() {
      clearTimeout(this.minuteur);
      this.minuteur = null;
      $('#sim-promenade').disabled = false;
      $('#sim-pause').disabled = true;
    },

    async evenement(type) {
      const r = await this.appelDispositif('alertes', { type, latitude: this.position[0], longitude: this.position[1] });
      this.signalerAlertes([r.alerte]);
    },

    majCarte(recentrer = false) {
      if (!this.position) return;
      if (!this.carte) {
        $('#sim-carte').textContent = `Position simulée : ${this.position[0].toFixed(5)}, ${this.position[1].toFixed(5)}`;
        return;
      }
      if (!this.marqueur) {
        this.marqueur = L.marker(this.position, { icon: L.divIcon({ className: '', html: '<div class="marqueur-canne"></div>', iconSize: [20, 20] }) }).addTo(this.carte);
      } else {
        this.marqueur.setLatLng(this.position);
      }
      if (recentrer) {
        this.carte.calque.clearLayers();
        this.zones.forEach((z) => cercleZone(z).addTo(this.carte.calque));
        this.carte.setView(this.position, 16);
      }
    },
  };

  chargeurs.simulateur = async () => {
    try {
      await chargerCannes();
    } catch (e) {
      return toast(e.message, true);
    }
    const select = $('#sim-canne');
    const actuel = simulation.canne?.id || select.value;
    select.innerHTML = donnees.cannes.map((c) => `<option value="${c.id}">${echapper(c.nom)} · ${echapper(c.identifiant)}${c.active ? '' : ' (désactivée)'}</option>`).join('');
    if (actuel && donnees.cannes.some((c) => c.id === actuel)) select.value = actuel;
    simulation.carte = await carte('sim-carte', {
      surClic: (latlng) => {
        if (!simulation.canne) return;
        simulation.arreter();
        simulation.envoyerPosition(latlng.lat, latlng.lng).catch((ex) => toast(ex.message, true));
      },
    });
    if (!simulation.minuteur && select.value) await simulation.choisir(select.value);
  };

  $('#sim-canne').addEventListener('change', (e) => simulation.choisir(e.target.value));
  $('#sim-promenade').addEventListener('click', () => simulation.demarrer());
  $('#sim-pause').addEventListener('click', () => { simulation.arreter(); simulation.journaliser('promenade arrêtée'); });
  $('#sim-domicile').addEventListener('click', (e) => action(e.currentTarget, async () => {
    simulation.arreter();
    const [la, lo] = simulation.depart || LOME;
    await simulation.envoyerPosition(la, lo);
  }));
  $('#sim-sos').addEventListener('click', (e) => action(e.currentTarget, () => simulation.evenement('sos')));
  $('#sim-chute').addEventListener('click', (e) => action(e.currentTarget, () => simulation.evenement('chute')));
  $('#sim-batterie-faible').addEventListener('click', (e) => action(e.currentTarget, async () => {
    simulation.batterie = 15;
    await simulation.envoyerPosition(...simulation.position);
  }));
  $('#sim-batterie-pleine').addEventListener('click', (e) => action(e.currentTarget, async () => {
    simulation.batterie = 100;
    await simulation.envoyerPosition(...simulation.position);
  }));

  // ===========================================================================
  // Temps réel : flux d'événements poussé par le serveur (Server-Sent Events)
  // ===========================================================================
  const tempsReel = { source: null, connecte: false, minuteurRedessin: null };

  function majIndicateurTempsReel() {
    const el = $('#indicateur-temps-reel');
    if (!el) return;
    el.className = 'badge ' + (tempsReel.connecte ? 'ok' : 'neutre');
    el.innerHTML = `<span class="point"></span>${tempsReel.connecte ? 'Temps réel' : 'Actualisation périodique'}`;
  }

  /** Redessine la vue visible au plus une fois par seconde. */
  function redessinerBientot() {
    if (tempsReel.minuteurRedessin) return;
    tempsReel.minuteurRedessin = setTimeout(() => {
      tempsReel.minuteurRedessin = null;
      if (document.hidden) return;
      if (ongletActif === 'cartographie') dessinerCarto();
      else if (ongletActif === 'tableau') chargeurs.tableau();
      else if (ongletActif === 'maintenance') chargeurs.maintenance();
    }, 1000);
  }

  function appliquerEtat(canneId, maj) {
    const c = canneParId(canneId);
    if (!c) { chargerCannes().then(redessinerBientot).catch(() => {}); return; }
    for (const [k, v] of Object.entries(maj)) if (v !== undefined && v !== null) c[k] = v;
    c.enLigne = !!c.active;
    c.derniereCommunication = maj.derniereCommunication || new Date().toISOString();
    redessinerBientot();
  }

  function connecterFlux() {
    deconnecterFlux();
    if (!window.EventSource || !jeton) return;
    const source = new EventSource(`/api/admin/flux?jeton=${encodeURIComponent(jeton)}`);
    tempsReel.source = source;
    source.onopen = () => { tempsReel.connecte = true; majIndicateurTempsReel(); };
    source.onerror = () => { tempsReel.connecte = false; majIndicateurTempsReel(); }; // EventSource se reconnecte seul
    source.addEventListener('position', (e) => {
      const d = JSON.parse(e.data);
      appliquerEtat(d.canneId, {
        dernierePosition: d.position,
        batterie: d.batterie ?? undefined,
        typeDispositif: d.typeDispositif,
        derniereCommunication: d.le,
      });
    });
    source.addEventListener('etat', (e) => {
      const d = JSON.parse(e.data);
      appliquerEtat(d.canneId, { batterie: d.batterie ?? undefined, typeDispositif: d.typeDispositif, derniereCommunication: d.derniereCommunication });
    });
    source.addEventListener('alerte', (e) => {
      const d = JSON.parse(e.data);
      const t = typeAlerte(d.alerte.type);
      toast(`Alerte ${t.libelle} · ${d.canneNom}${d.alerte.zoneNom ? ' · ' + d.alerte.zoneNom : ''}`, t.classe === 'crit');
      majCompteurAlertes();
      if (ongletActif === 'alertes') chargeurs.alertes();
      else redessinerBientot();
    });
  }

  function deconnecterFlux() {
    tempsReel.source?.close();
    tempsReel.source = null;
    tempsReel.connecte = false;
    majIndicateurTempsReel();
  }

  // ===========================================================================
  // Démarrage
  // ===========================================================================
  function demarrerApplication(utilisateur) {
    donnees.moi = utilisateur;
    $('#nom-admin').textContent = utilisateur.nom.replace(/\s*\(démo\)\s*/i, '');
    $('#avatar-admin').textContent = initiales(utilisateur.nom);
    $('#ecran-connexion').hidden = true;
    $('#application').hidden = false;
    ouvrirOnglet(ongletActif);
    majCompteurAlertes();
    connecterFlux();
  }

  // Actualisations périodiques (onglet visible uniquement).
  setInterval(() => {
    if (!jeton || document.hidden) return;
    // Filet de sécurité : le flux temps réel fait l'essentiel, on resynchronise toutes les 30 s.
    if (ongletActif === 'cartographie' && !tempsReel.connecte) chargerCannes().then(() => dessinerCarto()).catch(() => {});
  }, 10000);
  setInterval(() => {
    if (jeton && !document.hidden && ongletActif === 'cartographie' && tempsReel.connecte) {
      chargerCannes().then(() => dessinerCarto()).catch(() => {});
    }
  }, 30000);
  setInterval(() => {
    if (!jeton || document.hidden) return;
    if (ongletActif === 'tableau') chargeurs.tableau();
    else majCompteurAlertes();
  }, 15000);

  (async () => {
    if (!jeton) return afficherConnexion();
    try {
      const { utilisateur } = await api('GET', '/api/auth/moi');
      if (utilisateur.role !== 'admin') return deconnecter();
      demarrerApplication(utilisateur);
    } catch {
      deconnecter();
    }
  })();
})();
