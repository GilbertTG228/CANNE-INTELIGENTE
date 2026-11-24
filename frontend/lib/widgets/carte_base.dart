import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config/app_config.dart';
import '../config/config_carte.dart';
import 'carte_google/vue_carte_google.dart';

// =====================================================================================
// Ce que l'écran demande de dessiner (indépendant du fournisseur de carte)
// =====================================================================================

/// Cercle géographique (zone à éviter, précision GPS). Rayon en mètres.
class CercleCarte {
  const CercleCarte({
    required this.centre,
    required this.rayonM,
    required this.remplissage,
    required this.bord,
    this.epaisseur = 2,
  });

  final LatLng centre;
  final double rayonM;
  final Color remplissage;
  final Color bord;
  final double epaisseur;
}

/// Tracé (itinéraire, trajet de l'historique).
class TraceCarte {
  const TraceCarte({required this.points, required this.couleur, this.epaisseur = 5});

  final List<LatLng> points;
  final Color couleur;
  final double epaisseur;
}

/// Description d'un marqueur pour la carte Google (dessiné en HTML par la page
/// /carte-app/ du serveur, à l'identique du widget Flutter correspondant).
class DessinMarqueur {
  const DessinMarqueur._(this.donnees);

  /// Pastille ronde aux initiales (voir MarqueurPersonne).
  factory DessinMarqueur.personne({
    required String initiales,
    required Color couleur,
    required double taille,
    required bool enDirect,
    Color? pastille,
    String? etiquette,
  }) =>
      DessinMarqueur._({
        'type': 'personne',
        'initiales': initiales,
        'couleur': couleurCss(couleur),
        'taille': taille,
        'enDirect': enDirect,
        if (pastille != null) 'pastille': couleurCss(pastille),
        if (etiquette != null) 'etiquette': etiquette,
      });

  /// Carré blanc arrondi avec une icône colorée (domicile, arrivée).
  factory DessinMarqueur.icone({required String icone, required Color couleur}) =>
      DessinMarqueur._({'type': 'icone', 'icone': icone, 'couleur': couleurCss(couleur)});

  /// Rond coloré avec une icône blanche (voir MarqueurRond).
  factory DessinMarqueur.rond({required String icone, required Color couleur, required double taille}) =>
      DessinMarqueur._({'type': 'rond', 'icone': icone, 'couleur': couleurCss(couleur), 'taille': taille});

  /// Point coloré cerclé de blanc (départ / arrivée d'un trajet).
  factory DessinMarqueur.point({required Color couleur, double taille = 22}) =>
      DessinMarqueur._({'type': 'point', 'couleur': couleurCss(couleur), 'taille': taille});

  /// Étiquette blanche (nom d'une zone).
  factory DessinMarqueur.etiquette({required String texte, required Color couleur}) =>
      DessinMarqueur._({'type': 'etiquette', 'texte': texte, 'couleur': couleurCss(couleur)});

  /// Données envoyées à la page. Les icônes sont désignées par leur nom dans la
  /// police « Material Icons Round » (home, flag, block, directions_walk…).
  final Map<String, Object?> donnees;
}

/// Marqueur : le widget Flutter (carte OpenStreetMap) et son dessin équivalent
/// (carte Google). Le point est le centre du widget, comme avec flutter_map.
class MarqueurCarte {
  const MarqueurCarte({
    required this.point,
    required this.largeur,
    required this.hauteur,
    required this.enfant,
    required this.dessin,
  });

  final LatLng point;
  final double largeur;
  final double hauteur;
  final Widget enfant;
  final DessinMarqueur dessin;
}

/// Ensemble des éléments posés sur la carte, dessinés dans cet ordre :
/// cercles, tracés, puis marqueurs.
class CouchesCarte {
  const CouchesCarte({this.cercles = const [], this.traces = const [], this.marqueurs = const []});

  final List<CercleCarte> cercles;
  final List<TraceCarte> traces;
  final List<MarqueurCarte> marqueurs;

