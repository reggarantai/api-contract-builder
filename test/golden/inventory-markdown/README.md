# Inventory App

Stock and warehouse API.

API version **1.2.0**.

## Contents

- [Pages](#pages): what each screen does and which endpoints it calls
- [Models](models.md): shared data shapes
- [`inventory-app.openapi.yaml`](inventory-app.openapi.yaml): the contract for code generators and mock servers

## Servers

| Name | URL | Notes |
| --- | --- | --- |
| Production | https://api.inventory.example/v1 |  |
| Staging | https://staging.inventory.example/v1 | Reset every night |

## Authentication

Unless an endpoint says otherwise, requests use **bearerAuth**.

| Scheme | How to send | Notes |
| --- | --- | --- |
| bearerAuth | `Authorization: Bearer <JWT>` | Token from POST /auth/login |
| apiKeyAuth | `X-API-Key: <key>` | For server-to-server calls |

## Pages

| Page | Endpoints | Mockups |
| --- | --- | --- |
| [Login](pages/login.md) | 2 | 2 |
| [Registration](pages/registration.md) | 1 | 1 |
| [Stock list](pages/stock-list.md) | 2 | 1 |
| [Create schedule](pages/create-schedule.md) | 3 | 1 |

## Endpoints

| Method | Path | Summary | Status | Pages |
| --- | --- | --- | --- | --- |
| `POST` | `/auth/login` | Sign in | Agreed | [Login](pages/login.md#post-authlogin) |
| `POST` | `/auth/register` | Create an account | In review | [Registration](pages/registration.md#post-authregister) |
| `GET` | `/health` | Health check | Draft | — |
| `GET` | `/me` | Current user | Agreed | [Login](pages/login.md#get-me) |
| `POST` | `/schedules` | Create a restock schedule | Draft | [Create schedule](pages/create-schedule.md#post-schedules) |
| `GET` | `/stocks` | List stock items | Agreed | [Stock list](pages/stock-list.md#get-stocks), [Create schedule](pages/create-schedule.md#get-stocks) |
| `DELETE` | `/stocks/{sku}` | Remove a stock item | In review | [Stock list](pages/stock-list.md#delete-stockssku) |
| `GET` | `/suppliers` | List suppliers | Draft | [Create schedule](pages/create-schedule.md#get-suppliers) |

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
