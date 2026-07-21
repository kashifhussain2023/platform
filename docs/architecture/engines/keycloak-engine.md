# Keycloak — Engine Study

Source verified against: local clone `C:\Users\Admin\AppData\Local\Temp\claude\keycloak-src`
(keycloak/keycloak, Java/Quarkus) + official docs at www.keycloak.org/documentation (fetched
2026-07-19). All claims below are cited to a real file path or a fetched doc URL. Anything that
could not be verified this way is marked **NOT VERIFIED**.

---

## 1. Executive Summary

Keycloak is an Identity and Access Management (IAM) server: it issues and validates OpenID
Connect/OAuth2 and SAML 2.0 tokens/assertions, and owns the full lifecycle of realms, clients,
users, roles, groups, and sessions. It is a large multi-module Maven repo (`server-spi`,
`server-spi-private`, `services`, `model/jpa`, `model/infinispan`, `quarkus`, `js`, `adapters`,
`federation`, `saml-core`, `authz`, `crypto`, `operator`, `scim`, `authzen`, `ssf`, plus a `js/`
pnpm workspace for the admin/account consoles) built on a Quarkus runtime distribution.

Confirmed at the code level: the repo carries a single Apache License 2.0 (`LICENSE.txt`), and
`common/src/main/java/org/keycloak/common/Profile.java` — the class that defines every toggleable
feature in the product (~70 `Feature` enum entries, each typed `DEFAULT`, `DISABLED_BY_DEFAULT`,
`PREVIEW`, `EXPERIMENTAL`, or `DEPRECATED`) — has **no "Enterprise" or "commercial" `Type` at all**.
Every feature in this open clone, including `ORGANIZATION` (`Type.DEFAULT`, enabled out of the box),
is reachable with no license key or gate. This directly answers the brief's central licensing
question: there is no code-level Enterprise split in Keycloak; "Red Hat Build of Keycloak" is a
support/certification product layered on identical upstream code (Red Hat's own product page and
docs describe RHBK as certified builds + support SLAs, not a different feature set — see §18).

For Orlixa: Keycloak is architecturally a full IAM system, not a library. Orlixa already has a
working JWT auth stack (access+refresh tokens, Passport JWT strategy, RolesGuard,
OWNER/ADMIN/MEMBER roles, per-company tenancy). The recommendation is **augment, not replace**:
adopt Keycloak only as an optional SSO/SAML/OIDC-broker layer for enterprise customers who demand
it, keep Orlixa's own JWT system as the default/internal auth for all other tenants. A full
migration of Orlixa's core login to Keycloak is not justified at the platform's current stage (see
§20/§21).

---

## 2. Architecture Diagram

```
                         ┌─────────────────────────────────────────────┐
                         │        Keycloak server (Quarkus runtime)      │
                         │        distribution: quarkus/dist             │
                         │                                                │
 Browser (login UI) ────▶│  Vert.x/Quarkus HTTP layer                    │
 OIDC/SAML clients ─────▶│   ├─ RealmsResource (OIDC/SAML endpoints)     │
 Admin REST callers ────▶│   ├─ AdminRoot (Admin REST API)               │
                         │   ├─ Account console REST (js/apps/account-ui)│
                         │   └─ Authentication SPI pipeline               │
                         │        (AuthenticationProcessor → Flow →      │
                         │         Authenticator chain)                   │
                         │                                                │
                         │  KeycloakSessionFactory → per-request          │
                         │  KeycloakSession → ProviderFactory lookups     │
                         │  (server-spi / server-spi-private SPIs)        │
                         └───────────┬───────────────────┬────────────────┘
                                     │                   │
                     JPA (model/jpa) │                   │ Infinispan (model/infinispan)
                                     ▼                   ▼
                     ┌───────────────────────┐  ┌────────────────────────────┐
                     │ RDBMS (Postgres/MySQL/│  │ Embedded or remote          │
                     │ MariaDB/Oracle/MSSQL/ │  │ Infinispan caches:           │
                     │ H2 dev-only)          │  │ realms, users, authorization,│
                     │ REALM, CLIENT,        │  │ sessions, authenticationSess-│
                     │ USER_ENTITY, ...      │  │ ions, work, actionTokens,    │
                     │ (see §6)              │  │ loginFailures (§9/§10)       │
                     └───────────────────────┘  └────────────────────────────┘
                                     ▲
                                     │ optional
                     ┌───────────────────────────┐
                     │ External user stores via   │
                     │ UserStorageProvider SPI:    │
                     │ federation/ldap,            │
                     │ federation/kerberos,        │
                     │ federation/sssd,            │
                     │ federation/ipatuura         │
                     └───────────────────────────┘
```

