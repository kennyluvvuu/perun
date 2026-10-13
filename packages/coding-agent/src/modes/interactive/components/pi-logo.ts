import { foregroundAnsi, isAppleTerminalSession, rgbColor } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";

const CORAL = rgbColor(228, 138, 122);
const YELLOW = rgbColor(234, 182, 93);
const RESET = "\x1b[0m";

/**
 * The PerUN logo: 4 cells wide and 2 lines tall. Each cell shows two square pixels with half blocks,
 * forming a stylized Cyrillic "П":
 *
 *   coral coral yellow yellow
 *   coral .     .      yellow
 *   coral .     .      yellow
 *   coral .     .      yellow
 *
 * The brand colors stay fixed across themes; they follow the terminal's color mode.
 */
export function piLogoLines(): [string, string] {
	const mode = theme.getColorMode();
	const fg = (color: typeof CORAL) => foregroundAnsi(color, mode);
	const top = `${fg(CORAL)}█▀${fg(YELLOW)}▀█${RESET}`;
	const bottom = `${fg(CORAL)}█  ${fg(YELLOW)}█${RESET}`;
	return [top, bottom];
}

/**
 * Whether the terminal renders the half-block logo correctly. Apple Terminal draws gaps between rows and
 * misaligns the half blocks, so it gets the text wordmark instead.
 */
export function supportsPiLogo(): boolean {
	return !isAppleTerminalSession();
}

/** Text fallback for the logo: "ПерУН" with 1C coral and yellow. */
export function piWordmark(): string {
	const mode = theme.getColorMode();
	return `${foregroundAnsi(CORAL, mode)}Пер${foregroundAnsi(YELLOW, mode)}УН${RESET}`;
}

