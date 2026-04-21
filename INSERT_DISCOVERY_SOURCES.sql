-- =============================================================================
-- DISCOVERY SOURCES FOR RELAYFORGE BRAND
-- =============================================================================
-- Brand ID: 3a29177e-3310-4c15-8c15-b48b7167e6c3
-- Client ID: e007ac39-caa6-4308-a93a-89340ff87021
-- =============================================================================

-- First, ensure the brand exists and is properly enabled
UPDATE brand_profiles SET
    discovery_enabled = true,
    outbound_enabled = true,
    is_active = true
WHERE id = '3a29177e-3310-4c15-8c15-b48b7167e6c3';

-- =============================================================================
-- PRODUCTHUNT SOURCE
-- =============================================================================
INSERT INTO brand_discovery_sources (
    id,
    brand_id,
    name,
    type,
    config,
    is_active,
    rate_limit_per_min,
    execution_mode,
    retry_count,
    is_running,
    last_status,
    client_id
) VALUES (
    'aa7e4cb7-3e8f-4e4a-8bab-e146d18cb2d9',
    '3a29177e-3310-4c15-8c15-b48b7167e6c3',
    'ProductHunt - Tech Products',
    'producthunt',
    '{"auth": {"client_id": "YOUR_CLIENT_ID", "client_secret": "YOUR_CLIENT_SECRET"}, "limit": 50}'::jsonb,
    true,
    10,
    'pull',
    0,
    false,
    'pending',
    'e007ac39-caa6-4308-a93a-89340ff87021'
) ON CONFLICT (id) DO UPDATE SET
    brand_id = EXCLUDED.brand_id,
    name = EXCLUDED.name,
    type = EXCLUDED.type;

-- =============================================================================
-- HUNTER SOURCE
-- =============================================================================
INSERT INTO brand_discovery_sources (
    id,
    brand_id,
    name,
    type,
    config,
    is_active,
    rate_limit_per_min,
    execution_mode,
    retry_count,
    is_running,
    last_status,
    client_id
) VALUES (
    'cd6df0e0-4c8c-4201-8e00-08b3c0ab5b14',
    '3a29177e-3310-4c15-8c15-b48b7167e6c3',
    'Hunter - Domain Search',
    'hunter',
    '{"api_key": "YOUR_HUNTER_API_KEY", "domain": "relayforge.in", "limit": 50}'::jsonb,
    true,
    10,
    'pull',
    0,
    false,
    'pending',
    'e007ac39-caa6-4308-a93a-89340ff87021'
) ON CONFLICT (id) DO UPDATE SET
    brand_id = EXCLUDED.brand_id,
    name = EXCLUDED.name,
    type = EXCLUDED.type;

-- =============================================================================
-- GITHUB SOURCE
-- =============================================================================
INSERT INTO brand_discovery_sources (
    id,
    brand_id,
    name,
    type,
    config,
    is_active,
    rate_limit_per_min,
    execution_mode,
    retry_count,
    is_running,
    last_status,
    client_id
) VALUES (
    'b8f0e1a1-5d9c-4301-9f11-19c4b2cc6c25',
    '3a29177e-3310-4c15-8c15-b48b7167e6c3',
    'GitHub - Automation Repos',
    'github',
    '{"query": "topic:automation language:javascript", "max_repos": 50}'::jsonb,
    true,
    10,
    'pull',
    0,
    false,
    'pending',
    'e007ac39-caa6-4308-a93a-89340ff87021'
) ON CONFLICT (id) DO UPDATE SET
    brand_id = EXCLUDED.brand_id,
    name = EXCLUDED.name,
    type = EXCLUDED.type;

-- =============================================================================
-- REDDIT SOURCE
-- =============================================================================
INSERT INTO brand_discovery_sources (
    id,
    brand_id,
    name,
    type,
    config,
    is_active,
    rate_limit_per_min,
    execution_mode,
    retry_count,
    is_running,
    last_status,
    client_id
) VALUES (
    'c9f1f2b2-6e0d-4412-0922-20d5c3dd7e36',
    '3a29177e-3310-4c15-8c15-b48b7167e6c3',
    'Reddit - Startup Communities',
    'reddit',
    '{"subreddit": "startups", "limit": 50}'::jsonb,
    true,
    10,
    'pull',
    0,
    false,
    'pending',
    'e007ac39-caa6-4308-a93a-89340ff87021'
) ON CONFLICT (id) DO UPDATE SET
    brand_id = EXCLUDED.brand_id,
    name = EXCLUDED.name,
    type = EXCLUDED.type;

-- =============================================================================
-- INDIEHACKERS SOURCE
-- =============================================================================
INSERT INTO brand_discovery_sources (
    id,
    brand_id,
    name,
    type,
    config,
    is_active,
    rate_limit_per_min,
    execution_mode,
    retry_count,
    is_running,
    last_status,
    client_id
) VALUES (
    'd0e2f3c3-7f1e-5523-1234-31e6d4ee8f47',
    '3a29177e-3310-4c15-8c15-b48b7167e6c3',
    'IndieHackers - Products',
    'indiehackers',
    '{}'::jsonb,
    true,
    10,
    'pull',
    0,
    false,
    'pending',
    'e007ac39-caa6-4308-a93a-89340ff87021'
) ON CONFLICT (id) DO UPDATE SET
    brand_id = EXCLUDED.brand_id,
    name = EXCLUDED.name,
    type = EXCLUDED.type;

-- =============================================================================
-- VERIFY SOURCES CREATED
-- =============================================================================
SELECT 
    id,
    name,
    type,
    is_active,
    last_status
FROM brand_discovery_sources
WHERE brand_id = '3a29177e-3310-4c15-8c15-b48b7167e6c3'
AND is_active = true;