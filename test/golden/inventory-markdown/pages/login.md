# Login

Part of [Inventory App](../README.md).

## Description

Users sign in with their email and password.

## Acceptance criteria

- [ ] A wrong password shows the error from the API above the form
- [ ] The email stays filled in after an error
- [ ] A locked account sees when it can try again

## Mockups

![Sign-in form](../images/login/01-login-form.png)

_Sign-in form_

![Wrong password](../images/login/02-login-error.png)

_Wrong password_

## Endpoints

| When | Method | Path | Summary | Status |
| --- | --- | --- | --- | --- |
| When the page loads — Skip the page when already signed in | `GET` | [`/me`](#get-me) | Current user | Agreed |
| On form submit — Show errors inline | `POST` | [`/auth/login`](#post-authlogin) | Sign in | Agreed |

### GET /me

Current user

- **When:** When the page loads — Skip the page when already signed in
- **Status:** Agreed
- **Authentication:** bearerAuth (project default)

#### Responses

##### 200 OK

`application/json` — [User](../models.md#user)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `id` | string (uuid) | Yes |  |  |
| `name` | string | Yes |  |  |
| `email` | string (email) | Yes |  |  |

Example `ana`:

```json
{
  "id": "0b5c2d4e-8f1a-4b3c-9d2e-7a6f5e4d3c2b",
  "name": "Ana Lima",
  "email": "ana@example.com"
}
```

##### 401 Unauthorized

`application/json` — [Error](../models.md#error)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `message` | string | Yes |  |  |
| `code` | string |  | Stable code to branch on, e.g. ACCOUNT_LOCKED |  |

Example `signed-out`:

```json
{
  "message": "Sign in first."
}
```

### POST /auth/login

Sign in

- **When:** On form submit — Show errors inline
- **Status:** Agreed
- **Authentication:** None (public)

After 5 wrong passwords in a row the account is locked for 15 minutes.

#### Request body

Required.

`application/json` — object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `email` | string (email) | Yes |  |  |
| `password` | string (password) | Yes |  | at least 8 characters |
| `remember` | boolean |  | Keep the session for 30 days |  |

Example `valid`:

```json
{
  "email": "ana@example.com",
  "password": "correct-horse",
  "remember": true
}
```

#### Responses

##### 200 OK

`application/json` — object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `token` | string | Yes |  |  |
| `user` | [User](../models.md#user) | Yes |  |  |
| `user.id` | string (uuid) | Yes |  |  |
| `user.name` | string | Yes |  |  |
| `user.email` | string (email) | Yes |  |  |

Example `signed-in`:

```json
{
  "token": "eyJhbGciOi...",
  "user": {
    "id": "0b5c2d4e-8f1a-4b3c-9d2e-7a6f5e4d3c2b",
    "name": "Ana Lima",
    "email": "ana@example.com"
  }
}
```

##### 401 Unauthorized

`application/json` — [Error](../models.md#error)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `message` | string | Yes |  |  |
| `code` | string |  | Stable code to branch on, e.g. ACCOUNT_LOCKED |  |

Example `wrong-password`:

```json
{
  "message": "Email or password is wrong. 4 attempts left.",
  "code": "WRONG_PASSWORD"
}
```

##### 423 Account locked

`application/json` — [Error](../models.md#error)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `message` | string | Yes |  |  |
| `code` | string |  | Stable code to branch on, e.g. ACCOUNT_LOCKED |  |

Example `locked`:

```json
{
  "message": "Too many attempts. Try again in 15 minutes.",
  "code": "ACCOUNT_LOCKED"
}
```

**Notes for frontend:** Keep the email after an error.
