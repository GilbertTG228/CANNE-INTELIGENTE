import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config/theme.dart';
import '../controllers/alertes_controller.dart';
import '../controllers/navigation_controller.dart';
import '../controllers/suivi_controller.dart';
import '../models/alerte.dart';
import '../services/api_client.dart';
import '../services/location_service.dart';
import '../utils/format.dart';
import '../utils/geo.dart';
import '../widgets/alerte_visuel.dart';
import '../widgets/carte_base.dart';
import '../widgets/composants.dart';

/// Écran plein affiché lors d'un SOS ou d'une entrée en zone (ouvert par une
/// notification ou depuis le journal d'alertes).
class AlerteEnCoursScreen extends StatefulWidget {
  const AlerteEnCoursScreen({super.key, required this.alerte});

  final Alerte alerte;

  @override
  State<AlerteEnCoursScreen> createState() => _AlerteEnCoursScreenState();
}

class _AlerteEnCoursScreenState extends State<AlerteEnCoursScreen> {
  final _carte = ControleurCarte();
  bool _envoi = false;
  late bool _traitee = widget.alerte.traitee;

  /// Position du proche (pour la tuile « Distance de vous »), si la localisation est permise.
  LatLng? _maPosition;

  @override
  void initState() {
    super.initState();
    _localiserProche();
  }

  Future<void> _localiserProche() async {
    try {
      final p = await context.read<LocationService>().positionActuelle();
      if (mounted) setState(() => _maPosition = p);
    } catch (_) {
      // Localisation refusée ou indisponible : la tuile affiche « — ».
    }
  }

  @override
  void dispose() {
    _carte.dispose();
    super.dispose();
  }

