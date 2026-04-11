// ─── zipToState.js ────────────────────────────────────────────────────────────
// Zip code → State lookup for Reality Estimator
// Based on USPS zip prefix ranges (US_Territory_Zip_codes.pdf)
//
// Drop this file alongside App.jsx in the repo root.
//
// Usage anywhere in the app:
//   import { zipToState, zipToStateAbbr, isValidZip } from "./zipToState";
//
//   zipToState("95835")       → "California"
//   zipToStateAbbr("95835")   → "CA"
//   isValidZip("95835")       → true
//   zipToState("00000")       → null  (unknown/invalid)
// ─────────────────────────────────────────────────────────────────────────────

// Each entry: [prefixStart, prefixEnd, stateName, stateAbbr]
// Prefix is the first 3 digits of the zip code as a number.
// Ranges are inclusive on both ends.
const ZIP_RANGES = [
  // Alabama
  [350, 369, "Alabama", "AL"],
  // Alaska
  [995, 999, "Alaska", "AK"],
  // Arizona
  [850, 865, "Arizona", "AZ"],
  // Arkansas
  [716, 729, "Arkansas", "AR"],
  // California
  [900, 961, "California", "CA"],
  // Colorado
  [800, 816, "Colorado", "CO"],
  // Connecticut
  [60,  69,  "Connecticut", "CT"],
  // Delaware
  [197, 199, "Delaware", "DE"],
  // Washington DC
  [200, 205, "Washington DC", "DC"],
  // Florida
  [320, 349, "Florida", "FL"],
  // Georgia
  [300, 319, "Georgia", "GA"],
  [398, 399, "Georgia", "GA"],
  // Hawaii
  [967, 968, "Hawaii", "HI"],
  // Idaho
  [832, 838, "Idaho", "ID"],
  // Illinois
  [600, 629, "Illinois", "IL"],
  // Indiana
  [460, 479, "Indiana", "IN"],
  // Iowa
  [500, 528, "Iowa", "IA"],
  // Kansas
  [660, 679, "Kansas", "KS"],
  // Kentucky
  [400, 427, "Kentucky", "KY"],
  // Louisiana
  [700, 714, "Louisiana", "LA"],
  // Maine
  [39,  49,  "Maine", "ME"],
  // Maryland
  [206, 219, "Maryland", "MD"],
  // Massachusetts
  [10,  27,  "Massachusetts", "MA"],
  // Michigan
  [480, 499, "Michigan", "MI"],
  // Minnesota
  [550, 567, "Minnesota", "MN"],
  // Mississippi
  [386, 397, "Mississippi", "MS"],
  // Missouri
  [630, 658, "Missouri", "MO"],
  // Montana
  [590, 599, "Montana", "MT"],
  // Nebraska
  [680, 693, "Nebraska", "NE"],
  // Nevada
  [889, 898, "Nevada", "NV"],
  // New Hampshire
  [30,  38,  "New Hampshire", "NH"],
  // New Jersey
  [70,  89,  "New Jersey", "NJ"],
  // New Mexico
  [870, 884, "New Mexico", "NM"],
  // New York
  [100, 149, "New York", "NY"],
  // North Carolina
  [270, 289, "North Carolina", "NC"],
  // North Dakota
  [580, 588, "North Dakota", "ND"],
  // Ohio
  [430, 458, "Ohio", "OH"],
  // Oklahoma
  [730, 749, "Oklahoma", "OK"],
  [733, 733, "Oklahoma", "OK"],
  // Oregon
  [970, 979, "Oregon", "OR"],
  // Pennsylvania
  [150, 196, "Pennsylvania", "PA"],
  // Rhode Island
  [28,  29,  "Rhode Island", "RI"],
  // South Carolina
  [290, 299, "South Carolina", "SC"],
  // South Dakota
  [570, 577, "South Dakota", "SD"],
  // Tennessee
  [370, 385, "Tennessee", "TN"],
  // Texas
  [750, 799, "Texas", "TX"],
  [733, 733, "Texas", "TX"],
  // Utah
  [840, 847, "Utah", "UT"],
  // Vermont
  [50,  59,  "Vermont", "VT"],
  // Virginia
  [201, 201, "Virginia", "VA"],
  [220, 246, "Virginia", "VA"],
  // Washington
  [980, 994, "Washington", "WA"],
  // West Virginia
  [247, 268, "West Virginia", "WV"],
  // Wisconsin
  [530, 549, "Wisconsin", "WI"],
  // Wyoming
  [820, 831, "Wyoming", "WY"],
  // US Territories
  [6,   9,   "Puerto Rico", "PR"],
  [8,   8,   "US Virgin Islands", "VI"],
];

/**
 * Returns the full state name for a given zip code string.
 * Returns null if the zip is invalid or unrecognized.
 * @param {string} zip
 * @returns {string|null}
 */
export function zipToState(zip) {
  if (!zip || typeof zip !== "string") return null;
  const clean = zip.trim().replace(/\D/g, "");
  if (clean.length < 3) return null;
  const prefix = parseInt(clean.slice(0, 3), 10);
  for (const [start, end, state] of ZIP_RANGES) {
    if (prefix >= start && prefix <= end) return state;
  }
  return null;
}

/**
 * Returns the 2-letter state abbreviation for a given zip code string.
 * Returns null if the zip is invalid or unrecognized.
 * @param {string} zip
 * @returns {string|null}
 */
export function zipToStateAbbr(zip) {
  if (!zip || typeof zip !== "string") return null;
  const clean = zip.trim().replace(/\D/g, "");
  if (clean.length < 3) return null;
  const prefix = parseInt(clean.slice(0, 3), 10);
  for (const [start, end, , abbr] of ZIP_RANGES) {
    if (prefix >= start && prefix <= end) return abbr;
  }
  return null;
}

/**
 * Returns true if the zip code maps to a known US state or territory.
 * @param {string} zip
 * @returns {boolean}
 */
export function isValidZip(zip) {
  return zipToState(zip) !== null;
}

/**
 * Returns full state info object or null.
 * @param {string} zip
 * @returns {{ state: string, abbr: string }|null}
 */
export function zipToStateInfo(zip) {
  if (!zip || typeof zip !== "string") return null;
  const clean = zip.trim().replace(/\D/g, "");
  if (clean.length < 3) return null;
  const prefix = parseInt(clean.slice(0, 3), 10);
  for (const [start, end, state, abbr] of ZIP_RANGES) {
    if (prefix >= start && prefix <= end) return { state, abbr };
  }
  return null;
}