---

## 3. Component Diagram

```
server-spi/                 SPI *interfaces* only (org.keycloak.provider, .models, .authentication,
                             .storage, .keys, .credential, .organization, .userprofile, .vault, ...)
server-spi-private/         Internal-only SPIs (BruteForceProtector, cache managers, etc.) not meant
                             for third-party providers
services/                   The bulk of runtime logic: org.keycloak.protocol.{oidc,saml},
                             org.keycloak.authentication.*, org.keycloak.services.resources.admin.*
                             (Admin REST resources), org.keycloak.events, org.keycloak.broker
                             (identity brokering), org.keycloak.timer (scheduled tasks)
model/jpa/                  JPA entity classes + Hibernate-backed realm/user/client provider impls
                             (org.keycloak.models.jpa.entities.*, see §6)
model/infinispan/           Infinispan-backed caching layer + session/auth-session stores +
                             ClusterProviderFactory (clustering glue)
model/storage-private/      DB-lock, scheduled cleanup tasks (org.keycloak.services.scheduled.*)
quarkus/                    The actual server runtime: config-api, deployment (build-time Quarkus
                             extension), runtime (CLI: kc.sh start/build), server, dist (packaged zip)
adapters/saml, adapters/spi Legacy Java SAML adapters for protecting non-Keycloak Java apps
                             (OIDC adapters are largely superseded by standard OIDC/OAuth2 libraries)
federation/                 UserStorageProvider implementations: ldap, kerberos, sssd, ipatuura
authz/                      Authorization Services (UMA-style fine-grained policy/permission engine)
authzen/                    OpenID AuthZen authorization protocol support (experimental feature)
saml-core, saml-core-api    SAML 2.0 protocol object model + processing (shared by server + adapters)
crypto/                     Pluggable crypto providers: default, fips1402, elytron
scim/                       SCIM API (System for Cross-domain Identity Management), Preview feature
operator/                   Kubernetes Operator (CRDs: Keycloak, KeycloakRealmImport)
js/                         pnpm workspace: admin-ui (React admin console), account-ui (React account
                             console), keycloak-server (dev server), create-keycloak-theme (scaffolder)
themes/                     Server-side FreeMarker login/email/account theme templates
test-framework/, testsuite/ Test harnesses (Arquillian-based integration tests, newer test-framework)
```

---

## 4. Request Flow (OIDC authorization-code login → token issuance → resource-server validation)

Traced through real classes in `services/src/main/java/org/keycloak/`:

1. **Authorization request.** The RP redirects the browser to
   `/realms/{realm}/protocol/openid-connect/auth`, handled by
   `protocol/oidc/endpoints/AuthorizationEndpoint.java`. It parses the request via
   `endpoints/request/AuthorizationEndpointRequestParserProcessor.java` /
   `AuthzEndpointRequestParser.java`, validates redirect_uri/scope/response_type, then calls into
   `AuthenticationEndpointBase`/`AuthenticationFlowResolver` to kick off the login flow.
2. **Authentication flow.** `org.keycloak.authentication.AuthenticationProcessor` drives the
   configured flow (a `DefaultAuthenticationFlow` or `FormAuthenticationFlow`, both in
   `services/src/main/java/org/keycloak/authentication/`), executing each `Authenticator` SPI
   implementation in the flow's `AUTHENTICATION_EXECUTION` order (persisted in the
   `AUTHENTICATION_EXECUTION`/`AUTHENTICATION_FLOW` JPA tables, §6). A successful username+password
   (+ optional OTP/WebAuthn) authentication creates a `UserSessionModel` and
   `AuthenticationSessionModel`.
