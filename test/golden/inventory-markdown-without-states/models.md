# Models

Shared data shapes the endpoints use. Part of [Inventory App](README.md).

## Category

A group of stock items, like Packaging.

Type: object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `id` | string (uuid) | Yes |  |  |
| `name` | string | Yes |  | 1–60 characters |

## PageMeta

Where a page of results sits in the whole list.

Type: object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `page` | integer | Yes | The page number | ≥ 1 |
| `pageSize` | integer | Yes | Items per page | 1–100 |
| `totalItems` | integer | Yes | Items in the whole list | ≥ 0 |
| `totalPages` | integer | Yes | 0 when the list is empty | ≥ 0 |

## Problem

An error, as RFC 9457 problem details. Branch on `type`, not on `title` or `detail`.

Type: object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `type` | string (uri) | Yes | Identifies the kind of problem. It's stable: branch on it. |  |
| `title` | string | Yes | Short summary of the kind of problem |  |
| `status` | integer | Yes | The HTTP status code | 400–599 |
| `detail` | string |  | What went wrong this time, in words for people |  |
| `instance` | string (uri-reference) |  | Identifies this occurrence. Quote it when reporting a problem. |  |

## Session

An access token. The refresh token isn't in the body: it's in the `refresh_token` cookie, which scripts can't read.

Type: object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `accessToken` | string | Yes | Send as `Authorization: Bearer <token>`. Keep it in memory only. |  |
| `tokenType` | string | Yes |  | always `Bearer` |
| `expiresIn` | integer | Yes | Seconds until the access token expires | ≥ 1 |

## StockItem

Something the warehouse keeps in stock. Its quantity only changes through stock movements.

Type: object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `id` | string (uuid) | Yes |  |  |
| `sku` | string | Yes | Stock keeping unit: upper-case letters, digits, and hyphens. Unique among items that aren't deleted. | pattern `^[A-Z0-9-]{3,32}$` |
| `name` | string | Yes |  | 1–120 characters |
| `description` | string or null | Yes |  | at most 2000 characters |
| `category` | [Category](#category) | Yes |  |  |
| `unit` | string | Yes | What quantities count. It can't change once the item has stock movements. | one of `piece`, `box`, `roll`, `pack` |
| `quantityOnHand` | integer | Yes |  | ≥ 0 |
| `reorderPoint` | integer | Yes | At or below this quantity, the item is low on stock | 0–1000000 |
| `stockStatus` | string | Yes | `out_of_stock` at 0; `low_stock` at or below `reorderPoint` | one of `in_stock`, `low_stock`, `out_of_stock` |
| `createdAt` | string (date-time) | Yes |  |  |
| `updatedAt` | string (date-time) | Yes |  |  |

## StockItemInput

A new stock item. It starts with 0 on hand: record a receipt to add stock.

Type: object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `sku` | string | Yes | Stock keeping unit: upper-case letters, digits, and hyphens. Unique among items that aren't deleted. | pattern `^[A-Z0-9-]{3,32}$` |
| `name` | string | Yes |  | 1–120 characters |
| `description` | string or null |  |  | at most 2000 characters |
| `categoryId` | string (uuid) | Yes |  |  |
| `unit` | string | Yes | What quantities count. It can't change once the item has stock movements. | one of `piece`, `box`, `roll`, `pack` |
| `reorderPoint` | integer |  | At or below this quantity, the item is low on stock | 0–1000000; default `0` |

## StockItemUpdate

Changes to a stock item, as a JSON Merge Patch: send only the fields that change. The quantity isn't here; record a stock movement instead.

Type: object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `sku` | string |  | Stock keeping unit: upper-case letters, digits, and hyphens. Unique among items that aren't deleted. | pattern `^[A-Z0-9-]{3,32}$` |
| `name` | string |  |  | 1–120 characters |
| `description` | string or null |  |  | at most 2000 characters |
| `categoryId` | string (uuid) |  |  |  |
| `unit` | string |  | What quantities count. It can't change once the item has stock movements. | one of `piece`, `box`, `roll`, `pack` |
| `reorderPoint` | integer |  | At or below this quantity, the item is low on stock | 0–1000000 |

## StockMovement

One change to an item's quantity on hand. Movements can't be changed or deleted; record a count to correct a mistake.

Type: object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `id` | string (uuid) | Yes |  |  |
| `type` | string | Yes | `receipt` adds stock, `issue` takes it out, `count` sets it to what was counted | one of `receipt`, `issue`, `count` |
| `quantity` | integer | Yes | As entered: the amount received or issued, or the counted quantity | ≥ 0 |
| `quantityChange` | integer | Yes | How the quantity on hand changed: positive or negative |  |
| `quantityAfter` | integer | Yes | Quantity on hand after this movement | ≥ 0 |
| `reference` | string or null | Yes | Delivery note, order, or ticket number | at most 64 characters |
| `note` | string or null | Yes |  | at most 500 characters |
| `createdBy` | object | Yes | Who recorded it |  |
| `createdBy.id` | string (uuid) | Yes |  |  |
| `createdBy.name` | string | Yes |  |  |
| `createdAt` | string (date-time) | Yes |  |  |

## StockMovementInput

A stock movement to record.

Type: object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `type` | string | Yes | `receipt` adds stock, `issue` takes it out, `count` sets it to what was counted | one of `receipt`, `issue`, `count` |
| `quantity` | integer | Yes | At least 1 for receipts and issues | 0–1000000 |
| `reference` | string or null |  | Delivery note, order, or ticket number | at most 64 characters |
| `note` | string or null |  |  | at most 500 characters |

## User

A person who can sign in.

Type: object

| Field | Type | Required | Description | Rules |
| --- | --- | --- | --- | --- |
| `id` | string (uuid) | Yes |  |  |
| `name` | string | Yes |  | 1–80 characters |
| `email` | string (email) | Yes | Unique, ignoring case | at most 254 characters |
| `role` | string | Yes | Admins can also delete stock items | one of `admin`, `staff` |
| `emailVerified` | boolean | Yes | Users can sign in once their email is verified |  |
| `createdAt` | string (date-time) | Yes |  |  |

## ValidationProblem

A 422 problem: some fields of the request body are invalid.

Type: object

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
