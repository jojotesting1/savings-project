# Checklist de test — JK CAPITAL

## Client
- [ ] Créer un compte avec une nouvelle adresse e-mail.
- [ ] Vérifier qu'un mot de passe de moins de 10 caractères est refusé.
- [ ] Se déconnecter et se reconnecter.
- [ ] Créer une demande de dépôt fictive.
- [ ] Créer une demande de retrait dans la limite du solde disponible.
- [ ] Essayer un retrait supérieur au solde disponible : il doit être refusé.
- [ ] Vérifier l'état des demandes et le journal après traitement par l'admin.

## Administrateur
- [ ] Connexion avec `ADMIN_EMAIL` et `ADMIN_PASSWORD`.
- [ ] Approuver un dépôt : le solde fictif augmente une seule fois.
- [ ] Rejeter un dépôt : le solde ne change pas.
- [ ] Marquer un retrait payé avec une référence fictive : le solde baisse une seule fois.
- [ ] Rejeter un retrait : le débit n'est pas enregistré.
- [ ] Effectuer un ajustement avec motif et vérifier le journal.
- [ ] Vérifier qu'un client ne peut pas ouvrir `/admin`.
- [ ] Vérifier que `/health` renvoie `status: ok`.

## Sécurité de base
- [ ] Ne pas utiliser de vrais mots de passe.
- [ ] Ne saisir aucune donnée bancaire ou pièce d'identité.
- [ ] Utiliser HTTPS pour tout test hébergé.
- [ ] Définir un `SESSION_SECRET` long et unique.
- [ ] Tester une sauvegarde et sa restauration avant d'ajouter des données importantes.
