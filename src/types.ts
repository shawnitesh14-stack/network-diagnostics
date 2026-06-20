export type ScanStatus = "idle" | "resolving" | "scanning" | "completed" | "cancelled" | "failed";

export type ResourceType = "ip" | "hostname";

export interface ResolvedData {
  input: string;
  resolvedIp: string;
  type: ResourceType;
  version?: number;
  isAlreadyIp: boolean;
  error?: string;
}

export interface PortItem {
  port: number;
  name: string;
  description: string;
  category: "Web" | "Database" | "Transfer" | "Admin" | "Email" | "Other";
}

export interface ActiveScanPort {
  port: number;
  name: string;
  category: string;
  status: "pending" | "scanning" | "open" | "closed" | "filtered" | "error";
  durationMs?: number;
  details?: string;
}

export interface ScanReport {
  id: string;
  target: string;
  resolvedIp: string;
  timestamp: string;
  status: ScanStatus;
  totalPorts: number;
  openCount: number;
  closedCount: number;
  filteredCount: number;
  errorCount: number;
  ports: ActiveScanPort[];
  durationMs: number;
}
