import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../config/theme.dart';
import '../controllers/settings_controller.dart';
import '../widgets/composants.dart';

/// Présentation de l'application (onboarding), affichée au premier lancement
/// puis accessible depuis les paramètres (« Revoir la présentation »).
///
/// [revoir] : ouverte depuis les paramètres ; la fin ferme simplement l'écran.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key, this.revoir = false});

  final bool revoir;

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _Page {
  const _Page({required this.titre, required this.texte, required this.points, required this.illustration});
  final String titre;
  final String texte;
  final List<String> points;
  final Widget illustration;
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _pages = const [
    _Page(
      titre: 'Sa position, en temps réel',
      texte: 'Voyez où se trouve votre proche grâce au GPS de sa canne intelligente.',
      points: [
        'Mise à jour automatique toutes les 10 secondes',
        'Batterie et précision du signal visibles d\'un coup d\'œil',
        'Une position ancienne est toujours signalée comme telle',
      ],
      illustration: _IllustrationCarte(),
    ),
    _Page(
      titre: 'L\'historique de ses trajets',
      texte: 'Retrouvez ses déplacements jour par jour, mois par mois.',
      points: [
        'Chronologie des marches et des arrêts',
        'Distance parcourue et temps de marche',
        'Consultable même hors connexion',
      ],
      illustration: _IllustrationHistorique(),
    ),
    _Page(
      titre: 'Zones sensibles et alertes',
      texte: 'Dessinez les lieux à éviter : vous êtes prévenu dès qu\'il y entre.',
      points: [
        'Carrefours, chantiers, marchés : à vous de choisir',
        'Alertes de chute, de batterie faible et de canne inactive',
        'Notification immédiate sur votre téléphone',
      ],
      illustration: _IllustrationZones(),
    ),
    _Page(
      titre: 'Assistance et sécurité à distance',
      texte: 'En cas de SOS, agissez tout de suite, où que vous soyez.',
      points: [
        'Appel direct et itinéraire jusqu\'à lui en un geste',
        'Partage temporaire de sa position avec un autre proche',
        'Ses données restent protégées et sous son contrôle',
      ],
      illustration: _IllustrationSos(),
    ),
  ];

  final _controleur = PageController();
  int _page = 0;

  bool get _derniere => _page == _pages.length - 1;

  @override
  void dispose() {
    _controleur.dispose();
    super.dispose();
  }

  void _suivant() {
    if (_derniere) {
      _terminer();
      return;
    }
    _controleur.nextPage(duration: const Duration(milliseconds: 320), curve: Curves.easeOutCubic);
  }

  Future<void> _terminer() async {
    if (widget.revoir) {
      Navigator.of(context).pop();
      return;
    }
    // L'application affiche alors l'écran de connexion.
    await context.read<SettingsController>().marquerOnboardingVu();
  }

  void _surChangement(int i) => setState(() => _page = i);

  @override
  Widget build(BuildContext context) {
    final c = context.couleurs;
    return Scaffold(
      backgroundColor: c.surfaceContainerLowest,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 8, 0),
              child: Row(
                children: [
                  Container(
                    width: 36,
                    height: 36,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(color: c.primary, borderRadius: BorderRadius.circular(11)),
                    child: Text('CP', style: context.textes.labelLarge?.copyWith(color: c.onPrimary, fontWeight: FontWeight.w800)),
                  ),
                  const SizedBox(width: 10),
                  Expanded(child: Text('Canne Proche', style: context.textes.titleMedium)),
                  ExcludeSemantics(
                    excluding: _derniere,
                    child: AnimatedOpacity(
                      duration: const Duration(milliseconds: 200),
                      opacity: _derniere ? 0 : 1,
                      child: TextButton(
                        onPressed: _derniere ? null : _terminer,
                        child: const Text('Passer'),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: PageView.builder(
                controller: _controleur,
                itemCount: _pages.length,
                onPageChanged: _surChangement,
                itemBuilder: (_, i) => _ContenuPage(page: _pages[i]),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 8, 24, 20),
              child: Row(
                children: [
                  _Pagination(nombre: _pages.length, actif: _page, surChoix: (i) {
                    _controleur.animateToPage(i,
                        duration: const Duration(milliseconds: 320), curve: Curves.easeOutCubic);
                  }),
                  const Spacer(),
                  FilledButton(
                    onPressed: _suivant,
                    style: FilledButton.styleFrom(minimumSize: const Size(148, 56)),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(_derniere ? 'Commencer' : 'Suivant'),
                        const SizedBox(width: 8),
                        Icon(_derniere ? Icons.check_rounded : Icons.arrow_forward_rounded, size: 20),
                      ],
                    ),
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

class _ContenuPage extends StatelessWidget {
  const _ContenuPage({required this.page});
  final _Page page;

  @override
  Widget build(BuildContext context) {
    final c = context.couleurs;
    return LayoutBuilder(
      builder: (context, contraintes) => SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(24, 12, 24, 12),
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: contraintes.maxHeight - 24),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 460),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  ExcludeSemantics(
                    child: AspectRatio(aspectRatio: 1.15, child: page.illustration),
                  ),
                  const SizedBox(height: 28),
                  Semantics(header: true, child: Text(page.titre, style: context.textes.displaySmall)),
                  const SizedBox(height: 10),
                  Text(page.texte, style: context.textes.bodyLarge?.copyWith(color: c.onSurfaceVariant)),
                  const SizedBox(height: 18),
                  for (final p in page.points)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            margin: const EdgeInsets.only(top: 2),
                            width: 22,
                            height: 22,
                            decoration: BoxDecoration(color: c.primaryContainer, shape: BoxShape.circle),
                            child: Icon(Icons.check_rounded, size: 15, color: c.primary),
                          ),
                          const SizedBox(width: 12),
                          Expanded(child: Text(p, style: context.textes.bodyMedium)),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Points de pagination, cliquables (cibles de 32 px de large au minimum).
class _Pagination extends StatelessWidget {
  const _Pagination({required this.nombre, required this.actif, required this.surChoix});
  final int nombre;
  final int actif;
  final ValueChanged<int> surChoix;

  @override
  Widget build(BuildContext context) {
    final c = context.couleurs;
    return Semantics(
      label: 'Page ${actif + 1} sur $nombre',
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (var i = 0; i < nombre; i++)
            GestureDetector(
              onTap: () => surChoix(i),
              behavior: HitTestBehavior.opaque,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 18),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 250),
                  curve: Curves.easeOut,
                  width: i == actif ? 28 : 9,
                  height: 9,
                  decoration: BoxDecoration(
                    color: i == actif ? c.primary : c.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(5),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

// --- Illustrations (dessinées en Flutter, sans image) ------------------------------

/// Fond de carte stylisé commun aux illustrations.
class _FondCarte extends StatelessWidget {
  const _FondCarte({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(32),
      child: Stack(
        fit: StackFit.expand,
        children: [
          CustomPaint(painter: _PeintreCarte(sombre: context.sombre)),
          child,
        ],
      ),
    );
  }
}

class _PeintreCarte extends CustomPainter {
  _PeintreCarte({required this.sombre});
  final bool sombre;

  @override
  void paint(Canvas canvas, Size t) {
    final fond = Paint()..color = sombre ? const Color(0xFF16213A) : const Color(0xFFECEFF3);
    canvas.drawRect(Offset.zero & t, fond);
    final parc = Paint()..color = sombre ? const Color(0xFF1C3328) : const Color(0xFFDCEBD8);
    canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTWH(t.width * .06, t.height * .1, t.width * .3, t.height * .22), const Radius.circular(8)), parc);
    canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTWH(t.width * .66, t.height * .62, t.width * .26, t.height * .2), const Radius.circular(8)), parc);
    final route = Paint()
      ..color = sombre ? const Color(0xFF26324D) : Colors.white
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;
    void ligne(double x1, double y1, double x2, double y2, double l) {
      route.strokeWidth = l;
      canvas.drawLine(Offset(t.width * x1, t.height * y1), Offset(t.width * x2, t.height * y2), route);
    }

    ligne(-.1, .45, 1.1, .55, 16);
    ligne(.48, -.1, .54, 1.1, 16);
    ligne(-.1, .82, 1.1, .74, 9);
    ligne(.2, -.1, .25, 1.1, 8);
    ligne(.8, -.1, .84, 1.1, 8);
  }

  @override
  bool shouldRepaint(_PeintreCarte old) => old.sombre != sombre;
}

class _IllustrationCarte extends StatelessWidget {
  const _IllustrationCarte();

  @override
  Widget build(BuildContext context) {
    return _FondCarte(
      child: LayoutBuilder(
        builder: (context, t) => Stack(
          children: [
            Positioned(
              left: t.maxWidth * .5 - 52,
              top: t.maxHeight * .48 - 52,
              child: Container(
                width: 104,
                height: 104,
                decoration: BoxDecoration(color: context.statut.nominal.withValues(alpha: .16), shape: BoxShape.circle),
              ),
            ),
            Positioned(
              left: t.maxWidth * .5 - 32,
              top: t.maxHeight * .48 - 32,
              child: const MarqueurPersonne(nom: 'Ama Mensah', enDirect: true, taille: 64),
            ),
            Positioned(
              left: 16,
              top: 16,
              child: PuceFraicheur(horodatage: DateTime.now().subtract(const Duration(seconds: 8)), enDirect: true),
            ),
            Positioned(
              left: 16,
              right: 16,
              bottom: 16,
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: context.couleurs.surfaceContainerLowest,
                  borderRadius: BorderRadius.circular(18),
                  boxShadow: Marque.ombreFlottante,
                ),
                child: const RangeeTuiles(tuiles: [
                  TuileStat(libelle: 'Batterie', valeur: '78 %'),
                  TuileStat(libelle: 'Précision', valeur: '± 6 m'),
                ]),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _IllustrationHistorique extends StatelessWidget {
  const _IllustrationHistorique();

  @override
  Widget build(BuildContext context) {
    final c = context.couleurs;
    Widget etape(IconData icone, String titre, String detail, {bool marche = false}) => Container(
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: marche ? c.primaryContainer : c.surfaceContainerLowest,
            borderRadius: BorderRadius.circular(14),
            border: marche ? Border.all(color: c.primary, width: 1.5) : null,
            boxShadow: Marque.ombreFlottante,
          ),
          child: Row(
            children: [
              Icon(icone, color: marche ? c.primary : c.onSurfaceVariant, size: 22),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(titre, style: context.textes.labelLarge),
                    Text(detail, style: context.textes.bodySmall?.copyWith(color: c.onSurfaceVariant)),
                  ],
                ),
              ),
            ],
          ),
        );
    return _FondCarte(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.end,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            etape(Icons.home_outlined, 'Domicile', 'Depuis 11:48'),
            etape(Icons.directions_walk_rounded, 'Marche · 1,6 km', '11:26 → 11:48', marche: true),
            etape(Icons.place_outlined, 'Arrêt · 1 h 36', '09:50 → 11:26'),
          ],
        ),
      ),
    );
  }
}

class _IllustrationZones extends StatelessWidget {
  const _IllustrationZones();

  @override
  Widget build(BuildContext context) {
    final s = context.statut;
    return _FondCarte(
      child: LayoutBuilder(
        builder: (context, t) => Stack(
          children: [
            Positioned(
              left: t.maxWidth * .56 - 70,
              top: t.maxHeight * .42 - 70,
              child: Container(
                width: 140,
                height: 140,
                decoration: BoxDecoration(
                  color: s.critique.withValues(alpha: .13),
                  shape: BoxShape.circle,
                  border: Border.all(color: s.critique, width: 2.5),
                ),
              ),
            ),
            Positioned(
              left: t.maxWidth * .56 - 24,
              top: t.maxHeight * .42 - 24,
              child: const MarqueurPersonne(nom: 'Ama Mensah', enDirect: true, taille: 48),
            ),
            Positioned(
              left: 16,
              right: 16,
              top: 16,
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: context.couleurs.surfaceContainerLowest,
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: s.avert, width: 2),
                  boxShadow: Marque.ombreFlottante,
                ),
                child: Row(
                  children: [
                    Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(color: s.avertFond, borderRadius: BorderRadius.circular(12)),
                      child: Icon(Icons.shield_outlined, color: s.avert),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Entrée en zone', style: context.textes.labelLarge),
                          Text('Ama est entrée dans « Carrefour Déckon »',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: context.textes.bodySmall?.copyWith(color: context.couleurs.onSurfaceVariant)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _IllustrationSos extends StatelessWidget {
  const _IllustrationSos();

  @override
  Widget build(BuildContext context) {
    final s = context.statut;
    return ClipRRect(
      borderRadius: BorderRadius.circular(32),
      child: Container(
        color: s.critique,
        padding: const EdgeInsets.all(22),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 92,
              height: 92,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: Colors.white,
                shape: BoxShape.circle,
                boxShadow: [BoxShadow(color: Colors.white.withValues(alpha: .25), spreadRadius: 12)],
              ),
              child: Text('SOS', style: context.textes.headlineMedium?.copyWith(color: s.critique)),
            ),
            const SizedBox(height: 22),
            Text('Ama a besoin d\'aide',
                style: context.textes.headlineSmall?.copyWith(color: Colors.white), textAlign: TextAlign.center),
            const SizedBox(height: 18),
            Row(
              children: [
                Expanded(
                  child: Container(
                    height: 48,
                    decoration: BoxDecoration(color: const Color(0xFF15803D), borderRadius: BorderRadius.circular(14)),
                    child: const Icon(Icons.call_rounded, color: Colors.white),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Container(
                    height: 48,
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)),
                    child: Icon(Icons.near_me_rounded, color: context.couleurs.primary),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
