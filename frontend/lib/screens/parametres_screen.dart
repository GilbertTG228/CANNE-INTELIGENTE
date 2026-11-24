import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config/app_config.dart';
import '../config/theme.dart';
import '../controllers/auth_controller.dart';
import '../controllers/settings_controller.dart';
import '../controllers/suivi_controller.dart';
import '../services/api_client.dart';
import '../services/repository.dart';
import 'association_canne_screen.dart';
import 'onboarding_screen.dart';
import 'protection_donnees_screen.dart';
import 'selection_point_screen.dart';

/// Paramètres : profil, canne inactive, notifications, apparence, domicile,
/// données personnelles, déconnexion.
class ParametresScreen extends StatelessWidget {
  const ParametresScreen({super.key});

  /// Autorise ou non d'autres proches à s'associer (proche principal uniquement).
  Future<void> _modifierPartage(BuildContext context, bool autorise) async {
    final suivi = context.read<SuiviController>();
    final repo = context.read<Repository>();
    final messager = ScaffoldMessenger.of(context);
    final canne = suivi.canne;
    if (canne == null) return;
    try {
      await repo.modifierPartage(canne.id, autorise);
      await suivi.rafraichir();
      messager.showSnackBar(SnackBar(
        content: Text(autorise
            ? 'D\'autres proches peuvent maintenant s\'associer à la canne.'
            : 'Vous êtes désormais le seul à pouvoir ajouter cette canne.'),
      ));
    } on ApiException catch (e) {
      messager.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  /// Envoie délai et notifications au serveur (PUT /api/utilisateur/parametres).
  /// Les réglages restent enregistrés sur le téléphone même si l'envoi échoue.
  Future<void> _synchroniser(BuildContext context) async {
    final reglages = context.read<SettingsController>();
    final repo = context.read<Repository>();
    final messager = ScaffoldMessenger.of(context);
    try {
      await repo.enregistrerParametres(
        delaiInactiviteMinutes: reglages.delaiInactiviteMin,
        notificationsActives: reglages.notificationsActives,
      );
    } on ApiException catch (e) {
      messager.showSnackBar(SnackBar(
        content: Text('Réglage enregistré sur ce téléphone, mais pas sur le serveur : ${e.message}'),
      ));
    }
  }

  Future<void> _modifierNom(BuildContext context, SettingsController r) async {
    final controleur = TextEditingController(text: r.nomAffiche);
    final nom = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Votre nom'),
        content: TextField(
          controller: controleur,
          autofocus: true,
          textCapitalization: TextCapitalization.words,
          decoration: const InputDecoration(labelText: 'Nom affiché'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Annuler')),
          FilledButton(onPressed: () => Navigator.pop(ctx, controleur.text), child: const Text('Enregistrer')),
        ],
      ),
    );
    controleur.dispose();
    if (nom == null || nom.trim().isEmpty) return;
    await r.definirNomAffiche(nom);
    if (!context.mounted) return;
    final repo = context.read<Repository>();
    final messager = ScaffoldMessenger.of(context);
    try {
      await repo.enregistrerNom(nom.trim());
    } on ApiException catch (e) {
      messager.showSnackBar(SnackBar(
        content: Text('Nom enregistré sur ce téléphone, mais pas sur le serveur : ${e.message}'),
      ));
    }
  }

  Future<void> _changerMotDePasse(BuildContext context) async {
    final change = await showDialog<bool>(
      context: context,
      builder: (_) => const _DialogueMotDePasse(),
    );
    if (change == true && context.mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Mot de passe modifié.')));
    }
  }

  Future<void> _associer(BuildContext context) async {
    await Navigator.of(context).push(
      MaterialPageRoute<bool>(builder: (_) => const AssociationCanneScreen()),
    );
  }

  Future<void> _nePlusSuivre(BuildContext context) async {
    final suivi = context.read<SuiviController>();
    final repo = context.read<Repository>();
    final messager = ScaffoldMessenger.of(context);
    final canne = suivi.canne;
    if (canne == null) return;
    final confirme = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Ne plus suivre ${canne.nom} ?'),
        content: const Text(
            'Vous ne verrez plus sa position et ne recevrez plus ses alertes. '
            'Vous pourrez l\'associer de nouveau avec son code.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Annuler')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: ctx.statut.critique),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Ne plus suivre'),
          ),
        ],
      ),
    );
    if (confirme != true) return;
    try {
      await repo.dissocierCanne(canne.id);
      await suivi.rafraichir();
      messager.showSnackBar(SnackBar(content: Text('Vous ne suivez plus ${canne.nom}.')));
    } on ApiException catch (e) {
      messager.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _choisirDomicile(BuildContext context, SettingsController r) async {
    final point = await Navigator.of(context).push(
      MaterialPageRoute<dynamic>(
        builder: (_) => SelectionPointScreen(titre: 'Domicile', initial: r.domicile),
      ),
    );
    if (point != null) await r.definirDomicile(point);
  }

  Future<void> _testerSos(BuildContext context) async {
    final suivi = context.read<SuiviController>();
    final repo = context.read<Repository>();
    final messager = ScaffoldMessenger.of(context);
    final canne = suivi.canne;
    if (canne == null) return;
    final confirme = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Déclencher un SOS de test ?'),
        content: Text('Une alerte SOS sera simulée pour ${canne.nom}. Les autres proches la recevront aussi.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Annuler')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Déclencher')),
        ],
      ),
    );
    if (confirme != true) return;
    try {
      await repo.declencherSos(canne.id);
      messager.showSnackBar(const SnackBar(content: Text('SOS de test envoyé.')));
    } on ApiException catch (e) {
      messager.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _deconnecter(BuildContext context) async {
    final auth = context.read<AuthController>();
    final confirme = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Se déconnecter ?'),
        content: const Text(
            'Vous ne recevrez plus les alertes sur ce téléphone et les données enregistrées seront effacées.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Annuler')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: ctx.statut.critique),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Se déconnecter'),
          ),
        ],
      ),
    );
    if (confirme == true) await auth.deconnexion();
  }

  @override
  Widget build(BuildContext context) {
    final r = context.watch<SettingsController>();
    final suivi = context.watch<SuiviController>();
    final c = context.couleurs;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Paramètres'),
        backgroundColor: c.surface,
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const _Titre('Profil'),
            Card(
              child: Column(
                children: [
                  ListTile(
                    minTileHeight: 64,
                    leading: Icon(Icons.person_outline_rounded, color: c.primary),
                    title: Text(r.nomAffiche.isEmpty ? 'Nom non renseigné' : r.nomAffiche),
                    subtitle: const Text('Nom affiché'),
                    trailing: const Icon(Icons.edit_outlined),
                    onTap: () => _modifierNom(context, r),
                  ),
                  const Divider(),
                  ListTile(
                    minTileHeight: 64,
                    leading: Icon(Icons.phone_outlined, color: c.primary),
                    title: Text(r.telephone ?? '—'),
                    subtitle: const Text('Numéro de connexion'),
                  ),
                  const Divider(),
                  ListTile(
                    minTileHeight: 64,
                    leading: Icon(Icons.password_rounded, color: c.primary),
                    title: const Text('Changer le mot de passe'),
                    trailing: const Icon(Icons.chevron_right_rounded),
                    onTap: () => _changerMotDePasse(context),
                  ),
                ],
              ),
            ),
            const _Titre('Cannes suivies'),
            Card(
              child: Column(
                children: [
                  for (final canne in suivi.cannes)
                    ListTile(
                      minTileHeight: 64,
                      leading: Icon(
                        canne.id == suivi.canneId ? Icons.radio_button_checked : Icons.radio_button_off,
                        color: c.primary,
                      ),
                      title: Text(canne.nom),
                      subtitle: Text(canne.identifiant),
                      onTap: () => suivi.selectionner(canne.id),
                    ),
                  if (suivi.cannes.isNotEmpty) const Divider(),
                  ListTile(
                    minTileHeight: 56,
                    leading: Icon(Icons.add_link_rounded, color: c.primary),
                    title: const Text('Associer une canne'),
                    subtitle: const Text('Avec son identifiant et son code à 6 chiffres'),
                    onTap: () => _associer(context),
                  ),
                  if (suivi.canne != null && suivi.canne!.principal) ...[
                    const Divider(),
                    SwitchListTile(
                      secondary: Icon(Icons.group_add_outlined, color: c.primary),
                      title: const Text('Autoriser d\'autres proches'),
                      subtitle: Text(
                        'D\'autres proches pourront suivre ${suivi.canne!.nomCourt} avec le code de la canne.',
                      ),
                      value: suivi.canne!.partageAutorise,
                      onChanged: (v) => _modifierPartage(context, v),
                    ),
                  ],
                  if (suivi.canne != null) ...[
                    const Divider(),
                    ListTile(
                      minTileHeight: 56,
                      leading: Icon(Icons.link_off_rounded, color: context.statut.critique),
                      title: Text('Ne plus suivre ${suivi.canne!.nom}'),
                      onTap: () => _nePlusSuivre(context),
                    ),
                  ],
                ],
              ),
            ),
            const _Titre('Canne inactive'),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Alerter si la canne n\'envoie plus de position depuis :',
                        style: context.textes.bodyLarge),
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final m in AppConfig.delaisInactiviteMin)
                          ChoiceChip(
                            label: Text(m < 60 ? '$m min' : '${m ~/ 60} h'),
                            selected: r.delaiInactiviteMin == m,
                            onSelected: (_) async {
                              await r.definirDelaiInactivite(m);
                              if (context.mounted) await _synchroniser(context);
                            },
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const _Titre('Notifications'),
            Card(
              child: Column(
                children: [
                  SwitchListTile(
                    title: const Text('Recevoir les alertes'),
                    subtitle: const Text('SOS, chute, entrée en zone, batterie, inactivité'),
                    secondary: Icon(Icons.notifications_active_outlined, color: c.primary),
                    value: r.notificationsActives,
                    onChanged: (v) async {
                      await r.definirNotifications(v);
                      if (context.mounted) await _synchroniser(context);
                    },
                  ),
                  const Divider(),
                  SwitchListTile(
                    title: const Text('Sons'),
                    secondary: Icon(Icons.volume_up_outlined, color: c.primary),
                    value: r.sons,
                    onChanged: r.definirSons,
                  ),
                  const Divider(),
                  SwitchListTile(
                    title: const Text('Vibrations'),
                    secondary: Icon(Icons.vibration_rounded, color: c.primary),
                    value: r.vibrations,
                    onChanged: r.definirVibrations,
                  ),
                ],
              ),
            ),
            const _Titre('Domicile'),
            Card(
              child: Column(
                children: [
                  ListTile(
                    minTileHeight: 64,
                    leading: Icon(Icons.home_outlined, color: c.primary),
                    title: Text(r.domicile == null ? 'Non défini' : 'Domicile enregistré'),
                    subtitle: const Text('Destination possible de l\'itinéraire de retour'),
                    trailing: const Icon(Icons.edit_location_alt_outlined),
                    onTap: () => _choisirDomicile(context, r),
                  ),
                  if (r.domicile != null) ...[
                    const Divider(),
                    ListTile(
                      minTileHeight: 56,
                      leading: Icon(Icons.delete_outline_rounded, color: context.statut.critique),
                      title: const Text('Supprimer le domicile'),
                      onTap: () => r.definirDomicile(null),
                    ),
                  ],
                ],
              ),
            ),
            const _Titre('Données personnelles'),
            Card(
              child: ListTile(
                minTileHeight: 64,
                leading: Icon(Icons.verified_user_outlined, color: c.primary),
                title: const Text('Consentement et protection des données'),
                trailing: const Icon(Icons.chevron_right_rounded),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => const ProtectionDonneesScreen()),
                ),
              ),
            ),
            const _Titre('Tester sans canne physique'),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Icon(Icons.smartphone_rounded, color: c.primary),
                        const SizedBox(width: 12),
                        Expanded(child: Text('Un téléphone joue le rôle de la canne', style: context.textes.titleSmall)),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Sur le téléphone qui accompagnera la personne pendant le test, ouvrez la page « Canne virtuelle » '
                      'et activez-la avec le code donné par l\'administrateur. Ses vraies positions GPS arrivent ici '
                      'comme celles de la canne.',
                      style: context.textes.bodyMedium?.copyWith(color: c.onSurfaceVariant),
                    ),
                    const SizedBox(height: 8),
                    SelectableText(AppConfig.urlCanneVirtuelle, style: context.textes.labelLarge?.copyWith(color: c.primary)),
                    const SizedBox(height: 12),
                    OutlinedButton.icon(
                      onPressed: () => launchUrl(
                        Uri.parse(AppConfig.urlCanneVirtuelle),
                        mode: LaunchMode.externalApplication,
                      ),
                      icon: const Icon(Icons.open_in_new_rounded),
                      label: const Text('Ouvrir la canne virtuelle sur ce téléphone'),
                    ),
                  ],
                ),
              ),
            ),
            const _Titre('Aide'),
            Card(
              child: ListTile(
                minTileHeight: 64,
                leading: Icon(Icons.auto_stories_outlined, color: c.primary),
                title: const Text('Revoir la présentation'),
                subtitle: const Text('Les principales fonctions de l\'application'),
                trailing: const Icon(Icons.chevron_right_rounded),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => const OnboardingScreen(revoir: true)),
                ),
              ),
            ),
            const _Titre('Outils'),
            Card(
              child: ListTile(
                minTileHeight: 64,
                leading: Icon(Icons.sos_rounded, color: context.statut.critique),
                title: const Text('Tester une alerte SOS'),
                subtitle: const Text('Vérifie que les notifications arrivent bien'),
                onTap: () => _testerSos(context),
              ),
            ),
            const SizedBox(height: 24),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                foregroundColor: context.statut.critique,
                side: BorderSide(color: context.statut.critique, width: 1.5),
              ),
              onPressed: () => _deconnecter(context),
              icon: const Icon(Icons.logout_rounded),
              label: const Text('Se déconnecter'),
            ),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }
}

