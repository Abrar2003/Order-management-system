const CFT_M3_NUMERATOR = 28316846592n;
const fail = message => { throw Object.assign(new Error(message), { statusCode: 400, code: "WOOD_VOLUME_INVALID" }); };
function volumeInput(input) {
  if (!input || !["cft", "m3"].includes(input.unit)) fail("Choose CFT or cubic meters");
  const value = String(input.value ?? "").trim();
  if (!value) return { cft: null, input: { value: "", unit: input.unit } };
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || (match[2]?.length || 0) > (input.unit === "cft" ? 6 : 12) || value.length > 30) fail("Enter a non-negative volume with at most 6 CFT or 12 m³ decimals");
  const scale = 10n ** BigInt(match[2]?.length || 0), amount = BigInt(match[1] + (match[2] || ""));
  const numerator = input.unit === "cft" ? amount * 1000000n : amount * 1000000000000000000n;
  const denominator = input.unit === "cft" ? scale : scale * CFT_M3_NUMERATOR;
  const micro = (numerator * 2n + denominator) / (denominator * 2n);
  if (amount > 0n && micro === 0n) fail("Positive volume is below the canonical 0.000001 CFT precision");
  if (micro > BigInt(Number.MAX_SAFE_INTEGER)) fail("Finished wood volume is too large");
  const cft = Number(micro) / 1000000;
  if (Math.round(cft * 1000000) !== Number(micro)) fail("Finished wood volume cannot be represented at canonical precision");
  return { cft, input: { value, unit: input.unit } };
}
module.exports = { volumeInput };