3. **Authorization code issuance.** On success, the flow redirects back to the client's
   `redirect_uri` with a `code` — the code and its binding to the session are managed by
   `org.keycloak.protocol.oidc.OIDCLoginProtocol` /
   `services/src/main/java/org/keycloak/protocol/oidc/utils/OAuth2CodeParser` (issues a signed
   code tied to the session in Infinispan's `authenticationSessions`/`clientSessions` caches, §9/§10).
4. **Token exchange.** The RP calls `/realms/{realm}/protocol/openid-connect/token`, handled by
   `protocol/oidc/endpoints/TokenEndpoint.java`. It validates client authentication (via
   `org.keycloak.authentication.ClientAuthenticationFlow`), exchanges the code, and delegates to
   `org.keycloak.protocol.oidc.TokenManager` to build and sign the access token, ID token, and
   refresh token (JWS, default `RS256`, keys from the realm's active `ComponentEntity`/keystore
   provider under the `keys` SPI).
5. **Resource-server validation.** A downstream API (Orlixa's own NestJS resource server, or any
   OIDC-aware service) validates the access token either by verifying the JWT signature locally
   against the realm's JWKS at `/realms/{realm}/protocol/openid-connect/certs`
   (`protocol/oidc/endpoints/` JWKS-serving logic backed by the `keys` SPI,
   `server-spi/src/main/java/org/keycloak/keys/`), or by calling
   `protocol/oidc/endpoints/TokenIntrospectionEndpoint.java` (RFC 7662) for opaque/introspection-
   style validation. `UserInfoEndpoint.java` serves the standard `/userinfo` claims endpoint.
6. **Logout.** `protocol/oidc/endpoints/LogoutEndpoint.java` implements RP-initiated logout and
   back-channel logout, invalidating the `UserSessionModel` (removed from Infinispan `sessions`
   cache and, if `PERSISTENT_USER_SESSIONS` is enabled, the DB-backed session store).

---

## 5. Authentication Flow

**Admin console auth.** The Admin Console and Admin REST API (`AdminRoot`,
`services/src/main/java/org/keycloak/services/resources/admin/AdminRoot.java`) are themselves
protected by a normal OIDC bearer token issued against Keycloak's own built-in `master` realm (or
any realm with the `realm-management` client roles). `AdminAuth.java` and
`AdminRoleTokenPostProcessor.java` (same package) resolve the bearer token, check for the relevant
`realm-management` client roles (`realm-admin`, `manage-users`, etc.), and reject requests lacking
them — i.e., Keycloak "dogfoods" its own OIDC stack to secure its own admin plane.

**End-user-facing flows.**
- **OIDC/OAuth2:** Authorization Code (with PKCE), Client Credentials, Resource Owner Password
  Credentials (legacy/discouraged), Device Authorization Grant (`DEVICE_FLOW`, `Type.DEFAULT`),
  CIBA (`Type.DEFAULT`), and Pushed Authorization Requests (PAR, `Type.DEFAULT`) — all confirmed
  as `Feature` entries in `common/src/main/java/org/keycloak/common/Profile.java`.
- **SAML 2.0:** IdP-initiated and SP-initiated SSO, handled by
  `services/src/main/java/org/keycloak/protocol/saml/SamlService.java` and
  `SamlProtocol.java`/`SamlProtocolFactory.java`, using the shared `saml-core`/`saml-core-api`
  modules for assertion building/signing/encryption.
- **Step-up authentication** (`STEP_UP_AUTHENTICATION`, `STEP_UP_AUTHENTICATION_SAML`, both
  `Type.DEFAULT`) lets an authentication flow require a stronger factor (e.g. OTP) only when the
  requested resource demands a higher Authentication Context Class Reference (ACR).
- **WebAuthn/Passkeys** (`WEB_AUTHN`, `PASSKEYS`, both `Type.DEFAULT`) and **Kerberos** SPNEGO
  (`KERBEROS`, auto-detected from the JVM) are both first-class, non-gated authenticators.

---

## 6. Database Design

Confirmed via `@Table` annotations in
`model/jpa/src/main/java/org/keycloak/models/jpa/entities/*.java` (all real, read directly):

| Entity class | Table |
|---|---|
| `RealmEntity` | `REALM` |
| `RealmAttributeEntity` | `REALM_ATTRIBUTE` |
| `ClientEntity` | `CLIENT` (unique on `REALM_ID, CLIENT_ID`) |
| `ClientAttributeEntity` | `CLIENT_ATTRIBUTES` |
| `ClientScopeEntity` | `CLIENT_SCOPE` |
| `ClientInitialAccessEntity` | `CLIENT_INITIAL_ACCESS` |
| `UserEntity` | `USER_ENTITY` |
| `UserAttributeEntity` | `USER_ATTRIBUTE` |
| `CredentialEntity` | `CREDENTIAL` |
| `UserConsentEntity` | `USER_CONSENT` |
| `FederatedIdentityEntity` | `FEDERATED_IDENTITY` |
| `GroupEntity` | `KEYCLOAK_GROUP` |
| `GroupAttributeEntity` | `GROUP_ATTRIBUTE` |
| `GroupRoleMappingEntity` | `GROUP_ROLE_MAPPING` |
| `RoleEntity` | `KEYCLOAK_ROLE` |
| `RoleAttributeEntity` | `ROLE_ATTRIBUTE` |
| `CompositeRoleEntity` | `COMPOSITE_ROLE` |
| `UserRoleMappingEntity` | `USER_ROLE_MAPPING` |
| `AuthenticationFlowEntity` | `AUTHENTICATION_FLOW` |
| `AuthenticationExecutionEntity` | `AUTHENTICATION_EXECUTION` |
| `AuthenticatorConfigEntity` | `AUTHENTICATOR_CONFIG` |
| `IdentityProviderEntity` | `IDENTITY_PROVIDER` |
| `IdentityProviderMapperEntity` | `IDENTITY_PROVIDER_MAPPER` |
| `ComponentEntity` / `ComponentConfigEntity` | `COMPONENT` / `COMPONENT_CONFIG` (generic extension-point storage: user federation providers, key providers, etc.) |
| `OrganizationEntity` | `ORG` |
| `OrganizationDomainEntity` | `ORG_DOMAIN` |
| `OrganizationInvitationEntity` | `ORG_INVITATION` |
| `RevokedTokenEntity` | `REVOKED_TOKEN` |
| `MigrationModelEntity` | `MIGRATION_MODEL` |
| `RealmLocalizationTextsEntity` | `REALM_LOCALIZATIONS` |
| `OutboxEntryEntity` | `OUTBOX_ENTRY` (transactional outbox pattern, present in current source) |

