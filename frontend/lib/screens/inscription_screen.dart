import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../config/theme.dart';
import '../controllers/auth_controller.dart';
import '../services/api_client.dart';
import '../widgets/bandeau_message.dart';

/// Création d'un compte de proche aidant (nom, téléphone, mot de passe).
/// Une fois inscrit, le proche associe sa première canne avec le code fourni.
class InscriptionScreen extends StatefulWidget {
  const InscriptionScreen({super.key});

  @override
  State<InscriptionScreen> createState() => _InscriptionScreenState();
}

class _InscriptionScreenState extends State<InscriptionScreen> {
  final _formulaire = GlobalKey<FormState>();
  final _nom = TextEditingController();
  final _telephone = TextEditingController();
  final _motDePasse = TextEditingController();
  final _confirmation = TextEditingController();
  bool _masque = true;
  bool _envoi = false;
  String? _erreur;

  @override
  void dispose() {
    _nom.dispose();
    _telephone.dispose();
    _motDePasse.dispose();
    _confirmation.dispose();
    super.dispose();
  }

  Future<void> _valider() async {
    if (!_formulaire.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _envoi = true;
      _erreur = null;
    });
    final auth = context.read<AuthController>();
    final navigateur = Navigator.of(context);
    try {
      await auth.inscription(_nom.text.trim(), _telephone.text.trim(), _motDePasse.text);
      // Connecté : l'écran d'accueil remplace l'écran de connexion sous cette page.
      navigateur.popUntil((route) => route.isFirst);
    } on ApiException catch (e) {
      if (mounted) setState(() => _erreur = e.message);
    } finally {
      if (mounted) setState(() => _envoi = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.couleurs;
    return Scaffold(
      backgroundColor: c.surfaceContainerLowest,
      appBar: AppBar(title: const Text('Créer un compte')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: AutofillGroup(
                child: Form(
                  key: _formulaire,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Semantics(
                        header: true,
                        child: Text('Votre compte de proche', style: context.textes.headlineLarge),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Il vous permet de suivre la canne de votre proche et de recevoir ses alertes. '
                        'Vous associerez la canne juste après.',
                        style: context.textes.bodyLarge?.copyWith(color: c.onSurfaceVariant),
                      ),
                      const SizedBox(height: 24),
                      TextFormField(
                        controller: _nom,
                        textCapitalization: TextCapitalization.words,
                        textInputAction: TextInputAction.next,
                        autofillHints: const [AutofillHints.name],
                        style: context.textes.bodyLarge,
                        decoration: const InputDecoration(
                          labelText: 'Votre nom',
                          prefixIcon: Icon(Icons.person_outline_rounded),
                        ),
                        validator: (v) =>
                            (v == null || v.trim().length < 2) ? 'Saisissez votre nom.' : null,
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: _telephone,
                        keyboardType: TextInputType.phone,
                        textInputAction: TextInputAction.next,
                        autofillHints: const [AutofillHints.telephoneNumber],
                        style: context.textes.bodyLarge,
                        decoration: const InputDecoration(
                          labelText: 'Numéro de téléphone',
                          helperText: 'Il vous servira à vous connecter.',
                          prefixIcon: Icon(Icons.phone_outlined),
                        ),
                        validator: (v) {
                          final chiffres = (v ?? '').replaceAll(RegExp(r'\D'), '');
                          return chiffres.length < 6 ? 'Saisissez un numéro valide.' : null;
                        },
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: _motDePasse,
                        obscureText: _masque,
                        textInputAction: TextInputAction.next,
                        autofillHints: const [AutofillHints.newPassword],
                        style: context.textes.bodyLarge,
                        decoration: InputDecoration(
                          labelText: 'Mot de passe',
                          helperText: '8 caractères minimum.',
                          prefixIcon: const Icon(Icons.lock_outline),
                          suffixIcon: IconButton(
                            tooltip: _masque ? 'Afficher le mot de passe' : 'Masquer le mot de passe',
                            onPressed: () => setState(() => _masque = !_masque),
                            icon: Icon(_masque ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                          ),
                        ),
                        validator: (v) =>
                            (v == null || v.length < 8) ? 'Au moins 8 caractères.' : null,
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: _confirmation,
                        obscureText: _masque,
                        textInputAction: TextInputAction.done,
                        onFieldSubmitted: (_) => _valider(),
                        style: context.textes.bodyLarge,
                        decoration: const InputDecoration(
                          labelText: 'Confirmez le mot de passe',
                          prefixIcon: Icon(Icons.lock_outline),
                        ),
                        validator: (v) =>
                            v != _motDePasse.text ? 'Les mots de passe ne correspondent pas.' : null,
                      ),
                      if (_erreur != null) ...[
                        const SizedBox(height: 16),
                        BandeauMessage(message: _erreur!),
                      ],
                      const SizedBox(height: 24),
                      FilledButton(
                        onPressed: _envoi ? null : _valider,
                        child: _envoi ? const ChargementBouton() : const Text('Créer mon compte'),
                      ),
                      const SizedBox(height: 8),
                      TextButton(
                        onPressed: _envoi ? null : () => Navigator.of(context).pop(),
                        child: const Text('J\'ai déjà un compte'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
