import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config/app_config.dart';
import '../config/theme.dart';
import '../controllers/alertes_controller.dart';
import '../controllers/historique_controller.dart';
import '../controllers/navigation_controller.dart';
import '../controllers/settings_controller.dart';
import '../controllers/suivi_controller.dart';
import '../controllers/zones_controller.dart';
import '../models/itineraire.dart';
import '../services/api_client.dart';
import '../services/location_service.dart';
import '../services/routing_service.dart';
import '../utils/format.dart';
import '../utils/geo.dart';
import '../widgets/carte_base.dart';
import '../widgets/composants.dart';
import '../widgets/entete_suivi.dart';
import 'parametres_screen.dart';
import 'partage_screen.dart';

/// Onglet « Carte » (inspiré de Life360) : carte plein écran, personne suivie
/// en haut, panneau glissant en bas avec l'état de la canne et les actions.
///
/// Règle de sécurité : une position qui n'est plus actualisée est affichée en
/// gris, avec un bandeau orange, et n'est jamais présentée comme « en direct ».
class AccueilScreen extends StatefulWidget {
  const AccueilScreen({super.key});

  @override
  State<AccueilScreen> createState() => _AccueilScreenState();
}

class _AccueilScreenState extends State<AccueilScreen> {
  final _carte = ControleurCarte();
  Itineraire? _itineraire;
  String? _itineraireCanneId;
  bool _calcul = false;
  bool _satellite = false;

  /// La carte suit la canne tant que le proche ne la déplace pas à la main.
  bool _suivre = true;
  String? _centreePour;
  DateTime? _dernierHorodatageSuivi;

  @override
  void dispose() {
    _carte.dispose();
    super.dispose();
  }