  Map<String, Object?> versJson() => {
        'cmd': 'couches',
        'cercles': [
          for (final c in cercles)
            {
              'lat': c.centre.latitude,
              'lng': c.centre.longitude,
              'rayon': c.rayonM,
              'remplissage': couleurCss(c.remplissage),
              'opaciteRemplissage': c.remplissage.a,
              'bord': couleurCss(c.bord),
              'opaciteBord': c.bord.a,
              'epaisseur': c.epaisseur,
            },
        ],
        'traces': [
          for (final t in traces)
            {
              'points': [for (final p in t.points) [p.latitude, p.longitude]],
              'couleur': couleurCss(t.couleur),
              'opacite': t.couleur.a,
              'epaisseur': t.epaisseur,
            },
        ],
        'marqueurs': [
          for (final m in marqueurs) {'lat': m.point.latitude, 'lng': m.point.longitude, ...m.dessin.donnees},
        ],
      };
}

/// Couleur Flutter → « #RRGGBB » (l'opacité est transmise à part).
String couleurCss(Color c) {
  String h(double v) => (v * 255).round().clamp(0, 255).toRadixString(16).padLeft(2, '0');
  return '#${h(c.r)}${h(c.g)}${h(c.b)}';
}

// =====================================================================================
// Contrôleur : même usage quelle que soit la carte affichée
// =====================================================================================

abstract class _CibleCamera {
  void deplacer(LatLng point, double? zoom);
  void ajuster(List<LatLng> points, double zoomMax, EdgeInsets marge);
}

class ControleurCarte {
  /// Contrôleur de la carte OpenStreetMap (flutter_map).
  final MapController osm = MapController();
  _CibleCamera? _google;

  void deplacerSur(LatLng point, {double? zoom}) {
    final g = _google;
    if (g != null) {
      g.deplacer(point, zoom);
    } else {
      osm.deplacerSur(point, zoom: zoom);
    }
  }

  /// [marge] : espace à laisser libre sur chaque bord, par exemple sous un
  /// en-tête ou un panneau posés par-dessus la carte.
  void ajusterSur(List<LatLng> points, {double zoomMax = 17, EdgeInsets marge = const EdgeInsets.all(40)}) {
    if (points.isEmpty) return;
    final g = _google;
    if (g != null) {
      g.ajuster(points, zoomMax, marge);
    } else {
      osm.ajusterSur(points, zoomMax: zoomMax, marge: marge);
    }
  }
    void dispose() {
    _google = null;
    osm.dispose();
  }

}


// =====================================================================================
// Carte
// =====================================================================================

/// Carte de l'application : Google Maps si le serveur fournit une clé
/// (voir [ConfigCarte]), sinon OpenStreetMap (flutter_map). Si Google refuse la
/// clé ou ne répond pas, la carte bascule d'elle-même sur OpenStreetMap.
class CarteBase extends StatefulWidget {
  const CarteBase({
    super.key,
    required this.controleur,
    required this.centre,
    required this.libelle,
    this.zoom = 16,
    this.couches = const CouchesCarte(),
    this.surTouche,
    this.surDeplacement,
    this.interactive = true,
    this.satellite = false,
  });

  final ControleurCarte controleur;
  final LatLng centre;
  final double zoom;
  final CouchesCarte couches;
  final void Function(LatLng point)? surTouche;

  /// (a bougé à la main ?) — permet d'arrêter le suivi automatique.
  final void Function(bool geste)? surDeplacement;
  final bool interactive;

  /// Fond de carte : plan (par défaut) ou vue satellite.
  final bool satellite;

  /// Description lue par les lecteurs d'écran.
  final String libelle;

  @override
  State<CarteBase> createState() => _CarteBaseState();
}

class _CarteBaseState extends State<CarteBase> {
  /// Google indisponible pour cette carte (clé refusée, pas de réponse) : OpenStreetMap.
  bool _repli = false;

  void _basculerSurOsm() {
    if (!mounted || _repli) return;
    setState(() => _repli = true);
  }

  @override
  Widget build(BuildContext context) {
    final google = ConfigCarte.google && !_repli;
    return Semantics(
      label: widget.libelle,
      container: true,
      child: google
          ? _CarteGoogle(carte: widget, surEchec: _basculerSurOsm)
          : _CarteOsm(carte: widget),
    );
  }
}

// --- OpenStreetMap (flutter_map) ---------------------------------------------------------

class _CarteOsm extends StatelessWidget {
  const _CarteOsm({required this.carte});
  final CarteBase carte;

