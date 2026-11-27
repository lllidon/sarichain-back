# Hybrid shipping architecture

## Accepted product decisions

- Fulfilment strategy: hybrid. Compare direct dispatch from producer pickup points with consolidation through the configured Sarichain hub.
- Storefront choices: economy, standard, express, urgent.
- The backend is the pricing authority. The browser submits a quote snapshot only so the backend can detect stale prices/routes.
- Perishable, refrigerated and fragile requirements are catalog data, not customer guesses.
- A producer offer must reference a mapped pickup location for new offers.

## Quote inputs

1. Cart lines: product, offer, sale unit and quantity.
2. Destination: coordinates belonging to the customer's selected saved delivery address.
3. Product physical metadata: shipping weight or package dimensions, optional standard density, refrigeration requirement, temperature interval and fragile flag.
4. Producer pickup location: coordinates from the location referenced by the offer.
5. Admin tariff record: base, distance, billable weight, stop, minimum, speed multipliers, cold-chain, fragile, and hub parameters.

If weight is missing, the quote engine uses a clearly disclosed 1 kg per-sale-unit fallback. If package dimensions are missing, volume is estimated as weight divided by the configured standard density (default 250 kg/m³; at the 1 kg fallback this is 4 litres per unit). These fallback values are used only for freight estimation and are not written back as measured product specifications. A mapped pickup point is still required; origin coordinates are never invented.

## Customer delivery address book

- A marketplace customer can save up to 20 delivery addresses on their own member profile. Each entry stores a stable ID, title, recipient/contact details, postal address and optional latitude/longitude.
- Address editing and map pin selection live in account profile settings (`/partners?section=profile`), not in the cart.
- The cart loads the signed-in customer's saved addresses and displays only an address selector and read-only address summary. It does not render a map or accept ad-hoc coordinates.
- A saved address without both coordinates cannot produce a shipping quote or be used for checkout. The customer must edit that address in profile settings and set its delivery point on the map.
- Quote requests use the selected saved address coordinates. At checkout the backend resolves `addressId` against the authenticated member's saved addresses and uses stored coordinates rather than trusting client-supplied coordinates.
- The selected address ID is included in the order delivery snapshot for later fulfilment.

## Hybrid route selection

For each service level:

- Direct plan: calculate a producer-to-destination route for each distinct pickup group and sum its transport charge.
- Hub plan: calculate each producer-to-hub leg, then one hub-to-destination leg. Add configured hub handling and per-kilogram handling fees.
- Select the lower priced feasible plan.
- Hub consolidation is excluded unless the hub is enabled, coordinates and positive weight/volume capacities are configured, the order fits those capacities, the hub supports refrigeration when required, and all pickup groups share a compatible temperature band.
- Products from different temperature bands are kept in separate pickup groups; the hub plan is disabled when those groups cannot safely be consolidated.

Road distance uses the existing OSRM-compatible routing helper. When road routing is unavailable, the quote reports that it used a direct-distance estimate. The UI must disclose that estimate.

## Pricing

Billable weight:

`max(actual weight, volume × configured density)`

Transport charge reuses the existing transport tariff formula and speed multipliers. Cold-chain base/per-kilogram charges and fragile multiplier are then applied. Hub handling is added only for the hub plan.

All prices are calculated and rounded on the backend. At checkout, the backend recomputes the quote and compares the submitted fee, route mode and distance snapshot. A changed quote is rejected with a conflict so the customer can review the updated choices.

## API contract

- `POST /web/delivery-options`: accepts `items[]` and `destination{latitude,longitude}`; returns the four computed options and their price breakdown, route mode, distance and date windows.
- `POST /web/orders`: delivery selection includes method, dispatch date, slot, saved `addressId` and the quote snapshot; the backend resolves destination coordinates from the authenticated customer's address book (`quotedFee`, `quotedRouteMode`, `quotedDistanceKm`). The backend recomputes before persistence.
- `GET /web/delivery-options` retains the previous three fixed-fee methods for old storefront clients during staged rollout. The updated cart uses `POST` for cart-specific quotes. Legacy order submissions without destination coordinates remain accepted; new quote-backed orders are revalidated.

## Customer-facing order numbers

- Format: `SCYYMMDDCCNNNN` (14 characters), where `YYMMDD` is the Iranian/Jalali date in the `Asia/Tehran` time zone, `CC` is the last two digits of the customer's normalized mobile number (or `00` when unavailable), and `NNNN` is a zero-padded sequence.
- The sequence is allocated atomically in MongoDB per Jalali date and customer suffix, so concurrent order creation cannot allocate the same number.
- The sequence is padded to at least four digits and is not truncated if daily volume exceeds 9,999 for a suffix.
- The persistence layer accepts both MongoDB driver return shapes for `findOneAndUpdate` (legacy `ModifyResult.value` and newer direct-document result).

## Admin configuration

The existing `transport_zone_tariffs` singleton stores the new parameters:

- Refrigerated base charge and per-kilogram charge.
- Fragile multiplier.
- Hub enabled flag, coordinates, handling charge and per-kilogram charge.
- Hub refrigeration and fragile-handling capability, plus maximum weight/volume.

Defaults keep the hub disabled and refrigerated surcharges at zero until management configures real operating costs and capacities.

## Operational rollout requirements

1. Existing producer offers may not have a pickup location. Producers can assign a mapped orchard/warehouse location to existing offers from the products dashboard; new offers require this location.
2. Existing catalog products may not have physical specifications. Management should fill actual shipping weight and package dimensions whenever possible; until then, the storefront discloses the 1 kg / density-based volume estimate. Refrigeration and fragile flags should be reviewed.
3. Management must configure the hub location, capacity and cold-chain capability before consolidation can be considered.
4. Delivery dates are estimates, not capacity reservations. Same-day slots are filtered against Tehran local time. Driver availability, working hours, dispatch cutoffs, vehicle refrigeration certification and time-slot capacity must be connected before presenting these estimates as guaranteed commitments.
5. A later optimization phase should add route matrix optimization, vehicle matching and shipment scheduling. The current hybrid comparison is a cost estimate over producer pickup groups, not a dispatch assignment.

## Implementation status

The first implementation slice adds tariff controls, product shipping metadata, mandatory mapped pickup locations for new offers, backend hybrid quote calculation and quote revalidation, plus destination selection and four quote choices in the cart. It does not yet reserve a driver, verify live vehicle availability, or guarantee delivery times.