  void _planifierCentrage(SuiviController suivi, NavigationController nav) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      // Demande explicite (« Voir sur la carte » depuis une alerte).
      final focus = nav.focus;
      if (focus != null) {
        nav.focusTraite();
        _suivre = false;
        _carte.deplacerSur(focus, zoom: 17);
        return;
      }
      final p = suivi.position;
      if (p == null) return;
      final canneChangee = _centreePour != suivi.canneId;
      final nouvellePosition = _dernierHorodatageSuivi != p.horodatage;
      if (canneChangee) {
        _centreePour = suivi.canneId;
        _suivre = true;
        _itineraire = null;
        _carte.deplacerSur(p.latLng, zoom: 16.5);
      } else if (_suivre && nouvellePosition) {
        _carte.deplacerSur(p.latLng);
      }
      _dernierHorodatageSuivi = p.horodatage;
    });
  }

  void _recentrer(SuiviController suivi) {
    final p = suivi.position;
    if (p == null) return;
    setState(() => _suivre = true);
    _carte.deplacerSur(p.latLng, zoom: 16.5);
  }

  // --- Itinéraire -------------------------------------------------------------

  Future<void> _choisirDestination() async {
    final reglages = context.read<SettingsController>();
    final choix = await showModalBottomSheet<_Destination>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(8, 0, 8, 4),
                child: Text('Itinéraire à pied', style: ctx.textes.headlineSmall),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(8, 0, 8, 12),
                child: Text(
                  'Tracer le chemin depuis la canne jusqu\'à :',
                  style: ctx.textes.bodyMedium?.copyWith(color: ctx.couleurs.onSurfaceVariant),
                ),
              ),
              _OptionDestination(
                icone: Icons.person_pin_circle_outlined,
                titre: 'Ma position',
                detail: 'Pour aller le rejoindre',
                surAppui: () => Navigator.pop(ctx, _Destination.maPosition),
              ),
              _OptionDestination(
                icone: Icons.home_outlined,
                titre: 'Son domicile',
                detail: reglages.domicile != null
                    ? 'Pour le guider jusque chez lui'
                    : 'Non défini : à renseigner dans les paramètres',
                surAppui: reglages.domicile != null ? () => Navigator.pop(ctx, _Destination.domicile) : null,
              ),
              if (reglages.domicile == null)
                TextButton.icon(
                  onPressed: () => Navigator.pop(ctx, _Destination.definirDomicile),
                  icon: const Icon(Icons.edit_location_alt_outlined),
                  label: const Text('Définir le domicile'),
                ),
            ],
          ),
        ),
      ),
    );
    if (choix == null || !mounted) return;
    if (choix == _Destination.definirDomicile) {
      await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const ParametresScreen()));
      return;
    }
    await _calculer(choix);
  }

  Future<void> _calculer(_Destination destination) async {
    final suivi = context.read<SuiviController>();
    final reglages = context.read<SettingsController>();
    final routage = context.read<RoutingService>();
    final localisation = context.read<LocationService>();
    final messager = ScaffoldMessenger.of(context);
    final depart = suivi.position?.latLng;
    if (depart == null) {
      messager.showSnackBar(const SnackBar(content: Text('Position de la canne inconnue.')));
      return;
    }
    setState(() => _calcul = true);
    try {
      late final LatLng arrivee;
      late final String libelle;
      if (destination == _Destination.domicile) {
        arrivee = reglages.domicile!;
        libelle = 'le domicile';
      } else {
        arrivee = await localisation.positionActuelle();
        libelle = 'votre position';
      }
      final resultat = await routage.calculer(depart: depart, arrivee: arrivee, libelleDestination: libelle);
      if (!mounted) return;
      setState(() {
        _itineraire = resultat;
        _itineraireCanneId = suivi.canneId;
        _suivre = false;
      });
      _carte.ajusterSur([...resultat.points, depart, arrivee]);
    } on LocalisationException catch (e) {
      messager.showSnackBar(SnackBar(content: Text(e.message)));
    } on ApiException catch (e) {
      messager.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _calcul = false);
    }
  }

  Future<void> _appeler(String numero) async {
    final ok = await launchUrl(Uri(scheme: 'tel', path: numero));
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Impossible d\'ouvrir le composeur.')));
    }
  }

  void _ouvrirPartage() =>
      Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const PartageScreen()));

  // --- Affichage ----------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final suivi = context.watch<SuiviController>();
    final reglages = context.watch<SettingsController>();
    final zones = context.watch<ZonesController>().zones;
    final nonTraitees = context.watch<AlertesController>().nonTraitees;
    final nav = context.read<NavigationController>();
    final canne = suivi.canne;
    if (canne == null) return const SizedBox.shrink();
    _planifierCentrage(suivi, nav);

    final position = suivi.position;
    // enLigne : l'appareil communique (panneau normal) ; enDirect : sa position
    // est récente au point d'être présentée comme « en direct ».
    final enLigne = !suivi.canneHorsLigne && canne.active;
    final enDirect = suivi.positionEnDirect;
    final c = context.couleurs;
    final s = context.statut;
    final itineraire = _itineraireCanneId == suivi.canneId ? _itineraire : null;
    final centreInitial = position?.latLng ?? reglages.domicile ?? AppConfig.centreParDefaut;

    final zonesActives = zones.where((z) => z.actif).toList();
    final couches = CouchesCarte(
      cercles: [
        for (final z in zonesActives)
          CercleCarte(
            centre: z.centre,
            rayonM: z.rayon,
            remplissage: s.critique.withValues(alpha: 0.12),
            bord: s.critique,
            epaisseur: 2,
          ),
        if (position?.precision != null && position!.precision! > 0)
          CercleCarte(
            centre: position.latLng,
            rayonM: position.precision!,
            remplissage: (enDirect ? s.nominal : Marque.gris).withValues(alpha: 0.16),
            bord: enDirect ? s.nominal : Marque.gris,
            epaisseur: 1.5,
          ),
      ],
      traces: [
        if (itineraire != null) TraceCarte(points: itineraire.points, epaisseur: 6, couleur: c.primary),
      ],
      marqueurs: [
        for (final z in zonesActives)
          MarqueurCarte(
            point: z.centre,
            largeur: 170,
            hauteur: 28,
            enfant: Center(child: _EtiquetteZone(nom: z.nom)),
            dessin: DessinMarqueur.etiquette(texte: z.nom, couleur: s.critiqueTexte),
          ),
        if (reglages.domicile != null)
          MarqueurCarte(
            point: reglages.domicile!,
            largeur: 40,
            hauteur: 40,
            enfant: _MarqueurIcone(icone: Icons.home_rounded, couleur: s.nominal, libelle: 'Domicile'),
            dessin: DessinMarqueur.icone(icone: 'home', couleur: s.nominal),
          ),
        if (itineraire != null)
          MarqueurCarte(
            point: itineraire.destination,
            largeur: 40,
            hauteur: 40,
            enfant: _MarqueurIcone(
                icone: Icons.flag_rounded, couleur: s.avert, libelle: 'Arrivée : ${itineraire.libelleDestination}'),
            dessin: DessinMarqueur.icone(icone: 'flag', couleur: s.avert),
          ),
        if (position != null)
          MarqueurCarte(
            point: position.latLng,
            largeur: 190,
            hauteur: 124,
            // Le cercle est centré sur la position ; l'étiquette « Dernière position »
            // s'affiche dessous quand la position n'est plus actualisée.
            enfant: Column(
              children: [
                const SizedBox(height: 36),
                SizedBox(
                  height: 52,
                  child: Center(child: MarqueurPersonne(nom: canne.nom, enDirect: enDirect)),
                ),
                const SizedBox(height: 6),
                if (!enDirect) _EtiquetteDernierePosition(heure: heure(position.horodatage)),
              ],
            ),
            dessin: MarqueurPersonne.dessin(
              context,
              nom: canne.nom,
              enDirect: enDirect,
              etiquette: enDirect ? null : 'Dernière position · ${heure(position.horodatage)}',
            ),
          ),
      ],
    );

    return LayoutBuilder(
      builder: (context, contraintes) => Stack(
      children: [
        Positioned.fill(
          child: CarteBase(
            controleur: _carte,
            satellite: _satellite,
            centre: centreInitial,
            zoom: position == null ? 12 : 16.5,
            couches: couches,
            libelle: position == null
                ? 'Carte. Aucune position reçue pour ${canne.nom}.'
                : enDirect
                    ? 'Carte. Position en direct de ${canne.nom}, reçue ${ilYa(position.horodatage)}.'
                    : 'Carte. Dernière position connue de ${canne.nom}, ${ilYa(position.horodatage)}. Ce n\'est pas une position en direct.',
            surDeplacement: (geste) {
              if (geste && _suivre) setState(() => _suivre = false);
            },
          ),
        ),
        // --- En-tête flottant -------------------------------------------------------
        SafeArea(
          bottom: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Expanded(child: SelecteurPersonne()),
                    const SizedBox(width: 10),
                    BoutonFlottant(
                      icone: Icons.notifications_outlined,
                      libelle: nonTraitees > 0 ? 'Alertes, $nonTraitees à traiter' : 'Alertes',
                      badge: nonTraitees,
                      surAppui: () => nav.aller(3),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                if (enDirect || position == null)
                  PuceFraicheur(
                    // Heure du dernier contact (position ou signe de vie d'un appareil immobile).
                    horodatage: suivi.ageDernierSignal == null
                        ? position?.horodatage
                        : DateTime.now().subtract(suivi.ageDernierSignal!),
                    enDirect: enDirect,
                  )
                else
                  _BandeauPositionAncienne(
                    age: suivi.ageDernierSignal,
                    desactivee: !canne.active,
                  ),
              ],
            ),
          ),
        ),
        // --- Boutons flottants à droite, au-dessus du panneau ------------------------------
        Positioned(
          right: 16,
          bottom: contraintes.maxHeight * 0.44 + 16,
          child: Column(
            children: [
              BoutonFlottant(
                icone: Icons.layers_outlined,
                libelle: _satellite ? 'Afficher le plan' : 'Afficher la vue satellite',
                taille: 48,
                surAppui: () => setState(() => _satellite = !_satellite),
              ),
              const SizedBox(height: 10),
              BoutonFlottant(
                icone: _suivre ? Icons.my_location_rounded : Icons.location_searching_rounded,
                couleurIcone: c.primary,
                libelle: 'Recentrer la carte sur la canne',
                taille: 48,
                surAppui: position == null ? null : () => _recentrer(suivi),
              ),
            ],
          ),
        ),
        // --- Panneau glissant --------------------------------------------------------
        DraggableScrollableSheet(
          initialChildSize: 0.44,
          minChildSize: 0.22,
          maxChildSize: 0.86,
          snap: true,
          snapSizes: const [0.44],
          builder: (context, defilement) => DecoratedBox(
            decoration: BoxDecoration(
              color: c.surfaceContainerLowest,
              borderRadius: const BorderRadius.vertical(top: Radius.circular(Marque.rayonFeuille)),
              boxShadow: const [BoxShadow(color: Color(0x1F0F172A), blurRadius: 24, offset: Offset(0, -6))],
            ),
            child: ListView(
              controller: defilement,
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
              children: [
                const _Poignee(),
                if (enLigne)
                  _PanneauEnDirect(
                    itineraire: itineraire,
                    calculEnCours: _calcul,
                    surItineraire: _choisirDestination,
                    surEffacerItineraire: () => setState(() => _itineraire = null),
                    surAppeler: _appeler,
                    surPartager: _ouvrirPartage,
                  )
                else
                  _PanneauHorsLigne(surAppeler: _appeler),
              ],
            ),
          ),
        ),
      ],
      ),
    );
  }
}

