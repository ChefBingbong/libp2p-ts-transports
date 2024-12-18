import type { IpcSocketConnectOpts, ListenOptions, TcpSocketConnectOpts } from "net";
import os from "os";
import path from "path";
import type { Multiaddr } from "@multiformats/multiaddr";
import { multiaddr } from "@multiformats/multiaddr";

const ProtoFamily = { ip4: "IPv4", ip6: "IPv6" };

export type NetConfig = ListenOptions | (IpcSocketConnectOpts & TcpSocketConnectOpts);

export function multiaddrToNetConfig(addr: Multiaddr, config: NetConfig = {}): NetConfig {
	const listenPath = addr.getPath();

	// unix socket listening
	if (listenPath != null) {
		if (os.platform() === "win32") {
			// Use named pipes on Windows systems.
			return { path: path.join("\\\\.\\pipe\\", listenPath) };
		}
		return { path: listenPath };
	}

	// tcp listening
	return { ...config, ...addr.toOptions() };
}

export function getMultiaddrs(proto: "ip4" | "ip6", ip: string, port: number): Multiaddr[] {
	const toMa = (ip: string): Multiaddr => multiaddr(`/${proto}/${ip}/tcp/${port}`);
	return (isAnyAddr(ip) ? getNetworkAddrs(ProtoFamily[proto]) : [ip]).map(toMa);
}

export function isAnyAddr(ip: string): boolean {
	return ["0.0.0.0", "::"].includes(ip);
}

const networks = os.networkInterfaces();

function getNetworkAddrs(family: string): string[] {
	const addresses: string[] = [];

	for (const [, netAddrs] of Object.entries(networks)) {
		if (netAddrs != null) {
			for (const netAddr of netAddrs) {
				if (netAddr.family === family) {
					addresses.push(netAddr.address);
				}
			}
		}
	}

	return addresses;
}
