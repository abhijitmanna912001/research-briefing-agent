import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The agent route shells out to the swytchcode CLI at runtime (via @swytchcode/runtime's spawnSync).
  // Next's file tracing only follows imports, so it would leave the CLI out of the deployed function.
  // Include it explicitly, plus the project's .swytchcode/ state (tooling.json and the provider bundles),
  // which the CLI reads from process.cwd().
  outputFileTracingIncludes: {
    "/api/agent": [
      // The wrapper script the runtime resolves via node_modules/.bin, and the script itself.
      "./node_modules/.bin/swytchcode",
      "./node_modules/swytchcode/**/*",
      // The native binary the wrapper launches. Vercel functions run on x86_64 Linux by default; add
      // swytchcode-cli-linux-arm64 here if the project is switched to arm64 functions.
      "./node_modules/swytchcode-cli-linux-x64/**/*",
      "./.swytchcode/**/*",
    ],
  },
};

export default nextConfig;
