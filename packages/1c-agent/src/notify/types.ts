export interface PerunNotifyConfig {
	url: string;
	secret: string;
	session?: string;
	timeoutMs?: number;
	confirmTimeoutMs?: number;
	onError?: (message: string, error?: unknown) => void;
	fetchFn?: typeof fetch;
}

export interface ExtensionUIConfirmRequest {
	type: "extension_ui_request";
	id: string;
	method: "confirm";
	title: string;
	message: string;
}

export interface ExtensionUIConfirmResponse {
	type: "extension_ui_response";
	id: string;
	confirmed?: boolean;
	cancelled?: boolean;
}

export interface AgentEndNotifyEvent {
	type: "agent_end";
	messages: unknown[];
}

export interface AgentSettledNotifyEvent {
	type: "agent_settled";
	aborted: boolean;
}

export type PerunNotifyEvent = AgentEndNotifyEvent | AgentSettledNotifyEvent;
