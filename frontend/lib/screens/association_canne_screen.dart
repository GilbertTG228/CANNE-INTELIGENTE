import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../config/theme.dart';
import '../controllers/association_controller.dart';
import '../controllers/auth_controller.dart';
import '../controllers/navigation_controller.dart';
import '../controllers/suivi_controller.dart';
import '../services/repository.dart';
import '../widgets/bandeau_message.dart';
import '../widgets/composants.dart';

/// Identification et association de la canne, en trois étapes :
///  1. identifiant + code à 6 chiffres imprimés sur l'étiquette → vérification serveur ;
///  2. nom et téléphone de la personne malvoyante (pré-remplis si connus) → association ;
///  3. confirmation, puis redirection automatique vers le tableau de bord.
///
/// [integre] : affiché par l'application quand le compte ne suit encore
/// aucune canne (premier usage). Sinon, l'écran est ouvert par-dessus
/// (« Associer une autre canne ») et se ferme à la fin.
class AssociationCanneScreen extends StatelessWidget {
  const AssociationCanneScreen({super.key, this.integre = false});

  final bool integre;

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (ctx) => AssociationController(ctx.read<Repository>()),
      child: _ParcoursAssociation(integre: integre),
    );
  }
}

class _ParcoursAssociation extends StatefulWidget {
  const _ParcoursAssociation({required this.integre});
  final bool integre;

  @override
  State<_ParcoursAssociation> createState() => _ParcoursAssociationState();
}

class _ParcoursAssociationState extends State<_ParcoursAssociation> {
  static const _delaiRedirection = Duration(seconds: 3);
  Timer? _redirection;
  bool _fini = false;

  @override
  void dispose() {
    _redirection?.cancel();
    super.dispose();
  }

  /// Association réussie : redirection automatique après la confirmation.
  void _planifierRedirection() {
    _redirection?.cancel();
    _redirection = Timer(_delaiRedirection, _allerAuTableauDeBord);
  }

  Future<void> _allerAuTableauDeBord() async {
    if (_fini || !mounted) return;
    _fini = true;
    _redirection?.cancel();
    final canne = context.read<AssociationController>().canneAssociee;
    final suivi = context.read<SuiviController>();
    final nav = context.read<NavigationController>();
    final navigateur = Navigator.of(context);
    nav.aller(0);
    if (!widget.integre) navigateur.pop(true);
    // En mode intégré, l'actualisation fait apparaître le tableau de bord
    // (la liste des cannes n'est plus vide) : cet écran est alors remplacé.
    await suivi.rafraichir();
    if (canne != null) await suivi.selectionner(canne.id);
  }

  Future<bool> _quitterPossible() async {
    final ctrl = context.read<AssociationController>();
    if (ctrl.etape == EtapeAssociation.personne && !ctrl.enCours) {
      ctrl.recommencer();
      return false;
    }
    return true;
  }

