# SECURITY_AUDIT.md — EventBook

## 1. Présentation du projet

EventBook est une plateforme de gestion d'événements avec réservation de places, développée pour le module M1 Sécurité Web.

Tout utilisateur authentifié peut créer un événement et en devenir l'organisateur (propriétaire). Les autres utilisateurs (visiteurs) parcourent les événements et demandent une place ; l'organisateur reçoit une notification et peut accepter ou refuser la demande. Chaque utilisateur dispose d'un centre de notifications. Un rôle `admin` gère l'ensemble des utilisateurs, événements et réservations.

Stack technique : Node.js/Express, SQLite (`better-sqlite3`), JWT, frontend React (Vite).

Le dépôt contient deux branches :

* `vulnerable` : version volontairement vulnérable
* `secure` : version corrigée

## 2. Installation et lancement

```bash
git clone <repo-url>
cd eventbook
git checkout vulnerable   # ou: git checkout secure
npm install
npm run seed
npm start                 # backend + frontend React déjà construit, sur http://localhost:3000
```

Pour modifier le frontend React (optionnel) :

```bash
cd client
npm install
npm run dev      # serveur de dev Vite sur http://localhost:5173 (proxy /api vers :3000)
npm run build    # regénère le build dans ../public, servi par Express
```

## 3. Comptes de test

| Utilisateur | Mot de passe | Rôle  | Contexte |
|-------------|--------------|-------|----------|
| alice       | alice123     | user  | organisatrice de 2 événements |
| bob         | bob123       | user  | visiteur, a 2 demandes de réservation en attente |
| admin       | admin123     | admin | administrateur |

## 4. Organisation Git

* `vulnerable` : failles volontaires, commentées `// VULN #...` (backend Express + frontend React avec `dangerouslySetInnerHTML` et token en `localStorage`)
* `secure` : corrections à la racine, commentées `// FIX #...` (même stack, frontend React sans `dangerouslySetInnerHTML`, token en mémoire)

## 5. Liste des vulnérabilités intégrées

Vulnérabilités obligatoires :

1. **Broken Access Control / IDOR** — `PATCH /api/events/:id`, `DELETE /api/events/:id` : n'importe quel utilisateur peut modifier/supprimer l'événement d'un autre organisateur
2. **XSS (stockée)** — description d'événement et message de demande de réservation, rendus via `innerHTML`
3. **Injection SQL** — `POST /api/auth/login` et `GET /api/events/search/query`
4. **Mass Assignment** — deux instances :
   * `PATCH /api/users/me` : élévation de rôle
   * `PATCH /api/reservations/:id` : un visiteur confirme lui-même sa propre demande de réservation, en contournant totalement le rôle de validation de l'organisateur

Vulnérabilités bonus intégrées :

* Broken Access Control : `GET /api/admin/users` et `GET /api/owner/reservations` (fuite de toutes les demandes de réservation de tous les organisateurs, avec identité des demandeurs) accessibles sans vérification
* IDOR sur les notifications : `PATCH /api/notifications/:id/read` sans vérification de propriétaire
* Authentification faible : mots de passe en clair, pas de rate limiting, tokens 7 jours
* Information Disclosure : stack traces et requêtes SQL renvoyées, mots de passe exposés par `/api/admin/users`
* CORS permissif, absence de headers de sécurité, token en `localStorage`, secret JWT en dur

## 6. Audit détaillé des vulnérabilités

### 6.1 Broken Access Control / IDOR (événements)

* **Endpoint** : `PATCH /api/events/:id`, `DELETE /api/events/:id`
* **Cause technique** : la route récupère l'événement uniquement par son `id`, sans jamais comparer `event.owner_id` à `req.user.id`.
* **Exploitation** : `bob` (visiteur) modifie l'événement #1 appartenant à `alice`.
* **Payload** :
  ```bash
  curl -X PATCH http://localhost:3000/api/events/1 \
    -H "Authorization: Bearer <token_bob>" -H "Content-Type: application/json" \
    -d '{"title":"HACKED BY BOB"}'
  ```
