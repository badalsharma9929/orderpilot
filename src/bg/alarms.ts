import { getSettings } from '@/core/settings';
import { localDay } from '@/db/repo';

export const ALARM_MORNING = 'sweep-morning';
export const ALARM_EVENING = 'sweep-evening';
/** Re-runs today's sweep if it was missed or the worker was killed before it finished. */
export const ALARM_CATCHUP = 'sweep-catchup';

function nextAt(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export async function scheduleAlarms() {
  const s = await getSettings();
  await chrome.alarms.clear(ALARM_MORNING);
  await chrome.alarms.clear(ALARM_EVENING);
  chrome.alarms.create(ALARM_MORNING, { when: nextAt(s.sweepTime), periodInMinutes: 1440 });
  if (s.eveningSweep) chrome.alarms.create(ALARM_EVENING, { when: nextAt(s.eveningTime), periodInMinutes: 1440 });
  chrome.alarms.create(ALARM_CATCHUP, { periodInMinutes: 30 });
}

/** Chrome was closed at sweep time: run once on startup if today's sweep is missing. */
export async function missedToday(): Promise<boolean> {
  const s = await getSettings();
  const { lastSweep } = (await chrome.storage.local.get('lastSweep')) as { lastSweep?: { day: string } };
  if (lastSweep?.day === localDay()) return false;
  const [h, m] = s.sweepTime.split(':').map(Number);
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
}
