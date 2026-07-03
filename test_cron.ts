export function calculateNextRun(startTime: string, intervalMinutes: number, lastRunStr: string | null): string {
  const now = new Date();
  let nextRunTime = new Date();
  
  if (startTime) {
    const [hours, minutes] = startTime.split(':').map(Number);
    nextRunTime.setHours(hours, minutes, 0, 0);
    
    // If nextRunTime is in the past, add intervals until it's in the future
    while (nextRunTime <= now) {
      if (intervalMinutes && intervalMinutes > 0) {
        nextRunTime.setTime(nextRunTime.getTime() + intervalMinutes * 60 * 1000);
      } else {
        // If no interval, just set it to tomorrow at the same time
        nextRunTime.setDate(nextRunTime.getDate() + 1);
      }
    }
  } else if (intervalMinutes && intervalMinutes > 0) {
    // If no start time but interval, next run is lastRun + interval
    if (lastRunStr) {
      nextRunTime = new Date(new Date(lastRunStr).getTime() + intervalMinutes * 60 * 1000);
      if (nextRunTime <= now) {
         nextRunTime = new Date(now.getTime() + intervalMinutes * 60 * 1000);
      }
    } else {
      nextRunTime = new Date(now.getTime() + intervalMinutes * 60 * 1000);
    }
  } else {
    // Default to tomorrow if nothing is set
    nextRunTime.setDate(nextRunTime.getDate() + 1);
  }

  return nextRunTime.toISOString();
}