* **Preuve** : le titre de l'événement d'`alice` est modifié par `bob`, confirmé par une relecture de l'événement (`title: "HACKED BY BOB"`).
* **Impact** : n'importe quel utilisateur peut défigurer ou supprimer l'événement de n'importe quel organisateur.
* **Criticité** : **Élevée**
* **Correction** : vérification `event.owner_id === req.user.id || req.user.role === 'admin'` avant toute modification/suppression, réponse `403 Forbidden` sinon.
* **Validation** : la même requête avec le token de `bob` renvoie `{"error":"Only the event owner can edit this event"}`.

### 6.2 XSS stockée

* **Endpoint / zone** : description d'événement (`POST`/`PATCH /api/events`) et message de demande de réservation (`POST /api/events/:id/reservations`).
* **Particularité React** : React échappe automatiquement le contenu texte inséré via `{...}` dans le JSX — ce n'est donc **pas** une vulnérabilité "par défaut" du framework. Ici, le composant `EventDetail` utilise explicitement `dangerouslySetInnerHTML={{ __html: event.description }}` (et `OwnerReservations` fait de même pour `r.message`), ce qui désactive volontairement cette protection — une erreur de développeur réelle et fréquente (souvent introduite pour permettre un peu de mise en forme HTML dans une description, sans validation de ce qui est accepté).
* **Payload** : `{"message":"<script>alert(document.cookie)</script>"}`
* **Preuve** : le script s'exécute lorsque l'organisateur ouvre la liste des demandes reçues pour valider les réservations.
* **Impact** : vol de session de l'organisateur (rôle le plus sensible du point de vue métier, celui qui valide les accès), défacement.
* **Criticité** : **Élevée**
* **Correction** : suppression de tout `dangerouslySetInnerHTML` sur du contenu utilisateur ; retour à l'interpolation JSX classique (`<p>{event.description}</p>`, `<span>{r.message}</span>`) qui échappe automatiquement le HTML. Échappement supplémentaire côté serveur (`escapeHtml`) en défense en profondeur.
* **Validation** : le payload `<script>...</script>` est affiché tel quel comme texte visible à l'écran (balises comprises), sans jamais s'exécuter.

### 6.3 Injection SQL

* **Endpoint** : `POST /api/auth/login`, `GET /api/events/search/query`
* **Payload** : `{"username":"admin' -- ","password":"x"}`
* **Preuve** : connexion réussie en tant qu'`admin` sans connaître `admin123`.
* **Impact** : contournement total de l'authentification.
* **Criticité** : **Critique**
* **Correction** : requêtes paramétrées (`db.prepare('... WHERE username = ?').get(username)`), `bcrypt.compareSync` pour la vérification du mot de passe.
* **Validation** : le même payload renvoie `{"error":"Invalid username or password"}`.

### 6.4 Mass Assignment

* **Endpoints** : `PATCH /api/users/me` (rôle), `PATCH /api/reservations/:id` (statut)
* **Description** :
  1. Le champ `role` est accepté depuis le body sur `/api/users/me`.
  2. Le champ `status` de `/api/reservations/:id` est accepté sans vérifier que l'appelant est l'organisateur de l'événement concerné — un visiteur peut donc valider lui-même sa propre demande de place.
* **Payloads** :
  ```json
  { "role": "admin" }
  { "status": "confirmed" }
  ```
* **Preuve** : `bob` obtient `role: "admin"` après le premier appel ; sa réservation en attente passe directement à `"confirmed"` après le second, sans jamais que l'organisatrice `alice` n'intervienne.
* **Impact** : élévation de privilèges complète (1) ; contournement total du processus de validation métier — un visiteur peut s'auto-attribuer une place sur un événement à capacité limitée sans l'accord de l'organisateur (2).
* **Criticité** : **Critique**
* **Correction** :
  1. Whitelist stricte sur `/api/users/me` ; `role` toujours ignoré, changement de rôle réservé à `PATCH /api/admin/users/:id/role` (admin uniquement).
  2. `PATCH /api/reservations/:id` vérifie désormais `event.owner_id === req.user.id || req.user.role === 'admin'` avant tout changement de statut.
