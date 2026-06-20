import express from "express";
import path from "path";
import dns from "dns";
import net from "net";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // Logging utility
  const logError = (context: string, error: any) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ERROR in ${context}:`, error?.message || error || "Unknown Error");
  };

  const logInfo = (context: string, message: string) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] INFO [${context}]: ${message}`);
  };

  // Dedicated API routes
  
  // 1. DNS Resolution & IP Validation Endpoint
  app.post("/api/resolve", (req: express.Request, res: express.Response) => {
    const { target } = req.body;

    if (!target || typeof target !== "string") {
      logError("Resolve", "Target input is missing or invalid type.");
      res.status(400).json({ error: "Hostname or IP address is required." });
      return;
    }

    const trimmedInput = target.trim();
    logInfo("Resolve", `Resolution request received for: "${trimmedInput}"`);

    // Helper: test if input looks like an IP address
    // This matches patterns with dots & digits, or numbers with dots, or IPv6 patterns containing colons
    const looksLikeIp = /^[0-9.:\s]+$/.test(trimmedInput) || 
                        /^[0-9]+(\.[0-9]+){1,3}$/.test(trimmedInput) ||
                        /^[0-9a-fA-F:]+$/.test(trimmedInput);

    if (looksLikeIp) {
      // Validate IP format
      const ipVersion = net.isIP(trimmedInput);
      if (ipVersion === 0) {
        logError("Resolve", `Invalid IP format matched: "${trimmedInput}"`);
        res.json({ 
          error: "Invalid IP address format.",
          type: "ip" 
        });
        return;
      }

      // Valid IP address directly
      logInfo("Resolve", `Direct valid IP validated: "${trimmedInput}" (IPv${ipVersion})`);
      res.json({
        resolvedIp: trimmedInput,
        type: "ip",
        version: ipVersion,
        isAlreadyIp: true
      });
      return;
    }

    // It is classified as a hostname input
    // Validate basic hostname structure before doing expensive lookup
    const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    if (trimmedInput !== "localhost" && !hostnameRegex.test(trimmedInput)) {
      logError("Resolve", `Invalid hostname structure check failed: "${trimmedInput}"`);
      res.json({ 
        error: "Invalid hostname or host not found.",
        type: "hostname" 
      });
      return;
    }

    // Resolve hostname to IP using dns lookup
    dns.lookup(trimmedInput, { family: 4 }, (err, address) => {
      if (err) {
        logError("Resolve DNS", `Failed to lookup "${trimmedInput}". Code: ${err.code}. Msg: ${err.message}`);
        res.json({ 
          error: "Invalid hostname or host not found.",
          type: "hostname",
          dnsCode: err.code 
        });
        return;
      }

      if (!address) {
        logError("Resolve DNS", `No address resolved for check: "${trimmedInput}"`);
        res.json({ 
          error: "Invalid hostname or host not found.",
          type: "hostname" 
        });
        return;
      }

      logInfo("Resolve DNS", `Successfully resolved "${trimmedInput}" to "${address}"`);
      res.json({
        host: trimmedInput,
        resolvedIp: address,
        type: "hostname",
        isAlreadyIp: false
      });
    });
  });

  // 2. Individual Port Scan Endpoint
  // This performs a standard TCP handshake attempt.
  // Using single-port probes allows client-side tracking, concurrent configuration, and easy cancelation.
  app.post("/api/scan-port", (req: express.Request, res: express.Response) => {
    const { ip, port, timeout = 1000 } = req.body;

    const portNum = parseInt(port, 10);
    if (!ip || isNaN(portNum) || portNum < 1 || portNum > 65535) {
      logError("ScanPort", `Invalid scan request parameters. IP: ${ip}, Port: ${port}`);
      res.status(400).json({ error: "Valid IP address and port (1-65535) are required." });
      return;
    }

    // Double check IP format integrity
    if (net.isIP(ip) === 0) {
      logError("ScanPort", `Invalid IP validation failure: "${ip}"`);
      res.json({ error: "Invalid IP address format.", port: portNum });
      return;
    }

    logInfo("ScanPort", `Scanning port ${portNum} on target ${ip} (Timeout: ${timeout}ms)`);

    const socket = new net.Socket();
    let isHandled = false;
    const startTime = process.hrtime();

    const cleanUpAndRespond = (status: "open" | "closed" | "filtered" | "error", details?: string) => {
      if (isHandled) return;
      isHandled = true;
      socket.destroy();

      const diff = process.hrtime(startTime);
      const durationMs = Math.round((diff[0] * 1000) + (diff[1] / 1000000));

      res.json({
        port: portNum,
        status,
        durationMs,
        details: details || `Resolved in ${durationMs}ms`
      });
    };

    socket.setTimeout(timeout);

    socket.connect(portNum, ip, () => {
      cleanUpAndRespond("open", "TCP connection established successfully");
    });

    socket.on("timeout", () => {
      cleanUpAndRespond("filtered", `Connection timed out after ${timeout}ms`);
    });

    socket.on("error", (err: any) => {
      let status: "closed" | "error" | "filtered" = "closed";
      let explanation = err.message || "Connection refused";

      if (err.code === "ECONNREFUSED") {
        status = "closed";
        explanation = "Connection refused by host";
      } else if (err.code === "EHOSTUNREACH" || err.code === "ENETUNREACH") {
        status = "filtered";
        explanation = "Host/Network is unreachable";
      } else if (err.code === "ETIMEDOUT") {
        status = "filtered";
        explanation = "Connection timed out";
      } else {
        status = "error";
        explanation = `Socket error: ${err.code || "unknown"}`;
      }

      cleanUpAndRespond(status, explanation);
    });
  });

  // Setup Vite Dev Server / Static Assets
  if (process.env.NODE_ENV !== "production") {
    logInfo("Lifecycle", "Starting server in DEVELOPMENT mode with Vite Middleware.");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    logInfo("Lifecycle", "Starting server in PRODUCTION mode with static build folder.");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req: express.Request, res: express.Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    logInfo("Lifecycle", `Server successfully started. Accessible on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("FATAL: Failed to start the backend Express server:", err);
});
