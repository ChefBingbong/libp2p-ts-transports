import type { Server } from "http";
import os from "os";
import type {
	ComponentLogger,
	CounterGroup,
	CreateListenerOptions,
	Listener,
	ListenerEvents,
	Logger,
	MetricGroup,
	Metrics,
} from "@libp2p/interface";
import { TypedEventEmitter } from "@libp2p/interface";
import { ipPortToMultiaddr as toMultiaddr } from "@libp2p/utils/ip-port-to-multiaddr";
import type { Multiaddr } from "@multiformats/multiaddr";
import { multiaddr, protocols } from "@multiformats/multiaddr";
import type { DuplexWebSocket } from "it-ws/duplex";
import type { WebSocketServer } from "it-ws/server";
import { createServer } from "it-ws/server";
import { socketToMaConn } from "./socket-to-conn.js";

export interface WebSocketListenerComponents {
	logger: ComponentLogger;
	metrics?: Metrics;
}

export interface WebSocketListenerInit extends CreateListenerOptions {
	server?: Server;
}

export interface WebSocketListenerMetrics {
	status: MetricGroup;
	errors: CounterGroup;
	events: CounterGroup;
}

class WebSocketListener extends TypedEventEmitter<ListenerEvents> implements Listener {
	private readonly connections: Set<DuplexWebSocket>;
	private listeningMultiaddr?: Multiaddr;
	private readonly server: WebSocketServer;
	private readonly log: Logger;
	private metrics?: WebSocketListenerMetrics;
	private addr: string;

	constructor(components: WebSocketListenerComponents, init: WebSocketListenerInit) {
		super();

		this.log = components.logger.forComponent("libp2p:websockets:listener");
		const metrics = components.metrics;
		// Keep track of open connections to destroy when the listener is closed
		this.connections = new Set<DuplexWebSocket>();

		// biome-ignore lint/complexity/noUselessThisAlias: <explanation>
		const self = this; // eslint-disable-line @typescript-eslint/no-this-alias

		this.addr = "unknown";

		this.server = createServer({
			...init,
			onConnection: (stream: DuplexWebSocket) => {
				const maConn = socketToMaConn(stream, toMultiaddr(stream.remoteAddress ?? "", stream.remotePort ?? 0), {
					logger: components.logger,
					metrics: this.metrics?.events,
					metricPrefix: `${this.addr} `,
				});
				this.log("new inbound connection %s", maConn.remoteAddr);

				this.connections.add(stream);

				stream.socket.on("close", () => {
					self.connections.delete(stream);
				});

				init.upgrader.upgradeInbound(maConn).catch(async (err) => {
					this.log.error("inbound connection failed to upgrade", err);
					this.metrics?.errors.increment({ [`${this.addr} inbound_upgrade`]: true });

					try {
						maConn.abort(err);
					} catch (err) {
						this.log.error("inbound connection failed to close after upgrade failed - %e", err);
						this.metrics?.errors.increment({ [`${this.addr} inbound_closing_failed`]: true });
					}
				});
			},
		});

		this.server.on("listening", () => {
			if (metrics != null) {
				const { host, port } = this.listeningMultiaddr?.toOptions() ?? {};
				this.addr = `${host}:${port}`;

				metrics.registerMetricGroup("libp2p_websockets_inbound_connections_total", {
					label: "address",
					help: "Current active connections in WebSocket listener",
					calculate: () => {
						return {
							[this.addr]: this.connections.size,
						};
					},
				});

				this.metrics = {
					status: metrics?.registerMetricGroup("libp2p_websockets_listener_status_info", {
						label: "address",
						help: "Current status of the WebSocket listener socket",
					}),
					errors: metrics?.registerMetricGroup("libp2p_websockets_listener_errors_total", {
						label: "address",
						help: "Total count of WebSocket listener errors by type",
					}),
					events: metrics?.registerMetricGroup("libp2p_websockets_listener_events_total", {
						label: "address",
						help: "Total count of WebSocket listener events by type",
					}),
				};
			}
			this.dispatchEvent(new CustomEvent("listening"));
		});
		this.server.on("error", (err: Error) => {
			this.metrics?.errors.increment({ [`${this.addr} listen_error`]: true });
			this.dispatchEvent(
				new CustomEvent("error", {
					detail: err,
				}),
			);
		});
		this.server.on("close", () => {
			this.dispatchEvent(new CustomEvent("close"));
		});
	}

	async close(): Promise<void> {
		await Promise.all(
			Array.from(this.connections).map(async (maConn) => {
				await maConn.close();
			}),
		);

		if (this.server.address() == null) {
			// not listening, close will throw an error
			return;
		}

		await this.server.close();
	}

	async listen(ma: Multiaddr): Promise<void> {
		this.listeningMultiaddr = ma;

		await this.server.listen(ma.toOptions());
	}

	getAddrs(): Multiaddr[] {
		const multiaddrs = [];
		const address = this.server.address();

		if (address == null) {
			throw new Error("Listener is not ready yet");
		}

		if (typeof address === "string") {
			throw new Error("Wrong address type received - expected AddressInfo, got string - are you trying to listen on a unix socket?");
		}

		if (this.listeningMultiaddr == null) {
			throw new Error("Listener is not ready yet");
		}

		const ipfsId = this.listeningMultiaddr.getPeerId();
		const protos = this.listeningMultiaddr.protos();

		// Because TCP will only return the IPv6 version
		// we need to capture from the passed multiaddr
		if (protos.some((proto) => proto.code === protocols("ip4").code)) {
			const wsProto = protos.some((proto) => proto.code === protocols("ws").code) ? "/ws" : "/wss";
			let m = this.listeningMultiaddr.decapsulate("tcp");
			m = m.encapsulate(`/tcp/${address.port}${wsProto}`);
			if (ipfsId != null) {
				m = m.encapsulate(`/p2p/${ipfsId}`);
			}

			if (m.toString().includes("0.0.0.0")) {
				const netInterfaces = os.networkInterfaces();
				Object.values(netInterfaces).forEach((niInfos) => {
					if (niInfos == null) {
						return;
					}

					niInfos.forEach((ni) => {
						if (ni.family === "IPv4") {
							multiaddrs.push(multiaddr(m.toString().replace("0.0.0.0", ni.address)));
						}
					});
				});
			} else {
				multiaddrs.push(m);
			}
		}

		return multiaddrs;
	}
}

export function createListener(components: WebSocketListenerComponents, init: WebSocketListenerInit): Listener {
	return new WebSocketListener(components, init);
}
