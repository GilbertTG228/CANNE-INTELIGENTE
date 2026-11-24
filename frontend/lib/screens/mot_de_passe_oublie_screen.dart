import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../config/theme.dart';
import '../services/api_client.dart';
import '../services/auth_service.dart';
import '../widgets/bandeau_message.dart';

/// Réinitialisation en deux étapes :
///  1. le proche saisit son numéro, le serveur envoie un code à 6 chiffres par SMS ;
///  2. il saisit ce code et choisit un nouveau mot de passe.
class MotDePasseOublieScreen extends StatefulWidget {
  const MotDePasseOublieScreen({super.key});

  @override
  State<MotDePasseOublieScreen> createState() => _MotDePasseOublieScreenState();
}

enum _Etape { numero, code, termine }

class _MotDePasseOublieScreenState extends State<MotDePasseOublieScreen> {
  final _formulaireNumero = GlobalKey<FormState>();
  final _formulaireCode = GlobalKey<FormState>();
  final _telephone = TextEditingController();
  final _code = TextEditingController();
  final _motDePasse = TextEditingController();
  _Etape _etape = _Etape.numero;
  bool _envoi = false;
  bool _masque = true;
  String? _erreur;

  @override
  void dispose() {
    _telephone.dispose();
    _code.dispose();
    _motDePasse.dispose();
    super.dispose();
  }

  Future<void> _executer(Future<void> Function() action, _Etape suivante) async {
    setState(() {
      _envoi = true;
      _erreur = null;
    });
    try {
      await action();
      if (mounted) setState(() => _etape = suivante);
    } on ApiException catch (e) {
      if (mounted) setState(() => _erreur = e.message);
    } finally {
      if (mounted) setState(() => _envoi = false);
    }
  }

  Future<void> _demanderCode() async {
    if (!_formulaireNumero.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    final auth = context.read<AuthService>();
    await _executer(() => auth.motDePasseOublie(_telephone.text.trim()), _Etape.code);
  }

  Future<void> _reinitialiser() async {
    if (!_formulaireCode.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    final auth = context.read<AuthService>();
    await _executer(
      () => auth.reinitialiserMotDePasse(_telephone.text.trim(), _code.text.trim(), _motDePasse.text),
      _Etape.termine,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Mot de passe oublié')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: switch (_etape) {
                _Etape.numero => _etapeNumero(context),
                _Etape.code => _etapeCode(context),
                _Etape.termine => _etapeTerminee(context),
              },
            ),
          ),
        ),
      ),
    );
  }

  Widget _erreurEventuelle() => _erreur == null
      ? const SizedBox.shrink()
      : Padding(padding: const EdgeInsets.only(top: 16), child: BandeauMessage(message: _erreur!));

  Widget _etapeNumero(BuildContext context) {
    return Form(
      key: _formulaireNumero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Saisissez le numéro de téléphone de votre compte. Nous vous enverrons un code par SMS pour choisir un nouveau mot de passe.',
            style: context.textes.bodyLarge?.copyWith(color: context.couleurs.onSurfaceVariant),
          ),
          const SizedBox(height: 24),
          TextFormField(
            controller: _telephone,
            keyboardType: TextInputType.phone,
            textInputAction: TextInputAction.done,
            onFieldSubmitted: (_) => _demanderCode(),
            style: context.textes.bodyLarge,
            decoration: const InputDecoration(
              labelText: 'Numéro de téléphone',
              prefixIcon: Icon(Icons.phone_outlined),
            ),
            validator: (v) =>
                (v == null || v.trim().length < 6) ? 'Saisissez votre numéro de téléphone.' : null,
          ),
          _erreurEventuelle(),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _envoi ? null : _demanderCode,
            child: _envoi ? const ChargementBouton() : const Text('Recevoir un code'),
          ),
        ],
      ),
    );
  }

  Widget _etapeCode(BuildContext context) {
    return Form(
      key: _formulaireCode,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const BandeauMessage(
            type: TypeBandeau.succes,
            message: 'Si ce numéro correspond à un compte, un code à 6 chiffres vient d\'être envoyé par SMS. Il est valable 15 minutes.',
          ),
          const SizedBox(height: 24),
          TextFormField(
            controller: _code,
            keyboardType: TextInputType.number,
            textInputAction: TextInputAction.next,
            autofillHints: const [AutofillHints.oneTimeCode],
            inputFormatters: [
              FilteringTextInputFormatter.digitsOnly,
              LengthLimitingTextInputFormatter(6),
            ],
            style: context.textes.bodyLarge?.copyWith(letterSpacing: 4),
            decoration: const InputDecoration(
              labelText: 'Code reçu par SMS',
              prefixIcon: Icon(Icons.pin_outlined),
            ),
            validator: (v) => (v == null || v.length != 6) ? 'Le code comporte 6 chiffres.' : null,
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: _motDePasse,
            obscureText: _masque,
            textInputAction: TextInputAction.done,
            onFieldSubmitted: (_) => _reinitialiser(),
            autofillHints: const [AutofillHints.newPassword],
            style: context.textes.bodyLarge,
            decoration: InputDecoration(
              labelText: 'Nouveau mot de passe',
              helperText: '8 caractères minimum.',
              prefixIcon: const Icon(Icons.lock_outline),
              suffixIcon: IconButton(
                tooltip: _masque ? 'Afficher le mot de passe' : 'Masquer le mot de passe',
                onPressed: () => setState(() => _masque = !_masque),
                icon: Icon(_masque ? Icons.visibility_outlined : Icons.visibility_off_outlined),
              ),
            ),
            validator: (v) => (v == null || v.length < 8) ? 'Au moins 8 caractères.' : null,
          ),
          _erreurEventuelle(),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _envoi ? null : _reinitialiser,
            child: _envoi ? const ChargementBouton() : const Text('Changer le mot de passe'),
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: _envoi
                ? null
                : () => setState(() {
                      _etape = _Etape.numero;
                      _erreur = null;
                      _code.clear();
                    }),
            child: const Text('Renvoyer un code'),
          ),
        ],
      ),
    );
  }

  Widget _etapeTerminee(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Icon(Icons.verified_rounded, size: 64, color: context.statut.nominal),
        const SizedBox(height: 16),
        Text('Mot de passe modifié', style: context.textes.headlineMedium, textAlign: TextAlign.center),
        const SizedBox(height: 12),
        Text(
          'Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.',
          style: context.textes.bodyLarge,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 32),
        FilledButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Retour à la connexion'),
        ),
      ],
    );
  }
}