Note: **user sessions, client sessions, and authentication sessions are NOT primarily JPA/RDBMS
entities** — they live in Infinispan (`model/infinispan/src/main/java/org/keycloak/models/sessions/`,
§9/§10), except when the `PERSISTENT_USER_SESSIONS` feature (`Type.DEFAULT`,
`FeatureUpdatePolicy.SHUTDOWN`) is enabled, which additionally persists sessions to the DB so they
survive restarts/upgrades. User Storage Federation (LDAP/Kerberos/SSSD) means the `USER_ENTITY`
table often holds only a local shadow/cache record, with the source of truth in the external store
— confirmed by the presence of `UserFederationProviderEntity`/`UserFederationMapperEntity` (legacy)
and the `federation/` module's `UserStorageProviderFactory` implementations.

---

## 7. Folder Structure (annotated)

```
adapters/            Legacy SAML Java adapters (saml/, spi/) for protecting non-Keycloak apps
authz/                Authorization Services (fine-grained UMA policy engine): client, policy/common
authzen/              OpenID AuthZen protocol support (experimental)
boms/                 Maven Bills of Materials for consumers
common/               Cross-cutting utilities incl. Profile.java (feature flags), crypto interfaces
core/                 Shared representations (JSON DTOs for REST API, e.g. RealmRepresentation)
crypto/               default / fips1402 / elytron crypto provider implementations
dependencies/         Dependency management
distribution/         Packaging: galleon feature packs, server-provisioning.xml, SAML adapter zips
federation/           UserStorageProvider impls: ldap, kerberos, sssd, ipatuura
integration/          Integration glue modules
js/                   pnpm workspace: admin-ui, account-ui, keycloak-server, theme scaffolder
maven-settings.xml    Build config
model/                jpa (RDBMS persistence), infinispan (caching/session/clustering), storage,
                      storage-private, storage-services (federation SPI plumbing)
operator/             Kubernetes Operator (CRDs + reconciler)
quarkus/              The actual server runtime distribution: config-api, container, deployment,
                      runtime (kc.sh CLI), server, dist
rest/                 Additional REST resource modules (e.g. admin-ui-ext for console-only endpoints)
saml-core/            SAML protocol object model + XML processing
saml-core-api/        SAML API surface shared by server + adapters
scim/                 SCIM 2.0 API implementation (Preview feature)
server-spi/           Public extension-point interfaces (what third-party providers implement)
server-spi-private/   Internal-only SPIs not intended for external providers
services/             Core runtime logic: protocol endpoints, auth flows, admin REST resources,
                      events, identity brokering, timers
ssf/                  Shared Signals Framework support (experimental)
test-framework/        Newer test harness (replacing parts of testsuite/)
testsuite/            Arquillian-based integration test suite
themes/               FreeMarker templates for login/email/account UIs
util/                 Misc utility module
```

---

## 8. Deployment Architecture

Per official docs (`www.keycloak.org/high-availability/introduction`, fetched):
- Keycloak ships as a Quarkus-based standalone server (`kc.sh`/`kc.bat`), officially distributed
  also as a container image and via a Kubernetes Operator (`operator/` in this repo, CRDs
  `Keycloak` and `KeycloakRealmImport`).
- A production RDBMS is required — Postgres, MySQL, MariaDB, Oracle, MS SQL Server are supported
  (H2 is dev/demo-only, confirmed by `DB_TIDB` appearing as an `EXPERIMENTAL` feature alongside the
  established set in `Profile.java`).
- **Single-cluster HA:** multiple Keycloak nodes behind a load balancer, sharing one database and
  forming one Infinispan cluster for session/cache replication.
