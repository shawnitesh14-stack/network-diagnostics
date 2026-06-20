import { useState, useEffect, useRef, useMemo } from "react";
import {
  Activity,
  Globe,
  Server,
  Shield,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Play,
  Square,
  Search,
  Database,
  Cpu,
  History,
  Terminal,
  Settings,
  Clock,
  ArrowRight,
  Wifi,
  Copy,
  Trash2,
  RefreshCw,
  FileText,
  Check,
  SearchCheck,
  Info
} from "lucide-react";

import { COMMON_PORTS } from "./ports_preset";
import {
  ScanStatus,
  ResourceType,
  ResolvedData,
  PortItem,
  ActiveScanPort,
  ScanReport
} from "./types";

export default function App() {
  // Input Configuration State
  const [targetInput, setTargetInput] = useState<string>("8.8.8.8");
  const [useCustomPorts, setUseCustomPorts] = useState<boolean>(false);
  const [customPortsInput, setCustomPortsInput] = useState<string>("21-25, 80, 443, 3000, 8080");
  const [selectedPreset, setSelectedPreset] = useState<"common" | "web" | "database">("common");
  
  // Advanced Server Settings
  const [timeoutMs, setTimeoutMs] = useState<number>(1000);
  const [concurrency, setConcurrency] = useState<number>(3);

  // Resolution & Active Diagnostic State
  const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
  const [resolvedTarget, setResolvedTarget] = useState<ResolvedData | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [activePorts, setActivePorts] = useState<ActiveScanPort[]>([]);
  
  // Output Interactive Logs
  const [logs, setLogs] = useState<string[]>([]);
  const [autoScrollLogs, setAutoScrollLogs] = useState<boolean>(true);
  const [copiedLogs, setCopiedLogs] = useState<boolean>(false);

  // Client Filter & Search State
  const [portFilter, setPortFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "closed" | "filtered" | "error">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // Persistent Diagnostic History
  const [scanHistory, setScanHistory] = useState<ScanReport[]>([]);
  const [activeHistoryReportId, setActiveHistoryReportId] = useState<string | null>(null);

  // Reference elements for log scrolling and scan cancelation
  const logsEndRef = useRef<HTMLDivElement>(null);
  const isCancelledRef = useRef<boolean>(false);
  const scanStartTimeRef = useRef<number>(0);

  // Check backend server connection status on mount
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);

  useEffect(() => {
    // Initial server ping check
    const checkServer = async () => {
      try {
        const res = await fetch("/api/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: "127.0.0.1" })
        });
        if (res.ok) {
          setServerOnline(true);
        } else {
          setServerOnline(false);
        }
      } catch {
        setServerOnline(false);
      }
    };
    checkServer();

    // Load scanner log history from client memory
    try {
      const saved = localStorage.getItem("scanner_history");
      if (saved) {
        setScanHistory(JSON.parse(saved));
      }
    } catch (e) {
      console.error("Failed to load command scan history", e);
    }
  }, []);

  // Logger helper function
  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${timestamp}] ${message}`]);
  };

  // Scroll to bottom of terminal logger
  useEffect(() => {
    if (autoScrollLogs && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScrollLogs]);

  // Port Input Parser engine
  const parsePorts = (): ActiveScanPort[] => {
    if (!useCustomPorts) {
      let filtered: PortItem[] = [];
      if (selectedPreset === "common") {
        filtered = COMMON_PORTS;
      } else if (selectedPreset === "web") {
        filtered = COMMON_PORTS.filter(p => p.category === "Web" || p.port === 80 || p.port === 443 || p.port === 8080);
      } else if (selectedPreset === "database") {
        filtered = COMMON_PORTS.filter(p => p.category === "Database");
      }
      return filtered.map(p => ({
        port: p.port,
        name: p.name,
        category: p.category,
        status: "pending"
      }));
    }

    // Custom parsing implementation supporting comma lists, dashes or spaces
    const portsToScan: ActiveScanPort[] = [];
    const tokens = customPortsInput.split(/[\s,;]+/);
    const seen = new Set<number>();

    for (const token of tokens) {
      if (!token) continue;
      
      if (token.includes("-")) {
        // Range matched
        const rangeParts = token.split("-");
        const start = parseInt(rangeParts[0], 10);
        const end = parseInt(rangeParts[1], 10);
        
        if (!isNaN(start) && !isNaN(end) && start <= end && start >= 1 && end <= 65535) {
          const limit = Math.min(end, start + 100); // Guard limit to prevent server locking or user accidental lock
          for (let p = start; p <= limit; p++) {
            if (!seen.has(p)) {
              seen.add(p);
              const original = COMMON_PORTS.find(cp => cp.port === p);
              portsToScan.push({
                port: p,
                name: original?.name || "Custom",
                category: original?.category || "Other",
                status: "pending"
              });
            }
          }
        }
      } else {
        // Single port matched
        const p = parseInt(token, 10);
        if (!isNaN(p) && p >= 1 && p <= 65535) {
          if (!seen.has(p)) {
            seen.add(p);
            const original = COMMON_PORTS.find(cp => cp.port === p);
            portsToScan.push({
              port: p,
              name: original?.name || "Custom",
              category: original?.category || "Other",
              status: "pending"
            });
          }
        }
      }
    }

    // Sort ascending by port number
    return portsToScan.sort((a, b) => a.port - b.port);
  };

  // Launch DNS / IP Verification and network probe sequence
  const handleInitiateScan = async () => {
    if (!targetInput.trim()) {
      setValidationError("Please enter an IP address or hostname.");
      return;
    }

    // Prepare fresh UI matrix
    setScanStatus("resolving");
    setValidationError(null);
    setResolvedTarget(null);
    setActiveHistoryReportId(null);
    setLogs([]);
    isCancelledRef.current = false;
    scanStartTimeRef.current = Date.now();

    addLog(`SYSTEM: Diagnosing network address structure: "${targetInput.trim()}"`);
    addLog(`DNS: Querying automatic name resolution pipeline...`);

    try {
      const response = await fetch("/api/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: targetInput.trim() })
      });

      if (!response.ok) {
        throw new Error(`HTTP network error: status ${response.status}`);
      }

      const resData = await response.json();

      if (resData.error) {
        setValidationError(resData.error);
        setScanStatus("idle");
        addLog(`ERROR: Network target validation crashed: "${resData.error}"`);
        console.error("Target lookup exception logged:", resData.error);
        return;
      }

      // Display the resolved IP immediately before starting scan as per requirement
      const resolvedInfo: ResolvedData = {
        input: targetInput.trim(),
        resolvedIp: resData.resolvedIp,
        type: resData.type,
        version: resData.version,
        isAlreadyIp: resData.isAlreadyIp
      };
      
      setResolvedTarget(resolvedInfo);
      addLog(`DNS: Resolution mapped. Type: ${resolvedInfo.type.toUpperCase()} | Resolved target IP: ${resolvedInfo.resolvedIp}`);

      // Parse the ports selection list
      const targetPorts = parsePorts();
      if (targetPorts.length === 0) {
        setValidationError("No valid ports parsed. Check custom options.");
        setScanStatus("idle");
        addLog(`ERROR: Port target list parsing evaluated to empty grid.`);
        return;
      }

      setActivePorts(targetPorts);
      addLog(`PROBE: Selected ${targetPorts.length} connection diagnostic endpoints.`);

      // Step 2: Triggering Actual Connection Swarms
      setScanStatus("scanning");
      addLog(`PROBE: Starting active connection scan. Concurrency limit: ${concurrency} worker threads.`);
      addLog(`PROBE: Connection Handshake Timeout limit: ${timeoutMs}ms.`);

      // Dynamic worker execution queue
      let trackerIndex = 0;
      const scanResults = [...targetPorts];
      
      const executeWorkerQueue = async (): Promise<void> => {
        while (trackerIndex < scanResults.length && !isCancelledRef.current) {
          const currentTaskIndex = trackerIndex++;
          const targetPortItem = scanResults[currentTaskIndex];
          
          if (isCancelledRef.current) break;

          // Update state and logger to show port active probing
          setActivePorts((prev) =>
            prev.map((item, index) =>
              index === currentTaskIndex ? { ...item, status: "scanning" } : item
            )
          );
          addLog(`TCP: Probing port ${targetPortItem.port} (${targetPortItem.name}) on host "${resolvedInfo.resolvedIp}"`);

          try {
            const scanResponse = await fetch("/api/scan-port", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ip: resolvedInfo.resolvedIp,
                port: targetPortItem.port,
                timeout: timeoutMs
              })
            });

            if (isCancelledRef.current) break;

            if (!scanResponse.ok) {
              throw new Error(`Connection probe request error status: ${scanResponse.status}`);
            }

            const scanResult = await scanResponse.json();

            if (scanResult.error) {
              const errorPort: ActiveScanPort = {
                ...targetPortItem,
                status: "error",
                details: scanResult.error
              };
              scanResults[currentTaskIndex] = errorPort;
              setActivePorts((prev) =>
                prev.map((item, index) =>
                  index === currentTaskIndex ? errorPort : item
                )
              );
              addLog(`ERROR: Port ${targetPortItem.port} diagnostic failure: "${scanResult.error}"`);
            } else {
              const parsedPort: ActiveScanPort = {
                ...targetPortItem,
                status: scanResult.status,
                durationMs: scanResult.durationMs,
                details: scanResult.details
              };
              scanResults[currentTaskIndex] = parsedPort;
              setActivePorts((prev) =>
                prev.map((item, index) => (index === currentTaskIndex ? parsedPort : item))
              );

              // Status logger visual coloring
              if (scanResult.status === "open") {
                addLog(`TCP: ✔ PORT ${targetPortItem.port} (${targetPortItem.name}) is OPEN. Handshake established in ${scanResult.durationMs}ms`);
              } else if (scanResult.status === "filtered") {
                addLog(`TCP: ⚠️ PORT ${targetPortItem.port} (${targetPortItem.name}) is FILTERED / TIMED OUT (${scanResult.details || "No Response"})`);
              } else {
                addLog(`TCP: ✕ PORT ${targetPortItem.port} (${targetPortItem.name}) is CLOSED (${scanResult.details || "Refused"})`);
              }
            }
          } catch (err: any) {
            if (isCancelledRef.current) break;
            const crashedPort: ActiveScanPort = {
              ...targetPortItem,
              status: "error",
              details: err?.message || "Unhandled exception"
            };
            scanResults[currentTaskIndex] = crashedPort;
            setActivePorts((prev) =>
              prev.map((item, index) => (index === currentTaskIndex ? crashedPort : item))
            );
            addLog(`ERROR: Fatal issue scanning port ${targetPortItem.port}: ${err?.message || err}`);
            console.error("Individual port scanner crashed gracefully:", err);
          }
        }
      };

      // Launch parallel workers up to the concurrency configuration cap
      const activeRunningWorkers = Array.from({
        length: Math.min(concurrency, targetPorts.length)
      }).map(() => executeWorkerQueue());

      await Promise.all(activeRunningWorkers);

      // Verify completion final statuses
      const scanElapsedMs = Date.now() - scanStartTimeRef.current;
      
      if (isCancelledRef.current) {
        setScanStatus("cancelled");
        addLog(`SYSTEM: Scanning operation was explicitly aborted by user.`);
      } else {
        setScanStatus("completed");
        addLog(`SYSTEM: Diagnostics completed successfully! Time elapsed: ${(scanElapsedMs / 1000).toFixed(2)}s.`);

        // Aggregate statistics for persistent logging
        const open = scanResults.filter(p => p.status === "open").length;
        const closed = scanResults.filter(p => p.status === "closed").length;
        const filtered = scanResults.filter(p => p.status === "filtered").length;
        const error = scanResults.filter(p => p.status === "error").length;

        const finalReport: ScanReport = {
          id: Math.random().toString(36).substring(2, 11),
          target: targetInput.trim(),
          resolvedIp: resolvedInfo.resolvedIp,
          timestamp: new Date().toLocaleString(),
          status: "completed",
          totalPorts: scanResults.length,
          openCount: open,
          closedCount: closed,
          filteredCount: filtered,
          errorCount: error,
          ports: scanResults,
          durationMs: scanElapsedMs
        };

        setScanHistory((prev) => {
          const updated = [finalReport, ...prev].slice(0, 30); // Cache top 30 scans
          try {
            localStorage.setItem("scanner_history", JSON.stringify(updated));
          } catch (e) {
            console.error("Failed to save state to localStorage", e);
          }
          return updated;
        });
      }
    } catch (err: any) {
      setScanStatus("failed");
      addLog(`FATAL: Diagnostic exception: ${err?.message || "Internal server connection failed."}`);
      console.error("Scanner experienced overall process breakdown:", err);
    }
  };

  // Gracefully abort standard recursive requests
  const handleAbortScan = () => {
    isCancelledRef.current = true;
    setScanStatus("cancelled");
    addLog(`SYSTEM: Enqueueing cancellation request...`);
  };

  // Click on a historical item to view the dashboard contents or re-populate the inputs
  const handleViewHistoryItem = (report: ScanReport) => {
    setActiveHistoryReportId(report.id);
    setResolvedTarget({
      input: report.target,
      resolvedIp: report.resolvedIp,
      type: report.resolvedIp === report.target ? "ip" : "hostname",
      isAlreadyIp: report.resolvedIp === report.target
    });
    setTargetInput(report.target);
    setActivePorts(report.ports);
    setScanStatus("completed");
    setValidationError(null);
    setLogs([
      `[LOADED HISTORICAL RECORD] Diagnostic Session - ${report.timestamp}`,
      `Target: ${report.target} | Resolved: ${report.resolvedIp}`,
      `Open ports: ${report.openCount} / Total scoped: ${report.totalPorts}`,
      `Scan duration: ${(report.durationMs / 1000).toFixed(2)} seconds.`
    ]);
  };

  const handleClearHistory = () => {
    if (confirm("Are you sure you want to clear your local port scan history?")) {
      setScanHistory([]);
      localStorage.removeItem("scanner_history");
      if (activeHistoryReportId) {
        setScanStatus("idle");
        setResolvedTarget(null);
        setActivePorts([]);
      }
    }
  };

  // Helper stats for aggregate layout cards
  const summaryCounts = useMemo(() => {
    const counts = { total: activePorts.length, open: 0, closed: 0, filtered: 0, error: 0, pending: 0, scanning: 0 };
    activePorts.forEach(p => {
      if (p.status === "open") counts.open++;
      else if (p.status === "closed") counts.closed++;
      else if (p.status === "filtered") counts.filtered++;
      else if (p.status === "error") counts.error++;
      else if (p.status === "pending") counts.pending++;
      else if (p.status === "scanning") counts.scanning++;
    });
    return counts;
  }, [activePorts]);

  const completionPercent = useMemo(() => {
    if (activePorts.length === 0) return 0;
    const completedOrProbed = activePorts.filter(p => p.status !== "pending" && p.status !== "scanning").length;
    return Math.round((completedOrProbed / activePorts.length) * 100);
  }, [activePorts]);

  // Filters state ports before rendering client panel
  const filteredPortsToDisplay = useMemo(() => {
    return activePorts.filter(p => {
      // 1. Text Search IP/Port Match
      const textMatches =
        p.port.toString().includes(portFilter) ||
        p.name.toLowerCase().includes(portFilter.toLowerCase());

      // 2. Status Match
      const statusMatches = statusFilter === "all" || p.status === statusFilter;

      // 3. Category Match
      const categoryMatches = categoryFilter === "all" || p.category === categoryFilter;

      return textMatches && statusMatches && categoryMatches;
    });
  }, [activePorts, portFilter, statusFilter, categoryFilter]);

  // Copy plain log history
  const copyTerminalLogs = () => {
    try {
      navigator.clipboard.writeText(logs.join("\n"));
      setCopiedLogs(true);
      setTimeout(() => setCopiedLogs(false), 2000);
    } catch {
      alert("Failed to access system clipboard. Select manually inside console.");
    }
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-[#e2e8f0] pb-16 antialiased" id="scanner_root_container">
      {/* Dynamic Top Glow Strip */}
      <div className="h-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-600 w-full" />

      {/* Main Container */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        
        {/* Header Ribbon Area */}
        <header className="flex flex-col md:flex-row md:items-center justify-between pb-6 mb-6 border-b border-slate-800 gap-4" id="header_container">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-cyan-950/40 rounded-lg border border-cyan-800/60 shadow-[0_0_15px_rgba(6,182,212,0.15)]">
                <Activity className="h-6 w-6 text-cyan-400 animate-pulse" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                  Network Diagnostics <span className="text-xs font-mono font-medium px-2 py-0.5 bg-cyan-900/40 text-cyan-300 rounded border border-cyan-800/40 uppercase">v2.1 Stable</span>
                </h1>
                <p className="text-sm text-slate-400 mt-0.5">
                  Host-to-IP resolution, direct validation, and parallel multi-socket port auditing.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Connection Telemetry Indicator */}
            <div className="flex items-center gap-2 text-xs bg-slate-900/60 px-3 py-1.5 rounded-md border border-slate-800">
              <div className={`h-2 w-2 rounded-full ${serverOnline === true ? "bg-emerald-500 shadow-[0_0_8px_#10b981]" : "bg-rose-500 animate-ping"}`} />
              <span className="text-slate-400">DNS/Scan Engine: </span>
              <span className={serverOnline === true ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold"}>
                {serverOnline === null ? "Checking..." : serverOnline ? "SYSTEM ACTIVE" : "SERVER UNREACHABLE"}
              </span>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start" id="main_dashboard_grid">
          
          {/* LEFT INTERACTIVE CONTROL BAR (SIZE 4) */}
          <div className="lg:col-span-4 space-y-6" id="left_panel_controls">
            
            {/* Module 1: Address target input card */}
            <div className="bg-[#0f1524] rounded-xl border border-slate-800 shadow-xl overflow-hidden" id="target_card_controller">
              <div className="p-4 bg-slate-900/80 border-b border-slate-800 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Globe className="h-4.5 w-4.5 text-cyan-400" />
                  <h3 className="font-semibold text-sm text-white">Auditing Target Input</h3>
                </div>
                <span className="text-xs text-slate-500 font-mono">DNS + IP Validations</span>
              </div>

              <div className="p-5 space-y-4">
                {/* Main Input Component */}
                <div>
                  <label htmlFor="target_input" className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
                    IP Address or Domain Hostname
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      id="target_input"
                      value={targetInput}
                      onChange={(e) => {
                        setTargetInput(e.target.value);
                        if (validationError) setValidationError(null);
                      }}
                      placeholder="e.g. 192.168.1.1, localhost, or google.com"
                      disabled={scanStatus === "resolving" || scanStatus === "scanning"}
                      className="w-full bg-[#090d16] border border-slate-700 rounded-lg py-2.5 pl-3 pr-10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition duration-150 font-mono disabled:opacity-60"
                    />
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                      {targetInput.includes(".") || targetInput === "localhost" ? (
                        <Globe className="h-4 w-4 text-cyan-500/80" />
                      ) : (
                        <Server className="h-4 w-4 text-slate-500" />
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                    Accepts direct IPv4/IPv6 address strings or domain hostnames (resolved to IP via backend DNS on fly).
                  </p>
                </div>

                {/* Validation Warnings */}
                {validationError && (
                  <div className="p-3 bg-rose-950/30 border border-rose-900/50 rounded-lg flex items-start gap-2.5 animate-fadeIn" id="validation_alert_box">
                    <ShieldAlert className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <p className="text-xs font-semibold text-rose-300">Target Error</p>
                      <p className="text-xs text-rose-200/90 leading-normal">{validationError}</p>
                    </div>
                  </div>
                )}

                {/* Port Selection Options */}
                <div className="pt-2 border-t border-slate-800">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Audit Ports Range
                    </label>
                    <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs text-cyan-400 hover:text-cyan-300 select-none">
                      <input
                        type="checkbox"
                        checked={useCustomPorts}
                        onChange={(e) => setUseCustomPorts(e.target.checked)}
                        className="sr-only peer"
                      />
                      <span className={`w-8 h-4 bg-slate-800 rounded-full transition-colors relative after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-slate-400 after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-cyan-600 peer-checked:after:translate-x-4 peer-checked:after:bg-white`} />
                      <span>{useCustomPorts ? "Custom Ports List" : "Direct Presets"}</span>
                    </label>
                  </div>

                  {!useCustomPorts ? (
                    <div className="grid grid-cols-3 gap-2" id="preset_tabs">
                      <button
                        type="button"
                        onClick={() => setSelectedPreset("common")}
                        className={`text-xs p-2.5 rounded-lg border text-center transition font-medium ${
                          selectedPreset === "common"
                            ? "bg-slate-800/80 border-cyan-500/50 text-cyan-300 shadow-md"
                            : "bg-[#090d16] border-slate-850 hover:border-slate-700 text-slate-400 hover:text-slate-300"
                        }`}
                      >
                        Common
                        <span className="block text-[10px] text-slate-500 mt-0.5">18 Scans</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedPreset("web")}
                        className={`text-xs p-2.5 rounded-lg border text-center transition font-medium ${
                          selectedPreset === "web"
                            ? "bg-slate-800/80 border-cyan-500/50 text-cyan-300 shadow-md"
                            : "bg-[#090d16] border-slate-850 hover:border-slate-700 text-slate-400 hover:text-slate-300"
                        }`}
                      >
                        Web Stack
                        <span className="block text-[10px] text-slate-500 mt-0.5">4 Scans</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedPreset("database")}
                        className={`text-xs p-2.5 rounded-lg border text-center transition font-medium ${
                          selectedPreset === "database"
                            ? "bg-slate-800/80 border-cyan-500/50 text-cyan-300 shadow-md"
                            : "bg-[#090d16] border-slate-850 hover:border-slate-700 text-slate-400 hover:text-slate-300"
                        }`}
                      >
                        Databases
                        <span className="block text-[10px] text-slate-500 mt-0.5">7 Scans</span>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1.5 animate-fadeIn">
                      <input
                        type="text"
                        value={customPortsInput}
                        onChange={(e) => setCustomPortsInput(e.target.value)}
                        placeholder="e.g. 21, 22, 80-90, 443"
                        className="w-full bg-[#090d16] border border-slate-700 rounded-lg py-2 px-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
                      />
                      <span className="block text-[10px] text-slate-500 leading-tight">
                        Support formats: single ports (e.g. <code className="text-slate-400">80</code>), list dividers (e.g. <code className="text-slate-400">80, 443</code>), or range limits (e.g. <code className="text-slate-400">80-90</code> limit of max 100 consecutive endpoints per range).
                      </span>
                    </div>
                  )}
                </div>

                {/* Adjustments: Timeout / Workers Concurrency limits */}
                <div className="pt-3 border-t border-slate-800 space-y-3">
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-slate-400 font-medium font-mono">CONNECTION TIMEOUT:</span>
                      <span className="text-cyan-400 font-semibold">{timeoutMs}ms</span>
                    </div>
                    <input
                      type="range"
                      min="100"
                      max="5000"
                      step="100"
                      value={timeoutMs}
                      onChange={(e) => setTimeoutMs(parseInt(e.target.value, 10))}
                      disabled={scanStatus === "resolving" || scanStatus === "scanning"}
                      className="w-full accent-cyan-500 h-1 bg-slate-800 rounded-lg cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500">
                      <span>100ms (Fast LAN)</span>
                      <span>5000ms (Slow WAN)</span>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-slate-400 font-medium font-mono">CONCURRENT SOCKET WORKERS:</span>
                      <span className="text-indigo-400 font-semibold">{concurrency} Threads</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      step="1"
                      value={concurrency}
                      onChange={(e) => setConcurrency(parseInt(e.target.value, 10))}
                      disabled={scanStatus === "resolving" || scanStatus === "scanning"}
                      className="w-full accent-indigo-500 h-1 bg-slate-800 rounded-lg cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500">
                      <span>1 Thread</span>
                      <span>10 Parallel (Aggressive)</span>
                    </div>
                  </div>
                </div>

                {/* Target Execution Buttons */}
                <div className="pt-2">
                  {scanStatus === "resolving" || scanStatus === "scanning" ? (
                    <button
                      type="button"
                      onClick={handleAbortScan}
                      className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 text-white font-medium py-3 px-4 rounded-lg shadow-lg hover:shadow-red-900/40 transition-all duration-150 border border-red-500/30"
                      id="abort_scan_btn"
                    >
                      <Square className="h-4.5 w-4.5 shrink-0 fill-current animate-pulse" />
                      <span>ABORT MATRIX SCAN</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleInitiateScan}
                      className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 hover:from-cyan-500 hover:via-blue-500 hover:to-indigo-500 text-white font-semibold py-3 px-4 rounded-lg shadow-lg hover:shadow-cyan-500/20 active:translate-y-0.5 transition-all duration-150 border border-cyan-400/20"
                      id="run_scan_btn"
                    >
                      <Play className="h-4.5 w-4.5 shrink-0 fill-current" />
                      <span>RESOLVE & SCAN PORTS</span>
                    </button>
                  )}
                </div>

              </div>
            </div>

            {/* Module 2: Local Scan History Panel */}
            <div className="bg-[#0f1524] rounded-xl border border-slate-800 shadow-xl overflow-hidden" id="history_card_container">
              <div className="p-4 bg-slate-900/80 border-b border-slate-800 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-indigo-400" />
                  <h3 className="font-semibold text-sm text-white">Audit Cache Log</h3>
                </div>
                {scanHistory.length > 0 && (
                  <button
                    onClick={handleClearHistory}
                    className="text-[11px] text-rose-400 hover:text-rose-300 flex items-center gap-1 transition"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Clear Cache
                  </button>
                )}
              </div>

              <div className="p-4">
                {scanHistory.length === 0 ? (
                  <div className="py-8 text-center" id="empty_history_log">
                    <History className="h-8 w-8 text-slate-600 mx-auto opacity-40 mb-2" />
                    <p className="text-xs text-slate-500">No diagnostic reports cached locally.</p>
                    <p className="text-[10px] text-slate-600 mt-1">Completing a port scan saves results for comparison here.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[290px] overflow-y-auto pr-1" id="history_item_list">
                    {scanHistory.map((report) => (
                      <button
                        key={report.id}
                        onClick={() => handleViewHistoryItem(report)}
                        className={`w-full text-left p-3 rounded-lg border transition text-xs block relative group ${
                          activeHistoryReportId === report.id
                            ? "bg-slate-800/80 border-indigo-500/60 shadow-md text-slate-100"
                            : "bg-[#090d16] border-slate-850 hover:border-slate-850 hover:bg-slate-900/50 text-slate-450"
                        }`}
                      >
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-semibold text-white font-mono break-all pr-2 max-w-[190px] truncate">
                            {report.target}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono shrink-0">
                            {report.ports.filter(p => p.status === "open").length} Open / {report.totalPorts}
                          </span>
                        </div>
                        
                        <div className="font-mono text-[10px] text-slate-400 flex justify-between items-center">
                          <span>Resolved: {report.resolvedIp}</span>
                          <span className="text-indigo-400 font-semibold">{(report.durationMs / 1000).toFixed(1)}s</span>
                        </div>

                        <div className="text-[9px] text-slate-500 flex items-center justify-between mt-1 pt-1.5 border-t border-slate-900">
                          <span>{report.timestamp}</span>
                          <span className="text-cyan-400 group-hover:underline flex items-center gap-0.5">
                            Recall Details <ArrowRight className="h-2.5 w-2.5" />
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* RIGHT DETAILED SPECTRAL PANEL (SIZE 8) */}
          <div className="lg:col-span-8 space-y-6" id="right_diagnostic_dashboard">
            
            {/* Blank State View */}
            {scanStatus === "idle" && !resolvedTarget && (
              <div className="bg-[#0f1524] rounded-xl border border-slate-800 shadow-xl p-8 text-center py-16 fill-card" id="empty_audit_state">
                <div className="max-w-md mx-auto space-y-5">
                  
                  {/* Glowing Radar Target Node Circle */}
                  <div className="relative h-24 w-24 mx-auto mb-4">
                    <div className="absolute inset-0 rounded-full bg-cyan-500/5 animate-ping" />
                    <div className="absolute inset-2 rounded-full border border-dashed border-cyan-500/25 animate-spin duration-15000" />
                    <div className="absolute inset-4 rounded-full bg-cyan-950/20 border border-slate-800 flex items-center justify-center">
                      <Cpu className="h-8 w-8 text-cyan-400 animate-pulse" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-lg font-bold text-white tracking-tight">Scanner Matrix Initialized</h3>
                    <p className="text-sm text-slate-400 leading-relaxed">
                      Enter any IP pattern or address URL in the configuration block to initiate deep socket connection validation routines.
                    </p>
                  </div>

                  {/* Feature Quick Tips Checklist */}
                  <div className="bg-[#080d16] p-4 rounded-lg border border-slate-850 text-left space-y-2.5">
                    <h4 className="text-xs font-semibold text-cyan-400 uppercase tracking-wider font-mono">Quick Checklist & Guidelines:</h4>
                    <ul className="text-xs text-slate-400 space-y-1.5 list-disc pl-4.5">
                      <li>Supports both IP structures (e.g. <code className="text-indigo-300">127.0.0.1</code>) and fully qualified domain hostnames (e.g. <code className="text-indigo-300">google.com</code>).</li>
                      <li>Performs <strong className="text-slate-200">real-time IP sanitization and format checks</strong> before execution starts.</li>
                      <li>Renders active socket workers that perform simultaneous multi-handshake probes with manual cancellation and microsecond tracking.</li>
                      <li>Logs errors safely to custom logs in the bottom diagnostic terminal.</li>
                    </ul>
                  </div>

                  <div className="flex justify-center gap-3">
                    <button
                      onClick={() => { setTargetInput("127.0.0.1"); setValidationError(null); }}
                      className="px-3 py-1.5 bg-slate-900 rounded-lg hover:bg-slate-800 text-xs font-mono text-slate-300 border border-slate-800 hover:border-slate-700 transition"
                    >
                      Use Loopback IP (127.0.0.1)
                    </button>
                    <button
                      onClick={() => { setTargetInput("localhost"); setValidationError(null); }}
                      className="px-3 py-1.5 bg-slate-900 rounded-lg hover:bg-slate-800 text-xs font-mono text-slate-300 border border-slate-800 hover:border-slate-700 transition"
                    >
                      Use Local Hostname (localhost)
                    </button>
                  </div>

                </div>
              </div>
            )}

            {/* Scanning details dashboard */}
            {(resolvedTarget || scanStatus !== "idle") && (
              <div className="space-y-6" id="dashboard_diagnostics_active_layer">
                
                {/* Visual Section: Live Target Details Panel */}
                <div className="bg-[#0f1524] rounded-xl border border-slate-800 p-5 shadow-lg relative overflow-hidden" id="live_target_metric_panel">
                  {/* Subtle Background Canvas Grid Accent */}
                  <div className="absolute top-0 right-0 p-8 opacity-5 text-indigo-400 pointer-events-none select-none">
                    <GridPattern />
                  </div>

                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold font-mono tracking-wider text-slate-500 uppercase">Target Address:</span>
                        <span className="text-xs font-semibold px-2 py-0.5 bg-cyan-900/30 text-cyan-300 rounded-full border border-cyan-800/40">
                          {resolvedTarget?.type === "ip" ? "Direct IP Address" : "Domain Hostname"}
                        </span>
                        {activeHistoryReportId && (
                          <span className="text-xs font-semibold px-2 py-0.5 bg-indigo-900/30 text-indigo-300 rounded-full border border-indigo-800/40 font-mono">
                            HISTORIC
                          </span>
                        )}
                      </div>
                      
                      <div className="flex items-baseline gap-2.5">
                        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white font-mono break-all">
                          {resolvedTarget?.input || targetInput}
                        </h2>
                      </div>
                      
                      {/* Displays Resolved IP address string before scanning or when loaded - satisfying validation display requirements */}
                      {resolvedTarget && (
                        <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-1">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                          <span>Resolved Target IP: </span>
                          <strong className="text-emerald-400 font-mono text-xs font-semibold">{resolvedTarget.resolvedIp}</strong>
                          {resolvedTarget.version && (
                            <span className="font-mono text-[10px] px-1 bg-slate-800 text-slate-400 rounded">
                              IPv{resolvedTarget.version}
                            </span>
                          )}
                          <span className="text-slate-500">•</span>
                          <span className="text-[11px] text-slate-400">Validated Successful DNS Handshake</span>
                        </div>
                      )}
                    </div>

                    <div className="shrink-0 flex items-center gap-2 w-full md:w-auto self-stretch md:self-auto justify-end bg-slate-900/40 md:bg-transparent p-2.5 md:p-0 rounded-lg">
                      {scanStatus === "resolving" && (
                        <div className="flex items-center gap-2 text-yellow-400 text-sm font-semibold">
                          <RefreshCw className="h-4.5 w-4.5 animate-spin" />
                          <span>Querying Server DNS...</span>
                        </div>
                      )}
                      
                      {scanStatus === "scanning" && (
                        <div className="flex items-center gap-2.5 text-cyan-400 text-sm font-semibold">
                          <span className="relative flex h-3.5 w-3.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-cyan-500"></span>
                          </span>
                          <span>Probing Connection Ports ({completionPercent}%)</span>
                        </div>
                      )}

                      {scanStatus === "completed" && (
                        <div className="flex items-center gap-1.5 text-emerald-400 text-sm font-bold bg-emerald-950/20 px-3 py-1.5 rounded-lg border border-emerald-900/50">
                          <CheckCircle2 className="h-4 w-4 shrink-0" />
                          <span>AUDIT COMPLETE</span>
                        </div>
                      )}

                      {scanStatus === "cancelled" && (
                        <div className="flex items-center gap-1.5 text-rose-400 text-sm font-semibold bg-rose-950/20 px-3 py-1.5 rounded-lg border border-rose-900/50">
                          <AlertTriangle className="h-4 w-4 shrink-0" />
                          <span>PROBE CANCELED</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Multi-handshake Process Progress Bar */}
                  {(scanStatus === "scanning" || scanStatus === "completed" || scanStatus === "cancelled") && (
                    <div className="mt-4 pt-4 border-t border-slate-850 space-y-1.5 animate-fadeIn">
                      <div className="flex justify-between items-center text-xs font-mono">
                        <span className="text-slate-400">Auditing Sequence Progess Grid:</span>
                        <span className="text-slate-300 font-bold">{completionPercent}% ({activePorts.filter(p => p.status !== "pending" && p.status !== "scanning").length} / {summaryCounts.total} Checked)</span>
                      </div>
                      <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                        <div
                          className={`h-full transition-all duration-300 bg-gradient-to-r ${
                            scanStatus === "cancelled" 
                              ? "from-rose-500 to-red-600" 
                              : completionPercent === 100 
                                ? "from-emerald-500 to-cyan-500" 
                                : "from-cyan-500 via-blue-500 to-indigo-600 animate-pulse"
                          }`}
                          style={{ width: `${completionPercent}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Dashboard Count Widgets Bento-Boxes */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3" id="bento_metrics_grid">
                  
                  {/* Total Scope */}
                  <div className="bg-[#0f1524] rounded-lg border border-slate-800 p-3.5 text-center transition hover:border-slate-755">
                    <span className="block text-[10px] text-slate-500 font-semibold uppercase tracking-wider font-mono">Total Ports Scoped</span>
                    <strong className="block text-xl font-bold font-mono text-white mt-1">{summaryCounts.total}</strong>
                    <div className="h-1 bg-slate-800 w-2/3 mx-auto mt-2 rounded-full" />
                  </div>

                  {/* Open Ports */}
                  <div className="bg-[#0f1524] rounded-lg border border-slate-800 p-3.5 text-center transition hover:border-slate-755">
                    <span className="block text-[10px] text-emerald-500 font-semibold uppercase tracking-wider font-mono">✔ Ports Open</span>
                    <strong className="block text-xl font-bold font-mono text-emerald-400 mt-1">{summaryCounts.open}</strong>
                    <div className={`h-1 mx-auto mt-2 rounded-full w-2/3 ${summaryCounts.open > 0 ? "bg-emerald-500 shadow-[0_0_8px_#10b981]" : "bg-slate-800"}`} />
                  </div>

                  {/* Closed Ports */}
                  <div className="bg-[#0f1524] rounded-lg border border-slate-800 p-3.5 text-center transition hover:border-slate-755">
                    <span className="block text-[10px] text-slate-400 font-semibold uppercase tracking-wider font-mono">✕ Closed</span>
                    <strong className="block text-xl font-bold font-mono text-slate-300 mt-1">{summaryCounts.closed}</strong>
                    <div className="h-1 bg-slate-800 w-2/3 mx-auto mt-2 rounded-full" />
                  </div>

                  {/* Filtered Ports */}
                  <div className="bg-[#0f1524] rounded-lg border border-slate-800 p-3.5 text-center transition hover:border-slate-755">
                    <span className="block text-[10px] text-amber-500 font-semibold uppercase tracking-wider font-mono">⚠️ Filtered/Timeout</span>
                    <strong className="block text-xl font-bold font-mono text-amber-400 mt-1">{summaryCounts.filtered}</strong>
                    <div className={`h-1 mx-auto mt-2 rounded-full w-2/3 ${summaryCounts.filtered > 0 ? "bg-amber-500 animate-pulse" : "bg-slate-800"}`} />
                  </div>

                  {/* Errors */}
                  <div className="bg-[#0f1524] rounded-lg border border-slate-800 p-3.5 text-center col-span-2 sm:col-span-1 transition hover:border-slate-755">
                    <span className="block text-[10px] text-rose-550 font-semibold uppercase tracking-wider font-mono">Probe Failed</span>
                    <strong className="block text-xl font-bold font-mono text-rose-450 mt-1">{summaryCounts.error}</strong>
                    <div className={`h-1 mx-auto mt-2 rounded-full w-2/3 ${summaryCounts.error > 0 ? "bg-rose-500 shadow-[0_0_8px_#ef4444]" : "bg-slate-800"}`} />
                  </div>

                </div>

                {/* Ports Spectral Filter Grid and Spectrum Dashboard */}
                <div className="bg-[#0f1524] rounded-xl border border-slate-800 overflow-hidden" id="spectral_port_board">
                  
                  {/* Header containing Filters & Search */}
                  <div className="p-4 bg-slate-900/80 border-b border-slate-800 space-y-3.5 sm:space-y-0 sm:flex sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                      <SearchCheck className="h-4.5 w-4.5 text-cyan-400" />
                      <h3 className="font-semibold text-sm text-white">Spectral Port Probes Grid</h3>
                      <span className="text-xs text-slate-500 font-mono">({filteredPortsToDisplay.length} listed)</span>
                    </div>

                    {/* Filter Inputs Toolbar */}
                    <div className="flex flex-wrap items-center gap-2" id="filter_toolbar">
                      {/* Search Match */}
                      <div className="relative">
                        <input
                          type="text"
                          value={portFilter}
                          onChange={(e) => setPortFilter(e.target.value)}
                          placeholder="Search Port or Name..."
                          className="w-36 sm:w-44 bg-[#090d16] border border-slate-700/80 rounded py-1 px-2 text-xs text-white pl-7 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                        />
                        <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-slate-500" />
                      </div>

                      {/* Filter Status Selection */}
                      <select
                        value={statusFilter}
                        onChange={(e: any) => setStatusFilter(e.target.value)}
                        className="bg-[#090d16] border border-slate-700/80 rounded py-1 px-2 text-xs text-slate-300 focus:outline-none focus:border-cyan-500"
                        title="Filter Port Status"
                      >
                        <option value="all">Any Status</option>
                        <option value="open">Open</option>
                        <option value="closed">Closed</option>
                        <option value="filtered">Filtered/Timeout</option>
                        <option value="error">Failed/Error</option>
                      </select>

                      {/* Filter category Selection */}
                      <select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        className="bg-[#090d16] border border-slate-700/80 rounded py-1 px-2 text-xs text-slate-300 focus:outline-none focus:border-cyan-500"
                        title="Filter Port Category"
                      >
                        <option value="all">Any Group</option>
                        <option value="Web">Web Services</option>
                        <option value="Database">Databases</option>
                        <option value="Transfer">Files & Transfer</option>
                        <option value="Admin">Admin Protocols</option>
                        <option value="Email">Mail Services</option>
                        <option value="Other">Other Services</option>
                      </select>
                    </div>
                  </div>

                  {/* Probe Grid Container */}
                  <div className="p-5 max-h-[380px] overflow-y-auto" id="spectral_probe_grid">
                    
                    {filteredPortsToDisplay.length === 0 ? (
                      <div className="py-12 text-center" id="empty_grid_feedback">
                        <Info className="h-8 w-8 text-slate-600 mx-auto opacity-40 mb-2" />
                        <p className="text-sm text-slate-450 font-medium">No ports match current search query or group filter.</p>
                        <button
                          onClick={() => { setPortFilter(""); setStatusFilter("all"); setCategoryFilter("all"); }}
                          className="text-xs text-cyan-400 hover:underline mt-2 inline-block"
                        >
                          Reset Filters Area
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
                        {filteredPortsToDisplay.map((prob) => {
                          const open = prob.status === "open";
                          const closed = prob.status === "closed";
                          const filtered = prob.status === "filtered";
                          const error = probationStatusIsError(prob.status);
                          const active = prob.status === "scanning";

                          return (
                            <div
                              key={prob.port}
                              className={`rounded-lg border p-3 flex flex-col justify-between transition relative group overflow-hidden ${
                                open
                                  ? "bg-emerald-950/25 border-emerald-500/50 shadow-[0_0_12px_rgba(16,182,212,0.05)] text-[#e6f4ea]"
                                  : closed
                                    ? "bg-slate-900/40 border-slate-800 text-slate-300 hover:border-slate-750"
                                    : filtered
                                      ? "bg-amber-950/15 border-amber-500/40 text-[#fef3c7]"
                                      : error
                                        ? "bg-rose-955/20 border-rose-500/40 text-[#fde8e8]"
                                        : active
                                          ? "bg-slate-900/85 border-cyan-500/60 shadow-lg animate-pulse"
                                          : "bg-[#090d16] border-slate-850 text-slate-450 hover:border-slate-800"
                              }`}
                            >
                              {/* Visual Status Glow Accents */}
                              {open && <div className="absolute top-0 left-0 w-1 bg-emerald-500 h-full shadow-[0_0_8px_#10b981]" />}
                              {active && <div className="absolute top-0 left-0 w-1 bg-cyan-500 h-full" />}
                              {filtered && <div className="absolute top-0 left-0 w-1 bg-amber-500 h-full" />}
                              {error && <div className="absolute top-0 left-0 w-1 bg-rose-500 h-full" />}

                              <div>
                                <div className="flex justify-between items-start mb-1">
                                  <span className="font-mono font-bold text-sm tracking-wide text-white">
                                    {prob.port}
                                  </span>
                                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-medium border ${
                                    open
                                      ? "bg-emerald-950 border-emerald-800/60 text-emerald-400"
                                      : closed
                                        ? "bg-slate-950 border-slate-800 text-slate-500"
                                        : filtered
                                          ? "bg-amber-900/30 border-amber-800/40 text-amber-400"
                                          : error
                                            ? "bg-rose-950 border-rose-800/50 text-rose-400"
                                            : active
                                              ? "bg-cyan-950 border-cyan-800/60 text-cyan-400"
                                              : "bg-slate-950 border-slate-900 text-slate-600"
                                  }`}>
                                    {prob.status.toUpperCase()}
                                  </span>
                                </div>

                                <div className="flex items-center justify-between mt-1">
                                  <span className="text-xs font-semibold text-white group-hover:text-cyan-300 transition-colors truncate max-w-[90px]">
                                    {prob.name}
                                  </span>
                                  <span className="text-[10px] text-slate-500 font-mono">
                                    {prob.category}
                                  </span>
                                </div>
                              </div>

                              <div className="mt-2.5 pt-1.5 border-t border-slate-850 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                                <span className="opacity-70 truncate max-w-[85px]" title={prob.details}>
                                  {prob.details || getPortCategoryDetails(prob.status, prob.category)}
                                </span>
                                <span>
                                  {prob.durationMs !== undefined ? `${prob.durationMs}ms` : "—"}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                  </div>

                </div>

                {/* VISUAL REALTIME CONSOLE LOGGER */}
                <div className="bg-[#0b0f1a] rounded-xl border border-slate-800 overflow-hidden shadow-xl" id="diagnostic_system_consoles_container">
                  <div className="p-3.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <Terminal className="h-4 w-4 text-emerald-400" />
                      <h3 className="font-semibold text-xs text-white uppercase tracking-wider font-mono">Diagnostic Logs Terminal</h3>
                    </div>

                    <div className="flex items-center gap-3">
                      <label htmlFor="autoscroll_check" className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-300 select-none cursor-pointer">
                        <input
                          type="checkbox"
                          id="autoscroll_check"
                          checked={autoScrollLogs}
                          onChange={(e) => setAutoScrollLogs(e.target.checked)}
                          className="rounded border-slate-800 bg-[#090d16] text-cyan-600 focus:ring-0"
                        />
                        <span>Auto-scroll</span>
                      </label>

                      {logs.length > 0 && (
                        <button
                          onClick={copyTerminalLogs}
                          className="text-xs text-slate-300 hover:text-white flex items-center gap-1 bg-slate-800 hover:bg-slate-755 border border-slate-700 px-2.5 py-1 rounded transition"
                        >
                          {copiedLogs ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-400" />
                              <span className="text-emerald-400">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              <span>Copy Console</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="p-4 bg-[#05080f] h-[190px] overflow-y-auto font-mono text-xs text-slate-300 space-y-1.5 antialiased" id="terminal_logs_viewport">
                    {logs.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-slate-600 italic select-none">
                        Waiting for scanner stream commands...
                      </div>
                    ) : (
                      logs.map((log, id) => {
                        let logColor = "text-slate-300";
                        if (log.includes("✔ PORT") || log.includes("resolved IP") || log.includes("mapped") || log.includes("DNS: Querying") || log.includes("DNS: Resolution") || log.includes("SUCCESSFUL")) {
                          logColor = "text-emerald-400";
                        } else if (log.includes("ERROR") || log.includes("FATAL") || log.includes("crashed")) {
                          logColor = "text-rose-400";
                        } else if (log.includes("⚠️ PORT") || log.includes("Filtered") || log.includes("_cancellation_")) {
                          logColor = "text-amber-400";
                        } else if (log.includes("SYSTEM:") || log.includes("PROBE:")) {
                          logColor = "text-cyan-400 font-semibold";
                        }

                        return (
                          <div key={id} className={`leading-relaxed whitespace-pre-wrap ${logColor}`}>
                            <span className="text-slate-600 select-none mr-2">&gt;</span>
                            {log}
                          </div>
                        );
                      })
                    )}
                    <div ref={logsEndRef} />
                  </div>
                </div>

              </div>
            )}

          </div>

        </div>

      </div>
    </div>
  );
}

// Subcomponent decorators or helpers
function GridPattern() {
  return (
    <svg width="40" height="40" className="stroke-slate-900 fill-none" viewBox="0 0 40 40">
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)" />
    </svg>
  );
}

function probationStatusIsError(status: string): boolean {
  return status === "error" || status === "failed";
}

function getPortCategoryDetails(status: string, category: string): string {
  if (status === "pending") return "Pending probe";
  if (status === "scanning") return "Probing handshake";
  
  if (category === "Web") return "Secure web services";
  if (category === "Database") return "Persistent relational DB";
  if (category === "Admin") return "Secure Shell remote shell";
  if (category === "Transfer") return "Direct protocol server";
  return "Protocol service mapped";
}
