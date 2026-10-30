# Stock list

Part of [Inventory App](../README.md).

## Description

All items, newest first.

## Acceptance criteria

_None yet._

## Mockups

![table.png](../images/stock-list/01-table.png)

## Endpoints

| When | Method | Path | Summary | Status |
| --- | --- | --- | --- | --- |
| When the page loads | `GET` | [`/stocks`](#get-stocks) | List stock items | Agreed |
| On a user action — Delete button in each row | `DELETE` | [`/stocks/{sku}`](#delete-stockssku) | Remove a stock item | Draft |

### GET /stocks

List stock items

- **When:** When the page loads
- **Status:** Agreed
- **Authentication:** bearerAuth (project default)

#### Parameters

| Name | In | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- | --- |
| `page` | query | integer |  | Page number, from 1 | ≥ 1 |
| `category` | query | string (uuid) |  | Only items in this category |  |

#### Responses

##### 200 OK

`application/json` — array of [Stock](../models.md#stock)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `[].sku` | string | Yes |  | pattern `^[A-Z0-9-]+$` |
| `[].name` | string | Yes |  | at most 120 characters |
| `[].quantity` | integer | Yes |  | ≥ 0 |
| `[].category` | [Category](../models.md#category) |  |  |  |
| `[].category.id` | string (uuid) | Yes |  |  |
| `[].category.name` | string | Yes |  |  |
| `[].category.parent` | [Category](../models.md#category) or null |  |  |  |
| `[].tags` | array of string |  |  | unique items |

Example `two-items` — Two items:

```json
[
  {
    "sku": "SKU-001",
    "name": "Widget",
    "quantity": 12,
    "category": {
      "id": "6f1c2b9e-0b7a-4c64-9a8e-2f1d3c4b5a69",
      "name": "Parts",
      "parent": null
    },
    "tags": [
      "metal"
    ]
  },
  {
    "sku": "SKU-002",
    "name": "Gadget",
    "quantity": 0
  }
]
```

Example `empty` — No items yet:

```json
[]
```

### DELETE /stocks/{sku}

Remove a stock item

- **When:** On a user action — Delete button in each row
- **Status:** Draft
- **Authentication:** apiKeyAuth
- **Deprecated:** avoid in new code

#### Parameters

| Name | In | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- | --- |
| `sku` | path | string | Yes | Stock keeping unit |  |

#### Responses

##### 204 No Content

No body.
