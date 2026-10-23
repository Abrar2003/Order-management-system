export const CFT_TO_M3 = 0.028316846592;
export function woodForm(item = {}) {
  return { value: item.timber_volume_input?.value ?? item.timber_cft ?? "", unit: item.timber_volume_input?.unit || "cft",
    hs_code: item.hs_code || "", parts: (item.species_composition || []).map(row => ({ species: String(row.species?._id || row.species), percent: (row.share_bp / 100).toFixed(2) })) };
}
export function woodCft(form) {
  return String(form.value).trim() === "" ? null
    : Math.round(Number(form.value) * (form.unit === "m3" ? 1 / CFT_TO_M3 : 1) * 1e6) / 1e6;
}
export function shareBps(value) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new Error("Species percentages require at most two decimal places.");
  const bps = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  if (!Number.isSafeInteger(bps) || bps < 1 || bps > 10000) throw new Error("Each species percentage must be above 0 and at most 100%.");
  return bps;
}
export function woodPayload(form) {
  const parts = form.parts.map(row => ({ species: row.species, share_bp: shareBps(row.percent) }));
  if (parts.some(row => !row.species) || new Set(parts.map(row => row.species)).size !== parts.length || (parts.length && parts.reduce((sum, row) => sum + row.share_bp, 0) !== 10000)) throw new Error("Choose unique species totaling exactly 100%.");
  if (String(form.value).trim() && Number(form.value) === 0 && parts.length) throw new Error("A product with no wood must have an empty composition.");
  return { finished_wood_volume: { value: String(form.value), unit: form.unit }, hs_code: form.hs_code, species_composition: parts };
}

export function eudrShipmentPayload(needed, form) {
  if (!needed) return { eudr_needed: false };
  if (!String(form.value).trim() || !Number.isFinite(Number(form.value)) || Number(form.value) <= 0 || !form.hs_code.trim() || !form.parts.length) {
    throw new Error("CFT per item, wood type and HSN are required when EUDR is needed.");
  }
  const hs = form.hs_code.trim();
  if (!/^\d+(?:[ .]\d+)*$/.test(hs) || !/^\d{4,8}$/.test(hs.replace(/[ .]/g, ""))) {
    throw new Error("HSN requires 4–8 digits with single spaces or dots.");
  }
  return { eudr_needed: true, ...woodPayload(form) };
}
