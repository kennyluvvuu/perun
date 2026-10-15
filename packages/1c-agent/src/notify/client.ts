import { randomUUID } from "node:crypto";
import type {
	ExtensionUIConfirmRequest,
	ExtensionUIConfirmResponse,
	PerunNotifyConfig,
	PerunNotifyEvent,
} from "./types.ts";

export class PerunNotifyClient {
	private readonly config: PerunNotifyConfig;
	private readonly queue: PerunNotifyEvent[] = [];
	private processing = false;
	private flushWaiters: Array<() => void> = [];

	constructor(config: PerunNotifyConfig) {
		this.config = config;
	}

	private buildUrl(): string {
		const targetUrl = new URL(this.config.url);
		if (this.config.session) {
			targetUrl.searchParams.set("session", this.config.session);
		}
		return targetUrl.toString();
	}

	private handleError(message: string, error?: unknown): void {
		if (this.config.onError) {
			try {
				this.config.onError(message, error);
			} catch {
				// Prevent errors in user-supplied onError callback from interrupting flow
			}
		}
	}

	async askConfirm(title: string, message: string, signal?: AbortSignal): Promise<boolean | undefined> {
		if (signal?.aborted) {
			return undefined;
		}

		let url: string;
		try {
			url = this.buildUrl();
		} catch (error) {
			this.handleError("Invalid notify URL", error);
			return undefined;
		}

		const id = randomUUID();
		const timeoutMs = this.config.confirmTimeoutMs ?? 280000;
		const controller = new AbortController();

		const timeoutId = setTimeout(() => {
			controller.abort(new Error(`Confirmation timed out after ${timeoutMs}ms`));
		}, timeoutMs);

		const onAbort = () => {
			controller.abort(signal?.reason);
		};

		if (signal) {
			signal.addEventListener("abort", onAbort, { once: true });
		}

		const requestBody: ExtensionUIConfirmRequest = {
			type: "extension_ui_request",
			id,
			method: "confirm",
			title,
			message,
		};

		try {
			const fetchFn = this.config.fetchFn ?? fetch;
			const response = await fetchFn(url, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.config.secret}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(requestBody),
				signal: controller.signal,
			});

			if (response.status === 200) {
				const data = (await response.json()) as ExtensionUIConfirmResponse;
				if (data && data.type === "extension_ui_response" && data.id === id) {
					if (data.confirmed === true) {
						return true;
					}
					if (data.confirmed === false) {
						return false;
					}
					if (data.cancelled === true) {
						return undefined;
					}
				}
				return undefined;
			}

			this.handleError(`Confirmation request failed with HTTP ${response.status}: ${response.statusText}`);
			return undefined;
		} catch (error) {
			if (signal?.aborted) {
				return undefined;
			}
			this.handleError("Confirmation request failed", error);
			return undefined;
		} finally {
			clearTimeout(timeoutId);
			if (signal) {
				signal.removeEventListener("abort", onAbort);
			}
		}
	}

	notify(event: PerunNotifyEvent): void {
		this.queue.push(event);
		if (!this.processing) {
			this.processing = true;
			void this.processQueue();
		}
	}

	async flush(): Promise<void> {
		if (!this.processing && this.queue.length === 0) {
			return;
		}
		return new Promise<void>((resolve) => {
			this.flushWaiters.push(resolve);
		});
	}

	private async processQueue(): Promise<void> {
		try {
			while (this.queue.length > 0) {
				const event = this.queue.shift()!;
				try {
					await this.sendNotify(event);
				} catch (error) {
					this.handleError("Unexpected error in notify queue", error);
				}
			}
		} finally {
			this.processing = false;
			if (this.queue.length > 0) {
				this.processing = true;
				void this.processQueue();
			} else {
				const waiters = this.flushWaiters;
				this.flushWaiters = [];
				for (const waiter of waiters) {
					try {
						waiter();
					} catch {
						// Prevent waiter callback errors from interrupting flush
					}
				}
			}
		}
	}

	private async sendNotify(event: PerunNotifyEvent): Promise<void> {
		let url: string;
		try {
			url = this.buildUrl();
		} catch (error) {
			this.handleError("Invalid notify URL", error);
			return;
		}

		const timeoutMs = this.config.timeoutMs ?? 10000;
		const controller = new AbortController();
		const timeoutId = setTimeout(() => {
			controller.abort(new Error(`Notify request timed out after ${timeoutMs}ms`));
		}, timeoutMs);

		try {
			const fetchFn = this.config.fetchFn ?? fetch;
			const response = await fetchFn(url, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.config.secret}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(event),
				signal: controller.signal,
			});

			if (!response.ok) {
				this.handleError(`Notify request failed with HTTP ${response.status}: ${response.statusText}`);
			}
		} catch (error) {
			this.handleError("Notify request failed", error);
		} finally {
			clearTimeout(timeoutId);
		}
	}
}
