# Reset password

Part of [Inventory App](../README.md).

## Description

Opens from the link in the reset email: `/reset-password?token=…`.

## Acceptance criteria

- [ ] The token is removed from the address bar once it's read (`history.replaceState`), and the page is served with `Referrer-Policy: no-referrer`, so the token can't leak
- [ ] The form checks for at least 12 characters before sending
- [ ] On success, the user goes to Login, which says the password was changed and other devices were signed out
- [ ] An invalid or expired link shows a link to Forgot password

## Mockups

![reset-password.png](../images/reset-password/01-reset-password.png)

## Endpoints

| When | Method | Path | Summary | Status |
| --- | --- | --- | --- | --- |
| On form submit — Token from the `token` query parameter | `POST` | [`/auth/reset-password`](#post-authreset-password) | Set a new password | Draft |

### POST /auth/reset-password

Set a new password

- **When:** On form submit — Token from the `token` query parameter
- **Status:** Draft
- **Authentication:** None (public)

The token comes from the link in the reset email: `/reset-password?token=…`. Ends every session of the user: refresh tokens stop working at once, and access tokens already issued expire within 15 minutes.

#### Request body

Required.

`application/json` — object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `token` | string | Yes |  | at least 1 character |
| `password` | string (password) | Yes | At least 12 characters, and not in known data breaches | 12–128 characters |

Example `new-password`:

```json
{
  "token": "pr_7Tb2vX9kM4",
  "password": "staple-battery-horse"
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

**Notes for backend:** Store reset tokens hashed. Revoke every refresh token of the user.
