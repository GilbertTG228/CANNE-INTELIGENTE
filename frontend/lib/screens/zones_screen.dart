import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';

import '../config/app_config.dart';
import '../config/theme.dart';
import '../controllers/suivi_controller.dart';
import '../controllers/zones_controller.dart';
import '../models/zone.dart';
import '../services/api_client.dart';
import '../widgets/carte_base.dart';
import '../widgets/composants.dart';
import 'zone_edition_screen.dart';

/// Onglet « Zones » : carte des zones à éviter et liste avec interrupteurs.
/// Toucher la carte crée une zone à cet endroit.
class ZonesScreen extends StatefulWidget {
  const ZonesScreen({super.key});

  @override
  State<ZonesScreen> createState() => _ZonesScreenState();
}

class _ZonesScreenState extends State<ZonesScreen> {
  final _carte = ControleurCarte();
  String? _cadreePour;

  @override
  void dispose() {
    _carte.dispose();
    super.dispose();
  }

  void _ouvrirEdition({Zone? zone, LatLng? centre}) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => ZoneEditionScreen(zone: zone, centreInitial: centre)),
    );
  }

  Future<void> _basculer(Zone zone, bool actif) async {
    final zones = context.read<ZonesController>();
    final messager = ScaffoldMessenger.of(context);
    try {
      await zones.basculer(zone, actif);
    } on ApiException catch (e) {
      messager.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  /// Cadre la carte sur les zones entières (cercles compris) et la canne,
  /// une fois par canne, en laissant libres l'en-tête flottant et le panneau
  /// qui recouvrent la carte.
  void _cadrer(String? canneId, List<Zone> zones, LatLng? position, EdgeInsets marge) {
    if (canneId == null || _cadreePour == canneId || (zones.isEmpty && position == null)) return;
    _cadreePour = canneId;
    const distance = Distance();
    final points = <LatLng>[
      for (final z in zones)
        for (final cap in const [0, 90, 180, 270]) distance.offset(z.centre, z.rayon, cap),
      if (position != null) position,
    ];
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _carte.ajusterSur(points, zoomMax: 16, marge: marge);
    });
  }

  @override
  Widget build(BuildContext context) {
    final suivi = context.watch<SuiviController>();
    final zones = context.watch<ZonesController>();
    final canneId = suivi.canneId;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<ZonesController>().synchroniser(canneId);
    });

    final c = context.couleurs;
    final s = context.statut;
    final position = suivi.position;
    final nom = suivi.canne?.nomCourt ?? '';
    // Carte : environ 43 % de la hauteur de l'écran (proportion de la maquette),
    // le panneau de la liste la recouvre sur 28 px.
    final hauteurEcran = MediaQuery.sizeOf(context).height;
    final hauteurCarte = (hauteurEcran * 0.43).clamp(320.0, 480.0);
    final hautSure = MediaQuery.paddingOf(context).top;
    final marge = EdgeInsets.fromLTRB(32, hautSure + 8 + 56 + 16, 32, 28 + 24);
    if (!zones.chargement) _cadrer(canneId, zones.zones, position?.latLng, marge);

    final couches = CouchesCarte(
      cercles: [
        for (final z in zones.zones)
          CercleCarte(
            centre: z.centre,
            rayonM: z.rayon,
            remplissage: (z.actif ? s.critique : Marque.gris).withValues(alpha: z.actif ? 0.15 : 0.1),
            bord: z.actif ? s.critique : Marque.gris,
            epaisseur: 2.5,
          ),
      ],
      marqueurs: [
        if (position != null)
          MarqueurCarte(
            point: position.latLng,
            largeur: 44,
            hauteur: 44,
            enfant: Center(
              child: MarqueurPersonne(nom: suivi.canne?.nom ?? '', enDirect: suivi.positionEnDirect, taille: 38),
            ),
            dessin: MarqueurPersonne.dessin(context,
                nom: suivi.canne?.nom ?? '', enDirect: suivi.positionEnDirect, taille: 38),
          ),
      ],
    );
    final centre = position?.latLng ?? (zones.zones.isNotEmpty ? zones.zones.first.centre : AppConfig.centreParDefaut);

    // SizedBox.expand : la pile occupe tout l'écran de l'onglet, quel que soit le parent.
    return SizedBox.expand(
      child: Stack(
      children: [
        Positioned(
          left: 0,
          right: 0,
          top: 0,
          height: hauteurCarte,
          child: CarteBase(
            controleur: _carte,
            centre: centre,
            zoom: 14.5,
            couches: couches,
            libelle: 'Carte des zones à éviter. Touchez la carte pour créer une zone.',
            surTouche: (point) => _ouvrirEdition(centre: point),
          ),
        ),
        SafeArea(
          bottom: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Container(
              height: 56,
              padding: const EdgeInsets.symmetric(horizontal: 18),
              decoration: BoxDecoration(
                color: c.surfaceContainerLowest,
                borderRadius: BorderRadius.circular(28),
                boxShadow: Marque.ombreFlottante,
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Semantics(
                      header: true,
                      child: Text('Zones à éviter', style: context.textes.titleLarge),
                    ),
                  ),
                  Text(
                    '${zones.nombreActives} active${zones.nombreActives > 1 ? 's' : ''} sur ${zones.zones.length}',
                    style: context.textes.labelMedium?.copyWith(color: c.onSurfaceVariant),
                  ),
                ],
              ),
            ),
          ),
        ),
        Positioned.fill(
          top: hauteurCarte - 28,
          child: Container(
            decoration: BoxDecoration(
              color: c.surface,
              borderRadius: const BorderRadius.vertical(top: Radius.circular(Marque.rayonFeuille)),
            ),
            child: RefreshIndicator(
              onRefresh: () => context.read<ZonesController>().charger(),
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 18, 16, 24),
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  TitreSection(
                    nom.isEmpty ? 'Zones' : 'Zones d${RegExp(r'^[AEIOUYÉÈÊÂÎaeiouyéèêâî]').hasMatch(nom) ? '\'' : 'e '}$nom',
                    action: Text('Alerte à l\'entrée',
                        style: context.textes.bodySmall?.copyWith(color: c.onSurfaceVariant)),
                  ),
                  if (zones.chargement && zones.zones.isEmpty)
                    const Padding(
                      padding: EdgeInsets.all(32),
                      child: Center(child: CircularProgressIndicator()),
                    )
                  else if (zones.erreur != null && zones.zones.isEmpty)
                    _Message(
                      icone: Icons.cloud_off_rounded,
                      texte: zones.erreur!,
                      action: TextButton(
                        onPressed: () => context.read<ZonesController>().charger(),
                        child: const Text('Réessayer'),
                      ),
                    )
                  else if (zones.zones.isEmpty)
                    const _Message(
                      icone: Icons.shield_outlined,
                      texte: 'Aucune zone pour l\'instant. Touchez la carte ou le bouton ci-dessous '
                          'pour signaler un carrefour, un chantier ou un lieu à éviter.',
                    )
                  else
                    for (final z in zones.zones)
                      _CarteZone(
                        zone: z,
                        surBasculer: (v) => _basculer(z, v),
                        surModifier: () => _ouvrirEdition(zone: z),
                      ),
                  const SizedBox(height: 8),
                  FilledButton.icon(
                    onPressed: canneId == null ? null : () => _ouvrirEdition(),
                    icon: const Icon(Icons.add_rounded),
                    label: const Text('Nouvelle zone'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
      ),
    );
  }
}

