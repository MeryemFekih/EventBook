# EventBook — Projet Sécurité Web M1

Plateforme de gestion d'événements avec réservation de places (authentification, rôles `user`/`admin`, propriété d'événement, notifications, API REST, CRUD), livrée en deux versions :

* `git checkout vulnerable` — version volontairement vulnérable
* `git checkout secure` — version corrigée

Voir **[SECURITY_AUDIT.md](./SECURITY_AUDIT.md)** pour l'audit complet.

## Lancer le projet

```bash
npm install
npm run seed
npm start        # backend + frontend React (déjà construit) sur http://localhost:3000
```

Pour travailler sur le frontend React :

```bash
cd client
npm install
npm run dev      # http://localhost:5173, proxy /api vers le backend sur :3000
npm run build    # reconstruit ../public, servi par Express en prod
```

## Comptes de test

| Utilisateur | Mot de passe | Rôle  | Contexte |
|-------------|--------------|-------|----------|
| alice       | alice123     | user  | organisatrice de 2 événements |
| bob         | bob123       | user  | visiteur, 2 demandes en attente |
| admin       | admin123     | admin | administrateur |

## Fonctionnement

1. Un utilisateur crée un événement → il en devient l'organisateur.
2. Un visiteur consulte les événements et demande une place (avec un message optionnel).
3. L'organisateur voit les demandes reçues pour ses événements et les accepte/refuse.
4. Chaque action (nouvelle demande, confirmation, refus) génère une notification pour l'utilisateur concerné.
5. L'admin gère utilisateurs, événements et réservations.

## Stack

Node.js, Express, SQLite (`better-sqlite3`), JWT. Frontend React (Vite).

⚠️ La branche `vulnerable` contient des failles de sécurité **volontaires** à des fins pédagogiques. Ne jamais déployer cette branche sur un serveur exposé à Internet.
