import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "canvas", "imapflow", "mailparser", "imap-handler", "smtp-connection"],
};

export default nextConfig;
