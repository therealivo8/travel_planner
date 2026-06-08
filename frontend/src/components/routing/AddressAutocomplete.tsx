"use client";

import { useEffect, useRef, useState } from "react";
import { useMapsLibrary } from "@vis.gl/react-google-maps";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AddressSelection {
  address: string;
  lat: number;
  lng: number;
  place_id: string | null;
}

interface Props {
  value: string;
  placeholder?: string;
  onSelect: (result: AddressSelection) => void;
  onChange?: (value: string) => void;
  className?: string;
  "aria-invalid"?: boolean;
}

export function AddressAutocomplete({
  value,
  placeholder = "Search for an address…",
  onSelect,
  onChange,
  className,
  "aria-invalid": ariaInvalid,
}: Props) {
  const placesLib = useMapsLibrary("places");
  const containerRef = useRef<HTMLDivElement>(null);
  const elementRef = useRef<google.maps.places.PlaceAutocompleteElement | null>(null);
  const [inputValue, setInputValue] = useState(value);
  const [committedValue, setCommittedValue] = useState(value);

  if (committedValue !== value) {
    setCommittedValue(value);
    setInputValue(value);
  }

  useEffect(() => {
    if (!placesLib || !containerRef.current) return;

    // PlaceAutocompleteElement is a web component — create and mount it
    const el = new placesLib.PlaceAutocompleteElement({
      types: ["geocode", "establishment"],
    });
    el.setAttribute("placeholder", placeholder);

    // Mirror our Tailwind input styles as inline style since the web component
    // renders its own shadow-DOM input; the outer wrapper handles the icon/border.
    el.style.width = "100%";

    containerRef.current.appendChild(el);
    elementRef.current = el;

    const handlePlaceSelect = async (
      event: google.maps.places.PlaceAutocompletePlaceSelectEvent
    ) => {
      const place = event.place;
      await place.fetchFields({ fields: ["formattedAddress", "location", "id"] });

      if (!place.location) return;

      const result: AddressSelection = {
        address: place.formattedAddress ?? "",
        lat: place.location.lat(),
        lng: place.location.lng(),
        place_id: place.id ?? null,
      };
      setInputValue(result.address);
      onSelect(result);
    };

    const handleInput = (event: Event) => {
      const target = event.target as HTMLInputElement;
      setInputValue(target.value);
      onChange?.(target.value);
    };

    el.addEventListener("gmp-placeselect", handlePlaceSelect as EventListener);
    el.addEventListener("input", handleInput);

    return () => {
      el.removeEventListener("gmp-placeselect", handlePlaceSelect as EventListener);
      el.removeEventListener("input", handleInput);
      el.remove();
      elementRef.current = null;
    };
    // onSelect/onChange identity changes should not remount the element
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placesLib, placeholder]);

  return (
    <div className="relative">
      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400 pointer-events-none z-10" />
      <div
        ref={containerRef}
        aria-invalid={ariaInvalid}
        className={cn(
          "flex h-10 w-full rounded-lg border border-neutral-200 bg-white pl-9 pr-3 text-sm overflow-hidden",
          "focus-within:ring-2 focus-within:ring-primary-500 focus-within:outline-none",
          "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
          ariaInvalid && "border-error-500 focus-within:ring-error-500",
          className
        )}
      />
    </div>
  );
}