  Future<void> _acquitter() async {
    final alertes = context.read<AlertesController>();
    final messager = ScaffoldMessenger.of(context);
    final navigateur = Navigator.of(context);
    setState(() => _envoi = true);
    try {
      if (widget.alerte.id.isNotEmpty) {
        await alertes.marquerTraitee(widget.alerte.id);
      }
      if (mounted) setState(() => _traitee = true);
      navigateur.pop();
    } on ApiException catch (e) {
      messager.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _envoi = false);
    }
  }

  Future<void> _appeler(String numero) async {
    final ok = await launchUrl(Uri(scheme: 'tel', path: numero));
    if (!ok && mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Impossible d\'ouvrir le composeur.')));
    }
  }

  /// Itinéraire à pied vers la personne dans l'application de navigation du téléphone.
  Future<void> _yAller(LatLng cible) async {
    final uri = Uri.parse(
      'https://www.google.com/maps/dir/?api=1&destination=${cible.latitude},${cible.longitude}&travelmode=walking',
    );
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && mounted) _voirSurCarte();
  }

  void _voirSurCarte() {
    final a = widget.alerte;
    final suivi = context.read<SuiviController>();
    final point = a.position ?? suivi.position?.latLng;
    final nav = context.read<NavigationController>();
    Navigator.of(context).popUntil((r) => r.isFirst);
    nav.aller(0, focus: point);
  }

  @override
  Widget build(BuildContext context) {
    final a = widget.alerte;
    final suivi = context.watch<SuiviController>();
    final c = context.couleurs;
    final s = context.statut;
    final couleur = couleurAlerte(context, a);
    final canne = suivi.cannes.where((x) => x.id == a.canneId).firstOrNull ?? suivi.canne;
    final nom = canne?.nom ?? 'La personne';
    final prenom = canne?.nomCourt ?? 'la personne';
    final telephone = canne?.telephonePersonne;
    // Position en direct de la personne si elle est connue, sinon celle de l'alerte.
    final memeCanne = canne?.id == suivi.canneId;
    final positionVivante = memeCanne ? suivi.position : null;
    final point = positionVivante?.latLng ?? a.position;
    final enDirect = positionVivante != null && suivi.positionEnDirect;
    final precision = positionVivante?.precision;
    final batterie = memeCanne ? suivi.batterie : canne?.batterie;
    final distance = (_maPosition != null && point != null) ? distanceEntre(_maPosition!, point) : null;

    final titre = switch (a.type) {
      TypeAlerte.sos => '$prenom a besoin d\'aide',
      TypeAlerte.chute => 'Chute détectée',
      TypeAlerte.entreeZone => 'Entrée dans une zone à éviter',
      _ => titreAlerte(a),
    };
    final detail = switch (a.type) {
      TypeAlerte.sos => 'Bouton d\'urgence pressé à ${heure(a.horodatage)} · ${ilYa(a.horodatage)}',
      TypeAlerte.entreeZone =>
        '${a.zoneNom != null ? '« ${a.zoneNom} » · ' : ''}${heure(a.horodatage)} · ${ilYa(a.horodatage)}',
      _ => '${heure(a.horodatage)} · ${ilYa(a.horodatage)}',
    };

    return Scaffold(
      backgroundColor: c.surfaceContainerLowest,
      body: Column(
        children: [
          // --- Bandeau coloré -------------------------------------------------------
          Semantics(
            liveRegion: true,
            container: true,
            child: Container(
              width: double.infinity,
              decoration: BoxDecoration(
                color: couleur,
                borderRadius: const BorderRadius.vertical(bottom: Radius.circular(32)),
              ),
              child: SafeArea(
                bottom: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 8, 12, 26),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                            decoration: BoxDecoration(
                              color: Colors.white.withValues(alpha: 0.2),
                              borderRadius: BorderRadius.circular(999),
                            ),
                            child: Text(
                              _traitee ? 'ALERTE TRAITÉE' : 'ALERTE EN COURS',
                              style: context.textes.labelMedium?.copyWith(
                                  color: Colors.white, letterSpacing: 1, fontWeight: FontWeight.w800),
                            ),
                          ),
                          const Spacer(),
                          IconButton(
                            tooltip: 'Fermer',
                            style: IconButton.styleFrom(backgroundColor: Colors.white.withValues(alpha: 0.2)),
                            color: Colors.white,
                            icon: const Icon(Icons.close_rounded),
                            onPressed: () => Navigator.pop(context),
                          ),
                        ],
                      ),
                      const SizedBox(height: 14),
                      Row(
                        children: [
                          Container(
                            width: 72,
                            height: 72,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              color: Colors.white,
                              shape: BoxShape.circle,
                              boxShadow: [BoxShadow(color: Colors.white.withValues(alpha: 0.2), spreadRadius: 9)],
                            ),
                            child: a.type == TypeAlerte.sos
                                ? Text('SOS', style: context.textes.titleLarge?.copyWith(color: couleur, fontWeight: FontWeight.w800))
                                : Icon(iconeAlerte(a.type), color: couleur, size: 36),
                          ),
                          const SizedBox(width: 18),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Semantics(
                                  header: true,
                                  child: Text(titre,
                                      style: context.textes.headlineLarge?.copyWith(color: Colors.white)),
                                ),
                                const SizedBox(height: 4),
                                Text(detail,
                                    style: context.textes.bodyMedium
                                        ?.copyWith(color: Colors.white.withValues(alpha: 0.92))),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          // --- Carte et actions --------------------------------------------------------
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 24),
              children: [
                if (point != null)
                  ClipRRect(
                    borderRadius: BorderRadius.circular(Marque.rayonCarte),
                    child: SizedBox(
                      height: 190,
                      child: Stack(
                        children: [
                          Positioned.fill(
                            child: CarteBase(
                              controleur: _carte,
                              centre: point,
                              zoom: 16.5,
                              libelle: enDirect
                                  ? 'Carte. Position en direct de $nom.'
                                  : 'Carte. Dernière position connue de $nom.',
                              couches: CouchesCarte(marqueurs: [
                                MarqueurCarte(
                                  point: point,
                                  largeur: 56,
                                  hauteur: 56,
                                  enfant: Center(
                                    child: MarqueurPersonne(nom: nom, enDirect: enDirect, critique: a.critique, taille: 46),
                                  ),
                                  dessin: MarqueurPersonne.dessin(context,
                                      nom: nom, enDirect: enDirect, critique: a.critique, taille: 46),
                                ),
                              ]),
                            ),
                          ),
                          Positioned(
                            left: 10,
                            top: 10,
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                              decoration: BoxDecoration(
                                color: c.surfaceContainerLowest,
                                borderRadius: BorderRadius.circular(10),
                                boxShadow: Marque.ombreFlottante,
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Container(
                                    width: 8,
                                    height: 8,
                                    decoration: BoxDecoration(
                                      color: enDirect ? s.nominal : s.avert,
                                      shape: BoxShape.circle,
                                    ),
                                  ),
                                  const SizedBox(width: 6),
                                  Text(
                                    enDirect
                                        ? 'Position en direct${precision != null ? ' · ± ${precision.round()} m' : ''}'
                                        : positionVivante != null
                                            ? 'Dernière position connue'
                                            : 'Position au moment de l\'alerte',
                                    style: context.textes.labelMedium?.copyWith(
                                      color: enDirect ? s.nominalTexte : s.avertTexte,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                const SizedBox(height: 12),
                RangeeTuiles(tuiles: [
                  TuileStat(libelle: 'Distance de vous', valeur: distance == null ? '—' : distanceLisible(distance)),
                  TuileStat(
                    libelle: 'Batterie',
                    valeur: batterie == null ? '—' : '$batterie %',
                    couleurValeur: batterie != null && batterie < 20 ? s.critique : null,
                  ),
                ]),
                const SizedBox(height: 18),
                if (telephone != null && telephone.isNotEmpty) ...[
                  FilledButton.icon(
                    style: FilledButton.styleFrom(
                      backgroundColor: s.nominal,
                      foregroundColor: Colors.white,
                      minimumSize: const Size.fromHeight(60),
                    ),
                    onPressed: () => _appeler(telephone),
                    icon: const Icon(Icons.call_rounded),
                    label: Text('Appeler $prenom'),
                  ),
                  const SizedBox(height: 10),
                ],
                FilledButton.icon(
                  style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(60)),
                  onPressed: point == null ? null : () => _yAller(point),
                  icon: const Icon(Icons.near_me_rounded),
                  label: const Text('Y aller (itinéraire)'),
                ),
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size.fromHeight(60),
                    side: BorderSide(color: c.onSurface, width: 2),
                  ),
                  onPressed: _traitee || _envoi ? null : _acquitter,
                  icon: _envoi
                      ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.5))
                      : Icon(_traitee ? Icons.check_circle_rounded : Icons.check_rounded),
                  label: Text(_traitee ? 'Alerte déjà prise en charge' : 'Je prends en charge'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