class _CarteZone extends StatelessWidget {
  const _CarteZone({
    required this.zone,
    required this.surBasculer,
    required this.surModifier,
  });

  final Zone zone;
  final ValueChanged<bool> surBasculer;
  final VoidCallback surModifier;

  @override
  Widget build(BuildContext context) {
    final c = context.couleurs;
    final s = context.statut;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: c.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: surModifier,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 8, 12),
            child: Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: zone.actif ? s.critiqueFond : c.surfaceContainer,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Icon(Icons.warning_amber_rounded, color: zone.actif ? s.critique : c.onSurfaceVariant),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(zone.nom, maxLines: 2, overflow: TextOverflow.ellipsis, style: context.textes.titleSmall),
                      Text(
                        'Rayon ${zone.rayon.round()} m${zone.actif ? '' : ' · désactivée'}',
                        style: context.textes.bodySmall?.copyWith(color: c.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
                Semantics(
                  label: 'Zone ${zone.nom}',
                  child: Switch(value: zone.actif, onChanged: surBasculer),
                ),
                const SizedBox(width: 8),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({required this.icone, required this.texte, this.action});
  final IconData icone;
  final String texte;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final c = context.couleurs;
    return CarteBlanche(
      child: Column(
        children: [
          Icon(icone, size: 36, color: c.outline),
          const SizedBox(height: 8),
          Text(texte, textAlign: TextAlign.center, style: context.textes.bodyMedium?.copyWith(color: c.onSurfaceVariant)),
          if (action != null) action!,
        ],
      ),
    );
  }
}
