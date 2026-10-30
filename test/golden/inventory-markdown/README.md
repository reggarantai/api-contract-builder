# Inventory App

Stock tracking for the warehouse team: accounts and sign-in, stock items, and stock movements.

Every endpoint follows these conventions:

- **Errors** are problem details ([RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)) in `application/problem+json`; branch on `type`. 400 means invalid query or header parameters, 422 invalid body fields (listed in `errors`), and 404 an unknown or deleted ID. Other errors, like 415 or 500, are problem details too.
- **Authentication**: send `Authorization: Bearer <access token>`. A 401 means the token is missing or expired: refresh once with `POST /auth/refresh`, then retry. If refreshing answers 401, sign in again.
- **Paged lists** return `{ data, meta }` and take `page` and `pageSize`. Short lists return `{ data }`.
- **Creates** take an `Idempotency-Key` header, so a retry never creates something twice.
- **Requests** send JSON. PATCH sends a JSON Merge Patch (`application/merge-patch+json`).
- **Responses** send `Cache-Control: no-store`.
- **CORS** allows only the app's origin, with credentials. It exposes `Location` and `Retry-After` to scripts, and allows the `Idempotency-Key` request header.
- **Times** are UTC, in RFC 3339 format.

API version **1.0.0**.

## Contents

- [Pages](#pages): what each screen does and which endpoints it calls
- [Models](models.md): shared data shapes
- [`inventory-app.openapi.yaml`](inventory-app.openapi.yaml): the contract for code generators and mock servers

## Servers

| Name | URL | Notes |
| --- | --- | --- |
| Production | https://api.inventory.example/v1 |  |
| Staging | https://api.inventory-staging.example/v1 | Reset every night. A separate site, so cookies never cross between staging and production. |

## Authentication

Unless an endpoint says otherwise, requests use **bearerAuth**.

| Scheme | How to send | Notes |
| --- | --- | --- |
| bearerAuth | `Authorization: Bearer <JWT>` | Access token from POST /auth/login or POST /auth/refresh. It expires after 15 minutes. |
| refreshCookie | `Cookie: refresh_token=<key>` | HttpOnly cookie set by POST /auth/login and replaced by POST /auth/refresh. |

## Pages

| Page | Endpoints | Mockups |
| --- | --- | --- |
| [Login](pages/login.md) | 2 | 2 |
| [Registration](pages/registration.md) | 1 | 2 |
| [Verify email](pages/verify-email.md) | 2 | 1 |
| [Forgot password](pages/forgot-password.md) | 1 | 1 |
| [Reset password](pages/reset-password.md) | 1 | 1 |
| [App shell](pages/app-shell.md) | 3 | 1 |
| [Stock list](pages/stock-list.md) | 3 | 1 |
| [Stock item](pages/stock-item.md) | 3 | 2 |
| [Add or edit stock item](pages/add-or-edit-stock-item.md) | 4 | 1 |

## Endpoints

| Method | Path | Summary | Status | Pages |
| --- | --- | --- | --- | --- |
| `POST` | `/auth/forgot-password` | Email a password reset link | Draft | [Forgot password](pages/forgot-password.md#post-authforgot-password) |
| `POST` | `/auth/login` | Sign in | Agreed | [Login](pages/login.md#post-authlogin) |
| `POST` | `/auth/logout` | Sign out | Agreed | [App shell](pages/app-shell.md#post-authlogout) |
| `POST` | `/auth/refresh` | Get a new access token | Agreed | [App shell](pages/app-shell.md#post-authrefresh) |
| `POST` | `/auth/register` | Create an account | Agreed | [Registration](pages/registration.md#post-authregister) |
| `POST` | `/auth/reset-password` | Set a new password | Draft | [Reset password](pages/reset-password.md#post-authreset-password) |
| `POST` | `/auth/verify-email` | Verify an email address | In review | [Verify email](pages/verify-email.md#post-authverify-email) |
| `POST` | `/auth/verify-email/resend` | Send a new verification email | In review | [Login](pages/login.md#post-authverify-emailresend), [Verify email](pages/verify-email.md#post-authverify-emailresend) |
| `GET` | `/categories` | List categories | Agreed | [Stock list](pages/stock-list.md#get-categories), [Add or edit stock item](pages/add-or-edit-stock-item.md#get-categories) |
| `GET` | `/me` | Current user | Agreed | [App shell](pages/app-shell.md#get-me) |
| `GET` | `/stock-items` | List stock items | Agreed | [Stock list](pages/stock-list.md#get-stock-items) |
| `POST` | `/stock-items` | Add a stock item | Agreed | [Add or edit stock item](pages/add-or-edit-stock-item.md#post-stock-items) |
| `GET` | `/stock-items/{itemId}` | Get a stock item | Agreed | [Stock item](pages/stock-item.md#get-stock-itemsitemid), [Add or edit stock item](pages/add-or-edit-stock-item.md#get-stock-itemsitemid) |
| `PATCH` | `/stock-items/{itemId}` | Update a stock item | Agreed | [Add or edit stock item](pages/add-or-edit-stock-item.md#patch-stock-itemsitemid) |
| `DELETE` | `/stock-items/{itemId}` | Delete a stock item | In review | [Stock list](pages/stock-list.md#delete-stock-itemsitemid) |
| `GET` | `/stock-items/{itemId}/movements` | List an item's stock movements | Agreed | [Stock item](pages/stock-item.md#get-stock-itemsitemidmovements) |
| `POST` | `/stock-items/{itemId}/movements` | Record a stock movement | In review | [Stock item](pages/stock-item.md#post-stock-itemsitemidmovements) |

## Mock the API

Run a mock server from the OpenAPI file in this folder. It answers with the examples from this contract on http://127.0.0.1:4010.

```bash
npx @stoplight/prism-cli mock inventory-app.openapi.yaml
```

Ask for a specific response or a named example with the `Prefer` header:

```bash
curl -H "Prefer: code=404" http://127.0.0.1:4010/<path>
curl -H "Prefer: example=<example name>" http://127.0.0.1:4010/<path>
```
