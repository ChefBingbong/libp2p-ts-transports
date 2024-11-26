import { serviceCapabilities, transportSymbol } from "@libp2p/interface";
import type { Connection, Listener, Logger, Transport } from "@libp2p/interface";
import type { Multiaddr } from "@multiformats/multiaddr";
import type { TCPComponents, TCPDialEvents, TCPMetrics, TCPOptions } from "./index.js";

export class TCP implements Transport<TCPDialEvents> {
	private readonly opts: TCPOptions;
	private readonly metrics?: TCPMetrics;
	private readonly components: TCPComponents;
	private readonly log: Logger;

	constructor() {
		throw new Error("TCP connections are not possible in browsers");
	}

	readonly [transportSymbol] = true;

	readonly [Symbol.toStringTag] = "@libp2p/tcp";

	readonly [serviceCapabilities]: string[] = ["@libp2p/transport"];

	async dial(): Promise<Connection> {
		throw new Error("TCP connections are not possible in browsers");
	}

	createListener(): Listener {
		throw new Error("TCP connections are not possible in browsers");
	}

	listenFilter(): Multiaddr[] {
		return [];
	}

	dialFilter(): Multiaddr[] {
		return [];
	}
}
