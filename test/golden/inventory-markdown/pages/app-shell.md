# App shell

Part of [Inventory App](../README.md).

## Description

The layout around every signed-in page: navigation, the user menu, and keeping the session alive. It isn't a screen of its own, but its calls happen on every page.

## Acceptance criteria

- [ ] Opening a signed-in page without a session goes to Login, and back after signing in
- [ ] A 401 from any other endpoint refreshes once and repeats the call; if refreshing answers 401, the app goes to Login
- [ ] The user menu shows the user's name and role, and Sign out
- [ ] Sign out goes to Login, even if the request fails

## Mockups

![User menu open](../images/app-shell/01-app-shell.png)

_User menu open_

## Endpoints

| When | Method | Path | Summary | Status |
| --- | --- | --- | --- | --- |
| When the page loads — When there's no access token in memory yet, e.g. after a reload | `POST` | [`/auth/refresh`](#post-authrefresh) | Get a new access token | Agreed |
| When the page loads — Name and role for the user menu | `GET` | [`/me`](#get-me) | Current user | Agreed |
| Other — A minute before the access token expires, or once after a 401 | `POST` | [`/auth/refresh`](#post-authrefresh) | Get a new access token | Agreed |
| On a user action — Sign out, in the user menu | `POST` | [`/auth/logout`](#post-authlogout) | Sign out | Agreed |

### POST /auth/refresh

Get a new access token

- **When:** When the page loads — When there's no access token in memory yet, e.g. after a reload
- **When:** Other — A minute before the access token expires, or once after a 401
- **Status:** Agreed
- **Authentication:** refreshCookie

Exchanges the refresh token cookie for a new access token, and replaces the cookie. The session still ends 12 hours, or 30 days, after sign-in.

#### Responses

##### 200 OK

| Header | Type | Required | Description | Rules | Example |
| --- | --- | --- | --- | --- | --- |
| `Set-Cookie` | string | Yes | The new refresh token, with the same attributes. `Max-Age`, if set, is the time left in the session. |  | `refresh_token=rt_8Kd3nW1pZ7bT; HttpOnly; Secure; SameSite=Strict; Path=/v1/auth; Max-Age=2505600` |
| `Cache-Control` | string | Yes | Tokens must never be stored by a cache (RFC 6749) | always `no-store` |  |

`application/json` — [Session](../models.md#session)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `accessToken` | string | Yes | Send as `Authorization: Bearer <token>`. Keep it in memory only. |  |
| `tokenType` | string | Yes |  | always `Bearer` |
| `expiresIn` | integer | Yes | Seconds until the access token expires | ≥ 1 |

Example `refreshed`:

```json
{
  "accessToken": "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIwYjVjMmQ0ZSJ9.bmV3",
  "tokenType": "Bearer",
  "expiresIn": 900
}
```

##### 401 Unauthorized

| Header | Type | Required | Description | Rules | Example |
| --- | --- | --- | --- | --- | --- |
| `Set-Cookie` | string | Yes | Clears the refresh token cookie |  | `refresh_token=; HttpOnly; Secure; SameSite=Strict; Path=/v1/auth; Max-Age=0` |

`application/problem+json` — [Problem](../models.md#problem)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `type` | string (uri) | Yes | Identifies the kind of problem. It's stable: branch on it. |  |
| `title` | string | Yes | Short summary of the kind of problem |  |
| `status` | integer | Yes | The HTTP status code | 400–599 |
| `detail` | string |  | What went wrong this time, in words for people |  |
| `instance` | string (uri-reference) |  | Identifies this occurrence. Quote it when reporting a problem. |  |

Example `session-expired`:

```json
{
  "type": "https://api.inventory.example/problems/session-expired",
  "title": "Session expired",
  "status": 401,
  "detail": "Sign in again."
}
```

**Notes for frontend:** Call it directly, not through the code that refreshes on 401. Run one refresh at a time, across tabs too (e.g. with the Web Locks API): requests that get a 401 meanwhile wait for it, then retry once.

**Notes for backend:** Rotate the refresh token on every use. Accept the previous token for 30 seconds after it's replaced, since tabs can refresh at the same moment; after that, a reused token was probably stolen, so revoke every session of the user. Only accept requests whose `Origin` is the app.

### GET /me

Current user

- **When:** When the page loads — Name and role for the user menu
- **Status:** Agreed
- **Authentication:** bearerAuth (project default)

#### Responses

##### 200 OK

`application/json` — [User](../models.md#user)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `id` | string (uuid) | Yes |  |  |
| `name` | string | Yes |  | 1–80 characters |
| `email` | string (email) | Yes | Unique, ignoring case | at most 254 characters |
| `role` | string | Yes | Admins can also delete stock items | one of `admin`, `staff` |
| `emailVerified` | boolean | Yes | Users can sign in once their email is verified |  |
| `createdAt` | string (date-time) | Yes |  |  |

Example `ana`:

```json
{
  "id": "0b5c2d4e-8f1a-4b3c-9d2e-7a6f5e4d3c2b",
  "name": "Ana Lima",
  "email": "ana@example.com",
  "role": "admin",
  "emailVerified": true,
  "createdAt": "2026-03-02T09:00:00Z"
}
```

##### 401 Unauthorized

| Header | Type | Required | Description | Rules | Example |
| --- | --- | --- | --- | --- | --- |
| `WWW-Authenticate` | string | Yes | The Bearer challenge (RFC 6750). It adds `error="invalid_token"` when the token sent is expired or invalid. |  | `Bearer realm="inventory", error="invalid_token", error_description="The access token expired"` |

`application/problem+json` — [Problem](../models.md#problem)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `type` | string (uri) | Yes | Identifies the kind of problem. It's stable: branch on it. |  |
| `title` | string | Yes | Short summary of the kind of problem |  |
| `status` | integer | Yes | The HTTP status code | 400–599 |
| `detail` | string |  | What went wrong this time, in words for people |  |
| `instance` | string (uri-reference) |  | Identifies this occurrence. Quote it when reporting a problem. |  |

Example `token-expired`:

```json
{
  "type": "https://api.inventory.example/problems/token-expired",
  "title": "Access token expired",
  "status": 401,
  "detail": "Refresh the access token and try again."
}
```

Example `unauthenticated`:

```json
{
  "type": "https://api.inventory.example/problems/unauthenticated",
  "title": "Not signed in",
  "status": 401,
  "detail": "Send an access token in the Authorization header."
}
```

### POST /auth/logout

Sign out

- **When:** On a user action — Sign out, in the user menu
- **Status:** Agreed
- **Authentication:** None (public)

Revokes the refresh token in the cookie, if there is one, and clears the cookie. Always answers 204, so signing out can't fail.

#### Responses

##### 204 No Content

| Header | Type | Required | Description | Rules | Example |
| --- | --- | --- | --- | --- | --- |
| `Set-Cookie` | string | Yes | Clears the refresh token cookie |  | `refresh_token=; HttpOnly; Secure; SameSite=Strict; Path=/v1/auth; Max-Age=0` |

No body.

**Notes for frontend:** The access token works until it expires, so drop it from memory, even if this request fails.

**Notes for backend:** Only revoke when the request's `Origin` is the app.
