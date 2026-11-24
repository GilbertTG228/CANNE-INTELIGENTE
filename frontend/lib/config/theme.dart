import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Système de design « Canne Proche » (voir les maquettes) :
/// indigo profond, encre bleu nuit, statuts très contrastés, titres en
/// Plus Jakarta Sans et texte en Inter. Les contrastes respectent le niveau
/// AA du WCAG (4,5:1 pour le texte) et les cibles tactiles font au moins 48 px.
class Marque {
  Marque._();

  static const indigo = Color(0xFF4338CA);
  static const indigoFonce = Color(0xFF312E81);
  static const indigoDoux = Color(0xFFEEF0FF);
  static const encre = Color(0xFF0F172A);
  static const fond = Color(0xFFF5F6FA);
  static const gris = Color(0xFF94A3B8);

  /// Rayons utilisés partout (cartes, boutons, feuilles).
  static const rayonCarte = 20.0;
  static const rayonBouton = 14.0;
  static const rayonFeuille = 28.0;

  /// Ombre douce des éléments flottants sur la carte.
  static const ombreFlottante = [
    BoxShadow(color: Color(0x240F172A), blurRadius: 14, offset: Offset(0, 4)),
  ];
}

/// Couleurs sémantiques de statut (nominal / avertissement / critique).
@immutable
class CouleursStatut extends ThemeExtension<CouleursStatut> {
  const CouleursStatut({
    required this.nominal,
    required this.nominalFond,
    required this.nominalTexte,
    required this.avert,
    required this.avertFond,
    required this.avertTexte,
    required this.critique,
    required this.critiqueFond,
    required this.critiqueTexte,
    required this.bordure,
    required this.surfaceDouce,
  });

  final Color nominal, nominalFond, nominalTexte;
  final Color avert, avertFond, avertTexte;
  final Color critique, critiqueFond, critiqueTexte;
  final Color bordure, surfaceDouce;

  static const claires = CouleursStatut(
    nominal: Color(0xFF15803D),
    nominalFond: Color(0xFFDCFCE7),
    nominalTexte: Color(0xFF166534),
    avert: Color(0xFFC2410C),
    avertFond: Color(0xFFFFEDD5),
    avertTexte: Color(0xFF9A3412),
    critique: Color(0xFFB91C1C),
    critiqueFond: Color(0xFFFEE2E2),
    critiqueTexte: Color(0xFF991B1B),
    bordure: Color(0xFFE2E8F0),
    surfaceDouce: Color(0xFFF5F6FA),
  );

  static const sombres = CouleursStatut(
    nominal: Color(0xFF4ADE80),
    nominalFond: Color(0xFF12301F),
    nominalTexte: Color(0xFF86EFAC),
    avert: Color(0xFFFB923C),
    avertFond: Color(0xFF3A2314),
    avertTexte: Color(0xFFFDBA74),
    critique: Color(0xFFF87171),
    critiqueFond: Color(0xFF3F1A1A),
    critiqueTexte: Color(0xFFFCA5A5),
    bordure: Color(0xFF283449),
    surfaceDouce: Color(0xFF162036),
  );

  @override
  CouleursStatut copyWith({
    Color? nominal,
    Color? nominalFond,
    Color? nominalTexte,
    Color? avert,
    Color? avertFond,
    Color? avertTexte,
    Color? critique,
    Color? critiqueFond,
    Color? critiqueTexte,
    Color? bordure,
    Color? surfaceDouce,
  }) {
    return CouleursStatut(
      nominal: nominal ?? this.nominal,
      nominalFond: nominalFond ?? this.nominalFond,
      nominalTexte: nominalTexte ?? this.nominalTexte,
      avert: avert ?? this.avert,
      avertFond: avertFond ?? this.avertFond,
      avertTexte: avertTexte ?? this.avertTexte,
      critique: critique ?? this.critique,
      critiqueFond: critiqueFond ?? this.critiqueFond,
      critiqueTexte: critiqueTexte ?? this.critiqueTexte,
      bordure: bordure ?? this.bordure,
      surfaceDouce: surfaceDouce ?? this.surfaceDouce,
    );
  }

  @override
  CouleursStatut lerp(ThemeExtension<CouleursStatut>? other, double t) {
    if (other is! CouleursStatut) return this;
    Color l(Color a, Color b) => Color.lerp(a, b, t)!;
    return CouleursStatut(
      nominal: l(nominal, other.nominal),
      nominalFond: l(nominalFond, other.nominalFond),
      nominalTexte: l(nominalTexte, other.nominalTexte),
      avert: l(avert, other.avert),
      avertFond: l(avertFond, other.avertFond),
      avertTexte: l(avertTexte, other.avertTexte),
      critique: l(critique, other.critique),
      critiqueFond: l(critiqueFond, other.critiqueFond),
      critiqueTexte: l(critiqueTexte, other.critiqueTexte),
      bordure: l(bordure, other.bordure),
      surfaceDouce: l(surfaceDouce, other.surfaceDouce),
    );
  }
}

