# Models

Shared data shapes the endpoints use. Part of [Inventory App](README.md).

## Category

A group of stock items.

Type: object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `id` | string (uuid) | Yes |  |  |
| `name` | string | Yes |  |  |
| `parent` | [Category](#category) or null |  |  |  |

## Error

Type: object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `message` | string | Yes |  |  |
| `code` | string |  | Stable code to branch on, e.g. ACCOUNT_LOCKED |  |

## Schedule

Recurring deliveries of one item from one supplier.

Type: object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `id` | string (uuid) | Yes |  |  |
| `supplierId` | string (uuid) | Yes |  |  |
| `sku` | string | Yes |  |  |
| `quantity` | integer | Yes |  | ≥ 1 |
| `firstDelivery` | string (date) | Yes |  |  |
| `repeat` | string | Yes |  | one of `once`, `weekly`, `monthly` |
| `note` | string or null |  |  | at most 500 characters |

## Stock

An item in stock.

Type: object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `sku` | string | Yes |  | pattern `^[A-Z0-9-]+$` |
| `name` | string | Yes |  | at most 120 characters |
| `quantity` | integer | Yes |  | ≥ 0 |
| `category` | [Category](#category) |  |  |  |
| `tags` | array of string |  |  | unique items |

## Supplier

A company that delivers stock.

Type: object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `id` | string (uuid) | Yes |  |  |
| `name` | string | Yes |  |  |
| `email` | string (email) |  |  |  |

## User

A person who can sign in.

Type: object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `id` | string (uuid) | Yes |  |  |
| `name` | string | Yes |  |  |
| `email` | string (email) | Yes |  |  |
