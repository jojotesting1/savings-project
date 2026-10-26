# JK CAPITAL — projet de test (v1)

Interface française pour tester les parcours client et administrateur. **Ce projet est exclusivement une simulation** : aucun paiement bancaire, aucun virement, aucun rendement réel et aucun prestataire de paiement n'est connecté.

## Fonctions incluses
- Création de compte client et connexion par e-mail/mot de passe (hash bcrypt).
- Sessions serveur stockées dans PostgreSQL, cookie HttpOnly/SameSite et limitation des tentatives de connexion.
- Tableau de bord client : solde fictif, disponible après réservations, demandes de dépôt/retrait et journal comptable.
- Administration : approbation/rejet de dépôts simulés, marquage d'un retrait comme payé en simulation avec référence fictive, rejet, ajustement manuel motivé, liste clients et journal.
- Outil de simulation d'un crédit de 1 % (uniquement si `DEMO_MODE=true`; ce n'est pas un calcul de rendement financier).
- Déploiement Render Blueprint via `render.yaml`.

## Démo locale
Pré-requis : Node.js 20+ et PostgreSQL.

1. Crée une base PostgreSQL `jkcapital`.
2. Copie `.env.example` vers `.env` et adapte `DATABASE_URL` et `SESSION_SECRET`.
3. Installe et démarre :
   ```bash
   npm install
   npm start
   ```
4. Ouvre `http://localhost:3000`.

Quand `DEMO_MODE=true`, un compte client fictif est créé :
- Email : `client@jkcapital.test`
- Mot de passe : `Demo123!`

Pour l'administration locale, la première connexion admin est créée avec `ADMIN_EMAIL` et `ADMIN_PASSWORD` définis dans `.env`. Utilise un mot de passe unique, puis supprime les comptes et données de démo avant de réutiliser la base.

## Déploiement sur Render sans VPS
1. Crée un dépôt Git privé et envoie les fichiers du projet.
2. Dans Render, choisis **New → Blueprint** et connecte le dépôt contenant `render.yaml`.
3. Render créera un service web et une base PostgreSQL. Le plan indiqué dans `render.yaml` peut devoir être adapté aux offres disponibles dans ton compte.
4. Lors de la configuration, définis `ADMIN_EMAIL` et un mot de passe fort dans `ADMIN_PASSWORD`. Ne les mets pas dans Git.
5. `DEMO_MODE` est à `false` dans le blueprint public : la simulation de crédit quotidien est donc désactivée. Pour un environnement d'essai privé, tu peux la passer à `true`, mais conserve la bannière de test et n'y stocke aucun fonds réel.
6. Vérifie `/health`, teste inscription/connexion et toutes les opérations, puis examine les journaux Render.
7. Ajoute ton domaine personnalisé et configure le HTTPS selon les instructions Render/Cloudflare.

## Limites à lire avant tout test public
- L'application ne collecte ni carte bancaire, ni IBAN, ni documents d'identité.
- Les demandes de dépôt sont des demandes internes de démonstration, pas une preuve de paiement.
- « Marquer payé » n'envoie aucun virement : cela change uniquement l'état et inscrit un débit fictif.
- Le bouton 1 % est manuel, simulé, sans automatisation quotidienne ni garantie de rendement.
- Il s'agit d'une base de test et non d'un système financier certifié ou prêt à recevoir de vrais fonds. Avant une production, prévoir revue indépendante de sécurité, tests, surveillance, politique de confidentialité, conditions, sauvegardes testées et validation réglementaire du modèle financier dans la juridiction concernée.

## Environnement
Variables : `DATABASE_URL` (obligatoire), `SESSION_SECRET` (32+ caractères), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `DEMO_MODE` (`true`/`false`), `APP_CURRENCY` (défaut `EUR`), `PORT`.
