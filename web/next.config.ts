import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app lives in a monorepo alongside mobile/ and supabase/. Without an
  // explicit root, Turbopack walks up past the repository looking for a lock
  // file and picks up a stray one from the parent directory.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