- **Multi-site / multi-cluster HA:** two deployment models per docs — a v1 model using external
  Infinispan clusters (Data Grid) with a maximum of two sites, and a newer v2/"no external
  Infinispan cluster required" model (tied to the `MULTI_SITE` feature, `Type.DISABLED_BY_DEFAULT`,
  `FeatureUpdatePolicy.SHUTDOWN`, confirmed in `Profile.java`) that shifts session storage to the
  database instead, at the cost of materially higher DB read/write load. An external load balancer
  is required in both models.
- The `STATELESS` feature (`Type.PREVIEW`) and `CLUSTERLESS` feature (`Type.EXPERIMENTAL`) in
  `Profile.java` point at further architectural evolution toward reducing/removing the Infinispan
  clustering dependency — both still previews/experiments as of this source snapshot, NOT
  production defaults.

---

## 9. Worker Architecture

Keycloak has no separate worker-process tier (unlike n8n/BullMQ-style engines). Background work
runs as **in-process scheduled tasks** via the `org.keycloak.timer` SPI
(`services/src/main/java/org/keycloak/timer/`, `TimerProvider`/`TimerProviderFactory`), confirmed
scheduled classes in `model/storage-private/src/main/java/org/keycloak/services/scheduled/`:
- `ClearExpiredUserSessions`
- `ClearExpiredClientInitialAccessTokens`
- `ClearExpiredEvents`
- `ClearExpiredAdminEvents`
- `ClearExpiredRevokedTokens`
- `ClearExpiredIssuedVerifiableCredentials`

These run on a fixed interval inside every Keycloak node (guarded by a DB-lock mechanism,
`model/storage-private/.../models/dblock/`, so only one cluster node executes a given sweep at a
time). There is no separate worker fleet to scale independently — cleanup is intrinsically
lightweight relative to request traffic.

---

## 10. Queue Architecture

**Confirmed: Keycloak has no traditional message/task queue (no Kafka/RabbitMQ/BullMQ-equivalent
in the core server).** Its "queue" mechanism is Infinispan distributed caching, used for two very
different purposes:
1. **Session/cluster-state replication** — `model/infinispan/src/main/java/org/keycloak/models/`
   (`cache/`, `sessions/`) implement `CacheRealmProviderFactory`, `UserCacheProviderFactory`,
   `InfinispanConnectionProviderFactory` (all real META-INF/services entries found under
   `model/infinispan/src/main/resources/META-INF/services/`). Named caches include (per official
   HA docs and standard Keycloak cache config) `realms`, `users`, `authorization`, `keys`,
   `sessions`, `clientSessions`, `offlineSessions`, `offlineClientSessions`,
   `authenticationSessions`, `loginFailures`, `actionTokens`, and `work` (a pub/sub-style cache used
   to invalidate local caches across cluster nodes when an entity changes).
2. **Cross-node cache invalidation** — the `work` cache functions like a lightweight internal event
   bus: a node that changes a cached entity publishes an invalidation message so peer nodes evict
   their local copies. This is Infinispan's clustering/cache-invalidation mechanism, not a
   general-purpose task queue with retry/backoff semantics.

The `PublicKeyStorageProviderFactory` and `CrlStorageProviderFactory` (also under
`model/infinispan/.../META-INF/services/`) similarly use Infinispan as a distributed cache for
external keys/CRLs, reinforcing that Infinispan's role here is caching + clustering coordination,
not durable job queuing.

---

## 11. API Structure

**Admin REST API** (`services/src/main/java/org/keycloak/services/resources/admin/`, JAX-RS
resources, real classes found): `AdminRoot`, `RealmAdminResource`, `ClientsResource`/`ClientResource`,
`ClientScopesResource`, `ClientRoleMappingsResource`, `GroupsResource`/`GroupResource`,
`IdentityProvidersResource`/`IdentityProviderResource`, `ComponentResource` (used for federation
providers, key providers — generic pluggable-config CRUD), `AuthenticationManagementResource` (flow
management), `AttackDetectionResource` (brute-force unlock endpoints), `ClientPoliciesResource`/
`ClientProfilesResource`, `ProtocolMappersResource`, `KeyResource`. (User management resources exist
under the same package tree — not all individually re-listed here; confirmed present via directory
listing.)

**End-user-facing protocol endpoints** (`services/src/main/java/org/keycloak/protocol/oidc/endpoints/`):
`AuthorizationEndpoint`, `TokenEndpoint`, `TokenIntrospectionEndpoint`, `TokenRevocationEndpoint`,
`UserInfoEndpoint`, `LogoutEndpoint`, plus discovery (`/.well-known/openid-configuration`) and JWKS
serving. SAML endpoints are served by `protocol/saml/SamlService.java` at
`/realms/{realm}/protocol/saml`.

