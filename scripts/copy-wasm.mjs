// Serve MuJoCo's WebAssembly binary from /public so the loader can find it
// via locateFile, independent of how the bundler treats the package.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("@mujoco/mujoco/mujoco.wasm"));
mkdirSync("public/mujoco", { recursive: true });
copyFileSync(join(pkgDir, "mujoco.wasm"), "public/mujoco/mujoco.wasm");
console.log("copied mujoco.wasm -> public/mujoco/");
