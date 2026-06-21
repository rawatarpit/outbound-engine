#!/usr/bin/env python3
"""
search_maps — OpenStreetMap Overpass API for venue/business discovery.

Finds community centres, event venues, co-working spaces, and other
local businesses/venues that could host events needing payment automation.

Input:  JSON via argv[1] or stdin
        {queries: [{text, signal, intent_id}], max_results: int}
Output: JSON to stdout (single line)
        {companies: [{url, domain, signal_type, intent_id, name, lat, lon, tags}], meta: {total}}
"""
import json, sys, time, os, re, urllib.request, urllib.parse
from lib import log

MAPS_TIMEOUT = int(os.environ.get("MAPS_TIMEOUT", "30"))
DEFAULT_LAT = float(os.environ.get("MAPS_DEFAULT_LAT", "25.2048"))
DEFAULT_LON = float(os.environ.get("MAPS_DEFAULT_LON", "55.2708"))
# Default search radius in meters (~50km)
DEFAULT_RADIUS = int(os.environ.get("MAPS_DEFAULT_RADIUS", "50000"))

CITY_COORDS = {
    "dubai": (25.2048, 55.2708),
    "abu dhabi": (24.4539, 54.3773),
    "sharjah": (25.3463, 55.4209),
    "riyadh": (24.7136, 46.6753),
    "jeddah": (21.2854, 39.2376),
    "doha": (25.2854, 51.5310),
    "kuwait city": (29.3759, 47.9774),
    "muscat": (23.5880, 58.3829),
    "manama": (26.2285, 50.5860),
    "cairo": (30.0444, 31.2357),
    "london": (51.5074, -0.1278),
    "new york": (40.7128, -74.0060),
    "san francisco": (37.7749, -122.4194),
    "los angeles": (34.0522, -118.2437),
    "chicago": (41.8781, -87.6298),
    "berlin": (52.5200, 13.4050),
    "paris": (48.8566, 2.3522),
    "singapore": (1.3521, 103.8198),
    "hong kong": (22.3193, 114.1694),
    "tokyo": (35.6762, 139.6503),
    "sydney": (-33.8688, 151.2093),
    "mumbai": (19.0760, 72.8777),
    "bangalore": (12.9716, 77.5946),
    "amsterdam": (52.3676, 4.9041),
    "toronto": (43.6532, -79.3832),
    "mexico city": (19.4326, -99.1332),
    "sao paulo": (-23.5505, -46.6333),
}

def extract_coords(query_text: str) -> tuple:
    q = query_text.lower()
    for city, (lat, lon) in CITY_COORDS.items():
        if city in q:
            return (lat, lon)
    for region, (lat, lon) in [("uae", (24.4539, 54.3773)), ("gcc", (25.0, 48.0)), ("middle east", (26.0, 47.0)), ("europe", (50.0, 10.0)), ("usa", (39.0, -98.0)), ("uk", (54.0, -2.0))]:
        if region in q:
            return (lat, lon)
    return (DEFAULT_LAT, DEFAULT_LON)

# Amenity types relevant to community events and small business discovery
RELEVANT_AMENITIES = [
    "community_centre",
    "events_venue",
    "conference_centre",
    "coworking_space",
    "social_centre",
    "townhall",
    "village_hall",
    "library",
    "theatre",
]

SHOP_TYPES = [
    "mall",
    "department_store",
    "shopping_centre",
]

LEISURE_TYPES = [
    "park",
    "marina",
    "stadium",
    "sports_centre",
    "fitness_centre",
    "dance",
    "yoga",
]

def build_overpass_query(query_text: str, max_results: int) -> str:
    q = query_text.lower()
    lat, lon = extract_coords(query_text)
    radius = DEFAULT_RADIUS

    # Determine filter expression (Overpass QL regex with pipe = OR)
    filters_list = []
    if any(k in q for k in ["community", "event", "venue", "conference", "hall"]):
        filters_list.append('["amenity"~"community_centre|events_venue|conference_centre|coworking_space|social_centre|townhall|village_hall|theatre",i]')
    if any(k in q for k in ["cowork", "co-work", "shared", "office"]):
        filters_list.append('["amenity"="coworking_space"]')
    if any(k in q for k in ["mall", "shop", "store", "retail"]):
        filters_list.append('["shop"~"mall|department_store|shopping_centre",i]')
    if any(k in q for k in ["fitness", "gym", "yoga", "dance", "sport"]):
        filters_list.append('["leisure"~"fitness_centre|sports_centre|stadium|dance|yoga",i]')

    # If no keyword match, fallback to general community/events or name search
    if not filters_list:
        keywords = [w for w in q.split() if len(w) > 3 and w not in
                   {"near", "in", "at", "the", "for", "with", "and", "that", "this", "find", "search", "looking"}]
        if keywords:
            name_parts = "|".join(keywords[:3])
            filters_list.append(f'["name"~"{name_parts}",i]')
        else:
            filters_list.append('["amenity"~"community_centre|events_venue|conference_centre|coworking_space|library",i]')
            filters_list.append('["leisure"~"fitness_centre|sports_centre|dance|yoga",i]')

    # Build union: each filter becomes its own node/way block inside the union
    union_blocks = []
    for f in filters_list:
        union_blocks.append(f"node{f}(around:{radius},{lat},{lon});")
        union_blocks.append(f"way{f}(around:{radius},{lat},{lon});")
        union_blocks.append(f"relation{f}(around:{radius},{lat},{lon});")

    return f"""
    [out:json][timeout:{MAPS_TIMEOUT}];
    (
      {chr(10).join('      ' + b for b in union_blocks)}
    );
    out body {max_results};
    """

