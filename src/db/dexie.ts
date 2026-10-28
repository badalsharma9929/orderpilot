import Dexie, { type Table } from 'dexie';
import type { OrderDetail, Platform, Source, Tracking } from '@/core/schemas';
import type { OrderStatus } from '@/core/status';
import type { LadderStat, LadderStatsStore } from '@/core/ladder';

export interface AccountRow {
  id: string;               // `${platform}:${slug}`
  platform: Platform;
  displayName: string;
  lastSeenAt: string;
}

export interface OrderRow {
  key: string;              // `${platform}:${orderId}`
  platform: Platform;
  orderId: string;
  accountId: string;
  orderDate?: string;
  status: OrderStatus;
  isFinal: 0 | 1;           // Dexie can't index booleans
  completeness: number;
  gaps: string[];
  lastCheckedAt?: string;
  firstSeenAt: string;
  detail: OrderDetail;
  fieldSources: Record<string, Source>;
  /** Final order whose invoices are all collected: skipped by the invoice job. */
  invoicesDone?: 0 | 1;
}

export interface StatusEventRow {
  id?: number;
  orderKey: string;
  at: string;
  status: OrderStatus;
  rawStatus: string;
  courier?: string;
  awb?: string;
  eta?: string;
  location?: string;
  source: Source;
}

export interface DailySnapshotRow {
  day: string;
  orderKey: string;
  accountId: string;
  platform: Platform;
  status: OrderStatus;
  takenAt: string;
  snapshot: OrderDetail;
}

export interface InvoiceRow {
  key: string;              // invoiceKey(...)
  platform: Platform;
  accountId: string;
  orderKey: string;
  orderId: string;
  invoiceNo: string;
  url: string;
  sha256?: string;
  size?: number;
  fetchedAt?: string;
  fetchedDay?: string;
  zippedAt?: string;
  zipName?: string;
}

export interface InvoiceBlobRow { key: string; blob: Blob }

export interface CartRunRow {
  id?: number;
  at: string;
  platform: Platform;
  accountId?: string;
  url: string;
  coupon?: string;
  target: number;
  unitPrice?: number;
  qty?: number;
  subtotal?: number;
  discount?: number;
  payable?: number;
  couponOk?: boolean;
  outcome: 'ready-to-pay' | 'failed' | 'blocked' | 'needs-you';
  steps: Array<{ step: string; layer?: string; ok: boolean; note?: string; ms?: number }>;
}

export interface ErrorRow {
  id?: number;
  at: string;
  kind: 'blocked' | 'incomplete' | 'fetch-failed' | 'action-failed' | 'login-needed';
  platform?: Platform;
  accountId?: string;
  orderKey?: string;
  message: string;
  resolved: 0 | 1;
}

export interface OutboxRow { id?: number; table: string; rowKey: string; op: 'upsert' | 'delete'; at: string }

export class OrderPilotDB extends Dexie {
  accounts!: Table<AccountRow, string>;
  orders!: Table<OrderRow, string>;
  statusEvents!: Table<StatusEventRow, number>;
  dailySnapshots!: Table<DailySnapshotRow, [string, string]>;
  invoices!: Table<InvoiceRow, string>;
  invoiceBlobs!: Table<InvoiceBlobRow, string>;
  cartRuns!: Table<CartRunRow, number>;
  ladderStats!: Table<LadderStat & { key: string }, string>;
  errors!: Table<ErrorRow, number>;
  outbox!: Table<OutboxRow, number>;

  constructor(name = 'orderpilot') {
    super(name);
    this.version(1).stores({
      accounts: 'id, platform',
      orders: 'key, platform, accountId, status, isFinal, orderDate, lastCheckedAt',
      statusEvents: '++id, orderKey, at',
      dailySnapshots: '[day+orderKey], day, orderKey, accountId',
      invoices: 'key, sha256, orderKey, accountId, fetchedDay, zippedAt',
      invoiceBlobs: 'key',
      cartRuns: '++id, at',
      ladderStats: 'key',
      errors: '++id, at, kind, resolved, orderKey',
      outbox: '++id, table',
    });
  }
}

export const db = new OrderPilotDB();

export class DexieLadderStats implements LadderStatsStore {
  constructor(private d: OrderPilotDB = db) {}
  async get(key: string) {
    const r = await this.d.ladderStats.get(key);
    return r ? { winner: r.winner, fullTryDay: r.fullTryDay } : undefined;
  }
  async set(key: string, stat: LadderStat) { await this.d.ladderStats.put({ key, ...stat }); }
}

export type { Tracking };
