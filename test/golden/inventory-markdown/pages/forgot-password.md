# Forgot password

Part of [Inventory App](../README.md).

## Description

Sends a link to set a new password.

## Acceptance criteria

- [ ] After sending, the page always says "If an account exists for this email, we sent a link", even for unknown emails
- [ ] A 429 shows when the user can ask again

## Mockups

![forgot-password.png](../images/forgot-password/01-forgot-password.png)

## Endpoints

| When | Method | Path | Summary | Status |
| --- | --- | --- | --- | --- |
| On form submit | `POST` | [`/auth/forgot-password`](#post-authforgot-password) | Email a password reset link | Draft |

### POST /auth/forgot-password

Email a password reset link

- **When:** On form submit
- **Status:** Draft
- **Authentication:** None (public)

The link works once, for 1 hour. Always answers 202, so it doesn't show which emails have accounts.

#### Request body

Required.

`application/json` — object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `email` | string (email) | Yes |  | at most 254 characters |

Example `email`:

```json
{
  "email": "ana@example.com"
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
