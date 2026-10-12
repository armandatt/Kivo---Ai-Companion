// Where a signed-in request for a dashboard page goes. Pure: the layout does
// the lookup and the redirect; this is only the rule, so it can be tested.
//
//   no such account        the cookie outlived the account: sign in again
//   quiz not finished      the quiz, which is what creates the profile. A new
//                          Google account arrives here with no profile at all.
//   quiz finished          the page that was asked for
//
// "/onboarding" and "/signin" are outside the dashboard layout and never ask
// this question, so neither answer can send a request round in a circle.

export type DashboardEntry = "enter" | "/onboarding" | "/signin"

export function dashboardEntry(account: { exists: boolean; onboardingComplete: boolean | null | undefined }): DashboardEntry {
  if (!account.exists) return "/signin"
  return account.onboardingComplete === true ? "enter" : "/onboarding"
}
