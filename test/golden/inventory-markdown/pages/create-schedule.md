# Create schedule

Part of [Inventory App](../README.md).

## Description

Plans recurring restock deliveries from a supplier.

## Acceptance criteria

- [ ] The first delivery can't be in the past

## Mockups

![create-schedule.png](../images/create-schedule/01-create-schedule.png)

## Endpoints

| When | Method | Path | Summary | Status |
| --- | --- | --- | --- | --- |
| When the page loads — Fill the supplier list | `GET` | [`/suppliers`](#get-suppliers) | List suppliers | Draft |
| When the page loads — Fill the item list | `GET` | [`/stocks`](#get-stocks) | List stock items | Agreed |
| On form submit | `POST` | [`/schedules`](#post-schedules) | Create a restock schedule | Draft |

### GET /suppliers

List suppliers

- **When:** When the page loads — Fill the supplier list
- **Status:** Draft
- **Authentication:** bearerAuth (project default)

#### Responses

##### 200 OK

`application/json` — array of [Supplier](../models.md#supplier)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `[].id` | string (uuid) | Yes |  |  |
| `[].name` | string | Yes |  |  |
| `[].email` | string (email) |  |  |  |

Example `one-supplier`:

```json
[
  {
    "id": "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b",
    "name": "Acme Supplies",
    "email": "orders@acme.example"
  }
]
```

### GET /stocks

List stock items

- **When:** When the page loads — Fill the item list
- **Status:** Agreed
- **Authentication:** bearerAuth (project default)

#### Parameters

| Name | In | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- | --- |
| `page` | query | integer |  | Page number, from 1 | ≥ 1 |
| `category` | query | string (uuid) |  | Only items in this category |  |
| `search` | query | string |  | Matches SKU or name |  |

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

### POST /schedules

Create a restock schedule

- **When:** On form submit
- **Status:** Draft
- **Authentication:** bearerAuth (project default)

#### Request body

Required.

`application/json` — object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `supplierId` | string (uuid) | Yes |  |  |
| `sku` | string | Yes |  |  |
| `quantity` | integer | Yes |  | ≥ 1 |
| `firstDelivery` | string (date) | Yes |  |  |
| `repeat` | string | Yes |  | one of `once`, `weekly`, `monthly` |
| `note` | string or null |  |  | at most 500 characters |

Example `weekly`:

```json
{
  "supplierId": "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b",
  "sku": "SKU-002",
  "quantity": 50,
  "firstDelivery": "2026-11-15",
  "repeat": "weekly",
  "note": null
}
```

#### Responses

##### 201 Created

`application/json` — [Schedule](../models.md#schedule)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `id` | string (uuid) | Yes |  |  |
| `supplierId` | string (uuid) | Yes |  |  |
| `sku` | string | Yes |  |  |
| `quantity` | integer | Yes |  | ≥ 1 |
| `firstDelivery` | string (date) | Yes |  |  |
| `repeat` | string | Yes |  | one of `once`, `weekly`, `monthly` |
| `note` | string or null |  |  | at most 500 characters |

Example `created`:

```json
{
  "id": "4d3c2b1a-0f9e-4d8c-b7a6-5f4e3d2c1b0a",
  "supplierId": "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b",
  "sku": "SKU-002",
  "quantity": 50,
  "firstDelivery": "2026-11-15",
  "repeat": "weekly",
  "note": null
}
```

##### 422 Unprocessable Content

`application/json` — [Error](../models.md#error)

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `message` | string | Yes |  |  |
| `code` | string |  | Stable code to branch on, e.g. ACCOUNT_LOCKED |  |

Example `past-date`:

```json
{
  "message": "The first delivery must be in the future.",
  "code": "DATE_IN_PAST"
}
```

**Notes for frontend:** Only offer items whose supplier is set.
