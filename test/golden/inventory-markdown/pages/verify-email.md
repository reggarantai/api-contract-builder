# Verify email

Part of [Inventory App](../README.md).

## Description

Opens from the link in the verification email: `/verify-email?token=…`.

## Acceptance criteria

- [ ] The token is sent as soon as the page opens
- [ ] The token is removed from the address bar once it's read (`history.replaceState`), and the page is served with `Referrer-Policy: no-referrer`, so the token can't leak
- [ ] On success, the page says the email is verified and offers to sign in
- [ ] An invalid or expired link shows a form to send a new one

## Mockups

![The link has expired](../images/verify-email/01-verify-email-expired.png)

_The link has expired_

## Endpoints

| When | Method | Path | Summary | Status |
| --- | --- | --- | --- | --- |
| When the page loads — Token from the `token` query parameter | `POST` | [`/auth/verify-email`](#post-authverify-email) | Verify an email address | In review |
| On form submit — When the link is invalid or expired | `POST` | [`/auth/verify-email/resend`](#post-authverify-emailresend) | Send a new verification email | In review |

### POST /auth/verify-email

Verify an email address

- **When:** When the page loads — Token from the `token` query parameter
- **Status:** In review
- **Authentication:** None (public)

The token comes from the link in the verification email: `/verify-email?token=…`. A link that was already used answers 204 again while its account stays verified, so opening it twice, or an email scanner opening it first, isn't an error.

#### Request body

Required.

`application/json` — object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `token` | string | Yes |  | at least 1 character |

Example `from-link`:

```json
{
  "token": "ev_3Hq8sK2wN6"
}
```

#### Responses

##### 204 No Content

No body.

##### 400 Bad Request

`application/problem+json` — [Problem](../models.md#problem)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `type` | string (uri) | Yes | Identifies the kind of problem. It's stable: branch on it. |  |
| `title` | string | Yes | Short summary of the kind of problem |  |
| `status` | integer | Yes | The HTTP status code | 400–599 |
| `detail` | string |  | What went wrong this time, in words for people |  |
| `instance` | string (uri-reference) |  | Identifies this occurrence. Quote it when reporting a problem. |  |

Example `invalid-link`:

```json
{
  "type": "https://api.inventory.example/problems/invalid-link",
  "title": "Invalid or expired link",
  "status": 400,
  "detail": "This link is invalid or has expired. Ask for a new one."
}
```

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

Example `missing-token`:

```json
{
  "type": "https://api.inventory.example/problems/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "Some fields are invalid.",
  "errors": [
    {
      "pointer": "#/token",
      "detail": "Send the token from the link."
    }
  ]
}
```

**Notes for backend:** Store link tokens hashed.

### POST /auth/verify-email/resend

Send a new verification email

- **When:** On form submit — When the link is invalid or expired
- **Status:** In review
- **Authentication:** None (public)

Always answers 202, so it doesn't show which emails have accounts. An account that's already verified gets an email saying so, with a link to sign in; an unknown email gets nothing.

#### Request body

Required.

`application/json` — object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `email` | string (email) | Yes |  | at most 254 characters |

Example `email`:

```json
{
  "email": "budi@example.com"
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

Example `invalid-email`:

```json
{
  "type": "https://api.inventory.example/problems/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "Some fields are invalid.",
  "errors": [
    {
      "pointer": "#/email",
      "detail": "Enter an email address."
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
