# Places Autocomplete Migration: Autocomplete → PlaceAutocompleteElement

## Background

As of March 1, 2025, `google.maps.places.Autocomplete` is no longer available to new Google Maps customers. Google recommends migrating to `google.maps.places.PlaceAutocompleteElement`, a web component-based replacement.

**Affected file:** `frontend/src/components/routing/AddressAutocomplete.tsx`

---

## What Changed

### Before — `google.maps.places.Autocomplete`

- Attached to an existing `<input>` element via the DOM ref.
- Listened to the `place_changed` event.
- Called `getPlace()` synchronously to retrieve address data.
- Place fields (`formatted_address`, `geometry`, `place_id`) were requested at construction time.

```tsx
autocompleteRef.current = new placesLib.Autocomplete(inputRef.current, {
  fields: ["formatted_address", "geometry", "place_id"],
  types: ["geocode", "establishment"],
});

autocompleteRef.current.addListener("place_changed", () => {
  const place = autocompleteRef.current?.getPlace();
  // place.formatted_address, place.geometry.location, place.place_id
});
```

### After — `PlaceAutocompleteElement`

- A web component (`<gmp-place-autocomplete>`) created programmatically and appended to a container `<div>`.
- Listens to the `gmp-placeselect` event.
- Calls `place.fetchFields()` **asynchronously** to retrieve address data.
- Place fields are fetched on selection, not at construction time.

```tsx
const el = new placesLib.PlaceAutocompleteElement({
  types: ["geocode", "establishment"],
});
containerRef.current.appendChild(el);

el.addEventListener("gmp-placeselect", async (event) => {
  const place = event.place;
  await place.fetchFields({ fields: ["formattedAddress", "location", "id"] });
  // place.formattedAddress, place.location, place.id
});
```

---

## API Differences

| | `Autocomplete` | `PlaceAutocompleteElement` |
|---|---|---|
| Mount target | Existing `<input>` ref | Container `<div>` (element appends itself) |
| Selection event | `place_changed` | `gmp-placeselect` |
| Data retrieval | `getPlace()` — synchronous | `fetchFields()` — async/await |
| Field names | `formatted_address`, `geometry`, `place_id` | `formattedAddress`, `location`, `id` |
| Input tracking | Native React `onChange` on the `<input>` | `input` event listener on the element |

---

## Styling Notes

`PlaceAutocompleteElement` renders its own `<input>` inside a shadow DOM, so Tailwind classes cannot target it directly. The migration applies styles to the outer wrapper `<div>` using `focus-within:` variants for the focus ring and border.

To customize the inner input's appearance further, use Google's exposed CSS custom properties:

```css
gmp-place-autocomplete {
  --gmp-filled-input-text-color: #111;
  --gmp-filled-input-background-color: transparent;
}
```

See [Google's styling guide](https://developers.google.com/maps/documentation/javascript/place-autocomplete-element#style_the_component) for the full list of available properties.

---

## References

- [Google migration guide](https://developers.google.com/maps/documentation/javascript/places-migration-overview)
- [PlaceAutocompleteElement API reference](https://developers.google.com/maps/documentation/javascript/reference/place-autocomplete-element)
- [Legacy API notice](https://developers.google.com/maps/legacy)
