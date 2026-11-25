/**
 * Shared printer data for the whole app: one client, one status poll and one queue poll,
 * so opening several views never multiplies the load on the printer.
 */

import { createContext, type ComponentChildren } from "preact";
import { useCallback, useContext, useMemo, useState } from "preact/hooks";
import { PrinterClient } from "../printer/client";
import { type SupplySnapshot, applySnapshot, parseSnapshot } from "../printer/exactSupplies";
import type { PrinterStatus, QueuedJob } from "../printer/types";
import { loadOwner, saveOwner } from "./settings";
import { type Polled, usePolling } from "./usePolling";

const STATUS_INTERVAL_MS = 30_000;
const QUEUE_INTERVAL_MS = 15_000;
/** The snapshot changes a few times a day at most. */
const SNAPSHOT_INTERVAL_MS = 30 * 60_000;

/**
 * Exact toner levels published by scripts/toner/publish.ts. Any failure (offline, not yet
 * published, malformed) simply means "no exact values" and the UI shows ranges.
 */
async function loadSnapshot(): Promise<SupplySnapshot | null> {
  if (!__TONER_DATA_URL__) return null;
  try {
    const res = await fetch(__TONER_DATA_URL__);
    return res.ok ? parseSnapshot(await res.json()) : null;
  } catch {
    return null;
  }
}

interface PrinterContextValue {
  client: PrinterClient;
  status: Polled<PrinterStatus>;
  queue: Polled<QueuedJob[]>;
  /** Owner string the printer records for this computer, learned from the first tracked job. */
  owner: string | null;
  rememberOwner: (owner: string) => void;
}

const Ctx = createContext<PrinterContextValue | null>(null);

export function PrinterProvider(props: { client?: PrinterClient; children: ComponentChildren }) {
  const client = useMemo(() => props.client ?? new PrinterClient(), [props.client]);
  const queue = usePolling(useCallback(() => client.getQueue(), [client]), QUEUE_INTERVAL_MS);
  const snapshot = usePolling(loadSnapshot, SNAPSHOT_INTERVAL_MS);
  const liveStatus = usePolling(useCallback(() => client.getStatus(), [client]), STATUS_INTERVAL_MS);
  // Merge measured toner levels into the live status wherever they agree with it.
  const status = useMemo<Polled<PrinterStatus>>(() => {
    const data = liveStatus.data;
    if (!data || !snapshot.data) return liveStatus;
    return { ...liveStatus, data: { ...data, supplies: applySnapshot(data.supplies, data.device.model, snapshot.data) } };
  }, [liveStatus, snapshot.data]);
  const [owner, setOwner] = useState(loadOwner);
  const rememberOwner = useCallback((o: string) => {
    setOwner(o);
    saveOwner(o);
  }, []);
  const value = useMemo(() => ({ client, status, queue, owner, rememberOwner }), [client, status, queue, owner, rememberOwner]);
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

export function usePrinter(): PrinterContextValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("usePrinter must be used inside <PrinterProvider>");
  return value;
}
