import { defineConfig } from "@neon/config/v1";

// Postgres only: prices + history for GoldenPrice.
export default defineConfig({
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) return {};
    if (!branch.exists) return { ttl: "7d" };
    return {};
  },
});