def extract_website(tags: dict) -> str | None:
    for key in ("website", "contact:website", "url"):
        val = tags.get(key)
        if val:
            val = val.strip()
            if val.startswith("http"):
                try:
                    from urllib.parse import urlparse
                    return urlparse(val).netloc.replace("www.", "")
                except:
                    return val
            elif "." in val:
                return val
    return None

def osm_to_candidate(element: dict, signal: str, intent_id: str) -> dict | None:
    tags = element.get("tags", {}) or {}
    name = tags.get("name") or tags.get("brand") or tags.get("operator") or ""
    if not name:
        return None

    website = extract_website(tags)
    osm_url = f"https://www.openstreetmap.org/{element['type']}/{element['id']}"
    domain = website or osm_url

    address_parts = []
    for k in ("addr:street", "addr:housenumber", "addr:city", "addr:postcode"):
        v = tags.get(k)
        if v:
            address_parts.append(v)

    body_parts = [f"Type: {tags.get('amenity') or tags.get('leisure') or tags.get('shop') or tags.get('office') or 'unknown'}"]
    if address_parts:
        body_parts.append(f"Address: {', '.join(address_parts)}")
    phone = tags.get("phone") or tags.get("contact:phone") or ""
    if phone:
        body_parts.append(f"Phone: {phone}")
    category = tags.get("amenity") or tags.get("leisure") or tags.get("shop") or tags.get("office") or ""

    return {
        "url": osm_url,
        "domain": domain or "unknown.com",
        "signal_type": signal,
        "intent_id": intent_id,
        "name": name,
        "title": name,
        "body": ". ".join(body_parts),
        "lat": element.get("lat") or tags.get("lat") or "",
        "lon": element.get("lon") or tags.get("lon") or "",
        "tags": tags,
        "category": category,
        "website": website or "",
    }

def search_maps(query_text: str, max_results: int) -> list[dict]:
    overpass_query = build_overpass_query(query_text, max_results)
    log(f"  Overpass query: {overpass_query[:200]}...")

    try:
        import overpass
        api = overpass.API(timeout=MAPS_TIMEOUT)
        response = api.get(overpass_query, responseformat="json")
        elements = response.get("elements", [])
    except ImportError:
        log("overpass library not installed, falling back to direct Overpass API")
        elements = _direct_overpass_request(overpass_query)
    except Exception as e:
        log(f"overpass library error: {e}, falling back to direct API")
        elements = _direct_overpass_request(overpass_query)

    log(f"  Found {len(elements)} OSM elements")
    return elements[:max_results]

def _direct_overpass_request(overpass_query: str) -> list[dict]:
    """Fallback: call Overpass API directly via HTTP."""
    url = "https://overpass-api.de/api/interpreter"
    data = urllib.parse.urlencode({"data": overpass_query}).encode()
    try:
        req = urllib.request.Request(url, data=data, headers={"User-Agent": "OutboundEngine/1.0"})
        resp = urllib.request.urlopen(req, timeout=MAPS_TIMEOUT)
        body = json.loads(resp.read().decode())
        return body.get("elements", [])
    except Exception as e:
        log(f"Direct Overpass API error: {e}")
        return []

QUERY_DELAY = float(os.environ.get("MAPS_QUERY_DELAY", "2.0"))

def main():
    if len(sys.argv) >= 2:
        params = json.loads(sys.argv[1])
    else:
        params = json.loads(sys.stdin.read())

    queries = params.get("queries", [])
    max_results = int(params.get("max_results", 5))

    start = time.time()
    all_candidates = []
    seen_names = set()

    for i, q in enumerate(queries):
        query_text = q["text"].strip()
        if not query_text:
            continue
        try:
            log(f"  Searching OpenStreetMap: {query_text[:80]}")
            results = search_maps(query_text, max_results)
            candidates = []
            for elem in results:
                cand = osm_to_candidate(elem, q.get("signal", ""), q.get("intent_id", ""))
                if cand and cand.get("name") and cand["name"] not in seen_names:
                    seen_names.add(cand["name"])
                    candidates.append(cand)
        except Exception as e:
            log(f"OSM search failed for: {query_text[:60]}: {e}")
            candidates = []

        log(f"  Query '{query_text[:70]}': {len(candidates)} candidates found")
        if i < len(queries) - 1:
            time.sleep(QUERY_DELAY)

        all_candidates.extend(candidates)

    result = {
        "companies": all_candidates,
        "meta": {
            "total": len(all_candidates),
            "queries": len(queries),
        },
        "_duration_ms": int((time.time() - start) * 1000),
    }

    print(json.dumps(result))
    sys.stdout.flush()

if __name__ == "__main__":
    main()
