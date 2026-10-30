# Registration

Part of [Inventory App](../README.md).

## Description

New staff create an account with their work email.

## Acceptance criteria

- [ ] Each error in a 422 shows under the field its `pointer` names
- [ ] After sending, the page asks the user to check their email and shows the address, whether or not it already had an account
- [ ] A 429 shows when the user can try again

## Mockups

![registration-form.png](../images/registration/01-registration-form.png)

![After sending the form](../images/registration/02-registration-check-email.png)

_After sending the form_

## Endpoints

| When | Method | Path | Summary | Status |
| --- | --- | --- | --- | --- |
| On form submit | `POST` | [`/auth/register`](#post-authregister) | Create an account | Agreed |

### POST /auth/register

Create an account

- **When:** On form submit
- **Status:** Agreed
- **Authentication:** None (public)

Always answers 202, whether or not the email has an account, so it doesn't show who has one. A new account gets a link to verify the address. An existing account gets an email saying so, with links to sign in and to reset the password; an unverified one gets a new link.

#### Request body

Required.

`application/json` — object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `name` | string | Yes |  | 1–80 characters |
| `email` | string (email) | Yes |  | at most 254 characters |
| `password` | string (password) | Yes | At least 12 characters, and not in known data breaches | 12–128 characters |

Example `new-user`:

```json
{
  "name": "Budi Santoso",
  "email": "budi@example.com",
  "password": "correct-horse-battery"
}
```

#### Responses

##### 202 Accepted

No body.

##### 422 Unprocessable Content

`application/problem+json` — [ValidationProblem](../models.md#validationproblem)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `type` | string (uri) | Yes | Identifies the kind of problem. It's stable: branch on it. |  |
| `title` | string | Yes | Short summary of the kind of problem |  |
| `status` | integer | Yes | The HTTP status code | 400–599 |
| `detail` | string |  | What went wrong this time, in words for people |  |
| `instance` | string (uri-reference) |  | Identifies this occurrence. Quote it when reporting a problem. |  |
| `errors` | array of object | Yes | One entry per invalid field | at least 1 item |
| `errors[].pointer` | string | Yes | JSON Pointer (RFC 6901) to the field in the request body, as a URI fragment like `#/email` |  |
| `errors[].detail` | string | Yes | What's wrong with it |  |

Example `short-password`:

```json
{
  "type": "https://api.inventory.example/problems/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "Some fields are invalid.",
  "errors": [
    {
      "pointer": "#/password",
      "detail": "Use at least 12 characters."
    }
  ]
}
```

Example `breached-password`:

```json
{
  "type": "https://api.inventory.example/problems/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "Some fields are invalid.",
  "errors": [
    {
      "pointer": "#/password",
      "detail": "This password appeared in a data breach. Choose another."
    }
  ]
}
```

##### 429 Too Many Requests

| Header | Type | Required | Description | Rules | Example |
| --- | --- | --- | --- | --- | --- |
| `Retry-After` | integer | Yes | Seconds to wait before trying again | ≥ 1 | `60` |

`application/problem+json` — [Problem](../models.md#problem)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `type` | string (uri) | Yes | Identifies the kind of problem. It's stable: branch on it. |  |
| `title` | string | Yes | Short summary of the kind of problem |  |
| `status` | integer | Yes | The HTTP status code | 400–599 |
| `detail` | string |  | What went wrong this time, in words for people |  |
| `instance` | string (uri-reference) |  | Identifies this occurrence. Quote it when reporting a problem. |  |

Example `too-many-requests`:

```json
{
  "type": "https://api.inventory.example/problems/too-many-requests",
  "title": "Too many requests",
  "status": 429,
  "detail": "Wait a minute before asking for another email."
}
```

**Notes for backend:** The verification link works for 24 hours. New accounts get the staff role; admins are promoted outside this app. Check passwords against known breached passwords (NIST SP 800-63B).
