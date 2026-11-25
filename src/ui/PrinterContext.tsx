/**
 * Shared printer data for the whole app: one client, one status poll and one queue poll,
 * so opening several views never multiplies the load on the printer.
 */

import { createContext, type ComponentChildren } from "preact";
import { useCallback, useContext, useMemo, useState } from "preact/hooks";
import { PrinterClient } from "../printer/client";
import type { PrinterStatus, QueuedJob } from "../printer/types";
import { loadOwner, saveOwner } from "./settings";
import { type Polled, usePolling } from "./usePolling";

const STATUS_INTERVAL_MS = 30_000;
const QUEUE_INTERVAL_MS = 15_000;

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
  const status = usePolling(useCallback(() => client.getStatus(), [client]), STATUS_INTERVAL_MS);
  const queue = usePolling(useCallback(() => client.getQueue(), [client]), QUEUE_INTERVAL_MS);
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
