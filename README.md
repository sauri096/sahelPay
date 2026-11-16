# SahelPay : application de paiement mobile (MVP)

Portefeuille électronique sur le modèle de Wave : transferts gratuits, dépôt et retrait chez des agents (1 % de frais au retrait), paiement des marchands par QR code et back-office d'administration.

```
sahelpay/
├── backend/   API Node.js + TypeScript + PostgreSQL (grand livre en partie double)
├── mobile/    Application Android et iOS (Expo / React Native)
├── admin/     Back-office web (React + Vite)
└── docker-compose.yml
```

## Démarrage rapide

### 1. Base de données et API

Avec Docker :

```bash
docker compose up --build
```

Sans Docker (PostgreSQL 14 ou plus installé) :

```bash
cd backend
cp .env.example .env        # adaptez DATABASE_URL
npm install
npm run seed                # crée le schéma et les comptes de démonstration
npm run dev                 # API sur http://localhost:4000
```

### 2. Application mobile

```bash
cd mobile
npm install
# Sur un vrai téléphone, mettez l'IP de votre ordinateur sur le réseau Wi-Fi
echo "EXPO_PUBLIC_API_URL=http://192.168.1.10:4000" > .env
npx expo start
```

Scannez le QR code avec l'application **Expo Go** (Android et iOS), ou appuyez sur `w` pour l'ouvrir dans le navigateur.

### 3. Back-office

```bash
cd admin
npm install
npm run dev                 # http://localhost:5173
```

### Comptes de démonstration (PIN : `2580`)

| Rôle | Téléphone |
|---|---|
| Admin | +221770000001 |
| Agent (1 000 000 F de float) | +221770000002 |
| Marchand « Restaurant Teranga » | +221770000003 |
| Cliente Awa (50 000 F) | +221770000004 |
| Client Ibrahima (25 000 F) | +221770000005 |

En développement, le code SMS (OTP) s'affiche directement à l'écran.

## Fonctionnalités

**Client** : inscription par téléphone + OTP + PIN, solde (masquable), QR personnel pour recevoir, transfert avec affichage du nom du bénéficiaire avant envoi, scan QR (paiement marchand, retrait agent, transfert), historique, demande de vérification d'identité (KYC), réinitialisation du PIN par SMS.

**Agent** : dépôt d'espèces sur le compte d'un client, QR code pour les retraits, suivi du float, commission sur les retraits.

**Marchand** : QR code d'encaissement à afficher en caisse, historique des paiements reçus.

