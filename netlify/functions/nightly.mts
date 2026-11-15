// The nightly clean-up (the free Firebase plan has no automatic deletion). 20:30 UTC is 02:00 in India.
export { nightlyFunction as default } from "../../functions/src/netlify";

export const config = { schedule: "30 20 * * *" };
