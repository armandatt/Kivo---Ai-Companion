// K-09: two names of one zone are one zone, on the server and on the page.
import { canonicalZone, sameZone } from "../product/zone-names";
import { currentZoneName, dayKey } from "../engines/learner-calendar";

describe("zone names (K-09)", () => {
  test("Asia/Calcutta and Asia/Kolkata are the same zone", () => {
    expect(sameZone("Asia/Calcutta", "Asia/Kolkata")).toBe(true);
    expect(sameZone("Asia/Kolkata", "Asia/Calcutta")).toBe(true);
    expect(sameZone("Asia/Kolkata", "Asia/Kolkata")).toBe(true);
  });
  test("different zones stay different, and nothing is not a zone", () => {
    expect(sameZone("Asia/Kolkata", "Asia/Dhaka")).toBe(false);
    expect(sameZone("Europe/London", "UTC")).toBe(false);
    expect(sameZone(null, "Asia/Kolkata")).toBe(false);
    expect(sameZone("", "")).toBe(false);
  });
  test("the stored name is the current one; an unknown name is kept as it is", () => {
    expect(canonicalZone("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(currentZoneName("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(currentZoneName("Europe/Kiev")).toBe("Europe/Kyiv");
    expect(currentZoneName("America/New_York")).toBe("America/New_York");
  });
  test("both names draw the same day boundary (no date moves)", () => {
    // 18:29 UTC is 23:59 in India; 18:31 UTC is the next day there.
    for (const z of ["Asia/Calcutta", "Asia/Kolkata"]) {
      expect(dayKey(new Date("2026-12-31T18:29:00Z"), z)).toBe("2026-12-31");
      expect(dayKey(new Date("2026-12-31T18:31:00Z"), z)).toBe("2027-01-01");
    }
  });
});
