import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Update pricing data every 5 minutes
crons.interval(
  "update pricing data",
  { minutes: 5 },
  internal.pricing.updatePricingData,
  {},
);

export default crons;
