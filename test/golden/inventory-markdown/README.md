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
| [Login](pages/login.md) | 1 | 2 |
| [Stock list](pages/stock-list.md) | 2 | 1 |
| [Stock detail](pages/stock-detail.md) | 1 | 0 |
| [Add stock](pages/add-stock.md) | 1 | 0 |

## Endpoints

| Method | Path | Summary | Status | Pages |
| --- | --- | --- | --- | --- |
| `POST` | `/auth/login` | Sign in | Agreed | [Login](pages/login.md#post-authlogin) |
| `GET` | `/health` | Health check | Draft | — |
| `GET` | `/stocks` | List stock items | Agreed | [Stock list](pages/stock-list.md#get-stocks) |
| `POST` | `/stocks` | Add a stock item | In review | [Add stock](pages/add-stock.md#post-stocks) |
| `GET` | `/stocks/{sku}` | Get a stock item | Draft | [Stock detail](pages/stock-detail.md#get-stockssku) |
| `DELETE` | `/stocks/{sku}` | Remove a stock item | Draft | [Stock list](pages/stock-list.md#delete-stockssku) |

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