enum _Destination { maPosition, domicile, definirDomicile }

// --- Petits éléments ----------------------------------------------------------------

class _Poignee extends StatelessWidget {
  const _Poignee();

  @override
  Widget build(BuildContext context) {
    return ExcludeSemantics(
      child: Center(
        child: Container(
          margin: const EdgeInsets.only(top: 10, bottom: 14),
          width: 40,
          height: 5,
          decoration: BoxDecoration(
            color: context.couleurs.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(3),
          ),
        ),
      ),
    );
  }
}

class _MarqueurIcone extends StatelessWidget {
  const _MarqueurIcone({required this.icone, required this.couleur, required this.libelle});
  final IconData icone;
  final Color couleur;
  final String libelle;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: libelle,
      child: Container(
        decoration: BoxDecoration(
          color: context.couleurs.surfaceContainerLowest,
          borderRadius: BorderRadius.circular(12),
          boxShadow: Marque.ombreFlottante,
        ),
        child: Icon(icone, color: couleur, size: 22),
      ),
    );
  }
}

class _OptionDestination extends StatelessWidget {
  const _OptionDestination({required this.icone, required this.titre, required this.detail, required this.surAppui});
  final IconData icone;
  final String titre;
  final String detail;
  final VoidCallback? surAppui;

  @override
  Widget build(BuildContext context) {
    final c = context.couleurs;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: c.surface,
        borderRadius: BorderRadius.circular(16),
        child: ListTile(
          enabled: surAppui != null,
          onTap: surAppui,
          minTileHeight: 64,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          leading: Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(color: c.primaryContainer, borderRadius: BorderRadius.circular(14)),
            child: Icon(icone, color: c.primary),
          ),
          title: Text(titre),
          subtitle: Text(detail),
          trailing: const Icon(Icons.chevron_right_rounded),
        ),
      ),
    );
  }
}

