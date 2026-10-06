// tests/weightConfig.test.ts — the article-weight ruling of 5 Oct 2026 (src/core/weightConfig.ts). Labels are the router sheets'
// own (ISR 4000 c78-732542 t4, the C8300-style "internal power supply" rows, ASR/CRS "chassis only" / "full system").
import { weightRow, isVariantPid, weightRowDecision } from "../src/core/weightConfig.js";

let pass = 0, miss = 0;
const check = (what: string, ok: boolean, got?: unknown) => { if (ok) pass++; else miss++; console.log(`${ok ? "PASS" : "MISS"}  ${what}${ok ? "" : `  -> ${JSON.stringify(got)}`}`); };
const use = (label: string, sku: string) => weightRowDecision(label, sku)?.use ?? null;

check("a plain 'Weight' row is not a configuration row (the ordinary mapping stands)", weightRow("Weight") === null && weightRow("Unit Weight") === null && weightRow("Chassis weight") === null);
check("BASE: 'Weight with AC PS (no modules)' is ISR4331/K9's article weight", use("Weight with AC PS (no modules)", "ISR4331/K9") === true);
check("BASE: 'Weight with 1, 450-WAC power supply (no modules)' is ISR4451-X/K9's (the supply it ships with)", use("Weight with 1, 450-WAC power supply (no modules)", "ISR4451-X/K9") === true);
check("VARIANT: 'Weight with DC PS (no modules)' IS the distinct DC PID's article weight (ISR4331-DC/K9)", use("Weight with DC PS (no modules)", "ISR4331-DC/K9") === true);
check("SABOTAGE ...and the same DC row is an ADD-ON configuration of a PID with no DC variant (ISR4451-X/K9)", use("Weight with DC PS (no modules)", "ISR4451-X/K9") === false);
check("SABOTAGE ...and the BASE row is not the DC variant's weight", use("Weight with AC PS (no modules)", "ISR4331-DC/K9") === false);
check("SABOTAGE an extra PoE module / 1,000 W supply is an add-on, refused for every PID",
  use("Weight with 1 1,000-WAC power supply+ 1 PoE power module (no other modules)", "ISR4451-X/K9") === false
  && use("Weight with 1 1,000-WAC power supply+ 1 PoE power module (no other modules)", "ISR4351/K9") === false);
check("SABOTAGE 'AC PS with POE' is a PoE configuration: refused for a PID that is not a PoE variant", use("Weight with AC PS with POE (no modules)", "ISR4331/K9") === false);
check("...and taken for a PID that IS the PoE variant (C867VAE-POE-W-A-K9)", use("Weight with AC PoE Power Supply (No Modules)", "C867VAE-POE-W-A-K9") === true);
check("SABOTAGE 'fully loaded' / 'full system' are never the article weight",
  use("Typical weight (fully loaded with modules)", "ISR4331/K9") === false && use("Weight (full system)", "ASR-9010-AC") === false);
check("BASE: 'Weight (chassis only)' is the chassis PID's", use("Weight (chassis only)", "ASR-9010-AC") === true);
check("HVDC reads as the DC variant row, and outranks '(no modules)'",
  weightRow("Weight with Internal power supply (no modules), HVDC PSU") === "variant-dc" && weightRow("Weight with internal power supply (no modules), AC PSU") === "base");
check("isVariantPid reads the PID's own tokens: -DC/K9, -DC-V2, -DC=, -POE-; never a DC inside another token",
  isVariantPid("ISR4331-DC/K9", "dc") && isVariantPid("ASR-9006-DC-V2", "dc") && isVariantPid("ASR-9010-DC=", "dc") && isVariantPid("C867VAE-POE-W-A-K9", "poe")
  && !isVariantPid("ISR4331/K9", "dc") && !isVariantPid("DCN-123", "dc") && !isVariantPid("C8300-DCX", "dc"));
console.log(`\n    weight config: ${pass} passed, ${miss} missed`);
if (miss) process.exit(1);
