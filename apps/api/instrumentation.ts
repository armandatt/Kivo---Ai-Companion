export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { startInternalCheckinScheduler } = await import("./lib/internal-checkin-scheduler");
  startInternalCheckinScheduler();
}
