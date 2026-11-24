import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';

import '../config/app_config.dart';
import '../config/theme.dart';
import '../controllers/historique_controller.dart';
import '../controllers/settings_controller.dart';
import '../controllers/suivi_controller.dart';
import '../models/trajet.dart';
import '../utils/format.dart';
import '../utils/geo.dart';
import '../widgets/carte_base.dart';
import '../widgets/composants.dart';
import '../widgets/selecteurs_periode.dart';

/// Onglet « Historique » : carte du trajet sélectionné, résumé chiffré et
/// chronologie des marches et des arrêts (du plus récent au plus ancien).
class HistoriqueScreen extends StatefulWidget {
  const HistoriqueScreen({super.key});

  @override
  State<HistoriqueScreen> createState() => _HistoriqueScreenState();
}

class _HistoriqueScreenState extends State<HistoriqueScreen> {
  final _carte = ControleurCarte();
  int _versionAffichee = -1;

  @override
  void dispose() {
    _carte.dispose();
    super.dispose();
  }

  /// Recadre la carte quand les données ou la sélection changent.
  void _recadrerSiBesoin(HistoriqueController h) {
    if (_versionAffichee == h.version) return;
    _versionAffichee = h.version;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final selection = h.trajetSelectionne;
      final points = selection != null && selection < h.trajets.length
          ? h.trajets[selection].points
          : h.trajets.expand((t) => t.points).toList();
      _carte.ajusterSur(points);
    });
  }

  Future<void> _choisirDate(HistoriqueController h) async {
    DateTime? choix;
    switch (h.periode) {
      case Periode.jour:
        choix = await showDatePicker(
          context: context,
          initialDate: h.date,
          firstDate: DateTime(2020),
          lastDate: DateTime.now(),
          helpText: 'Choisir un jour',
        );
      case Periode.mois:
        choix = await choisirMois(context, h.date);
      case Periode.annee:
        choix = await choisirAnnee(context, h.date);
    }
    if (choix != null) h.definirDate(choix);
  }

  String _libelleDate(HistoriqueController h) {
    switch (h.periode) {
      case Periode.jour:
        final maintenant = DateTime.now();
        if (memeJour(h.date, maintenant)) return 'Aujourd\'hui, ${dateLongue(h.date)}';
        if (memeJour(h.date, maintenant.subtract(const Duration(days: 1)))) return 'Hier, ${dateLongue(h.date)}';
        return dateLongue(h.date);
      case Periode.mois:
        return moisAnnee(h.date);
      case Periode.annee:
        return '${h.date.year}';
    }
  }

  @override
  Widget build(BuildContext context) {
    final suivi = context.watch<SuiviController>();
    final h = context.watch<HistoriqueController>();
    final canneId = suivi.canneId;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<HistoriqueController>().synchroniser(canneId);
    });
    _recadrerSiBesoin(h);

    final c = context.couleurs;
    final s = context.statut;
    final selection = h.trajetSelectionne;
    final centre = suivi.position?.latLng ?? AppConfig.centreParDefaut;
    final trajetAffiche = selection != null && selection < h.trajets.length ? h.trajets[selection] : null;

    final couches = CouchesCarte(
      traces: [
        for (var i = 0; i < h.trajets.length; i++)
          TraceCarte(
            points: h.trajets[i].points,
            epaisseur: selection == i ? 7 : 5,
            couleur: selection == null || selection == i ? c.primary : c.primary.withValues(alpha: 0.3),
          ),
      ],
      marqueurs: [
        for (final t in trajetAffiche != null ? [trajetAffiche] : (h.trajets.isEmpty ? <Trajet>[] : [h.trajets.last])) ...[
          MarqueurCarte(
            point: t.points.first,
            largeur: 22,
            hauteur: 22,
            enfant: _PointCarte(couleur: s.nominal, libelle: 'Départ'),
            dessin: DessinMarqueur.point(couleur: s.nominal),
          ),
          MarqueurCarte(
            point: t.points.last,
            largeur: 22,
            hauteur: 22,
            enfant: _PointCarte(couleur: c.primary, libelle: 'Arrivée'),
            dessin: DessinMarqueur.point(couleur: c.primary),
          ),
        ],
      ],
    );

    return Column(
      children: [
        EnteteGrandTitre(
          titre: 'Historique',
          sousTitre: suivi.canne?.nom,
          bas: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _SelecteurPeriode(periode: h.periode, surChoix: h.changerPeriode),
              const SizedBox(height: 12),
              Row(
                children: [
                  _BoutonRond(
                    icone: Icons.chevron_left_rounded,
                    libelle: 'Période précédente',
                    surAppui: h.precedent,
                  ),
                  Expanded(
                    child: InkWell(
                      borderRadius: BorderRadius.circular(12),
                      onTap: () => _choisirDate(h),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        child: Text(
                          _libelleDate(h),
                          textAlign: TextAlign.center,
                          style: context.textes.titleSmall?.copyWith(fontSize: 16),
                        ),
                      ),
                    ),
                  ),
                  _BoutonRond(
                    icone: Icons.chevron_right_rounded,
                    libelle: 'Période suivante',
                    surAppui: h.peutAvancer ? h.suivant : null,
                  ),
                ],
              ),
            ],
          ),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () => context.read<HistoriqueController>().charger(),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 24),
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(Marque.rayonCarte),
                  child: SizedBox(
                    height: 168,
                    child: Stack(
                      children: [
                        Positioned.fill(
                          child: CarteBase(
                            controleur: _carte,
                            centre: centre,
                            zoom: 15,
                            couches: couches,
                            libelle: trajetAffiche != null
                                ? 'Carte du trajet sélectionné, ${distanceLisible(trajetAffiche.distanceM)}.'
                                : 'Carte des trajets de la période.',
                          ),
                        ),
                        if (trajetAffiche != null)
                          Positioned(
                            right: 10,
                            bottom: 10,
                            child: Semantics(
                              button: true,
                              label: 'Trajet ${selection! + 1} sélectionné. Toucher pour revoir tous les trajets.',
                              excludeSemantics: true,
                              child: Material(
                                color: c.surfaceContainerLowest,
                                borderRadius: BorderRadius.circular(8),
                                elevation: 1,
                                child: InkWell(
                                  borderRadius: BorderRadius.circular(8),
                                  onTap: () => h.selectionnerTrajet(null),
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                                    child: Text('Trajet ${selection + 1} sélectionné', style: context.textes.labelMedium),
                                  ),
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                RangeeTuiles(tuiles: [
                  TuileStat(libelle: 'Trajets', valeur: '${h.trajets.length}', fond: c.surfaceContainerLowest),
                  TuileStat(libelle: 'Distance', valeur: distanceLisible(h.distanceTotaleM), fond: c.surfaceContainerLowest),
                  TuileStat(libelle: 'En marche', valeur: dureeLisible(h.dureeTotale), fond: c.surfaceContainerLowest),
                ]),
                const SizedBox(height: 12),
                if (h.depuisCache)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Text('Données enregistrées sur le téléphone (hors ligne).',
                        style: context.textes.bodySmall?.copyWith(color: s.avertTexte)),
                  ),
                if (h.chargement)
                  const Padding(
                    padding: EdgeInsets.all(32),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else if (h.erreur != null)
                  _Info(icone: Icons.cloud_off_rounded, texte: h.erreur!, surReessayer: h.charger)
                else if (h.trajets.isEmpty)
                  _Info(
                    icone: Icons.directions_walk_rounded,
                    texte: h.periode == Periode.jour
                        ? 'Aucun déplacement enregistré ce jour-là.'
                        : 'Aucun déplacement enregistré sur cette période.',
                  )
                else
                  CarteBlanche(
                    padding: const EdgeInsets.fromLTRB(14, 14, 14, 4),
                    child: _Chronologie(h: h, domicile: context.watch<SettingsController>().domicile),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// Chronologie verticale (du plus récent au plus ancien) : arrêt en cours,
/// marches (cartes) et arrêts entre deux marches.
class _Chronologie extends StatelessWidget {
  const _Chronologie({required this.h, required this.domicile});
  final HistoriqueController h;
  final LatLng? domicile;

  bool _auDomicile(LatLng point) => domicile != null && distanceEntre(point, domicile!) < 80;

  @override
  Widget build(BuildContext context) {
    final jour = h.periode == Periode.jour;
    final elements = <Widget>[];
    final dernier = h.trajets.last;
    // Arrêt en cours (aujourd'hui, si la dernière marche est terminée).
    if (jour && memeJour(h.date, DateTime.now()) && DateTime.now().difference(dernier.fin).inMinutes >= 3) {
      elements.add(_ElementArret(
        titre: _auDomicile(dernier.points.last) ? 'Domicile' : 'Arrêt en cours',
        detail: 'Depuis ${heure(dernier.fin)}',
        domicile: _auDomicile(dernier.points.last),
      ));
    }
    for (var i = h.trajets.length - 1; i >= 0; i--) {
      final t = h.trajets[i];
      elements.add(_ElementMarche(
        trajet: t,
        selectionne: h.trajetSelectionne == i,
        avecDate: !jour,
        surAppui: () => h.selectionnerTrajet(i),
      ));
      if (jour && i > 0) {
        final precedent = h.trajets[i - 1];
        final pause = t.debut.difference(precedent.fin);
        if (pause.inMinutes >= 5) {
          final maison = _auDomicile(precedent.points.last);
          elements.add(_ElementArret(
            titre: maison ? 'Domicile · ${dureeLisible(pause)}' : 'Arrêt · ${dureeLisible(pause)}',
            detail: '${heure(precedent.fin)} → ${heure(t.debut)}',
            domicile: maison,
          ));
        }
      }
    }
    return Semantics(
      label: 'Chronologie, ${h.trajets.length} trajet${h.trajets.length > 1 ? 's' : ''}',
      child: Column(children: elements),
    );
  }
}

/// Trait vertical de la chronologie : continu entre deux arrêts, pointillé pendant une marche.
class _Trait extends StatelessWidget {
  const _Trait({required this.pointille});
  final bool pointille;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: const Size(3, double.infinity),
      painter: _PeintreTrait(
        couleur: pointille ? const Color(0xFFA5B4FC) : const Color(0xFFC7D2FE),
        pointille: pointille,
      ),
    );
  }
}

class _PeintreTrait extends CustomPainter {
  _PeintreTrait({required this.couleur, required this.pointille});
  final Color couleur;
  final bool pointille;

  @override
  void paint(Canvas canvas, Size t) {
    final pinceau = Paint()
      ..color = couleur
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round;
    final x = t.width / 2;
    if (!pointille) {
      canvas.drawLine(Offset(x, 0), Offset(x, t.height), pinceau);
      return;
    }
    for (double y = 2; y < t.height; y += 8) {
      canvas.drawLine(Offset(x, y), Offset(x, y + 0.5), pinceau);
    }
  }

  @override
  bool shouldRepaint(_PeintreTrait old) => old.couleur != couleur || old.pointille != pointille;
}

class _ElementMarche extends StatelessWidget {
  const _ElementMarche({required this.trajet, required this.selectionne, required this.avecDate, required this.surAppui});
  final Trajet trajet;
  final bool selectionne;
  final bool avecDate;
  final VoidCallback surAppui;

  @override
  Widget build(BuildContext context) {
    final c = context.couleurs;
    final titre = 'Marche · ${distanceLisible(trajet.distanceM)} · ${dureeLisible(trajet.duree)}';
    final detail = '${avecDate ? '${dateCourte(trajet.debut)} · ' : ''}${heure(trajet.debut)} → ${heure(trajet.fin)}';
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(width: 36, child: Center(child: _Trait(pointille: true))),
          const SizedBox(width: 14),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(top: 2, bottom: 10),
              child: Semantics(
                button: true,
                selected: selectionne,
                label: '$titre, $detail. ${selectionne ? 'Affiché sur la carte.' : 'Toucher pour l\'afficher sur la carte.'}',
                excludeSemantics: true,
                child: Material(
                  color: selectionne ? c.primaryContainer : context.statut.surfaceDouce,
                  borderRadius: BorderRadius.circular(14),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(14),
                    onTap: surAppui,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: selectionne ? c.primary : Colors.transparent, width: 1.5),
                      ),
                      child: Row(
                        children: [
                          Icon(Icons.directions_walk_rounded, size: 20, color: selectionne ? c.primary : c.onSurfaceVariant),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(titre,
                                    style: context.textes.labelLarge?.copyWith(
                                        color: selectionne ? c.onPrimaryContainer : c.onSurface)),
                                Text(detail,
                                    style: context.textes.bodySmall?.copyWith(
                                        color: selectionne ? c.primary : c.onSurfaceVariant)),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ElementArret extends StatelessWidget {
  const _ElementArret({required this.titre, required this.detail, required this.domicile});
  final String titre;
  final String detail;
  final bool domicile;

  @override
  Widget build(BuildContext context) {
    final c = context.couleurs;
    final s = context.statut;
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 36,
            child: Column(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(color: domicile ? s.nominalFond : c.surfaceContainer, shape: BoxShape.circle),
                  child: Icon(
                    domicile ? Icons.home_outlined : Icons.place_outlined,
                    size: 18,
                    color: domicile ? s.nominal : c.onSurfaceVariant,
                  ),
                ),
                const Expanded(child: _Trait(pointille: false)),
              ],
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(top: 4, bottom: 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(titre, style: context.textes.titleSmall),
                  Text(detail, style: context.textes.bodySmall?.copyWith(color: c.onSurfaceVariant)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PointCarte extends StatelessWidget {
  const _PointCarte({required this.couleur, required this.libelle});
  final Color couleur;
  final String libelle;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: libelle,
      child: Container(
        decoration: BoxDecoration(
          color: couleur,
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white, width: 3),
          boxShadow: Marque.ombreFlottante,
        ),
      ),
    );
  }
}

class _Info extends StatelessWidget {
  const _Info({required this.icone, required this.texte, this.surReessayer});
  final IconData icone;
  final String texte;
  final VoidCallback? surReessayer;

  @override
  Widget build(BuildContext context) {
    final c = context.couleurs;
    return CarteBlanche(
      child: Column(
        children: [
          Icon(icone, size: 36, color: c.outline),
          const SizedBox(height: 8),
          Text(texte, textAlign: TextAlign.center, style: context.textes.bodyMedium?.copyWith(color: c.onSurfaceVariant)),
          if (surReessayer != null)
            TextButton.icon(onPressed: surReessayer, icon: const Icon(Icons.refresh_rounded), label: const Text('Réessayer')),
        ],
      ),
    );
  }
}

/// Sélecteur Jour / Mois / Année : piste grise, segment choisi en blanc.
class _SelecteurPeriode extends StatelessWidget {
  const _SelecteurPeriode({required this.periode, required this.surChoix});
  final Periode periode;
  final ValueChanged<Periode> surChoix;

  @override
  Widget build(BuildContext context) {
    final c = context.couleurs;
    const options = [(Periode.jour, 'Jour'), (Periode.mois, 'Mois'), (Periode.annee, 'Année')];
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(color: const Color(0xFFEEF0F5), borderRadius: BorderRadius.circular(12)),
      child: Row(
        children: [
          for (final (valeur, libelle) in options)
            Expanded(
              child: Semantics(
                button: true,
                selected: valeur == periode,
                label: libelle,
                excludeSemantics: true,
                child: GestureDetector(
                  onTap: () => surChoix(valeur),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 180),
                    height: 40,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: valeur == periode ? c.surfaceContainerLowest : Colors.transparent,
                      borderRadius: BorderRadius.circular(10),
                      boxShadow: valeur == periode
                          ? const [BoxShadow(color: Color(0x1F0F172A), blurRadius: 3, offset: Offset(0, 1))]
                          : null,
                    ),
                    child: Text(
                      libelle,
                      style: context.textes.labelLarge?.copyWith(
                        fontSize: 14,
                        color: valeur == periode ? c.onSurface : c.onSurfaceVariant,
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Bouton rond à bordure grise (période précédente / suivante).
class _BoutonRond extends StatelessWidget {
  const _BoutonRond({required this.icone, required this.libelle, required this.surAppui});
  final IconData icone;
  final String libelle;
  final VoidCallback? surAppui;

  @override
  Widget build(BuildContext context) {
    final c = context.couleurs;
    return Semantics(
      button: true,
      enabled: surAppui != null,
      label: libelle,
      excludeSemantics: true,
      child: Material(
        color: c.surfaceContainerLowest,
        shape: CircleBorder(side: BorderSide(color: context.statut.bordure, width: 1.5)),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: surAppui,
          child: SizedBox(
            width: 44,
            height: 44,
            child: Icon(icone, color: surAppui == null ? c.surfaceContainerHighest : c.onSurface),
          ),
        ),
      ),
    );
  }
}