**Account Console REST API** backs the React `js/apps/account-ui` app (self-service password/2FA/
sessions/consent management for end users) — separate from the Admin REST API's realm-management
surface.

---

## 12. Extension Points (SPIs) — the most important section

Keycloak's primary extensibility mechanism is the **Service Provider Interface (SPI)** pattern,
built on the JDK `ServiceLoader` convention. Confirmed directly:
- `server-spi/src/main/java/org/keycloak/provider/ProviderFactory.java` defines the universal
  contract every SPI implementation follows: `create(KeycloakSession)`, `init(Config.Scope)`,
  `postInit(KeycloakSessionFactory)`, `close()`, `getId()`. Keycloak's own doc comment states:
  *"At boot time, keycloak discovers all factories. For each discovered factory, the init() method
  is called... Only one instance of a factory exists per server."*
- A repo-wide search found **270 `META-INF/services/org.keycloak.*` registration files** across
  modules — the concrete evidence that this ServiceLoader-based SPI mechanism is used pervasively,
  not just documented in theory.

Key SPI families found under `server-spi/src/main/java/org/keycloak/` (real package listing):
`component`, `credential`, `keys`, `locale`, `organization`, `policy`, `provider`, `sessions`,
`storage` (UserStorageProvider — the federation SPI), `theme`, `userprofile`, `vault`. Plus, in
`services/` (private/implementation-facing but still extension-relevant): `authentication`
(custom `Authenticator`/`AuthenticatorFactory` for building new login-flow steps),
`broker` (custom identity-provider/broker types), `events` (`EventListenerProvider` for streaming
login/admin events to external systems — the standard integration point for SIEM/audit pipelines),
`scripting` (JavaScript-based authenticators/mappers, `SCRIPTS` feature, `Type.PREVIEW`).

The most commercially relevant SPIs for an integration study like this one:
- **UserStorageProvider** (`storage` SPI) — write a custom provider to federate Orlixa's own user
  table as an external Keycloak identity source instead of duplicating users into Keycloak's own
  `USER_ENTITY` table.
- **EventListenerProvider** — hook into every login/admin event for audit-log or webhook fan-out.
- **Authenticator/AuthenticatorFactory** — insert custom steps into a login flow (e.g. an org-
  specific MFA policy).
- **Protocol Mapper** (`ProtocolMapperEntity`/`ProtocolMappersResource`) — shape which claims land
  in an issued token, the mechanism by which Orlixa's own claims (companyId, role) could be
  injected into a Keycloak-issued token if it were ever fronting Orlixa auth.

---

## 13. Plugin System

Confirmed via official docs and `quarkus/` build source: custom SPI provider implementations are
packaged as a plain JAR (containing the `META-INF/services/org.keycloak.<Spi>` file plus the
implementation classes) and dropped into the server distribution's `providers/` directory. The
Quarkus build-time extension (`quarkus/deployment/src/main/java/org/keycloak/quarkus/deployment/KeycloakProcessor.java`
handles Quarkus-side augmentation) requires a `kc.sh build` re-run after adding/removing a
provider JAR, because Quarkus performs build-time class scanning/augmentation rather than pure
runtime classloading — this is a real operational step, not merely a restart. This is a simpler,
file-drop mechanism compared to some other engines in this study that require in-process code
registration; it also means custom providers are a deploy-time (not per-tenant dynamic) concern.

---

## 14. Scalability

