/** Stable information about the computer currently hosting AMADEUS. */
export interface HostInfo {
  id: string;
  hostname: string;
  platform: string;
  arch: string;
}

/** The narrow host boundary exposed to tools and runtime context. */
export interface Host {
  getInfo(): Promise<HostInfo>;
}