/// Nom d'une zone à éviter, posé sur la carte (étiquette blanche, texte rouge).
class _EtiquetteZone extends StatelessWidget {
  const _EtiquetteZone({required this.nom});
  final String nom;

  @override
  Widget build(BuildContext context) {
    return ExcludeSemantics(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: context.couleurs.surfaceContainerLowest,
          borderRadius: BorderRadius.circular(8),
          boxShadow: const [BoxShadow(color: Color(0x260F172A), blurRadius: 4, offset: Offset(0, 1))],
        ),
        child: Text(
          nom,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: context.textes.labelSmall?.copyWith(color: context.statut.critiqueTexte, letterSpacing: 0),
        ),
      ),
    );
  }
}

/// Étiquette sombre sous le marqueur gris : heure de la dernière position connue.
class _EtiquetteDernierePosition extends StatelessWidget {
  const _EtiquetteDernierePosition({required this.heure});
  final String heure;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(color: const Color(0xFF334155), borderRadius: BorderRadius.circular(8)),
      child: Text(
        'Dernière position · $heure',
        style: context.textes.labelMedium?.copyWith(color: Colors.white, fontWeight: FontWeight.w700),
      ),
    );
  }
}

/// Bandeau orange posé sur la carte quand la position n'est plus actualisée.
class _BandeauPositionAncienne extends StatelessWidget {
  const _BandeauPositionAncienne({required this.age, required this.desactivee});
  final Duration? age;
  final bool desactivee;