/// Raccourcis pour accéder au thème depuis n'importe quel widget.
extension ThemeContexte on BuildContext {
  ColorScheme get couleurs => Theme.of(this).colorScheme;
  TextTheme get textes => Theme.of(this).textTheme;
  CouleursStatut get statut => Theme.of(this).extension<CouleursStatut>()!;
  bool get sombre => Theme.of(this).brightness == Brightness.dark;
}

class AppTheme {
  AppTheme._();

  static const _clair = ColorScheme(
    brightness: Brightness.light,
    primary: Marque.indigo,
    onPrimary: Colors.white,
    primaryContainer: Marque.indigoDoux,
    onPrimaryContainer: Marque.indigoFonce,
    secondary: Marque.encre,
    onSecondary: Colors.white,
    secondaryContainer: Color(0xFFE0E7FF),
    onSecondaryContainer: Marque.encre,
    tertiary: Color(0xFF15803D),
    onTertiary: Colors.white,
    error: Color(0xFFB91C1C),
    onError: Colors.white,
    errorContainer: Color(0xFFFEE2E2),
    onErrorContainer: Color(0xFF991B1B),
    surface: Marque.fond,
    onSurface: Marque.encre,
    onSurfaceVariant: Color(0xFF475569),
    outline: Color(0xFF64748B),
    outlineVariant: Color(0xFFE2E8F0),
    inverseSurface: Marque.encre,
    onInverseSurface: Colors.white,
    surfaceContainerLowest: Colors.white,
    surfaceContainerLow: Color(0xFFF5F6FA),
    surfaceContainer: Color(0xFFEEF0F5),
    surfaceContainerHigh: Color(0xFFE2E8F0),
    surfaceContainerHighest: Color(0xFFCBD5E1),
  );

  static const _sombre = ColorScheme(
    brightness: Brightness.dark,
    primary: Color(0xFFA5B4FC),
    onPrimary: Color(0xFF1E1B4B),
    primaryContainer: Color(0xFF2E2A6B),
    onPrimaryContainer: Color(0xFFE0E7FF),
    secondary: Color(0xFFCBD5E1),
    onSecondary: Marque.encre,
    secondaryContainer: Color(0xFF1E2A44),
    onSecondaryContainer: Color(0xFFE2E8F0),
    tertiary: Color(0xFF4ADE80),
    onTertiary: Color(0xFF053D1B),
    error: Color(0xFFF87171),
    onError: Color(0xFF3F0A0A),
    errorContainer: Color(0xFF7F1D1D),
    onErrorContainer: Color(0xFFFEE2E2),
    surface: Color(0xFF0B1220),
    onSurface: Color(0xFFE2E8F0),
    onSurfaceVariant: Color(0xFFA8B4C8),
    outline: Color(0xFF7B88A0),
    outlineVariant: Color(0xFF283449),
    inverseSurface: Color(0xFFE2E8F0),
    onInverseSurface: Marque.encre,
    surfaceContainerLowest: Color(0xFF111A2E),
    surfaceContainerLow: Color(0xFF0F1727),
    surfaceContainer: Color(0xFF162036),
    surfaceContainerHigh: Color(0xFF1C2944),
    surfaceContainerHighest: Color(0xFF243352),
  );

  static ThemeData claire() => _construire(_clair, CouleursStatut.claires);
  static ThemeData sombre() => _construire(_sombre, CouleursStatut.sombres);

  static TextTheme _textes(ColorScheme c) {
    final base = GoogleFonts.interTextTheme(
      ThemeData(brightness: c.brightness).textTheme,
    ).apply(bodyColor: c.onSurface, displayColor: c.onSurface);
    TextStyle titre(double taille, FontWeight poids, double hauteur, [double espacement = 0]) =>
        GoogleFonts.plusJakartaSans(
          fontSize: taille,
          fontWeight: poids,
          height: hauteur / taille,
          letterSpacing: espacement,
          color: c.onSurface,
        );
    TextStyle? s(TextStyle? t, double taille, FontWeight poids, double hauteur,
            [double espacement = 0]) =>
        t?.copyWith(
            fontSize: taille,
            fontWeight: poids,
            height: hauteur / taille,
            letterSpacing: espacement);
    return base.copyWith(
      displayLarge: titre(36, FontWeight.w800, 44, -0.7),
      displayMedium: titre(30, FontWeight.w800, 38, -0.6),
      displaySmall: titre(28, FontWeight.w800, 34, -0.5),
      headlineLarge: titre(26, FontWeight.w800, 32, -0.4),
      headlineMedium: titre(22, FontWeight.w800, 28, -0.3),
      headlineSmall: titre(19, FontWeight.w700, 26, -0.2),
      titleLarge: titre(20, FontWeight.w700, 28, -0.2),
      titleMedium: s(base.titleMedium, 17, FontWeight.w700, 24),
      titleSmall: s(base.titleSmall, 15, FontWeight.w700, 22),
      bodyLarge: s(base.bodyLarge, 17, FontWeight.w400, 26),
      bodyMedium: s(base.bodyMedium, 15, FontWeight.w400, 22),
      bodySmall: s(base.bodySmall, 13, FontWeight.w500, 18),
      labelLarge: s(base.labelLarge, 15, FontWeight.w700, 22, 0.1),
      labelMedium: s(base.labelMedium, 13, FontWeight.w600, 18, 0.1),
      labelSmall: s(base.labelSmall, 11, FontWeight.w700, 14, 0.4),
    );
  }

