import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Solo ejecuta los controllers de dominio enumerados; no requiere servicios externos.
const suites = [
  ["ms-catalog", "jest", "test/unit/attractions.controller.spec.ts"],
  ["ms-cliente", "node", "test/clients.controller.test.mjs"],
  ["ms_audit", "vitest", "src/audit/audit.controller.spec.ts"],
  [
    "ms_billing_profile",
    "vitest",
    "src/dato-facturacion/dato-facturacion.controller.spec.ts",
  ],
  ["ms_cart", "vitest", "src/cart/cart.controller.spec.ts"],
  ["ms_coupon", "vitest", "src/cupon/cupon.controller.spec.ts"],
  ["ms_identity", "jest", "test/unit/auth.controller.spec.ts"],
  ["ms_inventory", "node", "test/inventory.controller.test.mjs"],
  [
    "ms_location",
    "vitest",
    "src/attraction-location/attraction-location.controller.spec.ts",
  ],
  ["ms_payment", "vitest", "src/pago/pago.controller.spec.ts"],
  ["ms_refund", "vitest", "src/refund/refund.controller.spec.ts"],
  ["ms_review", "vitest", "src/resena/resena.controller.spec.ts"],
  ["ms_support", "vitest", "src/mensaje/mensaje.controller.spec.ts"],
];

const requested = process.argv.slice(2);
const unknown = requested.filter(
  (name) => !suites.some(([service]) => service === name),
);
if (unknown.length) {
  process.stderr.write(`Servicios desconocidos: ${unknown.join(", ")}\n`);
  process.exitCode = 1;
} else {
  const selected = suites.filter(
    ([service]) => !requested.length || requested.includes(service),
  );
  const failed = [];
  for (const [service, runner, file] of selected) {
    process.stdout.write(`\nPruebas de controller: ${service}\n`);
    const cwd = fileURLToPath(
      new URL(`../services/${service}/`, import.meta.url),
    );
    const run = (args) => {
      const result = spawnSync(process.execPath, args, {
        cwd,
        stdio: "inherit",
      });
      if (result.error) process.stderr.write(`${result.error.message}\n`);
      return result.status === 0 && !result.error;
    };
    let passed;
    if (runner === "node") {
      const config =
        service === "ms-cliente" ? "tsconfig.build.json" : "tsconfig.json";
      passed =
        run(["node_modules/typescript/bin/tsc", "-p", config]) &&
        run(["--test", file]);
    } else if (runner === "jest") {
      passed = run([
        "--experimental-vm-modules",
        "node_modules/jest/bin/jest.js",
        "--config",
        "jest.config.mjs",
        "--runInBand",
        "--runTestsByPath",
        file,
      ]);
    } else {
      passed = run(["node_modules/vitest/vitest.mjs", "run", file]);
    }
    if (!passed) failed.push(service);
  }
  process.stdout.write(
    `\nControllers: ${selected.length - failed.length}/${selected.length} servicios aprobados.\n`,
  );
  if (failed.length) {
    process.stderr.write(`Fallaron: ${failed.join(", ")}\n`);
    process.exitCode = 1;
  }
}
