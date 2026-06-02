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
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [inputValue, setInputValue] = useState(value);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    if (!placesLib || !inputRef.current) return;

    autocompleteRef.current = new placesLib.Autocomplete(inputRef.current, {
      fields: ["formatted_address", "geometry", "place_id"],
      types: ["geocode", "establishment"],
    });

    const listener = autocompleteRef.current.addListener("place_changed", () => {
      const place = autocompleteRef.current?.getPlace();
      if (!place?.geometry?.location) return;

      const result: AddressSelection = {
        address: place.formatted_address ?? inputRef.current?.value ?? "",
        lat: place.geometry.location.lat(),
        lng: place.geometry.location.lng(),
        place_id: place.place_id ?? null,
      };
      setInputValue(result.address);
      onSelect(result);
    });

    return () => {
      google.maps.event.removeListener(listener);
    };
  }, [placesLib, onSelect]);

  return (
    <div className="relative">
      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400 pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        placeholder={placeholder}
        aria-invalid={ariaInvalid}
        onChange={(e) => {
          setInputValue(e.target.value);
          onChange?.(e.target.value);
        }}
        className={cn(
          "flex h-10 w-full rounded-lg border border-neutral-200 bg-white pl-9 pr-3 py-2 text-sm",
          "placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
          "disabled:cursor-not-allowed disabled:opacity-50",
          ariaInvalid && "border-error-500 focus-visible:ring-error-500",
          className
        )}
      />
    </div>
  );
}