  static ThemeData _construire(ColorScheme c, CouleursStatut statut) {
    final textes = _textes(c);
    final arrondi = RoundedRectangleBorder(borderRadius: BorderRadius.circular(Marque.rayonBouton));
    return ThemeData(
      useMaterial3: true,
      colorScheme: c,
      scaffoldBackgroundColor: c.surface,
      textTheme: textes,
      extensions: [statut],
      visualDensity: VisualDensity.standard,
      materialTapTargetSize: MaterialTapTargetSize.padded,
      appBarTheme: AppBarTheme(
        backgroundColor: c.surfaceContainerLowest,
        foregroundColor: c.onSurface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0.5,
        centerTitle: false,
        titleTextStyle: textes.titleLarge,
      ),
      cardTheme: CardThemeData(
        color: c.surfaceContainerLowest,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Marque.rayonCarte),
          side: BorderSide(color: statut.bordure),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(48, 54),
          padding: const EdgeInsets.symmetric(horizontal: 24),
          shape: arrondi,
          textStyle: textes.labelLarge?.copyWith(fontSize: 16),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(48, 52),
          padding: const EdgeInsets.symmetric(horizontal: 18),
          shape: arrondi,
          side: BorderSide(color: statut.bordure, width: 1.5),
          foregroundColor: c.onSurface,
          backgroundColor: c.surfaceContainerLowest,
          textStyle: textes.labelLarge,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          minimumSize: const Size(48, 48),
          shape: arrondi,
          textStyle: textes.labelLarge,
        ),
      ),
      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(minimumSize: const Size(48, 48)),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: c.surfaceContainerLowest,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Marque.rayonBouton),
          borderSide: BorderSide(color: statut.bordure, width: 1.5),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Marque.rayonBouton),
          borderSide: BorderSide(color: statut.bordure, width: 1.5),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Marque.rayonBouton),
          borderSide: BorderSide(color: c.primary, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Marque.rayonBouton),
          borderSide: BorderSide(color: c.error, width: 1.5),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Marque.rayonBouton),
          borderSide: BorderSide(color: c.error, width: 2),
        ),
        labelStyle: textes.bodyMedium?.copyWith(color: c.onSurfaceVariant),
        floatingLabelStyle: textes.labelMedium?.copyWith(color: c.primary),
        helperStyle: textes.bodySmall?.copyWith(color: c.onSurfaceVariant),
        errorStyle: textes.bodySmall?.copyWith(color: c.error),
        prefixIconColor: c.onSurfaceVariant,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: c.surfaceContainerLowest,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        height: 76,
        indicatorColor: c.primaryContainer,
        indicatorShape: const StadiumBorder(),
        iconTheme: WidgetStateProperty.resolveWith((etats) => IconThemeData(
              color: etats.contains(WidgetState.selected) ? c.primary : c.onSurfaceVariant,
              size: 24,
            )),
        labelTextStyle: WidgetStateProperty.resolveWith((etats) {
          final actif = etats.contains(WidgetState.selected);
          return textes.labelMedium?.copyWith(
            fontWeight: actif ? FontWeight.w800 : FontWeight.w600,
            color: actif ? c.primary : c.onSurfaceVariant,
          );
        }),
      ),
      chipTheme: ChipThemeData(
        shape: const StadiumBorder(),
        labelStyle: textes.labelMedium,
        side: BorderSide(color: statut.bordure, width: 1.5),
        backgroundColor: c.surfaceContainerLowest,
        selectedColor: c.onSurface,
        secondarySelectedColor: c.onSurface,
        checkmarkColor: c.surface,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith(
            (e) => e.contains(WidgetState.selected) ? Colors.white : null),
        trackColor: WidgetStateProperty.resolveWith(
            (e) => e.contains(WidgetState.selected) ? c.primary : null),
        trackOutlineColor: WidgetStateProperty.resolveWith(
            (e) => e.contains(WidgetState.selected) ? c.primary : null),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: c.surfaceContainerLowest,
        surfaceTintColor: Colors.transparent,
        showDragHandle: true,
        dragHandleColor: c.surfaceContainerHighest,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(Marque.rayonFeuille)),
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: c.surfaceContainerLowest,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Marque.rayonCarte)),
        titleTextStyle: textes.headlineSmall,
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: c.inverseSurface,
        shape: arrondi,
        contentTextStyle: textes.bodyMedium?.copyWith(color: c.onInverseSurface),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(color: c.primary),
      dividerTheme: DividerThemeData(color: statut.bordure, space: 1),
      listTileTheme: ListTileThemeData(
        minVerticalPadding: 12,
        iconColor: c.onSurfaceVariant,
        titleTextStyle: textes.titleSmall,
        subtitleTextStyle: textes.bodySmall?.copyWith(color: c.onSurfaceVariant),
      ),
    );
  }
}