  @override
  Widget build(BuildContext context) {
    final s = context.statut;
    final titre = desactivee
        ? 'Canne désactivée par l\'administrateur'
        : age == null
            ? 'Aucune position reçue'
            : 'Position non actualisée depuis ${dureeLisible(age!)}';
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 10, 14, 10),
        decoration: BoxDecoration(
          color: s.avertFond,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: s.avert.withValues(alpha: 0.45), width: 1.5),
          boxShadow: Marque.ombreFlottante,
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(desactivee ? Icons.block_rounded : Icons.wifi_off_rounded, color: s.avertTexte),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(titre, style: context.textes.titleSmall?.copyWith(color: s.avertTexte)),
                  Text(
                    desactivee
                        ? 'Ce n\'est pas une position en direct.'
                        : 'Ce n\'est pas une position en direct. La canne n\'envoie plus de signal.',
                    style: context.textes.bodySmall?.copyWith(color: s.avertTexte),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// --- Panneau : canne en direct ---------------------------------------------------------

class _PanneauEnDirect extends StatelessWidget {
  const _PanneauEnDirect({
    required this.itineraire,
    required this.calculEnCours,
    required this.surItineraire,
    required this.surEffacerItineraire,
    required this.surAppeler,
    required this.surPartager,
  });

  final Itineraire? itineraire;
  final bool calculEnCours;
  final VoidCallback surItineraire;
  final VoidCallback surEffacerItineraire;
  final Future<void> Function(String numero) surAppeler;
  final VoidCallback surPartager;

  @override
  Widget build(BuildContext context) {
    final suivi = context.watch<SuiviController>();
    final reglages = context.watch<SettingsController>();
    final historique = context.watch<HistoriqueController>();
    final nav = context.read<NavigationController>();
    final canne = suivi.canne!;
    final p = suivi.position;
    final c = context.couleurs;
    final s = context.statut;
    final batterie = suivi.batterie;
    final faible = batterie != null && batterie < 20;
    final telephone = canne.telephonePersonne;

    // Ligne d'état : distance au domicile si elle est connue. Une position
    // ancienne n'est jamais présentée comme « en direct ».
    final enDirect = suivi.positionEnDirect;
    final aujourdhui = historique.periode == Periode.jour && memeJour(historique.date, DateTime.now());
    final dernierTrajet = aujourdhui && historique.trajets.isNotEmpty ? historique.trajets.last : null;
    // « En marche » si le dernier trajet du jour vient de se terminer (ou est en cours).
    final enMarche = dernierTrajet != null && DateTime.now().difference(dernierTrajet.fin) < const Duration(minutes: 3);
    String etat = enDirect
        ? (enMarche ? 'En marche' : 'À l\'arrêt')
        : (p == null ? 'Aucune position reçue' : 'Dernière position ${ilYa(p.horodatage)}');
    final domicile = reglages.domicile;
    if (p != null && domicile != null) {
      final d = distanceEntre(p.latLng, domicile);
      final lieu = d < 60 ? 'au domicile' : 'à ${distanceLisible(d)} du domicile';
      etat = '$etat · $lieu';
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            AvatarInitiales(nom: canne.nom, taille: 56),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Semantics(header: true, child: Text(canne.nom, style: context.textes.headlineMedium)),
                  const SizedBox(height: 2),
                  Text(etat,
                      style: context.textes.bodyMedium?.copyWith(
                          color: enDirect ? s.nominalTexte : s.avertTexte, fontWeight: FontWeight.w600)),
                ],
              ),
            ),
            if (telephone != null && telephone.isNotEmpty)
              Semantics(
                button: true,
                label: 'Appeler ${canne.nomCourt}',
                excludeSemantics: true,
                child: Material(
                  color: s.nominal,
                  shape: const CircleBorder(),
                  child: InkWell(
                    customBorder: const CircleBorder(),
                    onTap: () => surAppeler(telephone),
                    child: const SizedBox(width: 56, height: 56, child: Icon(Icons.call_rounded, color: Colors.white)),
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: 16),
        RangeeTuiles(tuiles: [
          TuileStat(
            libelle: 'Batterie',
            valeur: batterie == null ? '—' : '$batterie %',
            couleurValeur: faible ? s.critique : null,
          ),
          TuileStat(
            libelle: 'Précision GPS',
            valeur: p?.precision == null ? '—' : '± ${p!.precision!.round()} m',
          ),
          TuileStat(
            libelle: 'Aujourd\'hui',
            valeur: aujourdhui ? distanceLisible(historique.distanceTotaleM) : '—',
          ),
        ]),
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(
              child: BoutonActionRond(
                icone: Icons.near_me_outlined,
                libelle: 'Itinéraire',
                enCours: calculEnCours,
                surAppui: (p == null || calculEnCours) ? null : surItineraire,
              ),
            ),
            Expanded(
              child: BoutonActionRond(icone: Icons.share_location_rounded, libelle: 'Partager', surAppui: surPartager),
            ),
            Expanded(
              child: BoutonActionRond(icone: Icons.schedule_rounded, libelle: 'Trajets', surAppui: () => nav.aller(2)),
            ),
            Expanded(
              child: BoutonActionRond(
                  icone: Icons.shield_outlined, libelle: 'Zones', critique: true, surAppui: () => nav.aller(1)),
            ),
          ],
        ),
        if (itineraire != null) ...[
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.fromLTRB(14, 8, 4, 8),
            decoration: BoxDecoration(color: c.primaryContainer, borderRadius: BorderRadius.circular(16)),
            child: Row(
              children: [
                Icon(Icons.directions_walk_rounded, color: c.onPrimaryContainer),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Vers ${itineraire!.libelleDestination} : ${distanceLisible(itineraire!.distanceM)}, '
                    '${dureeLisible(itineraire!.duree)} à pied',
                    style: context.textes.bodyMedium?.copyWith(color: c.onPrimaryContainer, fontWeight: FontWeight.w600),
                  ),
                ),
                IconButton(
                  tooltip: 'Effacer l\'itinéraire',
                  onPressed: surEffacerItineraire,
                  icon: Icon(Icons.close_rounded, color: c.onPrimaryContainer),
                ),
              ],
            ),
          ),
        ],
        if (dernierTrajet != null) ...[
          const SizedBox(height: 14),
          Material(
            color: context.statut.surfaceDouce,
            borderRadius: BorderRadius.circular(16),
            child: InkWell(
              borderRadius: BorderRadius.circular(16),
              onTap: () => nav.aller(2),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  children: [
                    Icon(Icons.open_in_full_rounded, color: c.primary, size: 20),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text.rich(
                        TextSpan(children: [
                          const TextSpan(text: 'Dernier départ', style: TextStyle(fontWeight: FontWeight.w700)),
                          TextSpan(
                            text: ' à ${heure(dernierTrajet.debut)} · ${dureeLisible(dernierTrajet.duree)} de marche',
                          ),
                        ]),
                        style: context.textes.bodyMedium,
                      ),
                    ),
                    Icon(Icons.chevron_right_rounded, color: c.onSurfaceVariant),
                  ],
                ),
              ),
            ),
          ),
        ],
      ],
    );
  }
}

