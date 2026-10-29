// Signed licence fixtures for MEM-137 AC02: one licence per existing tier id,
// signed with a throwaway test key. The public key is committed here; the
// private key was not. The signatures must stay byte-for-byte as committed.
export const FIXTURE_KID = "mem-137-fixture";
export const FIXTURE_PUBLIC_KEY = "MCowBQYDK2VwAyEAVVRhohr84P3XjUOey6a5y9L9UFUZjt8n5lAue9fmp5s=";
export const FIXTURE_LICENSES = {
  "personal": {
    "v": 1,
    "lid": "lic_fix_personal",
    "tier": "personal",
    "services": [],
    "seats": 3,
    "iat": "2026-01-01",
    "exp": null,
    "grace_days": 14,
    "kid": "mem-137-fixture",
    "sig": "ed25519:N26rS7cPMXBz7uPWG8M0iC6vo4oZ6J8afOtbNtFQaDb8zRKYt9ArLsJxgmuA4mFOVZ4keclo1JpZxgf527YABw=="
  },
  "team": {
    "v": 1,
    "lid": "lic_fix_team",
    "tier": "team",
    "services": [],
    "seats": 3,
    "iat": "2026-01-01",
    "exp": null,
    "grace_days": 14,
    "kid": "mem-137-fixture",
    "sig": "ed25519:EMp7dWogXk0rmVvuBFdyMiIqpawpsPhBcGBHZ/BxDVLOouLexjAxqMFfxULDHC+C+YAz4vV1T56SYrMe3oABCg=="
  },
  "office": {
    "v": 1,
    "lid": "lic_fix_office",
    "tier": "office",
    "services": [],
    "seats": 3,
    "iat": "2026-01-01",
    "exp": null,
    "grace_days": 14,
    "kid": "mem-137-fixture",
    "sig": "ed25519:F98PrSzDn7mo7POn6pj1J5E+HhHNZdk8uuPBIpc9ooOWjMhbmvR4YrfT/2+WqciT8n9FR901gLZfO9S3x+NkDA=="
  },
  "business": {
    "v": 1,
    "lid": "lic_fix_business",
    "tier": "business",
    "services": [],
    "seats": 3,
    "iat": "2026-01-01",
    "exp": null,
    "grace_days": 14,
    "kid": "mem-137-fixture",
    "sig": "ed25519:nIiLa8AZXs5OcbUFmfGb7yTRgSMsbZfApBy6jLVKJfmhOxF4CLaEaAATtminSLIgnmR8mnG+/R9f5ly30PaDDw=="
  },
  "enterprise": {
    "v": 1,
    "lid": "lic_fix_enterprise",
    "tier": "enterprise",
    "services": [],
    "seats": 3,
    "iat": "2026-01-01",
    "exp": null,
    "grace_days": 14,
    "kid": "mem-137-fixture",
    "sig": "ed25519:GmuTmuPTL/0gC2aXSl2YzminxEvpaHHSWeSQlEHT4QQj7flUpKyFMFlnvwxWIKZU/3sx1XBP+b6P9AQT16hMDg=="
  },
  "founder": {
    "v": 1,
    "lid": "lic_fix_founder",
    "tier": "founder",
    "services": [],
    "seats": 3,
    "iat": "2026-01-01",
    "exp": null,
    "grace_days": 14,
    "kid": "mem-137-fixture",
    "sig": "ed25519:Csc+mTWWyy0MJc0IsIvMhkxCui9JiXC7VTQLLjnf2psN5LIMU5ocjmk8DXk4HcbSun5YlQG6RESzgBwOplm+DA=="
  }
};

