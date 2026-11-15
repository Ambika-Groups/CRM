// Bundles the functions and the shared core (packages/core) into lib/index.js, so Cloud Build needs only the two
// runtime dependencies in package.json. Run by `firebase deploy` (predeploy in firebase.json) or `npm run bundle`.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const core = fileURLToPath(new URL("../packages/core/src/index.ts", import.meta.url));

await build({
  entryPoints: ["src/index.ts"],
  outfile: "lib/index.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: true,
  alias: { "@ag/core": core },
  external: ["firebase-admin", "firebase-admin/*", "firebase-functions", "firebase-functions/*"],
  logLevel: "info",
});
