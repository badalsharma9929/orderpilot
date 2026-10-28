import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import type { ProgressEvent, BgRequest } from '@/core/messaging';
import { getSettings, type Settings } from '@/core/settings';

/** Re-renders whenever the queried tables change, including writes from the background worker. */
export function useLive<T>(query: () => Promise<T>, deps: unknown[] = [], initial?: T): T | undefined {
  const [value, setValue] = useState<T | undefined>(initial);
  useEffect(() => {
    const sub = liveQuery(query).subscribe({ next: setValue, error: (e) => console.error(e) });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

export function useProgress(job: ProgressEvent['job']) {
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  useEffect(() => {
    chrome.storage.session?.get('progress').then(({ progress }) => setEvents(((progress as ProgressEvent[] | undefined) ?? []).filter((e: ProgressEvent) => e.job === job)));
    const fn = (m: ProgressEvent) => { if (m?.kind === 'progress' && m.job === job) setEvents((xs) => [...xs.slice(-150), m]); };
    chrome.runtime.onMessage.addListener(fn);
    return () => chrome.runtime.onMessage.removeListener(fn);
  }, [job]);
  return [events, () => setEvents([])] as const;
}

export function useSettings() {
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    getSettings().then(setS);
    const fn = (changes: Record<string, chrome.storage.StorageChange>) => { if (changes.settings) getSettings().then(setS); };
    chrome.storage.onChanged.addListener(fn);
    return () => chrome.storage.onChanged.removeListener(fn);
  }, []);
  return s;
}

type WithoutKind<T> = T extends unknown ? Omit<T, 'kind'> : never;

export function bg<T = any>(msg: WithoutKind<BgRequest>): Promise<T> {
  return chrome.runtime.sendMessage({ kind: 'bg', ...msg } as BgRequest);
}