Per official HA docs (fetched): horizontal scaling is achieved by running multiple stateless-ish
Keycloak nodes behind a load balancer, sharing one RDBMS and one Infinispan cluster (embedded
clustering via UDP/TCP discovery, or JGroups-based clustering configured via Quarkus config).
Multi-site scaling requires either the v1 (external Infinispan/Data Grid, max 2 sites) or the newer
v2 experimental (`MULTI_SITE` feature) model that trades the external cache tier for materially
higher database load. `PERSISTENT_USER_SESSIONS` (`Type.DEFAULT`) lets sessions survive node
restarts/rolling upgrades by also writing them to the DB. There is no documented practical limit on
realms/clients/users beyond normal RDBMS + cache-sizing capacity planning (per docs: "one Keycloak
deployment can define, store, and manage as many realms as there is space for in the database").

---

## 15. Multi-tenancy

Keycloak's native multi-tenancy primitive is the **Realm** — confirmed by official docs: *"A realm
manages a set of users, credentials, roles, and groups... Realms are isolated from one another and
can only manage and authenticate the users that they control."* Each realm gets its own issuer URL,
its own signing keys, its own clients, its own login theme, and complete configuration isolation.

**Organizations** (the newer feature the brief asked to investigate specifically) is a *finer-
grained* multi-tenancy primitive that lives **inside a single realm**, not a replacement for
realms. Confirmed in code: `ORGANIZATION("Organization support within realms", Type.DEFAULT)` in
`common/src/main/java/org/keycloak/common/Profile.java` — it is a **Community, `DEFAULT`-type
feature, enabled by default**, with no Enterprise gate found anywhere in `Profile.java`'s type
system. Per the official server-admin docs (fetched): Organizations let admins group users, assign
organization-specific domains (e.g. mapping an email domain to an org for auto-join at
registration), attach organization-specific identity providers (so each customer org can bring its
own IdP under one shared realm), and manage member invitations/onboarding — backed by real JPA
entities `OrganizationEntity` (`ORG`), `OrganizationDomainEntity` (`ORG_DOMAIN`), and
`OrganizationInvitationEntity` (`ORG_INVITATION`) confirmed in `model/jpa/.../entities/`.

For the Orlixa-relevant design question (one realm per Orlixa company vs. one shared realm +
Keycloak Organization per company): **the shared-realm + Organizations model is the lighter, more
directly analogous fit** to Orlixa's existing per-company tenancy model, since it avoids the
operational overhead of realm-per-tenant (separate signing keys, separate admin objects, separate
theme/branding config, no realm count limit concerns but real per-realm administrative surface).
Realm-per-tenant would only make sense if Orlixa needed to give each enterprise customer a fully
independent, separately brandable, separately governed IdP instance — which is a heavier posture
than the platform's current single-shared-app model.

---

## 16. Security

Confirmed built-in, from real source:
- **Token signing:** RS256 by default (asymmetric JWS), keys managed via the `keys` SPI
  (`ComponentEntity`-backed keystore providers); other algorithms configurable per realm/client.
- **Brute-force detection:** a first-class built-in feature —
  `server-spi-private/src/main/java/org/keycloak/services/managers/BruteForceProtector.java`
  (+`BruteForceProtectorFactory`/`BruteForceProtectorSpi`) with concrete implementations
  `DefaultBruteForceProtector.java` and `DefaultBlockingBruteForceProtector.java` in `services/`,
  plus an admin-facing `AttackDetectionResource` REST resource to view/unlock locked accounts.
- **Refresh token handling:** managed centrally by
  `services/src/main/java/org/keycloak/protocol/oidc/TokenManager.java`; realm settings control
  refresh token lifetime and (per official docs) revocation/rotation behavior — offline vs. regular
  refresh tokens are tracked distinctly in the session caches (§9/§10).
- **Step-up authentication and WebAuthn/Passkeys** (§5) provide phishing-resistant MFA as
  `Type.DEFAULT` (non-gated) features.
- **FIPS 140-2 mode** exists as a `Type.DISABLED_BY_DEFAULT` (opt-in, not Enterprise-gated) feature
  with its own `crypto/fips1402` provider module.

---

## 17. Limitations (real gaps found)

- Operationally heavy for a small platform: requires its own RDBMS, its own clustering layer
  (Infinispan), its own upgrade/rolling-update discipline (several features are explicitly
  `FeatureUpdatePolicy.SHUTDOWN`, meaning enabling/disabling them requires a full cluster
  shutdown, not a rolling update — confirmed in `Profile.java`, e.g. `MULTI_SITE`,
  `PERSISTENT_USER_SESSIONS`, `STATELESS`, `CLUSTERLESS`).
- Feature maturity (`DEFAULT`/`PREVIEW`/`EXPERIMENTAL`/`DEPRECATED`) is only fully visible in
  the code — an integrator must read `Profile.java`'s `Type` values, not a marketing page, to know
  what's stable.
- Multi-site HA is explicitly still evolving: v1 is capped at 2 sites, v2 is `EXPERIMENTAL` and
  materially increases DB load — neither is a mature, simple "just scale it" story (per official
  HA docs).
- Admin/account console UIs (`js/apps/admin-ui`, `js/apps/account-ui`) are opinionated React SPAs
  Orlixa would either have to embed/iframe or fully ignore in favor of its own UI — Keycloak is not
  designed to have its login/admin screens invisibly white-labeled without theme work.

---

## 18. Enterprise-only Features

**No genuine Enterprise-only code-level gate was found in this open-source clone.** Direct
evidence: `common/src/main/java/org/keycloak/common/Profile.java`'s `Feature.Type` enum has exactly
five values — `DEFAULT`, `DISABLED_BY_DEFAULT`, `DEPRECATED`, `PREVIEW`/`PREVIEW_DISABLED_BY_DEFAULT`,
`EXPERIMENTAL` — and **no `ENTERPRISE`/`COMMERCIAL`/licensed type exists**. Every one of the ~70
features enumerated (including `ORGANIZATION`, `SCIM_API`, `AUTHORIZATION`, `ADMIN_FINE_GRAINED_AUTHZ_V2`,
etc.) is gated only by its maturity stage (default-on, opt-in, preview, experimental, deprecated),
never by a license key or subscription check. This matches Keycloak's status as a CNCF-hosted,
fully community Apache-2.0 project. "Red Hat Build of Keycloak" (RHBK), per Red Hat's own product
positioning, is the same upstream code delivered as a certified/supported build with an SLA and
FIPS-validated crypto builds for regulated customers — it is **a support and certification
product, not a separate feature tier**; this could not be independently verified beyond the
absence of any Enterprise gate in the code and is otherwise **NOT VERIFIED** against Red Hat's
commercial subscription terms directly (that content lives behind Red Hat's own product pages, not
the OSS docs/source examined here).

---

## 19. Community Features (confirmed to ship free under Apache 2.0)

Everything enumerated in `Profile.java` ships in this Apache-2.0 repo with no license gate,
including: full OIDC/OAuth2 (Authorization Code+PKCE, Client Credentials, Device Flow, CIBA, PAR),
SAML 2.0 IdP/SP flows, Organizations (multi-tenancy within a realm), Authorization Services
(fine-grained UMA policy engine), Admin Fine-Grained Permissions v2, WebAuthn/Passkeys, Kerberos/
SPNEGO, brute-force protection, LDAP/Kerberos/SSSD user federation, event listeners, custom SPI
providers (the entire extension mechanism), SCIM API (Preview), the Kubernetes Operator, and
Infinispan-based HA clustering.

---

## 20. Which parts should Orlixa reuse

- **Nothing needs to be reused wholesale.** The concrete, justified slice is: adopt Keycloak
  **only as an OIDC/SAML broker for the enterprise tier**, i.e. stand up one shared Keycloak realm
  (with a Keycloak **Organization** per enterprise customer, §15) purely to let those customers
  connect their own corporate IdP (Azure AD/Okta/ADFS via SAML or OIDC federation) — a capability
  Orlixa's own JWT system does not and should not try to reimplement.
  Orlixa's backend would treat Keycloak as just another OIDC provider it trusts, translating the
  federated identity into Orlixa's own JWT once, at the boundary — not replacing the JWT issuance
  Orlixa already relies on internally.
- The **Organizations** feature specifically fits the "one shared realm, N tenants" model, avoiding
  a heavier realm-per-customer design.
- The **UserStorageProvider SPI** (§12) is the concrete mechanism to consider *if* Keycloak is ever
  the source of truth for identity, allowing Orlixa's own user table to remain authoritative while
  Keycloak federates against it rather than duplicating user records.

## 21. Which parts should Orlixa replace

- **Nothing.** Replacing Orlixa's already-working JWT auth (access+refresh tokens, Passport JWT
  strategy, RolesGuard, per-company tenancy) with Keycloak end-to-end would mean standing up and
  operating an entirely new stateful service (its own RDBMS tables, its own Infinispan cluster,
  its own upgrade discipline, §17) to reproduce functionality Orlixa already has working in-process
  with zero extra infrastructure. This is a clear case of over-engineering for the platform's
  current stage — there is no current requirement (SSO/SAML demand from an enterprise buyer) that
  Orlixa's own system cannot satisfy today.

## 22. Which parts should Orlixa ignore

- The **Admin Console / Account Console React SPAs** (`js/apps/admin-ui`, `js/apps/account-ui`) —
  Orlixa has its own UI and would not expose Keycloak's own consoles to end users.
- The **legacy SAML Java adapters** (`adapters/saml`) — irrelevant to a Node/NestJS stack.
- **Authorization Services** (the UMA-style fine-grained policy engine, `authz/`) — Orlixa's own
  RolesGuard/OWNER-ADMIN-MEMBER model already solves its authorization needs at a much lower
  operational cost; Keycloak's policy engine would be substantial added complexity for no current
  requirement.
- **Kerberos/SPNEGO and LDAP/SSSD federation** (`federation/`) — no on-prem AD/Kerberos requirement
  exists for Orlixa's customer base today.
- **The Kubernetes Operator** (`operator/`) and multi-site/`MULTI_SITE` HA modes (§8/§14) — far
  beyond Orlixa's current deployment scale; revisit only if/when an enterprise customer contractually
  requires geo-redundant identity infrastructure.
- **SCIM API** (`scim/`, Preview) — no current requirement for automated user-provisioning from
  customers' HR/IdP systems; revisit only if enterprise buyers request SCIM provisioning alongside
  SSO.
