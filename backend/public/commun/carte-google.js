/*
 * Chargement du fond de carte pour les pages web (console, suivi partagé).
 *
 *  - Si le serveur a une clé Google Maps (GET /api/public/config-carte), on charge
 *    Google Maps JavaScript API et on installe un petit adaptateur qui reproduit
 *    la partie de l'API Leaflet utilisée par nos pages (L.map, L.marker, L.circle,
 *    L.polyline, L.layerGroup…). Le code des pages ne change donc pas.
 *  - Sinon (ou si Google ne répond pas, ou refuse la clé), on charge Leaflet et
 *    OpenStreetMap comme avant.
 *
 *  Utilisation : ChargeurCarte.charger().then((fournisseur) => …)
 *  fournisseur : 'google', 'osm' ou null (aucune carte possible : pas d'Internet).
 */
(function () {
  'use strict';

  var CLE_REPLI = 'carte-repli-osm';
  var promesse = null;

  function chargerScript(src, delaiMs) {
    return new Promise(function (ok) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () { ok(true); };
      s.onerror = function () { ok(false); };
      document.head.appendChild(s);
      setTimeout(function () { ok(false); }, delaiMs);
    });
  }

  function chargerLeaflet() {
    if (window.L && !window.L.estGoogle) return Promise.resolve('osm');
    if (!document.querySelector('link[data-leaflet]')) {
      var css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      css.setAttribute('data-leaflet', '');
      document.head.appendChild(css);
    }
    return chargerScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 8000)
      .then(function (ok) { return ok && window.L ? 'osm' : null; });
  }

  function chargerGoogle(cle) {
    return new Promise(function (ok) {
      var fini = false;
      function fin(v) { if (!fini) { fini = true; ok(v); } }
      // Clé refusée (mauvaise clé, API non autorisée, quota du jour atteint) :
      // on bascule sur OpenStreetMap pour le reste de la session.
      window.gm_authFailure = function () {
        try { sessionStorage.setItem(CLE_REPLI, '1'); } catch (e) { /* stockage indisponible */ }
        location.reload();
      };
      window.__carteGooglePrete = function () { installerAdaptateur(); fin('google'); };
      var url = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(cle) +
        '&callback=__carteGooglePrete&v=weekly&language=fr&region=TG&loading=async';
      chargerScript(url, 10000).then(function (charge) { if (!charge) fin(null); });
      setTimeout(function () { fin(null); }, 10000);
    });
  }

  function charger() {
    if (promesse) return promesse;
    promesse = fetch('/api/public/config-carte', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : { fournisseur: 'osm' }; })
      .catch(function () { return { fournisseur: 'osm' }; })
      .then(function (conf) {
        var repli = false;
        try { repli = sessionStorage.getItem(CLE_REPLI) === '1'; } catch (e) { /* stockage indisponible */ }
        if (conf.fournisseur === 'google' && conf.cleGoogle && !repli) {
          return chargerGoogle(conf.cleGoogle).then(function (f) { return f || chargerLeaflet(); });
        }
        return chargerLeaflet();
      });
    return promesse;
  }

  // ===========================================================================
  // Adaptateur : sous-ensemble de l'API Leaflet réalisé avec Google Maps
  // ===========================================================================
  function installerAdaptateur() {
    var g = window.google.maps;

    function enLatLng(x) {
      if (x == null) return null;
      if (Array.isArray(x)) return { lat: +x[0], lng: +x[1] };
      if (typeof x.lat === 'function') return { lat: x.lat(), lng: x.lng() };
      return { lat: +x.lat, lng: +x.lng };
    }

    // --- Bulle d'information au survol (équivalent de bindTooltip) -------------
    var bulle = null;
    function afficherBulle(carte, html, evt) {
      if (!bulle) {
        bulle = document.createElement('div');
        bulle.className = 'bulle-carte';
        bulle.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;background:#fff;color:#0F172A;' +
          'font:600 12px/1.3 Inter,system-ui,sans-serif;padding:5px 8px;border-radius:8px;' +
          'box-shadow:0 2px 8px rgba(15,23,42,.25);white-space:nowrap;display:none';
        document.body.appendChild(bulle);
      }
      bulle.innerHTML = html;
      var e = evt && (evt.domEvent || evt);
      var x = e && e.clientX != null ? e.clientX : 0;
      var y = e && e.clientY != null ? e.clientY : 0;
      bulle.style.left = (x + 12) + 'px';
      bulle.style.top = (y + 12) + 'px';
      bulle.style.display = 'block';
    }
    function masquerBulle() { if (bulle) bulle.style.display = 'none'; }

    // --- Couche de base ---------------------------------------------------------
    function Couche() { this._carte = null; this._groupe = null; this._bulle = null; this._clics = []; }
    Couche.prototype.addTo = function (cible) {
      if (cible && cible._estGroupe) { cible.addLayer(this); return this; }
      this._attacher(cible);
      return this;
    };
    Couche.prototype._attacher = function (carte) { this._carte = carte; this._afficher(carte ? carte._g : null); };
    Couche.prototype.remove = function () {
      if (this._groupe) this._groupe.removeLayer(this);
      else this._afficher(null);
      this._carte = null;
      return this;
    };
    Couche.prototype.bindTooltip = function (html) { this._bulle = html; this._brancherBulle(); return this; };
    Couche.prototype.on = function (type, fn) { if (type === 'click') { this._clics.push(fn); this._brancherClic(); } return this; };
    Couche.prototype._declencherClic = function (evt) {
      var self = this;
      this._clics.forEach(function (fn) { fn({ target: self, originalEvent: evt }); });
    };

    // --- Formes natives Google (cercle, tracé) ----------------------------------
    function Forme(objet) { Couche.call(this); this._o = objet; this._branche = false; }
    Forme.prototype = Object.create(Couche.prototype);
    Forme.prototype._afficher = function (carteG) { this._o.setMap(carteG); if (!carteG) masquerBulle(); };
    Forme.prototype._brancherBulle = function () {
      if (this._brancheBulle) return;
      this._brancheBulle = true;
      var self = this;
      this._o.addListener('mouseover', function (e) { if (self._bulle) afficherBulle(self._carte, self._bulle, e); });
      this._o.addListener('mousemove', function (e) { if (self._bulle) afficherBulle(self._carte, self._bulle, e); });
      this._o.addListener('mouseout', masquerBulle);
    };
    Forme.prototype._brancherClic = function () {
      if (this._branche) return;
      this._branche = true;
      var self = this;
      this._o.setOptions({ clickable: true });
      this._o.addListener('click', function (e) { self._declencherClic(e); });
    };
    Forme.prototype.setLatLng = function (p) { this._o.setCenter(enLatLng(p)); return this; };
    Forme.prototype.setRadius = function (r) { this._o.setRadius(+r); return this; };

    function optionsTrait(o) {
      return {
        strokeColor: o.color || '#3388ff',
        strokeOpacity: o.opacity != null ? o.opacity : 1,
        strokeWeight: o.weight != null ? o.weight : 3,
      };
    }

    function cercle(p, o) {
      o = o || {};
      var opts = optionsTrait(o);
      opts.center = enLatLng(p);
      opts.radius = +o.radius || 10;
      opts.fillColor = o.fillColor || o.color || '#3388ff';
      opts.fillOpacity = o.fillOpacity != null ? o.fillOpacity : 0.2;
      opts.clickable = false;
      return new Forme(new g.Circle(opts));
    }

    function trace(points, o) {
      o = o || {};
      var opts = optionsTrait(o);
      opts.path = (points || []).map(enLatLng);
      opts.clickable = false;
      return new Forme(new g.Polyline(opts));
    }

    // --- Marqueurs HTML (équivalent de L.marker + L.divIcon) --------------------
    var Superposition = null;
    function classeSuperposition() {
      if (Superposition) return Superposition;
      Superposition = function (marqueur) { this._m = marqueur; this._div = null; };
      Superposition.prototype = new g.OverlayView();
      Superposition.prototype.onAdd = function () {
        var m = this._m;
        var div = document.createElement('div');
        div.style.position = 'absolute';
        div.style.cursor = m._clics.length ? 'pointer' : '';
        div.innerHTML = m._icone.html || '';
        if (m._titre) div.title = m._titre;
        var taille = m._icone.iconSize || [20, 20];
        var ancre = m._icone.iconAnchor || [taille[0] / 2, taille[1] / 2];
        div.style.width = taille[0] + 'px';
        div.style.height = taille[1] + 'px';
        div.style.marginLeft = (-ancre[0]) + 'px';
        div.style.marginTop = (-ancre[1]) + 'px';
        if (m._icone.className) div.className = m._icone.className;
        div.addEventListener('click', function (e) { e.stopPropagation(); m._declencherClic(e); });
        div.addEventListener('mouseenter', function (e) { if (m._bulle) afficherBulle(m._carte, m._bulle, e); });
        div.addEventListener('mousemove', function (e) { if (m._bulle) afficherBulle(m._carte, m._bulle, e); });
        div.addEventListener('mouseleave', masquerBulle);
        this._div = div;
        this.getPanes().overlayMouseTarget.appendChild(div);
      };
      Superposition.prototype.draw = function () {
        if (!this._div) return;
        var pt = this.getProjection().fromLatLngToDivPixel(new g.LatLng(this._m._p.lat, this._m._p.lng));
        if (!pt) return;
        this._div.style.left = pt.x + 'px';
        this._div.style.top = pt.y + 'px';
      };
      Superposition.prototype.onRemove = function () {
        if (this._div && this._div.parentNode) this._div.parentNode.removeChild(this._div);
        this._div = null;
        masquerBulle();
      };
      return Superposition;
    }

    function Marqueur(p, o) {
      Couche.call(this);
      o = o || {};
      this._p = enLatLng(p);
      this._icone = o.icon || { html: '<div style="width:14px;height:14px;border-radius:50%;background:#4338CA;border:2px solid #fff"></div>', iconSize: [14, 14] };
      this._titre = o.title || '';
      var C = classeSuperposition();
      this._o = new C(this);
    }
    Marqueur.prototype = Object.create(Couche.prototype);
    Marqueur.prototype._afficher = function (carteG) { this._o.setMap(carteG); };
    Marqueur.prototype._brancherBulle = function () { /* géré par les évènements du <div> */ };
    Marqueur.prototype._brancherClic = function () { if (this._o._div) this._o._div.style.cursor = 'pointer'; };
    Marqueur.prototype.setLatLng = function (p) { this._p = enLatLng(p); this._o.draw(); return this; };

    // L.circleMarker : point de taille fixe en pixels
    function pointFixe(p, o) {
      o = o || {};
      var r = o.radius || 8;
      var w = o.weight != null ? o.weight : 2;
      var d = r * 2;
      var html = '<div style="box-sizing:border-box;width:' + d + 'px;height:' + d + 'px;border-radius:50%;' +
        'background:' + (o.fillColor || o.color || '#3388ff') + ';opacity:' + (o.fillOpacity != null ? o.fillOpacity : 1) + ';' +
        'border:' + w + 'px solid ' + (o.color || '#fff') + '"></div>';
      return new Marqueur(p, { icon: { html: html, iconSize: [d, d], iconAnchor: [r, r] } });
    }

    // --- Groupe de couches --------------------------------------------------------
    function Groupe() { this._estGroupe = true; this._carte = null; this._couches = []; }
    Groupe.prototype.addTo = function (carte) {
      this._carte = carte;
      var self = this;
      this._couches.forEach(function (c) { c._attacher(self._carte); });
      return this;
    };
    Groupe.prototype.addLayer = function (c) {
      c._groupe = this;
      this._couches.push(c);
      if (this._carte) c._attacher(this._carte);
      return this;
    };
    Groupe.prototype.removeLayer = function (c) {
      var i = this._couches.indexOf(c);
      if (i >= 0) this._couches.splice(i, 1);
      c._afficher(null);
      c._groupe = null;
      return this;
    };
    Groupe.prototype.clearLayers = function () {
      this._couches.forEach(function (c) { c._afficher(null); c._groupe = null; });
      this._couches = [];
      masquerBulle();
      return this;
    };
    Groupe.prototype.remove = function () { this.clearLayers(); this._carte = null; return this; };

    // --- Limites (L.latLngBounds) -------------------------------------------------
    function Limites(points) {
      this._b = new g.LatLngBounds();
      this._vide = true;
      var self = this;
      (points || []).forEach(function (p) { self.extend(p); });
    }
    Limites.prototype.extend = function (x) {
      if (x instanceof Limites) {
        if (!x._vide) { this._b.union(x._b); this._vide = false; }
      } else {
        var p = enLatLng(x);
        if (p && isFinite(p.lat) && isFinite(p.lng)) { this._b.extend(p); this._vide = false; }
      }
      return this;
    };
    Limites.prototype.isValid = function () { return !this._vide; };

    function latLng(lat, lng) {
      var p = { lat: +lat, lng: +lng };
      // Carré de « taille » mètres de côté centré sur le point (comme Leaflet).
      p.toBounds = function (taille) {
        var demi = taille / 2;
        var dLat = (demi / 6378137) * (180 / Math.PI);
        var dLng = dLat / Math.max(0.01, Math.cos(p.lat * Math.PI / 180));
        return new Limites([[p.lat - dLat, p.lng - dLng], [p.lat + dLat, p.lng + dLng]]);
      };
      return p;
    }

    // --- Carte ----------------------------------------------------------------------
    function Carte(el, o) {
      o = o || {};
      this._g = new g.Map(el, {
        center: { lat: 6.1319, lng: 1.2228 },
        zoom: 14,
        disableDefaultUI: true,
        zoomControl: o.zoomControl !== false,
        clickableIcons: false,
        gestureHandling: 'greedy',
        mapTypeId: 'roadmap',
      });
      this._g.addListener('mouseout', masquerBulle);
    }
    Carte.prototype.setView = function (p, zoom) {
      this._g.setCenter(enLatLng(p));
      if (zoom != null) this._g.setZoom(zoom);
      return this;
    };
    Carte.prototype.fitBounds = function (x, o) {
      o = o || {};
      var lim = x instanceof Limites ? x : new Limites(x);
      if (!lim.isValid()) return this;
      var pad = o.padding || [0, 0];
      var carte = this._g;
      var ne = lim._b.getNorthEast();
      var so = lim._b.getSouthWest();
      if (ne.equals(so)) {
        carte.setCenter(ne);
        carte.setZoom(o.maxZoom || 16);
        return this;
      }
      carte.fitBounds(lim._b, { top: pad[1], bottom: pad[1], left: pad[0], right: pad[0] });
      if (o.maxZoom != null) {
        g.event.addListenerOnce(carte, 'idle', function () {
          if (carte.getZoom() > o.maxZoom) carte.setZoom(o.maxZoom);
        });
      }
      return this;
    };
    Carte.prototype.invalidateSize = function () { return this; }; // Google suit seul la taille du conteneur
    Carte.prototype.on = function (type, fn) {
      if (type === 'click') {
        this._g.addListener('click', function (e) { fn({ latlng: { lat: e.latLng.lat(), lng: e.latLng.lng() } }); });
      }
      return this;
    };
    Carte.prototype.addLayer = function (c) { c.addTo(this); return this; };
    Carte.prototype.removeLayer = function (c) { c.remove(); return this; };
    Carte.prototype.getZoom = function () { return this._g.getZoom(); };

    var positions = { topright: g.ControlPosition.RIGHT_TOP, topleft: g.ControlPosition.LEFT_TOP,
      bottomright: g.ControlPosition.RIGHT_BOTTOM, bottomleft: g.ControlPosition.LEFT_BOTTOM };

    window.L = {
      estGoogle: true,
      map: function (el, o) { return new Carte(el, o); },
      tileLayer: function () { return { addTo: function () { return this; } }; }, // fond fourni par Google
      control: {
        zoom: function (o) {
          return {
            addTo: function (carte) {
              carte._g.setOptions({ zoomControl: true,
                zoomControlOptions: { position: positions[(o && o.position) || 'topleft'] } });
              return this;
            },
          };
        },
      },
      layerGroup: function () { return new Groupe(); },
      marker: function (p, o) { return new Marqueur(p, o); },
      divIcon: function (o) { return o || {}; },
      circle: cercle,
      circleMarker: pointFixe,
      polyline: trace,
      latLng: latLng,
      latLngBounds: function (points) { return new Limites(points); },
    };
  }

  window.ChargeurCarte = { charger: charger };
})();