class _Titre extends StatelessWidget {
  const _Titre(this.texte);
  final String texte;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 24, 4, 8),
      child: Semantics(
        header: true,
        child: Text(texte, style: context.textes.titleMedium),
      ),
    );
  }
}

/// Changement du mot de passe (ancien + nouveau), avec erreurs affichées dans la fenêtre.
class _DialogueMotDePasse extends StatefulWidget {
  const _DialogueMotDePasse();

  @override
  State<_DialogueMotDePasse> createState() => _DialogueMotDePasseState();
}

class _DialogueMotDePasseState extends State<_DialogueMotDePasse> {
  final _formulaire = GlobalKey<FormState>();
  final _ancien = TextEditingController();
  final _nouveau = TextEditingController();
  bool _envoi = false;
  String? _erreur;

  @override
  void dispose() {
    _ancien.dispose();
    _nouveau.dispose();
    super.dispose();
  }

  Future<void> _valider() async {
    if (!_formulaire.currentState!.validate()) return;
    setState(() {
      _envoi = true;
      _erreur = null;
    });
    final repo = context.read<Repository>();
    final navigateur = Navigator.of(context);
    try {
      await repo.changerMotDePasse(_ancien.text, _nouveau.text);
      navigateur.pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _erreur = e.message);
    } finally {
      if (mounted) setState(() => _envoi = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Changer le mot de passe'),
      content: Form(
        key: _formulaire,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextFormField(
              controller: _ancien,
              obscureText: true,
              autofocus: true,
              decoration: const InputDecoration(labelText: 'Mot de passe actuel'),
              validator: (v) => (v == null || v.isEmpty) ? 'Saisissez votre mot de passe actuel.' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _nouveau,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Nouveau mot de passe', helperText: '8 caractères minimum.'),
              validator: (v) => (v == null || v.length < 8) ? 'Au moins 8 caractères.' : null,
            ),
            if (_erreur != null) ...[
              const SizedBox(height: 12),
              Text(_erreur!, style: TextStyle(color: context.couleurs.error, fontWeight: FontWeight.w600)),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _envoi ? null : () => Navigator.pop(context, false),
          child: const Text('Annuler'),
        ),
        FilledButton(
          onPressed: _envoi ? null : _valider,
          child: const Text('Enregistrer'),
        ),
      ],
    );
  }
}
