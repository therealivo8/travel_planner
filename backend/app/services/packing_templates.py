"""Built-in packing templates (Phase 16, Part C). Constants, not a table: they ship with
the code and "add template" copies the items into the trip's own packing_items."""

TEMPLATES: dict[str, list[tuple[str, str]]] = {
    "Essentials": [
        ("Documents", "Driver's license"),
        ("Documents", "Insurance and registration"),
        ("Documents", "Printed or offline copy of itinerary"),
        ("Tech", "Phone charger"),
        ("Tech", "Car phone mount"),
        ("Tech", "Power bank"),
        ("Toiletries", "Toothbrush and toothpaste"),
        ("Toiletries", "Medications"),
        ("Toiletries", "Sunscreen"),
        ("Car", "Spare tire and jack"),
        ("Car", "Jumper cables"),
        ("Car", "First-aid kit"),
        ("Snacks", "Water bottles"),
        ("Snacks", "Road snacks"),
        ("Clothing", "Underwear and socks"),
        ("Clothing", "Comfortable shoes"),
    ],
    "Camping": [
        ("Shelter", "Tent"),
        ("Shelter", "Sleeping bags"),
        ("Shelter", "Sleeping pads"),
        ("Cooking", "Camp stove and fuel"),
        ("Cooking", "Cooler and ice"),
        ("Cooking", "Pots, pans and utensils"),
        ("Gear", "Headlamps and flashlight"),
        ("Gear", "Bug spray"),
        ("Gear", "Matches or lighter"),
        ("Gear", "Camp chairs"),
        ("Gear", "Trash bags"),
    ],
    "Beach": [
        ("Beach", "Swimsuits"),
        ("Beach", "Beach towels"),
        ("Beach", "Sunscreen (reef-safe)"),
        ("Beach", "Sun hat and sunglasses"),
        ("Beach", "Beach umbrella"),
        ("Beach", "Flip-flops"),
        ("Beach", "Cooler bag"),
    ],
    "Cold weather": [
        ("Clothing", "Warm jacket"),
        ("Clothing", "Gloves and hat"),
        ("Clothing", "Thermal layers"),
        ("Clothing", "Wool socks"),
        ("Car", "Ice scraper"),
        ("Car", "Blanket for the car"),
        ("Car", "Tire chains"),
    ],
    "Rain gear": [
        ("Clothing", "Rain jacket"),
        ("Clothing", "Waterproof shoes"),
        ("Gear", "Umbrella"),
        ("Gear", "Dry bags"),
        ("Car", "Windshield wipers check"),
    ],
    "Kids": [
        ("Kids", "Car seats and boosters"),
        ("Kids", "Diapers and wipes"),
        ("Kids", "Favorite toys and blanket"),
        ("Kids", "Tablet and headphones"),
        ("Kids", "Kid-friendly snacks"),
        ("Kids", "Change of clothes"),
    ],
    "Pets": [
        ("Pets", "Food and water bowls"),
        ("Pets", "Leash and harness"),
        ("Pets", "Vaccination records"),
        ("Pets", "Waste bags"),
        ("Pets", "Pet bed or blanket"),
        ("Pets", "Treats and medication"),
    ],
}


def template_items(name: str) -> list[tuple[str, str]] | None:
    return TEMPLATES.get(name)
