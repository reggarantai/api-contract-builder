# Login

Part of [Inventory App](../README.md).

## Description

Everyone who works with stock signs in here. Links to Registration and Forgot password.

## Acceptance criteria

- [ ] A wrong email or password shows the error above the form, and the email stays filled in
- [ ] An account that isn't verified yet sees a button to send a new verification email
- [ ] After too many attempts, the button stays disabled until the time from `Retry-After` has passed
- [ ] After signing in, the user lands on the page they asked for (only paths within this app), or on Stock list

## Mockups

![Sign-in form](../images/login/01-login-form.png)

_Sign-in form_

![Wrong email or password](../images/login/02-login-error.png)

_Wrong email or password_

## Endpoints

| When | Method | Path | Summary | Status |
| --- | --- | --- | --- | --- |
| On form submit | `POST` | [`/auth/login`](#post-authlogin) | Sign in | Agreed |
| On a user action — When the email isn't verified yet | `POST` | [`/auth/verify-email/resend`](#post-authverify-emailresend) | Send a new verification email | In review |

### POST /auth/login

Sign in

- **When:** On form submit
- **Status:** Agreed
- **Authentication:** None (public)

Returns an access token and sets the refresh token cookie. A session lasts 12 hours, or 30 days with `remember`, from sign-in; refreshing doesn't make it longer. Wrong credentials answer 400, not 401: a 401 always means the access token is missing or expired.

#### Request body

Required.

`application/json` — object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `email` | string (email) | Yes |  | at most 254 characters |
| `password` | string (password) | Yes |  | at most 128 characters |
| `remember` | boolean |  | Keep the session for 30 days instead of 12 hours |  |

Example `valid`:

```json
{
  "email": "ana@example.com",
  "password": "correct-horse-battery",
  "remember": true
}
```

#### Responses

##### 200 OK

| Header | Type | Required | Description | Rules | Example |
| --- | --- | --- | --- | --- | --- |
| `Set-Cookie` | string | Yes | The refresh token. With `remember`, `Max-Age` keeps it for the session's 30 days; without, it's a browser-session cookie. |  | `refresh_token=rt_5Jx2mQ9vL0aR; HttpOnly; Secure; SameSite=Strict; Path=/v1/auth; Max-Age=2592000` |
| `Cache-Control` | string | Yes | Tokens must never be stored by a cache (RFC 6749) | always `no-store` |  |

`application/json` — [Session](../models.md#session)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `accessToken` | string | Yes | Send as `Authorization: Bearer <token>`. Keep it in memory only. |  |
| `tokenType` | string | Yes |  | always `Bearer` |
| `expiresIn` | integer | Yes | Seconds until the access token expires | ≥ 1 |

Example `signed-in`:

```json
{
  "accessToken": "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIwYjVjMmQ0ZSJ9.c2ln",
  "tokenType": "Bearer",
  "expiresIn": 900
}
```

##### 400 Bad Request

`application/problem+json` — [Problem](../models.md#problem)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `type` | string (uri) | Yes | Identifies the kind of problem. It's stable: branch on it. |  |
| `title` | string | Yes | Short summary of the kind of problem |  |
| `status` | integer | Yes | The HTTP status code | 400–599 |
| `detail` | string |  | What went wrong this time, in words for people |  |
| `instance` | string (uri-reference) |  | Identifies this occurrence. Quote it when reporting a problem. |  |

Example `wrong-password`:

```json
{
  "type": "https://api.inventory.example/problems/invalid-credentials",
  "title": "Invalid credentials",
  "status": 400,
  "detail": "Email or password is wrong."
}
```

##### 403 Forbidden

`application/problem+json` — [Problem](../models.md#problem)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `type` | string (uri) | Yes | Identifies the kind of problem. It's stable: branch on it. |  |
| `title` | string | Yes | Short summary of the kind of problem |  |
| `status` | integer | Yes | The HTTP status code | 400–599 |
| `detail` | string |  | What went wrong this time, in words for people |  |
| `instance` | string (uri-reference) |  | Identifies this occurrence. Quote it when reporting a problem. |  |

Example `not-verified`:

```json
{
  "type": "https://api.inventory.example/problems/email-not-verified",
  "title": "Email not verified",
  "status": 403,
  "detail": "Verify your email address first. We sent a link to budi@example.com."
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
| `Retry-After` | integer | Yes | Seconds to wait before trying again | ≥ 1 | `900` |

`application/problem+json` — [Problem](../models.md#problem)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `type` | string (uri) | Yes | Identifies the kind of problem. It's stable: branch on it. |  |
| `title` | string | Yes | Short summary of the kind of problem |  |
| `status` | integer | Yes | The HTTP status code | 400–599 |
| `detail` | string |  | What went wrong this time, in words for people |  |
| `instance` | string (uri-reference) |  | Identifies this occurrence. Quote it when reporting a problem. |  |

Example `too-many-attempts`:

```json
{
  "type": "https://api.inventory.example/problems/too-many-attempts",
  "title": "Too many attempts",
  "status": 429,
  "detail": "Too many sign-in attempts. Try again in 15 minutes."
}
```

**Notes for frontend:** Keep the access token in memory, not in localStorage. Send API requests with `credentials: 'include'` so the browser keeps the cookie.

**Notes for backend:** Answer 400 for unknown emails too, and hash the password for them as well, so neither the answer nor its timing shows who has an account. Answer 403 only once the password matched. Throttle failed attempts per email and per IP address, unknown emails included, instead of locking accounts: a lock would let anyone lock a colleague out.

### POST /auth/verify-email/resend

Send a new verification email

- **When:** On a user action — When the email isn't verified yet
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
