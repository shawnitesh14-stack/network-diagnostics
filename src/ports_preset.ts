import { PortItem } from "./types";

export const COMMON_PORTS: PortItem[] = [
  { port: 21, name: "FTP", description: "File Transfer Protocol", category: "Transfer" },
  { port: 22, name: "SSH", description: "Secure Shell remote access", category: "Admin" },
  { port: 23, name: "Telnet", description: "Unencrypted remote login", category: "Admin" },
  { port: 25, name: "SMTP", description: "Simple Mail Transfer Protocol", category: "Email" },
  { port: 53, name: "DNS", description: "Domain Name System resolution", category: "Other" },
  { port: 80, name: "HTTP", description: "Hypertext Transfer Protocol (Web)", category: "Web" },
  { port: 110, name: "POP3", description: "Post Office Protocol v3", category: "Email" },
  { port: 143, name: "IMAP", description: "Internet Message Access Protocol", category: "Email" },
  { port: 443, name: "HTTPS", description: "Secure HTTP (Web over SSL/TLS)", category: "Web" },
  { port: 445, name: "SMB", description: "Server Message Block (file share)", category: "Transfer" },
  { port: 1433, name: "MSSQL", description: "Microsoft SQL Server", category: "Database" },
  { port: 1521, name: "Oracle", description: "Oracle Database", category: "Database" },
  { port: 3306, name: "MySQL", description: "MySQL Database service", category: "Database" },
  { port: 3389, name: "RDP", description: "Remote Desktop Protocol connection", category: "Admin" },
  { port: 5432, name: "Postgres", description: "PostgreSQL Database service", category: "Database" },
  { port: 6379, name: "Redis", description: "Redis In-Memory Key-Value store", category: "Database" },
  { port: 8080, name: "HTTP-Alt", description: "Common alternative HTTP port/Java web app", category: "Web" },
  { port: 27017, name: "MongoDB", description: "NoSQL MongoDB connection", category: "Database" }
];
