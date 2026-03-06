import { build } from "esbuild";

const sharedBuildOptions = {
  bundle: true,
  platform: "browser",
  target: ["chrome120"],
  sourcemap: false,
  minify: false,
  legalComments: "none",
};

await Promise.all([
  build({
    ...sharedBuildOptions,
    format: "iife",
    entryPoints: ["src/content-main.ts"],
    outfile: "dist/content-script.js",
  }),
  build({
    ...sharedBuildOptions,
    format: "iife",
    entryPoints: ["src/background.ts"],
    outfile: "dist/background.js",
  }),
]);