* **Validation** : les deux payloads sont soit ignorés (rôle reste `user`) soit rejetés (`403 Forbidden` sur la tentative d'auto-confirmation) ; en revanche, la même requête envoyée par `alice` (la vraie organisatrice) réussit normalement.

### 6.5 Vulnérabilités bonus (résumé)

| Faille | Preuve (vulnerable) | Correction (secure) |
|---|---|---|
| Fuite des demandes de réservation | `GET /api/owner/reservations` renvoie TOUTES les demandes de TOUS les organisateurs à n'importe quel utilisateur connecté | Filtrage server-side par `event.owner_id = req.user.id` (ou admin) |
| IDOR sur notifications | `PATCH /api/notifications/:id/read` sans vérification de propriétaire | Vérification `notification.user_id === req.user.id` |
| Endpoint admin non protégé | `GET /api/admin/users` accessible à un `user` | Middleware `requireAdmin` |
| Mots de passe en clair | Table `users` en clair | `bcrypt` (coût 10) |
| Pas de rate limiting | Brute-force login sans blocage | `express-rate-limit` |
| Information Disclosure | Stack traces / SQL renvoyées au client | Message générique, log serveur uniquement |
| CORS permissif | Origine reflétée + credentials | Liste blanche `ALLOWED_ORIGINS` |
| Pas de headers de sécurité | Aucun CSP | `helmet()` |
| Token en `localStorage` | `localStorage.setItem('eb_token', ...)` | Token en mémoire uniquement |
| Secret JWT en dur | `'secret123'` | `process.env.JWT_SECRET` |

## 7. Corrections appliquées dans la branche `secure`

* IDOR → vérification d'ownership (`owner_id`/`user_id`) systématique côté backend sur événements, réservations et notifications.
* Injection SQL → requêtes paramétrées partout.
* XSS → échappement serveur + rendu DOM sûr côté client.
* Mass Assignment → whitelist des champs éditables ; changement de rôle et changement de statut de réservation déplacés vers des points d'entrée dédiés et protégés par rôle/ownership.
* Renforcements bonus : `bcrypt`, `helmet`, `express-rate-limit`, CORS restrictif, JWT courte durée, suppression des fuites d'information, token en mémoire.

## 8. Validation après correction

Rejeu des mêmes payloads que lors de l'exploitation initiale, sur la branche `secure` :

* Bypass SQL login : **401**, message générique.
* IDOR sur événement d'un autre organisateur : **403 Forbidden**.
* Auto-confirmation de réservation par le demandeur : **403 Forbidden**.
* Élévation de rôle via mass assignment : **ignorée**, rôle inchangé.
* Fuite des demandes de réservation d'autres organisateurs : **liste vide** pour un utilisateur qui ne possède aucun événement.
* XSS stockée : payload affiché en texte échappé, aucune exécution.
* Flux légitime (l'organisatrice `alice` confirme la demande de `bob`) : **fonctionne toujours normalement**, preuve que la correction ne casse pas le cas d'usage réel.

## 9. Limites du projet

* Pas de gestion de la capacité maximale de l'événement (une réservation confirmée ne vérifie pas si l'événement est complet) — hors périmètre sécurité.
* Pas de pipeline CI/CD automatisé (bonus non implémenté).
* Token conservé en mémoire côté client (pas de cookie `httpOnly`), compromis pédagogique assumé.
* Base SQLite locale, adaptée à la démonstration uniquement.
* Tests manuels via `curl`, pas de suite de tests automatisés.

## 10. Conclusion

EventBook illustre, sur une plateforme d'événements avec un workflow de validation à deux rôles (organisateur/visiteur) et un système de notifications, le cycle complet **faille → exploitation → impact → correction → validation** pour les quatre vulnérabilités obligatoires — avec une attention particulière portée au Mass Assignment, décliné ici en deux variantes réalistes (élévation de rôle globale, et contournement d'un processus de validation métier spécifique à l'application). Chaque correction traite la cause racine et a été revérifiée avec les payloads exacts ayant permis l'exploitation initiale, sans casser les flux légitimes.