// --- Panneau : position non actualisée ------------------------------------------------

class _PanneauHorsLigne extends StatelessWidget {
  const _PanneauHorsLigne({required this.surAppeler});
  final Future<void> Function(String numero) surAppeler;

  @override
  Widget build(BuildContext context) {
    final suivi = context.watch<SuiviController>();
    final canne = suivi.canne!;
    final p = suivi.position;
    final c = context.couleurs;
    final s = context.statut;
    final batterie = suivi.batterie;
    final faible = batterie != null && batterie < 20;
    final age = suivi.ageDernierSignal;
    final telephone = canne.telephonePersonne;
    final desactivee = !canne.active;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            AvatarInitiales(nom: canne.nom, taille: 56, actif: false),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Semantics(header: true, child: Text(canne.nom, style: context.textes.headlineMedium)),
                  const SizedBox(height: 4),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                    decoration: BoxDecoration(color: s.avertFond, borderRadius: BorderRadius.circular(999)),
                    child: Text(
                      desactivee ? 'Canne désactivée' : 'Signal perdu · canne inactive',
                      style: context.textes.labelMedium?.copyWith(color: s.avertTexte, fontWeight: FontWeight.w800),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        RangeeTuiles(tuiles: [
          TuileStat(libelle: 'Dernier signal', valeur: p == null ? '—' : heure(p.horodatage)),
          TuileStat(
            libelle: 'Batterie connue',
            valeur: batterie == null ? '—' : '$batterie %',
            couleurValeur: faible ? s.critique : null,
          ),
          TuileStat(libelle: 'Sans signal', valeur: age == null ? '—' : dureeLisible(age)),
        ]),
        const SizedBox(height: 14),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: s.surfaceDouce, borderRadius: BorderRadius.circular(16)),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Que vérifier ?', style: context.textes.titleSmall),
              const SizedBox(height: 4),
              Text(
                desactivee
                    ? 'L\'administrateur a mis cette canne hors service (perte, réparation). Ses positions ne sont plus reçues.'
                    : faible
                        ? 'La batterie était presque vide : la canne s\'est sans doute éteinte. Essayez d\'appeler ${canne.nomCourt}.'
                        : 'Lieu sans réseau (sous-sol, marché couvert) ou batterie déchargée. Essayez d\'appeler ${canne.nomCourt}.',
                style: context.textes.bodyMedium?.copyWith(color: c.onSurfaceVariant),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        Row(
          children: [
            if (telephone != null && telephone.isNotEmpty) ...[
              Expanded(
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(backgroundColor: s.nominal, foregroundColor: Colors.white),
                  onPressed: () => surAppeler(telephone),
                  icon: const Icon(Icons.call_rounded),
                  label: Text('Appeler ${canne.nomCourt}', overflow: TextOverflow.ellipsis),
                ),
              ),
              const SizedBox(width: 10),
            ],
            Expanded(
              child: OutlinedButton.icon(
                onPressed: suivi.rafraichir,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Actualiser'),
              ),
            ),
          ],
        ),
      ],
    );
  }
}