  @override
  Widget build(BuildContext context) {
    final ctrl = context.watch<AssociationController>();
    final c = context.couleurs;

    return PopScope(
      canPop: ctrl.etape != EtapeAssociation.personne && !widget.integre,
      onPopInvokedWithResult: (aQuitte, _) async {
        if (aQuitte) return;
        final peut = await _quitterPossible();
        if (peut && mounted && !widget.integre) Navigator.of(context).pop();
      },
      child: Scaffold(
        backgroundColor: c.surfaceContainerLowest,
        appBar: AppBar(
          backgroundColor: c.surfaceContainerLowest,
          automaticallyImplyLeading: !widget.integre || ctrl.etape == EtapeAssociation.personne,
          leading: ctrl.etape == EtapeAssociation.personne
              ? IconButton(
                  tooltip: 'Retour à l\'identification',
                  onPressed: ctrl.enCours ? null : ctrl.recommencer,
                  icon: const Icon(Icons.arrow_back_rounded),
                )
              : null,
          title: Text(widget.integre ? 'Votre canne' : 'Associer une canne'),
          actions: [
            if (widget.integre && ctrl.etape != EtapeAssociation.terminee)
              TextButton(
                onPressed: () => context.read<AuthController>().deconnexion(),
                child: const Text('Déconnexion'),
              ),
          ],
        ),
        body: SafeArea(
          child: Column(
            children: [
              _Progression(etape: ctrl.numeroEtape),
              Expanded(
                child: Center(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 460),
                      child: AnimatedSwitcher(
                        duration: const Duration(milliseconds: 250),
                        child: switch (ctrl.etape) {
                          EtapeAssociation.identification =>
                            _EtapeIdentification(key: const ValueKey('id'), integre: widget.integre),
                          EtapeAssociation.personne => const _EtapePersonne(key: ValueKey('personne')),
                          EtapeAssociation.terminee => _EtapeTerminee(
                              key: const ValueKey('fin'),
                              surApparition: _planifierRedirection,
                              surContinuer: _allerAuTableauDeBord,
                            ),
                        },
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// --- Progression ---------------------------------------------------------------

class _Progression extends StatelessWidget {
  const _Progression({required this.etape});
  final int etape;

  static const _libelles = ['Identifier', 'Personne suivie', 'Confirmation'];

  @override
  Widget build(BuildContext context) {
    final c = context.couleurs;
    return Semantics(
      label: 'Étape $etape sur 3 : ${_libelles[etape - 1]}',
      excludeSemantics: true,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 4, 24, 12),
        child: Row(
          children: [
            for (var i = 1; i <= 3; i++) ...[
              if (i > 1) const SizedBox(width: 6),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    AnimatedContainer(
                      duration: const Duration(milliseconds: 250),
                      height: 5,
                      decoration: BoxDecoration(
                        color: i <= etape ? c.primary : c.surfaceContainerHigh,
                        borderRadius: BorderRadius.circular(3),
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      _libelles[i - 1],
                      style: context.textes.labelSmall?.copyWith(
                        color: i == etape ? c.primary : c.onSurfaceVariant,
                        fontWeight: i == etape ? FontWeight.w800 : FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// --- Étape 1 : identification ----------------------------------------------------

class _EtapeIdentification extends StatefulWidget {
  const _EtapeIdentification({super.key, required this.integre});
  final bool integre;

  @override
  State<_EtapeIdentification> createState() => _EtapeIdentificationState();
}

class _EtapeIdentificationState extends State<_EtapeIdentification> {
  final _formulaire = GlobalKey<FormState>();
  late final TextEditingController _identifiant;
  final _code = TextEditingController();

  @override
  void initState() {
    super.initState();
    _identifiant = TextEditingController(text: context.read<AssociationController>().identifiant);
  }

  @override
  void dispose() {
    _identifiant.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _verifier() async {
    if (!_formulaire.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    await context.read<AssociationController>().verifier(_identifiant.text, _code.text);
  }

  @override
  Widget build(BuildContext context) {
    final ctrl = context.watch<AssociationController>();
    final c = context.couleurs;
    return Form(
      key: _formulaire,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 8),
          Center(
            child: Container(
              width: 76,
              height: 76,
              decoration: BoxDecoration(color: c.primaryContainer, borderRadius: BorderRadius.circular(24)),
              child: Icon(Icons.qr_code_2_rounded, size: 42, color: c.primary),
            ),
          ),
          const SizedBox(height: 20),
          Semantics(
            header: true,
            child: Text(
              widget.integre ? 'Associez la canne de votre proche' : 'Identifier la canne',
              style: context.textes.headlineMedium,
              textAlign: TextAlign.center,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'L\'identifiant et le code à 6 chiffres sont imprimés sur l\'étiquette '
            'fixée sous la poignée de la canne.',
            style: context.textes.bodyLarge?.copyWith(color: c.onSurfaceVariant),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 24),
          TextFormField(
            controller: _identifiant,
            enabled: !ctrl.enCours,
            textCapitalization: TextCapitalization.characters,
            textInputAction: TextInputAction.next,
            autocorrect: false,
            style: context.textes.bodyLarge?.copyWith(fontWeight: FontWeight.w600),
            onChanged: (_) => ctrl.effacerErreur(),
            decoration: const InputDecoration(
              labelText: 'Identifiant de la canne (Cane ID)',
              hintText: 'CANNE-0001',
              prefixIcon: Icon(Icons.sensors_rounded),
            ),
            validator: (v) => (v == null || v.trim().length < 3) ? 'Saisissez l\'identifiant inscrit sur la canne.' : null,
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: _code,
            enabled: !ctrl.enCours,
            keyboardType: TextInputType.number,
            textInputAction: TextInputAction.done,
            onFieldSubmitted: (_) => _verifier(),
            onChanged: (_) => ctrl.effacerErreur(),
            inputFormatters: [
              FilteringTextInputFormatter.digitsOnly,
              LengthLimitingTextInputFormatter(6),
            ],
            style: context.textes.bodyLarge?.copyWith(letterSpacing: 6, fontWeight: FontWeight.w700),
            decoration: const InputDecoration(
              labelText: 'Code d\'association',
              hintText: '• • • • • •',
              helperText: 'Il prouve que vous avez la canne en main.',
              prefixIcon: Icon(Icons.pin_outlined),
            ),
            validator: (v) => (v == null || v.trim().length != 6) ? 'Le code comporte 6 chiffres.' : null,
          ),
          if (ctrl.erreur != null) ...[
            const SizedBox(height: 16),
            _CarteErreur(erreur: ctrl.erreur!, message: ctrl.messageErreur, surReessayer: _verifier),
          ],
          const SizedBox(height: 24),
          FilledButton.icon(
            onPressed: ctrl.enCours ? null : _verifier,
            icon: ctrl.enCours ? const ChargementBouton() : const Icon(Icons.verified_outlined),
            label: Text(ctrl.enCours ? 'Vérification en cours…' : 'Vérifier la canne'),
          ),
          const SizedBox(height: 16),
          Text(
            'Pas encore de canne ? L\'administrateur peut enregistrer une canne de test : '
            'un téléphone jouera son rôle avec de vraies positions GPS (Paramètres › Tester sans canne physique).',
            style: context.textes.bodySmall?.copyWith(color: c.onSurfaceVariant),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

// --- Étape 2 : personne suivie ------------------------------------------------------

class _EtapePersonne extends StatefulWidget {
  const _EtapePersonne({super.key});

  @override
  State<_EtapePersonne> createState() => _EtapePersonneState();
}

class _EtapePersonneState extends State<_EtapePersonne> {
  final _formulaire = GlobalKey<FormState>();
  late final TextEditingController _nom;
  late final TextEditingController _telephone;

  @override
  void initState() {
    super.initState();
    final v = context.read<AssociationController>().verifiee!;
    _nom = TextEditingController(text: v.nomAPreciser ? '' : v.nom);
    _telephone = TextEditingController(text: v.telephonePersonne ?? '');
  }

  @override
  void dispose() {
    _nom.dispose();
    _telephone.dispose();
    super.dispose();
  }

  Future<void> _associer() async {
    final ctrl = context.read<AssociationController>();
    if (ctrl.verifiee!.seraPrincipal && !_formulaire.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    await ctrl.associer(nomPersonne: _nom.text, telephonePersonne: _telephone.text);
  }

  @override
  Widget build(BuildContext context) {
    final ctrl = context.watch<AssociationController>();
    final v = ctrl.verifiee!;
    final c = context.couleurs;
    final s = context.statut;
    final principal = v.seraPrincipal;

    return Form(
      key: _formulaire,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            liveRegion: true,
            child: Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(color: s.nominalFond, borderRadius: BorderRadius.circular(16)),
              child: Row(
                children: [
                  Icon(Icons.check_circle_rounded, color: s.nominal, size: 30),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Canne ${v.identifiant} reconnue',
                            style: context.textes.titleSmall?.copyWith(color: s.nominalTexte)),
                        Text(
                          principal
                              ? 'Elle est active et disponible. Vous en serez le proche principal.'
                              : 'Déjà suivie par ${v.nombreProches} proche${v.nombreProches > 1 ? 's' : ''} : le partage est autorisé.',
                          style: context.textes.bodySmall?.copyWith(color: s.nominalTexte),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),
          Semantics(
            header: true,
            child: Text('La personne suivie', style: context.textes.headlineMedium),
          ),
          const SizedBox(height: 6),
          Text(
            principal
                ? 'Ces informations servent à l\'identifier dans l\'application et au bouton « Appeler ».'
                : 'Ces informations sont gérées par le proche principal.',
            style: context.textes.bodyMedium?.copyWith(color: c.onSurfaceVariant),
          ),
          const SizedBox(height: 18),
          TextFormField(
            controller: _nom,
            enabled: principal && !ctrl.enCours,
            readOnly: !principal,
            textCapitalization: TextCapitalization.words,
            textInputAction: TextInputAction.next,
            style: context.textes.bodyLarge,
            decoration: const InputDecoration(
              labelText: 'Nom de la personne malvoyante',
              hintText: 'Ex. Ama Mensah',
              prefixIcon: Icon(Icons.person_outline_rounded),
            ),
            validator: (val) => (val == null || val.trim().length < 2) ? 'Indiquez son prénom et son nom.' : null,
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: _telephone,
            enabled: principal && !ctrl.enCours,
            readOnly: !principal,
            keyboardType: TextInputType.phone,
            textInputAction: TextInputAction.done,
            onFieldSubmitted: (_) => _associer(),
            inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9+ ]'))],
            style: context.textes.bodyLarge,
            decoration: const InputDecoration(
              labelText: 'Son numéro de téléphone',
              hintText: '+228 90 00 00 00',
              prefixIcon: Icon(Icons.phone_outlined),
            ),
            validator: (val) {
              final chiffres = (val ?? '').replaceAll(RegExp(r'[^0-9]'), '');
              if (chiffres.isEmpty) return 'Indiquez son numéro pour pouvoir l\'appeler et l\'informer.';
              if (chiffres.length < 6 || chiffres.length > 15) return 'Numéro invalide.';
              return null;
            },
          ),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(color: c.primaryContainer, borderRadius: BorderRadius.circular(16)),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.sms_outlined, color: c.primary),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'Par transparence, un SMS informera la personne que vous suivez la position de sa canne. '
                    'Elle pourra demander l\'arrêt du suivi à tout moment.',
                    style: context.textes.bodySmall?.copyWith(color: c.onPrimaryContainer),
                  ),
                ),
              ],
            ),
          ),
          if (ctrl.erreur != null) ...[
            const SizedBox(height: 16),
            _CarteErreur(erreur: ctrl.erreur!, message: ctrl.messageErreur, surReessayer: _associer),
          ],
          const SizedBox(height: 24),
          FilledButton.icon(
            onPressed: ctrl.enCours ? null : _associer,
            icon: ctrl.enCours ? const ChargementBouton() : const Icon(Icons.link_rounded),
            label: Text(ctrl.enCours ? 'Association en cours…' : 'Associer la canne'),
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: ctrl.enCours ? null : ctrl.recommencer,
            child: const Text('Ce n\'est pas la bonne canne'),
          ),
        ],
      ),
    );
  }
}

// --- Étape 3 : confirmation --------------------------------------------------------

class _EtapeTerminee extends StatefulWidget {
  const _EtapeTerminee({super.key, required this.surApparition, required this.surContinuer});
  final VoidCallback surApparition;
  final VoidCallback surContinuer;

  @override
  State<_EtapeTerminee> createState() => _EtapeTermineeState();
}

class _EtapeTermineeState extends State<_EtapeTerminee> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.surApparition();
    });
  }

  @override
  Widget build(BuildContext context) {
    final ctrl = context.watch<AssociationController>();
    final r = ctrl.resultat!;
    final c = context.couleurs;
    final s = context.statut;
    final tel = r.canne.telephonePersonne;
    return Semantics(
      liveRegion: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 24),
          Center(
            child: TweenAnimationBuilder<double>(
              tween: Tween(begin: 0.6, end: 1),
              duration: const Duration(milliseconds: 450),
              curve: Curves.easeOutBack,
              builder: (_, echelle, enfant) => Transform.scale(scale: echelle, child: enfant),
              child: Container(
                width: 104,
                height: 104,
                decoration: BoxDecoration(color: s.nominalFond, shape: BoxShape.circle),
                child: Icon(Icons.check_rounded, size: 60, color: s.nominal),
              ),
            ),
          ),
          const SizedBox(height: 24),
          Text('Canne associée', style: context.textes.headlineLarge, textAlign: TextAlign.center),
          const SizedBox(height: 8),
          Text(
            'Vous suivez maintenant ${r.canne.nom}.',
            style: context.textes.bodyLarge?.copyWith(color: c.onSurfaceVariant),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 20),
          CarteBlanche(
            child: Row(
              children: [
                AvatarInitiales(nom: r.canne.nom),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(r.canne.nom, style: context.textes.titleMedium),
                      Text(
                        '${r.canne.identifiant}${r.canne.principal ? ' · proche principal' : ''}',
                        style: context.textes.bodySmall?.copyWith(color: c.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          if (tel != null && tel.isNotEmpty) ...[
            const SizedBox(height: 12),
            BandeauMessage(
              type: r.smsEnvoye ? TypeBandeau.succes : TypeBandeau.avertissement,
              message: r.smsEnvoye
                  ? 'SMS d\'information envoyé au $tel.'
                  : 'Le SMS d\'information n\'a pas pu être envoyé au $tel.',
            ),
          ],
          const SizedBox(height: 28),
          FilledButton.icon(
            onPressed: widget.surContinuer,
            icon: const Icon(Icons.map_outlined),
            label: const Text('Accéder au tableau de bord'),
          ),
          const SizedBox(height: 10),
          Text(
            'Redirection automatique dans quelques secondes…',
            style: context.textes.bodySmall?.copyWith(color: c.onSurfaceVariant),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

// --- Messages d'erreur -------------------------------------------------------------

class _CarteErreur extends StatelessWidget {
  const _CarteErreur({required this.erreur, required this.message, required this.surReessayer});

  final ErreurAssociation erreur;
  final String? message;
  final VoidCallback surReessayer;

  @override
  Widget build(BuildContext context) {
    final s = context.statut;
    final (icone, titre, texte, reessayer) = switch (erreur) {
      ErreurAssociation.identifiantInvalide => (
          Icons.error_outline_rounded,
          'Identifiant ou code incorrect',
          'Vérifiez l\'étiquette : l\'identifiant ressemble à CANNE-0001 et le code comporte 6 chiffres.',
          false,
        ),
      ErreurAssociation.canneDesactivee => (
          Icons.block_rounded,
          'Canne désactivée',
          'Cette canne a été mise hors service par l\'administrateur (perte, réparation…). Contactez-le pour la réactiver.',
          false,
        ),
      ErreurAssociation.dejaAssocieeAutreCompte => (
          Icons.lock_person_outlined,
          'Canne déjà associée à un autre compte',
          'Pour la suivre aussi, demandez au proche principal d\'activer « Autoriser d\'autres proches » dans ses paramètres, '
              'ou adressez-vous à l\'administrateur.',
          false,
        ),
      ErreurAssociation.dejaSuivie => (
          Icons.info_outline_rounded,
          'Vous suivez déjà cette canne',
          'Elle figure déjà dans votre liste de personnes suivies.',
          false,
        ),
      ErreurAssociation.tropDEssais => (
          Icons.hourglass_bottom_rounded,
          'Trop de tentatives',
          message ?? 'Patientez quelques minutes avant de réessayer.',
          false,
        ),
      ErreurAssociation.reseau => (
          Icons.wifi_off_rounded,
          'Pas de connexion',
          message ?? 'Vérifiez votre connexion Internet.',
          true,
        ),
      ErreurAssociation.serveur => (
          Icons.cloud_off_rounded,
          'Serveur indisponible',
          message ?? 'Réessayez dans quelques instants.',
          true,
        ),
      ErreurAssociation.saisie || ErreurAssociation.autre => (
          Icons.error_outline_rounded,
          'Opération impossible',
          message ?? 'Une erreur est survenue.',
          true,
        ),
    };
    final avert = erreur == ErreurAssociation.dejaSuivie || erreur == ErreurAssociation.tropDEssais;
    final fond = avert ? s.avertFond : s.critiqueFond;
    final couleur = avert ? s.avertTexte : s.critiqueTexte;
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: fond, borderRadius: BorderRadius.circular(16)),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icone, color: couleur),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(titre, style: context.textes.titleSmall?.copyWith(color: couleur)),
                  const SizedBox(height: 2),
                  Text(texte, style: context.textes.bodySmall?.copyWith(color: couleur)),
                  if (reessayer) ...[
                    const SizedBox(height: 6),
                    TextButton.icon(
                      style: TextButton.styleFrom(foregroundColor: couleur, padding: EdgeInsets.zero),
                      onPressed: surReessayer,
                      icon: const Icon(Icons.refresh_rounded),
                      label: const Text('Réessayer'),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
