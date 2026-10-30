# Login

Part of [Inventory App](../README.md).

## Description

Users sign in with email and password.

## Acceptance criteria

_None yet._

## Mockups

![Sign-in form](../images/login/01-form.png)

_Sign-in form_

![Wrong password](../images/login/02-error.png)

_Wrong password_

## Endpoints

| When | Method | Path | Summary | Status |
| --- | --- | --- | --- | --- |
| On form submit — Show errors inline | `POST` | [`/auth/login`](#post-authlogin) | Sign in | Agreed |

### POST /auth/login

Sign in

- **When:** On form submit — Show errors inline
- **Status:** Agreed
- **Authentication:** None (public)

#### Request body

Required.

`application/json` — object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `email` | string (email) | Yes |  |  |
| `password` | string (password) | Yes |  | at least 8 characters |

Example `valid`:

```json
{
  "email": "ana@example.com",
  "password": "correct-horse"
}
```

#### Responses

##### 200 OK

`application/json` — object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `token` | string | Yes |  |  |

Example `signed-in`:

```json
{
  "token": "eyJhbGciOi..."
}
```

##### 401 Unauthorized

`application/json` — [Error](../models.md#error)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `message` | string | Yes |  |  |
| `code` | string |  |  |  |

Example `wrong-password`:

```json
{
  "message": "Email or password is wrong"
}
```

**Notes for frontend:** Keep the email after an error.