  @override
  Widget build(BuildContext context) {
    final couches = carte.couches;
    return FlutterMap(
      mapController: carte.controleur.osm,
      options: MapOptions(
        initialCenter: carte.centre,
        initialZoom: carte.zoom,
        minZoom: 3,
        maxZoom: 19,
        onTap: carte.surTouche == null ? null : (_, point) => carte.surTouche!(point),
        onPositionChanged: carte.surDeplacement == null ? null : (camera, geste) => carte.surDeplacement!(geste),
        interactionOptions: InteractionOptions(
          flags: carte.interactive ? InteractiveFlag.all & ~InteractiveFlag.rotate : InteractiveFlag.none,
        ),
      ),
      children: [
        TileLayer(
          urlTemplate: carte.satellite ? AppConfig.tuilesSatelliteUrl : AppConfig.tuilesUrl,
          userAgentPackageName: AppConfig.packageName,
        ),
        if (couches.cercles.isNotEmpty)
          CircleLayer(circles: [
            for (final c in couches.cercles)
              CircleMarker(
                point: c.centre,
                radius: c.rayonM,
                useRadiusInMeter: true,
                color: c.remplissage,
                borderColor: c.bord,
                borderStrokeWidth: c.epaisseur,
              ),
          ]),
        if (couches.traces.isNotEmpty)
          PolylineLayer(polylines: [
            for (final t in couches.traces) Polyline(points: t.points, strokeWidth: t.epaisseur, color: t.couleur),
          ]),
        if (couches.marqueurs.isNotEmpty)
          MarkerLayer(markers: [
            for (final m in couches.marqueurs)
              Marker(point: m.point, width: m.largeur, height: m.hauteur, child: m.enfant),
          ]),
        RichAttributionWidget(
          alignment: AttributionAlignment.bottomLeft,
          showFlutterMapAttribution: false,
          attributions: [
            if (carte.satellite) const TextSourceAttribution('Imagerie © Esri'),
            TextSourceAttribution(
              '© contributeurs OpenStreetMap',
              onTap: () => launchUrl(
                Uri.parse('https://www.openstreetmap.org/copyright'),
                mode: LaunchMode.externalApplication,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

// --- Google Maps (page /carte-app/ du serveur dans une vue web) ------------------------

class _CarteGoogle extends StatefulWidget {
  const _CarteGoogle({required this.carte, required this.surEchec});
  final CarteBase carte;
  final VoidCallback surEchec;

  @override
  State<_CarteGoogle> createState() => _CarteGoogleState();
}

class _CarteGoogleState extends State<_CarteGoogle> implements _CibleCamera {
  static int _compteur = 0;
  late final String _id = 'carte-${DateTime.now().microsecondsSinceEpoch}-${_compteur++}';
  late final Uri _url;
  void Function(String commande)? _envoyer;
  bool _prete = false;
  final List<String> _enAttente = [];
  String? _dernieresCouches;
  bool? _dernierSatellite;
  Timer? _delai;

  @override
  void initState() {
    super.initState();
    final c = widget.carte;
    _url = Uri.parse(ConfigCarte.urlPageCarte).replace(queryParameters: {
      'id': _id,
      'lat': c.centre.latitude.toStringAsFixed(6),
      'lng': c.centre.longitude.toStringAsFixed(6),
      'zoom': c.zoom.toString(),
      'interactive': c.interactive ? '1' : '0',
      'satellite': c.satellite ? '1' : '0',
    });
    c.controleur._google = this;
    // Page jamais prête (serveur ou Google injoignable) : repli sur OpenStreetMap.
    _delai = Timer(const Duration(seconds: 15), () {
      if (!_prete) widget.surEchec();
    });
  }

  @override
  void didUpdateWidget(covariant _CarteGoogle ancien) {
    super.didUpdateWidget(ancien);
    if (!identical(ancien.carte.controleur, widget.carte.controleur)) {
      if (identical(ancien.carte.controleur._google, this)) ancien.carte.controleur._google = null;
      widget.carte.controleur._google = this;
    }
    _synchroniser();
  }

  @override
  void dispose() {
    _delai?.cancel();
    if (identical(widget.carte.controleur._google, this)) widget.carte.controleur._google = null;
    super.dispose();
  }

  /// Envoie à la page ce qui a changé (couches, fond satellite).
  void _synchroniser() {
    final couches = jsonEncode(widget.carte.couches.versJson());
    if (couches != _dernieresCouches) {
      _dernieresCouches = couches;
      _commande(couches);
    }
    if (widget.carte.satellite != _dernierSatellite) {
      _dernierSatellite = widget.carte.satellite;
      _commande(jsonEncode({'cmd': 'satellite', 'valeur': widget.carte.satellite}));
    }
  }

  void _commande(String json) {
    final envoyer = _envoyer;
    if (_prete && envoyer != null) {
      envoyer(json);
    } else {
      _enAttente.add(json);
    }
  }

  void _surMessage(String texte) {
    Map<String, dynamic> m;
    try {
      final d = jsonDecode(texte);
      if (d is! Map<String, dynamic>) return;
      m = d;
    } catch (_) {
      return;
    }
    if (m['id'] != _id) return; // message d'une autre carte
    switch (m['type']) {
      case 'pret':
        _prete = true;
        _delai?.cancel();
        final file = List<String>.of(_enAttente);
        _enAttente.clear();
        for (final c in file) {
          _envoyer?.call(c);
        }
        break;
      case 'touche':
        final lat = (m['lat'] as num?)?.toDouble();
        final lng = (m['lng'] as num?)?.toDouble();
        if (lat != null && lng != null) widget.carte.surTouche?.call(LatLng(lat, lng));
        break;
      case 'geste':
        widget.carte.surDeplacement?.call(true);
        break;
      case 'erreur':
        widget.surEchec();
        break;
    }
  }

  // --- _CibleCamera ---
  @override
  void deplacer(LatLng point, double? zoom) {
    _commande(jsonEncode({'cmd': 'deplacer', 'lat': point.latitude, 'lng': point.longitude, 'zoom': zoom}));
  }

  @override
  void ajuster(List<LatLng> points, double zoomMax, EdgeInsets marge) {
    _commande(jsonEncode({
      'cmd': 'ajuster',
      'points': [for (final p in points) [p.latitude, p.longitude]],
      'zoomMax': zoomMax,
      'marge': {'haut': marge.top, 'droite': marge.right, 'bas': marge.bottom, 'gauche': marge.left},
    }));
  }

  @override
  Widget build(BuildContext context) {
    // Les couches initiales partent dès que la page est prête.
    if (_dernieresCouches == null) _synchroniser();
    return VueCarteGoogle(
      url: _url,
      surMessage: _surMessage,
      surEnvoyeur: (envoyer) => _envoyer = envoyer,
    );
  }
}

// =====================================================================================
// Outils de caméra pour flutter_map
// =====================================================================================

/// Déplacement sans erreur si la carte n'est pas encore affichée.
extension MapControllerSur on MapController {
  void deplacerSur(LatLng point, {double? zoom}) {
    try {
      move(point, zoom ?? camera.zoom);
    } catch (_) {}
  }

  void ajusterSur(List<LatLng> points, {double zoomMax = 17, EdgeInsets marge = const EdgeInsets.all(40)}) {
    if (points.isEmpty) return;
    try {
      if (points.length == 1) {
        move(points.first, zoomMax);
        return;
      }
      fitCamera(CameraFit.bounds(
        bounds: LatLngBounds.fromPoints(points),
        padding: marge,
        maxZoom: zoomMax,
      ));
    } catch (_) {}
  }
}

/// Marqueur rond avec icône (canne, domicile, arrivée…).
class MarqueurRond extends StatelessWidget {
  const MarqueurRond({
    super.key,
    required this.icone,
    required this.couleur,
    this.taille = 44,
    this.libelle,
  });

  final IconData icone;
  final Color couleur;
  final double taille;
  final String? libelle;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: libelle,
      child: Container(
        decoration: BoxDecoration(
          color: couleur,
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white, width: 3),
          boxShadow: const [
            BoxShadow(color: Color(0x40000000), blurRadius: 8, offset: Offset(0, 2)),
          ],
        ),
        child: Icon(icone, color: Colors.white, size: taille * 0.55),
      ),
    );
  }
}
