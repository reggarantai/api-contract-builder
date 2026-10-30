# Registration

Part of [Inventory App](../README.md).

## Description

New users create an account with their work email.

## Acceptance criteria

- [ ] An email that's already registered shows a link to sign in
- [ ] The password needs at least 8 characters

## Mockups

![registration.png](../images/registration/01-registration.png)

## Endpoints

| When | Method | Path | Summary | Status |
| --- | --- | --- | --- | --- |
| On form submit | `POST` | [`/auth/register`](#post-authregister) | Create an account | In review |

### POST /auth/register

Create an account

- **When:** On form submit
- **Status:** In review
- **Authentication:** None (public)

#### Request body

Required.

`application/json` — object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `name` | string | Yes |  | 1–80 characters |
| `email` | string (email) | Yes |  |  |
| `password` | string (password) | Yes |  | at least 8 characters |

Example `new-user`:

```json
{
  "name": "Ana Lima",
  "email": "ana@example.com",
  "password": "correct-horse"
}
```

#### Responses

##### 201 Created

`application/json` — [User](../models.md#user)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `id` | string (uuid) | Yes |  |  |
| `name` | string | Yes |  |  |
| `email` | string (email) | Yes |  |  |

Example `created`:

```json
{
  "id": "0b5c2d4e-8f1a-4b3c-9d2e-7a6f5e4d3c2b",
  "name": "Ana Lima",
  "email": "ana@example.com"
}
```

##### 409 Conflict

`application/json` — [Error](../models.md#error)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `message` | string | Yes |  |  |
| `code` | string |  | Stable code to branch on, e.g. ACCOUNT_LOCKED |  |

Example `email-taken`:

```json
{
  "message": "An account with this email already exists.",
  "code": "EMAIL_TAKEN"
}
```

**Notes for backend:** Send a welcome email after creating the account.