**Admin** : tableau de bord, gestion des utilisateurs (création d'agents et de marchands, blocage), validation KYC, recherche et annulation de transactions, émission et rachat de float, contrôle d'intégrité du grand livre, journal d'audit.

## Modèle économique (configurable dans `backend/.env`)

| Opération | Frais | Payés par |
|---|---|---|
| Transfert entre clients | 0 % (`FEE_TRANSFER_BPS=0`) | — |
| Dépôt chez un agent | 0 % | — |
| Retrait chez un agent | 1 % (`FEE_CASH_OUT_BPS=100`) | Client, dont 40 % reversés à l'agent |
| Paiement marchand | 1 % (`FEE_MERCHANT_BPS=100`) | Marchand |

Plafonds par niveau KYC : niveau 0 (téléphone seul) = 200 000 F de solde et 100 000 F d'envois par jour ; niveau 1 (pièce vérifiée) = 2 000 000 F et 1 000 000 F/jour. Voir `backend/src/config.ts`.

## Architecture technique

### Le grand livre (le cœur du système)

Chaque mouvement d'argent est une **transaction** composée d'**écritures** (`ledger_entries`) dont la somme vaut toujours zéro. Exemple pour un retrait de 20 000 F :

| Compte | Écriture |
|---|---|
| Portefeuille client | −20 200 |
| Portefeuille agent | +20 080 (montant + commission) |
| Revenus SahelPay | +120 |

- La monnaie entre dans le système uniquement par le compte **émission** (float vendu aux agents contre espèces) ; ce compte est négatif du montant exact de la monnaie électronique en circulation.
- La monnaie électronique en circulation doit être couverte **à 100 %** par l'argent placé sur le compte de cantonnement à la banque (exigence BCEAO/BEAC).
- `GET /v1/admin/ledger/check` vérifie que tout est équilibré et que les soldes correspondent aux écritures.

### Sécurité et robustesse

- **Verrouillage des comptes** (`SELECT … FOR UPDATE` dans un ordre fixe) : pas de double dépense, même avec des requêtes simultanées (testé).
- **Idempotence** : l'en-tête `Idempotency-Key` garantit qu'une requête répétée (réseau instable) ne débite qu'une fois (testé).
- PIN haché (bcrypt), blocage après 5 erreurs, déblocage par OTP ; OTP haché, valable 5 minutes, 5 essais maximum.
- Confirmation par PIN pour chaque débit, contrainte SQL interdisant les soldes négatifs, montants en entiers (aucun arrondi flottant).
- Jeton JWT ; un compte bloqué perd l'accès immédiatement ; limitation du débit (rate limiting) sur l'authentification ; journal d'audit des actions admin.

### API (extrait)

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/v1/auth/otp/request`, `/otp/verify`, `/register`, `/login`, `/pin/reset` | public |
| GET | `/v1/me`, `/v1/transactions`, `/v1/users/lookup`, `/v1/fees/quote` | connecté |
| POST | `/v1/transfers` | client, marchand |
| POST | `/v1/cash-out`, `/v1/payments/merchant` | client |
| POST | `/v1/agent/cash-in` | agent |
| POST | `/v1/kyc` | connecté |
| * | `/v1/admin/...` | admin |

Format des QR codes : `SAHELPAY:U:<téléphone>` (client), `SAHELPAY:A:<code>` (agent), `SAHELPAY:M:<code>` (marchand).

### Tests

```bash
cd backend && npm test
```

14 tests d'intégration sur une vraie base PostgreSQL (`wallet_test`) : inscription, blocage du PIN, parcours complet de l'argent, provision insuffisante, idempotence, concurrence, plafonds KYC, annulation, permissions.

## Avant le lancement réel

Ce MVP est une base technique solide, mais il **ne doit pas manipuler d'argent réel** sans les étapes suivantes.

**Réglementaire**
- [ ] Agrément d'établissement de monnaie électronique (BCEAO en zone UEMOA, COBAC en zone CEMAC), ou partenariat avec une banque qui en détient un
- [ ] Compte de cantonnement à la banque et rapprochement quotidien avec le grand livre
- [ ] Dispositif LCB-FT : filtrage des listes de sanctions, déclarations de soupçon à la CENTIF, conservation des données
- [ ] Protection des données personnelles (CDP au Sénégal, ARTCI en Côte d'Ivoire, etc.)

**Technique**
- [ ] Brancher un vrai fournisseur SMS (implémenter `SmsProvider` dans `backend/src/lib/sms.ts`) et passer `EXPOSE_OTP=false`
- [ ] KYC avec photo de la pièce et selfie (stockage chiffré, vérification de vivacité)
- [ ] Liaison de l'appareil : OTP à chaque connexion depuis un nouveau téléphone
- [ ] Moteur de détection de fraude (vitesse des transactions, montants inhabituels)
- [ ] Notifications push, canal USSD pour les téléphones sans smartphone
- [ ] Interopérabilité : banques, Orange Money / MTN MoMo, système de paiement instantané de la BCEAO
- [ ] Rôles admin plus fins (support, conformité, finance) et double validation pour l'émission de float
- [ ] Hébergement redondant, sauvegardes, supervision, test d'intrusion par un cabinet indépendant
- [ ] Publication : `npx eas-cli build` pour générer les applications Android et iOS

## Personnalisation

- **Nom** : `APP_NAME` (backend), `app.json` (mobile), et le texte « SahelPay » dans les écrans
- **Monnaie** : `CURRENCY=XAF` pour la zone CEMAC (Tchad, Cameroun, Gabon…)
- **Indicatif par défaut** : `EXPO_PUBLIC_DEFAULT_PREFIX=+235` dans `mobile/.env` (voir `mobile/src/lib/config.ts`)
- **Couleurs** : `mobile/src/lib/theme.ts` et `admin/src/styles.css`
